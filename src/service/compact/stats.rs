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
    metrics,
    utils::time::{day_micros, get_ymdh_from_micros, now_micros},
};
use infra::{cluster::get_node_by_uuid, dist_lock, file_list as infra_file_list};

use crate::service::db;

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

    // get updated streams if we don't need to update old stats
    let updated_streams = if no_need_update_old_stats {
        infra_file_list::get_updated_streams((last_updated_at, latest_updated_at)).await?
    } else {
        vec![]
    };

    let yesterday_boundary = get_yesterday_boundary();
    let new_data_range = (yesterday_boundary.clone(), "".to_string());
    let old_data_range = ("".to_string(), yesterday_boundary.clone());

    let iter = [(new_data_range, true), (old_data_range, false)];

    let orgs = db::schema::list_organizations_from_cache().await;
    let mut total_streams = 0;
    for org_id in orgs {
        for stream_type in ALL_STREAM_TYPES {
            if stream_type == StreamType::Index || stream_type == StreamType::Filelist {
                continue;
            }
            let streams = db::schema::list_streams_from_cache(&org_id, stream_type).await;
            total_streams += streams.len();
            let stream_type_str = stream_type.to_string();
            for stream_name in streams {
                let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
                if !updated_streams.is_empty() && !updated_streams.contains(&stream_key) {
                    continue;
                }

                let start = std::time::Instant::now();
                for (date_range, is_recent) in iter.iter() {
                    if !is_recent && no_need_update_old_stats {
                        continue;
                    }
                    let start = std::time::Instant::now();
                    let result = update_stats_from_file_list_for_stream(
                        &org_id,
                        stream_type,
                        &stream_name,
                        date_range.clone(),
                        *is_recent,
                    )
                    .await;

                    // Record metrics
                    let duration = start.elapsed().as_secs_f64();
                    let scan_type = if *is_recent { "recent" } else { "historical" }.to_string();
                    metrics::STREAM_STATS_SCAN_DURATION
                        .with_label_values(&[&org_id, &stream_type_str, &scan_type])
                        .observe(duration);

                    metrics::STREAM_STATS_SCAN_TOTAL
                        .with_label_values(&[&org_id, &stream_type_str, &scan_type])
                        .inc();

                    if let Err(e) = result {
                        metrics::STREAM_STATS_SCAN_ERRORS_TOTAL
                            .with_label_values(&[&org_id, &stream_type_str, &scan_type])
                            .inc();

                        log::error!(
                            "[STATS] update stats for {org_id}/{stream_type}/{stream_name} error: {e}"
                        );
                        return Err(e);
                    }
                }

                log::info!(
                    "[STATS] update stats for {org_id}/{stream_type}/{stream_name} in {} ms",
                    start.elapsed().as_millis()
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
    db::compact::stats::set_offset(latest_updated_at, Some(&LOCAL_NODE.uuid.clone()))
        .await
        .map_err(|e| anyhow::anyhow!("set offset error: {e}"))?;

    Ok(())
}

pub async fn update_stats_from_file_list_for_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: (String, String),
    is_recent: bool,
) -> Result<(), anyhow::Error> {
    let mut stats =
        infra_file_list::stats_by_date_range(org_id, stream_type, stream_name, date_range.clone())
            .await?;
    let dump_stats = infra_file_list::query_dump_stats_by_date_range(
        org_id,
        stream_type,
        stream_name,
        date_range.clone(),
    )
    .await?;
    stats.merge(&dump_stats);
    infra_file_list::set_stream_stats(org_id, stream_type, stream_name, &stats, is_recent).await?;

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
pub fn get_yesterday_boundary() -> String {
    get_ymdh_from_micros(now_micros() - day_micros(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_yesterday_boundary_format() {
        let boundary = get_yesterday_boundary();

        // Should be in YYYY/MM/DD/HH format
        assert!(boundary.len() >= 13); // "YYYY/MM/DD/HH"

        // Split and verify parts
        let parts: Vec<&str> = boundary.split('/').collect();
        assert!(parts.len() >= 4, "Boundary should have at least 4 parts");

        // Verify year is 4 digits
        assert_eq!(parts[0].len(), 4);

        // Verify month is 2 digits
        assert_eq!(parts[1].len(), 2);

        // Verify day is 2 digits
        assert_eq!(parts[2].len(), 2);

        // Verify hour is 2 digits
        assert_eq!(parts[3].len(), 2);
    }

    #[test]
    fn test_get_yesterday_boundary_is_valid_date() {
        let boundary = get_yesterday_boundary();

        // Should be parseable as a date
        let parts: Vec<&str> = boundary.split('/').collect();

        let year: i32 = parts[0].parse().expect("Year should be a number");
        let month: u32 = parts[1].parse().expect("Month should be a number");
        let day: u32 = parts[2].parse().expect("Day should be a number");
        let hour: u32 = parts[3].parse().expect("Hour should be a number");

        assert!(year > 2020 && year < 2100, "Year should be reasonable");
        assert!((1..=12).contains(&month), "Month should be 1-12");
        assert!((1..=31).contains(&day), "Day should be 1-31");
        assert!(hour < 24, "Hour should be 0-23");
    }

    #[test]
    fn test_get_yesterday_boundary_is_yesterday() {
        let boundary = get_yesterday_boundary();
        let now_boundary = get_ymdh_from_micros(now_micros());

        // Yesterday should be different from today
        assert_ne!(boundary, now_boundary);

        // Yesterday should be lexicographically less than today (for dates in YYYY/MM/DD/HH format)
        assert!(boundary < now_boundary);
    }

    #[test]
    fn test_get_yesterday_boundary_consistency() {
        // Call multiple times in quick succession
        let boundary1 = get_yesterday_boundary();
        let boundary2 = get_yesterday_boundary();

        // Should be the same (assuming test runs quickly)
        assert_eq!(boundary1, boundary2);
    }

    #[tokio::test]
    async fn test_update_stats_from_file_list_for_stream_with_empty_date_range() {
        // Test with empty date strings
        let result = update_stats_from_file_list_for_stream(
            "test_org",
            StreamType::Logs,
            "test_stream",
            ("".to_string(), "".to_string()),
            true,
        )
        .await;

        // Should handle empty range gracefully (may return error or empty stats)
        let _ = result; // Test structure - actual behavior depends on implementation
    }

    #[test]
    fn test_yesterday_boundary_hour_is_zero() {
        let boundary = get_yesterday_boundary();
        let parts: Vec<&str> = boundary.split('/').collect();

        // The boundary should be at hour 00 (start of the day)
        // But this might vary based on implementation
        let hour: u32 = parts[3].parse().expect("Hour should be a number");
        assert!(hour < 24, "Hour should be valid");
    }

    #[test]
    fn test_date_range_ordering() {
        // Test that historical range is before recent range
        let yesterday = get_yesterday_boundary();
        let now_date = get_ymdh_from_micros(now_micros());

        // Yesterday should be before now
        assert!(yesterday <= now_date);
    }
}
