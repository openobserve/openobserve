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

use arrow_schema::SchemaRef;
use async_trait::async_trait;
use datafusion::{
    catalog::Session,
    common::{Result, project_schema},
    datasource::TableProvider,
    logical_expr::{Expr, TableProviderFilterPushDown, TableType},
    physical_plan::{ExecutionPlan, empty::EmptyExec, union::UnionExec},
};

#[derive(Debug)]
pub struct NewUnionTable {
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
            // Honor projection so filters use the correct column indices even for empty scans.
            let projected_schema = project_schema(&self.schema, projection)?;
            return Ok(Arc::new(EmptyExec::new(projected_schema)));
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
        prelude::{Expr, SessionContext},
        scalar::ScalarValue,
    };

    use super::*;

    fn test_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![Field::new("val", DataType::Int64, false)]))
    }

    fn metrics_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![
            Field::new("unused_label", DataType::Utf8View, true),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("trace_stream", DataType::Utf8View, true),
            Field::new("value", DataType::Float64, true),
        ]))
    }

    #[tokio::test]
    async fn test_empty_scan_projection() -> Result<()> {
        let schema = metrics_schema();
        let table = NewUnionTable::new(schema.clone(), vec![]);
        let ctx = SessionContext::new();
        for projection in [None, Some(vec![3, 1]), Some(vec![])] {
            let plan = table
                .scan(&ctx.state(), projection.as_ref(), &[], None)
                .await?;
            let expected = match projection {
                Some(indices) => Arc::new(schema.project(&indices)?),
                None => schema.clone(),
            };
            assert_eq!(plan.schema(), expected);
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_empty_scan_with_timestamp_filter() -> Result<()> {
        let ctx = SessionContext::new();
        ctx.register_table(
            "metrics",
            Arc::new(NewUnionTable::new(metrics_schema(), vec![])),
        )?;
        // An unprojected schema makes the timestamp filter compare Utf8View with Int64.
        let batches = ctx
            .sql("SELECT trace_stream, value FROM metrics WHERE _timestamp > 123")
            .await?
            .collect()
            .await?;
        assert_eq!(
            batches.iter().map(|batch| batch.num_rows()).sum::<usize>(),
            0
        );
        Ok(())
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
