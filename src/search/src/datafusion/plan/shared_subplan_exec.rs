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

use std::{collections::HashSet, fmt, sync::Arc};

use arrow::array::{ArrayData, RecordBatch};
use arrow_schema::SchemaRef;
use datafusion::{
    common::{Result, plan_err, runtime::SpawnedTask},
    error::{DataFusionError, SharedResult},
    execution::{
        SendableRecordBatchStream, TaskContext,
        disk_manager::RefCountedTempFile,
        memory_pool::{MemoryConsumer, MemoryLimit, MemoryPool, MemoryReservation},
    },
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, ExecutionPlanProperties, PlanProperties,
        SpillManager, Statistics,
        execution_plan::{Boundedness, CardinalityEffect, EmissionType},
        metrics::{Count, ExecutionPlanMetricsSet, MetricBuilder, MetricsSet, SpillMetrics},
        stream::RecordBatchStreamAdapter,
    },
};
use futures::{
    FutureExt, StreamExt, TryStreamExt,
    future::{BoxFuture, Shared},
};
use parking_lot::{Mutex, RwLock};

type MaterializeFut = Shared<BoxFuture<'static, SharedResult<Arc<MaterializedSubplan>>>>;

/// Pass-through node that carries the sharing id until the physical rewrite runs.
#[derive(Debug)]
pub struct SharedSubplanMarkerExec {
    id: u64,
    input: Arc<dyn ExecutionPlan>,
    properties: Arc<PlanProperties>,
}

/// Executes the shared subplan once and serves the first consumer.
#[derive(Debug)]
pub struct SharedSubplanExec {
    state: Arc<SharedSubplanState>,
    input: Arc<dyn ExecutionPlan>,
    properties: Arc<PlanProperties>,
    metrics: ExecutionPlanMetricsSet,
}

/// Replays the shared result for one more consumer; it has no child so the plan stays a tree.
#[derive(Debug)]
pub struct SharedSubplanReaderExec {
    state: Arc<SharedSubplanState>,
    schema: SchemaRef,
    properties: Arc<PlanProperties>,
}

pub struct SharedSubplanState {
    id: u64,
    consumers: usize,
    memory_limit: Option<usize>,
    input: RwLock<Arc<dyn ExecutionPlan>>,
    materialized: Mutex<Option<MaterializeFut>>,
    metrics: ExecutionPlanMetricsSet,
    materializations: Count,
}

struct MaterializedSubplan {
    partitions: Vec<PartitionData>,
    spill_manager: Arc<SpillManager>,
    // Released together with the in-memory batches.
    _budget: Arc<Mutex<MaterializeBudget>>,
}

enum PartitionData {
    Memory(Vec<RecordBatch>),
    Spilled(RefCountedTempFile),
}

// Shared by all partition collectors; a partition that stops fitting moves to disk.
struct MaterializeBudget {
    reservation: MemoryReservation,
    limit: Option<usize>,
}

impl SharedSubplanMarkerExec {
    pub fn new(id: u64, input: Arc<dyn ExecutionPlan>) -> Self {
        let properties = Arc::clone(input.properties());
        Self {
            id,
            input,
            properties,
        }
    }

    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn input(&self) -> &Arc<dyn ExecutionPlan> {
        &self.input
    }
}

impl DisplayAs for SharedSubplanMarkerExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "SharedSubplanMarkerExec: id={}", self.id)
    }
}

impl ExecutionPlan for SharedSubplanMarkerExec {
    fn name(&self) -> &'static str {
        "SharedSubplanMarkerExec"
    }

    fn properties(&self) -> &Arc<PlanProperties> {
        &self.properties
    }

    // Sorts must not be pushed below the marker, otherwise the copies of a subplan diverge.
    fn maintains_input_order(&self) -> Vec<bool> {
        vec![false]
    }

    fn benefits_from_input_partitioning(&self) -> Vec<bool> {
        vec![false]
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.input]
    }

    fn with_new_children(
        self: Arc<Self>,
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let Some(input) = single_child(children) else {
            return plan_err!("SharedSubplanMarkerExec requires exactly one child");
        };
        Ok(Arc::new(Self::new(self.id, input)))
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        self.input.execute(partition, context)
    }

    fn partition_statistics(&self, partition: Option<usize>) -> Result<Arc<Statistics>> {
        self.input.partition_statistics(partition)
    }

    fn cardinality_effect(&self) -> CardinalityEffect {
        CardinalityEffect::Equal
    }
}

impl SharedSubplanExec {
    pub fn new(
        id: u64,
        consumers: usize,
        memory_limit: Option<usize>,
        input: Arc<dyn ExecutionPlan>,
    ) -> Self {
        let metrics = ExecutionPlanMetricsSet::new();
        let materializations = MetricBuilder::new(&metrics).global_counter("materializations");
        let state = Arc::new(SharedSubplanState {
            id,
            consumers,
            memory_limit,
            input: RwLock::new(Arc::clone(&input)),
            materialized: Mutex::new(None),
            metrics: metrics.clone(),
            materializations,
        });
        Self::with_state(state, input, metrics)
    }

    pub fn id(&self) -> u64 {
        self.state.id
    }

    pub fn consumers(&self) -> usize {
        self.state.consumers
    }

    pub fn reader(&self) -> SharedSubplanReaderExec {
        SharedSubplanReaderExec {
            state: Arc::clone(&self.state),
            schema: self.input.schema(),
            properties: Arc::clone(&self.properties),
        }
    }

    fn with_state(
        state: Arc<SharedSubplanState>,
        input: Arc<dyn ExecutionPlan>,
        metrics: ExecutionPlanMetricsSet,
    ) -> Self {
        let properties = replay_properties(&input);
        Self {
            state,
            input,
            properties,
            metrics,
        }
    }
}

impl DisplayAs for SharedSubplanExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut fmt::Formatter) -> fmt::Result {
        write!(
            f,
            "SharedSubplanExec: id={}, consumers={}, partitions={}",
            self.state.id,
            self.state.consumers,
            self.input.output_partitioning().partition_count()
        )
    }
}

impl ExecutionPlan for SharedSubplanExec {
    fn name(&self) -> &'static str {
        "SharedSubplanExec"
    }

    fn properties(&self) -> &Arc<PlanProperties> {
        &self.properties
    }

    fn maintains_input_order(&self) -> Vec<bool> {
        vec![false]
    }

    fn benefits_from_input_partitioning(&self) -> Vec<bool> {
        vec![false]
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.input]
    }

    // The readers keep pointing at the same state, so the replaced input must be stored there.
    fn with_new_children(
        self: Arc<Self>,
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let Some(input) = single_child(children) else {
            return plan_err!("SharedSubplanExec requires exactly one child");
        };
        *self.state.input.write() = Arc::clone(&input);
        Ok(Arc::new(Self::with_state(
            Arc::clone(&self.state),
            input,
            self.metrics.clone(),
        )))
    }

    fn reset_state(self: Arc<Self>) -> Result<Arc<dyn ExecutionPlan>> {
        self.state.reset();
        Ok(self)
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        self.state.replay(partition, context, self.input.schema())
    }

    fn metrics(&self) -> Option<MetricsSet> {
        Some(self.metrics.clone_inner())
    }

    fn partition_statistics(&self, partition: Option<usize>) -> Result<Arc<Statistics>> {
        self.input.partition_statistics(partition)
    }

    fn cardinality_effect(&self) -> CardinalityEffect {
        CardinalityEffect::Equal
    }
}

impl DisplayAs for SharedSubplanReaderExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "SharedSubplanReaderExec: id={}", self.state.id)
    }
}

impl ExecutionPlan for SharedSubplanReaderExec {
    fn name(&self) -> &'static str {
        "SharedSubplanReaderExec"
    }

    fn properties(&self) -> &Arc<PlanProperties> {
        &self.properties
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![]
    }

    fn with_new_children(
        self: Arc<Self>,
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if !children.is_empty() {
            return plan_err!("SharedSubplanReaderExec cannot have children");
        }
        Ok(self)
    }

    fn reset_state(self: Arc<Self>) -> Result<Arc<dyn ExecutionPlan>> {
        self.state.reset();
        Ok(self)
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        self.state
            .replay(partition, context, Arc::clone(&self.schema))
    }

    fn partition_statistics(&self, partition: Option<usize>) -> Result<Arc<Statistics>> {
        self.state.input.read().partition_statistics(partition)
    }

    fn cardinality_effect(&self) -> CardinalityEffect {
        CardinalityEffect::Equal
    }
}

impl fmt::Debug for SharedSubplanState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "SharedSubplanState(id={}, consumers={})",
            self.id, self.consumers
        )
    }
}

impl SharedSubplanState {
    fn materialize(&self, context: Arc<TaskContext>) -> MaterializeFut {
        let mut guard = self.materialized.lock();
        if let Some(fut) = guard.as_ref() {
            return fut.clone();
        }
        self.materializations.add(1);
        let id = self.id;
        let memory_limit = self.memory_limit;
        let input = Arc::clone(&self.input.read());
        let metrics = self.metrics.clone();
        let fut = async move {
            materialize(id, memory_limit, input, context, metrics)
                .await
                .map_err(Arc::new)
        }
        .boxed()
        .shared();
        *guard = Some(fut.clone());
        fut
    }

    fn reset(&self) {
        *self.materialized.lock() = None;
    }

    fn replay(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
        schema: SchemaRef,
    ) -> Result<SendableRecordBatchStream> {
        let fut = self.materialize(context);
        let stream = futures::stream::once(async move {
            let data = fut.await.map_err(DataFusionError::Shared)?;
            data.stream(partition)
        })
        .try_flatten();
        Ok(Box::pin(RecordBatchStreamAdapter::new(schema, stream)))
    }
}

impl MaterializedSubplan {
    fn stream(&self, partition: usize) -> Result<SendableRecordBatchStream> {
        let schema = Arc::clone(self.spill_manager.schema());
        match self.partitions.get(partition) {
            Some(PartitionData::Spilled(file)) => {
                self.spill_manager.read_spill_as_stream(file.clone(), None)
            }
            Some(PartitionData::Memory(batches)) => Ok(Box::pin(RecordBatchStreamAdapter::new(
                schema,
                futures::stream::iter(batches.clone().into_iter().map(Ok)),
            ))),
            None => Ok(Box::pin(RecordBatchStreamAdapter::new(
                schema,
                futures::stream::empty(),
            ))),
        }
    }
}

impl MaterializeBudget {
    // Half of the pool stays available to the joins and aggregates that consume the result.
    fn new(id: u64, pool: &Arc<dyn MemoryPool>, memory_limit: Option<usize>) -> Self {
        let limit = memory_limit.or(match pool.memory_limit() {
            MemoryLimit::Finite(limit) => Some(limit / 2),
            MemoryLimit::Infinite | MemoryLimit::Unknown => None,
        });
        Self {
            reservation: MemoryConsumer::new(format!("SharedSubplanExec[{id}]"))
                .with_can_spill(true)
                .register(pool),
            limit,
        }
    }

    fn try_add(&mut self, bytes: usize) -> bool {
        if self
            .limit
            .is_some_and(|limit| self.reservation.size() + bytes > limit)
        {
            return false;
        }
        self.reservation.try_grow(bytes).is_ok()
    }

    fn release(&mut self, bytes: usize) {
        self.reservation.shrink(bytes);
    }
}

// The result is served after the full materialization, so the emission type is final.
fn replay_properties(input: &Arc<dyn ExecutionPlan>) -> Arc<PlanProperties> {
    Arc::new(PlanProperties::new(
        input.equivalence_properties().clone(),
        input.output_partitioning().clone(),
        EmissionType::Final,
        Boundedness::Bounded,
    ))
}

fn single_child(mut children: Vec<Arc<dyn ExecutionPlan>>) -> Option<Arc<dyn ExecutionPlan>> {
    if children.len() != 1 {
        return None;
    }
    children.pop()
}

// Aggregate output arrives as slices of the same buffers, so each allocation counts once.
fn retained_size(batch: &RecordBatch, seen: &mut HashSet<usize>) -> usize {
    batch
        .columns()
        .iter()
        .map(|column| array_retained_size(&column.to_data(), seen))
        .sum()
}

fn array_retained_size(data: &ArrayData, seen: &mut HashSet<usize>) -> usize {
    let mut size = 0;
    for buffer in data.buffers() {
        if seen.insert(buffer.data_ptr().as_ptr() as usize) {
            size += buffer.capacity();
        }
    }
    if let Some(nulls) = data.nulls() {
        let buffer = nulls.buffer();
        if seen.insert(buffer.data_ptr().as_ptr() as usize) {
            size += buffer.capacity();
        }
    }
    for child in data.child_data() {
        size += array_retained_size(child, seen);
    }
    size
}

async fn materialize(
    id: u64,
    memory_limit: Option<usize>,
    input: Arc<dyn ExecutionPlan>,
    context: Arc<TaskContext>,
    metrics: ExecutionPlanMetricsSet,
) -> Result<Arc<MaterializedSubplan>> {
    let partition_count = input.output_partitioning().partition_count();
    let budget = Arc::new(Mutex::new(MaterializeBudget::new(
        id,
        context.memory_pool(),
        memory_limit,
    )));
    let spill_manager = Arc::new(SpillManager::new(
        context.runtime_env(),
        SpillMetrics::new(&metrics, 0),
        input.schema(),
    ));
    let mut tasks = Vec::with_capacity(partition_count);
    for partition in 0..partition_count {
        let stream = input.execute(partition, Arc::clone(&context))?;
        tasks.push(SpawnedTask::spawn(collect_partition(
            id,
            partition,
            stream,
            Arc::clone(&budget),
            Arc::clone(&spill_manager),
        )));
    }
    let start = std::time::Instant::now();
    let mut partitions = Vec::with_capacity(partition_count);
    for task in tasks {
        let data = task
            .join()
            .await
            .map_err(|e| DataFusionError::ExecutionJoin(Box::new(e)))??;
        partitions.push(data);
    }
    let (rows, spilled) = partitions
        .iter()
        .fold((0, 0), |(rows, spilled), data| match data {
            PartitionData::Memory(batches) => (
                rows + batches.iter().map(|b| b.num_rows()).sum::<usize>(),
                spilled,
            ),
            PartitionData::Spilled(_) => (rows, spilled + 1),
        });
    log::info!(
        "[SharedSubplanExec {id}] materialized {rows} rows in memory ({} bytes), {spilled}/{partition_count} partitions spilled, took {} ms",
        budget.lock().reservation.size(),
        start.elapsed().as_millis()
    );
    Ok(Arc::new(MaterializedSubplan {
        partitions,
        spill_manager,
        _budget: budget,
    }))
}

async fn collect_partition(
    id: u64,
    partition: usize,
    mut stream: SendableRecordBatchStream,
    budget: Arc<Mutex<MaterializeBudget>>,
    spill_manager: Arc<SpillManager>,
) -> Result<PartitionData> {
    let mut batches = Vec::new();
    let mut seen = HashSet::new();
    let mut reserved = 0;
    let mut spill = None;
    while let Some(batch) = stream.next().await {
        let batch = batch?;
        if spill.is_none() {
            let bytes = retained_size(&batch, &mut seen);
            if budget.lock().try_add(bytes) {
                reserved += bytes;
                batches.push(batch);
                continue;
            }
            // Over budget: the whole partition moves to disk and stays there.
            let mut file = spill_manager.create_in_progress_file(&format!(
                "SharedSubplanExec[{id}] partition {partition}"
            ))?;
            for spilled in batches.drain(..) {
                file.append_batch(&spilled)?;
            }
            budget.lock().release(reserved);
            spill = Some(file);
        }
        if let Some(file) = spill.as_mut() {
            file.append_batch(&batch)?;
        }
    }
    match spill {
        Some(mut file) => Ok(file
            .finish()?
            .map_or_else(|| PartitionData::Memory(Vec::new()), PartitionData::Spilled)),
        None => Ok(PartitionData::Memory(batches)),
    }
}

#[cfg(test)]
mod tests {
    use arrow::{
        array::{Int64Array, StringArray},
        util::pretty::pretty_format_batches,
    };
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        common::tree_node::{TreeNode, TreeNodeRecursion},
        datasource::MemTable,
        execution::{SessionStateBuilder, runtime_env::RuntimeEnvBuilder},
        physical_plan::{collect, displayable},
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;
    use crate::datafusion::{
        optimizer::{
            analyze::shared_subplan::MarkSharedSubplanRule,
            logical_optimizer::shared_subplan::StripDivergedSharedSubplanRule,
            physical_optimizer::shared_subplan::SharedSubplanRule,
        },
        planner::extension_planner::OpenobserveQueryPlanner,
    };

    fn table() -> Arc<MemTable> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("v", DataType::Int64, false),
        ]));
        let batch = |names: Vec<&str>, values: Vec<i64>| {
            RecordBatch::try_new(
                Arc::clone(&schema),
                vec![
                    Arc::new(StringArray::from(names)),
                    Arc::new(Int64Array::from(values)),
                ],
            )
            .unwrap()
        };
        let partitions = vec![
            vec![batch(vec!["a", "b", "a"], vec![1, 2, 3])],
            vec![batch(vec!["c", "b", "a", "d"], vec![4, 5, 6, 1])],
        ];
        Arc::new(MemTable::try_new(schema, partitions).unwrap())
    }

    fn sharing_context(memory_limit: Option<usize>) -> SessionContext {
        let runtime = RuntimeEnvBuilder::new()
            .with_memory_limit(1 << 30, 1.0)
            .build()
            .unwrap();
        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(2))
            .with_runtime_env(Arc::new(runtime))
            .with_default_features()
            .with_analyzer_rule(Arc::new(MarkSharedSubplanRule::new()))
            .with_optimizer_rule(Arc::new(StripDivergedSharedSubplanRule::new()))
            .with_physical_optimizer_rule(Arc::new(SharedSubplanRule::with_memory_limit(
                memory_limit,
            )))
            .with_query_planner(Arc::new(OpenobserveQueryPlanner::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        ctx.register_table("t", table()).unwrap();
        ctx
    }

    async fn plain_results(sql: &str) -> String {
        let ctx = SessionContext::new();
        ctx.register_table("t", table()).unwrap();
        let batches = ctx.sql(sql).await.unwrap().collect().await.unwrap();
        pretty_format_batches(&batches).unwrap().to_string()
    }

    async fn shared_results(sql: &str) -> (String, String, usize) {
        let (results, plan, materializations, _) = shared_results_with(sql, None).await;
        (results, plan, materializations)
    }

    async fn shared_results_with(
        sql: &str,
        memory_limit: Option<usize>,
    ) -> (String, String, usize, usize) {
        let ctx = sharing_context(memory_limit);
        let plan = ctx
            .sql(sql)
            .await
            .unwrap()
            .create_physical_plan()
            .await
            .unwrap();
        let text = displayable(plan.as_ref()).indent(true).to_string();
        let batches = collect(Arc::clone(&plan), ctx.task_ctx()).await.unwrap();
        let (mut materializations, mut spills) = (0, 0);
        plan.apply(|node| {
            if let Some(shared) = node.downcast_ref::<SharedSubplanExec>() {
                let metric = |name: &str| {
                    shared
                        .metrics()
                        .and_then(|m| m.sum_by_name(name))
                        .map(|m| m.as_usize())
                        .unwrap_or_default()
                };
                materializations += metric("materializations");
                spills += shared
                    .metrics()
                    .and_then(|m| m.spill_count())
                    .unwrap_or_default();
            }
            Ok(TreeNodeRecursion::Continue)
        })
        .unwrap();
        (
            pretty_format_batches(&batches).unwrap().to_string(),
            text,
            materializations,
            spills,
        )
    }

    #[tokio::test]
    async fn over_budget_materialization_spills_to_disk() {
        let sql = "WITH c AS (SELECT name, count(*) AS cnt, sum(v) AS sv FROM t GROUP BY name) \
                   SELECT c1.name, c1.cnt, c2.sv, c3.cnt FROM c c1 JOIN c c2 ON c1.name = c2.name \
                   JOIN c c3 ON c1.name = c3.name WHERE c2.cnt > 1 ORDER BY c1.name";
        let (results, plan, materializations, spills) = shared_results_with(sql, Some(1)).await;
        assert_eq!(plan.matches("SharedSubplanExec").count(), 1, "{plan}");
        assert_eq!(materializations, 1);
        assert!(spills > 0);
        assert_eq!(results, plain_results(sql).await);
    }

    #[tokio::test]
    async fn cte_under_self_join_is_materialized_once() {
        let sql = "WITH c AS (SELECT name, count(*) AS cnt, sum(v) AS sv FROM t GROUP BY name) \
                   SELECT c1.name, c1.cnt, c2.sv, c3.cnt FROM c c1 JOIN c c2 ON c1.name = c2.name \
                   JOIN c c3 ON c1.name = c3.name WHERE c2.cnt > 1 ORDER BY c1.name";
        let (results, plan, materializations) = shared_results(sql).await;
        assert_eq!(plan.matches("SharedSubplanExec").count(), 1, "{plan}");
        assert_eq!(plan.matches("SharedSubplanReaderExec").count(), 2, "{plan}");
        assert_eq!(
            plan.matches("AggregateExec: mode=FinalPartitioned").count(),
            1,
            "{plan}"
        );
        assert_eq!(materializations, 1);
        assert_eq!(results, plain_results(sql).await);
    }

    #[tokio::test]
    async fn cte_under_union_is_materialized_once() {
        let sql = "SELECT * FROM (WITH c AS (SELECT name, count(*) AS cnt FROM t GROUP BY name) \
                   SELECT name, cnt FROM c WHERE cnt > 1 UNION ALL SELECT name, cnt FROM c WHERE cnt <= 1) \
                   ORDER BY name";
        let (results, plan, materializations) = shared_results(sql).await;
        assert_eq!(plan.matches("SharedSubplanExec").count(), 1, "{plan}");
        assert_eq!(plan.matches("SharedSubplanReaderExec").count(), 1, "{plan}");
        assert_eq!(materializations, 1);
        assert_eq!(results, plain_results(sql).await);
    }

    #[tokio::test]
    async fn pushed_filter_on_one_copy_falls_back_to_inlining() {
        let sql = "WITH c AS (SELECT name, v, count(*) AS cnt FROM t GROUP BY name, v) \
                   SELECT c1.name, c1.v, c2.cnt FROM c c1 JOIN c c2 ON c1.name = c2.name \
                   WHERE c1.v = 1 ORDER BY c1.name, c2.cnt";
        let (results, plan, materializations) = shared_results(sql).await;
        assert!(!plan.contains("SharedSubplan"), "{plan}");
        assert_eq!(
            plan.matches("AggregateExec: mode=FinalPartitioned").count(),
            2,
            "{plan}"
        );
        assert_eq!(materializations, 0);
        assert_eq!(results, plain_results(sql).await);
    }

    #[tokio::test]
    async fn cte_in_correlated_scalar_subquery_is_shared() {
        let sql = "WITH ctr AS (SELECT name, v, count(*) AS cnt FROM t GROUP BY name, v) \
                   SELECT ctr1.name, ctr1.v, ctr1.cnt FROM ctr ctr1 \
                   WHERE ctr1.cnt > (SELECT avg(ctr2.cnt) * 0.5 FROM ctr ctr2 WHERE ctr1.name = ctr2.name) \
                   ORDER BY ctr1.name, ctr1.v";
        let (results, plan, materializations) = shared_results(sql).await;
        assert_eq!(plan.matches("SharedSubplanExec").count(), 1, "{plan}");
        assert_eq!(plan.matches("SharedSubplanReaderExec").count(), 1, "{plan}");
        assert_eq!(materializations, 1);
        assert_eq!(results, plain_results(sql).await);
    }

    #[tokio::test]
    async fn cte_in_uncorrelated_scalar_subquery_is_shared() {
        let sql = "WITH revenue AS (SELECT name, sum(v) AS total FROM t GROUP BY name) \
                   SELECT name, total FROM revenue WHERE total = (SELECT max(total) FROM revenue) \
                   ORDER BY name";
        let (results, plan, materializations) = shared_results(sql).await;
        assert_eq!(plan.matches("SharedSubplanExec").count(), 1, "{plan}");
        assert_eq!(plan.matches("SharedSubplanReaderExec").count(), 1, "{plan}");
        assert_eq!(materializations, 1);
        assert_eq!(results, plain_results(sql).await);
    }

    #[tokio::test]
    async fn plain_cte_is_not_shared() {
        let sql = "WITH c AS (SELECT name, v FROM t WHERE v > 1) \
                   SELECT c1.name, c2.v FROM c c1 JOIN c c2 ON c1.name = c2.name ORDER BY c1.name, c2.v";
        let (results, plan, _) = shared_results(sql).await;
        assert!(!plan.contains("SharedSubplan"), "{plan}");
        assert_eq!(results, plain_results(sql).await);
    }

    #[tokio::test]
    async fn pruned_cte_columns_still_execute() {
        for sql in [
            "WITH c AS (SELECT count(*) AS cnt, sum(v) AS sv FROM t) \
             SELECT c1.sv, c2.sv FROM c c1 CROSS JOIN c c2",
            "WITH c AS (SELECT name, count(*) AS cnt, sum(v) AS sv FROM t GROUP BY name) \
             SELECT c1.name, c2.sv FROM c c1 JOIN c c2 ON c1.name = c2.name ORDER BY c1.name",
        ] {
            let (results, plan, materializations) = shared_results(sql).await;
            assert_eq!(plan.matches("SharedSubplanExec").count(), 1, "{plan}");
            assert!(!plan.contains("cnt"), "{plan}");
            assert_eq!(materializations, 1, "{plan}");
            assert_eq!(results, plain_results(sql).await, "{plan}");
        }
    }
}
