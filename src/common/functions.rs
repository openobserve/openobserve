use crate::infra::config::LOOKUP_TABLES;
use std::collections::HashMap;
use vector_enrichment::{Table, TableRegistry};

use crate::meta::functions::VRLCompilerConfig;

pub async fn get_all_transform_keys(org_id: &str) -> Vec<String> {
    let mut fn_list = Vec::new();
    for transform in crate::infra::config::QUERY_FUNCTIONS.iter() {
        let key = transform.key();
        let org_key = &format!("{}/", org_id);
        if key.contains(org_key) {
            if let Some(v) = key.strip_prefix(org_key).to_owned() {
                fn_list.push(v.to_string())
            }
        }
    }
    fn_list
}

#[cfg(feature = "zo_functions")]
pub fn init_vrl_runtime() -> vrl::compiler::runtime::Runtime {
    vrl::compiler::runtime::Runtime::new(vrl::prelude::state::RuntimeState::default())
}

pub fn get_vrl_compiler_config() -> VRLCompilerConfig {
    let look = LOOKUP_TABLES.clone();
    let mut functions = vrl::stdlib::all();
    functions.append(&mut vector_enrichment::vrl_functions());
    let registry = TableRegistry::default();
    let mut tables: HashMap<String, Box<dyn Table + Send + Sync>> = HashMap::new();

    for table in look.iter() {
        tables.insert(
            table.clone().stream_name.to_owned(),
            Box::new(table.value().clone()),
        );
    }
    registry.load(tables);
    let mut config = vrl::compiler::CompileConfig::default();
    config.set_custom(registry);
    VRLCompilerConfig { config, functions }
}
