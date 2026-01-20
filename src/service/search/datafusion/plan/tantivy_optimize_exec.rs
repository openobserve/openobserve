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

use std::{any::Any, collections::HashSet, sync::Arc};

use arrow::array::{
    Array, Int64Array, TimestampMicrosecondArray, TimestampNanosecondArray, UInt64Array,
};
use config::{
    PARQUET_BATCH_SIZE,
    meta::{inverted_index::IndexOptimizeMode, stream::FileKey},
};
use datafusion::{
    arrow::{array::RecordBatch, datatypes::SchemaRef},
    common::{Result, Statistics, internal_err},
    error::DataFusionError,
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        memory::MemoryStream,
        metrics::{BaselineMetrics, ExecutionPlanMetricsSet, MetricsSet},
        stream::RecordBatchStreamAdapter,
    },
};
use futures::TryStreamExt;

use crate::service::search::{
    grpc::{QueryParams, storage::tantivy_search},
    index::IndexCondition,
};

#[derive(Debug)]
pub struct TantivyOptimizeExec {
    query: Arc<QueryParams>,
    schema: SchemaRef,                       // The schema for the produced row
    file_list: Vec<FileKey>,                 // The list of files to read
    index_condition: Option<IndexCondition>, // The condition to filter the rows
    cache: PlanProperties,                   // Cached properties of this plan
    index_optimize_mode: IndexOptimizeMode,  // Type of query the ttv index optimizes
    metrics: ExecutionPlanMetricsSet,
}

impl TantivyOptimizeExec {
    /// Create a new TantivyOptimizeExec
    pub fn new(
        query: Arc<QueryParams>,
        schema: SchemaRef,
        file_list: Vec<FileKey>,
        index_condition: Option<IndexCondition>,
        index_optimize_mode: IndexOptimizeMode,
    ) -> Self {
        let cache = Self::compute_properties(Arc::clone(&schema));
        TantivyOptimizeExec {
            query,
            schema,
            file_list,
            index_condition,
            cache,
            index_optimize_mode,
            metrics: ExecutionPlanMetricsSet::new(),
        }
    }

    fn compute_properties(schema: SchemaRef) -> PlanProperties {
        PlanProperties::new(
            EquivalenceProperties::new(schema.clone()),
            // Output Partitioning
            Partitioning::UnknownPartitioning(1),
            // Execution Mode
            EmissionType::Final,
            Boundedness::Bounded,
        )
    }
}

impl DisplayAs for TantivyOptimizeExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        // display up to 5 file keys,
        let file_keys = self
            .file_list
            .iter()
            .take(5)
            .map(|file_key| file_key.key.clone())
            .collect::<Vec<String>>()
            .join(", ");
        write!(
            f,
            "TantivyOptimizeExec: files: {}, optimize_mode: {:?}, file_list: [{file_keys}]",
            self.file_list.len(),
            self.index_optimize_mode,
        )
    }
}

impl ExecutionPlan for TantivyOptimizeExec {
    fn name(&self) -> &'static str {
        "TantivyOptimizeExec"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![]
    }

    fn with_new_children(
        self: Arc<Self>,
        _: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        Ok(self)
    }

    fn execute(
        &self,
        partition: usize,
        _context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        if partition >= 1 {
            return internal_err!(
                "TantivyOptimizeExec invalid partition {partition} (expected partition: 0)"
            );
        }

        let metrics = BaselineMetrics::new(&self.metrics, partition);
        let fut = adapt_tantivy_result(
            self.query.clone(),
            self.file_list.clone(),
            self.index_condition.clone(),
            self.schema.clone(),
            self.index_optimize_mode.clone(),
            metrics,
        );
        let stream = futures::stream::once(fut).try_flatten();
        Ok(Box::pin(RecordBatchStreamAdapter::new(
            self.schema.clone(),
            stream,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema))
    }

    fn metrics(&self) -> Option<MetricsSet> {
        Some(self.metrics.clone_inner())
    }
}

async fn adapt_tantivy_result(
    query: Arc<QueryParams>,
    mut file_list: Vec<FileKey>,
    index_condition: Option<IndexCondition>,
    schema: SchemaRef,
    idx_optimize_mode: IndexOptimizeMode,
    metrics: BaselineMetrics,
) -> Result<SendableRecordBatchStream> {
    let timer = metrics.elapsed_compute().timer();
    let (idx_took, error, result) = tantivy_search(
        query.clone(),
        &mut file_list,
        index_condition,
        Some(idx_optimize_mode.clone()),
    )
    .await
    .map_err(|e| DataFusionError::External(Box::new(e)))?;

    if error {
        return internal_err!("Error while filtering file list by Tantivy index");
    }

    log::info!(
        "[trace_id {}] search->storage: stream {}/{}/{}, TantivyOptimizeExec execution time {} ms",
        query.trace_id,
        query.org_id,
        query.stream_type,
        query.stream_name,
        idx_took
    );

    // first level is for each record batch
    // second level is each array in record batch
    let array: Vec<Vec<Arc<dyn Array>>> = match idx_optimize_mode {
        IndexOptimizeMode::SimpleCount => {
            vec![vec![Arc::new(Int64Array::from(vec![
                result.num_rows() as i64
            ]))]]
        }
        IndexOptimizeMode::SimpleHistogram(min_value, bucket_width, num_buckets) => {
            vec![create_histogram_arrow_array(
                &schema,
                result.histogram(),
                min_value,
                bucket_width,
                num_buckets,
            )?]
        }
        IndexOptimizeMode::SimpleTopN(field, limit, _ascend) => {
            create_top_n_arrow_array(&schema, result.top_n(), &field, limit)?
        }
        IndexOptimizeMode::SimpleDistinct(_field, _limit, _ascend) => {
            vec![create_distinct_arrow_array(&schema, result.distinct())?]
        }
        _ => {
            return internal_err!(
                "Only count, histogram and topn optimize modes are supported by TantivyOptimizeExec"
            );
        }
    };

    let record_batches = array
        .into_iter()
        .map(|array| {
            RecordBatch::try_new(schema.clone(), array).map_err(|e| {
                DataFusionError::Internal(format!(
                    "TantivyOptimizeExec create record batch error: {e}",
                ))
            })
        })
        .collect::<Result<Vec<_>>>()?;

    // record output metrics
    metrics.record_output(record_batches.iter().map(|b| b.num_rows()).sum());
    timer.done();

    Ok(Box::pin(MemoryStream::try_new(
        record_batches,
        schema,
        None,
    )?))
}

/// Creates a RecordBatch containing histogram data with timestamps and counts
///
/// Parameters:
/// - schema: The expected schema for the result
/// - histogram_counts: Vector of counts for each histogram bucket
/// - min_value: The minimum timestamp value (start of first bucket)
/// - bucket_width: Width of each bucket in microseconds
/// - num_buckets: Expected number of buckets
fn create_histogram_arrow_array(
    schema: &SchemaRef,
    histogram_counts: Vec<u64>,
    min_value: i64,
    bucket_width: u64,
    num_buckets: usize,
) -> Result<Vec<Arc<dyn arrow::array::Array>>, DataFusionError> {
    // Validate inputs
    if bucket_width == 0 {
        return Err(DataFusionError::Internal(
            "Histogram bucket width cannot be zero".to_string(),
        ));
    }

    // Verify schema has expected structure
    if schema.fields().len() != 2 {
        return Err(DataFusionError::Internal(format!(
            "Expected schema with 2 fields for histogram, got {}",
            schema.fields().len()
        )));
    }

    // Ensure we have the right number of buckets (pad or truncate if necessary)
    let normalized_counts = if histogram_counts.len() != num_buckets {
        log::warn!(
            "Histogram counts length ({}) doesn't match expected buckets ({}), normalizing data",
            histogram_counts.len(),
            num_buckets
        );
        let mut normalized = histogram_counts;
        normalized.resize(num_buckets, 0);
        normalized
    } else {
        histogram_counts
    };

    // Pre-allocate vectors with exact capacity
    let mut timestamp_values = Vec::with_capacity(num_buckets);
    let mut count_values = Vec::with_capacity(num_buckets);

    for (i, &count) in normalized_counts.iter().enumerate() {
        if count > 0 {
            let bucket_offset = i64::try_from(i)
                .and_then(|i| i64::try_from(bucket_width).map(|w| i * w))
                .map_err(|_| {
                    DataFusionError::Internal(
                        "Bucket timestamp calculation would overflow".to_string(),
                    )
                })?;
            let bucket_timestamp = min_value.checked_add(bucket_offset).ok_or_else(|| {
                DataFusionError::Internal("Bucket timestamp calculation would overflow".to_string())
            })?;
            timestamp_values.push(bucket_timestamp);
            count_values.push(count as i64);
        }
    }

    // Get field data types from schema to ensure we create the right array types
    let timestamp_field = &schema.fields()[0];
    let count_field = &schema.fields()[1];

    // Create arrays with proper types based on schema
    let timestamp_array = match timestamp_field.data_type() {
        arrow_schema::DataType::Timestamp(arrow_schema::TimeUnit::Microsecond, _) => {
            Arc::new(TimestampMicrosecondArray::from(timestamp_values)) as Arc<dyn Array>
        }
        arrow_schema::DataType::Timestamp(arrow_schema::TimeUnit::Nanosecond, _) => {
            // Convert microseconds to nanoseconds
            let nano_values = timestamp_values
                .iter()
                .map(|&ts| {
                    ts.checked_mul(1000).ok_or_else(|| {
                        DataFusionError::Internal(
                            "Timestamp conversion to nanoseconds would overflow".to_string(),
                        )
                    })
                })
                .collect::<Result<Vec<_>, DataFusionError>>()?;
            Arc::new(TimestampNanosecondArray::from(nano_values)) as Arc<dyn Array>
        }
        // Handle other timestamp types as needed
        _ => {
            return Err(DataFusionError::Internal(format!(
                "Unexpected timestamp type in histogram schema: {:?}",
                timestamp_field.data_type()
            )));
        }
    };

    // Create count array
    let count_array = match count_field.data_type() {
        arrow_schema::DataType::Int64 => Arc::new(Int64Array::from(count_values)) as Arc<dyn Array>,
        arrow_schema::DataType::UInt64 => {
            // Convert to unsigned if schema requires it
            let u64_values = count_values.iter().map(|&c| c as u64).collect::<Vec<_>>();
            Arc::new(UInt64Array::from(u64_values)) as Arc<dyn Array>
        }
        // Add other numeric types as needed
        _ => {
            return Err(DataFusionError::Internal(format!(
                "Unexpected count type in histogram schema: {:?}",
                count_field.data_type()
            )));
        }
    };

    Ok(vec![timestamp_array, count_array])
}

fn create_top_n_arrow_array(
    schema: &SchemaRef,
    top_n: Vec<(String, u64)>,
    _field: &str,
    _limit: usize,
) -> Result<Vec<Vec<Arc<dyn arrow::array::Array>>>, DataFusionError> {
    // Validate inputs
    if schema.fields().len() != 2 {
        return Err(DataFusionError::Internal(format!(
            "Expected schema with 2 fields for TopN, got {}",
            schema.fields().len()
        )));
    }

    // Extract field values and counts
    let (field_values, count_values): (Vec<String>, Vec<u64>) = top_n.into_iter().unzip();

    // Get field data types from schema to ensure we create the right array types
    let field_field = &schema.fields()[0];
    let count_field = &schema.fields()[1];

    let total_rows = field_values.len();

    if total_rows == 0 {
        return Ok(vec![]);
    }

    let mut batches = Vec::new();

    // Process data in batches of BATCH_SIZE
    for chunk_start in (0..total_rows).step_by(PARQUET_BATCH_SIZE) {
        let chunk_end = std::cmp::min(chunk_start + PARQUET_BATCH_SIZE, total_rows);

        let field_chunk = field_values[chunk_start..chunk_end].to_vec();
        let count_chunk = count_values[chunk_start..chunk_end].to_vec();

        // Create field value array with proper type based on schema
        let field_array = create_field_array(field_field, field_chunk)?;

        // Create count array with proper type based on schema
        let count_array = create_count_array(count_field, count_chunk)?;

        batches.push(vec![field_array, count_array]);
    }

    Ok(batches)
}

fn create_distinct_arrow_array(
    schema: &SchemaRef,
    distinct_values: HashSet<String>,
) -> Result<Vec<Arc<dyn arrow::array::Array>>, DataFusionError> {
    // Validate inputs
    if schema.fields().len() != 1 {
        return Err(DataFusionError::Internal(format!(
            "Expected schema with 1 field for Distinct, got {}",
            schema.fields().len()
        )));
    }

    // Get field data types from schema to ensure we create the right array types
    let field_field = &schema.fields()[0];

    // Create field value array with proper type based on schema
    let field_array = create_field_array(field_field, distinct_values.into_iter().collect())?;

    Ok(vec![field_array])
}

/// Helper function to create field arrays with proper type conversion
fn create_field_array(
    field: &arrow_schema::Field,
    field_values: Vec<String>,
) -> Result<Arc<dyn Array>, DataFusionError> {
    match field.data_type() {
        arrow_schema::DataType::Utf8 => {
            Ok(Arc::new(arrow::array::StringArray::from(field_values)) as Arc<dyn Array>)
        }
        arrow_schema::DataType::Utf8View => {
            Ok(Arc::new(arrow::array::StringViewArray::from(field_values)) as Arc<dyn Array>)
        }
        arrow_schema::DataType::LargeUtf8 => {
            Ok(Arc::new(arrow::array::LargeStringArray::from(field_values)) as Arc<dyn Array>)
        }
        arrow_schema::DataType::Int64 => parse_i64_array(&field_values),
        arrow_schema::DataType::UInt64 => parse_u64_array(&field_values),
        arrow_schema::DataType::Float64 => parse_f64_array(&field_values),
        arrow_schema::DataType::Boolean => parse_bool_array(&field_values),
        // Handle other string types as needed
        _ => Err(DataFusionError::Internal(format!(
            "Unexpected field type in TopN or Distinct schema: {:?}",
            field.data_type()
        ))),
    }
}

/// Helper function to create count arrays with proper type conversion
fn create_count_array(
    field: &arrow_schema::Field,
    count_values: Vec<u64>,
) -> Result<Arc<dyn Array>, DataFusionError> {
    match field.data_type() {
        arrow_schema::DataType::Int64 => {
            let i64_values = count_values.iter().map(|&c| c as i64).collect::<Vec<_>>();
            Ok(Arc::new(Int64Array::from(i64_values)) as Arc<dyn Array>)
        }
        arrow_schema::DataType::UInt64 => {
            Ok(Arc::new(UInt64Array::from(count_values)) as Arc<dyn Array>)
        }
        arrow_schema::DataType::Int32 => {
            let i32_values = count_values.iter().map(|&c| c as i32).collect::<Vec<_>>();
            Ok(Arc::new(arrow::array::Int32Array::from(i32_values)) as Arc<dyn Array>)
        }
        arrow_schema::DataType::UInt32 => {
            let u32_values = count_values.iter().map(|&c| c as u32).collect::<Vec<_>>();
            Ok(Arc::new(arrow::array::UInt32Array::from(u32_values)) as Arc<dyn Array>)
        }
        // Add other numeric types as needed
        _ => Err(DataFusionError::Internal(format!(
            "Unexpected count type in TopN schema: {:?}",
            field.data_type()
        ))),
    }
}

/// Parse string values into i64 array
fn parse_i64_array(field_values: &[String]) -> Result<Arc<dyn Array>, DataFusionError> {
    let parsed_values = field_values
        .iter()
        .map(|v| {
            if v.is_empty() {
                Ok(0i64)
            } else {
                v.parse::<i64>()
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| DataFusionError::Internal(format!("Failed to parse i64 in topn: {e}")))?;

    Ok(Arc::new(arrow::array::Int64Array::from(parsed_values)) as Arc<dyn Array>)
}

/// Parse string values into u64 array
fn parse_u64_array(field_values: &[String]) -> Result<Arc<dyn Array>, DataFusionError> {
    let parsed_values = field_values
        .iter()
        .map(|v| {
            if v.is_empty() {
                Ok(0u64)
            } else {
                v.parse::<u64>()
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| DataFusionError::Internal(format!("Failed to parse u64 in topn: {e}")))?;

    Ok(Arc::new(arrow::array::UInt64Array::from(parsed_values)) as Arc<dyn Array>)
}

/// Parse string values into f64 array
fn parse_f64_array(field_values: &[String]) -> Result<Arc<dyn Array>, DataFusionError> {
    let parsed_values = field_values
        .iter()
        .map(|v| {
            if v.is_empty() {
                Ok(0.0f64)
            } else {
                v.parse::<f64>()
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| DataFusionError::Internal(format!("Failed to parse f64 in topn: {e}")))?;

    Ok(Arc::new(arrow::array::Float64Array::from(parsed_values)) as Arc<dyn Array>)
}

/// Parse string values into bool array
fn parse_bool_array(field_values: &[String]) -> Result<Arc<dyn Array>, DataFusionError> {
    let parsed_values = field_values
        .iter()
        .map(|v| {
            if v.is_empty() {
                Ok(false)
            } else {
                v.parse::<bool>()
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| DataFusionError::Internal(format!("Failed to parse bool in topn: {e}")))?;

    Ok(Arc::new(arrow::array::BooleanArray::from(parsed_values)) as Arc<dyn Array>)
}

#[cfg(test)]
mod tests {
    use arrow::array::{BooleanArray, Float64Array, Int64Array, StringArray, UInt64Array};
    use arrow_schema::{DataType, Field, Schema, TimeUnit};
    use config::meta::stream::{FileMeta, StreamType};
    use datafusion::sql::TableReference;

    use super::*;

    #[test]
    fn test_parse_f64_array() {
        let f64_values = [1.0, 0.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY];
        let field_values = f64_values.iter().map(|v| v.to_string()).collect::<Vec<_>>();
        let array = parse_f64_array(&field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<Float64Array>().unwrap();
        assert_eq!(array_values.len(), 5);
        assert_eq!(array_values.value(0), 1.0);
        assert_eq!(array_values.value(1), 0.0);
        assert!(array_values.value(2).is_nan());
        assert_eq!(array_values.value(3), f64::INFINITY);
        assert_eq!(array_values.value(4), f64::NEG_INFINITY);
    }

    #[test]
    fn test_parse_i64_array() {
        let field_values = vec![
            "123".to_string(),
            "-456".to_string(),
            "0".to_string(),
            "".to_string(),
        ];
        let array = parse_i64_array(&field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<Int64Array>().unwrap();
        assert_eq!(array_values.len(), 4);
        assert_eq!(array_values.value(0), 123);
        assert_eq!(array_values.value(1), -456);
        assert_eq!(array_values.value(2), 0);
        assert_eq!(array_values.value(3), 0); // empty string defaults to 0
    }

    #[test]
    fn test_parse_u64_array() {
        let field_values = vec![
            "123".to_string(),
            "456".to_string(),
            "0".to_string(),
            "".to_string(),
        ];
        let array = parse_u64_array(&field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<UInt64Array>().unwrap();
        assert_eq!(array_values.len(), 4);
        assert_eq!(array_values.value(0), 123);
        assert_eq!(array_values.value(1), 456);
        assert_eq!(array_values.value(2), 0);
        assert_eq!(array_values.value(3), 0); // empty string defaults to 0
    }

    #[test]
    fn test_parse_bool_array() {
        let field_values = vec!["true".to_string(), "false".to_string(), "".to_string()];
        let array = parse_bool_array(&field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<BooleanArray>().unwrap();
        assert_eq!(array_values.len(), 3);
        assert!(array_values.value(0));
        assert!(!array_values.value(1));
        assert!(!array_values.value(2)); // empty string defaults to false
    }

    #[test]
    fn test_parse_i64_array_invalid_input() {
        let field_values = vec!["123".to_string(), "invalid".to_string()];
        let result = parse_i64_array(&field_values);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_u64_array_invalid_input() {
        let field_values = vec!["123".to_string(), "invalid".to_string()];
        let result = parse_u64_array(&field_values);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_f64_array_invalid_input() {
        let field_values = vec!["123.45".to_string(), "invalid".to_string()];
        let result = parse_f64_array(&field_values);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_bool_array_invalid_input() {
        let field_values = vec!["true".to_string(), "invalid".to_string()];
        let result = parse_bool_array(&field_values);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_field_array_string() {
        let field = Field::new("test", DataType::Utf8, false);
        let field_values = vec!["hello".to_string(), "world".to_string()];
        let array = create_field_array(&field, field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<StringArray>().unwrap();
        assert_eq!(array_values.len(), 2);
        assert_eq!(array_values.value(0), "hello");
        assert_eq!(array_values.value(1), "world");
    }

    #[test]
    fn test_create_field_array_int64() {
        let field = Field::new("test", DataType::Int64, false);
        let field_values = vec!["123".to_string(), "456".to_string()];
        let array = create_field_array(&field, field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<Int64Array>().unwrap();
        assert_eq!(array_values.len(), 2);
        assert_eq!(array_values.value(0), 123);
        assert_eq!(array_values.value(1), 456);
    }

    #[test]
    fn test_create_field_array_uint64() {
        let field = Field::new("test", DataType::UInt64, false);
        let field_values = vec!["123".to_string(), "456".to_string()];
        let array = create_field_array(&field, field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<UInt64Array>().unwrap();
        assert_eq!(array_values.len(), 2);
        assert_eq!(array_values.value(0), 123);
        assert_eq!(array_values.value(1), 456);
    }

    #[test]
    fn test_create_field_array_float64() {
        let field = Field::new("test", DataType::Float64, false);
        let field_values = vec!["123.45".to_string(), "456.78".to_string()];
        let array = create_field_array(&field, field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<Float64Array>().unwrap();
        assert_eq!(array_values.len(), 2);
        assert_eq!(array_values.value(0), 123.45);
        assert_eq!(array_values.value(1), 456.78);
    }

    #[test]
    fn test_create_field_array_boolean() {
        let field = Field::new("test", DataType::Boolean, false);
        let field_values = vec!["true".to_string(), "false".to_string()];
        let array = create_field_array(&field, field_values).unwrap();
        let array_values = array.as_any().downcast_ref::<BooleanArray>().unwrap();
        assert_eq!(array_values.len(), 2);
        assert!(array_values.value(0));
        assert!(!array_values.value(1));
    }

    #[test]
    fn test_create_field_array_unsupported_type() {
        let field = Field::new("test", DataType::Int32, false);
        let field_values = vec!["123".to_string()];
        let result = create_field_array(&field, field_values);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_count_array_int64() {
        let field = Field::new("count", DataType::Int64, false);
        let count_values = vec![123, 456];
        let array = create_count_array(&field, count_values).unwrap();
        let array_values = array.as_any().downcast_ref::<Int64Array>().unwrap();
        assert_eq!(array_values.len(), 2);
        assert_eq!(array_values.value(0), 123);
        assert_eq!(array_values.value(1), 456);
    }

    #[test]
    fn test_create_count_array_uint64() {
        let field = Field::new("count", DataType::UInt64, false);
        let count_values = vec![123, 456];
        let array = create_count_array(&field, count_values).unwrap();
        let array_values = array.as_any().downcast_ref::<UInt64Array>().unwrap();
        assert_eq!(array_values.len(), 2);
        assert_eq!(array_values.value(0), 123);
        assert_eq!(array_values.value(1), 456);
    }

    #[test]
    fn test_create_count_array_int32() {
        let field = Field::new("count", DataType::Int32, false);
        let count_values = vec![123, 456];
        let array = create_count_array(&field, count_values).unwrap();
        let array_values = array
            .as_any()
            .downcast_ref::<arrow::array::Int32Array>()
            .unwrap();
        assert_eq!(array_values.len(), 2);
        assert_eq!(array_values.value(0), 123);
        assert_eq!(array_values.value(1), 456);
    }

    #[test]
    fn test_create_count_array_uint32() {
        let field = Field::new("count", DataType::UInt32, false);
        let count_values = vec![123, 456];
        let array = create_count_array(&field, count_values).unwrap();
        let array_values = array
            .as_any()
            .downcast_ref::<arrow::array::UInt32Array>()
            .unwrap();
        assert_eq!(array_values.len(), 2);
        assert_eq!(array_values.value(0), 123);
        assert_eq!(array_values.value(1), 456);
    }

    #[test]
    fn test_create_count_array_unsupported_type() {
        let field = Field::new("count", DataType::Float64, false);
        let count_values = vec![123, 456];
        let result = create_count_array(&field, count_values);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_histogram_arrow_array_microsecond() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(
                "timestamp",
                DataType::Timestamp(TimeUnit::Microsecond, None),
                false,
            ),
            Field::new("count", DataType::Int64, false),
        ]));
        let histogram_counts = vec![10, 0, 20, 0, 30];
        let result = create_histogram_arrow_array(&schema, histogram_counts, 1000, 100, 5).unwrap();

        assert_eq!(result.len(), 2);
        let timestamp_array = result[0]
            .as_any()
            .downcast_ref::<TimestampMicrosecondArray>()
            .unwrap();
        let count_array = result[1].as_any().downcast_ref::<Int64Array>().unwrap();

        assert_eq!(timestamp_array.len(), 3); // Only non-zero counts
        assert_eq!(count_array.len(), 3);
        assert_eq!(timestamp_array.value(0), 1000);
        assert_eq!(timestamp_array.value(1), 1200);
        assert_eq!(timestamp_array.value(2), 1400);
        assert_eq!(count_array.value(0), 10);
        assert_eq!(count_array.value(1), 20);
        assert_eq!(count_array.value(2), 30);
    }

    #[test]
    fn test_create_histogram_arrow_array_nanosecond() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(
                "timestamp",
                DataType::Timestamp(TimeUnit::Nanosecond, None),
                false,
            ),
            Field::new("count", DataType::UInt64, false),
        ]));
        let histogram_counts = vec![10, 20];
        let result = create_histogram_arrow_array(&schema, histogram_counts, 1000, 100, 2).unwrap();

        assert_eq!(result.len(), 2);
        let timestamp_array = result[0]
            .as_any()
            .downcast_ref::<TimestampNanosecondArray>()
            .unwrap();
        let count_array = result[1].as_any().downcast_ref::<UInt64Array>().unwrap();

        assert_eq!(timestamp_array.len(), 2);
        assert_eq!(count_array.len(), 2);
        assert_eq!(timestamp_array.value(0), 1000000); // 1000 * 1000
        assert_eq!(timestamp_array.value(1), 1100000); // 1100 * 1000
        assert_eq!(count_array.value(0), 10);
        assert_eq!(count_array.value(1), 20);
    }

    #[test]
    fn test_create_histogram_arrow_array_invalid_schema() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "timestamp",
            DataType::Int64,
            false,
        )]));
        let histogram_counts = vec![10, 20];
        let result = create_histogram_arrow_array(&schema, histogram_counts, 1000, 100, 2);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_histogram_arrow_array_zero_bucket_width() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(
                "timestamp",
                DataType::Timestamp(TimeUnit::Microsecond, None),
                false,
            ),
            Field::new("count", DataType::Int64, false),
        ]));
        let histogram_counts = vec![10, 20];
        let result = create_histogram_arrow_array(&schema, histogram_counts, 1000, 0, 2);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_histogram_arrow_array_normalize_counts() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(
                "timestamp",
                DataType::Timestamp(TimeUnit::Microsecond, None),
                false,
            ),
            Field::new("count", DataType::Int64, false),
        ]));
        let histogram_counts = vec![10, 20]; // Only 2 counts
        let result = create_histogram_arrow_array(&schema, histogram_counts, 1000, 100, 5).unwrap();

        assert_eq!(result.len(), 2);
        let timestamp_array = result[0]
            .as_any()
            .downcast_ref::<TimestampMicrosecondArray>()
            .unwrap();
        let count_array = result[1].as_any().downcast_ref::<Int64Array>().unwrap();

        assert_eq!(timestamp_array.len(), 2); // Only non-zero counts
        assert_eq!(count_array.len(), 2);
        assert_eq!(timestamp_array.value(0), 1000);
        assert_eq!(timestamp_array.value(1), 1100);
        assert_eq!(count_array.value(0), 10);
        assert_eq!(count_array.value(1), 20);
    }

    #[test]
    fn test_create_top_n_arrow_array() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("field", DataType::Utf8, false),
            Field::new("count", DataType::Int64, false),
        ]));
        let top_n = vec![("a".to_string(), 10), ("b".to_string(), 20)];
        let result = create_top_n_arrow_array(&schema, top_n, "field", 2).unwrap();

        assert_eq!(result.len(), 1); // One batch
        let batch = &result[0];
        assert_eq!(batch.len(), 2); // Two arrays

        let field_array = batch[0].as_any().downcast_ref::<StringArray>().unwrap();
        let count_array = batch[1].as_any().downcast_ref::<Int64Array>().unwrap();

        assert_eq!(field_array.len(), 2);
        assert_eq!(count_array.len(), 2);
        assert_eq!(field_array.value(0), "a");
        assert_eq!(field_array.value(1), "b");
        assert_eq!(count_array.value(0), 10);
        assert_eq!(count_array.value(1), 20);
    }

    #[test]
    fn test_create_top_n_arrow_array_empty() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("field", DataType::Utf8, false),
            Field::new("count", DataType::Int64, false),
        ]));
        let result = create_top_n_arrow_array(&schema, vec![], "field", 2).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_create_top_n_arrow_array_invalid_schema() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "field",
            DataType::Utf8,
            false,
        )]));
        let top_n = vec![("a".to_string(), 10)];
        let result = create_top_n_arrow_array(&schema, top_n, "field", 1);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_distinct_arrow_array() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "field",
            DataType::Utf8,
            false,
        )]));
        let distinct_values = vec!["a".to_string(), "b".to_string(), "c".to_string()]
            .into_iter()
            .collect();
        let result = create_distinct_arrow_array(&schema, distinct_values).unwrap();

        assert_eq!(result.len(), 1);
        let field_array = result[0].as_any().downcast_ref::<StringArray>().unwrap();
        assert_eq!(field_array.len(), 3);
        // Note: HashSet order is not guaranteed, so we just check the length
    }

    #[test]
    fn test_create_distinct_arrow_array_invalid_schema() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("field", DataType::Utf8, false),
            Field::new("count", DataType::Int64, false),
        ]));
        let distinct_values = vec!["a".to_string()].into_iter().collect();
        let result = create_distinct_arrow_array(&schema, distinct_values);
        assert!(result.is_err());
    }

    #[test]
    fn test_tantivy_optimize_exec_new() {
        let query = Arc::new(QueryParams {
            trace_id: "test".to_string(),
            org_id: "org".to_string(),
            stream: TableReference::from("test"),
            stream_type: StreamType::Logs,
            stream_name: "test".to_string(),
            time_range: (0, 1000),
            work_group: None,
            use_inverted_index: false,
        });
        let schema = Arc::new(Schema::new(vec![Field::new(
            "field",
            DataType::Utf8,
            false,
        )]));
        let file_list = vec![FileKey {
            id: 1,
            account: "test_account".to_string(),
            key: "test.parquet".to_string(),
            meta: FileMeta::default(),
            deleted: false,
            segment_ids: None,
        }];
        let index_condition = None;
        let index_optimize_mode = IndexOptimizeMode::SimpleCount;

        let exec = TantivyOptimizeExec::new(
            query.clone(),
            schema.clone(),
            file_list.clone(),
            index_condition.clone(),
            index_optimize_mode.clone(),
        );

        assert_eq!(exec.query.trace_id, "test");
        assert_eq!(exec.file_list.len(), 1);
        assert_eq!(exec.index_optimize_mode, index_optimize_mode);
    }

    #[test]
    fn test_tantivy_optimize_exec_display() {
        let query = Arc::new(QueryParams {
            trace_id: "test".to_string(),
            org_id: "org".to_string(),
            stream: TableReference::from("test"),
            stream_name: "test".to_string(),
            stream_type: StreamType::Logs,
            time_range: (0, 1000),
            work_group: None,
            use_inverted_index: false,
        });
        let schema = Arc::new(Schema::new(vec![Field::new(
            "field",
            DataType::Utf8,
            false,
        )]));
        let file_list = vec![
            FileKey {
                id: 1,
                account: "test_account".to_string(),
                key: "file1.parquet".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                segment_ids: None,
            },
            FileKey {
                id: 2,
                account: "test_account".to_string(),
                key: "file2.parquet".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                segment_ids: None,
            },
            FileKey {
                id: 3,
                account: "test_account".to_string(),
                key: "file3.parquet".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                segment_ids: None,
            },
            FileKey {
                id: 4,
                account: "test_account".to_string(),
                key: "file4.parquet".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                segment_ids: None,
            },
            FileKey {
                id: 5,
                account: "test_account".to_string(),
                key: "file5.parquet".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                segment_ids: None,
            },
            FileKey {
                id: 6,
                account: "test_account".to_string(),
                key: "file6.parquet".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                segment_ids: None,
            },
        ];
        let index_condition = None;
        let index_optimize_mode = IndexOptimizeMode::SimpleCount;

        let exec = Arc::new(TantivyOptimizeExec::new(
            query,
            schema,
            file_list,
            index_condition,
            index_optimize_mode,
        ));

        let display = format!(
            "{}",
            datafusion::physical_plan::displayable(exec.as_ref()).indent(false)
        );
        assert!(display.contains("TantivyOptimizeExec: files: 6"));
        assert!(display.contains("optimize_mode: SimpleCount"));
        assert!(display.contains(
            "file_list: [file1.parquet, file2.parquet, file3.parquet, file4.parquet, file5.parquet"
        ));
    }

    #[test]
    fn test_tantivy_optimize_exec_execution_plan() {
        let query = Arc::new(QueryParams {
            trace_id: "test".to_string(),
            org_id: "org".to_string(),
            stream: TableReference::from("test"),
            stream_type: StreamType::Logs,
            stream_name: "test".to_string(),
            time_range: (0, 1000),
            work_group: None,
            use_inverted_index: false,
        });
        let schema = Arc::new(Schema::new(vec![Field::new(
            "field",
            DataType::Utf8,
            false,
        )]));
        let file_list = vec![FileKey {
            id: 1,
            account: "test_account".to_string(),
            key: "test.parquet".to_string(),
            meta: FileMeta::default(),
            deleted: false,
            segment_ids: None,
        }];
        let index_condition = None;
        let index_optimize_mode = IndexOptimizeMode::SimpleCount;

        let exec = TantivyOptimizeExec::new(
            query,
            schema,
            file_list,
            index_condition,
            index_optimize_mode,
        );

        assert_eq!(exec.name(), "TantivyOptimizeExec");
        assert!(exec.children().is_empty());
        assert_eq!(exec.properties().output_partitioning().partition_count(), 1);
    }

    #[test]
    fn test_tantivy_optimize_exec_with_new_children() {
        let query = Arc::new(QueryParams {
            trace_id: "test".to_string(),
            org_id: "org".to_string(),
            stream: TableReference::from("test"),
            stream_type: StreamType::Logs,
            stream_name: "test".to_string(),
            time_range: (0, 1000),
            work_group: None,
            use_inverted_index: false,
        });
        let schema = Arc::new(Schema::new(vec![Field::new(
            "field",
            DataType::Utf8,
            false,
        )]));
        let file_list = vec![FileKey {
            id: 1,
            account: "test_account".to_string(),
            key: "test.parquet".to_string(),
            meta: FileMeta::default(),
            deleted: false,
            segment_ids: None,
        }];
        let index_condition = None;
        let index_optimize_mode = IndexOptimizeMode::SimpleCount;

        let exec = Arc::new(TantivyOptimizeExec::new(
            query,
            schema,
            file_list,
            index_condition,
            index_optimize_mode,
        ));

        let result = exec.with_new_children(vec![]);
        assert!(result.is_ok());
        let new_exec = result.unwrap();
        assert_eq!(new_exec.name(), "TantivyOptimizeExec");
    }

    #[test]
    fn test_tantivy_optimize_exec_statistics() {
        let query = Arc::new(QueryParams {
            trace_id: "test".to_string(),
            org_id: "org".to_string(),
            stream: TableReference::from("test"),
            stream_type: StreamType::Logs,
            stream_name: "test".to_string(),
            time_range: (0, 1000),
            work_group: None,
            use_inverted_index: false,
        });
        let schema = Arc::new(Schema::new(vec![Field::new(
            "field",
            DataType::Utf8,
            false,
        )]));
        let file_list = vec![FileKey {
            id: 1,
            account: "test_account".to_string(),
            key: "test.parquet".to_string(),
            meta: FileMeta::default(),
            deleted: false,
            segment_ids: None,
        }];
        let index_condition = None;
        let index_optimize_mode = IndexOptimizeMode::SimpleCount;

        let exec = TantivyOptimizeExec::new(
            query,
            schema,
            file_list,
            index_condition,
            index_optimize_mode,
        );

        let stats = exec.partition_statistics(None);
        assert!(stats.is_ok());
        let stats = stats.unwrap();
        assert!(matches!(
            stats.num_rows,
            datafusion::common::stats::Precision::Absent
        ));
    }
}
