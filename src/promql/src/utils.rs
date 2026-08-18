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

use std::ops::Not;

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{BUCKET_LABEL, HASH_LABEL, VALUE_LABEL},
};
use datafusion::{
    arrow::datatypes::{DataType, Schema},
    common::ScalarValue,
    error::Result,
    functions::regex::regexp_like,
    logical_expr::expr_fn::cast,
    prelude::{DataFrame, Expr, col, lit},
};
use hashbrown::HashSet;
use promql_parser::label::{MatchOp, Matchers};

/// Build the DataFusion predicates used for PromQL label matchers.
///
/// Keeping predicate construction separate lets storage-side secondary
/// indexes evaluate exactly the same matcher semantics as the final scan.
pub fn matcher_predicates(schema: &Schema, matchers: &Matchers) -> Vec<Expr> {
    let mut predicates = Vec::new();
    for mat in matchers.matchers.iter() {
        if mat.name == TIMESTAMP_COL_NAME || mat.name == VALUE_LABEL {
            continue;
        }
        let Ok(field) = schema.field_with_name(&mat.name) else {
            continue;
        };
        let field_type = field.data_type().clone();
        let literal = |value: String| -> Expr {
            match &field_type {
                // Explicitly type equality matcher literals to the label column;
                // an untyped literal would become Utf8View == Utf8 at execution.
                DataType::Utf8View => lit(ScalarValue::Utf8View(Some(value))),
                DataType::LargeUtf8 => lit(ScalarValue::LargeUtf8(Some(value))),
                _ => lit(value),
            }
        };
        let predicate = match &mat.op {
            MatchOp::Equal => col(mat.name.clone()).eq(literal(mat.value.clone())),
            MatchOp::NotEqual => col(mat.name.clone()).not_eq(literal(mat.value.clone())),
            MatchOp::Re(regex) => {
                let regex = format!("^{}$", regex.as_str());
                // DataFusion 54 can lower a regex on Utf8View to a mixed-type
                // equality/LIKE expression. Cast only regex matchers until that
                // optimizer bug is fixed; equality matchers stay zero-copy views.
                let value = if field_type == DataType::Utf8View {
                    cast(col(mat.name.clone()), DataType::Utf8)
                } else {
                    col(mat.name.clone())
                };
                regexp_like().call(vec![value, lit(regex)])
            }
            MatchOp::NotRe(regex) => {
                let regex = format!("^{}$", regex.as_str());
                let value = if field_type == DataType::Utf8View {
                    cast(col(mat.name.clone()), DataType::Utf8)
                } else {
                    col(mat.name.clone())
                };
                regexp_like().call(vec![value, lit(regex)]).not()
            }
        };
        predicates.push(predicate);
    }
    predicates
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
            .map(|f| f.name())
            .collect::<HashSet<_>>();
        let mut def_labels = vec![
            HASH_LABEL.to_string(),
            VALUE_LABEL.to_string(),
            BUCKET_LABEL.to_string(),
            TIMESTAMP_COL_NAME.to_string(),
        ];
        for label in label_selector.iter() {
            if def_labels.contains(label) {
                def_labels.retain(|x| x != label);
            }
        }
        // include only found columns and required _timestamp, hash, value, le cols
        let selected_cols: Vec<_> = label_selector
            .iter()
            .chain(def_labels.iter())
            .filter_map(|label| {
                if schema_fields.contains(label) {
                    Some(col(label))
                } else {
                    None
                }
            })
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

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
}
