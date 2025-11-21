// Copyright 2025 OpenObserve Inc.
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

use config::{
    cluster::LOCAL_NODE,
    meta::stream::{StreamStats, StreamType},
    utils::time::{now_micros, second_micros},
};
use hashbrown::HashMap;
use infra::{dist_lock, file_list as infra_file_list};

use crate::{
    common::infra::cluster::get_node_by_uuid,
    service::{db, file_list_dump},
};

pub async fn update_stats_from_file_list() -> Result<Option<(i64, i64)>, anyhow::Error> {
    let latest_update_at = infra_file_list::get_max_update_at()
        .await
        .map_err(|e| anyhow::anyhow!("get latest update_at error: {:?}", e))?;

    // no data in file_list
    if latest_update_at == 0 {
        return Ok(None);
    }

    // set the max_ts shouldn't greater than NOW-1m to avoid the latest data duplicated calculation
    let latest_update_at = std::cmp::min(latest_update_at, now_micros() - second_micros(60));

    loop {
        let Some(time_range) = update_stats_from_file_list_inner(latest_update_at).await? else {
            break;
        };
        log::info!("keep updating stream stats from file list, time range: {time_range:?} ...");
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }
    log::debug!("done updating stream stats from file list");
    Ok(None)
}

async fn update_stats_from_file_list_inner(
    latest_update_at: i64,
) -> Result<Option<(i64, i64)>, anyhow::Error> {
    // get last offset
    let (mut offset, node) = db::compact::stats::get_offset().await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(None);
    }

    // before starting, set current node to lock the job
    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        offset = match update_stats_lock_node().await {
            Ok(Some(offset)) => offset,
            Ok(None) => return Ok(None),
            Err(e) => return Err(e),
        }
    }

    // apply step limit
    let step_limit = config::get_config().limit.calculate_stats_step_limit_secs;
    // if the offset is 0, we use min_update_at to calculate the latest_update_at
    // otherwise, we use the offset + step_limit to calculate the latest_update_at
    let min_update_at = if offset == 0 {
        infra_file_list::get_min_update_at().await?
    } else {
        offset
    };
    let latest_update_at =
        std::cmp::min(min_update_at + second_micros(step_limit), latest_update_at);

    // there is no new data to process
    if offset == latest_update_at {
        return Ok(None);
    }

    // get stats from file_list
    let time_range = (offset, latest_update_at);
    let stream_stats = infra_file_list::stats(time_range)
        .await
        .map_err(|e| anyhow::anyhow!("get add stream stats error: {e}"))?;
    // get stats from file_list_dump
    // dump never store deleted files, so we do not have to consider deleted here
    let dumped_stats = file_list_dump::stats(time_range)
        .await
        .map_err(|e| anyhow::anyhow!("get dumped add stream stats error: {e}"))?;
    let mut stream_stats = stream_stats
        .into_iter()
        .collect::<HashMap<String, StreamStats>>();
    for (stream, stats) in dumped_stats {
        let entry = stream_stats.entry(stream).or_insert(StreamStats::default());
        *entry = &*entry + &stats;
    }
    // remove file_list_dump streams from stream_stats
    let filter_key = format!("/{}/", StreamType::Filelist);
    stream_stats.retain(|stream, _| !stream.contains(&filter_key));

    if !stream_stats.is_empty() {
        let stream_stats = stream_stats.into_iter().collect::<Vec<_>>();
        infra_file_list::set_stream_stats(&stream_stats, time_range)
            .await
            .map_err(|e| anyhow::anyhow!("set stream stats error: {e}"))?;
    }

    // update offset
    db::compact::stats::set_offset(latest_update_at, Some(&LOCAL_NODE.uuid.clone()))
        .await
        .map_err(|e| anyhow::anyhow!("set offset error: {e}"))?;

    Ok(Some(time_range))
}

async fn update_stats_lock_node() -> Result<Option<i64>, anyhow::Error> {
    let lock_key = "/compact/stream_stats/offset".to_string();
    let locker = dist_lock::lock(&lock_key, 0).await?;
    // check the working node for the organization again, maybe other node locked it
    // first
    let (offset, node) = db::compact::stats::get_offset().await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        dist_lock::unlock(&locker).await?;
        return Ok(None);
    }

    // bind the job to this node
    let ret = db::compact::stats::set_offset(offset, Some(&LOCAL_NODE.uuid.clone())).await;
    // already bind to this node, we can unlock now
    dist_lock::unlock(&locker).await?;
    if let Err(e) = ret {
        Err(e)
    } else {
        Ok(Some(offset))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() {
        infra::db::init().await.unwrap();
        // setup the offset
        _ = db::compact::stats::set_offset(1755705600000000, Some(&LOCAL_NODE.uuid.clone())).await;
    }

    #[tokio::test]
    async fn test_update_stats_from_file_list() {
        setup().await;
        let latest_updated_at = 1755706810000000;
        let ret = update_stats_from_file_list_inner(latest_updated_at)
            .await
            .unwrap();
        assert_eq!(ret, Some((1755705600000000, 1755706200000000)));
        let ret = update_stats_from_file_list_inner(latest_updated_at)
            .await
            .unwrap();
        assert_eq!(ret, Some((1755706200000000, 1755706800000000)));
        let ret = update_stats_from_file_list_inner(latest_updated_at)
            .await
            .unwrap();
        assert_eq!(ret, Some((1755706800000000, 1755706810000000)));
        let ret = update_stats_from_file_list_inner(latest_updated_at)
            .await
            .unwrap();
        assert_eq!(ret, None);
    }
}
