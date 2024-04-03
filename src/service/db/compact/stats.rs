// Copyright 2023 Zinc Labs Inc.
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

use std::sync::atomic;

use config::CONFIG;

use crate::service::db;
static LOCAL_OFFSET: atomic::AtomicI64 = atomic::AtomicI64::new(0);

pub async fn get_offset() -> (i64, String) {
    if !CONFIG.common.meta_store_external {
        let offset = LOCAL_OFFSET.load(atomic::Ordering::Relaxed);
        return (offset, String::from(""));
    }

    let key = "/compact/stream_stats/offset";
    let value = match db::get(key).await {
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
        LOCAL_OFFSET.store(offset, atomic::Ordering::Release);
        return Ok(());
    }

    let key = "/compact/stream_stats/offset";
    let val = if let Some(node) = node {
        format!("{};{}", offset, node)
    } else {
        offset.to_string()
    };
    Ok(db::put(key, val.into(), db::NO_NEED_WATCH, None).await?)
}
