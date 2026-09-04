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

//! The streaming entry for fused aggregations: attempts the ordered shard streams over the
//! selector's contexts and falls back to the materializing fold on the same contexts.
//!
//! Reads `ctx`, `eval_ctx`, `label_selector`; writes `result_type` on success.

use std::{sync::Arc, time::Duration};

use config::meta::promql::value::*;
use datafusion::error::Result;
use futures::future::pending;
use infra::errors::ErrorCodes;
use promql_parser::{
    label::Matchers,
    parser::{LabelModifier, VectorSelector},
};

use super::{
    Engine,
    selector::{equal_matcher_filters, get_offset_modifier, named_selector, plain_selector},
};
use crate::{functions, fused, micros};

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
        let query_ctx = &self.ctx.query_ctx;
        // need_wal bails early: WAL would split series across contexts
        if !config::get_config()
            .search
            .feature_metrics_streaming_agg_enabled
            || query_ctx.query_exemplars
            || query_ctx.query_data
            || query_ctx.is_super_cluster
            || query_ctx.need_wal
            || matches!(modifier, Some(LabelModifier::Exclude(_)))
        {
            return Ok(None);
        }
        let selector = named_selector(plain_selector(vs, "MatrixSelector")?, "MatrixSelector")?;
        let table_name = selector.name.clone().unwrap();
        let timeout = query_ctx.timeout;

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
                label_selector,
                &mut filters,
            )
            .await?;
        // a second context would split series and evaluate rate windows on partial data
        if let [(ctx, schema, scan_stats, keep_filters)] = ctxs.as_slice() {
            let matchers = if *keep_filters {
                selector.matchers.clone()
            } else {
                Matchers::empty()
            };
            let run = fused::stream::fused_agg(
                ctx,
                schema,
                fused::stream::StreamingSelector {
                    table_name: &table_name,
                    matchers: &matchers,
                    offset,
                },
                fused::stream::FusedShape {
                    op,
                    func: func.clone(),
                    range,
                },
                modifier,
                &self.eval_ctx,
            );
            if let Some(value) = self.run_cancellable(run, timeout).await? {
                self.ctx.scan_stats.write().await.add(scan_stats);
                if self.result_type.is_none() {
                    self.result_type = Some("matrix".to_string());
                }
                return Ok(Some(value));
            }
        }

        // the layout cannot stream: materialize on the contexts already created
        let matrix = self
            .eval_matrix_selector(&selector, range, Some(ctxs))
            .await?;
        let input = if matrix.is_empty() {
            Value::None
        } else {
            Value::Matrix(matrix)
        };
        fused::matrix::fused_agg(modifier, input, func, op, &self.eval_ctx, timeout)
            .await
            .map(Some)
    }

    /// Runs the streaming fold under the query timeout and the host's cancel signal; dropping
    /// the future aborts the shard folds.
    async fn run_cancellable<T>(
        &self,
        run: impl Future<Output = Result<T>>,
        timeout: u64,
    ) -> Result<T> {
        let trace_id = &self.ctx.query_ctx.trace_id;
        let mut abort_receiver = self
            .ctx
            .table_provider
            .register_cancellation(trace_id)
            .await?;
        tokio::pin!(run);
        // a cancel or an expired budget wins over a fold that happens to be ready
        tokio::select! {
            biased;
            _ = async {
                match abort_receiver.as_mut() {
                    Some(receiver) => {
                        let _ = receiver.await;
                    }
                    None => pending::<()>().await,
                }
            } => {
                log::info!("[trace_id {trace_id}] [PromQL] streaming fused agg canceled");
                Err(ErrorCodes::SearchCancelQuery(
                    "[PromQL] streaming fused agg canceled".to_string(),
                )
                .into())
            }
            _ = tokio::time::sleep(Duration::from_secs(timeout)) => {
                log::error!("[trace_id {trace_id}] [PromQL] streaming fused agg timeout");
                Err(ErrorCodes::SearchTimeout(
                    "[PromQL] streaming fused agg timeout".to_string(),
                )
                .into())
            }
            ret = &mut run => ret,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use config::{
        TIMESTAMP_COL_NAME,
        meta::{
            promql::{HASH_LABEL, HASH_SORTED_TABLE_SUFFIX, VALUE_LABEL},
            search::ScanStats,
        },
    };
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, RecordBatch, UInt64Array},
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
        enable_streaming();
        let eval_ctx = EvalContext::new(
            BASE + 60 * SECOND,
            BASE + 180 * SECOND,
            60 * SECOND,
            "test_trace".into(),
        );
        let mut ctx = PromqlContext::new(
            create_test_query_ctx("test_trace", "test_org", timeout),
            provider,
            vec![],
        );
        ctx.start = eval_ctx.start;
        ctx.end = eval_ctx.end;
        Engine::new("test_trace", Arc::new(ctx), eval_ctx)
    }

    async fn eval_query(provider: StreamingProvider, timeout: u64, query: &str) -> Result<Value> {
        let mut engine = engine(provider, timeout);
        let expr = promql_parser::parser::parse(query).unwrap();
        engine.exec(&expr).await.map(|(value, _)| value)
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
        let data = engine.eval_vector_selector(&vs).await.unwrap();
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
