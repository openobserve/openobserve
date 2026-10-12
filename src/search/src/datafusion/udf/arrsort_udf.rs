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

use std::{
    cmp::Ordering,
    sync::{Arc, LazyLock as Lazy},
};

use config::utils::json;
use datafusion::{
    arrow::{
        array::{ArrayRef, StringArray},
        datatypes::DataType,
    },
    common::cast::as_string_array,
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
    sql::sqlparser::parser::ParserError,
};

/// The name of the arrsort UDF given to DataFusion.
pub const ARR_SORT_UDF_NAME: &str = "arrsort";

/// Implementation of arrsort
pub static ARR_SORT_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        ARR_SORT_UDF_NAME,
        // expects one string - the array field
        vec![DataType::Utf8],
        // returns string
        DataType::Utf8,
        Volatility::Immutable,
        Arc::new(arr_sort_impl),
    )
});

/// Overflowed numbers rank beyond every finite value so the order stays transitive.
enum NumberOrderClass {
    NegOverflow(std::cmp::Reverse<String>),
    // Every i64 and u64 fits, so integers above 2^53 keep their exact order.
    Int(i128),
    // JSON numbers are never NaN, so the hand-written Ord via total_cmp is sound.
    Float(f64),
    PosOverflow(String),
}

impl PartialEq for NumberOrderClass {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for NumberOrderClass {}

impl Ord for NumberOrderClass {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (Self::NegOverflow(a), Self::NegOverflow(b)) => a.cmp(b),
            (Self::Int(a), Self::Int(b)) => a.cmp(b),
            (Self::Float(a), Self::Float(b)) => a.total_cmp(b),
            (Self::Int(a), Self::Float(b)) => int_float_cmp(*a, *b),
            (Self::Float(a), Self::Int(b)) => int_float_cmp(*b, *a).reverse(),
            (Self::PosOverflow(a), Self::PosOverflow(b)) => a.cmp(b),
            (Self::NegOverflow(_), _) => Ordering::Less,
            (_, Self::NegOverflow(_)) => Ordering::Greater,
            (Self::PosOverflow(_), _) => Ordering::Greater,
            (_, Self::PosOverflow(_)) => Ordering::Less,
        }
    }
}

impl PartialOrd for NumberOrderClass {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// arrsort function for datafusion
pub fn arr_sort_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    log::debug!("Inside arrsort");
    if args.len() != 1 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: arrsort(field)".to_string(),
            )),
            None,
        ));
    }
    let args = ColumnarValue::values_to_arrays(args)?;
    // log::debug!("Got the args: {:#?}", args);

    // 1. cast both arguments to be aligned with the signature
    let arr_field = as_string_array(&args[0])?;

    // 2. perform the computation
    let array = arr_field
        .iter()
        .map(|arr_field| {
            arr_field.and_then(|arr_field| {
                json::from_str::<json::Value>(arr_field)
                    .ok()
                    .and_then(|arr_field| {
                        if let json::Value::Array(mut field) = arr_field {
                            if field.is_empty() {
                                None
                            } else {
                                field.sort_by(json_total_cmp);
                                json::to_string(&field).ok()
                            }
                        } else {
                            None
                        }
                    })
            })
        })
        .collect::<StringArray>();

    // `Ok` because no error occurred during the calculation
    // `Arc` because arrays are immutable, thread-safe, trait objects.
    Ok(ColumnarValue::from(Arc::new(array) as ArrayRef))
}

/// Rank used to order values of different JSON types in [`json_total_cmp`].
fn type_rank(value: &json::Value) -> u8 {
    match value {
        json::Value::Null => 0,
        json::Value::Bool(_) => 1,
        json::Value::Number(_) => 2,
        json::Value::String(_) => 3,
        json::Value::Array(_) => 4,
        json::Value::Object(_) => 5,
    }
}

/// Total order over arbitrary JSON values, shared by `arrsort` and `arr_descending`.
pub(crate) fn json_total_cmp(a: &json::Value, b: &json::Value) -> Ordering {
    match (a, b) {
        (json::Value::Number(a), json::Value::Number(b)) => number_total_cmp(a, b),
        (json::Value::String(a), json::Value::String(b)) => a.cmp(b),
        (json::Value::Bool(a), json::Value::Bool(b)) => a.cmp(b),
        (json::Value::Null, json::Value::Null) => Ordering::Equal,
        _ => type_rank(a).cmp(&type_rank(b)),
    }
}

/// Numbers with no f64 form sort as signed infinity so mixed comparisons stay transitive.
fn number_total_cmp(a: &json::Number, b: &json::Number) -> Ordering {
    number_order_class(a).cmp(&number_order_class(b))
}

fn number_order_class(n: &json::Number) -> NumberOrderClass {
    if let Some(i) = n.as_i64() {
        return NumberOrderClass::Int(i.into());
    }
    if let Some(u) = n.as_u64() {
        return NumberOrderClass::Int(u.into());
    }
    match n.as_f64() {
        Some(f) => NumberOrderClass::Float(f),
        None => {
            let text = n.to_string();
            if text.starts_with('-') {
                NumberOrderClass::NegOverflow(std::cmp::Reverse(text))
            } else {
                NumberOrderClass::PosOverflow(text)
            }
        }
    }
}

/// Exact `i` vs `f`: round-to-nearest keeps any strict order, and a tie means `f` is integral.
fn int_float_cmp(i: i128, f: f64) -> Ordering {
    match (i as f64).total_cmp(&f) {
        Ordering::Equal => i.cmp(&(f as i128)),
        ord => ord,
    }
}

#[cfg(test)]
mod tests {
    use arrow::array::Array;
    use datafusion::{
        arrow::{
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        assert_batches_eq,
        datasource::MemTable,
        prelude::SessionContext,
    };

    use super::*;

    #[test]
    fn test_arr_sort_impl_integers_direct() {
        let input = StringArray::from(vec!["[3, 1, 4]"]);
        let args = [ColumnarValue::Array(Arc::new(input))];
        let result = arr_sort_impl(&args).unwrap();
        if let ColumnarValue::Array(out) = result {
            let out = out.as_any().downcast_ref::<StringArray>().unwrap();
            assert_eq!(out.value(0), "[1,3,4]");
        } else {
            panic!("expected array result");
        }
    }

    #[test]
    fn test_arr_sort_impl_wrong_arg_count_errors() {
        assert!(arr_sort_impl(&[]).is_err());
    }

    #[test]
    fn test_arr_sort_impl_invalid_json_returns_null() {
        let input = StringArray::from(vec!["not-json"]);
        let args = [ColumnarValue::Array(Arc::new(input))];
        let result = arr_sort_impl(&args).unwrap();
        if let ColumnarValue::Array(out) = result {
            let out = out.as_any().downcast_ref::<StringArray>().unwrap();
            assert!(out.is_null(0));
        } else {
            panic!("expected array result");
        }
    }

    // Helper function to run a single test case
    async fn run_single_test(arr_field: &str, expected_output: Vec<&str>) {
        let sql = "select arrsort(arr_field) as ret from t";
        let sqls = [(sql, expected_output)];

        let schema = Arc::new(Schema::new(vec![Field::new(
            "arr_field",
            DataType::Utf8,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![arr_field]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_SORT_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    // Helper function to run multiple test cases that should all return null
    async fn run_null_returning_tests(test_cases: &[&str]) {
        let expected_output = vec!["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        for &arr_field in test_cases {
            run_single_test(arr_field, expected_output.clone()).await;
        }
    }

    #[tokio::test]
    async fn test_arr_sort_valid_arrays() {
        let test_cases = [
            (
                r#"[true,false,true]"#,
                vec![
                    "+-------------------+",
                    "| ret               |",
                    "+-------------------+",
                    "| [false,true,true] |",
                    "+-------------------+",
                ],
            ),
            (
                r#"["hello2","hi2","bye2"]"#,
                vec![
                    "+-------------------------+",
                    "| ret                     |",
                    "+-------------------------+",
                    "| [\"bye2\",\"hello2\",\"hi2\"] |",
                    "+-------------------------+",
                ],
            ),
            (
                r#"[12, 345, 23, 45]"#,
                vec![
                    "+----------------+",
                    "| ret            |",
                    "+----------------+",
                    "| [12,23,45,345] |",
                    "+----------------+",
                ],
            ),
            (
                r#"[1.9, 34.5, 2.6, 4.5]"#,
                vec![
                    "+--------------------+",
                    "| ret                |",
                    "+--------------------+",
                    "| [1.9,2.6,4.5,34.5] |",
                    "+--------------------+",
                ],
            ),
            (
                r#"[3, 1, 4, 1, 5]"#,
                vec![
                    "+-------------+",
                    "| ret         |",
                    "+-------------+",
                    "| [1,1,3,4,5] |",
                    "+-------------+",
                ],
            ),
            (
                r#"["zebra", "apple", "banana"]"#,
                vec![
                    "+----------------------------+",
                    "| ret                        |",
                    "+----------------------------+",
                    "| [\"apple\",\"banana\",\"zebra\"] |",
                    "+----------------------------+",
                ],
            ),
        ];

        for (arr_field, expected_output) in test_cases {
            run_single_test(arr_field, expected_output).await;
        }
    }

    #[tokio::test]
    async fn test_arr_sort_null_returning_cases() {
        // Test cases that should return null
        let null_cases = [
            r#"not json"#,         // invalid JSON
            r#"{"key": "value"}"#, // object
            r#""just a string""#,  // string
            r#"42"#,               // number
            r#"true"#,             // boolean
            r#"null"#,             // null
        ];

        run_null_returning_tests(&null_cases).await;
    }

    #[tokio::test]
    async fn test_arr_sort_null_input() {
        let expected_output = ["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        let schema = Arc::new(Schema::new(vec![Field::new(
            "arr_field",
            DataType::Utf8,
            true,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![None::<String>]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_SORT_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "select arrsort(arr_field) as ret from t";
        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_sort_multiple_rows() {
        let arr_fields = vec![
            r#"[3, 1, 4]"#,
            r#"[]"#,
            r#"not json"#,
            r#"["b", "a", "c"]"#,
            r#"{"key": "value"}"#,
        ];
        let sql = "select arrsort(arr_field) as ret from t";
        let expected_output = [
            "+---------------+",
            "| ret           |",
            "+---------------+",
            "| [1,3,4]       |",
            "|               |",
            "|               |",
            "| [\"a\",\"b\",\"c\"] |",
            "|               |",
            "+---------------+",
        ];

        let schema = Arc::new(Schema::new(vec![Field::new(
            "arr_field",
            DataType::Utf8,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(arr_fields))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_SORT_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_sort_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_SORT_UDF.clone());

        // Test with no arguments
        let result = ctx.sql("select arrsort() as ret").await;
        assert!(result.is_err());

        // Test with multiple arguments
        let result = ctx.sql("select arrsort('a', 'b') as ret").await;
        assert!(result.is_err());
    }

    fn call_arr_sort(json_array: &str) -> String {
        let input = StringArray::from(vec![json_array]);
        let args = [ColumnarValue::Array(Arc::new(input))];
        let result = arr_sort_impl(&args).unwrap();
        match result {
            ColumnarValue::Array(out) => out
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap()
                .value(0)
                .to_string(),
            _ => panic!("expected array result"),
        }
    }

    #[test]
    fn test_arr_sort_mixed_number_and_string_does_not_panic() {
        call_arr_sort(r#"[1.5,"a"]"#);
    }

    #[test]
    fn test_arr_sort_float_and_int_does_not_panic() {
        call_arr_sort(r#"[2.5,1]"#);
    }

    #[test]
    fn test_arr_sort_negative_and_huge_unsigned_does_not_panic() {
        call_arr_sort(r#"[-1,18446744073709551615]"#);
    }

    #[test]
    fn test_arr_sort_null_mixed_with_strings_does_not_panic() {
        call_arr_sort(r#"[null,"a","b"]"#);
    }

    #[test]
    fn test_arr_sort_large_shuffled_mixed_type_array_does_not_panic() {
        use rand::prelude::SliceRandom;

        let mut values: Vec<json::Value> = Vec::with_capacity(200);
        for i in 0..200 {
            values.push(match i % 7 {
                0 => json::Value::from(i as i64),
                1 => json::Value::from(i as f64 + 0.5),
                2 => json::Value::from(format!("s{i}")),
                3 => json::Value::Bool(i % 2 == 0),
                4 => json::Value::Null,
                // arbitrary_precision numbers with no f64 representation, one per sign.
                5 => json::from_str::<json::Value>(&format!("{i}e400")).unwrap(),
                _ => json::from_str::<json::Value>(&format!("-{i}e400")).unwrap(),
            });
        }
        values.shuffle(&mut rand::rng());
        let json_array = json::to_string(&values).unwrap();
        call_arr_sort(&json_array);
    }

    fn parse_number(text: &str) -> json::Number {
        match json::from_str::<json::Value>(text).unwrap() {
            json::Value::Number(n) => n,
            other => panic!("expected a number, got {other:?}"),
        }
    }

    #[test]
    fn test_number_total_cmp_orders_overflow_against_finite_correctly() {
        let a = parse_number("100.0");
        let b = parse_number("1e400");
        let c = parse_number("50");

        assert_eq!(number_total_cmp(&a, &b), Ordering::Less, "100.0 < 1e400");
        assert_eq!(number_total_cmp(&b, &c), Ordering::Greater, "1e400 > 50");
        assert_eq!(number_total_cmp(&a, &c), Ordering::Greater, "100.0 > 50");
    }

    #[test]
    fn test_number_total_cmp_is_transitive_over_all_triples() {
        let texts = [
            "1e400",
            "-1e400",
            "100.0",
            "50",
            "-3",
            "2e300",
            "-2e300",
            "0",
            "-0.5",
            "0.5",
            "9007199254740992",
            "9007199254740993",
            "9007199254740992.0",
            "18446744073709551615",
            "18446744073709551616.0",
            "-1",
            "-9223372036854775808",
            "1727000000000000001",
            "1727000000000000002",
        ];
        let numbers: Vec<json::Number> = texts.iter().map(|t| parse_number(t)).collect();

        for a in &numbers {
            for b in &numbers {
                assert_eq!(
                    number_total_cmp(a, b),
                    number_total_cmp(b, a).reverse(),
                    "{a} vs {b} is not antisymmetric"
                );
                for c in &numbers {
                    let ab = number_total_cmp(a, b);
                    let bc = number_total_cmp(b, c);
                    let ac = number_total_cmp(a, c);
                    if ab != Ordering::Greater && bc != Ordering::Greater {
                        let want = if ab == Ordering::Equal {
                            bc
                        } else {
                            Ordering::Less
                        };
                        assert_eq!(ac, want, "{a} vs {b} is {ab:?}, {b} vs {c} is {bc:?}");
                    }
                }
            }
        }
    }

    #[test]
    fn test_arr_sort_orders_integers_above_2_pow_53_exactly() {
        assert_eq!(
            call_arr_sort("[1727000000000000002,1727000000000000001]"),
            "[1727000000000000001,1727000000000000002]"
        );
        assert_eq!(
            call_arr_sort("[9007199254740993,9007199254740992]"),
            "[9007199254740992,9007199254740993]"
        );
    }

    #[test]
    fn test_number_total_cmp_breaks_int_float_ties_exactly() {
        let cmp = |a: &str, b: &str| number_total_cmp(&parse_number(a), &parse_number(b));
        assert_eq!(
            cmp("9007199254740993", "9007199254740992.0"),
            Ordering::Greater
        );
        assert_eq!(
            cmp("9007199254740992", "9007199254740992.0"),
            Ordering::Equal
        );
        assert_eq!(
            cmp("18446744073709551615", "18446744073709551616.0"),
            Ordering::Less
        );
        assert_eq!(cmp("-1", "18446744073709551615"), Ordering::Less);
        assert_eq!(
            cmp("-9223372036854775808", "-9223372036854775807"),
            Ordering::Less
        );
        assert_eq!(cmp("2.5", "2"), Ordering::Greater);
    }

    #[test]
    fn test_arr_sort_with_overflow_numbers_is_deterministic_and_ordered() {
        let result = call_arr_sort(r#"[1e400,-1e400,100.0,50,2e300,-3]"#);
        assert_eq!(result, "[-1e+400,-3,50,100.0,2e+300,1e+400]");

        // Sorting again from a different input order must yield the same order (determinism).
        let result2 = call_arr_sort(r#"[50,-1e400,2e300,-3,1e400,100.0]"#);
        assert_eq!(result, result2);
    }
}
