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
//! Database Monitoring read API — HTTP handlers (design: `db-monitoring/dbm-design-doc.md`
//! §6 routes + §5.4/D4 hybrid live tail).
//!
//! GET handlers structurally modeled on the service-graph read API
//! (`src/core/src/traces/service_graph/api.rs`): fixed SQL over the `_o2_db_stats` summary
//! stream via `crate::search::search`, read as `StreamType::Logs`.
//!
//! Most of them carry no `#[cfg]` and serve both builds. Three do not:
//! `get_dbm_deadlocks`, `get_dbm_blocking` and `get_dbm_table_health` are
//! dual-implemented — the real handler behind `#[cfg(feature = "enterprise")]`
//! and, on OSS, a stub returning 403 (`unauthorized_response`) before any auth
//! or search work. Their bodies and the server-vantage canonicalizers they read
//! live in `o2_enterprise`.
//!
//! The three rollup-backed endpoints (databases / queries / query history)
//! serve a **hybrid**: rolled-up records for the requested window PLUS a live
//! DataFusion pass over the un-rolled-up span tail, merged server-side. All D4
//! guard rails apply:
//!
//! - tail spans `[max(offset, now − 1 rollup interval), now]` — never `now − offset` raw; a stalled
//!   job surfaces as staleness (`data_through`), never as an unbounded raw scan;
//! - the tail runs the SAME bounded two-stage SQL as the rollup ([`rollup::build_rank_sql`] and
//!   [`rollup::build_totals_sql`]), never the raw unbounded aggregate; a tail query answering
//!   exactly the request cap sets `tail_truncated=true` in the response;
//! - the tail is computed **unfiltered** and cached per `(org, stream, offset)` for `min(30 s,
//!   interval/10)` — the stored rollup offset IS the window-bucket: when the rollup advances, the
//!   key changes and a stale tail can never double-count against the new rollup rows. Scope filters
//!   are applied at merge time from the cached aggregate;
//! - merge math: counts/totals add exactly; `traces` adds as an UPPER BOUND (§5.1 merge rule);
//!   merged percentiles are request(calls)-weighted (the `aggregate_baselines` precedent) and
//!   labeled `percentiles_estimated`;
//! - the live tail is always on: DBM's only switch is `ZO_DB_MONITORING_ENABLED`, and a stalled
//!   rollup job still surfaces through `data_through`.
//!
//! Each handler is a config guard plus a delegation into [`super::service`]; the
//! query structs it extracts into live in [`super::models`]. That is the whole
//! layer — no SQL, no merge math and no authorization decision is taken here.

use axum::{
    extract::{Path, Query},
    response::Response as HttpResponse,
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::get_config;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

use super::{models::*, service::*};

/// GET /{org_id}/db_monitoring/databases — FR-1 overview.
///
/// `db_totals` rows grouped per (system, instance, namespace) — exact window
/// totals with true percentiles, never fingerprint-fused — plus the distinct
/// calling services from `query_stats` rows. Rollup + live tail (D4). With a
/// `service` filter the totals grain does not exist, so rows aggregate from
/// service-filtered `query_stats` instead and `top_n_subset` is set.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/databases",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringDatabases",
    summary = "Database Monitoring: databases overview",
    description = "Per-(system, instance, namespace) rollup totals with calling services, merged with a bounded live tail over the un-rolled-up spans.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Trace stream filter"),
        ("system" = Option<String>, Query, description = "Database system filter"),
        ("service" = Option<String>, Query, description = "Calling service filter"),
        ("baseline_start_time" = Option<i64>, Query, description = "Δ baseline window start (microseconds); returns baseline_hits in the same response"),
        ("baseline_end_time" = Option<i64>, Query, description = "Δ baseline window end (microseconds)"),
        ("include_breakdown" = Option<bool>, Query, description = "Also return the per-instance schema→service split as `breakdown` (one entry per instance), folded from the query_stats rows this window already read"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_databases(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<DatabasesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_databases_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// GET /{org_id}/db_monitoring/queries — FR-2 top queries.
///
/// `query_stats` rows merged per (fingerprint, system, instance) across
/// windows and constituent rows, `_other` remainders passed through at their
/// own grains, rollup + live tail (D4).
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/queries",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueries",
    summary = "Database Monitoring: top queries",
    description = "Top query fingerprints with merged stats and _other remainder, merged with a bounded live tail over the un-rolled-up spans.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Trace stream filter"),
        ("system" = Option<String>, Query, description = "Database system filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("namespace" = Option<String>, Query, description = "Database namespace filter"),
        ("env" = Option<String>, Query, description = "Environment filter"),
        ("service" = Option<String>, Query, description = "Calling service filter"),
        ("stmt_class" = Option<String>, Query, description = "Statement class filter (default 'query'; 'all' disables)"),
        ("sort" = Option<String>, Query, description = "Sort key (whitelist; default total_time_ns)"),
        ("limit" = Option<usize>, Query, description = "Max rows (default 100)"),
        ("search" = Option<String>, Query, description = "Free-text search over normalized query text"),
        ("include_server_fallback" = Option<bool>, Query, description = "When the client-vantage answer is an exact zero, also run the database-reported list and return it as `server_fallback` (with per-section forbidden/read-failed flags)"),
        ("fingerprint" = Option<String>, Query, description = "Narrows the `server_fallback` section to one statement (the query-detail row lookup). Does not filter the client-vantage rows."),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_queries(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<QueriesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    read_queries_response(&org_id, &user_email.user_id, &q).await
}

/// GET /{org_id}/db_monitoring/query/history — FR-5 per-fingerprint
/// series.
///
/// Distinguishes "below top-N" from zero: a window whose `db_totals` rows
/// exist but whose fingerprint row is absent means "ranked below top-N", never
/// "0 calls". Up to [`HISTORY_BACKFILL_MAX_WINDOWS`] such windows are
/// backfilled from raw spans (fingerprint + time bounded); the rest carry
/// `below_top_n: true` without metrics. The live tail renders as the `live`
/// point (D4).
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/query/history",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryHistory",
    summary = "Database Monitoring: per-query time series",
    description = "Per-window series for one query fingerprint, distinguishing below-top-N windows from zero, with bounded raw-span backfill and a live-tail point.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fingerprint" = String, Query, description = "Query fingerprint (required)"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Trace stream filter"),
        ("include_endpoints" = Option<bool>, Query, description = "Also return the FR-5 calling-endpoints aggregation as `endpoints`, run against the trace stream this handler already resolves"),
        ("endpoints_limit" = Option<usize>, Query, description = "Max endpoint rows when include_endpoints is set (default 50, max 500)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Missing fingerprint", content_type = "application/json", body = ()),
    )
)]
pub async fn get_dbm_query_history(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<HistoryQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    read_query_history_response(&org_id, &user_email.user_id, &q).await
}

/// GET /{org_id}/db_monitoring/query/endpoints — FR-5 calling
/// endpoints: on-demand raw-trace aggregation for ONE fingerprint joining DB
/// spans to their trace roots. Bounded by the fingerprint predicate and the
/// request payload's window — no rollup, no tail.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/query/endpoints",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryEndpoints",
    summary = "Database Monitoring: calling endpoints for a query",
    description = "Aggregates raw DB spans for one fingerprint joined to their trace root spans, grouped per calling service + endpoint.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fingerprint" = String, Query, description = "Query fingerprint (required)"),
        ("stream" = String, Query, description = "Trace stream name (required)"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("system" = Option<String>, Query, description = "Database system — the rest of the join key; without it a fingerprint shared by two engines returns their callers fused into one row"),
        ("namespace" = Option<String>, Query, description = "Database/schema — the rest of the join key (see `system`)"),
        ("limit" = Option<usize>, Query, description = "Max rows (default 50)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Missing fingerprint/stream", content_type = "application/json", body = ()),
    )
)]
pub async fn get_dbm_query_endpoints(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<EndpointsQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    read_query_endpoints_response(&org_id, &user_email.user_id, &q).await
}

/// GET /{org_id}/db_monitoring/samples — FR-6 global slow samples: the
/// slowest DB spans in the window ACROSS every system, instance and query.
///
/// The per-query samples on the detail page answer "show me one bad execution
/// of THIS query"; this endpoint answers the shape of question that starts an
/// incident — "what were the worst database calls anywhere, just now?" — before
/// the reader knows which query to blame.
///
/// Reads RAW trace spans (the client vantage), no rollup and no tail: every
/// row is one real completed execution with its trace attached. Stream
/// resolution and RBAC follow the rollup-backed endpoints exactly — explicit
/// `stream` param 403s loudly when unreadable; otherwise the involved streams
/// are discovered from the window's rollup rows (falling back to the org's
/// trace streams) and FILTERED to what the caller may read, then schema-gated
/// on `o2_db_fingerprint` so a stream that never carried a DB span is skipped
/// rather than queried.
///
/// Bounded: one fixed-shape SQL per involved stream, each `LIMIT limit`
/// (default 100, max 500 — far under the search cap), merged in Rust
/// ([`fold_sample_rows`]). `truncated` in the response says when more
/// qualifying spans existed than were returned.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/samples",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringSamples",
    summary = "Database Monitoring: slowest database calls in the window",
    description = "The slowest raw DB spans across all systems, instances and queries in the window, with trace ids for pivoting. Client-observed, completed calls only.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Trace stream filter"),
        ("system" = Option<String>, Query, description = "Database system filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("namespace" = Option<String>, Query, description = "Database/schema filter"),
        ("env" = Option<String>, Query, description = "Deployment environment filter"),
        ("service" = Option<String>, Query, description = "Calling service filter"),
        ("limit" = Option<usize>, Query, description = "Max spans (default 100, max 500)"),
        ("fingerprint" = Option<String>, Query, description = "Scope the ranking to one query fingerprint — the slowest executions of THAT statement"),
        ("include_server_fallback" = Option<bool>, Query, description = "When the client-vantage answer is an exact zero, also run the database-reported list and return it as `server_fallback`"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_samples(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<SamplesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_samples_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// GET /{org_id}/db_monitoring/deadlocks — FR-16 deadlock events.
///
/// Returns assembled deadlock EVENTS in the UI-facing DTO shape — never the raw
/// stored rows. Newest first, each with a real `participants[]` array whose
/// members carry the same `fingerprint` the span enrichment computes, so a
/// deadlock JOINs straight to the query rows the UI already shows (proof §2.6).
/// Also returns per-query-shape counts so the UI can rank "which query shape
/// deadlocks most".
///
/// MySQL entries — one per transaction side — are stitched into whole deadlocks
/// here (see [`stitch_mysql_deadlocks`]); Postgres records already carry the
/// whole cycle and pass through untouched.
#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/deadlocks",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringDeadlocks",
    summary = "Database Monitoring: deadlock events",
    description = "Canonical deadlock events with assembled participants and per-query-shape ranking.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default '_o2_dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("search" = Option<String>, Query, description = "Free text over participant statements, applications and objects"),
        ("limit" = Option<usize>, Query, description = "Max raw records scanned (default 100)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
#[cfg(feature = "enterprise")]
pub async fn get_dbm_deadlocks(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<DeadlocksQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_deadlocks_body(&org_id, &user_email.user_id, &q, false, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// OSS stub — deadlocks are an Enterprise capability.
///
/// The ROUTE stays registered (see `router/mod.rs`); only the body is gated.
/// Gating the route would answer 404, which reads as "this build is broken" or
/// "you have the wrong URL"; 403 is what tells the UI to render an upgrade
/// prompt. Deliberately NOT `disabled_response()`, which means
/// `ZO_DB_MONITORING_ENABLED=false` and would send the operator to a collector
/// checklist for a feature no amount of configuration will enable here.
///
/// The `Query<DeadlocksQuery>` extractor is dropped because that type is gated.
#[cfg(not(feature = "enterprise"))]
pub async fn get_dbm_deadlocks(
    Path(_org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
) -> HttpResponse {
    unauthorized_response()
}

/// GET /{org_id}/db_monitoring/blocking — FR-16 blocking chains.
///
/// Returns the flat canonical samples AND server-assembled root-blocker
/// `chains[]`. `pg_blocking_pids()` yields only DIRECT blocker edges (proof
/// §2.2/§4) — the transitive closure that identifies the one session worth
/// killing is ours to build, and is [`chains::assemble_chains`].
#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/blocking",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringBlocking",
    summary = "Database Monitoring: blocking samples and root-blocker chains",
    description = "Canonical blocking samples plus server-assembled transitive blocking chains with the root blocker identified.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default '_o2_dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("search" = Option<String>, Query, description = "Free text over statements and applications"),
        ("min_wait_seconds" = Option<f64>, Query, description = "Minimum blocked wait to include"),
        ("limit" = Option<usize>, Query, description = "Max samples (default 100)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
#[cfg(feature = "enterprise")]
pub async fn get_dbm_blocking(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<BlockingQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_blocking_body(&org_id, &user_email.user_id, &q, false, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// OSS stub — blocked queries are an Enterprise capability.
/// See [`get_dbm_deadlocks`]'s OSS stub for why this is 403 and not 404 or
/// `disabled_response()`, and why the route stays registered.
#[cfg(not(feature = "enterprise"))]
pub async fn get_dbm_blocking(
    Path(_org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
) -> HttpResponse {
    unauthorized_response()
}

/// GET /{org_id}/db_monitoring/activity — sampled active sessions.
///
/// `hits` is a row-limited SAMPLE OF SESSIONS, not the population;
/// `by_wait_event` and `by_state` are SQL aggregates over the whole window, so
/// the breakdown stays representative however many rows the table shows.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/activity",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringActivity",
    summary = "Database Monitoring: sampled active sessions and wait-event breakdown",
    description = "Sampled sessions from the server-vantage query_sample feed, with SQL-computed wait-event and state breakdowns over the full window.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default '_o2_dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("limit" = Option<usize>, Query, description = "Max sampled sessions returned (default 100)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_activity(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<ActivityQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_activity_body(&org_id, &user_email.user_id, &q, false, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// GET /{org_id}/db_monitoring/query/server_metrics — W6.
///
/// The database's own counters for one fingerprint, to sit BESIDE (never
/// merged into) the client-observed latency on the query detail page.
///
/// A sibling of `/query/plans` rather than a field on `/queries`: `/queries`
/// reads the `_o2_db_stats` rollup AND live trace tails under
/// `StreamType::Traces` auth, and folding a Logs-auth server source into it
/// would put three provenances under two auth models in one response.
///
/// SUPERSEDED by [`get_dbm_query_insights`], which returns this exact envelope
/// as its `server_metrics` section. That merge is the one this endpoint's own
/// doc comment argued FOR: `/query/plans` shares this handler's stream, auth
/// model and schema read, so the pair costs nothing to fold — unlike
/// `/queries`, which does not. Kept registered and unchanged for compatibility.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/query/server_metrics",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryServerMetrics",
    summary = "Database Monitoring: server-side counters for a query",
    description = "The database's OWN counters (pg_stat_statements / events_statements_summary_by_digest) for one query fingerprint, joined on (engine, database, fingerprint). Reports a MEAN and never a percentile, and withholds numbers when more than one instance is a candidate.",
    security(("Authorization" = [])),
)]
pub async fn get_dbm_query_server_metrics(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<ServerMetricsQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_server_metrics_body(&org_id, &user_email.user_id, &q, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// GET /{org_id}/db_monitoring/server_queries — the statement list as
/// the DATABASES report it, for deployments with no traced application
/// traffic.
///
/// Ranked by call count because the underlying feed is a most-frequent top-N
/// and can support no other ranking honestly — see the module note above.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/server_queries",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringServerQueries",
    summary = "Database Monitoring: statements as reported by the databases themselves",
    description = "Per-statement counters (pg_stat_statements / events_statements_summary_by_digest) aggregated over the window, ranked by call count. Server-vantage: measured inside the database across every client, disjoint from the trace-derived /queries list. Reports a MEAN and never a percentile.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default '_o2_dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("fingerprint" = Option<String>, Query, description = "Narrow to one statement — the query-detail row lookup on a deployment with no traced traffic. Omit for the ranked browse list."),
        ("limit" = Option<usize>, Query, description = "Max statements returned (default 50, cap 200)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_server_queries(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<ServerQueriesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_server_queries_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// GET /{org_id}/db_monitoring/server_samples — the slowest executions
/// the DATABASE ITSELF captured, for deployments with no traced traffic.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/server_samples",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringServerSamples",
    summary = "Database Monitoring: slowest executions captured by the database's own logging",
    description = "Single executions with their measured in-engine durations — from log_min_duration_statement completed-statement lines and Postgres auto_explain records — ranked slowest first. A threshold-filtered capture: rows describe only the executions the database chose to log.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream; when absent BOTH defaults ('_o2_dbm_server' and 'dbm_server_logs') are read and merged"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("limit" = Option<usize>, Query, description = "Max executions returned (default 100, cap 500)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_server_samples(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<ServerSamplesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_server_samples_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// GET /{org_id}/db_monitoring/query/plans — W3.4.
///
/// Distinct generic plans captured for one fingerprint over the window. See the
/// module comment above for what this data is and is not.
///
/// SUPERSEDED by [`get_dbm_query_insights`], which returns this exact envelope
/// as its `plans` section alongside the server counters the detail page always
/// requested in the same breath. Kept registered and unchanged for
/// compatibility; new callers should use `/query/insights`.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/query/plans",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryPlans",
    summary = "Database Monitoring: captured query plans for a query",
    description = "Distinct GENERIC, NULL-BOUND EXPLAIN plans captured for one query fingerprint, with first and last seen. Not the plan Postgres executed, and carries no per-plan latency.",
    security(("Authorization" = [])),
)]
pub async fn get_dbm_query_plans(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<PlansQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_plans_body(&org_id, &user_email.user_id, &q, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// GET /{org_id}/db_monitoring/query/insights — the query-detail page's
/// Logs-side pair in one round trip.
///
/// `/query/plans` and `/query/server_metrics` were ALWAYS co-fired from the
/// detail page: both default to `_o2_dbm_server`, both run the same
/// `present_dbm_columns` schema read, both query `KIND_TOP_QUERY` records for
/// the same fingerprint and window. That is two OFGA round trips, two schema
/// reads and two HTTP round trips to answer one question about one statement.
///
/// The two sections are the SAME envelopes the standalone endpoints return —
/// produced by the same `read_*_body` callables, so a section here and the
/// endpoint it came from cannot drift. Both standalone routes keep working
/// (they are marked superseded, not removed).
///
/// Per-section failure, never a whole-request failure: this page is about the
/// query, and a server-counters read that failed must not take the plans list
/// down with it. Each section carries its own `*_read_failed` flag rather than
/// letting an empty section imply "nothing captured".
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/query/insights",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryInsights",
    summary = "Database Monitoring: plans + server counters for a query",
    description = "The query-detail page's server-vantage pair in one response: `plans` (the /query/plans envelope) and `server_metrics` (the /query/server_metrics envelope), each nullable with its own read-failed flag.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fingerprint" = String, Query, description = "Query fingerprint (required)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (defaults to _o2_dbm_server)"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("engine" = Option<String>, Query, description = "Server-metrics join key: database engine. Omit and `server_metrics` is null."),
        ("database" = Option<String>, Query, description = "Server-metrics join key: database name. Required for engines whose records carry one."),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Missing fingerprint", content_type = "application/json", body = ()),
    )
)]
pub async fn get_dbm_query_insights(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<QueryInsightsQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    read_query_insights_response(&org_id, &user_email.user_id, &q).await
}

/// GET /{org_id}/db_monitoring/instances — every (engine, instance).
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/instances",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringInstances",
    summary = "Database Monitoring: every database instance the org knows",
    description = "The distinct (engine, instance) identities the server-vantage stream carries in the window, across EVERY feed — sessions, blocking, deadlocks, table stats and statement lists. Feeds the scope filter's instance picker, which must offer instances that have no rows on the current tab.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default '_o2_dbm_server')"),
        ("system" = Option<String>, Query, description = "Restrict to one engine"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
// NOT enterprise-gated, deliberately. This is the scope filter's instance
// picker, and the filter rides on tabs OSS can see (Activity, Top queries) —
// gating it would leave those tabs with an empty picker on an OSS build. It
// also reads nothing enterprise: a `SELECT DISTINCT` over the `o2_dbm_engine` /
// `o2_dbm_instance` columns, whose vocabulary lives in `config`. It carried a
// `#[cfg(feature = "enterprise")]` from the commit that introduced it, while
// the router registered it unconditionally — so an OSS build failed to compile
// `openobserve-api-search` with E0432. The bug survived because the OSS build
// was only ever checked against `openobserve-core`, which did not name the
// handler and so compiled clean.
pub async fn get_dbm_instances(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<DbmInstancesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_dbm_instances_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// GET /{org_id}/db_monitoring/table_health — W10.
///
/// The newest snapshot of every relation in the window, largest first.
///
/// Two disclosures ride on the envelope because the UI cannot phrase them
/// correctly otherwise: the scan and vacuum counters are LIFETIME totals since
/// the last `pg_stat_reset()` (not per-window counts), and the tuple figures are
/// PLANNER ESTIMATES (not exact counts).
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/table_health",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringTableHealth",
    summary = "Database Monitoring: table size, bloat and vacuum state",
    description = "Newest snapshot per relation from the table-stats server-vantage feed (pg_table_stats / mysql_table_stats / mariadb_table_stats). Scan and vacuum counters are LIFETIME totals since the last statistics reset; tuple counts and bloat percentage are planner estimates. Postgres, MySQL and MariaDB.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default '_o2_dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("limit" = Option<usize>, Query, description = "Max relations returned (default 100)"),
        ("include_indexes" = Option<bool>, Query, description = "Also return the index-health section (index_hits, disclosures) in the same response"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
#[cfg(feature = "enterprise")]
pub async fn get_dbm_table_health(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<TableHealthQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_table_health_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// OSS stub — Table Health is an Enterprise capability.
///
/// The ROUTE stays registered (see `router/mod.rs`); only the body is gated.
/// Gating the route would answer 404, which reads as "this build is broken" or
/// "you have the wrong URL"; 403 is what tells the UI to render an upgrade
/// prompt. Deliberately NOT `disabled_response()`, which means
/// `ZO_DB_MONITORING_ENABLED=false` and would send the operator to a collector
/// checklist for a feature no amount of configuration will enable here.
///
/// The `Query<TableHealthQuery>` extractor is dropped because that type is
/// gated.
#[cfg(not(feature = "enterprise"))]
pub async fn get_dbm_table_health(
    Path(_org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
) -> HttpResponse {
    unauthorized_response()
}

/// GET /{org_id}/db_monitoring/badges — every tab badge in one read.
///
/// Runs the six sibling endpoints' bodies concurrently and — when the
/// client-vantage answer is exactly zero — the server-vantage fallbacks, so the
/// shell's per-window cost is this call plus the page's own read. Each member is
/// that endpoint's unchanged response body, or `null` when its read failed.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/badges",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringBadges",
    summary = "Database Monitoring: all tab badges in one read",
    description = "One envelope carrying the databases, queries, activity, deadlocks, blocking and table-health response bodies for the window, read concurrently; members are null when their read failed. When the client-vantage answer is exactly zero, the server-vantage fallback members (server_queries, server_samples) are included too.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("system" = Option<String>, Query, description = "Database system filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("namespace" = Option<String>, Query, description = "Database/schema filter"),
        ("env" = Option<String>, Query, description = "Environment filter (trace-vantage slices only)"),
        ("service" = Option<String>, Query, description = "Calling service filter (trace-vantage slices only)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_badges(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<BadgesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    read_badges_response(&org_id, &user_email.user_id, &q).await
}

/// GET /{org_id}/db_monitoring/instance_metrics — the receiver's health view.
#[utoipa::path(
    get,
    path = "/{org_id}/db_monitoring/instance_metrics",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringInstanceMetrics",
    summary = "Database Monitoring: instance health from the collector's metric streams",
    description = "Connection saturation, cache hit ratio, replication lag and deadlock counts for every database instance the org's collector reports on, swept from the metric streams in ONE query. The stream list and the SQL are server-constructed: this endpoint takes no stream or query parameter, so a `db_monitoring` grant buys database health columns and not general metrics access.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_instance_metrics(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(q): Query<InstanceMetricsQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_instance_metrics_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}
