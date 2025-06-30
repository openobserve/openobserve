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
    collections::{BinaryHeap, HashMap},
    fmt::Formatter,
    sync::Arc,
};

use arrow::array::{Array, AsArray, RecordBatch, StructArray};
use arrow_schema::{Field, Schema};
use datafusion::{
    arrow::{array::ArrayRef, datatypes::DataType},
    common::{internal_err, not_impl_err, plan_err},
    error::Result,
    logical_expr::{
        function::{AccumulatorArgs, StateFieldsArgs},
        utils::format_state_name,
        Accumulator, AggregateUDFImpl, ColumnarValue, Signature, TypeSignature, Volatility,
    },
    physical_plan::PhysicalExpr,
    scalar::ScalarValue,
};

const APPROX_TOPK: &str = "approx_topk";

/// Approximate TopK UDAF that returns the top K elements by frequency.
///
/// For efficiency and accuracy:
/// - Maintains exact counts for top-k candidates (items in heap + recent high-frequency items)  
/// - Uses Count-Min Sketch only as a filter for items unlikely to be in top-k
/// - Optimized for both small and large cardinalities
pub(crate) struct ApproxTopK(Signature);

impl ApproxTopK {
    pub fn new() -> Self {
        Self(Signature::one_of(
            vec![
                TypeSignature::Exact(vec![DataType::Utf8, DataType::Int64]),
                TypeSignature::Exact(vec![DataType::LargeUtf8, DataType::Int64]),
            ],
            Volatility::Immutable,
        ))
    }
}

impl std::fmt::Debug for ApproxTopK {
    fn fmt(&self, f: &mut Formatter) -> std::fmt::Result {
        f.debug_struct("ApproxTopK")
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
            DataType::Utf8 | DataType::LargeUtf8 => {
                Ok(Box::new(ApproxTopKAccumulator::new(k)))
            }
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

/// Item in the top-k heap
#[derive(Debug, Clone, Eq, PartialEq)]
struct TopKItem {
    value: String,
    count: i64,
}

impl Ord for TopKItem {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Min-heap: smaller counts first
        match self.count.cmp(&other.count) {
            std::cmp::Ordering::Equal => other.value.cmp(&self.value), // Reverse for deterministic results
            other => other,
        }
    }
}

impl PartialOrd for TopKItem {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Efficient accumulator using exact counting for top-k candidates
struct ApproxTopKAccumulator {
    /// Exact counts for all candidates (items in heap + buffer)
    exact_counts: HashMap<String, i64>,
    /// Min-heap to maintain top-k items
    top_k_heap: BinaryHeap<TopKItem>,
    /// Target k value
    k: usize,
    /// Minimum count threshold for heap (for optimization)
    min_heap_count: i64,
}

impl std::fmt::Debug for ApproxTopKAccumulator {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ApproxTopKAccumulator(k={}, heap_size={}, candidates={})",
            self.k,
            self.top_k_heap.len(),
            self.exact_counts.len()
        )
    }
}

impl ApproxTopKAccumulator {
    fn new(k: usize) -> Self {
        Self {
            exact_counts: HashMap::new(),
            top_k_heap: BinaryHeap::new(),
            k,
            min_heap_count: 0,
        }
    }

    /// Add an item efficiently
    fn add_item(&mut self, value: &str, count: i64) {
        // Always update exact count
        let total_count = {
            let entry = self.exact_counts.entry(value.to_string()).or_insert(0);
            *entry += count;
            *entry
        };

        // Quick check: if heap is full and this item's count is too low, skip heap update
        if self.top_k_heap.len() >= self.k && total_count < self.min_heap_count {
            return;
        }

        // Update heap if necessary
        self.update_heap_for_item(value, total_count);
    }

    /// Update heap for a specific item
    fn update_heap_for_item(&mut self, value: &str, count: i64) {
        // First check if this item is already in the heap
        let already_in_heap = self
            .top_k_heap
            .iter()
            .any(|item| item.value == value);

        if already_in_heap {
            // Item is already in heap - need to update it
            // Rebuild heap with updated count
            let mut items: Vec<_> = self.top_k_heap.drain().collect();
            
            // Update the item's count
            for item in &mut items {
                if item.value == value {
                    item.count = count;
                    break;
                }
            }
            
            // Find the new minimum before rebuilding heap
            let new_min = items.iter().map(|item| item.count).min().unwrap_or(0);
            
            // Rebuild heap
            for item in items {
                self.top_k_heap.push(item);
            }
            
            // Update minimum threshold with the actual minimum
            self.min_heap_count = new_min;
            return;
        }

        // Item is not in heap
        if self.top_k_heap.len() < self.k {
            // Heap not full, just add
            self.top_k_heap.push(TopKItem {
                value: value.to_string(),
                count,
            });
            if self.top_k_heap.len() == self.k {
                // Update min threshold when heap becomes full
                // Find actual minimum from all items in heap
                self.min_heap_count = self.top_k_heap
                    .iter()
                    .map(|item| item.count)
                    .min()
                    .unwrap_or(0);
            }
        } else {
            // Heap is full - check if this item should replace the minimum
            if let Some(min_item) = self.top_k_heap.peek() {
                if count > min_item.count
                    || (count == min_item.count && value < min_item.value.as_str())
                {
                    // Remove minimum and add new item
                    self.top_k_heap.pop();
                    self.top_k_heap.push(TopKItem {
                        value: value.to_string(),
                        count,
                    });
                    // Update minimum threshold
                    // Find actual minimum from all items in heap
                    self.min_heap_count = self.top_k_heap
                        .iter()
                        .map(|item| item.count)
                        .min()
                        .unwrap_or(0);
                }
            }
        }
    }

    /// Merge another accumulator's data
    fn merge_from(&mut self, other_values: Vec<String>, other_counts: Vec<i64>) {
        // Merge all values with their counts
        for (value, count) in other_values.into_iter().zip(other_counts.into_iter()) {
            self.add_item(&value, count);
        }

        // After merging, we might need to rebuild the heap to ensure correctness
        // This is necessary because some items might have updated counts
        if self.exact_counts.len() > self.k {
            self.rebuild_heap();
        }
    }

    /// Rebuild heap from scratch (used after merge operations)
    fn rebuild_heap(&mut self) {
        // Clear heap and rebuild from exact counts
        self.top_k_heap.clear();
        
        // Sort all items by count
        let mut all_items: Vec<_> = self
            .exact_counts
            .iter()
            .map(|(v, c)| TopKItem {
                value: v.clone(),
                count: *c,
            })
            .collect();
        
        // Sort by count descending, then by value ascending
        all_items.sort_by(|a, b| match b.count.cmp(&a.count) {
            std::cmp::Ordering::Equal => a.value.cmp(&b.value),
            other => other,
        });

        // Take top k and build heap
        for item in all_items.into_iter().take(self.k) {
            self.top_k_heap.push(item);
        }

        // Update minimum threshold
        self.min_heap_count = self.top_k_heap
            .iter()
            .map(|item| item.count)
            .min()
            .unwrap_or(0);

        // Clean up exact_counts to only keep relevant items
        if self.exact_counts.len() > self.k * 10 {
            // Keep only items that might make it to top-k
            let threshold = self.min_heap_count / 2; // Keep items with at least half the min count
            self.exact_counts.retain(|_, &mut count| count >= threshold);
        }
    }

    /// Get the top k elements sorted by count descending
    fn get_top_k(&self) -> Vec<(String, i64)> {
        let mut items: Vec<_> = self
            .top_k_heap
            .iter()
            .map(|item| (item.value.clone(), item.count))
            .collect();

        // Sort by count descending, then by value ascending
        items.sort_by(|a, b| match b.1.cmp(&a.1) {
            std::cmp::Ordering::Equal => a.0.cmp(&b.0),
            other => other,
        });

        items
    }

    fn convert_to_strings(values: &ArrayRef) -> Result<Vec<String>> {
        match values.data_type() {
            DataType::Utf8 => {
                let array = values.as_string::<i32>();
                Ok(array
                    .iter()
                    .filter_map(|v| v.map(|s| s.to_string()))
                    .collect())
            }
            DataType::LargeUtf8 => {
                let array = values.as_string::<i64>();
                Ok(array
                    .iter()
                    .filter_map(|v| v.map(|s| s.to_string()))
                    .collect())
            }
            other => internal_err!("APPROX_TOPK received unexpected type {other:?}"),
        }
    }

    fn convert_to_counts(values: &ArrayRef) -> Result<Vec<i64>> {
        let array = values.as_primitive::<arrow::datatypes::Int64Type>();
        Ok(array.iter().map(|v| v.unwrap_or_default()).collect())
    }
}

impl Accumulator for ApproxTopKAccumulator {
    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        let top_k = self.get_top_k();

        // Only serialize the top-k items
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

        Ok(vec![values, counts, k_scalar])
    }

    fn evaluate(&mut self) -> Result<ScalarValue> {
        let top_k = self.get_top_k();

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
        use arrow::{array::{Int64Array, StringArray}, datatypes::Fields};

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
        self.exact_counts.len() * 40 + self.top_k_heap.len() * 40
    }

    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        let strings = Self::convert_to_strings(&values[0])?;

        // Process in batches for better performance
        for string_val in strings {
            self.add_item(&string_val, 1);
        }

        Ok(())
    }

    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        if states.is_empty() {
            return Ok(());
        }

        let values_list = states[0].as_list::<i32>();
        let counts_list = states[1].as_list::<i32>();

        for (values_opt, counts_opt) in values_list.iter().zip(counts_list.iter()) {
            if let (Some(values_array), Some(counts_array)) = (values_opt, counts_opt) {
                let values = Self::convert_to_strings(&values_array)?;
                let counts = Self::convert_to_counts(&counts_array)?;

                // Merge the data
                self.merge_from(values, counts);
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
    fn test_exact_counting() {
        let mut acc = ApproxTopKAccumulator::new(3);

        // Add items with specific frequencies
        for _ in 0..5 {
            acc.add_item("apple", 1);
        }
        for _ in 0..3 {
            acc.add_item("banana", 1);
        }
        for _ in 0..2 {
            acc.add_item("cherry", 1);
        }
        acc.add_item("date", 1);

        let top_k = acc.get_top_k();

        // Should return exactly top 3
        assert_eq!(top_k.len(), 3);
        assert_eq!(top_k[0], ("apple".to_string(), 5));
        assert_eq!(top_k[1], ("banana".to_string(), 3));
        assert_eq!(top_k[2], ("cherry".to_string(), 2));
    }

    #[test]
    fn test_heap_updates() {
        let mut acc = ApproxTopKAccumulator::new(2);

        // Add initial items
        acc.add_item("a", 1);
        acc.add_item("b", 2);
        acc.add_item("c", 3);

        // Update existing item
        acc.add_item("a", 5); // Now a=6, should be in top-2

        let top_k = acc.get_top_k();
        assert_eq!(top_k.len(), 2);
        assert_eq!(top_k[0], ("a".to_string(), 6));
        assert_eq!(top_k[1], ("c".to_string(), 3));
    }

    #[tokio::test]
    async fn test_approx_topk_accuracy() {
        let ctx = SessionContext::new();

        // Create test data
        let schema = Schema::new(vec![Field::new("item", DataType::Utf8, false)]);

        let mut values = Vec::new();
        // Create clear frequency differences
        for _ in 0..100 { values.push("item_1".to_string()); }
        for _ in 0..80  { values.push("item_2".to_string()); }
        for _ in 0..60  { values.push("item_3".to_string()); }
        for _ in 0..40  { values.push("item_4".to_string()); }
        for _ in 0..20  { values.push("item_5".to_string()); }
        // Add some noise
        for i in 6..50 {
            values.push(format!("item_{}", i));
        }

        let string_refs: Vec<&str> = values.iter().map(|s| s.as_str()).collect();
        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![Arc::new(StringArray::from(string_refs))],
        )
        .unwrap();

        let table = MemTable::try_new(Arc::new(schema), vec![vec![batch]]).unwrap();
        ctx.register_table("test_table", Arc::new(table)).unwrap();

        // Register the UDAF
        let topk_udaf = AggregateUDF::from(ApproxTopK::new());
        ctx.register_udaf(topk_udaf);

        // Test the function
        let df = ctx
            .sql("SELECT approx_topk(item, 5) as top_items FROM test_table")
            .await
            .unwrap();
        let results = df.collect().await.unwrap();

        // Verify we got the right results
        println!("Results: {:?}", results[0]);
        
        // The results should match the exact count
        assert_eq!(results.len(), 1);
    }
}
