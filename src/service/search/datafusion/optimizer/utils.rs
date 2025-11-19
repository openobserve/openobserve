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

use config::TIMESTAMP_COL_NAME;
use datafusion::{
    common::{
        DFSchema, Result,
        tree_node::{
            Transformed, TransformedResult, TreeNode, TreeNodeRecursion, TreeNodeRewriter,
        },
    },
    datasource::DefaultTableSource,
    logical_expr::{Limit, LogicalPlan, Projection, Sort, SortExpr, TableScan, TableSource, col},
    physical_plan::ExecutionPlan,
    prelude::Expr,
    scalar::ScalarValue,
};

use crate::service::search::datafusion::table_provider::empty_table::NewEmptyTable;

// check if the plan is a complex query that we can't add sort _timestamp
pub fn is_complex_query(plan: &LogicalPlan) -> bool {
    matches!(
        plan,
        LogicalPlan::Aggregate(_)
            | LogicalPlan::Join(_)
            | LogicalPlan::Distinct(_)
            | LogicalPlan::RecursiveQuery(_)
            | LogicalPlan::Subquery(_)
            | LogicalPlan::Window(_)
            | LogicalPlan::Union(_)
            | LogicalPlan::Extension(_)
    )
}

pub struct AddSortAndLimit {
    pub limit: usize,
    pub offset: usize,
}

impl AddSortAndLimit {
    pub fn new(limit: usize, offset: usize) -> Self {
        Self { limit, offset }
    }
}

impl TreeNodeRewriter for AddSortAndLimit {
    type Node = LogicalPlan;

    fn f_down(&mut self, node: LogicalPlan) -> Result<Transformed<LogicalPlan>> {
        if is_contain_deduplication_plan(&node) {
            return Ok(Transformed::new(node, false, TreeNodeRecursion::Stop));
        }

        let is_complex = node.exists(|plan| Ok(is_complex_query(plan)))?;
        let mut is_stop = true;
        let (mut transformed, schema) = match node {
            // skip projection,subqueryalias, analyze, that we can add limit/sort after them
            LogicalPlan::Projection(_)
            | LogicalPlan::SubqueryAlias(_)
            | LogicalPlan::DescribeTable(_)
            | LogicalPlan::Analyze(_) => {
                is_stop = false;
                (Transformed::no(node), None)
            }
            LogicalPlan::Limit(mut limit) => match limit.input.as_ref() {
                LogicalPlan::Sort(_) => (Transformed::no(LogicalPlan::Limit(limit)), None),
                LogicalPlan::Projection(_) => (Transformed::no(LogicalPlan::Limit(limit)), None),
                _ => {
                    if is_complex {
                        (Transformed::no(LogicalPlan::Limit(limit)), None)
                    } else {
                        // the add sort plan should reflect the limit
                        let fetch = get_int_from_expr(&limit.fetch);
                        let skip = get_int_from_expr(&limit.skip);
                        let (sort, schema) = generate_sort_plan(limit.input.clone(), fetch + skip);
                        limit.input = Arc::new(sort);
                        (Transformed::yes(LogicalPlan::Limit(limit)), schema)
                    }
                }
            },
            LogicalPlan::Sort(sort) => {
                if sort.fetch.is_some() {
                    (Transformed::no(LogicalPlan::Sort(sort)), None)
                } else {
                    let plan = generate_limit_plan(
                        Arc::new(LogicalPlan::Sort(sort)),
                        self.limit,
                        self.offset,
                    );
                    (Transformed::yes(plan), None)
                }
            }
            _ => {
                if is_complex {
                    (
                        Transformed::yes(generate_limit_plan(
                            Arc::new(node),
                            self.limit,
                            self.offset,
                        )),
                        None,
                    )
                } else {
                    let (plan, schema) =
                        generate_limit_and_sort_plan(Arc::new(node), self.limit, self.offset);
                    (Transformed::yes(plan), schema)
                }
            }
        };
        if is_stop {
            transformed.tnr = TreeNodeRecursion::Stop;
        }

        if let Some(schema) = schema {
            let plan = transformed.data;
            let proj = LogicalPlan::Projection(Projection::new_from_schema(Arc::new(plan), schema));
            transformed.data = proj;
        }
        Ok(transformed)
    }
}

fn generate_limit_plan(input: Arc<LogicalPlan>, limit: usize, skip: usize) -> LogicalPlan {
    LogicalPlan::Limit(Limit {
        skip: Some(Box::new(Expr::Literal(
            ScalarValue::Int64(Some(skip as i64)),
            None,
        ))),
        fetch: Some(Box::new(Expr::Literal(
            ScalarValue::Int64(Some(limit as i64)),
            None,
        ))),
        input,
    })
}

fn generate_sort_plan(
    input: Arc<LogicalPlan>,
    limit: usize,
) -> (LogicalPlan, Option<Arc<DFSchema>>) {
    let timestamp = SortExpr {
        expr: col(TIMESTAMP_COL_NAME),
        asc: false,
        nulls_first: false,
    };
    let schema = input.schema().clone();
    if schema.field_with_name(None, TIMESTAMP_COL_NAME).is_err() {
        let mut input = input.as_ref().clone();
        input = input
            .rewrite(&mut ChangeTableScanSchema::new())
            .data()
            .unwrap();
        (
            LogicalPlan::Sort(Sort {
                expr: vec![timestamp],
                input: Arc::new(input),
                fetch: Some(limit),
            }),
            Some(schema),
        )
    } else {
        let mut input = input.as_ref().clone();
        input = input.rewrite(&mut SortByTime::new()).data().unwrap();
        (
            LogicalPlan::Sort(Sort {
                expr: vec![timestamp],
                input: Arc::new(input),
                fetch: Some(limit),
            }),
            None,
        )
    }
}

fn generate_limit_and_sort_plan(
    input: Arc<LogicalPlan>,
    limit: usize,
    skip: usize,
) -> (LogicalPlan, Option<Arc<DFSchema>>) {
    let (sort, schema) = generate_sort_plan(input, limit + skip);
    (
        LogicalPlan::Limit(Limit {
            skip: Some(Box::new(Expr::Literal(
                ScalarValue::Int64(Some(skip as i64)),
                None,
            ))),
            fetch: Some(Box::new(Expr::Literal(
                ScalarValue::Int64(Some(limit as i64)),
                None,
            ))),
            input: Arc::new(sort),
        }),
        schema,
    )
}

fn get_int_from_expr(expr: &Option<Box<Expr>>) -> usize {
    match expr {
        Some(expr) => match expr.as_ref() {
            Expr::Literal(ScalarValue::Int64(Some(value)), _) => *value as usize,
            _ => 0,
        },
        _ => 0,
    }
}

struct ChangeTableScanSchema {}

impl ChangeTableScanSchema {
    fn new() -> Self {
        Self {}
    }
}

impl TreeNodeRewriter for ChangeTableScanSchema {
    type Node = LogicalPlan;

    fn f_up(&mut self, node: LogicalPlan) -> Result<Transformed<LogicalPlan>> {
        let mut transformed = match node {
            LogicalPlan::TableScan(scan) => {
                let schema = scan.source.schema();
                let timestamp_idx = schema.index_of(TIMESTAMP_COL_NAME)?;
                let projection = scan.projection.clone().map(|mut p| {
                    p.push(timestamp_idx);
                    p
                });
                let mut table_scan = TableScan::try_new(
                    scan.table_name,
                    scan.source,
                    projection,
                    scan.filters,
                    scan.fetch,
                )?;
                // add sorted by time to the table source
                let source = generate_table_source_with_sorted_by_time(table_scan.source);
                table_scan.source = source;
                Transformed::yes(LogicalPlan::TableScan(table_scan))
            }
            _ => Transformed::no(node),
        };
        transformed.tnr = TreeNodeRecursion::Stop;
        Ok(transformed)
    }
}

struct SortByTime {}

impl SortByTime {
    fn new() -> Self {
        Self {}
    }
}

impl TreeNodeRewriter for SortByTime {
    type Node = LogicalPlan;

    fn f_up(&mut self, node: LogicalPlan) -> Result<Transformed<LogicalPlan>> {
        let mut transformed = match node {
            LogicalPlan::TableScan(mut scan) => {
                // add sorted by time to the table source
                let source = generate_table_source_with_sorted_by_time(scan.source);
                scan.source = source;
                Transformed::yes(LogicalPlan::TableScan(scan))
            }
            _ => Transformed::no(node),
        };
        transformed.tnr = TreeNodeRecursion::Stop;
        Ok(transformed)
    }
}

fn generate_table_source_with_sorted_by_time(
    table_source: Arc<dyn TableSource>,
) -> Arc<dyn TableSource> {
    let source: &DefaultTableSource = table_source
        .as_any()
        .downcast_ref::<DefaultTableSource>()
        .unwrap();
    if let Some(table_provider) = source
        .table_provider
        .as_any()
        .downcast_ref::<NewEmptyTable>()
    {
        let mut new_table_provider = (*table_provider).clone();
        new_table_provider.sorted_by_time = true;
        let new_source = DefaultTableSource::new(Arc::new(new_table_provider));
        Arc::new(new_source)
    } else {
        // for unit test
        table_source
    }
}

pub fn is_contain_deduplication_plan(plan: &LogicalPlan) -> bool {
    plan.exists(|plan| Ok(matches!(plan, LogicalPlan::Extension(_))))
        .unwrap_or(true)
}

// avoid add new plan when the plan is empty relation
// for example: select * from default where false
pub fn is_empty_relation(plan: &LogicalPlan) -> bool {
    plan.exists(|plan| Ok(matches!(plan, LogicalPlan::EmptyRelation(_))))
        .unwrap_or(true)
}

pub fn is_place_holder_or_empty(plan: &Arc<dyn ExecutionPlan>) -> bool {
    plan.exists(|plan| {
        Ok(plan.name() == "PlaceholderRowExec"
            || plan.name() == "EmptyExec"
            || plan.name() == "DataSourceExec")
    })
    .unwrap_or(true)
}
