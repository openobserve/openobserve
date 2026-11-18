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

//! State, summary and window of a detector, read from the scored buckets of its current model.

use std::collections::HashSet;

use config::meta::stream::StreamType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::AnomalyLinkSnapshot;

pub const ANOMALY_STREAM: &str = "_anomalies";
/// The strip looks back this far for the start of the newest anomalous run.
const LOOKBACK_US: i64 = 7 * 86_400 * 1_000_000;
/// Caps the rows of one read: 7 days of 1-minute buckets.
const MAX_BUCKETS: i64 = 10_080;
/// "No new data" shows once the cursor lags this many buckets.
const STALE_CURSOR_BUCKETS: i64 = 3;
const HOUR_US: i64 = 3_600 * 1_000_000;

/// The latest judgment of one bucket of the current model.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExploreBucket {
    pub ts_us: i64,
    pub value: Option<f64>,
    pub expected: Option<f64>,
    pub lower: Option<f64>,
    pub upper: Option<f64>,
    pub is_anomaly: bool,
    pub is_absence: bool,
    pub is_partial_drop: bool,
}

impl ExploreBucket {
    fn is_anomalous(&self) -> bool {
        self.is_anomaly || self.is_absence || self.is_partial_drop
    }

    fn kind(&self) -> &'static str {
        if self.is_absence {
            "absence"
        } else if self.is_partial_drop {
            "partial_drop"
        } else {
            "value"
        }
    }

    /// How far the value lies outside its band, or from its expectation without one.
    fn excess(&self) -> f64 {
        let Some(value) = self.value else {
            return f64::NEG_INFINITY;
        };
        match (self.lower, self.upper) {
            (_, Some(upper)) if value > upper => value - upper,
            (Some(lower), _) if value < lower => lower - value,
            _ => self.expected.map(|e| (value - e).abs()).unwrap_or(0.0),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExploreState {
    Ongoing,
    BackInRange,
    #[default]
    None,
    NoRuns,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ExploreSummary {
    /// "value", "absence" or "partial_drop".
    pub kind: String,
    pub actual: Option<f64>,
    pub expected: Option<f64>,
    pub expected_lower: Option<f64>,
    pub expected_upper: Option<f64>,
    pub change_percent: Option<f64>,
    pub started_us: Option<i64>,
    pub since_us: Option<i64>,
}

/// The unpadded anomaly window; `clipped` when it reaches the start of the read range.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ExploreWindow {
    pub start_us: i64,
    pub end_us: i64,
    pub clipped: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExploreDecision {
    pub state: ExploreState,
    pub summary: Option<ExploreSummary>,
    pub window: Option<ExploreWindow>,
}

/// The body of `GET /api/{org_id}/anomaly_detection/{anomaly_id}/explore` in Phase 1.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ExploreResponse {
    pub url: String,
    pub label: String,
    /// "logs", "traces" or "metrics".
    pub target: String,
    pub filter_applied: bool,
    pub name: String,
    pub measure: String,
    pub stream: String,
    pub filter: Option<String>,
    pub state: ExploreState,
    /// Always "buckets" in Phase 1.
    pub state_source: String,
    pub summary: Option<ExploreSummary>,
    /// `current_model_version` when trained, else 0.
    pub model_version: i64,
    pub last_detection_run: Option<i64>,
    pub cursor_us: Option<i64>,
    pub no_new_data_since_us: Option<i64>,
    pub window: Option<ExploreWindow>,
    pub explore_start_us: i64,
}

/// Run time, cursor and the start of "No new data", as the strip reads them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Freshness {
    pub last_detection_run: Option<i64>,
    pub cursor_us: Option<i64>,
    pub no_new_data_since_us: Option<i64>,
}

/// Decides the strip state from `buckets`, oldest first; a detector that never ran is `NoRuns`.
pub fn decide(
    buckets: &[ExploreBucket],
    bucket_us: i64,
    range_start_us: i64,
    has_run: bool,
    is_trained: bool,
) -> ExploreDecision {
    if !has_run {
        return ExploreDecision {
            state: ExploreState::NoRuns,
            ..Default::default()
        };
    }
    if !is_trained {
        return ExploreDecision::default();
    }
    let Some(last) = buckets.iter().rposition(ExploreBucket::is_anomalous) else {
        return ExploreDecision::default();
    };
    // Missing buckets do not end a run: a continuing absence stores no points after its onset.
    let first = buckets[..last]
        .iter()
        .rposition(|b| !b.is_anomalous())
        .map_or(0, |i| i + 1);
    let run = &buckets[first..=last];
    let start_us = run[0].ts_us;
    let window = ExploreWindow {
        start_us,
        end_us: buckets[last].ts_us.saturating_add(bucket_us.max(0)),
        clipped: first == 0 || start_us <= range_start_us,
    };
    let ongoing = last + 1 == buckets.len();
    // An ongoing absence reports when the data stopped: its first bucket, not the run start.
    let since_us = if ongoing {
        run.iter()
            .rposition(|b| !b.is_absence)
            .map_or(Some(start_us), |i| run.get(i + 1).map(|b| b.ts_us))
    } else {
        buckets[last + 1..]
            .iter()
            .find(|b| b.value.is_some())
            .map(|b| b.ts_us)
    };
    let mut summary = run_summary(run);
    summary.started_us = Some(start_us);
    summary.since_us = since_us;
    ExploreDecision {
        state: if ongoing {
            ExploreState::Ongoing
        } else {
            ExploreState::BackInRange
        },
        summary: Some(summary),
        window: Some(window),
    }
}

/// A continuing absence stores only its first bucket, so an ongoing one runs to the last run.
pub fn extend_ongoing_absence(decision: &mut ExploreDecision, last_detection_run: Option<i64>) {
    let absence = decision
        .summary
        .as_ref()
        .is_some_and(|s| s.kind == "absence");
    if decision.state != ExploreState::Ongoing || !absence {
        return;
    }
    if let (Some(window), Some(run)) = (decision.window.as_mut(), last_detection_run) {
        window.end_us = window.end_us.max(run);
    }
}

/// The model version the page and the endpoint compare; an untrained detector has none.
pub fn served_model_version(is_trained: bool, current_model_version: i64) -> i64 {
    if is_trained { current_model_version } else { 0 }
}

/// True when the caller's data was loaded with another model than the served one.
pub fn is_stale_model(sent: Option<i64>, served: i64) -> bool {
    sent.is_some_and(|v| v != served)
}

/// The read range `(start, end)` in microseconds: 7 days, or fewer for very small buckets.
pub fn read_range(now_us: i64, bucket_us: i64) -> (i64, i64) {
    let span = LOOKBACK_US.min(bucket_us.max(1).saturating_mul(MAX_BUCKETS));
    (now_us.saturating_sub(span), now_us.saturating_add(1))
}

/// The unpadded window the link opens: the request's, else the anomaly window, else the
/// bucket that ends at the cursor, else the last hour.
pub fn link_window(
    requested: Option<(i64, i64)>,
    window: Option<&ExploreWindow>,
    cursor_us: Option<i64>,
    bucket_us: i64,
    now_us: i64,
) -> (i64, i64) {
    if let Some(range) = requested {
        return range;
    }
    if let Some(w) = window {
        return (w.start_us, w.end_us);
    }
    match cursor_us {
        Some(cursor) if bucket_us > 0 => (cursor.saturating_sub(bucket_us), cursor),
        _ => (now_us.saturating_sub(HOUR_US), now_us),
    }
}

/// The bucket that holds `ts_us`, if the read has it.
pub fn bucket_at(buckets: &[ExploreBucket], ts_us: i64, bucket_us: i64) -> Option<&ExploreBucket> {
    buckets
        .iter()
        .rev()
        .find(|b| b.ts_us <= ts_us && ts_us < b.ts_us.saturating_add(bucket_us.max(1)))
}

/// The banner values of a link built from the strip's summary; an ongoing absence starts at
/// its own first bucket, while the page range still covers the whole episode.
pub fn summary_snapshot(
    window: &ExploreWindow,
    summary: &ExploreSummary,
    measure: &str,
    ongoing: bool,
) -> AnomalyLinkSnapshot {
    let absence_start = summary
        .since_us
        .filter(|_| ongoing && summary.kind == "absence");
    AnomalyLinkSnapshot {
        start_us: absence_start.unwrap_or(window.start_us),
        end_us: window.end_us,
        kind: summary.kind.clone(),
        measure: measure.to_string(),
        actual: summary.actual,
        lower: summary.expected_lower,
        upper: summary.expected_upper,
        expected: summary.expected.filter(|_| summary.kind == "partial_drop"),
    }
}

/// The banner values of a link for one requested bucket; an unknown bucket carries no numbers.
pub fn bucket_snapshot(
    bucket: Option<&ExploreBucket>,
    start_us: i64,
    end_us: i64,
    measure: &str,
) -> AnomalyLinkSnapshot {
    let summary = bucket
        .map(bucket_summary)
        .unwrap_or_else(|| ExploreSummary {
            kind: "value".to_string(),
            ..Default::default()
        });
    let expected = summary.expected.filter(|_| summary.kind == "partial_drop");
    AnomalyLinkSnapshot {
        start_us,
        end_us,
        kind: summary.kind,
        measure: measure.to_string(),
        actual: summary.actual,
        lower: summary.expected_lower,
        upper: summary.expected_upper,
        expected,
    }
}

/// True on a super cluster member that does not run the scheduler; an unknown job cluster
/// counts as one, so the strip shows no stale run state it cannot check.
pub fn is_peer_cluster(
    super_cluster: bool,
    job_cluster: Option<&str>,
    local_cluster: &str,
) -> bool {
    if !super_cluster {
        return false;
    }
    match job_cluster {
        None => true,
        Some(job) => !job.is_empty() && job != local_cluster,
    }
}

/// Peers neither run the detector nor get its cursor, so they report no run state.
pub fn freshness(
    is_peer: bool,
    last_detection_run: Option<i64>,
    cursor_us: Option<i64>,
    bucket_us: i64,
    now_us: i64,
) -> Freshness {
    if is_peer {
        return Freshness::default();
    }
    let stale_after = bucket_us.max(0).saturating_mul(STALE_CURSOR_BUCKETS);
    Freshness {
        last_detection_run,
        cursor_us,
        no_new_data_since_us: cursor_us.filter(|c| now_us.saturating_sub(*c) > stale_after),
    }
}

/// "logs", "traces" or "metrics" for a stream type.
pub fn link_target(stream_type: &str) -> &'static str {
    match stream_type {
        "traces" => "traces",
        "metrics" => "metrics",
        _ => "logs",
    }
}

/// One row per bucket of the model `model_version`: the latest scored judgment
/// (`judged_end_us`, then `created_at`) and whether any event row marks it.
pub fn buckets_sql(anomaly_id: &str, model_version: i64, fields: &HashSet<String>) -> String {
    let has = |name: &str| fields.contains(name);
    let flag = |name: &str| {
        if has(name) {
            format!("{name} IS TRUE")
        } else {
            "false".to_string()
        }
    };
    let (absence, partial) = (flag("is_absence"), flag("is_partial_drop"));
    let scored_rank = format!("CASE WHEN ({absence}) OR ({partial}) THEN 0 ELSE 1 END");
    // Points written before `judged_end_us` existed sort first, as the oldest judgment.
    let judged = if has("judged_end_us") {
        ", judged_end_us ASC NULLS FIRST"
    } else {
        ""
    };
    let order = format!("ORDER BY {scored_rank}{judged}, created_at ASC");
    let latest = |column: &str, alias: &str| {
        if has(column) {
            format!("last_value({column} {order}) AS {alias}")
        } else {
            format!("CAST(NULL AS DOUBLE) AS {alias}")
        }
    };
    // The drop event row holds the drop's reading and baseline, not the scored row.
    let drop_order =
        format!("ORDER BY CASE WHEN {partial} THEN 1 ELSE 0 END{judged}, created_at ASC");
    let drop_latest = |column: &str, alias: &str| {
        if has(column) && has("is_partial_drop") {
            format!("last_value({column} {drop_order}) AS {alias}")
        } else {
            format!("CAST(NULL AS DOUBLE) AS {alias}")
        }
    };
    let id = anomaly_id.replace('\'', "''");
    format!(
        "SELECT _timestamp AS ts, max({scored_rank}) AS has_scored, {}, {}, {}, {}, {}, {}, \
         last_value(is_anomaly {order}) AS is_anomaly, \
         max(CASE WHEN {absence} THEN 1 ELSE 0 END) AS absence, \
         max(CASE WHEN {partial} THEN 1 ELSE 0 END) AS partial_drop \
         FROM \"{ANOMALY_STREAM}\" WHERE anomaly_id = '{id}' AND model_version = {model_version} \
         GROUP BY _timestamp ORDER BY ts DESC",
        latest("actual_value", "actual"),
        latest("expected_value", "expected"),
        latest("expected_lower", "lower"),
        latest("expected_upper", "upper"),
        drop_latest("actual_value", "drop_actual"),
        drop_latest("expected_value", "drop_expected"),
    )
}

/// Buckets from the rows of `buckets_sql`, oldest first.
pub fn parse_buckets(hits: &[serde_json::Value]) -> Vec<ExploreBucket> {
    let num = |hit: &serde_json::Value, key: &str| hit.get(key).and_then(|v| v.as_f64());
    let flag = |hit: &serde_json::Value, key: &str| match hit.get(key) {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(v) => v.as_f64().is_some_and(|n| n != 0.0),
        None => false,
    };
    let mut buckets: Vec<ExploreBucket> = hits
        .iter()
        .filter_map(|hit| {
            let ts_us = hit.get("ts").and_then(|v| v.as_i64())?;
            let scored = flag(hit, "has_scored");
            let is_absence = flag(hit, "absence");
            let is_partial_drop = flag(hit, "partial_drop");
            // An absence event row carries a placeholder 0, not a reading.
            let mut value = num(hit, "actual").filter(|_| scored || !is_absence);
            let mut expected = num(hit, "expected");
            if is_partial_drop && !is_absence && num(hit, "drop_expected").is_some() {
                (value, expected) = (num(hit, "drop_actual"), num(hit, "drop_expected"));
            }
            Some(ExploreBucket {
                ts_us,
                value,
                expected,
                lower: num(hit, "lower"),
                upper: num(hit, "upper"),
                is_anomaly: scored && flag(hit, "is_anomaly"),
                is_absence,
                is_partial_drop,
            })
        })
        .collect();
    buckets.sort_by_key(|b| b.ts_us);
    buckets
}

/// The buckets of the model `model_version` in the range of `read_range`, through the normal
/// search path so a peer cluster gets the points of the job cluster.
pub async fn read_buckets(
    org_id: &str,
    anomaly_id: &str,
    model_version: i64,
    range: (i64, i64),
) -> anyhow::Result<Vec<ExploreBucket>> {
    let schema = infra::schema::get_cache(org_id, ANOMALY_STREAM, StreamType::Logs).await?;
    let fields: HashSet<String> = schema.fields_map().keys().cloned().collect();
    if ![
        "_timestamp",
        "anomaly_id",
        "model_version",
        "is_anomaly",
        "actual_value",
        "created_at",
    ]
    .iter()
    .all(|f| fields.contains(*f))
    {
        return Ok(vec![]);
    }
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: buckets_sql(anomaly_id, model_version, &fields),
            from: 0,
            size: MAX_BUCKETS,
            start_time: range.0,
            end_time: range.1,
            ..Default::default()
        },
        search_type: Some(config::meta::search::SearchEventType::Other),
        use_cache: false,
        local_mode: None,
        ..Default::default()
    };
    let trace_id = config::ider::generate_trace_id();
    let resp = search_service::search(&trace_id, org_id, StreamType::Logs, None, &req)
        .await
        .map_err(|e| anyhow::anyhow!("reading {ANOMALY_STREAM} failed: {e}"))?;
    Ok(parse_buckets(&resp.hits))
}

/// The readings of a run, by the kind of its newest bucket; an absence has no numbers.
fn run_summary(run: &[ExploreBucket]) -> ExploreSummary {
    let Some(newest) = run.last() else {
        return ExploreSummary::default();
    };
    let kind = newest.kind();
    match kind {
        "absence" => ExploreSummary {
            kind: kind.to_string(),
            ..Default::default()
        },
        "partial_drop" => ExploreSummary {
            kind: kind.to_string(),
            actual: newest.value,
            expected: newest.expected,
            change_percent: change_percent(newest.value, newest.expected),
            ..Default::default()
        },
        _ => {
            let worst = run
                .iter()
                .filter(|b| b.kind() == "value" && b.value.is_some())
                .fold(None::<&ExploreBucket>, |worst, b| match worst {
                    Some(w) if w.excess() > b.excess() => Some(w),
                    _ => Some(b),
                })
                .unwrap_or(newest);
            bucket_summary(worst)
        }
    }
}

/// The readings of one bucket, with only the numbers its kind may show.
fn bucket_summary(bucket: &ExploreBucket) -> ExploreSummary {
    let kind = bucket.kind();
    let (actual, expected) = match kind {
        "absence" => (None, None),
        _ => (bucket.value, bucket.expected),
    };
    let (lower, upper) = match kind {
        "value" => (bucket.lower, bucket.upper),
        _ => (None, None),
    };
    ExploreSummary {
        kind: kind.to_string(),
        actual,
        expected,
        expected_lower: lower,
        expected_upper: upper,
        change_percent: change_percent(actual, expected),
        ..Default::default()
    }
}

fn change_percent(actual: Option<f64>, expected: Option<f64>) -> Option<f64> {
    match (actual, expected) {
        (Some(a), Some(e)) if e != 0.0 && a.is_finite() && e.is_finite() => {
            Some((a - e) / e.abs() * 100.0)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const B: i64 = 900_000_000;

    fn normal(i: i64) -> ExploreBucket {
        ExploreBucket {
            ts_us: i * B,
            value: Some(100.0),
            expected: Some(100.0),
            lower: Some(80.0),
            upper: Some(120.0),
            ..Default::default()
        }
    }

    fn high(i: i64, value: f64) -> ExploreBucket {
        ExploreBucket {
            value: Some(value),
            is_anomaly: true,
            ..normal(i)
        }
    }

    fn absent(i: i64) -> ExploreBucket {
        ExploreBucket {
            ts_us: i * B,
            is_absence: true,
            ..Default::default()
        }
    }

    fn dropped(i: i64) -> ExploreBucket {
        ExploreBucket {
            ts_us: i * B,
            value: Some(40.0),
            expected: Some(100.0),
            lower: Some(80.0),
            upper: Some(120.0),
            is_partial_drop: true,
            ..Default::default()
        }
    }

    #[test]
    fn test_newest_anomalous_bucket_is_ongoing_with_worst_reading() {
        let buckets = [
            normal(1),
            normal(2),
            high(3, 150.0),
            high(4, 200.0),
            high(5, 130.0),
        ];
        let d = decide(&buckets, B, 0, true, true);
        assert_eq!(d.state, ExploreState::Ongoing);
        assert_eq!(
            d.window,
            Some(ExploreWindow {
                start_us: 3 * B,
                end_us: 6 * B,
                clipped: false
            })
        );
        let s = d.summary.unwrap();
        assert_eq!(s.kind, "value");
        assert_eq!(s.actual, Some(200.0));
        assert_eq!(s.expected, Some(100.0));
        assert_eq!(
            (s.expected_lower, s.expected_upper),
            (Some(80.0), Some(120.0))
        );
        assert_eq!(s.change_percent, Some(100.0));
        assert_eq!(s.started_us, Some(3 * B));
        assert_eq!(s.since_us, None);
    }

    #[test]
    fn test_newest_normal_bucket_is_back_in_range_since_the_first_normal_bucket() {
        let buckets = [
            normal(1),
            high(2, 150.0),
            high(3, 160.0),
            normal(4),
            normal(5),
        ];
        let d = decide(&buckets, B, 0, true, true);
        assert_eq!(d.state, ExploreState::BackInRange);
        assert_eq!(d.window.unwrap().end_us, 4 * B);
        assert_eq!(d.summary.unwrap().since_us, Some(4 * B));
    }

    #[test]
    fn test_an_ongoing_absence_after_high_values_is_since_its_own_first_bucket() {
        let buckets = [normal(1), high(2, 900.0), high(3, 600.0), absent(4)];
        let s = decide(&buckets, B, 0, true, true).summary.unwrap();
        assert_eq!(s.kind, "absence");
        assert_eq!((s.started_us, s.since_us), (Some(2 * B), Some(4 * B)));
        let only_absence = decide(&[normal(1), absent(2)], B, 0, true, true);
        assert_eq!(only_absence.summary.unwrap().since_us, Some(2 * B));
        let value = decide(&[normal(1), high(2, 900.0)], B, 0, true, true);
        assert_eq!(value.summary.unwrap().since_us, None);
    }

    #[test]
    fn test_an_ongoing_absence_link_starts_at_the_absence_and_others_at_the_window() {
        let buckets = [normal(1), high(2, 900.0), high(3, 600.0), absent(4)];
        let d = decide(&buckets, B, 0, true, true);
        let (window, summary) = (d.window.unwrap(), d.summary.unwrap());
        let snap = summary_snapshot(&window, &summary, "m", true);
        assert_eq!(
            (snap.kind.as_str(), snap.start_us, snap.end_us),
            ("absence", 4 * B, 5 * B)
        );
        assert_eq!(
            window.start_us,
            2 * B,
            "the page range keeps the whole episode"
        );
        let back = summary_snapshot(&window, &summary, "m", false);
        assert_eq!(back.start_us, 2 * B);
        let value = decide(
            &[normal(1), high(2, 900.0), high(3, 600.0)],
            B,
            0,
            true,
            true,
        );
        let snap = summary_snapshot(&value.window.unwrap(), &value.summary.unwrap(), "m", true);
        assert_eq!(snap.start_us, 2 * B);
    }

    #[test]
    fn test_an_ongoing_absence_window_runs_to_the_last_detection_run() {
        let mut d = decide(&[normal(1), high(2, 900.0), absent(3)], B, 0, true, true);
        extend_ongoing_absence(&mut d, Some(9 * B));
        assert_eq!(d.window.unwrap().end_us, 9 * B);
        let mut early = decide(&[normal(1), absent(3)], B, 0, true, true);
        extend_ongoing_absence(&mut early, Some(3 * B));
        assert_eq!(
            early.window.unwrap().end_us,
            4 * B,
            "never shorter than the bucket"
        );
        let mut peer = decide(&[normal(1), absent(3)], B, 0, true, true);
        extend_ongoing_absence(&mut peer, None);
        assert_eq!(peer.window.unwrap().end_us, 4 * B);
        let mut value = decide(&[normal(1), high(2, 900.0)], B, 0, true, true);
        extend_ongoing_absence(&mut value, Some(9 * B));
        assert_eq!(value.window.unwrap().end_us, 3 * B);
        let mut back = decide(&[normal(1), absent(2), normal(3)], B, 0, true, true);
        extend_ongoing_absence(&mut back, Some(9 * B));
        assert_eq!(back.window.unwrap().end_us, 3 * B);
    }

    #[test]
    fn test_back_in_range_without_a_reading_has_no_since() {
        let unread = ExploreBucket {
            ts_us: 3 * B,
            ..Default::default()
        };
        let d = decide(&[normal(1), high(2, 150.0), unread], B, 0, true, true);
        assert_eq!(d.state, ExploreState::BackInRange);
        assert_eq!(d.summary.unwrap().since_us, None);
    }

    #[test]
    fn test_a_detector_that_never_ran_is_no_runs_before_the_training_check() {
        let d = decide(&[], B, 0, false, false);
        assert_eq!(d.state, ExploreState::NoRuns);
        assert_eq!((d.summary, d.window), (None, None));
    }

    #[test]
    fn test_untrained_or_quiet_detector_is_none_without_summary_or_window() {
        for (buckets, trained) in [
            (vec![high(1, 150.0)], false),
            (vec![normal(1)], true),
            (vec![], true),
        ] {
            let d = decide(&buckets, B, 0, true, trained);
            assert_eq!(d, ExploreDecision::default(), "{buckets:?} {trained}");
        }
    }

    #[test]
    fn test_absence_summary_has_no_numbers() {
        let d = decide(&[normal(1), absent(2)], B, 0, true, true);
        assert_eq!(d.state, ExploreState::Ongoing);
        let s = d.summary.unwrap();
        assert_eq!(s.kind, "absence");
        assert_eq!(
            (
                s.actual,
                s.expected,
                s.expected_lower,
                s.expected_upper,
                s.change_percent
            ),
            (None, None, None, None, None)
        );
    }

    #[test]
    fn test_partial_drop_summary_has_no_range() {
        let s = decide(&[normal(1), dropped(2)], B, 0, true, true)
            .summary
            .unwrap();
        assert_eq!(s.kind, "partial_drop");
        assert_eq!((s.actual, s.expected), (Some(40.0), Some(100.0)));
        assert_eq!((s.expected_lower, s.expected_upper), (None, None));
        assert_eq!(s.change_percent, Some(-60.0));
    }

    #[test]
    fn test_run_reaching_the_first_bucket_or_the_range_start_is_clipped() {
        let first = decide(&[high(1, 150.0), high(2, 150.0)], B, 0, true, true);
        assert!(first.window.unwrap().clipped);
        let at_start = decide(&[normal(1), high(2, 150.0)], B, 2 * B, true, true);
        assert!(at_start.window.unwrap().clipped);
        let inside = decide(&[normal(1), high(2, 150.0)], B, 0, true, true);
        assert!(!inside.window.unwrap().clipped);
    }

    #[test]
    fn test_missing_buckets_do_not_split_a_run() {
        let d = decide(&[normal(1), absent(2), high(5, 150.0)], B, 0, true, true);
        assert_eq!(d.window.unwrap().start_us, 2 * B);
    }

    #[test]
    fn test_served_model_is_zero_until_trained_and_a_different_sent_model_is_stale() {
        assert_eq!(served_model_version(false, 42), 0);
        assert_eq!(served_model_version(true, 42), 42);
        assert!(!is_stale_model(None, 42));
        assert!(!is_stale_model(Some(42), 42));
        assert!(is_stale_model(Some(41), 42));
        assert!(is_stale_model(Some(42), 0));
    }

    #[test]
    fn test_the_sql_reads_only_this_detector_and_its_current_model() {
        let fields: HashSet<String> = ["_timestamp", "anomaly_id", "model_version", "is_anomaly"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let sql = buckets_sql("ad'1", 77, &fields);
        assert!(sql.contains("FROM \"_anomalies\""), "{sql}");
        assert!(
            sql.contains("anomaly_id = 'ad''1' AND model_version = 77"),
            "{sql}"
        );
        assert!(!sql.contains("judged_end_us"), "{sql}");
        assert!(sql.contains("CAST(NULL AS DOUBLE) AS expected"), "{sql}");
        let mut with_judged = fields.clone();
        with_judged.insert("judged_end_us".to_string());
        with_judged.insert("is_absence".to_string());
        let sql = buckets_sql("ad1", 77, &with_judged);
        assert!(
            sql.contains("judged_end_us ASC NULLS FIRST, created_at ASC"),
            "{sql}"
        );
        assert!(sql.contains("is_absence IS TRUE"), "{sql}");
    }

    #[test]
    fn test_parsed_buckets_are_oldest_first_and_event_rows_are_no_verdict() {
        let hits = vec![
            serde_json::json!({"ts": 2 * B, "has_scored": 0, "actual": 0.0, "is_anomaly": true, "absence": 1, "partial_drop": 0}),
            serde_json::json!({"ts": B, "has_scored": 1, "actual": 150.0, "expected": 100.0, "lower": 80.0, "upper": 120.0, "is_anomaly": true, "absence": 0, "partial_drop": 0}),
        ];
        let buckets = parse_buckets(&hits);
        assert_eq!(buckets[0], high(1, 150.0));
        assert_eq!(buckets[1], absent(2));
    }

    #[test]
    fn test_a_partial_drop_bucket_reads_the_drop_event_not_the_scored_row() {
        let hits = vec![serde_json::json!({
            "ts": B, "has_scored": 1, "actual": 40.0, "expected": 145.833, "lower": 120.0,
            "upper": 170.0, "is_anomaly": true, "absence": 0, "partial_drop": 1,
            "drop_actual": 40.0, "drop_expected": 100.0
        })];
        let buckets = parse_buckets(&hits);
        assert_eq!(
            (buckets[0].value, buckets[0].expected),
            (Some(40.0), Some(100.0))
        );
        let s = run_summary(&buckets);
        assert_eq!(s.change_percent, Some(-60.0));
        let mut fields: HashSet<String> = ["actual_value", "expected_value", "is_partial_drop"]
            .into_iter()
            .map(String::from)
            .collect();
        let sql = buckets_sql("ad1", 1, &fields);
        assert!(
            sql.contains(
                "last_value(expected_value ORDER BY CASE WHEN is_partial_drop IS TRUE THEN 1 \
                 ELSE 0 END, created_at ASC) AS drop_expected"
            ),
            "{sql}"
        );
        fields.remove("is_partial_drop");
        assert!(buckets_sql("ad1", 1, &fields).contains("CAST(NULL AS DOUBLE) AS drop_expected"));
    }

    #[test]
    fn test_link_window_prefers_request_then_window_then_cursor_then_last_hour() {
        let w = ExploreWindow {
            start_us: 10,
            end_us: 20,
            clipped: false,
        };
        assert_eq!(
            link_window(Some((1, 2)), Some(&w), Some(50), 5, 100),
            (1, 2)
        );
        assert_eq!(link_window(None, Some(&w), Some(50), 5, 100), (10, 20));
        assert_eq!(link_window(None, None, Some(50), 5, 100), (45, 50));
        assert_eq!(
            link_window(None, None, None, 5, 2 * HOUR_US),
            (HOUR_US, 2 * HOUR_US)
        );
    }

    #[test]
    fn test_bucket_snapshot_carries_the_requested_bucket() {
        let buckets = [normal(1), high(2, 150.0)];
        let hit = bucket_at(&buckets, 2 * B, B);
        let snap = bucket_snapshot(hit, 2 * B, 3 * B, "count(*) per 15 min");
        assert_eq!((snap.start_us, snap.end_us), (2 * B, 3 * B));
        assert_eq!(
            (snap.actual, snap.lower, snap.upper),
            (Some(150.0), Some(80.0), Some(120.0))
        );
        let missing = bucket_snapshot(bucket_at(&buckets, 9 * B, B), 9 * B, 10 * B, "m");
        assert_eq!((missing.kind.as_str(), missing.actual), ("value", None));
    }

    #[test]
    fn test_a_peer_cluster_reports_no_run_time_cursor_or_no_new_data() {
        assert!(!is_peer_cluster(false, Some("a"), "b"));
        assert!(!is_peer_cluster(true, Some("a"), "a"));
        assert!(!is_peer_cluster(true, Some(""), "a"));
        assert!(is_peer_cluster(true, Some("a"), "b"));
        assert!(is_peer_cluster(true, None, "b"));
        assert_eq!(
            freshness(true, Some(1), Some(2), B, 10 * B),
            Freshness::default()
        );
        let local = freshness(false, Some(9 * B), Some(2 * B), B, 10 * B);
        assert_eq!(local.last_detection_run, Some(9 * B));
        assert_eq!(local.no_new_data_since_us, Some(2 * B));
        assert_eq!(
            freshness(false, None, Some(8 * B), B, 10 * B).no_new_data_since_us,
            None
        );
    }
}
