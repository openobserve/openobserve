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

//! Search-side bloom prune layer.
//!
//! Given a candidate `Vec<FileKey>` returned by `file_list` and the
//! bloom-prunable predicates extracted by [`super::bloom_predicate`],
//! this module:
//!
//! 1. Splits files into "has bloom" (`bloom_ver != 0`) and "no bloom" (`bloom_ver == 0`). The
//!    latter pass through untouched.
//! 2. Groups "has bloom" files by `(date, bloom_ver)` so that all files sharing a `.bf` are tested
//!    with one fetch.
//! 3. For each group, **fetches only the bytes the query needs**. On a cache hit we read the full
//!    blob from cache (same cost as a slice). On a cache miss we issue a single suffix-range
//!    request that brings back the footer plus the trailing body region, then `get_range` the
//!    remaining body slices for just the `(field, file_id)` pairs in the query. Filling the cache
//!    with the full file is delegated to `file_downloader` so the synchronous path never blocks on
//!    a full-file GET.
//! 4. For each file, evaluates the predicates: a file is kept iff **every** predicate's bloom
//!    returns *maybe* for **at least one** of its values (OR within a predicate, AND across
//!    predicates).
//!
//! Any failure (fetch, parse, schema mismatch) **falls back to "keep
//! all"** for the affected group — bloom is performance, not correctness.

use std::{collections::HashMap, ops::Range};

use config::meta::stream::{FileKey, StreamType};
use futures::stream::{self, StreamExt};
use infra::{
    bloom::{BLOOM_FOOTER_CACHE, BloomReader, MAGIC, VERSION, path::bloom_path},
    cache::{file_data, storage as cache_storage},
};
use object_store::{GetOptions, GetRange};

use super::bloom_predicate::BloomPredicate;

/// Cap on simultaneous in-flight `.bf` GETs from a single `prune` call.
/// A 30-day high-cardinality query may touch ~720 buckets; firing them
/// all at once would burst the object store and the local socket pool.
/// 32 is conservative enough to coexist with parquet/tantivy fetches
/// that run in the same query.
const BLOOM_PREFETCH_CONCURRENCY: usize = 32;

/// Bytes pulled from the tail of a `.bf` on cache miss. Big enough to
/// cover the footer payload for hour buckets up to ~150 indexed files
/// (footer ≈ 24 B per file × 3 typical fields + per-field header ≈ 7.5
/// KB at the high end). When the actual footer overflows this probe,
/// `BloomReader::parse` rejects the partial blob and we fall back to a
/// "keep all" decision for the group — cheaper than a re-fetch given
/// that this is the FPR limit, not correctness.
const BLOOM_SUFFIX_PROBE_BYTES: u64 = 16 * 1024;

/// When fetching body slices, merge two ranges that are within this many
/// bytes of each other into one GET. Same-field SBBFs are physically
/// adjacent in the body (see writer layout), so a single-field query
/// typically coalesces all ranges into one request.
const BLOOM_RANGE_COALESCE_GAP: u64 = 16 * 1024;

/// Prune `files` against `predicates`, returning the surviving subset.
/// Files with `bloom_ver == 0` are always kept (no bloom info).
///
/// `trace_id` is threaded through to background cache-fill jobs so they
/// log with the same trace identifier as the originating query.
pub async fn prune(
    files: Vec<FileKey>,
    predicates: &[BloomPredicate],
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Vec<FileKey> {
    if predicates.is_empty() {
        return files;
    }

    // 1. Split.
    let mut without_bloom: Vec<FileKey> = Vec::new();
    let mut with_bloom: Vec<FileKey> = Vec::with_capacity(files.len());
    for f in files {
        if f.meta.bloom_ver == 0 {
            without_bloom.push(f);
        } else {
            with_bloom.push(f);
        }
    }
    if with_bloom.is_empty() {
        return without_bloom;
    }

    // 2. Group by (date, bloom_ver). The date is the YYYY/MM/DD/HH bucket embedded in the parquet
    //    key.
    type Group = (String, i64); // (date, bloom_ver)
    let mut groups: HashMap<Group, Vec<usize>> = HashMap::new();
    let mut date_for: Vec<Option<String>> = vec![None; with_bloom.len()];
    for (i, f) in with_bloom.iter().enumerate() {
        let date = match config::utils::parquet::parse_file_key_columns(&f.key) {
            Ok((_, d, _)) => d,
            Err(_) => continue, // unparseable key → keep file (handled below)
        };
        date_for[i] = Some(date.clone());
        groups.entry((date, f.meta.bloom_ver)).or_default().push(i);
    }

    // 3. Per-group fetch spec. Compute the (field, file_id) targets up front so the async closure
    //    has everything it needs to do a partial read.
    struct GroupSpec {
        group: Group,
        account: String,
        path: String,
        targets: Vec<(String, u64)>,
    }
    let specs: Vec<GroupSpec> = groups
        .into_iter()
        .map(|((date, ver), idxs)| {
            let path = bloom_path(org_id, stream_type, stream_name, &date, ver);
            let account = infra::storage::get_account(org_id, &path).unwrap_or_default();
            let mut targets: Vec<(String, u64)> = Vec::with_capacity(idxs.len() * predicates.len());
            for i in idxs {
                let file_id = with_bloom[i].id as u64;
                for pred in predicates {
                    targets.push((pred.field.clone(), file_id));
                }
            }
            GroupSpec {
                group: (date, ver),
                account,
                path,
                targets,
            }
        })
        .collect();

    // 4. Fetch per group, bounded. Each closure does the cache probe + suffix probe + per-target
    //    body fetch inline so the worst-case fanout is still capped by BLOOM_PREFETCH_CONCURRENCY.
    let trace_id = trace_id.to_string();
    let fetched: Vec<(Group, String, Result<BloomReader, FetchError>)> = stream::iter(specs)
        .map(|spec| {
            let trace_id = trace_id.clone();
            async move {
                let res =
                    fetch_bloom_reader(&trace_id, &spec.account, &spec.path, &spec.targets).await;
                (spec.group, spec.path, res)
            }
        })
        .buffer_unordered(BLOOM_PREFETCH_CONCURRENCY)
        .collect()
        .await;

    let mut readers: HashMap<Group, BloomReader> = HashMap::new();
    for (group, path, result) in fetched {
        match result {
            Ok(r) => {
                readers.insert(group, r);
            }
            Err(e) => {
                log::warn!("[bloom-prune] fetch {path} failed: {e}; keeping its files");
            }
        }
    }

    // 4. Evaluate. Default = keep. Only drop if every predicate of the file is definitively
    //    excluded by the bloom.
    let mut kept = without_bloom;
    for (idx, f) in with_bloom.into_iter().enumerate() {
        let date = match date_for[idx].as_ref() {
            Some(d) => d.clone(),
            None => {
                kept.push(f);
                continue;
            }
        };
        let group = (date, f.meta.bloom_ver);
        let reader = match readers.get(&group) {
            Some(r) => r,
            None => {
                kept.push(f);
                continue;
            }
        };
        // file_list.id is what the compactor stamped into the .bf footer.
        let file_id = f.id as u64;
        let mut all_match = true;
        for pred in predicates {
            // OR within predicate values: any value's bloom-maybe keeps it.
            let mut any_match = false;
            for v in &pred.values {
                match reader.check(&pred.field, file_id, v.as_bytes()) {
                    Ok(true) => {
                        any_match = true;
                        break;
                    }
                    Ok(false) => {} // try next value
                    Err(e) => {
                        // Corrupt bloom for this (field, file_id). Bump
                        // a counter once per occurrence and conservatively
                        // keep — the alternative would silently drop a
                        // file that might really match.
                        log::warn!(
                            "[bloom-prune] check failed field={} file_id={file_id}: {e:?}; keeping file conservatively",
                            pred.field
                        );
                        config::metrics::BLOOM_CHECK_ERRORS_TOTAL
                            .with_label_values(&[org_id, stream_type.as_str()])
                            .inc();
                        any_match = true;
                        break;
                    }
                }
            }
            if !any_match {
                all_match = false;
                break;
            }
        }
        if all_match {
            kept.push(f);
        }
    }
    kept
}

/// Errors observable by the per-group fetch helper. Folded into a
/// `log::warn` + "keep all" in the prune loop — never surfaced to the
/// query caller.
#[derive(Debug, thiserror::Error)]
enum FetchError {
    #[error("object store: {0}")]
    Store(#[from] object_store::Error),
    #[error("bloom parse: {0:?}")]
    Parse(infra::bloom::ReadError),
}

/// Fetch a `BloomReader` for one (stream, date, bloom_ver) bucket, using
/// the minimum bytes the given `targets` require.
///
/// Path:
/// 1. Cache probe for the full blob. If hit → parse full blob and return. (The cache already paid
///    the cost; partial-read on a hit would be silly local IO.)
/// 2. Cache miss → one `GetRange::Suffix(BLOOM_SUFFIX_PROBE_BYTES)` GET. Brings back the footer +
///    tail of body, and `GetResult.meta.size` tells us the total file length (so no separate `head`
///    request).
/// 3. If the suffix covers the whole file (small `.bf`), parse it.
/// 4. Otherwise: build a partial blob (header + zeros + suffix), parse the footer, compute body
///    ranges for `targets`, drop ranges already inside the suffix, coalesce remaining ranges, fetch
///    them via `get_range`, splice into the reader's blob.
/// 5. Whether or not partial fetch ran, enqueue a background download of the full file. Subsequent
///    queries take the cache-hit path.
async fn fetch_bloom_reader(
    trace_id: &str,
    account: &str,
    path: &str,
    targets: &[(String, u64)],
) -> Result<BloomReader, FetchError> {
    // Stage A: cache-only probe for the whole blob.
    if let Ok(get_result) = file_data::get_opts(
        account,
        path,
        GetOptions::default(),
        // remote
        false,
    )
    .await
    {
        let total = get_result.meta.size;
        let bytes = get_result
            .bytes()
            .await
            .map_err(|e| object_store::Error::Generic {
                store: "bloom",
                source: Box::new(e),
            })?;
        if bytes.len() as u64 == total {
            return BloomReader::parse(bytes.to_vec()).map_err(FetchError::Parse);
        }
        // Length mismatch is unexpected on a cache hit; fall through to
        // the cache-miss path rather than parsing a truncated blob.
        log::debug!(
            "[bloom-prune] cache hit size mismatch on {path}: got {} of {total}; refetching",
            bytes.len()
        );
    }

    // Stage B: footer cache hit avoids the suffix GET entirely. `.bf`
    // files are immutable (append-only `bloom_ver` in the path), so the
    // cached suffix bytes stay valid for the lifetime of the file.
    let (total_size, suffix_bytes) = if let Some((total, suffix)) = BLOOM_FOOTER_CACHE.get(path) {
        (total as usize, suffix)
    } else {
        // Stage C: miss everywhere. One `GetRange::Suffix(N)` brings
        // back the footer + tail of body; meta.size is the total file
        // length, so no separate head request.
        let opts = GetOptions {
            range: Some(GetRange::Suffix(BLOOM_SUFFIX_PROBE_BYTES)),
            ..Default::default()
        };
        let suffix_result = cache_storage::get_opts(account, &path.into(), opts).await?;
        let total = suffix_result.meta.size;
        let suffix = suffix_result.bytes().await?;
        BLOOM_FOOTER_CACHE.put(path.to_string(), total, suffix.clone());
        (total as usize, suffix)
    };

    // Schedule a background full-file download so future prune calls
    // touching this `.bf` get a Stage A hit. Failure here is non-fatal —
    // we already have what this query needs.
    enqueue_full_download(trace_id, account, path, total_size as i64).await;

    // Small `.bf` — suffix covers everything.
    if suffix_bytes.len() >= total_size {
        let mut blob = suffix_bytes.to_vec();
        // GetRange::Suffix may technically over-deliver if the server
        // returned more than requested; clamp defensively.
        blob.truncate(total_size);
        return BloomReader::parse(blob).map_err(FetchError::Parse);
    }

    // Build a partial blob: header + zeros + suffix tail.
    let mut blob = vec![0u8; total_size];
    blob[..MAGIC.len()].copy_from_slice(MAGIC);
    blob[MAGIC.len()] = VERSION;
    let suffix_start = total_size - suffix_bytes.len();
    blob[suffix_start..].copy_from_slice(&suffix_bytes);
    let mut reader = BloomReader::parse(blob).map_err(FetchError::Parse)?;

    // Compute body ranges for our targets; drop ranges that are
    // already inside the suffix tail (covered by the splice above).
    let target_refs = targets.iter().map(|(f, id)| (f.as_str(), *id));
    let mut needed: Vec<Range<u64>> = reader
        .body_ranges_for(target_refs)
        .into_iter()
        .filter(|r| r.start < suffix_start as u64)
        .collect();
    if needed.is_empty() {
        return Ok(reader);
    }

    // Coalesce adjacent ranges. Writer lays out same-field SBBFs
    // contiguously, so a single-field query usually collapses into one
    // GET — even for 100+ files in the bucket.
    needed.sort_by_key(|r| r.start);
    let merged = coalesce_ranges(needed, BLOOM_RANGE_COALESCE_GAP);

    for r in &merged {
        let bytes = cache_storage::get_range(account, &path.into(), r.clone()).await?;
        reader.splice_body_bytes(r.start, &bytes);
    }

    Ok(reader)
}

/// Merge adjacent or near-adjacent ranges so we issue one GET instead of
/// many. Caller must pre-sort by `start`.
fn coalesce_ranges(ranges: Vec<Range<u64>>, max_gap: u64) -> Vec<Range<u64>> {
    let mut out: Vec<Range<u64>> = Vec::with_capacity(ranges.len());
    for r in ranges {
        match out.last_mut() {
            Some(last) if r.start <= last.end.saturating_add(max_gap) => {
                last.end = last.end.max(r.end);
            }
            _ => out.push(r),
        }
    }
    out
}

/// Best-effort enqueue of a full-blob download to fill the cache. Mirrors
/// what `service::search::grpc::storage::cache_files` does for parquet —
/// keeps the synchronous prune path off the slow path while still
/// guaranteeing the next query hits the cache.
async fn enqueue_full_download(trace_id: &str, account: &str, path: &str, size: i64) {
    let cfg = config::get_config();
    let cache_type = if cfg.disk_cache.enabled {
        file_data::CacheType::Disk
    } else if cfg.memory_cache.enabled {
        file_data::CacheType::Memory
    } else {
        return;
    };
    // ts drives the priority-queue gate in file_downloader (recent files
    // go on the priority queue). `.bf` files are tied to a specific
    // hour, but we don't have that info handy here without re-parsing
    // the path; use 0 → normal queue. This is best-effort cache fill,
    // not a query-blocking task.
    if let Err(e) = crate::job::queue_download(
        trace_id.to_string(),
        0, // no file_list row id for `.bf`
        account.to_string(),
        path.to_string(),
        size,
        0,
        cache_type,
    )
    .await
    {
        log::debug!("[bloom-prune] enqueue full download for {path} failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{FileKey, FileMeta};
    use infra::bloom::{BloomBuilder, BloomReader, BloomWriter};

    use super::*;

    fn fk(key: &str, bloom_ver: i64) -> FileKey {
        let mut k = FileKey::new(0, "default".into(), key.into(), FileMeta::default(), false);
        k.meta.bloom_ver = bloom_ver;
        k
    }

    /// Builds a `.bf` blob with two file_list ids and one indexed field,
    /// then evaluates the predicates directly against the parsed reader
    /// the same way `prune()` does (without going through the
    /// `file_data::get` ladder, which would need an object-store backend).
    /// This nails down the writer→reader→predicate-evaluation contract.
    #[test]
    fn test_writer_reader_predicate_contract() {
        // Pretend these are the file_list row ids the compactor stamped
        // into the .bf footer.
        let id_a: u64 = 101;
        let id_b: u64 = 102;

        let mut bb = BloomBuilder::new();
        let i_a = bb.begin(id_a, "trace_id", 100);
        bb.insert(i_a, b"present-A");
        let i_b = bb.begin(id_b, "trace_id", 100);
        bb.insert(i_b, b"present-B");
        let blob = BloomWriter::serialize(bb.finish()).unwrap();
        let r = BloomReader::parse(blob).unwrap();

        // Predicate matching only file A
        let pred = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["present-A".into()],
        };
        // file A: any value matches → kept
        assert!(
            pred.values
                .iter()
                .any(|v| r.check(&pred.field, id_a, v.as_bytes()).unwrap())
        );
        // file B: no value matches → would be dropped
        assert!(
            !pred
                .values
                .iter()
                .any(|v| r.check(&pred.field, id_b, v.as_bytes()).unwrap())
        );

        // IN list with one present + one absent → still kept (any-of within
        // a predicate)
        let pred_in = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["present-A".into(), "absent-X".into()],
        };
        assert!(
            pred_in
                .values
                .iter()
                .any(|v| r.check(&pred_in.field, id_a, v.as_bytes()).unwrap())
        );

        // Multi-predicate AND: every predicate must hit
        let pred_other = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["absent-Z".into()],
        };
        let preds = [pred.clone(), pred_other];
        let kept = preds.iter().all(|p| {
            p.values
                .iter()
                .any(|v| r.check(&p.field, id_a, v.as_bytes()).unwrap())
        });
        assert!(!kept, "AND of preds where one fully misses must drop");
    }

    #[tokio::test]
    async fn test_files_without_bloom_pass_through() {
        // bloom_ver = 0 → never touched, never dropped.
        let files = vec![
            fk("files/o/logs/s/2026/05/08/14/a.parquet", 0),
            fk("files/o/logs/s/2026/05/08/14/b.parquet", 0),
        ];
        let preds = vec![BloomPredicate {
            field: "trace_id".into(),
            values: vec!["x".into()],
        }];
        let kept = prune(files.clone(), &preds, "tid", "o", StreamType::Logs, "s").await;
        assert_eq!(kept.len(), files.len());
    }

    #[tokio::test]
    async fn test_no_predicates_keeps_everything() {
        let files = vec![fk("files/o/logs/s/2026/05/08/14/a.parquet", 123)];
        let kept = prune(files.clone(), &[], "tid", "o", StreamType::Logs, "s").await;
        assert_eq!(kept.len(), 1);
    }

    #[tokio::test]
    async fn test_missing_bf_keeps_all_files_in_group() {
        // bloom_ver = nonzero but the .bf doesn't exist in storage → degrade.
        let files = vec![fk("files/o/logs/missing/2026/05/08/14/a.parquet", 9_999)];
        let preds = vec![BloomPredicate {
            field: "trace_id".into(),
            values: vec!["x".into()],
        }];
        let kept = prune(
            files.clone(),
            &preds,
            "tid",
            "o",
            StreamType::Logs,
            "missing",
        )
        .await;
        assert_eq!(kept.len(), 1);
    }

    #[tokio::test]
    async fn test_unparseable_key_kept() {
        // Defensive: pathological keys shouldn't take the file out — they
        // just bypass bloom evaluation.
        let files = vec![fk("not-a-files-path", 1234)];
        let preds = vec![BloomPredicate {
            field: "trace_id".into(),
            values: vec!["x".into()],
        }];
        let kept = prune(files, &preds, "tid", "o", StreamType::Logs, "s").await;
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn test_coalesce_ranges_merges_within_gap() {
        let ranges = vec![10..20, 25..40, 100..120, 130..140];
        let merged = coalesce_ranges(ranges, 16);
        // [10..20, 25..40] merge (gap 5); [100..120, 130..140] merge (gap 10);
        // [40..100] gap 60 > 16, stays split.
        assert_eq!(merged, vec![10..40, 100..140]);
    }

    #[test]
    fn test_coalesce_ranges_keeps_distant_ranges() {
        let ranges = vec![0..10, 1000..1100];
        let merged = coalesce_ranges(ranges, 16);
        assert_eq!(merged, vec![0..10, 1000..1100]);
    }
}
