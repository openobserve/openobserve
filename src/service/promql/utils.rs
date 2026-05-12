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
    meta::promql::{BUCKET_LABEL, HASH_LABEL, VALUE_LABEL},
};
use datafusion::{
    arrow::datatypes::Schema,
    error::Result,
    prelude::{DataFrame, col, lit},
};
use hashbrown::HashSet;
use promql_parser::label::{MatchOp, Matchers};

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::{
        arrow::{
            array::Int32Array,
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

    #[test]
    fn test_apply_matchers_empty_matchers_returns_ok() {
        let (df, schema) = make_df();
        let matchers = Matchers::new(vec![]);
        let result = apply_matchers(df, &schema, &matchers);
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
        let (df, schema) = make_df();
        use promql_parser::label::{MatchOp, Matcher};
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Equal,
            name: "unknown_col".to_string(),
            value: "x".to_string(),
        }]);
        let result = apply_matchers(df, &schema, &matchers);
        assert!(result.is_ok());
    }

    #[test]
    fn test_apply_matchers_timestamp_col_is_skipped() {
        let (df, schema) = make_df();
        use promql_parser::label::{MatchOp, Matcher};
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::Equal,
            name: "_timestamp".to_string(),
            value: "12345".to_string(),
        }]);
        let result = apply_matchers(df, &schema, &matchers);
        assert!(result.is_ok());
    }
}

use crate::service::search::datafusion::udf::regexp_udf::{REGEX_MATCH_UDF, REGEX_NOT_MATCH_UDF};

pub fn apply_matchers(df: DataFrame, schema: &Schema, matchers: &Matchers) -> Result<DataFrame> {
    let mut df = df;
    for mat in matchers.matchers.iter() {
        if mat.name == TIMESTAMP_COL_NAME
            || mat.name == VALUE_LABEL
            || schema.field_with_name(&mat.name).is_err()
        {
            continue;
        }
        match &mat.op {
            MatchOp::Equal => df = df.filter(col(mat.name.clone()).eq(lit(mat.value.clone())))?,
            MatchOp::NotEqual => {
                df = df.filter(col(mat.name.clone()).not_eq(lit(mat.value.clone())))?
            }
            MatchOp::Re(regex) => {
                let regexp_match_udf = REGEX_MATCH_UDF.clone();
                let regex = format!("^{}$", regex.as_str());
                df = df.filter(regexp_match_udf.call(vec![col(mat.name.clone()), lit(regex)]))?
            }
            MatchOp::NotRe(regex) => {
                let regexp_not_match_udf = REGEX_NOT_MATCH_UDF.clone();
                let regex = format!("^{}$", regex.as_str());
                df =
                    df.filter(regexp_not_match_udf.call(vec![col(mat.name.clone()), lit(regex)]))?
            }
        }
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
