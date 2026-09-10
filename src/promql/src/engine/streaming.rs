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

use std::{sync::Arc, time::Duration};

use config::meta::promql::value::*;
use datafusion::{arrow::datatypes::Schema, error::Result, prelude::SessionContext};
use futures::future::pending;
use infra::errors::ErrorCodes;
use promql_parser::{
    label::Matchers,
    parser::{LabelModifier, VectorSelector},
};

use super::{
    Engine,
    selector::{
        SelectorContexts, equal_matcher_filters, get_offset_modifier, named_selector,
        plain_selector,
    },
};
use crate::{
    functions, fused, micros,
    series_stream::merge::{MergeSeriesStream, StreamingSelector, series_label_columns},
};

/// What scanning a selector takes: the normalized selector, its offset and label set, the
/// matchers the scan still applies, and the contexts created for it.
struct SelectorScan {
    selector: VectorSelector,
    /// The matchers the scan still applies; an exact index selection already applied them.
    scan_matchers: Matchers,
    offset: i64,
    label_selector: hashbrown::HashSet<String>,
    ctxs: SelectorContexts,
}

impl Engine {
    /// Streams the fused aggregation when the layout allows it, otherwise materializes on the
    /// same contexts; `None` only when the query shape rules the streaming path out up front.
    pub(super) async fn try_streaming_fused_agg(
        &mut self,
        vs: &VectorSelector,
        range: Duration,
        modifier: &Option<LabelModifier>,
        func: Arc<dyn functions::RangeFunc>,
        op: fused::FusedAggOp,
    ) -> Result<Option<Value>> {
        if matches!(modifier, Some(LabelModifier::Exclude(_))) {
            return Ok(None);
        }
        let Some(scan) = self.selector_scan(vs, range, "MatrixSelector").await? else {
            return Ok(None);
        };
        let shape = fused::stream::FusedShape {
            op,
            func: func.clone(),
            range,
        };
        let streamed = self
            .stream_scan_guarded(&scan, |ctx, schema| {
                fused::stream::fused_agg(
                    ctx,
                    schema,
                    scan.streaming_selector(),
                    shape,
                    modifier,
                    &self.eval_ctx,
                )
            })
            .await?;
        if let Some(value) = streamed {
            if self.result_type.is_none() {
                self.result_type = Some("matrix".to_string());
            }
            return Ok(Some(value));
        }

        // the layout cannot stream: materialize on the contexts already created
        let matrix = self
            .eval_matrix_selector(&scan.selector, range, Some(scan.ctxs))
            .await?;
        self.fused_agg_matrix(modifier, Value::Matrix(matrix), func, op)
            .await
            .map(Some)
    }

    /// Streams `range_func(selector[range])` series by series, and otherwise evaluates it
    /// generically on the same contexts; `None` only when the query shape rules the streaming
    /// path out up front.
    pub(super) async fn try_streaming_range_func(
        &mut self,
        vs: &VectorSelector,
        range: Duration,
        func: Arc<dyn functions::RangeFunc>,
    ) -> Result<Option<Value>> {
        let Some(scan) = self.selector_scan(vs, range, "MatrixSelector").await? else {
            return Ok(None);
        };
        if let Some((series, scanned)) = self.stream_range_func(&scan, func.clone(), range).await? {
            if self.result_type.is_none() {
                self.result_type = Some("matrix".to_string());
            }
            // the generic path evaluates an empty selector to None, not to an empty matrix
            return Ok(Some(match scanned {
                0 => Value::None,
                _ => Value::Matrix(series),
            }));
        }

        // the layout cannot stream: evaluate the generic function on the contexts already created
        let matrix = self
            .eval_matrix_selector(&scan.selector, range, Some(scan.ctxs))
            .await?;
        let input = if matrix.is_empty() {
            Value::None
        } else {
            Value::Matrix(matrix)
        };
        functions::eval_range(input, func, &self.eval_ctx).map(Some)
    }

    pub(super) async fn try_streaming_instant_selector(
        &mut self,
        vs: &VectorSelector,
    ) -> Result<Option<Vec<RangeValue>>> {
        let lookback = self.ctx.lookback();
        let Some(scan) = self.selector_scan(vs, lookback, "VectorSelector").await? else {
            return Ok(None);
        };
        let func = functions::instant_lookback_func();
        if let Some((mut series, _)) = self.stream_range_func(&scan, func, lookback).await? {
            if self.result_type.is_none() {
                self.result_type = Some("vector".to_string());
            }
            // an instant vector carries no window: the lookback is the query's, not the selector's
            series
                .iter_mut()
                .for_each(|series| series.time_window = None);
            return Ok(Some(series));
        }

        // the layout cannot stream: select on the contexts already created
        self.eval_vector_selector(&scan.selector, Some(scan.ctxs))
            .await
            .map(Some)
    }

    async fn stream_range_func(
        &self,
        scan: &SelectorScan,
        func: Arc<dyn functions::RangeFunc>,
        range: Duration,
    ) -> Result<Option<(Vec<RangeValue>, usize)>> {
        self.stream_scan_guarded(scan, |ctx, schema| async move {
            let label_cols = if self.skip_labels {
                vec![]
            } else {
                series_label_columns(schema, &scan.label_selector, func.name())
            };
            let eval = Arc::new(fused::RangeExpr::new(func, range, &self.eval_ctx));
            match MergeSeriesStream::execute_partitioned(
                ctx,
                schema,
                &scan.streaming_selector(),
                label_cols,
                micros(range),
                &self.eval_ctx,
            )
            .await?
            {
                None => Ok(None),
                Some(sources) => fused::eval_range(sources, eval).await.map(Some),
            }
        })
        .await
    }

    /// Runs `run` on the scan's single context under timeout and cancel, then accounts its stats.
    async fn stream_scan_guarded<'s, T, Fut>(
        &'s self,
        scan: &'s SelectorScan,
        run: impl FnOnce(&'s SessionContext, &'s Schema) -> Fut,
    ) -> Result<Option<T>>
    where
        Fut: Future<Output = Result<Option<T>>>,
    {
        // a second context would split series and evaluate windows on partial data
        let [(ctx, schema, scan_stats, _)] = scan.ctxs.as_slice() else {
            return Ok(None);
        };
        let trace_id = &self.ctx.query_ctx.trace_id;
        let mut abort_receiver = self
            .ctx
            .table_provider
            .register_cancellation(trace_id)
            .await?;
        let run = run(ctx, schema);
        tokio::pin!(run);
        // a cancel or an expired budget wins over a fold that happens to be ready and aborts it
        let result = tokio::select! {
            biased;
            _ = async {
                match abort_receiver.as_mut() {
                    Some(receiver) => {
                        let _ = receiver.await;
                    }
                    None => pending::<()>().await,
                }
            } => {
                log::info!("[trace_id {trace_id}] [PromQL] streaming query canceled");
                Err(ErrorCodes::SearchCancelQuery(
                    "[PromQL] streaming query canceled".to_string(),
                )
                .into())
            }
            _ = tokio::time::sleep(Duration::from_secs(self.ctx.query_ctx.timeout)) => {
                log::error!("[trace_id {trace_id}] [PromQL] streaming query timeout");
                Err(ErrorCodes::SearchTimeout(
                    "[PromQL] streaming query timeout".to_string(),
                )
                .into())
            }
            ret = &mut run => ret,
        };
        let Some(result) = result? else {
            return Ok(None);
        };
        self.ctx.scan_stats.write().await.add(scan_stats);
        Ok(Some(result))
    }

    /// Normalizes the selector and creates its contexts; `None` when a query-level gate rules
    /// the streaming path out before any context exists.
    async fn selector_scan(
        &mut self,
        vs: &VectorSelector,
        range: Duration,
        kind: &str,
    ) -> Result<Option<SelectorScan>> {
        let query_ctx = &self.ctx.query_ctx;
        // need_wal bails early: WAL would split series across contexts
        if !config::get_config()
            .search
            .feature_metrics_streaming_agg_enabled
            || query_ctx.query_exemplars
            || query_ctx.query_data
            || query_ctx.is_super_cluster
            || query_ctx.need_wal
        {
            return Ok(None);
        }
        let selector = named_selector(plain_selector(vs, kind)?, kind)?;
        let table_name = selector.name.clone().unwrap();

        let offset = get_offset_modifier(selector.offset.clone());
        let start = self.ctx.start - micros(range) - offset;
        let end = self.ctx.end - offset;
        let mut filters = equal_matcher_filters(&selector.matchers);
        let mut label_selector = self.label_selector.clone();
        label_selector.extend(self.ctx.label_selector.iter().cloned());

        let ctxs = self
            .ctx
            .table_provider
            .create_context(
                &query_ctx.org_id,
                &table_name,
                (start, end),
                selector.matchers.clone(),
                label_selector.clone(),
                &mut filters,
            )
            .await?;
        let scan_matchers = match ctxs.as_slice() {
            [(_, _, _, false)] => Matchers::empty(),
            _ => selector.matchers.clone(),
        };
        Ok(Some(SelectorScan {
            selector,
            scan_matchers,
            offset,
            label_selector,
            ctxs,
        }))
    }
}

impl SelectorScan {
    fn streaming_selector(&self) -> StreamingSelector<'_> {
        StreamingSelector {
            table_name: self.selector.name.as_deref().unwrap_or_default(),
            matchers: &self.scan_matchers,
            offset: self.offset,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use config::{
        TIMESTAMP_COL_NAME,
        meta::{
            promql::{HASH_LABEL, HASH_SORTED_TABLE_SUFFIX, NAME_LABEL, VALUE_LABEL},
            search::ScanStats,
        },
    };
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
            datatypes::{DataType, Field, Schema},
        },
        datasource::MemTable,
        prelude::{SessionConfig, SessionContext, col},
    };
    use hashbrown::HashSet;
    use tokio::sync::oneshot;

    use super::*;
    use crate::{engine::tests::*, exec::PromqlContext};

    const SECOND: i64 = 1_000_000;
    const BASE: i64 = 1_000 * SECOND;

    /// Serves one hash-sorted context and can hand out an already-fired cancel signal.
    struct StreamingProvider {
        ctx: SessionContext,
        calls: Arc<AtomicUsize>,
        canceled: bool,
        // a dropped sender reads as a cancel, so a live registration keeps it
        cancel: std::sync::Mutex<Option<oneshot::Sender<()>>>,
    }

    #[async_trait::async_trait]
    impl crate::TableProvider for StreamingProvider {
        async fn create_context(
            &self,
            _org_id: &str,
            _stream_name: &str,
            _time_range: (i64, i64),
            _matchers: Matchers,
            _label_selector: HashSet<String>,
            _filters: &mut [(String, Vec<String>)],
        ) -> Result<Vec<(SessionContext, Arc<Schema>, ScanStats, bool)>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![(
                self.ctx.clone(),
                metrics_schema(),
                ScanStats::default(),
                true,
            )])
        }

        async fn register_cancellation(
            &self,
            _trace_id: &str,
        ) -> Result<Option<oneshot::Receiver<()>>> {
            let (sender, receiver) = oneshot::channel();
            if self.canceled {
                let _ = sender.send(());
            } else {
                *self.cancel.lock().unwrap() = Some(sender);
            }
            Ok(Some(receiver))
        }
    }

    fn metrics_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
            Field::new("instance", DataType::Utf8, true),
            Field::new(NAME_LABEL, DataType::Utf8, true),
        ]))
    }

    /// Two counters sampled every 20 s; the hash-sorted table exists only when `streams`.
    fn provider(streams: bool, canceled: bool) -> StreamingProvider {
        let rows: Vec<(i64, u64, f64)> = [7u64, u64::MAX / 2]
            .into_iter()
            .flat_map(|hash| {
                (0..10).map(move |step| (BASE + step * 20 * SECOND, hash, (step * 3) as f64))
            })
            .collect();
        let batch = RecordBatch::try_new(
            metrics_schema(),
            vec![
                Arc::new(Int64Array::from_iter_values(rows.iter().map(|row| row.0))),
                Arc::new(UInt64Array::from_iter_values(rows.iter().map(|row| row.1))),
                Arc::new(Float64Array::from_iter_values(rows.iter().map(|row| row.2))),
                Arc::new(StringArray::from_iter_values(
                    rows.iter().map(|row| if row.1 == 7 { "a" } else { "b" }),
                )),
                Arc::new(StringArray::from_iter_values(rows.iter().map(|_| "m"))),
            ],
        )
        .unwrap();
        let table = || MemTable::try_new(metrics_schema(), vec![vec![batch.clone()]]).unwrap();
        let mut config = SessionConfig::new().with_target_partitions(3);
        config.options_mut().optimizer.prefer_existing_sort = true;
        let ctx = SessionContext::new_with_config(config);
        ctx.register_table("m", Arc::new(table())).unwrap();
        if streams {
            let sorted = table().with_sort_order(vec![vec![
                col(HASH_LABEL).sort(true, false),
                col(TIMESTAMP_COL_NAME).sort(true, false),
            ]]);
            ctx.register_table(format!("m{HASH_SORTED_TABLE_SUFFIX}"), Arc::new(sorted))
                .unwrap();
        }
        StreamingProvider {
            ctx,
            calls: Default::default(),
            canceled,
            cancel: Default::default(),
        }
    }

    /// Pins the flag on so a local env override cannot turn the streaming path off.
    fn enable_streaming() {
        static ENABLE: std::sync::Once = std::sync::Once::new();
        ENABLE.call_once(|| {
            unsafe { std::env::set_var("ZO_FEATURE_METRICS_STREAMING_AGG_ENABLED", "true") };
            config::refresh_config().expect("config refresh");
        });
    }

    fn engine(provider: StreamingProvider, timeout: u64) -> Engine {
        engine_at(provider, timeout, BASE + 60 * SECOND, 60 * SECOND, None)
    }

    /// Steps from `start` to `BASE + 180 s`; `lookback` overrides the 5 min default.
    fn engine_at(
        provider: StreamingProvider,
        timeout: u64,
        start: i64,
        step: i64,
        lookback: Option<i64>,
    ) -> Engine {
        enable_streaming();
        let eval_ctx = EvalContext::new(start, BASE + 180 * SECOND, step, "test_trace".into());
        let mut ctx = PromqlContext::new(
            create_test_query_ctx("test_trace", "test_org", timeout),
            provider,
            vec![],
        );
        ctx.start = eval_ctx.start;
        ctx.end = eval_ctx.end;
        if let Some(lookback) = lookback {
            ctx.lookback_delta = lookback;
        }
        Engine::new("test_trace", Arc::new(ctx), eval_ctx)
    }

    async fn exec_query(
        provider: StreamingProvider,
        timeout: u64,
        query: &str,
    ) -> Result<(Value, Option<String>)> {
        let mut engine = engine(provider, timeout);
        let expr = promql_parser::parser::parse(query).unwrap();
        engine.exec(&expr).await
    }

    async fn eval_query(provider: StreamingProvider, timeout: u64, query: &str) -> Result<Value> {
        exec_query(provider, timeout, query)
            .await
            .map(|(value, _)| value)
    }

    /// The generic instant path on its own: `eval_vector_selector` over the plain table.
    async fn generic_instant_selector(provider: StreamingProvider, selector: &str) -> Value {
        generic_instant_selector_on(engine(provider, 30), selector).await
    }

    async fn generic_instant_selector_on(mut engine: Engine, selector: &str) -> Value {
        let promql_parser::parser::Expr::VectorSelector(vs) =
            promql_parser::parser::parse(selector).unwrap()
        else {
            panic!("{selector} is not a vector selector");
        };
        Value::Matrix(engine.eval_vector_selector(&vs, None).await.unwrap())
    }

    async fn eval_sum_rate(provider: StreamingProvider, timeout: u64) -> Result<Value> {
        eval_query(provider, timeout, "sum(rate(m[1m]))").await
    }

    /// The generic instant path: `eval_vector_selector` then the plain aggregation.
    async fn generic_instant_agg(
        provider: StreamingProvider,
        selector: &str,
        modifier: &Option<LabelModifier>,
        agg: fn(&Option<LabelModifier>, Value, &EvalContext) -> Result<Value>,
    ) -> Value {
        let mut engine = engine(provider, 30);
        let promql_parser::parser::Expr::VectorSelector(vs) =
            promql_parser::parser::parse(selector).unwrap()
        else {
            panic!("{selector} is not a vector selector");
        };
        let data = engine.eval_vector_selector(&vs, None).await.unwrap();
        let eval_ctx = engine.eval_ctx.clone();
        agg(modifier, Value::Matrix(data), &eval_ctx).unwrap()
    }

    /// (sorted labels, (timestamp, value)) per series, sorted by labels.
    type CanonicalSeries = (Vec<(String, String)>, Vec<(i64, f64)>);

    fn canonical(value: Value) -> Vec<CanonicalSeries> {
        let Value::Matrix(matrix) = value else {
            panic!("expected a matrix, got {}", value.get_type());
        };
        let mut series: Vec<_> = matrix
            .into_iter()
            .map(|series| {
                let mut labels: Vec<_> = series
                    .labels
                    .iter()
                    .map(|label| (label.name.clone(), label.value.clone()))
                    .collect();
                labels.sort();
                let samples = series
                    .samples
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value))
                    .collect();
                (labels, samples)
            })
            .collect();
        series.sort_by(|a, b| a.0.cmp(&b.0));
        series
    }

    fn assert_same_matrix(expected: Value, actual: Value, context: &str) {
        let (expected, actual) = (canonical(expected), canonical(actual));
        assert_eq!(expected.len(), actual.len(), "{context}: series count");
        for (expected, actual) in expected.iter().zip(&actual) {
            assert_eq!(expected.0, actual.0, "{context}: labels");
            assert_eq!(expected.1.len(), actual.1.len(), "{context}: sample count");
            for ((ts_e, v_e), (ts_a, v_a)) in expected.1.iter().zip(&actual.1) {
                assert_eq!(ts_e, ts_a, "{context}: timestamp");
                assert!(
                    (v_e - v_a).abs() <= 1e-9,
                    "{context}: {v_e} vs {v_a} at {ts_e}"
                );
            }
        }
    }

    #[tokio::test]
    async fn test_streaming_run_stops_on_cancel() {
        let err = eval_sum_rate(provider(true, true), 30).await.unwrap_err();
        assert!(matches!(
            infra::errors::Error::from(err),
            infra::errors::Error::ErrorCode(ErrorCodes::SearchCancelQuery(_))
        ));
    }

    #[tokio::test]
    async fn test_streaming_run_stops_on_timeout() {
        let err = eval_sum_rate(provider(true, false), 0).await.unwrap_err();
        assert!(matches!(
            infra::errors::Error::from(err),
            infra::errors::Error::ErrorCode(ErrorCodes::SearchTimeout(_))
        ));
    }

    /// `agg(m)` streams as `agg(last_over_time(m[lookback]))` and must match the generic
    /// instant path, both when it streams and when it materializes on the same context.
    #[tokio::test]
    async fn test_instant_agg_matches_generic_streaming_and_materialized() {
        type Agg = fn(&Option<LabelModifier>, Value, &EvalContext) -> Result<Value>;
        let cases: [(&str, &str, Agg); 4] = [
            ("sum(m)", "m", crate::aggregations::sum),
            ("count(m)", "m", crate::aggregations::count),
            (
                "avg(m offset 30s)",
                "m offset 30s",
                crate::aggregations::avg,
            ),
            (
                "max(m offset 30s)",
                "m offset 30s",
                crate::aggregations::max,
            ),
        ];
        for (query, selector, agg) in cases {
            let expected = generic_instant_agg(provider(false, false), selector, &None, agg).await;
            let streamed = eval_query(provider(true, false), 30, query).await.unwrap();
            assert_same_matrix(expected.clone(), streamed, &format!("streamed {query}"));
            let materialized = eval_query(provider(false, false), 30, query).await.unwrap();
            assert_same_matrix(expected, materialized, &format!("materialized {query}"));
        }
    }

    /// The generic range path: `eval_matrix_selector` then `eval_range`.
    async fn generic_range_func(provider: StreamingProvider, query: &str) -> Value {
        let mut engine = engine(provider, 30);
        let promql_parser::parser::Expr::Call(call) = promql_parser::parser::parse(query).unwrap()
        else {
            panic!("{query} is not a call");
        };
        let promql_parser::parser::Expr::MatrixSelector(promql_parser::parser::MatrixSelector {
            vs,
            range,
        }) = call.args.args[0].as_ref()
        else {
            panic!("{query} is not over a matrix selector");
        };
        let matrix = engine.eval_matrix_selector(vs, *range, None).await.unwrap();
        let input = if matrix.is_empty() {
            Value::None
        } else {
            Value::Matrix(matrix)
        };
        let func = functions::fusable_range_func(call.func.name).unwrap();
        functions::eval_range(input, func, &engine.eval_ctx).unwrap()
    }

    /// A bare range function streams each series whole and must match the generic path, both
    /// when it streams and when it falls back on the same context.
    #[tokio::test]
    async fn test_range_func_matches_generic_streaming_and_materialized() {
        for query in [
            "rate(m[1m])",
            "increase(m[1m] offset 30s)",
            "last_over_time(m[40s])",
            "count_over_time(m{instance=\"a\"}[1m])",
        ] {
            let expected = generic_range_func(provider(false, false), query).await;
            let streamed = eval_query(provider(true, false), 30, query).await.unwrap();
            assert_same_matrix(expected.clone(), streamed, &format!("streamed {query}"));
            let materialized = eval_query(provider(false, false), 30, query).await.unwrap();
            assert_same_matrix(expected, materialized, &format!("materialized {query}"));
        }
    }

    #[tokio::test]
    async fn test_range_func_keeps_the_series_labels() {
        let value = eval_query(provider(true, false), 30, "rate(m[1m])")
            .await
            .unwrap();
        let mut instances: Vec<Vec<(String, String)>> = canonical(value)
            .into_iter()
            .map(|(labels, _)| labels)
            .collect();
        instances.sort();
        assert_eq!(
            instances,
            vec![
                vec![("instance".to_string(), "a".to_string())],
                vec![("instance".to_string(), "b".to_string())],
            ]
        );
    }

    #[tokio::test]
    async fn test_range_func_takes_the_streaming_path() {
        let err = eval_query(provider(true, true), 30, "rate(m[1m])")
            .await
            .unwrap_err();
        assert!(matches!(
            infra::errors::Error::from(err),
            infra::errors::Error::ErrorCode(ErrorCodes::SearchCancelQuery(_))
        ));
    }

    #[tokio::test]
    async fn test_instant_agg_takes_the_streaming_path() {
        let err = eval_query(provider(true, true), 30, "sum(m)")
            .await
            .unwrap_err();
        assert!(matches!(
            infra::errors::Error::from(err),
            infra::errors::Error::ErrorCode(ErrorCodes::SearchCancelQuery(_))
        ));
    }

    #[tokio::test]
    async fn test_instant_selector_matches_generic_streaming_and_materialized() {
        for selector in ["m", "m offset 30s", "m{instance=\"a\"}"] {
            let expected = generic_instant_selector(provider(false, false), selector).await;
            let (streamed, result_type) = exec_query(provider(true, false), 30, selector)
                .await
                .unwrap();
            assert_eq!(
                result_type.as_deref(),
                Some("vector"),
                "streamed {selector}"
            );
            let Value::Matrix(matrix) = &streamed else {
                panic!("expected a matrix, got {}", streamed.get_type());
            };
            assert!(
                matrix.iter().all(|series| series.time_window.is_none()),
                "streamed {selector}: an instant vector carries no window"
            );
            assert_same_matrix(expected.clone(), streamed, &format!("streamed {selector}"));
            let (materialized, result_type) = exec_query(provider(false, false), 30, selector)
                .await
                .unwrap();
            assert_eq!(
                result_type.as_deref(),
                Some("vector"),
                "materialized {selector}"
            );
            assert_same_matrix(expected, materialized, &format!("materialized {selector}"));
        }
    }

    #[tokio::test]
    async fn test_instant_selector_keeps_the_metric_name() {
        let value = eval_query(provider(true, false), 30, "m").await.unwrap();
        let mut labels: Vec<Vec<(String, String)>> = canonical(value)
            .into_iter()
            .map(|(labels, _)| labels)
            .collect();
        labels.sort();
        let name = (NAME_LABEL.to_string(), "m".to_string());
        assert_eq!(
            labels,
            vec![
                vec![name.clone(), ("instance".to_string(), "a".to_string())],
                vec![name, ("instance".to_string(), "b".to_string())],
            ]
        );
    }

    /// With a 10 s lookback over 20 s samples the steps hit the lower bound, miss, then the upper.
    #[tokio::test]
    async fn test_instant_selector_window_bounds_match_generic() {
        let (start, step, lookback) = (BASE + 70 * SECOND, 45 * SECOND, Some(10 * SECOND));
        for selector in ["m", "m offset -20s", "m{instance=\"a\"}"] {
            let generic = engine_at(provider(false, false), 30, start, step, lookback);
            let expected = generic_instant_selector_on(generic, selector).await;
            let mut streaming = engine_at(provider(true, false), 30, start, step, lookback);
            let expr = promql_parser::parser::parse(selector).unwrap();
            let (streamed, _) = streaming.exec(&expr).await.unwrap();
            assert_same_matrix(expected, streamed, selector);
        }
        let mut streaming = engine_at(provider(true, false), 30, start, step, lookback);
        let expr = promql_parser::parser::parse("m{instance=\"a\"}").unwrap();
        let (value, _) = streaming.exec(&expr).await.unwrap();
        let series = canonical(value);
        assert_eq!(series.len(), 1);
        assert_eq!(
            series[0].1,
            vec![(BASE + 70 * SECOND, 9.0), (BASE + 160 * SECOND, 24.0)],
            "the sample at 60 s is on the lower bound of [60 s, 70 s], 115 s sees none, 160 s is its own"
        );
    }

    #[tokio::test]
    async fn test_instant_selector_with_no_matching_series_is_none() {
        let value = eval_query(provider(true, false), 30, "m{instance=\"zzz\"}")
            .await
            .unwrap();
        assert!(matches!(value, Value::None), "got {}", value.get_type());
    }

    #[tokio::test]
    async fn test_instant_selector_without_a_metric_name_names_the_vector_selector() {
        let err = eval_query(provider(true, false), 30, "{instance=\"a\"}")
            .await
            .unwrap_err();
        assert!(
            err.to_string()
                .contains("VectorSelector: metric name is required"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn test_instant_selector_takes_the_streaming_path() {
        let err = eval_query(provider(true, true), 30, "m").await.unwrap_err();
        assert!(matches!(
            infra::errors::Error::from(err),
            infra::errors::Error::ErrorCode(ErrorCodes::SearchCancelQuery(_))
        ));
    }

    #[tokio::test]
    async fn test_instant_selector_selects_on_the_streaming_context_without_sorted_table() {
        let provider = provider(false, false);
        let calls = provider.calls.clone();

        let value = eval_query(provider, 30, "m").await.unwrap();
        let Value::Matrix(matrix) = value else {
            panic!("expected a matrix, got {}", value.get_type());
        };
        assert_eq!(matrix.len(), 2, "one series per instance");
        assert!(matrix.iter().all(|series| series.samples.len() == 3));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "the selecting fallback must reuse the context the streaming attempt created"
        );
    }

    #[tokio::test]
    async fn test_materializes_on_the_streaming_context_without_sorted_table() {
        let provider = provider(false, false);
        let calls = provider.calls.clone();

        let value = eval_sum_rate(provider, 30).await.unwrap();
        let Value::Matrix(matrix) = value else {
            panic!("expected a matrix, got {}", value.get_type());
        };
        assert_eq!(matrix.len(), 1, "sum() folds both series into one");
        assert_eq!(matrix[0].samples.len(), 3, "one sample per evaluation step");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "the materializing fallback must reuse the context the streaming attempt created"
        );
    }
}
