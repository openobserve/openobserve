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

use std::fmt;

use datafusion::{
    common::{Column, DFSchemaRef, Result},
    logical_expr::{LogicalPlan, UserDefinedLogicalNodeCore},
    prelude::Expr,
};

#[derive(Debug, PartialEq, Eq, Hash, PartialOrd)]
pub struct DeduplicationLogicalNode {
    pub input: LogicalPlan,
    pub deduplication_columns: Vec<Column>,
    #[allow(unused)]
    pub max_rows: usize,
}

impl DeduplicationLogicalNode {
    #[allow(unused)]
    pub fn new(input: LogicalPlan, deduplication_columns: Vec<Column>) -> Self {
        Self {
            input,
            deduplication_columns,
            max_rows: 1,
        }
    }
}

impl UserDefinedLogicalNodeCore for DeduplicationLogicalNode {
    fn name(&self) -> &str {
        "Deduplication"
    }

    fn inputs(&self) -> Vec<&LogicalPlan> {
        vec![&self.input]
    }

    fn schema(&self) -> &DFSchemaRef {
        self.input.schema()
    }

    fn expressions(&self) -> Vec<Expr> {
        vec![]
    }

    fn fmt_for_explain(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Deduplication")
    }

    fn with_exprs_and_inputs(&self, _exprs: Vec<Expr>, inputs: Vec<LogicalPlan>) -> Result<Self> {
        Ok(DeduplicationLogicalNode {
            input: inputs.into_iter().next().unwrap(),
            deduplication_columns: self.deduplication_columns.clone(),
            max_rows: self.max_rows,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::{
        common::DFSchema,
        logical_expr::{EmptyRelation, LogicalPlan, UserDefinedLogicalNodeCore},
    };

    use super::*;

    fn empty_plan() -> LogicalPlan {
        LogicalPlan::EmptyRelation(EmptyRelation {
            produce_one_row: false,
            schema: Arc::new(DFSchema::empty()),
        })
    }

    #[test]
    fn test_name() {
        let node = DeduplicationLogicalNode::new(empty_plan(), vec![]);
        assert_eq!(node.name(), "Deduplication");
    }

    #[test]
    fn test_inputs_returns_one_element() {
        let node = DeduplicationLogicalNode::new(empty_plan(), vec![]);
        assert_eq!(node.inputs().len(), 1);
    }

    #[test]
    fn test_expressions_is_empty() {
        let node = DeduplicationLogicalNode::new(empty_plan(), vec![]);
        assert!(node.expressions().is_empty());
    }

    #[test]
    fn test_fmt_for_explain() {
        let node = DeduplicationLogicalNode::new(empty_plan(), vec![]);
        struct Wrap<'a>(&'a DeduplicationLogicalNode);
        impl std::fmt::Display for Wrap<'_> {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt_for_explain(f)
            }
        }
        assert_eq!(format!("{}", Wrap(&node)), "Deduplication");
    }

    #[test]
    fn test_with_exprs_and_inputs_preserves_columns() {
        let col = Column::from_name("ts");
        let node = DeduplicationLogicalNode::new(empty_plan(), vec![col.clone()]);
        let new_input = empty_plan();
        let new_node = node.with_exprs_and_inputs(vec![], vec![new_input]).unwrap();
        assert_eq!(new_node.deduplication_columns, vec![col]);
        assert_eq!(new_node.max_rows, 1);
    }
}
