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

import type { I18nKey } from "@/types/i18n";
import { sqlIn, sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { pageKeyExpr, urlPrefilter } from "@/utils/rum/productAnalyticsQueries";

export type VitalKey = "lcp" | "inp" | "cls";
export type Band = "good" | "needs" | "poor";
export type Percentile = "p50" | "p75" | "p95";
export type SegmentDim = "browser" | "device" | "os" | "country" | "connection";

export interface VitalThreshold {
  good: number;
  poor: number;
  column: string;
  divisor: number;
}

// Stored LCP and INP are nanoseconds; CLS is unitless.
export const VITAL_THRESHOLDS: Readonly<Record<VitalKey, VitalThreshold>> = {
  lcp: { good: 2.5e9, poor: 4e9, column: "view_largest_contentful_paint", divisor: 1e9 },
  inp: { good: 2e8, poor: 5e8, column: "view_interaction_to_next_paint", divisor: 1e6 },
  cls: { good: 0.1, poor: 0.25, column: "view_cumulative_layout_shift", divisor: 1 },
};

export const VITAL_KEYS: readonly VitalKey[] = ["lcp", "inp", "cls"];
export const PERCENTILES: readonly Percentile[] = ["p50", "p75", "p95"];
export const PERCENTILE_Q: Readonly<Record<Percentile, number>> = {
  p50: 0.5,
  p75: 0.75,
  p95: 0.95,
};
export const MIN_VIEWS = 100;
export const MIN_SEGMENT_VIEWS = 30;
export const MAX_PAGES = 200;
export const MIN_DIFFERENCE_RATIO = 1.25;
export const MIN_PREVIOUS_SHARE = 0.1;
export const MAX_DELTA_PCT = 1000;
// Mobile SDKs share the stream, so the browser view keeps only browser rows; a blank source is browser, as in useRumPlatforms.
export const BROWSER_SOURCE_WHERE = "(source IS NULL OR source IN ('', 'browser'))";

export const SEGMENT_COLUMNS: Readonly<Record<SegmentDim, readonly string[]>> = {
  browser: ["user_agent_user_agent_family", "user_agent_user_agent_major"],
  device: ["user_agent_device_family"],
  os: ["user_agent_os_family"],
  country: ["geo_info_country"],
  connection: ["connectivity_effective_type"],
};
export const SEGMENT_DIMS = Object.keys(SEGMENT_COLUMNS) as SegmentDim[];
export const SEGMENT_TOP = 8;

export interface OverviewFilters {
  service: string[];
  env: string[];
  version: string[];
}

export interface QueryCtx {
  schema: Set<string>;
  filters: OverviewFilters;
}

export interface VitalsRow {
  views: number;
  [key: string]: number | null;
}

export interface Delta {
  abs: number;
  pct: number | null;
  direction: "up" | "down" | "flat";
}

export interface BandCounts {
  good: number;
  needs: number;
  poor: number;
}

export interface PageRow {
  path: string;
  views: number;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  errors: number;
  bad: number;
  impact: number;
}

export interface SegmentRow {
  label: string;
  views: number;
  inp: number | null;
  lcp: number | null;
  share: number;
  filter: string;
}

export interface BiggestDifference {
  dim: SegmentDim;
  label: string;
  filter: string;
  views: number;
  inp: number;
  ratio: number;
}

export const bandOf = (vital: VitalKey, value: number | null | undefined): Band | null => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const t = VITAL_THRESHOLDS[vital];
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs";
  return "poor";
};

export const bandCounts = (n: number, good: number, poor: number): BandCounts => {
  const g = Math.max(0, Math.min(good, n));
  const p = Math.max(0, Math.min(poor, n - g));
  return { good: g, needs: n - g - p, poor: p };
};

// Largest-remainder rounding so the three shares always add to 100.
export const bandPercents = (c: BandCounts): BandCounts => {
  const total = c.good + c.needs + c.poor;
  if (!total) return { good: 0, needs: 0, poor: 0 };
  const raw = [c.good, c.needs, c.poor].map((x) => (x / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - floor[i] })).sort((a, b) => b.f - a.f);
  for (const { i } of order) {
    if (left <= 0) break;
    floor[i] += 1;
    left -= 1;
  }
  return { good: floor[0], needs: floor[1], poor: floor[2] };
};

export interface Verdict {
  pass: boolean;
  failing: VitalKey[];
  assessed: number;
}

// A vital with no data is not assessed; with nothing assessed there is no verdict to give.
export const verdictOf = (p75: Partial<Record<VitalKey, number | null>>): Verdict => {
  const failing: VitalKey[] = [];
  let assessed = 0;
  for (const k of VITAL_KEYS) {
    const band = bandOf(k, p75[k]);
    if (!band) continue;
    assessed += 1;
    if (band !== "good") failing.push(k);
  }
  return { pass: assessed > 0 && failing.length === 0, failing, assessed };
};

export const isLowData = (views: number): boolean => views < MIN_VIEWS;

export const deltaOf = (cur: number | null, prev: number | null): Delta | null => {
  if (cur === null || prev === null || Number.isNaN(cur) || Number.isNaN(prev)) return null;
  const abs = cur - prev;
  const pct = prev === 0 ? null : (abs / Math.abs(prev)) * 100;
  const eps = Math.abs(prev) * 0.005 || 1e-9;
  return { abs, pct, direction: Math.abs(abs) <= eps ? "flat" : abs > 0 ? "up" : "down" };
};

export const previousWindow = (
  startUs: number,
  endUs: number,
): { startUs: number; endUs: number } => {
  const len = Math.max(0, endUs - startUs);
  return { startUs: startUs - len, endUs: startUs };
};

// Impact is views with a poor or needs-work vital or an error, scaled so the worst page is 100.
export const impactScores = <T extends { bad: number }>(rows: T[]): number[] => {
  const max = Math.max(0, ...rows.map((r) => r.bad));
  return rows.map((r) => (max > 0 ? Math.round((r.bad / max) * 100) : 0));
};

export const rankPages = (rows: Omit<PageRow, "impact">[]): PageRow[] => {
  const kept = rows.filter((r) => r.views >= MIN_VIEWS);
  const scores = impactScores(kept);
  return kept
    .map((r, i) => ({ ...r, impact: scores[i] }))
    .sort((a, b) => b.impact - a.impact || b.views - a.views);
};

export const biggestDifference = (
  byDim: Partial<Record<SegmentDim, SegmentRow[]>>,
): BiggestDifference | null => {
  let best: BiggestDifference | null = null;
  for (const dim of Object.keys(byDim) as SegmentDim[]) {
    const rows = (byDim[dim] ?? []).filter((r) => r.inp !== null && r.views >= MIN_SEGMENT_VIEWS);
    for (const r of rows) {
      const others = rows.filter((o) => o !== r);
      const w = others.reduce((s, o) => s + o.views, 0);
      if (!w) continue;
      const base = others.reduce((s, o) => s + (o.inp as number) * o.views, 0) / w;
      if (!base) continue;
      const ratio = (r.inp as number) / base;
      if (ratio < MIN_DIFFERENCE_RATIO || bandOf("inp", r.inp) === "good") continue;
      if (!best || ratio > best.ratio) {
        best = {
          dim,
          label: r.label,
          filter: r.filter,
          views: r.views,
          inp: r.inp as number,
          ratio,
        };
      }
    }
  }
  return best;
};

export const toDisplay = (vital: VitalKey, raw: number | null | undefined): number | null =>
  raw === null || raw === undefined ? null : raw / VITAL_THRESHOLDS[vital].divisor;

export const NO_VALUE = "\u2014";

export const formatVital = (vital: VitalKey, raw: number | null | undefined): string => {
  const v = toDisplay(vital, raw);
  if (v === null) return NO_VALUE;
  if (vital === "lcp") return `${v.toFixed(v < 10 ? 2 : 1)} s`;
  if (vital === "inp") return `${Math.round(v)} ms`;
  return v.toFixed(2);
};

export const bucketInterval = (startUs: number, endUs: number): string => {
  const hours = (endUs - startUs) / 3.6e9;
  if (hours <= 2) return "5 minute";
  if (hours <= 12) return "30 minute";
  if (hours <= 48) return "1 hour";
  if (hours <= 24 * 14) return "6 hour";
  return "1 day";
};

const has = (ctx: QueryCtx, field: string): boolean => ctx.schema.has(field);

const schemaRecord = (schema: Set<string>): Record<string, boolean> =>
  Object.fromEntries([...schema].map((f) => [f, true]));

export const scopeWhere = (ctx: QueryCtx, extra?: string): string => {
  const parts: string[] = [];
  if (has(ctx, "source")) parts.push(BROWSER_SOURCE_WHERE);
  (["service", "env", "version"] as const).forEach((f) => {
    if (has(ctx, f) && ctx.filters[f].length) parts.push(sqlIn(f, ctx.filters[f]));
  });
  if (has(ctx, "session_type"))
    parts.push("(session_type IS NULL OR session_type <> 'synthetics')");
  if (extra) parts.push(extra);
  return parts.length ? parts.join(" AND ") : "1 = 1";
};

// A bare typed NULL keeps the output column name unique; MAX(NULL) twice collides on the server.
const agg = (
  ctx: QueryCtx,
  fn: "MAX" | "MIN",
  field: string,
  type: string,
  alias: string,
): string =>
  has(ctx, field) ? `${fn}(${field}) AS ${alias}` : `CAST(NULL AS ${type}) AS ${alias}`;

const viewAggs = (ctx: QueryCtx, extra: string[] = []): string =>
  [
    "view_id",
    agg(ctx, "MAX", VITAL_THRESHOLDS.lcp.column, "BIGINT", "lcp"),
    agg(ctx, "MAX", VITAL_THRESHOLDS.inp.column, "BIGINT", "inp"),
    agg(ctx, "MAX", VITAL_THRESHOLDS.cls.column, "DOUBLE", "cls"),
    ...extra,
  ].join(", ");

// 1 for rows in the current window, 0 for the previous one, so one scan serves both.
const windowFlag = (splitAtUs: number): string =>
  `CASE WHEN _timestamp >= ${Math.round(splitAtUs)} THEN 1 ELSE 0 END`;

// View events are cumulative updates, so each view_id collapses to its latest values first.
const viewsCte = (
  ctx: QueryCtx,
  extra: string[] = [],
  where?: string,
  splitAtUs?: number,
): string => {
  const w = splitAtUs === undefined ? null : windowFlag(splitAtUs);
  return `v AS (SELECT ${w ? `${w} AS w, ` : ""}${viewAggs(ctx, extra)} FROM "_rumdata" WHERE type = 'view' AND view_id IS NOT NULL AND ${scopeWhere(ctx, where)} GROUP BY view_id${w ? `, ${w}` : ""})`;
};

const pctAggs = (qs: Percentile[]): string[] =>
  VITAL_KEYS.flatMap((k) =>
    qs.map((q) => `approx_percentile_cont(${k}, ${PERCENTILE_Q[q]}) AS ${k}_${q}`),
  );

const bandAggs = (): string[] =>
  VITAL_KEYS.flatMap((k) => {
    const t = VITAL_THRESHOLDS[k];
    return [
      `COUNT(${k}) AS ${k}_n`,
      `COUNT(CASE WHEN ${k} <= ${t.good} THEN 1 END) AS ${k}_good`,
      `COUNT(CASE WHEN ${k} > ${t.poor} THEN 1 END) AS ${k}_poor`,
    ];
  });

// A view straddling the split counts in both windows, exactly as two separate window queries would.
export const vitalsSql = (ctx: QueryCtx, splitAtUs: number): string =>
  `WITH ${viewsCte(ctx, [], undefined, splitAtUs)} SELECT w, COUNT(*) AS views, ${[...pctAggs([...PERCENTILES]), ...bandAggs()].join(", ")} FROM v GROUP BY w ORDER BY w DESC LIMIT 2`;

const errorFlag = (ctx: QueryCtx): string => (has(ctx, "view_error_count") ? "ec > 0" : "FALSE");

export const badViewPredicate = (ctx: QueryCtx): string =>
  [
    `lcp > ${VITAL_THRESHOLDS.lcp.good}`,
    `inp > ${VITAL_THRESHOLDS.inp.good}`,
    `cls > ${VITAL_THRESHOLDS.cls.good}`,
    errorFlag(ctx),
  ].join(" OR ");

export const pagesSql = (ctx: QueryCtx): string => {
  const extra = [
    agg(ctx, "MIN", "view_url", "VARCHAR", "url"),
    agg(ctx, "MAX", "view_error_count", "BIGINT", "ec"),
    ...(has(ctx, "view_name") ? ["MIN(view_name) AS vn"] : []),
  ];
  const pg = pageKeyExpr("url", schemaRecord(ctx.schema), "vn");
  return (
    `WITH ${viewsCte(ctx, extra)}, p AS (SELECT *, ${pg} AS pg FROM v) ` +
    `SELECT pg, COUNT(*) AS views, approx_percentile_cont(lcp, 0.75) AS lcp, approx_percentile_cont(inp, 0.75) AS inp, ` +
    `approx_percentile_cont(cls, 0.75) AS cls, COALESCE(SUM(ec), 0) AS errors, ` +
    `COUNT(CASE WHEN ${badViewPredicate(ctx)} THEN 1 END) AS bad ` +
    `FROM p WHERE pg IS NOT NULL GROUP BY pg HAVING COUNT(*) >= ${MIN_VIEWS} ORDER BY bad DESC LIMIT ${MAX_PAGES}`
  );
};

export const segmentColumns = (ctx: QueryCtx, dim: SegmentDim): string[] =>
  SEGMENT_COLUMNS[dim].filter((c) => has(ctx, c));

export const segmentDims = (ctx: QueryCtx): SegmentDim[] =>
  SEGMENT_DIMS.filter((d) => segmentColumns(ctx, d).length);

const segAlias = (dimIndex: number, colIndex: number): string => `s${dimIndex}_${colIndex}`;

// Every dimension in one scan; GROUPING() tells which grouping set a row came from.
export const segmentsSql = (ctx: QueryCtx): string | null => {
  const dims = segmentDims(ctx);
  if (!dims.length) return null;
  const cols = dims.map((d, i) => segmentColumns(ctx, d).map((c, j) => [c, segAlias(i, j)]));
  const extra = cols.flat().map(([c, a]) => `MIN(${c}) AS ${a}`);
  const keys = cols.flat().map(([, a]) => a);
  const flags = dims.map((_, i) => `GROUPING(${segAlias(i, 0)}) AS g${i}`);
  const sets = cols.map((set) => `(${set.map(([, a]) => a).join(", ")})`).join(", ");
  return (
    `WITH ${viewsCte(ctx, extra)} SELECT ${[...keys, ...flags].join(", ")}, COUNT(*) AS views, ` +
    `approx_percentile_cont(inp, 0.75) AS inp, approx_percentile_cont(lcp, 0.75) AS lcp ` +
    `FROM v GROUP BY GROUPING SETS (${sets}) ORDER BY views DESC LIMIT 1000`
  );
};

// Per dimension, as d0/d1 rows for mapSegments; ties break by label so the top 8 is stable.
export const splitSegments = (
  ctx: QueryCtx,
  rows: Record<string, unknown>[],
): Partial<Record<SegmentDim, Record<string, unknown>[]>> => {
  const out: Partial<Record<SegmentDim, Record<string, unknown>[]>> = {};
  segmentDims(ctx).forEach((dim, i) => {
    const n = segmentColumns(ctx, dim).length;
    out[dim] = rows
      .filter((r) => toNum(r[`g${i}`]) === 0 && String(r[segAlias(i, 0)] ?? "") !== "")
      .map((r): Record<string, unknown> => ({
        ...Object.fromEntries(Array.from({ length: n }, (_, j) => [`d${j}`, r[segAlias(i, j)]])),
        views: r.views,
        inp: r.inp,
        lcp: r.lcp,
      }))
      .sort(
        (a, b) =>
          toNum(b.views) - toNum(a.views) ||
          `${a.d0} ${a.d1 ?? ""}`.localeCompare(`${b.d0} ${b.d1 ?? ""}`),
      )
      .slice(0, SEGMENT_TOP);
  });
  return out;
};

// Frustration rows may lack a session, so the session condition lives in each session aggregate, not the WHERE.
const kpiAggs = (ctx: QueryCtx): string[] => {
  const errId = has(ctx, "error_id") ? "error_id" : "CAST(NULL AS VARCHAR)";
  const errOf = "type = 'error' AND session_id IS NOT NULL";
  return [
    "COUNT(DISTINCT session_id) AS sessions",
    "COUNT(DISTINCT CASE WHEN type = 'error' THEN session_id END) AS err_sessions",
    `COUNT(DISTINCT CASE WHEN ${errOf} THEN ${errId} END) AS errors`,
    has(ctx, "error_handling")
      ? `COUNT(DISTINCT CASE WHEN ${errOf} AND error_handling = 'unhandled' THEN ${errId} END) AS unhandled`
      : "0 AS unhandled",
    ...(has(ctx, "action_frustration_type")
      ? [
          "COUNT(CASE WHEN type = 'action' AND strpos(action_frustration_type, 'rage_click') > 0 THEN 1 END) AS rage",
          "COUNT(CASE WHEN type = 'action' AND strpos(action_frustration_type, 'dead_click') > 0 THEN 1 END) AS dead",
        ]
      : []),
  ];
};

// Totals and frustration for both windows, plus per-version release sessions when withRelease, in one scan.
export const kpiSql = (ctx: QueryCtx, splitAtUs: number, withRelease: boolean): string => {
  const rel = withRelease && has(ctx, "version");
  const cols = [
    "_timestamp",
    "type",
    "session_id",
    ...["error_id", "error_handling", "action_frustration_type"].filter((c) => has(ctx, c)),
    ...(rel ? ["version"] : []),
  ];
  const aggs = [
    ...kpiAggs(ctx),
    ...(rel ? ["MIN(CASE WHEN session_id IS NOT NULL THEN _timestamp END) AS first_seen"] : []),
  ];
  return (
    `WITH e AS (SELECT ${windowFlag(splitAtUs)} AS w, ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeWhere(ctx)}) ` +
    (rel
      ? `SELECT w, version, GROUPING(version) AS gv, ${aggs.join(", ")} FROM e GROUP BY GROUPING SETS ((w), (w, version)) ORDER BY gv DESC, w DESC, first_seen DESC LIMIT 1000`
      : `SELECT w, ${aggs.join(", ")} FROM e GROUP BY w ORDER BY w DESC LIMIT 2`)
  );
};

// The whole-window row for w; a release query also returns per-version rows, which have gv = 0.
export const windowRow = (
  rows: Record<string, unknown>[],
  w: 0 | 1,
): Record<string, unknown> | undefined =>
  rows.find((r) => toNum(r.w) === w && (r.gv === undefined || toNum(r.gv) === 1));

// The two latest versions in the current window, as releaseSessionsSql would return them.
export const releaseRowsFromKpi = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
  rows
    .filter(
      (r) =>
        toNum(r.gv) === 0 &&
        toNum(r.w) === 1 &&
        String(r.version ?? "") !== "" &&
        r.first_seen !== null &&
        r.first_seen !== undefined,
    )
    .sort((a, b) => toNum(b.first_seen) - toNum(a.first_seen))
    .slice(0, 2);

export const seriesSql = (ctx: QueryCtx, interval: string): string => {
  const errId = has(ctx, "error_id") ? "error_id" : "CAST(NULL AS VARCHAR)";
  const handled = has(ctx, "error_handling")
    ? `COUNT(DISTINCT CASE WHEN type = 'error' AND error_handling = 'unhandled' THEN ${errId} END)`
    : "0";
  return (
    `SELECT histogram(_timestamp, ${sqlLiteral(interval)}) AS bucket, COUNT(DISTINCT session_id) AS sessions, ` +
    `COUNT(DISTINCT CASE WHEN type = 'error' THEN session_id END) AS err_sessions, ` +
    `COUNT(DISTINCT CASE WHEN type = 'error' THEN ${errId} END) AS errors, ${handled} AS unhandled ` +
    `FROM "_rumdata" WHERE session_id IS NOT NULL AND ${scopeWhere(ctx)} GROUP BY bucket ORDER BY bucket LIMIT 500`
  );
};

export const chartSql = (ctx: QueryCtx, interval: string): string => {
  const errId = has(ctx, "error_id") ? "error_id" : "CAST(NULL AS VARCHAR)";
  return (
    `SELECT histogram(_timestamp, ${sqlLiteral(interval)}) AS x_axis_1, COUNT(DISTINCT session_id) AS y_axis_1, ` +
    `COUNT(DISTINCT CASE WHEN type = 'error' THEN ${errId} END) AS y_axis_2 ` +
    `FROM "_rumdata" WHERE session_id IS NOT NULL AND ${scopeWhere(ctx)} GROUP BY x_axis_1 ORDER BY x_axis_1`
  );
};

// The panel key embeds its SQL, so the bucket step travels with the rows it produced.
export const intervalFromKey = (key: string | null | undefined): string | null =>
  /histogram\(_timestamp, '([^']+)'\)/.exec(key ?? "")?.[1] ?? null;

export const releaseSessionsSql = (ctx: QueryCtx): string | null =>
  has(ctx, "version")
    ? `SELECT version, MIN(_timestamp) AS first_seen, COUNT(DISTINCT session_id) AS sessions, ` +
      `COUNT(DISTINCT CASE WHEN type = 'error' THEN session_id END) AS err_sessions ` +
      `FROM "_rumdata" WHERE version IS NOT NULL AND version <> '' AND session_id IS NOT NULL AND ${scopeWhere({ ...ctx, filters: { ...ctx.filters, version: [] } })} ` +
      `GROUP BY version ORDER BY first_seen DESC LIMIT 2`
    : null;

export const releaseVitalsSql = (ctx: QueryCtx, versions: string[]): string | null =>
  has(ctx, "version") && versions.length
    ? `WITH ${viewsCte({ ...ctx, filters: { ...ctx.filters, version: [] } }, ["MIN(version) AS ver"], sqlIn("version", versions))} ` +
      `SELECT ver, COUNT(*) AS views, approx_percentile_cont(lcp, 0.75) AS lcp, approx_percentile_cont(inp, 0.75) AS inp FROM v GROUP BY ver LIMIT 2`
    : null;

export const releaseNewErrorsSql = (ctx: QueryCtx, cur: string, prev: string): string | null =>
  has(ctx, "version") && has(ctx, "error_message")
    ? `WITH e AS (SELECT substr(error_message, 1, 200) AS k, ` +
      `MAX(CASE WHEN version = ${sqlLiteral(cur)} THEN 1 ELSE 0 END) AS in_cur, ` +
      `MAX(CASE WHEN version = ${sqlLiteral(prev)} THEN 1 ELSE 0 END) AS in_prev ` +
      `FROM "_rumdata" WHERE type = 'error' AND error_message IS NOT NULL AND ${scopeWhere(
        { ...ctx, filters: { ...ctx.filters, version: [] } },
        sqlIn("version", [cur, prev]),
      )} GROUP BY k) ` +
      `SELECT COUNT(CASE WHEN in_cur = 1 AND in_prev = 0 THEN 1 END) AS new_errors FROM e LIMIT 1`
    : null;

export const filterOptionsSql = (schema: Set<string>): string | null => {
  const cols = ["service", "env", "version"].filter((c) => schema.has(c));
  const where = schema.has("source") ? ` WHERE ${BROWSER_SOURCE_WHERE}` : "";
  return cols.length
    ? `SELECT ${cols.join(", ")} FROM "_rumdata"${where} GROUP BY ${cols.join(", ")} LIMIT 500`
    : null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const toNum = (v: unknown): number => num(v) ?? 0;

export const mapVitals = (row: Record<string, unknown> | undefined) => {
  if (!row) return null;
  const views = toNum(row.views);
  const out: Record<string, unknown> = { views };
  for (const k of VITAL_KEYS) {
    out[k] = Object.fromEntries(PERCENTILES.map((p) => [p, num(row[`${k}_${p}`])]));
    out[`${k}Bands`] = bandCounts(
      toNum(row[`${k}_n`]),
      toNum(row[`${k}_good`]),
      toNum(row[`${k}_poor`]),
    );
  }
  return out as unknown as {
    views: number;
    lcp: Record<Percentile, number | null>;
    inp: Record<Percentile, number | null>;
    cls: Record<Percentile, number | null>;
    lcpBands: BandCounts;
    inpBands: BandCounts;
    clsBands: BandCounts;
  };
};

export type VitalsSummary = NonNullable<ReturnType<typeof mapVitals>>;

export const mapPages = (rows: Record<string, unknown>[]): PageRow[] =>
  rankPages(
    rows.map((r) => ({
      path: String(r.pg ?? ""),
      views: toNum(r.views),
      lcp: num(r.lcp),
      inp: num(r.inp),
      cls: num(r.cls),
      errors: toNum(r.errors),
      bad: toNum(r.bad),
    })),
  );

export const mapSegments = (
  dim: SegmentDim,
  cols: string[],
  rows: Record<string, unknown>[],
  windowViews?: number | null,
): SegmentRow[] => {
  // Only the top rows are returned, so their sum would overstate each share.
  const total = windowViews || rows.reduce((s, r) => s + toNum(r.views), 0);
  return rows.map((r) => {
    const parts = cols.map((_, i) => String(r[`d${i}`] ?? "").trim()).filter(Boolean);
    const filter =
      dim === "browser" && parts.length > 1
        ? `${cols[0]}=${sqlLiteral(parts[0])} AND ${cols[1]}=${sqlLiteral(parts[1])}`
        : `${cols[0]}=${sqlLiteral(parts[0] ?? "")}`;
    return {
      label: parts.join(" "),
      views: toNum(r.views),
      inp: num(r.inp),
      lcp: num(r.lcp),
      share: total ? Math.min(100, Math.round((toNum(r.views) / total) * 100)) : 0,
      filter,
    };
  });
};

// The substring prefilter only prunes; the normalised key decides, so /cart never matches /cartography.
export const pageFilter = (path: string, schema: Set<string>, column = "view_url"): string =>
  `${urlPrefilter(path, column)} AND ${pageKeyExpr(column, schemaRecord(schema))} = ${sqlLiteral(path)}`;

export const versionFilter = (version: string): string => `version=${sqlLiteral(version)}`;

export const andFilters = (...parts: (string | null | undefined)[]): string =>
  parts.filter(Boolean).join(" AND ");

export interface VitalDelta {
  kind: "faster" | "slower" | "lower" | "higher" | "none";
  text: string;
}

// Lower is better for every vital, so a negative change is an improvement; CLS is unitless, so it is lower/higher.
export const vitalDelta = (
  vital: VitalKey,
  cur: number | null | undefined,
  prev: number | null | undefined,
): VitalDelta | null => {
  const d = deltaOf(cur ?? null, prev ?? null);
  if (!d) return null;
  const text = formatVital(vital, Math.abs(d.abs));
  const zero = formatVital(vital, 0);
  if (d.direction === "flat" || text === zero) return { kind: "none", text: "" };
  const down = d.abs < 0;
  if (vital === "cls") return { kind: down ? "lower" : "higher", text };
  return { kind: down ? "faster" : "slower", text };
};

export interface KpiDelta {
  kind: "change" | "flat" | "new";
  text: string;
  tone: "good" | "bad" | "flat";
}

export const kpiDelta = (
  cur: number | null,
  prev: number | null,
  opts: { higherIsBetter: boolean; points?: boolean },
): KpiDelta | null => {
  const d = deltaOf(cur, prev);
  if (!d) return null;
  if (d.direction === "flat") return { kind: "flat", text: "", tone: "flat" };
  if (d.pct === null && !opts.points) return { kind: "new", text: "", tone: "flat" };
  const sign = d.abs > 0 ? "+" : "-";
  const multiple =
    (d.pct as number) > MAX_DELTA_PCT && prev ? `${Math.round((cur as number) / prev)}x` : null;
  const text = opts.points
    ? `${sign}${Math.abs(d.abs).toFixed(1)}`
    : (multiple ?? `${sign}${Math.round(Math.abs(d.pct as number))}%`);
  return { kind: "change", text, tone: d.abs > 0 === opts.higherIsBetter ? "good" : "bad" };
};

export const deltaSentenceKey = (d: KpiDelta, points: boolean): I18nKey =>
  d.kind === "flat"
    ? "rum.overviewPage.deltaFlat"
    : d.kind === "new"
      ? "rum.overviewPage.deltaNewMsg"
      : points
        ? "rum.overviewPage.deltaChangePts"
        : "rum.overviewPage.deltaChange";

export const formatCount = (n: number | null | undefined): string =>
  n === null || n === undefined ? NO_VALUE : n.toLocaleString();

export const formatPercent = (n: number | null | undefined): string =>
  n === null || n === undefined ? NO_VALUE : `${n.toFixed(1)}%`;

export const sparkValues = (
  series: { sessions: number; errSessions: number; errors: number; unhandled: number }[],
  pick: "sessions" | "errors" | "unhandled" | "errorFree",
): number[] =>
  series.map((p) =>
    pick === "errorFree"
      ? p.sessions
        ? ((p.sessions - p.errSessions) / p.sessions) * 100
        : 100
      : p[pick],
  );

// A version first seen at the start of the range, or in the first bucket, was live before it.
export const versionPredatesRange = (
  firstSeenUs: number,
  startUs: number,
  endUs: number,
  firstBucketUs: number | null,
  bucketUs: number,
): boolean => {
  const floor = Math.max(startUs + (endUs - startUs) * 0.05, (firstBucketUs ?? 0) + bucketUs);
  return firstSeenUs < floor;
};

// A previous window needs enough views (or sessions, without vitals) and a tenth of the current traffic, or its deltas mislead.
export const previousUsable = (
  prev: { views?: number | null; sessions?: number | null },
  cur: { views?: number | null; sessions?: number | null },
): boolean => {
  const byViews = prev.views !== null && prev.views !== undefined;
  const p = (byViews ? prev.views : prev.sessions) ?? 0;
  const c = (byViews ? cur.views : cur.sessions) ?? 0;
  return p >= MIN_VIEWS && p >= c * MIN_PREVIOUS_SHARE;
};

// Within deltaOf's flat tolerance, or equal once formatted, a release is unchanged rather than better or worse.
export const releaseTone = (
  cur: number | null,
  prev: number | null,
  higherIsBetter: boolean,
  shown?: { cur: string; prev: string },
): "better" | "worse" | "same" => {
  const d = deltaOf(cur, prev);
  if (!d || d.direction === "flat" || (shown && shown.cur === shown.prev)) return "same";
  return d.abs > 0 === higherIsBetter ? "better" : "worse";
};

// The bucket holding "now" is still filling, so drawing it would read as a drop.
export const dropOpenBucket = <T extends { ts: number }>(
  points: T[],
  stepUs: number,
  nowUs: number,
): T[] => {
  const last = points[points.length - 1];
  return last && stepUs > 0 && last.ts + stepUs > nowUs ? points.slice(0, -1) : points;
};

export const overThresholdPct = (c: BandCounts): number => {
  const p = bandPercents(c);
  return p.needs + p.poor;
};

const INTERVAL_UNIT_US: Record<string, number> = { minute: 6e7, hour: 3.6e9, day: 8.64e10 };

export const intervalMicros = (interval: string): number => {
  const [n, unit] = interval.split(" ");
  return Number(n) * (INTERVAL_UNIT_US[unit] ?? 0);
};

// A missing bucket means no traffic, so it is zero rather than a gap the line interpolates over.
export const fillBuckets = <T extends { ts: number }>(
  points: T[],
  stepUs: number,
  zero: (ts: number) => T,
  maxPoints = 1000,
): T[] => {
  if (points.length < 2 || stepUs <= 0) return points;
  const byTs = new Map(points.map((p) => [p.ts, p]));
  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  if ((last - first) / stepUs + 1 > maxPoints) return points;
  if (points.some((p) => (p.ts - first) % stepUs !== 0)) return points;
  const out: T[] = [];
  for (let ts = first; ts <= last; ts += stepUs) out.push(byTs.get(ts) ?? zero(ts));
  return out;
};

export interface PickerRange {
  valueType?: string;
  relativeTimePeriod?: string | null;
}

// A relative picker keeps `period` so the target page re-resolves "last 24 hours" itself.
const timeQuery = (
  range: { startUs: number; endUs: number } | null,
  picker?: PickerRange | null,
): Record<string, string> => {
  if (picker?.valueType === "relative" && picker.relativeTimePeriod) {
    return { period: picker.relativeTimePeriod };
  }
  return range ? { from: String(range.startUs), to: String(range.endUs) } : {};
};

export const drillQuery = (o: {
  org: string;
  filter: string;
  scope: string;
  range: { startUs: number; endUs: number } | null;
  picker?: PickerRange | null;
  extra?: Record<string, string>;
  encode: (sql: string) => string | null;
}): Record<string, string> => {
  const where = andFilters(o.filter, o.scope === "1 = 1" ? null : o.scope);
  return {
    org_identifier: o.org,
    ...(where ? { query: o.encode(where) ?? "" } : {}),
    ...o.extra,
    ...timeQuery(o.range, o.picker),
  };
};

// Product Analytics resolves the range from the same period or from/to keys.
export const analyticsQuery = (o: {
  org: string;
  range: { startUs: number; endUs: number } | null;
  picker?: PickerRange | null;
}): Record<string, string> => ({ org_identifier: o.org, ...timeQuery(o.range, o.picker) });

const QUERY_KEYS = {
  service: "ov_service",
  env: "ov_env",
  version: "ov_version",
  percentile: "ov_pct",
} as const;

type QueryValue = string | null | (string | null)[] | undefined;

const asList = (v: QueryValue): string[] =>
  (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x !== "");

export const stateFromQuery = (
  query: Record<string, QueryValue>,
): { filters: OverviewFilters; percentile: Percentile } => {
  const pct = asList(query[QUERY_KEYS.percentile])[0];
  return {
    filters: {
      service: asList(query[QUERY_KEYS.service]),
      env: asList(query[QUERY_KEYS.env]),
      version: asList(query[QUERY_KEYS.version]),
    },
    percentile: PERCENTILES.includes(pct as Percentile) ? (pct as Percentile) : "p75",
  };
};

// Empty selections are omitted, and p75 is the default, so a plain page keeps a plain URL.
export const queryFromState = (
  filters: OverviewFilters,
  percentile: Percentile,
): Record<string, string | string[]> => ({
  ...(filters.service.length ? { [QUERY_KEYS.service]: filters.service } : {}),
  ...(filters.env.length ? { [QUERY_KEYS.env]: filters.env } : {}),
  ...(filters.version.length ? { [QUERY_KEYS.version]: filters.version } : {}),
  ...(percentile !== "p75" ? { [QUERY_KEYS.percentile]: percentile } : {}),
});

export const withoutOverviewState = <T extends Record<string, unknown>>(query: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(query).filter(([k]) => !Object.values(QUERY_KEYS).includes(k as never)),
  ) as Partial<T>;

// The Performance page rebuilds its query on a range or refresh change, so the overview's own keys are carried over.
export const overviewStateOnly = <T extends Record<string, unknown>>(query: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(query).filter(([k]) => Object.values(QUERY_KEYS).includes(k as never)),
  ) as Partial<T>;

export const formatInZone = (ms: number, timeZone?: string, locale?: string): string => {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Date(ms).toLocaleString(locale, { ...opts, timeZone });
  } catch {
    return new Date(ms).toLocaleString(locale, opts);
  }
};
