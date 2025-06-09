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

use std::{fmt::Formatter, sync::Arc};

use arrow::array::{
    Array, AsArray, Float32Array, Int8Array, Int16Array, Int32Array, Int64Array, RecordBatch,
    UInt8Array, UInt16Array, UInt32Array, UInt64Array,
};
use arrow_schema::{Field, Schema};
use datafusion::{
    arrow::{
        array::{ArrayRef, Float64Array},
        datatypes::DataType,
    },
    common::{downcast_value, internal_err, not_impl_err, plan_err},
    error::Result,
    logical_expr::{
        Accumulator, AggregateUDFImpl, ColumnarValue, Signature, TypeSignature, Volatility,
        function::{AccumulatorArgs, StateFieldsArgs},
        utils::format_state_name,
    },
    physical_plan::PhysicalExpr,
    scalar::ScalarValue,
};
use datafusion_functions_aggregate_common::tdigest::TryIntoF64;

use super::NUMERICS;

const SUMMARY_PERCENTILE: &str = "summary_percentile";

/// The summary_percentile is based on summary stream
/// the summary stream sql:
/// SELECT max(_timestamp) as _timestamp,
///     count(_timestamp) as total_count,
///     f1,
///     f2,
///     f3
/// FROM default
/// GROUP BY
///     f1,
///     f2,
///     f3
/// the summary_percentile sql(use for calculate multi filed percentile):
/// SELECT summary_percentile(f1, total_count, 0.5) as f1_median,
///     summary_percentile(f2, total_count, 0.5) as f2_median,
///     summary_percentile(f3, total_count, 0.5) as f3_median
/// FROM summary_percentile
pub(crate) struct SummaryPercentile(Signature);

impl SummaryPercentile {
    pub fn new() -> Self {
        let mut variants = Vec::with_capacity(NUMERICS.len());
        // Accept any numeric value, the count field, and a float64 percentile
        for num in NUMERICS {
            variants.push(TypeSignature::Exact(vec![
                num.clone(),
                DataType::Int64,
                DataType::Float64,
            ]));
        }
        Self(Signature::one_of(variants, Volatility::Immutable))
    }
}

impl std::fmt::Debug for SummaryPercentile {
    fn fmt(&self, f: &mut Formatter) -> std::fmt::Result {
        f.debug_struct("SummaryPercentile")
            .field("name", &self.name())
            .field("signature", &self.0)
            .finish()
    }
}

impl Default for SummaryPercentile {
    fn default() -> Self {
        Self::new()
    }
}

impl AggregateUDFImpl for SummaryPercentile {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn name(&self) -> &str {
        SUMMARY_PERCENTILE
    }

    fn signature(&self) -> &datafusion::logical_expr::Signature {
        &self.0
    }

    fn return_type(&self, arg_types: &[DataType]) -> Result<DataType> {
        if !arg_types[0].is_numeric() {
            return plan_err!("summary_percentile requires numeric input types");
        }
        Ok(arg_types[0].clone())
    }

    fn state_fields(&self, args: StateFieldsArgs) -> Result<Vec<Field>> {
        Ok(vec![
            Field::new(
                format_state_name(args.name, "value"),
                DataType::List(Arc::new(Field::new("item", DataType::Float64, true))),
                true,
            ),
            Field::new(
                format_state_name(args.name, "count"),
                DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
                true,
            ),
        ])
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        let percentile = validate_input_percentile_expr(&args.exprs[2])?;
        let value_data_type = args.exprs[0].data_type(args.schema)?;
        let count_data_type = args.exprs[1].data_type(args.schema)?;
        // TODO: should support all Int and Uint data type
        if count_data_type != DataType::Int64 {
            return not_impl_err!(
                "Second argument for 'SUMMARY_PERCENTILE' must be Int64 (got data type {:?})",
                count_data_type
            );
        }
        let accumulator: SummaryPercentileAccumulator = match value_data_type {
            t @ (DataType::Int8
            | DataType::Int16
            | DataType::Int32
            | DataType::Int64
            | DataType::UInt8
            | DataType::UInt16
            | DataType::UInt32
            | DataType::UInt64
            | DataType::Float32
            | DataType::Float64) => SummaryPercentileAccumulator::new(percentile, t.clone()),
            other => {
                return not_impl_err!(
                    "Support for 'SUMMARY_PERCENTILE' for data type {other} is not implemented"
                );
            }
        };
        Ok(Box::new(accumulator))
    }
}

fn validate_input_percentile_expr(expr: &Arc<dyn PhysicalExpr>) -> Result<f64> {
    let percentile = match get_scalar_value(expr)? {
        ScalarValue::Float32(Some(value)) => value as f64,
        ScalarValue::Float64(Some(value)) => value,
        sv => {
            return not_impl_err!(
                "Percentile value for 'SUMMARY_PERCENTILE' must be Float32 or Float64 literal (got data type {})",
                sv.data_type()
            );
        }
    };

    // Ensure the percentile is between 0 and 1.
    if !(0.0..=1.0).contains(&percentile) {
        return plan_err!(
            "Percentile value must be between 0.0 and 1.0 inclusive, {percentile} is invalid"
        );
    }
    Ok(percentile)
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
struct SummaryPercentileAccumulator {
    value: Vec<f64>,
    count: Vec<i64>,
    percentile: f64,
    return_type: DataType,
}

impl std::fmt::Debug for SummaryPercentileAccumulator {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "SummaryPercentileAccumulator({}, {})",
            self.return_type, self.percentile
        )
    }
}

impl SummaryPercentileAccumulator {
    // Default to median
    fn new(percentile: f64, return_type: DataType) -> Self {
        Self {
            value: Vec::new(),
            count: Vec::new(),
            percentile,
            return_type,
        }
    }

    pub fn convert_to_float(values: &ArrayRef) -> Result<Vec<f64>> {
        match values.data_type() {
            DataType::Float64 => {
                let array = downcast_value!(values, Float64Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::Float32 => {
                let array = downcast_value!(values, Float32Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::Int64 => {
                let array = downcast_value!(values, Int64Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::Int32 => {
                let array = downcast_value!(values, Int32Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::Int16 => {
                let array = downcast_value!(values, Int16Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::Int8 => {
                let array = downcast_value!(values, Int8Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::UInt64 => {
                let array = downcast_value!(values, UInt64Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::UInt32 => {
                let array = downcast_value!(values, UInt32Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::UInt16 => {
                let array = downcast_value!(values, UInt16Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            DataType::UInt8 => {
                let array = downcast_value!(values, UInt8Array);
                Ok(array
                    .values()
                    .iter()
                    .filter_map(|v| v.try_as_f64().transpose())
                    .collect::<Result<Vec<_>>>()?)
            }
            e => internal_err!("SUMMART_PERCENTILE is not expected to receive the type {e:?}"),
        }
    }

    fn convert_to_int64(values: &ArrayRef) -> Result<Vec<i64>> {
        let array = downcast_value!(values, Int64Array);
        Ok(array.values().to_vec())
    }
}

impl Accumulator for SummaryPercentileAccumulator {
    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        let value = ScalarValue::List(ScalarValue::new_list_nullable(
            &self
                .value
                .iter()
                .map(|v| ScalarValue::Float64(Some(*v)))
                .collect::<Vec<ScalarValue>>(),
            &DataType::Float64,
        ));
        let count = ScalarValue::List(ScalarValue::new_list_nullable(
            &self
                .count
                .iter()
                .map(|v| ScalarValue::Int64(Some(*v)))
                .collect::<Vec<ScalarValue>>(),
            &DataType::Int64,
        ));
        Ok(vec![value, count])
    }

    fn evaluate(&mut self) -> Result<ScalarValue> {
        if self.value.is_empty() {
            return Ok(match &self.return_type {
                DataType::Int8 => ScalarValue::Int8(None),
                DataType::Int16 => ScalarValue::Int16(None),
                DataType::Int32 => ScalarValue::Int32(None),
                DataType::Int64 => ScalarValue::Int64(None),
                DataType::UInt8 => ScalarValue::UInt8(None),
                DataType::UInt16 => ScalarValue::UInt16(None),
                DataType::UInt32 => ScalarValue::UInt32(None),
                DataType::UInt64 => ScalarValue::UInt64(None),
                DataType::Float32 => ScalarValue::Float32(None),
                DataType::Float64 => ScalarValue::Float64(None),
                v => unreachable!("unexpected return type {:?}", v),
            });
        }

        // 1. sort the value array and merge the count array based on value array
        let mut value_count = self.value.iter().zip(self.count.iter()).collect::<Vec<_>>();
        value_count.sort_by(|a, b| a.0.partial_cmp(b.0).unwrap());

        // 2. calculate the prefix sum of the count array
        let mut prefix_sum: Vec<i64> = Vec::with_capacity(value_count.len());
        for (i, (_value, count)) in value_count.iter().enumerate() {
            prefix_sum.push(**count);
            if i > 0 {
                prefix_sum[i] += prefix_sum[i - 1];
            }
        }

        // 3. calculate the rank of the percentile
        let percentile_count = self.percentile * (prefix_sum[prefix_sum.len() - 1] as f64);
        let lower_index = prefix_sum
            .iter()
            .position(|&v| v as f64 >= percentile_count)
            .unwrap();
        let upper_index = lower_index + 1;

        // 4. calculate the fractioned value
        let fraction = percentile_count - prefix_sum[lower_index] as f64;
        let lower_value = value_count[lower_index].0;
        let upper_value = value_count[upper_index].0;
        let percentile_value = lower_value + (upper_value - lower_value) * fraction;

        Ok(match &self.return_type {
            DataType::Int8 => ScalarValue::Int8(Some(percentile_value as i8)),
            DataType::Int16 => ScalarValue::Int16(Some(percentile_value as i16)),
            DataType::Int32 => ScalarValue::Int32(Some(percentile_value as i32)),
            DataType::Int64 => ScalarValue::Int64(Some(percentile_value as i64)),
            DataType::UInt8 => ScalarValue::UInt8(Some(percentile_value as u8)),
            DataType::UInt16 => ScalarValue::UInt16(Some(percentile_value as u16)),
            DataType::UInt32 => ScalarValue::UInt32(Some(percentile_value as u32)),
            DataType::UInt64 => ScalarValue::UInt64(Some(percentile_value as u64)),
            DataType::Float32 => ScalarValue::Float32(Some(percentile_value as f32)),
            DataType::Float64 => ScalarValue::Float64(Some(percentile_value)),
            v => unreachable!("unexpected return type {:?}", v),
        })
    }

    fn size(&self) -> usize {
        self.value.len()
    }

    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        let value = SummaryPercentileAccumulator::convert_to_float(&values[0])?;
        self.value.reserve(value.len());
        self.value.extend(value);
        let count = SummaryPercentileAccumulator::convert_to_int64(&values[1])?;
        self.count.reserve(count.len());
        self.count.extend(count);
        Ok(())
    }

    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        if states.is_empty() {
            return Ok(());
        }

        let array = states[0].as_list::<i32>();
        for v in array.iter().flatten() {
            self.update_batch(&[v])?
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use arrow::array::{ArrayRef, RecordBatch};
    use arrow_schema::{Field, Schema};
    use datafusion::{
        common::cast::{as_float64_array, as_uint32_array},
        datasource::MemTable,
        logical_expr::{Accumulator, AggregateUDF},
        prelude::SessionContext,
    };

    use super::*;

    // list of numbers to test
    const VALUES: [u16; 92] = [
        2973, 1018, 5898, 52, 17296, 943, 1363, 1075, 1176, 2257, 1263, 1132, 1749, 967, 1737,
        1380, 1506, 2021, 1341, 3240, 1430, 1632, 2127, 2547, 1346, 1249, 11700, 1491, 1202, 8444,
        916, 1132, 1417, 2527, 1163, 15003, 1299, 2073, 1523, 3783, 2170, 6640, 1493, 981, 1926,
        2066, 2621, 1062, 2108, 852, 3634, 1322, 2433, 1015, 2271, 1819, 2978, 1635, 2102, 2847,
        1208, 3896, 2603, 1174, 8444, 1846, 3291, 1, 1638, 1647, 1101, 1602, 1558, 808, 734, 16227,
        1304, 2219, 1163, 1135, 1429, 2778, 1439, 2553, 1480, 1129, 2054, 1203, 3653, 679, 1591,
        1811,
    ];
    const COUNTS: [u16; 92] = [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1,
    ];

    fn create_context() -> SessionContext {
        let ctx = SessionContext::new();
        // Create two fields with the same data but different data types
        let schema = Schema::new(vec![
            Field::new("value_float", DataType::Float64, false),
            Field::new("value_uint", DataType::UInt32, false),
            Field::new("total_count", DataType::Int64, false),
        ]);
        let values_float: Vec<_> = VALUES.into_iter().map(|v| v as f64).collect();
        let values_uint: Vec<_> = VALUES.into_iter().map(|v| v as u32).collect();
        let counts: Vec<_> = COUNTS.into_iter().map(|v| v as i64).collect();
        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(Float64Array::from(values_float)),
                Arc::new(UInt32Array::from(values_uint)),
                Arc::new(Int64Array::from(counts)),
            ],
        )
        .unwrap();
        let table = MemTable::try_new(Arc::new(schema), vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(table)).unwrap();
        ctx
    }

    #[test]
    fn test_summary_percentile() {
        let mut acc = SummaryPercentileAccumulator::new(0.75, DataType::Float64);
        let values: Vec<_> = VALUES.into_iter().map(|v| v as f64).collect();
        let counts: Vec<_> = COUNTS.into_iter().map(|v| v as i64).collect();
        // Convert values to arrayref
        let values: ArrayRef = Arc::new(arrow::array::Float64Array::from(values));
        let counts: ArrayRef = Arc::new(arrow::array::Int64Array::from(counts));
        acc.update_batch(&[values, counts]).unwrap();

        // Check the result
        assert_eq!(acc.evaluate().unwrap(), ScalarValue::Float64(Some(2433.0)));
    }

    #[tokio::test]
    async fn test_summary_percentile_udaf() {
        let ctx = create_context();
        let percentile = 0.75;
        let sql_float_field = &format!(
            "select summary_percentile(value_float, total_count, {}) from t",
            percentile
        );
        let sql_uint_field = &format!(
            "select summary_percentile(value_uint, total_count, {}) from t",
            percentile
        );
        let acc_udaf = AggregateUDF::from(SummaryPercentile::new());
        ctx.register_udaf(acc_udaf);

        let df = ctx.sql(sql_float_field).await.unwrap();
        let results = df.collect().await.unwrap();
        // downcast the array to the expected type
        let result = as_float64_array(results[0].column(0)).unwrap();
        assert_eq!(result.value(0), 2433.0);

        let df = ctx.sql(sql_uint_field).await.unwrap();
        let results = df.collect().await.unwrap();
        // downcast the array to the expected type
        let result = as_uint32_array(results[0].column(0)).unwrap();
        assert_eq!(result.value(0), 2433);
    }

    #[tokio::test]
    async fn test_multi_summary_percentile_udaf() {
        let ctx = SessionContext::new();
        // Create two fields with the same data but different data types
        let schema = Schema::new(vec![
            Field::new("f1", DataType::Float64, false),
            Field::new("f2", DataType::UInt32, false),
            Field::new("total_count", DataType::Int64, false),
        ]);
        let f1: Vec<f64> = vec![1.0, 3.0, 2.0, 4.0, 2.0, 3.0, 1.0, 3.0, 2.0, 4.0, 2.0, 3.0];
        let f2: Vec<u32> = vec![2, 3, 4, 5, 6, 1, 4, 5, 1, 1, 2, 3];
        let counts: Vec<i64> = vec![3, 2, 3, 2, 3, 1, 3, 4, 5, 2, 4, 2];
        let batch = RecordBatch::try_new(
            Arc::new(schema.clone()),
            vec![
                Arc::new(Float64Array::from(f1)),
                Arc::new(UInt32Array::from(f2)),
                Arc::new(Int64Array::from(counts)),
            ],
        )
        .unwrap();
        let table = MemTable::try_new(Arc::new(schema), vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(table)).unwrap();

        let percentile = 0.75;
        let sql = &format!(
            "select summary_percentile(f1, total_count, {}), summary_percentile(f2, total_count, {}) from t",
            percentile, percentile
        );
        let acc_udaf = AggregateUDF::from(SummaryPercentile::new());
        ctx.register_udaf(acc_udaf);

        let df = ctx.sql(sql).await.unwrap();
        let results = df.collect().await.unwrap();
        // downcast the array to the expected type
        let result1 = as_float64_array(results[0].column(0)).unwrap();
        let result2 = as_uint32_array(results[0].column(1)).unwrap();
        assert_eq!(result1.value(0), 3.0);
        assert_eq!(result2.value(0), 5);
    }
}
