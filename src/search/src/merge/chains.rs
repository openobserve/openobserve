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

//! How many sorted inputs a hash-ordered merge keeps open, read from the files' statistics.

use std::sync::Arc;

use config::{
    get_config, ider,
    meta::{
        search::{Session, StorageType},
        stream::FileKey,
    },
};
use datafusion::{
    arrow::datatypes::Schema,
    datasource::physical_plan::FileGroup,
    error::{DataFusionError, Result},
};
use hashbrown::HashMap;
use infra::runtime::DATAFUSION_RUNTIME;

use crate::datafusion::{
    datasource::listing_adapter::ListingTableAdapter,
    exec::{DataFusionContextBuilder, TableBuilder},
    sort_order::FileSortOrder,
    storage::{file_list, format_location},
};

/// The sorted chains of the hash-ordered `files`; `None` when their statistics cannot be read.
pub async fn hash_ordered_chains(
    schema: Arc<Schema>,
    files: Vec<FileKey>,
    stream: &str,
) -> Option<Vec<Vec<FileKey>>> {
    if files.is_empty() {
        return Some(Vec::new());
    }

    let file_num = files.len();
    let chains = DATAFUSION_RUNTIME
        .spawn(read_chains(schema, files))
        .await
        .map_err(|e| e.to_string())
        .and_then(|chains| chains.map_err(|e| e.to_string()));
    match chains {
        Ok(chains) => Some(chains),
        Err(e) => {
            log::warn!(
                "[COMPACTOR] merge_by_stream [{stream}] chaining {file_num} files by statistics failed: {e}"
            );
            None
        }
    }
}

/// The sorted chains a hash-ordered merge of `files` reads: each chain is one input it keeps open.
async fn read_chains(schema: Arc<Schema>, files: Vec<FileKey>) -> Result<Vec<Vec<FileKey>>> {
    let sort_order = FileSortOrder::HashTimestampAsc;
    let session = Session {
        id: ider::generate(),
        storage_type: StorageType::Memory,
        work_group: None,
        target_partitions: 2,
    };
    let trace_id = session.id.clone();
    let listed = list_file_chains(session, schema, files.clone(), sort_order).await;
    file_list::clear(&trace_id);

    let mut by_key: HashMap<String, FileKey> =
        files.into_iter().map(|f| (f.key.clone(), f)).collect();
    let mut chains = Vec::new();
    for group in listed? {
        let chain: Vec<FileKey> = group
            .iter()
            .filter_map(|file| {
                let (_, key) = format_location(&file.object_meta.location);
                by_key.remove(key.as_ref())
            })
            .collect();
        if !chain.is_empty() {
            chains.push(chain);
        }
    }
    if !by_key.is_empty() {
        return Err(DataFusionError::Plan(format!(
            "read_chains: {} file(s) missing from the listed files",
            by_key.len()
        )));
    }
    Ok(chains)
}

/// Lists `files` with their footer statistics and chains them, one table per file format.
async fn list_file_chains(
    session: Session,
    schema: Arc<Schema>,
    files: Vec<FileKey>,
    sort_order: FileSortOrder,
) -> Result<Vec<FileGroup>> {
    let ctx = DataFusionContextBuilder::new()
        .trace_id(&session.id)
        .sort_order(sort_order)
        .build(get_config().limit.datafusion_min_partition_num)
        .await?;

    let state = ctx.state();
    let tables = TableBuilder::new()
        .sort_order(sort_order)
        .build(session, files, schema)
        .await?;

    let mut chains = Vec::new();
    for table in tables {
        let table = table.downcast_ref::<ListingTableAdapter>().ok_or_else(|| {
            DataFusionError::Internal("merge table is not a listing table".into())
        })?;
        chains.extend(table.sorted_file_chains(&state).await?);
    }
    Ok(chains)
}

#[cfg(test)]
mod tests {
    use arrow::array::{Int64Array, RecordBatch, UInt64Array};
    use arrow_schema::{DataType, Field};
    use config::{
        TIMESTAMP_COL_NAME,
        meta::{promql::HASH_LABEL, stream::FileMeta},
    };
    use parquet::{
        arrow::ArrowWriter,
        file::properties::{EnabledStatistics, WriterProperties},
    };

    use super::*;

    fn schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]))
    }

    async fn put_file(account: &str, name: &str, hashes: [u64; 2], stats: bool) -> FileKey {
        let columns: Vec<Arc<dyn arrow::array::Array>> = vec![
            Arc::new(UInt64Array::from(hashes.to_vec())),
            Arc::new(Int64Array::from(vec![10, 50])),
        ];
        let statistics = if stats {
            EnabledStatistics::Page
        } else {
            EnabledStatistics::None
        };
        let props = WriterProperties::builder()
            .set_statistics_enabled(statistics)
            .build();
        let mut buf = Vec::new();
        let mut writer = ArrowWriter::try_new(&mut buf, schema(), Some(props)).unwrap();
        writer
            .write(&RecordBatch::try_new(schema(), columns).unwrap())
            .unwrap();
        writer.close().unwrap();
        let key = format!("files/o/metrics/chains/2026/08/18/10/hash-merged-v1-{name}.parquet");
        let meta = FileMeta {
            records: 2,
            compressed_size: buf.len() as i64,
            ..Default::default()
        };
        infra::storage::put(account, &key, buf.into())
            .await
            .unwrap();
        FileKey::new(0, account.to_string(), key, meta, false)
    }

    /// Each round's files form one chain; files without statistics are an error, not a guess.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_read_chains() {
        let id = ider::uuid();
        infra::storage::add_account(&id, Box::new(object_store::memory::InMemory::new())).await;
        let account = format!("{id}:default");
        let mut rounds = Vec::new();
        let mut bare = Vec::new();
        for round in ["a", "b", "c"] {
            rounds.push(put_file(&account, &format!("{round}1"), [1, 4], true).await);
            rounds.push(put_file(&account, &format!("{round}2"), [5, 9], true).await);
            bare.push(put_file(&account, &format!("{round}0"), [1, 9], false).await);
        }
        let chains = read_chains(schema(), rounds).await.unwrap();
        let lens: Vec<usize> = chains.iter().map(Vec::len).collect();
        assert_eq!(lens, [2, 2, 2], "{chains:?}");

        let err = read_chains(schema(), bare).await.unwrap_err();
        assert!(err.to_string().contains("statistics"), "{err}");
    }
}
