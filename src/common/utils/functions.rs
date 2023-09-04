// Copyright 2023 Zinc Labs Inc.
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

use std::collections::HashMap;
use vector_enrichment::{Table, TableRegistry};

use crate::common::{
    infra::config::ENRICHMENT_TABLES,
    meta::{functions::VRLCompilerConfig, organization::DEFAULT_ORG},
};

pub async fn get_all_transform_keys(org_id: &str) -> Vec<String> {
    let org_key = &format!("{}/", org_id);

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
    registry.load(tables);
    let mut config = vrl::compiler::CompileConfig::default();
    config.set_custom(registry);
    VRLCompilerConfig { config, functions }
}
