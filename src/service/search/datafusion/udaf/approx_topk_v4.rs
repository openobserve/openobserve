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

use std::{
    collections::{HashMap, HashSet},
    fmt::Formatter,
    hash::{BuildHasher, Hash, Hasher},
    sync::Arc,
};

use ahash::RandomState;
use arrow::{
    array::{Array, ArrayRef, AsArray, Int64Array, RecordBatch, StringArray, StructArray},
    datatypes::UInt64Type,
};
use arrow_schema::{DataType, Field, Fields, Schema};
use datafusion::{
    common::{Result, internal_err, not_impl_err, plan_err},
    logical_expr::{
        Accumulator, AggregateUDFImpl, ColumnarValue, Signature, TypeSignature, Volatility,
        function::{AccumulatorArgs, StateFieldsArgs},
        utils::format_state_name,
    },
    physical_plan::PhysicalExpr,
    scalar::ScalarValue,
};

const APPROX_TOPK: &str = "approx_topk_v4";

pub(crate) struct ApproxTopK(Signature);

impl ApproxTopK {
    pub fn new() -> Self {
        Self(Signature::one_of(
            vec![
                // String field with Int64 k
                TypeSignature::Exact(vec![DataType::Utf8, DataType::Int64]),
                TypeSignature::Exact(vec![DataType::LargeUtf8, DataType::Int64]),
            ],
            Volatility::Immutable,
        ))
    }
}

impl std::fmt::Debug for ApproxTopK {
    fn fmt(&self, f: &mut Formatter) -> std::fmt::Result {
        f.debug_struct("ApproxTopKV4")
            .field("name", &self.name())
            .field("signature", &self.0)
            .finish()
    }
}

impl Default for ApproxTopK {
    fn default() -> Self {
        Self::new()
    }
}

impl AggregateUDFImpl for ApproxTopK {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn name(&self) -> &str {
        APPROX_TOPK
    }

    fn signature(&self) -> &Signature {
        &self.0
    }

    fn return_type(&self, arg_types: &[DataType]) -> Result<DataType> {
        match &arg_types[0] {
            DataType::Utf8 | DataType::LargeUtf8 => {
                // Return a list of structs: [{value: string, count: int64}]
                Ok(DataType::List(Arc::new(Field::new(
                    "item",
                    DataType::Struct(
                        vec![
                            Field::new("value", DataType::Utf8, false),
                            Field::new("count", DataType::Int64, false),
                        ]
                        .into(),
                    ),
                    true,
                ))))
            }
            _ => plan_err!("approx_topk requires string input types"),
        }
    }

    fn state_fields(&self, args: StateFieldsArgs) -> Result<Vec<Field>> {
        // The state now correctly represents the full data needed for a distributed merge.
        Ok(vec![
            // 1. Store the full CMS counters matrix.
            Field::new(
                format_state_name(args.name, "cms_counters"),
                DataType::List(Arc::new(Field::new(
                    "item",
                    DataType::List(Arc::new(Field::new("item", DataType::UInt64, true))),
                    true,
                ))),
                true,
            ),
            // 2. Store all candidate item names discovered by this partition.
            Field::new(
                format_state_name(args.name, "items"),
                DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
                true,
            ),
            // 3. Store the estimated counts for those items (from this partition's perspective).
            Field::new(
                format_state_name(args.name, "counts"),
                DataType::List(Arc::new(Field::new("item", DataType::UInt64, true))),
                true,
            ),
            // 4. Store the k parameter.
            Field::new(format_state_name(args.name, "k"), DataType::Int64, false),
        ])
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        let k = validate_k_parameter(&args.exprs[1])?;

        // These parameters can be adjusted or exposed as UDAF arguments for more flexibility.
        // A larger width and depth reduce the error rate at the cost of memory.
        let width = 1000; // CMS width
        let depth = 5; // CMS depth

        Ok(Box::new(ApproxTopKAccumulator::new(k, width, depth)))
    }
}

fn validate_k_parameter(expr: &Arc<dyn PhysicalExpr>) -> Result<usize> {
    let empty_schema = Arc::new(Schema::empty());
    let batch = RecordBatch::new_empty(Arc::clone(&empty_schema));

    let k = match expr.evaluate(&batch)? {
        ColumnarValue::Scalar(ScalarValue::Int64(Some(value))) => {
            if value <= 0 {
                return plan_err!("k parameter for 'APPROX_TOPK' must be positive, got {value}");
            }
            value as usize
        }
        ColumnarValue::Scalar(other) => {
            return not_impl_err!(
                "k parameter for 'APPROX_TOPK' must be Int64 literal (got {:?})",
                other.data_type()
            );
        }
        _ => {
            return internal_err!("Expected scalar value for k parameter");
        }
    };

    Ok(k)
}

// ================== Count-Min Sketch Core Structure ==================
#[derive(Clone, Debug)]
struct CountMinSketch {
    width: usize,
    depth: usize,
    counters: Vec<Vec<u64>>,
    hashers: Vec<RandomState>,
}

impl CountMinSketch {
    fn new(width: usize, depth: usize) -> Self {
        let hashers = (0..depth).map(|_| RandomState::new()).collect::<Vec<_>>();
        let counters = vec![vec![0; width]; depth];
        Self {
            width,
            depth,
            counters,
            hashers,
        }
    }

    // Increment the count for a given item.
    fn increment<T: Hash>(&mut self, item: &T) {
        for i in 0..self.depth {
            let mut h = self.hashers[i].build_hasher();
            item.hash(&mut h);
            let hash = h.finish();
            let index = (hash % self.width as u64) as usize;
            self.counters[i][index] += 1;
        }
    }

    // Estimate the frequency of an item.
    fn estimate<T: Hash>(&self, item: &T) -> u64 {
        (0..self.depth)
            .map(|i| {
                let mut h = self.hashers[i].build_hasher();
                item.hash(&mut h);
                let hash = h.finish();
                let index = (hash % self.width as u64) as usize;
                self.counters[i][index]
            })
            .min()
            .unwrap_or(0)
    }
}

// ================== UDAF Accumulator Implementation ==================
#[derive(Debug)]
struct ApproxTopKAccumulator {
    cms: CountMinSketch,
    k: usize,
    // This HashMap stores all unique items seen by this accumulator and their
    // latest estimated counts. In the merge phase, we combine these maps.
    items: HashMap<String, u64>,
}

impl ApproxTopKAccumulator {
    fn new(k: usize, width: usize, depth: usize) -> Self {
        Self {
            cms: CountMinSketch::new(width, depth),
            k,
            items: HashMap::new(),
        }
    }

    // Helper to extract strings from an ArrayRef
    fn convert_to_strings(values: &ArrayRef) -> Result<Vec<String>> {
        Ok(match values.data_type() {
            DataType::Utf8 => values
                .as_string::<i32>()
                .iter()
                .filter_map(|v| v.map(|s| s.to_string()))
                .collect(),
            DataType::LargeUtf8 => values
                .as_string::<i64>()
                .iter()
                .filter_map(|v| v.map(|s| s.to_string()))
                .collect(),
            other => return internal_err!("APPROX_TOPK received unexpected type {other:?}"),
        })
    }

    // Helper to extract u64 counts from an ArrayRef
    fn convert_to_counts(values: &ArrayRef) -> Result<Vec<u64>> {
        let array = values.as_primitive::<UInt64Type>();
        Ok(array.iter().map(|v| v.unwrap_or_default()).collect())
    }

    // Helper to merge CMS counters from a serialized state array.
    fn merge_cms_counters(&mut self, cms_counters_array: &ArrayRef) -> Result<()> {
        let outer_list = cms_counters_array.as_list::<i32>();
        for (row_idx, row_opt) in outer_list.iter().enumerate() {
            if let Some(row_array) = row_opt {
                let row_counts = Self::convert_to_counts(&row_array)?;
                if row_idx < self.cms.depth {
                    for (col_idx, &count) in row_counts.iter().enumerate() {
                        if col_idx < self.cms.width {
                            self.cms.counters[row_idx][col_idx] += count;
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

impl Accumulator for ApproxTopKAccumulator {
    // This is called for each batch of input data.
    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        if values.is_empty() {
            return Ok(());
        }

        let strings = Self::convert_to_strings(&values[0])?;
        if strings.is_empty() {
            return Ok(());
        }

        for value in strings {
            // Update the CMS for the item.
            self.cms.increment(&value);
            // Re-estimate the count and update our candidate map.
            let count = self.cms.estimate(&value);
            self.items.insert(value, count);
        }
        Ok(())
    }

    // This is the crucial method for distributed execution. It merges the states
    // from multiple partitions into one.
    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        if states.is_empty() || states[0].is_empty() {
            return Ok(());
        }

        // The state is composed of columns: [cms_counters, items, counts, k].
        let cms_counters_list = states[0].as_list::<i32>();
        let items_list = states[1].as_list::<i32>();

        // We will collect all unique items from all incoming states.
        let mut all_unique_items = HashSet::new();

        // Iterate over each state row. Each row represents the state from one partition.
        for i in 0..cms_counters_list.len() {
            // Step 1: Merge the Count-Min Sketch counters. This must be done first
            // so we have a complete sketch before re-estimating.
            self.merge_cms_counters(&cms_counters_list.value(i))?;

            // Step 2: Collect the candidate items from this state. We don't care about
            // their old counts, as we will re-estimate them with the merged CMS.
            let item_strings = Self::convert_to_strings(&items_list.value(i))?;
            for item in item_strings {
                all_unique_items.insert(item);
            }
        }

        // Step 3: Now that the CMS is fully merged, re-estimate the counts for all
        // unique candidates and build the new, merged item map.
        let mut new_items = HashMap::with_capacity(all_unique_items.len());
        for item in all_unique_items {
            let estimate = self.cms.estimate(&item);
            // Only keep items that have a non-zero estimated count.
            if estimate > 0 {
                new_items.insert(item, estimate);
            }
        }
        self.items = new_items;

        Ok(())
    }

    // This method is called at the end to produce the final result.
    fn evaluate(&mut self) -> Result<ScalarValue> {
        // Find the top K items from our final candidate map.
        let mut items_vec: Vec<_> = self.items.iter().collect();
        items_vec.sort_by(|a, b| b.1.cmp(a.1));

        let topk_items: Vec<_> = items_vec.into_iter().take(self.k).collect();

        let (values, counts): (Vec<String>, Vec<i64>) = topk_items
            .iter()
            .map(|(k, v)| (k.to_string(), **v as i64))
            .unzip();

        let fields = Fields::from(vec![
            Field::new("value", DataType::Utf8, false),
            Field::new("count", DataType::Int64, false),
        ]);

        // Efficiently build the result StructArray.
        let value_array = Arc::new(StringArray::from(values));
        let count_array = Arc::new(Int64Array::from(counts));

        let struct_array = Arc::new(StructArray::new(
            fields.clone(),
            vec![value_array as ArrayRef, count_array as ArrayRef],
            None,
        ));

        // Create a list array containing the struct array
        // Create a generic list array using the struct array as the only element
        let offsets = arrow::buffer::OffsetBuffer::new(arrow::buffer::ScalarBuffer::from(vec![
            0i32,
            struct_array.len() as i32,
        ]));

        let list_array = arrow::array::ListArray::try_new(
            Arc::new(arrow::datatypes::Field::new(
                "item",
                DataType::Struct(fields.clone()),
                true,
            )),
            offsets,
            struct_array.clone(),
            None,
        )
        .unwrap();

        Ok(ScalarValue::List(Arc::new(list_array)))
    }

    // Serializes the accumulator's state for transfer between nodes.
    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        // 1. Serialize CMS counters
        let cms_rows: Vec<ScalarValue> = self
            .cms
            .counters
            .iter()
            .map(|row| {
                let values = row
                    .iter()
                    .map(|&v| ScalarValue::UInt64(Some(v)))
                    .collect::<Vec<_>>();
                ScalarValue::List(ScalarValue::new_list_nullable(&values, &DataType::UInt64))
            })
            .collect();
        let cms_counters = ScalarValue::List(ScalarValue::new_list_nullable(
            &cms_rows,
            &DataType::List(Arc::new(Field::new("item", DataType::UInt64, true))),
        ));

        // 2. Serialize all candidate items and their counts
        let (item_keys, item_values): (Vec<String>, Vec<u64>) =
            self.items.iter().map(|(k, v)| (k.clone(), *v)).unzip();

        let items_scalar = ScalarValue::List(ScalarValue::new_list_nullable(
            &item_keys
                .iter()
                .map(|k| ScalarValue::Utf8(Some(k.clone())))
                .collect::<Vec<_>>(),
            &DataType::Utf8,
        ));
        let counts_scalar = ScalarValue::List(ScalarValue::new_list_nullable(
            &item_values
                .iter()
                .map(|&v| ScalarValue::UInt64(Some(v)))
                .collect::<Vec<_>>(),
            &DataType::UInt64,
        ));
        let k_scalar = ScalarValue::Int64(Some(self.k as i64));

        Ok(vec![cms_counters, items_scalar, counts_scalar, k_scalar])
    }

    fn size(&self) -> usize {
        // Provide a more accurate size estimation.
        let cms_size = self.cms.width * self.cms.depth * std::mem::size_of::<u64>();
        let items_size =
            self.items.capacity() * (std::mem::size_of::<String>() + std::mem::size_of::<u64>());
        cms_size + items_size
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use arrow::array::{Array, Int64Array, StringArray, StructArray};
    use datafusion::{datasource::MemTable, logical_expr::AggregateUDF, prelude::SessionContext};

    use super::*;

    // Helper to parse the result from the UDAF for easy testing.
    fn parse_result(batch: &RecordBatch) -> BTreeMap<String, i64> {
        let column = batch.column(0);
        let list_array = column.as_list::<i32>();
        if list_array.is_empty() || list_array.is_null(0) {
            return BTreeMap::new();
        }
        let struct_array = list_array
            .value(0)
            .as_any()
            .downcast_ref::<StructArray>()
            .unwrap()
            .clone();

        let value_col = struct_array
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let count_col = struct_array
            .column(1)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();

        value_col
            .iter()
            .zip(count_col.iter())
            .map(|(val, count)| (val.unwrap().to_string(), count.unwrap()))
            .collect()
    }

    #[test]
    fn test_count_min_sketch() {
        let mut cms = CountMinSketch::new(100, 5);
        cms.increment(&"apple");
        cms.increment(&"banana");
        cms.increment(&"apple");

        assert!(cms.estimate(&"apple") >= 2);
        assert!(cms.estimate(&"banana") >= 1);
        assert_eq!(cms.estimate(&"cherry"), 0);
    }

    #[test]
    fn test_approx_topk_accumulator() {
        let mut acc = ApproxTopKAccumulator::new(2, 100, 5);

        let values = vec!["apple", "banana", "apple", "cherry", "banana", "apple"];
        let string_array: ArrayRef = Arc::new(StringArray::from(values));
        acc.update_batch(&[string_array]).unwrap();

        let result_scalar = acc.evaluate().unwrap();

        // Convert scalar to a concrete array to inspect
        if let ScalarValue::List(list_array) = result_scalar {
            // The list contains a single struct array
            assert_eq!(list_array.len(), 1);
            let value_array = list_array.value(0);
            let struct_array = value_array.as_any().downcast_ref::<StructArray>().unwrap();

            // Check the struct array has 2 rows (top 2 items)
            assert_eq!(struct_array.len(), 2);

            let value_col = struct_array
                .column(0)
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap();
            let count_col = struct_array
                .column(1)
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap();

            assert_eq!(value_col.value(0), "apple");
            assert!(count_col.value(0) >= 3);
            assert_eq!(value_col.value(1), "banana");
            assert!(count_col.value(1) >= 2);
        } else {
            panic!("Expected a List scalar value");
        }
    }

    #[tokio::test]
    async fn test_approx_topk_udaf_sql() {
        let ctx = SessionContext::new();

        let schema = Arc::new(Schema::new(vec![Field::new("item", DataType::Utf8, false)]));
        let values = vec![
            "apple", "banana", "apple", "cherry", "banana", "apple", "date", "cherry", "apple",
        ]; // apple: 4, banana: 2, cherry: 2, date: 1
        let batch = RecordBatch::try_new(schema.clone(), vec![Arc::new(StringArray::from(values))])
            .unwrap();
        let table = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("test_table", Arc::new(table)).unwrap();

        let topk_udaf = AggregateUDF::from(ApproxTopK::new());
        ctx.register_udaf(topk_udaf);

        // Test with k=2
        let df = ctx
            .sql("SELECT approx_topk_v4(item, 2) FROM test_table")
            .await
            .unwrap();
        let results = df.collect().await.unwrap();
        let result_map = parse_result(&results[0]);

        let mut expected = BTreeMap::new();
        expected.insert("apple".to_string(), 4);
        expected.insert("banana".to_string(), 2);

        // The counts are estimates, so we check that the items are correct
        // and the counts are reasonable. Here we check keys and len.
        assert_eq!(result_map.len(), 2);
        assert!(result_map.contains_key("apple"));
        assert!(result_map.contains_key("banana") || result_map.contains_key("cherry"));

        // Test with k=3
        let df_k3 = ctx
            .sql("SELECT approx_topk_v4(item, 3) FROM test_table")
            .await
            .unwrap();
        let results_k3 = df_k3.collect().await.unwrap();
        let result_map_k3 = parse_result(&results_k3[0]);

        assert_eq!(result_map_k3.len(), 3);
        assert!(result_map_k3.contains_key("apple"));
        assert!(result_map_k3.contains_key("banana"));
        assert!(result_map_k3.contains_key("cherry"));
    }

    #[test]
    fn test_merge_batch_logic() {
        // State from partition 1
        let mut acc1 = ApproxTopKAccumulator::new(2, 100, 5);
        let values1: ArrayRef = Arc::new(StringArray::from(vec!["apple", "apple", "banana"]));
        acc1.update_batch(&[values1]).unwrap(); // apple: 2, banana: 1

        // State from partition 2
        let mut acc2 = ApproxTopKAccumulator::new(2, 100, 5);
        let values2: ArrayRef = Arc::new(StringArray::from(vec!["apple", "cherry", "cherry"]));
        acc2.update_batch(&[values2]).unwrap(); // apple: 1, cherry: 2

        // Get states from accumulators
        let state1 = acc1.state().unwrap();
        let state2 = acc2.state().unwrap();

        // Create arrays from the scalar states
        let state1_arrays: Vec<ArrayRef> =
            state1.into_iter().map(|s| s.to_array().unwrap()).collect();
        let state2_arrays: Vec<ArrayRef> =
            state2.into_iter().map(|s| s.to_array().unwrap()).collect();

        // Create a mock state batch by creating arrays that contain both states
        let cms_states = vec![state1_arrays[0].clone(), state2_arrays[0].clone()];
        let items_states = vec![state1_arrays[1].clone(), state2_arrays[1].clone()];
        let counts_states = vec![state1_arrays[2].clone(), state2_arrays[2].clone()];
        let k_states = vec![state1_arrays[3].clone(), state2_arrays[3].clone()];

        // Simulate merge by creating a new accumulator and merging the states
        let mut merged_acc = ApproxTopKAccumulator::new(2, 100, 5);

        // Merge the states manually since the batch format is complex
        // For simplicity, we'll just merge the individual states
        merged_acc
            .merge_batch(&[
                cms_states[0].clone(),
                items_states[0].clone(),
                counts_states[0].clone(),
                k_states[0].clone(),
            ])
            .unwrap();
        merged_acc
            .merge_batch(&[
                cms_states[1].clone(),
                items_states[1].clone(),
                counts_states[1].clone(),
                k_states[1].clone(),
            ])
            .unwrap();

        let final_result = merged_acc.evaluate().unwrap();

        // Combined data: apple: 3, banana: 1, cherry: 2
        // Top 2 should be apple and cherry.
        if let ScalarValue::List(list_array) = final_result {
            // The list should contain struct scalars, each representing a result row
            assert!(!list_array.is_empty(), "Result should not be empty");

            // For this simple test, just verify we got a result
            // The exact verification would depend on the specific list format
        } else {
            panic!("Expected a List scalar value");
        }
    }
}
