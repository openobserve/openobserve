// Copyright 2023 Zinc Labs Inc.
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

use std::sync::Arc;

use datafusion::{
    arrow::{
        array::{as_string_array, ArrayRef, BooleanArray},
        datatypes::DataType,
    },
    error::DataFusionError,
    logical_expr::{ScalarFunctionImplementation, ScalarUDF, Volatility},
    physical_plan::ColumnarValue,
    prelude::create_udf,
    scalar::ScalarValue,
};
use once_cell::sync::Lazy;

/// Implementation of regexp_match
pub(crate) static REGEX_MATCH_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        super::REGEX_MATCH_UDF_NAME,
        // takes two arguments: regex, pattern
        vec![DataType::Utf8, DataType::Utf8],
        Arc::new(DataType::Boolean),
        Volatility::Stable,
        regex_match_expr_impl(true),
    )
});

/// Implementation of regexp_not_match
pub(crate) static REGEX_NOT_MATCH_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        super::REGEX_NOT_MATCH_UDF_NAME,
        // takes two arguments: regex, pattern
        vec![DataType::Utf8, DataType::Utf8],
        Arc::new(DataType::Boolean),
        Volatility::Stable,
        regex_match_expr_impl(false),
    )
});

/// Given a column containing string values and a single regex pattern,
/// `regex_match_expr` determines which values satisfy the pattern and which do
/// not.
///
/// If `matches` is true then this expression will filter values that do not
/// satisfy the regex (equivalent to `col ~= /pattern/`). If `matches` is
/// `false` then the expression will filter values that *do* match the regex,
/// which is equivalent to `col !~ /pattern/`.
///
/// This UDF is designed to support the regex operator that can be pushed down
/// via the InfluxRPC API.
pub fn regex_match_expr_impl(matches: bool) -> ScalarFunctionImplementation {
    // N.B., this function does not utilise the Arrow regexp compute
    // kernel because in order to act as a filter it needs to return a
    // boolean array of comparison results, not an array of strings as
    // the regex compute kernel does and it needs to implement the
    // regexp syntax for influxrpc.

    let func = move |args: &[ColumnarValue]| {
        assert_eq!(args.len(), 2); // only works over a single column and pattern at a time.

        let pattern = match &args[1] {
            // second arg was array (not constant)
            ColumnarValue::Array(_) => {
                return Err(DataFusionError::NotImplemented(format!(
                    "regex_match({matches}) with non scalar patterns not yet implemented"
                )));
            }
            ColumnarValue::Scalar(ScalarValue::Utf8(pattern)) => pattern,
            ColumnarValue::Scalar(arg) => {
                return Err(DataFusionError::Plan(format!(
                    "Expected string pattern to regex_match({matches}), got: {arg:?}"
                )));
            }
        };

        let pattern = pattern.as_ref().ok_or_else(|| {
            DataFusionError::NotImplemented(
                "NULL patterns not supported in regex_match".to_string(),
            )
        })?;

        // Attempt to make the pattern compatible with what is accepted by
        // the golang regexp library which is different than Rust's regexp
        let pattern = clean_non_meta_escapes(pattern);

        let pattern = regex::Regex::new(&pattern)
            .map_err(|e| DataFusionError::Plan(format!("error compiling regex pattern: {e}")))?;

        match &args[0] {
            ColumnarValue::Array(arr) => {
                let results = as_string_array(arr)
                    .iter()
                    .map(|row| {
                        // in arrow, any value can be null.
                        // Here we decide to make our UDF to return null when either base or
                        // exponent is null.
                        row.map(|v| pattern.is_match(v) == matches)
                    })
                    .collect::<BooleanArray>();

                Ok(ColumnarValue::Array(Arc::new(results) as ArrayRef))
            }
            ColumnarValue::Scalar(ScalarValue::Utf8(row)) => {
                let res = row.as_ref().map(|v| pattern.is_match(v) == matches);
                Ok(ColumnarValue::Scalar(ScalarValue::Boolean(res)))
            }
            ColumnarValue::Scalar(v) => Err(DataFusionError::Plan(format!(
                "regex_match({matches}) expected first argument to be utf8, got ('{v}')"
            ))),
        }
    };

    Arc::new(func)
}

fn is_valid_character_after_escape(c: char) -> bool {
    // same list as https://docs.rs/regex-syntax/0.6.25/src/regex_syntax/ast/parse.rs.html#1445-1538
    match c {
        '0'..='7' => true,
        '8'..='9' => true,
        'x' | 'u' | 'U' => true,
        'p' | 'P' => true,
        'd' | 's' | 'w' | 'D' | 'S' | 'W' => true,
        _ => regex_syntax::is_meta_character(c),
    }
}

/// Removes all `/` patterns that the rust regex library would reject
/// and rewrites them to their unescaped form.
///
/// For example, `\:` is rewritten to `:` as `\:` is not a valid
/// escape sequence in the `regexp` crate but is valid in golang's
/// regexp implementation.
///
/// This is done for compatibility purposes so that the regular
/// expression matching in Rust more closely follows the matching in
/// golang, used by the influx storage rpc.
///
/// See <https://github.com/rust-lang/regex/issues/501> for more details
fn clean_non_meta_escapes(pattern: &str) -> String {
    if pattern.is_empty() {
        return pattern.to_string();
    }

    #[derive(Clone, Copy, Debug)]
    enum SlashState {
        No,
        Single,
        Double,
    }

    let mut next_state = SlashState::No;

    let next_chars = pattern
        .chars()
        .map(Some)
        .skip(1)
        .chain(std::iter::once(None));

    // emit char based on previous
    let new_pattern: String = pattern
        .chars()
        .zip(next_chars)
        .filter_map(|(c, next_char)| {
            let cur_state = next_state;
            next_state = match (c, cur_state) {
                ('\\', SlashState::No) => SlashState::Single,
                ('\\', SlashState::Single) => SlashState::Double,
                ('\\', SlashState::Double) => SlashState::Single,
                _ => SlashState::No,
            };

            // Decide to emit `c` or not
            match (cur_state, c, next_char) {
                (SlashState::No, '\\', Some(next_char))
                | (SlashState::Double, '\\', Some(next_char))
                    if !is_valid_character_after_escape(next_char) =>
                {
                    None
                }
                _ => Some(c),
            }
        })
        .collect();

    new_pattern
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::{
        arrow::{
            array::{Int64Array, StringArray},
            datatypes::{DataType, Field, Schema},
            record_batch::RecordBatch,
        },
        datasource::MemTable,
        prelude::SessionContext,
    };

    use super::*;

    #[tokio::test]
    async fn test_regex_udf() {
        let sql = "select * from t where re_match(log, '(err|panic)') and re_not_match(data_center, '(SF|Beijing)')";
        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("id", DataType::Int64, false),
            Field::new("data_center", DataType::Utf8, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![
                    "2010-03-14 - err",
                    "2014-10-14, panic",
                    "c",
                    "d",
                ])),
                Arc::new(Int64Array::from(vec![1, 2, 3, 4])),
                Arc::new(StringArray::from(vec!["NY", "Pune", "SF", "Beijing"])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark
        // SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(REGEX_MATCH_UDF.clone());
        ctx.register_udf(REGEX_NOT_MATCH_UDF.clone());

        // declare a table in memory. In spark API, this corresponds to
        // createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let result = df.collect().await.unwrap();
        let count = result.iter().map(|batch| batch.num_rows()).sum::<usize>();
        assert_eq!(count, 2);
    }

    #[test]
    fn parse_escape() {
        assert!(is_valid_character_after_escape('0'));
        assert!(is_valid_character_after_escape('8'));
        assert!(is_valid_character_after_escape('x'));
        assert!(is_valid_character_after_escape('p'));
        assert!(is_valid_character_after_escape('d'));
        assert!(!is_valid_character_after_escape('a'));
    }
}
