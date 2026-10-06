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

import { getTimezoneOffset } from "date-fns-tz";
import { sqlIn, sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import type {
  NamedActionRule,
  NamedEvent,
  NamedEventRule,
} from "@/utils/rum/productAnalyticsModel";

export type StepKind = "p" | "c" | "e";
export interface StepRef {
  kind: StepKind;
  key: string;
}
export type IdentityField = "usr_id" | "usr_email" | "usr_anonymous_id";
export interface AnalyticsScope {
  app: string;
  env: string[];
  version: string[];
  schema: Record<string, boolean>;
}
export interface IdentitySql {
  field: IdentityField;
  excluded: string[];
}
export type FunnelUnit = "sessions" | "users";
export type FunnelWindow = "session" | "1h" | "1d" | "7d";
export type BreakdownDim = "browser" | "os" | "device" | "country" | "version" | "env";
export interface FunnelDef {
  steps: StepRef[];
  unit: FunnelUnit;
  window: FunnelWindow;
  breakdown: BreakdownDim | null;
}
export interface FunnelCohort {
  funnel: FunnelDef;
  stepIndex: number;
  side: "dropped";
}
export type PathsInclude = "all" | "pages" | "clicks";
export interface PathsDef {
  anchor: StepRef | null;
  direction: "next" | "prev";
  depth: number;
  include: PathsInclude;
  cohort: FunnelCohort | null;
}
export type Granularity = "auto" | "day" | "week" | "month";
export type RetentionMode = "on" | "after";
export interface RetentionDef {
  start: StepRef | null;
  ret: StepRef | null;
  per: Granularity;
  mode: RetentionMode;
}
export type SampleRatio = 1 | 2 | 4 | 8 | 16;
export interface BuildOpts {
  events: NamedEvent[];
  sample: SampleRatio;
}
export interface RegexPass {
  pattern: string;
  replacement: string;
  global: boolean;
}

export const IDENTITY_FIELDS: readonly IdentityField[] = [
  "usr_id",
  "usr_email",
  "usr_anonymous_id",
];
export const WINDOW_MS: Readonly<Record<Exclude<FunnelWindow, "session">, number>> = {
  "1h": 3600000,
  "1d": 86400000,
  "7d": 604800000,
};
export const DIMENSIONS: Readonly<Record<BreakdownDim, string>> = {
  browser: "user_agent_user_agent_family",
  os: "user_agent_os_family",
  device: "user_agent_device_family",
  country: "geo_info_country",
  version: "version",
  env: "env",
};
export const SAMPLE_CHARS = "0123456789abcdef" as const;
export const MAX_FUNNEL_STEPS = 10;
export const PAGE_LIMIT = 200;
const DAY_US = 86400000000;
const WHOLE = "ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING";
const ROOT_URL_RE = "^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*/?(?:[?#].*)?$";
const hrExpr = (scope: AnalyticsScope): string =>
  has(scope, "session_has_replay")
    ? "MAX(CASE WHEN session_has_replay IS NOT NULL THEN 1 ELSE 0 END) AS hr"
    : "0 AS hr";
const ID_HEAD = String.raw`[0-9]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{16,}`;
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+){2,}";
const ID_TAIL = [
  "[^/#]*(?:@|%40)[^/#]*",
  ...Array.from({ length: 20 }, (_, k) => `[A-Za-z_.=%-]{${k}}[0-9][A-Za-z0-9_.=%-]{${19 - k},}`),
].join("|");
const SEGMENT_PASSES: RegexPass[] = [
  {
    pattern: `/(?:${ID_HEAD}|(${SLUG})|${ID_TAIL})(/|#|$)`,
    replacement: String.raw`/\1 \2`,
    global: true,
  },
  { pattern: "/ ", replacement: "/:id", global: true },
  { pattern: " ", replacement: "", global: true },
];
export const PAGE_KEY_PASSES: readonly RegexPass[] = [
  { pattern: "^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*", replacement: "", global: false },
  {
    pattern: String.raw`^([^?#]*)(?:\?[^#]*)?(?:#!?(/[^?#]*))?.*$`,
    replacement: String.raw`\1#\2`,
    global: false,
  },
  ...SEGMENT_PASSES,
  ...SEGMENT_PASSES,
  { pattern: "#/?$", replacement: "", global: false },
  { pattern: "(.)/+$", replacement: String.raw`\1`, global: false },
];
export const CLICK_KEY_PASSES: readonly RegexPass[] = [
  { pattern: String.raw`[^\s]*(?:@|%40)[^\s]*`, replacement: ":email", global: true },
  {
    pattern: String.raw`eyJ[A-Za-z0-9_=-]+(?:\.[A-Za-z0-9_=-]+)*`,
    replacement: ":token",
    global: true,
  },
  {
    pattern:
      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{16,}",
    replacement: ":id",
    global: true,
  },
  { pattern: "[0-9]{6,}", replacement: ":num", global: true },
];

const lit = (value: unknown): string => sqlLiteral(value);

const lits = (values: readonly unknown[]): string => values.map(lit).join(", ");

// histogram()'s optional 3rd (timezone) argument buckets by *local* calendar
// day/week — but per its own contract, each bucket edge comes back as local
// wall-clock time stamped as if it were UTC, not as a true UTC instant
// (o2-enterprise#2808). The shared chart renderer (sqlTimeSeriesConverter)
// always treats a histogram() x-axis as true UTC and shifts it once more for
// display, so left as-is the viewer's offset gets applied twice: every point
// lands later than it should, and the earliest bucket can shift past the
// query's start and disappear. Undo the backend's wall-clock shift by
// subtracting the same offset back out, so what reaches the renderer is a
// genuine UTC instant — like every other dashboard panel's x-axis — while the
// bucket boundaries themselves stay aligned to the viewer's local day.
const histogramLocalBucketExpr = (
  interval: "1 day" | "1 week",
  tz: string,
  referenceUs: number,
): string => {
  const raw = `histogram(_timestamp, ${lit(interval === "1 week" ? "1 week" : "1 day")}, ${lit(tz)})`;
  let offsetMs = 0;
  try {
    offsetMs = getTimezoneOffset(tz, referenceUs / 1000);
  } catch {
    offsetMs = 0;
  }
  const offsetSeconds = Math.round(offsetMs / 1000);
  if (!offsetSeconds) return raw;
  const op = offsetSeconds > 0 ? "-" : "+";
  return `(${raw} ${op} INTERVAL '${Math.abs(offsetSeconds)} SECOND')`;
};

const has = (scope: AnalyticsScope, field: string): boolean => scope.schema[field] === true;

// action_target_name only exists once an action event is ingested, so every reference needs a fallback.
const atnCol = (scope: AnalyticsScope): string =>
  has(scope, "action_target_name")
    ? "MIN(action_target_name) AS atn"
    : "CAST(NULL AS VARCHAR) AS atn";
const atnRawRef = (scope: AnalyticsScope): string =>
  has(scope, "action_target_name") ? "action_target_name" : "CAST(NULL AS VARCHAR)";
const actionClickExpr = (scope: AnalyticsScope): string =>
  has(scope, "action_target_name") ? "(type = 'action' AND action_target_name <> '')" : "FALSE";
const actionClickAnd = (scope: AnalyticsScope): string =>
  has(scope, "action_target_name") ? "type = 'action' AND action_target_name <> ''" : "FALSE";
const pathsIncludeExpr = (scope: AnalyticsScope, include: PathsInclude): string => {
  if (include === "pages") return "type = 'view'";
  if (!has(scope, "action_target_name")) return include === "clicks" ? "FALSE" : "type = 'view'";
  return include === "clicks"
    ? "(type = 'action' AND action_target_name <> '')"
    : "(type = 'view' OR (type = 'action' AND action_target_name <> ''))";
};

const passSql = (x: string, p: RegexPass): string =>
  `regexp_replace(${x}, '${p.pattern}', '${p.replacement}'${p.global ? ", 'g'" : ""})`;

export function pageKeyExpr(
  col: string,
  schema: Record<string, boolean>,
  viewNameCol: string = "view_name",
): string {
  const x = PAGE_KEY_PASSES.reduce(passSql, col);
  const fallback =
    schema.view_name === true ? `NULLIF(${viewNameCol}, '')` : "CAST(NULL AS VARCHAR)";
  return `CASE WHEN ${col} IS NULL OR ${col} = '' THEN ${fallback} ELSE COALESCE(NULLIF(${x}, ''), '/') END`;
}

export function clickKeyExpr(col: string): string {
  return CLICK_KEY_PASSES.reduce(passSql, col);
}

export function urlPrefilter(key: string, col: string): string {
  if (key === "/")
    return `(${col} IS NULL OR ${col} = '' OR regexp_like(${col}, '${ROOT_URL_RE}'))`;
  if (!key.startsWith("/")) return `(${col} IS NULL OR ${col} = '')`;
  const parts = key.split(/:id|#!?/).filter((p) => p && p !== "/");
  if (!parts.length) return "TRUE";
  return `(${parts.map((p) => `strpos(${col}, ${lit(p)}) > 0`).join(" AND ")})`;
}

// A prefix's text before its first template marker appears verbatim in every matching URL.
const prefixPrefilter = (prefix: string, col: string): string | null => {
  if (!prefix.startsWith("/")) return null;
  const head = prefix.split(/[:#]/)[0];
  return head.length > 1 ? `(strpos(${col}, ${lit(head)}) > 0)` : null;
};

export function samplePredicate(expr: string, sample: SampleRatio): string {
  return `substr(md5(${expr}), 1, 1) IN (${lits(SAMPLE_CHARS.slice(0, 16 / sample).split(""))})`;
}

export function scopeClause(scope: AnalyticsScope, sample: SampleRatio = 1): string {
  const parts = [`application_id = ${lit(scope.app)}`, "session_id IS NOT NULL"];
  if (has(scope, "env") && scope.env.length) parts.push(sqlIn("env", scope.env));
  if (has(scope, "version") && scope.version.length) parts.push(sqlIn("version", scope.version));
  if (has(scope, "session_type"))
    parts.push("(session_type IS NULL OR session_type <> 'synthetics')");
  if (sample > 1) parts.push(samplePredicate("session_id", sample));
  return parts.join(" AND ");
}

export function identityExpr(id: IdentitySql): string {
  if (!IDENTITY_FIELDS.includes(id.field)) throw new Error(`Unknown identity field ${id.field}`);
  const u = `NULLIF(${id.field}, '')`;
  return id.excluded.length
    ? `CASE WHEN ${u} IN (${lits(id.excluded)}) THEN NULL ELSE ${u} END`
    : u;
}

const findEvent = (id: string, events: readonly NamedEvent[]): NamedEvent | undefined =>
  events.find((e) => e.id === id);

const rawRule = (rule: NamedEventRule | NamedActionRule, scope: AnalyticsScope): string => {
  const pk = pageKeyExpr("view_url", scope.schema);
  if (rule.t === "action") {
    if (!has(scope, "action_target_name")) return "(1 = 0)";
    const onPage = rule.onPage ? ` AND ${pk} = ${lit(rule.onPage)}` : "";
    return `(type = 'action' AND action_target_name <> '' AND ${clickKeyExpr("action_target_name")} IN (${lits(rule.targets)})${onPage})`;
  }
  if (rule.op === "eq") return stepPredicateRaw({ kind: "p", key: rule.value }, scope, []);
  if (rule.op === "prefix") {
    const pf = prefixPrefilter(rule.value, "view_url");
    return `(type = 'view' AND ${pf ? `${pf} AND ` : ""}starts_with(${pk}, ${lit(rule.value)}))`;
  }
  return `(type = 'view' AND regexp_like(${pk}, ${lit(rule.value)}))`;
};

const groupedRule = (rule: NamedEventRule | NamedActionRule, scope: AnalyticsScope): string => {
  if (rule.t === "action") {
    const onPage = rule.onPage
      ? ` AND ${pageKeyExpr("url", scope.schema, "vn")} = ${lit(rule.onPage)}`
      : "";
    return `(ty = 'action' AND k IN (${lits(rule.targets)})${onPage})`;
  }
  if (rule.op === "eq") return `(ty = 'view' AND k = ${lit(rule.value)})`;
  if (rule.op === "prefix") return `(ty = 'view' AND starts_with(k, ${lit(rule.value)}))`;
  return `(ty = 'view' AND regexp_like(k, ${lit(rule.value)}))`;
};

export function stepPredicateRaw(
  step: StepRef,
  scope: AnalyticsScope,
  events: NamedEvent[],
): string {
  if (step.kind === "p") {
    return `(type = 'view' AND ${urlPrefilter(step.key, "view_url")} AND ${pageKeyExpr("view_url", scope.schema)} = ${lit(step.key)})`;
  }
  if (step.kind === "c") {
    if (!has(scope, "action_target_name")) return "(1 = 0)";
    return `(type = 'action' AND action_target_name <> '' AND ${clickKeyExpr("action_target_name")} = ${lit(step.key)})`;
  }
  const ev = findEvent(step.key, events);
  if (!ev) return "(1 = 0)";
  return `(${ev.rules.map((r) => rawRule(r, scope)).join(" OR ")})`;
}

export function stepPredicateGrouped(
  step: StepRef,
  scope: AnalyticsScope,
  events: NamedEvent[],
): string {
  if (step.kind === "p") return `ty = 'view' AND k = ${lit(step.key)}`;
  if (step.kind === "c") return `ty = 'action' AND k = ${lit(step.key)}`;
  const ev = findEvent(step.key, events);
  if (!ev) return "1 = 0";
  return `(${ev.rules.map((r) => groupedRule(r, scope)).join(" OR ")})`;
}

// Removes string literals first, so a click key such as 'Join us' cannot trip the structural checks.
export function assertJoinFree(sql: string): void {
  const bare = sql.replace(/'(?:[^']|'')*'/g, "''");
  const scans = bare.split('FROM "_rumdata"').length - 1;
  if (scans !== 1) throw new Error(`Analytics SQL must read _rumdata exactly once, found ${scans}`);
  for (const re of [/\bJOIN\b/i, /\bIN\s*\(\s*SELECT/i, /\bEXISTS\b/i, /\bUNION\b/i]) {
    if (re.test(bare)) throw new Error(`Analytics SQL must be join-free: ${re}`);
  }
}

const withCtes = (ctes: string[], tail: string): string => `WITH ${ctes.join(",\n")}\n${tail}`;

const presentCandidates = (scope: AnalyticsScope): IdentityField[] =>
  IDENTITY_FIELDS.filter((f) => has(scope, f));

// Q3 counts synthetic sessions, so its filter omits the synthetics exclusion that every other builder applies.
const unfilteredScope = (scope: AnalyticsScope): string => {
  const parts = [`application_id = ${lit(scope.app)}`, "session_id IS NOT NULL"];
  if (has(scope, "env") && scope.env.length) parts.push(sqlIn("env", scope.env));
  if (has(scope, "version") && scope.version.length) parts.push(sqlIn("version", scope.version));
  return parts.join(" AND ");
};

export function appProbeSql(): string {
  return `SELECT application_id AS app, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE application_id IS NOT NULL AND application_id <> '' AND session_id IS NOT NULL GROUP BY application_id ORDER BY sessions DESC LIMIT 100`;
}

export function facetOptionsSql(scope: AnalyticsScope, field: "env" | "version"): string {
  const f = field === "env" ? "env" : "version";
  return `SELECT ${f} AS value, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE application_id = ${lit(scope.app)} AND session_id IS NOT NULL AND ${f} IS NOT NULL AND ${f} <> '' GROUP BY ${f} ORDER BY sessions DESC LIMIT 100`;
}

export function summarySql(scope: AnalyticsScope, currentStartUs: number): string {
  const cs = Math.trunc(currentStartUs);
  const synthetic = has(scope, "session_type")
    ? `COUNT(DISTINCT CASE WHEN _timestamp >= ${cs} AND session_type = 'synthetics' THEN session_id END) AS synthetic_sessions`
    : "0 AS synthetic_sessions";
  const cols = [
    `COUNT(DISTINCT CASE WHEN _timestamp >= ${cs} THEN session_id END) AS sessions`,
    `COUNT(DISTINCT CASE WHEN _timestamp < ${cs} THEN session_id END) AS prev_sessions`,
    `COUNT(DISTINCT CASE WHEN _timestamp >= ${cs} AND type = 'view' THEN view_id END) AS views`,
    `COUNT(CASE WHEN _timestamp >= ${cs} AND type IN ('view', 'action') THEN 1 END) AS va_rows`,
    synthetic,
    "MAX(_timestamp) AS data_through_us",
  ];
  for (const f of presentCandidates(scope)) {
    cols.push(
      `COUNT(DISTINCT CASE WHEN _timestamp >= ${cs} THEN NULLIF(${f}, '') END) AS ${f}__values`,
    );
    cols.push(
      `COUNT(DISTINCT CASE WHEN _timestamp >= ${cs} AND NULLIF(${f}, '') IS NOT NULL THEN session_id END) AS ${f}__sessions`,
    );
  }
  return `SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${unfilteredScope(scope)} LIMIT 1`;
}

export function identityTopSql(scope: AnalyticsScope, field: IdentityField): string {
  const u = identityExpr({ field, excluded: [] });
  return withCtes(
    [
      `v AS (SELECT ${u} AS u, COUNT(DISTINCT session_id) AS s FROM "_rumdata" WHERE ${scopeClause(scope)} AND type IN ('view','action') AND ${u} IS NOT NULL GROUP BY ${u})`,
      "r AS (SELECT u, s, SUM(s) OVER () AS total_s, COUNT(*) OVER () AS n_values FROM v)",
    ],
    "SELECT u, s, total_s, n_values FROM r ORDER BY s DESC, u LIMIT 3",
  );
}

const cur = (cs: number) => `CASE WHEN _timestamp >= ${Math.trunc(cs)} THEN 1 ELSE 0 END`;

const identityGroupCols = (id: IdentitySql): string[] => {
  const u = identityExpr(id);
  return [
    `first_value(${u} ORDER BY CASE WHEN ${u} IS NULL THEN 1 ELSE 0 END, date) AS u0`,
    `MIN(CASE WHEN ${u} IS NOT NULL THEN date END) AS ut`,
  ];
};

const UID_WINDOW =
  "FIRST_VALUE(u0) OVER (PARTITION BY sid ORDER BY CASE WHEN u0 IS NULL THEN 1 ELSE 0 END, ut)";

export function entryExitSql(
  scope: AnalyticsScope,
  currentStartUs: number,
  id: IdentitySql | null,
): string {
  const cs = Math.trunc(currentStartUs);
  // One session is one entry, in its first view's window, and one exit, in its last view's window.
  const cols = [
    "session_id AS sid",
    `CASE WHEN MIN(CASE WHEN type = 'view' THEN _timestamp END) >= ${cs} THEN 1 ELSE 0 END AS ce`,
    `CASE WHEN MAX(CASE WHEN type = 'view' THEN _timestamp END) >= ${cs} THEN 1 ELSE 0 END AS cx`,
    "substr(MIN(CASE WHEN type = 'view' THEN CAST(date AS VARCHAR) || view_url END), 14) AS fu",
    "substr(MAX(CASE WHEN type = 'view' THEN CAST(date AS VARCHAR) || view_url END), 14) AS lu",
    "MAX(CASE WHEN type = 'view' THEN 1 ELSE 0 END) AS hv",
    ...(has(scope, "view_name")
      ? [
          "substr(MIN(CASE WHEN type = 'view' THEN CAST(date AS VARCHAR) || view_name END), 14) AS fvn",
          "substr(MAX(CASE WHEN type = 'view' THEN CAST(date AS VARCHAR) || view_name END), 14) AS lvn",
        ]
      : []),
  ];
  let extra = "";
  if (id) {
    const u = identityExpr(id);
    cols.push(`first_value(${u} ORDER BY CASE WHEN ${u} IS NULL THEN 1 ELSE 0 END, date) AS u`);
    extra = ` OR ${u} IS NOT NULL`;
  }
  const agg: string[] = [];
  for (const [side, n] of [
    ["entry", 1],
    ["exit", 2],
  ] as const) {
    agg.push(`COUNT(CASE WHEN cur = 1 AND side = ${n} THEN 1 END) AS ${side}_sessions`);
    agg.push(`COUNT(CASE WHEN cur = 0 AND side = ${n} THEN 1 END) AS prev_${side}_sessions`);
    if (id) {
      agg.push(`COUNT(DISTINCT CASE WHEN cur = 1 AND side = ${n} THEN u END) AS ${side}_users`);
      agg.push(
        `COUNT(DISTINCT CASE WHEN cur = 0 AND side = ${n} THEN u END) AS prev_${side}_users`,
      );
    }
  }
  return withCtes(
    [
      `s0 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (type = 'view'${extra}) GROUP BY session_id)`,
      `s1 AS (SELECT sid${id ? ", u" : ""}, unnest(make_array(ce, cx)) AS cur, unnest(make_array(${pageKeyExpr("fu", scope.schema, "fvn")}, ${pageKeyExpr("lu", scope.schema, "lvn")})) AS k, unnest(make_array(1, 2)) AS side FROM s0 WHERE hv = 1)`,
      `g AS (SELECT k, ${agg.join(", ")} FROM s1 WHERE k IS NOT NULL GROUP BY k)`,
    ],
    "SELECT *, entry_sessions + exit_sessions + prev_entry_sessions + prev_exit_sessions AS rank_key FROM g ORDER BY rank_key DESC, k LIMIT 1000",
  );
}

export function stepPickerSql(scope: AnalyticsScope, term?: string): string {
  const filter = term ? ` AND strpos(lower(k), ${lit(term.toLowerCase())}) > 0` : "";
  const groupKey = has(scope, "action_target_name") ? "action_target_name" : actionKey(scope);
  return withCtes(
    [
      `e0 AS (SELECT session_id AS sid, type AS ty, MIN(view_url) AS url, ${atnCol(scope)}${has(scope, "view_name") ? ", MIN(view_name) AS vn" : ""} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (type = 'view' OR ${actionClickExpr(scope)}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id ELSE ${groupKey} END)`,
      `e AS (SELECT sid, CASE WHEN ty = 'view' THEN 'p' ELSE 'c' END AS kind, CASE WHEN ty = 'view' THEN ${pageKeyExpr("url", scope.schema, "vn")} ELSE ${clickKeyExpr("atn")} END AS k FROM e0)`,
    ],
    `SELECT kind, k, COUNT(DISTINCT sid) AS sessions FROM e WHERE k IS NOT NULL AND k <> ''${filter} GROUP BY kind, k ORDER BY sessions DESC, kind, k LIMIT ${term ? 50 : 200}`,
  );
}

const RANK_KEY =
  "CASE WHEN sessions > prev_sessions THEN sessions ELSE prev_sessions END AS rank_key";

export function pagesSql(
  scope: AnalyticsScope,
  currentStartUs: number,
  id: IdentitySql | null,
): string {
  const c = cur(currentStartUs);
  const cols = [
    "session_id AS sid",
    "type AS ty",
    `${c} AS cur`,
    "MIN(CASE WHEN type = 'view' THEN view_id END) AS vid",
    "MIN(CASE WHEN type = 'view' THEN view_url END) AS url",
    ...(has(scope, "view_name") ? ["MIN(CASE WHEN type = 'view' THEN view_name END) AS vn"] : []),
    ...(id ? identityGroupCols(id) : []),
  ];
  const extra = id ? ` OR ${identityExpr(id)} IS NOT NULL` : "";
  const agg = [
    "COUNT(DISTINCT CASE WHEN cur = 1 THEN sid END) AS sessions",
    "COUNT(DISTINCT CASE WHEN cur = 0 THEN sid END) AS prev_sessions",
    "COUNT(DISTINCT CASE WHEN cur = 1 THEN vid END) AS views",
    "COUNT(DISTINCT CASE WHEN cur = 0 THEN vid END) AS prev_views",
    ...(id
      ? [
          "COUNT(DISTINCT CASE WHEN cur = 1 THEN u END) AS users",
          "COUNT(DISTINCT CASE WHEN cur = 0 THEN u END) AS prev_users",
        ]
      : []),
  ];
  return withCtes(
    [
      `v0 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (type = 'view'${extra}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id END, ${c})`,
      `v1 AS (SELECT sid, ty, cur, vid, url${has(scope, "view_name") ? ", vn" : ""}${id ? `, ${UID_WINDOW} AS u` : ""} FROM v0)`,
      `v AS (SELECT ${pageKeyExpr("url", scope.schema, "vn")} AS k, sid, cur, vid${id ? ", u" : ""} FROM v1 WHERE ty = 'view')`,
      `g AS (SELECT k, ${agg.join(", ")} FROM v WHERE k IS NOT NULL GROUP BY k)`,
    ],
    `SELECT *, ${RANK_KEY} FROM g ORDER BY rank_key DESC, k LIMIT 500`,
  );
}

export function clicksSql(
  scope: AnalyticsScope,
  currentStartUs: number,
  id: IdentitySql | null,
): string {
  const c = `_timestamp >= ${Math.trunc(currentStartUs)}`;
  const ck = clickKeyExpr(atnRawRef(scope));
  const cols = [
    `${ck} AS k`,
    `COUNT(DISTINCT CASE WHEN ${c} THEN session_id END) AS sessions`,
    `COUNT(DISTINCT CASE WHEN NOT (${c}) THEN session_id END) AS prev_sessions`,
    `COUNT(CASE WHEN ${c} THEN 1 END) AS clicks`,
    `COUNT(CASE WHEN NOT (${c}) THEN 1 END) AS prev_clicks`,
  ];
  if (id) {
    const u = identityExpr(id);
    cols.push(`COUNT(DISTINCT CASE WHEN ${c} THEN ${u} END) AS users`);
    cols.push(`COUNT(DISTINCT CASE WHEN NOT (${c}) THEN ${u} END) AS prev_users`);
  }
  return withCtes(
    [
      `g AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND ${actionClickAnd(scope)} GROUP BY ${ck})`,
    ],
    `SELECT *, ${RANK_KEY} FROM g WHERE k <> '' ORDER BY rank_key DESC, k LIMIT 500`,
  );
}

export function clickPagesSql(
  scope: AnalyticsScope,
  currentStartUs: number,
  keys: string[],
): string {
  const ck = clickKeyExpr(atnRawRef(scope));
  const pk = pageKeyExpr("view_url", scope.schema);
  return `SELECT ${ck} AS k, ${pk} AS pg, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE ${scopeClause(scope)} AND _timestamp >= ${Math.trunc(currentStartUs)} AND ${actionClickAnd(scope)} AND ${ck} IN (${lits(keys)}) GROUP BY ${ck}, ${pk} ORDER BY sessions DESC, k, pg LIMIT 2000`;
}

export function trendSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  interval: "1 day" | "1 week",
  tz: string,
  referenceUs: number,
  series: StepRef[],
  events: NamedEvent[],
): string {
  const bucket = `${histogramLocalBucketExpr(interval, tz, referenceUs)} AS x_axis_1`;
  const tail = "GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 1000";
  if (!series.length) {
    const users = id
      ? `, COUNT(DISTINCT CASE WHEN type IN ('view', 'action') THEN ${identityExpr(id)} END) AS y_axis_2`
      : "";
    return `SELECT ${bucket}, COUNT(DISTINCT session_id) AS y_axis_1${users} FROM "_rumdata" WHERE ${scopeClause(scope)} AND type IN ('view', 'action') ${tail}`;
  }
  const preds = series.slice(0, 5).map((s) => stepPredicateRaw(s, scope, events));
  const ys = preds.map(
    (p, i) => `COUNT(DISTINCT CASE WHEN ${p} THEN session_id END) AS y_axis_${i + 1}`,
  );
  return `SELECT ${bucket}, ${ys.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (${preds.join(" OR ")}) ${tail}`;
}

export function activeUsersSql(scope: AnalyticsScope, id: IdentitySql, endUs: number): string {
  const u = identityExpr(id);
  const end = Math.trunc(endUs);
  return `SELECT COUNT(DISTINCT CASE WHEN _timestamp >= ${end - DAY_US} THEN ${u} END) AS dau, COUNT(DISTINCT CASE WHEN _timestamp >= ${end - 7 * DAY_US} THEN ${u} END) AS wau, COUNT(DISTINCT ${u}) AS mau FROM "_rumdata" WHERE ${scopeClause(scope)} AND type IN ('view', 'action') AND ${u} IS NOT NULL LIMIT 1`;
}

const actionKey = (scope: AnalyticsScope): string =>
  has(scope, "action_id") ? "COALESCE(action_id, CAST(date AS VARCHAR))" : "CAST(date AS VARCHAR)";

const unique = (items: string[]): string[] => [...new Set(items)];

const stepEvents = (steps: StepRef[], events: NamedEvent[]): NamedEvent[] =>
  steps.flatMap((s) =>
    s.kind === "e" ? [findEvent(s.key, events)].filter((e): e is NamedEvent => !!e) : [],
  );

// An on-page action rule compares the page key of the action's own URL, so the grouped rows must keep it.
const needsUrl = (steps: StepRef[], events: NamedEvent[]): boolean =>
  stepEvents(steps, events).some((e) => e.rules.some((r) => r.t === "action" && !!r.onPage));

const actionRowPredicates = (
  scope: AnalyticsScope,
  steps: StepRef[],
  events: NamedEvent[],
): string[] =>
  unique([
    ...steps.filter((s) => s.kind === "c").map((s) => stepPredicateRaw(s, scope, events)),
    ...stepEvents(steps, events).flatMap((e) =>
      e.rules.filter((r): r is NamedActionRule => r.t === "action").map((r) => rawRule(r, scope)),
    ),
  ]);

const viewKeepPredicates = (
  scope: AnalyticsScope,
  steps: StepRef[],
  events: NamedEvent[],
): string[] => {
  const pk = pageKeyExpr("url", scope.schema, "vn");
  const eq = (key: string) => `(${urlPrefilter(key, "url")} AND ${pk} = ${lit(key)})`;
  const fromRules = stepEvents(steps, events).flatMap((e) =>
    e.rules
      .filter((r): r is NamedEventRule => r.t === "view")
      .map((r) => {
        if (r.op === "eq") return eq(r.value);
        if (r.op === "prefix") {
          const pf = prefixPrefilter(r.value, "url");
          return `(${pf ? `${pf} AND ` : ""}starts_with(${pk}, ${lit(r.value)}))`;
        }
        return `regexp_like(${pk}, ${lit(r.value)})`;
      }),
  );
  return unique([...steps.filter((s) => s.kind === "p").map((s) => eq(s.key)), ...fromRules]);
};

const stepFlags = (scope: AnalyticsScope, steps: StepRef[], events: NamedEvent[]): string =>
  steps
    .map(
      (s, i) =>
        `CASE WHEN ${stepPredicateGrouped(s, scope, events)} THEN 1 ELSE 0 END AS m${i + 1}`,
    )
    .join(", ");

const range1 = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

const stepConds = (n: number): string =>
  range1(n)
    .map((i) => `m${i} = 1`)
    .join(", ");

// One window stage replaces the n-1 chain windows: the partition's depth and whether a row is a matched step k.
const sequenceCtes = (
  n: number,
  partition: string,
  windowMs: number | null,
  k: number,
): string[] => {
  const conds = stepConds(n);
  const w = windowMs ?? 0;
  const next = k < n ? `, CASE WHEN wr >= ${k + 1} THEN 1 ELSE 0 END AS v${k + 1}` : "";
  return [
    `w AS (SELECT *, sequence_depth(${w}, t, ${conds}) OVER (PARTITION BY ${partition}) AS wr, sequence_step_match(${w}, ${k}, t, ${conds}) OVER (PARTITION BY ${partition}) AS wv FROM x2)`,
    `v AS (SELECT *, CASE WHEN wv THEN 1 ELSE 0 END AS v${k}${next} FROM w)`,
  ];
};

interface ChainShape {
  users: boolean;
  windowMs: number | null;
  partition: string;
}

const chainShape = (id: IdentitySql | null, def: FunnelDef): ChainShape => {
  const users = def.unit === "users" && id !== null;
  const window = users ? def.window : "session";
  const windowMs = window === "session" ? null : WINDOW_MS[window];
  return { users, windowMs, partition: users && windowMs ? "COALESCE(uid, 's:' || sid)" : "sid" };
};

const funnelCtes = (
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: FunnelDef,
  events: NamedEvent[],
  dim: string | null,
): { ctes: string[]; users: boolean } => {
  const { users, windowMs, partition } = chainShape(id, def);
  const n = def.steps.length;
  const u = users && id ? identityExpr(id) : "";
  const url = needsUrl(def.steps, events);
  const vnAvail = has(scope, "view_name");
  const cols = [
    "session_id AS sid",
    "type AS ty",
    "MIN(date) AS t",
    "MIN(view_url) AS url",
    atnCol(scope),
    ...(users && id ? identityGroupCols(id) : []),
    ...(dim ? [`MIN(${dim}) AS dim`] : []),
    ...(vnAvail ? ["MIN(view_name) AS vn"] : []),
  ];
  const rowFilter = [
    "type = 'view'",
    ...actionRowPredicates(scope, def.steps, events),
    ...(users ? [`${u} IS NOT NULL`] : []),
  ].join(" OR ");
  const keep = viewKeepPredicates(scope, def.steps, events).join(" OR ") || "FALSE";
  const k = `CASE WHEN ty = 'view' THEN ${pageKeyExpr("url", scope.schema, "vn")} WHEN ty = 'action' THEN ${clickKeyExpr("atn")} END AS k`;
  const ctes = [
    `x00 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (${rowFilter}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN ${actionKey(scope)} ELSE type END)`,
    `x0 AS (SELECT sid, t, ty, ${k}${users ? ", u0, ut" : ""}${dim ? ", dim" : ""}${url ? ", url" : ""}${url && vnAvail ? ", vn" : ""} FROM x00 WHERE ty = 'action' OR (ty = 'view' AND (${keep}))${users ? " OR u0 IS NOT NULL" : ""})`,
    `x1 AS (SELECT sid, t, ty, k${dim ? ", dim" : ""}, ${stepFlags(scope, def.steps, events)}, ${users ? `${UID_WINDOW} AS uid` : "CAST(NULL AS VARCHAR) AS uid"} FROM x0)`,
  ];
  const n1 = range1(n);
  let source = "x1";
  if (users) {
    const x2Cols = [
      "sid",
      "t",
      "ty",
      "k",
      ...(dim ? ["dim"] : []),
      ...n1.map((i) => `m${i}`),
      "uid",
    ];
    ctes.push(
      `x2 AS (SELECT ${x2Cols.join(", ")} FROM x1 WHERE ${n1.map((i) => `m${i} = 1`).join(" OR ")})`,
    );
    source = "x2";
  }
  const f = `sequence_step_times(${windowMs ?? 0}, t, ${stepConds(n)}) AS f`;
  const seen = n1.map((i) => `SUM(m${i}) AS seen${i}`);
  const firstDim = "first_value(dim ORDER BY CASE WHEN m1 = 1 THEN 0 ELSE 1 END, t) AS dim";
  const fromF = [
    ...n1.map((i) => `CASE WHEN f[${i}] IS NOT NULL THEN 1 ELSE 0 END AS r${i}`),
    ...n1.slice(1).map((i) => `f[${i}] AS d${i}`),
    ...n1.map((i) => `seen${i}`),
  ];
  if (users && windowMs) {
    // A windowed sequence spans the user's sessions, so it aggregates the user's rows directly.
    const su = [
      "CASE WHEN uid IS NULL THEN 1 ELSE 0 END AS anon",
      f,
      ...seen,
      "COUNT(DISTINCT CASE WHEN m1 = 1 THEN sid END) AS s1s",
      ...(dim ? [firstDim] : []),
    ];
    ctes.push(
      `su AS (SELECT ${su.join(", ")} FROM x2 GROUP BY ${partition}, CASE WHEN uid IS NULL THEN 1 ELSE 0 END)`,
      `pu AS (SELECT anon, ${[...fromF, "s1s", ...(dim ? ["dim"] : [])].join(", ")} FROM su)`,
    );
    return { ctes, users };
  }
  const dimCols = dim ? [firstDim, "MIN(CASE WHEN m1 = 1 THEN t END) AS t1"] : [];
  ctes.push(
    `s AS (SELECT ${["sid", "MAX(uid) AS uid", f, ...seen, ...dimCols].join(", ")} FROM ${source} GROUP BY sid)`,
    `ps AS (SELECT ${["sid", "uid", ...fromF, ...(dim ? ["dim", "t1"] : [])].join(", ")} FROM s)`,
  );
  if (users) {
    const pu = [
      "CASE WHEN uid IS NULL THEN 1 ELSE 0 END AS anon",
      ...n1.map((i) => `MAX(r${i}) AS r${i}`),
      ...n1.slice(1).map((i) => `MIN(d${i}) AS d${i}`),
      ...n1.map((i) => `SUM(seen${i}) AS seen${i}`),
      "SUM(r1) AS s1s",
      ...(dim ? ["first_value(dim ORDER BY t1) AS dim"] : []),
    ];
    ctes.push(
      `pu AS (SELECT ${pu.join(", ")} FROM ps GROUP BY COALESCE(uid, 's:' || sid), CASE WHEN uid IS NULL THEN 1 ELSE 0 END)`,
    );
  }
  return { ctes, users };
};

const breakdownField = (scope: AnalyticsScope, def: FunnelDef): string | null => {
  if (!def.breakdown) return null;
  const field = DIMENSIONS[def.breakdown];
  return field && has(scope, field) ? field : null;
};

export function funnelSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: FunnelDef,
  opts: BuildOpts,
): string {
  const dim = breakdownField(scope, def);
  const { ctes, users } = funnelCtes(scope, id, def, opts.events, dim);
  const n = def.steps.length;
  if (dim) {
    const cnt = range1(n).map((i) => `SUM(r${i}) AS c${i}`);
    return withCtes(
      ctes,
      `SELECT dim, ${cnt.join(", ")} FROM ${users ? "pu WHERE anon = 0" : "ps"} GROUP BY dim ORDER BY c1 DESC, dim LIMIT 1000`,
    );
  }
  const cnt = range1(n).map((i) =>
    users ? `SUM(CASE WHEN anon = 0 THEN r${i} ELSE 0 END) AS c${i}` : `SUM(r${i}) AS c${i}`,
  );
  const seen = range1(n).map((i) => `SUM(seen${i}) AS seen${i}`);
  const extra = users
    ? ["SUM(s1s) AS s1_sessions", "SUM(CASE WHEN anon = 1 THEN s1s ELSE 0 END) AS left_out"]
    : [];
  const pcts = range1(n)
    .slice(1)
    .flatMap((i) => {
      const d = users ? `CASE WHEN anon = 0 THEN d${i} END` : `d${i}`;
      return [
        `approx_percentile_cont(${d}, 0.5) AS med${i}`,
        `approx_percentile_cont(${d}, 0.9) AS p90_${i}`,
      ];
    });
  return withCtes(
    ctes,
    `SELECT ${[...cnt, ...seen, ...extra, ...pcts].join(", ")} FROM ${users ? "pu" : "ps"} LIMIT 1`,
  );
}

export function funnelPanelSql(scope: AnalyticsScope, def: FunnelDef, opts: BuildOpts): string {
  const sessionsDef: FunnelDef = { ...def, unit: "sessions", window: "session", breakdown: null };
  const { ctes } = funnelCtes(scope, null, sessionsDef, opts.events, null);
  const n = def.steps.length;
  const fin = [
    ...range1(n).map((i) => `SUM(r${i}) AS c${i}`),
    ...range1(n).map((i) => `SUM(seen${i}) AS seen${i}`),
  ];
  const labels = def.steps.map((s, i) => {
    const name = s.kind === "e" ? (findEvent(s.key, opts.events)?.name ?? s.key) : s.key;
    return lit(`${i + 1}. ${name}`);
  });
  return withCtes(
    [...ctes, `fin AS (SELECT ${fin.join(", ")} FROM ps)`],
    `SELECT unnest(make_array(${labels.join(", ")})) AS x_axis_1, unnest(make_array(${range1(n)
      .map((i) => `c${i}`)
      .join(", ")})) AS y_axis_1 FROM fin`,
  );
}

// The alert service rejects any `SELECT *` in the text, so this path lists every column.
export function funnelAlertSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: FunnelDef,
  belowPct: number,
  opts: BuildOpts,
): string {
  const { ctes, users } = funnelCtes(scope, id, { ...def, breakdown: null }, opts.events, null);
  const n = def.steps.length;
  const pct = Math.min(100, Math.max(0, Number.isFinite(belowPct) ? belowPct : 0));
  const conv = "100.0 * converted / entered";
  return withCtes(
    [
      ...ctes,
      `fin AS (SELECT SUM(r1) AS entered, SUM(r${n}) AS converted FROM ${users ? "pu WHERE anon = 0" : "ps"})`,
    ],
    `SELECT entered, converted, ${conv} AS conv_pct FROM fin WHERE entered > 0 AND ${conv} < ${pct}`,
  );
}

interface FullChainOpts {
  errors: boolean;
  label: boolean;
  sample: SampleRatio;
}

const fullChainCtes = (
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: FunnelDef,
  events: NamedEvent[],
  o: FullChainOpts,
  stepK: number,
): { ctes: string[]; unit: string; windowMs: number | null; frustration: boolean } => {
  const { users, windowMs, partition } = chainShape(id, def);
  const idf = !!id && (users || o.label);
  const frustration = o.errors && has(scope, "action_frustration_type");
  const url = needsUrl(def.steps, events);
  const vnAvail = has(scope, "view_name");
  const cols = [
    "session_id AS sid",
    "type AS ty",
    "MIN(date) AS t",
    "MIN(view_url) AS url",
    atnCol(scope),
    hrExpr(scope),
    ...(frustration
      ? ["MAX(CASE WHEN action_frustration_type IS NOT NULL THEN 1 ELSE 0 END) AS fr"]
      : []),
    ...(idf && id ? identityGroupCols(id) : []),
    ...(vnAvail ? ["MIN(view_name) AS vn"] : []),
  ];
  const types = o.errors ? "'view', 'error'" : "'view'";
  const identityRows = idf && id ? ` OR ${identityExpr(id)} IS NOT NULL` : "";
  const k = `CASE WHEN ty = 'view' THEN ${pageKeyExpr("url", scope.schema, "vn")} WHEN ty = 'action' THEN ${clickKeyExpr("atn")} END AS k`;
  const fr = frustration ? ", fr" : "";
  const keepUrl = url ? ", url" : "";
  const keepVn = url && vnAvail ? ", vn" : "";
  const ctes = [
    `x00 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope, users ? 1 : o.sample)} AND (type IN (${types}) OR ${actionClickExpr(scope)}${identityRows}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN ${actionKey(scope)} WHEN type = 'error' THEN CAST(date AS VARCHAR) ELSE type END)`,
    idf
      ? `x0 AS (SELECT sid, ty, t, hr${fr}, u0, ut${keepUrl}${keepVn}, ${k} FROM x00)`
      : `x0 AS (SELECT sid, ty, t, hr${fr}${keepUrl}${keepVn}, ${k} FROM x00 WHERE ty IN ('view', 'action', 'error'))`,
    `x1 AS (SELECT sid, ty, t, hr${fr}, k, ${stepFlags(scope, def.steps, events)}, ${idf ? `${UID_WINDOW} AS uid` : "CAST(NULL AS VARCHAR) AS uid"} FROM x0)`,
    `x2 AS (SELECT * FROM (SELECT *, MAX(m1) OVER (PARTITION BY ${partition}) AS h1 FROM x1) q WHERE h1 = 1 AND ty IN ('view', 'action', 'error'))`,
    ...sequenceCtes(def.steps.length, partition, windowMs, stepK),
  ];
  return { ctes, unit: users ? "uid" : "sid", windowMs, frustration };
};

const reachCte = (unit: string, k: number, withNext: boolean): string => {
  const cols = [
    `MIN(CASE WHEN v${k} = 1 THEN t END) OVER (PARTITION BY ${unit}) AS tk`,
    `substr(MIN(CASE WHEN v${k} = 1 THEN CAST(t AS VARCHAR) || sid END) OVER (PARTITION BY ${unit}), 14) AS sk`,
    `MAX(v${k}) OVER (PARTITION BY ${unit}) AS rk`,
    ...(withNext ? [`MAX(v${k + 1}) OVER (PARTITION BY ${unit}) AS rk1`] : []),
  ];
  return `r AS (SELECT *, ${cols.join(", ")} FROM v WHERE ${unit} IS NOT NULL)`;
};

// Named-event steps reuse their flag, because an on-page rule needs a URL the chain rows no longer carry.
const notStep = (scope: AnalyticsScope, step: StepRef, k: number, events: NamedEvent[]): string =>
  step.kind === "e" ? `NOT (m${k} = 1)` : `NOT (${stepPredicateGrouped(step, scope, events)})`;

const nextAfterSql = (
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: FunnelDef,
  k: number,
  dropped: boolean,
  opts: BuildOpts,
): string => {
  const { ctes, unit } = fullChainCtes(
    scope,
    id,
    def,
    opts.events,
    { errors: false, label: false, sample: opts.sample },
    k,
  );
  ctes.push(reachCte(unit, k, dropped));
  const cand = `sid = sk AND t > tk AND ty IN ('view', 'action') AND k IS NOT NULL AND ${notStep(scope, def.steps[k - 1], k, opts.events)}`;
  ctes.push(
    `nu0 AS (SELECT ${unit} AS unit, MIN(CASE WHEN ${cand} THEN CAST(t AS VARCHAR) || CASE WHEN ty = 'view' THEN 'p' ELSE 'c' END || k END) AS nx FROM r WHERE ${dropped ? "rk = 1 AND rk1 = 0" : "rk = 1"} GROUP BY ${unit})`,
  );
  ctes.push(
    "nu AS (SELECT unit, CASE substr(nx, 14, 1) WHEN 'p' THEN 'view' WHEN 'c' THEN 'action' END AS nty, substr(nx, 15) AS nk FROM nu0)",
  );
  const head =
    "SELECT CASE WHEN nty IS NULL THEN 0 ELSE 1 END AS is_next, CASE WHEN nty = 'view' THEN 'p' WHEN nty = 'action' THEN 'c' END AS kind, nk AS k, COUNT(*) AS units FROM nu";
  return withCtes(
    ctes,
    dropped
      ? `${head} GROUP BY nty, nk ORDER BY is_next, units DESC, k LIMIT 6`
      : `${head} WHERE nty IS NOT NULL GROUP BY nty, nk ORDER BY units DESC, k LIMIT 5`,
  );
};

export function nextStepsSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: FunnelDef,
  opts: BuildOpts,
): string {
  return nextAfterSql(scope, id, def, def.steps.length, false, opts);
}

export function dropoffNextSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  cohort: FunnelCohort,
  opts: BuildOpts,
): string {
  return nextAfterSql(scope, id, cohort.funnel, cohort.stepIndex, true, opts);
}

export function dropoffHealthSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: FunnelDef,
  stepIndex: number,
  opts: BuildOpts,
): string {
  const k = stepIndex;
  const { ctes, unit, windowMs, frustration } = fullChainCtes(
    scope,
    id,
    def,
    opts.events,
    { errors: true, label: false, sample: opts.sample },
    k,
  );
  ctes.push(reachCte(unit, k, true));
  const win = windowMs ? `t >= tk AND t <= tk + ${windowMs}` : "sid = sk AND t >= tk";
  const fr = frustration
    ? `, MAX(CASE WHEN ty = 'action' AND fr = 1 AND ${win} THEN 1 ELSE 0 END) AS f`
    : "";
  ctes.push(
    `hu AS (SELECT ${unit} AS unit, MAX(rk1) AS conv, MAX(CASE WHEN ty = 'error' AND ${win} THEN 1 ELSE 0 END) AS e${fr}, COUNT(DISTINCT CASE WHEN v${k} = 1 THEN sid END) AS s FROM r WHERE rk = 1 GROUP BY ${unit})`,
  );
  return withCtes(
    ctes,
    `SELECT CASE WHEN conv = 1 THEN 'converted' ELSE 'dropped' END AS side, COUNT(*) AS units, SUM(s) AS sessions, SUM(e) AS with_error, ${frustration ? "SUM(f)" : "0"} AS with_frustration FROM hu GROUP BY conv ORDER BY side LIMIT 2`,
  );
}

export function cohortSessionsSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  cohort: FunnelCohort,
  page: number,
  opts: BuildOpts,
): string {
  const k = cohort.stepIndex;
  const { ctes, unit, frustration } = fullChainCtes(
    scope,
    id,
    cohort.funnel,
    opts.events,
    { errors: true, label: true, sample: opts.sample },
    k,
  );
  ctes.push(reachCte(unit, k, true));
  const fr = frustration ? "SUM(CASE WHEN ty = 'action' AND fr = 1 THEN 1 ELSE 0 END)" : "0";
  ctes.push(
    `cs AS (SELECT sid, MIN(CASE WHEN v${k} = 1 THEN t END) AS step_t, SUM(CASE WHEN ty = 'error' THEN 1 ELSE 0 END) AS errors, ${fr} AS frustrations, MAX(hr) AS has_replay, MIN(t) AS started, MAX(t) AS ended, MAX(uid) AS user_label FROM r WHERE rk = 1 AND rk1 = 0 GROUP BY sid)`,
  );
  return withCtes(
    ctes,
    `SELECT sid, step_t, errors, frustrations, has_replay, started, ended, user_label, COUNT(*) OVER () AS total FROM cs WHERE step_t IS NOT NULL ORDER BY has_replay DESC, step_t DESC, sid LIMIT ${PAGE_LIMIT} OFFSET ${PAGE_LIMIT * Math.max(0, Math.trunc(page))}`,
  );
}

export function sessionEventsProbeSql(sessionId: string, schema: Record<string, boolean>): string {
  const email = schema.usr_email ? "MAX(usr_email)" : "CAST(NULL AS VARCHAR)";
  const source = schema.source ? "MIN(source)" : "CAST(NULL AS VARCHAR)";
  return `SELECT MIN(date) AS start_time, MAX(date) AS end_time, ${email} AS user_email, ${source} AS source FROM "_rumdata" WHERE session_id = ${lit(sessionId)} LIMIT 1`;
}

const GROUPED_INCLUDE: Readonly<Record<PathsInclude, string>> = {
  all: "ty IN ('view', 'action')",
  pages: "ty = 'view'",
  clicks: "ty = 'action'",
};

const ATTR_WINDOW = `OVER (PARTITION BY sid ORDER BY t, key ${WHOLE})`;

// Error rows have no key, so they get their own LAG partition and the dedup matches the flow query.
const pathTail = (def: PathsDef, attrs: boolean, anchor: string): string[] => {
  const d = attrs
    ? `d AS (SELECT *, LAG(key) OVER (PARTITION BY sid, CASE WHEN ty = 'error' THEN 1 ELSE 0 END ORDER BY t, key) AS pk, SUM(CASE WHEN ty = 'error' THEN 1 ELSE 0 END) ${ATTR_WINDOW} AS errors, MIN(t) ${ATTR_WINDOW} AS started, MAX(t) ${ATTR_WINDOW} AS ended, MAX(hr) ${ATTR_WINDOW} AS has_replay FROM e)`
    : "d AS (SELECT *, LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk FROM e)";
  const sign = def.direction === "next" ? "+" : "-";
  const depth = Math.min(5, Math.max(1, Math.trunc(def.depth)));
  const window =
    def.direction === "next" ? `n BETWEEN n0 AND n0 + ${depth}` : `n BETWEEN n0 - ${depth} AND n0`;
  const cols = [
    "sid",
    ...range1(depth).map((j) => `MAX(CASE WHEN n = n0 ${sign} ${j} THEN key END) AS s${j}`),
    ...range1(depth).map((j) => `MAX(CASE WHEN n = n0 ${sign} ${j} THEN t END) AS t${j}`),
    ...(attrs
      ? [
          "MAX(errors) AS errors",
          "MAX(started) AS started",
          "MAX(ended) AS ended",
          "MAX(has_replay) AS has_replay",
          "MAX(CASE WHEN n = n0 THEN t END) AS t0",
        ]
      : []),
  ];
  return [
    d,
    "sq AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t, key) AS n FROM d WHERE key IS NOT NULL AND (pk IS NULL OR pk <> key))",
    `an AS (SELECT *, ${anchor} OVER (PARTITION BY sid) AS n0 FROM sq)`,
    `pa AS (SELECT ${cols.join(", ")} FROM an WHERE ${window} GROUP BY sid)`,
  ];
};

const cohortPathCtes = (
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: PathsDef,
  cohort: FunnelCohort,
  opts: BuildOpts,
  attrs: boolean,
): string[] => {
  const k = cohort.stepIndex;
  const { ctes, unit } = fullChainCtes(
    scope,
    id,
    cohort.funnel,
    opts.events,
    { errors: attrs, label: false, sample: opts.sample },
    k,
  );
  const include = attrs
    ? `(${GROUPED_INCLUDE[def.include]} OR ty = 'error')`
    : GROUPED_INCLUDE[def.include];
  // Per session tk already is the step time; a user's first reach can sit in another session.
  const stepT =
    unit === "sid" ? "tk" : `MIN(CASE WHEN v${k} = 1 THEN t END) OVER (PARTITION BY sid)`;
  return [
    ...ctes,
    reachCte(unit, k, true),
    `cr AS (SELECT sid, t, ty, hr, k, ${stepT} AS step_t FROM r WHERE rk = 1 AND rk1 = 0)`,
    `e AS (SELECT sid, t, ty, hr, step_t, CASE WHEN ty = 'view' THEN 'p:' || k WHEN ty = 'action' THEN 'c:' || k END AS key FROM cr WHERE step_t IS NOT NULL AND ${include})`,
    ...pathTail(def, attrs, "MAX(CASE WHEN t <= step_t THEN n END)"),
  ];
};

const pathCtes = (
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: PathsDef,
  opts: BuildOpts,
  attrs: boolean,
): string[] => {
  if (def.cohort) return cohortPathCtes(scope, id, def, def.cohort, opts, attrs);
  const anchor = def.anchor;
  if (!anchor) throw new Error("Paths need an anchor or a funnel cohort");
  const types = attrs
    ? `(${pathsIncludeExpr(scope, def.include)} OR type = 'error')`
    : pathsIncludeExpr(scope, def.include);
  const cols = [
    "session_id AS sid",
    "type AS ty",
    "MIN(date) AS t",
    "MIN(view_url) AS url",
    atnCol(scope),
    hrExpr(scope),
    ...(has(scope, "view_name") ? ["MIN(view_name) AS vn"] : []),
  ];
  const ctes = [
    `e0 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope, opts.sample)} AND ${types} GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN ${actionKey(scope)} ELSE CAST(date AS VARCHAR) END)`,
  ];
  const pk = pageKeyExpr("url", scope.schema, "vn");
  const ck = clickKeyExpr("atn");
  if (anchor.kind === "e") {
    const keepVn = has(scope, "view_name") ? ", vn" : "";
    ctes.push(
      `e1 AS (SELECT sid, t, ty, hr, url${keepVn}, CASE WHEN ty = 'view' THEN ${pk} WHEN ty = 'action' THEN ${ck} END AS k FROM e0)`,
      `e AS (SELECT sid, t, ty, hr, CASE WHEN ty = 'view' THEN 'p:' || k WHEN ty = 'action' THEN 'c:' || k END AS key, CASE WHEN ${stepPredicateGrouped(anchor, scope, opts.events)} THEN 1 ELSE 0 END AS am FROM e1)`,
    );
    return [...ctes, ...pathTail(def, attrs, "MIN(CASE WHEN am = 1 THEN n END)")];
  }
  ctes.push(
    `e AS (SELECT sid, t, ty, hr, CASE WHEN ty = 'view' THEN 'p:' || ${pk} WHEN ty = 'action' THEN 'c:' || ${ck} END AS key FROM e0)`,
  );
  return [
    ...ctes,
    ...pathTail(
      def,
      attrs,
      `MIN(CASE WHEN key = ${lit(`${anchor.kind}:${anchor.key}`)} THEN n END)`,
    ),
  ];
};

export function pathsSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: PathsDef,
  opts: BuildOpts,
): string {
  const depth = Math.min(5, Math.max(1, Math.trunc(def.depth)));
  const s = range1(depth)
    .map((j) => `s${j}`)
    .join(", ");
  return withCtes(
    pathCtes(scope, id, def, opts, false),
    `SELECT ${s}, COUNT(*) AS sessions, SUM(COUNT(*)) OVER () AS anchor_sessions, COUNT(*) OVER () AS path_count FROM pa GROUP BY ${s} ORDER BY sessions DESC, ${s} LIMIT 5000`,
  );
}

export function branchSessionsSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  def: PathsDef,
  predicate: string,
  stepDepth: number,
  page: number,
  opts: BuildOpts,
): string {
  const j = Math.min(Math.max(0, Math.trunc(stepDepth)), Math.trunc(def.depth));
  return withCtes(
    pathCtes(scope, id, def, opts, true),
    `SELECT sid, t${j} AS step_t, errors, 0 AS frustrations, has_replay, started, ended, COUNT(*) OVER () AS total FROM pa WHERE ${predicate} ORDER BY has_replay DESC, step_t DESC, sid LIMIT ${PAGE_LIMIT} OFFSET ${PAGE_LIMIT * Math.max(0, Math.trunc(page))}`,
  );
}

const periodCase = (boundariesUs: number[]): string => {
  const whens = boundariesUs
    .slice(1)
    .map((b, i) => `WHEN _timestamp < ${Math.trunc(b)} THEN ${i}`)
    .join(" ");
  return `CASE ${whens} ELSE ${boundariesUs.length - 1} END`;
};

const retentionCtes = (
  scope: AnalyticsScope,
  id: IdentitySql,
  def: RetentionDef,
  boundariesUs: number[],
  opts: BuildOpts,
  perSession: boolean,
): string[] => {
  const u = identityExpr(id);
  const p = periodCase(boundariesUs);
  const pred = (step: StepRef | null) =>
    step ? stepPredicateRaw(step, scope, opts.events) : "1 = 1";
  const sample = opts.sample > 1 ? ` AND ${samplePredicate(u, opts.sample)}` : "";
  const cols = [
    `${u} AS u`,
    `${p} AS p`,
    `MAX(CASE WHEN ${pred(def.start)} THEN 1 ELSE 0 END) AS s`,
    `MAX(CASE WHEN ${pred(def.ret)} THEN 1 ELSE 0 END) AS r`,
    ...(perSession ? ["session_id AS sid", "MAX(_timestamp) AS ts"] : []),
  ];
  return [
    `a AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND type IN ('view', 'action') AND ${u} IS NOT NULL${sample} GROUP BY ${u}, ${p}${perSession ? ", session_id" : ""})`,
    "c AS (SELECT *, MIN(CASE WHEN s = 1 THEN p END) OVER (PARTITION BY u) AS cohort, MAX(CASE WHEN r = 1 THEN p END) OVER (PARTITION BY u) AS last_ret FROM a)",
  ];
};

export function retentionSql(
  scope: AnalyticsScope,
  id: IdentitySql,
  def: RetentionDef,
  boundariesUs: number[],
  opts: BuildOpts,
): string {
  const m = boundariesUs.length;
  return withCtes(
    retentionCtes(scope, id, def, boundariesUs, opts, false),
    `SELECT cohort, p - cohort AS k, COUNT(CASE WHEN p = cohort THEN 1 END) AS size_part, COUNT(CASE WHEN r = 1 THEN 1 END) AS users_on, COUNT(CASE WHEN p = last_ret THEN 1 END) AS users_last FROM c WHERE cohort IS NOT NULL AND p >= cohort GROUP BY cohort, p - cohort ORDER BY cohort, k LIMIT ${(m * (m + 1)) / 2}`,
  );
}

export function retentionCellUsersSql(
  scope: AnalyticsScope,
  id: IdentitySql,
  def: RetentionDef,
  boundariesUs: number[],
  cohort: number,
  period: number,
  opts: BuildOpts,
): string {
  const c = Math.trunc(cohort);
  const target = c + Math.trunc(period);
  const retained =
    def.mode === "after"
      ? `CASE WHEN MAX(last_ret) >= ${target} THEN 1 ELSE 0 END`
      : `MAX(CASE WHEN p = ${target} AND r = 1 THEN 1 ELSE 0 END)`;
  return withCtes(
    [
      ...retentionCtes(scope, id, def, boundariesUs, opts, true),
      `m AS (SELECT u, ${retained} AS retained, COUNT(DISTINCT sid) AS sessions, MAX(ts) AS last_seen FROM c WHERE cohort = ${c} GROUP BY u)`,
      "x AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY retained ORDER BY last_seen DESC, u) AS rn FROM m)",
    ],
    "SELECT u, retained, sessions, last_seen FROM x WHERE rn <= 200 ORDER BY retained DESC, last_seen DESC, u LIMIT 400",
  );
}

const MAX_FEATURE_EVENTS = 5;

const featureRule = (rule: NamedEventRule | NamedActionRule): string => {
  if (rule.t === "action") {
    return `(ty = 'action' AND k IN (${lits(rule.targets)})${rule.onPage ? ` AND pg = ${lit(rule.onPage)}` : ""})`;
  }
  if (rule.op === "eq") return `(ty = 'view' AND pg = ${lit(rule.value)})`;
  if (rule.op === "prefix") return `(ty = 'view' AND starts_with(pg, ${lit(rule.value)}))`;
  return `(ty = 'view' AND regexp_like(pg, ${lit(rule.value)}))`;
};

export function featuresSql(
  scope: AnalyticsScope,
  currentStartUs: number,
  id: IdentitySql | null,
  events: NamedEvent[],
): string {
  if (!events.length || events.length > MAX_FEATURE_EVENTS)
    throw new Error("Features take 1 to 5 events per request");
  const c = cur(currentStartUs);
  const cols = [
    "session_id AS sid",
    "type AS ty",
    `${c} AS cur`,
    "MIN(view_url) AS url",
    atnCol(scope),
    ...(has(scope, "view_name") ? ["MIN(view_name) AS vn"] : []),
    ...(id ? identityGroupCols(id) : []),
  ];
  const extra = id ? ` OR ${identityExpr(id)} IS NOT NULL` : "";
  const agg = events.flatMap((ev, i) => {
    const p = `(${ev.rules.map(featureRule).join(" OR ")})`;
    return [
      `COUNT(DISTINCT CASE WHEN cur = 1 AND ${p} THEN sid END) AS e${i}_sessions`,
      `COUNT(DISTINCT CASE WHEN cur = 0 AND ${p} THEN sid END) AS e${i}_prev_sessions`,
      `COUNT(CASE WHEN cur = 1 AND ${p} THEN 1 END) AS e${i}_events`,
      `COUNT(CASE WHEN cur = 0 AND ${p} THEN 1 END) AS e${i}_prev_events`,
      ...(id
        ? [
            `COUNT(DISTINCT CASE WHEN cur = 1 AND ${p} THEN u END) AS e${i}_users`,
            `COUNT(DISTINCT CASE WHEN cur = 0 AND ${p} THEN u END) AS e${i}_prev_users`,
          ]
        : []),
    ];
  });
  return withCtes(
    [
      `e0 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (type = 'view' OR ${actionClickExpr(scope)}${extra}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN ${actionKey(scope)} END, ${c})`,
      `e1 AS (SELECT sid, ty, cur, ${pageKeyExpr("url", scope.schema, "vn")} AS pg, ${clickKeyExpr("atn")} AS k${id ? `, ${UID_WINDOW} AS u` : ""} FROM e0)`,
    ],
    `SELECT ${agg.join(", ")} FROM e1 LIMIT 1`,
  );
}
