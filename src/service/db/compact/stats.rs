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

use std::sync::atomic;

use crate::common::infra::{config::CONFIG, db as infra_db};

static LOCAL_OFFSET: atomic::AtomicI64 = atomic::AtomicI64::new(0);

pub async fn get_offset() -> (i64, String) {
    if !CONFIG.common.meta_store_external {
        let offset = LOCAL_OFFSET.load(atomic::Ordering::Relaxed);
        return (offset, String::from(""));
    }

    let db = infra_db::get_db().await;
    let key = "/compact/stream_stats/offset";
    let value = match db.get(key).await {
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

pub async fn set_offset(offset: i64, node: Option<&str>) -> Result<(), anyhow::Error> {
    if !CONFIG.common.meta_store_external {
        LOCAL_OFFSET.store(offset, atomic::Ordering::Relaxed);
        return Ok(());
    }

    let db = infra_db::get_db().await;
    let key = "/compact/stream_stats/offset";
    let val = if let Some(node) = node {
        format!("{};{}", offset, node)
    } else {
        offset.to_string()
    };
    Ok(db.put(key, val.into(), infra_db::NO_NEED_WATCH).await?)
}
