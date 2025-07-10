// Copyright 2025 OpenObserve Inc.
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

use arrow::array::RecordBatch;

use super::json::{Map as JsonMap, Value};

/// Converts an arrow [`RecordBatch`] into a `Vec` of Serde JSON
/// [`JsonMap`]s (objects)
pub fn record_batches_to_json_rows(
    batches: &[&RecordBatch],
) -> Result<Vec<JsonMap<String, Value>>, anyhow::Error> {
    if batches.is_empty() || batches.iter().all(|b| b.num_rows() == 0) {
        return Ok(Vec::new());
    }

    let json_buf = Vec::with_capacity(
        batches
            .iter()
            .map(|b| b.get_array_memory_size())
            .sum::<usize>(),
    );
    let mut writer = arrow_json::ArrayWriter::new(json_buf);
    writer.write_batches(batches)?;
    writer.finish()?;
    let json_data = writer.into_inner();
    let ret: Vec<JsonMap<String, Value>> = serde_json::from_reader(json_data.as_slice())?;

    // This effects other function, comment it for now
    //
    // Hack for uint64, because Chrome V8 does not support uint64
    // for field in schema.fields() {
    //     if field.data_type() == &DataType::UInt64 {
    //         for row in ret.iter_mut() {
    //             if let Some(val) = row.get_mut(field.name()) {
    //                 if val.is_u64() {
    //                     *val = Value::String(val.to_string());
    //                 }
    //             }
    //         }
    //     }
    // }

    Ok(ret)
}

#[cfg(test)]
mod tests {
    use arrow::{
        array::{Int32Array, StringArray, record_batch},
        datatypes::{DataType, Field, Schema},
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
}
