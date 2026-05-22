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

//! Search-side bloom prune layer — single-block point check.
//!
//! Given a candidate `Vec<FileKey>` and the bloom-prunable predicates
//! extracted by [`super::bloom_predicate`], this module:
//!
//! 1. Splits files into "has bloom" (`bloom_ver != 0`) and "no bloom" (`bloom_ver == 0`). The
//!    latter pass through untouched.
//! 2. Groups "has bloom" files by `(date, bloom_ver)` so all files sharing a `.bf` are tested with
//!    one footer fetch.
//! 3. For each group, fetches **only the bytes the query needs**:
//!    - footer cache hit → 0 GETs
//!    - footer cache miss → 1 suffix GET (16 KB)
//!    - then **one batched `get_ranges` call** that pulls every required 32-byte SBBF block for all
//!      `(file, value)` targets in the bucket. `cache_storage::get_ranges` internally coalesces
//!      adjacent ranges via `object_store::coalesce_ranges`.
//! 4. For each `(file_id, predicate value)`, runs the SBBF point check on the fetched 32-byte
//!    block. A file is kept iff every predicate's bloom returns *maybe* for at least one of its
//!    values (OR within a predicate, AND across predicates).
//!
//! Any failure (fetch, parse, schema mismatch) **falls back to "keep
//! all"** for the affected group — bloom is performance, not correctness.

use std::collections::HashMap;

use config::meta::stream::{FileKey, StreamType};
use futures::stream::{self, StreamExt};
use infra::{
    bloom::{BLOOM_FOOTER_CACHE, BloomReader, path::bloom_path, sbbf::BLOCK_BYTES},
    cache::storage as cache_storage,
};
use object_store::{GetOptions, GetRange};

use super::bloom_predicate::BloomPredicate;

/// Bytes pulled from the tail of a `.bf` on footer-cache miss. Big
/// enough to cover the footer payload for hour buckets up to ~150 indexed
/// (file, field) pairs (footer ≈ 24 B per file × few fields + per-field
/// header ≈ 7.5 KB at the high end). When the actual footer overflows
/// this probe, the group falls back to "keep all".
const BLOOM_SUFFIX_PROBE_BYTES: u64 = 16 * 1024;

/// Outer concurrency cap on `.bf` buckets processed in parallel.
///
/// Mirrors the tantivy search path (`storage.rs`): use the same
/// `query_thread_num` knob (defaults to `cpu_num * 4` in cluster mode,
/// `cpu_num` in local). No hardcoded constant — large multi-day
/// trace_id lookups need to fan out far beyond 32 buckets.
fn bloom_prefetch_concurrency() -> usize {
    config::get_config().limit.query_thread_num.max(1)
}

/// Prune `files` against `predicates`, returning the surviving subset.
/// Files with `bloom_ver == 0` are always kept (no bloom info).
///
/// `trace_id` is threaded through purely for logging.
pub async fn prune(
    files: Vec<FileKey>,
    predicates: &[BloomPredicate],
    _trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Vec<FileKey> {
    if predicates.is_empty() {
        return files;
    }

    // 1. Split files by whether they have a bloom_ver assigned.
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

    // 2. Group by (date, bloom_ver) — one .bf per group.
    type Group = (String, i64);
    let mut groups: HashMap<Group, Vec<usize>> = HashMap::new();
    let mut date_for: Vec<Option<String>> = vec![None; with_bloom.len()];
    for (i, f) in with_bloom.iter().enumerate() {
        let date = match config::utils::parquet::parse_file_key_columns(&f.key) {
            Ok((_, d, _)) => d,
            Err(_) => continue,
        };
        date_for[i] = Some(date.clone());
        groups.entry((date, f.meta.bloom_ver)).or_default().push(i);
    }

    // 3. Plan per-group work: target (file_idx, pred_idx, value_idx) tuples and the bytes each one
    //    needs. file_idx is into with_bloom for later result-folding.
    struct GroupSpec {
        group: Group,
        account: String,
        path: String,
        /// One entry per (file_idx, pred_idx, value_idx) tuple in this bucket.
        targets: Vec<TargetSpec>,
    }
    let specs: Vec<GroupSpec> = groups
        .into_iter()
        .map(|((date, ver), idxs)| {
            let path = bloom_path(org_id, stream_type, stream_name, &date, ver);
            let account = infra::storage::get_account(org_id, &path).unwrap_or_default();
            let mut targets: Vec<TargetSpec> = Vec::with_capacity(idxs.len() * predicates.len());
            for &i in &idxs {
                for (pi, pred) in predicates.iter().enumerate() {
                    for vi in 0..pred.values.len() {
                        targets.push(TargetSpec {
                            file_idx: i,
                            pred_idx: pi,
                            value_idx: vi,
                        });
                    }
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

    // 4. Run each group: fetch footer → compute 32-byte ranges → batched range GETs → run
    //    check_block per target. Outer concurrency is config-driven.
    let with_bloom_ref = &with_bloom;
    let concurrency = bloom_prefetch_concurrency();
    let results: Vec<(Group, GroupResult)> = stream::iter(specs)
        .map(|spec| async move {
            let group = spec.group.clone();
            let res = run_group(
                &spec.account,
                &spec.path,
                &spec.targets,
                predicates,
                with_bloom_ref,
            )
            .await;
            (group, res)
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    // 5. Fold per-group outcomes into a per-file "did every predicate match?" table. Default = keep
    //    (no info = conservative).
    let mut per_file_match: HashMap<usize, Vec<Vec<bool>>> = HashMap::new();
    for (_, result) in &results {
        match result {
            GroupResult::Ok(outcomes) => {
                for (file_idx, pred_idx, value_idx, hit) in outcomes {
                    let entry = per_file_match.entry(*file_idx).or_insert_with(|| {
                        predicates
                            .iter()
                            .map(|p| vec![false; p.values.len()])
                            .collect()
                    });
                    entry[*pred_idx][*value_idx] = *hit;
                }
            }
            GroupResult::Err(path, e) => {
                log::warn!("[bloom-prune] group {path} failed: {e}; keeping its files");
            }
        }
    }

    // Also fold "checked successfully but some predicate had no info" — those
    // files default to keep. We track this by recording which (file_idx, pred_idx)
    // pairs had at least one block_range_for hit. If a pair has no hits at all
    // for any of its values, we treat that predicate as "unknown" → keep file.
    let mut has_info: HashMap<usize, Vec<bool>> = HashMap::new();
    for (_, result) in &results {
        if let GroupResult::Ok(outcomes) = result {
            for (file_idx, pred_idx, ..) in outcomes {
                let entry = has_info
                    .entry(*file_idx)
                    .or_insert_with(|| vec![false; predicates.len()]);
                entry[*pred_idx] = true;
            }
        }
    }

    let mut kept = without_bloom;
    for (idx, f) in with_bloom.into_iter().enumerate() {
        if date_for[idx].is_none() {
            kept.push(f);
            continue;
        }
        let matches = match per_file_match.get(&idx) {
            Some(m) => m,
            None => {
                // Bucket failed entirely → keep.
                kept.push(f);
                continue;
            }
        };
        let info = has_info
            .get(&idx)
            .cloned()
            .unwrap_or_else(|| vec![false; predicates.len()]);

        // AND across predicates, OR within each predicate's values. A predicate
        // with no info (unknown field / unknown file_id) counts as "match".
        let all_match = predicates.iter().enumerate().all(|(pi, _)| {
            if !info[pi] {
                return true; // unknown → conservatively true
            }
            matches[pi].iter().any(|hit| *hit)
        });
        if all_match {
            kept.push(f);
        }
    }
    kept
}

/// One scheduled point check inside a group: a tuple identifying which
/// `(file, predicate, value)` it belongs to. The actual byte range and
/// hash are computed later, after the footer is parsed.
struct TargetSpec {
    file_idx: usize,
    pred_idx: usize,
    value_idx: usize,
}

/// Outcome of running one (date, bloom_ver) bucket. The `Ok` variant carries
/// one tuple per `(file_idx, pred_idx, value_idx)` whose block range was
/// resolvable; missing entries imply "no info" for that target and are
/// handled by the caller.
enum GroupResult {
    Ok(Vec<(usize, usize, usize, bool)>),
    Err(String, FetchError),
}

/// Errors observable by the per-group fetch helper. Folded into a `log::warn`
/// + "keep all" in the prune loop — never surfaced to the query caller.
#[derive(Debug, thiserror::Error)]
enum FetchError {
    #[error("object store: {0}")]
    Store(#[from] object_store::Error),
    #[error("bloom parse: {0:?}")]
    Parse(infra::bloom::ReadError),
    #[error("short block: expected {expected} got {got}")]
    ShortBlock { expected: usize, got: usize },
}

async fn run_group(
    account: &str,
    path: &str,
    targets: &[TargetSpec],
    predicates: &[BloomPredicate],
    with_bloom: &[FileKey],
) -> GroupResult {
    // Step 1: get the footer suffix bytes + total file size. Footer cache
    // first, then a single suffix-range GET on miss. `.bf` files are
    // immutable so cache entries are valid for the file's lifetime.
    let (total_size, suffix) = match get_footer_suffix(account, path).await {
        Ok(x) => x,
        Err(e) => return GroupResult::Err(path.to_string(), e),
    };

    let reader = match BloomReader::parse_suffix(&suffix, total_size) {
        Ok(r) => r,
        Err(e) => return GroupResult::Err(path.to_string(), FetchError::Parse(e)),
    };

    // Step 2: compute (range, hash) per target. Targets with no range
    // (unknown field/file in this .bf) are dropped from the planned work —
    // the absence is recorded later as "no info" by the caller.
    struct Planned {
        file_idx: usize,
        pred_idx: usize,
        value_idx: usize,
        range: std::ops::Range<u64>,
        hash: u64,
    }
    let mut planned: Vec<Planned> = Vec::with_capacity(targets.len());
    for t in targets {
        let pred = &predicates[t.pred_idx];
        let value = pred.values[t.value_idx].as_bytes();
        let file_id = with_bloom[t.file_idx].id as u64;
        if let Some((range, hash)) = reader.block_range_for(&pred.field, file_id, value) {
            planned.push(Planned {
                file_idx: t.file_idx,
                pred_idx: t.pred_idx,
                value_idx: t.value_idx,
                range,
                hash,
            });
        }
    }
    if planned.is_empty() {
        return GroupResult::Ok(Vec::new());
    }

    // Step 3: fetch all 32-byte blocks in one call. `get_ranges` internally
    // coalesces adjacent ranges via `object_store::coalesce_ranges` and
    // returns one `Bytes` per input range, in input order. For trace_id
    // queries each range is a separate 32 B block at random offsets inside
    // the SBBF — coalescing rarely merges, but the single API call still
    // saves N round trips of per-range overhead.
    let ranges: Vec<std::ops::Range<u64>> = planned.iter().map(|p| p.range.clone()).collect();
    let fetched = match cache_storage::get_ranges(account, &path.into(), &ranges).await {
        Ok(v) => v,
        Err(e) => return GroupResult::Err(path.to_string(), FetchError::Store(e)),
    };
    if fetched.len() != planned.len() {
        return GroupResult::Err(
            path.to_string(),
            FetchError::ShortBlock {
                expected: planned.len(),
                got: fetched.len(),
            },
        );
    }

    // Step 4: run check_block for each planned target against its 32-byte
    // block. Order matches `planned`.
    let mut outcomes: Vec<(usize, usize, usize, bool)> = Vec::with_capacity(planned.len());
    for (p, buf) in planned.iter().zip(fetched.iter()) {
        if buf.len() < BLOCK_BYTES {
            return GroupResult::Err(
                path.to_string(),
                FetchError::ShortBlock {
                    expected: BLOCK_BYTES,
                    got: buf.len(),
                },
            );
        }
        let block: &[u8; BLOCK_BYTES] = buf[..BLOCK_BYTES].try_into().unwrap();
        let hit = BloomReader::check_block_with_hash(block, p.hash);
        outcomes.push((p.file_idx, p.pred_idx, p.value_idx, hit));
    }

    GroupResult::Ok(outcomes)
}

/// Footer suffix retrieval: footer cache → suffix-range GET on miss.
/// Returns (total_size, suffix_bytes) in both branches.
async fn get_footer_suffix(account: &str, path: &str) -> Result<(u64, bytes::Bytes), FetchError> {
    if let Some((total, suffix)) = BLOOM_FOOTER_CACHE.get(path) {
        return Ok((total, suffix));
    }
    let opts = GetOptions {
        range: Some(GetRange::Suffix(BLOOM_SUFFIX_PROBE_BYTES)),
        ..Default::default()
    };
    let res = cache_storage::get_opts(account, &path.into(), opts).await?;
    let total = res.meta.size;
    let suffix = res.bytes().await?;
    BLOOM_FOOTER_CACHE.put(path.to_string(), total, suffix.clone());
    Ok((total, suffix))
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

    /// End-to-end: writer produces a `.bf`, reader's single-block API resolves
    /// the same membership the predicate logic expects.
    #[test]
    fn test_writer_reader_predicate_contract() {
        let id_a: u64 = 101;
        let id_b: u64 = 102;

        let mut bb = BloomBuilder::new();
        let i_a = bb.begin(id_a, "trace_id", 100);
        bb.insert(i_a, b"present-A");
        let i_b = bb.begin(id_b, "trace_id", 100);
        bb.insert(i_b, b"present-B");
        let blob = BloomWriter::serialize(bb.finish()).unwrap();
        let r = BloomReader::parse(&blob).unwrap();

        let check = |field: &str, file_id: u64, v: &[u8]| {
            let (range, h) = r.block_range_for(field, file_id, v).unwrap();
            let s = range.start as usize;
            let e = range.end as usize;
            let block: &[u8; BLOCK_BYTES] = blob[s..e].try_into().unwrap();
            BloomReader::check_block_with_hash(block, h)
        };

        let pred = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["present-A".into()],
        };
        // file A: any value matches → kept
        assert!(
            pred.values
                .iter()
                .any(|v| check(&pred.field, id_a, v.as_bytes()))
        );
        // file B: no value matches → would be dropped
        assert!(
            !pred
                .values
                .iter()
                .any(|v| check(&pred.field, id_b, v.as_bytes()))
        );

        // IN list with one present + one absent → still kept (OR within)
        let pred_in = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["present-A".into(), "absent-X".into()],
        };
        assert!(
            pred_in
                .values
                .iter()
                .any(|v| check(&pred_in.field, id_a, v.as_bytes()))
        );

        // AND across predicates: any all-miss drops
        let pred_other = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["absent-Z".into()],
        };
        let preds = [pred.clone(), pred_other];
        let kept = preds
            .iter()
            .all(|p| p.values.iter().any(|v| check(&p.field, id_a, v.as_bytes())));
        assert!(!kept);
    }

    #[tokio::test]
    async fn test_files_without_bloom_pass_through() {
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
        let files = vec![fk("not-a-files-path", 1234)];
        let preds = vec![BloomPredicate {
            field: "trace_id".into(),
            values: vec!["x".into()],
        }];
        let kept = prune(files, &preds, "tid", "o", StreamType::Logs, "s").await;
        assert_eq!(kept.len(), 1);
    }
}
