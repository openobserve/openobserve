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

//! Post-merge bloom filter build.
//!
//! Triggered from inside each `merge_by_stream` worker after its
//! per-(stream, hour-prefix) merge work finishes. Reads every file
//! in the bucket from `file_list`, opens each `.ttv`, iterates the
//! configured bloom-target fields' term dictionaries, packs the
//! resulting blooms into one `.bf`, uploads it, and bulk-updates
//! `bloom_ver` on the file_list rows.
//!
//! Concurrency model is the file_list_dump pattern: no explicit
//! lock — the compactor's job scheduler already pins one worker per
//! `(stream, partition_prefix)`, and within that worker we run the
//! build sequentially after the merges complete.
//!
//! Failure is **always non-fatal**. A failed bloom build leaves
//! `bloom_ver = 0` on the just-merged files and the search side
//! falls back to opening every tantivy file in the bucket — same
//! behavior as before this feature existed. There is no periodic
//! retry: `bloom_ver = 0` is overloaded (waiting / failed / no
//! contribution / feature off when ingested), so a scan-based catchup
//! can't tell those apart. Coverage gaps caused by config changes are
//! handled by an out-of-band backfill CLI (see DESIGN.md).

use std::{collections::HashSet, sync::Arc};

use anyhow::Context;
use bytes::Bytes;
use config::{
    get_config,
    meta::stream::{FileKey, StreamType},
    utils::{inverted_index::convert_parquet_file_name_to_tantivy_file, time::now_micros},
};
use infra::{
    bloom::{BloomWriter, FieldBloom, path::bloom_path},
    file_list as infra_file_list, storage,
};
use tantivy::Directory;
use tantivy_utils::puffin_directory::{
    caching_directory::CachingDirectory, footer_cache::FooterCache,
};

use crate::service::{
    search::grpc::storage::get_tantivy_directory, tantivy::bloom_builder::build_blooms_from_index,
};

/// Build the bloom file for one (stream, date_key) bucket.
///
/// `date_key` is the `YYYY/MM/DD/HH` string used in `file_list.date`.
///
/// Returns `Ok(())` even when no bloom is built (e.g. nothing changed,
/// no target fields configured, build hit a recoverable error). The
/// caller should not propagate failures to user requests.
pub async fn build_for_bucket(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_key: &str,
) -> anyhow::Result<()> {
    let cfg = get_config();
    if !cfg.common.bloom_filter_enabled {
        return Ok(());
    }

    // Resolve target fields from current stream settings.
    let stream_settings = infra::schema::get_settings(org_id, stream_name, stream_type).await;
    let bloom_filter_fields =
        infra::schema::get_stream_setting_bloom_filter_fields(&stream_settings);
    if bloom_filter_fields.is_empty() {
        return Ok(());
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
        return Ok(());
    }

    // Pull every file currently in this hour bucket.
    let date_range = (date_key.to_string(), date_key.to_string());
    let files = infra_file_list::query_for_merge(org_id, stream_type, stream_name, date_range)
        .await
        .context("query_for_merge for bloom build")?;
    if files.is_empty() {
        return Ok(());
    }

    // Trigger: rebuild only when **at least one file has bloom_ver=0**
    // (i.e., new data needs blooming). A bucket where every file already
    // has a non-zero bloom_ver — even if those values differ across files
    // (e.g., older rows already dumped at one version, newer rows
    // produced by a later compaction round at another) — has nothing
    // new to do here. The search side handles mixed `bloom_ver` natively
    // by grouping per (date, bloom_ver) and fetching each `.bf`.
    //
    // This is the key invariant that prevents `.bf` orphaning: rebuild
    // never re-stamps an already-stamped file, so no live row ever
    // moves off a `bloom_ver` while a dumped row may still point to it.
    let any_zero = files.iter().any(|f| f.meta.bloom_ver == 0);
    if !any_zero {
        log::debug!(
            "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: every file already has a bloom_ver, skipping ({} files)",
            files.len()
        );
        return Ok(());
    }

    // Build blooms only for the *new* files (bloom_ver = 0). Existing
    // files keep their assigned bloom_ver and continue to reference
    // their original `.bf` (append-only — never re-stamp a blessed row).
    //
    // **Sub-grouping**: a single hour can hold thousands of files. Since
    // the transposed `.bf` holds every file's SBBF in memory before
    // serialize (M × B × 32 bytes), one giant `.bf` would OOM the
    // compactor at high volume (e.g. 1000 files × 16 MB = 16 GB). So we
    // split the new files into chunks of at most `max_files_per_bf` and
    // write one `.bf` per chunk, each with its own `bloom_ver`. The
    // search side already groups by `(date, bloom_ver)`, so it naturally
    // reads one block-row per chunk. Read bytes stay `M × 32` total; only
    // the request count grows to `ceil(M / max_files_per_bf)`.
    //
    // Files are sorted by record count first so similar-sized files share
    // a chunk — this minimizes the uniform-`B` padding waste (B is sized
    // to each chunk's max cardinality).
    const BLOOM_BUILD_FPP: f64 = 0.01;
    let max_files_per_bf = cfg.common.bloom_filter_max_files_per_bf.max(1);

    let mut new_files: Vec<&FileKey> = files.iter().filter(|f| f.meta.bloom_ver == 0).collect();
    new_files.sort_by(|a, b| b.meta.records.cmp(&a.meta.records));

    let base_ver = now_micros();
    let mut wrote_any = false;
    let mut total_covered = 0usize;
    let chunk_total = new_files.len().div_ceil(max_files_per_bf);

    for (chunk_idx, chunk) in new_files.chunks(max_files_per_bf).enumerate() {
        // B for this chunk is sized from the chunk's MAX record count, used
        // as a safe NDV upper bound: a file can't hold more distinct values
        // than rows. This never under-sizes (no saturation) for the target
        // high-cardinality fields where distinct ≈ rows. It over-sizes for
        // fields that repeat heavily (distinct ≪ rows) — acceptable for a
        // POC; exact sizing would read each file's tantivy term count in a
        // pre-pass to pick max distinct instead of max rows.
        let max_records = chunk
            .iter()
            .map(|f| f.meta.records.max(0) as u64)
            .max()
            .unwrap_or(0)
            .max(1);
        let num_blocks = infra::bloom::num_blocks_for(max_records, BLOOM_BUILD_FPP);

        let mut all_blooms: Vec<FieldBloom> = Vec::new();
        let mut contributing_ids: Vec<i64> = Vec::new();
        for f in chunk {
            match build_blooms_for_file(f, &target_fields, num_blocks).await {
                Ok(mut blooms) if !blooms.is_empty() => {
                    all_blooms.append(&mut blooms);
                    contributing_ids.push(f.id);
                }
                Ok(_) => {} // no blooms (no index / field absent) — leave at 0
                Err(e) => {
                    log::warn!("[BLOOM_BUILD] skipping {} (bloom build failed): {e}", f.key);
                }
            }
        }
        if all_blooms.is_empty() {
            continue;
        }

        // Distinct bloom_ver per chunk (base + idx) → distinct `.bf` path.
        let bloom_ver = base_ver + chunk_idx as i64;
        let blob = match BloomWriter::serialize(all_blooms) {
            Ok(b) => b,
            Err(e) => {
                log::warn!(
                    "[BLOOM_BUILD] serialize failed for {org_id}/{stream_type}/{stream_name}/{date_key} chunk {chunk_idx}: {e}"
                );
                config::metrics::BLOOM_FILE_BUILD_FAILED_TOTAL
                    .with_label_values(&[org_id, stream_type.as_str(), "serialize"])
                    .inc();
                continue;
            }
        };
        let bf_path = bloom_path(org_id, stream_type, stream_name, date_key, bloom_ver);
        let bf_account = storage::get_account(org_id, &bf_path).unwrap_or_default();
        if let Err(e) = storage::put(&bf_account, &bf_path, Bytes::from(blob)).await {
            log::warn!("[BLOOM_BUILD] upload {bf_path} failed: {e}");
            config::metrics::BLOOM_FILE_BUILD_FAILED_TOTAL
                .with_label_values(&[org_id, stream_type.as_str(), "upload"])
                .inc();
            continue;
        }

        debug_assert!(
            contributing_ids.iter().all(|id| *id > 0),
            "bloom builder must only stamp file_list rows with assigned ids"
        );
        if let Err(e) = infra_file_list::update_bloom_ver(&contributing_ids, bloom_ver).await {
            log::warn!(
                "[BLOOM_BUILD] update_bloom_ver failed for {org_id}/{stream_type}/{stream_name}/{date_key} chunk {chunk_idx}: {e}"
            );
            config::metrics::BLOOM_FILE_BUILD_FAILED_TOTAL
                .with_label_values(&[org_id, stream_type.as_str(), "update_file_list"])
                .inc();
            continue;
        }

        config::metrics::BLOOM_FILE_BUILT_TOTAL
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc();
        total_covered += contributing_ids.len();
        wrote_any = true;
        log::debug!(
            "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: wrote {bf_path} (chunk {}/{chunk_total}, num_blocks={num_blocks}) covering {} file(s)",
            chunk_idx + 1,
            contributing_ids.len(),
        );
    }

    if !wrote_any {
        log::debug!(
            "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: no blooms produced from {} new file(s); skipping",
            new_files.len()
        );
        return Ok(());
    }
    log::info!(
        "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: wrote {chunk_total} `.bf`(s) covering {total_covered} new file(s) (out of {} in bucket, max {max_files_per_bf}/bf)",
        files.len()
    );

    Ok(())
}

async fn build_blooms_for_file(
    file: &FileKey,
    target_fields: &[String],
    num_blocks: u32,
) -> anyhow::Result<Vec<FieldBloom>> {
    let Some(ttv_file_name) = convert_parquet_file_name_to_tantivy_file(&file.key) else {
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
        .await
        .context("open puffin dir")?,
    );
    let footer_cache = FooterCache::from_directory(puffin_dir.clone(), &ttv_file_name).await?;
    let cache_dir = CachingDirectory::new_with_cacher(puffin_dir, Arc::new(footer_cache));
    let reader_directory: Box<dyn Directory> = Box::new(cache_dir);
    let index = tantivy::Index::open(reader_directory)?;

    // file.id is the file_list row id, assigned by the INSERT that
    // happened in `write_file_list` before this build runs. Always > 0
    // by the time we get here.
    let file_id = file.id as u64;
    build_blooms_from_index(&index, file_id, target_fields, num_blocks).await
}
