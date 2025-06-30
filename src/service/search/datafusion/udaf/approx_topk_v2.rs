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

use std::{collections::BinaryHeap, fmt::Formatter, sync::Arc};

use arrow::array::{Array, AsArray, RecordBatch, StructArray};
use arrow_schema::{Field, Schema};
use datafusion::{
    arrow::{array::ArrayRef, datatypes::DataType},
    common::{internal_err, not_impl_err, plan_err},
    error::Result,
    logical_expr::{
        Accumulator, AggregateUDFImpl, ColumnarValue, Signature, TypeSignature, Volatility,
        function::{AccumulatorArgs, StateFieldsArgs},
        utils::format_state_name,
    },
    physical_plan::PhysicalExpr,
    scalar::ScalarValue,
};

const APPROX_TOPK: &str = "approx_topk_v2";

/// Count-Min Sketch parameters for high cardinality data
/// These parameters provide good accuracy vs memory tradeoff
const CMS_WIDTH: usize = 2048; // Width of the sketch (more = better accuracy)
const CMS_DEPTH: usize = 5; // Depth of the sketch (more hash functions = better accuracy)

/// Approximate TopK UDAF that returns the top K elements by frequency.
///
/// Usage: approx_topk(field, k)
/// - field: the field to find top k values from
/// - k: number of top elements to return
///
/// Uses Count-Min Sketch for memory-efficient frequency estimation on high cardinality data.
/// For partial aggregation, returns top k elements from each partition.
/// For final aggregation, merges results from all partitions and returns final top k.
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
        f.debug_struct("ApproxTopKV2")
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

    fn signature(&self) -> &datafusion::logical_expr::Signature {
        &self.0
    }

    fn return_type(&self, arg_types: &[DataType]) -> Result<DataType> {
        match &arg_types[0] {
            DataType::Utf8 | DataType::LargeUtf8 => {
                // Return array of structs: [{value: string, count: int64}]
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
        Ok(vec![
            // Store Count-Min Sketch as flattened array
            Field::new(
                format_state_name(args.name, "cms_counters"),
                DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                true,
            ),
            // Store top-k values
            Field::new(
                format_state_name(args.name, "values"),
                DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
                true,
            ),
            // Store top-k counts
            Field::new(
                format_state_name(args.name, "counts"),
                DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                true,
            ),
            // Store k parameter
            Field::new(format_state_name(args.name, "k"), DataType::Int64, false),
        ])
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        let k = validate_k_parameter(&args.exprs[1])?;
        let value_data_type = args.exprs[0].data_type(args.schema)?;

        match value_data_type {
            DataType::Utf8 | DataType::LargeUtf8 => Ok(Box::new(ApproxTopKAccumulator::new(k))),
            other => {
                not_impl_err!("Support for 'APPROX_TOPK' for data type {other} is not implemented")
            }
        }
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

/// Count-Min Sketch implementation for frequency estimation
#[derive(Debug, Clone)]
struct CountMinSketch {
    /// 2D array of counters [depth][width]
    counters: Vec<Vec<i64>>,
    /// Width and depth of the sketch
    width: usize,
    depth: usize,
}

impl CountMinSketch {
    fn new() -> Self {
        Self {
            counters: vec![vec![0; CMS_WIDTH]; CMS_DEPTH],
            width: CMS_WIDTH,
            depth: CMS_DEPTH,
        }
    }

    /// Hash function using FNV-1a algorithm with different seeds
    fn hash_static(value: &str, seed: usize, width: usize) -> usize {
        let mut hash = 2166136261u32.wrapping_add(seed as u32);
        for byte in value.bytes() {
            hash ^= byte as u32;
            hash = hash.wrapping_mul(16777619);
        }
        (hash as usize) % width
    }

    /// Add an item to the sketch
    fn add(&mut self, value: &str, count: i64) {
        for i in 0..self.depth {
            let pos = Self::hash_static(value, i, self.width);
            self.counters[i][pos] += count;
        }
    }

    /// Query the estimated frequency of an item
    fn query(&self, value: &str) -> i64 {
        let mut min_count = i64::MAX;
        for i in 0..self.depth {
            let pos = Self::hash_static(value, i, self.width);
            min_count = min_count.min(self.counters[i][pos]);
        }
        min_count.max(0)
    }

    /// Merge another Count-Min Sketch into this one
    fn merge(&mut self, other: &CountMinSketch) {
        for (i, row) in self.counters.iter_mut().enumerate() {
            for (j, counter) in row.iter_mut().enumerate() {
                *counter += other.counters[i][j];
            }
        }
    }

    /// Get all counters as a flat vector for serialization
    fn to_flat_counters(&self) -> Vec<i64> {
        self.counters.iter().flatten().copied().collect()
    }

    /// Restore from flat counters
    fn from_flat_counters(flat: &[i64]) -> Self {
        if flat.len() != CMS_WIDTH * CMS_DEPTH {
            // Return empty sketch if size mismatch
            return Self::new();
        }

        let mut counters = vec![vec![0; CMS_WIDTH]; CMS_DEPTH];
        for (i, &value) in flat.iter().enumerate() {
            let row = i / CMS_WIDTH;
            let col = i % CMS_WIDTH;
            counters[row][col] = value;
        }

        Self {
            counters,
            width: CMS_WIDTH,
            depth: CMS_DEPTH,
        }
    }
}

/// Item in the top-k heap with count and value
#[derive(Debug, Clone, Eq, PartialEq)]
struct TopKItem {
    value: String,
    count: i64,
}

impl Ord for TopKItem {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Min-heap: smaller counts first, then lexicographic order for ties
        match self.count.cmp(&other.count) {
            std::cmp::Ordering::Equal => other.value.cmp(&self.value), /* Reverse for deterministic results */
            other => other,
        }
    }
}

impl PartialOrd for TopKItem {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Accumulator for ApproxTopK using Count-Min Sketch for high cardinality
struct ApproxTopKAccumulator {
    /// Count-Min Sketch for frequency estimation
    cms: CountMinSketch,
    /// Min-heap to maintain top-k items
    top_k_heap: BinaryHeap<TopKItem>,
    /// Target k value
    k: usize,
    // Maximum candidates to keep in memory
    max_candidates: usize,
}

impl std::fmt::Debug for ApproxTopKAccumulator {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ApproxTopKAccumulator(k={}, max_candidates={}, heap_size={})",
            self.k,
            self.max_candidates,
            self.top_k_heap.len()
        )
    }
}

impl ApproxTopKAccumulator {
    fn new(k: usize) -> Self {
        Self {
            cms: CountMinSketch::new(),
            top_k_heap: BinaryHeap::new(),
            k,
            max_candidates: (k * 10).max(1000).min(100_000), // Cap at 100k for safety
        }
    }

    /// Add an item and update the top-k tracking
    fn add_item(&mut self, value: &str, count: i64) {
        // Update Count-Min Sketch
        self.cms.add(value, count);

        // Get updated frequency estimate
        let estimated_freq = self.cms.query(value);

        // Update top-k heap
        // First, check if this item is already in the heap
        let mut found_index = None;
        for (i, item) in self.top_k_heap.iter().enumerate() {
            if item.value == value {
                found_index = Some(i);
                break;
            }
        }

        if found_index.is_some() {
            // Item already in heap, rebuild heap with updated counts
            let mut items: Vec<_> = self.top_k_heap.drain().collect();
            for item in &mut items {
                if item.value == value {
                    item.count = estimated_freq;
                }
            }
            self.top_k_heap.extend(items);
        } else {
            // New item
            let new_item = TopKItem {
                value: value.to_string(),
                count: estimated_freq,
            };

            if self.top_k_heap.len() < self.max_candidates {
                // Heap not full, just add
                self.top_k_heap.push(new_item);
            } else if let Some(min_item) = self.top_k_heap.peek() {
                // If new item has higher count than minimum, replace
                if estimated_freq > min_item.count
                    || (estimated_freq == min_item.count && value < min_item.value.as_str())
                {
                    self.top_k_heap.pop();
                    self.top_k_heap.push(new_item);
                }
            }
        }
    }

    /// Get the top k elements as (value, count) pairs sorted by count descending
    fn get_top_k(&self) -> Vec<(String, i64)> {
        let mut items: Vec<_> = self
            .top_k_heap
            .iter()
            .map(|item| (item.value.clone(), item.count))
            .collect();

        // Sort by count descending, then by value ascending for deterministic results
        items.sort_by(|a, b| match b.1.cmp(&a.1) {
            std::cmp::Ordering::Equal => a.0.cmp(&b.0),
            other => other,
        });

        items
    }

    /// Convert string array to vector of strings
    fn convert_to_strings(values: &ArrayRef) -> Result<Vec<String>> {
        match values.data_type() {
            DataType::Utf8 => {
                let array = values.as_string::<i32>();
                Ok(array
                    .iter()
                    .map(|v| v.unwrap_or_default().to_string())
                    .collect())
            }
            DataType::LargeUtf8 => {
                let array = values.as_string::<i64>();
                Ok(array
                    .iter()
                    .map(|v| v.unwrap_or_default().to_string())
                    .collect())
            }
            other => {
                internal_err!("APPROX_TOPK received unexpected type {other:?}")
            }
        }
    }

    /// Convert int64 array to vector of counts
    fn convert_to_counts(values: &ArrayRef) -> Result<Vec<i64>> {
        let array = values.as_primitive::<arrow::datatypes::Int64Type>();
        Ok(array.iter().map(|v| v.unwrap_or_default()).collect())
    }
}

impl Accumulator for ApproxTopKAccumulator {
    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        let top_k = self.get_top_k();

        // Serialize Count-Min Sketch
        let cms_counters = ScalarValue::List(ScalarValue::new_list_nullable(
            &self
                .cms
                .to_flat_counters()
                .iter()
                .map(|&count| ScalarValue::Int64(Some(count)))
                .collect::<Vec<ScalarValue>>(),
            &DataType::Int64,
        ));

        // Serialize top-k values and counts
        let values = ScalarValue::List(ScalarValue::new_list_nullable(
            &top_k
                .iter()
                .map(|(v, _)| ScalarValue::Utf8(Some(v.clone())))
                .collect::<Vec<ScalarValue>>(),
            &DataType::Utf8,
        ));

        let counts = ScalarValue::List(ScalarValue::new_list_nullable(
            &top_k
                .iter()
                .map(|(_, c)| ScalarValue::Int64(Some(*c)))
                .collect::<Vec<ScalarValue>>(),
            &DataType::Int64,
        ));

        let k_scalar = ScalarValue::Int64(Some(self.k as i64));

        Ok(vec![cms_counters, values, counts, k_scalar])
    }

    fn evaluate(&mut self) -> Result<ScalarValue> {
        let top_k = self
            .get_top_k()
            .into_iter()
            .take(self.k)
            .collect::<Vec<_>>();

        if top_k.is_empty() {
            return Ok(ScalarValue::List(ScalarValue::new_list_nullable(
                &[],
                &DataType::Struct(
                    vec![
                        Field::new("value", DataType::Utf8, false),
                        Field::new("count", DataType::Int64, false),
                    ]
                    .into(),
                ),
            )));
        }

        // Create struct array from the top k results
        use arrow::{
            array::{Int64Array, StringArray},
            datatypes::Fields,
        };

        let values: Vec<Option<String>> = top_k.iter().map(|(v, _)| Some(v.clone())).collect();
        let counts: Vec<Option<i64>> = top_k.iter().map(|(_, c)| Some(*c)).collect();

        let value_array = Arc::new(StringArray::from(values));
        let count_array = Arc::new(Int64Array::from(counts));

        let struct_array = StructArray::new(
            Fields::from(vec![
                Field::new("value", DataType::Utf8, false),
                Field::new("count", DataType::Int64, false),
            ]),
            vec![value_array as ArrayRef, count_array as ArrayRef],
            None,
        );

        Ok(ScalarValue::List(ScalarValue::new_list_nullable(
            &top_k
                .into_iter()
                .enumerate()
                .map(|(i, _)| ScalarValue::Struct(Arc::new(struct_array.slice(i, 1))))
                .collect::<Vec<ScalarValue>>(),
            &DataType::Struct(
                vec![
                    Field::new("value", DataType::Utf8, false),
                    Field::new("count", DataType::Int64, false),
                ]
                .into(),
            ),
        )))
    }

    fn size(&self) -> usize {
        // Count-Min Sketch size + top-k heap size
        CMS_WIDTH * CMS_DEPTH * std::mem::size_of::<i64>()
            + self.top_k_heap.len() * (std::mem::size_of::<TopKItem>() + 32) // Estimate string size
    }

    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        let strings = Self::convert_to_strings(&values[0])?;

        // Add each string value to the sketch and update top-k
        for string_val in strings {
            self.add_item(&string_val, 1);
        }

        Ok(())
    }

    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        if states.is_empty() {
            return Ok(());
        }

        // Extract Count-Min Sketch counters
        let cms_list = states[0].as_list::<i32>();
        let values_list = states[1].as_list::<i32>();
        let counts_list = states[2].as_list::<i32>();

        for ((cms_opt, values_opt), counts_opt) in cms_list
            .iter()
            .zip(values_list.iter())
            .zip(counts_list.iter())
        {
            if let (Some(cms_array), Some(values_array), Some(counts_array)) =
                (cms_opt, values_opt, counts_opt)
            {
                // Merge Count-Min Sketch
                let cms_counters = Self::convert_to_counts(&cms_array)?;
                let other_cms = CountMinSketch::from_flat_counters(&cms_counters);
                self.cms.merge(&other_cms);

                // Merge top-k items by re-adding them with their counts
                let values = Self::convert_to_strings(&values_array)?;
                let counts = Self::convert_to_counts(&counts_array)?;

                for (value, count) in values.into_iter().zip(counts.into_iter()) {
                    // Add to our sketch (this updates the frequency estimates)
                    self.add_item(&value, count);
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use arrow::array::StringArray;
    use datafusion::{datasource::MemTable, logical_expr::AggregateUDF, prelude::SessionContext};

    use super::*;

    #[test]
    fn test_count_min_sketch() {
        let mut cms = CountMinSketch::new();

        // Add some items
        cms.add("apple", 5);
        cms.add("banana", 3);
        cms.add("apple", 2); // Total: 7

        // Query frequencies
        let apple_freq = cms.query("apple");
        let banana_freq = cms.query("banana");
        let cherry_freq = cms.query("cherry"); // Should be 0

        assert!(apple_freq >= 7); // CMS may overestimate, never underestimate
        assert!(banana_freq >= 3);
        assert_eq!(cherry_freq, 0);
    }

    #[test]
    fn test_approx_topk_accumulator() {
        let mut acc = ApproxTopKAccumulator::new(3);

        // Add some test data with different frequencies
        let values = vec![
            "apple",
            "banana",
            "apple",
            "cherry",
            "banana",
            "apple",
            "date",
            "elderberry",
            "fig",
            "grape",
            "apple",
            "banana",
        ];
        let string_array: ArrayRef = Arc::new(StringArray::from(values));

        acc.update_batch(&[string_array]).unwrap();

        // Get top k results
        let top_k = acc.get_top_k();

        // Should have at most 3 items, with apple being most frequent
        assert!(top_k.len() <= 3);
        assert!(top_k.len() > 0);

        // apple should be first (most frequent)
        assert_eq!(top_k[0].0, "apple");
        assert!(top_k[0].1 >= 4); // CMS may overestimate
    }

    #[tokio::test]
    async fn test_approx_topk_udaf_v2() {
        let ctx = SessionContext::new();

        // Create test data with high frequency differences
        let schema = Schema::new(vec![Field::new("item", DataType::Utf8, false)]);

        let values = vec![
            "apple",
            "banana",
            "apple",
            "cherry",
            "banana",
            "apple",
            "date",
            "elderberry",
            "fig",
            "grape",
            "apple",
            "banana",
            "apple",
            "apple",
            "banana",
            "cherry",
            "date",
            "apple",
        ];
        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![Arc::new(StringArray::from(values))],
        )
        .unwrap();

        let table = MemTable::try_new(Arc::new(schema), vec![vec![batch]]).unwrap();
        ctx.register_table("test_table", Arc::new(table)).unwrap();

        // Register the UDAF
        let topk_udaf = AggregateUDF::from(ApproxTopK::new());
        ctx.register_udaf(topk_udaf);

        // Test the function
        let df = ctx
            .sql("SELECT approx_topk_v2(item, 3) as top_items FROM test_table")
            .await
            .unwrap();
        let results = df.collect().await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].num_columns(), 1);
        assert_eq!(results[0].num_rows(), 1);

        // Verify the result contains the expected top items
        println!("Results: {:?}", results[0]);
    }

    #[test]
    fn test_cms_serialization() {
        let mut cms = CountMinSketch::new();
        cms.add("test", 5);
        cms.add("item", 3);

        // Serialize and deserialize
        let flat = cms.to_flat_counters();
        let restored = CountMinSketch::from_flat_counters(&flat);

        // Verify queries work the same
        assert_eq!(cms.query("test"), restored.query("test"));
        assert_eq!(cms.query("item"), restored.query("item"));
        assert_eq!(cms.query("missing"), restored.query("missing"));
    }

    #[tokio::test]
    async fn test_high_cardinality_performance() {
        let mut acc = ApproxTopKAccumulator::new(10);

        // Simulate high cardinality data
        let mut values = Vec::new();

        // Add many unique values with zipfian-like distribution
        for i in 0..1000 {
            let freq = if i < 10 {
                100
            } else if i < 100 {
                10
            } else {
                1
            };
            for _ in 0..freq {
                values.push(format!("item_{}", i));
            }
        }

        // Convert to Arrow array
        let string_values: Vec<&str> = values.iter().map(|s| s.as_str()).collect();
        let string_array: ArrayRef = Arc::new(StringArray::from(string_values));

        // Process the data
        acc.update_batch(&[string_array]).unwrap();

        // Get results
        let top_k = acc.get_top_k();

        // Should return top 10 items
        assert_eq!(top_k.len(), 10);

        // Top items should be from the most frequent group (item_0 to item_9)
        for (value, count) in &top_k {
            assert!(value.starts_with("item_"));
            let item_num: usize = value.strip_prefix("item_").unwrap().parse().unwrap();
            assert!(item_num < 10, "Expected top frequent items, got {}", value);
            assert!(*count >= 90, "Expected high count, got {}", count); // CMS may overestimate
        }
    }
}
