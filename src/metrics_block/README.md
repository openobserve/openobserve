# Metrics indexes with series blocks

`metrics_block` stores bounded label metadata, the series-block directory, and independently compressed samples in one immutable `.midx` object. It has no query engine or storage-client dependency. The existing Parquet object remains the source for SQL and PromQL fallback.

## Rollout

1. Upgrade readers and writers to a build that understands this format, initially with `ZO_METRICS_INDEX_BLOCKS_ENABLED=false` (the default).
2. Keep `ZO_METRICS_INDEX_ENABLED=true` for the existing hash-ordered ingester/hour-compaction layout. Keep `ZO_FEATURE_METRICS_STREAMING_AGG_ENABLED=true` for supported streaming PromQL evaluation.
3. Enable `ZO_METRICS_INDEX_BLOCKS_ENABLED=true` on the upgraded deployment. Closed-hour compaction writes the new container for eligible Parquet output; existing objects are not rewritten in place. Unsupported schemas retain metadata-only Arrow indexes.
4. Compare query results against a node with blocks disabled, including time windows spanning older and newly compacted files. Observe `metrics blocks preflight`, `metrics blocks read`, and `metrics blocks fallback before execution` logs. Validate production latency and memory before widening rollout.

`ZO_METRICS_INDEX_BLOCKS_CACHE_MAX_SIZE` bounds the parsed metadata cache in MiB (default 512, zero disables it). Cache entries include the storage account, immutable parent identity, and requested label projection. Samples, memory maps, and query results are not kept in this cache. The existing metrics-index selection cache is unchanged and defaults to disabled.

## Read compatibility and fallback

| Source | Blocks enabled | Blocks disabled |
| --- | --- | --- |
| Existing metadata-only Arrow `.midx` | Label pruning plus Parquet | Label pruning plus Parquet |
| New container `.midx` | Exact label pruning, then supported streaming selectors use independent blocks at every selection density | Parquet, with original matchers |
| Mixed old and new indexes | Each index can prune labels; the streaming scan conservatively uses Parquet for the whole selector when any selected source lacks blocks | Parquet; old indexes can still prune labels |
| Missing, invalid, or unsupported index | Retain source files and filters for correct fallback | Retain source files and filters for correct fallback |

Mixed-file fallback includes all selected files, including fragments of the same series from old and new sources. Preflight runs before any block output. Unsupported row selections, schemas, timestamp ties/overlap, sparse or overflowing time windows, and incompatible source layouts retain the existing Parquet merge semantics. A payload integrity failure after block execution starts is an error, never a silently empty result or a partially restarted scan.

Non-streaming PromQL, WAL, open-hour files, unsupported schemas/layouts, and SQL continue through their established readers. This feature does not promise complete PromQL or WAL coverage. Label-only pruning reads the footer and bounded metadata ranges without fetching or mapping samples. The legacy loader checks the Arrow header before reading a metadata-only object. In block mode, the query inspects Parquet cache membership without downloading or queuing Parquet bodies before pruning; a legacy/mixed/unsupported fallback reads Parquet on demand. SQL and block-disabled prefetch behavior remain unchanged.

To roll back the feature on this new binary, set `ZO_METRICS_INDEX_BLOCKS_ENABLED=false` and restart/reload using the deployment's normal configuration procedure. Existing new containers remain alongside valid Parquet objects. This is different from rolling back to an older binary: an old reader cannot decode the new container. Older builds with the existing index-error-to-Parquet fallback are expected to scan Parquet, but backward binary rollback was not established by these new-reader tests. Test the exact older build before a binary rollback; upgrade all readers before enabling new-format writing.

## Container version 1

The existing metrics index key is reused:

`files/{org}/metrics/{stream}/{yyyy}/{mm}/{dd}/{hh}/indexed-v1-{id}.parquet`

maps to:

`files/{org}/midx/{stream}/{yyyy}/{mm}/{dd}/{hh}/indexed-v1-{id}.midx`

The object contains contiguous compressed sample payloads, compact column metadata, and a fixed 64-byte footer. There is no second production sample object and no conversion command or experimental-format compatibility layer. Legacy Arrow IPC `.midx` is recognized separately by the metrics-index reader.

| Footer bytes | Encoding |
| --- | --- |
| 0–7 | ASCII `O2MIDX01` |
| 8–11 | Version `1`, little-endian u32 |
| 12–15 | Flags `0`, little-endian u32 |
| 16–23 | Metadata start / payload end, little-endian u64 |
| 24–31 | Metadata length, little-endian u64 |
| 32–63 | SHA-256 of the complete metadata section |

Metadata starts with `O2META01`, a little-endian u32 JSON-header length, the JSON header, and one Zstd frame per column. The header carries the source schema, block count, and each column's raw/compressed byte lengths. Schema properties bind the parent object key, record count, compressed Parquet size, source schema, identity-label set, format version, and verified Parquet row-group size.

The first nine columns describe each block: series hash, parent row start, row count, minimum/maximum timestamp, payload offset/length, strict timestamp ordering, and SHA-256 of the compressed payload. Remaining columns are identity labels. Label columns encode a UTF-8 dictionary and u32 indices; `u32::MAX` marks null, and an empty string has its own dictionary entry. Missing labels are projected as null while the pruner conservatively retains uncovered matchers.

Each sample payload is a Zstd frame containing an initial little-endian i64 timestamp followed by modular i64 differences, then eight transposed byte planes of original f64 bits. Wrapping timestamp arithmetic preserves all i64 values; there is no floating-point transformation. Duplicates, signed zero, infinities, and NaN payload bits survive encoding. The streaming reader falls back for timestamp ties to preserve existing merge semantics.

## Bounds and lifetime

- At most 8,192 samples per block, 1,000,000 blocks, and 128 identity-label columns.
- Encoded metadata and declared decompressed metadata are capped at 128 MiB; the JSON header is capped at 1 MiB. Projected label expansion has a separate 128 MiB cap.
- Writer directory/label admission is capped at a conservative 256 MiB estimate. Parent bytes, encoded output, and bounded codec scratch are separate allocations.
- Sample readers bound each compressed block by Zstd's compression bound for `rows * 16`, verify checksums, and reuse bounded decoder scratch. Metadata and sample Zstd windows are capped.
- Remote reads coalesce ordered selected payload ranges within explicit byte/span limits. Query cancellation drops owned preparation/read tasks and query-owned buffers.
- On 64-bit Unix, only the positive native-local storage capability can provide a mapped file. Size and footer bind cached metadata to the opened inode. Local storage publishes new staging inodes atomically and retires objects by unlinking; external in-place modification or truncation of published objects violates the storage contract. Memory-map admission failure uses the range reader.
- Compaction uploads Parquet and its complete index before publishing the replacement file-list entries. The same existing `.midx` retention/deletion path removes either generation. No live object is migrated in place.

## Verification

Regression tests live in `metrics_block`, `metrics_index`, `promql::series_stream`, `promql-service::search::grpc::storage`, and the native storage/range-reader modules. They cover real Parquet roundtrip, exact sample bits, malformed/truncated/oversized metadata, old/new label pruning, mixed same-series fragments, flag-off fallback, all selection densities, cancellation, native mapping, and all currently fusable range functions.

This change also retains the measured pipeline's histogram buffer reuse, exact-text sample serialization, and guarded local-loopback gRPC response optimization. These preserve numerical/wire semantics and keep remote gRPC compression unchanged; no isolated speedup for an individual optimization is asserted.
