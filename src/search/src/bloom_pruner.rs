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

//! Search-side bloom prune layer — transposed (block-major) read.
//!
//! Given a candidate `Vec<FileKey>` and the query's tantivy `IndexCondition`,
//! this module pulls the bloom-decidable predicates out of it
//! ([`collect_decidable`]) and then:
//!
//! 1. Splits files into "has bloom" (`bloom_ver != 0`) and "no bloom" (`bloom_ver == 0`). The
//!    latter pass through untouched.
//! 2. Groups "has bloom" files by `(date, bloom_ver)` so all files sharing a `.bf` are tested with
//!    one footer fetch.
//! 3. For each group, fetches **one block row per `(predicate, value)`** — a single contiguous `M ×
//!    32`-byte range (M = files in the group) that holds every file's SBBF block for that value
//!    (see the transposed layout in `infra::bloom`). So the per-group remote cost is
//!    O(predicate×value) reads, not O(files): a single trace_id lookup is **one read per group**.
//! 4. For each file, slices its column out of the fetched row and runs the SBBF point check. A file
//!    is kept iff every predicate's bloom returns *maybe* for at least one of its values (OR within
//!    a predicate, AND across predicates).
//!
//! Any failure (fetch, parse, schema mismatch) **falls back to "keep
//! all"** for the affected group — bloom is performance, not correctness.

use std::collections::{HashMap, HashSet};

use config::meta::stream::{FileKey, StreamType};
use futures::stream::{self, StreamExt};
use infra::bloom::{
    BLOOM_FOOTER_CACHE, BloomReader,
    path::bloom_path,
    sbbf::{BLOCK_BYTES, check_block_with_mask, mask_from_hash},
};
use object_store::{GetOptions, GetRange};

use super::index::{Condition, IndexCondition};

/// One bloom-decidable predicate: a field plus the candidate values to test.
/// Passes if **any** candidate's bloom check returns "maybe" (OR within a
/// predicate; predicates are AND'd across).
struct Predicate {
    field: String,
    values: Vec<String>,
}

/// Bytes pulled from the tail of a `.bf` on footer-cache miss. Big
/// enough to cover the footer payload for hour buckets up to ~150 indexed
/// (file, field) pairs (footer ≈ 24 B per file × few fields + per-field
/// header ≈ 7.5 KB at the high end). When the actual footer overflows
/// this probe, the group falls back to "keep all".
const BLOOM_SUFFIX_PROBE_BYTES: u64 = 16 * 1024;

/// Outcome of running one (date, bloom_ver) bucket. The `Ok` variant carries
/// one tuple per resolvable `(file_idx, pred_idx, value_idx)`; missing
/// entries imply "no info" for that target and are handled by the caller.
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
    #[error("row count mismatch: expected {expected} got {got}")]
    RowMismatch { expected: usize, got: usize },
}

/// Outer concurrency cap on `.bf` buckets processed in parallel.
///
/// Mirrors the tantivy search path (`storage.rs`): use the same
/// `query_thread_num` knob (defaults to `cpu_num * 4` in cluster mode,
/// `cpu_num` in local). No hardcoded constant — large multi-day
/// trace_id lookups need to fan out far beyond 32 buckets.
fn bloom_prefetch_concurrency() -> usize {
    config::get_config().limit.query_thread_num.max(1)
}

/// Prune `files` against the bloom-decidable parts of `index_condition`,
/// returning the surviving subset. Files with `bloom_ver == 0` are always
/// kept (no bloom info). If no condition is bloom-decidable, `files` is
/// returned unchanged without touching any `.bf`.
///
/// `trace_id` is threaded through purely for logging.
pub async fn prune(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    files: Vec<FileKey>,
    index_condition: &IndexCondition,
    bloom_indexed_fields: Vec<String>,
) -> Vec<FileKey> {
    let bloom_indexed_fields = bloom_indexed_fields.into_iter().collect::<HashSet<_>>();
    let predicates = collect_decidable(index_condition, &bloom_indexed_fields);
    if predicates.is_empty() {
        return files;
    }
    let predicates = predicates.as_slice();

    // 1. Split files by whether they have a bloom_ver assigned.
    let total_input = files.len();
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
        log::warn!(
            "[trace_id {trace_id}] search->bloom: stream {org_id}/{stream_type}/{stream_name}, \
             all {total_input} files have bloom_ver=0 — no `.bf` covers any of them. \
             Likely causes: compactor hasn't built `.bf` for this hour yet, or these files \
             produced no blooms (target field not in tantivy schema at build time, or \
             index_size=0). Falling through, no pruning applied."
        );
        return without_bloom;
    }
    log::info!(
        "[trace_id {trace_id}] search->bloom: stream {org_id}/{stream_type}/{stream_name}, \
         input={total_input} (with_bloom={}, without_bloom={}), \
         predicates=[{}]",
        with_bloom.len(),
        without_bloom.len(),
        predicates
            .iter()
            .map(|p| format!("{}({})", p.field, p.values.len()))
            .collect::<Vec<_>>()
            .join(", ")
    );

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

    // 3. Plan per-group work. With the transposed layout the fetch unit is one block-row per
    //    (predicate, value) — shared by every file in the group — so we just carry the group's file
    //    indices.
    struct GroupSpec {
        group: Group,
        account: String,
        path: String,
        file_idxs: Vec<usize>,
    }
    let specs: Vec<GroupSpec> = groups
        .into_iter()
        .map(|((date, ver), idxs)| {
            let path = bloom_path(org_id, stream_type, stream_name, &date, ver);
            let account = infra::storage::get_account(org_id, &path).unwrap_or_default();
            GroupSpec {
                group: (date, ver),
                account,
                path,
                file_idxs: idxs,
            }
        })
        .collect();

    // 4. Run each group: fetch footer → compute 32-byte ranges → batched range GETs → run
    //    check_block per target. Outer concurrency is config-driven.
    let total_groups = specs.len();
    let with_bloom_ref = &with_bloom;
    let concurrency = bloom_prefetch_concurrency();
    let results: Vec<(Group, GroupResult)> = stream::iter(specs)
        .map(|spec| async move {
            let group = spec.group.clone();
            let res = run_group(
                trace_id,
                &spec.account,
                &spec.path,
                &spec.file_idxs,
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
                log::warn!(
                    "[trace_id {trace_id}] search->bloom: group `{path}` failed: {e}; keeping its files"
                );
            }
        }
    }

    // Also fold "checked successfully but some predicate had no info" — those
    // files default to keep. We track this by recording which (file_idx, pred_idx)
    // pairs produced at least one checked block (i.e. `row_range` resolved a row
    // and the file had a column in it). If a pair has no checked block at all for
    // any of its values, we treat that predicate as "unknown" → keep file.
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
    let mut kept_no_info = 0usize;
    let mut kept_predicate_hit = 0usize;
    let mut dropped = 0usize;
    let mut kept_unparseable_key = 0usize;
    let mut kept_bucket_failed = 0usize;
    for (idx, f) in with_bloom.into_iter().enumerate() {
        if date_for[idx].is_none() {
            kept_unparseable_key += 1;
            kept.push(f);
            continue;
        }
        let matches = match per_file_match.get(&idx) {
            Some(m) => m,
            None => {
                // Bucket failed entirely → keep.
                kept_bucket_failed += 1;
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
        let any_pred_lacks_info = info.iter().any(|i| !*i);
        let all_match = predicates.iter().enumerate().all(|(pi, _)| {
            if !info[pi] {
                return true; // unknown → conservatively true
            }
            matches[pi].iter().any(|hit| *hit)
        });
        if all_match {
            if any_pred_lacks_info {
                kept_no_info += 1;
            } else {
                kept_predicate_hit += 1;
            }
            kept.push(f);
        } else {
            dropped += 1;
        }
    }
    log::info!(
        "[trace_id {trace_id}] search->bloom: stream {org_id}/{stream_type}/{stream_name}, \
         groups={total_groups}, input={total_input}, kept={} \
         (predicate_hit={kept_predicate_hit}, no_info={kept_no_info}, \
         bucket_failed={kept_bucket_failed}, unparseable_key={kept_unparseable_key}, \
         no_bloom={}), dropped={dropped}",
        kept.len(),
        kept.len() - kept_predicate_hit - kept_no_info - kept_bucket_failed - kept_unparseable_key
    );
    kept
}

async fn run_group(
    trace_id: &str,
    account: &str,
    path: &str,
    file_idxs: &[usize],
    predicates: &[Predicate],
    with_bloom: &[FileKey],
) -> GroupResult {
    // Step 1: footer (cache → suffix GET on miss). `.bf` is immutable so the
    // footer cache entry is valid for the file's lifetime.
    let (total_size, suffix) = match get_footer_suffix(account, path).await {
        Ok(x) => x,
        Err(e) => return GroupResult::Err(path.to_string(), e),
    };
    let reader = match BloomReader::parse_suffix(&suffix, total_size) {
        Ok(r) => r,
        Err(e) => return GroupResult::Err(path.to_string(), FetchError::Parse(e)),
    };

    // Step 2: one block-ROW per (predicate, value) — shared across all files
    // in this group. This is the transposed-layout win: O(predicate×value)
    // reads per group instead of O(files).
    struct RowPlan {
        pred_idx: usize,
        value_idx: usize,
        range: std::ops::Range<u64>,
        /// SBBF bit-mask for this value, computed once and reused for every
        /// file's block in the row (the mask depends only on the hash, which
        /// is identical across all files in the group).
        mask: [u32; 8],
    }
    let mut rows: Vec<RowPlan> = Vec::new();
    for (pi, pred) in predicates.iter().enumerate() {
        for (vi, value) in pred.values.iter().enumerate() {
            if let Some((range, hash)) = reader.row_range(&pred.field, value.as_bytes()) {
                rows.push(RowPlan {
                    pred_idx: pi,
                    value_idx: vi,
                    range,
                    mask: mask_from_hash(hash),
                });
            }
            // field absent in this .bf → no row → those (file, pred) pairs
            // stay "no info" and are conservatively kept by the caller.
        }
    }
    if rows.is_empty() {
        let footer_fields: Vec<&str> = reader.fields().collect();
        let requested_fields: Vec<&str> = predicates.iter().map(|p| p.field.as_str()).collect();
        log::warn!(
            "[trace_id {trace_id}] search->bloom: group `{path}`: no rows resolved — \
             footer fields=[{}], requested=[{}]. Likely cause: stream \
             `bloom_filter_fields ∩ index_fields` at build time differed from the queried \
             field. Keeping all files in this group.",
            footer_fields.join(", "),
            requested_fields.join(", "),
        );
        return GroupResult::Ok(Vec::new());
    }

    // Step 3: fetch the rows. One contiguous range each (M×32 bytes), batched
    // into a single `get_ranges` call. For the canonical single-value query
    // this is exactly ONE remote read for the whole group.
    let ranges: Vec<std::ops::Range<u64>> = rows.iter().map(|r| r.range.clone()).collect();
    let fetched = match infra::cache::storage::get_ranges(account, &path.into(), &ranges).await {
        Ok(v) => v,
        Err(e) => return GroupResult::Err(path.to_string(), FetchError::Store(e)),
    };
    if fetched.len() != rows.len() {
        return GroupResult::Err(
            path.to_string(),
            FetchError::RowMismatch {
                expected: rows.len(),
                got: fetched.len(),
            },
        );
    }

    // Step 4: for each file, slice its column out of each fetched row and run
    // the 8-bit check. A file whose column is absent from a row's field stays
    // "no info" for that predicate.
    let mut outcomes: Vec<(usize, usize, usize, bool)> = Vec::new();
    for (r, row_bytes) in rows.iter().zip(fetched.iter()) {
        let field = &predicates[r.pred_idx].field;
        for &file_idx in file_idxs {
            let file_id = with_bloom[file_idx].id as u64;
            let Some(col) = reader.column_index(field, file_id) else {
                continue; // file not a column for this field → no info
            };
            let off = col * BLOCK_BYTES;
            if off + BLOCK_BYTES > row_bytes.len() {
                // Shouldn't happen if footer + body agree; treat as no info.
                continue;
            }
            let block: &[u8; BLOCK_BYTES] = row_bytes[off..off + BLOCK_BYTES].try_into().unwrap();
            let hit = check_block_with_mask(block, &r.mask);
            outcomes.push((file_idx, r.pred_idx, r.value_idx, hit));
        }
    }

    GroupResult::Ok(outcomes)
}

/// Footer suffix retrieval: footer cache → suffix-range GET on miss.
/// Returns (total_size, suffix_bytes) in both branches.
///
/// Two-step read: the first probe pulls a fixed tail
/// (`BLOOM_SUFFIX_PROBE_BYTES`), which covers the whole footer for the common
/// case (few fields / a few hundred files). When the footer is bigger than
/// the probe — many bloom fields, or a large `max_files_per_bf` — we re-read
/// exactly `footer_len + 8` from the tail so a big `.bf` still prunes instead
/// of silently falling back to keep-all.
async fn get_footer_suffix(account: &str, path: &str) -> Result<(u64, bytes::Bytes), FetchError> {
    if let Some((total, suffix)) = BLOOM_FOOTER_CACHE.get(path) {
        return Ok((total, suffix));
    }

    let (total, suffix) = fetch_suffix(account, path, BLOOM_SUFFIX_PROBE_BYTES).await?;
    let suffix = match footer_shortfall(&suffix, total) {
        Some(needed) => fetch_suffix(account, path, needed).await?.1,
        None => suffix,
    };

    BLOOM_FOOTER_CACHE.put(path.to_string(), total, suffix.clone());
    Ok((total, suffix))
}

/// One `Suffix(n)` GET. Returns (total_file_size, suffix_bytes).
async fn fetch_suffix(
    account: &str,
    path: &str,
    n: u64,
) -> Result<(u64, bytes::Bytes), FetchError> {
    let opts = GetOptions {
        range: Some(GetRange::Suffix(n)),
        ..Default::default()
    };
    let res = infra::cache::storage::get_opts(account, &path.into(), opts).await?;
    let total = res.meta.size;
    let suffix = res.bytes().await?;
    Ok((total, suffix))
}

/// If the footer doesn't fully fit in `suffix`, return how many trailing
/// bytes to re-read (`footer_len + footer_len_field + magic`). The last 8
/// bytes of any `.bf` are `footer_len(4) + MAGIC(4)`, and the probe always
/// includes them, so we can read `footer_len` here. Returns `None` when the
/// footer already fits, the suffix is too short to hold the trailer, or
/// `footer_len` is implausible (corrupt) — let `parse_suffix` reject those.
fn footer_shortfall(suffix: &[u8], total: u64) -> Option<u64> {
    let n = suffix.len();
    if n < 8 {
        return None;
    }
    let footer_len = u32::from_le_bytes(suffix[n - 8..n - 4].try_into().ok()?) as u64;
    let needed = footer_len + 8;
    if needed <= n as u64 || needed > total {
        return None;
    }
    Some(needed)
}

/// Pull the bloom-decidable predicates out of a top-level `IndexCondition`.
///
/// Each top-level (AND'd) condition is run through [`try_predicate`]; those
/// that fold cleanly become bloom checks, the rest are silently skipped (the
/// affected files pass the bloom step untouched).
///
/// `bloom_indexed_fields` is the stream's `bloom_filter_fields ∩ index_fields`
/// — passing an unrelated field would just waste IO on guaranteed misses.
fn collect_decidable(
    cond: &IndexCondition,
    bloom_indexed_fields: &HashSet<String>,
) -> Vec<Predicate> {
    cond.conditions
        .iter()
        .filter_map(|c| try_predicate(c, bloom_indexed_fields))
        .collect()
}

/// Try to convert a single `Condition` into one bloom-decidable `Predicate`.
///
/// A bloom can prove a value is definitely *absent* from a file, never that
/// it's present — so we only fold **positive equality / IN** shapes on a
/// `bloom_indexed_fields` field:
///
/// - `Equal(f, v)` → `Predicate { f, [v] }`.
/// - `In(f, vs, false)` with non-empty `vs` → `Predicate { f, vs }`.
/// - `Or(l, r)` whose every leaf folds to the **same** field → one `Predicate` whose `values` is
///   the deduped union of leaves' values (semantically `f IN (...)`). Handles arbitrarily nested
///   `Or`s by recursion.
///
/// Returns `None` on anything else — `NotEqual` / `Not` / `Regex` / `StrMatch`
/// / `MatchAll` / `FuzzyMatchAll`, nested `And`, negated or empty `In`, an
/// `Or` whose leaves don't all fold or don't share a field, or any condition
/// on a non-bloom-indexed field.
fn try_predicate(cond: &Condition, bloom_indexed_fields: &HashSet<String>) -> Option<Predicate> {
    match cond {
        Condition::Equal(field, value) if bloom_indexed_fields.contains(field) => Some(Predicate {
            field: field.clone(),
            values: vec![value.clone()],
        }),
        Condition::In(field, values, false)
            if bloom_indexed_fields.contains(field) && !values.is_empty() =>
        {
            Some(Predicate {
                field: field.clone(),
                values: values.clone(),
            })
        }
        Condition::Or(left, right) => {
            let lp = try_predicate(left, bloom_indexed_fields)?;
            let rp = try_predicate(right, bloom_indexed_fields)?;
            if lp.field != rp.field {
                return None;
            }
            let mut values = lp.values;
            values.extend(rp.values);
            // Dedup so e.g. `f = a OR f IN (a, b)` doesn't fetch the same row twice.
            values.sort();
            values.dedup();
            Some(Predicate {
                field: lp.field,
                values,
            })
        }
        _ => None,
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

    fn fields(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    fn cond(conditions: Vec<Condition>) -> IndexCondition {
        let mut c = IndexCondition::new();
        for x in conditions {
            c.add_condition(x);
        }
        c
    }

    // ---- collect_decidable dispatch ----

    #[test]
    fn test_collect_equal_on_indexed_field() {
        let c = cond(vec![Condition::Equal("trace_id".into(), "abc".into())]);
        let p = collect_decidable(&c, &fields(&["trace_id"]));
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].field, "trace_id");
        assert_eq!(p[0].values, vec!["abc".to_string()]);
    }

    #[test]
    fn test_collect_skips_non_indexed_field() {
        let c = cond(vec![Condition::Equal("body".into(), "abc".into())]);
        assert!(collect_decidable(&c, &fields(&["trace_id"])).is_empty());
    }

    #[test]
    fn test_collect_positive_in() {
        let c = cond(vec![Condition::In(
            "trace_id".into(),
            vec!["a".into(), "b".into()],
            false,
        )]);
        let p = collect_decidable(&c, &fields(&["trace_id"]));
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].values, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn test_collect_skips_empty_and_negated_in() {
        let empty = cond(vec![Condition::In("trace_id".into(), vec![], false)]);
        assert!(collect_decidable(&empty, &fields(&["trace_id"])).is_empty());
        let negated = cond(vec![Condition::In(
            "trace_id".into(),
            vec!["a".into()],
            true,
        )]);
        assert!(collect_decidable(&negated, &fields(&["trace_id"])).is_empty());
    }

    #[test]
    fn test_collect_skips_negation_regex_strmatch() {
        let c = cond(vec![
            Condition::NotEqual("trace_id".into(), "abc".into()),
            Condition::Regex("trace_id".into(), "^abc.*".into()),
            Condition::StrMatch("trace_id".into(), "abc".into(), true),
        ]);
        assert!(collect_decidable(&c, &fields(&["trace_id"])).is_empty());
    }

    // ---- same-field Or folding ----

    #[test]
    fn test_collect_same_field_or_of_equals_flattens() {
        // `trace_id = b OR trace_id = a` → one Predicate, values sorted+deduped
        // (semantically `trace_id IN (a, b)`).
        let c = cond(vec![Condition::Or(
            Box::new(Condition::Equal("trace_id".into(), "b".into())),
            Box::new(Condition::Equal("trace_id".into(), "a".into())),
        )]);
        let p = collect_decidable(&c, &fields(&["trace_id"]));
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].field, "trace_id");
        assert_eq!(p[0].values, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn test_collect_same_field_or_mixed_eq_and_in_flattens() {
        // `trace_id = a OR trace_id IN (b, c)` → one Predicate { values: [a, b, c] }
        let c = cond(vec![Condition::Or(
            Box::new(Condition::Equal("trace_id".into(), "a".into())),
            Box::new(Condition::In(
                "trace_id".into(),
                vec!["b".into(), "c".into()],
                false,
            )),
        )]);
        let p = collect_decidable(&c, &fields(&["trace_id"]));
        assert_eq!(p.len(), 1);
        assert_eq!(
            p[0].values,
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn test_collect_nested_or_chain_flattens() {
        // (trace_id = 1 OR trace_id = 2) OR trace_id = 3 → one Predicate.
        let inner = Condition::Or(
            Box::new(Condition::Equal("trace_id".into(), "1".into())),
            Box::new(Condition::Equal("trace_id".into(), "2".into())),
        );
        let outer = Condition::Or(
            Box::new(inner),
            Box::new(Condition::Equal("trace_id".into(), "3".into())),
        );
        let p = collect_decidable(&cond(vec![outer]), &fields(&["trace_id"]));
        assert_eq!(p.len(), 1);
        assert_eq!(
            p[0].values,
            vec!["1".to_string(), "2".to_string(), "3".to_string()]
        );
    }

    #[test]
    fn test_collect_or_dedups_values() {
        // `trace_id = a OR trace_id IN (a, b)` → values = [a, b], one row each.
        let c = cond(vec![Condition::Or(
            Box::new(Condition::Equal("trace_id".into(), "a".into())),
            Box::new(Condition::In(
                "trace_id".into(),
                vec!["a".into(), "b".into()],
                false,
            )),
        )]);
        let p = collect_decidable(&c, &fields(&["trace_id"]));
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].values, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn test_collect_cross_field_or_skipped() {
        // `trace_id = a OR service = x` — joining across fields would weaken
        // the filter, so the whole Or is dropped.
        let c = cond(vec![Condition::Or(
            Box::new(Condition::Equal("trace_id".into(), "a".into())),
            Box::new(Condition::Equal("service".into(), "x".into())),
        )]);
        assert!(collect_decidable(&c, &fields(&["trace_id", "service"])).is_empty());
    }

    #[test]
    fn test_collect_or_with_negated_in_skipped() {
        // Any leaf we can't fold (here a negated In) collapses the whole Or.
        let c = cond(vec![Condition::Or(
            Box::new(Condition::Equal("trace_id".into(), "a".into())),
            Box::new(Condition::In("trace_id".into(), vec!["b".into()], true)),
        )]);
        assert!(collect_decidable(&c, &fields(&["trace_id"])).is_empty());
    }

    #[test]
    fn test_collect_or_on_non_indexed_field_skipped() {
        // Both branches positive Eq on the same name, but the field is not in
        // the bloom-indexed set — leaves fold to None, whole Or is dropped.
        let c = cond(vec![Condition::Or(
            Box::new(Condition::Equal("body".into(), "a".into())),
            Box::new(Condition::Equal("body".into(), "b".into())),
        )]);
        assert!(collect_decidable(&c, &fields(&["trace_id"])).is_empty());
    }

    #[test]
    fn test_collect_or_alongside_and_top_level() {
        // Top-level AND of (same-field Or) + (Equal on a different bloom field):
        // both produce a Predicate; pruner ANDs them.
        let c = cond(vec![
            Condition::Or(
                Box::new(Condition::Equal("trace_id".into(), "a".into())),
                Box::new(Condition::Equal("trace_id".into(), "b".into())),
            ),
            Condition::Equal("user_id".into(), "u-1".into()),
        ]);
        let p = collect_decidable(&c, &fields(&["trace_id", "user_id"]));
        assert_eq!(p.len(), 2);
        let trace = p.iter().find(|p| p.field == "trace_id").unwrap();
        assert_eq!(trace.values, vec!["a".to_string(), "b".to_string()]);
        let user = p.iter().find(|p| p.field == "user_id").unwrap();
        assert_eq!(user.values, vec!["u-1".to_string()]);
    }

    #[test]
    fn test_collect_multiple_top_level_ands() {
        // Top-level AND: each prunable predicate is picked; non-prunable ones
        // (here the NotEqual) are ignored.
        let c = cond(vec![
            Condition::Equal("trace_id".into(), "x".into()),
            Condition::NotEqual("body".into(), "noise".into()),
            Condition::Equal("user_id".into(), "u-1".into()),
        ]);
        let p = collect_decidable(&c, &fields(&["trace_id", "user_id"]));
        assert_eq!(p.len(), 2);
        assert!(p.iter().any(|x| x.field == "trace_id"));
        assert!(p.iter().any(|x| x.field == "user_id"));
    }

    /// End-to-end: writer produces a `.bf`, reader's single-block API resolves
    /// the same membership the prune logic expects.
    #[test]
    fn test_writer_reader_predicate_contract() {
        let id_a: u64 = 101;
        let id_b: u64 = 102;

        // Both files share a uniform B (transposed layout requirement).
        let nb = infra::bloom::num_blocks_for(100, 0.01);
        let mut bb = BloomBuilder::new();
        let i_a = bb.begin_with_blocks(id_a, "trace_id", nb);
        bb.insert(i_a, b"present-A");
        let i_b = bb.begin_with_blocks(id_b, "trace_id", nb);
        bb.insert(i_b, b"present-B");
        let blob = BloomWriter::serialize(bb.finish()).unwrap();
        let r = BloomReader::parse(&blob).unwrap();

        let check = |field: &str, file_id: u64, v: &[u8]| {
            let (range, h) = r.row_range(field, v).unwrap();
            let col = r.column_index(field, file_id).unwrap();
            let row = &blob[range.start as usize..range.end as usize];
            let off = col * BLOCK_BYTES;
            let block: &[u8; BLOCK_BYTES] = row[off..off + BLOCK_BYTES].try_into().unwrap();
            BloomReader::check_block_with_hash(block, h)
        };

        let pred = Predicate {
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
        let pred_in = Predicate {
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
        let pred_other = Predicate {
            field: "trace_id".into(),
            values: vec!["absent-Z".into()],
        };
        let preds = [pred, pred_other];
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
        let c = cond(vec![Condition::Equal("trace_id".into(), "x".into())]);
        let kept = prune(
            "tid",
            "o",
            StreamType::Logs,
            "s",
            files.clone(),
            &c,
            vec!["trace_id".to_string()],
        )
        .await;
        assert_eq!(kept.len(), files.len());
    }

    #[tokio::test]
    async fn test_no_decidable_predicate_keeps_everything() {
        let files = vec![fk("files/o/logs/s/2026/05/08/14/a.parquet", 123)];
        // A NotEqual is not bloom-decidable → prune returns input untouched.
        let c = cond(vec![Condition::NotEqual("trace_id".into(), "x".into())]);
        let kept = prune(
            "tid",
            "o",
            StreamType::Logs,
            "s",
            files.clone(),
            &c,
            vec!["trace_id".to_string()],
        )
        .await;
        assert_eq!(kept.len(), 1);
    }

    #[tokio::test]
    async fn test_missing_bf_keeps_all_files_in_group() {
        let files = vec![fk("files/o/logs/missing/2026/05/08/14/a.parquet", 9_999)];
        let c = cond(vec![Condition::Equal("trace_id".into(), "x".into())]);
        let kept = prune(
            "tid",
            "o",
            StreamType::Logs,
            "missing",
            files.clone(),
            &c,
            vec!["trace_id".to_string()],
        )
        .await;
        assert_eq!(kept.len(), 1);
    }

    #[tokio::test]
    async fn test_unparseable_key_kept() {
        let files = vec![fk("not-a-files-path", 1234)];
        let c = cond(vec![Condition::Equal("trace_id".into(), "x".into())]);
        let kept = prune(
            "tid",
            "o",
            StreamType::Logs,
            "s",
            files,
            &c,
            vec!["trace_id".to_string()],
        )
        .await;
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn test_footer_shortfall() {
        let total = 10_000u64;
        let mut s = vec![0u8; 64]; // last 8 bytes = footer_len(4) + magic(4)
        // footer fits within the 64-byte suffix (needed = 40 + 8 = 48 <= 64)
        s[56..60].copy_from_slice(&40u32.to_le_bytes());
        assert_eq!(footer_shortfall(&s, total), None);
        // footer bigger than the suffix → re-read footer_len + 8
        s[56..60].copy_from_slice(&5000u32.to_le_bytes());
        assert_eq!(footer_shortfall(&s, total), Some(5008));
        // implausible footer_len (> total) → None, let parse reject it
        s[56..60].copy_from_slice(&20_000u32.to_le_bytes());
        assert_eq!(footer_shortfall(&s, total), None);
        // too short to even hold the trailer → None
        assert_eq!(footer_shortfall(&[0u8; 4], total), None);
    }

    /// A `.bf` whose footer exceeds a small probe must still parse once we
    /// re-read exactly `footer_shortfall` bytes from the tail — the two-step
    /// read that keeps large `.bf`s prunable instead of falling back.
    #[test]
    fn test_large_footer_two_step_parse() {
        // 300 files in one field → footer ≈ 3.6 KB, well over a 256 B probe.
        let mut bb = BloomBuilder::new();
        for fid in 0..300u64 {
            let i = bb.begin_with_blocks(fid, "trace_id", 4);
            bb.insert(i, format!("v-{fid}").as_bytes());
        }
        let blob = BloomWriter::serialize(bb.finish()).unwrap();
        let total = blob.len() as u64;

        // Small probe that does NOT cover the whole footer.
        let probe = 256.min(blob.len());
        let small = &blob[blob.len() - probe..];
        let needed = footer_shortfall(small, total).expect("footer exceeds the small probe");

        // Re-read exactly `needed` trailing bytes and parse — must succeed.
        let big = &blob[blob.len() - needed as usize..];
        let r = BloomReader::parse_suffix(big, total).expect("parse with precise footer suffix");
        assert!(r.column_index("trace_id", 0).is_some());
        assert!(r.column_index("trace_id", 299).is_some());
    }
}
