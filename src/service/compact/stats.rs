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
    meta::stream::{ALL_STREAM_TYPES, StreamType},
    utils::time::{BASE_TIME, day_micros, get_ymdh_from_micros, now_micros},
};
use infra::{dist_lock, file_list as infra_file_list};

use crate::{common::infra::cluster::get_node_by_uuid, service::db};

pub async fn update_stats_from_file_list() -> Result<(), anyhow::Error> {
    let latest_updated_at = infra_file_list::get_max_update_at()
        .await
        .map_err(|e| anyhow::anyhow!("get latest update_at error: {:?}", e))?;

    // no data in file_list
    if latest_updated_at == 0 {
        return Ok(());
    }

    // get last offset
    let (mut last_updated_at, node) = db::compact::stats::get_offset().await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(());
    }

    // before starting, set current node to lock the job
    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        last_updated_at = match update_stats_lock_node().await {
            Ok(Some(v)) => v,
            Ok(None) => return Ok(()),
            Err(e) => return Err(e),
        }
    }

    log::info!(
        "[STATS] update stats from file list, last updated: {last_updated_at}, latest updated: {latest_updated_at}"
    );

    let orgs = db::schema::list_organizations_from_cache().await;
    for org_id in orgs {
        for stream_type in ALL_STREAM_TYPES {
            let streams = db::schema::list_streams_from_cache(&org_id, stream_type).await;
            for stream_name in streams {
                let start = std::time::Instant::now();
                if let Err(e) = update_stats_from_file_list_inner(
                    &org_id,
                    stream_type,
                    &stream_name,
                    latest_updated_at,
                    last_updated_at,
                )
                .await
                {
                    log::error!(
                        "[STATS] update stats for {org_id}/{stream_type}/{stream_name} error: {e}"
                    );
                    return Err(e);
                }
                let took = start.elapsed().as_millis();
                log::info!(
                    "[STATS] update stats for {org_id}/{stream_type}/{stream_name} in {took} ms"
                );
            }
        }
    }

    // update offset to current time
    let offset = now_micros();
    db::compact::stats::set_offset(offset, Some(&LOCAL_NODE.uuid.clone()))
        .await
        .map_err(|e| anyhow::anyhow!("set offset error: {e}"))?;

    Ok(())
}

async fn update_stats_from_file_list_inner(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    latest_updated_at: i64,
    last_updated_at: i64,
) -> Result<(), anyhow::Error> {
    let yesterday_boundary = get_yesterday_boundary();

    // check if we need to update old stats by comparing the last_updated and now is the same day
    let no_need_update_old_stats = last_updated_at > 0
        && get_ymdh_from_micros(last_updated_at) == get_ymdh_from_micros(now_micros());

    // update latest stats
    let new_data_range = (
        yesterday_boundary.clone(),
        get_ymdh_from_micros(latest_updated_at),
    );

    let mut stats = infra_file_list::stats_by_date_range(
        org_id,
        stream_type,
        stream_name,
        new_data_range.clone(),
    )
    .await?;
    let dump_stats = infra_file_list::query_dump_stats_by_date_range(
        org_id,
        stream_type,
        stream_name,
        new_data_range.clone(),
    )
    .await?;
    stats.merge(&dump_stats);
    infra_file_list::set_stream_stats(org_id, stream_type, stream_name, &stats, true).await?;

    // update old stats
    if no_need_update_old_stats {
        return Ok(());
    }
    let old_data_range = (
        get_ymdh_from_micros(BASE_TIME.timestamp_micros()),
        yesterday_boundary.clone(),
    );
    let mut stats = infra_file_list::stats_by_date_range(
        org_id,
        stream_type,
        stream_name,
        old_data_range.clone(),
    )
    .await?;
    let dump_stats = infra_file_list::query_dump_stats_by_date_range(
        org_id,
        stream_type,
        stream_name,
        old_data_range.clone(),
    )
    .await?;
    stats.merge(&dump_stats);
    infra_file_list::set_stream_stats(org_id, stream_type, stream_name, &stats, false).await?;

    Ok(())
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

/// Get yesterday's boundary date (yesterday 00:00:00 in YYYY/MM/DD/HH)
/// This is the boundary between "historical" and "recent" data
fn get_yesterday_boundary() -> String {
    get_ymdh_from_micros(now_micros() - day_micros(1))
}
