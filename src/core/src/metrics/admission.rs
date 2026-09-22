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

use std::collections::HashMap;

use chrono::{DateTime, Days};
use config::{TIMESTAMP_COL_NAME, get_config, meta::stream::StreamType, metrics, utils::json};

use super::ingest::RecordsByStream;

/// The `error_type` label a point rejected for its timestamp is counted under.
pub(super) const TS_OUT_OF_BOUNDS: &str = "timestamp_out_of_bounds";

/// The timestamps one metrics stream accepts, resolved once per request.
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

/// Why a point's timestamp was refused.
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

    /// Counts one rejected point for the stream; the caller reports it to the client.
    pub(super) fn count(&self, org_id: &str, stream_name: &str) {
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

#[derive(Clone, Copy, Debug)]
pub(super) struct StreamPolicy {
    pub deleting: bool,
    pub bounds: TimestampBounds,
}

/// Per-request cache of each stream's policy, all measured from the same `now`.
pub(super) struct StreamPolicies {
    pub(super) org_id: String,
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

    /// One map lookup per call on the hot path; the stream's settings are read only once.
    pub(super) async fn get(&mut self, stream_name: &str) -> StreamPolicy {
        if let Some(policy) = self.by_stream.get(stream_name) {
            return *policy;
        }
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

/// Drops pipeline output its destination refuses; a record without `_timestamp` is written as now.
pub(super) async fn admit_pipeline_outputs<T>(
    outputs: &mut RecordsByStream<T>,
    policies: &mut StreamPolicies,
    mut on_reject: impl FnMut(&str, OutOfBounds),
) {
    for (stream_name, records) in outputs.iter_mut() {
        let bounds = policies.get(stream_name).await.bounds;
        records.retain(|(record, _)| {
            let Some(timestamp) = record.get(TIMESTAMP_COL_NAME).and_then(json::Value::as_i64)
            else {
                return true;
            };
            match bounds.check(timestamp) {
                Ok(()) => true,
                Err(reason) => {
                    on_reject(stream_name, reason);
                    false
                }
            }
        });
    }
    outputs.retain(|_, records| !records.is_empty());
}

#[cfg(test)]
mod tests {
    use super::*;

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
