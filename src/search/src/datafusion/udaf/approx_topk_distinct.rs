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

use std::{fmt::Formatter, sync::Arc};

use arrow::{
    array::{Array, AsArray, BinaryArray, LargeStringArray, RecordBatch, StructArray, UInt64Array},
    datatypes::Fields,
};
use datafusion::{
    arrow::{
        array::ArrayRef,
        datatypes::{DataType, Field, FieldRef, Schema},
    },
    common::{internal_err, not_impl_err, plan_err},
    error::Result,
    functions_aggregate::approx_distinct::ApproxDistinct,
    logical_expr::{
        Accumulator, AggregateUDFImpl, ColumnarValue, Signature, TypeSignature, Volatility,
        function::{AccumulatorArgs, StateFieldsArgs},
        utils::format_state_name,
    },
    physical_plan::{PhysicalExpr, expressions::col},
    scalar::ScalarValue,
};
use hashbrown::HashMap;

const APPROX_TOPK_DISTINCT: &str = "approx_topk_distinct";

/// Approximate TopK UDAF that returns the top K elements by distinct count of another field.
///
/// Usage: approx_topk_distinct(top_field, value_field, k, [cap])
/// - top_field: the field to find top k values from
/// - value_field: the field to count distinct values for
/// - k: number of top elements to return
/// - cap: optional maximum number of candidates to keep in memory (default: max(k*4, 1000))
///
/// This function finds the top K values in top_field, ranked by how many unique values
/// they have in the corresponding value_field. For example:
/// - If you have data with (user_id, session_id) pairs
/// - approx_topk_distinct(user_id, session_id, 10) returns the top 10 users with the most distinct
///   sessions
///
/// Uses HyperLogLog for exact distinct counting (memory-efficient for reasonable cardinalities).
#[derive(Debug, PartialEq, Eq, Hash)]
pub struct ApproxTopKDistinct(Signature);

impl ApproxTopKDistinct {
    pub fn new() -> Self {
        Self(Signature::one_of(
            vec![
                // top_field, value_field, k
                TypeSignature::Exact(vec![DataType::Utf8, DataType::Utf8, DataType::Int64]),
                TypeSignature::Exact(vec![DataType::LargeUtf8, DataType::Utf8, DataType::Int64]),
                TypeSignature::Exact(vec![DataType::Utf8, DataType::LargeUtf8, DataType::Int64]),
                TypeSignature::Exact(vec![
                    DataType::LargeUtf8,
                    DataType::LargeUtf8,
                    DataType::Int64,
                ]),
                // top_field, value_field, k, cap
                TypeSignature::Exact(vec![
                    DataType::Utf8,
                    DataType::Utf8,
                    DataType::Int64,
                    DataType::Int64,
                ]),
                TypeSignature::Exact(vec![
                    DataType::LargeUtf8,
                    DataType::Utf8,
                    DataType::Int64,
                    DataType::Int64,
                ]),
                TypeSignature::Exact(vec![
                    DataType::Utf8,
                    DataType::LargeUtf8,
                    DataType::Int64,
                    DataType::Int64,
                ]),
                TypeSignature::Exact(vec![
                    DataType::LargeUtf8,
                    DataType::LargeUtf8,
                    DataType::Int64,
                    DataType::Int64,
                ]),
            ],
            Volatility::Immutable,
        ))
    }
}

impl Default for ApproxTopKDistinct {
    fn default() -> Self {
        Self::new()
    }
}

impl AggregateUDFImpl for ApproxTopKDistinct {
    fn name(&self) -> &str {
        APPROX_TOPK_DISTINCT
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
                            Field::new("value", DataType::LargeUtf8, false),
                            Field::new("count", DataType::UInt64, false),
                        ]
                        .into(),
                    ),
                    true,
                ))))
            }
            _ => plan_err!("approx_topk_distinct requires string input types"),
        }
    }

    fn state_fields(&self, args: StateFieldsArgs) -> Result<Vec<FieldRef>> {
        Ok(vec![
            // Store top_field values as list of strings
            Arc::new(Field::new(
                format_state_name(args.name, "top_values"),
                DataType::List(Arc::new(Field::new("item", DataType::LargeUtf8, true))),
                true,
            )),
            // Store distinct values as list of list of HLL registers
            Arc::new(Field::new(
                format_state_name(args.name, "hll_registers"),
                DataType::List(Arc::new(Field::new("item", DataType::LargeBinary, true))),
                true,
            )),
            // Store k parameter
            Arc::new(Field::new(
                format_state_name(args.name, "k"),
                DataType::Int64,
                false,
            )),
        ])
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        let k = validate_k_parameter(&args.exprs[2])?;
        let cap = if args.exprs.len() > 3 {
            Some(validate_cap_parameter(&args.exprs[3])?)
        } else {
            None
        };

        let top_field_data_type = args.exprs[0].data_type(args.schema)?;
        let value_field_data_type = args.exprs[1].data_type(args.schema)?;

        match (&top_field_data_type, &value_field_data_type) {
            (DataType::Utf8 | DataType::LargeUtf8, DataType::Utf8 | DataType::LargeUtf8) => {
                Ok(Box::new(ApproxTopKDistinctAccumulator::new(k, cap)))
            }
            (other_top, other_value) => {
                not_impl_err!(
                    "Support for 'APPROX_TOPK_DISTINCT' for data types {other_top:?}, {other_value:?} is not implemented"
                )
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
                return plan_err!(
                    "k parameter for 'APPROX_TOPK_DISTINCT' must be positive, got {value}"
                );
            }
            value as usize
        }
        ColumnarValue::Scalar(other) => {
            return not_impl_err!(
                "k parameter for 'APPROX_TOPK_DISTINCT' must be Int64 literal (got {:?})",
                other.data_type()
            );
        }
        _ => {
            return internal_err!("Expected scalar value for k parameter");
        }
    };

    Ok(k)
}

fn validate_cap_parameter(expr: &Arc<dyn PhysicalExpr>) -> Result<usize> {
    let empty_schema = Arc::new(Schema::empty());
    let batch = RecordBatch::new_empty(Arc::clone(&empty_schema));

    let cap = match expr.evaluate(&batch)? {
        ColumnarValue::Scalar(ScalarValue::Int64(Some(value))) => {
            if value <= 0 {
                return plan_err!(
                    "cap parameter for 'APPROX_TOPK_DISTINCT' must be positive, got {value}"
                );
            }
            value as usize
        }
        ColumnarValue::Scalar(other) => {
            return not_impl_err!(
                "cap parameter for 'APPROX_TOPK_DISTINCT' must be Int64 literal (got {:?})",
                other.data_type()
            );
        }
        _ => {
            return internal_err!("Expected scalar value for cap parameter");
        }
    };

    Ok(cap)
}

/// Accumulator that tracks top K values by distinct count of another field
/// Uses HyperLogLog for exact distinct counting (good for reasonable cardinalities)
struct ApproxTopKDistinctAccumulator {
    // Map from top_field value to HyperLogLog accumulator
    candidates: HashMap<String, Box<dyn Accumulator>>,
    k: usize,
    // Memory management
    max_candidates: usize,    // Maximum candidates to keep in memory
    min_count_threshold: u64, // Minimum count to be considered
}

impl std::fmt::Debug for ApproxTopKDistinctAccumulator {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ApproxTopKDistinctAccumulator(k={}, candidates={})",
            self.k,
            self.candidates.len()
        )
    }
}

impl ApproxTopKDistinctAccumulator {
    fn new(k: usize, max_candidates: Option<usize>) -> Self {
        // Cap at least k*4 for safety
        let default_max = (k * 4).max(1000);
        let max_candidates = max_candidates.unwrap_or(default_max);
        Self {
            candidates: HashMap::with_capacity(max_candidates),
            k,
            max_candidates,
            min_count_threshold: 0,
        }
    }

    fn new_acc_args() -> Option<Box<dyn Accumulator>> {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "f",
            DataType::LargeUtf8,
            true,
        )]));
        let acc_args = AccumulatorArgs {
            return_field: Arc::new(Field::new("f", DataType::UInt64, true)),
            schema: &schema,
            ignore_nulls: false,
            order_bys: &[],
            is_reversed: false,
            name: "APPROX_DISTINCT(f)",
            is_distinct: false,
            exprs: &[col("f", &schema).unwrap()],
            expr_fields: &[Arc::new(Field::new("f", DataType::LargeUtf8, true))],
        };
        ApproxDistinct::new().accumulator(acc_args).ok()
    }

    /// Memory-efficient update that only keeps top candidates
    fn update_with_pruning(&mut self, value: String, distinct_values: Vec<String>) {
        // Periodically prune low-frequency items to save memory
        if self.candidates.len() >= self.max_candidates {
            self.prune_low_frequency_items();
        }

        // Update count
        self.candidates
            .entry(value)
            .or_insert_with(|| Self::new_acc_args().unwrap())
            .update_batch(&[Arc::new(LargeStringArray::from(distinct_values))])
            .unwrap();
    }

    /// Remove low-frequency items to keep memory usage bounded
    fn prune_low_frequency_items(&mut self) {
        let target_size = (self.max_candidates / 2).max(self.k);

        // Collect items with their counts
        let mut items = self
            .candidates
            .iter_mut()
            .map(|(k, v)| (k, Self::get_distinct_count(v)))
            .collect::<Vec<_>>();

        // Sort by count descending, then by key for deterministic results
        items.sort_by_key(|k| std::cmp::Reverse(k.1));

        // Update minimum threshold to the lowest count we're keeping
        let mut item_iter = items.into_iter().skip(target_size - 1);
        if let Some((_, count)) = item_iter.next() {
            self.min_count_threshold = self.min_count_threshold.max(count);
        }

        // Keep only the top target_size items
        let removed_items = item_iter.map(|(k, _)| k.clone()).collect::<Vec<_>>();
        for key in removed_items {
            self.candidates.remove(&key);
        }
    }

    /// Get top k entries by distinct count
    fn get_top_k(&mut self, n: usize) -> Vec<(String, u64)> {
        let mut items: Vec<(String, u64)> = self
            .candidates
            .iter_mut()
            .map(|(top_value, acc)| (top_value.clone(), Self::get_distinct_count(acc)))
            .collect();

        // Sort by distinct count descending, then by value ascending for deterministic results
        items.sort_by_key(|k| std::cmp::Reverse(k.1));

        items.into_iter().take(n).collect()
    }

    /// Get distinct count from a ApproxDistinct accumulator
    fn get_distinct_count(distinct_acc: &mut Box<dyn Accumulator>) -> u64 {
        distinct_acc
            .evaluate()
            .map(|v| {
                if let ScalarValue::UInt64(Some(count)) = v {
                    count
                } else {
                    0
                }
            })
            .ok()
            .unwrap_or(0)
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
                internal_err!("APPROX_TOPK_DISTINCT received unexpected type {other:?}")
            }
        }
    }

    /// Convert string array to vector of binary arrays
    fn convert_to_binary(values: &ArrayRef) -> Result<Vec<Vec<u8>>> {
        match values.data_type() {
            DataType::Binary => {
                let array = values.as_binary::<i32>();
                Ok(array
                    .iter()
                    .map(|v| v.unwrap_or_default().to_vec())
                    .collect::<Vec<_>>())
            }
            DataType::LargeBinary => {
                let array = values.as_binary::<i64>();
                Ok(array
                    .iter()
                    .map(|v| v.unwrap_or_default().to_vec())
                    .collect::<Vec<_>>())
            }
            other => {
                internal_err!("APPROX_TOPK_DISTINCT received unexpected type {other:?}")
            }
        }
    }

    fn convert_to_large_binary(value: ScalarValue) -> Result<ScalarValue> {
        match value {
            ScalarValue::Binary(v) => Ok(ScalarValue::LargeBinary(v)),
            ScalarValue::LargeBinary(_) => Ok(value),
            other => internal_err!("APPROX_TOPK_DISTINCT received unexpected type {other:?}"),
        }
    }
}

impl Accumulator for ApproxTopKDistinctAccumulator {
    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        // Get top entries for state serialization
        let top_entries = self.get_top_k(self.max_candidates);

        let values: Vec<ScalarValue> = top_entries
            .iter()
            .map(|(v, _)| ScalarValue::LargeUtf8(Some(v.clone())))
            .collect();

        // Serialize HyperLogLog accumulators as lists of binary arrays
        let distinct_values: Vec<ScalarValue> = top_entries
            .iter()
            .filter_map(|(top_val, _)| {
                if let Some(acc) = self.candidates.get_mut(top_val) {
                    acc.state()
                        .ok()
                        .and_then(|mut v| v.pop().map(|v| Self::convert_to_large_binary(v).ok()))
                        .flatten()
                } else {
                    None
                }
            })
            .collect();

        let values_list = ScalarValue::List(ScalarValue::new_list_nullable(
            &values,
            &DataType::LargeUtf8,
        ));

        let distinct_values_list = ScalarValue::List(ScalarValue::new_list_nullable(
            &distinct_values,
            &DataType::LargeBinary,
        ));

        let k_scalar = ScalarValue::Int64(Some(self.k as i64));

        Ok(vec![values_list, distinct_values_list, k_scalar])
    }

    fn evaluate(&mut self) -> Result<ScalarValue> {
        let top_k = self.get_top_k(self.k);

        if top_k.is_empty() {
            return Ok(ScalarValue::List(ScalarValue::new_list_nullable(
                &[],
                &DataType::Struct(
                    vec![
                        Field::new("value", DataType::LargeUtf8, false),
                        Field::new("count", DataType::UInt64, false),
                    ]
                    .into(),
                ),
            )));
        }

        let values: Vec<Option<String>> = top_k.iter().map(|(v, _)| Some(v.clone())).collect();
        let counts: Vec<Option<u64>> = top_k.iter().map(|(_, c)| Some(*c)).collect();

        let value_array = Arc::new(LargeStringArray::from(values));
        let count_array = Arc::new(UInt64Array::from(counts));

        let struct_array = StructArray::new(
            Fields::from(vec![
                Field::new("value", DataType::LargeUtf8, false),
                Field::new("count", DataType::UInt64, false),
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
                    Field::new("value", DataType::LargeUtf8, false),
                    Field::new("count", DataType::UInt64, false),
                ]
                .into(),
            ),
        )))
    }

    fn size(&self) -> usize {
        // Estimate memory usage: HashMap overhead + HLL registers sizes
        let mut total_size = self.candidates.len() * 64; // HashMap overhead
        for (key, acc) in &self.candidates {
            total_size += key.len(); // Key size
            total_size += acc.size(); // HLL registers size
        }
        total_size
    }

    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        let top_field_strings = Self::convert_to_strings(&values[0])?;
        let value_field_strings = Self::convert_to_strings(&values[1])?;

        // Ensure both arrays have the same length
        if top_field_strings.len() != value_field_strings.len() {
            return internal_err!("Top field and value field arrays must have the same length");
        }

        // Partition distinct values for each top_field value
        let mut distinct_values = HashMap::with_capacity(top_field_strings.len());
        for (top_value, distinct_value) in top_field_strings.into_iter().zip(value_field_strings) {
            // self.update_with_pruning(top_value, distinct_value);
            distinct_values
                .entry(top_value)
                .or_insert(vec![])
                .push(distinct_value);
        }

        for (top_value, distinct_values) in distinct_values {
            self.update_with_pruning(top_value, distinct_values);
        }

        Ok(())
    }

    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        if states.is_empty() {
            return Ok(());
        }

        let values_list = states[0].as_list::<i32>();
        let distinct_values_list = states[1].as_list::<i32>();

        for (values_opt, distinct_values_opt) in values_list.iter().zip(distinct_values_list.iter())
        {
            if let (Some(values_array), Some(distinct_values_array)) =
                (values_opt, distinct_values_opt)
            {
                let values = Self::convert_to_strings(&values_array)?;
                let distinct_values = Self::convert_to_binary(&distinct_values_array)?;

                // Merge Hll registers for each top_field value
                for (value, distinct_value) in values.into_iter().zip(distinct_values) {
                    let distinct_acc = self
                        .candidates
                        .entry(value)
                        .or_insert_with(|| Self::new_acc_args().unwrap());

                    // Merge all distinct values
                    distinct_acc
                        .merge_batch(&[Arc::new(BinaryArray::from_vec(vec![&distinct_value]))])
                        .unwrap();
                }
            }

            // Check if we need to prune after merging
            if self.candidates.len() > self.max_candidates {
                self.prune_low_frequency_items();
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
    fn test_approx_topk_distinct_accumulator() {
        let mut acc = ApproxTopKDistinctAccumulator::new(3, None);

        // Test data: (top_field, value_field)
        // user1 has sessions: [session1, session2, session1] -> 2 distinct
        // user2 has sessions: [session3] -> 1 distinct
        // user3 has sessions: [session4, session5, session6] -> 3 distinct

        let top_field_values = vec![
            "user1", "user1", "user1", "user2", "user3", "user3", "user3",
        ];
        let value_field_values = vec![
            "session1", "session2", "session1", "session3", "session4", "session5", "session6",
        ];

        let top_field_array: ArrayRef = Arc::new(StringArray::from(top_field_values));
        let value_field_array: ArrayRef = Arc::new(StringArray::from(value_field_values));

        acc.update_batch(&[top_field_array, value_field_array])
            .unwrap();

        // Get top 3 results
        let top_k = acc.get_top_k(3);

        assert_eq!(top_k.len(), 3);
        assert!(top_k[0].1 >= top_k[1].1); // Results should be sorted by distinct count descending

        // user3 should have the highest distinct count (3)
        // user1 should have 2 distinct sessions
        // user2 should have 1 distinct session
        assert_eq!(top_k[0].0, "user3");
        assert_eq!(top_k[0].1, 3);
        assert_eq!(top_k[1].0, "user1");
        assert_eq!(top_k[1].1, 2);
        assert_eq!(top_k[2].0, "user2");
        assert_eq!(top_k[2].1, 1);
    }

    #[tokio::test]
    async fn test_approx_topk_distinct_udaf() {
        let ctx = SessionContext::new();

        // Create test data
        let schema = Schema::new(vec![
            Field::new("user_id", DataType::Utf8, false),
            Field::new("session_id", DataType::Utf8, false),
        ]);

        let users = vec![
            "user1", "user1", "user1", "user2", "user3", "user3", "user3",
        ];
        let sessions = vec![
            "session1", "session2", "session1", "session3", "session4", "session5", "session6",
        ];

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(StringArray::from(users)),
                Arc::new(StringArray::from(sessions)),
            ],
        )
        .unwrap();

        let table = MemTable::try_new(Arc::new(schema), vec![vec![batch]]).unwrap();
        ctx.register_table("test_table", Arc::new(table)).unwrap();

        // Register the UDAF
        let topk_distinct_udaf = AggregateUDF::from(ApproxTopKDistinct::new());
        ctx.register_udaf(topk_distinct_udaf);

        // Test the function
        let df = ctx
            .sql("SELECT approx_topk_distinct(user_id, session_id, 2) as top_users FROM test_table")
            .await
            .unwrap();
        let results = df.collect().await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].num_columns(), 1);
        assert_eq!(results[0].num_rows(), 1);
    }

    #[tokio::test]
    async fn test_approx_topk_distinct_udaf_with_cap() {
        let ctx = SessionContext::new();

        // Create test data
        let schema = Schema::new(vec![
            Field::new("user_id", DataType::Utf8, false),
            Field::new("session_id", DataType::Utf8, false),
        ]);

        let users = vec!["user1", "user1", "user2", "user3", "user3"];
        let sessions = vec!["session1", "session2", "session3", "session4", "session5"];

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(StringArray::from(users)),
                Arc::new(StringArray::from(sessions)),
            ],
        )
        .unwrap();

        let table = MemTable::try_new(Arc::new(schema), vec![vec![batch]]).unwrap();
        ctx.register_table("test_table", Arc::new(table)).unwrap();

        // Register the UDAF
        let topk_distinct_udaf = AggregateUDF::from(ApproxTopKDistinct::new());
        ctx.register_udaf(topk_distinct_udaf);

        // Test the function with cap parameter
        let df = ctx
            .sql("SELECT approx_topk_distinct(user_id, session_id, 2, 10) as top_users FROM test_table")
            .await
            .unwrap();
        let results = df.collect().await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].num_columns(), 1);
        assert_eq!(results[0].num_rows(), 1);
    }
}
