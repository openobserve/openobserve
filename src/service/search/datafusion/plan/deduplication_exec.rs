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
    any::Any,
    sync::Arc,
    task::{Context, Poll},
};

use arrow::array::{
    BooleanArray, Float64Array, Int64Array, LargeStringArray, RecordBatch, StringArray,
    StringViewArray, TimestampMicrosecondArray, UInt64Array,
};
use arrow_schema::{DataType, SortOptions, TimeUnit};
use config::TIMESTAMP_COL_NAME;
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{Result, Statistics, internal_err},
    execution::{RecordBatchStream, SendableRecordBatchStream, TaskContext},
    physical_expr::{
        EquivalenceProperties, LexRequirement, OrderingRequirements, Partitioning,
        PhysicalSortRequirement,
    },
    physical_plan::{
        DisplayAs, DisplayFormatType, Distribution, ExecutionPlan, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        expressions::Column,
        metrics::{BaselineMetrics, ExecutionPlanMetricsSet, MetricsSet},
    },
};
use futures::{Stream, StreamExt};
use itertools::Itertools;

#[derive(Debug)]
pub struct DeduplicationExec {
    input: Arc<dyn ExecutionPlan>,
    deduplication_columns: Vec<Column>,
    max_rows: usize, // current unused
    cache: PlanProperties,
    metrics: ExecutionPlanMetricsSet,
}

impl DeduplicationExec {
    /// Create a new DeduplicationExec
    pub fn new(
        input: Arc<dyn ExecutionPlan>,
        deduplication_columns: Vec<Column>,
        max_rows: usize,
    ) -> Self {
        let cache = Self::compute_properties(input.schema());
        DeduplicationExec {
            input,
            deduplication_columns,
            max_rows,
            cache,
            metrics: ExecutionPlanMetricsSet::new(),
        }
    }

    fn compute_properties(schema: SchemaRef) -> PlanProperties {
        PlanProperties::new(
            // TODO: add the order by properties
            EquivalenceProperties::new(schema.clone()),
            // Output Partitioning
            Partitioning::UnknownPartitioning(1),
            // Execution Mode
            EmissionType::Incremental,
            Boundedness::Bounded,
        )
    }
}

impl DisplayAs for DeduplicationExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "DeduplicationExec: columns: [{}]",
            self.deduplication_columns
                .iter()
                .map(|c| format!("{c}"))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

impl ExecutionPlan for DeduplicationExec {
    fn name(&self) -> &'static str {
        "DeduplicationExec"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.input]
    }

    fn with_new_children(
        self: Arc<Self>,
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        assert!(children.len() == 1);
        Ok(Arc::new(DeduplicationExec::new(
            children.into_iter().next().unwrap(),
            self.deduplication_columns.clone(),
            self.max_rows,
        )))
    }

    fn supports_limit_pushdown(&self) -> bool {
        true
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        if partition != 0 {
            return internal_err!(
                "DeduplicationExec invalid partition {partition} (expected partition: 0)"
            );
        }

        let input_stream = self.input.execute(partition, context)?;

        let metrics = BaselineMetrics::new(&self.metrics, partition);

        Ok(Box::pin(DeduplicationStream::new(
            input_stream,
            self.deduplication_columns.clone(),
            metrics,
        )))
    }

    fn partition_statistics(&self, partition: Option<usize>) -> Result<Statistics> {
        self.input.partition_statistics(partition)
    }

    // if don't have this, the optimizer will not merge the SortExec
    // and get wrong result
    fn required_input_ordering(&self) -> Vec<Option<OrderingRequirements>> {
        let mut sort_requirment = self
            .deduplication_columns
            .iter()
            .map(|column| {
                PhysicalSortRequirement::new(
                    Arc::new(column.clone()) as _,
                    Some(SortOptions::new(true, false)),
                )
            })
            .collect_vec();
        if let Some((index, _)) = self.schema().column_with_name(TIMESTAMP_COL_NAME) {
            sort_requirment.push(PhysicalSortRequirement::new(
                Arc::new(Column::new(TIMESTAMP_COL_NAME, index)) as _,
                Some(SortOptions::new(true, false)),
            ));
        }
        vec![LexRequirement::new(sort_requirment).map(OrderingRequirements::new)]
    }

    fn required_input_distribution(&self) -> Vec<Distribution> {
        vec![Distribution::SinglePartition; self.children().len()]
    }

    fn metrics(&self) -> Option<MetricsSet> {
        Some(self.metrics.clone_inner())
    }
}

// TODO: rewrite this part use arrow kernel
struct DeduplicationStream {
    stream: SendableRecordBatchStream,
    deduplication_columns: Vec<Column>,
    last_value: Option<Vec<Value>>,
    #[allow(unused)]
    batch_size: usize,
    metrics: BaselineMetrics,
}

impl DeduplicationStream {
    pub fn new(
        stream: SendableRecordBatchStream,
        deduplication_columns: Vec<Column>,
        metrics: BaselineMetrics,
    ) -> Self {
        Self {
            stream,
            deduplication_columns,
            last_value: None,
            batch_size: 0,
            metrics,
        }
    }
}

impl Stream for DeduplicationStream {
    type Item = Result<RecordBatch>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        let poll = match self.stream.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(batch))) => {
                let timer = std::time::Instant::now();
                // deduplication the batch based on the deduplication_columns
                let deduplication_arrays =
                    generate_deduplication_arrays(&self.deduplication_columns, &batch);

                let mut indexes = vec![];
                if self.last_value.is_none() {
                    self.last_value = Some(deduplication_arrays.get_value(0));
                    indexes.push(0);
                }

                for i in 0..batch.num_rows() {
                    if *self.last_value.as_ref().unwrap() != deduplication_arrays.get_value(i) {
                        indexes.push(i as u64);
                        self.last_value = Some(deduplication_arrays.get_value(i));
                    }
                }

                // for each column use indexes to take() value from batch
                let mut new_columns = vec![];
                let indexes = UInt64Array::from(indexes);
                for i in 0..batch.columns().len() {
                    let column = batch.column(i);
                    let values = arrow::compute::take(column, &indexes, None)?;
                    new_columns.push(values);
                }

                let new_batch = RecordBatch::try_new(self.schema(), new_columns)?;

                self.metrics.elapsed_compute().add_duration(timer.elapsed());

                Poll::Ready(Some(Ok(new_batch)))
            }
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(e))),
        };

        self.metrics.record_poll(poll)
    }
}

impl RecordBatchStream for DeduplicationStream {
    /// Get the schema
    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.stream.schema())
    }
}

#[derive(Debug, Clone)]
struct DeduplicationArrays {
    pub arrays: Vec<Array>,
}

impl DeduplicationArrays {
    pub fn get_value(&self, i: usize) -> Vec<Value> {
        self.arrays
            .iter()
            .map(|array| array.get_value(i))
            .collect_vec()
    }
}

#[derive(Debug, Clone)]
enum Array {
    String(StringArray),
    StringView(StringViewArray),
    LargeString(LargeStringArray),
    Int64(Int64Array),
    UInt64(UInt64Array),
    Boolean(BooleanArray),
    Float64(Float64Array),
    TimestampMicrosecond(TimestampMicrosecondArray),
}

impl Array {
    pub fn get_value(&self, i: usize) -> Value {
        match &self {
            Array::String(array) => Value::String(array.value(i).to_string()),
            Array::StringView(array) => Value::String(array.value(i).to_string()),
            Array::LargeString(array) => Value::String(array.value(i).to_string()),
            Array::Int64(array) => Value::Int64(array.value(i)),
            Array::UInt64(array) => Value::UInt64(array.value(i)),
            Array::Boolean(array) => Value::Boolean(array.value(i)),
            Array::Float64(array) => Value::Float64(array.value(i)),
            Array::TimestampMicrosecond(array) => Value::Int64(array.value(i)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, PartialOrd)]
enum Value {
    String(String),
    Int64(i64),
    UInt64(u64),
    Boolean(bool),
    Float64(f64),
}

fn generate_deduplication_arrays(
    deduplication_columns: &[Column],
    batch: &RecordBatch,
) -> DeduplicationArrays {
    let arrays = deduplication_columns
        .iter()
        .map(|column| {
            let array = batch.column(column.index());
            match array.data_type() {
                DataType::Utf8 => Array::String(
                    array
                        .as_any()
                        .downcast_ref::<StringArray>()
                        .unwrap()
                        .clone(),
                ),
                DataType::Utf8View => Array::StringView(
                    array
                        .as_any()
                        .downcast_ref::<StringViewArray>()
                        .unwrap()
                        .clone(),
                ),
                DataType::LargeUtf8 => Array::LargeString(
                    array
                        .as_any()
                        .downcast_ref::<LargeStringArray>()
                        .unwrap()
                        .clone(),
                ),
                DataType::Int64 => {
                    Array::Int64(array.as_any().downcast_ref::<Int64Array>().unwrap().clone())
                }
                DataType::UInt64 => Array::UInt64(
                    array
                        .as_any()
                        .downcast_ref::<UInt64Array>()
                        .unwrap()
                        .clone(),
                ),
                DataType::Boolean => Array::Boolean(
                    array
                        .as_any()
                        .downcast_ref::<BooleanArray>()
                        .unwrap()
                        .clone(),
                ),
                DataType::Float64 => Array::Float64(
                    array
                        .as_any()
                        .downcast_ref::<Float64Array>()
                        .unwrap()
                        .clone(),
                ),
                DataType::Timestamp(TimeUnit::Microsecond, None) => Array::TimestampMicrosecond(
                    array
                        .as_any()
                        .downcast_ref::<TimestampMicrosecondArray>()
                        .unwrap()
                        .clone(),
                ),
                _ => {
                    panic!("Unsupported data type: {}", array.data_type());
                }
            }
        })
        .collect_vec();
    DeduplicationArrays { arrays }
}
