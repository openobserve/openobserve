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

use std::{any::Any, sync::Arc};

use async_trait::async_trait;
use datafusion::{
    arrow::datatypes::SchemaRef,
    catalog::Session,
    common::{Result, project_schema},
    datasource::{TableProvider, TableType},
    logical_expr::TableProviderFilterPushDown,
    physical_plan::ExecutionPlan,
    prelude::Expr,
};

use crate::service::search::datafusion::distributed_plan::empty_exec::NewEmptyExec;

/// An empty plan that is useful for testing and generating plans
/// without mapping them to actual data.
#[derive(Debug, Clone)]
pub struct NewEmptyTable {
    name: String,
    schema: SchemaRef,
    partitions: usize,
    pub sorted_by_time: bool,
}

impl NewEmptyTable {
    /// Initialize a new `EmptyTable` from a schema.
    pub fn new(name: &str, schema: SchemaRef) -> Self {
        Self {
            name: name.to_string(),
            schema,
            partitions: 1,
            sorted_by_time: false,
        }
    }

    /// Creates a new EmptyTable with specified partition number.
    pub fn with_partitions(mut self, partitions: usize) -> Self {
        self.partitions = partitions;
        self
    }

    /// Creates a new EmptyTable with specified sorted_by_time.
    pub fn with_sorted_by_time(mut self, sorted_by_time: bool) -> Self {
        self.sorted_by_time = sorted_by_time;
        self
    }
}

#[async_trait]
impl TableProvider for NewEmptyTable {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    fn table_type(&self) -> TableType {
        TableType::Base
    }

    async fn scan(
        &self,
        _state: &dyn Session,
        projection: Option<&Vec<usize>>,
        filters: &[Expr],
        _limit: Option<usize>, // limit is not supported for empty table
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let projected_schema = project_schema(&self.schema, projection)?;
        Ok(Arc::new(
            NewEmptyExec::new(
                &self.name,
                projected_schema,
                projection,
                filters,
                None,
                self.sorted_by_time,
                self.schema.clone(),
            )
            .with_partitions(self.partitions),
        ))
    }

    fn supports_filters_pushdown(
        &self,
        filters: &[&Expr],
    ) -> Result<Vec<TableProviderFilterPushDown>> {
        Ok(vec![TableProviderFilterPushDown::Inexact; filters.len()])
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::{
        arrow::datatypes::{DataType, Field, Schema},
        datasource::{TableProvider, TableType},
        logical_expr::TableProviderFilterPushDown,
    };

    use super::*;

    fn test_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![Field::new("id", DataType::Int64, false)]))
    }

    #[test]
    fn test_new_defaults() {
        let table = NewEmptyTable::new("test", test_schema());
        assert!(!table.sorted_by_time);
    }

    #[test]
    fn test_with_sorted_by_time() {
        let table = NewEmptyTable::new("test", test_schema()).with_sorted_by_time(true);
        assert!(table.sorted_by_time);
    }

    #[test]
    fn test_with_partitions() {
        let table = NewEmptyTable::new("test", test_schema()).with_partitions(4);
        assert_eq!(table.partitions, 4);
    }

    #[test]
    fn test_schema_returns_correct_schema() {
        let schema = test_schema();
        let table = NewEmptyTable::new("test", schema.clone());
        assert_eq!(table.schema().fields().len(), 1);
        assert_eq!(table.schema().field(0).name(), "id");
    }

    #[test]
    fn test_table_type_is_base() {
        let table = NewEmptyTable::new("test", test_schema());
        assert_eq!(table.table_type(), TableType::Base);
    }

    #[test]
    fn test_supports_filters_pushdown_inexact() {
        let table = NewEmptyTable::new("test", test_schema());
        let dummy_expr = Expr::Literal(datafusion::scalar::ScalarValue::Boolean(Some(true)), None);
        let filters = vec![&dummy_expr];
        let result = table.supports_filters_pushdown(&filters).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], TableProviderFilterPushDown::Inexact);
    }

    #[test]
    fn test_supports_filters_pushdown_empty() {
        let table = NewEmptyTable::new("test", test_schema());
        let result = table.supports_filters_pushdown(&[]).unwrap();
        assert!(result.is_empty());
    }
}
