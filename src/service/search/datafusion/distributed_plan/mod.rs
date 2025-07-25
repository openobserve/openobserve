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

use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
    },
    physical_plan::ExecutionPlan,
};

pub mod codec;
pub mod empty_exec;
pub mod enrich_exec;
pub mod node;
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

pub struct EmptyExecVisitor {
    data: Option<Arc<dyn ExecutionPlan>>,
}

impl EmptyExecVisitor {
    pub fn new() -> Self {
        Self { data: None }
    }

    pub fn get_data(&self) -> Option<&Arc<dyn ExecutionPlan>> {
        self.data.as_ref()
    }
}

impl Default for EmptyExecVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl<'n> TreeNodeVisitor<'n> for EmptyExecVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if node.name() == "EmptyExec" {
            self.data = Some(node.clone());
            Ok(TreeNodeRecursion::Stop)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

pub struct ReplaceTableScanExec {
    input: Arc<dyn ExecutionPlan>,
}

impl ReplaceTableScanExec {
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

#[cfg(test)]
mod tests {
    use std::{any::Any, sync::Arc};

    use datafusion::physical_plan::{ExecutionPlan, PlanProperties};

    use super::*;

    #[derive(Debug)]
    struct MockExecPlan;
    impl datafusion::physical_plan::DisplayAs for MockExecPlan {
        fn fmt_as(
            &self,
            _: datafusion::physical_plan::DisplayFormatType,
            _: &mut std::fmt::Formatter,
        ) -> std::fmt::Result {
            Ok(())
        }
    }
    impl ExecutionPlan for MockExecPlan {
        fn name(&self) -> &'static str {
            "NewEmptyExec"
        }
        fn as_any(&self) -> &dyn Any {
            self
        }
        fn properties(&self) -> &PlanProperties {
            panic!("not needed")
        }
        fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
            vec![]
        }
        fn with_new_children(
            self: Arc<Self>,
            _: Vec<Arc<dyn ExecutionPlan>>,
        ) -> datafusion::common::Result<Arc<dyn ExecutionPlan>> {
            Ok(self)
        }
        fn execute(
            &self,
            _: usize,
            _: Arc<datafusion::execution::TaskContext>,
        ) -> datafusion::common::Result<datafusion::execution::SendableRecordBatchStream> {
            panic!("not needed")
        }
        fn statistics(&self) -> datafusion::common::Result<datafusion::common::Statistics> {
            panic!("not needed")
        }
    }

    #[derive(Debug)]
    struct MockEmptyExecPlan;
    impl datafusion::physical_plan::DisplayAs for MockEmptyExecPlan {
        fn fmt_as(
            &self,
            _: datafusion::physical_plan::DisplayFormatType,
            _: &mut std::fmt::Formatter,
        ) -> std::fmt::Result {
            Ok(())
        }
    }
    impl ExecutionPlan for MockEmptyExecPlan {
        fn name(&self) -> &'static str {
            "EmptyExec"
        }
        fn as_any(&self) -> &dyn Any {
            self
        }
        fn properties(&self) -> &PlanProperties {
            panic!("not needed")
        }
        fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
            vec![]
        }
        fn with_new_children(
            self: Arc<Self>,
            _: Vec<Arc<dyn ExecutionPlan>>,
        ) -> datafusion::common::Result<Arc<dyn ExecutionPlan>> {
            Ok(self)
        }
        fn execute(
            &self,
            _: usize,
            _: Arc<datafusion::execution::TaskContext>,
        ) -> datafusion::common::Result<datafusion::execution::SendableRecordBatchStream> {
            panic!("not needed")
        }
        fn statistics(&self) -> datafusion::common::Result<datafusion::common::Statistics> {
            panic!("not needed")
        }
    }

    #[test]
    fn test_new_empty_exec_visitor() {
        let plan = Arc::new(MockExecPlan) as Arc<dyn ExecutionPlan>;
        let mut visitor = NewEmptyExecVisitor::new();
        let _ = visitor.f_up(&plan);
        assert!(visitor.get_data().is_some());
    }

    #[test]
    fn test_empty_exec_visitor() {
        let plan = Arc::new(MockEmptyExecPlan) as Arc<dyn ExecutionPlan>;
        let mut visitor = EmptyExecVisitor::new();
        let _ = visitor.f_up(&plan);
        assert!(visitor.get_data().is_some());
    }

    #[test]
    fn test_replace_table_scan_exec() {
        let input = Arc::new(MockExecPlan) as Arc<dyn ExecutionPlan>;
        let mut rewriter = ReplaceTableScanExec::new(input.clone());
        let plan = Arc::new(MockExecPlan) as Arc<dyn ExecutionPlan>;
        let result = rewriter.f_up(plan.clone()).unwrap();
        // Should be transformed to input
        assert!(result.transformed);
        assert!(Arc::ptr_eq(&result.data, &input));
    }
}
