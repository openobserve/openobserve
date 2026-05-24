# Bloom-filter pruning above tantivy

> **Status:** experimental / POC — transposed layout + sub-grouping
> **Layer:** built **on top of** tantivy — a field must be a tantivy secondary index (`index_fields`) *and* opted into `bloom_filter_fields`; only the intersection is built (§11.0)
> **Scope:** positive equality / IN lookups; meaningful only for **random** high-cardinality fields (§11)

This document describes the bloom-filter pruning layer that sits above tantivy in OpenObserve's search path. **Read §11 before enabling it** — it is a win for random high-cardinality ids and a net cost for time-ordered ones.

---

## 1. Motivation & where it actually helps

OpenObserve search already prunes parquet via tantivy:

```
file_list query → tantivy lookup per file → row_ids → parquet read
```

The bloom layer adds a cheaper preliminary step that can drop files before
any tantivy file is opened:

```
file_list query → bloom filter prune → tantivy lookup → parquet read
                  └──────── new ────────┘
```

**When it helps — and when it doesn't (read this first).** Bloom is a
local-IO/CPU-for-remote-IO trade. It only pays off when its membership
data is cheap to consult *and* it prunes enough to save downstream work.
Two empirical findings from S3 testing shape the whole design:

1. **Tantivy's footer-cached sparse index already prunes time-ordered IDs for free.** For
   UUIDv7 / snowflake / any time-correlated id, files are time-partitioned so each file's term
   range is narrow and non-overlapping. Tantivy's in-memory sstable sparse index rejects almost
   every file with **zero S3 IO**. Bloom cannot beat that — and shouldn't try. It is redundant for
   time-ordered fields.

2. **For fully-random ids (UUIDv4, W3C 16-byte trace_id, random request_id) tantivy can't
   range-reject** — every file's term range spans the whole value space, so tantivy must fetch one
   term-dict block per file (`N` S3 reads). This is the window where bloom can win — *if* a bloom
   lookup costs far less than `N` remote reads.

A naive per-file bloom does **not** win even in case 2: it issues one
remote read per file too (`N`), then tantivy still runs on survivors
(`K`), for `N + K` > `N`. The transposed layout (§4.3) is what changes
the math: it makes a whole group answerable in **one** read, so bloom
prune costs `O(groups)` reads instead of `O(files)` — `N → ~ceil(files /
max_files_per_bf)`. That, plus a high prune rate, is what can beat
tantivy's `N` for random fields.

**Net:** enable bloom for high-cardinality **random** fields; leave it off
for time-ordered ids (tantivy wins) and for deployments where neither
applies. See §11 for the precise decision table.

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
- **Backfill of dumped data**: dumped rows preserve their `bloom_ver` at dump time; if it was 0, it stays 0. A CLI tool to rebuild blooms for a specified time range is planned (see §14) but not in this PR.

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
- `bloom_ver` is `now_micros()` at build (+ chunk index for sub-groups, §5.1); combined with the `(stream, date)` prefix it is unique per `.bf`. One hour can have several `.bf` files (multiple compaction rounds and/or sub-group chunks).

### 4.3 `.bf` file layout — transposed (block-major)

This is the key structural choice. All files of a field within one `.bf`
share the same `num_blocks = B`. Because `block_index = fastmap(hash(value),
B)` depends only on `B`, a query value maps to the **same block index `bi`
across every file**. Laying the body out block-major (all files' block 0,
then all files' block 1, …) makes the blocks a query needs — one per file —
a **single contiguous row** at `bi`. The search side then reads one
`M × 32`-byte range per `.bf`, not one tiny range per file.

```
0  ─────────────────────────────────────────
   MAGIC      4B   "O2BF"
   VERSION    1B   0x01
─────────────────────────────────────────────
   BODY            per field, a transposed M×B bit-matrix:
                     row 0  : [f0.blk0][f1.blk0]…[f(M-1).blk0]   (M × 32 B)
                     row 1  : [f0.blk1][f1.blk1]…[f(M-1).blk1]
                     …
                     row B-1: …
─────────────────────────────────────────────
   FOOTER          (hand-rolled, no thrift)
     field_count   u32 LE
     per field:
       name_len    u16 LE
       name        bytes
       algo        u8           (0x01 = SBBF + gxhash64)
       num_blocks  u32 LE       (B, uniform across files)
       file_count  u32 LE       (M)
       body_offset u64 LE       (start of this field's matrix)
       per file (column order):
         file_id     u64 LE     (file_list.id cast to u64)
         n_items     u32 LE
─────────────────────────────────────────────
   FOOTER_LEN  4B  (LE)
   MAGIC       4B  "O2BF"
EOF─────────────────────────────────────────
```

Body size per field = `B × M × 32`. To answer `value` for `file_id`:
`bi = fastmap(hash(value), B)`; the row is `[body_offset + bi·M·32,
+M·32)`; the file's 32-byte block is at column `col` (from the footer)
within that row.

**Algorithm**: SBBF block layout from the Parquet spec, hash is
**gxhash64 (seed=0)** from `config::utils::hash` (not the spec's xxhash64
— we don't interop with external readers, so the swap is invisible and
drops a dependency; degrades to `DefaultHasher` only on non-AES arches,
self-consistent within one binary). Lives in `infra::bloom::sbbf`:
`Sbbf` (build), plus standalone `check_block(block, hash)` /
`block_index(hash, B)` for the read side.

**Reader is footer-only.** `parse_suffix(suffix, total_size)` reads just
the tail (16 KB suffix probe covers the footer; capped per `.bf` to
≤ `max_files_per_bf` files so the footer is ~`M × 12` bytes — well under
16 KB at the default 256). The body never enters the reader; the pruner
fetches rows on demand via `infra::cache::storage::get_ranges`.

**Format version**: `VERSION = 0x01`, first format. Earlier prototypes
used a file-major layout (per-file SBBF, per-file `num_blocks`) which
forced one read per file; none shipped.

### 4.4 `file_id` choice

`u64 = file_list.id as u64` — assigned by `write_file_list` before the
build runs, and the same id the search side reads off each `FileKey`.
Cast is safe (file_list ids are sequential u63s). In the transposed
footer it doubles as the column key: `file_id → column index`.

---

## 5. Write path

### 5.1 Append-only build

This is the core invariant: **`bloom_ver` is set once per file and never re-stamped**.

`bloom_build::build_for_bucket(org, stream_type, stream, date_key)`:

1. Resolve target fields from current `StreamSettings`: `index_fields ∩ bloom_filter_fields`. Skip if empty.
2. `query_for_merge` to get every file currently in this hour bucket.
3. **Trigger gate**: rebuild iff at least one file has `bloom_ver = 0`. If every file already has a `bloom_ver` (even mixed non-zero values across rows that were stamped at different times), return early.
4. Take the new (`bloom_ver = 0`) files, **sort by record count descending**, and **chunk into groups of ≤ `bloom_filter_max_files_per_bf`** (default 256). Sorting co-locates similar-sized files so the uniform-`B` padding waste within a chunk is small.
5. For each chunk:
   - `B = num_blocks_for(max_records_in_chunk, 0.01)` — record count is a safe NDV upper bound (distinct ≤ rows), so this never under-sizes the SBBF (no saturation) for the target high-cardinality fields where distinct ≈ rows. Sized from metadata, no extra IO. Every file in the chunk uses this `B` (required for the transposed layout). Over-sizes for heavily-repeating fields; exact term-count sizing is future work.
   - For each file: open `.ttv` via `get_tantivy_directory` (cache-friendly), iterate the target fields' term dictionaries (`service::tantivy::bloom_builder::build_blooms_from_index`, terms come back deduped + sorted, no extra IO since `.ttv` is warm), insert into a `B`-sized SBBF.
   - `BloomWriter::serialize` (transposes the chunk's SBBFs) → `storage::put` to `bloom_path(... bloom_ver = base_ts + chunk_idx)` → `update_bloom_ver(chunk_ids, bloom_ver)`.

Each chunk gets its own `bloom_ver`, so the search side sees one
`(date, bloom_ver)` group per chunk and reads one block-row from each.
Files that errored or produced no terms stay at `bloom_ver = 0`.

**Why chunk:** the transposed writer holds all of a chunk's SBBFs in
memory before serialize (`M × B × 32` bytes). One un-chunked hour of
1000 files × 16 MB SBBF = 16 GB → OOM. At 256 files/`.bf` the build
peak is bounded (`256 × per-file-SBBF`), the `.bf` object is bounded,
and the footer stays ≤ ~3 KB. The query cost is `ceil(files /
max_files_per_bf)` reads, each `≤ max_files_per_bf × 32` bytes — total
read bytes unchanged, only request count grows.

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
2. **Group** remaining files by `(date, bloom_ver)` — one `.bf` per group.
3. **Run per group**, bounded by `buffer_unordered(bloom_prefetch_concurrency())` (config-driven, §9):
   - **Footer**: `BLOOM_FOOTER_CACHE.get(path)` (0 GETs) or one `GetRange::Suffix(16 KB)` on miss → `BloomReader::parse_suffix`. Body never materialized.
   - **Rows**: for each `(predicate, value)`, `reader.row_range(field, value)` → one `M × 32`-byte range (the block row shared by *all* files in the group) + the hash. This is **one range per (predicate, value)**, independent of file count.
   - **Batched fetch**: a single `infra::cache::storage::get_ranges(account, path, &row_ranges)` call. For the canonical single-value query that's **one row read for the whole group**.
   - **Check**: for each file, `reader.column_index(field, file_id)` gives its 32-byte slice within the fetched row; `check_block_with_hash(&block, hash)`.
4. **Evaluate** per file: kept iff every predicate returns "maybe" for at least one value (OR within a predicate, AND across predicates). A predicate with no info on a file (field absent, or file not a column) is "unknown → keep".
5. Files in a group whose fetch/parse failed wholesale → conservatively keep.

**Per-`.bf` steady-state IO** (the whole point of the transposed layout):

| | footer | row reads | bytes |
|---|---|---|---|
| cache warm, 1 value | 0 | **1 `get_ranges`** | `M × 32` |
| cache cold, 1 value | +1 suffix (16 KB) | 1 | `M × 32` + 16 KB |
| `IN (v1..vk)` | 0/1 | 1 `get_ranges` of k rows | `k × M × 32` |

Read cost is `O(predicate × value)` reads per `.bf` — **independent of file
count** and of the SBBF size `B`. A 16 MB-per-file SBBF (10M unique at FPR
0.01) is touched for the same `M × 32` bytes as a 2 MB one. With
sub-grouping (§5.1) a hour of `F` files = `ceil(F / max_files_per_bf)`
`.bf`s, so a single-value query is `ceil(F / 256)` row reads, each
`≤ 256 × 32 = 8 KB`.

This is what lets bloom beat tantivy for fully-random fields on S3: where
tantivy must issue ~`F` block reads (no range pruning possible), bloom
issues `ceil(F / 256)` row reads + `K` tantivy reads on survivors. For
time-ordered fields tantivy range-prunes for free and wins regardless —
see §11.

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
| `BloomWriter::serialize` error (overflow / non-uniform `B`) | Log `..{stage="serialize"}`, skip that chunk |
| `.bf` fetch fails | Log warn, keep all files in that group |
| `.bf` parse fails (bad magic, version, truncated, `num_blocks=0`) | Log warn, keep all files in that group |
| `get_ranges` returns fewer rows than requested | `FetchError::RowMismatch`, keep all files in that group |
| Field unknown to the `.bf` (schema/settings drift) | `row_range` → None, predicate is "no info" → keep that file |
| `file_id` not a column in the `.bf` (race / different chunk) | `column_index` → None → keep that file |
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

Per-stream opt-in is via the existing `StreamSettings` — a field must be
in **both** lists for a bloom to be built (bloom reads the tantivy term
dict, so the field must be a secondary index first — see §11.0):

- `index_fields`: SecondaryIndex (the tantivy secondary index — **required**)
- `bloom_filter_fields`: BloomFilter (opt the field into bloom)

Only the **intersection** `index_fields ∩ bloom_filter_fields` is
bloom-targeted. A field in only one list builds no bloom and prunes
nothing. Values are not inspected — the operator decides which fields are
worth it (see §11.2 / §11.3 for guidance).

Build-side sizing / chunking:

```
ZO_BLOOM_FILTER_MAX_FILES_PER_BF = 256  # files per `.bf` chunk (caps build memory & object size; query reads = ceil(files / this))
```

`B` is sized as `num_blocks_for(max_records_in_chunk, 0.01)` — record
count is the NDV upper bound, so the SBBF never saturates for
high-cardinality fields. (`ZO_BLOOM_FILTER_NDV_RATIO` is **not** used by
this path; sizing from `records / ratio` under-sizes unique fields by the
ratio and saturates the filter — the bug that made an early build keep
every file.)

`max_files_per_bf` is the main scale knob: bigger → fewer reads per query
but more compactor memory at build (`≈ files × per-file-SBBF`); smaller →
bounded memory but more reads. 256 balances both; drop to 128 if the
compactor is memory-constrained at very high volume.

Search-side concurrency is config-driven, mirroring the tantivy search path (`grpc/storage.rs`):

```rust
fn bloom_prefetch_concurrency() -> usize {
    config::get_config().limit.query_thread_num.max(1)
}
```

Defaults to `cpu_num * 4` (cluster) / `cpu_num` (local). No hardcoded constant.

Internal tuning constants (not currently exposed as env vars):

- Default FPP = `0.01` (≈ 1% false-positive rate; ~10 bits/element with SBBF)
- `BLOOM_SUFFIX_PROBE_BYTES = 16 KB` (suffix probe on footer-cache miss; footer is ~`M × 12` bytes, so the default `max_files_per_bf = 256` keeps it well under 16 KB)

---

## 10. Lifecycle and storage

### 10.1 `.bf` lifetime

A `.bf` is **never deleted by the bloom layer**. With append-only writes:

- A `.bf` referenced when written stays referenced for as long as any of its files exist (live or dumped).
- No rebuild ever supersedes it, so no GC enqueue.

`.bf` files are removed by the **outer data-retention sweep** that already removes `parquet` and `.ttv` files when an entire `(org, stream, date)` partition ages out. The `bloom/{org}/{stream}/{date}/` subtree is removed alongside.

### 10.2 Storage cost

`.bf` body per `.bf` chunk = `B × M × 32`, where `B = num_blocks_for(max_records_in_chunk, 0.01)` and `M ≤ max_files_per_bf`.

| per-file unique values | B (blocks) | per-file SBBF | one 256-file `.bf` |
|---|---|---|---|
| 1M | 65 536 | 2 MB | 512 MB |
| 10M | 524 288 | 16 MB | 4 GB |

This scales with **total cardinality** — it's inherent to bloom, not the
layout (the transpose doesn't add bytes; uniform-`B` padding is the only
overhead, kept small by size-sorting before chunking). At extreme volume
(10B rows/hour) this is GBs/hour; weigh it against query benefit before
enabling. Mitigation: only `bloom_filter_fields ∩ index_fields` get
blooms; low-cardinality fields are tiny.

### 10.3 Multiple `.bf` per hour

A hour has multiple `.bf` files for two reasons: (a) append-only build
across N compaction rounds, and (b) sub-grouping — each round splits its
new files into `ceil(new_files / max_files_per_bf)` chunks. Search handles
both natively by grouping candidates on `(date, bloom_ver)` and reading
one block-row per group. Query read cost for a hour of `F` files ≈
`ceil(F / max_files_per_bf)` row reads.

---

## 11. When to enable — operator's call, here's the guidance

### 11.0 Prerequisite: bloom is built **on top of** tantivy

A `.bf` is built by iterating the **tantivy term dictionary** of each
file (`build_blooms_from_index`), not by scanning parquet. So a field
only gets a bloom if it is **already a tantivy secondary index**. The
builder targets exactly `index_fields ∩ bloom_filter_fields`:

- A field in `bloom_filter_fields` but **not** in `index_fields` → no
  `.ttv` term dict to read → **no bloom is ever built** for it (and the
  search-side predicate finds the field absent from every `.bf`, so it
  prunes nothing).
- **Both must be set on the stream** for bloom to take effect.

This is by design: bloom is a *pruning accelerator for tantivy*, not a
standalone index. It exists to cut how many `.ttv` files tantivy must
open, so it can only cover fields tantivy already indexes.

### 11.1 No value inspection — the operator decides

The build does **not** sample field values to decide whether a bloom is
worthwhile (e.g. detect time-ordered vs random). Whatever the operator
puts in `bloom_filter_fields ∩ index_fields` gets a bloom. The guidance
below is advisory; enforcement is left to the operator because only they
know their id scheme and query mix.

### 11.2 Decision table

The layer is a net cost unless the indexed field is high-cardinality
**and random** (not time-ordered), and queries are frequent enough to
amortize the extra `.bf` storage.

| Field | Verdict |
|---|---|
| **Fully-random high-cardinality** (UUIDv4, W3C 16-byte trace_id, random request_id, random hash) | **Enable — this is the target.** Tantivy can't range-prune, so it must open every `.ttv`; bloom cuts that to ~the real matches. |
| **Time-ordered high-cardinality** (UUIDv7, snowflake, ts-prefixed ids) | **Leave off.** Tantivy's footer-cached sparse index already range-rejects with ~0 IO; bloom only adds latency + storage. |
| Low-cardinality / non-indexed / range / `LIKE` / regex / `!=` / OR | **Off (no effect).** Either not built, or skipped by `bloom_predicate::extract`. |

### 11.3 Measured results (S3, no disk cache, 170 files / 14.64 GB index, 1 group)

Same stream `benchtest`, two fields — one random, one time-ordered —
queried for a single matching row:

| Field | Type | tantivy only | bloom + tantivy | Outcome |
|---|---|---|---|---|
| `trace_id` = `1fb3487f…` (16-byte random) | random | **2584 ms** (opens all 170 `.ttv`) | 24 ms prune + 65 ms tantivy = **89 ms** | **~29× faster** |
| `request_id` = `019e588a-…-7e74-…` (UUIDv7) | time-ordered | **154 ms** (range-prunes to ~1 file) | 42 ms prune + 187 ms tantivy = **229 ms** | ~1.5× **slower** |

The transposed read cost was confirmed minimal: the whole 170-file group
was answered by **one row read of 5440 bytes** (`170 × 32`) + a cached
footer — total bloom traffic across the run ≈ 170 KB / ~30 requests.

Takeaways:
- For the random field, tantivy alone degrades to a full 170-file scan (2.6 s); bloom prunes to 1 file first, so it's a large win.
- For the UUIDv7 field, tantivy's sparse index already does the pruning in memory; bloom is pure overhead.
- Same code, same data — the **only** variable is whether the field's values are time-correlated. That's why the choice is the operator's.

## 12. Limitations

| Limitation | Workaround |
|---|---|
| `bloom_ver` on **dumped rows is frozen** at dump time | If frozen at 0, those rows fall back to tantivy. A backfill CLI can be added later. |
| Layer doesn't help **range / `LIKE` / `!=` / regex / OR-with-non-indexed** queries | Skipped by `bloom_predicate::extract`; search path unchanged. |
| **Uniform `B` per chunk** pads small files up to the chunk's max cardinality | Size-sort before chunking keeps padding small; pick a smaller `max_files_per_bf` if size skew is high. |
| **Build memory** ≈ `max_files_per_bf × per-file-SBBF` (writer holds a chunk's SBBFs before serialize) | Bounded by `max_files_per_bf`; lower it under memory pressure. A streaming transpose would remove the bound (future work). |
| No automatic backfill if build fails or settings change after ingest | Rows stay at `bloom_ver = 0`; search falls back to tantivy. Backfill CLI is future work. |

---

## 13. Known weak spots & potential issues

Things that work today but we know aren't ideal. Listed here so we
remember to come back to them — none are blocking.

### 13.1 Operational risks

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

**Impact:** more row reads per query (bounded by
`buffer_unordered(bloom_prefetch_concurrency())`, §9); more storage in
the `bloom/` subtree. Sub-grouping (§5.1) adds to this — a hour is
`rounds × ceil(new_files / max_files_per_bf)` `.bf`s.

**Fix later:** a periodic **compact-bloom** pass that, for stable
hours (settled long enough that no `bloom_ver = 0` will appear
again), reads every `.bf` in the bucket, merges them by OR-ing
each (file, field) bitset, writes one combined `.bf`, and atomically
re-points file_list rows. This is safe for live data but breaks the
"never re-stamp" invariant for dumped rows — would need to either
skip hours that have been partially dumped, or run before dump.

### 13.2 Performance gaps

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

**Impact:** users can't tune FPR without recompiling. The 16 KB probe
must cover the footer (~`M × 12` bytes); with `max_files_per_bf` ≤ ~1300
it always does, and the default 256 leaves a wide margin — so this is no
longer a real failure mode unless `max_files_per_bf` is pushed very high.

**Fix later:** add `ZO_BLOOM_DEFAULT_FPP` (and `ZO_BLOOM_SUFFIX_PROBE_BYTES`
if `max_files_per_bf` ever needs to exceed the 16 KB footer budget). A
two-step footer read (read `footer_len`, then the exact footer) would
remove the probe-size coupling entirely.

### 13.3 Semantic / coverage gaps

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

### 13.4 Observability gaps

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

### 13.5 Test gaps

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

## 14. Future work

Capabilities we **don't have yet** but might want, separate from the
§12 known weak spots which are about improving things we already do.

- **Hour-level summary bloom** (hierarchical) for queries that span thousands of buckets, to skip whole hours with one bloom check before fetching per-file blooms. Only worth it if real query traces show the per-file fetch dominates.
- **Per-stream `fpp`** via `StreamSettings` for users who want tighter FPR on hot streams (e.g. 0.001 for a billion-trace-id-per-day stream at the cost of ~1.4× more `.bf` bytes).
- **Bloom on tokenized fields** (Loki BBF 2.0 style) — would handle full-text queries, but requires re-thinking term enumeration since FTS term dicts can be huge. Currently full-text goes through tantivy directly with no bloom prune.
- **`Arc<BloomReader>` cross-query cache** — moved here from §12.2 since it's a *new capability* (the reader is `&self`-ready, but the cache itself is new code).
- **Backfill CLI** for hours where the live build path didn't cover everything — synchronous build failures, or operator-side config changes (`bloom_filter_enabled` flipped on, fields added to `bloom_filter_fields`) after data has been ingested. Required if you need bloom coverage on those rows; without it they stay at `bloom_ver = 0` and search degrades to tantivy for them.

---

## 15. File map

| File | Role |
|---|---|
| `src/infra/src/bloom/mod.rs` | Module root, magic + version constants |
| `src/infra/src/bloom/path.rs` | `bloom_path` / `bloom_dir` helpers |
| `src/infra/src/bloom/sbbf.rs` | Own SBBF impl (Parquet block layout, gxhash64); `Sbbf::{new_with_num_blocks,insert,check,to_bytes}`, `block_index`, `check_block`, `hash_value`, `num_blocks_for`, `BLOCK_BYTES` |
| `src/infra/src/bloom/writer.rs` | `BloomBuilder` (`begin_with_blocks`), `FieldBloom`, `BloomWriter::serialize` (transposes per field), `WriteError` |
| `src/infra/src/bloom/reader.rs` | `BloomReader::parse / parse_suffix / row_range / column_index / check_block_with_hash / inspect`, `FieldInspect`, `ReadError` |
| `src/infra/src/bloom/footer_cache.rs` | `BLOOM_FOOTER_CACHE` (path → suffix bytes) |
| `src/infra/src/bloom/DESIGN.md` | This document |
| `src/infra/src/file_list/mod.rs` | `FileList::update_bloom_ver` trait |
| `src/infra/src/file_list/{sqlite,postgres}.rs` | DB impls + DDL + migrations + `bloom_ver` in all INSERT/SELECT paths |
| `src/service/tantivy/bloom_builder.rs` | `build_blooms_from_index(index, file_id, fields, num_blocks)` (term-dict iteration, uniform B) |
| `src/service/compact/bloom_build.rs` | `build_for_bucket` (sub-grouping into ≤`max_files_per_bf` chunks) |
| `src/cli/basic/bloom.rs` | `openobserve bloom-inspect --file …` (dump footer: fields, B, row_bytes, file_ids) |
| `src/service/compact/merge.rs` | per-prefix bloom_build hook in `merge_by_stream` |
| `src/service/search/bloom_predicate.rs` | predicate extraction |
| `src/service/search/bloom_pruner.rs` | `prune` (fetch + evaluate) |
| `src/service/search/grpc/storage.rs` | search-path hook before `tantivy_search` |
| `src/service/file_list_dump.rs` | dump-parquet schema + tolerant `bloom_ver` reader |
| `src/service/compact/dump.rs` | dump-parquet writer with `bloom_ver` column, plus the `bloom_dumped_files_total` metric |
| `src/proto/proto/cluster/common.proto` | gRPC `FileMeta.bloom_ver` (tag 7) |
| `src/config/src/metrics.rs` | six Prometheus metrics |

---

## 16. Open questions

(none blocking; documented for future readers)

- Should `.bf` GC happen via a smarter scan (e.g., orphan detection) instead of the per-(stream, date) retention sweep? Only worth it if storage of orphans becomes a measurable problem.
- Could the predicate extractor be extended to handle nested `And`? Marginal value; current top-level AND covers the canonical `WHERE trace_id = X AND service = Y` case.
