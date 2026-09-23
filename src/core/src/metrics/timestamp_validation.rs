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

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
};

use chrono::{DateTime, Days};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        promql::NAME_LABEL,
        stream::{StreamParams, StreamType},
    },
    metrics,
    utils::{json, schema::format_stream_name},
};

use super::ingest::RecordsByStream;
use crate::pipeline::batch_execution::ExecutablePipeline;

const TS_OUT_OF_BOUNDS: &str = "timestamp_out_of_bounds";

/// What a metric's admission needs from the request: pipelines decide where a record lands.
pub(super) struct TimestampValidator<'a> {
    pub(super) org_id: &'a str,
    pub(super) pipelines: &'a mut HashMap<String, Vec<ExecutablePipeline>>,
    pub(super) policies: &'a mut StreamTimestampPolicyCache,
    pub(super) rejected_data_points: &'a mut i64,
    pub(super) error_message: &'a mut String,
    pub(super) points: &'a mut PointRejectionTracker,
}

impl TimestampValidator<'_> {
    pub(super) fn record_rejection(
        &mut self,
        id: usize,
        stream_name: &str,
        reason: TimestampRejection,
    ) {
        if self
            .points
            .record_rejection(id, self.org_id, stream_name, reason)
        {
            *self.rejected_data_points += 1;
            *self.error_message = reason.message();
        }
    }

    pub(super) async fn input_timestamp_bounds(
        &mut self,
        stream_name: &str,
    ) -> Option<TimestampBounds> {
        if self.stream_has_pipeline(stream_name).await {
            None
        } else {
            Some(self.policies.get(stream_name).await.bounds)
        }
    }

    async fn stream_has_pipeline(&mut self, stream_name: &str) -> bool {
        if !self.pipelines.contains_key(stream_name) {
            let stream_param = StreamParams::new(self.org_id, stream_name, StreamType::Metrics);
            let found = crate::ingestion::get_stream_executable_pipelines(&stream_param).await;
            self.pipelines.insert(stream_name.to_string(), found);
        }
        self.pipelines
            .get(stream_name)
            .is_some_and(|v| !v.is_empty())
    }
}

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

    pub(super) fn record_rejection(
        &mut self,
        id: usize,
        org_id: &str,
        stream_name: &str,
        reason: TimestampRejection,
    ) -> bool {
        if !self.mark_rejected(id) {
            return false;
        }
        reason.count(org_id, stream_name);
        true
    }

    pub(super) fn mark_rejected(&mut self, id: usize) -> bool {
        self.rejected.insert(id)
    }
}

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

    fn count(&self, org_id: &str, stream_name: &str) {
        metrics::INGEST_ERRORS
            .with_label_values(&[
                org_id,
                StreamType::Metrics.as_str(),
                stream_name,
                TS_OUT_OF_BOUNDS,
            ])
            .inc();
    }
}

pub(super) struct StreamTimestampPolicyCache {
    org_id: String,
    now: i64,
    by_stream: HashMap<String, StreamTimestampPolicy>,
    deleting_by_stream: HashMap<String, bool>,
}

impl StreamTimestampPolicyCache {
    pub(super) fn new(org_id: &str, now: i64) -> Self {
        Self {
            org_id: org_id.to_string(),
            now,
            by_stream: HashMap::new(),
            deleting_by_stream: HashMap::new(),
        }
    }

    pub(super) fn is_deleting(&mut self, stream_name: &str) -> bool {
        // check if stream is deleting from cache
        *self
            .deleting_by_stream
            .entry(stream_name.to_string())
            .or_insert_with(|| {
                db::compact::retention::is_deleting_stream(
                    &self.org_id,
                    StreamType::Metrics,
                    stream_name,
                    None,
                )
            })
    }

    pub(super) async fn get(&mut self, stream_name: &str) -> StreamTimestampPolicy {
        if let Some(policy) = self.by_stream.get(stream_name) {
            return *policy;
        }
        let retention_days =
            infra::schema::get_settings(&self.org_id, stream_name, StreamType::Metrics)
                .await
                .map(|s| s.data_retention)
                .filter(|days| *days > 0)
                .unwrap_or_else(|| get_config().compact.data_retention_days);
        let policy = StreamTimestampPolicy {
            bounds: TimestampBounds::new(self.now, retention_days),
        };
        self.by_stream.insert(stream_name.to_string(), policy);
        policy
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct StreamTimestampPolicy {
    pub(super) bounds: TimestampBounds,
}

pub(super) async fn filter_valid_points<'point, 'stream, T>(
    points: &'point [T],
    validator: &mut TimestampValidator<'_>,
    mut parse_point: impl FnMut(&'point T) -> Option<(Cow<'stream, str>, i64)>,
) -> Vec<&'point T> {
    let mut valid = Vec::with_capacity(points.len());
    let mut common_bounds = None;
    for point in points {
        let Some((stream_name, timestamp)) = parse_point(point) else {
            continue;
        };
        let bounds = match &stream_name {
            Cow::Borrowed(name) => match common_bounds {
                Some((cached_name, bounds)) if cached_name == *name => bounds,
                _ => {
                    let bounds = validator.input_timestamp_bounds(name).await;
                    common_bounds = Some((*name, bounds));
                    bounds
                }
            },
            Cow::Owned(name) => validator.input_timestamp_bounds(name).await,
        };
        match bounds.map(|bounds| bounds.check(timestamp)) {
            Some(Err(reason)) => {
                let id = validator.points.next_point_id();
                validator.record_rejection(id, &stream_name, reason);
            }
            _ => valid.push(point),
        }
    }
    valid
}

pub(super) async fn filter_record_groups(
    groups: Vec<Vec<json::Value>>,
    validator: &mut TimestampValidator<'_>,
) -> Vec<(json::Value, usize)> {
    let mut admitted = Vec::new();
    for group in groups {
        let id = validator.points.next_point_id();
        for record in group {
            let stream_name = format_stream_name(
                record
                    .get(NAME_LABEL)
                    .and_then(json::Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            );
            if validator.stream_has_pipeline(&stream_name).await {
                admitted.push((record, id));
                continue;
            }
            let timestamp = record.get(TIMESTAMP_COL_NAME).and_then(json::Value::as_i64);
            let bounds = validator.policies.get(&stream_name).await.bounds;
            match timestamp.map(|ts| bounds.check(ts)) {
                Some(Err(reason)) => validator.record_rejection(id, &stream_name, reason),
                _ => admitted.push((record, id)),
            }
        }
    }
    admitted
}

pub(super) async fn filter_pipeline_outputs<T>(
    outputs: &mut RecordsByStream<T>,
    policies: &mut StreamTimestampPolicyCache,
    points: &mut PointRejectionTracker,
    point_timestamp: impl Fn(&json::Map<String, json::Value>, &T) -> (usize, Option<i64>),
    mut on_reject: impl FnMut(TimestampRejection),
) {
    for (stream_name, records) in outputs.iter_mut() {
        let bounds = policies.get(stream_name).await.bounds;
        records.retain(|(record, side)| {
            let (id, timestamp) = point_timestamp(record, side);
            match timestamp.map(|ts| bounds.check(ts)) {
                Some(Err(reason)) => {
                    if points.record_rejection(id, &policies.org_id, stream_name, reason) {
                        on_reject(reason);
                    }
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

    use config::meta::stream::StreamSettings;

    use super::*;

    const NOW: i64 = 1_700_000_000_000_000;
    const DAY: i64 = 86_400_000_000;

    #[tokio::test]
    async fn filter_plain_samples_uses_each_destination_and_skips_missing_values() {
        let org = "plain_timestamp_samples";
        let mut policies = StreamTimestampPolicyCache::new(org, NOW);
        for (stream, days) in [("recent", 1), ("archive", 30)] {
            policies.by_stream.insert(
                stream.to_string(),
                StreamTimestampPolicy {
                    bounds: TimestampBounds::new(NOW, days),
                },
            );
        }
        let mut pipelines = HashMap::from([
            ("recent".to_string(), vec![]),
            ("archive".to_string(), vec![]),
        ]);
        let mut points = PointRejectionTracker::default();
        let mut rejected = 0;
        let mut message = String::new();
        let future = NOW + get_config().limit.ingest_allowed_in_future_micro + 1;
        let samples = [
            ("recent", Some(NOW)),
            ("archive", Some(NOW - 10 * DAY)),
            ("recent", Some(NOW - 10 * DAY)),
            ("recent", Some(future)),
            ("missing", None),
        ];
        let mut validator = TimestampValidator {
            org_id: org,
            pipelines: &mut pipelines,
            policies: &mut policies,
            rejected_data_points: &mut rejected,
            error_message: &mut message,
            points: &mut points,
        };
        let valid = filter_valid_points(&samples, &mut validator, |sample| {
            Some((Cow::Borrowed(sample.0), sample.1?))
        })
        .await;
        assert_eq!(valid, vec![&samples[0], &samples[1]]);
        assert_eq!(rejected, 2);
        assert_eq!(message, TimestampRejection::Future.message());
        assert!(!pipelines.contains_key("missing"));
    }

    #[tokio::test]
    async fn pipeline_filter_uses_side_timestamp_instead_of_json_timestamp() {
        let org = "side_timestamp_samples";
        let mut policies = StreamTimestampPolicyCache::new(org, NOW);
        policies.by_stream.insert(
            "destination".to_string(),
            StreamTimestampPolicy {
                bounds: TimestampBounds::new(NOW, 1),
            },
        );
        let mut points = PointRejectionTracker::default();
        let valid_id = points.next_point_id();
        let rejected_id = points.next_point_id();
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
                (record(future), (valid_id, NOW)),
                (record(NOW), (rejected_id, future)),
                (record(NOW), (rejected_id, future)),
            ],
        )]);
        let mut rejections = Vec::new();
        filter_pipeline_outputs(
            &mut outputs,
            &mut policies,
            &mut points,
            |_record, &(id, timestamp)| (id, Some(timestamp)),
            |reason| rejections.push(reason),
        )
        .await;
        assert_eq!(outputs["destination"].len(), 1);
        assert_eq!(
            outputs["destination"][0].0[TIMESTAMP_COL_NAME],
            json::json!(future)
        );
        assert_eq!(outputs["destination"][0].1, (valid_id, NOW));
        assert_eq!(rejections, vec![TimestampRejection::Future]);
    }

    #[tokio::test]
    async fn empty_metrics_only_check_deletion_without_loading_retention() {
        let org = "empty_metrics_no_retention_lookup";
        let mut policies = StreamTimestampPolicyCache::new(org, NOW);
        let mut pipelines = HashMap::new();
        let mut points = PointRejectionTracker::default();
        let mut rejected = 0;
        let mut message = String::new();
        for stream in ["empty_gauge", "no_recorded_value", "nan", "empty_histogram"] {
            assert!(!policies.is_deleting(stream));
            let mut validator = TimestampValidator {
                org_id: org,
                pipelines: &mut pipelines,
                policies: &mut policies,
                rejected_data_points: &mut rejected,
                error_message: &mut message,
                points: &mut points,
            };
            let samples = [()];
            assert!(
                filter_valid_points(&samples, &mut validator, |_| None)
                    .await
                    .is_empty()
            );
            assert!(
                filter_record_groups(vec![vec![]], &mut validator)
                    .await
                    .is_empty()
            );
        }
        assert!(policies.by_stream.is_empty());
        assert_eq!(policies.deleting_by_stream.len(), 4);
        assert!(pipelines.is_empty());
        assert_eq!(rejected, 0);
    }

    #[tokio::test]
    async fn destination_policy_uses_global_fallback_and_request_cache() {
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
        let mut policies = StreamTimestampPolicyCache::new(org, NOW);
        let expected = TimestampBounds::new(NOW, config::get_config().compact.data_retention_days);
        let fallback = policies.get("fallback").await.bounds;
        for timestamp in [0, NOW - 10 * DAY, NOW, i64::MAX] {
            assert_eq!(fallback.check(timestamp), expected.check(timestamp));
        }
        assert_eq!(
            policies.get("cached").await.bounds.check(NOW - 10 * DAY),
            Ok(())
        );
        infra::schema::put_stream_settings(
            format!("{org}/metrics/cached"),
            Arc::new(StreamSettings {
                data_retention: 1,
                ..Default::default()
            }),
        )
        .await;
        assert_eq!(
            policies.get("cached").await.bounds.check(NOW - 10 * DAY),
            Ok(())
        );
        let mut next_request = StreamTimestampPolicyCache::new(org, NOW);
        assert_eq!(
            next_request
                .get("cached")
                .await
                .bounds
                .check(NOW - 10 * DAY),
            Err(TimestampRejection::Retention(1))
        );
    }

    #[test]
    fn point_rejections_count_once_without_a_transport_context() {
        let mut points = PointRejectionTracker::default();
        let first = points.next_point_id();
        let second = points.next_point_id();
        assert_ne!(first, second);
        assert!(points.record_rejection(
            first,
            "admission_identity",
            "a",
            TimestampRejection::Future
        ));
        assert!(!points.record_rejection(
            first,
            "admission_identity",
            "b",
            TimestampRejection::Retention(1)
        ));
        assert!(points.record_rejection(
            second,
            "admission_identity",
            "b",
            TimestampRejection::Future
        ));
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
