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

use config::{datafusion::request::Request, meta::cluster::NodeInfo};
use datafusion::{
    common::{
        Result, TableReference,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
    },
    config::ConfigOptions,
    physical_expr::{LexOrdering, PhysicalExpr, expressions::Column as PhysicalColumn},
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan, ExecutionPlanProperties, Partitioning,
        aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
        coalesce_partitions::CoalescePartitionsExec,
        repartition::RepartitionExec,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
};
use hashbrown::HashMap;
use proto::cluster_rpc::{self, KvItem};
#[cfg(feature = "enterprise")]
use {
    crate::datafusion::optimizer::physical_optimizer::broadcast_join::broadcast_join_rewrite,
    crate::datafusion::optimizer::physical_optimizer::enrichment::enrichment_broadcast_join_rewrite,
    crate::datafusion::optimizer::physical_optimizer::enrichment::should_use_enrichment_broadcast_join,
    o2_enterprise::enterprise::search::datafusion::optimizer::broadcast_join::should_use_broadcast_join,
};

use crate::{
    datafusion::{
        distributed_plan::{
            empty_exec::NewEmptyExec, node::RemoteScanNodes, remote_scan_exec::RemoteScanExec,
        },
        optimizer::{context::RemoteScanContext, utils::is_place_holder_or_empty},
    },
    sql::Sql,
};

pub fn generate_remote_scan_rules(
    req: &Request,
    sql: &Sql,
    context: RemoteScanContext,
) -> Arc<dyn PhysicalOptimizerRule + Send + Sync> {
    let RemoteScanContext {
        nodes,
        partitioned_file_lists,
        context,
        is_leader,
    } = context;

    let equal_keys = sql
        .equal_items
        .iter()
        .map(|(stream_name, fields)| {
            (
                stream_name.clone(),
                fields
                    .iter()
                    .map(|(k, v)| cluster_rpc::KvItem::new(k, v))
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<HashMap<_, _>>();

    // rewrite physical plan
    Arc::new(RemoteScanRule::new(
        req.clone(),
        nodes,
        partitioned_file_lists,
        equal_keys,
        is_leader,
        context,
        sql.sampling_config.clone(),
    ))
}

// add remote scan to physical plan
#[derive(Debug)]
pub struct RemoteScanRule {
    remote_scan_nodes: Arc<RemoteScanNodes>,
    single_node_optimizer_enable: bool,
}

impl RemoteScanRule {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        req: Request,
        nodes: Vec<Arc<dyn NodeInfo>>,
        file_id_lists: HashMap<TableReference, Vec<Vec<i64>>>,
        equal_keys: HashMap<TableReference, Vec<KvItem>>,
        is_leader: bool,
        opentelemetry_context: opentelemetry::Context,
        sampling_config: Option<proto::cluster_rpc::SamplingConfig>,
    ) -> Self {
        let remote_scan_nodes = RemoteScanNodes::new(
            req,
            nodes,
            file_id_lists,
            equal_keys,
            is_leader,
            opentelemetry_context,
            sampling_config,
        );
        let remote_scan_nodes = Arc::new(remote_scan_nodes);
        let cfg = config::get_config();
        Self {
            remote_scan_nodes,
            single_node_optimizer_enable: cfg.common.feature_single_node_optimize_enabled,
        }
    }

    #[cfg(test)]
    pub fn new_test(
        file_id_lists: HashMap<TableReference, Vec<Vec<i64>>>,
        single_node_optimizer_enable: bool,
    ) -> Self {
        use tracing_opentelemetry::OpenTelemetrySpanExt;
        let remote_scan_nodes = RemoteScanNodes::new(
            Request::default(),
            vec![],
            file_id_lists,
            HashMap::new(),
            false,
            tracing::Span::current().context(),
            None,
        );
        let remote_scan_nodes = Arc::new(remote_scan_nodes);
        Self {
            remote_scan_nodes,
            single_node_optimizer_enable,
        }
    }
}

impl PhysicalOptimizerRule for RemoteScanRule {
    /// Rewrite `plan` to an optimized form
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        // should not add remote scan for placeholder or emptyplan
        if is_place_holder_or_empty(&plan) {
            return Ok(plan);
        }

        #[cfg(feature = "enterprise")]
        if config::get_config()
            .common
            .feature_enrichment_broadcast_join_enabled
            && should_use_enrichment_broadcast_join(&plan)
        {
            return enrichment_broadcast_join_rewrite(plan, self.remote_scan_nodes.clone());
        }

        #[cfg(feature = "enterprise")]
        if config::get_config().common.feature_broadcast_join_enabled
            && should_use_broadcast_join(&plan)
        {
            return broadcast_join_rewrite(plan, self.remote_scan_nodes.clone());
        }

        // if single node and can optimize, add remote scan to top
        if self.single_node_optimizer_enable && is_single_node_optimize(&plan) {
            return remote_scan_to_top_if_needed(plan, self.remote_scan_nodes.clone());
        }

        // if not single node, rewrite physical plan to add remote scan
        let mut rewrite = RemoteScanRewriter::new(self.remote_scan_nodes.clone());
        let mut plan = plan.rewrite(&mut rewrite)?.data;
        if !rewrite.is_changed {
            plan = remote_scan_to_top_if_needed(plan, self.remote_scan_nodes.clone())?;
        }
        Ok(plan)
    }

    fn name(&self) -> &str {
        "RemoteScanRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

#[derive(Debug, Clone)]
pub struct RemoteScanRewriter {
    pub remote_scan_nodes: Arc<RemoteScanNodes>,
    pub is_changed: bool,
    pub partial_reduce_enabled: bool,
}

impl RemoteScanRewriter {
    pub fn new(remote_scan_nodes: Arc<RemoteScanNodes>) -> Self {
        let cfg = config::get_config();
        Self {
            remote_scan_nodes,
            is_changed: false,
            partial_reduce_enabled: cfg.common.feature_partial_reduce_enabled,
        }
    }
}

impl TreeNodeRewriter for RemoteScanRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if node.name() == "RepartitionExec" || node.name() == "CoalescePartitionsExec" {
            let mut visitor = TableNameVisitor::new();
            node.visit(&mut visitor)?;
            if !visitor.has_remote_scan {
                let table_name = visitor.table_name.clone().unwrap();
                let input = node.children()[0];
                let remote_scan_input =
                    wrap_partial_reduce(self.partial_reduce_enabled, input.clone())?;
                let remote_scan_or_partial_reduce: Arc<dyn ExecutionPlan> =
                    Arc::new(RemoteScanExec::new(
                        remote_scan_input,
                        self.remote_scan_nodes.get_remote_node(&table_name),
                    )?);
                let output_partitioning =
                    Partitioning::RoundRobinBatch(input.output_partitioning().partition_count());
                let repartition = Arc::new(RepartitionExec::try_new(
                    remote_scan_or_partial_reduce,
                    output_partitioning,
                )?);
                let new_node = node.with_new_children(vec![repartition])?;
                self.is_changed = true;
                return Ok(Transformed::yes(new_node));
            }
        } else if node.name() == "SortPreservingMergeExec" {
            let mut visitor = TableNameVisitor::new();
            node.visit(&mut visitor)?;
            if !visitor.has_remote_scan {
                let table_name = visitor.table_name.clone().unwrap();
                let follow_merge_node = node.clone();
                let new_input =
                    follow_merge_node.with_new_children(vec![node.children()[0].clone()])?;

                let remote_scan = Arc::new(RemoteScanExec::new(
                    new_input,
                    self.remote_scan_nodes.get_remote_node(&table_name),
                )?);
                let new_node = node.with_new_children(vec![remote_scan])?;
                self.is_changed = true;
                return Ok(Transformed::yes(new_node));
            }
        } else if node.name() == "UnionExec" {
            let mut visitor = TableNameVisitor::new();
            node.visit(&mut visitor)?;
            // add each remote scan for each child
            if !visitor.has_remote_scan {
                let mut new_children: Vec<Arc<dyn ExecutionPlan>> = vec![];
                for child in node.children() {
                    let mut visitor = TableNameVisitor::new();
                    child.visit(&mut visitor)?;
                    // For sort, we should add a SortPreservingMergeExec
                    if child.name() == "SortExec" {
                        let table_name = visitor.table_name.clone().unwrap();
                        let sort = child.downcast_ref::<SortExec>().unwrap();
                        let sort_merge = Arc::new(
                            SortPreservingMergeExec::new(
                                LexOrdering::new(sort.expr().to_vec()).unwrap(),
                                Arc::new(sort.clone()),
                            )
                            .with_fetch(sort.fetch()),
                        );
                        let remote_scan = Arc::new(RemoteScanExec::new(
                            sort_merge,
                            self.remote_scan_nodes.get_remote_node(&table_name),
                        )?);
                        new_children.push(remote_scan);
                    } else {
                        let table_name = visitor.table_name.clone().unwrap();
                        let remote_scan = Arc::new(RemoteScanExec::new(
                            child.clone(),
                            self.remote_scan_nodes.get_remote_node(&table_name),
                        )?);
                        new_children.push(remote_scan);
                    }
                }
                let new_node = node.with_new_children(new_children)?;
                self.is_changed = true;
                return Ok(Transformed::yes(new_node));
            }
        } else if node.name() == "HashJoinExec" {
            let mut new_children: Vec<Arc<dyn ExecutionPlan>> = vec![];
            for child in node.children() {
                let mut visitor = TableNameVisitor::new();
                child.visit(&mut visitor)?;
                if !visitor.has_remote_scan {
                    let table_name = visitor.table_name.clone().unwrap();
                    let remote_scan = Arc::new(RemoteScanExec::new(
                        child.clone(),
                        self.remote_scan_nodes.get_remote_node(&table_name),
                    )?);
                    // add repartition for better performance(imporve parallelism)
                    let output_partitioning = Partitioning::RoundRobinBatch(
                        child.output_partitioning().partition_count(),
                    );
                    let repartition =
                        Arc::new(RepartitionExec::try_new(remote_scan, output_partitioning)?);
                    new_children.push(repartition);
                } else {
                    new_children.push(child.clone());
                }
            }
            let new_node = node.with_new_children(new_children)?;
            self.is_changed = true;
            return Ok(Transformed::yes(new_node));
        }
        Ok(Transformed::no(node))
    }
}

// If partial reduce is enabled and the input is a partial aggregate, wrap it
// with a PartialReduce AggregateExec.
fn wrap_partial_reduce(
    partial_reduce_enabled: bool,
    input: Arc<dyn ExecutionPlan>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let Some(agg) = input.downcast_ref::<AggregateExec>() else {
        return Ok(input);
    };
    wrap_partial_reduce_for_aggregate(partial_reduce_enabled, agg, input.clone())
}

// If partial reduce is enabled and `agg` is a partial aggregate, wrap `input`
// with a PartialReduce AggregateExec. `input` can be either the original partial
// aggregate itself or another plan producing that aggregate's partial-output
// schema, such as a RemoteScanExec on a super-cluster region leader.
pub fn wrap_partial_reduce_for_aggregate(
    partial_reduce_enabled: bool,
    agg: &AggregateExec,
    input: Arc<dyn ExecutionPlan>,
) -> Result<Arc<dyn ExecutionPlan>> {
    if !partial_reduce_enabled {
        return Ok(input);
    }
    if !matches!(
        *agg.mode(),
        AggregateMode::Partial | AggregateMode::PartialReduce
    ) {
        return Ok(input);
    }

    // PartialReduce receives Partial's output, so group expressions must be
    // simple Column refs into that schema rather than the original scan-level exprs.
    let partial_schema = input.schema();
    let group_exprs: Vec<(Arc<dyn PhysicalExpr>, String)> = agg
        .group_expr()
        .expr()
        .iter()
        .map(|(_, name)| {
            let idx = partial_schema.index_of(name)?;
            Ok((
                Arc::new(PhysicalColumn::new(name, idx)) as Arc<dyn PhysicalExpr>,
                name.clone(),
            ))
        })
        .collect::<Result<_>>()?;
    // null_expr entries are schema-independent NULL literals used by GROUPING SETS
    let null_exprs: Vec<(Arc<dyn PhysicalExpr>, String)> = agg.group_expr().null_expr().to_vec();
    // Reuse the group-key Column refs as the hash-partition keys.
    let hash_exprs: Vec<Arc<dyn PhysicalExpr>> = group_exprs
        .iter()
        .map(|(expr, _)| Arc::clone(expr))
        .collect();
    let new_group_by = PhysicalGroupBy::new(
        group_exprs,
        null_exprs,
        agg.group_expr().groups().to_vec(),
        !agg.group_expr().is_single(),
    );
    let reduce_input: Arc<dyn ExecutionPlan> = if !hash_exprs.is_empty() {
        let num_partitions = input.output_partitioning().partition_count();
        Arc::new(RepartitionExec::try_new(
            input.clone(),
            Partitioning::Hash(hash_exprs, num_partitions),
        )?)
    } else {
        Arc::new(CoalescePartitionsExec::new(input.clone()))
    };
    Ok(Arc::new(AggregateExec::try_new(
        AggregateMode::PartialReduce,
        new_group_by,
        agg.aggr_expr().to_vec(),
        vec![None; agg.aggr_expr().len()],
        reduce_input,
        agg.input_schema(),
    )?) as Arc<dyn ExecutionPlan>)
}

fn is_single_node_optimize(plan: &Arc<dyn ExecutionPlan>) -> bool {
    let mut visitor = NewEmptyExecCountVisitor::default();
    plan.visit(&mut visitor)
        .expect("visit physical plan failed in is_single_node_optimize");
    let empty_exec_count = visitor.get_count();
    empty_exec_count <= 1 && config::cluster::LOCAL_NODE.is_single_node()
}

pub fn remote_scan_to_top_if_needed(
    plan: Arc<dyn ExecutionPlan>,
    remote_scan_nodes: Arc<RemoteScanNodes>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let mut visitor = TableNameVisitor::new();
    plan.visit(&mut visitor)?;
    if !visitor.has_remote_scan {
        let table_name = visitor.table_name.clone().unwrap();
        let remote_scan = Arc::new(RemoteScanExec::new(
            plan,
            remote_scan_nodes.get_remote_node(&table_name),
        )?);
        return Ok(remote_scan);
    }
    Ok(plan)
}

// visit physical plan to get underlying table name and check is add a remote scan after current
// physical plan
struct TableNameVisitor {
    table_name: Option<TableReference>,
    // if RemoteScanExec appear in the physical plan
    has_remote_scan: bool,
}

impl TableNameVisitor {
    pub fn new() -> Self {
        Self {
            table_name: None,
            has_remote_scan: false,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for TableNameVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        let name = node.name();
        if name == "RemoteScanExec" {
            self.has_remote_scan = true;
            Ok(TreeNodeRecursion::Stop)
        } else if name == "NewEmptyExec" {
            let table = node.downcast_ref::<NewEmptyExec>().unwrap();
            self.table_name = Some(TableReference::from(table.name()));
            Ok(TreeNodeRecursion::Continue)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

pub struct NewEmptyExecCountVisitor {
    count: usize,
}

impl NewEmptyExecCountVisitor {
    pub fn new() -> Self {
        Self { count: 0 }
    }

    pub fn get_count(&self) -> usize {
        self.count
    }
}

impl Default for NewEmptyExecCountVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl<'n> TreeNodeVisitor<'n> for NewEmptyExecCountVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if node.name() == "NewEmptyExec" {
            self.count += 1;
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::datatypes::{DataType, Field, Schema},
        physical_optimizer::PhysicalOptimizerRule,
        physical_plan::{empty::EmptyExec, expressions::col},
    };

    use super::*;

    #[test]
    fn test_remote_scan_rule_name() {
        let rule = RemoteScanRule::new_test(HashMap::new(), false);
        assert_eq!(rule.name(), "RemoteScanRule");
    }

    #[test]
    fn test_remote_scan_rule_schema_check() {
        let rule = RemoteScanRule::new_test(HashMap::new(), false);
        assert!(rule.schema_check());
    }

    #[test]
    fn test_table_name_visitor_new_initial_state() {
        let v = TableNameVisitor::new();
        assert!(v.table_name.is_none());
        assert!(!v.has_remote_scan);
    }

    #[test]
    fn test_new_empty_exec_count_visitor_new_starts_at_zero() {
        let v = NewEmptyExecCountVisitor::new();
        assert_eq!(v.get_count(), 0);
    }

    #[test]
    fn test_new_empty_exec_count_visitor_default_starts_at_zero() {
        let v = NewEmptyExecCountVisitor::default();
        assert_eq!(v.get_count(), 0);
    }

    #[test]
    fn test_wrap_partial_reduce_disabled_returns_input_unchanged() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, false)]));
        let input: Arc<dyn ExecutionPlan> = Arc::new(EmptyExec::new(Arc::clone(&schema)));
        let result = wrap_partial_reduce(false, input).unwrap();
        assert_eq!(result.name(), "EmptyExec");
    }

    #[test]
    fn test_wrap_partial_reduce_non_agg_input_returns_input_unchanged() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, false)]));
        let input: Arc<dyn ExecutionPlan> = Arc::new(EmptyExec::new(Arc::clone(&schema)));
        let result = wrap_partial_reduce(true, input).unwrap();
        assert_eq!(result.name(), "EmptyExec");
    }

    #[test]
    fn test_wrap_partial_reduce_single_mode_returns_input_unchanged()
    -> datafusion::common::Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, false)]));
        let group_by = PhysicalGroupBy::new(
            vec![(col("a", &schema)?, "a".to_string())],
            vec![],
            vec![vec![false]],
            false,
        );
        let agg = AggregateExec::try_new(
            AggregateMode::Single,
            group_by,
            vec![],
            vec![],
            Arc::new(EmptyExec::new(Arc::clone(&schema))),
            Arc::clone(&schema),
        )?;
        let input: Arc<dyn ExecutionPlan> = Arc::new(agg);
        let result = wrap_partial_reduce(true, input)?;
        let result_agg = result.downcast_ref::<AggregateExec>().unwrap();
        assert_eq!(*result_agg.mode(), AggregateMode::Single);
        Ok(())
    }

    #[test]
    fn test_wrap_partial_reduce_partial_no_group_by_produces_partial_reduce()
    -> datafusion::common::Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, false)]));
        let group_by = PhysicalGroupBy::new(vec![], vec![], vec![vec![]], false);
        let agg = AggregateExec::try_new(
            AggregateMode::Partial,
            group_by,
            vec![],
            vec![],
            Arc::new(EmptyExec::new(Arc::clone(&schema))),
            Arc::clone(&schema),
        )?;
        let input: Arc<dyn ExecutionPlan> = Arc::new(agg);
        let result = wrap_partial_reduce(true, input)?;
        let result_agg = result.downcast_ref::<AggregateExec>().unwrap();
        assert_eq!(*result_agg.mode(), AggregateMode::PartialReduce);
        assert!(result_agg.group_expr().expr().is_empty());
        Ok(())
    }

    #[test]
    fn test_wrap_partial_reduce_partial_with_group_by_produces_partial_reduce_with_column_refs()
    -> datafusion::common::Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, false)]));
        let group_by = PhysicalGroupBy::new(
            vec![(col("a", &schema)?, "a".to_string())],
            vec![],
            vec![vec![false]],
            false,
        );
        let agg = AggregateExec::try_new(
            AggregateMode::Partial,
            group_by,
            vec![],
            vec![],
            Arc::new(EmptyExec::new(Arc::clone(&schema))),
            Arc::clone(&schema),
        )?;
        let input: Arc<dyn ExecutionPlan> = Arc::new(agg);
        let result = wrap_partial_reduce(true, input)?;
        let result_agg = result.downcast_ref::<AggregateExec>().unwrap();
        assert_eq!(*result_agg.mode(), AggregateMode::PartialReduce);
        assert_eq!(result_agg.group_expr().expr().len(), 1);
        let (expr, name) = &result_agg.group_expr().expr()[0];
        assert_eq!(name, "a");
        let col_expr = expr
            .downcast_ref::<PhysicalColumn>()
            .expect("group expr should be a Column reference into partial output schema");
        assert_eq!(col_expr.name(), "a");
        assert_eq!(col_expr.index(), 0);
        Ok(())
    }

    #[test]
    fn test_wrap_partial_reduce_multi_partition_group_by_hash_repartitions()
    -> datafusion::common::Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, false)]));
        let group_by = PhysicalGroupBy::new(
            vec![(col("a", &schema)?, "a".to_string())],
            vec![],
            vec![vec![false]],
            false,
        );
        // Partial agg over a 4-partition input -> 4 output partitions.
        let agg = AggregateExec::try_new(
            AggregateMode::Partial,
            group_by,
            vec![],
            vec![],
            Arc::new(EmptyExec::new(Arc::clone(&schema)).with_partitions(4)),
            Arc::clone(&schema),
        )?;
        let input: Arc<dyn ExecutionPlan> = Arc::new(agg);
        let result = wrap_partial_reduce(true, input)?;
        let result_agg = result.downcast_ref::<AggregateExec>().unwrap();
        assert_eq!(*result_agg.mode(), AggregateMode::PartialReduce);
        // PartialReduce preserves the partial agg's partition count (partition-local reduce).
        assert_eq!(result.output_partitioning().partition_count(), 4);
        // Its child must be a Hash RepartitionExec on the group key into 4 partitions,
        // so each group key lands in exactly one bucket (no duplication across buckets).
        let child = result.children()[0].clone();
        let repartition = child
            .downcast_ref::<RepartitionExec>()
            .expect("a multi-partition GROUP BY should hash-partition the partial output");
        match repartition.partitioning() {
            Partitioning::Hash(exprs, n) => {
                assert_eq!(*n, 4);
                assert_eq!(exprs.len(), 1, "should hash on the single group key");
            }
            other => panic!("expected Hash partitioning, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn test_wrap_partial_reduce_multi_partition_no_group_by_falls_back_to_coalesce()
    -> datafusion::common::Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, false)]));
        let group_by = PhysicalGroupBy::new(vec![], vec![], vec![vec![]], false);
        // Partial agg over a 4-partition input but with no GROUP BY.
        let agg = AggregateExec::try_new(
            AggregateMode::Partial,
            group_by,
            vec![],
            vec![],
            Arc::new(EmptyExec::new(Arc::clone(&schema)).with_partitions(4)),
            Arc::clone(&schema),
        )?;
        let input: Arc<dyn ExecutionPlan> = Arc::new(agg);
        // No GROUP BY: can't hash-partition even with multiple input partitions -> coalesce to one.
        let result = wrap_partial_reduce(true, input)?;
        assert_eq!(result.children()[0].name(), "CoalescePartitionsExec");
        assert_eq!(result.output_partitioning().partition_count(), 1);
        Ok(())
    }

    #[test]
    fn test_wrap_partial_reduce_for_partial_reduce_source_accepts_remote_output()
    -> datafusion::common::Result<()> {
        let scan_schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, false)]));
        let group_by = PhysicalGroupBy::new(
            vec![(col("a", &scan_schema)?, "a".to_string())],
            vec![],
            vec![vec![false]],
            false,
        );
        let partial = AggregateExec::try_new(
            AggregateMode::Partial,
            group_by,
            vec![],
            vec![],
            Arc::new(EmptyExec::new(Arc::clone(&scan_schema)).with_partitions(4)),
            Arc::clone(&scan_schema),
        )?;
        let partial_plan: Arc<dyn ExecutionPlan> = Arc::new(partial);
        let source_plan = wrap_partial_reduce(true, partial_plan)?;
        let source_agg = source_plan
            .downcast_ref::<AggregateExec>()
            .expect("source plan should be a PartialReduce aggregate");
        assert_eq!(*source_agg.mode(), AggregateMode::PartialReduce);

        // Simulate a super-cluster region leader: the local RemoteScanExec is not
        // itself an AggregateExec, but it emits the source aggregate's partial schema.
        let remote_output: Arc<dyn ExecutionPlan> =
            Arc::new(EmptyExec::new(source_plan.schema().clone()).with_partitions(4));
        let result = wrap_partial_reduce_for_aggregate(true, source_agg, remote_output)?;
        let result_agg = result.downcast_ref::<AggregateExec>().unwrap();
        assert_eq!(*result_agg.mode(), AggregateMode::PartialReduce);
        assert_eq!(result_agg.group_expr().expr().len(), 1);

        let child = result.children()[0].clone();
        let repartition = child
            .downcast_ref::<RepartitionExec>()
            .expect("region-level grouped reduce should hash-partition remote output");
        assert!(matches!(
            repartition.partitioning(),
            Partitioning::Hash(_, 4)
        ));
        Ok(())
    }

    // Regression test: PartialReduce must carry the SCAN schema as input_schema, not the
    // partial-aggregate output schema.  DataFusion uses input_schema during plan
    // serialisation/deserialisation to reconstruct aggregate-expression argument types.
    // If we used the partial output schema instead, a `max(_timestamp:Int64)` expression
    // (column index 0 in the scan) would be resolved against index 0 of the partial output
    // (which is the group-by key `client_ip:Utf8`), causing MinMaxBytesAccumulator(Utf8) to
    // be created and then panic when fed Int64 state data.
    #[test]
    fn test_wrap_partial_reduce_input_schema_is_scan_schema() -> datafusion::common::Result<()> {
        // Scan schema: [_timestamp:Int64 @ 0, client_ip:Utf8 @ 1]
        // Group by client_ip (index 1), so partial output is [client_ip:Utf8, ...].
        // After wrapping, result_agg.input_schema() must still be the SCAN schema.
        let scan_schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("client_ip", DataType::Utf8, false),
        ]));
        let group_by = PhysicalGroupBy::new(
            vec![(col("client_ip", &scan_schema)?, "client_ip".to_string())],
            vec![],
            vec![vec![false]],
            false,
        );
        let agg = AggregateExec::try_new(
            AggregateMode::Partial,
            group_by,
            vec![],
            vec![],
            Arc::new(EmptyExec::new(Arc::clone(&scan_schema))),
            Arc::clone(&scan_schema),
        )?;
        let input: Arc<dyn ExecutionPlan> = Arc::new(agg);
        let result = wrap_partial_reduce(true, input)?;
        let result_agg = result.downcast_ref::<AggregateExec>().unwrap();
        assert_eq!(*result_agg.mode(), AggregateMode::PartialReduce);
        // The critical invariant: input_schema must be the original scan schema so that
        // aggregate expression argument types (e.g. _timestamp:Int64) are reconstructed
        // correctly during plan serde on querier nodes.
        assert_eq!(
            result_agg.input_schema().as_ref(),
            scan_schema.as_ref(),
            "PartialReduce input_schema must be the scan schema, not the partial output schema"
        );
        Ok(())
    }

    // Regression test: null_exprs (GROUPING SETS placeholders) must be carried over
    // unchanged.  The original code remapped them to Column refs, which would replace
    // the NULL sentinel with the actual column value during ROLLUP/CUBE aggregation.
    #[test]
    fn test_wrap_partial_reduce_null_exprs_preserved_for_grouping_sets()
    -> datafusion::common::Result<()> {
        use datafusion::{
            arrow::datatypes::DataType, common::ScalarValue, physical_expr::expressions::Literal,
        };

        let schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Int64, false),
            Field::new("b", DataType::Utf8, false),
        ]));
        // Simulate ROLLUP(a, b): null_expr entries are NULL literals (schema-independent).
        let null_a: Arc<dyn PhysicalExpr> = Arc::new(Literal::new(ScalarValue::Int64(None)));
        let null_b: Arc<dyn PhysicalExpr> = Arc::new(Literal::new(ScalarValue::Utf8(None)));
        let group_by = PhysicalGroupBy::new(
            vec![
                (col("a", &schema)?, "a".to_string()),
                (col("b", &schema)?, "b".to_string()),
            ],
            vec![
                (Arc::clone(&null_a), "a".to_string()),
                (Arc::clone(&null_b), "b".to_string()),
            ],
            vec![
                vec![false, false], // (a, b)
                vec![false, true],  // (a)
                vec![true, false],  // (b)
            ],
            true,
        );
        let agg = AggregateExec::try_new(
            AggregateMode::Partial,
            group_by,
            vec![],
            vec![],
            Arc::new(EmptyExec::new(Arc::clone(&schema))),
            Arc::clone(&schema),
        )?;
        let input: Arc<dyn ExecutionPlan> = Arc::new(agg);
        let result = wrap_partial_reduce(true, input)?;
        let result_agg = result.downcast_ref::<AggregateExec>().unwrap();
        assert_eq!(*result_agg.mode(), AggregateMode::PartialReduce);

        let null_exprs = result_agg.group_expr().null_expr();
        assert_eq!(null_exprs.len(), 2);
        // Both must still be Literal(NULL), NOT remapped to Column refs.
        for (expr, _) in null_exprs {
            assert!(
                expr.is::<Literal>(),
                "null_expr must remain a Literal, not be replaced with a Column ref"
            );
        }
        Ok(())
    }
}
