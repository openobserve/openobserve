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

use config::meta::{cluster::NodeInfo, inverted_index::IndexOptimizeMode};
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

use crate::service::search::{
    datafusion::{
        distributed_plan::{
            empty_exec::NewEmptyExec, node::RemoteScanNodes, remote_scan::RemoteScanExec,
        },
        optimizer::context::RemoteScanContext,
    },
    index::IndexCondition,
    request::Request,
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
        sql.index_condition.clone(),
        sql.index_optimize_mode.clone(),
        is_leader,
        context,
    ))
}

// add remote scan to physical plan
#[derive(Debug)]
pub struct RemoteScanRule {
    remote_scan_nodes: Arc<RemoteScanNodes>,
}

impl RemoteScanRule {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        req: Request,
        nodes: Vec<Arc<dyn NodeInfo>>,
        file_id_lists: HashMap<TableReference, Vec<Vec<i64>>>,
        equal_keys: HashMap<TableReference, Vec<KvItem>>,
        index_condition: Option<IndexCondition>,
        index_optimize_mode: Option<IndexOptimizeMode>,
        is_leader: bool,
        opentelemetry_context: opentelemetry::Context,
    ) -> Self {
        let remote_scan_nodes = RemoteScanNodes::new(
            req,
            nodes,
            file_id_lists,
            equal_keys,
            index_condition,
            index_optimize_mode,
            is_leader,
            opentelemetry_context,
        );
        let remote_scan_nodes = Arc::new(remote_scan_nodes);
        Self { remote_scan_nodes }
    }
}

impl PhysicalOptimizerRule for RemoteScanRule {
    /// Rewrite `plan` to an optimized form
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let mut plan = plan;
        let is_change = if is_single_node_optimize(&plan) {
            false
        } else {
            let mut rewrite = RemoteScanRewriter::new(self.remote_scan_nodes.clone());
            plan = plan.rewrite(&mut rewrite)?.data;
            rewrite.is_changed
        };

        // add remote scan exec to top if physical plan do not have remote scan exec
        if !is_change {
            let mut visitor = TableNameVisitor::new();
            plan.visit(&mut visitor)?;
            if visitor.is_remote_scan {
                let table_name = visitor.table_name.clone().unwrap();
                plan = Arc::new(RemoteScanExec::new(
                    plan,
                    self.remote_scan_nodes.get_remote_node(&table_name),
                )?);
            }
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
            if visitor.is_remote_scan {
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
            if visitor.is_remote_scan {
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
            if visitor.is_remote_scan {
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

// visit physical plan to get underlying table name and check is add a remote scan after current
// physical plan
struct TableNameVisitor {
    table_name: Option<TableReference>,
    is_remote_scan: bool, // is add remote scan after current physical plan
}

impl TableNameVisitor {
    pub fn new() -> Self {
        Self {
            table_name: None,
            is_remote_scan: true,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for TableNameVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        let name = node.name();
        if name == "RemoteScanExec" {
            self.is_remote_scan = false;
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

    #[allow(dead_code)]
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
