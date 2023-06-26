use crate::{infra::config::ENRICHMENT_TABLES, meta::organization::DEFAULT_ORG};
use std::collections::HashMap;
use vector_enrichment::{Table, TableRegistry};

use crate::meta::functions::VRLCompilerConfig;

pub async fn get_all_transform_keys(org_id: &str) -> Vec<String> {
    let org_key = &format!("{}/", org_id);

    crate::infra::config::QUERY_FUNCTIONS
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
    registry.load(tables);
    let mut config = vrl::compiler::CompileConfig::default();
    config.set_custom(registry);
    VRLCompilerConfig { config, functions }
}
