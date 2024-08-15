use std::sync::Arc;

use datafusion::{
    common::{
        tree_node::{Transformed, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
        Result,
    },
    physical_plan::ExecutionPlan,
};

pub mod codec;
pub mod empty_exec;
pub mod remote_scan;
pub mod rewrite;

pub struct NewEmptyExecVisitor {
    data: Option<Arc<dyn ExecutionPlan>>,
}

impl NewEmptyExecVisitor {
    pub fn new() -> Self {
        Self { data: None }
    }

    pub fn get_data(&self) -> Option<&Arc<dyn ExecutionPlan>> {
        self.data.as_ref()
    }
}

impl Default for NewEmptyExecVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl<'n> TreeNodeVisitor<'n> for NewEmptyExecVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if node.name() == "NewEmptyExec" {
            self.data = Some(node.clone());
            Ok(TreeNodeRecursion::Stop)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

#[allow(dead_code)]
pub struct ReplaceTableScanExec {
    input: Arc<dyn ExecutionPlan>,
}

impl ReplaceTableScanExec {
    #[allow(dead_code)]
    pub fn new(input: Arc<dyn ExecutionPlan>) -> Self {
        Self { input }
    }
}

impl TreeNodeRewriter for ReplaceTableScanExec {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Self::Node) -> Result<Transformed<Self::Node>> {
        let name = node.name().to_string();
        let mut transformed = if name == "NewEmptyExec" {
            Transformed::yes(self.input.clone())
        } else {
            Transformed::no(node)
        };
        if name == "NewEmptyExec" {
            transformed.tnr = TreeNodeRecursion::Stop;
        } else {
            transformed.tnr = TreeNodeRecursion::Continue;
        }
        Ok(transformed)
    }
}