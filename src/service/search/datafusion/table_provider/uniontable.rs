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

use arrow_schema::SchemaRef;
use async_trait::async_trait;
use datafusion::{
    catalog::Session,
    common::Result,
    datasource::TableProvider,
    logical_expr::{Expr, TableProviderFilterPushDown, TableType},
    physical_plan::{ExecutionPlan, empty::EmptyExec, union::UnionExec},
};

#[derive(Debug)]
pub(crate) struct NewUnionTable {
    schema: SchemaRef,
    tables: Vec<Arc<dyn TableProvider>>,
}

impl NewUnionTable {
    /// Create a new in-memory table from the provided schema and record batches
    pub fn new(schema: SchemaRef, tables: Vec<Arc<dyn TableProvider>>) -> Self {
        Self { schema, tables }
    }
}

#[async_trait]
impl TableProvider for NewUnionTable {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.schema)
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
        if self.tables.is_empty() {
            return Ok(Arc::new(EmptyExec::new(self.schema())));
        }
        if self.tables.len() == 1 {
            return self.tables[0].scan(state, projection, filters, limit).await;
        }
        let mut table_plans = Vec::new();
        for table in self.tables.iter() {
            let plan = table.scan(state, projection, filters, limit).await?;
            table_plans.push(plan);
        }

        Ok(UnionExec::try_new(table_plans)?)
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

    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        datasource::{TableProvider, TableType},
        logical_expr::TableProviderFilterPushDown,
        prelude::Expr,
        scalar::ScalarValue,
    };

    use super::*;

    fn test_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![Field::new("val", DataType::Int64, false)]))
    }

    #[test]
    fn test_schema_returns_correct_schema() {
        let table = NewUnionTable::new(test_schema(), vec![]);
        assert_eq!(table.schema().fields().len(), 1);
        assert_eq!(table.schema().field(0).name(), "val");
    }

    #[test]
    fn test_table_type_is_base() {
        let table = NewUnionTable::new(test_schema(), vec![]);
        assert_eq!(table.table_type(), TableType::Base);
    }

    #[test]
    fn test_supports_filters_pushdown_empty() {
        let table = NewUnionTable::new(test_schema(), vec![]);
        let result = table.supports_filters_pushdown(&[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_supports_filters_pushdown_returns_inexact() {
        let table = NewUnionTable::new(test_schema(), vec![]);
        let dummy = Expr::Literal(ScalarValue::Boolean(Some(true)), None);
        let filters = vec![&dummy];
        let result = table.supports_filters_pushdown(&filters).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], TableProviderFilterPushDown::Inexact);
    }
}
