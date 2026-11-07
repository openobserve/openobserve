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

//! Services trend: per-server RED figures against an hours-long baseline, ranked by signal.

use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap},
    future::Future,
};

use config::meta::{
    promql::value::{InstantValue, LabelsExt, RangeValue, Sample, Value},
    service_graph::{
        RedBaseline, RedFigures, ServiceSignal, ServiceTrend, ServiceTrendPoint,
        ServicesTrendResponse, ServicesTrendWindow, TrendSource,
    },
};

use super::{
    PROCESSED_TIMESTAMP_STREAM,
    read::{
        COLLECTOR_ONLY, INSTANT_STEP_MICROS, ReadFilter, count, escape_label_value, label_eq,
        matrix_rows, q_edge_failed_by_server, q_server_count, q_server_count_offset,
        q_server_failed, q_server_quantile, run_query_scoped, secs_to_ns, selector, vector_rows,
    },
};

pub const MAX_TREND_WINDOW_MICROS: i64 = 7 * 24 * HOUR_MICROS;
pub const DEFAULT_BASELINE_HOURS: u32 = 24;
pub const MAX_BASELINE_HOURS: u32 = 168;
pub const DEFAULT_LIMIT: usize = 12;
pub const MAX_LIMIT: usize = 50;
pub const MAX_INCLUDE: usize = 12;
/// Below this many requests a rate is noise: the row is `LowTraffic` and never ranks as degraded.
const MIN_REQUESTS: u64 = 20;
const ERRORS_MIN_RATE: f64 = 1.0;
const ERRORS_MIN_DELTA: f64 = 1.0;
const ERRORS_NO_BASELINE_RATE: f64 = 5.0;
const LATENCY_MIN_RATIO: f64 = 2.0;
const MIN_STEP_MICROS: i64 = 5 * 60 * 1_000_000;
/// The window plus baseline spans at most this many steps, so a series has at most 289 points.
const MAX_STEPS: i64 = 288;
const MINUTE_MICROS: i64 = 60 * 1_000_000;
const HOUR_MICROS: i64 = 3_600_000_000;
const HOUR_MS: i64 = 3_600_000;
const MAX_WARNINGS: usize = 5;
const P99: f64 = 0.99;

/// A validated request; the handler fills and bounds the window before building it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrendRequest {
    pub start: i64,
    pub end: i64,
    pub baseline_hours: u32,
    pub limit: usize,
    pub include: Vec<String>,
    pub trace_stream: Option<String>,
}

impl TrendRequest {
    /// Names PromQL cannot quote are the caller's input error, not a read failure.
    pub fn validate(&self) -> Result<(), String> {
        self.filter().validate()?;
        self.include
            .iter()
            .try_for_each(|name| label_eq("server", name).map(|_| ()))
    }

    fn filter(&self) -> ReadFilter {
        ReadFilter {
            trace_stream: self.trace_stream.clone(),
            agent_env: None,
        }
    }

    fn baseline_micros(&self) -> i64 {
        i64::from(self.baseline_hours) * HOUR_MICROS
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Span {
    start: i64,
    data_until: i64,
    baseline_start: i64,
    step: i64,
    /// Step-aligned because the engine rounds long ranges onto epoch multiples of the step.
    series_start: i64,
}

impl Span {
    fn new(req: &TrendRequest, horizon: i64, watermark: Option<i64>) -> Self {
        let data_until = watermark.map_or(req.end.min(horizon), |w| req.end.min(horizon).min(w));
        let start = data_until - (req.end - req.start);
        let baseline_start = start - req.baseline_micros();
        let step = step_micros(req.end - req.start, req.baseline_hours);
        Self {
            start,
            data_until,
            baseline_start,
            step,
            series_start: baseline_start + (-baseline_start).rem_euclid(step),
        }
    }

    /// Hour-aligned bounds the engine keeps as sent, and the offset back onto the baseline hours.
    fn coverage_grid(&self) -> (i64, i64, i64) {
        let lead = (-self.start).rem_euclid(HOUR_MICROS);
        (
            self.baseline_start + HOUR_MICROS + lead,
            self.start + lead,
            lead / 1_000,
        )
    }
}

/// Per-server figures from one window, re-summed across trace streams.
#[derive(Clone, Debug, Default, PartialEq)]
struct ServerFigures {
    requests: f64,
    failed: f64,
    p99_ns: Option<u64>,
}

/// Instant rows of one phase-1 window: count, failed, p99.
type WindowRows = [Vec<InstantValue>; 3];
/// One series step: requests, failed, p99 ns.
type StepFigures = (f64, f64, Option<u64>);

struct Phase1 {
    current: WindowRows,
    baseline: WindowRows,
    coverage: Vec<RangeValue>,
}

#[derive(Clone, Copy)]
struct Read<'a> {
    matcher: &'a str,
    source: TrendSource,
    span: Span,
}

impl Read<'_> {
    fn q_failed(&self, matcher: &str, range_ms: i64) -> String {
        match self.source {
            TrendSource::V4 => q_server_failed(matcher, range_ms),
            TrendSource::Collector => q_edge_failed_by_server(matcher, range_ms),
        }
    }
}

/// Reads the services trend; `horizon` is the newest window end the rollup may have written.
pub async fn fetch_services_trend(
    org: &str,
    req: &TrendRequest,
    horizon: i64,
) -> Result<ServicesTrendResponse, anyhow::Error> {
    fetch_with(req, horizon, |q, start, end, step| async move {
        run_query_scoped(org, &q, start, end, step).await
    })
    .await
}

async fn fetch_with<F, Fut>(
    req: &TrendRequest,
    horizon: i64,
    run: F,
) -> Result<ServicesTrendResponse, anyhow::Error>
where
    F: Fn(String, i64, i64, i64) -> Fut,
    Fut: Future<Output = Result<(Value, Vec<String>), anyhow::Error>>,
{
    let mut warnings = vec![];
    let n4 = req
        .filter()
        .node_matcher(true)
        .map_err(anyhow::Error::msg)?;
    let marker = run_instant(&run, q_marker(&n4, marker_range_ms(req)), req.end).await?;
    warnings.extend(marker.1);
    let (source, watermark) = choose_source(&marker.0, req.trace_stream.is_some());
    let span = Span::new(req, horizon, watermark);
    let matcher = match source {
        TrendSource::V4 => n4,
        TrendSource::Collector => COLLECTOR_ONLY.to_string(),
    };
    if source == TrendSource::V4 && watermark.is_none() {
        return Ok(respond(span, source, vec![], (0, 0), warnings));
    }
    let read = Read {
        matcher: &matcher,
        source,
        span,
    };
    let phase1 = read_phase1(&run, read, req, &mut warnings).await?;
    let (mut services, totals) = rank(rows_from(&phase1, req.baseline_hours), req);
    if !services.is_empty() {
        let names: Vec<String> = services.iter().map(|s| s.service.clone()).collect();
        let series = read_series(&run, read, &names, &mut warnings).await?;
        attach_series(&mut services, series);
    }
    Ok(respond(span, source, services, totals, warnings))
}

async fn run_instant<F, Fut>(
    run: &F,
    query: String,
    at: i64,
) -> Result<(Vec<InstantValue>, Vec<String>), anyhow::Error>
where
    F: Fn(String, i64, i64, i64) -> Fut,
    Fut: Future<Output = Result<(Value, Vec<String>), anyhow::Error>>,
{
    let (value, warnings) = run(query.clone(), at, at, INSTANT_STEP_MICROS).await?;
    Ok((vector_rows(value, &query)?, warnings))
}

async fn run_range<F, Fut>(
    run: &F,
    query: String,
    start: i64,
    end: i64,
    step: i64,
) -> Result<(Vec<RangeValue>, Vec<String>), anyhow::Error>
where
    F: Fn(String, i64, i64, i64) -> Fut,
    Fut: Future<Output = Result<(Value, Vec<String>), anyhow::Error>>,
{
    let (value, warnings) = run(query.clone(), start, end, step).await?;
    if start == end {
        return Ok((singleton_rows(value, &query, end)?, warnings));
    }
    Ok((matrix_rows(value, &query)?, warnings))
}

/// The engine answers a range with equal bounds as an instant query, so its vector is one step.
fn singleton_rows(value: Value, query: &str, at: i64) -> Result<Vec<RangeValue>, anyhow::Error> {
    if matches!(value, Value::Matrix(_) | Value::Range(_)) {
        return matrix_rows(value, query);
    }
    Ok(vector_rows(value, query)?
        .into_iter()
        .map(|r| RangeValue::new(r.labels, [Sample::new(at, r.sample.value)]))
        .collect())
}

async fn read_phase1<F, Fut>(
    run: &F,
    read: Read<'_>,
    req: &TrendRequest,
    warnings: &mut Vec<String>,
) -> Result<Phase1, anyhow::Error>
where
    F: Fn(String, i64, i64, i64) -> Fut,
    Fut: Future<Output = Result<(Value, Vec<String>), anyhow::Error>>,
{
    let (n, span) = (read.matcher, read.span);
    let current_ms = (span.data_until - span.start) / 1_000 + 1;
    let baseline_ms = i64::from(req.baseline_hours) * HOUR_MS + 1;
    let instants = [
        (q_server_count(n, current_ms), span.data_until),
        (read.q_failed(n, current_ms), span.data_until),
        (q_server_quantile(P99, n, current_ms), span.data_until),
        (q_server_count(n, baseline_ms), span.start),
        (read.q_failed(n, baseline_ms), span.start),
        (q_server_quantile(P99, n, baseline_ms), span.start),
    ];
    let (grid_start, grid_end, offset_ms) = span.coverage_grid();
    let coverage = run_range(
        run,
        q_server_count_offset(n, HOUR_MS, offset_ms),
        grid_start,
        grid_end,
        HOUR_MICROS,
    );
    let (rows, coverage) = futures::future::join(
        futures::future::join_all(instants.map(|(q, at)| run_instant(run, q, at))),
        coverage,
    )
    .await;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let (rows, w) = r?;
        warnings.extend(w);
        out.push(rows);
    }
    let (coverage, w) = coverage?;
    warnings.extend(w);
    let [c, f, q, bc, bf, bq]: [Vec<InstantValue>; 6] = out
        .try_into()
        .map_err(|_| anyhow::anyhow!("services trend: phase 1 returned the wrong result count"))?;
    Ok(Phase1 {
        current: [c, f, q],
        baseline: [bc, bf, bq],
        coverage,
    })
}

async fn read_series<F, Fut>(
    run: &F,
    read: Read<'_>,
    names: &[String],
    warnings: &mut Vec<String>,
) -> Result<[Vec<RangeValue>; 3], anyhow::Error>
where
    F: Fn(String, i64, i64, i64) -> Fut,
    Fut: Future<Output = Result<(Value, Vec<String>), anyhow::Error>>,
{
    let span = read.span;
    let m = server_matcher(read.matcher, names).map_err(anyhow::Error::msg)?;
    let step_ms = span.step / 1_000;
    let queries = [
        q_server_count(&m, step_ms),
        read.q_failed(&m, step_ms),
        q_server_quantile(P99, &m, step_ms),
    ];
    let results = futures::future::join_all(
        queries.map(|q| run_range(run, q, span.series_start, span.data_until, span.step)),
    )
    .await;
    let mut out = Vec::with_capacity(3);
    for r in results {
        let (rows, w) = r?;
        warnings.extend(w);
        out.push(rows);
    }
    out.try_into()
        .map_err(|_| anyhow::anyhow!("services trend: phase 2 returned the wrong result count"))
}

/// The marker spans the window and the baseline, so v4 history anywhere in it keeps `V4`.
fn marker_range_ms(req: &TrendRequest) -> i64 {
    (req.end - (req.start - req.baseline_micros())) / 1_000 + 1
}

fn q_marker(n4: &str, range_ms: i64) -> String {
    format!(
        "max(max_over_time({}[{range_ms}ms]))",
        selector(PROCESSED_TIMESTAMP_STREAM, n4)
    )
}

/// The gauge holds seconds; a stream filter only exists on v4 series, so it never falls back.
fn choose_source(rows: &[InstantValue], stream_filtered: bool) -> (TrendSource, Option<i64>) {
    let mark = rows
        .iter()
        .map(|r| r.sample.value)
        .filter(|v| v.is_finite())
        .reduce(f64::max);
    match mark {
        Some(secs) => (TrendSource::V4, Some((secs * 1e6) as i64)),
        None if stream_filtered => (TrendSource::V4, None),
        None => (TrendSource::Collector, None),
    }
}

fn step_micros(window_micros: i64, baseline_hours: u32) -> i64 {
    let span = window_micros + i64::from(baseline_hours) * HOUR_MICROS;
    let per_step = (span + MAX_STEPS - 1) / MAX_STEPS;
    let minutes = (per_step + MINUTE_MICROS - 1) / MINUTE_MICROS;
    (minutes * MINUTE_MICROS).max(MIN_STEP_MICROS)
}

/// `n` plus an anchored alternation of the names, regex-escaped and then PromQL-quoted.
fn server_matcher(n: &str, names: &[String]) -> Result<String, String> {
    let alternation = names
        .iter()
        .map(|name| regex::escape(name))
        .collect::<Vec<_>>()
        .join("|");
    let server = format!(
        "server=~\"{}\"",
        escape_label_value(&format!("^(?:{alternation})$"))?
    );
    Ok(if n.is_empty() {
        server
    } else {
        format!("{n},{server}")
    })
}

fn per_server(rows: &WindowRows) -> BTreeMap<String, ServerFigures> {
    let [counts, failed, p99] = rows;
    let mut out: BTreeMap<String, ServerFigures> = BTreeMap::new();
    for r in counts {
        out.entry(r.labels.get_value("server"))
            .or_default()
            .requests += count(r.sample.value);
    }
    for r in failed {
        if let Some(f) = out.get_mut(&r.labels.get_value("server")) {
            f.failed += count(r.sample.value);
        }
    }
    for r in p99 {
        if let Some(f) = out.get_mut(&r.labels.get_value("server")) {
            f.p99_ns = secs_to_ns(r.sample.value);
        }
    }
    out
}

/// Hours of the baseline with any request, per server, after re-summing streams per step.
fn covered_hours(coverage: &[RangeValue]) -> HashMap<String, u32> {
    let mut per_step: HashMap<(String, i64), f64> = HashMap::new();
    for series in coverage {
        let server = series.labels.get_value("server");
        for s in &series.samples {
            *per_step.entry((server.clone(), s.timestamp)).or_default() += count(s.value);
        }
    }
    let mut out: HashMap<String, u32> = HashMap::new();
    for ((server, _), requests) in per_step {
        if requests > 0.0 {
            *out.entry(server).or_default() += 1;
        }
    }
    out
}

fn red(f: &ServerFigures) -> RedFigures {
    let requests = f.requests.round().max(0.0) as u64;
    RedFigures {
        requests,
        failed: f.failed.round().max(0.0) as u64,
        error_rate: error_rate(f),
        p99_latency_ns: f.p99_ns,
    }
}

fn error_rate(f: &ServerFigures) -> f64 {
    if f.requests > 0.0 {
        (f.failed / f.requests * 100.0).min(100.0)
    } else {
        0.0
    }
}

/// No baseline under `MIN_REQUESTS` or under half the requested hours covered.
fn baseline_of(
    f: Option<&ServerFigures>,
    covered_hours: u32,
    baseline_hours: u32,
) -> Option<RedBaseline> {
    let f = f?;
    if f.requests.round() < MIN_REQUESTS as f64 || covered_hours < baseline_hours / 2 {
        return None;
    }
    Some(RedBaseline {
        error_rate: error_rate(f),
        p99_latency_ns: f.p99_ns,
        requests_per_min: f.requests / (f64::from(baseline_hours) * 60.0),
        covered_hours,
    })
}

fn trend_row(service: String, f: &ServerFigures, baseline: Option<RedBaseline>) -> ServiceTrend {
    let current = red(f);
    let p99_ratio = baseline.as_ref().and_then(|b| {
        let (now, base) = (current.p99_latency_ns?, b.p99_latency_ns?);
        (current.requests >= MIN_REQUESTS && base > 0).then(|| now as f64 / base as f64)
    });
    let error_rate_delta = baseline.as_ref().map(|b| current.error_rate - b.error_rate);
    let signal = signal_of(&current, baseline.is_some(), p99_ratio, error_rate_delta);
    ServiceTrend {
        service,
        current,
        baseline,
        p99_ratio,
        error_rate_delta,
        signal,
        included: false,
        series: vec![],
    }
}

fn signal_of(
    current: &RedFigures,
    has_baseline: bool,
    p99_ratio: Option<f64>,
    error_rate_delta: Option<f64>,
) -> ServiceSignal {
    if current.requests < MIN_REQUESTS {
        return ServiceSignal::LowTraffic;
    }
    let errors = if has_baseline {
        current.error_rate >= ERRORS_MIN_RATE
            && error_rate_delta.is_some_and(|d| d >= ERRORS_MIN_DELTA)
    } else {
        current.error_rate >= ERRORS_NO_BASELINE_RATE
    };
    if errors {
        ServiceSignal::Errors
    } else if p99_ratio.is_some_and(|r| r >= LATENCY_MIN_RATIO) {
        ServiceSignal::Latency
    } else {
        ServiceSignal::Normal
    }
}

/// One row per server with at least one request in the window and a name PromQL can quote.
fn rows_from(phase1: &Phase1, baseline_hours: u32) -> Vec<ServiceTrend> {
    let current = per_server(&phase1.current);
    let baseline = per_server(&phase1.baseline);
    let covered = covered_hours(&phase1.coverage);
    current
        .into_iter()
        .filter(|(server, f)| {
            !server.is_empty() && f.requests.round() >= 1.0 && escape_label_value(server).is_ok()
        })
        .map(|(server, f)| {
            let hours = covered.get(&server).copied().unwrap_or(0);
            let b = baseline_of(baseline.get(&server), hours, baseline_hours);
            trend_row(server, &f, b)
        })
        .collect()
}

fn rank_key(row: &ServiceTrend) -> f64 {
    match row.signal {
        ServiceSignal::Errors => row.error_rate_delta.unwrap_or(row.current.error_rate),
        ServiceSignal::Latency => row.p99_ratio.unwrap_or(0.0),
        ServiceSignal::Normal | ServiceSignal::LowTraffic => row.current.requests as f64,
    }
}

fn rank_order(a: &ServiceTrend, b: &ServiceTrend) -> Ordering {
    a.signal
        .cmp(&b.signal)
        .then_with(|| rank_key(b).total_cmp(&rank_key(a)))
        .then_with(|| a.service.cmp(&b.service))
}

/// Top `limit` after validity, then every `include` name with rows; totals cover all servers.
fn rank(mut rows: Vec<ServiceTrend>, req: &TrendRequest) -> (Vec<ServiceTrend>, (u32, u32)) {
    rows.sort_by(rank_order);
    let total = rows.len() as u32;
    let degraded = rows
        .iter()
        .filter(|r| matches!(r.signal, ServiceSignal::Errors | ServiceSignal::Latency))
        .count() as u32;
    let mut selected = Vec::with_capacity(req.limit + req.include.len());
    for (i, mut row) in rows.into_iter().enumerate() {
        if i < req.limit {
            selected.push(row);
        } else if req.include.contains(&row.service) {
            row.included = true;
            selected.push(row);
        }
    }
    (selected, (total, degraded))
}

fn attach_series(services: &mut [ServiceTrend], series: [Vec<RangeValue>; 3]) {
    let [counts, failed, p99] = series;
    let mut points: HashMap<String, BTreeMap<i64, StepFigures>> = HashMap::new();
    let mut merge = |rows: &[RangeValue], set: fn(&mut StepFigures, f64)| {
        for s in rows {
            let steps = points.entry(s.labels.get_value("server")).or_default();
            for sample in &s.samples {
                set(steps.entry(sample.timestamp).or_default(), sample.value);
            }
        }
    };
    merge(&counts, |p, v| p.0 += count(v));
    merge(&failed, |p, v| p.1 += count(v));
    merge(&p99, |p, v| p.2 = secs_to_ns(v));
    for svc in services.iter_mut() {
        let Some(steps) = points.remove(&svc.service) else {
            continue;
        };
        svc.series = steps
            .into_iter()
            .filter(|(_, (requests, ..))| requests.round() >= 1.0)
            .map(|(timestamp, (requests, failed, p99))| ServiceTrendPoint {
                timestamp,
                requests: requests.round() as u64,
                failed: failed.round().max(0.0) as u64,
                p99_latency_ns: p99,
            })
            .collect();
    }
}

/// Deduplicated in first-seen order and capped; any warning at all marks the response partial.
fn settle_warnings(warnings: Vec<String>) -> (bool, Vec<String>) {
    let partial = !warnings.is_empty();
    let mut out: Vec<String> = Vec::with_capacity(MAX_WARNINGS);
    for w in warnings {
        if out.len() == MAX_WARNINGS {
            break;
        }
        if !out.contains(&w) {
            out.push(w);
        }
    }
    (partial, out)
}

fn respond(
    span: Span,
    source: TrendSource,
    services: Vec<ServiceTrend>,
    (total_services, degraded_total): (u32, u32),
    warnings: Vec<String>,
) -> ServicesTrendResponse {
    let (partial, warnings) = settle_warnings(warnings);
    ServicesTrendResponse {
        window: ServicesTrendWindow {
            start_time: span.start,
            end_time: span.data_until,
        },
        baseline_window: ServicesTrendWindow {
            start_time: span.baseline_start,
            end_time: span.start,
        },
        data_until: span.data_until,
        source,
        step_micros: span.step,
        series_start: span.series_start,
        partial,
        warnings,
        services,
        total_services,
        degraded_total,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use config::meta::promql::value::{Label, Sample};

    use super::{
        super::{
            read::V4_ONLY,
            writer::{LABEL_TRACE_STREAM, M_REQUEST_FAILED_TOTAL, M_SERVER_FAILED_TOTAL},
        },
        *,
    };

    const NOW: i64 = 1_800_000_000_000_000;
    const MIN: i64 = MINUTE_MICROS;

    /// Server, trace stream, requests, failed, p99 seconds.
    type Fig = (&'static str, &'static str, f64, f64, f64);

    #[derive(Clone, Default)]
    struct Fake {
        marker_secs: Option<f64>,
        current_at: i64,
        current: Vec<Fig>,
        baseline: Vec<Fig>,
        /// Server, trace stream, baseline hour indexes with requests.
        coverage: Vec<(&'static str, &'static str, Vec<i64>)>,
        /// Server, trace stream, step timestamp, requests.
        series: Vec<(&'static str, &'static str, i64, f64)>,
        /// A server with requests at every step the engine evaluates after its own rounding.
        grid_server: Option<&'static str>,
        warning: Option<&'static str>,
    }

    impl Fake {
        fn answer(&self, q: &str, start: i64, end: i64, step: i64) -> Value {
            if q.contains(PROCESSED_TIMESTAMP_STREAM) {
                return Value::Vector(self.marker_secs.map(|v| row(&[], v)).into_iter().collect());
            }
            if start == end && step == HOUR_MICROS {
                let rows = self.coverage.iter().filter(|(.., hours)| !hours.is_empty());
                let rows = rows.map(|(server, stream, _)| {
                    row(&[("server", server), (LABEL_TRACE_STREAM, stream)], 5.0)
                });
                return Value::Vector(rows.collect());
            }
            if start != end {
                return Value::Matrix(self.matrix(q, start, end, step));
            }
            let figs = if start == self.current_at {
                &self.current
            } else {
                &self.baseline
            };
            let rows = figs.iter().map(|(server, stream, count, failed, p99)| {
                if q.starts_with("histogram_quantile") {
                    row(&[("server", server)], *p99)
                } else if is_failed_query(q) {
                    row(&[("server", server)], fails_in(q, stream, *failed))
                } else {
                    row(&[("server", server), (LABEL_TRACE_STREAM, stream)], *count)
                }
            });
            Value::Vector(rows.collect())
        }

        fn matrix(&self, q: &str, start: i64, end: i64, step: i64) -> Vec<RangeValue> {
            if step == HOUR_MICROS {
                return self
                    .coverage
                    .iter()
                    .map(|(server, stream, hours)| {
                        let samples = hours
                            .iter()
                            .map(|h| Sample::new(start + h * HOUR_MICROS, 5.0));
                        RangeValue::new(
                            labels(&[("server", server), (LABEL_TRACE_STREAM, stream)]),
                            samples,
                        )
                    })
                    .collect();
            }
            if q.starts_with("histogram_quantile") || is_failed_query(q) {
                return vec![];
            }
            if let Some(server) = self.grid_server {
                let (first, last) = promql::adjust_start_end(start, end, step);
                let samples =
                    (0..=(last - first) / step).map(|i| Sample::new(first + i * step, 5.0));
                return vec![RangeValue::new(labels(&[("server", server)]), samples)];
            }
            self.series
                .iter()
                .map(|(server, stream, ts, v)| {
                    RangeValue::new(
                        labels(&[("server", server), (LABEL_TRACE_STREAM, stream)]),
                        [Sample::new(*ts, *v)],
                    )
                })
                .collect()
        }
    }

    fn is_failed_query(q: &str) -> bool {
        q.contains(M_SERVER_FAILED_TOTAL) || q.contains(M_REQUEST_FAILED_TOTAL)
    }

    /// Collector series lack the node failure counter; v4 figures come from it alone.
    fn fails_in(q: &str, stream: &str, failed: f64) -> f64 {
        let has = if stream.is_empty() {
            q.contains(M_REQUEST_FAILED_TOTAL)
        } else {
            q.contains(M_SERVER_FAILED_TOTAL)
        };
        if has { failed } else { f64::NAN }
    }

    fn labels(pairs: &[(&str, &str)]) -> Vec<Arc<Label>> {
        pairs
            .iter()
            .map(|(k, v)| Arc::new(Label::new(*k, *v)))
            .collect()
    }

    fn row(pairs: &[(&str, &str)], value: f64) -> InstantValue {
        InstantValue {
            labels: labels(pairs),
            sample: Sample::new(0, value),
        }
    }

    fn request(baseline_hours: u32, limit: usize) -> TrendRequest {
        TrendRequest {
            start: NOW - HOUR_MICROS,
            end: NOW,
            baseline_hours,
            limit,
            include: vec![],
            trace_stream: None,
        }
    }

    /// Runs the whole read against `fake`; returns the response and every (query, start, end).
    async fn run_fake(
        fake: &Fake,
        req: &TrendRequest,
        horizon: i64,
    ) -> (ServicesTrendResponse, Vec<(String, i64, i64)>) {
        let seen = Mutex::new(vec![]);
        let seen_ref = &seen;
        let resp = fetch_with(req, horizon, |q, start, end, step| {
            let value = fake.answer(&q, start, end, step);
            let warnings = fake.warning.map(str::to_string).into_iter().collect();
            seen_ref.lock().unwrap().push((q, start, end));
            async move { Ok((value, warnings)) }
        })
        .await
        .unwrap();
        (resp, seen.into_inner().unwrap())
    }

    fn all_hours(baseline_hours: u32) -> Vec<i64> {
        (0..i64::from(baseline_hours)).collect()
    }

    fn trend(service: &str, signal: ServiceSignal, key: f64, requests: u64) -> ServiceTrend {
        ServiceTrend {
            service: service.to_string(),
            current: RedFigures {
                requests,
                error_rate: key,
                ..Default::default()
            },
            baseline: None,
            p99_ratio: Some(key),
            error_rate_delta: Some(key),
            signal,
            included: false,
            series: vec![],
        }
    }

    #[test]
    fn test_step_and_point_counts() {
        let points = |window: i64, hours: u32| {
            let step = step_micros(window, hours);
            (step, (window + i64::from(hours) * HOUR_MICROS) / step + 1)
        };
        assert_eq!(points(HOUR_MICROS, 24), (6 * MIN, 251));
        assert_eq!(points(HOUR_MICROS, 1), (5 * MIN, 25));
        assert_eq!(
            points(MAX_TREND_WINDOW_MICROS, MAX_BASELINE_HOURS),
            (70 * MIN, 289)
        );
    }

    #[test]
    fn test_per_stream_rows_are_resummed_per_server() {
        let rows: WindowRows = [
            vec![
                row(&[("server", "a"), (LABEL_TRACE_STREAM, "s1")], 30.0),
                row(&[("server", "a"), (LABEL_TRACE_STREAM, "s2")], 70.0),
                row(&[("server", "b"), (LABEL_TRACE_STREAM, "s1")], f64::NAN),
            ],
            vec![row(&[("server", "a")], 4.0)],
            vec![row(&[("server", "a")], 0.25)],
        ];
        let figs = per_server(&rows);
        assert_eq!(
            figs["a"],
            ServerFigures {
                requests: 100.0,
                failed: 4.0,
                p99_ns: Some(250_000_000)
            }
        );
        assert_eq!(figs["b"].requests, 0.0);

        let coverage = vec![
            RangeValue::new(
                labels(&[("server", "a"), (LABEL_TRACE_STREAM, "s1")]),
                [Sample::new(1, 3.0), Sample::new(2, 0.0)],
            ),
            RangeValue::new(
                labels(&[("server", "a"), (LABEL_TRACE_STREAM, "s2")]),
                [Sample::new(1, 2.0), Sample::new(3, 1.0)],
            ),
        ];
        assert_eq!(
            covered_hours(&coverage)["a"],
            2,
            "hour 1 counts once across streams"
        );

        let mut services = vec![trend("a", ServiceSignal::Normal, 0.0, 100)];
        let step_rows = vec![
            RangeValue::new(
                labels(&[("server", "a"), (LABEL_TRACE_STREAM, "s1")]),
                [Sample::new(10, 3.0), Sample::new(20, 0.0)],
            ),
            RangeValue::new(
                labels(&[("server", "a"), (LABEL_TRACE_STREAM, "s2")]),
                [Sample::new(10, 2.0)],
            ),
        ];
        attach_series(&mut services, [step_rows, vec![], vec![]]);
        assert_eq!(
            services[0].series,
            vec![ServiceTrendPoint {
                timestamp: 10,
                requests: 5,
                failed: 0,
                p99_latency_ns: None
            }],
            "summed per step; the empty step is a gap"
        );
    }

    #[tokio::test]
    async fn test_v4_marker_spans_window_and_baseline_and_keeps_every_query_v4() {
        let req = request(24, 12);
        let fake = Fake {
            marker_secs: Some((NOW / 1_000_000) as f64),
            current_at: NOW,
            current: vec![("a", "default", 100.0, 0.0, 0.1)],
            ..Default::default()
        };
        let (resp, seen) = run_fake(&fake, &req, NOW).await;
        assert_eq!(resp.source, TrendSource::V4);
        let (marker, at, _) = &seen[0];
        assert_eq!(*at, NOW);
        assert!(
            marker.contains(&format!("[{}ms]", 25 * HOUR_MS + 1)),
            "{marker}"
        );
        assert_eq!(
            seen.len(),
            11,
            "one marker, seven phase-1 and three phase-2 queries"
        );
        for (q, ..) in &seen {
            assert!(q.contains(V4_ONLY) && !q.contains(COLLECTOR_ONLY), "{q}");
        }
    }

    #[tokio::test]
    async fn test_no_marker_reads_only_collector_series() {
        let fake = Fake {
            current_at: NOW,
            current: vec![("a", "", 100.0, 0.0, 0.1)],
            ..Default::default()
        };
        let (resp, seen) = run_fake(&fake, &request(24, 12), NOW).await;
        assert_eq!(resp.source, TrendSource::Collector);
        assert_eq!(resp.data_until, NOW);
        for (q, ..) in &seen[1..] {
            assert!(q.contains(COLLECTOR_ONLY) && !q.contains(V4_ONLY), "{q}");
        }
        assert_eq!(resp.services.len(), 1);
    }

    #[tokio::test]
    async fn test_no_marker_with_a_stream_filter_is_v4_without_rows() {
        let req = TrendRequest {
            trace_stream: Some("default".to_string()),
            ..request(24, 12)
        };
        let fake = Fake {
            current_at: NOW,
            current: vec![("a", "default", 100.0, 0.0, 0.1)],
            ..Default::default()
        };
        let (resp, seen) = run_fake(&fake, &req, NOW).await;
        assert_eq!(resp.source, TrendSource::V4);
        assert!(resp.services.is_empty());
        assert_eq!(seen.len(), 1);
        assert!(
            seen[0].0.contains("trace_stream=\"default\""),
            "{}",
            seen[0].0
        );
    }

    #[test]
    fn test_data_until_is_the_earliest_bound_and_the_window_shifts_left() {
        let req = request(24, 12);
        let span = Span::new(&req, NOW - 5 * MIN, Some(NOW - 9 * MIN));
        assert_eq!(span.step, 6 * MIN);
        assert_eq!(span.data_until, NOW - 9 * MIN);
        assert_eq!(span.start, NOW - 9 * MIN - HOUR_MICROS);
        assert_eq!(span.baseline_start, span.start - 24 * HOUR_MICROS);
        assert_eq!(span.series_start, span.baseline_start + 3 * MIN);
        assert_eq!(
            Span::new(&req, NOW - 5 * MIN, None).data_until,
            NOW - 5 * MIN
        );
        let odd = Span::new(&request(1, 12), NOW - 7 * MIN - 13_000_000, None);
        assert_eq!(odd.data_until, NOW - 7 * MIN - 13_000_000);
        assert_eq!(odd.series_start.rem_euclid(odd.step), 0);
        assert!(odd.series_start >= odd.baseline_start);
        assert!(odd.series_start < odd.baseline_start + odd.step);
        assert_eq!(
            Span::new(&req, NOW + 5 * MIN, Some(NOW + MIN)).data_until,
            NOW
        );
    }

    #[tokio::test]
    async fn test_limit_applies_after_baseline_validity_and_degraded_counts_final_signals() {
        let fake = Fake {
            marker_secs: Some((NOW / 1_000_000) as f64),
            current_at: NOW,
            current: vec![
                ("lost", "default", 100.0, 0.0, 0.3),
                ("valid", "default", 100.0, 0.0, 0.25),
                ("calm", "default", 100.0, 0.0, 0.1),
            ],
            baseline: vec![
                ("lost", "default", 1000.0, 0.0, 0.1),
                ("valid", "default", 1000.0, 0.0, 0.1),
                ("calm", "default", 1000.0, 0.0, 0.1),
            ],
            coverage: vec![
                ("lost", "default", vec![0, 1, 2]),
                ("valid", "default", all_hours(24)),
                ("calm", "default", all_hours(24)),
            ],
            series: vec![("valid", "default", NOW - HOUR_MICROS, 7.0)],
            ..Default::default()
        };
        let (resp, seen) = run_fake(&fake, &request(24, 1), NOW).await;
        let names: Vec<&str> = resp.services.iter().map(|s| s.service.as_str()).collect();
        assert_eq!(names, ["valid"]);
        let valid = &resp.services[0];
        assert_eq!(valid.signal, ServiceSignal::Latency);
        assert_eq!(valid.p99_ratio, Some(2.5));
        assert_eq!(valid.baseline.as_ref().map(|b| b.covered_hours), Some(24));
        assert_eq!(valid.series.len(), 1);
        assert_eq!((resp.total_services, resp.degraded_total), (3, 1));
        let series_query = &seen.last().unwrap().0;
        assert!(
            series_query.contains(r#"server=~"^(?:valid)$""#),
            "{series_query}"
        );
    }

    #[tokio::test]
    async fn test_include_rows_are_returned_marked_beyond_the_limit() {
        let fake = Fake {
            current_at: NOW,
            current: vec![
                ("a", "", 300.0, 0.0, 0.1),
                ("b", "", 200.0, 0.0, 0.1),
                ("c", "", 100.0, 0.0, 0.1),
            ],
            ..Default::default()
        };
        let req = TrendRequest {
            include: vec!["a".to_string(), "c".to_string(), "gone".to_string()],
            ..request(24, 1)
        };
        let (resp, _) = run_fake(&fake, &req, NOW).await;
        let got: Vec<(&str, bool)> = resp
            .services
            .iter()
            .map(|s| (s.service.as_str(), s.included))
            .collect();
        assert_eq!(got, [("a", false), ("c", true)]);
        assert_eq!(resp.total_services, 3);
    }

    #[test]
    fn test_series_matcher_escapes_regex_then_label_characters() {
        let names = ["a.b".to_string(), "x\"y".to_string(), "p|q".to_string()];
        assert_eq!(
            server_matcher(V4_ONLY, &names).unwrap(),
            r#"trace_stream!="",server=~"^(?:a\\.b|x\"y|p\\|q)$""#
        );
        assert_eq!(
            server_matcher("", &names[..1]).unwrap(),
            r#"server=~"^(?:a\\.b)$""#
        );
        assert!(server_matcher("", &["a\tb".to_string()]).is_err());
    }

    #[test]
    fn test_baseline_needs_min_requests_and_half_the_hours() {
        let figs = |requests| ServerFigures {
            requests,
            failed: 2.0,
            p99_ns: Some(5),
        };
        assert!(baseline_of(Some(&figs(100.0)), 11, 24).is_none());
        let b = baseline_of(Some(&figs(1440.0)), 12, 24).unwrap();
        assert_eq!(b.covered_hours, 12);
        assert_eq!(b.requests_per_min, 1.0);
        assert!((b.error_rate - 2.0 / 14.4).abs() < 1e-9);
        assert!(baseline_of(Some(&figs(19.0)), 24, 24).is_none());
        assert!(baseline_of(None, 24, 24).is_none());
        assert!(baseline_of(Some(&figs(20.0)), 0, 1).is_some());
    }

    #[test]
    fn test_signal_thresholds_with_and_without_baseline() {
        let fig = |requests: f64, failed: f64, p99| ServerFigures {
            requests,
            failed,
            p99_ns: Some(p99),
        };
        let base = |error_rate| RedBaseline {
            error_rate,
            p99_latency_ns: Some(100),
            requests_per_min: 1.0,
            covered_hours: 24,
        };
        assert_eq!(
            trend_row("s".into(), &fig(19.0, 19.0, 900), Some(base(0.0))).signal,
            ServiceSignal::LowTraffic
        );
        assert_eq!(
            trend_row("s".into(), &fig(19.0, 19.0, 900), None).signal,
            ServiceSignal::LowTraffic
        );
        assert_eq!(
            trend_row("s".into(), &fig(1000.0, 20.0, 100), Some(base(0.1))).signal,
            ServiceSignal::Errors
        );
        assert_eq!(
            trend_row("s".into(), &fig(1000.0, 20.0, 100), Some(base(1.5))).signal,
            ServiceSignal::Normal
        );
        assert_eq!(
            trend_row("s".into(), &fig(1000.0, 9.0, 100), Some(base(0.0))).signal,
            ServiceSignal::Normal
        );
        assert_eq!(
            trend_row("s".into(), &fig(1000.0, 10.0, 100), Some(base(0.0))).signal,
            ServiceSignal::Errors
        );
        assert_eq!(
            trend_row("s".into(), &fig(1000.0, 0.0, 200), Some(base(0.0))).signal,
            ServiceSignal::Latency
        );
        assert_eq!(
            trend_row("s".into(), &fig(1000.0, 0.0, 199), Some(base(0.0))).signal,
            ServiceSignal::Normal
        );
        assert_eq!(
            trend_row("s".into(), &fig(1000.0, 49.0, 900), None).signal,
            ServiceSignal::Normal
        );
        let no_base = trend_row("s".into(), &fig(1000.0, 50.0, 900), None);
        assert_eq!(no_base.signal, ServiceSignal::Errors);
        assert_eq!((no_base.p99_ratio, no_base.error_rate_delta), (None, None));
    }

    #[test]
    fn test_tier_sort_and_ties() {
        let mut rows = [
            trend("low", ServiceSignal::LowTraffic, 0.0, 5),
            trend("n-small", ServiceSignal::Normal, 0.0, 10),
            trend("lat-2", ServiceSignal::Latency, 2.0, 100),
            trend("err-b", ServiceSignal::Errors, 3.0, 100),
            trend("n-big", ServiceSignal::Normal, 0.0, 500),
            trend("lat-4", ServiceSignal::Latency, 4.0, 100),
            trend("err-a", ServiceSignal::Errors, 3.0, 100),
            trend("err-top", ServiceSignal::Errors, 9.0, 100),
        ];
        rows.sort_by(rank_order);
        let names: Vec<&str> = rows.iter().map(|r| r.service.as_str()).collect();
        assert_eq!(
            names,
            [
                "err-top", "err-a", "err-b", "lat-4", "lat-2", "n-big", "n-small", "low"
            ]
        );
    }

    #[test]
    fn test_warnings_mark_partial_deduplicate_and_cap() {
        assert_eq!(settle_warnings(vec![]), (false, vec![]));
        let raw: Vec<String> = ["a", "b", "a", "c", "d", "b", "e", "f", "g"]
            .map(str::to_string)
            .into();
        let (partial, warnings) = settle_warnings(raw);
        assert!(partial);
        assert_eq!(warnings, ["a", "b", "c", "d", "e"]);
    }

    #[tokio::test]
    async fn test_response_json_matches_the_web_contract() {
        let fake = Fake {
            current_at: NOW,
            current: vec![("a", "", 5.0, 0.0, f64::NAN)],
            ..Default::default()
        };
        let (resp, _) = run_fake(&fake, &request(24, 12), NOW).await;
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["source"], "collector");
        assert_eq!(json["window"]["end_time"], NOW);
        let svc = &json["services"][0];
        assert_eq!(svc["signal"], "low_traffic");
        assert!(svc["baseline"].is_null() && svc["p99_ratio"].is_null());
        assert!(svc["current"]["p99_latency_ns"].is_null());
        assert_eq!(svc["included"], false);
        let v4 = serde_json::to_value(TrendSource::V4).unwrap();
        assert_eq!(v4, "v4");
    }

    #[tokio::test]
    async fn test_one_hour_baseline_reads_a_singleton_coverage_vector() {
        let fake = Fake {
            current_at: NOW,
            current: vec![("a", "", 100.0, 0.0, 0.2)],
            baseline: vec![("a", "", 100.0, 0.0, 0.1)],
            coverage: vec![("a", "", vec![0])],
            ..Default::default()
        };
        let (resp, seen) = run_fake(&fake, &request(1, 12), NOW).await;
        let coverage = seen
            .iter()
            .find(|(q, ..)| q.contains(&format!("[{HOUR_MS}ms]")));
        let (_, start, end) = coverage.unwrap();
        assert_eq!(start, end, "a one-hour baseline has a single coverage step");
        let a = &resp.services[0];
        assert_eq!(a.baseline.as_ref().map(|b| b.covered_hours), Some(1));
        assert_eq!(a.signal, ServiceSignal::Latency);
    }

    /// The web reads the series at `series_start + k * step_micros` exactly.
    fn client_lookups(resp: &ServicesTrendResponse) -> (usize, usize) {
        let step = resp.step_micros;
        let origin = resp.series_start;
        let first = origin + (resp.window.start_time - origin + step - 1) / step * step;
        let series = &resp.services[0].series;
        let wanted: Vec<i64> = (0..)
            .map(|k| first + k * step)
            .take_while(|at| *at <= resp.data_until)
            .collect();
        let hit = wanted
            .iter()
            .filter(|at| series.iter().any(|p| p.timestamp == **at))
            .count();
        (hit, wanted.len())
    }

    #[tokio::test]
    async fn test_series_grid_matches_the_engine_rounding_for_an_unaligned_watermark() {
        let watermark = NOW - 7 * MIN - 13_000_000;
        for (window, hours) in [(HOUR_MICROS, 24), (7 * MIN, 1), (90 * MIN, 3)] {
            let req = TrendRequest {
                start: NOW - window,
                ..request(hours, 12)
            };
            let span = Span::new(&req, NOW, Some(watermark));
            let fake = Fake {
                marker_secs: Some(watermark as f64 / 1e6),
                current_at: span.data_until,
                current: vec![("a", "default", 100.0, 0.0, 0.1)],
                grid_server: Some("a"),
                ..Default::default()
            };
            let (resp, _) = run_fake(&fake, &req, NOW).await;
            assert_eq!(
                resp.data_until, watermark,
                "the right edge is never snapped"
            );
            assert_eq!(resp.window.end_time, watermark);
            assert_eq!(resp.window.start_time, watermark - window);
            assert_eq!(resp.baseline_window.end_time, watermark - window);
            assert_eq!(resp.series_start % resp.step_micros, 0);
            let (hit, wanted) = client_lookups(&resp);
            assert!(wanted > 0);
            assert_eq!(hit, wanted, "window {window} baseline {hours} h");
        }
    }

    #[tokio::test]
    async fn test_query_warnings_reach_the_response() {
        let fake = Fake {
            current_at: NOW,
            current: vec![("a", "", 100.0, 0.0, 0.1)],
            warning: Some("node x timed out"),
            ..Default::default()
        };
        let (resp, _) = run_fake(&fake, &request(24, 12), NOW).await;
        assert!(resp.partial);
        assert_eq!(resp.warnings, ["node x timed out"]);
    }

    #[tokio::test]
    async fn test_collector_failures_come_from_the_edge_counter_summed_by_server() {
        let fake = Fake {
            current_at: NOW,
            current: vec![("a", "", 1000.0, 100.0, 0.1)],
            ..Default::default()
        };
        let (resp, seen) = run_fake(&fake, &request(24, 12), NOW).await;
        assert_eq!(resp.source, TrendSource::Collector);
        let a = &resp.services[0];
        assert_eq!((a.current.failed, a.current.error_rate), (100, 10.0));
        assert_eq!(a.signal, ServiceSignal::Errors);
        for (q, ..) in seen.iter().filter(|(q, ..)| is_failed_query(q)) {
            assert!(
                q.starts_with("sum by (server) (increase(")
                    && q.contains(M_REQUEST_FAILED_TOTAL)
                    && !q.contains(M_SERVER_FAILED_TOTAL),
                "{q}"
            );
        }
    }

    #[tokio::test]
    async fn test_unquotable_server_names_are_skipped_not_fatal() {
        let fake = Fake {
            current_at: NOW,
            current: vec![
                ("ok", "", 100.0, 0.0, 0.1),
                ("bad\u{7}", "", 500.0, 0.0, 0.1),
            ],
            ..Default::default()
        };
        let (resp, seen) = run_fake(&fake, &request(24, 12), NOW).await;
        let names: Vec<&str> = resp.services.iter().map(|s| s.service.as_str()).collect();
        assert_eq!(names, ["ok"]);
        assert_eq!(resp.total_services, 1);
        assert!(seen.last().unwrap().0.contains(r#"server=~"^(?:ok)$""#));
    }

    #[test]
    fn test_coverage_windows_survive_the_engine_rounding() {
        let span = Span {
            start: 124 * HOUR_MICROS + 30 * MIN,
            data_until: 125 * HOUR_MICROS + 30 * MIN,
            baseline_start: 100 * HOUR_MICROS + 30 * MIN,
            step: 6 * MIN,
            series_start: 100 * HOUR_MICROS + 30 * MIN,
        };
        let (start, end, offset_ms) = span.coverage_grid();
        let (first, last) = promql::adjust_start_end(start, end, HOUR_MICROS);
        let window_ends: Vec<i64> = (0..=(last - first) / HOUR_MICROS)
            .map(|k| first + k * HOUR_MICROS - offset_ms * 1_000)
            .collect();
        let wanted: Vec<i64> = (1..=24)
            .map(|k| span.baseline_start + k * HOUR_MICROS)
            .collect();
        assert_eq!(window_ends, wanted);
        let q = q_server_count_offset("", HOUR_MS, offset_ms);
        assert!(
            q.ends_with(&format!("[{HOUR_MS}ms] offset 1800000ms))")),
            "{q}"
        );
        promql_parser::parser::parse(&q).unwrap();
        let aligned = Span {
            start: 124 * HOUR_MICROS,
            baseline_start: 100 * HOUR_MICROS,
            ..span
        };
        assert_eq!(
            aligned.coverage_grid(),
            (101 * HOUR_MICROS, 124 * HOUR_MICROS, 0)
        );
    }
}
