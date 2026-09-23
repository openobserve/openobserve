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
pub(super) struct Admission<'a> {
    pub(super) org_id: &'a str,
    pub(super) metric_name: &'a str,
    pub(super) pipelines: &'a mut HashMap<String, Vec<ExecutablePipeline>>,
    pub(super) policies: &'a mut StreamPolicies,
    pub(super) rejected_data_points: &'a mut i64,
    pub(super) error_message: &'a mut String,
    pub(super) points: &'a mut PointAdmission,
}

impl Admission<'_> {
    pub(super) fn reject(&mut self, id: usize, stream_name: &str, reason: OutOfBounds) {
        if self.points.reject(id, self.org_id, stream_name, reason) {
            *self.rejected_data_points += 1;
            *self.error_message = reason.message();
        }
    }

    pub(super) async fn direct_bounds(&mut self, stream_name: &str) -> Option<TimestampBounds> {
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
pub(super) struct PointAdmission {
    next_id: usize,
    rejected: HashSet<usize>,
}

impl PointAdmission {
    pub(super) fn allocate(&mut self) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub(super) fn reject(
        &mut self,
        id: usize,
        org_id: &str,
        stream_name: &str,
        reason: OutOfBounds,
    ) -> bool {
        if !self.rejected.insert(id) {
            return false;
        }
        reason.count(org_id, stream_name);
        true
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

    pub(super) fn check(&self, timestamp: i64) -> std::result::Result<(), OutOfBounds> {
        if timestamp > self.max_ts {
            return Err(OutOfBounds::Future);
        }
        match self.retention {
            Some((days, min_ts)) if timestamp < min_ts => Err(OutOfBounds::Retention(days)),
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum OutOfBounds {
    Future,
    Retention(i64),
}

impl OutOfBounds {
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

pub(super) struct StreamPolicies {
    org_id: String,
    now: i64,
    by_stream: HashMap<String, StreamPolicy>,
}

impl StreamPolicies {
    pub(super) fn new(org_id: &str, now: i64) -> Self {
        Self {
            org_id: org_id.to_string(),
            now,
            by_stream: HashMap::new(),
        }
    }

    pub(super) async fn get(&mut self, stream_name: &str) -> StreamPolicy {
        if let Some(policy) = self.by_stream.get(stream_name) {
            return *policy;
        }
        // check if stream is deleting from cache
        let deleting = db::compact::retention::is_deleting_stream(
            &self.org_id,
            StreamType::Metrics,
            stream_name,
            None,
        );
        let retention_days =
            infra::schema::get_settings(&self.org_id, stream_name, StreamType::Metrics)
                .await
                .map(|s| s.data_retention)
                .filter(|days| *days > 0)
                .unwrap_or_else(|| get_config().compact.data_retention_days);
        let policy = StreamPolicy {
            deleting,
            bounds: TimestampBounds::new(self.now, retention_days),
        };
        self.by_stream.insert(stream_name.to_string(), policy);
        policy
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct StreamPolicy {
    pub(super) deleting: bool,
    pub(super) bounds: TimestampBounds,
}

pub(super) async fn admit_record_groups(
    groups: Vec<Vec<json::Value>>,
    admission: &mut Admission<'_>,
) -> Vec<(json::Value, usize)> {
    let mut admitted = Vec::new();
    for group in groups {
        let id = admission.points.allocate();
        for record in group {
            let stream_name = format_stream_name(
                record
                    .get(NAME_LABEL)
                    .and_then(json::Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            );
            if admission.stream_has_pipeline(&stream_name).await {
                admitted.push((record, id));
                continue;
            }
            let timestamp = record.get(TIMESTAMP_COL_NAME).and_then(json::Value::as_i64);
            let bounds = admission.policies.get(&stream_name).await.bounds;
            match timestamp.map(|ts| bounds.check(ts)) {
                Some(Err(reason)) => admission.reject(id, &stream_name, reason),
                _ => admitted.push((record, id)),
            }
        }
    }
    admitted
}

pub(super) async fn admit_pipeline_outputs(
    outputs: &mut RecordsByStream<usize>,
    policies: &mut StreamPolicies,
    points: &mut PointAdmission,
    mut on_reject: impl FnMut(OutOfBounds),
) {
    for (stream_name, records) in outputs.iter_mut() {
        let bounds = policies.get(stream_name).await.bounds;
        records.retain(|(record, id)| {
            let timestamp = record.get(TIMESTAMP_COL_NAME).and_then(json::Value::as_i64);
            match timestamp.map(|ts| bounds.check(ts)) {
                Some(Err(reason)) => {
                    if points.reject(*id, &policies.org_id, stream_name, reason) {
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
        let mut policies = StreamPolicies::new(org, NOW);
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
        let mut next_request = StreamPolicies::new(org, NOW);
        assert_eq!(
            next_request
                .get("cached")
                .await
                .bounds
                .check(NOW - 10 * DAY),
            Err(OutOfBounds::Retention(1))
        );
    }

    #[test]
    fn point_rejections_count_once_without_a_transport_context() {
        let mut points = PointAdmission::default();
        let first = points.allocate();
        let second = points.allocate();
        assert_ne!(first, second);
        assert!(points.reject(first, "admission_identity", "a", OutOfBounds::Future));
        assert!(!points.reject(first, "admission_identity", "b", OutOfBounds::Retention(1)));
        assert!(points.reject(second, "admission_identity", "b", OutOfBounds::Future));
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
        assert_eq!(bounds.check(now + in_future + 1), Err(OutOfBounds::Future));
        assert_eq!(bounds.check(i64::MAX), Err(OutOfBounds::Future));

        // the retention day itself is kept whole, exactly as the upload job keeps it
        let retention_day_start = (now - 7 * day) / day * day;
        assert_eq!(bounds.check(retention_day_start), Ok(()));
        assert_eq!(bounds.check(now - 7 * day), Ok(()));
        assert_eq!(
            bounds.check(retention_day_start - 1),
            Err(OutOfBounds::Retention(7))
        );
        assert_eq!(bounds.check(0), Err(OutOfBounds::Retention(7)));
    }

    #[test]
    fn test_timestamp_bounds_without_retention_only_refuse_the_future() {
        let now = 1_700_000_000 * 1_000_000;
        let bounds = TimestampBounds::new(now, 0);
        assert_eq!(bounds.check(0), Ok(()));
        assert_eq!(bounds.check(now - 365 * 24 * 3600 * 1_000_000), Ok(()));
        assert_eq!(bounds.check(i64::MAX), Err(OutOfBounds::Future));
    }
}
