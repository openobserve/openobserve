// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

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

use std::{any::Any, cmp::Ordering, sync::Arc};

use arrow_schema::{DataType, Field, Schema, SchemaBuilder, SchemaRef, SortOptions};
use async_trait::async_trait;
use config::get_config;
use datafusion::{
    catalog::{Session, memory::DataSourceExec},
    common::{Result, Statistics, ToDFSchema, plan_err, project_schema, stats::Precision},
    datasource::{
        TableProvider,
        file_format::parquet::ParquetFormat,
        listing::{ListingOptions, ListingTableConfig, ListingTableUrl, PartitionedFile},
        physical_plan::{FileGroup, FileScanConfig, FileScanConfigBuilder, ParquetSource},
    },
    error::DataFusionError,
    execution::{
        cache::{cache_manager::FileStatisticsCache, cache_unit::DefaultFileStatisticsCache},
        context::SessionState,
    },
    logical_expr::{Expr, SortExpr, TableProviderFilterPushDown, TableType, utils::conjunction},
    physical_expr::{LexOrdering, PhysicalSortExpr, create_physical_expr, expressions},
    physical_plan::{ExecutionPlan, PhysicalExpr, empty::EmptyExec},
};
use futures::{
    Stream, StreamExt,
    future::{self, try_join_all},
    stream,
};
use hashbrown::HashMap;
use helpers::*;
use object_store::ObjectStore;
use parquet_reader::NewParquetFileReaderFactory;
use tokio::sync::Semaphore;

use crate::service::search::index::IndexCondition;

pub mod catalog;
pub mod empty_table;
pub mod enrich_table;
mod helpers;
pub mod memtable;
mod parquet_reader;
pub mod uniontable;

#[derive(Debug)]
pub(crate) struct NewListingTable {
    table_paths: Vec<ListingTableUrl>,
    /// File fields only
    file_schema: SchemaRef,
    /// File fields + partition columns
    table_schema: SchemaRef,
    diff_rules: HashMap<String, DataType>,
    options: ListingOptions,
    collected_statistics: FileStatisticsCache,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
    need_optimize_partition: bool,
}

impl NewListingTable {
    /// Create new [`ListingTable`] that lists the FS to get the files
    /// to scan. See [`ListingTable`] for and example.
    ///
    /// Takes a `ListingTableConfig` as input which requires an `ObjectStore` and `table_path`.
    /// `ListingOptions` and `SchemaRef` are optional.  If they are not
    /// provided the file type is inferred based on the file suffix.
    /// If the schema is provided then it must be resolved before creating the table
    /// and should contain the fields of the file without the table
    /// partitioning columns.
    pub fn try_new(
        config: ListingTableConfig,
        rules: HashMap<String, DataType>,
        index_condition: Option<IndexCondition>,
        fst_fields: Vec<String>,
        need_optimize_partition: bool,
    ) -> Result<Self> {
        let file_schema = config
            .file_schema
            .ok_or_else(|| DataFusionError::Internal("No schema provided.".into()))?;

        let options = config
            .options
            .ok_or_else(|| DataFusionError::Internal("No ListingOptions provided".into()))?;

        // Add the partition columns to the file schema
        let mut builder = SchemaBuilder::from(file_schema.as_ref().to_owned());
        for (part_col_name, part_col_type) in &options.table_partition_cols {
            builder.push(Field::new(part_col_name, part_col_type.clone(), false));
        }

        let table = Self {
            table_paths: config.table_paths,
            file_schema,
            table_schema: Arc::new(builder.finish()),
            diff_rules: rules,
            options,
            collected_statistics: Arc::new(DefaultFileStatisticsCache::default()),
            index_condition,
            fst_fields,
            need_optimize_partition,
        };

        Ok(table)
    }

    /// Set the [`FileStatisticsCache`] used to cache parquet file statistics.
    ///
    /// Setting a statistics cache on the `SessionContext` can avoid refetching statistics
    /// multiple times in the same session.
    ///
    /// If `None`, creates a new [`DefaultFileStatisticsCache`] scoped to this query.
    pub fn with_cache(mut self, cache: Option<FileStatisticsCache>) -> Self {
        self.collected_statistics =
            cache.unwrap_or(Arc::new(DefaultFileStatisticsCache::default()));
        self
    }

    /// If file_sort_order is specified, creates the appropriate physical expressions
    fn try_create_output_ordering(&self) -> Result<Vec<LexOrdering>> {
        create_ordering(&self.table_schema, &self.options.file_sort_order)
    }

    /// Get the list of files for a scan as well as the file level statistics.
    /// The list is grouped to let the execution plan know how the files should
    /// be distributed to different threads / executors.
    async fn list_files_for_scan<'a>(
        &'a self,
        ctx: &'a SessionState,
        limit: Option<usize>,
    ) -> Result<(Vec<FileGroup>, Statistics)> {
        let store = if let Some(url) = self.table_paths.first() {
            ctx.runtime_env().object_store(url)?
        } else {
            return Ok((vec![], Statistics::new_unknown(&self.file_schema)));
        };
        // list files
        let file_list = future::try_join_all(
            self.table_paths
                .iter()
                .map(|table_path| list_files(store.as_ref(), table_path)),
        )
        .await?;
        let file_list = stream::iter(file_list).flatten();
        // collect the statistics if required by the config
        let files = file_list
            .map(|part_file| async {
                let part_file = part_file?;
                let statistics = if self.options.collect_stat {
                    self.do_collect_statistics(ctx, &store, &part_file).await?
                } else {
                    Arc::new(Statistics::new_unknown(&self.file_schema))
                };
                Ok(part_file.with_statistics(statistics))
            })
            .boxed()
            .buffer_unordered(ctx.config_options().execution.meta_fetch_concurrency);

        let (file_group, inexact_stats) =
            get_files_with_limit(files, limit, self.options.collect_stat).await?;

        let semaphore = std::sync::Arc::new(Semaphore::new(get_config().limit.cpu_num));
        let mut tasks = Vec::with_capacity(file_group.files().len());
        for mut file in file_group.into_inner().into_iter() {
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let task = tokio::task::spawn(async move {
                let access_plan = generate_access_plan(&file);
                if let Some(access_plan) = access_plan {
                    file.extensions = Some(access_plan as _);
                }
                drop(permit);
                file
            });
            tasks.push(task)
        }
        let files = try_join_all(tasks)
            .await
            .map_err(|e| DataFusionError::External(Box::new(e)))?;

        let file_group = FileGroup::new(files);
        let file_groups = file_group.split_files(self.options.target_partitions);
        let (file, stats) = compute_all_files_statistics(
            file_groups,
            self.schema(),
            self.options.collect_stat,
            inexact_stats,
        )?;

        Ok((file, stats))
    }

    /// Collects statistics for a given partitioned file.
    ///
    /// This method first checks if the statistics for the given file are already cached.
    /// If they are, it returns the cached statistics.
    /// If they are not, it infers the statistics from the file and stores them in the cache.
    async fn do_collect_statistics(
        &self,
        ctx: &dyn Session,
        store: &Arc<dyn ObjectStore>,
        part_file: &PartitionedFile,
    ) -> Result<Arc<Statistics>> {
        match self
            .collected_statistics
            .get_with_extra(&part_file.object_meta.location, &part_file.object_meta)
        {
            Some(statistics) => Ok(statistics),
            None => {
                let statistics = self
                    .options
                    .format
                    .infer_stats(
                        ctx,
                        store,
                        Arc::clone(&self.file_schema),
                        &part_file.object_meta,
                    )
                    .await
                    .map_err(|e| {
                        log::error!(
                            "Failed to infer stats for file: {}, error: {}",
                            part_file.object_meta.location,
                            e
                        );
                        e
                    })?;
                let statistics = Arc::new(statistics);
                self.collected_statistics.put_with_extra(
                    &part_file.object_meta.location,
                    Arc::clone(&statistics),
                    &part_file.object_meta,
                );
                Ok(statistics)
            }
        }
    }

    async fn create_physical_plan(
        &self,
        state: &SessionState,
        conf: FileScanConfig,
        filters: Option<&Arc<dyn PhysicalExpr>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let Some(parquet) = self.options.format.as_any().downcast_ref::<ParquetFormat>() else {
            return plan_err!("ParquetFormat not found");
        };

        let mut predicate = None;
        let mut metadata_size_hint = None;

        // If enable pruning then combine the filters to build the predicate.
        // If disable pruning then set the predicate to None, thus readers
        // will not prune data based on the statistics.
        if parquet.enable_pruning()
            && let Some(pred) = filters.cloned()
        {
            predicate = Some(pred);
        }
        if let Some(metadata) = parquet.metadata_size_hint() {
            metadata_size_hint = Some(metadata);
        }

        let mut source = ParquetSource::new(parquet.options().clone());

        let store = state.runtime_env().object_store(&conf.object_store_url)?;
        source = source
            .with_parquet_file_reader_factory(Arc::new(NewParquetFileReaderFactory::new(store)));
        if let Some(predicate) = predicate {
            source = source.with_predicate(predicate);
        }
        if let Some(metadata_size_hint) = metadata_size_hint {
            source = source.with_metadata_size_hint(metadata_size_hint)
        }

        let conf = FileScanConfigBuilder::from(conf).with_source(Arc::new(source));
        Ok(DataSourceExec::from_data_source(conf.build()))
    }
}

#[async_trait]
impl TableProvider for NewListingTable {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.table_schema)
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
        // TODO (https://github.com/apache/datafusion/issues/11600) remove downcast_ref from here?
        let session_state = state.as_any().downcast_ref::<SessionState>().unwrap();
        let (mut partitioned_file_lists, statistics) =
            self.list_files_for_scan(session_state, limit).await?;

        let projected_schema = project_schema(&self.schema(), projection)?;

        // if no files need to be read, return an `EmptyExec`
        if partitioned_file_lists.is_empty() {
            return Ok(Arc::new(EmptyExec::new(projected_schema)));
        }

        let output_ordering = self.try_create_output_ordering()?;
        match state
            .config_options()
            .execution
            .split_file_groups_by_statistics
            .then(|| {
                output_ordering.first().map(|output_ordering| {
                    FileScanConfig::split_groups_by_statistics(
                        &self.table_schema,
                        &partitioned_file_lists,
                        output_ordering,
                    )
                })
            })
            .flatten()
        {
            Some(Err(e)) => log::debug!("failed to split file groups by statistics: {e}"),
            Some(Ok(new_groups)) => match self.options.target_partitions.cmp(&new_groups.len()) {
                Ordering::Equal => {
                    partitioned_file_lists = new_groups;
                }
                Ordering::Greater => {
                    if self.need_optimize_partition {
                        partitioned_file_lists = repartition_sorted_groups(
                            new_groups,
                            self.options.target_partitions,
                            Arc::clone(&self.file_schema),
                            self.options.collect_stat,
                        );
                    } else {
                        partitioned_file_lists = new_groups;
                    }
                }
                Ordering::Less => {
                    log::debug!(
                        "attempted to split file groups by statistics, but there were more file groups: {} than target_partitions: {}; falling back to unordered",
                        new_groups.len(),
                        self.options.target_partitions
                    )
                }
            },
            None => {
                log::debug!("did't set split_file_groups_by_statistics");
            } // no ordering required
        };

        log::debug!(
            "after partition, target_partitions: {}, file groups: {}",
            self.options.target_partitions,
            partitioned_file_lists.len()
        );

        // extract types of partition columns
        let table_partition_cols = self
            .options
            .table_partition_cols
            .iter()
            .map(|col| Ok(self.table_schema.field_with_name(&col.0)?.clone()))
            .collect::<Result<Vec<_>>>()?;

        let filters = if let Some(expr) = conjunction(filters.to_vec()) {
            // NOTE: Use the table schema (NOT file schema) here because `expr` may contain
            // references to partition columns.
            let table_df_schema = self.table_schema.as_ref().clone().to_dfschema()?;
            let filters = create_physical_expr(&expr, &table_df_schema, state.execution_props())?;
            Some(filters)
        } else {
            None
        };

        let object_store_url = if let Some(url) = self.table_paths.first() {
            url.object_store()
        } else {
            return Ok(Arc::new(EmptyExec::new(Arc::new(Schema::empty()))));
        };

        let (parquet_projection, filter_projection) =
            if let Some(index_condition) = self.index_condition.as_ref() {
                // get the projection for the filter
                let mut filter_projection =
                    index_condition.get_schema_projection(self.schema(), &self.fst_fields);
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

        // create the execution plan
        let parquet_exec = self
            .create_physical_plan(
                session_state,
                FileScanConfigBuilder::new(
                    object_store_url,
                    Arc::clone(&self.file_schema),
                    self.options.format.file_source(),
                )
                .with_file_groups(partitioned_file_lists)
                .with_statistics(statistics)
                .with_projection(parquet_projection.cloned())
                .with_limit(limit)
                .with_output_ordering(output_ordering)
                .with_table_partition_cols(table_partition_cols)
                .build(),
                filters.as_ref(),
            )
            .await?;

        let projection_exec = apply_projection(
            &self.schema(),
            &self.diff_rules,
            parquet_projection,
            parquet_exec,
        )?;

        // if the index condition can remove filter, we can skip the config
        // feature_query_remove_filter_with_index
        let can_remove_filter = self
            .index_condition
            .as_ref()
            .map(|v| v.can_remove_filter())
            .unwrap_or(true);
        if can_remove_filter || get_config().common.feature_query_remove_filter_with_index {
            apply_filter(
                self.index_condition.as_ref(),
                &projection_exec.schema(),
                &self.fst_fields,
                projection_exec,
                filter_projection,
            )
        } else {
            Ok(projection_exec)
        }
    }

    fn supports_filters_pushdown(
        &self,
        filters: &[&Expr],
    ) -> Result<Vec<TableProviderFilterPushDown>> {
        let support: Vec<_> = filters
            .iter()
            .map(|filter| {
                if expr_applicable_for_cols(
                    &self
                        .options
                        .table_partition_cols
                        .iter()
                        .map(|x| x.0.clone())
                        .collect::<Vec<_>>(),
                    filter,
                ) {
                    // if filter can be handled by partition pruning, it is exact
                    TableProviderFilterPushDown::Exact
                } else {
                    // otherwise, we still might be able to handle the filter with file
                    // level mechanisms such as Parquet row group pruning.
                    TableProviderFilterPushDown::Inexact
                }
            })
            .collect();
        Ok(support)
    }
}

// 1. first get larger group
// 2. split larger groups based on odd and even numbers
// 3. loop until the group reaches the number of partitions
fn repartition_sorted_groups(
    mut groups: Vec<FileGroup>,
    partition_num: usize,
    file_schema: SchemaRef,
    collect_stat: bool,
) -> Vec<FileGroup> {
    if groups.is_empty() {
        return groups;
    }

    while groups.len() < partition_num {
        let max_index = find_max_group_index(&groups);
        let max_group = groups.remove(max_index);

        // if the max group has less than 3 files, we don't split it further
        // less than 3 will cause repartitionExec issue
        if max_group.files().len() <= 3 {
            groups.push(max_group);
            break;
        }

        // split max_group into odd and even groups
        let group_cap = max_group.files().len().div_ceil(2);
        let mut odd_group = Vec::with_capacity(group_cap);
        let mut even_group = Vec::with_capacity(group_cap);

        for (idx, file) in max_group.into_inner().into_iter().enumerate() {
            if idx % 2 == 0 {
                even_group.push(file);
            } else {
                odd_group.push(file);
            }
        }

        if !odd_group.is_empty() {
            let file_group = FileGroup::new(odd_group);
            let file_group_with_statistics =
                compute_file_group_statistics(file_group, Arc::clone(&file_schema), collect_stat)
                    .unwrap();
            groups.push(file_group_with_statistics);
        }
        if !even_group.is_empty() {
            let file_group = FileGroup::new(even_group);
            let file_group_with_statistics =
                compute_file_group_statistics(file_group, Arc::clone(&file_schema), collect_stat)
                    .unwrap();
            groups.push(file_group_with_statistics);
        }
    }

    groups
}

// find the index of the group with the most files
fn find_max_group_index(groups: &[FileGroup]) -> usize {
    groups
        .iter()
        .enumerate()
        .fold(0, |max_index, (idx, group)| {
            if group.len() > groups[max_index].len() {
                idx
            } else {
                max_index
            }
        })
}

fn create_ordering(schema: &Schema, sort_order: &[Vec<SortExpr>]) -> Result<Vec<LexOrdering>> {
    let mut all_sort_orders = vec![];

    for exprs in sort_order {
        // Construct PhysicalSortExpr objects from Expr objects:
        let mut sort_exprs = LexOrdering::default();
        for sort in exprs {
            match &sort.expr {
                Expr::Column(col) => match expressions::col(&col.name, schema) {
                    Ok(expr) => {
                        sort_exprs.push(PhysicalSortExpr {
                            expr,
                            options: SortOptions {
                                descending: !sort.asc,
                                nulls_first: sort.nulls_first,
                            },
                        });
                    }
                    // Cannot find expression in the projected_schema, stop iterating
                    // since rest of the orderings are violated
                    Err(_) => break,
                },
                expr => {
                    return plan_err!(
                        "Expected single column references in output_ordering, got {expr}"
                    );
                }
            }
        }
        if !sort_exprs.is_empty() {
            all_sort_orders.push(sort_exprs);
        }
    }
    Ok(all_sort_orders)
}

/// Processes a stream of partitioned files and returns a `FileGroup` containing the files.
///
/// This function collects files from the provided stream until either:
/// 1. The stream is exhausted
/// 2. The accumulated number of rows exceeds the provided `limit` (if specified)
///
/// # Arguments
/// * `files` - A stream of `Result<PartitionedFile>` items to process
/// * `limit` - An optional row count limit. If provided, the function will stop collecting files
///   once the accumulated number of rows exceeds this limit
/// * `collect_stats` - Whether to collect and accumulate statistics from the files
///
/// # Returns
/// A `Result` containing a `FileGroup` with the collected files
/// and a boolean indicating whether the statistics are inexact.
///
/// # Note
/// The function will continue processing files if statistics are not available or if the
/// limit is not provided. If `collect_stats` is false, statistics won't be accumulated
/// but files will still be collected.
async fn get_files_with_limit(
    files: impl Stream<Item = Result<PartitionedFile>>,
    limit: Option<usize>,
    collect_stats: bool,
) -> Result<(FileGroup, bool)> {
    let mut file_group = FileGroup::default();
    // Fusing the stream allows us to call next safely even once it is finished.
    let mut all_files = Box::pin(files.fuse());
    enum ProcessingState {
        ReadingFiles,
        ReachedLimit,
    }

    let mut state = ProcessingState::ReadingFiles;
    let mut num_rows = Precision::Absent;

    while let Some(file_result) = all_files.next().await {
        // Early exit if we've already reached our limit
        if matches!(state, ProcessingState::ReachedLimit) {
            break;
        }

        let file = file_result?;

        // Update file statistics regardless of state
        if collect_stats && let Some(file_stats) = &file.statistics {
            num_rows = if file_group.is_empty() {
                // For the first file, just take its row count
                file_stats.num_rows
            } else {
                // For subsequent files, accumulate the counts
                num_rows.add(&file_stats.num_rows)
            };
        }

        // Always add the file to our group
        file_group.push(file);

        // Check if we've hit the limit (if one was specified)
        if let Some(limit) = limit
            && let Precision::Exact(row_count) = num_rows
            && row_count > limit
        {
            state = ProcessingState::ReachedLimit;
        }
    }
    // If we still have files in the stream, it means that the limit kicked
    // in, and the statistic could have been different had we processed the
    // files in a different order.
    let inexact_stats = all_files.next().await.is_some();
    Ok((file_group, inexact_stats))
}

/// Computes statistics for all files across multiple file groups.
///
/// This function:
/// 1. Computes statistics for each individual file group
/// 2. Summary statistics across all file groups
/// 3. Optionally marks statistics as inexact
///
/// # Parameters
/// * `file_groups` - Vector of file groups to process
/// * `table_schema` - Schema of the table
/// * `collect_stats` - Whether to collect statistics
/// * `inexact_stats` - Whether to mark the resulting statistics as inexact
///
/// # Returns
/// A tuple containing:
/// * The processed file groups with their individual statistics attached
/// * The summary statistics across all file groups, aka all files summary statistics
pub fn compute_all_files_statistics(
    file_groups: Vec<FileGroup>,
    table_schema: SchemaRef,
    collect_stats: bool,
    inexact_stats: bool,
) -> Result<(Vec<FileGroup>, Statistics)> {
    let file_groups_with_stats = file_groups
        .into_iter()
        .map(|file_group| {
            compute_file_group_statistics(file_group, Arc::clone(&table_schema), collect_stats)
        })
        .collect::<Result<Vec<_>>>()?;

    // Then summary statistics across all file groups
    let file_groups_statistics = file_groups_with_stats
        .iter()
        .filter_map(|file_group| file_group.file_statistics(None));

    let mut statistics = Statistics::try_merge_iter(file_groups_statistics, &table_schema)?;

    if inexact_stats {
        statistics = statistics.to_inexact()
    }

    Ok((file_groups_with_stats, statistics))
}

/// Computes the summary statistics for a group of files(`FileGroup` level's statistics).
///
/// This function combines statistics from all files in the file group to create
/// summary statistics. It handles the following aspects:
/// - Merges row counts and byte sizes across files
/// - Computes column-level statistics like min/max values
/// - Maintains appropriate precision information (exact, inexact, absent)
///
/// # Parameters
/// * `file_group` - The group of files to process
/// * `file_schema` - Schema of the files
/// * `collect_stats` - Whether to collect statistics (if false, returns original file group)
///
/// # Returns
/// A new file group with summary statistics attached
pub fn compute_file_group_statistics(
    file_group: FileGroup,
    file_schema: SchemaRef,
    collect_stats: bool,
) -> Result<FileGroup> {
    if !collect_stats {
        return Ok(file_group);
    }

    let file_group_stats = file_group.iter().filter_map(|file| {
        let stats = file.statistics.as_ref()?;
        Some(stats.as_ref())
    });
    let statistics = Statistics::try_merge_iter(file_group_stats, &file_schema)?;

    Ok(file_group.with_statistics(Arc::new(statistics)))
}
