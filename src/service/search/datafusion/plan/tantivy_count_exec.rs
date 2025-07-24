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

use std::{any::Any, sync::Arc};

use arrow::array::{
    Array, Int64Array, TimestampMicrosecondArray, TimestampNanosecondArray, UInt64Array,
};
use config::meta::{inverted_index::InvertedIndexOptimizeMode, stream::FileKey};
use datafusion::{
    arrow::{array::RecordBatch, datatypes::SchemaRef},
    common::{Result, Statistics, internal_err},
    error::DataFusionError,
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        stream::RecordBatchStreamAdapter,
    },
};

use crate::service::search::{
    grpc::{QueryParams, storage::filter_file_list_by_tantivy_index},
    index::IndexCondition,
};

#[derive(Debug)]
pub struct TantivyOptimizeExec {
    query: Arc<QueryParams>,
    schema: SchemaRef,               // The schema for the produced row
    file_list: Vec<FileKey>,         // The list of files to read
    index_condition: IndexCondition, // The condition to filter the rows
    cache: PlanProperties,           // Cached properties of this plan
    index_optimize_mode: InvertedIndexOptimizeMode, // Type of query the ttv index optimizes
}

impl TantivyOptimizeExec {
    /// Create a new TantivyOptimizeExec
    pub fn new(
        query: Arc<QueryParams>,
        schema: SchemaRef,
        file_list: Vec<FileKey>,
        index_condition: IndexCondition,
        index_optimize_mode: InvertedIndexOptimizeMode,
    ) -> Self {
        let cache = Self::compute_properties(Arc::clone(&schema));
        TantivyOptimizeExec {
            query,
            schema,
            file_list,
            index_condition,
            cache,
            index_optimize_mode,
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
            "TantivyOptimizeExec: files: {}, file_list: [{file_keys}]",
            self.file_list.len()
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

        let fut = adapt_tantivy_result(
            self.query.clone(),
            self.file_list.clone(),
            Some(self.index_condition.clone()),
            self.schema.clone(),
            self.index_optimize_mode.clone(),
        );
        let stream = futures::stream::once(fut);
        Ok(Box::pin(RecordBatchStreamAdapter::new(
            self.schema.clone(),
            stream,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema))
    }
}

async fn adapt_tantivy_result(
    query: Arc<QueryParams>,
    mut file_list: Vec<FileKey>,
    index_condition: Option<IndexCondition>,
    schema: SchemaRef,
    idx_optimize_mode: InvertedIndexOptimizeMode,
) -> Result<RecordBatch> {
    let (idx_took, error, total_hits, histogram_counts) = filter_file_list_by_tantivy_index(
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

    let array = match idx_optimize_mode {
        InvertedIndexOptimizeMode::SimpleCount => {
            vec![Arc::new(Int64Array::from(vec![total_hits as i64])) as Arc<dyn Array>]
        }
        InvertedIndexOptimizeMode::SimpleHistogram(min_value, bucket_width, num_buckets) => {
            create_histogram_arrow_array(
                &schema,
                histogram_counts,
                min_value,
                bucket_width,
                num_buckets,
            )?
        }
        _ => {
            return internal_err!(
                "Only count and histogram optimize modes are supported by TantivyOptimizeExec"
            );
        }
    };

    RecordBatch::try_new(schema, array).map_err(|e| {
        DataFusionError::Internal(format!(
            "TantivyOptimizeExec create record batch error: {e}",
        ))
    })
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
