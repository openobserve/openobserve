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

//! Bloom filter build + orphan cleanup for the compactor.
//!
//! One public entry point, [`build_for_stream`], called once per hour bucket
//! at the end of a merge round. It does two things in order:
//!
//! 1. **Orphan cleanup.** Given the `bloom_ver` values of the files this merge round just deleted,
//!    [`cleanup_orphan_blooms`] retires any `.bf` no longer referenced by a live row in the bucket.
//! 2. **Build.** It queries the bucket itself (`query_for_bloom` → rows with `index_size > 0` and
//!    `bloom_ver = 0`) and builds `.bf` coverage for those files. The caller does not pass a file
//!    list; this module owns both the "which files" and the "how to bloom" decisions.
//!
//! `bloom_ver` is not append-only: a merge produces new output files with a
//! fresh `bloom_ver` and deletes the small inputs, so an old `.bf` whose every
//! file got merged away becomes an orphan — step 1 catches it.
//!
//! Failure is **always non-fatal**. A failed build leaves `bloom_ver = 0`
//! on the affected files and the search side falls back to opening every
//! tantivy file in the bucket. A failed cleanup leaves an orphan `.bf` for
//! data-retention to reap. Neither affects correctness, so neither
//! propagates to the caller as a hard error.

use std::{collections::HashSet, sync::Arc};

use anyhow::Context;
use bytes::Bytes;
use config::{
    get_config,
    meta::stream::{FileKey, FileListDeleted, StreamType},
    utils::{inverted_index::to_tantivy_name, time::now_micros},
};
use infra::{
    bloom::{BloomWriter, FieldBloom, path::bloom_path},
    errors::Result,
    file_list as infra_file_list, storage,
};
use tantivy::Directory;
use tantivy_utils::puffin_directory::{
    caching_directory::CachingDirectory, footer_cache::FooterCache,
};

use crate::service::{
    search::grpc::storage::get_tantivy_directory, tantivy::bloom_builder::build_blooms_from_index,
};

/// Clean orphan `.bf`s for `orphan_blooms`, then build `.bf` coverage for the
/// bucket's `bloom_ver = 0` files (queried internally via `query_for_bloom`).
///
/// `date_key` is the `YYYY/MM/DD/HH` string used in `file_list.date`.
/// `orphan_blooms` is the `bloom_ver` values of the files the merge round just
/// deleted — used only for cleanup. Files already carrying a non-zero
/// `bloom_ver` are never re-stamped, so no live file migrates off a `bloom_ver`
/// that a dumped row may still point to.
///
/// Returns `Ok(false)` when bloom is disabled or there is nothing to build (no
/// target fields, nothing at `bloom_ver = 0`); `Ok(true)` when a build ran.
/// Recoverable per-file/per-chunk errors are logged, not propagated — never
/// surfaces a build failure to user requests.
pub(crate) async fn build_for_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_key: &str,
    is_incremental: bool,
    orphan_blooms: Vec<i64>,
) -> Result<bool> {
    let cfg = get_config();
    if !cfg.common.bloom_filter_enabled {
        return Ok(false);
    }

    // clean up orphan blooms
    if let Err(e) =
        cleanup_orphan_blooms(org_id, stream_type, stream_name, date_key, orphan_blooms).await
    {
        log::warn!("[BLOOM_BUILD] cleanup orphan blooms failed: {e}");
    }

    // don't build bloom for incremental round
    if is_incremental {
        return Ok(false);
    }

    // Resolve target fields from current stream settings: a field is bloomed
    // only when the operator put it in BOTH `bloom_filter_fields` and
    // `index_fields` (bloom is built on top of the tantivy index).
    let stream_settings = infra::schema::get_settings(org_id, stream_name, stream_type).await;
    let bloom_filter_fields =
        infra::schema::get_stream_setting_bloom_filter_fields(&stream_settings);
    if bloom_filter_fields.is_empty() {
        return Ok(false);
    }
    let index_fields: HashSet<String> =
        infra::schema::get_stream_setting_index_fields(&stream_settings)
            .into_iter()
            .collect();
    let target_fields: Vec<String> = bloom_filter_fields
        .into_iter()
        .filter(|f| index_fields.contains(f))
        .collect();
    if target_fields.is_empty() {
        return Ok(false);
    }

    // Pull every file currently in this hour bucket.
    let mut files =
        infra_file_list::query_for_bloom(org_id, stream_type, stream_name, date_key).await?;
    if files.is_empty() {
        return Ok(false);
    }

    // Build blooms only for files without a `.bf` yet (bloom_ver = 0).
    //
    // **Sub-grouping**: a single hour can hold thousands of files. Since the
    // transposed `.bf` holds every file's SBBF in memory before serialize
    // (M × B × 32 bytes), one giant `.bf` would OOM the compactor at high
    // volume. So we split the new files into chunks of at most
    // `max_files_per_bf` and write one `.bf` per chunk, each with its own
    // `bloom_ver`. The search side groups by `(date, bloom_ver)`, so it
    // naturally reads one block-row per chunk. Total read bytes stay
    // `M × 32`; only the request count grows to `ceil(M / max_files_per_bf)`.
    //
    // Files are sorted by record count first so similar-sized files share a
    // chunk — minimizes the uniform-`B` padding waste (B is sized to each
    // chunk's max cardinality).
    let fpp = cfg.common.bloom_filter_fpp;
    let max_files_per_bf = cfg.common.bloom_filter_max_files_per_bf.max(1);
    files.sort_by(|a, b| b.meta.records.cmp(&a.meta.records));

    let base_ver = now_micros();
    let chunk_total = files.len().div_ceil(max_files_per_bf);
    for (chunk_idx, chunk) in files.chunks(max_files_per_bf).enumerate() {
        let bloom_ver = base_ver + chunk_idx as i64;
        let bloom_path = bloom_path(org_id, stream_type, stream_name, date_key, bloom_ver);
        match build_for_chunk(org_id, bloom_ver, &bloom_path, chunk, &target_fields, fpp).await {
            Ok((took, num_blocks, contributing_ids)) => {
                log::info!(
                    "[BLOOM_BUILD] {bloom_path}: wrote chunk {}/{chunk_total}, num_blocks={num_blocks} covering {contributing_ids} files in {took} ms",
                    chunk_idx + 1,
                );
            }
            Err(e) => {
                log::warn!("[BLOOM_BUILD] {bloom_path}: build chunk failed: {e}");
            }
        }
    }

    Ok(true)
}

// B for this chunk is sized from the chunk's MAX record count, used as
// a safe NDV upper bound: a file can't hold more distinct values than
// rows. This never under-sizes (no saturation) for the target
// high-cardinality fields where distinct ≈ rows. It over-sizes for
// fields that repeat heavily (distinct ≪ rows) — acceptable; exact
// sizing would read each file's tantivy term count in a pre-pass.
async fn build_for_chunk(
    org_id: &str,
    bloom_ver: i64,
    bf_path: &str,
    files: &[FileKey],
    target_fields: &[String],
    fpp: f64,
) -> Result<(u64, u32, usize)> {
    let start = std::time::Instant::now();

    let max_records = files
        .iter()
        .map(|f| f.meta.records.max(0) as u64)
        .max()
        .unwrap_or(0)
        .max(1);
    let num_blocks = infra::bloom::num_blocks_for(max_records, fpp);

    let mut all_blooms: Vec<FieldBloom> = Vec::new();
    let mut contributing_ids: Vec<i64> = Vec::new();
    for f in files {
        match build_for_file(f, target_fields, num_blocks).await {
            Ok(mut blooms) if !blooms.is_empty() => {
                all_blooms.append(&mut blooms);
                contributing_ids.push(f.id);
            }
            Ok(_) => {} // no blooms (no index / field absent) — leave at 0
            Err(e) => {
                log::warn!(
                    "[BLOOM_BUILD] {bf_path}: skipping {} (bloom build failed): {e}",
                    f.key
                );
            }
        }
    }
    if all_blooms.is_empty() {
        return Ok((0, 0, 0));
    }

    // Distinct bloom_ver per chunk (base + idx) → distinct `.bf` path.
    let blob: Vec<u8> = BloomWriter::serialize(all_blooms).context("serialize blooms")?;
    let bf_account = storage::get_account(org_id, bf_path).unwrap_or_default();
    storage::put(&bf_account, bf_path, Bytes::from(blob))
        .await
        .context("upload blooms")?;

    debug_assert!(
        contributing_ids.iter().all(|id| *id > 0),
        "bloom builder must only stamp file_list rows with assigned ids"
    );
    infra_file_list::update_bloom_ver(&contributing_ids, bloom_ver)
        .await
        .context("update bloom ver")?;

    let took = start.elapsed().as_millis() as u64;

    Ok((took, num_blocks, contributing_ids.len()))
}

async fn build_for_file(
    file: &FileKey,
    target_fields: &[String],
    num_blocks: u32,
) -> anyhow::Result<Vec<FieldBloom>> {
    let Some(ttv_file_name) = to_tantivy_name(&file.key) else {
        return Ok(Vec::new()); // not an indexable file
    };
    if file.meta.index_size == 0 {
        return Ok(Vec::new()); // no .ttv was emitted
    }
    let file_account = file.account.clone();
    let puffin_dir = Arc::new(
        get_tantivy_directory(
            "bloom_build",
            &file_account,
            &ttv_file_name,
            file.meta.index_size,
        )
        .await?,
    );
    let footer_cache = FooterCache::from_directory(puffin_dir.clone(), &ttv_file_name).await?;
    let cache_dir = CachingDirectory::new_with_cacher(puffin_dir, Arc::new(footer_cache));
    let reader_directory: Box<dyn Directory> = Box::new(cache_dir);
    let index = tantivy::Index::open(reader_directory).context("open index")?;

    // file.id is the file_list row id, assigned by the INSERT that
    // happened in `write_file_list` before this build runs. Always > 0
    // by the time we get here.
    let file_id = file.id as u64;
    build_blooms_from_index(&index, file_id, target_fields, num_blocks).await
}

/// Retire any `.bf` whose `bloom_ver` is no longer referenced by a live file
/// in this (stream, `date_key`) bucket.
///
/// `deleted_bloom_vers` is the set of `bloom_ver` values carried by files a
/// merge round just deleted (the caller dedups / drops the 0 sentinel, but we
/// guard again here). For each, we probe `file_list` for any surviving row at
/// that version; if none, the `.bf` is enqueued for deletion via the existing
/// `file_list_deleted` queue.
///
/// Orphan detection is a **cleanup optimization, not correctness**: if the
/// EXISTS probe or the enqueue fails, we log and move on — the stale `.bf`
/// stays until data-retention reaps the day's subtree. Errors never
/// propagate.
async fn cleanup_orphan_blooms(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_key: &str,
    orphan_blooms: Vec<i64>,
) -> Result<()> {
    if orphan_blooms.is_empty() {
        return Ok(());
    }
    let candidates: HashSet<i64> = orphan_blooms.into_iter().collect();

    let mut orphans: Vec<FileListDeleted> = Vec::new();
    for v_old in candidates {
        match infra_file_list::bloom_ver_referenced(
            org_id,
            stream_type,
            stream_name,
            date_key,
            v_old,
        )
        .await
        {
            Ok(true) => {} // still referenced by a live file — keep the `.bf`
            Ok(false) => {
                let path = bloom_path(org_id, stream_type, stream_name, date_key, v_old);
                let account = storage::get_account(org_id, &path).unwrap_or_default();
                orphans.push(FileListDeleted {
                    id: 0,
                    account,
                    file: path,
                    index_file: false, // a `.bf` has no companion `.ttv`
                    flattened: false,
                });
            }
            Err(e) => {
                log::warn!(
                    "[BLOOM_CLEANUP] {org_id}/{stream_type}/{stream_name}/{date_key}: \
                     bloom_ver_referenced({v_old}) failed: {e}; leaving `.bf` for retention"
                );
            }
        }
    }
    if orphans.is_empty() {
        return Ok(());
    }

    let created_at = now_micros();
    let n = orphans.len();
    if let Err(e) = infra_file_list::batch_add_deleted(org_id, created_at, &orphans).await {
        log::warn!(
            "[BLOOM_CLEANUP] {org_id}/{stream_type}/{stream_name}/{date_key}: \
             enqueue {n} orphan `.bf` for deletion failed: {e}"
        );
    } else {
        log::info!(
            "[BLOOM_CLEANUP] {org_id}/{stream_type}/{stream_name}/{date_key}: \
             enqueued {n} orphan `.bf` for deletion"
        );
    }
    Ok(())
}
