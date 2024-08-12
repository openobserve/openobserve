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

use std::sync::Arc;

use datafusion::{
    common::{DataFusionError, Result},
    datasource::{
        file_format::parquet::ParquetFormat,
        listing::{ListingOptions, ListingTable, ListingTableConfig, ListingTableUrl},
    },
    prelude::SessionContext,
};
use proto::datafusion::empty_table::NewEmptyTable;

#[allow(dead_code)]
pub async fn generate_context(testdata: &str, target_partitions: usize) -> Result<SessionContext> {
    let mut session_config = datafusion::prelude::SessionConfig::new()
        .with_batch_size(8192)
        .with_target_partitions(target_partitions);
    session_config
        .options_mut()
        .execution
        .listing_table_ignore_subdirectory = false;
    session_config.options_mut().sql_parser.dialect = "PostgreSQL".to_string();
    let ctx = SessionContext::new_with_config(session_config);

    let file_format = ParquetFormat::default().with_enable_pruning(true);
    let list_options = ListingOptions::new(Arc::new(file_format))
        .with_file_extension(".parquet")
        .with_target_partitions(target_partitions)
        .with_collect_stat(true);
    let list_url = match ListingTableUrl::parse(testdata) {
        Ok(url) => url,
        Err(e) => {
            return Err(DataFusionError::Execution(format!(
                "ListingTableUrl error: {e}"
            )));
        }
    };
    let list_config = ListingTableConfig::new(list_url)
        .with_listing_options(list_options)
        .infer_schema(&ctx.state())
        .await?;

    let table = ListingTable::try_new(list_config.clone())?;
    ctx.register_table("t1", Arc::new(table))?;

    let table = ListingTable::try_new(list_config.clone())?;
    ctx.register_table("t2", Arc::new(table))?;

    Ok(ctx)
}

pub async fn generate_context_with_empty_table_scan(
    testdata: &str,
    target_partitions: usize,
) -> Result<SessionContext> {
    let mut session_config = datafusion::prelude::SessionConfig::new()
        .with_batch_size(8192)
        .with_target_partitions(target_partitions);
    session_config
        .options_mut()
        .execution
        .listing_table_ignore_subdirectory = false;
    session_config.options_mut().sql_parser.dialect = "PostgreSQL".to_string();
    let ctx = SessionContext::new_with_config(session_config);

    let file_format = ParquetFormat::default().with_enable_pruning(true);
    let list_options = ListingOptions::new(Arc::new(file_format))
        .with_file_extension(".parquet")
        .with_target_partitions(target_partitions)
        .with_collect_stat(true);
    let list_url = match ListingTableUrl::parse(testdata) {
        Ok(url) => url,
        Err(e) => {
            return Err(DataFusionError::Execution(format!(
                "ListingTableUrl error: {e}"
            )));
        }
    };
    let list_config = ListingTableConfig::new(list_url)
        .with_listing_options(list_options)
        .infer_schema(&ctx.state())
        .await?;
    let schema = list_config.file_schema.clone().unwrap();

    let table = NewEmptyTable::new(schema.clone()).with_partitions(target_partitions);
    ctx.register_table("t1", Arc::new(table))?;

    let table = NewEmptyTable::new(schema.clone()).with_partitions(target_partitions);
    ctx.register_table("t2", Arc::new(table))?;

    Ok(ctx)
}
