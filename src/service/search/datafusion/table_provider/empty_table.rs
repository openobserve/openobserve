// Copyright 2024 Zinc Labs Inc.
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
    common::{project_schema, Result},
    datasource::{TableProvider, TableType},
    logical_expr::TableProviderFilterPushDown,
    physical_plan::ExecutionPlan,
    prelude::Expr,
};

use crate::service::search::datafusion::physical_plan::empty_exec::NewEmptyExec;

/// An empty plan that is useful for testing and generating plans
/// without mapping them to actual data.
pub struct NewEmptyTable {
    name: String,
    schema: SchemaRef,
    partitions: usize,
    sorted_by_time: bool,
}

impl NewEmptyTable {
    /// Initialize a new `EmptyTable` from a schema.
    pub fn new(name: &str, schema: SchemaRef, sorted_by_time: bool) -> Self {
        Self {
            name: name.to_string(),
            schema,
            partitions: 1,
            sorted_by_time,
        }
    }

    /// Creates a new EmptyTable with specified partition number.
    pub fn with_partitions(mut self, partitions: usize) -> Self {
        self.partitions = partitions;
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
        limit: Option<usize>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        // even though there is no data, projections apply
        let projected_schema = project_schema(&self.schema, projection)?;
        Ok(Arc::new(
            NewEmptyExec::new(
                &self.name,
                projected_schema,
                projection,
                filters,
                limit,
                self.sorted_by_time,
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
