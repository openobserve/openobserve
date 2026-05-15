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

use datafusion::physical_plan::{ExecutionPlan, displayable};

use crate::cluster::LOCAL_NODE;

pub fn generate_plan_string(trace_id: &str, plan: &dyn ExecutionPlan) -> String {
    let plan = displayable(plan).indent(false).to_string();
    let mut plan = format!("[trace_id {trace_id}] \n{plan}");
    if !LOCAL_NODE.is_single_node() {
        plan = plan.replace("\n", "\\n");
    }
    plan
}

pub fn print_plan(plan: &dyn ExecutionPlan) {
    let plan = displayable(plan).indent(false).to_string();
    println!("\n{plan}\n");
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::datatypes::{DataType, Field, Schema};
    use datafusion::physical_plan::empty::EmptyExec;

    use super::*;

    fn empty_plan() -> Arc<dyn ExecutionPlan> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        Arc::new(EmptyExec::new(schema))
    }

    #[test]
    fn test_generate_plan_string_contains_trace_id() {
        let plan = empty_plan();
        let result = generate_plan_string("trace-xyz", plan.as_ref());
        assert!(result.contains("trace-xyz"));
        assert!(result.contains("EmptyExec"));
    }

    #[test]
    fn test_generate_plan_string_nonempty() {
        let plan = empty_plan();
        let result = generate_plan_string("t1", plan.as_ref());
        assert!(!result.is_empty());
    }

    #[test]
    fn test_print_plan_does_not_panic() {
        let plan = empty_plan();
        print_plan(plan.as_ref());
    }
}
