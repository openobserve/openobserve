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

use std::sync::{Arc, LazyLock as Lazy};

use arrow_schema::{Field, FieldRef, Fields};
use datafusion::{
    arrow::{
        array::{
            Array, ArrayRef, BooleanArray, GenericStringBuilder, OffsetSizeTrait, StructArray,
            as_string_array,
        },
        datatypes::DataType,
    },
    common::cast::as_generic_string_array,
    error::{DataFusionError, Result},
    logical_expr::{
        ReturnFieldArgs, ScalarFunctionArgs, ScalarFunctionImplementation, ScalarUDF,
        ScalarUDFImpl, Signature, TypeSignature::Exact, Volatility,
    },
    physical_plan::ColumnarValue,
    prelude::create_udf,
    scalar::ScalarValue,
};

/// Implementation of regexp_match
pub static REGEX_MATCH_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        super::REGEX_MATCH_UDF_NAME,
        // takes two arguments: regex, pattern
        vec![DataType::Utf8, DataType::Utf8],
        DataType::Boolean,
        Volatility::Stable,
        regex_match_expr_impl(true),
    )
});

/// Implementation of regexp_not_match
pub static REGEX_NOT_MATCH_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        super::REGEX_NOT_MATCH_UDF_NAME,
        // takes two arguments: regex, pattern
        vec![DataType::Utf8, DataType::Utf8],
        DataType::Boolean,
        Volatility::Stable,
        regex_match_expr_impl(false),
    )
});

/// Implementation of regexp_match_to_fields
pub static REGEXP_MATCH_TO_FIELDS_UDF: Lazy<ScalarUDF> =
    Lazy::new(|| ScalarUDF::from(RegxpMatchToFields::new()));

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

/// A customized implementation of REGEXP_MATCH() that further process the results
/// from DataFusion regexp_match() function. Instead of returning all found matches
/// in a single column, this function unpack the found matches to match Named Capturing
/// Groups parsed from regex patterns from the second function arguments. If successful,
/// the function returns a key_value pair struct where keys are field names and values
/// are found field values.
///
/// The number of arguments and data types of arguments are implemented the same as
/// the native REGEXP_MATCH() function. They can be used the same way, but to get results
/// back in different formats.
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct RegxpMatchToFields {
    signature: Signature,
    aliases: Vec<String>,
}

impl RegxpMatchToFields {
    fn new() -> Self {
        Self {
            signature: Signature::one_of(
                vec![
                    Exact(vec![DataType::Utf8, DataType::Utf8]),
                    Exact(vec![DataType::LargeUtf8, DataType::Utf8]),
                    Exact(vec![DataType::Utf8, DataType::Utf8, DataType::Utf8]),
                    Exact(vec![DataType::LargeUtf8, DataType::Utf8, DataType::Utf8]),
                ],
                Volatility::Immutable,
            ),
            aliases: vec!["regexp_match_to_fields".to_string()],
        }
    }
}

impl ScalarUDFImpl for RegxpMatchToFields {
    fn name(&self) -> &str {
        "regexp_match_to_fields"
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        unreachable!() // since return_type_from_args is implemented
    }

    fn return_field_from_args(&self, args: ReturnFieldArgs) -> Result<FieldRef> {
        if args.arg_fields.len() != 2 {
            return Err(DataFusionError::Execution(
                "regexp_match_to_fields function requires 2 arguments, haystack & pattern, of strings".to_string()
            ));
        }
        let regexp_pattern = match &args.scalar_arguments[1] {
            Some(ScalarValue::Utf8(Some(arg2))) => arg2.clone(),
            _ => {
                return Err(DataFusionError::Execution(format!(
                    "The second argument for regexp_match_to_fields needs to be a string, but got {}",
                    args.arg_fields[1]
                )));
            }
        };
        let ret_type = &args.arg_fields[0];
        let fields = regex_pattern_to_fields(&regexp_pattern, ret_type.data_type())?;
        Ok(Arc::new(Field::new(
            "regexp_match_to_fields",
            DataType::Struct(Fields::from_iter(fields)),
            false,
        )))
    }

    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        let is_scalar = args
            .args
            .iter()
            .all(|arg| matches!(arg, ColumnarValue::Scalar(_)));
        let regexp_pattern = match &args.args[1] {
            ColumnarValue::Scalar(ScalarValue::Utf8(Some(pattern))) => pattern.clone(),
            _ => {
                return Err(DataFusionError::Execution(
                    "regexp_match_to_fields requires a non-null scalar string pattern".to_string(),
                ));
            }
        };
        let input = args.args[0].clone().into_array(1)?;
        let DataType::Struct(fields) = args.return_field.data_type() else {
            return Err(DataFusionError::Internal(
                "regexp_match_to_fields expected a struct return type".to_string(),
            ));
        };
        let regex = regex::Regex::new(&regexp_pattern)
            .map_err(|e| DataFusionError::Execution(format!("Invalid regex pattern: {e}")))?;
        let result = match input.data_type() {
            DataType::Utf8 => capture_fields::<i32>(&input, &regex, fields.clone())?,
            DataType::LargeUtf8 => capture_fields::<i64>(&input, &regex, fields.clone())?,
            other => {
                return Err(DataFusionError::Execution(format!(
                    "Unsupported data type {other:?} for function regexp_match_to_fields"
                )));
            }
        };
        if is_scalar {
            Ok(ColumnarValue::Scalar(ScalarValue::try_from_array(
                &result, 0,
            )?))
        } else {
            Ok(ColumnarValue::Array(Arc::new(result)))
        }
    }

    fn aliases(&self) -> &[String] {
        &self.aliases
    }
}

// Build one struct per input row. Looking up captures by name also preserves
// NULLs for optional groups and ignores unnamed groups without shifting fields.
fn capture_fields<T: OffsetSizeTrait>(
    input: &ArrayRef,
    regex: &regex::Regex,
    fields: Fields,
) -> Result<StructArray> {
    let input = as_generic_string_array::<T>(input)?;
    let mut builders: Vec<_> = fields
        .iter()
        .map(|_| GenericStringBuilder::<T>::new())
        .collect();
    for value in input.iter() {
        let captures = value.and_then(|value| regex.captures(value));
        for (field, builder) in fields.iter().zip(&mut builders) {
            builder.append_option(
                captures
                    .as_ref()
                    .and_then(|captures| captures.name(field.name()))
                    .map(|value| value.as_str()),
            );
        }
    }
    let columns = builders
        .iter_mut()
        .map(|builder| Arc::new(builder.finish()) as ArrayRef)
        .collect();
    Ok(StructArray::try_new(fields, columns, None)?)
}

/// Parse named groups and allow NULL for missing input or unmatched captures.
fn regex_pattern_to_fields(pattern: &str, ret_type: &DataType) -> Result<Vec<Field>> {
    let regex = regex::Regex::new(pattern)
        .map_err(|e| DataFusionError::Execution(format!("Invalid regex pattern: {e}")))?;
    let fields: Vec<_> = regex
        .capture_names()
        .flatten()
        .map(|name| Field::new(name, ret_type.clone(), true))
        .collect();
    if fields.is_empty() {
        Err(DataFusionError::Execution("Named Capturing Groups must be used to assign field names for regexp_match_to_fields function".to_string()))
    } else {
        Ok(fields)
    }
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::{
            array::{Int64Array, StringArray},
            datatypes::Schema,
            record_batch::RecordBatch,
        },
        assert_batches_eq,
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

    #[test]
    fn test_clean_non_meta_escapes_empty() {
        assert_eq!(clean_non_meta_escapes(""), "");
    }

    #[test]
    fn test_clean_non_meta_escapes_valid_escapes_unchanged() {
        // \d, \w, \s are valid — kept as-is
        assert_eq!(clean_non_meta_escapes(r"\d+"), r"\d+");
        assert_eq!(clean_non_meta_escapes(r"\w"), r"\w");
        assert_eq!(clean_non_meta_escapes(r"\s"), r"\s");
    }

    #[test]
    fn test_clean_non_meta_escapes_removes_invalid_backslash() {
        // \: is invalid in Rust regex — backslash stripped, : kept
        assert_eq!(clean_non_meta_escapes(r"\:"), ":");
        // \- is valid (- is meta in regex_syntax 0.8+) — kept as-is
        assert_eq!(clean_non_meta_escapes(r"\-"), r"\-");
    }

    #[test]
    fn test_clean_non_meta_escapes_no_backslash() {
        let s = "hello world";
        assert_eq!(clean_non_meta_escapes(s), s);
    }

    #[test]
    fn test_clean_non_meta_escapes_double_backslash_kept() {
        // \\ is a valid escape (literal backslash) — both chars kept
        assert_eq!(clean_non_meta_escapes(r"\\"), r"\\");
    }

    #[tokio::test]
    async fn test_regexp_match_to_fields_udf() {
        let log_line = r#"2024-02-29 00:15:30 15.128.22.213 GET /Administradores_Elina/service-worker.js - 443"#;

        let schema = Arc::new(Schema::new(vec![Field::new("log", DataType::Utf8, false)]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![log_line]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let my_udf = ScalarUDF::from(RegxpMatchToFields::new());
        ctx.register_udf(my_udf);

        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sqls = [
            (
                r#"select regexp_match_to_fields(log, '(?P<timestamp>[^\s]+ [^\s]+) (?P<client_ip>[^\s]+) (?P<http_method>[^\s]+) (?P<requested_path>[^\s]+) (?P<placeholder1>[^\s]+) (?P<server_port>[^\s]+)') as subquery from t"#,
                vec![
                    "+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+",
                    "| subquery                                                                                                                                                                  |",
                    "+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+",
                    "| {timestamp: 2024-02-29 00:15:30, client_ip: 15.128.22.213, http_method: GET, requested_path: /Administradores_Elina/service-worker.js, placeholder1: -, server_port: 443} |",
                    "+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+",
                ],
            ),
            (
                r#"select regexp_match_to_fields(log, '([^\s]+ [^\s]+) ([^\s]+) ([^\s]+)') as subquery from t"#,
                vec![],
            ),
        ];
        let test1 = ctx.sql(sqls[0].0).await.unwrap().collect().await.unwrap();
        assert_batches_eq!(sqls[0].1, &test1);

        let test2 = ctx.sql(sqls[1].0).await;
        assert!(test2.is_err());
    }

    #[test]
    fn test_regex_pattern_to_fields_with_named_groups() {
        let result =
            regex_pattern_to_fields(r"(?P<host>[^\s]+) (?P<method>[^\s]+)", &DataType::Utf8)
                .unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name(), "host");
        assert_eq!(result[1].name(), "method");
    }

    #[test]
    fn test_regex_pattern_to_fields_no_named_groups_errors() {
        let result = regex_pattern_to_fields(r"([^\s]+) ([^\s]+)", &DataType::Utf8);
        assert!(result.is_err());
    }

    #[test]
    fn test_regex_pattern_to_fields_empty_pattern_errors() {
        let result = regex_pattern_to_fields("", &DataType::Utf8);
        assert!(result.is_err());
    }
}
