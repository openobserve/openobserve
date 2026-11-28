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

use datafusion::{
    arrow::{compute::can_cast_types, datatypes::DataType},
    common::{Result, ScalarValue, plan_err},
};

/// Rebinds each `ArrayRef` ident to the concrete array of `$data_type`, then evaluates `$body`
/// once per string type, so `$body` can call a function generic over `StringArrayType`.
macro_rules! with_string_arrays {
    ($data_type:expr, [$($array:ident),+ $(,)?], $body:expr) => {{
        use ::datafusion::arrow::{array::AsArray as _, datatypes::DataType};
        match $data_type {
            DataType::Utf8 => {
                $(let $array = $array.as_string::<i32>();)+
                $body
            }
            DataType::LargeUtf8 => {
                $(let $array = $array.as_string::<i64>();)+
                $body
            }
            DataType::Utf8View => {
                $(let $array = $array.as_string_view();)+
                $body
            }
            other => ::datafusion::common::exec_err!("expected a string array, got {other}"),
        }
    }};
}

pub(crate) use with_string_arrays;

/// Keeps each string argument's own type and converts any other to Utf8, so no column is cast
/// to match another argument's string type.
pub fn coerce_string_params(
    name: &str,
    count: usize,
    arg_types: &[DataType],
) -> Result<Vec<DataType>> {
    if arg_types.len() != count {
        return plan_err!("{name} expects {count} arguments, got {}", arg_types.len());
    }
    arg_types
        .iter()
        .map(|data_type| match data_type {
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => Ok(data_type.clone()),
            _ if can_cast_types(data_type, &DataType::Utf8) => Ok(DataType::Utf8),
            _ => plan_err!("{name} cannot take an argument of type {data_type}"),
        })
        .collect()
}

/// Value of a string scalar of any string type; `None` for NULL or a non-string scalar.
pub fn scalar_str(value: &ScalarValue) -> Option<&str> {
    match value {
        ScalarValue::Utf8(v) | ScalarValue::LargeUtf8(v) | ScalarValue::Utf8View(v) => v.as_deref(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::arrow::array::{
        ArrayRef, Int64Array, LargeStringArray, StringArray, StringArrayType, StringViewArray,
    };

    use super::*;

    fn arrays() -> Vec<ArrayRef> {
        let rows = [Some("a"), None, Some("long enough to be out of line")];
        vec![
            Arc::new(StringArray::from_iter(rows)),
            Arc::new(LargeStringArray::from_iter(rows)),
            Arc::new(StringViewArray::from_iter(rows)),
        ]
    }

    fn collect<'a, S: StringArrayType<'a>>(array: S) -> Vec<Option<String>> {
        array.iter().map(|v| v.map(str::to_string)).collect()
    }

    fn dispatch(array: &ArrayRef) -> Result<Vec<Option<String>>> {
        with_string_arrays!(array.data_type(), [array], Ok(collect(array)))
    }

    #[test]
    fn dispatch_reads_every_string_type_in_place() {
        for array in arrays() {
            assert_eq!(
                dispatch(&array).unwrap(),
                vec![
                    Some("a".to_string()),
                    None,
                    Some("long enough to be out of line".to_string())
                ],
                "{}",
                array.data_type()
            );
        }
        let array: ArrayRef = Arc::new(Int64Array::from(vec![1]));
        assert!(dispatch(&array).is_err());
    }

    #[test]
    fn coerce_string_params_keeps_each_string_type() {
        use DataType::*;
        let coerce = |types: &[DataType]| coerce_string_params("f", 2, types);
        assert_eq!(coerce(&[Utf8, Utf8View]).unwrap(), [Utf8, Utf8View]);
        assert_eq!(coerce(&[LargeUtf8, Null]).unwrap(), [LargeUtf8, Utf8]);
        assert_eq!(coerce(&[Int64, Utf8View]).unwrap(), [Utf8, Utf8View]);
        assert!(coerce(&[Utf8]).is_err());
    }
}
