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
use infra::runtime::DATAFUSION_RUNTIME;
use metrics_index::MetricsFileLayout;

use crate::datafusion::{
    datasource::listing_adapter::ListingTableAdapter,
    exec::{DataFusionContextBuilder, TableBuilder},
    sort_order::FileSortOrder,
    storage::{file_list, format_location},
};

/// The sorted chains of the hash-merged files among `files`; `None` when they cannot be read.
pub async fn hash_merged_chains(
    schema: Arc<Schema>,
    files: &[FileKey],
    stream: &str,
) -> Option<Vec<Vec<FileKey>>> {
    let merged: Vec<FileKey> = files
        .iter()
        .filter(|f| MetricsFileLayout::of(&f.key) == Some(MetricsFileLayout::HashMerged))
        .cloned()
        .collect();
    if merged.is_empty() {
        return Some(Vec::new());
    }
    let merged_num = merged.len();
    let chains = DATAFUSION_RUNTIME
        .spawn(hash_ordered_chains(schema, merged))
        .await
        .map_err(|e| e.to_string())
        .and_then(|chains| chains.map_err(|e| e.to_string()));
    match chains {
        Ok(chains) => Some(chains),
        Err(e) => {
            log::warn!(
                "[COMPACTOR] merge_by_stream [{stream}] chaining {merged_num} hash-merged files by statistics failed: {e}"
            );
            None
        }
    }
}

/// The sorted chains a hash-ordered merge of `files` reads: each chain is one input it keeps open.
async fn hash_ordered_chains(
    schema: Arc<Schema>,
    files: Vec<FileKey>,
) -> Result<Vec<Vec<FileKey>>> {
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

    let mut by_key: hashbrown::HashMap<String, FileKey> =
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
            "hash_ordered_chains: {} file(s) missing from the listed files",
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
    use parquet::file::properties::{EnabledStatistics, WriterProperties};

    use super::*;

    fn schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]))
    }

    async fn put_file(
        account: &str,
        name: &str,
        hashes: [u64; 2],
        statistics: EnabledStatistics,
    ) -> FileKey {
        let batch = RecordBatch::try_new(
            schema(),
            vec![
                Arc::new(UInt64Array::from(hashes.to_vec())),
                Arc::new(Int64Array::from(vec![10, 50])),
            ],
        )
        .unwrap();
        let props = WriterProperties::builder()
            .set_statistics_enabled(statistics)
            .build();
        let mut buf = Vec::new();
        let mut writer =
            parquet::arrow::ArrowWriter::try_new(&mut buf, schema(), Some(props)).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();
        let key = format!("files/o/metrics/chains/2026/08/18/10/{name}");
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
    async fn test_hash_ordered_chains_follow_the_file_statistics() {
        let id = ider::uuid();
        infra::storage::add_account(&id, Box::new(object_store::memory::InMemory::new())).await;
        let account = format!("{id}:default");
        let mut rounds = Vec::new();
        for round in ["a", "b", "c"] {
            for (part, hashes) in [(1, [1, 4]), (2, [5, 9])] {
                let name = format!("hash-merged-v1-{round}{part}.parquet");
                rounds.push(put_file(&account, &name, hashes, EnabledStatistics::Page).await);
            }
        }
        let chains = hash_ordered_chains(schema(), rounds).await.unwrap();
        let mut names: Vec<Vec<&str>> = chains
            .iter()
            .map(|chain| {
                chain
                    .iter()
                    .map(|f| f.key.rsplit('/').next().unwrap())
                    .collect()
            })
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                ["hash-merged-v1-a1.parquet", "hash-merged-v1-a2.parquet"],
                ["hash-merged-v1-b1.parquet", "hash-merged-v1-b2.parquet"],
                ["hash-merged-v1-c1.parquet", "hash-merged-v1-c2.parquet"],
            ]
        );

        let mut bare = Vec::new();
        for i in 1..=5 {
            let name = format!("hash-merged-v1-n{i}.parquet");
            bare.push(put_file(&account, &name, [1, 9], EnabledStatistics::None).await);
        }
        let err = hash_ordered_chains(schema(), bare).await.unwrap_err();
        assert!(err.to_string().contains("statistics"), "{err}");
    }
}
