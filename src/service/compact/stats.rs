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

use tokio::time;

use crate::common::infra::{
    cluster::{get_node_by_uuid, LOCAL_NODE_UUID},
    config::CONFIG,
    dist_lock, file_list as infra_file_list,
};
use crate::service::db;

pub async fn update_stats_from_file_list() -> Result<(), anyhow::Error> {
    // get last offset
    let (mut offset, node) = db::compact::stats::get_offset().await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
        log::error!("[COMPACT] update stats from file_list is merging by {node}");
        return Ok(());
    }

    // before starting, set current node to lock the job
    if node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
        offset = update_stats_lock_node().await?;
    }

    // get latest offset
    let latest_pk = infra_file_list::get_max_pk_value().await?;
    let pk_value = if offset == 0 && latest_pk == 0 {
        None
    } else {
        Some((offset, latest_pk))
    };

    // get stats from file_list
    let orgs = db::schema::list_organizations_from_cache();
    for org_id in orgs {
        let stream_stats = infra_file_list::stats(&org_id, None, None, pk_value).await?;
        if !stream_stats.is_empty() {
            infra_file_list::set_stream_stats(&org_id, &stream_stats).await?;
        }
        time::sleep(time::Duration::from_secs(1)).await;
    }

    // update offset
    db::compact::stats::set_offset(latest_pk, Some(&LOCAL_NODE_UUID.clone())).await?;

    Ok(())
}

async fn update_stats_lock_node() -> Result<i64, anyhow::Error> {
    let lock_key = format!("compact/stream_stats/offset");
    let locker = dist_lock::lock(&lock_key, CONFIG.etcd.command_timeout).await?;
    // check the working node for the organization again, maybe other node locked it first
    let (offset, node) = db::compact::stats::get_offset().await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
        dist_lock::unlock(&locker).await?;
        return Err(anyhow::anyhow!(
            "[COMPACT] update stats from file_list is merging by {node}"
        ));
    }

    // bind the job to this node
    if let Err(e) = db::compact::stats::set_offset(offset, Some(&LOCAL_NODE_UUID.clone())).await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }

    // already bind to this node, we can unlock now
    dist_lock::unlock(&locker).await?;
    Ok(offset)
}
