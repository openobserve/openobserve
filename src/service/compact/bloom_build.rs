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
    meta::stream::{FileKey, FileListDeleted, StreamType},
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

    // Cheap early-out: if every file already shares the same non-zero
    // bloom_ver and no zero rows are present, nothing changed since the
    // last build. Skip the rebuild.
    let any_zero = files.iter().any(|f| f.meta.bloom_ver == 0);
    if !any_zero {
        let mut iter = files.iter().map(|f| f.meta.bloom_ver);
        let first = iter.next().unwrap();
        if iter.all(|v| v == first) {
            log::debug!(
                "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: nothing changed, skipping ({} files at bloom_ver={first})",
                files.len()
            );
            return Ok(());
        }
    }

    // Iterate term dicts for every file. Each `.ttv` open is one object-
    // store fetch (cached on disk after the first hit). Errors per file
    // are logged and skipped — partial bloom is better than no bloom.
    let mut all_blooms: Vec<FieldBloom> = Vec::new();
    let mut covered: usize = 0;
    for f in &files {
        match build_blooms_for_file(f, &target_fields).await {
            Ok(mut blooms) if !blooms.is_empty() => {
                all_blooms.append(&mut blooms);
                covered += 1;
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
            "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: no blooms produced from {} file(s); skipping",
            files.len()
        );
        return Ok(());
    }

    // Pack + upload.
    let bloom_ver = now_micros();
    let blob = BloomWriter::serialize(all_blooms);
    let bf_path = bloom_path(org_id, stream_type, stream_name, date_key, bloom_ver);
    let bf_account = storage::get_account(&bf_path).unwrap_or_default();
    if let Err(e) = storage::put(&bf_account, &bf_path, Bytes::from(blob)).await {
        log::warn!("[BLOOM_BUILD] upload {bf_path} failed: {e}");
        return Ok(());
    }

    // Bulk update file_list. Capture the *previous* distinct bloom_vers
    // (excluding 0 and the new value) so we can enqueue the now-orphaned
    // `.bf`s for delete.
    let ids: Vec<i64> = files.iter().map(|f| f.id).collect();
    let old_bloom_vers: HashSet<i64> = files
        .iter()
        .map(|f| f.meta.bloom_ver)
        .filter(|v| *v != 0 && *v != bloom_ver)
        .collect();
    if let Err(e) = infra_file_list::update_bloom_ver(&ids, bloom_ver).await {
        log::warn!(
            "[BLOOM_BUILD] update_bloom_ver failed for {org_id}/{stream_type}/{stream_name}/{date_key}: {e}"
        );
        return Ok(());
    }

    config::metrics::BLOOM_FILE_BUILT_TOTAL
        .with_label_values(&[org_id, stream_type.as_str()])
        .inc();
    log::info!(
        "[BLOOM_BUILD] {org_id}/{stream_type}/{stream_name}/{date_key}: wrote {bf_path} covering {covered}/{} files; superseded {} old version(s)",
        files.len(),
        old_bloom_vers.len()
    );

    // Best-effort: enqueue obsolete `.bf` paths for deletion via the
    // existing `file_list_deleted` cleanup pipeline.
    enqueue_obsolete_bloom_paths(org_id, stream_type, stream_name, date_key, &old_bloom_vers).await;

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

/// Enqueue the parquet-format `.bf` paths whose `bloom_ver` is no
/// longer referenced by any file_list row in this bucket. The existing
/// `file_list_deleted` worker eventually removes them from object
/// storage. Failures here are logged-only (orphaned `.bf` only wastes
/// storage; nothing breaks).
async fn enqueue_obsolete_bloom_paths(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_key: &str,
    old_bloom_vers: &HashSet<i64>,
) {
    if old_bloom_vers.is_empty() {
        return;
    }
    let items: Vec<FileListDeleted> = old_bloom_vers
        .iter()
        .map(|ver| {
            let path = bloom_path(org_id, stream_type, stream_name, date_key, *ver);
            let account = storage::get_account(&path).unwrap_or_default();
            FileListDeleted {
                id: 0,
                account,
                file: path,
                index_file: false,
                flattened: false,
            }
        })
        .collect();
    if let Err(e) = infra_file_list::batch_add_deleted(org_id, now_micros(), &items).await {
        log::warn!(
            "[BLOOM_BUILD] failed to enqueue {} obsolete bloom file(s) for delete: {e}",
            items.len()
        );
    }
}
