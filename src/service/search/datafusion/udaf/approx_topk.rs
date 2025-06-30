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

use arrow::{
    array::{Array, Int64Array, Int64Builder, ListArray, RecordBatch, StructArray},
    buffer::OffsetBuffer,
};
use arrow_schema::{DataType, Field, Schema};
use datafusion::{
    arrow::array::ArrayRef,
    common::{internal_err, not_impl_err},
    error::Result,
    logical_expr::{
        Accumulator, AggregateUDFImpl, ColumnarValue, Signature, TypeSignature, Volatility,
        function::{AccumulatorArgs, StateFieldsArgs},
        utils::format_state_name,
    },
    physical_plan::PhysicalExpr,
    scalar::ScalarValue,
};

use crate::service::search::datafusion::udaf::APPROX_TOPK_INPUTS;

const APPROX_TOPK: &str = "approx_topk";

pub(crate) struct ApproxTopk(Signature);

// input: a field, a value n
// output: the field's top n values, the count of the top n values
impl ApproxTopk {
    pub fn new() -> Self {
        let mut variants = Vec::with_capacity(APPROX_TOPK_INPUTS.len());
        for data_type in APPROX_TOPK_INPUTS {
            variants.push(TypeSignature::Exact(vec![
                data_type.clone(),
                DataType::Int64,
            ]));
        }
        Self(Signature::one_of(variants, Volatility::Immutable))
    }
}

impl std::fmt::Debug for ApproxTopk {
    fn fmt(&self, f: &mut Formatter) -> std::fmt::Result {
        f.debug_struct("ApproxTopk")
            .field("name", &self.name())
            .field("signature", &self.0)
            .finish()
    }
}

impl Default for ApproxTopk {
    fn default() -> Self {
        Self::new()
    }
}

impl AggregateUDFImpl for ApproxTopk {
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
        Ok(DataType::Struct(
            vec![
                Field::new(
                    "value",
                    DataType::List(Arc::new(Field::new("item", arg_types[0].clone(), true))),
                    true,
                ),
                Field::new(
                    "count",
                    DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                    true,
                ),
            ]
            .into(),
        ))
    }

    fn state_fields(&self, args: StateFieldsArgs) -> Result<Vec<Field>> {
        Ok(vec![Field::new(
            args.name,
            DataType::Struct(
                vec![
                    Field::new(
                        "value",
                        DataType::List(Arc::new(Field::new(
                            "item",
                            args.input_types[0].clone(),
                            true,
                        ))),
                        true,
                    ),
                    Field::new(
                        "count",
                        DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                        true,
                    ),
                ]
                .into(),
            ),
            true,
        )])
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        let value_data_type = args.exprs[0].data_type(args.schema)?;
        let topk = get_scalar_value(&args.exprs[1])?;
        let topk = match topk {
            ScalarValue::Int64(Some(v)) => v,
            _ => {
                return not_impl_err!(
                    "Second argument for 'APPROX_TOPK' must be Int64 (got data type {:?})",
                    topk
                );
            }
        };

        let accumulator: ApproxTopkAccumulator = match value_data_type {
            t @ (DataType::Int8
            | DataType::Int16
            | DataType::Int32
            | DataType::Int64
            | DataType::UInt8
            | DataType::UInt16
            | DataType::UInt32
            | DataType::UInt64
            | DataType::Float32
            | DataType::Float64) => ApproxTopkAccumulator::new(topk, t.clone()),
            other => {
                return not_impl_err!(
                    "Support for 'APPROX_TOPK' for data type {other} is not implemented"
                );
            }
        };
        Ok(Box::new(accumulator))
    }
}

fn get_scalar_value(expr: &Arc<dyn PhysicalExpr>) -> Result<ScalarValue> {
    let empty_schema = Arc::new(Schema::empty());
    let batch = RecordBatch::new_empty(Arc::clone(&empty_schema));
    if let ColumnarValue::Scalar(s) = expr.evaluate(&batch)? {
        Ok(s)
    } else {
        internal_err!("Didn't expect ColumnarValue::Array")
    }
}

/// This accumulator will return the exact percentile value from the given data
struct ApproxTopkAccumulator {
    max_heap: HashMap<i64, i64>, // value -> count
    topk: i64,
    return_type: DataType,
}

impl std::fmt::Debug for ApproxTopkAccumulator {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ApproxTopkAccumulator({}, {})",
            self.return_type, self.topk
        )
    }
}

impl ApproxTopkAccumulator {
    // Default to median
    fn new(topk: i64, return_type: DataType) -> Self {
        Self {
            max_heap: HashMap::with_capacity(topk as usize),
            topk,
            return_type,
        }
    }
}

impl Accumulator for ApproxTopkAccumulator {
    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        // sort the result only return the topk values
        let mut sorted_result = self.max_heap.iter().collect::<Vec<_>>();
        sorted_result.sort_by(|a, b| b.1.cmp(a.1));
        sorted_result.truncate(self.topk as usize);

        let mut result = Int64Builder::new();
        let mut count = Int64Builder::new();
        for (v, c) in sorted_result.iter() {
            result.append_value(**v);
            count.append_value(**c);
        }
        let result_array = Arc::new(result.finish());
        let count_array = Arc::new(count.finish());

        // Create ListArray for values
        let value_list = ListArray::new(
            Arc::new(Field::new("item", DataType::Int64, true)),
            OffsetBuffer::new(
                arrow::buffer::Buffer::from_slice_ref([0, result_array.len() as i32]).into(),
            ),
            result_array,
            None,
        );

        // Create ListArray for counts
        let count_list = ListArray::new(
            Arc::new(Field::new("item", DataType::Int64, true)),
            OffsetBuffer::new(
                arrow::buffer::Buffer::from_slice_ref([0, count_array.len() as i32]).into(),
            ),
            count_array,
            None,
        );

        Ok(vec![ScalarValue::Struct(Arc::new(StructArray::new(
            vec![
                Field::new(
                    "value",
                    DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                    true,
                ),
                Field::new(
                    "count",
                    DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                    true,
                ),
            ]
            .into(),
            vec![Arc::new(value_list), Arc::new(count_list)],
            None,
        )))])
    }

    fn evaluate(&mut self) -> Result<ScalarValue> {
        // sort the result only return the topk values
        let mut sorted_result = self.max_heap.iter().collect::<Vec<_>>();
        sorted_result.sort_by(|a, b| b.1.cmp(a.1));
        sorted_result.truncate(self.topk as usize);

        // return the max topk values and their counts
        let mut result = Int64Builder::new();
        let mut count = Int64Builder::new();
        for (v, c) in sorted_result.iter() {
            result.append_value(**v);
            count.append_value(**c);
        }
        let result_array = Arc::new(result.finish());
        let count_array = Arc::new(count.finish());

        // Create ListArray for values
        let value_list = ListArray::new(
            Arc::new(Field::new("item", DataType::Int64, true)),
            OffsetBuffer::new(
                arrow::buffer::Buffer::from_slice_ref([0, result_array.len() as i32]).into(),
            ),
            result_array,
            None,
        );

        // Create ListArray for counts
        let count_list = ListArray::new(
            Arc::new(Field::new("item", DataType::Int64, true)),
            OffsetBuffer::new(
                arrow::buffer::Buffer::from_slice_ref([0, count_array.len() as i32]).into(),
            ),
            count_array,
            None,
        );

        Ok(ScalarValue::Struct(Arc::new(StructArray::new(
            vec![
                Field::new(
                    "value",
                    DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                    true,
                ),
                Field::new(
                    "count",
                    DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                    true,
                ),
            ]
            .into(),
            vec![Arc::new(value_list), Arc::new(count_list)],
            None,
        ))))
    }

    fn size(&self) -> usize {
        self.max_heap.len()
    }

    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        let value = values[0].as_any().downcast_ref::<Int64Array>().unwrap();
        for v in value.iter().flatten() {
            *self.max_heap.entry(v).or_insert(0) += 1;
        }
        Ok(())
    }

    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        // states should contain a single struct array with value and count list fields
        let struct_array = states[0].as_any().downcast_ref::<StructArray>().unwrap();

        // Get the value and count list arrays
        let value_list = struct_array
            .column(0)
            .as_any()
            .downcast_ref::<ListArray>()
            .unwrap();
        let count_list = struct_array
            .column(1)
            .as_any()
            .downcast_ref::<ListArray>()
            .unwrap();

        // Extract the underlying arrays
        let values = value_list
            .values()
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let counts = count_list
            .values()
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();

        // Merge the values and counts into our accumulator
        for (v, c) in values.iter().zip(counts.iter()) {
            if let Some(c) = c {
                if let Some(v) = v {
                    if let Some(entry) = self.max_heap.get_mut(&v) {
                        *entry += c;
                    } else {
                        self.max_heap.insert(v, c);
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use arrow::{
        array::{Int64Array, RecordBatch},
        util::pretty::pretty_format_batches,
    };
    use arrow_schema::{Field, Schema};
    use datafusion::{datasource::MemTable, logical_expr::AggregateUDF, prelude::SessionContext};

    use super::*;

    fn create_test_context() -> SessionContext {
        let ctx = SessionContext::new();
        let schema = Schema::new(vec![
            Field::new("value", DataType::Int64, false),
            Field::new("count", DataType::Int64, false),
        ]);

        // Test data: values with their counts
        let values = vec![10, 20, 30, 40, 50, 10, 20, 30, 40, 50, 10, 20];
        let counts = vec![1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2];

        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(Int64Array::from(values)),
                Arc::new(Int64Array::from(counts)),
            ],
        )
        .unwrap();

        let table = MemTable::try_new(Arc::new(schema), vec![vec![batch]]).unwrap();
        ctx.register_table("test_table", Arc::new(table)).unwrap();
        ctx
    }

    #[tokio::test]
    async fn test_approx_topk_udaf_integration() {
        let ctx = create_test_context();
        let udaf = AggregateUDF::from(ApproxTopk::new());
        ctx.register_udaf(udaf);

        // Test SQL query with approx_topk
        let sql = "SELECT approx_topk(value, 2) FROM test_table";
        let df = ctx.sql(sql).await.unwrap();
        let results = df.collect().await.unwrap();

        // Verify we got a result
        assert!(!results.is_empty());
        assert!(!results[0].columns().is_empty());

        println!("{}", pretty_format_batches(&results).unwrap());

        // // The result should be a struct with value and count lists
        // let result_column = results[0].column(0);
        // let struct_array = as_struct_array(result_column).unwrap();

        // assert_eq!(struct_array.num_columns(), 2);
        // assert!(struct_array.column(0).len() <= 3); // Should not exceed topk=3Add commentMore
        // actions assert!(struct_array.column(1).len() <= 3);
    }
}
