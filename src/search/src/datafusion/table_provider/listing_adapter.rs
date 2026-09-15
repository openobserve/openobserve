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
    catalog::{Session, TableProvider},
    common::{Result, exec_datafusion_err, plan_err},
    datasource::{
        TableType,
        listing::{ListingTable, ListingTableConfig},
        physical_plan::{FileGroup, FileScanConfig},
    },
    execution::{SessionState, cache::cache_manager::FileStatisticsCache},
    logical_expr::TableProviderFilterPushDown,
    physical_plan::ExecutionPlan,
    prelude::Expr,
};
use tonic::async_trait;

use crate::{
    datafusion::{
        sort_order::FileSortOrder,
        table_provider::{
            helpers::{apply_combined_filter, file_scan_config, with_access_plans},
            metrics::{handler_metrics_scan, hash_interval},
        },
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
    target_partitions: usize,
}

impl ListingTableAdapter {
    pub fn try_new(
        config: ListingTableConfig,
        trace_id: String,
        sort_order: FileSortOrder,
        index_condition: Option<IndexCondition>,
        fst_fields: Vec<String>,
        timestamp_filter: Option<(i64, i64)>,
        target_partitions: usize,
    ) -> Result<Self> {
        if target_partitions == 0 {
            return plan_err!("ListingTableAdapter requires target_partitions greater than zero");
        }
        let listing_table = ListingTable::try_new(config)?;
        Ok(Self {
            listing_table,
            trace_id,
            sort_order,
            index_condition,
            fst_fields,
            timestamp_filter,
            target_partitions,
        })
    }

    pub fn with_cache(mut self, cache: Option<Arc<FileStatisticsCache>>) -> Self {
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
        // Each table keeps its scan budget without changing the shared query session.
        let mut scan_state = state
            .as_any()
            .downcast_ref::<SessionState>()
            .ok_or_else(|| exec_datafusion_err!("ListingTableAdapter requires a SessionState"))?
            .clone();
        scan_state
            .config_mut()
            .options_mut()
            .execution
            .target_partitions = self.target_partitions;
        let state: &dyn Session = &scan_state;

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

        let target_partitions = self.target_partitions;
        let parquet_exec = match hash_interval(filters) {
            Some(hash_range) if self.sort_order.is_sorted() => handler_metrics_scan(
                &self.trace_id,
                parquet_exec,
                self.sort_order,
                hash_range,
                target_partitions,
            ),
            _ => {
                // The files are sorted but DataFusion dropped the ordering (overlapping
                // files in one group): regroup them by statistics ourselves.
                let regroup_order = (self.sort_order.is_sorted()
                    && parquet_exec.properties().output_ordering().is_none())
                .then_some(self.sort_order);
                handler_tantivy_index(
                    &self.trace_id,
                    state,
                    parquet_exec,
                    regroup_order,
                    target_partitions,
                )
            }
        };

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
    let Some(config) = file_scan_config(&plan) else {
        return plan;
    };
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

    let mut plan = with_access_plans(trace_id, config, file_groups, target_partitions);
    // skip repartitioning when the files were regrouped by statistics: the
    // groups already carry the ordering and there are plenty of them
    if regroup_order.is_none()
        && let Ok(Some(repartition_plan)) =
            plan.repartitioned(target_partitions, state.config_options())
    {
        plan = repartition_plan;
    }
    plan
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Float64Array, Int64Array, RecordBatch, UInt64Array};
    use arrow_schema::{DataType, Field, Schema};
    use config::{FileFormat, meta::promql::HASH_LABEL};
    use datafusion::{
        datasource::{
            file_format::{FileFormat as DataFusionFileFormat, parquet::ParquetFormat},
            listing::{ListingOptions, ListingTableUrl},
        },
        physical_plan::{collect, displayable},
    };
    use parquet::arrow::ArrowWriter;
    use vortex::{
        VortexSessionDefault, array::ArrayRef, arrow::ArrowSessionExt, file::VortexWriteOptions,
        io::session::RuntimeSessionExt, session::VortexSession,
    };
    use vortex_datafusion::VortexFormat;

    use super::*;
    use crate::datafusion::exec::DataFusionContextBuilder;

    fn hash_sorted_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
        ]))
    }

    #[tokio::test]
    async fn test_scan_prunes_files_outside_hash_interval() {
        let dir = tempfile::tempdir().unwrap();
        write_hash_sorted_file(
            dir.path(),
            "a.parquet",
            &[(1, 10), (3, 20)],
            FileFormat::Parquet,
        )
        .await;
        write_hash_sorted_file(
            dir.path(),
            "b.parquet",
            &[(5, 10), (7, 20)],
            FileFormat::Parquet,
        )
        .await;
        write_hash_sorted_file(
            dir.path(),
            "c.parquet",
            &[(9, 10), (11, 20)],
            FileFormat::Parquet,
        )
        .await;

        let sort_order = FileSortOrder::HashTimestampAsc;
        let ctx = DataFusionContextBuilder::new()
            .trace_id("test_hash_prune")
            .sort_order(sort_order)
            .build(2)
            .await
            .unwrap();
        let listing_options = ListingOptions::new(Arc::new(ParquetFormat::default()))
            .with_file_sort_order(vec![sort_order.logical_sort_exprs()]);
        let url = ListingTableUrl::parse(format!("file://{}/", dir.path().display())).unwrap();
        let config = ListingTableConfig::new(url)
            .with_listing_options(listing_options)
            .with_schema(hash_sorted_schema());
        let table = ListingTableAdapter::try_new(
            config,
            "test_hash_prune".to_string(),
            sort_order,
            None,
            vec![],
            None,
            2,
        )
        .unwrap();
        ctx.register_table("t", Arc::new(table)).unwrap();

        let plan = ctx
            .state()
            .create_logical_plan(&format!(
                "SELECT * FROM t WHERE {HASH_LABEL} >= 5 AND {HASH_LABEL} <= 7 ORDER BY {}",
                sort_order.order_by_clause().unwrap()
            ))
            .await
            .unwrap();
        let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();
        let display = displayable(physical_plan.as_ref()).indent(true).to_string();
        assert!(
            display.contains("b.parquet") && !display.contains("a.parquet"),
            "expected only the intersecting file in the scan, got:\n{display}"
        );
        assert!(!display.contains("c.parquet"), "got:\n{display}");

        let batches = collect(physical_plan, ctx.task_ctx()).await.unwrap();
        let hashes: Vec<u64> = batches
            .iter()
            .flat_map(|batch| {
                batch
                    .column(0)
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap()
                    .values()
                    .to_vec()
            })
            .collect();
        assert_eq!(hashes, vec![5, 7]);
    }

    /// Write one file whose rows are ordered by (__hash__, _timestamp).
    async fn write_hash_sorted_file(
        dir: &std::path::Path,
        name: &str,
        rows: &[(u64, i64)],
        file_format: FileFormat,
    ) {
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
        match file_format {
            FileFormat::Parquet => {
                let file = std::fs::File::create(dir.join(name)).unwrap();
                let mut writer = ArrowWriter::try_new(file, schema, None).unwrap();
                writer.write(&batch).unwrap();
                writer.close().unwrap();
            }
            FileFormat::Vortex => {
                let session = VortexSession::default().with_tokio();
                let mut buf = Vec::new();
                let mut writer = VortexWriteOptions::new(session.clone()).writer(
                    &mut buf,
                    session.arrow().from_arrow_schema(schema.as_ref()).unwrap(),
                );
                let array: ArrayRef = session
                    .arrow()
                    .from_arrow_record_batch(batch, schema.as_ref())
                    .unwrap();
                writer.push(array).await.unwrap();
                writer.finish().await.unwrap();
                std::fs::write(dir.join(name), buf).unwrap();
            }
        }
    }

    /// Hash-sorted files with overlapping hash ranges (every ingester file
    /// covers the whole hash space) must still yield an ordered scan: one file
    /// per partition, merged by SortPreservingMergeExec without a SortExec.
    #[tokio::test]
    async fn test_hash_sorted_files_merge_without_sort_exec() {
        for file_format in [FileFormat::Parquet, FileFormat::Vortex] {
            assert_hash_sorted_files_merge_without_sort_exec(file_format).await;
        }
    }

    async fn assert_hash_sorted_files_merge_without_sort_exec(file_format: FileFormat) {
        let dir = tempfile::tempdir().unwrap();
        write_hash_sorted_file(
            dir.path(),
            &format!("a{}", file_format.extension()),
            &[(1, 10), (1, 30), (5, 10), (9, 20)],
            file_format,
        )
        .await;
        write_hash_sorted_file(
            dir.path(),
            &format!("b{}", file_format.extension()),
            &[(1, 20), (2, 10), (9, 10)],
            file_format,
        )
        .await;
        write_hash_sorted_file(
            dir.path(),
            &format!("c{}", file_format.extension()),
            &[(3, 10), (5, 5), (5, 20)],
            file_format,
        )
        .await;

        let sort_order = FileSortOrder::HashTimestampAsc;
        let ctx = DataFusionContextBuilder::new()
            .trace_id("test_hash_sorted_merge")
            .sort_order(sort_order)
            .build(2)
            .await
            .unwrap();

        let datafusion_file_format: Arc<dyn DataFusionFileFormat> = match file_format {
            FileFormat::Parquet => Arc::new(ParquetFormat::default()),
            FileFormat::Vortex => {
                Arc::new(VortexFormat::new(VortexSession::default().with_tokio()))
            }
        };
        let listing_options = ListingOptions::new(datafusion_file_format)
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
            2,
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
            "expected a merge of pre-sorted {file_format} partitions, got:\n{display}"
        );
        assert!(
            !display.contains("SortExec"),
            "hash-sorted {file_format} inputs must not be re-sorted, got:\n{display}"
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

    // Utf8-typed vortex min with max dropped used to panic FilterExec interval analysis on a
    // Utf8View schema
    #[tokio::test]
    async fn test_vortex_utf8view_stats_plan_and_scan() {
        use arrow::array::StringArray;

        let dir = tempfile::tempdir().unwrap();
        let file_schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("name", DataType::Utf8, true),
        ]));
        let batch1 = RecordBatch::try_new(
            file_schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1i64, 2, 3])),
                Arc::new(StringArray::from(vec![Some("a"), Some("b"), Some("c")])),
            ],
        )
        .unwrap();
        // chunk with the string column entirely null: file-level Max is skipped
        let batch2 = RecordBatch::try_new(
            file_schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![4i64, 5, 6])),
                Arc::new(StringArray::from(vec![None::<&str>, None, None])),
            ],
        )
        .unwrap();

        let session = VortexSession::default().with_tokio();
        let mut buf = Vec::new();
        let mut writer = VortexWriteOptions::new(session.clone()).writer(
            &mut buf,
            session
                .arrow()
                .from_arrow_schema(file_schema.as_ref())
                .unwrap(),
        );
        writer
            .push(
                session
                    .arrow()
                    .from_arrow_record_batch(batch1, file_schema.as_ref())
                    .unwrap(),
            )
            .await
            .unwrap();
        writer
            .push(
                session
                    .arrow()
                    .from_arrow_record_batch(batch2, file_schema.as_ref())
                    .unwrap(),
            )
            .await
            .unwrap();
        writer.finish().await.unwrap();
        std::fs::write(dir.path().join("a.vortex"), buf).unwrap();

        // table schema the way finalize_schemas produces it: Utf8 -> Utf8View
        let table_schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("name", DataType::Utf8View, true),
        ]));

        let ctx = DataFusionContextBuilder::new()
            .trace_id("test_vortex_utf8view_stats")
            .build(2)
            .await
            .unwrap();
        let format: Arc<dyn DataFusionFileFormat> =
            Arc::new(VortexFormat::new(VortexSession::default().with_tokio()));
        let listing_options = ListingOptions::new(format);
        let url = ListingTableUrl::parse(format!("file://{}/", dir.path().display())).unwrap();
        let config = ListingTableConfig::new(url)
            .with_listing_options(listing_options)
            .with_schema(table_schema);
        let table = ListingTableAdapter::try_new(
            config,
            "test_vortex_utf8view_stats".to_string(),
            FileSortOrder::None,
            None,
            vec![],
            None,
            2,
        )
        .unwrap();
        ctx.register_table("t", Arc::new(table)).unwrap();

        let plan = ctx
            .state()
            .create_logical_plan(
                "SELECT count(name) FROM t WHERE _timestamp >= 1 AND _timestamp < 100",
            )
            .await
            .unwrap();
        let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();
        let batches = collect(physical_plan, ctx.task_ctx()).await.unwrap();
        let counts = batches
            .iter()
            .flat_map(|b| {
                let col = b.column(0).as_any().downcast_ref::<Int64Array>().unwrap();
                (0..b.num_rows()).map(|i| col.value(i)).collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        assert_eq!(counts, vec![3]);
    }

    #[tokio::test]
    async fn test_table_scan_partitions_are_independent_of_session() {
        use datafusion::{
            physical_plan::ExecutionPlanProperties,
            prelude::{SessionConfig, SessionContext},
        };

        use crate::datafusion::table_provider::uniontable::NewUnionTable;

        let ctx = SessionContext::new_with_config(
            SessionConfig::new()
                .with_target_partitions(2)
                .with_repartition_file_scans(false),
        );
        let state = ctx.state();
        for format in [FileFormat::Parquet, FileFormat::Vortex] {
            let dir = tempfile::tempdir().unwrap();
            for index in 0..8 {
                write_hash_sorted_file(
                    dir.path(),
                    &format!("{index}{}", format.extension()),
                    &[(index, 10), (index, 20)],
                    format,
                )
                .await;
            }
            for sort_order in [FileSortOrder::None, FileSortOrder::HashTimestampAsc] {
                let mut tables: Vec<Arc<dyn TableProvider>> = Vec::new();
                for target in [1, 8] {
                    let file_format: Arc<dyn DataFusionFileFormat> = match format {
                        FileFormat::Parquet => Arc::new(ParquetFormat::default()),
                        FileFormat::Vortex => {
                            Arc::new(VortexFormat::new(VortexSession::default().with_tokio()))
                        }
                    };
                    let mut options =
                        ListingOptions::new(file_format).with_file_extension(format.extension());
                    if sort_order.is_sorted() {
                        options =
                            options.with_file_sort_order(vec![sort_order.logical_sort_exprs()]);
                    }
                    let config = ListingTableConfig::new(
                        ListingTableUrl::parse(dir.path().to_str().unwrap()).unwrap(),
                    )
                    .with_listing_options(options)
                    .with_schema(hash_sorted_schema());
                    let table = Arc::new(
                        ListingTableAdapter::try_new(
                            config,
                            "scan-budget".to_string(),
                            sort_order,
                            None,
                            vec![],
                            None,
                            target,
                        )
                        .unwrap(),
                    );
                    let scan = table.scan(&state, None, &[], None).await.unwrap();
                    assert_eq!(
                        scan.output_partitioning().partition_count(),
                        target,
                        "format={format:?}, sort_order={sort_order:?}"
                    );
                    if sort_order.is_sorted() {
                        assert!(scan.properties().output_ordering().is_some());
                    }
                    let batches = collect(scan, ctx.task_ctx()).await.unwrap();
                    assert_eq!(batches.iter().map(RecordBatch::num_rows).sum::<usize>(), 16);
                    assert_eq!(state.config().target_partitions(), 2);
                    tables.push(table);
                }
                let union = NewUnionTable::new(hash_sorted_schema(), tables);
                let scan = union.scan(&state, None, &[], None).await.unwrap();
                assert_eq!(scan.output_partitioning().partition_count(), 9);
                let batches = collect(scan, ctx.task_ctx()).await.unwrap();
                assert_eq!(batches.iter().map(RecordBatch::num_rows).sum::<usize>(), 32);
                assert_eq!(ctx.state().config().target_partitions(), 2);
            }
        }
    }
}
