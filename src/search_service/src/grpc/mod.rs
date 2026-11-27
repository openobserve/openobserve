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

use arrow_schema::{Metadata, Schema};
use config::meta::{search::ScanStats, stream::FileKey};
use datafusion::{datasource::TableProvider, execution::cache::cache_manager::FileStatisticsCache};
use hashbrown::HashSet;
use infra::errors::Result;

use super::{
    datafusion::{exec::TableBuilder, sort_order::FileSortOrder},
    index::IndexCondition,
};

pub mod flight;
pub mod storage;
pub mod wal;
use ::search::types::QueryParams;

pub type SearchTable = Result<(Vec<Arc<dyn TableProvider>>, ScanStats, HashSet<u64>)>;

/// Create the tables over `files`; only the files that reach outside the query
/// time range get the timestamp filter.
#[allow(clippy::too_many_arguments)]
pub async fn create_tables_from_files(
    files: Vec<FileKey>,
    session: config::meta::search::Session,
    query: Arc<QueryParams>,
    schema_ref: Arc<Schema>,
    sort_order: FileSortOrder,
    file_stat_cache: Option<Arc<FileStatisticsCache>>,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
) -> Result<Vec<Arc<dyn TableProvider>>> {
    let schema_ref = Arc::new(
        schema_ref
            .as_ref()
            .clone()
            .with_metadata(Metadata::default()),
    );
    let mut builder = TableBuilder::new()
        .sort_order(sort_order)
        .file_stat_cache(file_stat_cache)
        .index_condition(index_condition)
        .fst_fields(fst_fields);
    // enrichment tables are joined to the stream as a whole, so they keep every row
    let is_enrich = query
        .stream
        .schema()
        .is_some_and(|schema| schema == "enrich" || schema == "enrichment_tables");
    if !is_enrich {
        builder = builder.timestamp_filter(query.time_range);
    }
    Ok(builder.build(session, files, schema_ref).await?)
}
