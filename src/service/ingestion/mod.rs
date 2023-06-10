// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashMap;
use arrow_schema::Schema;
use bytes::{BufMut, BytesMut};
use chrono::{TimeZone, Utc};
use datafusion::arrow::json::reader::infer_json_schema;
#[cfg(feature = "zo_functions")]
use std::collections::BTreeMap;
use std::io::BufReader;
#[cfg(feature = "zo_functions")]
use vector_enrichment::TableRegistry;
#[cfg(feature = "zo_functions")]
use vrl::compiler::TargetValueRef;
#[cfg(feature = "zo_functions")]
use vrl::compiler::{runtime::Runtime, CompilationResult};
#[cfg(feature = "zo_functions")]
use vrl::prelude::state;

use super::{db, triggers};
#[cfg(feature = "zo_functions")]
use crate::common::functions::get_vrl_compiler_config;
#[cfg(feature = "zo_functions")]
use crate::common::json;
#[cfg(feature = "zo_functions")]
use crate::infra::config::STREAM_FUNCTIONS;
use crate::infra::metrics;
#[cfg(feature = "zo_functions")]
use crate::meta::functions::StreamTransform;
#[cfg(feature = "zo_functions")]
use crate::meta::functions::VRLRuntimeConfig;

use crate::meta::StreamType;
use crate::{
    common::json::{Map, Value},
    infra::config::CONFIG,
};
use crate::{
    common::notification::send_notification,
    infra::config::STREAM_ALERTS,
    meta::alert::{Alert, Trigger},
};

#[cfg(feature = "zo_functions")]
pub fn compile_vrl_function(func: &str, org_id: &str) -> Result<VRLRuntimeConfig, std::io::Error> {
    if func.contains("get_env_var") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "get_env_var is not supported",
        ));
    }

    let external = state::ExternalEnv::default();
    let vrl_config = get_vrl_compiler_config(org_id);
    match vrl::compiler::compile_with_external(
        func,
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
        Err(e) => Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            vrl::diagnostic::Formatter::new(func, e).to_string(),
        )),
    }
}

#[cfg(feature = "zo_functions")]
pub fn apply_vrl_fn(runtime: &mut Runtime, vrl_runtime: &VRLRuntimeConfig, row: &Value) -> Value {
    let mut metadata = vrl::value::Value::from(BTreeMap::new());
    let mut target = TargetValueRef {
        value: &mut vrl::value::Value::from(row),
        metadata: &mut metadata,
        secrets: &mut vrl::value::Secrets::new(),
    };
    let timezone = vrl::compiler::TimeZone::Local;
    let result = match vrl::compiler::VrlRuntime::default() {
        vrl::compiler::VrlRuntime::Ast => {
            runtime.resolve(&mut target, &vrl_runtime.program, &timezone)
        }
    };
    match result {
        Ok(res) => match res.try_into() {
            Ok(val) => val,
            Err(_) => row.clone(),
        },
        Err(err) => {
            log::error!("Error from vrl {:?}", err);
            row.clone()
        }
    }
}

#[cfg(feature = "zo_functions")]
pub async fn get_stream_transforms<'a>(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    stream_transform_map: &mut AHashMap<String, Vec<StreamTransform>>,
    stream_vrl_map: &mut AHashMap<String, VRLRuntimeConfig>,
) {
    let key = format!("{}/{}/{}", &org_id, stream_type, &stream_name);
    if stream_transform_map.contains_key(&key) {
        return;
    }
    let mut _local_tans: Vec<StreamTransform> = vec![];
    (_local_tans, *stream_vrl_map) =
        crate::service::ingestion::register_stream_transforms(org_id, stream_type, stream_name);
    stream_transform_map.insert(key, _local_tans);
}

pub async fn get_stream_partition_keys(
    stream_name: &str,
    stream_schema_map: &AHashMap<String, Schema>,
) -> Vec<String> {
    let mut keys: Vec<String> = vec![];
    if stream_schema_map.contains_key(stream_name) {
        let schema = stream_schema_map.get(stream_name).unwrap();
        let mut meta = schema.metadata().clone();
        meta.remove("created_at");

        let stream_settings = meta.get("settings");

        if let Some(value) = stream_settings {
            let settings: Value = crate::common::json::from_slice(value.as_bytes()).unwrap();
            let part_keys = settings.get("partition_keys");

            if let Some(value) = part_keys {
                let mut v: Vec<_> = value.as_object().unwrap().into_iter().collect();
                v.sort_by(|a, b| a.0.cmp(b.0));
                for (_, value) in v {
                    keys.push(value.as_str().unwrap().to_string());
                }
            }
        }
    }
    keys
}

pub async fn get_stream_alerts<'a>(
    key: String,
    stream_alerts_map: &mut AHashMap<String, Vec<Alert>>,
) {
    if stream_alerts_map.contains_key(&key) {
        return;
    }
    let alerts_list = STREAM_ALERTS.get(&key);
    if alerts_list.is_none() {
        return;
    }
    let mut alerts = alerts_list.unwrap().list.clone();
    alerts.retain(|alert| alert.is_real_time);
    stream_alerts_map.insert(key, alerts);
}

pub fn get_hour_key(
    timestamp: i64,
    partition_keys: Vec<String>,
    local_val: &Map<String, Value>,
) -> String {
    // get hour file name
    let mut hour_key = Utc
        .timestamp_nanos(timestamp * 1000)
        .format("%Y_%m_%d_%H")
        .to_string();

    for key in &partition_keys {
        match local_val.get(key) {
            Some(v) => {
                let val = if v.is_string() {
                    format!("{}={}", key, v.as_str().unwrap())
                } else {
                    format!("{}={}", key, v)
                };
                hour_key.push_str(&format!("_{}", get_partition_key_record(&val)));
            }
            None => continue,
        };
    }
    hour_key
}

// generate partition key for record
pub fn get_partition_key_record(s: &str) -> String {
    let s = s.replace(['/', '_'], ".");
    if s.len() > 100 {
        s[0..100].to_string()
    } else {
        s
    }
}

pub async fn send_ingest_notification(trigger: Trigger, alert: Alert) {
    log::info!(
        "Sending notification for alert {} {}",
        alert.name,
        alert.stream
    );
    let _ = send_notification(&alert, &trigger).await;
    let trigger_to_save = Trigger {
        last_sent_at: Utc::now().timestamp_micros(),
        count: trigger.count + 1,
        ..trigger
    };
    let _ = triggers::save_trigger(&trigger_to_save.alert_name, &trigger_to_save).await;
}

#[cfg(feature = "zo_functions")]
pub fn register_stream_transforms(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> (Vec<StreamTransform>, AHashMap<String, VRLRuntimeConfig>) {
    let mut local_tans = vec![];
    let mut stream_vrl_map: AHashMap<String, VRLRuntimeConfig> = AHashMap::new();
    let key = format!("{}/{}/{}", &org_id, stream_type, &stream_name);

    if let Some(transforms) = STREAM_FUNCTIONS.get(&key) {
        local_tans = (*transforms.list).to_vec();
        local_tans.sort_by(|a, b| a.order.cmp(&b.order));
        for trans in &local_tans {
            let func_key = format!("{}/{}", &stream_name, trans.transform.name);
            if let Ok(vrl_runtime_config) = compile_vrl_function(&trans.transform.function, org_id)
            {
                let registry = vrl_runtime_config
                    .config
                    .get_custom::<TableRegistry>()
                    .unwrap();
                registry.finish_load();
                stream_vrl_map.insert(func_key, vrl_runtime_config);
            }
        }
    }

    (local_tans, stream_vrl_map)
}

#[cfg(feature = "zo_functions")]
pub fn apply_stream_transform<'a>(
    local_tans: &Vec<StreamTransform>,
    value: &'a Value,
    stream_vrl_map: &'a AHashMap<String, VRLRuntimeConfig>,
    stream_name: &str,
    runtime: &mut Runtime,
) -> Value {
    let mut value = value.clone();
    for trans in local_tans {
        let func_key = format!("{stream_name}/{}", trans.transform.name);
        if stream_vrl_map.contains_key(&func_key) && !value.is_null() {
            let vrl_runtime = stream_vrl_map.get(&func_key).unwrap();
            value = apply_vrl_fn(runtime, vrl_runtime, &value);
        }
    }
    json::flatten_json_and_format_field(&value)
}

pub fn format_stream_name(stream_name: &str) -> String {
    stream_name.replace('/', "_").replace('=', "-")
}

pub async fn chk_schema_by_record(
    stream_schema_map: &mut AHashMap<String, Schema>,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    record_ts: i64,
    record_val: &str,
) {
    let schema = if stream_schema_map.contains_key(stream_name) {
        stream_schema_map.get(stream_name).unwrap().clone()
    } else {
        let schema = db::schema::get(org_id, stream_name, Some(stream_type))
            .await
            .unwrap();
        stream_schema_map.insert(stream_name.to_string(), schema.clone());
        schema
    };
    if !schema.fields().is_empty() {
        return;
    }

    let mut schema_reader = BufReader::new(record_val.as_bytes());
    let inferred_schema = infer_json_schema(&mut schema_reader, None).unwrap();
    let inferred_schema = inferred_schema.with_metadata(schema.metadata().clone());
    stream_schema_map.insert(stream_name.to_string(), inferred_schema.clone());
    db::schema::set(
        org_id,
        stream_name,
        stream_type,
        &inferred_schema,
        Some(record_ts),
        true,
    )
    .await
    .unwrap();
}

pub fn write_file(
    buf: AHashMap<String, Vec<String>>,
    thread_id: usize,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) {
    let mut write_buf = BytesMut::new();
    for (key, entry) in buf {
        if entry.is_empty() {
            continue;
        }
        let file = crate::infra::wal::get_or_create(
            thread_id,
            org_id,
            stream_name,
            stream_type,
            &key,
            CONFIG.common.wal_memory_mode_enabled,
        );

        let mut write_size = 0;
        if CONFIG.common.wal_line_mode_enabled {
            for row in &entry {
                write_buf.clear();
                write_buf.put(row.as_bytes());
                write_buf.put("\n".as_bytes());
                file.write(write_buf.as_ref());
                write_size += write_buf.len() as u64
            }
        } else {
            write_buf.clear();
            for row in &entry {
                write_buf.put(row.as_bytes());
                write_buf.put("\n".as_bytes());
            }
            file.write(write_buf.as_ref());
            write_size += write_buf.len() as u64
        }

        // metrics
        metrics::INGEST_RECORDS
            .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
            .inc_by(entry.len() as u64);
        metrics::INGEST_BYTES
            .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
            .inc_by(write_size);
    }
}

#[cfg(feature = "zo_functions")]
pub fn init_functions_runtime() -> Runtime {
    crate::common::functions::init_vrl_runtime()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_get_partition_key_record() {
        assert_eq!(
            get_partition_key_record("default/olympics"),
            "default.olympics"
        );
    }
    #[test]
    fn test_get_hour_key() {
        let mut local_val = Map::new();
        local_val.insert("country".to_string(), Value::String("USA".to_string()));
        local_val.insert("sport".to_string(), Value::String("basketball".to_string()));
        assert_eq!(
            get_hour_key(
                1620000000,
                vec!["country".to_string(), "sport".to_string()],
                &local_val
            ),
            "1970_01_01_00_country=USA_sport=basketball"
        );
    }

    #[test]
    fn test_get_hour_key_no_partition_keys() {
        let mut local_val = Map::new();
        local_val.insert("country".to_string(), Value::String("USA".to_string()));
        local_val.insert("sport".to_string(), Value::String("basketball".to_string()));
        assert_eq!(
            get_hour_key(1620000000, vec![], &local_val),
            "1970_01_01_00"
        );
    }
    #[test]
    fn test_get_hour_key_no_partition_keys_no_local_val() {
        assert_eq!(
            get_hour_key(1620000000, vec![], &Map::new()),
            "1970_01_01_00"
        );
    }
    #[actix_web::test]
    async fn test_get_stream_partition_keys() {
        let mut stream_schema_map = AHashMap::new();
        let mut meta = HashMap::new();
        meta.insert(
            "settings".to_string(),
            r#"{"partition_keys": {"country": "country", "sport": "sport"}}"#.to_string(),
        );
        let schema = Schema::new(vec![]).with_metadata(meta);
        stream_schema_map.insert("olympics".to_string(), schema);
        let keys = get_stream_partition_keys("olympics", &stream_schema_map).await;
        assert_eq!(keys, vec!["country".to_string(), "sport".to_string()]);
    }

    #[actix_web::test]
    #[cfg(feature = "zo_functions")]
    async fn test_compile_vrl_function() {
        let result = compile_vrl_function(
            r#"if .country == "USA" {
                ..country = "United States"
            }"#,
            "default",
        );
        assert!(result.is_err())
    }
}
