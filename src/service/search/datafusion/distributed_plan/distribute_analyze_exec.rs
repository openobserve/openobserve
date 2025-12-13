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

use arrow::{
    array::{Int32Builder, StringBuilder},
    datatypes::SchemaRef,
    record_batch::RecordBatch,
};
use arrow_schema::{DataType, Field, Schema};
use config::{cluster::LOCAL_NODE, meta::cluster::NodeInfo};
use datafusion::{
    common::{DataFusionError, Result, internal_err},
    execution::TaskContext,
    physical_expr::EquivalenceProperties,
    physical_plan::{
        DisplayAs, DisplayFormatType, Distribution, ExecutionPlan, ExecutionPlanProperties,
        Partitioning, PlanProperties, SendableRecordBatchStream, execute_stream,
        stream::RecordBatchStreamAdapter,
    },
};
use flight::common::Metrics;
use futures::StreamExt;

use crate::{
    handler::grpc::flight::visitor::get_cluster_metrics,
    service::search::datafusion::distributed_plan::display::DisplayableExecutionPlan,
};

/// query EXPLAIN ANALYZE in distributed mode
/// the output recordbatch's schema is
/// phase: current we have three phase
/// node: the ip or partition id
/// plan: plan with metrics
#[derive(Debug)]
pub struct DistributeAnalyzeExec {
    /// Control how much extra to print
    verbose: bool,
    /// If statistics should be displayed
    show_statistics: bool,
    /// The input plan (the plan being analyzed)
    pub input: Arc<dyn ExecutionPlan>,
    /// The output schema for RecordBatches of this exec node
    schema: SchemaRef,
    cache: PlanProperties,
}

impl DistributeAnalyzeExec {
    /// Create a new AnalyzeExec
    pub fn new(verbose: bool, show_statistics: bool, input: Arc<dyn ExecutionPlan>) -> Self {
        let fields = vec![
            Field::new("phase", DataType::Int32, false),
            Field::new("node_address", DataType::Utf8, false),
            Field::new("node_name", DataType::Utf8, false),
            Field::new("plan", DataType::Utf8, false),
        ];
        let schema = Arc::new(Schema::new(fields));
        let cache = Self::compute_properties(&input, Arc::clone(&schema));
        DistributeAnalyzeExec {
            verbose,
            show_statistics,
            input,
            schema,
            cache,
        }
    }

    /// This function creates the cache object that stores the plan properties such as schema,
    /// equivalence properties, ordering, partitioning, etc.
    fn compute_properties(input: &Arc<dyn ExecutionPlan>, schema: SchemaRef) -> PlanProperties {
        PlanProperties::new(
            EquivalenceProperties::new(schema),
            Partitioning::UnknownPartitioning(1),
            input.pipeline_behavior(),
            input.boundedness(),
        )
    }
}

impl DisplayAs for DistributeAnalyzeExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "DistributeAnalyzeExec verbose={}", self.verbose)
    }
}

impl ExecutionPlan for DistributeAnalyzeExec {
    fn name(&self) -> &'static str {
        "DistributeAnalyzeExec"
    }

    /// Return a reference to Any that can be used for downcasting
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.input]
    }

    /// AnalyzeExec is handled specially so this value is ignored
    fn required_input_distribution(&self) -> Vec<Distribution> {
        vec![]
    }

    fn with_new_children(
        self: Arc<Self>,
        mut children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        Ok(Arc::new(Self::new(
            self.verbose,
            self.show_statistics,
            children.pop().unwrap(),
        )))
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        if 0 != partition {
            return internal_err!(
                "DistributeAnalyzeExec invalid partition. Expected 0, got {partition}"
            );
        }

        // Create future that computes the final output
        let start = std::time::Instant::now();
        let captured_input = Arc::clone(&self.input);
        let captured_schema = Arc::clone(&self.schema);
        let verbose = self.verbose;
        let show_statistics = self.show_statistics;

        let mut stream = execute_stream(self.input.clone(), context.clone())?;
        let output = async move {
            let mut total_rows = 0;
            while let Some(batch) = stream.next().await.transpose()? {
                total_rows += batch.num_rows();
            }

            let duration = std::time::Instant::now() - start;
            create_output_batch(
                verbose,
                show_statistics,
                total_rows,
                duration,
                captured_input,
                captured_schema,
            )
        };

        Ok(Box::pin(RecordBatchStreamAdapter::new(
            Arc::clone(&self.schema),
            futures::stream::once(output),
        )))
    }
}

fn create_output_batch(
    verbose: bool,
    _show_statistics: bool,
    total_rows: usize,
    duration: std::time::Duration,
    input: Arc<dyn ExecutionPlan>,
    schema: SchemaRef,
) -> Result<RecordBatch> {
    let mut phase_builder = Int32Builder::new();
    let mut address_builder = StringBuilder::with_capacity(1, 1024);
    let mut name_builder = StringBuilder::with_capacity(1, 1024);
    let mut plan_builder = StringBuilder::with_capacity(1, 1024);

    phase_builder.append_value(0); // Phase 0 for the main plan
    address_builder.append_value(LOCAL_NODE.get_grpc_addr());
    name_builder.append_value(LOCAL_NODE.get_name());

    let annotated_plan = DisplayableExecutionPlan::new(input.as_ref())
        .indent(verbose)
        .to_string();
    plan_builder.append_value(annotated_plan);

    // add metrics from remote scan
    let metrics = collect_metrics(input);

    for m in metrics {
        phase_builder.append_value(m.stage);
        address_builder.append_value(m.node_address);
        name_builder.append_value(m.node_name);
        plan_builder.append_value(m.metrics);
    }

    if verbose {
        phase_builder.append_value(0); // Phase 0 for the main plan
        address_builder.append_value("Output Rows");
        name_builder.append_value("");
        plan_builder.append_value(total_rows.to_string());

        phase_builder.append_value(0); // Phase 0 for the main plan
        address_builder.append_value("Duration");
        name_builder.append_value("");
        plan_builder.append_value(format!("{duration:?}"));
    }

    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(phase_builder.finish()),
            Arc::new(address_builder.finish()),
            Arc::new(name_builder.finish()),
            Arc::new(plan_builder.finish()),
        ],
    )
    .map_err(DataFusionError::from)
}

fn collect_metrics(plan: Arc<dyn ExecutionPlan>) -> Vec<Metrics> {
    let mut metrics = Vec::new();
    for m in get_cluster_metrics(&plan) {
        let m = m.lock().clone();
        metrics.extend(m);
    }
    metrics
}
