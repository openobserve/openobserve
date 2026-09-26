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

//! Automatic partition time level for metrics streams.
//!
//! Low-volume metrics streams write one tiny parquet file per hour. This job
//! moves streams that stay quiet to daily partitions and moves them back when
//! they get busy, using the compressed bytes per hour recorded in
//! `stream_stats`:
//!
//! - to daily: below the low mark both over the recent window (yesterday and
//!   today so far) and over the stream's history;
//! - back to hourly: above the high mark over the recent window;
//! - otherwise nothing changes. The gap between the marks, the requirement that
//!   quiet be sustained, and a minimum dwell time between changes keep streams
//!   near a threshold from flapping.
//!
//! A change never applies to data already written: it takes effect from a
//! future UTC day on (see `infra::schema::schedule_partition_time_level`).
//! Streams whose level was set through the settings API are pinned and never
//! touched. The job runs on every compactor but does its work at most once per
//! ZO_METRICS_DAILY_PARTITION_AUTO_INTERVAL_HOURS across the cluster.

use std::collections::HashMap;

use config::{
    get_config,
    meta::stream::{PartitionTimeLevel, StreamSettings, StreamStats, StreamType},
    metrics,
    utils::time::{day_micros, hour_micros, now_micros},
};
use infra::{dist_lock, file_list as infra_file_list};

const LOCK_KEY: &str = "/compact/metrics_partition_classifier";
const LAST_RUN_KEY: &str = "/compact/metrics_partition_classifier/last_run";
/// The recent window must span at least this long to be trusted.
const MIN_RECENT_HOURS: f64 = 12.0;

/// What the classifier does with one stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Decision {
    ToDaily,
    ToHourly,
    Keep,
    /// The level was set through the settings API.
    Pinned,
    /// A change is scheduled and not in effect yet.
    Pending,
    /// The current level has not been in effect for the minimum dwell time.
    Dwell,
    /// Not enough history.
    TooYoung,
    /// No usable stats.
    NoStats,
    /// Would change, but the per-run limit was reached.
    Capped,
    /// The change could not be saved.
    Error,
}

impl Decision {
    pub fn as_str(self) -> &'static str {
        match self {
            Decision::ToDaily => "to_daily",
            Decision::ToHourly => "to_hourly",
            Decision::Keep => "keep",
            Decision::Pinned => "pinned",
            Decision::Pending => "pending",
            Decision::Dwell => "dwell",
            Decision::TooYoung => "too_young",
            Decision::NoStats => "no_stats",
            Decision::Capped => "capped",
            Decision::Error => "error",
        }
    }

    const ALL: [Decision; 10] = [
        Decision::ToDaily,
        Decision::ToHourly,
        Decision::Keep,
        Decision::Pinned,
        Decision::Pending,
        Decision::Dwell,
        Decision::TooYoung,
        Decision::NoStats,
        Decision::Capped,
        Decision::Error,
    ];
}

#[derive(Debug, Clone, Copy)]
pub struct Thresholds {
    /// Compressed bytes per hour below which a stream is quiet.
    pub low_bytes_per_hour: f64,
    /// Compressed bytes per hour above which a daily stream goes back to hourly.
    pub high_bytes_per_hour: f64,
    pub min_dwell_micros: i64,
    pub min_age_micros: i64,
}

impl Thresholds {
    fn from_config() -> Self {
        let cfg = get_config();
        Self {
            low_bytes_per_hour: cfg.limit.metrics_daily_partition_low_kb_per_hour as f64 * 1024.0,
            high_bytes_per_hour: cfg.limit.metrics_daily_partition_high_kb_per_hour as f64 * 1024.0,
            min_dwell_micros: day_micros(cfg.limit.metrics_daily_partition_min_dwell_days),
            min_age_micros: day_micros(cfg.limit.metrics_daily_partition_min_age_days),
        }
    }
}

/// A stream's volume from its two `stream_stats` rows.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct StreamVolume {
    /// Compressed bytes and hours of the recent window.
    pub recent_bytes: f64,
    pub recent_hours: f64,
    /// Compressed bytes and hours before the recent window (0 hours = none).
    pub historical_bytes: f64,
    pub historical_hours: f64,
    /// Earliest data timestamp, microseconds.
    pub first_ts: i64,
}

impl StreamVolume {
    /// `recent_start` is the start of the recent window (yesterday 00:00 as of
    /// the last stats run, `stats_at`).
    pub fn from_stats(
        recent: Option<&StreamStats>,
        historical: Option<&StreamStats>,
        recent_start: i64,
        stats_at: i64,
    ) -> Option<Self> {
        let hour = hour_micros(1) as f64;
        let first_ts = [recent, historical]
            .into_iter()
            .flatten()
            .map(|s| s.doc_time_min)
            .filter(|ts| *ts > 0)
            .min()?;
        let recent_hours = (stats_at - recent_start).max(0) as f64 / hour;
        let (historical_bytes, historical_hours) = match historical {
            Some(h) if h.doc_time_min > 0 && h.doc_time_min < recent_start => (
                h.compressed_size.max(0.0),
                (recent_start - h.doc_time_min) as f64 / hour,
            ),
            _ => (0.0, 0.0),
        };
        Some(Self {
            recent_bytes: recent.map(|r| r.compressed_size.max(0.0)).unwrap_or(0.0),
            recent_hours,
            historical_bytes,
            historical_hours,
            first_ts,
        })
    }
}

/// Decide one stream. Pure, so the policy is unit tested on its own.
pub fn decide(
    settings: &StreamSettings,
    volume: Option<&StreamVolume>,
    now: i64,
    th: &Thresholds,
) -> Decision {
    if settings.partition_time_level.is_some() && !settings.partition_time_level_auto {
        return Decision::Pinned;
    }
    if settings.partition_time_level_change_pending(now) {
        return Decision::Pending;
    }
    if let Some(since) = settings.partition_time_level_changed_since(now)
        && now - since < th.min_dwell_micros
    {
        return Decision::Dwell;
    }
    let Some(volume) = volume else {
        return Decision::NoStats;
    };
    if now - volume.first_ts < th.min_age_micros {
        return Decision::TooYoung;
    }
    if volume.recent_hours < MIN_RECENT_HOURS {
        return Decision::NoStats;
    }
    let recent_rate = volume.recent_bytes / volume.recent_hours;
    if settings.requested_partition_time_level_at(now) == PartitionTimeLevel::Daily {
        if recent_rate > th.high_bytes_per_hour {
            Decision::ToHourly
        } else {
            Decision::Keep
        }
    } else {
        let historical_rate = if volume.historical_hours >= 1.0 {
            volume.historical_bytes / volume.historical_hours
        } else {
            recent_rate
        };
        if recent_rate < th.low_bytes_per_hour && historical_rate < th.low_bytes_per_hour {
            Decision::ToDaily
        } else {
            Decision::Keep
        }
    }
}

pub async fn run() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    if !cfg.limit.metrics_daily_partition_enabled || !cfg.limit.metrics_daily_partition_auto {
        return Ok(());
    }
    let now = now_micros();
    let interval = hour_micros(cfg.limit.metrics_daily_partition_auto_interval_hours);
    if !claim_run(now, interval).await? {
        return Ok(());
    }
    let start = std::time::Instant::now();
    let ret = classify_all(now).await;
    metrics::METRICS_PARTITION_CLASSIFIER_DURATION
        .with_label_values::<&str>(&[])
        .observe(start.elapsed().as_secs_f64());
    match ret {
        Ok(()) => {
            metrics::METRICS_PARTITION_CLASSIFIER_LAST_RUN_TIMESTAMP
                .with_label_values::<&str>(&[])
                .set(now_micros());
            Ok(())
        }
        Err(e) => {
            metrics::METRICS_PARTITION_CLASSIFIER_ERRORS
                .with_label_values(&["run"])
                .inc();
            Err(e)
        }
    }
}

/// Whether this node should run now: at most once per `interval` across the cluster.
async fn claim_run(now: i64, interval: i64) -> Result<bool, anyhow::Error> {
    let locker = dist_lock::lock(LOCK_KEY, 0).await?;
    let last_run: i64 = match db::get(LAST_RUN_KEY).await {
        Ok(v) => String::from_utf8_lossy(&v).parse().unwrap_or(0),
        Err(_) => 0,
    };
    let claimed = if now - last_run < interval {
        false
    } else {
        db::put(
            LAST_RUN_KEY,
            now.to_string().into(),
            infra::db::NO_NEED_WATCH,
            None,
        )
        .await
        .is_ok()
    };
    dist_lock::unlock(&locker).await?;
    Ok(claimed)
}

async fn classify_all(now: i64) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let th = Thresholds::from_config();
    let max_changes = cfg.limit.metrics_daily_partition_max_changes_per_run;

    // stream_stats is as fresh as the last stats run; its recent row covers files
    // dated from the day before that run on
    let (stats_at, _) = db::compact::stats::get_offset().await;
    if stats_at <= 0 {
        log::info!("[PARTITION_CLASSIFIER] no stream stats yet, skipping");
        return Ok(());
    }
    let recent_start = stats_at - stats_at.rem_euclid(day_micros(1)) - day_micros(1);

    let mut decisions: HashMap<Decision, i64> = HashMap::new();
    let mut changes = 0usize;
    metrics::METRICS_PARTITION_STREAMS.reset();

    for (org_id, stream_types) in db::schema::list_all_streams_grouped().await {
        let Some(streams) = stream_types.get(&StreamType::Metrics) else {
            continue;
        };
        let volumes = match org_volumes(&org_id, recent_start, stats_at).await {
            Ok(v) => v,
            Err(e) => {
                log::error!("[PARTITION_CLASSIFIER] [{org_id}] read stream stats error: {e}");
                metrics::METRICS_PARTITION_CLASSIFIER_ERRORS
                    .with_label_values(&["stats"])
                    .inc();
                continue;
            }
        };
        let mut level_counts: HashMap<(String, &'static str), i64> = HashMap::new();
        for stream_name in streams {
            let Some(settings) =
                infra::schema::get_settings(&org_id, stream_name, StreamType::Metrics).await
            else {
                continue;
            };
            let in_effect = infra::schema::get_stream_partition_time_level(
                StreamType::Metrics,
                Some(&settings),
                now,
            );
            let state = if settings.partition_time_level_change_pending(now) {
                "pending"
            } else {
                "current"
            };
            *level_counts
                .entry((in_effect.to_string(), state))
                .or_default() += 1;

            let mut decision = decide(&settings, volumes.get(stream_name.as_str()), now, &th);
            let target = match decision {
                Decision::ToDaily => Some(PartitionTimeLevel::Daily),
                // back to the stream type default, still managed by the classifier
                Decision::ToHourly => Some(PartitionTimeLevel::Unset),
                _ => None,
            };
            if let Some(target) = target {
                if changes >= max_changes {
                    decision = Decision::Capped;
                } else {
                    let mut new_settings = (*settings).clone();
                    if infra::schema::schedule_partition_time_level(
                        &org_id,
                        StreamType::Metrics,
                        &mut new_settings,
                        target,
                        true,
                        now,
                    ) {
                        match schema::save_stream_settings(
                            &org_id,
                            stream_name,
                            StreamType::Metrics,
                            new_settings,
                        )
                        .await
                        {
                            Ok(_) => {
                                changes += 1;
                                log::info!(
                                    "[PARTITION_CLASSIFIER] [{org_id}/metrics/{stream_name}] {} from {}",
                                    decision.as_str(),
                                    infra::schema::next_partition_level_switch(now),
                                );
                            }
                            Err(e) => {
                                log::error!(
                                    "[PARTITION_CLASSIFIER] [{org_id}/metrics/{stream_name}] save settings error: {e}"
                                );
                                metrics::METRICS_PARTITION_CLASSIFIER_ERRORS
                                    .with_label_values(&["save"])
                                    .inc();
                                decision = Decision::Error;
                            }
                        }
                    }
                }
            }
            *decisions.entry(decision).or_default() += 1;
        }
        for ((level, state), count) in level_counts {
            metrics::METRICS_PARTITION_STREAMS
                .with_label_values(&[org_id.as_str(), level.as_str(), state])
                .set(count);
        }
    }

    for decision in Decision::ALL {
        metrics::METRICS_PARTITION_CLASSIFIER_DECISIONS
            .with_label_values(&[decision.as_str()])
            .set(decisions.get(&decision).copied().unwrap_or(0));
    }
    log::info!(
        "[PARTITION_CLASSIFIER] run done, {changes} changes scheduled, decisions: {:?}",
        decisions
            .iter()
            .map(|(d, n)| (d.as_str(), *n))
            .collect::<Vec<_>>()
    );
    Ok(())
}

/// Volume of every metrics stream of an organization, keyed by stream name.
async fn org_volumes(
    org_id: &str,
    recent_start: i64,
    stats_at: i64,
) -> Result<HashMap<String, StreamVolume>, anyhow::Error> {
    let prefix = format!("{org_id}/{}/", StreamType::Metrics);
    let mut rows: HashMap<String, (Option<StreamStats>, Option<StreamStats>)> = HashMap::new();
    for (stream_key, is_recent, stats) in
        infra_file_list::get_stream_stats_by_recency(org_id).await?
    {
        let Some(name) = stream_key.strip_prefix(&prefix) else {
            continue;
        };
        let entry = rows.entry(name.to_string()).or_default();
        if is_recent {
            entry.0 = Some(stats);
        } else {
            entry.1 = Some(stats);
        }
    }
    Ok(rows
        .into_iter()
        .filter_map(|(name, (recent, historical))| {
            StreamVolume::from_stats(recent.as_ref(), historical.as_ref(), recent_start, stats_at)
                .map(|v| (name, v))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400_000_000;
    // 2026-09-20 12:00:00 UTC
    const NOW: i64 = 1_789_905_600_000_000;
    const KB: f64 = 1024.0;

    fn th() -> Thresholds {
        Thresholds {
            low_bytes_per_hour: 1024.0 * KB,
            high_bytes_per_hour: 4096.0 * KB,
            min_dwell_micros: 7 * DAY,
            min_age_micros: 3 * DAY,
        }
    }

    fn volume(recent_kb_per_hour: f64, historical_kb_per_hour: f64) -> StreamVolume {
        StreamVolume {
            recent_bytes: recent_kb_per_hour * KB * 36.0,
            recent_hours: 36.0,
            historical_bytes: historical_kb_per_hour * KB * 240.0,
            historical_hours: 240.0,
            first_ts: NOW - 30 * DAY,
        }
    }

    fn daily_since(since: i64, auto: bool) -> StreamSettings {
        let mut s = StreamSettings::default();
        s.schedule_partition_time_level(PartitionTimeLevel::Daily, auto, since, since - DAY);
        s
    }

    #[test]
    fn test_quiet_stream_goes_daily_only_when_quiet_is_sustained() {
        let s = StreamSettings::default();
        assert_eq!(
            decide(&s, Some(&volume(100.0, 100.0)), NOW, &th()),
            Decision::ToDaily
        );
        // quiet lately but busy historically: wait
        assert_eq!(
            decide(&s, Some(&volume(100.0, 2000.0)), NOW, &th()),
            Decision::Keep
        );
        // in the hysteresis band: no change
        assert_eq!(
            decide(&s, Some(&volume(2000.0, 100.0)), NOW, &th()),
            Decision::Keep
        );
        // no history before the recent window: the recent rate decides
        let mut v = volume(100.0, 0.0);
        v.historical_hours = 0.0;
        assert_eq!(decide(&s, Some(&v), NOW, &th()), Decision::ToDaily);
    }

    #[test]
    fn test_daily_stream_goes_back_only_above_the_high_mark() {
        let s = daily_since(NOW - 10 * DAY, true);
        assert_eq!(
            decide(&s, Some(&volume(2000.0, 2000.0)), NOW, &th()),
            Decision::Keep
        );
        assert_eq!(
            decide(&s, Some(&volume(5000.0, 100.0)), NOW, &th()),
            Decision::ToHourly
        );
    }

    #[test]
    fn test_guards() {
        // pinned through the API, either level
        let pinned = daily_since(NOW - 10 * DAY, false);
        assert_eq!(
            decide(&pinned, Some(&volume(9000.0, 9000.0)), NOW, &th()),
            Decision::Pinned
        );
        let mut pinned_hourly = StreamSettings::default();
        pinned_hourly.schedule_partition_time_level(PartitionTimeLevel::Hourly, false, NOW, NOW);
        assert_eq!(
            decide(&pinned_hourly, Some(&volume(1.0, 1.0)), NOW, &th()),
            Decision::Pinned
        );
        // `unset` through the API hands the stream back to the classifier
        let mut unset = pinned_hourly.clone();
        unset.schedule_partition_time_level(PartitionTimeLevel::Unset, false, NOW, NOW);
        assert_ne!(
            decide(&unset, Some(&volume(1.0, 1.0)), NOW, &th()),
            Decision::Pinned
        );
        // pending change
        let pending = daily_since(NOW + DAY, true);
        assert_eq!(
            decide(&pending, Some(&volume(9000.0, 9000.0)), NOW, &th()),
            Decision::Pending
        );
        // changed 3 days ago: dwell
        let recent = daily_since(NOW - 3 * DAY, true);
        assert_eq!(
            decide(&recent, Some(&volume(9000.0, 9000.0)), NOW, &th()),
            Decision::Dwell
        );
        // young stream
        let mut young = volume(1.0, 1.0);
        young.first_ts = NOW - DAY;
        assert_eq!(
            decide(&StreamSettings::default(), Some(&young), NOW, &th()),
            Decision::TooYoung
        );
        // no stats, or a recent window too short to trust
        assert_eq!(
            decide(&StreamSettings::default(), None, NOW, &th()),
            Decision::NoStats
        );
        let mut short = volume(1.0, 1.0);
        short.recent_hours = 2.0;
        assert_eq!(
            decide(&StreamSettings::default(), Some(&short), NOW, &th()),
            Decision::NoStats
        );
    }

    #[test]
    fn test_volume_from_stats() {
        let recent_start = NOW - NOW % DAY - DAY; // yesterday 00:00
        let stats_at = NOW;
        let recent = StreamStats {
            doc_time_min: recent_start,
            compressed_size: 36.0 * 1000.0,
            ..Default::default()
        };
        let historical = StreamStats {
            doc_time_min: recent_start - 10 * DAY,
            compressed_size: 240.0 * 500.0,
            ..Default::default()
        };
        let v = StreamVolume::from_stats(Some(&recent), Some(&historical), recent_start, stats_at)
            .unwrap();
        assert_eq!(v.recent_hours, 36.0);
        assert_eq!(v.recent_bytes / v.recent_hours, 1000.0);
        assert_eq!(v.historical_hours, 240.0);
        assert_eq!(v.historical_bytes / v.historical_hours, 500.0);
        assert_eq!(v.first_ts, recent_start - 10 * DAY);

        // only recent data
        let v = StreamVolume::from_stats(Some(&recent), None, recent_start, stats_at).unwrap();
        assert_eq!(v.historical_hours, 0.0);
        assert_eq!(v.first_ts, recent_start);

        // nothing at all
        assert!(StreamVolume::from_stats(None, None, recent_start, stats_at).is_none());
        let empty = StreamStats::default();
        assert!(StreamVolume::from_stats(Some(&empty), None, recent_start, stats_at).is_none());
    }
}
