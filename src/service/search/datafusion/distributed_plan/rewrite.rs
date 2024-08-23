// Copyright 2024 Zinc Labs Inc.
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

use config::meta::{cluster::Node, stream::FileKey};
use datafusion::{
    common::{
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
        Result,
    },
    physical_plan::{repartition::RepartitionExec, ExecutionPlan, Partitioning},
};
use hashbrown::HashMap;
use proto::cluster_rpc::{PartitionKeys, SearchRequest};

use super::{empty_exec::NewEmptyExec, remote_scan::RemoteScanExec};

// add remote scan to physical plan
pub struct RemoteScanRewriter {
    pub req: SearchRequest,
    pub nodes: Vec<Node>,
    pub file_lists: HashMap<String, Vec<Vec<FileKey>>>,
    pub partition_keys: HashMap<String, Vec<PartitionKeys>>,
    pub match_all_keys: Vec<String>,
    pub is_leader: bool, // for super cluster
    pub is_changed: bool,
}

impl RemoteScanRewriter {
    #[allow(dead_code)]
    pub fn new(
        req: SearchRequest,
        nodes: Vec<Node>,
        file_lists: HashMap<String, Vec<Vec<FileKey>>>,
        partition_keys: HashMap<String, Vec<PartitionKeys>>,
        match_all_keys: Vec<String>,
        is_leader: bool,
    ) -> Self {
        Self {
            req,
            nodes,
            file_lists,
            partition_keys,
            match_all_keys,
            is_leader,
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
                let empty = vec![];
                let table_name = visitor.table_name.clone().unwrap();
                let input = node.children()[0];
                let remote_scan = Arc::new(RemoteScanExec::new(
                    input.clone(),
                    self.file_lists.get(&table_name).unwrap().clone(),
                    self.partition_keys
                        .get(&table_name)
                        .unwrap_or(&empty)
                        .clone(),
                    self.match_all_keys.clone(),
                    self.is_leader,
                    self.req.clone(),
                    self.nodes.clone(),
                ));
                let partitioning = Partitioning::RoundRobinBatch(self.nodes.len());
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
                let empty = vec![];
                let follow_merge_node = node.clone();
                let new_input =
                    follow_merge_node.with_new_children(vec![node.children()[0].clone()])?;

                let remote_scan = Arc::new(RemoteScanExec::new(
                    new_input,
                    self.file_lists
                        .get(&visitor.table_name.clone().unwrap())
                        .unwrap()
                        .clone(),
                    self.partition_keys
                        .get(&table_name)
                        .unwrap_or(&empty)
                        .clone(),
                    self.match_all_keys.clone(),
                    self.is_leader,
                    self.req.clone(),
                    self.nodes.clone(),
                ));
                let new_node = node.with_new_children(vec![remote_scan])?;
                self.is_changed = true;
                return Ok(Transformed::yes(new_node));
            }
        }
        Ok(Transformed::no(node))
    }
}

// visit physical plan to get underlying table name and check is add a remote scan after current
// physical plan
#[allow(dead_code)]
struct TableNameVisitor {
    table_name: Option<String>,
    is_remote_scan: bool, // is add remote scan after current physical plan
}

impl TableNameVisitor {
    #[allow(dead_code)]
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
