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
//! behavior as before this feature existed.

use std::collections::HashSet;

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
    // their original `.bf`. This is what makes the layer
    // **append-only**: we never re-stamp a previously-blessed row, so
    // dumped rows that point at an older `bloom_ver` always have their
    // `.bf` preserved (no rebuild ever supersedes it).
    //
    // Files we couldn't build for (or that produced no blooms because
    // the field isn't in their schema) keep `bloom_ver = 0` so search
    // doesn't pay a wasted `.bf` fetch only to find them missing.
    let mut all_blooms: Vec<FieldBloom> = Vec::new();
    let mut contributing_ids: Vec<i64> = Vec::new();
    let mut considered: usize = 0;
    for f in &files {
        if f.meta.bloom_ver != 0 {
            continue; // already stamped; do not touch
        }
        considered += 1;
        match build_blooms_for_file(f, &target_fields).await {
            Ok(mut blooms) if !blooms.is_empty() => {
                all_blooms.append(&mut blooms);
                contributing_ids.push(f.id);
            }
            Ok(_) => {
                // No blooms produced (no index, or fields not in this file's
                // schema). Not an error.
            }
            Err(e) => {
                log::warn!("[BLOOM_BUILD] skipping {} (bloom build failed): {e}", f.key);
            }
        }
    }
    if all_blooms.is_empty() {
        log::debug!(
            "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: no blooms produced from {considered} new file(s); skipping"
        );
        return Ok(());
    }

    // Pack + upload.
    let bloom_ver = now_micros();
    let blob = match BloomWriter::serialize(all_blooms) {
        Ok(b) => b,
        Err(e) => {
            log::warn!(
                "[BLOOM_BUILD] serialize failed for {org_id}/{stream_type}/{stream_name}/{date_key}: {e}"
            );
            config::metrics::BLOOM_FILE_BUILD_FAILED_TOTAL
                .with_label_values(&[org_id, stream_type.as_str(), "serialize"])
                .inc();
            return Ok(());
        }
    };
    let bf_path = bloom_path(org_id, stream_type, stream_name, date_key, bloom_ver);
    let bf_account = storage::get_account(&bf_path).unwrap_or_default();
    if let Err(e) = storage::put(&bf_account, &bf_path, Bytes::from(blob)).await {
        log::warn!("[BLOOM_BUILD] upload {bf_path} failed: {e}");
        config::metrics::BLOOM_FILE_BUILD_FAILED_TOTAL
            .with_label_values(&[org_id, stream_type.as_str(), "upload"])
            .inc();
        return Ok(());
    }

    // Stamp the contributing rows (and only those) with the new bloom_ver.
    let covered = contributing_ids.len();
    debug_assert!(
        contributing_ids.iter().all(|id| *id > 0),
        "bloom builder must only stamp file_list rows with assigned ids; \
         a 0 here means we ran the build before write_file_list — caller bug"
    );
    if let Err(e) = infra_file_list::update_bloom_ver(&contributing_ids, bloom_ver).await {
        log::warn!(
            "[BLOOM_BUILD] update_bloom_ver failed for {org_id}/{stream_type}/{stream_name}/{date_key}: {e}"
        );
        config::metrics::BLOOM_FILE_BUILD_FAILED_TOTAL
            .with_label_values(&[org_id, stream_type.as_str(), "update_file_list"])
            .inc();
        return Ok(());
    }

    config::metrics::BLOOM_FILE_BUILT_TOTAL
        .with_label_values(&[org_id, stream_type.as_str()])
        .inc();
    log::info!(
        "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: wrote {bf_path} covering {covered} new file(s) (out of {} in bucket)",
        files.len()
    );

    Ok(())
}

async fn build_blooms_for_file(
    file: &FileKey,
    target_fields: &[String],
) -> anyhow::Result<Vec<FieldBloom>> {
    let Some(ttv_path) = convert_parquet_file_name_to_tantivy_file(&file.key) else {
        return Ok(Vec::new()); // not an indexable file
    };
    if file.meta.index_size == 0 {
        return Ok(Vec::new()); // no .ttv was emitted
    }
    let dir = get_tantivy_directory(
        "bloom_build",
        &file.account,
        &ttv_path,
        file.meta.index_size,
    )
    .await
    .context("open puffin dir")?;
    let index = tantivy::Index::open(dir).context("open tantivy index")?;
    // file.id is the file_list row id, assigned by the INSERT that
    // happened in `write_file_list` before this build runs. Always > 0
    // by the time we get here.
    let file_id = file.id as u64;
    build_blooms_from_index(&index, file_id, target_fields, 0.01)
}

// NOTE: there is intentionally no per-rebuild `.bf` GC in this module.
// The append-only invariant (we never re-stamp a file that already has
// a non-zero `bloom_ver`) means a `.bf` that's referenced when written
// stays referenced for as long as any of its files exist — including
// after dump (dumped rows preserve `bloom_ver` and so still reference
// the original `.bf`). Deletion is left to the outer data-retention
// sweep that removes the entire `bloom/{org}/{stream}/{date}/`
// directory when the date partition itself ages out, alongside parquet
// and tantivy files.
