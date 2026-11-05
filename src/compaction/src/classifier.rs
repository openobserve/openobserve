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

//! Moves a stream to daily or back to hourly from the volume of its last closed days.

use std::sync::atomic::{AtomicI64, Ordering};

use config::{
    DYNAMIC_PARTITION_MIN_WINDOW_DAYS,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        cluster::Role,
        stream::{PartitionTimeLevel, StreamType},
    },
    utils::time::{day_micros, now_micros},
};
use infra::{
    cluster::get_node_from_consistent_hash,
    schema::{
        get_settings, get_stream_setting_dynamic_partition, unwrap_stream_created_at,
        unwrap_stream_settings,
    },
};

/// Hashes to the one compactor that runs the classifier.
const CLASSIFIER_NODE_KEY: &str = "dynamic_partition_classifier";

/// The newest closed day this node has classified the streams up to.
static LAST_RUN_DAY: AtomicI64 = AtomicI64::new(0);

/// The closed days a run looks at, ending with `newest_day`.
#[derive(Clone, Copy)]
struct ClassifyWindow {
    newest_day: i64,
    days: i64,
}

impl ClassifyWindow {
    /// The days retention still holds whole, `None` when that is too few to judge from.
    fn within_retention(self, retention_days: i64) -> Option<Self> {
        let days = if retention_days > 0 {
            self.days.min(retention_days - 1)
        } else {
            self.days
        };
        (days >= DYNAMIC_PARTITION_MIN_WINDOW_DAYS).then_some(Self { days, ..self })
    }

    /// Whether a stream created at `created_at` existed through all the days.
    fn covers(&self, created_at: i64) -> bool {
        created_at > 0 && created_at <= self.newest_day - (self.days - 1) * day_micros(1)
    }
}

/// Classifies all streams once per closed day on one compactor; repeating a run changes nothing.
pub async fn run() -> Result<(), anyhow::Error> {
    // keyed by the day, not by today: a tick before yesterday settles must not use up the day
    let newest_day = newest_closed_day(now_micros(), crate::settle_micros());
    if LAST_RUN_DAY.load(Ordering::Relaxed) == newest_day {
        return Ok(());
    }
    let Some(node_name) =
        get_node_from_consistent_hash(CLASSIFIER_NODE_KEY, &Role::Compactor, None).await
    else {
        return Ok(()); // no compactor node
    };
    if LOCAL_NODE.name.ne(&node_name) {
        return Ok(()); // not this node
    }
    let cfg = get_config();
    let window = ClassifyWindow {
        newest_day,
        days: cfg.compact.dynamic_partition_window_days,
    };
    for (org_id, stream_types) in db::schema::list_all_streams_grouped().await {
        if db::file_list::BLOCKED_ORGS.contains(&org_id) {
            continue;
        }
        for (stream_type, streams) in &stream_types {
            if stream_type.support_dynamic_partition() {
                classify_streams(&org_id, *stream_type, streams, window).await;
            }
        }
    }
    LAST_RUN_DAY.store(newest_day, Ordering::Relaxed);
    Ok(())
}

async fn classify_streams(
    org_id: &str,
    stream_type: StreamType,
    streams: &[String],
    window: ClassifyWindow,
) {
    for stream_name in streams {
        if db::compact::retention::is_deleting_stream(org_id, stream_type, stream_name, None) {
            continue;
        }
        if let Err(e) = classify_stream(org_id, stream_type, stream_name, window).await {
            log::error!(
                "[COMPACTOR] classify [{org_id}/{stream_type}/{stream_name}] failed, the next run retries: {e}"
            );
        }
    }
}

async fn classify_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    window: ClassifyWindow,
) -> Result<(), anyhow::Error> {
    let settings = get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();
    if !get_stream_setting_dynamic_partition(stream_type, Some(&settings)) {
        return Ok(());
    }
    // a day retention has deleted reads as empty and would keep a busy stream from moving back
    let retention_days =
        crate::retention::retention_days(&settings, get_config().compact.data_retention_days);
    let Some(window) = window.within_retention(retention_days) else {
        return Ok(());
    };
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let created_at = unwrap_stream_created_at(&schema).unwrap_or_default();
    if !window.covers(created_at) {
        return Ok(());
    }

    let current = settings.partition_time_level.current_level();
    let mut target = current;
    let max_file_size = get_config().compact.max_file_size as f64;
    let mut sizes = Vec::with_capacity(window.days as usize);
    for day_ago in 0..window.days {
        let day = window.newest_day - day_ago * day_micros(1);
        let stats = crate::stats::day_stats(org_id, stream_type, stream_name, day).await?;
        sizes.push(stats.storage_size);
        // stop at the first day that rules a move out: most streams need only one
        match classify(&sizes, max_file_size) {
            Some(level) if level != current => target = level,
            _ => return Ok(()),
        }
    }
    // the queries took a while: a change made since must survive this write
    let schema = infra::schema::get_from_db(org_id, stream_name, stream_type).await?;
    if schema.fields().is_empty() {
        return Ok(()); // the stream was deleted meanwhile
    }
    // a stream ingest created and nobody edited has no stored settings yet
    let mut settings = unwrap_stream_settings(&schema).unwrap_or_default();
    if !get_stream_setting_dynamic_partition(stream_type, Some(&settings)) {
        return Ok(());
    }
    // a run can pass midnight, and an effect day taken from its start may have begun
    if settings
        .partition_time_level
        .set_level(target, now_micros())
    {
        schema::save_stream_settings(org_id, stream_name, stream_type, settings).await?;
        log::info!("[COMPACTOR] classify [{org_id}/{stream_type}/{stream_name}] moves to {target}");
    }
    Ok(())
}

/// The newest day ending at least `settle` ago.
fn newest_closed_day(now: i64, settle: i64) -> i64 {
    let settled = now - settle;
    settled - settled % day_micros(1) - day_micros(1)
}

/// Daily when every day holds less than `max_file_size`, hourly when every day holds more.
fn classify(day_sizes: &[f64], max_file_size: f64) -> Option<PartitionTimeLevel> {
    if day_sizes.is_empty() {
        None
    } else if day_sizes.iter().all(|size| *size < max_file_size) {
        Some(PartitionTimeLevel::Daily)
    } else if day_sizes.iter().all(|size| *size > max_file_size) {
        Some(PartitionTimeLevel::Hourly)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 1_790_640_000_000_000; // 2026-09-29T00:00:00Z

    #[test]
    fn test_classify_needs_every_day_on_one_side() {
        use PartitionTimeLevel::{Daily, Hourly};
        let max = 100.0;
        for (sizes, expected) in [
            (vec![0.0, 1.0, 99.0], Some(Daily)),
            (vec![101.0, 500.0], Some(Hourly)),
            (vec![1.0, 101.0], None),
            (vec![101.0, 1.0], None),
            (vec![1.0, 100.0], None), // exactly the limit is neither
            (vec![100.0, 101.0], None),
            (vec![], None),
        ] {
            assert_eq!(classify(&sizes, max), expected, "{sizes:?}");
        }
    }

    #[test]
    fn test_newest_closed_day_waits_for_the_day_to_settle() {
        let settle = 1_800_000_000; // 30 minutes
        // shortly after midnight yesterday has not settled yet
        assert_eq!(
            newest_closed_day(DAY + settle - 1, settle),
            DAY - 2 * day_micros(1)
        );
        assert_eq!(newest_closed_day(DAY + settle, settle), DAY - day_micros(1));
        assert_eq!(
            newest_closed_day(DAY + day_micros(1) - 1, settle),
            DAY - day_micros(1)
        );
    }

    #[test]
    fn test_window_stays_within_retention() {
        let window = ClassifyWindow {
            newest_day: DAY,
            days: 7,
        };
        let days = |retention| window.within_retention(retention).map(|w| w.days);
        assert_eq!(days(0), Some(7), "no retention");
        assert_eq!(days(30), Some(7));
        assert_eq!(days(8), Some(7));
        assert_eq!(days(7), Some(6));
        assert_eq!(days(4), Some(3));
        assert_eq!(days(3), None, "too few days to judge");
        assert_eq!(days(1), None);
    }

    #[test]
    fn test_window_covers_leaves_a_young_stream_alone() {
        for days in [1, 7, 30] {
            let window = ClassifyWindow {
                newest_day: DAY,
                days,
            };
            let oldest_day = DAY - (days - 1) * day_micros(1);
            assert!(window.covers(oldest_day), "{days}");
            assert!(window.covers(oldest_day - 1), "{days}");
            assert!(!window.covers(oldest_day + 1), "{days}");
            assert!(!window.covers(0), "no created_at, no judgement");
        }
    }
}
