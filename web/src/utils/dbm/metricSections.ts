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
 * grouping (Activity · Locks · Replication · Indexes · Blocks · Vacuum),
 * declared as data the way `llmInsightsPanels` declares the LLM dashboard.
 *
 * Three panel sources, one renderer:
 *  • `promql`     — an OTel receiver metric stream; the panel is available only
 *                   when the stream exists in the org, and gets an
 *                   Open-in-Metrics-Explorer handoff.
 *  • `sql-stats`  — the query rollup (`_o2_db_stats`): the by-query throughput
 *                   and latency charts Datadog draws from pg_stat_statements.
 *  • `sql-server` — the database's OWN per-query counters riding top_query
 *                   samples in `_o2_dbm_server` (shared blocks hit/read/dirtied).
 *
 * Every panel carries `byDims` — the per-panel "by ▾" slicer. A section renders
 * only when at least one of its panels can read something.
 */

import type { I18nText, TranslateFn } from "@/types/i18n";

import {
  buildDbmPromqlPanelSchema,
  buildDbmSqlPanelSchema,
  dbmPromqlSelector,
  dbmSqlEscape,
  type DbmMetricsScope,
} from "./metricsPanels";

export type DbmSectionSource = "promql" | "sql-stats" | "sql-server";

export interface DbmSectionPanelDef {
  key: string;
  source: DbmSectionSource;
  /** promql: the metric stream charted (and required for availability). */
  metric?: string;
  /** promql aggregation across series. */
  agg?: "sum" | "max";
  /** promql: counter → rate; level → plain. */
  rate?: boolean;
  /** sql sources: the SELECT value expression. */
  valueExpr?: string;
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

/** Mirrors the constants in metricsPanels/dbmShared — the two DBM streams. */
const STATS_STREAM = "_o2_db_stats";
const SERVER_STREAM = "_o2_dbm_server";

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
};

/** rollup dim key → SELECT expression. */
const STATS_DIMS: Readonly<Record<string, string>> = {
  query: "COALESCE(substr(query_norm, 1, 60), fingerprint, 'unknown')",
  database: "COALESCE(db_namespace, 'unknown')",
  service: "COALESCE(service_name, 'unknown')",
};

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
    key: "activity",
    panels: [
      {
        key: "calls",
        source: "sql-stats",
        valueExpr: "SUM(calls)",
        byDims: ["query", "database", "service"],
        unit: "numbers",
      },
      {
        key: "avgDuration",
        source: "sql-stats",
        valueExpr: "SUM(total_time_ns) * 1.0 / NULLIF(SUM(calls), 0) / 1000000.0",
        byDims: ["query", "database", "service"],
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
 */
export function availableDbmSections(streamNames: Set<string>): DbmSectionDef[] {
  return DBM_METRIC_SECTIONS.map((section) => ({
    ...section,
    panels: section.panels.filter(
      (p) => p.source !== "promql" || (p.metric && streamNames.has(p.metric)),
    ),
  })).filter((section) => section.panels.length > 0);
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
  return sqlEntry(def, by, scope, title);
}

function promqlEntry(
  def: DbmSectionPanelDef,
  by: string,
  scope: DbmMetricsScope,
  title: I18nText,
): DbmSectionPanelEntry {
  const metric = def.metric ?? "";
  const label = PROMQL_DIMS[by] ?? PROMQL_DIMS[def.byDims[0]];
  const selector = dbmPromqlSelector(metric, scope);
  const inner = def.rate
    ? `rate(${metric}{${selector}}[$__rate_interval])`
    : `${metric}{${selector}}`;
  const query = `${def.agg ?? "sum"} by (${label}) (${inner})`;

  return {
    key: def.key,
    title,
    help: metric,
    schema: buildDbmPromqlPanelSchema({
      id: `dbm-catalog-${def.key}`,
      chartType: "line",
      unit: def.unit,
      queries: [{ query, stream: metric, legend: `{${label}}` }],
    }),
    explore: { stream: metric, query },
  };
}

function sqlEntry(
  def: DbmSectionPanelDef,
  by: string,
  scope: DbmMetricsScope,
  title: I18nText,
): DbmSectionPanelEntry {
  const stats = def.source === "sql-stats";
  const dims = stats ? STATS_DIMS : SERVER_DIMS;
  const dim = dims[by] ?? dims[def.byDims[0]];
  const stream = stats ? STATS_STREAM : SERVER_STREAM;

  const predicates = stats
    ? ["record_type = 'query_stats'"]
    : [
        "o2_event_name = 'db.server.top_query'",
        // Cumulative counters summed per bucket double-count across polls;
        // only delta-reporting receivers chart here.
        "COALESCE(o2_dbm_metrics_are_delta, true) = true",
      ];
  const cols = stats
    ? { system: "db_system", instance: "db_instance", namespace: "db_namespace" }
    : { system: "o2_dbm_engine", instance: "o2_dbm_instance", namespace: "o2_dbm_database" };
  if (scope.system) predicates.push(`${cols.system} = '${dbmSqlEscape(scope.system)}'`);
  if (scope.instance) predicates.push(`${cols.instance} = '${dbmSqlEscape(scope.instance)}'`);
  if (scope.namespace) predicates.push(`${cols.namespace} = '${dbmSqlEscape(scope.namespace)}'`);

  // GROUP BY repeats the expression — the planner refuses a SELECT alias there.
  const sql =
    `SELECT histogram(_timestamp) AS ts, ${dim} AS segment, ${def.valueExpr} AS value ` +
    `FROM "${stream}" WHERE ${predicates.join(" AND ")} ` +
    `GROUP BY ts, ${dim} ORDER BY ts ASC`;

  return {
    key: def.key,
    title,
    help: stream,
    schema: buildDbmSqlPanelSchema({
      id: `dbm-catalog-${def.key}`,
      chartType: "line",
      unit: def.unit,
      stream,
      sql,
      xLabel: title,
      yAlias: "value",
      yLabel: title,
      segmentLabel: title,
    }),
  };
}
