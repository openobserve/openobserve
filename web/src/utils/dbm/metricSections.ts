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

/**
 * The DBM Metrics tab's THEMED SECTION catalog — the Datadog-style semantic
 * grouping (Activity · Locks · Replication · Indexes · Blocks · Vacuum · Host),
 * declared as data the way `llmInsightsPanels` declares the LLM dashboard.
 *
 * Three panel sources, one renderer:
 *  • `promql`     — an OTel receiver metric stream; the panel is available only
 *                   when the stream exists in the org, and gets an
 *                   Open-in-Metrics-Explorer handoff.
 *  • `sql-rate`   — per-minute rates diffed from the CUMULATIVE per-query
 *                   counters riding top_query samples (calls, exec time): the
 *                   by-query throughput and latency charts Datadog draws from
 *                   pg_stat_statements, at poll resolution instead of the
 *                   15-minute rollup cadence of `_o2_db_stats`.
 *  • `sql-server` — the database's OWN per-query counters riding top_query
 *                   samples in `_o2_dbm_server` (shared blocks hit/read/dirtied).
 *
 * Every panel carries `byDims` — the per-panel "by ▾" slicer. A section renders
 * only when at least one of its panels can read something.
 */

import type { I18nText, TranslateFn } from "@/types/i18n";

import { normalizeInstanceHost } from "./instanceMetrics";
import {
  buildDbmPromqlPanelSchema,
  buildDbmSqlPanelSchema,
  dbmPromqlSelector,
  dbmSqlEscape,
  escapeRegExp,
  promqlEscape,
  type DbmMetricsScope,
} from "./metricsPanels";

export type DbmSectionSource = "promql" | "sql-rate" | "sql-server";

export interface DbmSectionPanelDef {
  key: string;
  source: DbmSectionSource;
  /** promql: the metric stream charted (and required for availability). */
  metric?: string;
  /** promql aggregation across series. */
  agg?: "sum" | "max";
  /** promql: counter → rate; level → plain. */
  rate?: boolean;
  /** sql-server: the SELECT value expression. */
  valueExpr?: string;
  /** sql-rate: the cumulative counter column the per-bucket rate is diffed from. */
  counter?: string;
  /** sql-rate: cumulative denominator column — value becomes Δcounter × scale / Δdivisor. */
  divideBy?: string;
  /** sql-rate: multiplier on the (numerator) delta, e.g. seconds → milliseconds. */
  scale?: number;
  /** promql: a composed query overriding the sliced form; receives the rendered host selector. */
  expr?: (hostSelector: string) => string;
  /** Slicer dimensions, first is the default. Keys into the per-source dim tables. */
  byDims: string[];
  unit: string | null;
}

export interface DbmSectionDef {
  key: string;
  panels: DbmSectionPanelDef[];
}

export interface DbmSectionPanelEntry {
  key: string;
  title: I18nText;
  help: string;
  schema: Record<string, any>;
  /** Present on promql panels only: the raw query for the Metrics Explorer handoff. */
  explore?: { stream: string; query: string };
}

/** Mirrors the constant in metricsPanels/dbmShared — the server-vantage DBM stream. */
const SERVER_STREAM = "_o2_dbm_server";

/** OTel hostmetrics streams — no DB prefix, scoped by hostname instead of instance labels. */
const HOST_METRIC_PREFIX = "system_";

/** Addresses the collector rewrites to its own hostname — scoping by them would guess wrong. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** promql dim key → label name (receiver attribute after sanitisation). */
const PROMQL_DIMS: Readonly<Record<string, string>> = {
  database: "postgresql_database_name",
  operation: "operation",
  mode: "mode",
  lockType: "lock_type",
  table: "postgresql_table_name",
  index: "postgresql_index_name",
  client: "replication_client",
  state: "state",
  direction: "direction",
  device: "device",
  host: "host_name",
};

/** Dims that can exceed the series cap; only these pay top-N ranking. */
const UNBOUNDED_SQL_DIMS: ReadonlySet<string> = new Set(["query"]);

/** server-vantage dim key → SELECT expression. */
const SERVER_DIMS: Readonly<Record<string, string>> = {
  // The SQL text column top_query rows actually populate (server_queries.rs
  // reads the same one); o2_dbm_query_shape is spec'd but never ingested, and
  // a missing column is a hard schema error, not a NULL.
  query: "COALESCE(substr(o2_dbm_activity_query, 1, 60), o2_dbm_fingerprint, 'unknown')",
  database: "COALESCE(o2_dbm_database, 'unknown')",
};

export const DBM_METRIC_SECTIONS: readonly DbmSectionDef[] = [
  {
    key: "host",
    panels: [
      {
        key: "cpuUtilization",
        source: "promql",
        metric: "system_cpu_time",
        expr: (hostSel) =>
          "100 * (1 - " +
          `sum(rate(system_cpu_time{${['state="idle"', hostSel].filter(Boolean).join(",")}}[$__rate_interval])) / ` +
          `sum(rate(system_cpu_time{${hostSel}}[$__rate_interval])))`,
        byDims: [],
        unit: "percent",
      },
      {
        key: "memoryUsage",
        source: "promql",
        metric: "system_memory_usage",
        agg: "sum",
        rate: false,
        byDims: ["host", "state"],
        unit: "bytes",
      },
      {
        key: "diskIo",
        source: "promql",
        metric: "system_disk_io",
        agg: "sum",
        rate: true,
        byDims: ["host", "direction", "device"],
        unit: "bps",
      },
      {
        key: "networkIo",
        source: "promql",
        metric: "system_network_io",
        agg: "sum",
        rate: true,
        byDims: ["host", "direction", "device"],
        unit: "bps",
      },
    ],
  },
  {
    key: "activity",
    panels: [
      {
        key: "calls",
        source: "sql-rate",
        counter: "o2_dbm_calls",
        byDims: ["query", "database"],
        unit: "numbers",
      },
      {
        key: "avgDuration",
        source: "sql-rate",
        // exec_time is SECONDS on top_query (see O2_DBM_EXEC_TIME_S) — ×1000
        // over the call delta yields mean milliseconds per call.
        counter: "o2_dbm_exec_time_s",
        divideBy: "o2_dbm_calls",
        scale: 1000,
        byDims: ["query", "database"],
        unit: "milliseconds",
      },
      {
        key: "commits",
        source: "promql",
        metric: "postgresql_commits",
        agg: "sum",
        rate: true,
        byDims: ["database"],
        unit: null,
      },
      {
        key: "rollbacks",
        source: "promql",
        metric: "postgresql_rollbacks",
        agg: "sum",
        rate: true,
        byDims: ["database"],
        unit: null,
      },
      {
        key: "rowsModified",
        source: "promql",
        metric: "postgresql_operations",
        agg: "sum",
        rate: true,
        byDims: ["operation", "database"],
        unit: null,
      },
    ],
  },
  {
    key: "locks",
    panels: [
      {
        key: "locks",
        source: "promql",
        metric: "postgresql_database_locks",
        agg: "sum",
        rate: false,
        byDims: ["mode", "lockType", "table"],
        unit: null,
      },
    ],
  },
  {
    key: "replication",
    panels: [
      {
        key: "walLag",
        source: "promql",
        metric: "postgresql_wal_lag",
        agg: "max",
        rate: false,
        byDims: ["operation", "client"],
        unit: "seconds",
      },
    ],
  },
  {
    key: "indexes",
    panels: [
      {
        key: "indexScans",
        source: "promql",
        metric: "postgresql_index_scans",
        agg: "sum",
        rate: true,
        byDims: ["index", "table"],
        unit: null,
      },
      {
        key: "indexSize",
        source: "promql",
        metric: "postgresql_index_size",
        agg: "sum",
        rate: false,
        byDims: ["index", "table"],
        unit: "bytes",
      },
    ],
  },
  {
    key: "blocks",
    panels: [
      {
        key: "blksHit",
        source: "sql-server",
        valueExpr: "SUM(o2_dbm_shared_blks_hit)",
        byDims: ["query", "database"],
        unit: "numbers",
      },
      {
        key: "blksRead",
        source: "sql-server",
        valueExpr: "SUM(o2_dbm_shared_blks_read)",
        byDims: ["query", "database"],
        unit: "numbers",
      },
      {
        key: "blksDirtied",
        source: "sql-server",
        valueExpr: "SUM(o2_dbm_shared_blks_dirtied)",
        byDims: ["query", "database"],
        unit: "numbers",
      },
    ],
  },
  {
    key: "vacuum",
    panels: [
      {
        key: "rowsByState",
        source: "promql",
        metric: "postgresql_rows",
        agg: "sum",
        rate: false,
        byDims: ["state", "table"],
        unit: null,
      },
    ],
  },
];

/**
 * The catalog narrowed to what this org can actually read: a promql panel needs
 * its metric stream; the two DBM-stream sources are always eligible (their
 * streams are not in the metrics list — an empty chart there is data truth).
 * The host section checks `allStreamNames`: its `system_*` streams carry no DB
 * prefix, so the engine-scoped set can never contain them.
 */
export function availableDbmSections(
  dbStreamNames: Set<string>,
  allStreamNames?: Set<string>,
): DbmSectionDef[] {
  return DBM_METRIC_SECTIONS.map((section) => {
    const pool = section.key === "host" ? (allStreamNames ?? dbStreamNames) : dbStreamNames;
    return {
      ...section,
      panels: section.panels.filter(
        (p) => p.source !== "promql" || (p.metric && pool.has(p.metric)),
      ),
    };
  }).filter((section) => section.panels.length > 0);
}

/**
 * Endpoints of cloud-managed databases: there is no host to scrape, so a
 * hostname matcher can only ever return nothing — the section states the fact
 * instead of rendering doomed empty charts.
 */
const MANAGED_DB_SUFFIXES: readonly string[] = [
  ".rds.amazonaws.com",
  ".database.azure.com",
  ".aivencloud.com",
];

export type DbmHostScopeState = "unscoped" | "scoped" | "loopback" | "managed";

/** How the host section relates to the current instance scope. */
export function dbmHostScopeState(scope: DbmMetricsScope): DbmHostScopeState {
  const host = normalizeInstanceHost(scope.instance);
  if (!host) return "unscoped";
  if (LOOPBACK_HOSTS.has(host)) return "loopback";
  if (MANAGED_DB_SUFFIXES.some((suffix) => host.endsWith(suffix))) return "managed";
  return "scoped";
}

/**
 * Host-stream scoping: the DB instance's host as a hostmetrics `host_name`
 * matcher. Loopback and managed endpoints return "" — the collector reports
 * its OWN hostname for localhost dials, and a managed database has no host at
 * all, so any matcher would be a guess. The matcher is FQDN-tolerant: `db-1`
 * also matches `db-1.internal`. scope.system/namespace never apply.
 */
export function dbmHostSelector(scope: DbmMetricsScope): string {
  if (dbmHostScopeState(scope) !== "scoped") return "";
  const host = normalizeInstanceHost(scope.instance);
  const pattern = `${escapeRegExp(host as string)}(\\..*)?`;
  return `host_name=~"${promqlEscape(pattern)}"`;
}

/** Metric streams the catalog charts, so the auto-discovered remainder skips them. */
export function catalogConsumedStreams(streamNames: Set<string>): Set<string> {
  const consumed = new Set<string>();
  for (const section of availableDbmSections(streamNames)) {
    for (const panel of section.panels) {
      if (panel.source === "promql" && panel.metric) consumed.add(panel.metric);
    }
  }
  return consumed;
}

/** One catalog panel at one slicer position, as a self-querying schema. */
export function buildDbmSectionPanel(
  def: DbmSectionPanelDef,
  by: string,
  scope: DbmMetricsScope,
  t: TranslateFn,
): DbmSectionPanelEntry {
  const title = t(`dbm.metrics.catalogPanels.${def.key}`);
  if (def.source === "promql") return promqlEntry(def, by, scope, title);
  if (def.source === "sql-rate") return rateEntry(def, by, scope, title, t);
  return sqlEntry(def, by, scope, title, t);
}

function promqlEntry(
  def: DbmSectionPanelDef,
  by: string,
  scope: DbmMetricsScope,
  title: I18nText,
): DbmSectionPanelEntry {
  const metric = def.metric ?? "";
  const isHost = metric.startsWith(HOST_METRIC_PREFIX);
  const selector = isHost ? dbmHostSelector(scope) : dbmPromqlSelector(metric, scope);
  const { query, legend } = def.expr
    ? { query: def.expr(selector), legend: String(title) }
    : slicedPromql(def, by, selector, isHost);

  return {
    key: def.key,
    title,
    help: metric,
    schema: buildDbmPromqlPanelSchema({
      id: `dbm-catalog-${def.key}`,
      chartType: "line",
      unit: def.unit,
      queries: [{ query, stream: metric, legend }],
    }),
    explore: { stream: metric, query },
  };
}

function slicedPromql(
  def: DbmSectionPanelDef,
  by: string,
  selector: string,
  isHost: boolean,
): { query: string; legend: string } {
  const metric = def.metric ?? "";
  const label = PROMQL_DIMS[by] ?? PROMQL_DIMS[def.byDims[0]];
  const inner = def.rate
    ? `rate(${metric}{${selector}}[$__rate_interval])`
    : `${metric}{${selector}}`;
  // An unscoped host stream mixes machines — group by host_name too, so two
  // hosts never blend into one series.
  const wide = isHost && !selector && label !== "host_name";
  const query = `${def.agg ?? "sum"} by (${wide ? `${label}, host_name` : label}) (${inner})`;
  return { query, legend: wide ? `{host_name} {${label}}` : `{${label}}` };
}

function sqlEntry(
  def: DbmSectionPanelDef,
  by: string,
  scope: DbmMetricsScope,
  title: I18nText,
  t: TranslateFn,
): DbmSectionPanelEntry {
  const byKey = SERVER_DIMS[by] ? by : def.byDims[0];
  const dim = SERVER_DIMS[byKey];
  const where = serverScopeWhere(scope, [
    // Cumulative counters summed per bucket double-count across polls;
    // only delta-reporting receivers chart here.
    "COALESCE(o2_dbm_metrics_are_delta, true) = true",
  ]);

  // GROUP BY repeats the expression — the planner refuses a SELECT alias
  // there. The trailing LIMIT is load-bearing: the search API returns at most
  // 1000 rows unless the SQL itself carries an outer LIMIT (the server lifts
  // the result cap from the SQL text), and segments x buckets exceeds 1000 on
  // routine windows, silently truncating the time axis. That same extraction
  // reads ANY LIMIT in the text — a `LIMIT 10` inside a top-N subquery caps
  // the whole result at 10 rows — so unbounded dims rank top-10 segments with
  // a window predicate instead, which also scans the stream once, not twice.
  const base =
    `SELECT histogram(_timestamp) AS ts, ${dim} AS segment, ${def.valueExpr} AS value ` +
    `FROM "${SERVER_STREAM}" WHERE ${where} GROUP BY ts, ${dim}`;
  const sql = UNBOUNDED_SQL_DIMS.has(byKey)
    ? `SELECT ts, segment, value FROM ` +
      `(SELECT ts, segment, value, DENSE_RANK() OVER (ORDER BY total DESC, segment) AS rnk FROM ` +
      `(SELECT ts, segment, value, SUM(value) OVER (PARTITION BY segment) AS total FROM ` +
      `(${base}) AS b) AS w) AS x ` +
      `WHERE rnk <= 10 ORDER BY ts ASC LIMIT 30000`
    : `${base} ORDER BY ts ASC LIMIT 30000`;

  return sqlPanelEntry(def, title, t, sql);
}

/**
 * Per-bucket rate from a CUMULATIVE per-query counter, LAG-diffed per segment.
 * The receiver stamps `metrics_are_delta: true` on top_query rows that carry
 * lifetime pg_stat_statements totals (verified against 0.158.0: `calls` in the
 * hundreds of millions, rising monotonically per poll), so the flag cannot
 * gate a SUM — the diff shape is the one that charts this feed truthfully.
 * Negative deltas (a counter reset or statement eviction) are dropped, not
 * clamped: a clamped zero would chart as a real measurement of quiet.
 */
function rateEntry(
  def: DbmSectionPanelDef,
  by: string,
  scope: DbmMetricsScope,
  title: I18nText,
  t: TranslateFn,
): DbmSectionPanelEntry {
  const byKey = SERVER_DIMS[by] ? by : def.byDims[0];
  const dim = SERVER_DIMS[byKey];
  const where = serverScopeWhere(scope, []);
  const scale = def.scale ?? 1;
  const ratio = Boolean(def.divideBy);

  const den = ratio ? `, MAX(${def.divideBy}) AS den` : "";
  const denCarry = ratio ? ", den" : "";
  const lag = (col: string) => `${col} - LAG(${col}) OVER (PARTITION BY segment ORDER BY ts)`;
  const valueExpr = ratio ? `d * ${scale}.0 / dd` : scale === 1 ? "d" : `d * ${scale}.0`;
  const guards = ["d IS NOT NULL", "d >= 0", ...(ratio ? ["dd > 0"] : [])];
  if (UNBOUNDED_SQL_DIMS.has(byKey)) guards.push("rnk <= 10");

  // Top-N ranks by the counter's SPAN over the window (last minus first) —
  // the same total the per-bucket deltas sum to, computable before diffing.
  const sql =
    `SELECT ts, segment, ${valueExpr} AS value FROM ` +
    `(SELECT ts, segment, ${lag("cum")} AS d${ratio ? `, ${lag("den")} AS dd` : ""}, rnk FROM ` +
    `(SELECT ts, segment, cum${denCarry}, DENSE_RANK() OVER (ORDER BY span DESC, segment) AS rnk FROM ` +
    `(SELECT ts, segment, cum${denCarry}, ` +
    `MAX(cum) OVER (PARTITION BY segment) - MIN(cum) OVER (PARTITION BY segment) AS span FROM ` +
    `(SELECT histogram(_timestamp) AS ts, ${dim} AS segment, MAX(${def.counter}) AS cum${den} ` +
    `FROM "${SERVER_STREAM}" WHERE ${where} GROUP BY ts, ${dim}) AS a) AS s) AS r) AS f ` +
    `WHERE ${guards.join(" AND ")} ORDER BY ts ASC LIMIT 30000`;

  return sqlPanelEntry(def, title, t, sql);
}

function serverScopeWhere(scope: DbmMetricsScope, extra: string[]): string {
  // The discriminator every other DBM reader uses (fromDbmLocks.ts,
  // metricsPanels.ts's load panel) — `o2_event_name` is not a column on
  // `_o2_dbm_server` at all, a hard DataFusion schema error, not empty data.
  const predicates = ["o2_dbm_kind = 'top_query'", ...extra];
  if (scope.system) predicates.push(`o2_dbm_engine = '${dbmSqlEscape(scope.system)}'`);
  if (scope.instance) predicates.push(`o2_dbm_instance = '${dbmSqlEscape(scope.instance)}'`);
  if (scope.namespace) predicates.push(`o2_dbm_database = '${dbmSqlEscape(scope.namespace)}'`);
  return predicates.join(" AND ");
}

function sqlPanelEntry(
  def: DbmSectionPanelDef,
  title: I18nText,
  t: TranslateFn,
  sql: string,
): DbmSectionPanelEntry {
  return {
    key: def.key,
    title,
    help: SERVER_STREAM,
    schema: buildDbmSqlPanelSchema({
      id: `dbm-catalog-${def.key}`,
      chartType: "line",
      unit: def.unit,
      stream: SERVER_STREAM,
      sql,
      // The x axis is time — naming it after the panel doubled the title.
      xLabel: t("dbm.metrics.load.timeAxis"),
      yAlias: "value",
      yLabel: title,
      segmentLabel: title,
    }),
  };
}
