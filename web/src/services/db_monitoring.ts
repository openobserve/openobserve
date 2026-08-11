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

import http from "./http";
import type { QueryPlansResponse } from "@/utils/dbm/plans";

// ─── Response contract ───────────────────────────────────────────────────────
// Mirrors `src/core/src/traces/db_monitoring/api.rs`. Rows come from
// `SELECT * FROM _o2_db_stats` merged in Rust, so every metric is OPTIONAL:
// `merge_rows` only emits a key when at least one constituent row carried it
// (e.g. `rows_returned` is absent on streams without the column, percentiles
// are absent when no constituent had calls > 0).

/**
 * The honesty payload carried by every rollup-backed response (`Freshness` in
 * api.rs). Times are microseconds.
 */
export interface Freshness {
  /**
   * Minimum rollup offset across the involved streams. `0` = at least one
   * stream has never been rolled up.
   */
  data_through: number;
  /** Whether the live tail is enabled server-side. */
  live_tail: boolean;
  /**
   * Where the live tail begins. LATER than `data_through` means the rollup
   * stalled beyond the one-interval tail cap and the range in between is
   * covered by neither source — the genuine coverage gap.
   */
  tail_covers_from: number | null;
  /** Where the live tail ends. */
  tail_through: number | null;
  /** The live tail hit its row cap, so the tail itself is partial. */
  tail_truncated: boolean;
  /**
   * Percentiles were fused across windows/sources by request weighting, so
   * they are estimates rather than true quantiles.
   */
  percentiles_estimated: boolean;
  /** Always `true` — distinct-trace counts are an upper bound. */
  traces_upper_bound: boolean;
}

/**
 * A `query_stats`-grain row: one fingerprint on one (system, instance).
 * `_other` remainder rows arrive in `QueriesResponse.other`, never in `hits`.
 */
export interface QueryStatsRow {
  /** Fingerprint id, or the literal `_other` on a remainder row. */
  fingerprint: string;
  query_norm?: string;
  db_system: string;
  db_instance: string;
  db_namespace?: string;
  env?: string;
  service_name?: string;
  operation?: string;
  stmt_class?: string;
  /** Distinct dimensions across the merged constituent rows. */
  namespaces?: string[];
  envs?: string[];
  services?: string[];
  statements?: number;
  calls?: number;
  errors?: number;
  total_time_ns?: number;
  p50_ns?: number;
  p95_ns?: number;
  p99_ns?: number;
  max_ns?: number;
  /** Upper bound — see `Freshness.traces_upper_bound`. */
  traces?: number;
  rows_returned?: number;
  rows_emitting_calls?: number;
  trace_stream_name?: string;
  record_type?: string;
  /** Normalization version; a bump resets trend comparability. */
  fp_version?: number;
  /** The normalized text was cut at the 4 KB storage bound. */
  truncated?: boolean;
}

/**
 * A `db_totals`-grain row: exact window totals per (system, instance,
 * namespace), never fused from per-fingerprint approximations.
 */
export interface DbTotalsRow {
  db_system: string;
  db_instance: string;
  db_namespace?: string;
  /** Present only on the class-grain totals rows (namespace is null there). */
  stmt_class?: string | null;
  statements?: number;
  calls?: number;
  errors?: number;
  total_time_ns?: number;
  p50_ns?: number;
  p95_ns?: number;
  p99_ns?: number;
  max_ns?: number;
  traces?: number;
  rows_returned?: number;
  rows_emitting_calls?: number;
  /** Attached by the databases endpoint from the `query_stats` pool. */
  calling_services?: string[];
  trace_stream_name?: string;
  record_type?: string;
  fp_version?: number;
}

/** An `error_class`-grain row: per-status-code error counts. */
export interface ErrorClassRow {
  fingerprint: string;
  db_system: string;
  db_instance: string;
  env?: string;
  /** Driver/engine status code, or the literal `unknown`. */
  status_code: string;
  errors?: number;
}

/**
 * One point of a per-fingerprint series. A point with `below_top_n` and no
 * metrics means "ranked below top-N in this window" — NEVER zero. Rendering it
 * as zero makes an ongoing incident read as recovered.
 */
export interface HistoryPoint {
  /** Window END, microseconds. */
  timestamp: number;
  /** The fingerprint was not in this window's top-N. */
  below_top_n?: boolean;
  /** Metrics were recovered from raw spans rather than the rollup. */
  backfilled?: boolean;
  /** The not-yet-aggregated live-tail point. */
  live?: boolean;
  calls?: number;
  errors?: number;
  statements?: number;
  total_time_ns?: number;
  p50_ns?: number;
  p95_ns?: number;
  p99_ns?: number;
  max_ns?: number;
  traces?: number;
  rows_returned?: number;
  rows_emitting_calls?: number;
}

/** A calling (service, endpoint) pair for one fingerprint, from raw traces. */
export interface EndpointRow {
  service_name: string | null;
  endpoint: string | null;
  calls: number;
  errors: number;
  total_time_ns: number;
  p95_ns: number | null;
  traces: number;
}

export interface DatabasesResponse {
  hits: DbTotalsRow[];
  /**
   * The scope is narrower than the grain totals reconcile at, so shares
   * describe the shown rows only.
   */
  top_n_subset: boolean;
  freshness: Freshness;
}

export interface QueriesResponse {
  hits: QueryStatsRow[];
  /**
   * The reconciling remainder. Empty when `top_n_subset` is true — the totals
   * cannot reconcile at this scope, so no remainder is emitted.
   */
  other: QueryStatsRow[];
  /** Row count BEFORE `limit` truncation. */
  total: number;
  top_n_subset: boolean;
  freshness: Freshness;
}

export interface QueryHistoryResponse {
  fingerprint: string;
  series: HistoryPoint[];
  /**
   * More below-top-N windows existed than the backfill budget, so the older
   * ones carry the flag without metrics.
   */
  backfill_capped: boolean;
  freshness: Freshness;
}

/** Raw-trace aggregation — no rollup, so no freshness block. */
export interface QueryEndpointsResponse {
  hits: EndpointRow[];
}

// ─── Deadlocks & blocking ────────────────────────────────────────────────────
// These two read the DATABASE'S OWN LOG, not application traces, so they share
// none of the rollup vocabulary above: no fingerprint grain, no `_other`
// remainder, no percentile fusion.
//
// The wire rows are a UI-FACING DTO assembled in `api.rs`, not the stored
// records. The storage layer keeps the canonical columns under an `o2_dbm_*`
// prefix and has to encode `participants` as a JSON STRING (the logs schema
// inferrer rejects nested values), but neither detail crosses the wire — the
// server drops the prefix and emits a real array. Two consequences worth
// knowing:
//
//   • MySQL logs one entry per transaction SIDE. The server stitches the sides
//     into whole deadlocks before responding, so `hits[]` is one entry per
//     DEADLOCK on both engines. A side whose partner never arrived comes back
//     with `partial: true` rather than being dropped.
//   • `chains[]` is NESTED (`root.children[]`), not the flat waiter list the
//     table needs — `flattenChains` walks it into rows.

/**
 * One side of a deadlock. Both sides carry the SAME shape — a deadlock is
 * symmetric, and the only asymmetry is `victim`, so nothing else in this type
 * distinguishes the cancelled session from the survivor.
 */
export interface DeadlockParticipant {
  /** Backend pid (Postgres) or thread id (MySQL). */
  pid: number | null;
  /** The database's transaction id, when the log carried one. */
  transaction_id?: string | null;
  /** The statement this session was running when the cycle closed. */
  query?: string | null;
  /** Joins this participant to a Top-queries row. */
  fingerprint?: string | null;
  /** `application_name` (PG) / connection attribute (MySQL). */
  application?: string | null;
  /** Database user. */
  user?: string | null;
  /** Raw lock mode — `ShareLock`, `RECORD LOCK`. Kept for the DBA alongside the
   *  translated sentence the UI builds from `lock_target`. */
  lock_mode?: string | null;
  /** What it was waiting ON — `transaction 1430`, an index name. */
  lock_target?: string | null;
  /** The database cancelled THIS side to break the cycle. */
  victim: boolean;
}

/**
 * One deadlock as the server assembled it — a single event, not a rollup.
 *
 * This is the wire shape verbatim: `api.rs` emits exactly these keys, so no
 * client-side decoding step stands between the response and the UI.
 */
export interface DeadlockEvent {
  /** Event id, stable enough to key a row and to deep-link. */
  id: string;
  /** When the database logged it, microseconds. */
  timestamp: number;
  /** `postgresql` | `mysql`. */
  db_system: string;
  db_instance?: string | null;
  db_namespace?: string | null;
  /** The pid/thread the database cancelled to break the cycle. */
  victim_pid?: number | null;
  /** `participants.length`, sent explicitly so a caller can trust it without
   *  walking the array. */
  participant_count?: number;
  /**
   * Only ONE side is present. On MySQL that means the partner entry never
   * arrived (lost, or cut off by the window); the event is still real, so it is
   * shown and labelled rather than dropped.
   */
  partial?: boolean;
  /** The sorted participant-fingerprint set — the victim-order-independent
   *  grouping key, identical in construction across engines. */
  query_shape?: string | null;
  /** The table(s)/lock targets the sides fought over. */
  objects?: string[];
  /** Two sides in the normal case; typed as a list because a cycle can be
   *  longer and MySQL genuinely reports 3-way pileups. */
  participants: DeadlockParticipant[];
  /** The log text the fields were parsed out of. */
  raw?: string | null;
}

/** The server's grouping of events by the statement shape they share. */
export interface DeadlockQueryShape {
  query_shape: string;
  count: number;
  last_seen: number;
  fingerprints?: string[];
  queries?: string[];
}

export interface DeadlocksResponse {
  /** One entry per DEADLOCK — MySQL sides are already stitched server-side. */
  hits: DeadlockEvent[];
  /** Server-side grouping — the UI still groups locally by query PAIR, which is
   *  a finer grain than the single shared shape this reports. */
  query_shapes?: DeadlockQueryShape[];
  /** EVENT count before any row limit — what the tab badge shows. */
  total: number;
  /** The row list was capped, so `total` exceeds `hits.length`. */
  truncated?: boolean;
  /** Which receiver stream answered. */
  stream?: string;
  /**
   * The database is not sending its log at all, so this tab cannot fill in.
   * Distinct from `hits: []`, which is the HEALTHY case.
   */
  not_collecting?: boolean;
  /** MySQL keeps only the most recent deadlock without this setting on. */
  innodb_print_all_deadlocks?: boolean | null;
  /** Non-deadlock lines from these databases — the proof that the pipeline is
   *  carrying traffic when the list is empty. */
  log_lines_seen?: number | null;
  /** The most recent deadlock outside this window, for the healthy state's
   *  "last time this wasn't empty" offer. */
  last_seen_before?: number | null;
  freshness?: Freshness;
}

/**
 * One session waiting on a lock. This is the wire shape verbatim — `api.rs`
 * emits exactly these keys, in the same `db_system`/`db_instance`/`db_namespace`
 * vocabulary the rollup endpoints use.
 */
export interface BlockingSample {
  /** When the lock table was sampled, microseconds. */
  timestamp?: number;
  /** The waiting session. */
  blocked_pid: number;
  /** Its DIRECT blocker — not necessarily the root of the chain. */
  blocking_pid: number | null;
  blocked_query?: string | null;
  blocking_query?: string | null;
  /** Joins the waiting query to a Top-queries row. */
  blocked_fingerprint?: string | null;
  blocking_fingerprint?: string | null;
  blocked_application?: string | null;
  blocking_application?: string | null;
  /** `Lock` — the class of wait. */
  wait_event_type?: string | null;
  /** `transactionid`, `tuple` — what specifically is being waited on. */
  wait_event?: string | null;
  /** Seconds this session has been waiting. */
  wait_seconds?: number | null;
  db_system: string;
  db_instance?: string | null;
  db_namespace?: string | null;
  // The three below are NOT yet served by the backend — the canonical record
  // has no column for them. They stay optional so the UI renders without them
  // today and lights up when the collector recipes start reporting them.
  /** The object under contention. */
  object?: string | null;
  /** Seconds since the blocker last ran a statement. A blocker idle in an open
   *  transaction is the "application forgot to commit" signature. */
  blocker_idle_seconds?: number | null;
  /** The blocker is not itself waiting — it is the root of its chain. */
  blocker_is_root?: boolean;
}

/** A node of the server's nested chain tree. */
export interface BlockingChainNode {
  pid: number;
  app?: string | null;
  query?: string | null;
  fingerprint?: string | null;
  wait_seconds?: number | null;
  wait_event_type?: string | null;
  wait_event?: string | null;
  /** 0 at the root; one deeper per hop. */
  depth?: number;
  children?: BlockingChainNode[];
}

/**
 * A root blocker with its chain, assembled SERVER-SIDE — the server sees the
 * whole sample set, so it can climb past a blocker that fell outside the row
 * limit. The tree hangs off `root.children`; `flattenChains` walks it into rows.
 */
export interface BlockingChain {
  /** The tree itself. `root.children` are the sessions it directly blocks. */
  root?: BlockingChainNode;
  /** The session at the top — holds a lock and waits for nothing. */
  root_pid: number;
  root_query?: string | null;
  root_app?: string | null;
  root_fingerprint?: string | null;
  /** How many sessions are stuck below this root, at every depth. */
  blocked_count: number;
  /** Longest path from the root to a leaf. */
  depth: number;
  /** The worst wait anywhere in this chain, seconds. */
  max_wait_seconds?: number | null;
  /**
   * The chain closes on itself. The database resolves a true cycle as a
   * deadlock, so this means the sample caught one mid-flight — the walk must
   * not recurse forever on it.
   */
  cyclic?: boolean;
  engine?: string | null;
  database?: string | null;
  instance?: string | null;
}

export interface BlockingResponse {
  /** Every waiting session, flat — the "who's stuck" perspective reads this. */
  hits: BlockingSample[];
  /** Root-blocker assembly — the "who's blocking" perspective reads this. */
  chains?: BlockingChain[];
  /** Waiting-session count before any row limit. */
  total: number;
  /** The row list was capped. */
  truncated?: boolean;
  stream?: string;
  /** No database is reporting lock waits, so this tab cannot fill in. */
  not_collecting?: boolean;
  /** When the server last sampled `pg_locks` / `pg_stat_activity`. */
  sampled_at?: number | null;
  /** How often it samples, seconds — the "checked every 10 seconds" claim. */
  sample_interval_seconds?: number | null;
  freshness?: Freshness;
}

// ─── Activity (sampled sessions) ─────────────────────────────────────────────
// A poll of the engine's own session table, canonicalized into `KIND_ACTIVITY`
// records. Two properties of this feed shape everything that reads it:
//
//   • It is SAMPLED, not continuous — one poll every
//     `sample_interval_seconds`, which is INFERRED from the spacing of the
//     samples and is therefore null when the server saw too few to infer one.
//     Our shipped default is 10s, not Datadog's 1 Hz.
//   • The receiver already FILTERED it — its template excludes `idle` sessions
//     older than the newest query unless they are blocking someone. So this is
//     not a faithful `pg_stat_activity` snapshot, and the page has to say so.

/**
 * One sampled session, as `activity_row_to_dto` emits it. Storage names never
 * cross the wire — the server drops the `o2_dbm_*` prefix and turns the
 * receiver's empty-string sentinels into `null`.
 */
export interface ActivitySession {
  /** When the sample was taken, microseconds. */
  timestamp: number;
  /** Backend pid (Postgres) or thread id (MySQL). */
  session_pid: number | null;
  session_user?: string | null;
  session_app?: string | null;
  /** `active` / `idle` / `idle in transaction` on PG; MySQL has no `active`. */
  state?: string | null;
  query?: string | null;
  /** Joins this session to a Top-queries row. */
  fingerprint?: string | null;
  /** The engine's own statement id — note the `query_id` spelling (X4). */
  server_query_id?: string | null;
  /**
   * NULL means the backend is ON CPU, not that the value is unknown — measured
   * at 36% of active Postgres sessions on the live rig. Never render it blank.
   */
  wait_event?: string | null;
  wait_event_type?: string | null;
  /** Postgres-native spelling: `2026-08-11 02:33:43.484605+00`. */
  query_start?: string | null;
  /** ISO-8601: `2026-08-11T02:33:43Z` — a DIFFERENT format from `query_start`,
   *  and a different clock. Transaction age is what separates a 5ms
   *  idle-in-transaction from a 20-minute incident. */
  xact_start?: string | null;
  /** ISO-8601, like `xact_start`. When the lock wait began. */
  wait_start?: string | null;
  /** MILLISECONDS here, though the same attribute name means SECONDS on
   *  top_query (E4) — hence the unit in the field name. */
  exec_time_ms?: number | null;
  /**
   * State-dependent: live-elapsed for a running session, the LAST COMPLETED
   * duration for an idle one. Rendering both in one column puts "running 40s
   * and still going" beside "finished 40s ago" — opposite actions.
   */
  duration_ms?: number | null;
  /** A real array on the wire; `[]` when unblocked, never `[0]`. */
  blocking_pids?: number[] | null;
  /** Derived from `blocking_pids` — the SOLE blocked-ness predicate (E2/E3). */
  blocked?: boolean;
  lock_mode?: string | null;
  lock_type?: string | null;
  lock_relation?: string | null;
  client_address?: string | null;
  client_host?: string | null;
  client_port?: number | null;
  db_system: string;
  db_instance?: string | null;
  db_namespace?: string | null;
}

/**
 * One wait-event bucket, from a SQL `GROUP BY` over the whole window — not a
 * fold over `hits`, which is row-limited and would present a truncated sample
 * as a population.
 *
 * Grouped by the engine's OWN vocabulary: PG reports sampled states while MySQL
 * reports timed durations, so a unified cross-engine taxonomy would sum two
 * incomparable things. A null `wait_event` is the on-CPU bucket, a real answer.
 */
export interface ActivityWaitBucket {
  wait_event_type: string | null;
  wait_event: string | null;
  sessions: number;
  /** Share of all sampled sessions in the window, `0`–`1`. */
  share?: number;
}

/** One session-state bucket, same SQL-aggregate provenance. */
export interface ActivityStateBucket {
  state: string | null;
  sessions: number;
}

export interface ActivityResponse {
  /** A row-limited SAMPLE of sessions — the breakdowns are the population. */
  hits: ActivitySession[];
  /** Always true; the server states it so the UI cannot forget. */
  sampled_sessions?: boolean;
  by_wait_event: ActivityWaitBucket[];
  by_state: ActivityStateBucket[];
  /** `hits.length`, not the window's population. */
  total?: number;
  /** The row sample hit its cap. Measured on the ROW query only — the
   *  aggregates carry no limit and are never truncated. */
  truncated?: boolean;
  stream?: string;
  /** Nothing is sampling sessions, so this tab cannot fill in. Distinct from
   *  `hits: []`, which is the HEALTHY case. */
  not_collecting?: boolean;
  /** Non-activity lines from these databases — the proof the pipeline is
   *  carrying traffic when the list is empty. */
  log_lines_seen?: number | null;
  /** When the most recent sample was taken, microseconds. */
  sampled_at?: number | null;
  /** Inferred from the spacing of observed polls. NULL when the server saw too
   *  few to infer one — the UI must fall back to non-numeric copy, never to a
   *  made-up default. */
  sample_interval_seconds?: number | null;
  freshness?: Freshness;
}

// ─── Request params ──────────────────────────────────────────────────────────

export interface DatabasesParams {
  startTime?: number;
  endTime?: number;
  stream?: string;
  system?: string;
  service?: string;
}

export interface QueriesParams {
  startTime?: number;
  endTime?: number;
  stream?: string;
  system?: string;
  instance?: string;
  namespace?: string;
  env?: string;
  service?: string;
  /** Defaults to `query` server-side; `all` disables the filter. */
  stmtClass?: string;
  /** Whitelisted server-side; unknown keys fall back to `total_time_ns`. */
  sort?: QuerySortKey;
  limit?: number;
  /** Free-text over the normalized query text; forces `top_n_subset`. */
  search?: string;
}

export interface QueryHistoryParams {
  fingerprint: string;
  startTime?: number;
  endTime?: number;
  stream?: string;
  system?: string;
  instance?: string;
  namespace?: string;
  env?: string;
  service?: string;
}

export interface QueryEndpointsParams {
  fingerprint: string;
  /** Required — the raw trace stream to aggregate. */
  stream: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface QueryPlansParams {
  fingerprint: string;
  /**
   * The server-vantage LOGS stream. Optional — the handler defaults it to the
   * shared `dbm_server` stream, as its deadlock/blocking/activity siblings do,
   * so the UI need not carry a backend constant.
   */
  stream?: string;
  startTime?: number;
  endTime?: number;
}

export interface DeadlocksParams {
  startTime?: number;
  endTime?: number;
  stream?: string;
  system?: string;
  instance?: string;
  namespace?: string;
  /** Free-text over the participant statements, applications and objects. */
  search?: string;
  limit?: number;
}

export interface ActivityParams {
  startTime?: number;
  endTime?: number;
  stream?: string;
  system?: string;
  instance?: string;
  namespace?: string;
  limit?: number;
}

export interface BlockingParams {
  startTime?: number;
  endTime?: number;
  stream?: string;
  system?: string;
  instance?: string;
  namespace?: string;
  search?: string;
  limit?: number;
}

/** The server's `SORT_KEYS` whitelist, verbatim. */
export type QuerySortKey =
  | "calls"
  | "errors"
  | "total_time_ns"
  | "p50_ns"
  | "p95_ns"
  | "p99_ns"
  | "max_ns"
  | "traces"
  | "statements";

type QueryParams = Record<string, string | number>;

/** `all` is the UI's "no filter" sentinel and must not reach the backend. */
const put = (params: QueryParams, key: string, value?: string | number) => {
  if (value === undefined || value === null || value === "" || value === "all") return;
  params[key] = value;
};

const dbMonitoringService = {
  /** FR-1 overview — `db_totals` rows per (system, instance, namespace). */
  getDatabases: (orgId: string, options: DatabasesParams = {}) => {
    const params: QueryParams = {};
    put(params, "start_time", options.startTime);
    put(params, "end_time", options.endTime);
    put(params, "stream", options.stream);
    put(params, "system", options.system);
    put(params, "service", options.service);
    return http().get<DatabasesResponse>(`/api/${orgId}/traces/db_monitoring/databases`, {
      params,
    });
  },

  /** FR-2 top queries — one row per fingerprint plus the `_other` remainder. */
  getQueries: (orgId: string, options: QueriesParams = {}) => {
    const params: QueryParams = {};
    put(params, "start_time", options.startTime);
    put(params, "end_time", options.endTime);
    put(params, "stream", options.stream);
    put(params, "system", options.system);
    put(params, "instance", options.instance);
    put(params, "namespace", options.namespace);
    put(params, "env", options.env);
    put(params, "service", options.service);
    // `stmt_class` is the one param whose "all" IS meaningful to the backend:
    // omitting it defaults to `query`, so the sentinel must pass through.
    if (options.stmtClass) params.stmt_class = options.stmtClass;
    put(params, "sort", options.sort);
    put(params, "limit", options.limit);
    put(params, "search", options.search);
    return http().get<QueriesResponse>(`/api/${orgId}/traces/db_monitoring/queries`, { params });
  },

  /** FR-5 per-fingerprint series, with below-top-N and live points flagged. */
  getQueryHistory: (orgId: string, options: QueryHistoryParams) => {
    const params: QueryParams = { fingerprint: options.fingerprint };
    put(params, "start_time", options.startTime);
    put(params, "end_time", options.endTime);
    put(params, "stream", options.stream);
    put(params, "system", options.system);
    put(params, "instance", options.instance);
    put(params, "namespace", options.namespace);
    put(params, "env", options.env);
    put(params, "service", options.service);
    return http().get<QueryHistoryResponse>(`/api/${orgId}/traces/db_monitoring/query/history`, {
      params,
    });
  },

  /** FR-5 calling endpoints for one fingerprint, from raw trace spans. */
  getQueryEndpoints: (orgId: string, options: QueryEndpointsParams) => {
    const params: QueryParams = {
      fingerprint: options.fingerprint,
      stream: options.stream,
    };
    put(params, "start_time", options.startTime);
    put(params, "end_time", options.endTime);
    put(params, "limit", options.limit);
    return http().get<QueryEndpointsResponse>(
      `/api/${orgId}/traces/db_monitoring/query/endpoints`,
      { params },
    );
  },

  /**
   * Distinct captured plans for one query.
   *
   * The response is a GENERIC, NULL-BOUND estimate — see `utils/dbm/plans.ts`
   * for what that means and why nothing here may be paired with latency.
   */
  getQueryPlans: (orgId: string, options: QueryPlansParams) => {
    const params: QueryParams = { fingerprint: options.fingerprint };
    put(params, "stream", options.stream);
    put(params, "start_time", options.startTime);
    put(params, "end_time", options.endTime);
    return http().get<QueryPlansResponse>(`/api/${orgId}/traces/db_monitoring/query/plans`, {
      params,
    });
  },

  /** FR-8 deadlocks the database reported in this window. */
  getDeadlocks: (orgId: string, options: DeadlocksParams = {}) => {
    const params: QueryParams = {};
    put(params, "start_time", options.startTime);
    put(params, "end_time", options.endTime);
    put(params, "stream", options.stream);
    put(params, "system", options.system);
    put(params, "instance", options.instance);
    put(params, "namespace", options.namespace);
    put(params, "search", options.search);
    put(params, "limit", options.limit);
    return http().get<DeadlocksResponse>(`/api/${orgId}/traces/db_monitoring/deadlocks`, {
      params,
    });
  },

  /**
   * W2 sampled sessions, with SQL-computed wait-event and state breakdowns.
   *
   * `hits` is row-limited and is a SAMPLE; `by_wait_event`/`by_state` are
   * aggregates over the whole window and are the population.
   */
  getActivity: (orgId: string, options: ActivityParams = {}) => {
    const params: QueryParams = {};
    put(params, "start_time", options.startTime);
    put(params, "end_time", options.endTime);
    put(params, "stream", options.stream);
    put(params, "system", options.system);
    put(params, "instance", options.instance);
    // `namespace`, not `database` — the handler accepts both and prefers
    // `database`, but every sibling method here spells it `namespace`.
    put(params, "namespace", options.namespace);
    put(params, "limit", options.limit);
    return http().get<ActivityResponse>(`/api/${orgId}/traces/db_monitoring/activity`, { params });
  },

  /** FR-9 sessions currently waiting on a lock, with root-blocker chains. */
  getBlocking: (orgId: string, options: BlockingParams = {}) => {
    const params: QueryParams = {};
    put(params, "start_time", options.startTime);
    put(params, "end_time", options.endTime);
    put(params, "stream", options.stream);
    put(params, "system", options.system);
    put(params, "instance", options.instance);
    put(params, "namespace", options.namespace);
    put(params, "search", options.search);
    put(params, "limit", options.limit);
    return http().get<BlockingResponse>(`/api/${orgId}/traces/db_monitoring/blocking`, { params });
  },
};

export default dbMonitoringService;
