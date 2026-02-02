// Copyright 2025 OpenObserve Inc.
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

pub fn get_vrl_compiler_config(org_id: &str) -> VRLCompilerConfig {
    let en_tables = ENRICHMENT_TABLES.clone();
    let mut functions = vrl::stdlib::all();
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
}
