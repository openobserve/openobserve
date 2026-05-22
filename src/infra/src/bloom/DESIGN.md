# Bloom-filter pruning above tantivy

> **Status:** implemented (PR #11702)
> **Layer:** above the existing parquet + tantivy search path
> **Scope:** equality lookups on user-declared `bloom_filter_fields ∩ index_fields`

This document describes the design of the bloom-filter pruning layer that sits above tantivy in OpenObserve's search path.

---

## 1. Motivation

OpenObserve search already prunes parquet via tantivy:

```
file_list query → tantivy lookup per file → row_ids → parquet read
```

That works, but **every tantivy file in the candidate range still has to be opened**. For a query like `trace_id = 'abc'` over a month of 100 TB of logs, that is on the order of **1 million tantivy file footers** to fetch from object storage just to learn that 999 999 of them don't contain the term.

The bloom-filter layer adds a much cheaper preliminary step:

```
file_list query → bloom filter prune → tantivy lookup → parquet read
                  └──────── new ────────┘
```

For a 30-day, high-cardinality lookup the bloom layer brings the number of object-store round-trips per query down from ≈1 M (one tantivy footer per parquet) to ≈720 (one `.bf` per hour bucket).

---

## 2. Goals & non-goals

### Goals

- Drop tantivy file open count by ~1000× for **positive equality / IN** queries on user-declared high-cardinality fields (`trace_id`, `request_id`, `user_id`, ...).
- Stay correct under any failure: a bloom miss must never drop a file that actually matches the query.
- Reuse existing infra (file_list, tantivy term dict, file_data cache, retention sweep) instead of standing up a new service.
- Be invisible to the rest of the search path — no behavior change when the layer is disabled or fails.

### Non-goals (explicitly deferred)

- **Full-text bloom** (Loki BBF 2.0 style): tantivy already does FTS; marginal value, large index size.
- **Hierarchical / bucket-level summary blooms**: hour-level per-file is enough for current scale.
- **Backfill of dumped data**: dumped rows preserve their `bloom_ver` at dump time; if it was 0, it stays 0. A CLI tool to rebuild blooms for a specified time range is planned (see §13) but not in this PR.

---

## 3. High-level architecture

```
┌────────────────────────────────────────────────────────────────┐
│ INGEST                COMPACT                       SEARCH     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ parquet         ┌─ merge_files() ──┐                           │
│   │             │   parquet+tantivy│                           │
│   │             │     unchanged    │                           │
│   ▼             └────────┬─────────┘                           │
│ file_list (live)         │                  file_list query    │
│ bloom_ver=0              ▼                       │             │
│                  bloom_build per                 │ FileKey w/   │
│                  (stream, hour)                  │ bloom_ver    │
│                  (append-only)                   ▼             │
│                          │                   bloom_pruner      │
│                          ▼                  group by (date,    │
│                  .bf file uploaded           bloom_ver) →       │
│                  bloom_ver = now_us()         fetch .bf each →  │
│                  UPDATE file_list             evaluate preds    │
│                  contributing rows                   │          │
│                                                      ▼          │
│                                                tantivy_search   │
│ file_list_dump  ←─ dump (eventually) ──┐               │        │
│ preserves       (preserves bloom_ver)  │               ▼        │
│ bloom_ver                              │         parquet read   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Three modules

| Module | Crate | Role |
|---|---|---|
| `infra::bloom` | `infra` | `.bf` file **format** (writer/reader) and path conventions |
| `service::compact::bloom_build` | `openobserve` | **Builder**: post-merge only; stamps `bloom_ver` |
| `service::search::bloom_pruner` + `bloom_predicate` | `openobserve` | **Reader**: extracts predicates, fetches `.bf`, prunes file list |

---

## 4. Data model

### 4.1 `file_list.bloom_ver` (BIGINT, default 0)

Every `file_list` row carries a `bloom_ver: i64`:

- `0` → no `.bf` covers this file (or the file just hasn't been blessed yet)
- non-zero → microsecond timestamp encoded into the `.bf` filename that covers this file's blooms

Migration:

| Backend | Path |
|---|---|
| SQLite | idempotent `add_column` covers existing installs; new installs get the column from the fresh-DDL block |
| Postgres (declarative-partitioned `file_list`) | `ALTER TABLE parent ADD COLUMN IF NOT EXISTS bloom_ver BIGINT DEFAULT 0 NOT NULL` propagates to all partitions; covers the three Postgres bootstrap branches (fresh / regular→partitioned / already-partitioned) |
| `file_list_dump` (parquet archive) | `bloom_ver` added to the schema; reader is **tolerant of missing column** so dump files written before this layer existed continue to be readable (default 0) |
| gRPC `cluster_rpc::FileMeta` | proto tag 7 |

### 4.2 `.bf` file path

```
files/{org}/bloom/{stream_type}/{stream}/{date}/{bloom_ver}.bf
```

- `date` is the same `YYYY/MM/DD/HH` string used in `file_list.date`
- `bloom_ver` is the build-time `now_micros()`; combined with the `(stream, date)` prefix it is unique per build

### 4.3 `.bf` file layout

```
0  ─────────────────────────────────────────
   MAGIC      4B   "O2BF"
   VERSION    1B   0x01
─────────────────────────────────────────────
   BODY            (concat of raw SBBF bitsets — each is exactly
                    `num_blocks × 32` little-endian bytes, no
                    thrift header, no framing)
─────────────────────────────────────────────
   FOOTER          (hand-rolled, no thrift)
     field_count   u32 LE
     per field:
       name_len    u16 LE
       name        bytes
       algo        u8           (0x01 = SBBF + gxhash64)
       file_count  u32 LE
       per file:
         file_id     u64 LE  (file_list.id cast to u64)
         body_offset u64 LE
         body_size   u32 LE   (always a non-zero multiple of 32)
         n_items     u32 LE
─────────────────────────────────────────────
   FOOTER_LEN  4B  (LE)
   MAGIC       4B  "O2BF"
EOF─────────────────────────────────────────
```

Bloom algorithm: SBBF block layout from the Parquet spec, but the hash function is gxhash64 (seed=0) from `config::utils::hash` rather than the spec's xxhash64. We don't interop with external SBBF readers, so this swap is invisible outside `.bf` files and saves an extra direct dependency. Implementation lives in `infra::bloom::sbbf` — ~120 LOC of `Sbbf` struct + the standalone `check_block(block_bytes, hash)` and `block_index(hash, num_blocks)` primitives. The split-block design is the key property that makes single-block point reads possible.

Width-overflow checks at write time return `WriteError::{FieldNameTooLong, TooManyFields, TooManyFiles, BloomBodyTooLarge}` instead of silent `as` casts.

Tail magic + footer-length pointer is used by the reader's `parse_suffix(suffix, total_size)` path: the search side fetches just the footer (typically 16 KB suffix probe) and never materializes the body. The body bytes stay in object store / disk cache; only the **single 32-byte block** each point check needs is read on demand via `infra::cache::storage::get_ranges`.

**Format version**: `VERSION = 0x01`. This is the first released format — `body_offset..body_offset+body_size` is exactly a sequence of 32-byte raw SBBF blocks, no framing. Earlier in-development prototypes wrapped each body in a Parquet thrift `BloomFilterHeader` from `parquet::bloom_filter::Sbbf::write`; those never shipped, and the current code only knows the raw-block layout.

### 4.4 `file_id` choice

`u64 = file_list.id as u64`.

The compactor's bloom build runs **after** `write_file_list` has assigned ids, so the value is always known and > 0. The search side already has each `FileKey.id` from the `file_list` query. Cast is safe — file_list ids are sequential u63s.

(An earlier iteration used `xxhash64(parquet_path)` because the build was scheduled before insert; switching to `id` removed the `twox-hash` direct dep and the hash-collision concern.)

---

## 5. Write path

### 5.1 Append-only build

This is the core invariant: **`bloom_ver` is set once per file and never re-stamped**.

`bloom_build::build_for_bucket(org, stream_type, stream, date_key)`:

1. Resolve target fields from current `StreamSettings`: `index_fields ∩ bloom_filter_fields`. Skip if empty.
2. `query_for_merge` to get every file currently in this hour bucket.
3. **Trigger gate**: rebuild iff at least one file has `bloom_ver = 0`. If every file already has a `bloom_ver` (even mixed non-zero values across rows that were stamped at different times), return early.
4. For every file with `bloom_ver = 0`:
   - Open `.ttv` via the existing `get_tantivy_directory` (cache-friendly).
   - Iterate the term dictionary for each target field via `service::tantivy::bloom_builder::build_blooms_from_index` — terms come back already deduplicated, sorted, and zero extra IO since the `.ttv` is warm in cache.
   - Pack into `FieldBloom`s (per-(file, field)).
5. `BloomWriter::serialize` → bytes.
6. `storage::put` to `bloom_path(...{bloom_ver = now_us()})`.
7. `infra::file_list::update_bloom_ver(contributing_ids, bloom_ver)`. Files that errored or had no terms stay at `bloom_ver = 0` so search doesn't pay a wasted `.bf` fetch on them.

### 5.2 Trigger site

The bloom build is fired from exactly one place: inside `service::compact::merge::merge_by_stream`, after the per-prefix worker barrier completes. For every prefix visited during the job, call `build_for_bucket`. This fires whether or not merging actually happened, so a hour with one big file (no merge needed) is still bloom-built.

There is **no periodic catchup sweep**. An earlier design used a `run_catchup` job that scanned `file_list` for `bloom_ver = 0` rows and re-tried `build_for_bucket` for those (stream, date) pairs. That scan was removed because `bloom_ver = 0` is overloaded — see §5.3 — and the scan couldn't distinguish "waiting to be built" from "tried already, zero contribution" from "feature was off when this row was ingested". Coverage gaps caused by operator-side configuration changes (enabling `bloom_filter_enabled` after ingest, or adding a field to `bloom_filter_fields` for an already-settled stream) are out of scope for the auto-build path; they're handled by an out-of-band backfill CLI (see §13).

### 5.3 `bloom_ver = 0` is overloaded

A row with `bloom_ver = 0` can mean any of:

1. **Waiting to build** — file just landed, `merge_by_stream` hasn't reached its prefix yet.
2. **Build failed** — `storage::put` or `update_bloom_ver` errored; status logged via `bloom_file_build_failed_total`.
3. **No contribution** — `build_blooms_for_file` succeeded but produced no blooms (target field not in this file's schema, or `index_size = 0` so no `.ttv` exists).
4. **Feature off at ingest** — `bloom_filter_enabled` was false or the stream didn't have `bloom_filter_fields` configured when the file landed.

Search treats all four the same: file falls through to the original tantivy path. The append-only invariant only protects rows that have a *non-zero* `bloom_ver` — there's no parallel guarantee that a zero will eventually become non-zero.

### 5.4 Concurrency

No explicit locking. The compactor scheduler already pins one worker per `(stream, partition_prefix)`, so two workers cannot bloom-build the same hour at the same time. The append-only invariant means rows already at non-zero `bloom_ver` aren't touched by any future build, so even if two builds did somehow overlap on the same bucket (e.g. process restart, lost lease), the worst case is two `.bf` files written at different `bloom_ver`s; the later UPDATE wins for whichever rows it covers.

### 5.5 What dump sees

When `service::compact::dump` archives a hour's `file_list` rows into a parquet:

- The `bloom_ver` column is part of the dump schema (added in this PR).
- The `.bf` file at that `bloom_ver` is **never superseded** because of the append-only invariant — `build_for_bucket` only stamps `bloom_ver=0` rows, never re-stamps.
- Therefore the dumped rows continue to point at a `.bf` that exists in object storage for as long as the (stream, date) directory exists.

Dump is decoupled from bloom build: there's no dump-time coordination, no pinning step, no special handling. The invariant carries.

---

## 6. Read path

### 6.1 Predicate extraction

`service::search::bloom_predicate::extract(IndexCondition, bloom_indexed_fields)` walks the top-level AND list and pulls out the conditions a bloom can rule on:

- `Equal(field, value)` where `field ∈ bloom_indexed_fields`
- `In(field, [values], false)` (positive, non-empty)

Skipped (search-side prune treats those files as "keep"):

- `NotEqual` / `Not` / negated `In` — bloom can prove absence, not presence
- `StrMatch`, `Regex`, `MatchAll`, `FuzzyMatchAll` — tokenized; bloom is keyed by exact term
- Top-level `Or` — would weaken the filter
- Nested `And` — punted

### 6.2 Pruner

`service::search::bloom_pruner::prune(files, predicates, trace_id, org, stream_type, stream)`:

1. **Split**: files with `bloom_ver = 0` pass through untouched.
2. **Group** remaining files by `(date, bloom_ver)` so each `.bf` footer is fetched only once. For each group, enumerate the `(file_idx, pred_idx, value_idx)` tuples that need a point check.
3. **Fetch per group**, bounded by `buffer_unordered(bloom_prefetch_concurrency())` where the concurrency is config-driven (see §9). Per group:
   - **Footer cache hit**: `BLOOM_FOOTER_CACHE.get(path)` returns the cached suffix bytes (footer + tail of body) plus the `.bf` total size. **0 GETs**.
   - **Footer cache miss**: one `GetRange::Suffix(BLOOM_SUFFIX_PROBE_BYTES = 16 KB)` to the object store. `GetResult.meta.size` is the total file length (no separate `head`); the suffix bytes go into `BLOOM_FOOTER_CACHE` for the next query.
   - **Footer parse**: `BloomReader::parse_suffix(&suffix, total_size)` produces a footer-only reader. The body is never materialized.
   - **Block planning**: for each `(file_id, value)` target, `reader.block_range_for(field, file_id, value)` returns the absolute byte range of the single 32-byte SBBF block to fetch and the `hash` to feed `check_block`. Targets with no info (unknown field or file_id) are dropped; the per-file fold treats those predicates as "unknown → keep".
   - **Batched block fetch**: a single `infra::cache::storage::get_ranges(account, path, &ranges)` call pulls every needed 32-byte block. Internally `object_store::coalesce_ranges` merges adjacent ranges into one underlying GET; returns one `Bytes` per input range, in input order.
   - **Check**: `BloomReader::check_block_with_hash(&block, hash)` on each fetched 32-byte block.
4. **Evaluate** per file: kept iff every predicate's bloom returns "maybe" for at least one of its values (OR within a predicate, AND across predicates). A predicate with no info on this file (every value's `block_range_for` returned `None`) is treated as "unknown → keep".
5. Files with no successfully-evaluated targets (bucket fetch failed wholesale) → conservatively keep.

**Per-bucket steady-state IO**:

- Footer cache warm: **0 GETs for the footer + 1 `get_ranges` call** that batches all N point checks (where N = file_ids in bucket × predicates × values per predicate). Each block is 32 bytes — for a trace_id IN list of 1 value across 20 file_ids, that's 20 × 32 B = 640 B in one batched call.
- Footer cache cold: same as above + 1 suffix GET (16 KB).

The single-block design means **read amplification = O(32 B per point check)**, independent of the underlying SBBF size. A 2 MB SBBF (1.7M unique trace_ids at FPR 0.01) is touched for 32 B per query — the same as a 200 MB SBBF (170M unique).

### 6.3 Hook

In `service::search::grpc::storage::search`, immediately before `tantivy_search()`. Gated by `cfg.common.bloom_filter_enabled` AND a non-empty `bloom_filter_fields` for the stream. If pruning removes everything, short-circuit the search with `Ok((vec![], ScanStats::default(), HashSet::new()))` — saves a tantivy_search round trip on the (very common) "trace_id not found" case.

---

## 7. Failure handling

The layer is **performance, not correctness**. Every failure mode degrades to "keep the file", never drops a file that might match.

| Failure | Behavior |
|---|---|
| `bloom_filter_enabled = false` | Layer disabled entirely, search is identical to pre-bloom path |
| Stream has no `bloom_filter_fields` | Build short-circuits, search short-circuits |
| `.bf` upload fails | Log `BLOOM_FILE_BUILD_FAILED_TOTAL{stage="upload"}`, contributing rows keep `bloom_ver = 0`, search degrades to tantivy |
| `update_bloom_ver` fails after upload | Log `..{stage="update_file_list"}`, `.bf` becomes a (small) orphan, search degrades for those files |
| `BloomWriter::serialize` overflow | Log `..{stage="serialize"}`, no upload, no DB change |
| `.bf` fetch fails | Log warn, keep all files in that group |
| `.bf` parse fails (bad magic, truncated) | Log warn, keep all files in that group |
| Footer entry's `body_size` is not a non-zero multiple of 32 | `BloomReader::parse_suffix` rejects with `InvalidBloomSize`, the bucket falls back to "keep all" |
| Fetched block size mismatch (`get_ranges` returned fewer/shorter ranges than asked) | Log warn, conservatively keep affected files |
| Field unknown to the `.bf` (schema drift) | Conservatively keep that file |
| `file_id` unknown to the `.bf` (race window) | Conservatively keep that file |
| Old dump parquet missing `bloom_ver` column | Defaulted to 0 on read; degrades to tantivy for those rows |

---

## 8. Metrics

All under the standard Prometheus registry, namespace `o2`:

| Metric | Type | Labels | When |
|---|---|---|---|
| `bloom_prune_keep_ratio` | Histogram | `organization, stream_type` | Per `prune` call (when bloom prune actually runs); ratio of files surviving |
| `bloom_prune_duration_seconds` | Histogram | `organization, stream_type` | Wall time of a `prune` call |
| `bloom_check_errors_total` | IntCounter | `organization, stream_type` | Per block-fetch / size-mismatch failure inside one group (very rare; usually indicates a corrupt `.bf`) |
| `bloom_file_built_total` | IntCounter | `organization, stream_type` | Per successful `.bf` upload |
| `bloom_file_build_failed_total` | IntCounter | `organization, stream_type, stage` | Per build failure; `stage ∈ {serialize, upload, update_file_list}` |

Healthy steady state: `keep_ratio` near zero for high-cardinality lookups, `built_total` growing roughly in step with compaction cycles, both `*_failed_total` and `check_errors_total` flat.

---

## 9. Configuration

Feature gate (reused from the now-removed parquet-column-bloom path):

```
ZO_BLOOM_FILTER_ENABLED = true
```

Footer cache size (mirrors `ZO_INVERTED_INDEX_FOOTER_CACHE_MAX_SIZE`):

```
ZO_BLOOM_FOOTER_CACHE_MAX_SIZE = 0  # MB; 0 = auto-size to 1% of total mem, clamped [32, 256]
```

When `false`:

- Compactor never builds `.bf`.
- Search side never enters the prune step.

Per-stream opt-in is via the existing `StreamSettings`:

- `index_fields`: SecondaryIndex (raw-tokenized in tantivy)
- `bloom_filter_fields`: BloomFilter

Only the **intersection** is bloom-targeted. A field listed only in one isn't built.

Search-side concurrency is config-driven, mirroring the tantivy search path (`grpc/storage.rs`):

```rust
fn bloom_prefetch_concurrency() -> usize {
    config::get_config().limit.query_thread_num.max(1)
}
```

Defaults to `cpu_num * 4` (cluster) / `cpu_num` (local). No hardcoded constant — large multi-day trace_id lookups need to fan out far beyond 32 buckets, and tantivy's path already tunes against the same env var.

Internal tuning constants (not currently exposed as env vars):

- Default FPP = `0.01` (≈ 1% false-positive rate; ~10 bits/element with SBBF)
- `BLOOM_SUFFIX_PROBE_BYTES = 16 KB` (size of the suffix range probe on footer-cache miss; should cover the footer for buckets up to ~150 indexed files at the typical 3-field config — footer is ~24 B per (file, field) entry + ~7.5 KB per-field header)

---

## 10. Lifecycle and storage

### 10.1 `.bf` lifetime

A `.bf` is **never deleted by the bloom layer**. With append-only writes:

- A `.bf` referenced when written stays referenced for as long as any of its files exist (live or dumped).
- No rebuild ever supersedes it, so no GC enqueue.

`.bf` files are removed by the **outer data-retention sweep** that already removes `parquet` and `.ttv` files when an entire `(org, stream, date)` partition ages out. The `bloom/{org}/{stream}/{date}/` subtree is removed alongside.

### 10.2 Storage cost

Per file at FPP 0.01: `~10 bits/term × N`.

For a typical hot trace stream (1M unique trace_ids per file): ≈ 1.5 MB `.bf` body per file. A hour with 100 such files → 150 MB hourly `.bf`. Over 30 days, single stream: ~110 GB.

Mitigation: only the fields the user opts into via `bloom_filter_fields` get blooms. Low-cardinality fields are tiny.

### 10.3 Multiple `.bf` per hour

Because bloom build is append-only, a hour that received writes across N compaction rounds has up to N `.bf` files. Search handles this natively (group by `(date, bloom_ver)`, fetch each). N is typically 1–3 per hour in practice (initial ingest + 1–2 compaction rounds).

A 30-day high-cardinality query: ≈ 720 hours × 2 avg = ~1440 `.bf` footers, bounded by `buffer_unordered(bloom_prefetch_concurrency())` and absorbed by `BLOOM_FOOTER_CACHE` after the first query. The 32-byte block reads themselves are batched per bucket via `get_ranges` and hit the local file cache once warm.

---

## 11. Limitations

| Limitation | Workaround |
|---|---|
| `bloom_ver` on **dumped rows is frozen** at dump time | If frozen at 0, those rows fall back to tantivy. A backfill CLI tool can be added later if needed. |
| Layer doesn't help **range / `LIKE` / `!=` / regex / OR-with-non-indexed** queries | These predicates are skipped by `bloom_predicate::extract` and the search path is unchanged for them. |
| **Per-stream multi-row write**: `update_bloom_ver` fans out as one UPDATE per chunk of 900 ids (SQLite) or one `UPDATE ... = ANY($)` (Postgres). For very wide hours (>1000 files) the SQLite path runs multiple statements. | Acceptable; not on the hot read path. |
| No automatic backfill if bloom build fails synchronously, or if the operator turns on `bloom_filter_enabled` / adds `bloom_filter_fields` after data has been ingested. | Rows stay at `bloom_ver = 0` indefinitely; search falls back to tantivy for them. A backfill CLI re-runs the build for a specified time range. |

---

## 12. Known weak spots & potential issues

Things that work today but we know aren't ideal. Listed here so we
remember to come back to them — none are blocking.

### 12.1 Operational risks

#### `.bf` orphans from partial-failure builds

If `storage::put` succeeds but the subsequent `update_bloom_ver` fails,
the `.bf` is uploaded with no row referencing it. The append-only
invariant means we never re-encounter the bucket in a way that would
fix this — the next `build_for_bucket` sees the same `bloom_ver = 0`
rows and writes a *new* `.bf` with a fresh timestamp.

**Impact:** bounded storage waste. The orphan is at most one `.bf` per
bucket per failure event, and `bloom_file_build_failed_total{stage=
"update_file_list"}` tracks the rate. Eventually deleted when the
date partition ages out.

**Fix later:** if rate is non-trivial, retry the UPDATE before giving
up, or pre-allocate `bloom_ver` and write the UPDATE first
(makes it possible to roll back the `.bf` upload).

#### Multi-`.bf`-per-hour growth on hot streams

Each compaction round on an hour produces a new `.bf` for whatever
files arrived since the last build. A hot stream with many small
ingest-flushes per hour (lots of compaction rounds before settling)
can accumulate 10+ `.bf` per hour. Search has to fetch every distinct
`bloom_ver` for the bucket.

**Impact:** more fetches per query (currently capped at
`buffer_unordered(32)`); more storage in the `bloom/` subtree.

**Fix later:** a periodic **compact-bloom** pass that, for stable
hours (settled long enough that no `bloom_ver = 0` will appear
again), reads every `.bf` in the bucket, merges them by OR-ing
each (file, field) bitset, writes one combined `.bf`, and atomically
re-points file_list rows. This is safe for live data but breaks the
"never re-stamp" invariant for dumped rows — would need to either
skip hours that have been partially dumped, or run before dump.

### 12.2 Performance gaps

#### No cross-query `Arc<BloomReader>` cache

`BLOOM_FOOTER_CACHE` caches suffix bytes; every prune call still
calls `BloomReader::parse_suffix` to walk the footer into the
`HashMap<field, HashMap<file_id, ...>>` structure.

**Impact:** the parse is cheap (microseconds for a typical footer of
~24 B per file × few fields) but it's pure waste on a hot bucket
queried thousands of times per second.

**Fix later:** swap the suffix-bytes cache for an `Arc<BloomReader>`
cache keyed by path. The reader is footer-only (no body), so memory
per entry is small — a few hundred bytes for typical .bf footers.

#### Hardcoded FPP / probe sizing

Two build/probe constants that aren't env-configurable yet:

- `DEFAULT_FPP = 0.01` (build)
- `BLOOM_SUFFIX_PROBE_BYTES = 16 KB` (search-side cache-miss footer probe)

**Impact:** users can't tune without recompiling. The probe constant
matters on the cache-miss path: if a `.bf` has a footer larger than
16 KB (≳ 150 indexed files × 3 fields in a single hour), the suffix
probe fails to cover the footer and the bucket degrades to "keep all".

**Fix later:** add `ZO_BLOOM_DEFAULT_FPP` and
`ZO_BLOOM_SUFFIX_PROBE_BYTES` env vars. The search-side concurrency
is already config-driven (mirrors tantivy's `query_thread_num`,
see §9).

### 12.3 Semantic / coverage gaps

#### Frozen `bloom_ver` on dumped rows

The synchronous build hook fires before `set_job_done`, so under
normal operation the file_list row carries the correct `bloom_ver`
by the time dump runs. The frozen-at-zero case still happens when:

- Synchronous build had a partial or full failure (network, schema
  drift, target field not present in the file) — row stays at
  `bloom_ver = 0`, gets dumped at 0.
- Operator turns on `bloom_filter_enabled`, or adds a field to
  `bloom_filter_fields`, after the data has already been dumped.
  The dumped rows are no longer in `file_list`, so even a
  configuration-aware sweep can't reach them.

Once frozen, search for those rows degrades to the original tantivy
path. Correctness preserved, perf benefit lost for that data.

**Fix later:** a backfill CLI that reads a dump parquet, builds
blooms for its rows, writes a `.bf`, and rewrites the dump with
updated `bloom_ver`s. Tractable but mechanically tricky (rewriting a
dump means atomically swapping the parquet object).

**Observability:** `bloom_dumped_files_total{bloom_ver_zero}` (added
in this PR) counts every dumped row split by whether it was frozen
at zero or not — lets the operator decide when to schedule a
backfill.

#### Predicate extraction limited to top-level AND

Nested `And`, top-level `Or`, and any combination involving
`NotEqual` / `Regex` / `MatchAll` are all skipped by
`bloom_predicate::extract`.

**Impact:** queries with these shapes get no bloom pruning.

**Fix later:** for nested `And`, recurse into the predicate tree —
trivial. For `Or`, only useful if every branch is bloom-prunable AND
combined with bloom-OR (each predicate keeps the file if *any*
branch's bloom says maybe). Adding this widens applicability but
the implementation is non-trivial enough that it should wait until
we see real queries that need it.

### 12.4 Observability gaps

#### No bloom-coverage metric

We don't expose a "what fraction of file_list has `bloom_ver != 0`"
gauge per stream. The dump-time counter `bloom_dumped_files_total{
bloom_ver_zero}` is the closest signal we have today, but it only
covers data after it leaves the live file_list.

**Fix later:** a periodic gauge `bloom_coverage_ratio{org,stream}`
populated from a cheap `COUNT(*) FILTER (WHERE bloom_ver = 0) /
COUNT(*)` aggregate. Beware though: `bloom_ver = 0` aggregates the
four sentinel cases listed in §5.3, including "no contribution"
which can be a steady-state non-zero count even when everything is
working. Interpreting the gauge would need to subtract those out.

### 12.5 Test gaps

#### No end-to-end integration test

The unit tests cover format round-trip, predicate extraction, prune
on a synthetic in-memory `.bf`, and the SBBF compatibility check.
But there's no test that wires ingest → compact → bloom_build →
search through a real (in-memory) object store + tantivy + parquet
pipeline.

**Impact:** regressions in the wiring (like the `bloom_ver` SELECT
list bug we hit in review) only surface in CI runs against real
infra, sometimes only in production.

**Fix later:** an integration test under `tests/` using
`InMemory` object store, `RamDirectory` tantivy, and an in-memory
SQLite. Build a small parquet, ingest, run compact, run a search,
assert the prune metric moved.

---

## 13. Future work

Capabilities we **don't have yet** but might want, separate from the
§12 known weak spots which are about improving things we already do.

- **Hour-level summary bloom** (hierarchical) for queries that span thousands of buckets, to skip whole hours with one bloom check before fetching per-file blooms. Only worth it if real query traces show the per-file fetch dominates.
- **Per-stream `fpp`** via `StreamSettings` for users who want tighter FPR on hot streams (e.g. 0.001 for a billion-trace-id-per-day stream at the cost of ~1.4× more `.bf` bytes).
- **Bloom on tokenized fields** (Loki BBF 2.0 style) — would handle full-text queries, but requires re-thinking term enumeration since FTS term dicts can be huge. Currently full-text goes through tantivy directly with no bloom prune.
- **`Arc<BloomReader>` cross-query cache** — moved here from §12.2 since it's a *new capability* (the reader is `&self`-ready, but the cache itself is new code).
- **Backfill CLI** for hours where the live build path didn't cover everything — synchronous build failures, or operator-side config changes (`bloom_filter_enabled` flipped on, fields added to `bloom_filter_fields`) after data has been ingested. Required if you need bloom coverage on those rows; without it they stay at `bloom_ver = 0` and search degrades to tantivy for them.

---

## 14. File map

| File | Role |
|---|---|
| `src/infra/src/bloom/mod.rs` | Module root, magic + version constants |
| `src/infra/src/bloom/path.rs` | `bloom_path` / `bloom_dir` helpers |
| `src/infra/src/bloom/sbbf.rs` | Own SBBF impl (Parquet spec, ~120 LOC); `Sbbf`, `block_index`, `check_block`, `hash_value`, `num_blocks_for`, `BLOCK_BYTES` |
| `src/infra/src/bloom/writer.rs` | `BloomBuilder`, `FieldBloom`, `BloomWriter::serialize`, `WriteError` |
| `src/infra/src/bloom/reader.rs` | `BloomReader::parse / parse_suffix / block_range_for / check_block_with_hash`, `ReadError` |
| `src/infra/src/bloom/footer_cache.rs` | `BLOOM_FOOTER_CACHE` (path → suffix bytes) |
| `src/infra/src/bloom/DESIGN.md` | This document |
| `src/infra/src/file_list/mod.rs` | `FileList::update_bloom_ver` trait |
| `src/infra/src/file_list/{sqlite,postgres}.rs` | DB impls + DDL + migrations |
| `src/service/tantivy/bloom_builder.rs` | `build_blooms_from_index` (term-dict iteration) |
| `src/service/compact/bloom_build.rs` | `build_for_bucket` |
| `src/service/compact/merge.rs` | per-prefix bloom_build hook in `merge_by_stream` |
| `src/service/search/bloom_predicate.rs` | predicate extraction |
| `src/service/search/bloom_pruner.rs` | `prune` (fetch + evaluate) |
| `src/service/search/grpc/storage.rs` | search-path hook before `tantivy_search` |
| `src/service/file_list_dump.rs` | dump-parquet schema + tolerant `bloom_ver` reader |
| `src/service/compact/dump.rs` | dump-parquet writer with `bloom_ver` column, plus the `bloom_dumped_files_total` metric |
| `src/proto/proto/cluster/common.proto` | gRPC `FileMeta.bloom_ver` (tag 7) |
| `src/config/src/metrics.rs` | six Prometheus metrics |

---

## 15. Open questions

(none blocking; documented for future readers)

- Should `.bf` GC happen via a smarter scan (e.g., orphan detection) instead of the per-(stream, date) retention sweep? Only worth it if storage of orphans becomes a measurable problem.
- Could the predicate extractor be extended to handle nested `And`? Marginal value; current top-level AND covers the canonical `WHERE trace_id = X AND service = Y` case.
