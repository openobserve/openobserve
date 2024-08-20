use std::{collections::HashMap, sync::Arc};

use config::meta::{cluster::Node, stream::FileKey};
use datafusion::{
    common::{
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
        Result,
    },
    physical_plan::{repartition::RepartitionExec, ExecutionPlan, Partitioning},
};
use proto::cluster_rpc::SearchRequest;

use super::{empty_exec::NewEmptyExec, remote_scan::RemoteScanExec};

// add remote scan to physical plan
pub struct RemoteScanRewriter {
    req: SearchRequest,
    nodes: Vec<Node>,
    file_lists: HashMap<String, Vec<Vec<FileKey>>>,
    pub is_changed: bool,
}

impl RemoteScanRewriter {
    #[allow(dead_code)]
    pub fn new(
        req: SearchRequest,
        file_lists: HashMap<String, Vec<Vec<FileKey>>>,
        nodes: Vec<Node>,
    ) -> Self {
        Self {
            req,
            nodes,
            file_lists,
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
                let input = node.children()[0];
                let remote_scan = Arc::new(RemoteScanExec::new(
                    input.clone(),
                    self.file_lists
                        .get(&visitor.table_name.clone().unwrap())
                        .unwrap()
                        .clone(),
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
                let follow_merge_node = node.clone();
                let new_input =
                    follow_merge_node.with_new_children(vec![node.children()[0].clone()])?;

                let remote_scan = Arc::new(RemoteScanExec::new(
                    new_input,
                    self.file_lists
                        .get(&visitor.table_name.clone().unwrap())
                        .unwrap()
                        .clone(),
                    self.req.clone(),
                    self.nodes.clone(),
                ));
                let partitioning = Partitioning::RoundRobinBatch(self.nodes.len());
                let repartition = Arc::new(RepartitionExec::try_new(remote_scan, partitioning)?);
                let new_node = node.with_new_children(vec![repartition])?;
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
