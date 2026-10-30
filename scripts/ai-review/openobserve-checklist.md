## OpenObserve checklist

Defect classes that keep recurring in this repository, mined from its fix history. For each item whose area the diff touches, run its check; a hit is a finding only after you confirm it in the code.
### A. Multi-tenancy / org scoping
A1. Every meta-table write, delete or lookup by id must also filter by org. Ids, names, fingerprints and pattern ids are not unique across orgs.
  Check: in `src/infra/src/table/*.rs`, look for `delete_many`, `update`, `find` and raw `WHERE id = $1` with no `Column::Org.eq(org_id)` / `org_id = $n`. Follow the fn up through `src/db/*` and `src/super_cluster_queue/*`; org_id must be threaded through every layer.
A2. Lookups that fall back to the shared/default org (e.g. `templates::get_model`) are for reads only. Writes and deletes must use the org-exact lookup.
  Check: an update/delete that reuses a `get`/`get_model` helper. Read that helper for a default-org fallback.
A3. The target org comes from the authenticated route (path `{org_id}`, or the gRPC org header verified by auth). Never take it from the body, a stored object, an MCP tool arg or a confirm token.
  Check: handlers that read `body.org_id`, `req.org_id`, `payload.org` or a stored session's org. Each one must be compared to the path org, with a 403 on mismatch.
A4. In-memory maps, caches, dedup/grouping state and metric keys must include org_id.
  Check: new `DashMap`/`HashMap`/`static` keyed by fingerprint, name, stream or trace_id alone. The same applies to new scheduled jobs that query a stream: is the stream resolved inside the job's own org?
A5. Routes shaped `/v2/{org_id}/{module}` resolve their org only if `module` is listed in `V2_ORG_MODULES` (`src/core/src/auth.rs`, `org_from_path`). Otherwise auth treats "v2" as the org.
  Check: a new v2 scope in `src/api/http/src/handler/http/router/mod.rs` must come with a `V2_ORG_MODULES` entry.

### B. RBAC / authz
B1. In OSS, `core::auth::check_permissions` is a stub that returns false. Callers must be inside `#[cfg(feature = "enterprise")]` and respect `rbac_enabled`, or use a helper with an OSS-allow variant (`check_folder_write_permissions`).
  Check: an ungated `if !check_permissions(..)` turns into a 403 for every OSS user.
B2. Objects that later run queries in the background (alerts, pipelines, reports, SLOs, anomaly configs, eval jobs, dashboard panels/variables) must check that the saver can read the stream at save time.
  Check: a new background object type, or a new query/stream-bearing field, without `background_access::guard_write` plus the matching `*_sources` fn (`src/core/src/background_access/mod.rs`).
B3. Folder-scoped resources: the `?folder=` query is authoritative, not `body.folder_id`. Create, move and clone must authorize the destination folder (`check_folder_write_permissions`, which checks POST on the folder) and also the source object.
  Check: move/clone/import handlers. In the web service file (`web/src/services/<module>.ts`), every per-object call must send `folder`, mirroring `services/alerts.ts`.
B4. Bulk endpoints (bulk delete/move) must authorize and validate every id before mutating any of them.
  Check: a loop that deletes as it goes, or one permission check for the whole list.
B5. A new OpenFGA resource type needs three things: an `OFGA_MODELS` key (o2-enterprise); an ownership back-fill in `src/core/src/ofga/mod.rs` (`pending_migrations` version gate + `all_org_ownership_keys`) with a model-version bump; and an entry in `web/src/components/iam/roles/EditRole.vue`. Without the back-fill, existing orgs never get `_all_<org>` tuples.
  Check: a new `check_permissions(.., "<new_type>", ..)` string with no matching migration arm.
B6. Authz checks must be identical on every query entry point: `_search`, `_search_stream`, multi-stream, search jobs, `_values`/`_values_stream`, PromQL (metric name taken from a `__name__` matcher) and MCP tools.
  Check: a check added in one of `src/api/search/src/search/{mod,search_stream,multi_streams,search_job}.rs` or `promql/mod.rs` must be added in its siblings.

### C. Injection and outbound requests
C1. Values spliced into SQL text must be quoted with `config::utils::sql::{quote_identifier, quote_sql_string, escape_sql_string}`. Stream and field names are identifiers. In web code, use `escapeSingleQuotes` (`web/src/utils/queryUtils.ts`).
  Check: `format!` strings containing SELECT/WHERE/FROM with `{}` interpolation, or TS template literals building SQL or filter strings (alerts, traces, service graph, `_values`, RUM).
C2. String-level SQL rewrites (quick-mode field list, `aggregationPreviewQuery.ts`, match_all, `_timestamp` alias) must skip string literals, comments and subqueries. Generated projections must not repeat a column.
  Check: a regex or `.replace` on SQL text with no literal/comment masking. Field lists merged from several sources need dedup by `field.name()`.
C3. User-configured outbound URLs (destinations, webhooks, workflow HTTP, enrichment URL tables, synthetics targets) must pass `SsrfGuard::validate_url_with_config_async` and use a client from `ssrf_guard::build_safe_client` / `build_safe_destination_client`, which block redirects to private addresses. Validate at save time too, and keep the URL out of error text.
  Check: a bare `reqwest::Client::builder()` or `reqwest::get` on a user-supplied URL.

### D. Meta store, caches and cluster coordination
D1. Watch events are async, so a write followed by a read on the same node is served stale unless the write path refreshes the local cache itself (see `refresh_local_stream_cache` in `src/schema/src/lib.rs` and `cache_user_record` in `src/db/src/user.rs`). Writers should return the stored row.
  Check: `put_into_db_coordinator` / a watch-only cache update, followed by a cache read in the same request or the next one (login after a password change, settings update after settings update).
D2. Watch `Put` handlers fire on update as well as create. The cache must replace by id, and purge the old key when the keying field changes (e.g. a pipeline's source stream), not push a second copy.
  Check: `.push(` into a cached `Vec` inside a watch handler. Stored references to other objects (home dashboard pin, folder ids) must be reconciled on move/delete.
D3. A new cache with a watcher must be spawned in `src/jobs/src/job/mod.rs` for every node role that reads it, routers included.
  Check: the watcher sits inside a role-specific branch while the cache is read in the auth or router path.
D4. Super-cluster replication: handlers in `src/super_cluster_queue/*` and `o2_enterprise::...::super_cluster::queue::*` calls are enterprise-only, so OSS CI does not compile them.
  Check: a changed signature on an `infra::table`/`db` fn means grepping every `#[cfg(feature = "enterprise")]` caller. A new replicated object needs a queue message that carries org_id.
D5. ORM clients: write through `infra::db::get_orm_client_rw()`. On sqlite, `get_orm_client_ro()` is a read-only pool, so any write through it fails. A read that must see a just-committed write also needs rw.
  Check: functions that take `get_orm_client_ro()` and then call insert/update/delete, or pass the client to a helper that writes.
D6. Concurrent get-or-create across requests and nodes must rely on a unique index plus a re-read (pattern: `infra::table::folders::get_or_create`), not check-then-insert. Multi-row UPDATEs must lock rows in a deterministic order (`ORDER BY` + `FOR UPDATE SKIP LOCKED`, or sorted batches).
  Check: `if get(..).is_none() { insert }`, and batch upserts built from unordered maps or queues.
D7. Per-org defaults (folders, ingestion tokens, configs, self-reporting schemas, OFGA tuples) created on org creation must also be back-filled for existing orgs at startup.
  Check: new code in org-create paths (`src/core/src/organization.rs`) with no startup back-fill in `jobs/mod.rs`.

### E. DB migrations (sqlite + postgres; MySQL is gone)
E1. Entity field types must match the migration DDL on Postgres. A `Json` field over a TEXT column fails, and an untyped `0` literal is INT4 when decoded into i64 (use `0::BIGINT`).
  Check: compare the changed `src/infra/src/table/entity/*.rs` field with its migration column def, and look for raw SQL literals decoded into i64.
E2. Migrations must be re-runnable: `.if_not_exists()` on every `create_table`/`create_index`; guarded ALTERs that consult `information_schema` and are scoped to `current_schema()`, not `'public'`; registered in `src/infra/src/table/migration/mod.rs`. Do not create tables only when a runtime env flag is on.
  Check: a new migration file with a bare `create_index`, an unconditional `ALTER COLUMN TYPE`, or a schema name literal.

### F. Ingestion, schema evolution, storage
F1. Streams with a user-defined schema (UDS) keep only `defined_schema_fields`. Any ingest-derived column (`infer_*`, `gen_ai_agent_*`, `o2_ingest_ts`, `_all`, internal columns) must be added in `generate_schema_for_defined_schema_fields` (`src/schema/src/lib.rs`), or it is silently dropped.
  Check: new fields written at ingest time by a processor/registry, and whether the UDS path keeps them.
F2. A nullable column can be missing from a given WAL/parquet file, because all-null columns are pruned, and from older schemas. Merges, bloom/tantivy builds and fixed-column queries must tolerate this.
  Check: hardcoded column lists in merge/compaction/meta queries (`src/compaction/*`, trace time index, profiles meta).
F3. Ingestion paths come in parallel sets: OTLP gRPC, OTLP-HTTP protobuf, OTLP-JSON, and native JSON/Prometheus (`src/core/src/metrics/{prom,otlp,json}.rs`, `src/core/src/logs/*`, traces). A fix in one usually belongs in the others. A failed or partially failed export must not be acked as success; return OTLP partial-success or a 4xx with the reason.
  Check: `Ok(Response::new(Export*ServiceResponse` on an error branch; label-set or realtime-alert logic changed in only one path.
F4. Compactor/WAL: retire or delete only files the merge actually consumed; respect hour vs day partition boundaries; never replay a live writer's WAL.
  Check: file-list deletes driven by the requested set rather than the consumed set; day-granular loops in hour-partitioned code.

### G. Search, query, time units
G1. Timestamps are i64 microseconds. Check every `/ 1_000` vs `/ 1_000_000`, and the units PromQL range windows and histogram intervals expect.
  Check: arithmetic on `start`/`end` near ms/s conversion. Note that `0` can mean "missing" (validate with `> 0`).
G2. Search ranges are half-open `[start, end)`. Consecutive windows start at the previous `end`, not `end + 1`. Don't round the scanned start to a histogram bucket. Retention and delete-by-range loops must not cover an extra day or hour.
  Check: `+ 1` / `- 1` on period boundaries in `src/core/src/alerts/scheduler/handlers.rs`, `src/compaction/*`, and PromQL range code.
G3. Never default stream_type to logs. Joins, dual-query SLIs, function tests and RUM fallbacks must resolve each table's own stream type.
  Check: `StreamType::Logs` or `"logs"` literals in a multi-source path; a stream type taken from the first query and applied to all.
G4. trace_id is not unique per query. Query manager entries, cancel, WAL file locks and admission slots are keyed per query and released through Drop guards, so a cancelled future can't leak them.
  Check: new state keyed by `trace_id`; release calls placed after an `.await` instead of in a guard.
G5. Background searches (search jobs, alerts, anomaly training) must use `RoleGroup::Background`. New HTTP endpoints that search must be added to `QUERIER_ROUTES` (`src/config/src/router.rs`), or the router sends them to ingesters.
  Check: new search-calling routes, and `RoleGroup::Interactive` in non-user-facing code.
G6. Behavioural parity between `_search`, `_search_stream`, multi-stream, `_values`/`_values_stream` and `_around`: size vs explicit LIMIT, histogram interval, filters.
  Check: a semantic fix in one of these paths; the siblings should share a helper.

### H. Alerts, pipelines, scheduler, functions
H1. Notification outcomes must be truthful. If `NotificationOutcome.failed` is non-empty or a webhook returned non-2xx, the result is `RunOutcome::NotifyFailed` (partial counts as failed). This applies to every trigger kind in `scheduler/handlers.rs`: realtime, scheduled, composite, multi/grouped, incident, anomaly.
  Check: a new or changed send path that only checks `Err` from send.
H2. Triggers whose module `completes_by_claim()` must complete through `infra::scheduler::complete_claim` (fenced), not `db::scheduler::update_trigger`. Long passes must renew their claim and write only while holding it.
  Check: `update_trigger` calls added in the claim-based paths.
H3. Realtime evaluation is per record and per label set. Don't memoize the per-stream match after the first record, and keep every label set in notifications.
  Check: `stream_trigger_map`-style caches populated without a match.
H4. JS/VRL functions run on shared worker runtimes. Bound execution time, never reuse a JS context with queued jobs, and report VRL results that can't be converted instead of calling `unwrap`.
  Check: changes in `src/core/src/pipeline/*` / function runtime code that block or await without a timeout.

### I. Enterprise vs OSS gating
I1. Code under `#[cfg(feature = "enterprise")]` and the o2-enterprise crate are not compiled by OSS CI. Test helpers must use the same gate as their callers (`#[cfg(all(feature = "enterprise", feature = "test-utils"))]`).
  Check: a signature change means grepping enterprise-gated call sites and `o2_enterprise::` calls.
I2. Enterprise/cloud-only UI needs gating in four places: routes (`web/src/composables/shared/router.ts`, `useManagementRoutes`), menu/settings entries, keyboard shortcuts, and the API calls themselves. The gate is `config.isEnterprise == "true" || config.isCloud == "true"`, plus the runtime flag in `store.state.zoConfig` (`rbac_enabled`, `ai_enabled`, `oncall_enabled`, ...).
  Check: a new enterprise-only page or call that only checks one of these.

### J. Frontend state and API contracts
J1. Results from a superseded run (stream/HTTP/WS) must be dropped in every handler (data, progress, complete, error) once its `AbortController` is aborted, while the traceId is still released.
  Check: `fetchQueryDataWithHttpStream` / streaming callbacks with no `signal.aborted` guard.
J2. Switching org must reset page state (live mode, field caches, results). Drilldowns and navigation must carry `org_identifier`.
  Check: new page-level refs/stores with no watcher on `store.state.selectedOrganization`.
J3. Every search transport (`services/search.ts`, `useStreamingSearch`, `useWebSocket`) must parse via `patchLargeNumbersInJson` (`web/src/utils/nsFieldsPatch.ts`), and booleans may arrive as strings.
  Check: a new `JSON.parse` of search data, or a fix applied to only one transport.
J4. HTML built for ECharts tooltip/legend formatters or `v-html` must escape interpolated data with `escapeHtml` (`web/src/utils/html.ts`) or DOMPurify.
  Check: template strings returned from `formatter:` that interpolate series names or values.
J5. Under `ZO_BASE_URI`, URL handling must not split paths by segment index or hardcode `http://localhost:{port}`. Use `getPath()` in web code and `config.common.base_uri` in Rust.
  Check: `url.split("/")` with `slice(n)`; self-calls built from the port alone.

### K. Tests
K1. UI changes to nav, routes, tabs or selectors routinely break Playwright specs in `tests/ui-testing/`, and many follow-up PRs only "heal" specs. Unit specs also assert route counts (`toHaveLength`) that change with gating.
  Check: grep `tests/ui-testing` and `*.spec.ts` for the changed route, `data-test` id or menu.
