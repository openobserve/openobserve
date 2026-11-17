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

//! PromQL reads of the service-signal metrics streams.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use config::{
    meta::promql::{
        NAME_LABEL,
        value::{Labels, LabelsExt, RangeValue, Sample, Value},
    },
    utils::time::SECOND_MICRO_SECS,
};

use crate::traces::service_graph::v4::MAX_BACKLOG_MICROS;

const HOUR_MICROS: i64 = 3_600 * SECOND_MICRO_SECS;
/// An arm starting further back than this is read in whole hours (D240).
pub const FINE_HORIZON_MICROS: i64 = 24 * HOUR_MICROS;
// Settlement waits this long past the backlog edge and the ingest RPC timeout, for clock skew.
const SETTLE_MARGIN_MICROS: i64 = HOUR_MICROS;
// Late writes after settlement must become visible after this cache entry expires.
const SETTLED_TTL_MICROS: i64 = SETTLE_MARGIN_MICROS;
// Step samples the settled reads of one node hold, 16 bytes each.
const SETTLED_SAMPLES: usize = 2_000_000;
// An empty read holds no samples, so the number of settled reads is capped on its own.
const SETTLED_READS: usize = 4_096;

// Instant raw reads miss the PromQL result cache, so settled arms are kept here instead (F7).
static SETTLED: LazyLock<Mutex<Settled>> = LazyLock::new(Default::default);

/// How an arm is read: its bounds and step after snapping, and whether it reads whole hours.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ArmGrid {
    pub start: i64,
    pub end: i64,
    pub step: i64,
    pub hourly: bool,
}

/// One series' increase over an arm, its traffic in the arm's last part and the steps it moved in.
#[derive(Clone, Debug, PartialEq)]
pub struct SeriesIncrease {
    pub labels: Labels,
    pub total: f64,
    pub latest: f64,
    pub span: Option<(i64, i64)>,
}

impl SeriesIncrease {
    pub fn label(&self, name: &str) -> String {
        self.labels.get_value(name)
    }
}

/// Org, query, grid and super-cluster fan-out of one arm read.
type SettledKey = (String, String, ArmGrid, bool);

/// Settled arm reads with their read time and sample count, oldest read evicted first.
#[derive(Default)]
struct Settled {
    reads: HashMap<SettledKey, (i64, usize, Value)>,
    samples: usize,
}

impl Settled {
    fn get(&mut self, key: &SettledKey, now: i64) -> Option<Value> {
        let (at, _, value) = self.reads.get(key)?;
        if now - *at < SETTLED_TTL_MICROS {
            return Some(value.clone());
        }
        self.remove(key);
        None
    }

    fn put(&mut self, key: SettledKey, now: i64, value: Value) {
        let samples: usize = matrix(&value).iter().map(|s| s.samples.len()).sum();
        if samples > SETTLED_SAMPLES / 4 {
            return;
        }
        self.remove(&key);
        let swept = &mut self.samples;
        self.reads.retain(|_, (at, n, _)| {
            let live = now - *at < SETTLED_TTL_MICROS;
            if !live {
                *swept -= *n;
            }
            live
        });
        while self.reads.len() >= SETTLED_READS || self.samples + samples > SETTLED_SAMPLES {
            let Some(oldest) = self
                .reads
                .iter()
                .min_by_key(|(_, (at, ..))| *at)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.remove(&oldest);
        }
        self.samples += samples;
        self.reads.insert(key, (now, samples, value));
    }

    fn remove(&mut self, key: &SettledKey) {
        if let Some((_, samples, _)) = self.reads.remove(key) {
            self.samples -= samples;
        }
    }
}

pub fn arm_grid(start: i64, end: i64, window: i64, now: i64) -> ArmGrid {
    if start >= now - FINE_HORIZON_MICROS || window >= HOUR_MICROS {
        return ArmGrid {
            start,
            end,
            step: window,
            hourly: false,
        };
    }
    ArmGrid {
        start: start.div_euclid(HOUR_MICROS) * HOUR_MICROS,
        end: end.div_euclid(HOUR_MICROS) * HOUR_MICROS
            + if end.rem_euclid(HOUR_MICROS) == 0 {
                0
            } else {
                HOUR_MICROS
            },
        step: HOUR_MICROS,
        hourly: true,
    }
}

pub fn arm_query(selector: &str, start: i64, end: i64, step: i64) -> (String, i64, i64, i64) {
    let at = read_at(end, step);
    let range_ms = (at - (start - step)) / 1_000;
    (format!("{selector}[{range_ms}ms]"), at, at, step)
}

/// Per-series increase over the arm, its traffic in the arm's last part and the steps it moved in.
pub fn increases(value: &Value, start: i64, step: i64, latest_from: i64) -> Vec<SeriesIncrease> {
    matrix(value)
        .iter()
        .map(|s| {
            let mut out = SeriesIncrease {
                labels: s.labels.clone().without_label(NAME_LABEL),
                total: 0.0,
                latest: 0.0,
                span: None,
            };
            for (at, increase) in fold(&s.samples, start, step) {
                out.total += increase;
                if at > latest_from {
                    out.latest += increase;
                }
                let moved = (at - step, at);
                out.span = Some(
                    out.span
                        .map_or(moved, |(a, b)| (a.min(moved.0), b.max(moved.1))),
                );
            }
            out
        })
        .collect()
}

/// Per-series increase at each step end after `start`, for charts; the same fold as [`increases`].
pub fn step_increases(
    value: &Value,
    start: i64,
    step: i64,
) -> Vec<(SeriesIncrease, Vec<(i64, f64)>)> {
    matrix(value)
        .iter()
        .map(|s| {
            let steps = fold(&s.samples, start, step);
            let labels = s.labels.clone().without_label(NAME_LABEL);
            let total = steps.iter().map(|(_, n)| n).sum();
            let span = steps.first().zip(steps.last()).map(|(a, b)| (a.0, b.0));
            (
                SeriesIncrease {
                    labels,
                    total,
                    latest: 0.0,
                    span,
                },
                steps,
            )
        })
        .collect()
}

/// Exact integer counts of [`increases`].
pub fn arm_counts(value: &Value, start: i64, step: i64) -> Vec<(Labels, u64)> {
    increases(value, start, step, i64::MAX)
        .into_iter()
        .map(|s| (s.labels, s.total.round().max(0.0) as u64))
        .collect()
}

/// A PromQL regex matching exactly these values.
pub fn any_of<'a>(values: impl IntoIterator<Item = &'a str>) -> String {
    let alternatives: Vec<String> = values.into_iter().map(regex::escape).collect();
    literal(&alternatives.join("|"))
}

/// A PromQL string literal of `value`; control characters were dropped when it was written.
pub fn literal(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Runs one range query in process; reads fan out to every region unless `local`.
pub async fn range(
    org: &str,
    query: &str,
    grid: ArmGrid,
    local: bool,
) -> Result<Value, anyhow::Error> {
    let req = request(query, grid);
    #[cfg(not(feature = "enterprise"))]
    let is_super_cluster = false;
    #[cfg(feature = "enterprise")]
    let is_super_cluster = !local
        && o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled;
    #[cfg(not(feature = "enterprise"))]
    let _ = local;
    let key = (org.to_string(), query.to_string(), grid, is_super_cluster);
    settled_read(key, config::utils::time::now_micros(), || async {
        let trace_id = config::ider::generate_trace_id();
        let resp =
            promql_service::search::search(&trace_id, org, &req, "", 0, is_super_cluster).await?;
        complete(resp, grid.end)
    })
    .await
}

/// The service-signal writer refuses a window ending at or before this: past the catch-up backlog.
pub fn writable_after(now: i64) -> i64 {
    now - config::get_config().limit.cache_delay_secs * SECOND_MICRO_SECS - MAX_BACKLOG_MICROS
}

/// Arms ending by this are final; an ingest cut at the backlog edge ends within its RPC timeout.
pub(super) fn settled_before(now: i64) -> i64 {
    let ingest = config::get_config().limit.grpc_ingest_timeout as i64 * SECOND_MICRO_SECS;
    writable_after(now) - SETTLE_MARGIN_MICROS - ingest
}

/// The value of a response, trimmed to the arm; a warning means a node failed or series were cut.
fn complete(
    resp: promql_service::search::SearchResponse,
    end: i64,
) -> Result<Value, anyhow::Error> {
    if !resp.warnings.is_empty() {
        anyhow::bail!("incomplete PromQL result: {}", resp.warnings.join("; "));
    }
    Ok(trim(resp.value, end))
}

/// An arm's instant read of raw samples at [`read_at`].
fn request(query: &str, grid: ArmGrid) -> promql_service::MetricsQueryRequest {
    let at = read_at(grid.end, grid.step);
    promql_service::MetricsQueryRequest {
        query: query.to_string(),
        start: at,
        end: at,
        step: grid.step,
        query_exemplars: false,
        use_cache: Some(true),
        search_type: Some(config::meta::search::SearchEventType::Other),
        search_event_context: None,
        regions: vec![],
        clusters: vec![],
    }
}

/// Drops the samples past `end` that [`request`] read only to include the sample at `end`.
fn trim(value: Value, end: i64) -> Value {
    match value {
        Value::Matrix(series) => Value::Matrix(
            series
                .into_iter()
                .filter_map(|mut s| {
                    s.samples.retain(|p| p.timestamp <= end);
                    (!s.samples.is_empty()).then_some(s)
                })
                .collect(),
        ),
        other => other,
    }
}

fn read_at(end: i64, step: i64) -> i64 {
    end + step
}

/// Arms ending by [`settled_before`] are final, so one read serves repeated compares.
pub(super) async fn settled_read<F, Fut>(
    key: SettledKey,
    now: i64,
    read: F,
) -> Result<Value, anyhow::Error>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<Value, anyhow::Error>>,
{
    let settled = key.2.end <= settled_before(now);
    if settled {
        let held = SETTLED.lock().expect("settled reads").get(&key, now);
        if let Some(value) = held {
            return Ok(value);
        }
    }
    let value = read().await?;
    if !settled {
        return Ok(value);
    }
    let value = compact(value, key.2.start, key.2.step);
    SETTLED
        .lock()
        .expect("settled reads")
        .put(key, now, value.clone());
    Ok(value)
}

/// Each series as one cumulative sample per step it moved in, which [`fold`] reads the same.
fn compact(value: Value, start: i64, step: i64) -> Value {
    match value {
        Value::Matrix(series) => Value::Matrix(
            series
                .into_iter()
                .map(|mut s| {
                    let mut total = 0.0;
                    let mut samples = vec![Sample::new(start, 0.0)];
                    for (at, increase) in fold(&s.samples, start, step) {
                        total += increase;
                        samples.push(Sample::new(at, total));
                    }
                    s.samples = samples;
                    s
                })
                .collect(),
        ),
        other => other,
    }
}

fn matrix(value: &Value) -> &[RangeValue] {
    match value {
        Value::Matrix(series) => series,
        _ => &[],
    }
}

fn fold(samples: &[Sample], start: i64, step: i64) -> Vec<(i64, f64)> {
    let step = step.max(1);
    let mut steps: Vec<(i64, f64)> = Vec::new();
    let mut prev = 0.0;
    for sample in samples {
        if sample.timestamp > start {
            let increase = if sample.value >= prev {
                sample.value - prev
            } else {
                sample.value
            };
            if increase > 0.0 {
                let at = start + (sample.timestamp - start + step - 1).div_euclid(step) * step;
                match steps.last_mut() {
                    Some((t, n)) if *t == at => *n += increase,
                    _ => steps.push((at, increase)),
                }
            }
        }
        prev = sample.value;
    }
    steps
}

#[cfg(test)]
pub(crate) mod engine_tests {
    use std::{sync::Arc, time::Duration};

    use config::meta::promql::{HASH_LABEL, VALUE_LABEL, value::QueryContext};
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
            datatypes::{DataType, Field, Schema},
        },
        datasource::MemTable,
        prelude::{SessionContext, col, lit},
    };
    use promql::{ScanContext, TableProvider, exec::PromqlContext};
    use promql_parser::{label::Matchers, parser::EvalStmt};

    use super::*;

    const W: i64 = 60_000_000;
    const T0: i64 = 1_700_000_040_000_000;

    pub(crate) struct Rows(pub(crate) SessionContext, pub(crate) Arc<Schema>);

    #[async_trait::async_trait]
    impl TableProvider for Rows {
        async fn create_context(
            &self,
            _org_id: &str,
            _stream_name: &str,
            _time_range: (i64, i64),
            _matchers: Matchers,
            _label_selector: hashbrown::HashSet<String>,
            _filters: &mut [(String, Vec<String>)],
            _streaming: bool,
        ) -> datafusion::error::Result<Vec<ScanContext>> {
            Ok(vec![ScanContext::table(
                self.0.clone(),
                self.1.clone(),
                config::meta::search::ScanStats::default(),
                true,
            )])
        }
    }

    /// [`Rows`] read as storage reads them, without a sample at exactly the range end.
    pub(crate) struct EndExclusive(pub(crate) Rows);

    #[async_trait::async_trait]
    impl TableProvider for EndExclusive {
        async fn create_context(
            &self,
            _org_id: &str,
            stream_name: &str,
            time_range: (i64, i64),
            _matchers: Matchers,
            _label_selector: hashbrown::HashSet<String>,
            _filters: &mut [(String, Vec<String>)],
            _streaming: bool,
        ) -> datafusion::error::Result<Vec<ScanContext>> {
            let ts = || col(config::TIMESTAMP_COL_NAME);
            let read = self.0.0.table(stream_name).await?.filter(
                ts().gt_eq(lit(time_range.0))
                    .and(ts().lt(lit(time_range.1))),
            )?;
            let ctx = SessionContext::new();
            ctx.register_table(stream_name, read.into_view())?;
            Ok(vec![ScanContext::table(
                ctx,
                self.0.1.clone(),
                config::meta::search::ScanStats::default(),
                true,
            )])
        }
    }

    pub(crate) fn rows(metric: &str, rows: &[(&str, i64, f64)]) -> Rows {
        labelled(metric, "series", rows)
    }

    /// Rows whose one label column is `label`.
    pub(crate) fn labelled(metric: &str, label: &str, rows: &[(&str, i64, f64)]) -> Rows {
        let schema = Arc::new(Schema::new(vec![
            Field::new(config::TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
            Field::new(label, DataType::Utf8, true),
            Field::new(NAME_LABEL, DataType::Utf8, true),
        ]));
        let hash = |s: &str| {
            s.bytes()
                .fold(7u64, |h, b| h.wrapping_mul(31).wrapping_add(b as u64))
        };
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.1))),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|r| hash(r.0)),
                )),
                Arc::new(Float64Array::from_iter_values(rows.iter().map(|r| r.2))),
                Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.0))),
                Arc::new(StringArray::from_iter_values(rows.iter().map(|_| metric))),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new();
        ctx.register_table(
            metric,
            Arc::new(MemTable::try_new(schema.clone(), vec![vec![batch]]).unwrap()),
        )
        .unwrap();
        Rows(ctx, schema)
    }

    pub(crate) async fn eval(
        provider: impl TableProvider,
        query: &str,
        start: i64,
        end: i64,
        step: i64,
    ) -> Value {
        let query_ctx = Arc::new(QueryContext {
            trace_id: "t".into(),
            org_id: "o".into(),
            query_exemplars: false,
            query_data: false,
            need_wal: false,
            use_cache: false,
            timeout: 30,
            search_event_type: None,
            search_event_context: None,
            regions: vec![],
            clusters: vec![],
            is_super_cluster: false,
        });
        let mut ctx = PromqlContext::new(query_ctx, provider, vec![]);
        let at = |us: i64| std::time::UNIX_EPOCH + Duration::from_micros(us as u64);
        let stmt = EvalStmt {
            expr: promql_parser::parser::parse(query).unwrap(),
            start: at(start),
            end: at(end),
            interval: Duration::from_micros(step.max(0) as u64),
            lookback_delta: Duration::from_secs(300),
        };
        ctx.exec("t", stmt).await.unwrap().0
    }

    /// Cumulative samples at window ends after `0 @ t_base`, as the writer emits them.
    fn written(
        series: &'static str,
        born: i64,
        per_window: &[u64],
    ) -> Vec<(&'static str, i64, f64)> {
        let mut out = vec![(series, born - 1_000, 0.0)];
        let mut total = 0;
        for (i, n) in per_window.iter().enumerate() {
            total += n;
            out.push((series, born + i as i64 * W, total as f64));
        }
        out
    }

    #[tokio::test]
    async fn arm_counts_are_exact_on_the_real_engine() {
        let metric = "_o2_service_requests_total";
        // Arm (T0+5W, T0+15W]: ten windows.
        let (s, e) = (T0 + 5 * W, T0 + 15 * W);
        let busy = vec![1_000_003u64; 20];
        let mut samples = written("old", T0, &busy);
        samples.extend(written(
            "born",
            T0 + 9 * W,
            &[7, 11, 13, 17, 19, 23, 29, 31],
        ));
        // Takeover at T0+11W: the new owner restarts the same series from a fresh 0 baseline.
        let mut taken = written("taken", T0, &[500_000; 11]);
        taken.extend(written(
            "taken",
            T0 + 12 * W,
            &[41, 43, 47, 53, 59, 61, 67, 71],
        ));
        samples.extend(taken);
        let grid = ArmGrid {
            start: s,
            end: e,
            step: W,
            hourly: false,
        };
        let value = read(metric, &samples, grid).await;
        assert_eq!(
            counts(&value, grid),
            vec![
                ("born".to_string(), 7 + 11 + 13 + 17 + 19 + 23 + 29),
                ("old".to_string(), 10 * 1_000_003),
                ("taken".to_string(), 5 * 500_000 + 41 + 43 + 47 + 53),
            ]
        );
    }

    #[tokio::test]
    async fn arm_reads_keep_the_sample_at_the_arm_end() {
        let metric = "_o2_service_requests_total";
        let (s, e) = (T0 + 5 * W, T0 + 15 * W);
        let samples = written("seq", T0, &[238; 20]);
        for grid in [
            arm_grid(s, e, W, e),
            ArmGrid {
                start: s,
                end: e - W / 2,
                step: W,
                hourly: false,
            },
        ] {
            let (query, ..) = arm_query(&format!("{metric}{{}}"), grid.start, grid.end, grid.step);
            let req = request(&query, grid);
            let read = eval(
                EndExclusive(rows(metric, &samples)),
                &req.query,
                req.start,
                req.end,
                req.step,
            )
            .await;
            let value = trim(read, grid.end);
            let windows = (grid.end - grid.start) / W;
            assert_eq!(
                arm_counts(&value, s, W)
                    .into_iter()
                    .map(|(_, n)| n)
                    .collect::<Vec<_>>(),
                vec![windows as u64 * 238],
                "{grid:?}"
            );
            let Value::Matrix(series) = &value else {
                panic!("a matrix expected, got {value:?}");
            };
            let last = series[0].samples.last().unwrap().timestamp;
            assert_eq!(last, grid.start + windows * W, "{grid:?}");
        }
    }

    /// Reads `samples` of `metric` for `grid` the way [`range`] does, from end-exclusive storage.
    async fn read(metric: &str, samples: &[(&str, i64, f64)], grid: ArmGrid) -> Value {
        let (query, ..) = arm_query(&format!("{metric}{{}}"), grid.start, grid.end, grid.step);
        let req = request(&query, grid);
        let value = eval(
            EndExclusive(rows(metric, samples)),
            &req.query,
            req.start,
            req.end,
            req.step,
        )
        .await;
        trim(value, grid.end)
    }

    fn counts(value: &Value, grid: ArmGrid) -> Vec<(String, u64)> {
        let mut got: Vec<(String, u64)> = arm_counts(value, grid.start, grid.step)
            .into_iter()
            .map(|(labels, n)| (labels.get_value("series"), n))
            .collect();
        got.sort();
        got
    }

    #[tokio::test]
    async fn a_reset_is_counted_from_its_baseline_when_its_first_value_exceeds_the_last() {
        let metric = "_o2_service_requests_total";
        // One a window from T0 to T0+5W (cumulative 1..6), then a new owner from a 0 baseline.
        let mut samples = written("taken", T0, &[1; 6]);
        samples.extend(written("taken", T0 + 6 * W, &[9, 3]));
        // Idle after T0+3W, then readmitted from a 0 baseline: the gap has no samples at all.
        let mut gap = written("readmitted", T0, &[1; 4]);
        gap.extend(written("readmitted", T0 + 6 * W, &[9, 3]));
        samples.extend(gap);
        let grid = ArmGrid {
            start: T0 + 2 * W,
            end: T0 + 8 * W,
            step: W,
            hourly: false,
        };
        let value = read(metric, &samples, grid).await;
        assert_eq!(
            counts(&value, grid),
            vec![
                ("readmitted".to_string(), 1 + 9 + 3),
                ("taken".to_string(), 3 + 9 + 3),
            ]
        );
        let steps: Vec<(String, f64)> = step_increases(&value, grid.start, grid.step)
            .into_iter()
            .map(|(s, _)| (s.label("series"), s.total))
            .collect();
        assert!(steps.contains(&("taken".to_string(), 15.0)), "{steps:?}");
        assert!(
            steps.contains(&("readmitted".to_string(), 13.0)),
            "{steps:?}"
        );
    }

    #[tokio::test]
    async fn a_reset_inside_an_hourly_step_keeps_the_traffic_before_it() {
        let metric = "_o2_service_requests_total";
        let hour = HOUR_MICROS;
        let h = T0 - T0.rem_euclid(hour) + hour;
        let mut samples = vec![("hour", h - 1_000, 0.0), ("hour", h, 100.0)];
        for i in 1..=20 {
            samples.push(("hour", h + i * W, 100.0 + 10.0 * i as f64));
        }
        samples.push(("hour", h + 21 * W - 1_000, 0.0));
        for i in 21..=60 {
            samples.push(("hour", h + i * W, 5.0 * (i - 20) as f64));
        }
        let grid = arm_grid(h, h + hour, W, h + 30 * 24 * hour);
        assert!(grid.hourly && grid.start == h && grid.end == h + hour);
        let value = read(metric, &samples, grid).await;
        assert_eq!(counts(&value, grid), vec![("hour".to_string(), 200 + 200)]);
        let steps: Vec<(i64, f64)> = step_increases(&value, grid.start, grid.step)
            .into_iter()
            .flat_map(|(_, steps)| steps)
            .collect();
        assert_eq!(steps, vec![(h + hour, 400.0)]);
    }

    #[tokio::test]
    async fn a_settled_arm_is_read_once_and_a_recent_one_every_time() {
        let now = T0 + 30 * 24 * HOUR_MICROS;
        let settled = settled_before(now);
        let reads = std::sync::atomic::AtomicUsize::new(0);
        let points = |n: usize| {
            Value::Matrix(vec![RangeValue::new(
                Labels::default(),
                vec![Sample::new(T0, 1.0); n],
            )])
        };
        let read = |n: usize| {
            reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let value = points(n);
            async move { Ok::<_, anyhow::Error>(value) }
        };
        let key = |org: &str, end: i64| {
            let grid = ArmGrid {
                start: end - HOUR_MICROS,
                end,
                step: HOUR_MICROS,
                hourly: true,
            };
            (org.to_string(), "m{}[1h]".to_string(), grid, false)
        };
        for end in [settled, settled + 1] {
            reads.store(0, std::sync::atomic::Ordering::SeqCst);
            for _ in 0..3 {
                let value = settled_read(key("settled-org", end), now, || read(3))
                    .await
                    .unwrap();
                assert_eq!(matrix(&value).len(), 1);
            }
            let expected = if end == settled { 1 } else { 3 };
            assert_eq!(reads.load(std::sync::atomic::Ordering::SeqCst), expected);
        }
        reads.store(0, std::sync::atomic::Ordering::SeqCst);
        let later = now + SETTLED_TTL_MICROS;
        settled_read(key("settled-org", settled), later, || read(3))
            .await
            .unwrap();
        assert_eq!(
            reads.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "an expired read is read again"
        );
        let mut held = Settled::default();
        let big = SETTLED_SAMPLES / 4;
        for n in 0..4 {
            held.put(key("bounded-org", settled - n), now + n, points(big));
        }
        assert_eq!(held.samples, 4 * big);
        held.put(key("bounded-org", settled - 4), now + 4, points(big));
        assert_eq!(held.samples, 4 * big);
        assert!(held.get(&key("bounded-org", settled), now + 4).is_none());
        assert!(
            held.get(&key("bounded-org", settled - 4), now + 4)
                .is_some()
        );
        held.put(key("bounded-org", settled - 5), now + 5, points(big + 1));
        assert!(
            held.get(&key("bounded-org", settled - 5), now + 5)
                .is_none()
        );
        SETTLED
            .lock()
            .unwrap()
            .reads
            .retain(|k, _| k.0 != "settled-org");
    }

    #[tokio::test]
    async fn a_delayed_write_applies_after_settlement_shows_once_the_cached_arm_expires() {
        let now = T0 + 30 * 24 * HOUR_MICROS;
        let end = settled_before(now);
        let grid = ArmGrid {
            start: end - HOUR_MICROS,
            end,
            step: HOUR_MICROS,
            hourly: true,
        };
        let key = || {
            (
                "delayed-write-org".to_string(),
                "m{}[1h]".to_string(),
                grid,
                false,
            )
        };
        let storage = std::sync::Mutex::new(vec![Sample::new(end - 1_000, 0.0)]);
        let read = || {
            let samples = storage.lock().unwrap().clone();
            let value = Value::Matrix(vec![RangeValue::new(Labels::default(), samples)]);
            async move { Ok::<_, anyhow::Error>(value) }
        };
        let total = |value: &Value| -> Vec<f64> {
            increases(value, grid.start, grid.step, grid.end)
                .into_iter()
                .map(|s| s.total)
                .collect()
        };
        let cached = settled_read(key(), now, read).await.unwrap();
        storage.lock().unwrap().push(Sample::new(end, 7.0));
        let stale = settled_read(key(), now + SETTLED_TTL_MICROS - 1, read)
            .await
            .unwrap();
        let healed = settled_read(key(), now + SETTLED_TTL_MICROS, read)
            .await
            .unwrap();
        assert_eq!(total(&cached), vec![0.0]);
        assert_eq!(
            total(&stale),
            vec![0.0],
            "inside the TTL the cached arm answers"
        );
        assert_eq!(
            total(&healed),
            vec![7.0],
            "the late write shows once the arm expires"
        );
        const { assert!(SETTLED_TTL_MICROS <= SETTLE_MARGIN_MICROS) };
        assert!(SETTLE_MARGIN_MICROS <= writable_after(now) - settled_before(now));
        SETTLED
            .lock()
            .unwrap()
            .reads
            .retain(|k, _| k.0 != "delayed-write-org");
    }

    #[test]
    fn distinct_empty_reads_are_bounded_and_expired_reads_are_swept() {
        let now = T0 + 30 * 24 * HOUR_MICROS;
        let key = |n: usize| {
            let end = settled_before(now) - (n as i64) * HOUR_MICROS;
            let grid = ArmGrid {
                start: end - HOUR_MICROS,
                end,
                step: HOUR_MICROS,
                hourly: true,
            };
            ("empty-org".to_string(), "m{}[1h]".to_string(), grid, false)
        };
        let mut held = Settled::default();
        for n in 0..SETTLED_READS + 10 {
            held.put(key(n), now + n as i64, Value::Matrix(vec![]));
        }
        assert_eq!(held.reads.len(), SETTLED_READS);
        assert!(held.reads.contains_key(&key(SETTLED_READS + 9)));
        assert!(
            !held.reads.contains_key(&key(0)),
            "the oldest read went first"
        );
        let one = Value::Matrix(vec![RangeValue::new(
            Labels::default(),
            vec![Sample::new(T0, 1.0)],
        )]);
        let later = now + SETTLED_READS as i64 + 10 + SETTLED_TTL_MICROS;
        held.put(key(SETTLED_READS + 100), later, one);
        assert_eq!(held.reads.len(), 1, "expired reads are swept on insertion");
        assert_eq!(held.samples, 1);
    }

    #[tokio::test]
    async fn a_compacted_read_folds_as_its_raw_samples() {
        let metric = "_o2_service_requests_total";
        let hour = HOUR_MICROS;
        let h = T0 - T0.rem_euclid(hour) + hour;
        let mut samples = vec![("hour", h - 1_000, 0.0), ("hour", h, 100.0)];
        for i in 1..=50 {
            samples.push(("hour", h + i * W, 100.0 + 10.0 * i as f64));
        }
        samples.push(("hour", h + 51 * W - 1_000, 0.0));
        for i in 51..=150 {
            samples.push(("hour", h + i * W, 5.0 * (i - 50) as f64));
        }
        samples.extend(written("idle", h + 3 * W, &[0, 0, 0]));
        let grid = arm_grid(h, h + 3 * hour, W, h + 30 * 24 * hour);
        let raw = read(metric, &samples, grid).await;
        let small = compact(raw.clone(), grid.start, grid.step);
        assert!(matrix(&small).iter().all(|s| s.samples.len() <= 4));
        let latest = grid.end - 10 * W;
        assert_eq!(
            increases(&small, grid.start, grid.step, latest),
            increases(&raw, grid.start, grid.step, latest)
        );
        assert_eq!(
            step_increases(&small, grid.start, grid.step),
            step_increases(&raw, grid.start, grid.step)
        );
        assert_eq!(
            counts(&small, grid),
            vec![("hour".to_string(), 1_000), ("idle".to_string(), 0)]
        );
    }

    #[test]
    fn an_incomplete_result_is_an_error() {
        let value = Value::Matrix(vec![]);
        let truncated = promql_service::search::SearchResponse {
            value: value.clone(),
            warnings: vec![
                "PromQL result truncated from 3 to 2 series; increase the organization limit or ZO_METRICS_MAX_SERIES_RESPONSE".into(),
            ],
        };
        let error = complete(truncated, T0).unwrap_err().to_string();
        assert!(error.contains("truncated from 3 to 2 series"), "{error}");
        let whole = promql_service::search::SearchResponse {
            value,
            warnings: vec![],
        };
        assert!(complete(whole, T0).is_ok());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn rust_quantiles_equal_histogram_quantile_on_the_real_engine() {
        use o2_enterprise::enterprise::{
            search::datafusion::udaf::ddsketch::sketch_config,
            service_identity::signals::histogram::{BOUNDS, Histogram, INF_LE, LE},
        };
        let metric = "_o2_service_request_duration_seconds_bucket";
        let mut sketch = sketches_ddsketch::DDSketch::new(sketch_config());
        for i in 0..5_000_u32 {
            // Microseconds: a 1 ms floor and a tail out to ~40 ms.
            sketch.add(1_000.0 + f64::from(i % 997).powf(1.5) * 1.3);
        }
        let hist = Histogram::from_sketch(&sketch, 1e6, 1e6);
        assert_eq!(hist.total(), 5_000);
        let mut samples = Vec::new();
        let mut cumulative = 0.0;
        for (i, n) in hist.counts.iter().enumerate() {
            cumulative += *n as f64;
            let le = if i < BOUNDS { LE[i].as_str() } else { INF_LE };
            samples.push((le, T0 - 1_000, 0.0));
            samples.push((le, T0 + W, cumulative));
        }
        for q in [0.5, 0.75, 0.95, 0.99] {
            let query = format!(
                "histogram_quantile({q}, sum by (le) (last_over_time({metric}[{}ms])))",
                W / 1_000 + 1
            );
            let value = eval(labelled(metric, "le", &samples), &query, T0 + W, T0 + W, W).await;
            let engine = match &value {
                Value::Matrix(series) => series[0].samples[0].value,
                Value::Vector(points) => points[0].sample.value,
                other => panic!("one point expected, got {other:?}"),
            } * 1e6;
            let rust = hist.quantile(q).unwrap();
            assert!(
                (engine - rust).abs() <= rust * 1e-9,
                "q={q}: engine {engine} vs rust {rust}"
            );
        }
    }

    #[test]
    fn every_query_reads_a_range_past_its_step_and_old_arms_read_hours() {
        let day = 24 * HOUR_MICROS;
        let now = T0 + 10 * day;
        for (start, end, step) in [
            (now - 600 * SECOND_MICRO_SECS, now, W),
            (now - 3 * day, now - 2 * day, W),
        ] {
            let grid = arm_grid(start, end, step, now);
            let (query, qs, qe, qstep) = arm_query("m{}", grid.start, grid.end, grid.step);
            let range_ms = (grid.end - grid.start) / 1_000 + 2 * grid.step / 1_000;
            assert_eq!(query, format!("m{{}}[{range_ms}ms]"));
            assert!(range_ms * 1_000 > grid.step);
            assert_eq!(qs, qe);
            assert_eq!((qs, qstep), (grid.end + grid.step, grid.step));
        }
        let fine = arm_grid(now - 600 * SECOND_MICRO_SECS, now, W, now);
        assert!(!fine.hourly && fine.step == W);
        let start = now - 2 * day - 90 * SECOND_MICRO_SECS;
        let old = arm_grid(start, start + 2 * HOUR_MICROS, W, now);
        assert!(old.hourly);
        assert_eq!(old.step, HOUR_MICROS);
        assert!(old.start <= start && old.start % HOUR_MICROS == 0);
        assert!(old.end >= start + 2 * HOUR_MICROS && old.end % HOUR_MICROS == 0);
    }
}
