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

use infra::dist_lock;

use crate as db;

const V4_STARTED_AT_KEY: &str = "/service_graph/v4/started_at";
const V1_STOPPED_KEY: &str = "/service_graph/v1/stopped";

fn mk_key() -> String {
    "/service_graph/node/offsets".to_string()
}

pub fn v4_offset_key(org_id: &str, stream_name: &str) -> String {
    format!("/service_graph/v4/offsets/{org_id}/{stream_name}")
}

pub async fn get_offset() -> (i64, String) {
    let key = mk_key();
    let mut value = match db::get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    if value.is_empty() {
        value = String::from("0");
    }
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
    let key = mk_key();
    let val = if let Some(node) = node {
        format!("{offset};{node}")
    } else {
        offset.to_string()
    };
    Ok(db::put(&key, val.into(), db::NO_NEED_WATCH, None).await?)
}

/// Malformed meta-db content is `(0, "")`, never a panic.
pub fn parse_v4_offset(value: &str) -> (i64, String) {
    let value = value.trim();
    if value.is_empty() {
        return (0, String::new());
    }
    let (offset, node) = value.split_once(';').unwrap_or((value, ""));
    match offset.parse::<i64>() {
        Ok(offset) if offset >= 0 => (offset, node.to_string()),
        _ => {
            log::warn!("[ServiceGraph] malformed v4 offset value {value:?}, treating as unset");
            (0, String::new())
        }
    }
}

pub async fn get_v4_offset(org_id: &str, stream_name: &str) -> (i64, String) {
    let key = v4_offset_key(org_id, stream_name);
    match db::get(&key).await {
        Ok(ret) => parse_v4_offset(&String::from_utf8_lossy(&ret)),
        Err(_) => (0, String::new()),
    }
}

/// Value is `<micros>;<node_uuid>`: the claiming node travels with the offset.
pub async fn set_v4_offset(
    org_id: &str,
    stream_name: &str,
    offset: i64,
    node: &str,
) -> Result<(), anyhow::Error> {
    let key = v4_offset_key(org_id, stream_name);
    let val = format!("{offset};{node}");
    Ok(db::put(&key, val.into(), db::NO_NEED_WATCH, None).await?)
}

pub async fn get_started_at() -> Option<i64> {
    get_i64(V4_STARTED_AT_KEY).await
}

pub async fn set_started_at_if_absent(now: i64) -> Result<(), anyhow::Error> {
    put_once(V4_STARTED_AT_KEY, now.to_string()).await
}

pub async fn is_v1_stopped() -> bool {
    is_flag(V1_STOPPED_KEY).await
}

pub async fn set_v1_stopped_if_absent() -> Result<(), anyhow::Error> {
    put_once(V1_STOPPED_KEY, "true".to_string()).await
}

async fn get_i64(key: &str) -> Option<i64> {
    let ret = db::get(key).await.ok()?;
    String::from_utf8_lossy(&ret).trim().parse::<i64>().ok()
}

async fn is_flag(key: &str) -> bool {
    match db::get(key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).trim() == "true",
        Err(_) => false,
    }
}

/// Write-once: re-read under the lock because two schedulers may reach the same switch together.
async fn put_once(key: &str, value: String) -> Result<(), anyhow::Error> {
    if db::get(key).await.is_ok() {
        return Ok(());
    }
    let locker = dist_lock::lock(key, 0).await?;
    let ret = if db::get(key).await.is_ok() {
        Ok(())
    } else {
        db::put(key, value.into(), db::NO_NEED_WATCH, None)
            .await
            .map_err(anyhow::Error::from)
    };
    dist_lock::unlock(&locker).await?;
    ret
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mk_key_returns_expected_path() {
        assert_eq!(mk_key(), "/service_graph/node/offsets");
    }

    #[test]
    fn test_key_formats() {
        assert_eq!(
            v4_offset_key("default", "traces"),
            "/service_graph/v4/offsets/default/traces"
        );
        assert_eq!(V4_STARTED_AT_KEY, "/service_graph/v4/started_at");
        assert_eq!(V1_STOPPED_KEY, "/service_graph/v1/stopped");
    }

    #[test]
    fn test_parse_v4_offset_micros_and_uuid() {
        assert_eq!(
            parse_v4_offset("1700000000000000;node-a"),
            (1_700_000_000_000_000, "node-a".to_string())
        );
        assert_eq!(parse_v4_offset("42;"), (42, String::new()));
        assert_eq!(parse_v4_offset("42"), (42, String::new()));
    }

    #[test]
    fn test_parse_v4_offset_malformed_is_unset() {
        assert_eq!(parse_v4_offset(""), (0, String::new()));
        assert_eq!(parse_v4_offset("abc;node"), (0, String::new()));
        assert_eq!(parse_v4_offset(";node"), (0, String::new()));
        assert_eq!(parse_v4_offset("-5;node"), (0, String::new()));
        assert_eq!(parse_v4_offset("1.5;node"), (0, String::new()));
    }
}
