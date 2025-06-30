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

use std::{collections::HashMap, fmt::Formatter, sync::Arc};

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

const APPROX_TOPK: &str = "approx_topk_v5";

/// Approximate TopK UDAF that returns the top K elements by frequency.
///
/// Usage: approx_topk(field, k)
/// - field: the field to find top k values from
/// - k: number of top elements to return
///
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
        f.debug_struct("ApproxTopKV5")
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
            // Store values as list of strings
            Field::new(
                format_state_name(args.name, "values"),
                DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
                true,
            ),
            // Store counts as list of int64
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

/// Memory-efficient accumulator that only tracks top-K candidates
/// Uses a min-heap to maintain only the most frequent items
struct ApproxTopKAccumulator {
    // Only keep track of top candidates - LIMITED SIZE!
    candidates: HashMap<String, i64>,
    k: usize,
    // Memory management
    max_candidates: usize,    // Maximum candidates to keep in memory
    min_count_threshold: i64, // Minimum count to be considered
}

impl std::fmt::Debug for ApproxTopKAccumulator {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ApproxTopKAccumulator(k={}, candidates={})",
            self.k,
            self.candidates.len()
        )
    }
}

impl ApproxTopKAccumulator {
    fn new(k: usize) -> Self {
        Self::with_memory_limit(k, None)
    }

    fn with_memory_limit(k: usize, max_candidates: Option<usize>) -> Self {
        // Cap at at least 2*k for safety
        let default_max = (k * 10).min(1000).max(k * 2);
        Self {
            candidates: HashMap::new(),
            k,
            max_candidates: max_candidates.unwrap_or(default_max),
            min_count_threshold: 1,
        }
    }

    /// Memory-efficient update that only keeps top candidates
    fn update_with_pruning(&mut self, value: String) {
        // Update count
        let count = self.candidates.entry(value).or_insert(0);
        *count += 1;

        // Periodically prune low-frequency items to save memory
        if self.candidates.len() > self.max_candidates {
            self.prune_low_frequency_items();
        }
    }

    /// Remove low-frequency items to keep memory usage bounded
    fn prune_low_frequency_items(&mut self) {
        let current_size = self.candidates.len();
        let target_size = (self.max_candidates / 2).max(self.k);

        if current_size <= target_size {
            return; // No need to prune
        }

        // Collect items with their counts
        let mut items: Vec<(String, i64)> = self
            .candidates
            .iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect();

        // Sort by count descending, then by key for deterministic results
        items.sort_by(|a, b| match b.1.cmp(&a.1) {
            std::cmp::Ordering::Equal => a.0.cmp(&b.0),
            other => other,
        });

        // Keep only the top target_size items
        self.candidates.clear();
        for (key, count) in items.into_iter().take(target_size) {
            self.candidates.insert(key, count);
        }

        // Update minimum threshold to the lowest count we're keeping
        if let Some(min_count) = self.candidates.values().min() {
            self.min_count_threshold = (*min_count).max(self.min_count_threshold);
        }
    }

    /// Get the top k elements as (value, count) pairs sorted by count descending
    fn get_top_k(&self, n: usize) -> Vec<(String, i64)> {
        let mut items: Vec<_> = self
            .candidates
            .iter()
            .map(|(v, c)| (v.clone(), *c))
            .collect();

        // Sort by count descending, then by value ascending for deterministic results
        items.sort_by(|a, b| match b.1.cmp(&a.1) {
            std::cmp::Ordering::Equal => a.0.cmp(&b.0),
            other => other,
        });

        items.into_iter().take(n).collect()
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
        let pairs: Vec<_> = self.get_top_k(self.max_candidates);

        let values = ScalarValue::List(ScalarValue::new_list_nullable(
            &pairs
                .iter()
                .map(|(v, _)| ScalarValue::Utf8(Some(v.to_string())))
                .collect::<Vec<ScalarValue>>(),
            &DataType::Utf8,
        ));

        let counts = ScalarValue::List(ScalarValue::new_list_nullable(
            &pairs
                .iter()
                .map(|(_, c)| ScalarValue::Int64(Some(*c)))
                .collect::<Vec<ScalarValue>>(),
            &DataType::Int64,
        ));

        let k_scalar = ScalarValue::Int64(Some(self.k as i64));

        Ok(vec![values, counts, k_scalar])
    }

    fn evaluate(&mut self) -> Result<ScalarValue> {
        let top_k = self.get_top_k(self.k);

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
        // Estimate memory usage:
        // - HashMap overhead + String keys + i64 values
        // - Average string length ~20 bytes + HashMap overhead ~40 bytes per entry
        self.candidates.len() * 60
    }

    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        let strings = Self::convert_to_strings(&values[0])?;

        // Count each string value
        for string_val in strings {
            self.update_with_pruning(string_val);
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

                // Merge the counts from this state
                for (value, count) in values.into_iter().zip(counts.into_iter()) {
                    *self.candidates.entry(value).or_insert(0) += count;
                }

                // Check if we need to prune after merging
                if self.candidates.len() > self.max_candidates {
                    self.prune_low_frequency_items();
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
    fn test_approx_topk_accumulator() {
        let mut acc = ApproxTopKAccumulator::new(3);

        // Add some test data
        let values = vec!["apple", "banana", "apple", "cherry", "banana", "apple"];
        let string_array: ArrayRef = Arc::new(StringArray::from(values));

        acc.update_batch(&[string_array]).unwrap();

        // Evaluate should return top 3 by frequency
        let result = acc.evaluate().unwrap();

        // apple: 3, banana: 2, cherry: 1
        assert!(matches!(result, ScalarValue::List(_)));
    }

    #[test]
    fn test_memory_efficient_pruning() {
        // Test that the accumulator prunes low-frequency items to save memory
        let mut acc = ApproxTopKAccumulator::with_memory_limit(3, Some(20)); // Small limit for testing

        // Add many different items with low frequency
        for i in 0..100 {
            let item = format!("low_freq_{}", i);
            let array: ArrayRef = Arc::new(StringArray::from(vec![item.as_str()]));
            acc.update_batch(&[array]).unwrap();
        }

        // Should have pruned significantly
        assert!(
            acc.candidates.len() < 100,
            "Should prune low-frequency items"
        );

        // Add some high-frequency items
        for _ in 0..15 {
            let array: ArrayRef = Arc::new(StringArray::from(vec!["very_frequent"]));
            acc.update_batch(&[array]).unwrap();
        }

        for _ in 0..8 {
            let array: ArrayRef = Arc::new(StringArray::from(vec!["medium_frequent"]));
            acc.update_batch(&[array]).unwrap();
        }

        // Get top results
        let top_k = acc.get_top_k(acc.k);
        assert!(!top_k.is_empty());

        // Most frequent items should be at the top
        assert_eq!(top_k[0].0, "very_frequent");
        assert_eq!(top_k[0].1, 15);

        if top_k.len() > 1 {
            assert_eq!(top_k[1].0, "medium_frequent");
            assert_eq!(top_k[1].1, 8);
        }

        // Memory usage should be reasonable
        assert!(acc.candidates.len() <= 50, "Memory usage should be bounded");
    }

    #[tokio::test]
    async fn test_approx_topk_udaf_v5() {
        let ctx = SessionContext::new();

        // Create test data
        let schema = Schema::new(vec![Field::new("item", DataType::Utf8, false)]);

        let values = vec![
            "apple", "banana", "apple", "cherry", "banana", "apple", "date",
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
            .sql("SELECT approx_topk_v5(item, 2) as top_items FROM test_table")
            .await
            .unwrap();
        let results = df.collect().await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].num_columns(), 1);
        assert_eq!(results[0].num_rows(), 1);
    }
}
