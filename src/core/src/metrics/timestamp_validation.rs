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

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Days};
use config::{get_config, meta::stream::StreamType, metrics, utils::json};

use super::ingest::RecordsByStream;

const TS_OUT_OF_BOUNDS: &str = "timestamp_out_of_bounds";

#[derive(Clone, Copy, Debug)]
pub(super) struct TimestampBounds {
    max_ts: i64,
    retention: Option<(i64, i64)>,
}

impl TimestampBounds {
    pub(super) fn new(now: i64, retention_days: i64) -> Self {
        let cfg = get_config();
        // the upload job drops a whole day at a time, so the bound is that day's start
        let retention = (retention_days > 0)
            .then(|| DateTime::from_timestamp_micros(now))
            .flatten()
            .and_then(|now| now.checked_sub_days(Days::new(retention_days as u64)))
            .and_then(|day| day.date_naive().and_hms_opt(0, 0, 0))
            .map(|day| (retention_days, day.and_utc().timestamp_micros()));
        Self {
            max_ts: now.saturating_add(cfg.limit.ingest_allowed_in_future_micro),
            retention,
        }
    }

    pub(super) fn check(&self, timestamp: i64) -> std::result::Result<(), TimestampRejection> {
        if timestamp > self.max_ts {
            return Err(TimestampRejection::Future);
        }
        match self.retention {
            Some((days, min_ts)) if timestamp < min_ts => Err(TimestampRejection::Retention(days)),
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TimestampRejection {
    Future,
    Retention(i64),
}

impl TimestampRejection {
    pub(super) fn message(&self) -> String {
        match self {
            Self::Future => schema::get_future_discard_error().to_string(),
            Self::Retention(days) => format!(
                "Too old data, older than the stream's data retention of {days} days and would be deleted. Data discarded."
            ),
        }
    }
}

/// Each destination stream's bounds, resolved once per request against the request's start.
pub(super) struct TimestampBoundsCache {
    org_id: String,
    now: i64,
    by_stream: HashMap<String, TimestampBounds>,
}

impl TimestampBoundsCache {
    pub(super) fn new(org_id: &str, now: i64) -> Self {
        Self {
            org_id: org_id.to_string(),
            now,
            by_stream: HashMap::new(),
        }
    }

    pub(super) async fn get(&mut self, stream_name: &str) -> TimestampBounds {
        if let Some(bounds) = self.by_stream.get(stream_name) {
            return *bounds;
        }
        let retention_days =
            infra::schema::get_settings(&self.org_id, stream_name, StreamType::Metrics)
                .await
                .map(|s| s.data_retention)
                .filter(|days| *days > 0)
                .unwrap_or_else(|| get_config().compact.data_retention_days);
        let bounds = TimestampBounds::new(self.now, retention_days);
        self.by_stream.insert(stream_name.to_string(), bounds);
        bounds
    }
}

/// Identifies a request's input points so one expanded into several records is refused once.
#[derive(Default)]
pub(super) struct PointRejectionTracker {
    next_id: usize,
    rejected: HashSet<usize>,
}

impl PointRejectionTracker {
    pub(super) fn next_point_id(&mut self) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// `true` the first time a point is refused for its timestamp, which is when it is counted.
    pub(super) fn record_rejection(&mut self, id: usize, org_id: &str, stream_name: &str) -> bool {
        if !self.mark_rejected(id) {
            return false;
        }
        metrics::INGEST_ERRORS
            .with_label_values(&[
                org_id,
                StreamType::Metrics.as_str(),
                stream_name,
                TS_OUT_OF_BOUNDS,
            ])
            .inc();
        true
    }

    pub(super) fn mark_rejected(&mut self, id: usize) -> bool {
        self.rejected.insert(id)
    }
}

/// Drops pipeline outputs outside their destination's bounds, timed by `point_timestamp`.
pub(super) async fn filter_pipeline_outputs<T>(
    outputs: &mut RecordsByStream<T>,
    bounds: &mut TimestampBoundsCache,
    point_timestamp: impl Fn(&json::Map<String, json::Value>, &T) -> Option<i64>,
    mut reject: impl FnMut(&T, &str, TimestampRejection),
) {
    for (stream_name, records) in outputs.iter_mut() {
        let stream_bounds = bounds.get(stream_name).await;
        records.retain(|(record, side)| {
            match point_timestamp(record, side).map(|ts| stream_bounds.check(ts)) {
                Some(Err(reason)) => {
                    reject(side, stream_name, reason);
                    false
                }
                _ => true,
            }
        });
    }
    outputs.retain(|_, records| !records.is_empty());
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::{TIMESTAMP_COL_NAME, meta::stream::StreamSettings};

    use super::*;

    const NOW: i64 = 1_700_000_000_000_000;
    const DAY: i64 = 86_400_000_000;

    #[tokio::test]
    async fn pipeline_filter_uses_side_timestamp_instead_of_json_timestamp() {
        let org = "side_timestamp_samples";
        let mut bounds = TimestampBoundsCache::new(org, NOW);
        bounds
            .by_stream
            .insert("destination".to_string(), TimestampBounds::new(NOW, 1));
        let future = NOW + get_config().limit.ingest_allowed_in_future_micro + 1;
        let record = |timestamp| {
            json::json!({"_timestamp": timestamp})
                .as_object()
                .unwrap()
                .clone()
        };
        let mut outputs = HashMap::from([(
            "destination".to_string(),
            vec![
                (record(future), NOW),
                (record(NOW), future),
                (record(NOW), future),
            ],
        )]);
        let mut rejections = Vec::new();
        filter_pipeline_outputs(
            &mut outputs,
            &mut bounds,
            |_record, &timestamp| Some(timestamp),
            |&timestamp, stream, reason| rejections.push((timestamp, stream.to_string(), reason)),
        )
        .await;
        assert_eq!(outputs["destination"].len(), 1);
        assert_eq!(
            outputs["destination"][0].0[TIMESTAMP_COL_NAME],
            json::json!(future)
        );
        let refused = (
            future,
            "destination".to_string(),
            TimestampRejection::Future,
        );
        assert_eq!(rejections, vec![refused.clone(), refused]);
    }

    #[tokio::test]
    async fn destination_bounds_use_global_fallback_and_request_cache() {
        let org = "otlp_policy_cache";
        for (stream, days) in [("fallback", 0), ("cached", 30)] {
            infra::schema::put_stream_settings(
                format!("{org}/metrics/{stream}"),
                Arc::new(StreamSettings {
                    data_retention: days,
                    ..Default::default()
                }),
            )
            .await;
        }
        let mut bounds = TimestampBoundsCache::new(org, NOW);
        let expected = TimestampBounds::new(NOW, config::get_config().compact.data_retention_days);
        let fallback = bounds.get("fallback").await;
        for timestamp in [0, NOW - 10 * DAY, NOW, i64::MAX] {
            assert_eq!(fallback.check(timestamp), expected.check(timestamp));
        }
        assert_eq!(bounds.get("cached").await.check(NOW - 10 * DAY), Ok(()));
        infra::schema::put_stream_settings(
            format!("{org}/metrics/cached"),
            Arc::new(StreamSettings {
                data_retention: 1,
                ..Default::default()
            }),
        )
        .await;
        assert_eq!(bounds.get("cached").await.check(NOW - 10 * DAY), Ok(()));
        let mut next_request = TimestampBoundsCache::new(org, NOW);
        assert_eq!(
            next_request.get("cached").await.check(NOW - 10 * DAY),
            Err(TimestampRejection::Retention(1))
        );
    }

    #[test]
    fn point_rejections_count_once_without_a_transport_context() {
        let mut points = PointRejectionTracker::default();
        let first = points.next_point_id();
        let second = points.next_point_id();
        assert_ne!(first, second);
        assert!(points.record_rejection(first, "admission_identity", "a"));
        assert!(!points.record_rejection(first, "admission_identity", "b"));
        assert!(!points.mark_rejected(first));
        assert!(points.mark_rejected(second));
        assert!(!points.record_rejection(second, "admission_identity", "b"));
    }

    #[test]
    fn test_timestamp_bounds_refuse_the_future_window_and_retention() {
        let hour = 3600 * 1_000_000;
        let day = 24 * hour;
        let in_future = get_config().limit.ingest_allowed_in_future_micro;
        let now = 1_700_000_000 * 1_000_000;
        let bounds = TimestampBounds::new(now, 7);

        assert_eq!(bounds.check(now), Ok(()));
        assert_eq!(bounds.check(now + in_future), Ok(()));
        assert_eq!(
            bounds.check(now + in_future + 1),
            Err(TimestampRejection::Future)
        );
        assert_eq!(bounds.check(i64::MAX), Err(TimestampRejection::Future));

        // the retention day itself is kept whole, exactly as the upload job keeps it
        let retention_day_start = (now - 7 * day) / day * day;
        assert_eq!(bounds.check(retention_day_start), Ok(()));
        assert_eq!(bounds.check(now - 7 * day), Ok(()));
        assert_eq!(
            bounds.check(retention_day_start - 1),
            Err(TimestampRejection::Retention(7))
        );
        assert_eq!(bounds.check(0), Err(TimestampRejection::Retention(7)));
    }

    #[test]
    fn test_timestamp_bounds_without_retention_only_refuse_the_future() {
        let now = 1_700_000_000 * 1_000_000;
        let bounds = TimestampBounds::new(now, 0);
        assert_eq!(bounds.check(0), Ok(()));
        assert_eq!(bounds.check(now - 365 * 24 * 3600 * 1_000_000), Ok(()));
        assert_eq!(bounds.check(i64::MAX), Err(TimestampRejection::Future));
    }
}
