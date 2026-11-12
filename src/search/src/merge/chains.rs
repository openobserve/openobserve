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
    ider,
    meta::{
        search::{Session, StorageType},
        stream::FileKey,
    },
};
use datafusion::{
    arrow::datatypes::Schema,
    common::tree_node::{TreeNode, TreeNodeRecursion},
    datasource::{physical_plan::FileScanConfig, source::DataSourceExec},
    error::{DataFusionError, Result},
};
use infra::runtime::DATAFUSION_RUNTIME;
use metrics_index::MetricsFileLayout;

use super::MergeMode;
use crate::datafusion::{
    exec::TableBuilder,
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
    let planned = async {
        let tables = TableBuilder::new()
            .sort_order(sort_order)
            .build(session, files.clone(), schema.clone())
            .await?;
        let sql = MergeMode::MetricsIndexed.sql(&schema);
        super::plan_merge_query(&sql, sort_order, schema, tables).await
    }
    .await;
    file_list::clear(&trace_id);
    let (_, plan) = planned?;

    let mut by_key: hashbrown::HashMap<String, FileKey> =
        files.into_iter().map(|f| (f.key.clone(), f)).collect();
    let mut chains = Vec::new();
    plan.apply(|node| {
        let scan = node
            .downcast_ref::<DataSourceExec>()
            .and_then(|exec| exec.data_source().downcast_ref::<FileScanConfig>());
        for group in scan.iter().flat_map(|scan| &scan.file_groups) {
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
        Ok(TreeNodeRecursion::Continue)
    })?;
    if !by_key.is_empty() {
        return Err(DataFusionError::Plan(format!(
            "hash_ordered_chains: {} file(s) missing from the merge plan",
            by_key.len()
        )));
    }
    Ok(chains)
}

#[cfg(test)]
mod tests {
    use arrow::array::{Int64Array, RecordBatch};
    use arrow_schema::{DataType, Field};
    use config::{TIMESTAMP_COL_NAME, meta::stream::FileMeta};

    use super::*;

    async fn put_hash_file(account: &str, name: &str, hashes: &[u64]) -> FileKey {
        use arrow::array::UInt64Array;
        use config::meta::promql::HASH_LABEL;
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(UInt64Array::from(hashes.to_vec())),
                Arc::new(Int64Array::from(vec![10; hashes.len()])),
            ],
        )
        .unwrap();
        let mut buf = Vec::new();
        let mut writer = parquet::arrow::ArrowWriter::try_new(&mut buf, schema, None).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();
        let key = format!("files/o/metrics/chains/2026/08/18/10/{name}");
        let meta = FileMeta {
            records: hashes.len() as i64,
            compressed_size: buf.len() as i64,
            ..Default::default()
        };
        infra::storage::put(account, &key, buf.into())
            .await
            .unwrap();
        FileKey::new(0, account.to_string(), key, meta, false)
    }

    /// Files whose hash ranges do not overlap share a chain; an overlapping file opens its own.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_hash_ordered_chains_group_non_overlapping_files() {
        use config::meta::promql::HASH_LABEL;
        let id = ider::uuid();
        infra::storage::add_account(&id, Box::new(object_store::memory::InMemory::new())).await;
        let account = format!("{id}:default");
        let files = vec![
            put_hash_file(&account, "hash-merged-v1-a.parquet", &[1, 2, 3]).await,
            put_hash_file(&account, "hash-merged-v1-b.parquet", &[4, 5, 6]).await,
            put_hash_file(&account, "hash-sorted-v1-c.parquet", &[2, 5]).await,
            put_hash_file(&account, "hash-sorted-v1-d.parquet", &[1, 6]).await,
        ];
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));
        let chains = hash_ordered_chains(schema, files).await.unwrap();
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
                vec!["hash-merged-v1-a.parquet", "hash-merged-v1-b.parquet"],
                vec!["hash-sorted-v1-c.parquet"],
                vec!["hash-sorted-v1-d.parquet"],
            ]
        );
    }
}
