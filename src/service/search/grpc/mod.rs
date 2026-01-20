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

use std::{collections::HashSet, sync::Arc};

use arrow_schema::Schema;
use config::meta::{
    search::ScanStats,
    stream::{FileKey, StreamType},
};
use datafusion::{
    datasource::TableProvider, execution::cache::cache_manager::FileStatisticsCache,
    sql::TableReference,
};
use infra::errors::Result;

use super::{datafusion::exec::TableBuilder, index::IndexCondition};

pub mod flight;
pub mod storage;
pub(crate) mod tantivy_result;
pub(crate) mod tantivy_result_cache;
pub mod wal;

pub type SearchTable = Result<(Vec<Arc<dyn TableProvider>>, ScanStats, HashSet<u64>)>;

#[derive(Debug)]
pub struct QueryParams {
    pub trace_id: String,
    pub org_id: String,
    pub stream: TableReference,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub time_range: (i64, i64),
    pub work_group: Option<String>,
    pub use_inverted_index: bool,
}

/// Create tables from files, automatically splitting them based on time range overlap:
/// - Files completely within the query time range: no timestamp filter applied
/// - Files partially overlapping with the query time range: timestamp filter applied
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create_tables_from_files<F>(
    files: Vec<FileKey>,
    session: config::meta::search::Session,
    query: Arc<QueryParams>,
    schema_ref: Arc<Schema>,
    sorted_by_time: bool,
    file_stat_cache: Option<Arc<dyn FileStatisticsCache>>,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
    on_error: F,
) -> Result<Vec<Arc<dyn TableProvider>>>
where
    F: Fn() + Clone,
{
    let mut tables = Vec::new();
    let schema_ref = Arc::new(
        schema_ref
            .as_ref()
            .clone()
            .with_metadata(Default::default()),
    );

    // Helper to create table with common configuration
    let create_table = |files: Vec<FileKey>, timestamp_filter: Option<(i64, i64)>| {
        let mut session = session.clone();
        // Note: avoid the files be replaced by the same session id in file_list::set
        session.id = format!("{}-{}", session.id, timestamp_filter.is_some());
        let schema_ref = schema_ref.clone();
        let file_stat_cache = file_stat_cache.clone();
        let index_condition = index_condition.clone();
        let fst_fields = fst_fields.clone();
        let on_error = on_error.clone();

        async move {
            let mut builder = TableBuilder::new()
                .sorted_by_time(sorted_by_time)
                .file_stat_cache(file_stat_cache)
                .index_condition(index_condition)
                .fst_fields(fst_fields);

            if let Some(time_range) = timestamp_filter {
                builder = builder.timestamp_filter(time_range);
            }

            builder
                .build(session, files, schema_ref)
                .await
                .inspect_err(|_| on_error())
        }
    };

    // If the stream is enrichment tables, create a table for all files
    // this is used for add enrich before the stream name(usually for join with the stream)
    if let Some(schema) = query.stream.schema()
        && (schema == "enrich" || schema == "enrichment_tables")
    {
        let table = create_table(files, None).await?;
        tables.push(table);
        return Ok(tables);
    }

    // Split files into two groups based on time range overlap
    let (start_time, end_time) = query.time_range;
    let (files_without_filter, files_with_filter): (Vec<_>, Vec<_>) = files
        .into_iter()
        .partition(|file| file.meta.min_ts >= start_time && file.meta.max_ts < end_time);

    // Create table for files without timestamp filter
    if !files_without_filter.is_empty() {
        let table = create_table(files_without_filter, None).await?;
        tables.push(table);
    }

    // Create table for files with timestamp filter
    if !files_with_filter.is_empty() {
        let table = create_table(files_with_filter, Some(query.time_range)).await?;
        tables.push(table);
    }

    Ok(tables)
}
