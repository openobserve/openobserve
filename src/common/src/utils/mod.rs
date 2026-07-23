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

pub mod http;
pub mod jwt;
pub mod redirect_response;
pub mod ssrf_guard;

// TODO: in a separate PR combine this with jobs/mod duplication perhaps?
#[cfg(feature = "enterprise")]
pub async fn get_nats_lock(key: String) -> Result<String, anyhow::Error> {
    use config::cluster::LOCAL_NODE;
    use infra::{cluster::get_node_by_uuid, dist_lock};

    let db = infra::db::get_db().await;
    let node = db.get(&key).await.ok().unwrap_or_default();
    let node = String::from_utf8_lossy(&node);
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(node.to_string());
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let locker = infra::dist_lock::lock(&key, 0).await?;
        // check the working node again, maybe other node locked it first
        let node = db.get(&key).await.ok().unwrap_or_default();
        let node = String::from_utf8_lossy(&node);
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(node.to_string());
        }
        // set to current node
        let ret = db
            .put(
                &key,
                LOCAL_NODE.uuid.clone().into(),
                infra::db::NO_NEED_WATCH,
                None,
            )
            .await;
        // Check db.put result before releasing the lock to ensure consistent state
        if let Err(e) = ret {
            dist_lock::unlock(&locker).await?;
            drop(locker);
            return Err(e.into());
        }
        dist_lock::unlock(&locker).await?;
        drop(locker);
    }

    Ok(LOCAL_NODE.uuid.clone())
}
