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

use std::sync::Arc;

use config::{datafusion::request::Request, meta::cluster::NodeInfo};
use datafusion::{
    common::{
        Result, TableReference,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
    },
    config::ConfigOptions,
    physical_expr::LexOrdering,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan, ExecutionPlanProperties, Partitioning,
        repartition::RepartitionExec,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
};
use hashbrown::HashMap;
use proto::cluster_rpc::{self, KvItem};
#[cfg(feature = "enterprise")]
use {
    crate::service::search::datafusion::optimizer::physical_optimizer::broadcast_join::broadcast_join_rewrite,
    crate::service::search::datafusion::optimizer::physical_optimizer::enrichment::enrichment_broadcast_join_rewrite,
    crate::service::search::datafusion::optimizer::physical_optimizer::enrichment::should_use_enrichment_broadcast_join,
    o2_enterprise::enterprise::search::datafusion::optimizer::broadcast_join::should_use_broadcast_join,
};

use crate::service::search::{
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
        Self {
            remote_scan_nodes,
            single_node_optimizer_enable: config::get_config()
                .common
                .feature_single_node_optimize_enabled,
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
}

impl RemoteScanRewriter {
    pub fn new(remote_scan_nodes: Arc<RemoteScanNodes>) -> Self {
        Self {
            remote_scan_nodes,
            is_changed: false,
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
                let remote_scan = Arc::new(RemoteScanExec::new(
                    input.clone(),
                    self.remote_scan_nodes.get_remote_node(&table_name),
                )?);
                let output_partitioning =
                    Partitioning::RoundRobinBatch(input.output_partitioning().partition_count());
                let repartition =
                    Arc::new(RepartitionExec::try_new(remote_scan, output_partitioning)?);
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
                        let sort = child.as_any().downcast_ref::<SortExec>().unwrap();
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
            let table = node.as_any().downcast_ref::<NewEmptyExec>().unwrap();
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
