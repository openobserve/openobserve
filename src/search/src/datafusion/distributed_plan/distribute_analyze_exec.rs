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

use std::sync::Arc;

use arrow::{
    array::{ArrayBuilder, ArrayRef, Int32Builder, StringArray, StringBuilder},
    datatypes::SchemaRef,
    record_batch::RecordBatch,
};
use arrow_schema::{DataType, Field, Schema};
use config::{cluster::LOCAL_NODE, meta::cluster::NodeInfo, utils::time::now_micros};
use datafusion::{
    common::{DataFusionError, Result, internal_err, tree_node::TreeNodeRecursion},
    execution::TaskContext,
    physical_expr::{EquivalenceProperties, PhysicalExpr},
    physical_plan::{
        DisplayAs, DisplayFormatType, Distribution, ExecutionPlan, ExecutionPlanProperties,
        Partitioning, PlanProperties, SendableRecordBatchStream, execute_stream,
        stream::RecordBatchStreamAdapter,
    },
};
use flight::profile::{ProfileInputs, ProfileNode, QueryProfile, RemoteNodeProfile};
use futures::StreamExt;

use crate::datafusion::distributed_plan::{
    display::DisplayableExecutionPlan, profile::build_profile,
};

/// EXPLAIN ANALYZE across nodes: one text row per node that ran a plan, phase = its depth.
#[derive(Debug, Clone)]
pub struct DistributeAnalyzeExec {
    /// Control how much extra to print
    verbose: bool,
    /// If statistics should be displayed
    show_statistics: bool,
    /// Adds the `profile` column, the whole profile as JSON on the first row.
    profile: bool,
    /// The input plan (the plan being analyzed)
    pub input: Arc<dyn ExecutionPlan>,
    /// The output schema for RecordBatches of this exec node
    schema: SchemaRef,
    cache: Arc<PlanProperties>,
}

impl DistributeAnalyzeExec {
    pub fn new(
        verbose: bool,
        show_statistics: bool,
        profile: bool,
        input: Arc<dyn ExecutionPlan>,
    ) -> Self {
        let mut fields = vec![
            Field::new("phase", DataType::Int32, false),
            Field::new("node_address", DataType::Utf8, false),
            Field::new("node_name", DataType::Utf8, false),
            Field::new("plan", DataType::Utf8, false),
        ];
        if profile {
            fields.push(Field::new("profile", DataType::Utf8, true));
        }
        let schema = Arc::new(Schema::new(fields));
        let cache = Self::compute_properties(&input, Arc::clone(&schema));
        DistributeAnalyzeExec {
            verbose,
            show_statistics,
            profile,
            input,
            schema,
            cache,
        }
    }

    fn output_batch(
        &self,
        profile: &QueryProfile,
        duration: std::time::Duration,
    ) -> Result<RecordBatch> {
        let mut phase_builder = Int32Builder::new();
        let mut address_builder = StringBuilder::with_capacity(1, 1024);
        let mut name_builder = StringBuilder::with_capacity(1, 1024);
        let mut plan_builder = StringBuilder::with_capacity(1, 1024);

        phase_builder.append_value(0);
        address_builder.append_value(&profile.node_address);
        name_builder.append_value(&profile.node_name);
        let annotated_plan = DisplayableExecutionPlan::new(self.input.as_ref())
            .indent(self.verbose)
            .to_string();
        plan_builder.append_value(annotated_plan);

        let mut remote_rows = Vec::new();
        collect_remote_rows(&profile.plan, 1, &mut remote_rows);
        for (stage, node, plan) in remote_rows {
            phase_builder.append_value(stage);
            address_builder.append_value(&node.node_address);
            name_builder.append_value(&node.node_name);
            plan_builder.append_value(plan.to_text());
        }

        if self.verbose {
            phase_builder.append_value(0);
            address_builder.append_value("Output Rows");
            name_builder.append_value("");
            plan_builder.append_value(profile.output_rows.to_string());

            phase_builder.append_value(0);
            address_builder.append_value("Duration");
            name_builder.append_value("");
            plan_builder.append_value(format!("{duration:?}"));
        }

        let rows = phase_builder.len();
        let mut columns: Vec<ArrayRef> = vec![
            Arc::new(phase_builder.finish()),
            Arc::new(address_builder.finish()),
            Arc::new(name_builder.finish()),
            Arc::new(plan_builder.finish()),
        ];
        if self.profile {
            let json =
                serde_json::to_string(profile).map_err(|e| DataFusionError::External(e.into()))?;
            columns.push(Arc::new(StringArray::from_iter(
                std::iter::once(Some(json)).chain(std::iter::repeat_n(None, rows - 1)),
            )));
        }

        RecordBatch::try_new(Arc::clone(&self.schema), columns).map_err(DataFusionError::from)
    }

    /// This function creates the cache object that stores the plan properties such as schema,
    /// equivalence properties, ordering, partitioning, etc.
    fn compute_properties(
        input: &Arc<dyn ExecutionPlan>,
        schema: SchemaRef,
    ) -> Arc<PlanProperties> {
        Arc::new(PlanProperties::new(
            EquivalenceProperties::new(schema),
            Partitioning::UnknownPartitioning(1),
            input.pipeline_behavior(),
            input.boundedness(),
        ))
    }
}

impl DisplayAs for DistributeAnalyzeExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "DistributeAnalyzeExec verbose={}", self.verbose)
    }
}

impl ExecutionPlan for DistributeAnalyzeExec {
    fn apply_expressions(
        &self,
        _f: &mut dyn FnMut(&Arc<dyn PhysicalExpr>) -> Result<TreeNodeRecursion>,
    ) -> Result<TreeNodeRecursion> {
        Ok(TreeNodeRecursion::Continue)
    }

    fn name(&self) -> &'static str {
        "DistributeAnalyzeExec"
    }

    fn properties(&self) -> &Arc<PlanProperties> {
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
            self.profile,
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
        let start_us = now_micros();
        let exec = self.clone();

        let mut stream = execute_stream(self.input.clone(), context.clone())?;
        let output = async move {
            let mut total_rows = 0;
            while let Some(batch) = stream.next().await.transpose()? {
                total_rows += batch.num_rows();
            }
            // remote nodes publish their profiles when their streams are dropped
            drop(stream);

            let duration = std::time::Instant::now() - start;
            let profile = QueryProfile {
                node_name: LOCAL_NODE.get_name(),
                node_address: LOCAL_NODE.get_grpc_addr(),
                start_us,
                end_us: now_micros(),
                output_rows: total_rows,
                plan: build_profile(exec.input.as_ref()),
            };
            exec.output_batch(&profile, duration)
        };

        Ok(Box::pin(RecordBatchStreamAdapter::new(
            Arc::clone(&self.schema),
            futures::stream::once(output),
        )))
    }
}

/// Lists, depth first, each remote node that sent back its plan, with its stage below the leader.
fn collect_remote_rows<'a>(
    node: &'a ProfileNode,
    stage: i32,
    rows: &mut Vec<(i32, &'a RemoteNodeProfile, &'a ProfileNode)>,
) {
    match &node.inputs {
        ProfileInputs::Children(children) => {
            for child in children {
                collect_remote_rows(child, stage, rows);
            }
        }
        ProfileInputs::Remote(remotes) => {
            for (remote, plan) in remotes
                .iter()
                .filter_map(|r| r.plan.as_ref().map(|plan| (r, plan)))
            {
                rows.push((stage, remote, plan));
                collect_remote_rows(plan, stage + 1, rows);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::Array;
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::physical_plan::empty::EmptyExec;

    use super::*;

    fn empty_input() -> Arc<dyn ExecutionPlan> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        Arc::new(EmptyExec::new(schema))
    }

    #[test]
    fn test_distribute_analyze_exec_new_non_verbose() {
        let input = empty_input();
        let exec = DistributeAnalyzeExec::new(false, false, false, input);
        assert_eq!(exec.name(), "DistributeAnalyzeExec");
        assert_eq!(exec.children().len(), 1);
    }

    #[test]
    fn test_distribute_analyze_exec_new_verbose() {
        let input = empty_input();
        let exec = DistributeAnalyzeExec::new(true, true, false, input);
        assert_eq!(exec.name(), "DistributeAnalyzeExec");
    }

    #[test]
    fn test_distribute_analyze_exec_schema_has_four_fields() {
        let input = empty_input();
        let exec = DistributeAnalyzeExec::new(false, false, false, input);
        assert_eq!(exec.schema().fields().len(), 4);
        assert_eq!(exec.schema().field(0).name(), "phase");
        assert_eq!(exec.schema().field(1).name(), "node_address");
    }

    #[test]
    fn test_distribute_analyze_exec_schema_adds_profile_when_requested() {
        let exec = DistributeAnalyzeExec::new(false, false, true, empty_input());
        assert_eq!(exec.schema().fields().len(), 5);
        assert_eq!(exec.schema().field(4).name(), "profile");
        assert!(exec.schema().field(4).is_nullable());
    }

    #[tokio::test]
    async fn test_distribute_analyze_exec_without_profile_emits_four_columns() {
        let exec = Arc::new(DistributeAnalyzeExec::new(
            true,
            false,
            false,
            empty_input(),
        ));
        let batches = datafusion::physical_plan::collect(exec, Arc::new(TaskContext::default()))
            .await
            .unwrap();
        assert_eq!(batches[0].num_columns(), 4);
    }

    #[tokio::test]
    async fn test_distribute_analyze_exec_emits_profile_on_first_row() {
        let exec = Arc::new(DistributeAnalyzeExec::new(true, false, true, empty_input()));
        let batches = datafusion::physical_plan::collect(exec, Arc::new(TaskContext::default()))
            .await
            .unwrap();
        let profile = batches[0]
            .column(4)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert!(profile.is_valid(0));
        assert!((1..profile.len()).all(|i| profile.is_null(i)));
        let parsed: QueryProfile = serde_json::from_str(profile.value(0)).unwrap();
        assert_eq!(parsed.plan.name, "EmptyExec");
        assert!(parsed.end_us >= parsed.start_us);
    }

    #[test]
    fn test_collect_remote_rows_nests_stages_and_skips_nodes_without_plan() {
        let node = |name: &str, plan: Option<ProfileNode>| RemoteNodeProfile {
            node_name: name.to_string(),
            plan,
            ..Default::default()
        };
        let scan = |remotes| ProfileNode {
            name: "RemoteScanExec".to_string(),
            inputs: ProfileInputs::Remote(remotes),
            ..Default::default()
        };
        let cluster_leader = node(
            "b-querier-0",
            Some(scan(vec![node(
                "b-querier-1",
                Some(ProfileNode::default()),
            )])),
        );
        let root = ProfileNode {
            inputs: ProfileInputs::Children(vec![scan(vec![
                cluster_leader,
                node("skipped", None),
            ])]),
            ..Default::default()
        };
        let mut rows = Vec::new();
        collect_remote_rows(&root, 1, &mut rows);
        let rows: Vec<_> = rows
            .iter()
            .map(|(stage, node, _)| (*stage, node.node_name.as_str()))
            .collect();
        assert_eq!(rows, vec![(1, "b-querier-0"), (2, "b-querier-1")]);
    }
}
