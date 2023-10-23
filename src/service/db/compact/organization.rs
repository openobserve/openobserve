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

use once_cell::sync::Lazy;

use crate::common::infra::{config::RwHashMap, db as infra_db};

pub static STREAMS: Lazy<RwHashMap<String, RwHashMap<String, i64>>> = Lazy::new(Default::default);

fn mk_key(org_id: &str, module: &str) -> String {
    format!("/compact/organization/{org_id}/{module}")
}

pub async fn get_offset(org_id: &str, module: &str) -> (i64, String) {
    let db = &infra_db::DEFAULT;
    let key = mk_key(org_id, module);
    let value = match db.get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    if value.contains(';') {
        let mut parts = value.split(';');
        let offset: i64 = parts.next().unwrap().parse().unwrap();
        let node = parts.next().unwrap().to_string();
        (offset, node)
    } else {
        (value.parse().unwrap(), String::from(""))
    }
}

pub async fn set_offset(
    org_id: &str,
    module: &str,
    offset: i64,
    node: Option<&str>,
) -> Result<(), anyhow::Error> {
    let db = &infra_db::DEFAULT;
    let key = mk_key(org_id, module);
    let val = if let Some(node) = node {
        format!("{};{}", offset, node)
    } else {
        offset.to_string()
    };
    Ok(db.put(&key, val.into(), infra_db::NO_NEED_WATCH).await?)
}
