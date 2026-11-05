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

pub mod ip_cidr_contains;
pub mod ip_subnet;
pub mod is_ipv4;
pub mod is_ipv6;
pub mod is_private_ip;

use std::sync::Arc;

use datafusion::{
    arrow::{
        array::{Array, ArrayRef, AsArray, StringArrayType},
        datatypes::DataType,
    },
    common::{Result, ScalarValue, exec_err},
    logical_expr::ColumnarValue,
};

/// Applies `f` to every row of a string argument; a NULL row or a `None` from `f` gives NULL.
pub(super) fn eval_strings<T, B>(
    arg: &ColumnarValue,
    number_rows: usize,
    name: &str,
    f: impl FnMut(&str) -> Option<T>,
) -> Result<ColumnarValue>
where
    B: Array + FromIterator<Option<T>> + 'static,
{
    let array = arg.to_array(number_rows)?;
    let out: B = match array.data_type() {
        DataType::Utf8 => map_rows(array.as_string::<i32>(), f),
        DataType::LargeUtf8 => map_rows(array.as_string::<i64>(), f),
        DataType::Utf8View => map_rows(array.as_string_view(), f),
        other => return exec_err!("{name} expects a string argument, got {other}"),
    };
    Ok(ColumnarValue::Array(Arc::new(out) as ArrayRef))
}

/// Value of a constant string argument, or `None` when it is a NULL literal.
pub(super) fn constant_str<'a>(
    arg: &'a ColumnarValue,
    name: &str,
    param: &str,
) -> Result<Option<&'a str>> {
    match arg {
        ColumnarValue::Scalar(
            ScalarValue::Utf8(v) | ScalarValue::LargeUtf8(v) | ScalarValue::Utf8View(v),
        ) => Ok(v.as_deref()),
        _ => exec_err!("{name}: `{param}` must be a constant string"),
    }
}

/// Decimal prefix length without sign or spaces, at most `max`.
pub(super) fn parse_prefix_len(s: &str, max: u8) -> Option<u8> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse::<u8>().ok().filter(|len| *len <= max)
}

pub(super) fn v4_mask(len: u8) -> u32 {
    // A shift by the full width overflows, and /0 means no network bits.
    u32::MAX.checked_shl(32 - u32::from(len)).unwrap_or(0)
}

pub(super) fn v6_mask(len: u8) -> u128 {
    // A shift by the full width overflows, and /0 means no network bits.
    u128::MAX.checked_shl(128 - u32::from(len)).unwrap_or(0)
}

/// Runs `sql` with the IP UDFs registered and renders the first column, NULL as "NULL".
#[cfg(test)]
pub(super) async fn query_column(sql: &str) -> Result<Vec<String>> {
    use datafusion::{arrow::util::display::array_value_to_string, prelude::SessionContext};

    let ctx = SessionContext::new();
    ctx.register_udf(ip_cidr_contains::IP_CIDR_CONTAINS_UDF.clone());
    ctx.register_udf(ip_subnet::IP_SUBNET_UDF.clone());
    ctx.register_udf(is_ipv4::IS_IPV4_UDF.clone());
    ctx.register_udf(is_ipv6::IS_IPV6_UDF.clone());
    ctx.register_udf(is_private_ip::IS_PRIVATE_IP_UDF.clone());
    let mut out = Vec::new();
    for batch in ctx.sql(sql).await?.collect().await? {
        let column = batch.column(0);
        for row in 0..column.len() {
            out.push(if column.is_null(row) {
                "NULL".to_string()
            } else {
                array_value_to_string(column, row)?
            });
        }
    }
    Ok(out)
}

fn map_rows<'a, S, T, B>(array: S, mut f: impl FnMut(&str) -> Option<T>) -> B
where
    S: StringArrayType<'a>,
    B: FromIterator<Option<T>>,
{
    array.iter().map(|row| row.and_then(&mut f)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_len_accepts_plain_decimals_up_to_max() {
        for (input, max, expected) in [
            ("0", 32, Some(0)),
            ("32", 32, Some(32)),
            ("33", 32, None),
            ("128", 128, Some(128)),
            ("129", 128, None),
            ("", 32, None),
            ("+8", 32, None),
            (" 8", 32, None),
            ("8a", 32, None),
            ("300", 128, None),
        ] {
            assert_eq!(parse_prefix_len(input, max), expected, "input {input:?}");
        }
    }

    #[test]
    fn masks_cover_the_full_range() {
        assert_eq!(v4_mask(0), 0);
        assert_eq!(v4_mask(8), 0xff00_0000);
        assert_eq!(v4_mask(32), u32::MAX);
        assert_eq!(v6_mask(0), 0);
        assert_eq!(v6_mask(64), u128::MAX << 64);
        assert_eq!(v6_mask(128), u128::MAX);
    }
}
