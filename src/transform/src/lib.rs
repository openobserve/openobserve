// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Shared ownership for OpenObserve transform definitions, enrichment tables,
//! and VRL compilation. This crate deliberately has no dependency on core or
//! the search engine so both can consume the same runtime state.

use std::{
    collections::{BTreeMap, HashMap},
    sync::LazyLock,
};

use config::{
    DEFAULT_ORG, RwHashMap,
    meta::{
        function::{Transform, VRLCompilerConfig, VRLResultResolver, VRLRuntimeConfig},
        stream::StreamType,
    },
    metrics,
    utils::json,
};
use vector_enrichment::{Table, TableRegistry};
use vrl::{
    compiler::{CompilationResult, TargetValueRef, runtime::Runtime},
    prelude::NotNan,
};

pub mod enrichment;
pub mod js;

use enrichment::ENRICHMENT_TABLES;
// Re-export the underlying engines so downstream crates depend on this crate
// instead of on `vrl`/`vector-enrichment` directly.
pub use vector_enrichment;
pub use vrl;

/// Metric label recorded when a transform fails to process a record.
pub const TRANSFORM_FAILED: &str = "document_failed_transform";

/// Query and ingestion transform definitions, keyed by `org_id/function_name`.
pub static QUERY_FUNCTIONS: LazyLock<RwHashMap<String, Transform>> =
    LazyLock::new(Default::default);

/// Process-wide enrichment tables such as MaxMind databases.
///
/// Organization-owned stream enrichment tables live in [`ENRICHMENT_TABLES`].
static GLOBAL_ENRICHMENT_TABLES: LazyLock<RwHashMap<String, Box<dyn Table + Send + Sync>>> =
    LazyLock::new(Default::default);

pub fn register_global_enrichment_table<T>(name: impl Into<String>, table: T)
where
    T: Table + Send + Sync + 'static,
{
    GLOBAL_ENRICHMENT_TABLES.insert(name.into(), Box::new(table));
}

pub fn remove_global_enrichment_table(name: &str) {
    GLOBAL_ENRICHMENT_TABLES.remove(name);
}

pub async fn get_all_transform_keys(org_id: &str) -> Vec<String> {
    let org_key = format!("{org_id}/");

    QUERY_FUNCTIONS
        .iter()
        .filter_map(|transform| {
            let key = transform.key();
            key.strip_prefix(&org_key).map(ToOwned::to_owned)
        })
        .collect()
}

pub fn init_vrl_runtime() -> Runtime {
    Runtime::new(vrl::prelude::state::RuntimeState::default())
}

pub fn get_enrichment_tables(org_id: &str) -> HashMap<String, Box<dyn Table + Send + Sync>> {
    let mut tables = HashMap::new();

    for table in ENRICHMENT_TABLES.iter() {
        if table.org_id == org_id || table.org_id == DEFAULT_ORG {
            tables.insert(
                table.stream_name.clone(),
                Box::new(table.value().clone()) as Box<dyn Table + Send + Sync>,
            );
        }
    }

    for table in GLOBAL_ENRICHMENT_TABLES.iter() {
        tables.insert(table.key().clone(), table.value().clone());
    }

    tables
}

pub fn get_vrl_compiler_config(org_id: &str) -> VRLCompilerConfig {
    let mut functions = vrl::stdlib::all();
    functions.append(&mut vector_enrichment::vrl_functions());
    let registry = TableRegistry::default();
    registry.load(get_enrichment_tables(org_id));
    let mut config = vrl::compiler::CompileConfig::default();
    config.set_custom(registry);
    VRLCompilerConfig { config, functions }
}

pub fn compile_vrl_function(
    source: &str,
    org_id: &str,
) -> Result<VRLRuntimeConfig, std::io::Error> {
    if source.contains("get_env_var") {
        return Err(std::io::Error::other("get_env_var is not supported"));
    }

    let external = vrl::prelude::state::ExternalEnv::default();
    let vrl_config = get_vrl_compiler_config(org_id);
    match vrl::compiler::compile_with_external(
        source,
        &vrl_config.functions,
        &external,
        vrl_config.config,
    ) {
        Ok(CompilationResult {
            program,
            warnings: _,
            config,
        }) => Ok(VRLRuntimeConfig {
            program,
            config,
            fields: vec![],
        }),
        Err(error) => Err(std::io::Error::other(
            vrl::diagnostic::Formatter::new(source, error).to_string(),
        )),
    }
}

pub fn apply_vrl_fn(
    runtime: &mut Runtime,
    vrl_runtime: &VRLResultResolver,
    row: json::Value,
    org_id: &str,
    stream_name: &[String],
) -> (json::Value, Option<String>) {
    let mut metadata = vrl::value::Value::from(BTreeMap::new());
    metadata.insert("org_id", vrl::value::Value::from(org_id.to_string()));
    metadata.insert(
        "stream_name",
        vrl::value::Value::from(stream_name[0].clone()),
    );
    let mut target = TargetValueRef {
        value: &mut vrl::value::Value::from(&row),
        metadata: &mut metadata,
        secrets: &mut vrl::value::Secrets::new(),
    };

    target
        .secrets
        .insert(stream_name[0].clone(), stream_name[0].clone());

    let timezone = vrl::compiler::TimeZone::Local;
    let result = match vrl::compiler::VrlRuntime::default() {
        vrl::compiler::VrlRuntime::Ast => {
            runtime.resolve(&mut target, &vrl_runtime.program, &timezone)
        }
    };
    match result {
        Ok(res) => match res.try_into() {
            Ok(val) => (val, None),
            Err(err) => {
                metrics::INGEST_ERRORS
                    .with_label_values(&[
                        org_id,
                        StreamType::Logs.as_str(),
                        &format!("{stream_name:?}"),
                        TRANSFORM_FAILED,
                    ])
                    .inc();
                // Log full error with record for debugging
                log::debug!(
                    "{org_id}/{stream_name:?} vrl failed at processing result {err:?} on record {row:?}. Returning original row."
                );
                // Return only error message without sensitive record data
                let clean_err = format!("{org_id}/{stream_name:?} vrl failed: {err:?}");
                (row, Some(clean_err))
            }
        },
        Err(err) => {
            metrics::INGEST_ERRORS
                .with_label_values(&[
                    org_id,
                    StreamType::Logs.as_str(),
                    &format!("{stream_name:?}"),
                    TRANSFORM_FAILED,
                ])
                .inc();
            // Log full error with record for debugging
            log::debug!(
                "{org_id}/{stream_name:?} vrl runtime failed at getting result {err:?} on record {row:?}. Returning original row."
            );
            // Return only error message without sensitive record data
            let clean_err = format!("{org_id}/{stream_name:?} vrl runtime error: {err:?}");
            (row, Some(clean_err))
        }
    }
}

pub fn convert_to_vrl(value: &json::Value) -> vrl::value::Value {
    match value {
        json::Value::Null => vrl::value::Value::Null,
        json::Value::Bool(b) => vrl::value::Value::Boolean(*b),
        json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                vrl::value::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                vrl::value::Value::Float(NotNan::new(f).unwrap_or(NotNan::new(0.0).unwrap()))
            } else {
                unimplemented!("handle other number types")
            }
        }
        json::Value::String(s) => vrl::value::Value::from(s.as_str()),
        json::Value::Array(arr) => {
            vrl::value::Value::Array(arr.iter().map(convert_to_vrl).collect())
        }
        json::Value::Object(obj) => vrl::value::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.to_string().into(), convert_to_vrl(v)))
                .collect(),
        ),
    }
}

pub fn convert_from_vrl(value: &vrl::value::Value) -> json::Value {
    match value {
        vrl::value::Value::Null => json::Value::Null,
        vrl::value::Value::Boolean(b) => json::Value::Bool(*b),
        vrl::value::Value::Integer(i) => json::Value::Number(json::Number::from(*i)),
        vrl::value::Value::Float(f) => json::Value::Number(
            json::Number::from_f64(f.into_inner()).unwrap_or(json::Number::from(0)),
        ),
        vrl::value::Value::Bytes(b) => json::Value::String(String::from_utf8_lossy(b).to_string()),
        vrl::value::Value::Array(arr) => {
            json::Value::Array(arr.iter().map(convert_from_vrl).collect())
        }
        vrl::value::Value::Object(obj) => json::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.to_string(), convert_from_vrl(v)))
                .collect(),
        ),
        vrl::value::Value::Timestamp(ts) => json::Value::Number(json::Number::from(
            ts.timestamp_nanos_opt().unwrap_or(0) / 1000,
        )),
        vrl::value::Value::Regex(_) => json::Value::String("regex".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::function::Transform;
    use vector_enrichment::TableRegistry;

    use super::{
        enrichment::{ENRICHMENT_TABLES, StreamTable},
        *,
    };

    #[test]
    fn creates_vrl_compiler_config_with_org_enrichment_tables() {
        let key = "vrl_crate_test/default/users";
        ENRICHMENT_TABLES.insert(
            key.to_string(),
            StreamTable {
                org_id: "vrl_crate_test".to_string(),
                stream_name: "users".to_string(),
                data: Arc::new(vec![]),
            },
        );

        let config = get_vrl_compiler_config("vrl_crate_test");
        let registry = config.config.get_custom::<TableRegistry>().unwrap();
        assert!(registry.table_ids().contains(&"users".to_string()));

        ENRICHMENT_TABLES.remove(key);
    }

    #[test]
    fn includes_registered_global_enrichment_tables() {
        let name = "vrl_crate_test_global";
        register_global_enrichment_table(
            name,
            StreamTable {
                org_id: "default".to_string(),
                stream_name: name.to_string(),
                data: Arc::new(vec![]),
            },
        );

        let config = get_vrl_compiler_config("vrl_crate_test");
        let registry = config.config.get_custom::<TableRegistry>().unwrap();
        assert!(registry.table_ids().contains(&name.to_string()));

        remove_global_enrichment_table(name);
    }

    #[tokio::test]
    async fn returns_transform_keys_for_requested_org() {
        let key = "vrl_crate_test/test_transform";
        QUERY_FUNCTIONS.insert(
            key.to_string(),
            Transform {
                name: "test_transform".to_string(),
                function: ".".to_string(),
                params: "row".to_string(),
                num_args: 1,
                trans_type: Some(0),
                streams: None,
            },
        );

        let keys = get_all_transform_keys("vrl_crate_test").await;
        assert_eq!(keys, vec!["test_transform"]);

        QUERY_FUNCTIONS.remove(key);
    }

    #[test]
    fn rejects_environment_access() {
        let error = match compile_vrl_function("get_env_var!(\"HOME\")", "default") {
            Ok(_) => panic!("get_env_var must be rejected"),
            Err(error) => error,
        };
        assert_eq!(error.to_string(), "get_env_var is not supported");
    }
}
