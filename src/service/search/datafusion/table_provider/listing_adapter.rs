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

use arrow_schema::SchemaRef;
use config::{TIMESTAMP_COL_NAME, get_config};
use datafusion::{
    catalog::{Session, TableProvider, memory::DataSourceExec},
    common::Result,
    datasource::{
        TableType,
        listing::{ListingTable, ListingTableConfig},
        physical_plan::{FileGroup, FileScanConfig},
    },
    execution::cache::cache_manager::FileStatisticsCache,
    logical_expr::TableProviderFilterPushDown,
    physical_plan::ExecutionPlan,
    prelude::Expr,
};
use rayon::prelude::*;
use tonic::async_trait;

use crate::service::search::{
    datafusion::table_provider::helpers::{apply_combined_filter, generate_access_plan},
    index::IndexCondition,
};

#[derive(Debug)]
pub struct ListingTableAdapter {
    listing_table: ListingTable,
    trace_id: String,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
    timestamp_filter: Option<(i64, i64)>,
}

impl ListingTableAdapter {
    pub fn try_new(
        config: ListingTableConfig,
        trace_id: String,
        index_condition: Option<IndexCondition>,
        fst_fields: Vec<String>,
        timestamp_filter: Option<(i64, i64)>,
    ) -> Result<Self> {
        let listing_table = ListingTable::try_new(config)?;
        Ok(Self {
            listing_table,
            trace_id,
            index_condition,
            fst_fields,
            timestamp_filter,
        })
    }

    pub fn with_cache(mut self, cache: Option<Arc<dyn FileStatisticsCache>>) -> Self {
        self.listing_table = self.listing_table.with_cache(cache);
        self
    }
}

#[async_trait]
impl TableProvider for ListingTableAdapter {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.listing_table.schema())
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
        let (parquet_projection, filter_projection) =
            if self.index_condition.is_some() || self.timestamp_filter.is_some() {
                // get the projection for the filter
                let mut filter_projection = self
                    .index_condition
                    .as_ref()
                    .map(|ic| ic.get_schema_projection(self.schema(), &self.fst_fields))
                    .unwrap_or_default();

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
        let parquet_projection = parquet_projection.as_ref();
        let filter_projection = filter_projection.as_ref();

        let parquet_exec = self
            .listing_table
            .scan(state, parquet_projection, filters, limit)
            .await?;

        let reverse = !self.listing_table.options().file_sort_order.is_empty()
            && parquet_exec.properties().output_ordering().is_none();
        let parquet_exec = handler_tantivy_index(&self.trace_id, parquet_exec, reverse);

        // if the index condition can remove filter, we can skip the config
        // feature_query_remove_filter_with_index
        let can_remove_filter = self
            .index_condition
            .as_ref()
            .map(|v| v.can_remove_filter())
            .unwrap_or(true);
        let index_condition =
            if can_remove_filter || get_config().common.feature_query_remove_filter_with_index {
                self.index_condition.as_ref()
            } else {
                None
            };
        let plan = apply_combined_filter(
            index_condition,
            self.timestamp_filter,
            &parquet_exec.schema(),
            &self.fst_fields,
            parquet_exec,
            filter_projection,
        )?;

        if reverse {
            log::info!(
                "[trace_id {}] attempted to split file groups by statistics, but there were more file groups than target_partitions: {}; falling back to unordered",
                self.trace_id,
                state.config().target_partitions(),
            );
        }

        Ok(plan)
    }

    fn supports_filters_pushdown(
        &self,
        filters: &[&Expr],
    ) -> Result<Vec<TableProviderFilterPushDown>> {
        self.listing_table.supports_filters_pushdown(filters)
    }
}

fn handler_tantivy_index(
    trace_id: &str,
    plan: Arc<dyn ExecutionPlan>,
    reverse: bool,
) -> Arc<dyn ExecutionPlan> {
    if let Some(data_source_exec) = plan.as_any().downcast_ref::<DataSourceExec>()
        && let Some(config) = data_source_exec
            .data_source()
            .as_any()
            .downcast_ref::<FileScanConfig>()
    {
        let mut file_groups = config.file_groups.clone();

        if reverse {
            let new_file_groups = file_groups
                .into_iter()
                .map(|file_group| {
                    let mut files = file_group.into_inner();
                    files.reverse();
                    FileGroup::new(files)
                })
                .collect();
            file_groups = new_file_groups;
        }

        let start = std::time::Instant::now();
        let new_file_groups: Vec<_> = file_groups
            .into_par_iter()
            .map(|file_group| {
                let group: Vec<_> = file_group
                    .into_inner()
                    .into_iter()
                    .map(|mut file| {
                        if let Some(access_plan) = generate_access_plan(&file) {
                            file = file.with_extensions(access_plan);
                        }
                        file
                    })
                    .collect();
                // TODO: check if we need statistics for FileGroup
                // the statistics in FileGroup is used in ExecutionPlan::partition_statistics
                FileGroup::new(group)
            })
            .collect();

        let groups_len = new_file_groups.len();
        let max_group_len = new_file_groups.iter().map(|g| g.len()).max().unwrap_or(0);
        let files_nums = new_file_groups.iter().map(|g| g.len()).sum::<usize>();

        log::info!(
            "[trace_id {trace_id}] listing table adapter, file groups: {groups_len}, max group len: {max_group_len}, total files: {files_nums}, took: {} ms",
            start.elapsed().as_millis() as usize,
        );

        let mut config = config.clone();
        config.file_groups = new_file_groups;
        let plan = Arc::new(DataSourceExec::new(Arc::new(config)));
        return plan;
    }
    plan
}
