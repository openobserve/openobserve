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
    collections::HashMap,
    fmt::Formatter,
    hash::{BuildHasher, Hash, Hasher},
    sync::Arc,
};

use ahash::RandomState;
use arrow::array::{Array, AsArray, RecordBatch, StringArray, StructArray};
use arrow_schema::{Field, Schema};
use datafusion::{
    arrow::{array::ArrayRef, datatypes::{DataType, Fields}},
    common::{internal_err, not_impl_err, plan_err},
    error::Result,
    logical_expr::{
        function::{AccumulatorArgs, StateFieldsArgs}, 
        utils::format_state_name, 
        Accumulator, 
        AggregateUDFImpl, 
        ColumnarValue, 
        Signature, 
        TypeSignature, 
        Volatility
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
            // Store CMS counters as nested lists
            Field::new(
                format_state_name(args.name, "cms_counters"),
                DataType::List(Arc::new(Field::new(
                    "item", 
                    DataType::List(Arc::new(Field::new("item", DataType::UInt64, true))),
                    true
                ))),
                true,
            ),
            // Store item names
            Field::new(
                format_state_name(args.name, "items"),
                DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
                true,
            ),
            // Store item counts
            Field::new(
                format_state_name(args.name, "counts"),
                DataType::List(Arc::new(Field::new("item", DataType::UInt64, true))),
                true,
            ),
            // Store k parameter
            Field::new(format_state_name(args.name, "k"), DataType::Int64, false),
        ])
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        let k = validate_k_parameter(&args.exprs[1])?;
        
        // 参数设置（可根据数据规模调整）
        let width = 1000; // CMS宽度
        let depth = 5; // CMS深度

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

// ================== Count-Min Sketch 核心结构 ==================
#[derive(Clone, Debug)]
struct CountMinSketch {
    width: usize,              // 桶的数量 (b)
    depth: usize,              // 哈希函数的数量 (ℓ)
    counters: Vec<Vec<u64>>,   // 计数器矩阵 [depth][width]
    hashers: Vec<RandomState>, // 哈希函数集合
}

impl CountMinSketch {
    fn new(width: usize, depth: usize) -> Self {
        // 创建深度个独立的哈希函数
        let hashers = (0..depth).map(|_| RandomState::new()).collect::<Vec<_>>();

        // 初始化计数器矩阵
        let counters = vec![vec![0; width]; depth];

        Self {
            width,
            depth,
            counters,
            hashers,
        }
    }

    // 增加元素的计数
    fn increment<T: Hash>(&mut self, item: &T) {
        for (i, hasher) in self.hashers.iter().enumerate() {
            let mut h = hasher.build_hasher();
            item.hash(&mut h);
            let hash = h.finish();
            let index = (hash % self.width as u64) as usize;
            self.counters[i][index] += 1;
        }
    }

    // 估算元素的频率
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

    // 合并两个CMS（用于分布式计算）
    #[allow(dead_code)]
    fn merge(&mut self, other: &Self) -> Result<()> {
        if self.width != other.width || self.depth != other.depth {
            return internal_err!("CMS dimensions mismatch during merge");
        }

        for i in 0..self.depth {
            for j in 0..self.width {
                self.counters[i][j] += other.counters[i][j];
            }
        }
        Ok(())
    }
}

// ================== UDAF 实现 ==================
#[derive(Debug)]
struct ApproxTopKAccumulator {
    cms: CountMinSketch,
    k: usize,
    items: HashMap<String, u64>, // 跟踪候选元素
}

impl ApproxTopKAccumulator {
    fn new(k: usize, width: usize, depth: usize) -> Self {
        Self {
            cms: CountMinSketch::new(width, depth),
            k,
            items: HashMap::new(),
        }
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

    fn convert_to_counts(values: &ArrayRef) -> Result<Vec<u64>> {
        let array = values.as_primitive::<arrow::datatypes::UInt64Type>();
        Ok(array.iter().map(|v| v.unwrap_or_default()).collect())
    }

    // Helper method to merge CMS counters from serialized state
    fn merge_cms_counters(&mut self, cms_counters_array: &ArrayRef) -> Result<()> {
        let outer_list = cms_counters_array.as_list::<i32>();
        
        for (row_idx, row_opt) in outer_list.iter().enumerate() {
            if let Some(row_array) = row_opt {
                let row_counts = Self::convert_to_counts(&row_array)?;
                
                // Ensure we don't exceed the CMS dimensions
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
    // 更新状态（处理新数据）
    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        let strings = Self::convert_to_strings(&values[0])?;

        for value in strings {
            // 更新CMS
            self.cms.increment(&value);

            // 更新候选集合
            let count = self.cms.estimate(&value);
            self.items.insert(value, count);
        }
        Ok(())
    }

    // 合并分布式结果
    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        if states.is_empty() {
            return Ok(());
        }

        // state[0] = cms_counters (nested lists)
        // state[1] = items (list of strings)
        // state[2] = counts (list of uint64)
        // state[3] = k parameter

        let cms_counters_list = states[0].as_list::<i32>();
        let items_list = states[1].as_list::<i32>();
        let counts_list = states[2].as_list::<i32>();

        for ((cms_counters_opt, items_opt), counts_opt) in cms_counters_list
            .iter()
            .zip(items_list.iter())
            .zip(counts_list.iter())
        {
            if let (Some(cms_counters_array), Some(items_array), Some(counts_array)) =
                (cms_counters_opt, items_opt, counts_opt)
            {
                // 1. Merge CMS counters
                self.merge_cms_counters(&cms_counters_array)?;

                // 2. Merge items and counts
                let items = Self::convert_to_strings(&items_array)?;
                let counts = Self::convert_to_counts(&counts_array)?;

                for (item, count) in items.into_iter().zip(counts.into_iter()) {
                    // Update local CMS with the item
                    self.cms.increment(&item);
                    
                    // Get the current estimate and use max with incoming count
                    let current_estimate = self.cms.estimate(&item);
                    let final_count = std::cmp::max(current_estimate, count);
                    
                    // Update items HashMap
                    self.items.insert(item, final_count);
                }
            }
        }

        Ok(())
    }



    // 计算最终结果
    fn evaluate(&mut self) -> Result<ScalarValue> {
        // 获取topK元素
        let mut items: Vec<_> = self.items.iter().collect();
        items.sort_by(|a, b| b.1.cmp(a.1));
        let topk = items.into_iter().take(self.k).collect::<Vec<_>>();

        if topk.is_empty() {
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

        // 转换为DataFusion可识别的结构
        let values: Vec<Option<String>> = topk.iter().map(|(k, _)| Some(k.to_string())).collect();
        let counts: Vec<Option<i64>> = topk.iter().map(|(_, v)| Some(**v as i64)).collect();

        let value_array = Arc::new(StringArray::from(values));
        let count_array = Arc::new(arrow::array::Int64Array::from(counts));

        let struct_array = StructArray::new(
            Fields::from(vec![
                Field::new("value", DataType::Utf8, false),
                Field::new("count", DataType::Int64, false),
            ]),
            vec![value_array as ArrayRef, count_array as ArrayRef],
            None,
        );

        Ok(ScalarValue::List(ScalarValue::new_list_nullable(
            &topk
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

    // 状态表示（用于分布式合并）
    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        // Simplified state serialization
        let topk: Vec<_> = {
            let mut items: Vec<_> = self.items.iter().collect();
            items.sort_by(|a, b| b.1.cmp(a.1));
            items.into_iter().take(self.k).collect()
        };

        // Serialize CMS counters (simplified)
        let cms_rows: Vec<ScalarValue> = self.cms.counters
            .iter()
            .map(|row| {
                ScalarValue::List(ScalarValue::new_list_nullable(
                    &row.iter().map(|&v| ScalarValue::UInt64(Some(v))).collect::<Vec<_>>(),
                    &DataType::UInt64,
                ))
            })
            .collect();

        let cms_counters = ScalarValue::List(ScalarValue::new_list_nullable(
            &cms_rows,
            &DataType::List(Arc::new(Field::new("item", DataType::UInt64, true))),
        ));

        // Serialize items
        let items = ScalarValue::List(ScalarValue::new_list_nullable(
            &topk.iter().map(|(k, _)| ScalarValue::Utf8(Some(k.to_string()))).collect::<Vec<_>>(),
            &DataType::Utf8,
        ));

        // Serialize counts
        let counts = ScalarValue::List(ScalarValue::new_list_nullable(
            &topk.iter().map(|(_, v)| ScalarValue::UInt64(Some(**v))).collect::<Vec<_>>(),
            &DataType::UInt64,
        ));

        let k_scalar = ScalarValue::Int64(Some(self.k as i64));

        Ok(vec![cms_counters, items, counts, k_scalar])
    }

    fn size(&self) -> usize {
        self.cms.width * self.cms.depth * 8 + self.items.len() * 32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow::array::StringArray;
    use datafusion::{datasource::MemTable, logical_expr::AggregateUDF, prelude::SessionContext};

    #[test]
    fn test_count_min_sketch() {
        let mut cms = CountMinSketch::new(100, 5);
        
        // Add some items
        cms.increment(&"apple");
        cms.increment(&"banana");
        cms.increment(&"apple");
        
        // Verify estimates
        let apple_count = cms.estimate(&"apple");
        let banana_count = cms.estimate(&"banana");
        let cherry_count = cms.estimate(&"cherry");
        
        assert!(apple_count >= 2); // CMS may overestimate
        assert!(banana_count >= 1);
        assert_eq!(cherry_count, 0);
    }

    #[test]
    fn test_approx_topk_v4_accumulator() {
        let mut acc = ApproxTopKAccumulator::new(3, 100, 5);

        // Add some test data
        let values = vec!["apple", "banana", "apple", "cherry", "banana", "apple"];
        let string_array: ArrayRef = Arc::new(StringArray::from(values));

        acc.update_batch(&[string_array]).unwrap();

        // Evaluate should return top 3 by frequency
        let result = acc.evaluate().unwrap();

        // apple: 3, banana: 2, cherry: 1
        assert!(matches!(result, ScalarValue::List(_)));
    }

    #[tokio::test]
    async fn test_approx_topk_v4_udaf() {
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
            .sql("SELECT approx_topk_v4(item, 2) as top_items FROM test_table")
            .await
            .unwrap();
        let results = df.collect().await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].num_columns(), 1);
        assert_eq!(results[0].num_rows(), 1);
    }

    #[test]
    fn test_merge_batch_functionality() {
        let mut acc = ApproxTopKAccumulator::new(3, 100, 5);

        // Add some data to accumulator
        let values = vec!["apple", "banana", "apple", "cherry"];
        let string_array: ArrayRef = Arc::new(StringArray::from(values));
        acc.update_batch(&[string_array]).unwrap();

        // Test that merge_batch handles empty states correctly
        let empty_states: Vec<ArrayRef> = vec![];
        let result = acc.merge_batch(&empty_states);
        assert!(result.is_ok());

        // Test final evaluation works after merge_batch call
        let result = acc.evaluate().unwrap();
        assert!(matches!(result, ScalarValue::List(_)));

        // Test that state() method works (needed for distributed aggregation)
        let state = acc.state().unwrap();
        assert_eq!(state.len(), 4); // cms_counters, items, counts, k
        
        // Verify state types
        assert!(matches!(state[0], ScalarValue::List(_))); // cms_counters
        assert!(matches!(state[1], ScalarValue::List(_))); // items
        assert!(matches!(state[2], ScalarValue::List(_))); // counts
        assert!(matches!(state[3], ScalarValue::Int64(_))); // k
    }
}
