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

use config::{ALL_VALUES_COL_NAME, ORIGINAL_DATA_COL_NAME};
use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRewriter},
    },
    config::ConfigOptions,
    logical_expr::{Expr, LogicalPlan, Projection},
    optimizer::AnalyzerRule,
};

/// Optimization rule that remove index fields from table scan
///
/// Note: should apply before push down filter rule
#[derive(Default, Debug)]
pub struct RemoveIndexFieldsRule {
    need_original_field: bool,
    need_all_values_field: bool,
}

impl RemoveIndexFieldsRule {
    #[allow(missing_docs)]
    pub fn new(need_original_field: bool, need_all_values_field: bool) -> Self {
        Self {
            need_original_field,
            need_all_values_field,
        }
    }
}

impl AnalyzerRule for RemoveIndexFieldsRule {
    fn name(&self) -> &str {
        "remove_index_fields"
    }

    fn analyze(&self, plan: LogicalPlan, _config: &ConfigOptions) -> Result<LogicalPlan> {
        let plan = plan.rewrite(&mut RemoveIndexFields::new(
            self.need_original_field,
            self.need_all_values_field,
        ))?;
        Ok(plan.data)
    }
}

struct RemoveIndexFields {
    need_original_field: bool,
    need_all_values_field: bool,
}

impl RemoveIndexFields {
    pub fn new(need_original_field: bool, need_all_values_field: bool) -> Self {
        Self {
            need_original_field,
            need_all_values_field,
        }
    }
}

impl TreeNodeRewriter for RemoveIndexFields {
    type Node = LogicalPlan;

    fn f_up(&mut self, node: LogicalPlan) -> Result<Transformed<LogicalPlan>> {
        match node {
            LogicalPlan::Projection(ref projection) => {
                if matches!(&*projection.input, LogicalPlan::Filter(_)) {
                    let schema = projection.input.schema();

                    // check if the table has original_data & _all_values field
                    let has_original_data =
                        schema.index_of_column_by_name(None, ORIGINAL_DATA_COL_NAME);
                    let has_all_values = schema.index_of_column_by_name(None, ALL_VALUES_COL_NAME);
                    if (self.need_original_field || has_original_data.is_none())
                        && has_all_values.is_none()
                    {
                        return Ok(Transformed::no(node));
                    }

                    let mut new_projection = projection.clone();
                    if !self.need_original_field && has_original_data.is_some() {
                        new_projection.expr.retain(|expr| {
                            if let Expr::Column(column) = expr {
                                column.name() != ORIGINAL_DATA_COL_NAME
                            } else {
                                true
                            }
                        });
                    }
                    if !self.need_all_values_field && has_all_values.is_some() {
                        new_projection.expr.retain(|expr| {
                            if let Expr::Column(column) = expr {
                                column.name() != ALL_VALUES_COL_NAME
                            } else {
                                true
                            }
                        });
                    }
                    let projection =
                        Projection::try_new(new_projection.expr, projection.input.clone())?;
                    Ok(Transformed::yes(LogicalPlan::Projection(projection)))
                } else {
                    Ok(Transformed::no(node))
                }
            }
            _ => Ok(Transformed::no(node)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        common::Result,
        logical_expr::{LogicalPlan, LogicalPlanBuilder, lit, table_scan},
        optimizer::Analyzer,
        prelude::col,
    };

    use super::*;

    fn test_table() -> Result<LogicalPlan> {
        let schema = Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("_original_data", DataType::Utf8, false),
            Field::new("_all_values", DataType::Utf8, false),
        ]);
        let test = table_scan(Some("test"), &schema, None)?.build()?;
        Ok(test)
    }

    fn assert_analyzer_plan_equal(
        plan: LogicalPlan,
        expected: &str,
        need_original_field: bool,
        need_all_values_field: bool,
    ) -> Result<()> {
        assert_analyzer_plan_eq(
            Arc::new(RemoveIndexFieldsRule::new(
                need_original_field,
                need_all_values_field,
            )),
            plan,
            expected,
        )
    }

    // from datafusion
    pub fn assert_analyzer_plan_eq(
        rule: Arc<dyn AnalyzerRule + Send + Sync>,
        plan: LogicalPlan,
        expected: &str,
    ) -> Result<()> {
        // Apply the rule once
        let config = ConfigOptions::new();

        let analyzer = Analyzer::with_rules(vec![Arc::clone(&rule)]);
        let analyzer_plan = analyzer.execute_and_check(plan, &config, |_plan, _rule| {})?;
        let formatted_plan = format!("{analyzer_plan}");
        assert_eq!(formatted_plan, expected);

        Ok(())
    }

    #[test]
    fn test_remove_index_fields_table_scan() -> Result<()> {
        let table_scan = test_table()?;
        let plan = LogicalPlanBuilder::from(table_scan).build()?;

        let expected = "TableScan: test";
        assert_analyzer_plan_equal(plan, expected, false, false)
    }

    #[test]
    fn test_remove_index_fields_table_scan_with_projection() -> Result<()> {
        let table_scan = test_table()?;
        let plan = LogicalPlanBuilder::from(table_scan)
            .project(vec![col("id")])?
            .build()?;

        let expected = "Projection: test.id\n  TableScan: test";
        assert_analyzer_plan_equal(plan, expected, false, false)
    }

    #[test]
    fn test_remove_index_fields_table_scan_with_projection_all_values() -> Result<()> {
        let table_scan = test_table()?;
        let plan = LogicalPlanBuilder::from(table_scan)
            .project(vec![col("id"), col("_all_values")])?
            .build()?;

        let expected = "Projection: test.id, test._all_values\n  TableScan: test";
        assert_analyzer_plan_equal(plan, expected, false, true)
    }

    #[test]
    fn test_remove_index_fields_table_scan_with_filter() -> Result<()> {
        let table_scan = test_table()?;
        let plan = LogicalPlanBuilder::from(table_scan)
            .filter(col("id").gt(lit(1)))?
            .project(vec![col("id")])?
            .build()?;

        let expected = "Projection: test.id\n  Filter: test.id > Int32(1)\n    TableScan: test";
        assert_analyzer_plan_equal(plan, expected, false, false)
    }

    #[test]
    fn test_remove_index_fields_table_scan_with_need_original_field() -> Result<()> {
        let table_scan = test_table()?;
        let plan = LogicalPlanBuilder::from(table_scan)
            .filter(col("id").gt(lit(1)))?
            .project(vec![col("id"), col("_original_data")])?
            .build()?;

        let expected = "Projection: test.id, test._original_data\n  Filter: test.id > Int32(1)\n    TableScan: test";
        assert_analyzer_plan_equal(plan, expected, true, false)
    }

    #[test]
    fn test_remove_index_fields_table_scan_with_need_all_values_field() -> Result<()> {
        let table_scan = test_table()?;
        let plan = LogicalPlanBuilder::from(table_scan)
            .filter(col("id").gt(lit(1)))?
            .project(vec![col("id"), col("_all_values")])?
            .build()?;

        let expected = "Projection: test.id, test._all_values\n  Filter: test.id > Int32(1)\n    TableScan: test";
        assert_analyzer_plan_equal(plan, expected, false, true)
    }
}
