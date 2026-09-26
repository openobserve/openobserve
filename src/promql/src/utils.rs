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

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{BUCKET_LABEL, HASH_LABEL, NAME_LABEL, VALUE_LABEL},
};
use datafusion::{
    arrow::datatypes::Schema,
    error::Result,
    logical_expr::utils::disjunction,
    prelude::{DataFrame, Expr, col, lit},
};
use hashbrown::HashSet;
pub use metrics_index::{matcher_predicates, matcher_residual_field};
use promql_parser::{
    label::{MatchOp, Matchers},
    parser::{Offset, VectorSelector},
};

use crate::micros;

const OPTIMIZATION_STEP_LOOKBACK_MULTIPLIER: i64 = 5;
const OPTIMIZATION_MAX_STEPS: i64 = 30;

/// The stream a selector reads from: the bare metric name, else an `__name__` equality matcher.
pub fn metric_name(selector: &VectorSelector) -> Option<String> {
    if let Some(name) = selector.name.as_ref() {
        return Some(name.clone());
    }
    // only `=` resolves to one stream; a regex or negated `__name__` names a set the engine
    // cannot read, so it must fail rather than authorize a stream no one has
    selector
        .matchers
        .find_matchers(NAME_LABEL)
        .into_iter()
        .find(|mat| matches!(mat.op, MatchOp::Equal))
        .map(|mat| mat.value)
}

pub fn apply_matchers(df: DataFrame, matchers: &Matchers) -> Result<DataFrame> {
    let predicates = matcher_predicates(df.schema().as_arrow(), matchers);
    let mut df = df;
    for predicate in predicates {
        df = df.filter(predicate)?;
    }
    Ok(df)
}

pub fn apply_label_selector(
    df: DataFrame,
    schema: &Schema,
    label_selector: &HashSet<String>,
) -> Option<DataFrame> {
    let mut df = df;
    if !label_selector.is_empty() {
        let schema_fields = schema
            .fields()
            .iter()
            .map(|f| f.name().as_str())
            .collect::<HashSet<_>>();
        let def_labels = [HASH_LABEL, VALUE_LABEL, BUCKET_LABEL, TIMESTAMP_COL_NAME]
            .into_iter()
            .filter(|label| !label_selector.contains(*label));
        // include only found columns and required _timestamp, hash, value, le cols
        let selected_cols: Vec<_> = label_selector
            .iter()
            .map(String::as_str)
            .chain(def_labels)
            .filter(|label| schema_fields.contains(label))
            .map(col)
            .collect();
        df = match df.select(selected_cols) {
            Ok(df) => df,
            Err(e) => {
                log::error!("Selecting cols error: {e}");
                return None;
            }
        };
    }
    Some(df)
}

/// Restricts `df` to the rows the evaluation can observe: per-step lookback
/// windows when the steps are sparse enough, the contiguous
/// `[start - lookback, end]` range otherwise.
pub(crate) fn apply_time_window(
    df: DataFrame,
    start: i64,
    end: i64,
    step: i64,
    lookback: i64,
) -> Result<DataFrame> {
    // Optimization: When step > lookback, we don't need to load all data in
    // [start-lookback, end] Instead, we only need to load data windows around
    // each evaluation point
    let use_optimization = start != end
        && step > 0
        && step >= lookback * OPTIMIZATION_STEP_LOOKBACK_MULTIPLIER
        && (((end - start) / step) + 1) < OPTIMIZATION_MAX_STEPS;
    if use_optimization {
        let num_steps = ((end - start) / step) + 1;
        let mut conditions: Vec<Expr> = Vec::new();
        for i in 0..num_steps {
            let eval_ts = start + (step * i);
            let window_start = eval_ts - lookback;
            let window_end = eval_ts;

            conditions.push(
                col(TIMESTAMP_COL_NAME)
                    .gt_eq(lit(window_start))
                    .and(col(TIMESTAMP_COL_NAME).lt_eq(lit(window_end))),
            );
        }

        let filters = disjunction(conditions).unwrap();
        df.filter(filters)
    } else {
        // Need to include lookback window before start for the first evaluation point
        let query_start = start - lookback;
        df.filter(
            col(TIMESTAMP_COL_NAME)
                .gt_eq(lit(query_start))
                .and(col(TIMESTAMP_COL_NAME).lt_eq(lit(end))),
        )
    }
}

/// Length of the contiguous run of equal hashes starting at `start`.
pub(crate) fn batch_run_len(hashes: &[u64], start: usize) -> usize {
    let hash = hashes[start];
    let mut end = start + 1;
    while end < hashes.len() && hashes[end] == hash {
        end += 1;
    }
    end - start
}

/// An `offset` in microseconds, positive into the past.
pub(crate) fn offset_micros(offset: &Option<Offset>) -> i64 {
    match offset {
        Some(Offset::Pos(offset)) => micros(*offset),
        Some(Offset::Neg(offset)) => -micros(*offset),
        None => 0,
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use datafusion::{
        arrow::{
            array::{Int32Array, StringArray, StringViewArray},
            datatypes::{DataType, Field, Schema as ArrowSchema},
            record_batch::RecordBatch,
        },
        prelude::SessionContext,
    };
    use hashbrown::HashSet;
    use promql_parser::label::Matchers;

    use super::*;

    #[test]
    fn test_batch_run_len() {
        let hashes = [7u64, 7, 7, 9, 9, 1];
        assert_eq!(batch_run_len(&hashes, 0), 3);
        assert_eq!(batch_run_len(&hashes, 3), 2);
        assert_eq!(batch_run_len(&hashes, 5), 1);
    }

    fn make_df() -> (DataFrame, ArrowSchema) {
        let schema = Arc::new(ArrowSchema::new(vec![Field::new(
            "a",
            DataType::Int32,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from(vec![1, 2, 3]))],
        )
        .unwrap();
        let ctx = SessionContext::new();
        let df = ctx.read_batch(batch).unwrap();
        (
            df,
            ArrowSchema::new(vec![Field::new("a", DataType::Int32, false)]),
        )
    }

    fn make_string_df() -> (DataFrame, ArrowSchema) {
        let schema = Arc::new(ArrowSchema::new(vec![Field::new(
            "service",
            DataType::Utf8,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec!["api", "worker", "api-v2"]))],
        )
        .unwrap();
        let ctx = SessionContext::new();
        let df = ctx.read_batch(batch).unwrap();
        (
            df,
            ArrowSchema::new(vec![Field::new("service", DataType::Utf8, false)]),
        )
    }

    fn make_string_view_df() -> (DataFrame, ArrowSchema) {
        let schema = Arc::new(ArrowSchema::new(vec![Field::new(
            "service",
            DataType::Utf8View,
            false,
        )]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![Arc::new(StringViewArray::from(vec![
                "api", "worker", "api-v2",
            ]))],
        )
        .unwrap();
        let ctx = SessionContext::new();
        let df = ctx.read_batch(batch).unwrap();
        (df, schema.as_ref().clone())
    }

    #[test]
    fn test_apply_matchers_empty_matchers_returns_ok() {
        let (df, _) = make_df();
        let matchers = Matchers::new(vec![]);
        let result = apply_matchers(df, &matchers);
        assert!(result.is_ok());
    }

    #[test]
    fn test_apply_label_selector_empty_set_returns_some() {
        let (df, schema) = make_df();
        let label_selector = HashSet::new();
        let result = apply_label_selector(df, &schema, &label_selector);
        assert!(result.is_some());
    }

    #[test]
    fn test_apply_label_selector_existing_field_returns_some() {
        let (df, schema) = make_df();
        let mut label_selector = HashSet::new();
        label_selector.insert("a".to_string());
        let result = apply_label_selector(df, &schema, &label_selector);
        assert!(result.is_some());
    }

    #[test]
    fn test_apply_label_selector_nonexistent_field_returns_some() {
        let (df, schema) = make_df();
        let mut label_selector = HashSet::new();
        label_selector.insert("no_such_col".to_string());
        let result = apply_label_selector(df, &schema, &label_selector);
        assert!(result.is_some());
    }

    #[test]
    fn test_apply_matchers_unknown_field_is_skipped() {
        let (df, _) = make_df();
        use promql_parser::label::{MatchOp, Matcher};
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Equal,
            name: "unknown_col".to_string(),
            value: "x".to_string(),
        }]);
        let result = apply_matchers(df, &matchers);
        assert!(result.is_ok());
    }

    #[test]
    fn test_apply_matchers_timestamp_col_is_skipped() {
        let (df, _) = make_df();
        use promql_parser::label::{MatchOp, Matcher};
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Equal,
            name: "_timestamp".to_string(),
            value: "12345".to_string(),
        }]);
        let result = apply_matchers(df, &matchers);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_apply_matchers_regex_uses_anchored_promql_semantics() {
        use promql_parser::label::Matcher;

        let (df, _) = make_string_df();
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Re(regex::Regex::new("api.*").unwrap()),
            name: "service".to_string(),
            value: "api.*".to_string(),
        }]);
        let batches = apply_matchers(df, &matchers)
            .unwrap()
            .collect()
            .await
            .unwrap();

        assert_eq!(
            batches.iter().map(|batch| batch.num_rows()).sum::<usize>(),
            2
        );
    }

    #[tokio::test]
    async fn test_apply_matchers_negative_regex() {
        use promql_parser::label::Matcher;

        let (df, _) = make_string_df();
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::NotRe(regex::Regex::new("api.*").unwrap()),
            name: "service".to_string(),
            value: "api.*".to_string(),
        }]);
        let batches = apply_matchers(df, &matchers)
            .unwrap()
            .collect()
            .await
            .unwrap();

        assert_eq!(
            batches.iter().map(|batch| batch.num_rows()).sum::<usize>(),
            1
        );
    }

    #[tokio::test]
    async fn test_apply_matchers_exact_regex_supports_utf8_view() {
        use promql_parser::label::Matcher;

        let (df, _) = make_string_view_df();
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Re(regex::Regex::new("api").unwrap()),
            name: "service".to_string(),
            value: "api".to_string(),
        }]);
        let batches = apply_matchers(df, &matchers)
            .unwrap()
            .collect()
            .await
            .unwrap();

        assert_eq!(
            batches.iter().map(|batch| batch.num_rows()).sum::<usize>(),
            1
        );
    }

    #[tokio::test]
    async fn test_apply_matchers_prefix_regex_supports_utf8_view() {
        use promql_parser::label::Matcher;

        let (df, _) = make_string_view_df();
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Re(regex::Regex::new("api.*").unwrap()),
            name: "service".to_string(),
            value: "api.*".to_string(),
        }]);
        let batches = apply_matchers(df, &matchers)
            .unwrap()
            .collect()
            .await
            .unwrap();

        assert_eq!(
            batches.iter().map(|batch| batch.num_rows()).sum::<usize>(),
            2
        );
    }

    #[tokio::test]
    async fn test_apply_matchers_equality_supports_utf8_view() {
        use promql_parser::label::Matcher;

        let (df, _) = make_string_view_df();
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Equal,
            name: "service".to_string(),
            value: "api".to_string(),
        }]);
        let batches = apply_matchers(df, &matchers)
            .unwrap()
            .collect()
            .await
            .unwrap();

        assert_eq!(
            batches.iter().map(|batch| batch.num_rows()).sum::<usize>(),
            1
        );
    }

    #[tokio::test]
    async fn test_apply_matchers_name_label_is_skipped() {
        use promql_parser::label::Matcher;

        // Rows ingested before `__name__` normalization keep the original
        // mixed-case metric name, while the selector carries the formatted
        // stream name; the matcher must not be applied as a column filter.
        let schema = Arc::new(ArrowSchema::new(vec![Field::new(
            NAME_LABEL,
            DataType::Utf8,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![
                "ClickHouseAsyncMetrics_CPUFrequencyMHz",
                "ClickHouseAsyncMetrics_CPUFrequencyMHz",
            ]))],
        )
        .unwrap();
        let ctx = SessionContext::new();
        let df = ctx.read_batch(batch).unwrap();

        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Equal,
            name: NAME_LABEL.to_string(),
            value: "clickhouseasyncmetrics_cpufrequencymhz".to_string(),
        }]);
        let batches = apply_matchers(df, &matchers)
            .unwrap()
            .collect()
            .await
            .unwrap();

        assert_eq!(
            batches.iter().map(|batch| batch.num_rows()).sum::<usize>(),
            2
        );
    }

    #[test]
    fn test_offset_micros() {
        assert_eq!(offset_micros(&None), 0);
        let past = Some(Offset::Pos(Duration::from_secs(60)));
        assert_eq!(offset_micros(&past), 60_000_000);
        let ahead = Some(Offset::Neg(Duration::from_secs(30)));
        assert_eq!(offset_micros(&ahead), -30_000_000);
    }
}
