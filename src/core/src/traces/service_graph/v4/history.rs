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

//! Edge trend: per-step requests, errors and client latency of one edge from the v4 metrics.

use std::collections::BTreeMap;

use config::meta::{promql::value::RangeValue, service_graph::EdgeTrendDataPoint};

use super::{
    read::{QUANTILES, V4_ONLY, count, label_eq, range, secs_to_ns, selector},
    schedule::align_down,
    writer::{LABEL_TRACE_STREAM, M_CLIENT_SECONDS, M_REQUEST_FAILED_TOTAL, M_REQUEST_TOTAL},
};

/// Caps a series at about one day of minutes, so a week-long range still answers quickly.
const MAX_POINTS: i64 = 1440;
/// The rollup writes one sample per minute; a finer step has nothing to show.
const MIN_STEP_SECS: i64 = 60;

/// Which edge to read; an unset side matches every client or server.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EdgeFilter {
    pub client: Option<String>,
    pub server: Option<String>,
    pub trace_stream: Option<String>,
}

impl EdgeFilter {
    /// Values PromQL cannot quote are the caller's input error, not a read failure.
    pub fn validate(&self) -> Result<(), String> {
        self.matcher(true).map(|_| ())
    }

    fn matcher(&self, v4_only: bool) -> Result<String, String> {
        let mut parts = [
            ("client", &self.client),
            ("server", &self.server),
            (LABEL_TRACE_STREAM, &self.trace_stream),
        ]
        .into_iter()
        .filter_map(|(label, v)| v.as_deref().map(|v| label_eq(label, v)))
        .collect::<Result<Vec<_>, _>>()?;
        if v4_only && self.trace_stream.is_none() {
            parts.push(V4_ONLY.to_string());
        }
        Ok(parts.join(","))
    }
}

/// Reads the edge trend over `[start, end)`; each point covers the step ending at its timestamp.
pub async fn fetch_edge_history(
    org: &str,
    filter: &EdgeFilter,
    start: i64,
    end: i64,
) -> Result<Vec<EdgeTrendDataPoint>, anyhow::Error> {
    let step = step_micros(start, end);
    let Some((first, last)) = eval_bounds(start, end, step) else {
        return Ok(vec![]);
    };
    let run = |v4_only: bool| async move {
        let matcher = filter.matcher(v4_only).map_err(anyhow::Error::msg)?;
        futures::future::try_join_all(
            plan(&matcher, step)
                .iter()
                .map(|q| range(org, q, first, last, step)),
        )
        .await
    };
    let mut results = run(true).await?;
    // Collector series are read only for an edge v4 never wrote, so the two never add up.
    if filter.trace_stream.is_none() && results[0].is_empty() {
        results = run(false).await?;
    }
    Ok(assemble(&results))
}

/// Coarser than a minute only when the range would exceed `MAX_POINTS`; always whole minutes.
fn step_micros(start: i64, end: i64) -> i64 {
    let span_secs = (end.saturating_sub(start) / 1_000_000).max(1) as u64;
    let minutes = span_secs
        .div_ceil(MAX_POINTS as u64)
        .div_ceil(MIN_STEP_SECS as u64);
    minutes as i64 * MIN_STEP_SECS * 1_000_000
}

/// Evaluation times sit on step boundaries, where the rollup's samples are, inside the range.
fn eval_bounds(start: i64, end: i64, step: i64) -> Option<(i64, i64)> {
    let first = align_down(start.checked_add(step - 1)?, step).checked_add(step)?;
    let last = align_down(end, step);
    (first <= last).then_some((first, last))
}

/// Requests, failures, then p50/p95/p99; +1ms keeps the sample at each step's start.
fn plan(matcher: &str, step: i64) -> [String; 5] {
    let range_ms = step / 1_000 + 1;
    let increase =
        |metric: &str| format!("sum(increase({}[{range_ms}ms]))", selector(metric, matcher));
    let bucket = selector(&format!("{M_CLIENT_SECONDS}_bucket"), matcher);
    let [p50, p95, p99] = QUANTILES
        .map(|q| format!("histogram_quantile({q}, sum by (le) (rate({bucket}[{range_ms}ms])))"));
    [
        increase(M_REQUEST_TOTAL),
        increase(M_REQUEST_FAILED_TOTAL),
        p50,
        p95,
        p99,
    ]
}

/// Steps without requests are left out, as the per-window edge records never had them.
fn assemble(results: &[Vec<RangeValue>]) -> Vec<EdgeTrendDataPoint> {
    let [requests, failed, p50, p95, p99] = results else {
        return vec![];
    };
    let mut points: BTreeMap<i64, EdgeTrendDataPoint> = BTreeMap::new();
    let mut merge = |series: &[RangeValue], set: fn(&mut EdgeTrendDataPoint, f64)| {
        for sample in series.iter().flat_map(|s| &s.samples) {
            let p = points
                .entry(sample.timestamp)
                .or_insert_with(|| EdgeTrendDataPoint {
                    timestamp: sample.timestamp,
                    ..Default::default()
                });
            set(p, sample.value);
        }
    };
    merge(requests, |p, v| p.total_requests += count(v).round() as u64);
    merge(failed, |p, v| p.failed_requests += count(v).round() as u64);
    merge(p50, |p, v| p.p50_latency_ns = secs_to_ns(v).unwrap_or(0));
    merge(p95, |p, v| p.p95_latency_ns = secs_to_ns(v).unwrap_or(0));
    merge(p99, |p, v| p.p99_latency_ns = secs_to_ns(v).unwrap_or(0));
    points
        .into_values()
        .filter(|p| p.total_requests > 0)
        .collect()
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::Sample;

    use super::*;

    const MIN: i64 = 60_000_000;

    fn series(points: &[(i64, f64)]) -> Vec<RangeValue> {
        vec![RangeValue {
            samples: points
                .iter()
                .map(|&(timestamp, value)| Sample { timestamp, value })
                .collect(),
            ..Default::default()
        }]
    }

    #[test]
    fn test_matcher_escapes_and_skips_unset_sides() {
        let f = EdgeFilter {
            client: Some("a\"b".to_string()),
            server: None,
            trace_stream: Some("default".to_string()),
        };
        for v4_only in [true, false] {
            assert_eq!(
                f.matcher(v4_only).unwrap(),
                "client=\"a\\\"b\",trace_stream=\"default\""
            );
        }
        assert_eq!(EdgeFilter::default().matcher(false).unwrap(), "");
        let bad = EdgeFilter {
            server: Some("x\u{7}".to_string()),
            ..Default::default()
        };
        assert!(bad.validate().is_err());
    }

    #[test]
    fn test_matcher_without_a_stream_reads_v4_series_first() {
        let f = EdgeFilter {
            server: Some("b".to_string()),
            ..Default::default()
        };
        assert_eq!(f.matcher(true).unwrap(), "server=\"b\",trace_stream!=\"\"");
        assert_eq!(f.matcher(false).unwrap(), "server=\"b\"");
        assert_eq!(EdgeFilter::default().matcher(true).unwrap(), V4_ONLY);
    }

    #[test]
    fn test_step_is_whole_minutes_and_capped_by_points() {
        assert_eq!(step_micros(0, 3600 * 1_000_000), MIN);
        assert_eq!(step_micros(0, 24 * 3600 * 1_000_000), MIN);
        assert_eq!(step_micros(0, 7 * 24 * 3600 * 1_000_000), 7 * MIN);
        assert_eq!(step_micros(0, 1), MIN);
    }

    #[test]
    fn test_eval_bounds_align_to_step_inside_the_range() {
        assert_eq!(eval_bounds(0, 10 * MIN, MIN), Some((MIN, 10 * MIN)));
        assert_eq!(
            eval_bounds(MIN / 2, 10 * MIN + 1, MIN),
            Some((2 * MIN, 10 * MIN))
        );
        assert_eq!(eval_bounds(0, MIN - 1, MIN), None);
    }

    #[test]
    fn test_step_and_bounds_survive_windows_near_i64_max() {
        let step = step_micros(i64::MAX - 1, i64::MAX);
        assert_eq!(step, MIN);
        assert_eq!(eval_bounds(i64::MAX - 1, i64::MAX, step), None);
        assert!(step_micros(i64::MIN, i64::MAX) > 0);
    }

    #[test]
    fn test_plan_queries() {
        let plan = plan("server=\"b\"", MIN);
        assert_eq!(
            plan[0],
            "sum(increase(traces_service_graph_request_total{server=\"b\"}[60001ms]))"
        );
        assert_eq!(
            plan[1],
            "sum(increase(traces_service_graph_request_failed_total{server=\"b\"}[60001ms]))"
        );
        assert_eq!(
            plan[3],
            "histogram_quantile(0.95, sum by (le) (rate(traces_service_graph_request_client_seconds_bucket{server=\"b\"}[60001ms])))"
        );
    }

    #[test]
    fn test_assemble_joins_by_timestamp_and_drops_idle_steps() {
        let results = vec![
            series(&[(MIN, 10.4), (2 * MIN, 0.0), (3 * MIN, f64::NAN)]),
            series(&[(MIN, 2.0)]),
            series(&[(MIN, 0.0015), (2 * MIN, f64::NAN)]),
            series(&[(MIN, 0.002)]),
            series(&[(MIN, 0.003)]),
        ];
        assert_eq!(
            assemble(&results),
            vec![EdgeTrendDataPoint {
                timestamp: MIN,
                p50_latency_ns: 1_500_000,
                p95_latency_ns: 2_000_000,
                p99_latency_ns: 3_000_000,
                total_requests: 10,
                failed_requests: 2,
            }]
        );
    }
}
