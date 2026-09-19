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
 * Panel builders for the DBM **Metrics** tab.
 *
 * Every chart is a self-querying dashboard panel (version 2) rendered through
 * `PanelSchemaRenderer` — the same engine dashboards use — so this tab costs no
 * `db_monitoring` endpoint at all.
 *
 * Two sources, two rule sets:
 *
 *  • FEATURED panels are composed from `DBM_INSTANCE_METRICS`, the catalog the
 *    instance-health sweep reads, because the catalog knows what metric
 *    metadata cannot say: `postgresql_backends` is a level (the generic rule
 *    set would rate it into "connections per second"), `mysql_threads` needs
 *    `kind="connected"`, and MySQL's buffer-pool counters OVERLAP
 *    (`read_requests` includes the misses), so its cache-hit ratio must be
 *    `1 - reads/read_requests` — the naive hits/(hits+reads) understates the
 *    ratio on exactly the disk-bound instances the chart exists to surface.
 *  • The engine GROUPS chart every remaining `postgresql_*` / `mysql_*` stream
 *    through the metrics explorer's rule set (`buildPromqlSeed`), ordered by
 *    triage relevance rather than the alphabet.
 *
 * Scope travels as PromQL label matchers spliced into each query, using the
 * receiver label names the catalog pins. MySQL metrics carry no database
 * label, so a namespace scope narrows only the Postgres panels — the same
 * asymmetry the instance-health sweep has.
 */

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import {
  DBM_INSTANCE_METRICS,
  metricSystemFor,
  normalizeInstanceHost,
  type DbmMetricRole,
  type DbmMetricSpec,
} from "@/utils/dbm/instanceMetrics";
import {
  buildMetricCards,
  operandStreamsOf,
  type MetricCard,
  type MetricStream,
} from "@/utils/metrics/metricFamily";
import { buildPromqlSeed } from "@/utils/metrics/metricPanelSeed";

/** The scope the panels narrow to — the same three dimensions every DBM tab carries. */
export interface DbmMetricsScope {
  system?: string | null;
  instance?: string | null;
  namespace?: string | null;
}

export interface DbmMetricPanelEntry {
  /** Unique within the tab: `system:role` for featured, the stream name for groups. */
  key: string;
  title: I18nText;
  /** Tooltip line: the exact metric id(s), plus exporter help when it says more. */
  help: string;
  /** A self-querying version-2 panel schema for PanelSchemaRenderer. */
  schema: Record<string, any>;
}

export interface DbmMetricsSections {
  /** The curated triage roles, catalog-backed, in reading order. */
  featured: DbmMetricPanelEntry[];
  /** Everything else the DB receivers ship, grouped by engine. */
  groups: Array<{ system: string; panels: DbmMetricPanelEntry[] }>;
}

/** The dimensions the load chart can stack by — all columns on the activity samples. */
export const DBM_LOAD_BREAKDOWNS = ["waitEvent", "query", "database", "user"] as const;
export type DbmLoadBreakdown = (typeof DBM_LOAD_BREAKDOWNS)[number];

/** Mirrors `dbmShared.ts` — the stream every server-vantage record lands in. */
const DBM_SERVER_STREAM = "_o2_dbm_server";

/** Metric-stream prefix → the engine whose receiver writes it. */
const PREFIX_TO_SYSTEM: ReadonlyArray<[string, string]> = [
  ["postgresql_", "postgresql"],
  ["mysql_", "mysql"],
];

/** Receiver label names per metric system, pinned by the instance-health catalog. */
const SCOPE_LABELS: Readonly<Record<string, { instance: string; namespace?: string }>> = {
  postgresql: { instance: "service_instance_id", namespace: "postgresql_database_name" },
  mysql: { instance: "mysql_instance_endpoint" },
};

/** Product names — one correct form worldwide, never translated. */
const ENGINE_NAMES: Readonly<Record<string, string>> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
};

/**
 * Long-tail ordering: a substring's index here is its triage rank. Temp files,
 * locks and WAL pressure are what a slowness debugger scans for; commit
 * counters are bookkeeping. Unmatched streams sort after, alphabetically.
 */
const TRIAGE_PRIORITY: readonly string[] = ["temp", "lock", "wal", "rollback", "row"];

/**
 * What each load-chart breakdown groups by. NULL wait on a non-idle session
 * means on-CPU — an answer, not a gap — so it is named rather than blank.
 */
const LOAD_BREAKDOWN_EXPRS: Readonly<Record<DbmLoadBreakdown, string>> = {
  waitEvent: "COALESCE(o2_dbm_wait_event, 'CPU')",
  // The statement text names the slice; the fingerprint backs a sample whose
  // text was dropped. Truncated so one long query cannot own the legend.
  query: "COALESCE(substr(o2_dbm_activity_query, 1, 60), o2_dbm_fingerprint, 'unknown')",
  database: "COALESCE(o2_dbm_database, 'unknown')",
  user: "COALESCE(o2_dbm_session_user, 'unknown')",
};

/** The engine whose receiver writes this metric stream, or null for a non-DB stream. */
export function dbmMetricSystemOf(streamName: string): string | null {
  for (const [prefix, system] of PREFIX_TO_SYSTEM) {
    if (streamName.startsWith(prefix)) return system;
  }
  return null;
}

/** The DB-engine metric streams, optionally narrowed to one scoped engine. */
export function filterDbmMetricStreams(
  streams: MetricStream[],
  system?: string | null,
): MetricStream[] {
  const scoped = system ? metricSystemFor(system) : null;
  return (streams ?? []).filter((s) => {
    const owner = s?.name ? dbmMetricSystemOf(s.name) : null;
    if (!owner) return false;
    return scoped ? owner === scoped : true;
  });
}

export const promqlEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A port-tolerant identity matcher. The scope's instance is the CLIENT's
 * address (no port), while the receiver's identity label stores `host:port` —
 * exact equality never matches, the same vantage gap `normalizeInstanceHost`
 * exists to close for the health column. The regex accepts the bare host, a
 * bracketed IPv6 form, and any port. (A pooler or loopback address still
 * matches nothing — that gap is real, not a matching bug.)
 */
function instanceMatcher(label: string, value: string): string {
  const host = normalizeInstanceHost(value);
  if (!host) return `${label}="${promqlEscape(value)}"`;
  const pattern = `(\\[)?${escapeRegExp(host)}(\\])?(:[0-9]+)?`;
  return `${label}=~"${promqlEscape(pattern)}"`;
}

/**
 * The rendered matcher list scoping one stream, e.g.
 * `service_instance_id=~"db-1(:[0-9]+)?",postgresql_database_name="orders"`.
 * Empty when the scope names nothing this stream's engine can express.
 */
export function dbmPromqlSelector(streamName: string, scope: DbmMetricsScope): string {
  const labels = SCOPE_LABELS[dbmMetricSystemOf(streamName) ?? ""];
  if (!labels) return "";
  const matchers: string[] = [];
  if (scope.instance) matchers.push(instanceMatcher(labels.instance, scope.instance));
  if (scope.namespace && labels.namespace) {
    matchers.push(`${labels.namespace}="${promqlEscape(scope.namespace)}"`);
  }
  return matchers.join(",");
}

/**
 * Splices a rendered matcher list into every selector of the named operand
 * streams. The seeded queries always spell their selectors (`metric{}`), so
 * appending inside the braces is a complete rewrite, not a heuristic.
 */
export function injectPromqlSelector(
  query: string,
  operandStreams: string[],
  selector: string,
): string {
  if (!selector) return query;
  let out = query;
  for (const name of operandStreams) {
    const pattern = new RegExp(`${escapeRegExp(name)}\\{([^}]*)\\}`, "g");
    out = out.replace(
      pattern,
      (_, inner: string) => `${name}{${inner ? `${inner},${selector}` : selector}}`,
    );
  }
  return out;
}

/**
 * Whether a panel error is a stream-permission denial. This tab queries with
 * the USER's credentials (unlike the sibling tabs' module-granted endpoints),
 * so a 403 here means "no read grant on this stream" — a state to name, never
 * the engine's raw "Unauthorized Access" body text.
 */
export function panelErrorIsForbidden(event: { code?: unknown } | null | undefined): boolean {
  return String(event?.code ?? "") === "403";
}

/** `postgresql_bgwriter_buffers_allocated` → `Bgwriter buffers allocated`. */
export function humanizeDbmMetricName(streamName: string): string {
  let rest = streamName;
  for (const [prefix] of PREFIX_TO_SYSTEM) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  const words = rest.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Case-insensitive needle over title, key and help (the metric id lives there). */
export function filterDbmMetricPanels(
  entries: DbmMetricPanelEntry[],
  needle: string,
): DbmMetricPanelEntry[] {
  const q = needle.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      String(e.title).toLowerCase().includes(q) ||
      e.key.toLowerCase().includes(q) ||
      e.help.toLowerCase().includes(q),
  );
}

/** The DBM Metrics tab's grid: curated triage roles first, then per-engine groups. */
export function buildDbmMetricsSections(
  streams: MetricStream[],
  scope: DbmMetricsScope,
  t: TranslateFn,
  opts: { excludeStreams?: Set<string> } = {},
): DbmMetricsSections {
  // A missing `stats` block is unknown, not empty — only a measured zero hides.
  const kept = filterDbmMetricStreams(streams, scope.system).filter(
    (s) => !(s.stats && (s.stats.doc_num ?? 0) === 0),
  );

  const cards = buildMetricCards(kept).filter((card) => !card.unsupported);
  const cardByName = new Map(cards.map((card) => [card.name, card]));

  const { featured, consumed } = buildFeatured(cardByName, scope, t);

  const groups: DbmMetricsSections["groups"] = [];
  for (const [, system] of PREFIX_TO_SYSTEM) {
    const panels = cards
      .filter((card) => !consumed.has(card.name))
      .filter((card) => !opts.excludeStreams?.has(card.name))
      .filter((card) => dbmMetricSystemOf(card.name) === system)
      .sort(compareByTriage)
      .map((card) => seededEntry(card, kept, scope));
    if (panels.length) groups.push({ system, panels });
  }

  return { featured, groups };
}

function triageRank(name: string): number {
  const idx = TRIAGE_PRIORITY.findIndex((needle) => name.includes(needle));
  return idx === -1 ? TRIAGE_PRIORITY.length : idx;
}

function compareByTriage(a: MetricCard, b: MetricCard): number {
  return triageRank(a.name) - triageRank(b.name) || a.name.localeCompare(b.name);
}

/* ----------------------------- featured roles ----------------------------- */

export interface DbmPanelQuery {
  query: string;
  stream: string;
  legend: string;
}

/**
 * The curated first row, composed from the catalog: connections WITH its limit
 * as a reference series, the cache-hit RATIO instead of two raw counters, then
 * replication lag and deadlocks. A role whose stream this org does not ship is
 * skipped, never rendered empty.
 */
function buildFeatured(
  cardByName: Map<string, MetricCard>,
  scope: DbmMetricsScope,
  t: TranslateFn,
): { featured: DbmMetricPanelEntry[]; consumed: Set<string> } {
  const featured: DbmMetricPanelEntry[] = [];
  const consumed = new Set<string>();

  for (const [, system] of PREFIX_TO_SYSTEM) {
    const spec = (role: DbmMetricRole): DbmMetricSpec | undefined =>
      DBM_INSTANCE_METRICS.find((s) => metricSystemFor(s.system) === system && s.role === role);
    const has = (s: DbmMetricSpec | undefined): s is DbmMetricSpec =>
      !!s && cardByName.has(s.stream);
    const consume = (...specs: Array<DbmMetricSpec | undefined>) =>
      specs.forEach((s) => s && consumed.add(s.stream));

    const conn = spec("connections");
    if (has(conn)) {
      const queries: DbmPanelQuery[] = [specQuery(conn, scope)];
      const limit = spec("connectionLimit");
      if (has(limit)) {
        queries.push({ ...specQuery(limit, scope), legend: t("dbm.metrics.limitLegend") });
        consume(limit);
      }
      consume(conn);
      featured.push(
        rolePanel(system, "connections", queries, cardByName.get(conn.stream)!, t, {
          unit: cardByName.get(conn.stream)!.unit || null,
        }),
      );
    }

    const hit = spec("cacheHit");
    const read = spec("cacheRead");
    if (has(hit) && has(read)) {
      const query =
        system === "mysql" ? mysqlOverlapRatio(hit, read, scope) : disjointRatio(hit, read, scope);
      consume(hit, read);
      featured.push(
        rolePanel(
          system,
          "cacheHitRatio",
          [{ query, stream: hit.stream, legend: String(t("dbm.metrics.roles.cacheHitRatio")) }],
          cardByName.get(hit.stream)!,
          t,
          { unit: "percent-1" },
        ),
      );
    }

    for (const role of ["replicationLag", "deadlocks"] as const) {
      const s = spec(role);
      if (!has(s)) continue;
      consume(s);
      featured.push(
        rolePanel(system, role, [specQuery(s, scope)], cardByName.get(s.stream)!, t, {
          unit: s.cumulative ? null : cardByName.get(s.stream)!.unit || null,
        }),
      );
    }
  }

  return { featured, consumed };
}

/** One catalog stream as a promql query: rated iff cumulative, catalog filter as matcher. */
function specQuery(spec: DbmMetricSpec, scope: DbmMetricsScope): DbmPanelQuery {
  const inner = ratedSelector(spec, scope, spec.cumulative);
  const byLabels = [spec.identityColumn, ...(spec.seriesColumns ?? [])];
  const aggregate = spec.aggregate === "sum" ? "sum" : "max";
  const legendLabel = spec.seriesColumns?.at(-1) ?? spec.identityColumn;
  return {
    query: `${aggregate} by (${byLabels.join(", ")}) (${inner})`,
    stream: spec.stream,
    legend: `{${legendLabel}}`,
  };
}

function ratedSelector(spec: DbmMetricSpec, scope: DbmMetricsScope, rate: boolean): string {
  const matchers = [
    spec.filter ? `${spec.filter.column}="${promqlEscape(spec.filter.value)}"` : "",
    dbmPromqlSelector(spec.stream, scope),
  ]
    .filter(Boolean)
    .join(",");
  const selector = `${spec.stream}{${matchers}}`;
  return rate ? `rate(${selector}[$__rate_interval])` : selector;
}

/** Postgres publishes hits and misses as DISJOINT counters: hit / (hit + read). */
function disjointRatio(hit: DbmMetricSpec, read: DbmMetricSpec, scope: DbmMetricsScope): string {
  const h = `sum(${ratedSelector(hit, scope, true)})`;
  const r = `sum(${ratedSelector(read, scope, true)})`;
  return `${h} / (${h} + ${r})`;
}

/**
 * MySQL's `read_requests` INCLUDES the misses (`reads` ⊂ `read_requests`), so
 * the ratio is 1 - reads/read_requests — the naive hits/(hits+reads) would
 * double-count the misses and understate the ratio on disk-bound instances.
 * Same reasoning as `overlappingCacheHitRatio` in instanceMetrics.ts.
 */
function mysqlOverlapRatio(
  hit: DbmMetricSpec,
  read: DbmMetricSpec,
  scope: DbmMetricsScope,
): string {
  const reads = `sum(${ratedSelector(read, scope, true)})`;
  const requests = `sum(${ratedSelector(hit, scope, true)})`;
  return `1 - ${reads} / ${requests}`;
}

function rolePanel(
  system: string,
  role: string,
  queries: DbmPanelQuery[],
  card: MetricCard,
  t: TranslateFn,
  opts: { unit: string | null },
): DbmMetricPanelEntry {
  return {
    key: `${system}:${role}`,
    title: t("dbm.metrics.roleTitle", {
      role: t(`dbm.metrics.roles.${role}`),
      engine: raw(ENGINE_NAMES[system] ?? system),
    }),
    help: helpLine(card),
    schema: buildDbmPromqlPanelSchema({
      id: `dbm-metric-${system}-${role}`,
      chartType: "line",
      unit: opts.unit,
      queries,
    }),
  };
}

/* ------------------------------ grid panels ------------------------------- */

/** A grid panel, seeded by the metrics explorer's generic rule set. */
function seededEntry(
  card: MetricCard,
  streams: MetricStream[],
  scope: DbmMetricsScope,
): DbmMetricPanelEntry {
  const seed = buildPromqlSeed(card.name, streams, { allowChartTypeChange: true });
  const selector = dbmPromqlSelector(card.name, scope);
  const query = injectPromqlSelector(seed.query, operandStreamsOf(card), selector);
  const shortName = humanizeDbmMetricName(card.name);

  return {
    key: card.name,
    title: raw(shortName),
    help: helpLine(card),
    schema: buildDbmPromqlPanelSchema({
      id: `dbm-metric-${card.name}`,
      chartType: seed.chartType ?? "line",
      unit: seed.config.unit ?? null,
      unitCustom: seed.config.unit_custom ?? null,
      // A labelless series otherwise renders its legend as a literal `{}`.
      queries: [{ query, stream: seed.stream, legend: seed.legend || shortName }],
      heatmap: seed.config.heatmap_mode
        ? {
            heatmap_mode: seed.config.heatmap_mode,
            bucket_unit: seed.config.bucket_unit,
            bucket_unit_custom: seed.config.bucket_unit_custom,
          }
        : undefined,
    }),
  };
}

/** The metric id first — it is how the reader finds the stream — then the exporter's prose. */
function helpLine(card: MetricCard): string {
  return card.help ? `${card.name} — ${card.help}` : card.name;
}

/* ----------------------------- schema assembly ---------------------------- */

export interface DbmPanelSchemaArgs {
  id: string;
  chartType: string;
  unit: string | null;
  unitCustom?: string | null;
  queries: DbmPanelQuery[];
  heatmap?: Record<string, any>;
}

export function buildDbmPromqlPanelSchema(args: DbmPanelSchemaArgs): Record<string, any> {
  return {
    version: 2,
    id: args.id,
    title: "",
    description: "",
    type: args.chartType,
    config: {
      ...basePanelConfig(),
      unit: args.unit,
      unit_custom: args.unitCustom ?? null,
      ...(args.heatmap ?? {}),
    },
    queryType: "promql",
    queries: args.queries.map((q) => ({
      query: q.query,
      customQuery: true,
      vrlFunctionQuery: "",
      fields: {
        stream: q.stream,
        stream_type: "metrics",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
        latitude: null,
        longitude: null,
        weight: null,
      },
      config: {
        promql_legend: q.legend,
        layer_type: "scatter",
        weight_fixed: 1,
        limit: 0,
        min: 0,
        max: 100,
        time_shift: [],
      },
    })),
  };
}

/* ------------------------------- load chart ------------------------------- */

/** Axis labels the load panel renders; the page passes translated text. */
export interface DbmLoadPanelLabels {
  time?: I18nText;
  sessions?: I18nText;
  segment?: I18nText;
}

/** Single-quote doubling for values spliced into panel SQL. */
export const dbmSqlEscape = (value: string) => value.replace(/'/g, "''");

/**
 * The Datadog-style load chart: AVERAGE ACTIVE SESSIONS per time bucket,
 * stacked by the chosen dimension, from the server-vantage activity samples.
 *
 * Three claims the SQL must keep true:
 *  • Zoom-invariant: per-poll session counts are summed over the bucket and
 *    divided by the bucket's poll count, so the y-axis means the same thing at
 *    every window width. A raw distinct-count inflates with bucket width.
 *  • Engine-neutral: idle sessions are EXCLUDED rather than active ones
 *    allow-listed — MySQL has no `active` state (`running`/`waiting`/`other`),
 *    and an allow-list silently zeroed its CPU band.
 *  • Fleet-safe: sessions count once per poll ROW, never DISTINCT pid across
 *    instances — a pid is unique per instance, not globally.
 */
export function buildDbmLoadPanelSchema(
  scope: DbmMetricsScope,
  labels: DbmLoadPanelLabels = {},
  breakdown: DbmLoadBreakdown = "waitEvent",
): Record<string, any> {
  const predicates = [
    "o2_dbm_kind = 'activity'",
    // Prefix match: 'idle in transaction' (+ its aborted variant) also waits
    // on ClientRead and painted a constant band of fake load. MySQL's states
    // never start with 'idle', so its sessions are untouched.
    "(o2_dbm_session_state IS NULL OR o2_dbm_session_state NOT LIKE 'idle%')",
  ];
  if (scope.system) predicates.push(`o2_dbm_engine = '${dbmSqlEscape(scope.system)}'`);
  if (scope.instance) predicates.push(`o2_dbm_instance = '${dbmSqlEscape(scope.instance)}'`);
  if (scope.namespace) predicates.push(`o2_dbm_database = '${dbmSqlEscape(scope.namespace)}'`);
  const where = predicates.join(" AND ");

  // GROUP BY repeats the expression: the planner refuses to resolve a SELECT
  // alias of an expression there (llmInsightsPanels groups the same way).
  // Per-bucket poll counts come from DENSE_RANK + MAX windows over ONE scan —
  // a COUNT(DISTINCT) self-join reads the stream twice for the same numbers
  // (verified identical), and window COUNT(DISTINCT) is unsupported. The
  // trailing LIMIT lifts the search API's 1000-row result cap.
  const dim = LOAD_BREAKDOWN_EXPRS[breakdown];
  const sql =
    `SELECT ts, segment, SUM(cnt) * 1.0 / MAX(polls) AS sessions FROM ` +
    `(SELECT ts, segment, cnt, MAX(rnk) OVER (PARTITION BY ts) AS polls FROM ` +
    `(SELECT ts, segment, poll, cnt, DENSE_RANK() OVER (PARTITION BY ts ORDER BY poll) AS rnk FROM ` +
    `(SELECT histogram(_timestamp) AS ts, ${dim} AS segment, o2_dbm_timestamp AS poll, COUNT(*) AS cnt ` +
    `FROM "${DBM_SERVER_STREAM}" WHERE ${where} GROUP BY ts, ${dim}, poll) AS b) AS w) AS x ` +
    `GROUP BY ts, segment ORDER BY ts ASC LIMIT 30000`;

  return buildDbmSqlPanelSchema({
    id: "dbm-metric-load",
    chartType: "line",
    unit: "numbers",
    stream: DBM_SERVER_STREAM,
    sql,
    xLabel: labels.time ?? raw("ts"),
    yAlias: "sessions",
    yLabel: labels.sessions ?? raw("sessions"),
    segmentLabel: labels.segment ?? raw("segment"),
  });
}

/** Inputs for a self-querying SQL timeseries panel: `ts` / y-alias / `segment` columns. */
export interface DbmSqlPanelArgs {
  id: string;
  chartType: string;
  unit: string | null;
  stream: string;
  sql: string;
  xLabel: I18nText;
  yAlias: string;
  yLabel: I18nText;
  segmentLabel: I18nText;
}

export function buildDbmSqlPanelSchema(args: DbmSqlPanelArgs): Record<string, any> {
  const axis = (aliasName: string, label: I18nText) => ({
    alias: aliasName,
    column: aliasName,
    color: null,
    label,
  });

  return {
    version: 2,
    id: args.id,
    title: "",
    description: "",
    type: args.chartType,
    config: {
      ...basePanelConfig(),
      unit: args.unit,
      unit_custom: "",
      // SQL panels chart SPARSE event data (samples, rollup windows). Lines
      // stay connected for readability, but every real bucket draws a DOT —
      // the dots are what keep a bridged stretch honest (no dot = no sample),
      // and a lone single-poll wait event still renders instead of vanishing.
      connect_nulls: true,
      show_symbol: true,
    },
    queryType: "sql",
    queries: [
      {
        query: args.sql,
        customQuery: true,
        vrlFunctionQuery: "",
        fields: {
          stream: args.stream,
          stream_type: "logs",
          x: [axis("ts", args.xLabel)],
          y: [axis(args.yAlias, args.yLabel)],
          z: [],
          breakdown: [axis("segment", args.segmentLabel)],
          filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
          latitude: null,
          longitude: null,
          weight: null,
        },
        config: {
          promql_legend: "",
          layer_type: "scatter",
          weight_fixed: 1,
          limit: 0,
          min: 0,
          max: 100,
          time_shift: [],
        },
      },
    ],
  };
}

function basePanelConfig(): Record<string, any> {
  return {
    show_legends: true,
    legends_position: "bottom",
    decimals: 2,
    connect_nulls: true,
    no_value_replacement: "",
    show_symbol: false,
    line_interpolation: "smooth",
    axis_border_show: true,
    wrap_table_cells: false,
    base_map: { type: "osm" },
    map_view: { zoom: 1, lat: 0, lng: 0 },
    mark_line: [],
  };
}
