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

//! Database Monitoring read API — request models.
//!
//! The `*Query` structs axum deserializes each `/db_monitoring/*` route's query
//! string into, plus the one accessor macro five of them share. Nothing here
//! reads, computes or renders: [`super::handler`] takes these as extractors and
//! hands them to [`super::service`].

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct DatabasesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub service: Option<String>,
    /// The Δ baseline window, returned as `baseline_hits` in the same
    /// response. The CLIENT computes the bounds — the baseline is a reader
    /// choice (previous window, same hours yesterday) this endpoint must not
    /// guess at. Both or neither; the pair rides one round trip and the two
    /// windows are read concurrently.
    pub baseline_start_time: Option<i64>,
    pub baseline_end_time: Option<i64>,
    /// Fold the per-instance schema → service split into THIS response, keyed
    /// by instance, instead of the page issuing `GET /queries?instance=<row>`
    /// once per expanded row (and re-issuing all of them on every window
    /// change). Opt-in for the same reason `include_indexes` is: the split is
    /// a drill-down nobody has opened yet on first paint.
    ///
    /// It costs no additional search: the fingerprint rows the split needs are
    /// the `query_stats` pool this window already read to compute
    /// `calling_services`. The fold is the same `group_query_rows(.., None,
    /// false)` the queries endpoint runs for `stmt_class=all` under an
    /// instance scope.
    pub include_breakdown: Option<bool>,
}
#[derive(Debug, Deserialize)]
pub struct QueriesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub namespace: Option<String>,
    pub env: Option<String>,
    pub service: Option<String>,
    /// Statement class filter — defaults to `query` (FR-2: COMMIT/SET/ping
    /// noise must not dominate calls-sorted views); `all` disables.
    pub stmt_class: Option<String>,
    pub sort: Option<String>,
    pub limit: Option<usize>,
    /// Free-text search over the normalized query text. Applied at merge time
    /// in Rust — never interpolated into SQL.
    pub search: Option<String>,
    /// The Δ baseline window, returned as `baseline_hits` in the same
    /// response — same contract as the databases endpoint: client-computed
    /// bounds, both or neither, read concurrently with the current window.
    /// The baseline is fetched under the SAME filters and sort so the two
    /// sets are comparable row-for-row.
    pub baseline_start_time: Option<i64>,
    pub baseline_end_time: Option<i64>,
    /// Narrows the SERVER FALLBACK to one statement — it does not filter the
    /// client-vantage rows, which the detail page already selects from the
    /// ranked page it reads.
    ///
    /// The query-detail page looks up ONE fingerprint. Its client read is a
    /// ranked page it filters in the browser, which is fine while traces
    /// exist; with none, the fallback below is the only vantage that can
    /// answer, and it must answer about THIS statement rather than handing
    /// back the org's fifty most-frequent.
    pub fingerprint: Option<String>,
    /// Run the database-reported fallback list in this same request when — and
    /// only when — the client-vantage answer is an EXACT zero, returning it as
    /// `server_fallback`.
    ///
    /// On a deployment with the collector wired but no traced application
    /// traffic, this page's client read is honestly empty while the databases
    /// have been reporting their statement counters all along. The page
    /// handled that by awaiting this response and THEN issuing
    /// `/server_queries` — two sequential round trips on every load, in the
    /// deployment least able to spare them.
    ///
    /// The server already runs exactly this conditional inside `/badges`; this
    /// exposes it to the tab that renders the rows. Armed only by an exact
    /// zero: a failed read is unknown, and unknown is not zero.
    pub include_server_fallback: Option<bool>,
}
#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub fingerprint: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub namespace: Option<String>,
    pub env: Option<String>,
    pub service: Option<String>,
    /// Also return the FR-5 calling-endpoints aggregation as `endpoints`, in
    /// this same response.
    ///
    /// The query-detail page fired `/query/history` and `/query/endpoints`
    /// together on every entry, with the identical fingerprint and window —
    /// and endpoints REQUIRES a `stream` the page had to resolve first, which
    /// is the very stream this handler already resolves for its own backfill
    /// (`trace_stream_name` in the response below). So the second request was
    /// waiting on a fact this one had computed.
    ///
    /// Opt-in, like `include_indexes`: a caller who wants the series alone
    /// should not pay for a raw-span aggregation.
    pub include_endpoints: Option<bool>,
    /// Cap for the `endpoints` section — the standalone endpoint's `limit`,
    /// under the same default and clamp.
    pub endpoints_limit: Option<usize>,
}
#[derive(Debug, Deserialize)]
pub struct EndpointsQuery {
    pub fingerprint: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// The REST of the join key. A fingerprint hashes statement text only, so
    /// on a mixed fleet it names one statement running on several engines and
    /// databases at once; aggregating callers without these fuses them into one
    /// row that describes no engine (see [`build_endpoints_sql`]).
    ///
    /// Optional so the existing contract is unchanged for a caller that has no
    /// engine to give — a fused answer is still what an unscoped question
    /// deserves, and the caller that DOES enrich a server row now sends them.
    pub system: Option<String>,
    pub namespace: Option<String>,
    pub limit: Option<usize>,
}
#[derive(Debug, Deserialize)]
pub struct SamplesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub namespace: Option<String>,
    pub env: Option<String>,
    pub service: Option<String>,
    pub limit: Option<usize>,
    /// Run the database-reported fallback list (`/server_samples`) in this same
    /// request when the client-vantage answer is an EXACT zero, returning it as
    /// `server_fallback`. See [`QueriesQuery::include_server_fallback`] — same
    /// contract, same reason, same per-section permission handling.
    pub include_server_fallback: Option<bool>,
    /// Scope the ranking to ONE statement — "show me the slowest executions of
    /// this query", the question the detail page asks.
    ///
    /// The predicate is built here, through the same escaping every other
    /// predicate in this module uses, and the stream is resolved through
    /// `involved_streams` rather than interpolated from a URL.
    pub fingerprint: Option<String>,
}
#[cfg(feature = "enterprise")]
#[derive(Debug, Deserialize)]
pub struct DeadlocksQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// Server-vantage LOGS stream carrying the canonical events.
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// The database name. Accepted as `namespace` too — that is the name the
    /// rollup endpoints use for the same concept (`db_namespace`), and the UI
    /// sends one vocabulary to every DBM endpoint.
    pub database: Option<String>,
    pub namespace: Option<String>,
    /// Free text matched over participant statements, applications and objects.
    /// Applied in Rust AFTER stitching so a term matching only one MySQL side
    /// still returns the whole deadlock.
    pub search: Option<String>,
    pub limit: Option<usize>,
}

/// The database filter, under either spelling (`database` or the rollup
/// endpoints' `namespace`) — one accessor for the five server-vantage query
/// structs that carry the pair.
macro_rules! impl_database_filter {
    ($($query:ty),+ $(,)?) => {$(
        impl $query {
            pub(crate) fn database(&self) -> Option<&str> {
                self.database
                    .as_deref()
                    .or(self.namespace.as_deref())
                    .filter(|s| !s.is_empty())
            }
        }
    )+};
}

impl_database_filter!(ActivityQuery, ServerQueriesQuery, ServerSamplesQuery,);

// The two enterprise query types use the same accessor, but only exist on an
// enterprise build.
#[cfg(feature = "enterprise")]
impl_database_filter!(DeadlocksQuery, BlockingQuery,);

#[cfg(feature = "enterprise")]
#[derive(Debug, Deserialize)]
pub struct BlockingQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// See [`DeadlocksQuery::database`] — `namespace` is the same concept under
    /// the rollup endpoints' spelling.
    pub database: Option<String>,
    pub namespace: Option<String>,
    /// Free text over the blocked/blocking statements and applications.
    pub search: Option<String>,
    /// Drop samples whose blocked session waited less than this.
    pub min_wait_seconds: Option<f64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// See [`DeadlocksQuery::database`] — `namespace` is the same concept under
    /// the rollup endpoints' spelling.
    pub database: Option<String>,
    pub namespace: Option<String>,
    pub limit: Option<usize>,
}
#[derive(Debug, Deserialize)]
pub struct ServerMetricsQuery {
    pub fingerprint: Option<String>,
    pub engine: Option<String>,
    pub database: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct ServerQueriesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// See [`DeadlocksQuery::database`] — `namespace` is the same concept under
    /// the rollup endpoints' spelling.
    pub database: Option<String>,
    pub namespace: Option<String>,
    /// Narrow the list to ONE statement, for the query-detail page's row
    /// lookup on a deployment with no traced traffic. Without it that page can
    /// only find its row by paging the whole ranked list, and a statement
    /// ranked below the cap is indistinguishable from one that does not exist.
    ///
    /// Additive and optional: absent, this endpoint is byte-identically the
    /// ranked browse list it has always been.
    pub fingerprint: Option<String>,
    pub limit: Option<usize>,
}
#[derive(Debug, Deserialize)]
pub struct ServerSamplesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// See [`DeadlocksQuery::database`].
    pub database: Option<String>,
    pub namespace: Option<String>,
    pub limit: Option<usize>,
}
#[derive(Debug, Deserialize)]
pub struct PlansQuery {
    pub fingerprint: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct QueryInsightsQuery {
    pub fingerprint: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// The server-metrics join key. Absent (or, for a database-carrying engine,
    /// an absent `database`) means there IS no key — the section comes back
    /// `null` and the page renders its "no join key" line, exactly as it did
    /// when it decided not to send the second request at all.
    pub engine: Option<String>,
    pub database: Option<String>,
}
// ─── Instances (`/instances`) — the fleet's identity list ────────────────────
//
// Every DBM tab renders a scope filter whose "database" (instance) picker must
// offer every instance the org HAS — not merely the ones whose rows happen to
// be on screen. Deriving the options from a page's own loaded rows fails three
// ways that all look like "the filter is broken":
//
//   * a feed that names no instance leaves the picker EMPTY (deadlocks return no identity of their
//     own),
//   * a feed no engine populates DROPS that engine (SQL Server has no session sampler, so Activity
//     cannot offer `mssql-prod-1`),
//   * a CAPPED read (activity stops at 100 sampled sessions) makes the list first-page-local rather
//     than window-local.
//
// `/databases` cannot stand in: it is the CLIENT vantage (spans), so on a
// zero-trace org it returns nothing at all while server-vantage data sits one
// tab away. And no per-feed union is complete either — measured on the rig,
// activity named 2 of 4 engines, table_health 2 of 4, deadlocks 0 of 4.
//
// So this is one DISTINCT over the identity columns with NO kind predicate:
// every server-vantage record carries `(engine, instance)` whatever feed wrote
// it, which makes the union complete BY CONSTRUCTION instead of by remembering
// to add each new feed to a client-side merge.
#[derive(Debug, Deserialize)]
pub struct DbmInstancesQuery {
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// Narrow to one engine. The picker uses this when a `system` chip is
    /// already applied, so the instance list agrees with the engine filter
    /// beside it rather than offering instances that chip excludes.
    pub system: Option<String>,
}
#[cfg(feature = "enterprise")]
#[derive(Debug, Deserialize)]
pub struct TableHealthQuery {
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub limit: Option<usize>,
    /// Also return the index-health section (`index_hits` and its
    /// disclosures) in the same response. Off by default: the tab-count badge
    /// hits this endpoint purely to count tables, and making it pay for index
    /// rows it discards would tax six pages to spare one round trip on one.
    pub include_indexes: Option<bool>,
}
#[derive(Debug, Deserialize)]
pub struct BadgesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// The reader's scope, forwarded to exactly the slices whose endpoint
    /// ACCEPTS each dimension — the same matrix the pages apply to their own
    /// reads, because a badge must count what its tab would show.
    ///
    /// Forwarding a narrower scope than a tab applies would make the strip
    /// answer a different question than the tab it labels.
    ///
    /// A dimension a slice does not accept is simply not sent to it. That is
    /// honest rather than lossy: the databases endpoint has no namespace
    /// concept, so neither the Overview badge nor the Overview TAB can narrow
    /// by one.
    pub system: Option<String>,
    pub instance: Option<String>,
    pub namespace: Option<String>,
    /// Trace-vantage only — the queries and samples slices are the only ones
    /// whose feed carries the calling application.
    pub env: Option<String>,
    pub service: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InstanceMetricsQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}
