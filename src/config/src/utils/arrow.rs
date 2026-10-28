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

use arrow::{
    array::{
        Array, AsArray, BooleanArray, GenericStringArray, Int64Array, RecordBatch, StringViewArray,
        UInt64Array,
    },
    datatypes::{DataType, FieldRef, Int64Type, UInt64Type},
    error::ArrowError,
};
use arrow_json::writer::{EncoderOptions, NullableEncoder, make_encoder};

use super::json::{self, Map as JsonMap, Value};

/// A result column, read directly when its JSON value needs no encoding.
struct JsonColumn<'a> {
    name: &'a str,
    encoder: NullableEncoder<'a>,
    direct: DirectValue<'a>,
}

impl<'a> JsonColumn<'a> {
    fn try_new(
        field: &'a FieldRef,
        array: &'a dyn Array,
        options: &'a EncoderOptions,
    ) -> Result<Self, ArrowError> {
        let direct = match array.data_type() {
            DataType::Utf8 => DirectValue::Utf8(array.as_string::<i32>()),
            DataType::LargeUtf8 => DirectValue::LargeUtf8(array.as_string::<i64>()),
            DataType::Utf8View => DirectValue::Utf8View(array.as_string_view()),
            DataType::Boolean => DirectValue::Boolean(array.as_boolean()),
            DataType::Int64 => DirectValue::Int64(array.as_primitive::<Int64Type>()),
            DataType::UInt64 => DirectValue::UInt64(array.as_primitive::<UInt64Type>()),
            DataType::Float16 | DataType::Float32 | DataType::Float64 => DirectValue::Float,
            _ => DirectValue::Encoded,
        };
        Ok(Self {
            name: field.name(),
            encoder: make_encoder(field, array, options)?,
            direct,
        })
    }

    fn value(&mut self, idx: usize, buf: &mut Vec<u8>) -> Result<Value, anyhow::Error> {
        Ok(match self.direct {
            DirectValue::Utf8(array) => Value::String(array.value(idx).to_string()),
            DirectValue::LargeUtf8(array) => Value::String(array.value(idx).to_string()),
            DirectValue::Utf8View(array) => Value::String(array.value(idx).to_string()),
            DirectValue::Boolean(array) => Value::Bool(array.value(idx)),
            DirectValue::Int64(array) => Value::from(array.value(idx)),
            DirectValue::UInt64(array) => Value::from(array.value(idx)),
            DirectValue::Float | DirectValue::Encoded => {
                buf.clear();
                self.encoder.encode(idx, buf);
                // skips from_slice's second number parse; NaN and infinity arrive as null
                if matches!(self.direct, DirectValue::Float) && buf != b"null" {
                    Value::Number(std::str::from_utf8(buf)?.parse()?)
                } else {
                    json::from_slice(buf)?
                }
            }
        })
    }
}

enum DirectValue<'a> {
    Utf8(&'a GenericStringArray<i32>),
    LargeUtf8(&'a GenericStringArray<i64>),
    Utf8View(&'a StringViewArray),
    Boolean(&'a BooleanArray),
    Int64(&'a Int64Array),
    UInt64(&'a UInt64Array),
    Float,
    Encoded,
}

/// Converts arrow [`RecordBatch`]es into the JSON objects `arrow_json::ArrayWriter` writes.
pub fn record_batches_to_json_rows(
    batches: &[&RecordBatch],
) -> Result<Vec<JsonMap<String, Value>>, anyhow::Error> {
    let mut rows = Vec::with_capacity(batches.iter().map(|b| b.num_rows()).sum());
    for batch in batches {
        append_json_rows(batch, &mut rows)?;
    }
    Ok(rows)
}

fn append_json_rows(
    batch: &RecordBatch,
    rows: &mut Vec<JsonMap<String, Value>>,
) -> Result<(), anyhow::Error> {
    let options = EncoderOptions::default();
    let schema = batch.schema();
    let mut columns = schema
        .fields()
        .iter()
        .zip(batch.columns())
        .map(|(field, array)| JsonColumn::try_new(field, array.as_ref(), &options))
        .collect::<Result<Vec<_>, _>>()?;
    let mut buf = Vec::new();
    for idx in 0..batch.num_rows() {
        // sized by the non-null cells: wide sparse rows would otherwise hold slots for every column
        let len = columns.iter().filter(|c| !c.encoder.is_null(idx)).count();
        let mut row = JsonMap::with_capacity(len);
        for column in &mut columns {
            // the writer leaves SQL NULL out of the object, it never writes an explicit null
            if column.encoder.is_null(idx) {
                continue;
            }
            row.insert(column.name.to_string(), column.value(idx, &mut buf)?);
        }
        rows.push(row);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{
            ArrayRef, BinaryArray, BinaryViewArray, Date64Array, Decimal128Array, Decimal256Array,
            DictionaryArray, DurationSecondArray, FixedSizeBinaryArray, FixedSizeListArray,
            Float16Array, Float32Array, Float64Array, Int32Array, Int64Builder,
            IntervalMonthDayNanoArray, LargeBinaryArray, LargeListArray, LargeStringArray,
            ListArray, MapBuilder, NullArray, RunArray, StringArray, StringBuilder, StructArray,
            Time64MicrosecondArray, TimestampMicrosecondArray, TimestampNanosecondArray,
            UnionArray, record_batch,
        },
        datatypes::{
            ArrowPrimitiveType, Field, Float16Type, Int32Type, IntervalMonthDayNano, Schema,
            UnionFields, i256,
        },
        record_batch::RecordBatch,
    };

    use super::*;

    fn create_test_batch() -> RecordBatch {
        record_batch!(
            ("id", Int32, [1, 2, 3]),
            ("name", Utf8, ["Alice", "Bob", "Charlie"]),
            ("value", UInt64, [100, 200, 300])
        )
        .unwrap()
    }

    #[test]
    fn test_record_batches_to_json_rows_empty() {
        let result = record_batches_to_json_rows(&[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_record_batches_to_json_rows_single_batch() {
        let batch = create_test_batch();
        let result = record_batches_to_json_rows(&[&batch]).unwrap();

        assert_eq!(result.len(), 3);
        assert_eq!(result[0]["id"], 1);
        assert_eq!(result[0]["name"], "Alice");
        assert_eq!(result[0]["value"], 100);
        assert_eq!(result[1]["id"], 2);
        assert_eq!(result[1]["name"], "Bob");
        assert_eq!(result[1]["value"], 200);
        assert_eq!(result[2]["id"], 3);
        assert_eq!(result[2]["name"], "Charlie");
        assert_eq!(result[2]["value"], 300);
    }

    #[test]
    fn test_record_batches_to_json_rows_multiple_batches() {
        let batch1 = create_test_batch();
        let batch2 = create_test_batch();
        let result = record_batches_to_json_rows(&[&batch1, &batch2]).unwrap();

        assert_eq!(result.len(), 6);
        // First batch
        assert_eq!(result[0]["id"], 1);
        assert_eq!(result[0]["name"], "Alice");
        assert_eq!(result[0]["value"], 100);
        // Second batch
        assert_eq!(result[3]["id"], 1);
        assert_eq!(result[3]["name"], "Alice");
        assert_eq!(result[3]["value"], 100);
    }

    #[test]
    fn test_record_batches_to_json_rows_empty_batch() {
        let schema = Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new("name", DataType::Utf8, false),
        ]);

        let id_array = Int32Array::from(Vec::<i32>::new());
        let name_array = StringArray::from(Vec::<String>::new());

        let batch = RecordBatch::try_new(
            schema.into(),
            vec![
                std::sync::Arc::new(id_array),
                std::sync::Arc::new(name_array),
            ],
        )
        .unwrap();

        let result = record_batches_to_json_rows(&[&batch]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_record_batches_to_json_rows_nullable_fields() {
        let schema = Schema::new(vec![
            Field::new("id", DataType::Int32, true),
            Field::new("name", DataType::Utf8, true),
        ]);

        let id_array = Int32Array::from(vec![Some(1), None, Some(3)]);
        let name_array = StringArray::from(vec![Some("Alice"), None, Some("Charlie")]);

        let batch = RecordBatch::try_new(
            schema.into(),
            vec![
                std::sync::Arc::new(id_array),
                std::sync::Arc::new(name_array),
            ],
        )
        .unwrap();

        let result = record_batches_to_json_rows(&[&batch]).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0]["id"], 1);
        assert_eq!(result[0]["name"], "Alice");
        assert!(result[1].is_empty());
        assert_eq!(result[2]["id"], 3);
        assert_eq!(result[2]["name"], "Charlie");
    }

    /// The rows `arrow_json::ArrayWriter` produces, parsed back with serde_json.
    fn array_writer_rows(batches: &[&RecordBatch]) -> Vec<JsonMap<String, Value>> {
        let mut writer = arrow_json::ArrayWriter::new(Vec::new());
        writer.write_batches(batches).unwrap();
        writer.finish().unwrap();
        let buf = writer.into_inner();
        if buf.is_empty() {
            return Vec::new();
        }
        json::from_slice(&buf).unwrap()
    }

    fn all_types_batch() -> RecordBatch {
        let strs = vec![
            Some(""),
            Some("quote\" back\\slash /"),
            Some("new\nline\ttab\r\u{0001}"),
            Some("中文 😀"),
            None,
            Some("plain"),
        ];
        let list = ListArray::from_iter_primitive::<Int64Type, _, _>(vec![
            Some(vec![Some(1), None, Some(3)]),
            Some(vec![]),
            None,
            Some(vec![Some(i64::MAX)]),
            None,
            Some(vec![None]),
        ]);
        let nested = StructArray::try_new(
            vec![
                Field::new("a", DataType::Int64, true),
                Field::new("b", DataType::Utf8, true),
            ]
            .into(),
            vec![
                Arc::new(Int64Array::from(vec![
                    Some(1),
                    None,
                    Some(3),
                    None,
                    None,
                    Some(6),
                ])),
                Arc::new(StringArray::from(vec![
                    Some("x"),
                    Some("y"),
                    None,
                    None,
                    None,
                    Some("\"z\""),
                ])),
            ],
            Some(vec![true, true, true, false, false, true].into()),
        )
        .unwrap();
        let dict: DictionaryArray<Int32Type> =
            vec![Some("d1"), Some("d2"), Some("d1"), None, None, Some("d3")]
                .into_iter()
                .collect();
        let columns: Vec<(&str, ArrayRef)> = vec![
            ("utf8", Arc::new(StringArray::from(strs.clone()))),
            ("large_utf8", Arc::new(LargeStringArray::from(strs.clone()))),
            ("utf8_view", Arc::new(StringViewArray::from(strs))),
            (
                "bool",
                Arc::new(BooleanArray::from(vec![
                    Some(true),
                    Some(false),
                    None,
                    Some(true),
                    None,
                    None,
                ])),
            ),
            (
                "i32",
                Arc::new(Int32Array::from(vec![
                    Some(i32::MIN),
                    Some(0),
                    Some(i32::MAX),
                    None,
                    None,
                    Some(-1),
                ])),
            ),
            (
                "i64",
                Arc::new(Int64Array::from(vec![
                    Some(i64::MIN),
                    Some(0),
                    Some(i64::MAX),
                    None,
                    None,
                    Some(-1),
                ])),
            ),
            (
                "u64",
                Arc::new(UInt64Array::from(vec![
                    Some(0),
                    Some(1),
                    Some(u64::MAX),
                    None,
                    None,
                    Some(7),
                ])),
            ),
            (
                "f32",
                Arc::new(Float32Array::from(vec![
                    Some(0.1),
                    Some(1e20),
                    Some(f32::NAN),
                    Some(f32::INFINITY),
                    None,
                    Some(-0.0),
                ])),
            ),
            (
                "f64",
                Arc::new(Float64Array::from(vec![
                    Some(0.1),
                    Some(1e20),
                    Some(1e-7),
                    Some(f64::NEG_INFINITY),
                    None,
                    Some(f64::NAN),
                ])),
            ),
            (
                "f64_edges",
                Arc::new(Float64Array::from(vec![
                    Some(-0.0),
                    Some(f64::MAX),
                    Some(f64::MIN_POSITIVE),
                    Some(1.0),
                    None,
                    Some(123_456_789.123),
                ])),
            ),
            (
                "ts_us",
                Arc::new(TimestampMicrosecondArray::from(vec![
                    Some(1_686_568_960_000_000),
                    Some(0),
                    Some(-1),
                    None,
                    None,
                    Some(1_700_000_000_123_456),
                ])),
            ),
            (
                "ts_ns_tz",
                Arc::new(
                    TimestampNanosecondArray::from(vec![
                        Some(1_686_568_960_000_000_001),
                        Some(0),
                        None,
                        None,
                        None,
                        Some(5),
                    ])
                    .with_timezone("+08:00"),
                ),
            ),
            (
                "decimal",
                Arc::new(
                    Decimal128Array::from(vec![
                        Some(12345),
                        Some(-1),
                        Some(0),
                        None,
                        None,
                        Some(7),
                    ])
                    .with_precision_and_scale(20, 2)
                    .unwrap(),
                ),
            ),
            ("list", Arc::new(list)),
            ("struct", Arc::new(nested)),
            ("dict", Arc::new(dict)),
            (
                "binary",
                Arc::new(BinaryArray::from(vec![
                    Some(&b"ab"[..]),
                    Some(&b""[..]),
                    None,
                    None,
                    None,
                    Some(&b"\x00\xff"[..]),
                ])),
            ),
            ("null", Arc::new(NullArray::new(6))),
            (
                "dup",
                Arc::new(Int64Array::from(vec![
                    Some(1),
                    None,
                    Some(3),
                    None,
                    None,
                    Some(6),
                ])),
            ),
            (
                "dup",
                Arc::new(StringArray::from(vec![
                    Some("second"),
                    Some("only-second"),
                    None,
                    None,
                    None,
                    None,
                ])),
            ),
        ];
        RecordBatch::try_from_iter(columns).unwrap()
    }

    fn more_types_batch() -> RecordBatch {
        type F16 = <Float16Type as ArrowPrimitiveType>::Native;
        let mut map = MapBuilder::new(None, StringBuilder::new(), Int64Builder::new());
        for i in 0..6 {
            if i % 3 == 2 {
                map.append(false).unwrap();
                continue;
            }
            map.keys().append_value(format!("k{i}\"q"));
            if i % 2 == 0 {
                map.values().append_value(i);
            } else {
                map.values().append_null();
            }
            map.keys().append_value("second");
            map.values().append_value(-1);
            map.append(true).unwrap();
        }
        let large_list = LargeListArray::from_iter_primitive::<Int64Type, _, _>(vec![
            Some(vec![Some(1), None]),
            None,
            Some(vec![]),
            Some(vec![Some(4)]),
            None,
            Some(vec![Some(6), Some(7)]),
        ]);
        let fixed_list = FixedSizeListArray::from_iter_primitive::<Int64Type, _, _>(
            vec![
                Some(vec![Some(1), Some(2)]),
                None,
                Some(vec![None, Some(3)]),
                Some(vec![Some(4), Some(5)]),
                None,
                Some(vec![Some(6), Some(7)]),
            ],
            2,
        );
        let run_end: RunArray<Int32Type> =
            vec![Some("a"), Some("a"), None, Some("b"), Some("b"), Some("c")]
                .into_iter()
                .collect();
        let columns: Vec<(&str, ArrayRef)> = vec![
            ("map", Arc::new(map.finish())),
            ("large_list", Arc::new(large_list)),
            ("fixed_size_list", Arc::new(fixed_list)),
            (
                "large_binary",
                Arc::new(LargeBinaryArray::from(vec![
                    Some(&b"ab"[..]),
                    None,
                    Some(&b""[..]),
                    Some(&b"\xff"[..]),
                    None,
                    Some(&b"z"[..]),
                ])),
            ),
            (
                "binary_view",
                Arc::new(BinaryViewArray::from(vec![
                    Some(&b"ab"[..]),
                    None,
                    Some(&b"a value longer than the inline view"[..]),
                    Some(&b"\x00"[..]),
                    None,
                    Some(&b"z"[..]),
                ])),
            ),
            (
                "fixed_size_binary",
                Arc::new(
                    FixedSizeBinaryArray::try_from_sparse_iter_with_size(
                        vec![
                            Some(vec![1u8, 2]),
                            None,
                            Some(vec![3, 4]),
                            Some(vec![5, 6]),
                            None,
                            Some(vec![7, 8]),
                        ]
                        .into_iter(),
                        2,
                    )
                    .unwrap(),
                ),
            ),
            (
                "f16",
                Arc::new(Float16Array::from(vec![
                    Some(F16::from_f32(0.1)),
                    Some(F16::INFINITY),
                    Some(F16::NAN),
                    None,
                    Some(F16::from_f32(-2.5)),
                    Some(F16::MAX),
                ])),
            ),
            (
                "date64",
                Arc::new(Date64Array::from(vec![
                    Some(0),
                    Some(1_686_568_960_000),
                    None,
                    Some(-86_400_000),
                    None,
                    Some(5),
                ])),
            ),
            (
                "time64_us",
                Arc::new(Time64MicrosecondArray::from(vec![
                    Some(0),
                    Some(3_600_000_001),
                    None,
                    Some(86_399_999_999),
                    None,
                    Some(1),
                ])),
            ),
            (
                "duration_s",
                Arc::new(DurationSecondArray::from(vec![
                    Some(0),
                    Some(3600),
                    None,
                    Some(-5),
                    None,
                    Some(86_401),
                ])),
            ),
            (
                "interval",
                Arc::new(IntervalMonthDayNanoArray::from(vec![
                    Some(IntervalMonthDayNano::new(1, 2, 3)),
                    None,
                    Some(IntervalMonthDayNano::new(0, 0, 0)),
                    Some(IntervalMonthDayNano::new(-1, 0, 1_000_000_000)),
                    None,
                    Some(IntervalMonthDayNano::new(12, 31, 5)),
                ])),
            ),
            (
                "decimal256",
                Arc::new(
                    Decimal256Array::from(vec![
                        Some(i256::from_i128(12345)),
                        None,
                        Some(i256::from_i128(-1)),
                        Some(i256::MAX),
                        None,
                        Some(i256::from_i128(0)),
                    ])
                    .with_precision_and_scale(76, 3)
                    .unwrap(),
                ),
            ),
            ("run_end", Arc::new(run_end)),
        ];
        RecordBatch::try_from_iter(columns).unwrap()
    }

    #[test]
    fn test_record_batches_to_json_rows_rejects_what_array_writer_rejects() {
        let fields = UnionFields::try_new(
            vec![0, 1],
            vec![
                Field::new("i", DataType::Int64, true),
                Field::new("s", DataType::Utf8, true),
            ],
        )
        .unwrap();
        let union = UnionArray::try_new(
            fields,
            vec![0i8, 1].into(),
            None,
            vec![
                Arc::new(Int64Array::from(vec![1, 2])) as ArrayRef,
                Arc::new(StringArray::from(vec!["a", "b"])),
            ],
        )
        .unwrap();
        let batch = RecordBatch::try_from_iter(vec![("u", Arc::new(union) as ArrayRef)]).unwrap();
        let mut writer = arrow_json::ArrayWriter::new(Vec::new());
        let expected = writer.write_batches(&[&batch]).unwrap_err().to_string();
        let got = record_batches_to_json_rows(&[&batch])
            .unwrap_err()
            .to_string();
        assert_eq!(got, expected);
    }

    #[test]
    fn test_record_batches_to_json_rows_matches_array_writer() {
        let batch = all_types_batch();
        let empty = batch.slice(0, 0);
        let tail = batch.slice(2, 4);
        let more = more_types_batch();
        let more_tail = more.slice(1, 4);
        for batches in [
            vec![&batch],
            vec![&batch, &empty, &tail],
            vec![&empty],
            vec![&more, &more_tail],
        ] {
            let expected = array_writer_rows(&batches);
            let got = record_batches_to_json_rows(&batches).unwrap();
            assert_eq!(got, expected);
            assert_eq!(
                json::to_string(&got).unwrap(),
                json::to_string(&expected).unwrap()
            );
        }
        let rows = record_batches_to_json_rows(&[&batch]).unwrap();
        assert!(rows[4].is_empty(), "{:?}", rows[4]);
        assert_eq!(rows[2].get("f32"), Some(&Value::Null));
        assert!(!rows[3].contains_key("i64"));
        assert_eq!(rows[0]["dup"], "second");
    }
}
