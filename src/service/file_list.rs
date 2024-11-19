// Copyright 2024 OpenObserve Inc.
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

use config::{
    get_config,
    meta::{
        search::ScanStats,
        stream::{FileKey, PartitionTimeLevel, StreamType},
    },
    metrics::{FILE_LIST_CACHE_HIT_COUNT, FILE_LIST_ID_SELECT_COUNT},
    utils::file::get_file_meta as util_get_file_meta,
};
use hashbrown::HashSet;
use infra::{errors::Result, file_list, storage};
use rayon::slice::ParallelSliceMut;

#[tracing::instrument(
    name = "service::file_list::query",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<FileKey>> {
    let files = file_list::query(
        org_id,
        stream_type,
        stream_name,
        time_level,
        Some((time_min, time_max)),
        None,
    )
    .await?;
    let mut file_keys = Vec::with_capacity(files.len());
    for file in files {
        file_keys.push(FileKey {
            key: file.0,
            meta: file.1,
            deleted: false,
            segment_ids: None,
        });
    }
    Ok(file_keys)
}

pub async fn query_by_ids(trace_id: &str, ids: &[i64]) -> Result<Vec<FileKey>> {
    let cfg = get_config();
    FILE_LIST_ID_SELECT_COUNT
        .with_label_values(&[])
        .set(ids.len() as i64);
    // 1. first query from local cache
    let (mut files, ids) = if !cfg.common.local_mode && cfg.common.meta_store_external {
        let ids_set: HashSet<_> = ids.iter().cloned().collect();
        let cached_files = match file_list::LOCAL_CACHE.query_by_ids(ids).await {
            Ok(files) => files,
            Err(e) => {
                log::error!(
                    "[trace_id {trace_id}] file_list query cache failed: {:?}",
                    e
                );
                Vec::new()
            }
        };
        let cached_ids = cached_files
            .iter()
            .map(|(id, ..)| *id)
            .collect::<HashSet<_>>();
        log::info!(
            "[trace_id {trace_id}] file_list cached_ids: {:?}",
            cached_ids.len()
        );

        FILE_LIST_CACHE_HIT_COUNT
            .with_label_values(&[])
            .set(cached_ids.len() as i64);

        let mut file_keys = Vec::with_capacity(ids.len());
        for (_, key, meta) in cached_files {
            file_keys.push(FileKey {
                key,
                meta,
                deleted: false,
                segment_ids: None,
            });
        }
        (
            file_keys,
            ids_set.difference(&cached_ids).cloned().collect::<Vec<_>>(),
        )
    } else {
        (Vec::with_capacity(ids.len()), ids.to_vec())
    };

    // 2. query from remote db
    let db_files = file_list::query_by_ids(&ids).await?;
    let db_files = db_files
        .into_iter()
        .map(|(id, key, meta)| {
            (
                id,
                FileKey {
                    key,
                    meta,
                    deleted: false,
                    segment_ids: None,
                },
            )
        })
        .collect::<Vec<_>>();

    // 3. set the local cache
    if !cfg.common.local_mode && cfg.common.meta_store_external {
        let db_files: Vec<_> = db_files.iter().map(|(id, f)| (*id, f)).collect();
        if let Err(e) = file_list::LOCAL_CACHE.batch_add_with_id(&db_files).await {
            log::error!("[trace_id {trace_id}] file_list set cache failed: {:?}", e);
        }
    }

    // 4. merge the results
    files.extend(db_files.into_iter().map(|(_, f)| f));

    Ok(files)
}

#[tracing::instrument(
    name = "service::file_list::query_ids",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query_ids(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
) -> Result<Vec<file_list::FileId>> {
    let mut files = file_list::query_ids(org_id, stream_type, stream_name, time_range).await?;
    files.par_sort_unstable_by(|a, b| a.id.cmp(&b.id));
    files.dedup_by(|a, b| a.id == b.id);
    Ok(files)
}

#[inline]
pub async fn calculate_files_size(files: &[FileKey]) -> Result<ScanStats> {
    let mut stats = ScanStats::new();
    stats.files = files.len() as i64;
    for file in files {
        stats.records += file.meta.records;
        stats.original_size += file.meta.original_size;
        stats.compressed_size += file.meta.compressed_size;
    }
    Ok(stats)
}

#[inline]
pub fn calculate_local_files_size(files: &[String]) -> Result<u64> {
    let mut size = 0;
    for file in files {
        let file_size = match util_get_file_meta(file) {
            Ok(resp) => resp.len(),
            Err(_) => 0,
        };
        size += file_size;
    }
    Ok(size)
}

// Delete one parquet file and update the file list
pub async fn delete_parquet_file(key: &str, file_list_only: bool) -> Result<()> {
    // delete from file list in metastore
    file_list::batch_remove(&[key.to_string()]).await?;

    // delete the parquet whaterever the file is exists or not
    if !file_list_only {
        _ = storage::del(&[key]).await;
    }
    Ok(())
}
