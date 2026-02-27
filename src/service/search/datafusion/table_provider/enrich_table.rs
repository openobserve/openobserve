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

use std::{any::Any, sync::Arc};

use async_trait::async_trait;
use config::TIMESTAMP_COL_NAME;
use datafusion::{
    arrow::datatypes::SchemaRef,
    catalog::Session,
    common::{Result, project_schema},
    datasource::{TableProvider, TableType},
    logical_expr::TableProviderFilterPushDown,
    physical_plan::ExecutionPlan,
    prelude::Expr,
    sql::TableReference,
};

use crate::service::search::datafusion::{
    distributed_plan::enrich_exec::EnrichExec, table_provider::helpers::apply_combined_filter,
};

/// An enrich table that is used for loading enrichment data from database.
#[derive(Debug, Clone)]
pub struct EnrichTable {
    org_id: String,
    stream: TableReference,
    schema: SchemaRef,
    timestamp_filter: Option<(i64, i64)>,
}

impl EnrichTable {
    /// Initialize a new `EnrichTable` from a schema.
    pub fn new(
        org_id: &str,
        stream: &TableReference,
        schema: SchemaRef,
        time_range: (i64, i64),
    ) -> Self {
        let timestamp_filter = if let Some(schema) = stream.schema()
            && (schema == "enrich" || schema == "enrichment_tables")
        {
            None
        } else {
            Some(time_range)
        };
        Self {
            org_id: org_id.to_string(),
            stream: stream.clone(),
            schema,
            timestamp_filter,
        }
    }
}

#[async_trait]
impl TableProvider for EnrichTable {
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
        _filters: &[Expr],
        _limit: Option<usize>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let (enrich_projection, filter_projection) = if self.timestamp_filter.is_some() {
            let mut filter_projection = Vec::new();
            // add _timestamp column if timestamp_filter is present
            if self.timestamp_filter.is_some()
                && let Ok(timestamp_idx) = self.schema().index_of(TIMESTAMP_COL_NAME)
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
        } else {
            (projection.cloned(), None)
        };

        let enrich_projection = enrich_projection.as_ref();
        let filter_projection = filter_projection.as_ref();

        // Create the base execution plan
        let schema = project_schema(&self.schema, enrich_projection)?;
        let enrich_exec = Arc::new(EnrichExec::new(&self.org_id, self.stream.table(), schema));

        // Apply timestamp filter only (no index condition for enrich tables)
        let filter_exec = apply_combined_filter(
            None,
            self.timestamp_filter,
            &enrich_exec.schema(),
            &[],
            enrich_exec,
            filter_projection,
        )?;

        Ok(filter_exec)
    }

    fn supports_filters_pushdown(
        &self,
        filters: &[&Expr],
    ) -> Result<Vec<TableProviderFilterPushDown>> {
        Ok(vec![TableProviderFilterPushDown::Inexact; filters.len()])
    }
}
