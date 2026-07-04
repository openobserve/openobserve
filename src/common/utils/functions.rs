// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::collections::HashMap;

use config::{
    GEO_IP_ASN_ENRICHMENT_TABLE, GEO_IP_CITY_ENRICHMENT_TABLE, meta::function::VRLCompilerConfig,
};
use vector_enrichment::{Table, TableRegistry};

use crate::common::{
    infra::config::{ENRICHMENT_TABLES, GEOIP_ASN_TABLE, GEOIP_CITY_TABLE},
    meta::organization::DEFAULT_ORG,
};

pub async fn get_all_transform_keys(org_id: &str) -> Vec<String> {
    let org_key = &format!("{org_id}/");

    crate::common::infra::config::QUERY_FUNCTIONS
        .clone()
        .iter()
        .filter_map(|transform| {
            let key = transform.key();
            key.strip_prefix(org_key).map(|x| x.to_string())
        })
        .collect()
}

pub fn init_vrl_runtime() -> vrl::compiler::runtime::Runtime {
    vrl::compiler::runtime::Runtime::new(vrl::prelude::state::RuntimeState::default())
}

/// Identifiers of VRL stdlib functions that perform outbound network I/O.
///
/// These functions let VRL programs issue arbitrary HTTP / DNS requests from
/// inside the OpenObserve process. The VRL runtime does not respect the app's
/// `SsrfGuard`, so if we expose these to user-supplied VRL (e.g. via
/// `POST /api/{org}/functions/test`, pipeline transforms, or the search
/// `query_fn`), an org admin can turn the server into a server-side request
/// forwarder — reaching loopback, the cloud instance metadata service, or
/// forging Authorization headers against internal ingest APIs to poison
/// another tenant's streams (see TC-7BBD9F20).
///
/// The runtime-level fix is to never register these functions with the VRL
/// compiler in the first place; a program that references them then fails to
/// compile with an "undefined function" diagnostic, before any I/O can occur.
///
/// This deny-list intentionally excludes VRL's core parsing / encoding /
/// transformation functions (`parse_json`, `upcase`, `encode_json`, ...): those
/// are pure and safe.
const VRL_BLOCKED_NETWORK_FUNCTIONS: &[&str] = &["http_request", "dns_lookup", "reverse_dns"];

pub fn get_vrl_compiler_config(org_id: &str) -> VRLCompilerConfig {
    let en_tables = ENRICHMENT_TABLES.clone();
    // Build the allowed VRL function list by filtering vrl::stdlib::all() to
    // strip any outbound-network function. See VRL_BLOCKED_NETWORK_FUNCTIONS.
    let mut functions: Vec<Box<dyn vrl::compiler::Function>> = vrl::stdlib::all()
        .into_iter()
        .filter(|f| !VRL_BLOCKED_NETWORK_FUNCTIONS.contains(&f.identifier()))
        .collect();
    functions.append(&mut vector_enrichment::vrl_functions());
    let registry = TableRegistry::default();
    let mut tables: HashMap<String, Box<dyn Table + Send + Sync>> = HashMap::new();

    for table in en_tables.iter() {
        if table.org_id == org_id || table.org_id == DEFAULT_ORG {
            tables.insert(
                table.stream_name.to_owned(),
                Box::new(table.value().clone()),
            );
        }
    }
    drop(en_tables);

    if let Some(v) = GEOIP_CITY_TABLE.read().as_ref() {
        tables.insert(GEO_IP_CITY_ENRICHMENT_TABLE.to_owned(), Box::new(v.clone()));
    }

    if let Some(v) = GEOIP_ASN_TABLE.read().as_ref() {
        tables.insert(GEO_IP_ASN_ENRICHMENT_TABLE.to_owned(), Box::new(v.clone()));
    }

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .common
        .enable_enterprise_mmdb
    {
        let geoip_ent = crate::common::infra::config::GEOIP_ENT_TABLE.read();
        if let Some(table) = geoip_ent.as_ref() {
            tables.insert(
                o2_enterprise::enterprise::common::config::GEO_IP_ENTERPRISE_ENRICHMENT_TABLE
                    .to_owned(),
                Box::new(table.clone()),
            );
        }
    };

    registry.load(tables);
    let mut config = vrl::compiler::CompileConfig::default();
    config.set_custom(registry);
    VRLCompilerConfig { config, functions }
}

#[cfg(test)]
mod tests {

    use std::sync::Arc;

    use super::*;

    #[test]
    fn test_init_vrl_runtime() {
        let runtime = init_vrl_runtime();
        assert!(runtime.is_empty());
    }

    #[test]
    fn test_get_vrl_compiler_config() {
        let config = get_vrl_compiler_config("default");
        assert!(!config.functions.is_empty());
        assert!(config.config.get_custom::<TableRegistry>().is_some());
    }

    #[tokio::test]
    async fn test_get_all_transform_keys() {
        // Setup test data
        let test_org = "test_org";
        let test_key = format!("{test_org}/test_transform");
        crate::common::infra::config::QUERY_FUNCTIONS.insert(
            test_key.clone(),
            config::meta::function::Transform {
                name: test_key.clone(),
                function: ".".to_string(),
                params: "row".to_string(),
                num_args: 1,
                trans_type: Some(0),
                streams: Some(vec![config::meta::function::StreamOrder {
                    stream: "test".to_string(),
                    order: 1,
                    stream_type: config::meta::stream::StreamType::Logs,
                    is_removed: false,
                    apply_before_flattening: false,
                }]),
            },
        );

        // Test the function
        let keys = get_all_transform_keys(test_org).await;
        assert!(keys.contains(&"test_transform".to_string()));
    }

    #[test]
    fn test_get_vrl_compiler_config_with_enrichment_tables() {
        // Setup test data
        let test_org = "test_org";
        let test_stream = "test_stream";
        let table_name = "test_table";
        let en_table = crate::service::enrichment::StreamTable {
            org_id: test_org.to_string(),
            stream_name: test_stream.to_string(),
            data: Arc::new(vec![]),
        };
        ENRICHMENT_TABLES.insert(table_name.to_string(), en_table);

        // Test the function
        let config = get_vrl_compiler_config(test_org);
        let registry = config.config.get_custom::<TableRegistry>().unwrap();

        // Verify enrichment table is loaded
        assert!(registry.table_ids().contains(&test_stream.to_string()));
    }

    #[tokio::test]
    async fn test_get_all_transform_keys_empty() {
        let keys = get_all_transform_keys("nonexistent_org").await;
        assert!(keys.is_empty());
    }

    #[test]
    fn test_get_vrl_compiler_config_empty() {
        let config = get_vrl_compiler_config("nonexistent_org");
        let registry = config.config.get_custom::<TableRegistry>().unwrap();
        assert!(registry.table_ids().is_empty());
    }

    /// Security regression: outbound-network VRL stdlib functions
    /// (`http_request`, `dns_lookup`, `reverse_dns`) MUST NOT be exposed to
    /// user-supplied VRL. `http_request!()` in particular gives any org admin
    /// who reaches `/api/{org}/functions/test` a server-side request forger
    /// that runs from inside the OpenObserve process (SSRF into loopback +
    /// internal APIs, cross-tenant data poisoning). See TC-7BBD9F20.
    ///
    /// The allowed VRL function list built by `get_vrl_compiler_config` must
    /// therefore contain none of the outbound-network functions.
    #[test]
    fn test_vrl_compiler_config_excludes_outbound_network_functions() {
        let config = get_vrl_compiler_config("default");
        let identifiers: Vec<&'static str> =
            config.functions.iter().map(|f| f.identifier()).collect();

        for banned in ["http_request", "dns_lookup", "reverse_dns"] {
            assert!(
                !identifiers.contains(&banned),
                "VRL stdlib exposed outbound-network function `{banned}` to \
                 user code; this enables SSRF from the function-test endpoint \
                 (see TC-7BBD9F20). Deny it in get_vrl_compiler_config()."
            );
        }
    }

    /// Security regression: a VRL program that references `http_request!()`
    /// must fail to compile through `get_vrl_compiler_config`'s allowed
    /// function list — because the function is not registered, VRL should
    /// raise an "undefined function" style diagnostic at compile time.
    ///
    /// Paired positive-control below asserts a harmless VRL program still
    /// compiles, so this red is provably the network-function block, not a
    /// broken VRL setup.
    #[test]
    fn test_vrl_program_using_http_request_fails_to_compile() {
        let vrl_config = get_vrl_compiler_config("default");
        let external = vrl::prelude::state::ExternalEnv::default();
        let src = r#"
            .r = http_request!("http://127.0.0.1:5080/api/whatever/_json",
                               method: "POST",
                               headers: {},
                               body: "{}")
            .
        "#;
        let result = vrl::compiler::compile_with_external(
            src,
            &vrl_config.functions,
            &external,
            vrl_config.config,
        );
        assert!(
            result.is_err(),
            "VRL program calling http_request!() compiled successfully; \
             this is the SSRF surface from TC-7BBD9F20 — http_request must \
             not be in the allowed VRL function list."
        );
    }

    /// Positive control for
    /// `test_vrl_program_using_http_request_fails_to_compile`:
    /// a benign VRL program that uses core transformation functions
    /// (`upcase`, field assignment) MUST still compile, so the red above
    /// is provably specific to the outbound-network function rather than a
    /// broken compiler setup.
    #[test]
    fn test_vrl_program_using_safe_stdlib_still_compiles() {
        let vrl_config = get_vrl_compiler_config("default");
        let external = vrl::prelude::state::ExternalEnv::default();
        let src = r#"
            .greeting = upcase("hello")
            .
        "#;
        let result = vrl::compiler::compile_with_external(
            src,
            &vrl_config.functions,
            &external,
            vrl_config.config,
        );
        assert!(
            result.is_ok(),
            "Benign VRL program failed to compile; the network-function \
             deny-list must not remove core transformation functions."
        );
    }
}
