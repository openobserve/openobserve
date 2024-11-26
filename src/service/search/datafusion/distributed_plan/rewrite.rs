// Copyright 2024 OpenObserve Inc.
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

use config::meta::{cluster::NodeInfo, stream::FileKey};
use datafusion::{
    common::{
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
        Result,
    },
    physical_plan::{repartition::RepartitionExec, ExecutionPlan, Partitioning},
};
use hashbrown::HashMap;
use proto::cluster_rpc::KvItem;

use super::{empty_exec::NewEmptyExec, node::RemoteScanNodes, remote_scan::RemoteScanExec};
use crate::service::search::{index::IndexCondition, request::Request};

// add remote scan to physical plan
pub struct RemoteScanRewriter {
    pub remote_scan_nodes: RemoteScanNodes,
    pub is_changed: bool,
}

impl RemoteScanRewriter {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        req: Request,
        nodes: Vec<Arc<dyn NodeInfo>>,
        file_id_lists: HashMap<String, Vec<Vec<i64>>>,
        idx_file_list: Vec<FileKey>,
        equal_keys: HashMap<String, Vec<KvItem>>,
        match_all_keys: Vec<String>,
        index_condition: Option<IndexCondition>,
        is_leader: bool,
        opentelemetry_context: opentelemetry::Context,
    ) -> Self {
        Self {
            remote_scan_nodes: RemoteScanNodes::new(
                req,
                nodes,
                file_id_lists,
                idx_file_list,
                equal_keys,
                match_all_keys,
                index_condition,
                is_leader,
                opentelemetry_context,
            ),
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
                let node_len = self.remote_scan_nodes.nodes.len();
                let remote_scan = Arc::new(RemoteScanExec::new(
                    input.clone(),
                    self.remote_scan_nodes.get_remote_node(table_name.as_str()),
                )?);
                let partitioning = Partitioning::RoundRobinBatch(node_len);
                let repartition = Arc::new(RepartitionExec::try_new(remote_scan, partitioning)?);
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
                    self.remote_scan_nodes.get_remote_node(table_name.as_str()),
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
                    let table_name = visitor.table_name.clone().unwrap();
                    let remote_scan = Arc::new(RemoteScanExec::new(
                        child.clone(),
                        self.remote_scan_nodes.get_remote_node(table_name.as_str()),
                    )?);
                    new_children.push(remote_scan);
                }
                let new_node = node.with_new_children(new_children)?;
                self.is_changed = true;
                return Ok(Transformed::yes(new_node));
            }
        }
        Ok(Transformed::no(node))
    }
}

// visit physical plan to get underlying table name and check is add a remote scan after current
// physical plan
struct TableNameVisitor {
    table_name: Option<String>,
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
            self.table_name = Some(table.name().to_string());
            Ok(TreeNodeRecursion::Continue)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}
