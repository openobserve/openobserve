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

use arrow::{
    array::{Array, ArrayRef, StringBuilder, StringViewBuilder},
    datatypes::DataType,
};
use datafusion::{
    common::{
        Result,
        cast::{as_string_array, as_string_view_array},
    },
    error::DataFusionError,
    logical_expr::{
        ColumnarValue, ScalarFunctionArgs, ScalarUDF, ScalarUDFImpl, Signature, Volatility,
    },
    scalar::ScalarValue,
};

pub const FOLD_NATIVE_FRAMES_UDF_NAME: &str = "fold_native_frames";

/// Replaces every run of unsymbolized frames from one binary in a profile stack with `[binary]`.
pub static FOLD_NATIVE_FRAMES_UDF: Lazy<ScalarUDF> =
    Lazy::new(|| ScalarUDF::from(FoldNativeFramesUdf::new()));

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct FoldNativeFramesUdf {
    signature: Signature,
}

impl FoldNativeFramesUdf {
    fn new() -> Self {
        Self {
            signature: Signature::uniform(
                1,
                vec![DataType::Utf8, DataType::Utf8View],
                Volatility::Immutable,
            ),
        }
    }
}

impl ScalarUDFImpl for FoldNativeFramesUdf {
    fn name(&self) -> &str {
        FOLD_NATIVE_FRAMES_UDF_NAME
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, arg_types: &[DataType]) -> Result<DataType> {
        Ok(arg_types[0].clone())
    }

    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        match &args.args[0] {
            ColumnarValue::Array(array) => Ok(ColumnarValue::Array(fold_array(array)?)),
            ColumnarValue::Scalar(scalar) => {
                let folded = fold_array(&scalar.to_array_of_size(1)?)?;
                Ok(ColumnarValue::Scalar(ScalarValue::try_from_array(
                    &folded, 0,
                )?))
            }
        }
    }
}

fn fold_array(array: &ArrayRef) -> Result<ArrayRef> {
    let mut buf = String::new();
    match array.data_type() {
        DataType::Utf8 => {
            let input = as_string_array(array)?;
            let mut builder = StringBuilder::with_capacity(input.len(), input.value_data().len());
            for stack in input.iter() {
                builder.append_option(stack.map(|s| fold_stack(s, &mut buf)));
            }
            Ok(Arc::new(builder.finish()))
        }
        DataType::Utf8View => {
            let input = as_string_view_array(array)?;
            let mut builder = StringViewBuilder::with_capacity(input.len());
            for stack in input.iter() {
                builder.append_option(stack.map(|s| fold_stack(s, &mut buf)));
            }
            Ok(Arc::new(builder.finish()))
        }
        other => Err(DataFusionError::Execution(format!(
            "{FOLD_NATIVE_FRAMES_UDF_NAME} expects a string argument, got {other}"
        ))),
    }
}

fn fold_stack<'a>(stack: &'a str, buf: &'a mut String) -> &'a str {
    if !stack.contains("0x") {
        return stack;
    }
    buf.clear();
    let mut previous: Option<&str> = None;
    for frame in stack.split(';') {
        let binary = unsymbolized_binary(frame);
        if binary.is_some() && binary == previous {
            continue;
        }
        if !buf.is_empty() {
            buf.push(';');
        }
        match binary {
            Some(name) => {
                buf.push('[');
                buf.push_str(name);
                buf.push(']');
            }
            None => buf.push_str(frame),
        }
        previous = binary;
    }
    buf.as_str()
}

/// Binary of an ingested `[{file}@]{id}+0x{offset}[/{kind}]` or `0x{addr}` frame.
fn unsymbolized_binary(frame: &str) -> Option<&str> {
    let addressed = match frame.rsplit_once('/') {
        Some((head, kind)) if is_frame_kind(kind) => head,
        _ => frame,
    };
    let (mapping, offset) = match addressed.rsplit_once("+0x") {
        Some((mapping, offset)) if !mapping.is_empty() => (mapping, offset),
        Some(_) => return None,
        None => ("unknown", addressed.strip_prefix("0x")?),
    };
    if offset.is_empty() || !offset.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    // Build ids never contain '@', so the last one ends the file name.
    Some(mapping.rsplit_once('@').map_or(mapping, |(file, _)| file))
}

fn is_frame_kind(kind: &str) -> bool {
    !kind.is_empty()
        && kind
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use arrow::array::{StringArray, StringViewArray};
    use datafusion::common::config::ConfigOptions;

    use super::*;

    fn fold(stack: &str) -> String {
        fold_stack(stack, &mut String::new()).to_string()
    }

    #[test]
    fn folds_runs_of_one_binary_and_keeps_symbolized_frames() {
        assert_eq!(
            fold(
                "main;libc.so.6@aa11+0x1a/native;libc.so.6@aa11+0x2b/native;handler;libssl.so+0x99"
            ),
            "main;[libc.so.6];handler;[libssl.so]"
        );
    }

    #[test]
    fn same_binary_with_another_build_id_folds_to_one_name() {
        assert_eq!(
            fold("app@b1+0x10;app@b2+0x20/native"),
            fold("app@b9+0x30/native")
        );
    }

    #[test]
    fn build_id_only_and_bare_addresses() {
        assert_eq!(
            fold("deadbeef+0x10/native;0xff;0xfe/kernel;run"),
            "[deadbeef];[unknown];run"
        );
    }

    #[test]
    fn separated_runs_of_one_binary_stay_separate() {
        assert_eq!(
            fold("libc.so.6+0x1;cb;libc.so.6+0x2"),
            "[libc.so.6];cb;[libc.so.6]"
        );
    }

    #[test]
    fn leaves_symbol_names_that_only_look_like_addresses() {
        for stack in ["github.com/x/y.Run;main.main", "parse_0x;+0x10", "fmt+0xzz"] {
            assert_eq!(fold(stack), stack);
        }
    }

    #[test]
    fn invokes_on_utf8_and_utf8_view() {
        let udf = FoldNativeFramesUdf::new();
        let cases: Vec<ArrayRef> = vec![
            Arc::new(StringArray::from(vec![
                Some("a;lib.so+0x1;lib.so+0x2"),
                None,
            ])),
            Arc::new(StringViewArray::from(vec![
                Some("a;lib.so+0x1;lib.so+0x2"),
                None,
            ])),
        ];
        for input in cases {
            let data_type = input.data_type().clone();
            let args = ScalarFunctionArgs {
                args: vec![ColumnarValue::Array(input)],
                arg_fields: vec![Arc::new(arrow::datatypes::Field::new(
                    "stack",
                    data_type.clone(),
                    true,
                ))],
                number_rows: 2,
                return_field: Arc::new(arrow::datatypes::Field::new(
                    "stack",
                    data_type.clone(),
                    true,
                )),
                config_options: Arc::new(ConfigOptions::default()),
            };
            let ColumnarValue::Array(out) = udf.invoke_with_args(args).unwrap() else {
                panic!("expected an array");
            };
            assert_eq!(out.data_type(), &data_type);
            assert_eq!(
                ScalarValue::try_from_array(&out, 0).unwrap().to_string(),
                "a;[lib.so]"
            );
            assert!(out.is_null(1));
        }
    }
}
