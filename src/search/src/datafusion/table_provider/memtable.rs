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

use std::sync::Arc;

use arrow::array::RecordBatch;
use arrow_schema::{DataType, SchemaRef};
use async_trait::async_trait;
use config::{TIMESTAMP_COL_NAME, get_config};
use datafusion::{
    catalog::Session,
    common::{Constraints, Result},
    datasource::{MemTable, TableProvider},
    logical_expr::{Expr, TableType},
    physical_plan::{ExecutionPlan, sorts::sort::SortExec},
};
use hashbrown::HashMap;

use crate::{
    datafusion::{
        sort_order::FileSortOrder,
        table_provider::helpers::{apply_combined_filter, apply_projection},
    },
    index::IndexCondition,
};

#[derive(Debug)]
pub struct NewMemTable {
    mem_table: MemTable,
    diff_rules: HashMap<String, DataType>,
    sort_order: FileSortOrder,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
    timestamp_filter: (i64, i64),
}

impl NewMemTable {
    /// Create a new in-memory table from the provided schema and record batches
    pub fn try_new(
        schema: SchemaRef,
        partitions: Vec<Vec<RecordBatch>>,
        rules: HashMap<String, DataType>,
        sort_order: FileSortOrder,
        index_condition: Option<IndexCondition>,
        fst_fields: Vec<String>,
        timestamp_filter: (i64, i64),
    ) -> Result<Self> {
        // this schema is the full schema of the table, from empty_exec.full_schema()
        let mem = MemTable::try_new(schema, partitions)?;
        Ok(Self {
            mem_table: mem,
            diff_rules: rules,
            sort_order,
            index_condition,
            fst_fields,
            timestamp_filter,
        })
    }
}

#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::datatypes::{DataType, Field, Schema};
    use hashbrown::HashMap;

    use super::*;

    fn make_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("message", DataType::Utf8, true),
        ]))
    }

    #[test]
    fn test_try_new_single_empty_partition_succeeds() {
        let schema = make_schema();
        // MemTable requires at least one partition (may be empty)
        let result = NewMemTable::try_new(
            schema,
            vec![vec![]],
            HashMap::new(),
            FileSortOrder::None,
            None,
            vec![],
            (0, i64::MAX),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_try_new_with_rules() {
        let schema = make_schema();
        let mut rules = HashMap::new();
        rules.insert("message".to_string(), DataType::Utf8);
        let result = NewMemTable::try_new(
            schema,
            vec![vec![]],
            rules,
            FileSortOrder::TimestampDesc,
            None,
            vec!["message".to_string()],
            (0, 1000),
        );
        assert!(result.is_ok());
    }
}

#[async_trait]
impl TableProvider for NewMemTable {
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
        let (mem_projection, filter_projection) = {
            // get the projection for the filter
            let mut filter_projection = self
                .index_condition
                .as_ref()
                .map(|ic| ic.get_schema_projection(self.schema(), &self.fst_fields))
                .unwrap_or_default();

            // add _timestamp column if timestamp_filter is present
            if let Ok(timestamp_idx) = self.schema().index_of(TIMESTAMP_COL_NAME)
                && !filter_projection.contains(&timestamp_idx)
            {
                filter_projection.push(timestamp_idx);
            }

            // add requested projection columns
            if let Some(v) = projection.as_ref() {
                filter_projection.extend(v.iter().copied());
            }
            filter_projection.sort();
            filter_projection.dedup();

            // regenerate the projection with the filter_projection
            let projection = projection.as_ref().map(|p| {
                p.iter()
                    .filter_map(|i| filter_projection.iter().position(|f| f == i))
                    .collect::<Vec<_>>()
            });
            (Some(filter_projection), projection)
        };
        let mem_projection = mem_projection.as_ref();
        let filter_projection = filter_projection.as_ref();

        let memory_exec = self
            .mem_table
            .scan(state, mem_projection, filters, limit)
            .await?;

        let projection_exec = apply_projection(
            &self.schema(),
            &self.diff_rules,
            mem_projection,
            memory_exec,
        )?;

        // if the index condition can remove filter, we can skip the config
        // feature_query_remove_filter_with_index
        let can_remove_filter = self
            .index_condition
            .as_ref()
            .map(|v| v.can_remove_filter())
            .unwrap_or(true);
        let index_condition =
            if can_remove_filter || get_config().search.feature_query_remove_filter_with_index {
                self.index_condition.as_ref()
            } else {
                None
            };
        let filter_exec = apply_combined_filter(
            index_condition,
            Some(self.timestamp_filter),
            &projection_exec.schema(),
            &self.fst_fields,
            projection_exec,
            filter_projection,
        )?;

        apply_sort(filter_exec, self.sort_order)
    }

    fn get_column_default(&self, column: &str) -> Option<&Expr> {
        self.mem_table.get_column_default(column)
    }
}

/// Wrap the plan in a `SortExec` that produces `sort_order`. Memtable batches
/// are unsorted, so this is what makes them satisfy the ordering the rest of
/// the plan was built for. No-op when the order is `None` or when a sort
/// column is missing from the projected schema.
fn apply_sort(
    exec_plan: Arc<dyn ExecutionPlan>,
    sort_order: FileSortOrder,
) -> Result<Arc<dyn ExecutionPlan>> {
    Ok(match sort_order.physical_ordering(&exec_plan.schema()) {
        Some(ordering) => Arc::new(SortExec::new(ordering, exec_plan)) as _,
        None => exec_plan,
    })
}
