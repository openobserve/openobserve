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

use std::{any::Any, sync::Arc};

use arrow::array::RecordBatch;
use arrow_schema::{DataType, Schema, SchemaRef, SortOptions};
use async_trait::async_trait;
use datafusion::{
    catalog::Session,
    common::{project_schema, Constraints, Result},
    datasource::{MemTable, TableProvider},
    logical_expr::{Expr, TableType},
    physical_expr::{LexOrdering, PhysicalSortExpr},
    physical_plan::{
        expressions::{CastExpr, Column},
        filter::FilterExec,
        projection::ProjectionExec,
        sorts::sort::SortExec,
        ExecutionPlan, PhysicalExpr,
    },
};
use hashbrown::HashMap;

use crate::service::search::index::IndexCondition;

#[derive(Debug)]
pub(crate) struct NewMemTable {
    mem_table: MemTable,
    diff_rules: HashMap<String, DataType>,
    sorted_by_time: bool,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
}

impl NewMemTable {
    /// Create a new in-memory table from the provided schema and record batches
    pub fn try_new(
        schema: SchemaRef,
        partitions: Vec<Vec<RecordBatch>>,
        rules: HashMap<String, DataType>,
        sorted_by_time: bool,
        index_condition: Option<IndexCondition>,
        fst_fields: Vec<String>,
    ) -> Result<Self> {
        let mem = MemTable::try_new(schema, partitions)?;
        Ok(Self {
            mem_table: mem,
            diff_rules: rules,
            sorted_by_time,
            index_condition,
            fst_fields,
        })
    }
}

#[async_trait]
impl TableProvider for NewMemTable {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        self.mem_table.schema()
    }

    fn constraints(&self) -> Option<&Constraints> {
        self.mem_table.constraints()
    }

    fn table_type(&self) -> TableType {
        TableType::Base
    }

    async fn scan(
        &self,
        state: &dyn Session,
        projection: Option<&Vec<usize>>,
        filters: &[Expr],
        limit: Option<usize>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let (mem_projection, filter_projection) = if self.index_condition.is_some() {
            (None, projection)
        } else {
            (projection, None)
        };

        let memory_exec = self
            .mem_table
            .scan(state, mem_projection, filters, limit)
            .await?;

        let projection_exec = apply_projection_if_need(
            &self.schema(),
            &self.diff_rules,
            mem_projection,
            memory_exec,
        )?;

        let filter_exec = apply_filter_if_needed(
            self.index_condition.as_ref(),
            &self.schema(),
            &self.fst_fields,
            projection_exec,
            filter_projection,
        )?;

        apply_sort_if_needed(filter_exec, self.sorted_by_time)
    }

    fn get_column_default(&self, column: &str) -> Option<&Expr> {
        self.mem_table.get_column_default(column)
    }
}

// create sort exec by _timestamp
fn wrap_sort(exec: Arc<dyn ExecutionPlan>) -> Arc<dyn ExecutionPlan> {
    let column_timestamp = config::get_config().common.column_timestamp.to_string();
    let index = exec.schema().index_of(&column_timestamp);
    (match index {
        Ok(index) => {
            let ordering = LexOrdering::new(vec![PhysicalSortExpr {
                expr: Arc::new(Column::new(&column_timestamp, index)),
                options: SortOptions {
                    descending: true,
                    nulls_first: false,
                },
            }]);
            Arc::new(SortExec::new(ordering, exec))
        }
        Err(_) => exec,
    }) as _
}

fn wrap_filter(
    index_condition: &IndexCondition,
    schema: &Schema,
    fst_fields: &[String],
    exec: Arc<dyn ExecutionPlan>,
    projection: Option<&Vec<usize>>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let expr = index_condition.to_physical_expr(schema, fst_fields);

    Ok(Arc::new(
        FilterExec::try_new(expr, exec)?.with_projection(projection.cloned())?,
    ))
}

fn apply_projection_if_need(
    schema: &SchemaRef,
    diff_rules: &HashMap<String, DataType>,
    projection: Option<&Vec<usize>>,
    memory_exec: Arc<dyn ExecutionPlan>,
) -> Result<Arc<dyn ExecutionPlan>> {
    if diff_rules.is_empty() {
        return Ok(memory_exec);
    }
    let projected_schema = project_schema(schema, projection)?;
    let mut exprs: Vec<(Arc<dyn PhysicalExpr>, String)> =
        Vec::with_capacity(projected_schema.fields().len());
    for (idx, field) in projected_schema.fields().iter().enumerate() {
        let name = field.name().to_string();
        let col = Arc::new(Column::new(&name, idx));
        if let Some(data_type) = diff_rules.get(&name) {
            exprs.push((Arc::new(CastExpr::new(col, data_type.clone(), None)), name));
        } else {
            exprs.push((col, name));
        }
    }
    Ok(Arc::new(ProjectionExec::try_new(exprs, memory_exec)?))
}

fn apply_filter_if_needed(
    index_condition: Option<&IndexCondition>,
    schema: &Schema,
    fst_fields: &[String],
    exec_plan: Arc<dyn ExecutionPlan>,
    filter_projection: Option<&Vec<usize>>,
) -> Result<Arc<dyn ExecutionPlan>> {
    if let Some(condition) = index_condition {
        wrap_filter(condition, schema, fst_fields, exec_plan, filter_projection)
    } else {
        Ok(exec_plan)
    }
}

fn apply_sort_if_needed(
    exec_plan: Arc<dyn ExecutionPlan>,
    sorted_by_time: bool,
) -> Result<Arc<dyn ExecutionPlan>> {
    Ok(if sorted_by_time {
        wrap_sort(exec_plan)
    } else {
        exec_plan
    })
}
