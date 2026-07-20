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

use bytes::Bytes;

fn mk_key() -> String {
    "/service_graph/node/offsets".to_string()
}

pub async fn get_offset() -> (i64, String) {
    let key = mk_key();
    let db = infra::db::get_db().await;
    let mut value = match db.get(&key).await {
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
    let val = Bytes::from(val);
    infra::db::get_db()
        .await
        .put(&key, val.clone(), infra::db::NO_NEED_WATCH, None)
        .await?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::put(
            &key,
            val,
            infra::db::NO_NEED_WATCH,
            None,
        )
        .await
        .map_err(|err| anyhow::anyhow!(err.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mk_key_returns_expected_path() {
        assert_eq!(mk_key(), "/service_graph/node/offsets");
    }
}
