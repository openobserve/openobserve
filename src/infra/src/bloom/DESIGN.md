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
- **Backfill of dumped data**: dumped rows preserve their `bloom_ver` at dump time; if it was 0, it stays 0. Operationally rare; CLI tool can be added later if needed.

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
| `service::compact::bloom_build` | `openobserve` | **Builder**: post-merge + periodic catchup; stamps `bloom_ver` |
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
   BODY            (concat of `Sbbf::write` outputs, each is
                    parquet's thrift `BloomFilterHeader` + bitset)
─────────────────────────────────────────────
   FOOTER          (hand-rolled, no thrift)
     field_count   u32 LE
     per field:
       name_len    u16 LE
       name        bytes
       algo        u8           (0x01 = SBBF + xxhash64, parquet spec)
       file_count  u32 LE
       per file:
         file_id     u64 LE  (file_list.id cast to u64)
         body_offset u64 LE
         body_size   u32 LE
         n_items     u32 LE
─────────────────────────────────────────────
   FOOTER_LEN  4B  (LE)
   MAGIC       4B  "O2BF"
EOF─────────────────────────────────────────
```

Bloom algorithm: `parquet::bloom_filter::Sbbf` (Parquet spec, SBBF + XxHash64 seed=0). Each per-(file, field) bloom in the body is a stand-alone Parquet column-bloom — feedable to any parquet-aware tool.

Width-overflow checks at write time return `WriteError::{FieldNameTooLong, TooManyFields, TooManyFiles, BloomBodyTooLarge}` instead of silent `as` casts.

Tail magic + footer-length pointer enables Parquet-style tail reads for future streaming readers; current reader is whole-blob.

The reader uses `OnceLock<Result<Sbbf, ReadError>>` per file entry, so `BloomReader::check` takes `&self` and the same reader can be shared across queries via `Arc` without per-call locking.

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

### 5.2 Trigger sites

The bloom build is fired from two places. Both call the same `build_for_bucket` so the invariant is enforced once.

#### A. After every per-(stream, hour) compaction round

Inside `service::compact::merge::merge_by_stream`, after the per-prefix worker barrier completes, iterate every visited prefix and call `build_for_bucket`. This fires whether or not merging actually happened, so a hour with one big file (no merge needed) is still bloom-built.

#### B. Periodic catchup sweep

`service::compact::bloom_build::run_catchup` runs alongside `run_merge` / `run_retention` in `src/job/compactor.rs`. Per tick:

1. Iterate orgs and streams from cache.
2. For each stream this node owns (consistent-hash gate), call `query_pending_bloom_dates` — distinct `date`s where any row has `bloom_ver = 0` AND newest `updated_at` predates the **settling window** (default `compact.interval × 4`, ≥ 60s).
3. For each returned date, call `build_for_bucket`.

Catches three real gaps the per-merge hook misses:

| Scenario | Per-merge hook | Catchup |
|---|---|---|
| Active hour, new files arriving | ✓ | (skipped, settling window) |
| Hour with 1 file already, no merging | ✗ | ✓ |
| Operator just enabled `bloom_filter_enabled` on settled stream | ✗ | ✓ |
| Stream stopped ingesting long ago, old `bloom_ver=0` data | ✗ | ✓ |

### 5.3 Concurrency

No explicit locking. Two layers of natural exclusion:

- **Per-merge hook**: the compactor scheduler already pins one worker per `(stream, partition_prefix)`, so two workers cannot bloom-build the same hour at the same time.
- **Catchup**: distributed via the same consistent-hash gate the rest of the compactor uses; only the owner node sweeps a given stream. The settling window prevents catchup from racing the per-merge hook.

If two builds did somehow overlap on the same bucket, the worst case is two `.bf` files written at different `bloom_ver`s; the later UPDATE wins for whichever rows it covers. The append-only invariant means rows already at non-zero `bloom_ver` aren't touched by either build.

### 5.4 What dump sees

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

`service::search::bloom_pruner::prune(files, predicates, org, stream_type, stream)`:

1. **Split**: files with `bloom_ver = 0` pass through untouched.
2. **Group** remaining files by `(date, bloom_ver)` so each `.bf` is fetched only once.
3. **Fetch**, bounded:
   - `stream::buffer_unordered(BLOOM_PREFETCH_CONCURRENCY = 32)` — caps the in-flight GET burst (a 30-day query touches ~720 buckets).
   - Cache-only first via `infra::cache::file_data::get_opts(remote=false)`. On miss → remote `get` + write-through `set` so subsequent prune calls touching the same `.bf` are cache hits.
4. **Parse** each blob with `BloomReader::parse`.
5. **Evaluate** per file: kept iff every predicate's bloom returns "maybe" for at least one of its values (OR within a predicate, AND across predicates).
6. Files with unknown field/file_id (schema drift) → conservatively keep.

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
| `Sbbf::from_bytes` fails on a single (field, file_id) | Log warn, bump `BLOOM_CHECK_ERRORS_TOTAL`, conservatively keep that file |
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
| `bloom_check_errors_total` | IntCounter | `organization, stream_type` | Per `Sbbf::from_bytes` failure on a single (field, file_id) |
| `bloom_file_built_total` | IntCounter | `organization, stream_type` | Per successful `.bf` upload |
| `bloom_file_build_failed_total` | IntCounter | `organization, stream_type, stage` | Per build failure; `stage ∈ {serialize, upload, update_file_list}` |

Healthy steady state: `keep_ratio` near zero for high-cardinality lookups, `built_total` growing roughly in step with compaction cycles, both `*_failed_total` and `check_errors_total` flat.

---

## 9. Configuration

Single feature gate, reused from the (now-removed) parquet-column-bloom path:

```
ZO_BLOOM_FILTER_ENABLED = true
```

When `false`:

- Compactor never builds `.bf`.
- Catchup sweep is a no-op.
- Search side never enters the prune step.

Per-stream opt-in is via the existing `StreamSettings`:

- `index_fields`: SecondaryIndex (raw-tokenized in tantivy)
- `bloom_filter_fields`: BloomFilter

Only the **intersection** is bloom-targeted. A field listed only in one isn't built.

Internal tuning constants (not currently exposed as env vars):

- Default FPP = `0.01` (≈ 1% false-positive rate; ~10 bits/element with SBBF)
- `BLOOM_PREFETCH_CONCURRENCY = 32` (search-side parallel `.bf` fetches)
- Catchup settling window = `compact.interval × 4` (min 60s)

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

A 30-day high-cardinality query: ≈ 720 hours × 2 avg = ~1440 `.bf` fetches, bounded by `buffer_unordered(32)` and absorbed by the file_data cache after the first query.

---

## 11. Limitations

| Limitation | Workaround |
|---|---|
| `bloom_ver` on **dumped rows is frozen** at dump time | If frozen at 0, those rows fall back to tantivy. A backfill CLI tool can be added later if needed. |
| Layer doesn't help **range / `LIKE` / `!=` / regex / OR-with-non-indexed** queries | These predicates are skipped by `bloom_predicate::extract` and the search path is unchanged for them. |
| **Per-stream multi-row write**: `update_bloom_ver` fans out as one UPDATE per chunk of 900 ids (SQLite) or one `UPDATE ... = ANY($)` (Postgres). For very wide hours (>1000 files) the SQLite path runs multiple statements. | Acceptable; not on the hot read path. |
| Compactor must finish a **bloom build before dump** for the same hour to see non-zero `bloom_ver`. | Settling-window-based ordering. Default `compact.interval × 4` (4 cycles) gives compaction + bloom build ample time. |

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

#### Settling window vs. slow compaction

`run_catchup` excludes buckets whose newest `updated_at` is within
`compact.interval × 4` (default ≈ 40 s). If a real compaction round
takes longer than that — e.g. backed-up queue, slow object store —
catchup could fire on a bucket compactor was still about to touch.

**Impact with append-only writes:** redundant work, not incorrectness.
Catchup builds for the `bloom_ver = 0` rows it sees; compactor's
later round sees no `bloom_ver = 0` rows and skips. The `.bf`
catchup wrote is valid and referenced.

**Fix later:** make the multiplier configurable; or have catchup look
at compactor pending-job count and back off when it's high.

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

#### No cross-query `BloomReader` cache

`BloomReader::check` is `&self` (interior `OnceLock<Sbbf>`), so we
*can* share via `Arc` across queries — but we don't yet. Every prune
call re-parses each `.bf` footer it touches.

**Impact:** the parse is cheap (dozens of microseconds for a typical
footer) but it's pure waste on a hot bucket queried thousands of
times per second.

**Fix later:** add an LRU `HashMap<(org, stream, date, bloom_ver),
Arc<BloomReader>>` next to the file_data cache. The cache key is
unique per `.bf` and the reader is immutable, so eviction is a pure
LRU concern.

#### Hardcoded concurrency / FPP / settling window

Three constants that should probably be env-configurable:

- `BLOOM_PREFETCH_CONCURRENCY = 32` (search prune)
- `DEFAULT_FPP = 0.01` (build)
- `compact.interval × 4` settling window (catchup)

**Impact:** users can't tune without recompiling.

**Fix later:** add `ZO_BLOOM_PREFETCH_CONCURRENCY`,
`ZO_BLOOM_DEFAULT_FPP`, `ZO_BLOOM_SETTLING_WINDOW_SECS` env vars.

#### `query_pending_bloom_dates` cost on huge `file_list`

The distinct-date scan with `stream = ? AND bloom_ver = 0 AND
updated_at < ?` runs once per stream per catchup tick. On Postgres
this hits the partition for the relevant date and is fast; on SQLite
it's a full-table scan filtered by index.

**Impact:** linear in the size of `file_list` per stream. Fine for
typical deployments, possibly slow for users with multi-million-row
file_lists per stream.

**Fix later:** add a covering index `(stream, bloom_ver, updated_at)`
if profiling shows this query dominating; or have ingest write
`bloom_ver = 0` rows to a sidecar "pending bloom" queue table that
catchup reads instead.

### 12.3 Semantic / coverage gaps

#### Frozen `bloom_ver` on dumped rows

If a row is dumped while at `bloom_ver = 0` (catchup hadn't reached
it yet, or dump retention is shorter than the settling window), its
`bloom_ver` stays 0 forever. Search for those rows degrades to the
original tantivy path.

**Impact:** correctness preserved, perf benefit lost for that data.

**Fix later:** a backfill CLI that reads a dump parquet, builds
blooms for its rows, writes a `.bf`, and rewrites the dump with
updated `bloom_ver`s. Tractable but mechanically tricky (rewriting a
dump means atomically swapping the parquet object).

Alternative: have the dump path **wait for catchup** on a hour
before dumping it, instead of relying on the global settling window.

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
gauge per stream. If catchup falls behind ingest, you'd find out by
seeing low `bloom_prune_keep_ratio` improvement, not by seeing
coverage directly.

**Fix later:** a periodic gauge `bloom_coverage_ratio{org,stream}`
populated from a cheap `COUNT(*) FILTER (WHERE bloom_ver = 0) /
COUNT(*)` aggregate. Could share the same scheduler tick as catchup.

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
- **Backfill CLI** for hours that were dumped at `bloom_ver = 0` — moved here from §12.3 since it's a new tool, not a fix to existing behavior.

---

## 14. File map

| File | Role |
|---|---|
| `src/infra/src/bloom/mod.rs` | Module root, magic + version constants |
| `src/infra/src/bloom/path.rs` | `bloom_path` / `bloom_dir` helpers |
| `src/infra/src/bloom/writer.rs` | `BloomBuilder`, `FieldBloom`, `BloomWriter::serialize`, `WriteError` |
| `src/infra/src/bloom/reader.rs` | `BloomReader::parse / check`, `ReadError` |
| `src/infra/src/bloom/DESIGN.md` | This document |
| `src/infra/src/file_list/mod.rs` | `FileList::update_bloom_ver`, `query_pending_bloom_dates` traits |
| `src/infra/src/file_list/{sqlite,postgres}.rs` | DB impls + DDL + migrations |
| `src/service/tantivy/bloom_builder.rs` | `build_blooms_from_index` (term-dict iteration) |
| `src/service/compact/bloom_build.rs` | `build_for_bucket`, `run_catchup` |
| `src/service/compact/merge.rs` | per-prefix bloom_build hook in `merge_by_stream` |
| `src/service/search/bloom_predicate.rs` | predicate extraction |
| `src/service/search/bloom_pruner.rs` | `prune` (fetch + evaluate) |
| `src/service/search/grpc/storage.rs` | search-path hook before `tantivy_search` |
| `src/service/file_list_dump.rs` | dump-parquet schema + tolerant `bloom_ver` reader |
| `src/service/compact/dump.rs` | dump-parquet writer with `bloom_ver` column |
| `src/job/compactor.rs` | `run_bloom_catchup` scheduler entry |
| `src/proto/proto/cluster/common.proto` | gRPC `FileMeta.bloom_ver` (tag 7) |
| `src/config/src/metrics.rs` | five Prometheus metrics |

---

## 15. Open questions

(none blocking; documented for future readers)

- Should the catchup settling window be configurable per-stream rather than a global `compact.interval × 4`? Probably overkill until we see a real case where it matters.
- Should `.bf` GC happen via a smarter scan (e.g., orphan detection) instead of the per-(stream, date) retention sweep? Only worth it if storage of orphans becomes a measurable problem.
- Could the predicate extractor be extended to handle nested `And`? Marginal value; current top-level AND covers the canonical `WHERE trace_id = X AND service = Y` case.
