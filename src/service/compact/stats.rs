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

use chrono::{Timelike, Utc};
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::stream::{ALL_STREAM_TYPES, StreamType},
    metrics,
    utils::time::{BASE_TIME, day_micros, get_ymdh_from_micros, now_micros},
};
use infra::{dist_lock, file_list as infra_file_list};

use crate::{common::infra::cluster::get_node_by_uuid, service::db};

pub async fn update_stats_from_file_list() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    // check if current hour is allowed for update stats
    // this config for data retention, but we also use it for update stats
    if !cfg.compact.retention_allowed_hours.is_empty() {
        let current_hour = Utc::now().hour();
        let allowed_hours: Vec<u32> = cfg
            .compact
            .retention_allowed_hours
            .split(',')
            .filter_map(|s| s.trim().parse::<u32>().ok())
            .filter(|&h| h < 24)
            .collect();

        if !allowed_hours.is_empty() && !allowed_hours.contains(&current_hour) {
            log::info!(
                "[COMPACTOR] update stats skipped: current hour {} is not in allowed hours {:?}",
                current_hour,
                allowed_hours
            );
            return Ok(());
        }
    }

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

    // no more data to update
    if last_updated_at >= latest_updated_at {
        return Ok(());
    }

    // check if we need to update old stats by comparing the last_updated and now is the same day
    let no_need_update_old_stats = last_updated_at > 0
        && get_ymdh_from_micros(last_updated_at) == get_ymdh_from_micros(now_micros());

    log::info!(
        "[STATS] update stats from file list, last updated: {last_updated_at}, latest updated: {latest_updated_at}, no need update old stats: {no_need_update_old_stats}"
    );

    // we need to init now before the loop, also need to update offset use this value
    let now_ts = now_micros();

    // get updated streams if we don't need to update old stats
    let updated_streams = if no_need_update_old_stats {
        infra_file_list::get_updated_streams((last_updated_at, latest_updated_at)).await?
    } else {
        vec![]
    };

    let orgs = db::schema::list_organizations_from_cache().await;
    let mut total_streams = 0;
    for org_id in orgs {
        for stream_type in ALL_STREAM_TYPES {
            if stream_type == StreamType::Index || stream_type == StreamType::Filelist {
                continue;
            }
            let streams = db::schema::list_streams_from_cache(&org_id, stream_type).await;
            total_streams += streams.len();
            for stream_name in streams {
                let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
                if !updated_streams.is_empty() && !updated_streams.contains(&stream_key) {
                    continue;
                }
                let start = std::time::Instant::now();
                let result = update_stats_from_file_list_inner(
                    &org_id,
                    stream_type,
                    &stream_name,
                    latest_updated_at,
                    no_need_update_old_stats,
                )
                .await;

                // Record metrics
                let duration = start.elapsed().as_secs_f64();
                let stream_type_str = stream_type.to_string();

                metrics::STREAM_STATS_SCAN_DURATION
                    .with_label_values(&[&org_id, &stream_type_str])
                    .observe(duration);

                metrics::STREAM_STATS_SCAN_TOTAL
                    .with_label_values(&[&org_id, &stream_type_str])
                    .inc();

                if let Err(e) = result {
                    metrics::STREAM_STATS_SCAN_ERRORS_TOTAL
                        .with_label_values(&[&org_id, &stream_type_str])
                        .inc();

                    log::error!(
                        "[STATS] update stats for {org_id}/{stream_type}/{stream_name} error: {e}"
                    );
                    return Err(e);
                }

                log::info!(
                    "[STATS] update stats for {org_id}/{stream_type}/{stream_name} in {} ms",
                    (duration * 1000.0) as u64
                );
            }
        }
    }

    // Update global metrics
    metrics::STREAM_STATS_STREAMS_TOTAL
        .with_label_values::<&str>(&[])
        .set(total_streams as i64);
    metrics::STREAM_STATS_LAST_SCAN_TIMESTAMP
        .with_label_values::<&str>(&[])
        .set(now_micros());

    // update offset to current time
    db::compact::stats::set_offset(now_ts, Some(&LOCAL_NODE.uuid.clone()))
        .await
        .map_err(|e| anyhow::anyhow!("set offset error: {e}"))?;

    Ok(())
}

async fn update_stats_from_file_list_inner(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    latest_updated_at: i64,
    no_need_update_old_stats: bool,
) -> Result<(), anyhow::Error> {
    let yesterday_boundary = get_yesterday_boundary();

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
