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

use chrono::Utc;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::ScanStats,
        stream::{FileKey, FileMeta, PartitionTimeLevel, StreamType},
    },
    metrics::{FILE_LIST_CACHE_HIT_COUNT, FILE_LIST_ID_SELECT_COUNT},
    utils::file::get_file_meta as util_get_file_meta,
};
use hashbrown::HashSet;
use infra::{errors::Result, file_list, storage};
use rayon::slice::ParallelSliceMut;

use crate::service::{
    file_list_dump,
    search::inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
};

#[tracing::instrument(
    name = "service::file_list::query",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query(
    trace_id: &str,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<FileKey>> {
    let cfg = get_config();
    let files = file_list::query(
        org_id,
        stream_type,
        stream_name,
        time_level,
        Some((time_min, time_max)),
        None,
    )
    .await?;
    let dumped_files = file_list_dump::query(
        trace_id,
        org_id,
        stream_name,
        stream_type,
        (time_min, time_max),
        None,
    )
    .await?;
    if cfg.common.file_list_dump_debug_check {
        let dumped_file_names = dumped_files
            .iter()
            .map(|f| "files/".to_string() + &f.stream + "/" + &f.date + "/" + &f.file)
            .collect::<HashSet<_>>();
        let missing_files: usize = files
            .iter()
            .map(|(_account, name, _)| {
                if dumped_file_names.contains(name) {
                    0
                } else {
                    1
                }
            })
            .sum();
        if missing_files > 0 {
            log::info!(
                "[trace_id : {trace_id}] dump was missing {missing_files} files present in db"
            );
        }
    }
    let mut file_keys = Vec::with_capacity(files.len());
    for (account, key, meta) in files {
        file_keys.push(FileKey {
            account,
            key,
            meta,
            deleted: false,
            segment_ids: None,
        });
    }
    if !cfg.common.file_list_dump_dual_write {
        // we only consider these files in case of dual write disabled,
        // because with dual write there are some edge cases which cannot be sovled even with id
        // de-dup so the data gets counted twice.
        for file in dumped_files {
            file_keys.push(FileKey {
                account: file.account,
                key: "files/".to_string() + &file.stream + "/" + &file.date + "/" + &file.file,
                meta: FileMeta {
                    min_ts: file.min_ts,
                    max_ts: file.max_ts,
                    records: file.records,
                    original_size: file.original_size,
                    compressed_size: file.compressed_size,
                    index_size: file.index_size,
                    flattened: file.flattened,
                },
                deleted: file.deleted,
                segment_ids: None,
            })
        }
    }

    file_keys.par_sort_unstable_by(|a, b| a.key.cmp(&b.key));
    file_keys.dedup_by(|a, b| a.key == b.key);
    Ok(file_keys)
}

/// NOTE: This will not query the files from file_dump. If you also want files from the dump, use
/// query function instead. Currently this is used only when compacting on stream, and we do not
/// support re-compaction of already dumped files, so this function completely ignores the files
/// from dump
#[tracing::instrument(
    name = "service::file_list::query_for_merge",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query_for_merge(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_start: &str,
    date_end: &str,
) -> Result<Vec<FileKey>> {
    let files = file_list::query_for_merge(
        org_id,
        stream_type,
        stream_name,
        Some((date_start.to_string(), date_end.to_string())),
    )
    .await?;
    let mut file_keys = Vec::with_capacity(files.len());
    for (account, key, meta) in files {
        file_keys.push(FileKey {
            account,
            key,
            meta,
            deleted: false,
            segment_ids: None,
        });
    }
    // we don't need to query from dump here, because
    // we expected all dumped files to be already compacted,
    // and the compaction marks old files as deleted, which is not possible with dump
    Ok(file_keys)
}

#[tracing::instrument(name = "service::file_list::query_by_ids", skip_all)]
pub async fn query_by_ids(
    trace_id: &str,
    ids: &[i64],
    org: &str,
    stream_type: StreamType,
    stream: &str,
    time_range: Option<(i64, i64)>,
) -> Result<Vec<FileKey>> {
    let cfg = get_config();
    FILE_LIST_ID_SELECT_COUNT
        .with_label_values(&[])
        .set(ids.len() as i64);
    // 1. first query from local cache
    let (mut files, ids) = if !cfg.common.local_mode {
        let start = std::time::Instant::now();
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
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] file_list get cached_ids: {}, took: {} ms",
                    cached_ids.len(),
                    start.elapsed().as_millis()
                ),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("file_list get cached_ids".to_string())
                    .search_role("follower".to_string())
                    .duration(start.elapsed().as_millis() as usize)
                    .desc(format!(
                        "get cached_ids: {}, left ids: {}",
                        cached_ids.len(),
                        ids.len() - cached_ids.len(),
                    ))
                    .build()
            )
        );

        FILE_LIST_CACHE_HIT_COUNT
            .with_label_values(&[])
            .set(cached_ids.len() as i64);

        let mut file_keys = Vec::with_capacity(ids.len());
        for (_, account, key, meta) in cached_files {
            file_keys.push(FileKey {
                account,
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
    let start = std::time::Instant::now();
    let db_files = file_list::query_by_ids(&ids).await?;
    let db_files = db_files
        .into_iter()
        .map(|(id, account, key, meta)| {
            (
                id,
                FileKey {
                    account,
                    key,
                    meta,
                    deleted: false,
                    segment_ids: None,
                },
            )
        })
        .collect::<Vec<_>>();
    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] file_list query from db: {}, took: {} ms",
                db_files.len(),
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("file_list query from db".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .desc(format!("query from db: {}", db_files.len(),))
                .build()
        )
    );

    // query from file_list_dump
    // we use the min(id) as id hint because that automatically filter outs any dump files
    // which cannot have the ids we are looking for
    let dumped_files = file_list_dump::query(
        trace_id,
        org,
        stream,
        stream_type,
        time_range.unwrap_or((0, Utc::now().timestamp_micros())),
        ids.iter().min().copied(),
    )
    .await?;

    let dumped_files: Vec<_> = dumped_files
        .into_iter()
        .filter(|r| ids.contains(&r.id))
        .map(|r| {
            (
                r.id,
                FileKey {
                    account: r.account,
                    key: "files/".to_string() + &r.stream + "/" + &r.date + "/" + &r.file,
                    meta: FileMeta {
                        min_ts: r.min_ts,
                        max_ts: r.max_ts,
                        records: r.records,
                        original_size: r.original_size,
                        compressed_size: r.compressed_size,
                        index_size: r.index_size,
                        flattened: r.flattened,
                    },
                    deleted: r.deleted,
                    segment_ids: None,
                },
            )
        })
        .collect();

    if cfg.common.file_list_dump_debug_check {
        let dump_ids = dumped_files
            .iter()
            .map(|entry| entry.0)
            .collect::<HashSet<_>>();
        let db_ids = db_files.iter().map(|entry| entry.0).collect::<Vec<_>>();
        let missing_files: usize = db_ids
            .iter()
            .map(|id| if dump_ids.contains(id) { 0 } else { 1 })
            .sum();
        if missing_files > 0 {
            log::info!(
                "[trace_id : {trace_id}] dump was missing {missing_files} files present in db"
            );
        }
    }

    // 3. set the local cache
    if !cfg.common.local_mode {
        let start = std::time::Instant::now();
        let db_files: Vec<_> = db_files.iter().map(|(id, f)| (*id, f)).collect();
        if let Err(e) = file_list::LOCAL_CACHE.batch_add_with_id(&db_files).await {
            log::error!(
                "[trace_id {trace_id}] file_list set cache failed for db files: {:?}",
                e
            );
        }

        if !cfg.common.file_list_dump_dual_write {
            let dumped_files: Vec<_> = dumped_files.iter().map(|(id, f)| (*id, f)).collect();
            if let Err(e) = file_list::LOCAL_CACHE
                .batch_add_with_id(&dumped_files)
                .await
            {
                log::error!(
                    "[trace_id {trace_id}] file_list set cache failed for dumped files: {:?}",
                    e
                );
            }
        }

        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] file_list set cached_ids: {}, took: {} ms",
                    db_files.len(),
                    start.elapsed().as_millis()
                ),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("file_list set cached_ids".to_string())
                    .search_role("follower".to_string())
                    .duration(start.elapsed().as_millis() as usize)
                    .desc(format!("set cached_ids: {}", db_files.len(),))
                    .build()
            )
        );
    }

    // 4. merge the results
    files.extend(db_files.into_iter().map(|(_, f)| f));
    if !cfg.common.file_list_dump_dual_write {
        files.extend(dumped_files.into_iter().map(|(_, f)| f));
    }
    files.par_sort_unstable_by(|a, b| a.key.cmp(&b.key));
    files.dedup_by(|a, b| a.key == b.key);
    Ok(files)
}

#[tracing::instrument(
    name = "service::file_list::query_ids",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
) -> Result<Vec<file_list::FileId>> {
    let cfg = get_config();
    let mut files = file_list::query_ids(org_id, stream_type, stream_name, time_range).await?;
    let dumped_files = super::file_list_dump::get_ids_in_range(
        trace_id,
        org_id,
        stream_name,
        stream_type,
        time_range
            .ok_or_else(|| infra::errors::Error::Message("time_range is required".to_string()))?,
    )
    .await
    .unwrap();
    if cfg.common.file_list_dump_debug_check {
        let dump_ids = dumped_files.iter().map(|f| f.id).collect::<HashSet<_>>();
        let db_ids = files.iter().map(|f| f.id).collect::<Vec<_>>();
        let missing_files: usize = db_ids
            .iter()
            .map(|id| if dump_ids.contains(id) { 0 } else { 1 })
            .sum();
        if missing_files > 0 {
            log::info!(
                "[trace_id : {trace_id}] dump was missing {missing_files} files present in db"
            );
        }
    }
    if !cfg.common.file_list_dump_dual_write {
        files.extend(dumped_files.into_iter());
    }
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
        stats.idx_scan_size += file.meta.index_size;
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
pub async fn delete_parquet_file(account: &str, key: &str, file_list_only: bool) -> Result<()> {
    // delete from file list in metastore
    file_list::batch_process(&[FileKey::new(
        account.to_string(),
        key.to_string(),
        Default::default(),
        true,
    )])
    .await?;

    // delete the parquet whaterever the file is exists or not
    if !file_list_only {
        _ = storage::del(vec![(account, key)]).await;
    }
    Ok(())
}

pub async fn update_compressed_size(key: &str, size: i64) -> Result<()> {
    file_list::update_compressed_size(key, size).await?;
    file_list::LOCAL_CACHE
        .update_compressed_size(key, size)
        .await?;
    Ok(())
}
