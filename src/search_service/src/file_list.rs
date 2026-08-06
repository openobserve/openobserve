// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::stream::{FileKey, PartitionTimeLevel, StreamType},
    metrics::{FILE_LIST_CACHE_HIT_COUNT, FILE_LIST_ID_SELECT_COUNT},
};
use hashbrown::HashSet;
use infra::{errors::Result, file_list as infra_file_list};
use rayon::slice::ParallelSliceMut;

use crate::inspector::{SearchInspectorFieldsBuilder, search_inspector_fields};

#[tracing::instrument(
    name = "search_service::file_list::query",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_level: PartitionTimeLevel,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<FileKey>> {
    let mut files = infra_file_list::query(
        org_id,
        stream_type,
        stream_name,
        time_level,
        (time_min, time_max),
        None,
    )
    .await?;
    let dumped_files = crate::file_list_dump::query(
        trace_id,
        org_id,
        stream_type,
        stream_name,
        (time_min, time_max),
        &[],
    )
    .await?;

    files.extend(dumped_files.iter().map(FileKey::from));
    files.par_sort_unstable_by(|left, right| left.key.cmp(&right.key));
    files.dedup_by(|left, right| left.key == right.key);
    Ok(files)
}

/// Query merge candidates from the live file list only.
///
/// Dumped file-list entries have already been compacted and cannot be marked deleted, so
/// re-compaction intentionally ignores them.
#[tracing::instrument(
    name = "search_service::file_list::query_for_merge",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query_for_merge(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_start: &str,
    date_end: &str,
) -> Result<Vec<FileKey>> {
    infra_file_list::query_for_merge(
        org_id,
        stream_type,
        stream_name,
        (date_start.to_string(), date_end.to_string()),
    )
    .await
}

#[tracing::instrument(name = "search_service::file_list::query_by_ids", skip_all)]
pub async fn query_by_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    ids: &[i64],
) -> Result<Vec<FileKey>> {
    let cfg = get_config();
    FILE_LIST_ID_SELECT_COUNT
        .with_label_values::<&str>(&[])
        .set(ids.len() as i64);
    let ids_set: HashSet<_> = ids.iter().copied().collect();
    let (mut files, ids_set) = if cfg.common.local_mode {
        (Vec::with_capacity(ids.len()), ids_set)
    } else {
        let start = std::time::Instant::now();
        let cached_files = match infra_file_list::LOCAL_CACHE
            .query_by_ids(ids, time_range)
            .await
        {
            Ok(files) => files,
            Err(err) => {
                log::error!("[trace_id {trace_id}] file_list query cache failed: {err:?}");
                Vec::new()
            }
        };
        let cached_ids: HashSet<_> = cached_files.iter().map(|file| file.id).collect();
        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] file_list get cached_ids: {}, took: {} ms",
                    cached_ids.len(),
                    start.elapsed().as_millis()
                ),
                SearchInspectorFieldsBuilder::new()
                    .trace_id(trace_id.to_string())
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
            .with_label_values::<&str>(&[])
            .set(cached_ids.len() as i64);
        (
            cached_files,
            ids_set.difference(&cached_ids).copied().collect(),
        )
    };

    let start = std::time::Instant::now();
    let ids: Vec<_> = ids_set.iter().copied().collect();
    let mut db_files = infra_file_list::query_by_ids(&ids, time_range).await?;
    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] file_list query from db: {}, took: {} ms",
                db_files.len(),
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("file_list query from db".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .desc(format!("query from db: {}", db_files.len()))
                .build()
        )
    );
    let db_ids: HashSet<_> = db_files.iter().map(|file| file.id).collect();
    let ids_set = ids_set.difference(&db_ids).copied().collect::<HashSet<_>>();
    if !ids_set.is_empty() {
        let ids: Vec<_> = ids_set.iter().copied().collect();
        let dumped_files = crate::file_list_dump::query(
            trace_id,
            org_id,
            stream_type,
            stream_name,
            time_range.unwrap_or_default(),
            &ids,
        )
        .await?;
        db_files.extend(
            dumped_files
                .iter()
                .filter_map(|file| ids_set.contains(&file.id).then_some(file.into())),
        );
    }

    if !cfg.common.local_mode {
        let cached_files = db_files.clone();
        let trace_id = trace_id.to_string();
        tokio::task::spawn(async move {
            let start = std::time::Instant::now();
            if let Err(err) = infra_file_list::LOCAL_CACHE
                .batch_add_with_id(&cached_files)
                .await
            {
                log::error!("[trace_id {trace_id}] file_list set cache failed for db files: {err}");
            }
            log::info!(
                "{}",
                search_inspector_fields(
                    format!(
                        "[trace_id {trace_id}] file_list set cached_ids: {}, took: {} ms",
                        cached_files.len(),
                        start.elapsed().as_millis()
                    ),
                    SearchInspectorFieldsBuilder::new()
                        .trace_id(trace_id.to_string())
                        .node_name(LOCAL_NODE.name.clone())
                        .component("file_list set cached_ids".to_string())
                        .search_role("follower".to_string())
                        .duration(start.elapsed().as_millis() as usize)
                        .desc(format!("set cached_ids: {}", cached_files.len()))
                        .build()
                )
            );
        });
    }

    files.extend(db_files);
    files.par_sort_unstable_by(|left, right| left.key.cmp(&right.key));
    files.dedup_by(|left, right| left.key == right.key);
    Ok(files)
}

#[tracing::instrument(
    name = "search_service::file_list::query_ids",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: (i64, i64),
) -> Result<Vec<infra_file_list::FileId>> {
    let mut files =
        infra_file_list::query_ids(org_id, stream_type, stream_name, time_range).await?;
    files.extend(
        crate::file_list_dump::query_ids(trace_id, org_id, stream_type, stream_name, time_range)
            .await?,
    );
    files.par_sort_unstable_by(|left, right| left.id.cmp(&right.id));
    files.dedup_by(|left, right| left.id == right.id);
    Ok(files)
}
