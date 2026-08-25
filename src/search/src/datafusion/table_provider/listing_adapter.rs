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

use crate::{
    datafusion::{
        sort_order::FileSortOrder,
        table_provider::helpers::{apply_combined_filter, generate_access_plan},
    },
    index::IndexCondition,
};

#[derive(Debug)]
pub struct ListingTableAdapter {
    listing_table: ListingTable,
    trace_id: String,
    /// Physical sort order of the files. Must match the `file_sort_order` set on
    /// the listing options; it is used to regroup files by statistics when
    /// DataFusion could not prove the ordering itself.
    sort_order: FileSortOrder,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
    timestamp_filter: Option<(i64, i64)>,
}

impl ListingTableAdapter {
    pub fn try_new(
        config: ListingTableConfig,
        trace_id: String,
        sort_order: FileSortOrder,
        index_condition: Option<IndexCondition>,
        fst_fields: Vec<String>,
        timestamp_filter: Option<(i64, i64)>,
    ) -> Result<Self> {
        let listing_table = ListingTable::try_new(config)?;
        Ok(Self {
            listing_table,
            trace_id,
            sort_order,
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

        // The files are sorted but DataFusion dropped the ordering (overlapping
        // files in one group): regroup them by statistics ourselves.
        let regroup_order = (self.sort_order.is_sorted()
            && parquet_exec.properties().output_ordering().is_none())
        .then_some(self.sort_order);
        let target_partitions = self.listing_table.options().target_partitions;
        let parquet_exec = handler_tantivy_index(
            &self.trace_id,
            state,
            parquet_exec,
            regroup_order,
            target_partitions,
        );

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
        let plan = apply_combined_filter(
            index_condition,
            self.timestamp_filter,
            &parquet_exec.schema(),
            &self.fst_fields,
            parquet_exec,
            filter_projection,
        )?;

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
    state: &dyn Session,
    plan: Arc<dyn ExecutionPlan>,
    regroup_order: Option<FileSortOrder>,
    target_partitions: usize,
) -> Arc<dyn ExecutionPlan> {
    if let Some(data_source_exec) = plan.downcast_ref::<DataSourceExec>()
        && let Some(config) = data_source_exec
            .data_source()
            .downcast_ref::<FileScanConfig>()
    {
        let mut file_groups = config.file_groups.clone();

        if let Some(sort_order) = regroup_order {
            let schema = config.file_source().table_schema().table_schema();
            match sort_order.physical_ordering(schema) {
                Some(ordering) => {
                    match FileScanConfig::split_groups_by_statistics_with_target_partitions(
                        schema,
                        &file_groups,
                        &ordering,
                        target_partitions,
                    ) {
                        Ok(new_file_groups) => {
                            file_groups = new_file_groups;
                        }
                        Err(e) if sort_order.is_timestamp_desc() => {
                            // files are listed oldest first; reversing each group
                            // is the best effort approximation of `_timestamp DESC`
                            log::warn!(
                                "[trace_id {trace_id}] failed to split file groups by statistics: {e}, falling back to reversing file groups"
                            );
                            file_groups = file_groups
                                .into_iter()
                                .map(|file_group| {
                                    let mut files = file_group.into_inner();
                                    files.reverse();
                                    FileGroup::new(files)
                                })
                                .collect();
                        }
                        Err(e) => {
                            log::warn!(
                                "[trace_id {trace_id}] failed to split file groups by statistics for {sort_order}: {e}, keeping file groups as is"
                            );
                        }
                    }
                }
                None => {
                    log::warn!(
                        "[trace_id {trace_id}] sort columns of {sort_order} not found in schema, skipping split_groups_by_statistics"
                    );
                }
            }
        }

        let start = std::time::Instant::now();
        let new_file_groups: Vec<_> = file_groups
            .into_par_iter()
            .map(|file_group| {
                let group: Vec<_> = file_group
                    .into_inner()
                    .into_iter()
                    .map(|mut file| {
                        generate_access_plan(&mut file);
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
            "[trace_id {trace_id}] listing table adapter, target_partitions: {target_partitions}, file groups: {groups_len}, max group len: {max_group_len}, total files: {files_nums}, took: {} ms",
            start.elapsed().as_millis() as usize,
        );

        let mut config = config.clone();
        config.file_groups = new_file_groups;
        let mut plan = Arc::new(DataSourceExec::new(Arc::new(config))) as Arc<dyn ExecutionPlan>;
        // skip repartitioning when the files were regrouped by statistics: the
        // groups already carry the ordering and there are plenty of them
        if regroup_order.is_none()
            && let Ok(Some(repartition_plan)) =
                plan.repartitioned(target_partitions, state.config_options())
        {
            plan = repartition_plan;
        }
        return plan;
    }
    plan
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Float64Array, Int64Array, RecordBatch, UInt64Array};
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::promql::HASH_LABEL;
    use datafusion::{
        datasource::{
            file_format::parquet::ParquetFormat,
            listing::{ListingOptions, ListingTableUrl},
        },
        physical_plan::{collect, displayable},
    };
    use parquet::arrow::ArrowWriter;

    use super::*;
    use crate::datafusion::exec::DataFusionContextBuilder;

    fn hash_sorted_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
        ]))
    }

    /// Write one Parquet file whose rows are ordered by (__hash__, _timestamp).
    fn write_hash_sorted_file(dir: &std::path::Path, name: &str, rows: &[(u64, i64)]) {
        let schema = hash_sorted_schema();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(UInt64Array::from_iter_values(rows.iter().map(|r| r.0))),
                Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.1))),
                Arc::new(Float64Array::from_iter_values(
                    rows.iter().map(|r| r.0 as f64),
                )),
            ],
        )
        .unwrap();
        let file = std::fs::File::create(dir.join(name)).unwrap();
        let mut writer = ArrowWriter::try_new(file, schema, None).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();
    }

    /// Hash-sorted files with overlapping hash ranges (every ingester file
    /// covers the whole hash space) must still yield an ordered scan: one file
    /// per partition, merged by SortPreservingMergeExec without a SortExec.
    #[tokio::test]
    async fn test_hash_sorted_files_merge_without_sort_exec() {
        let dir = tempfile::tempdir().unwrap();
        write_hash_sorted_file(
            dir.path(),
            "a.parquet",
            &[(1, 10), (1, 30), (5, 10), (9, 20)],
        );
        write_hash_sorted_file(dir.path(), "b.parquet", &[(1, 20), (2, 10), (9, 10)]);
        write_hash_sorted_file(dir.path(), "c.parquet", &[(3, 10), (5, 5), (5, 20)]);

        let sort_order = FileSortOrder::HashTimestampAsc;
        let ctx = DataFusionContextBuilder::new()
            .trace_id("test_hash_sorted_merge")
            .sort_order(sort_order)
            .build(2)
            .await
            .unwrap();

        let listing_options = ListingOptions::new(Arc::new(ParquetFormat::default()))
            .with_target_partitions(2)
            .with_collect_stat(true)
            .with_file_sort_order(vec![sort_order.logical_sort_exprs()]);
        let url = ListingTableUrl::parse(format!("file://{}/", dir.path().display())).unwrap();
        let config = ListingTableConfig::new(url)
            .with_listing_options(listing_options)
            .with_schema(hash_sorted_schema());
        let table = ListingTableAdapter::try_new(
            config,
            "test_hash_sorted_merge".to_string(),
            sort_order,
            None,
            vec![],
            None,
        )
        .unwrap();
        ctx.register_table("t", Arc::new(table)).unwrap();

        let plan = ctx
            .state()
            .create_logical_plan(&format!(
                "SELECT * FROM t ORDER BY {}",
                sort_order.order_by_clause().unwrap()
            ))
            .await
            .unwrap();
        let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();
        let display = displayable(physical_plan.as_ref()).indent(true).to_string();
        assert!(
            display.contains("SortPreservingMergeExec"),
            "expected a merge of pre-sorted partitions, got:\n{display}"
        );
        assert!(
            !display.contains("SortExec"),
            "hash-sorted inputs must not be re-sorted, got:\n{display}"
        );

        let batches = collect(physical_plan, ctx.task_ctx()).await.unwrap();
        let mut rows = Vec::new();
        for batch in &batches {
            let hashes = batch
                .column(0)
                .as_any()
                .downcast_ref::<UInt64Array>()
                .unwrap();
            let ts = batch
                .column(1)
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap();
            for i in 0..batch.num_rows() {
                rows.push((hashes.value(i), ts.value(i)));
            }
        }
        let mut expected = vec![
            (1, 10),
            (1, 30),
            (5, 10),
            (9, 20),
            (1, 20),
            (2, 10),
            (9, 10),
            (3, 10),
            (5, 5),
            (5, 20),
        ];
        expected.sort();
        assert_eq!(rows, expected);
    }
}
