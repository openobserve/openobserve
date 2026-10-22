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

import { sqlIn, sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import {
  CONTAINER_SUFFIXES,
  FILTER_FIELDS,
  type AppExclusions,
  type MatchOp,
  type NamedEvent,
  type NamedRule,
  type PageRule,
  type SessionRule,
} from "@/utils/rum/productAnalyticsModel";

export type StepKind = "p" | "c" | "e" | "r";
/** A page step's "only when": a URL parameter, or the referrer host, equals one of `values`. */
export type ViewCond =
  | { t: "param"; key: string; op: "eq"; values: string[] }
  | { t: "ref"; op: "eq"; values: string[] };
export interface StepFilters {
  minMs?: number;
  frustrated?: true;
  errored?: true;
  vc?: ViewCond[];
}
export interface StepRef {
  kind: StepKind;
  key: string;
  f?: StepFilters;
}
/** Exactly one of `b` (between steps a and b) and `withinMs` (within that long after step a). */
export interface ExclusionStep {
  step: StepRef;
  a: number;
  b?: number;
  withinMs?: number;
}
export type IdentityField = "usr_id" | "usr_email" | "usr_anonymous_id";
export interface AnalyticsScope {
  app: string;
  env: string[];
  version: string[];
  schema: Record<string, boolean>;
  exclusions?: AppExclusions;
  xall?: boolean;
  apps?: string[];
  appExclusions?: Record<string, AppExclusions>;
  newSince?: number;
}
export interface IdentitySql {
  field: IdentityField;
  excluded: string[];
}
export type FunnelUnit = "sessions" | "users";
export type FunnelWindow = "session" | "1h" | "1d" | "7d";
export type BreakdownDim = "browser" | "os" | "device" | "country" | "version" | "env" | "app";
export interface FunnelDef {
  steps: StepRef[];
  unit: FunnelUnit;
  window: FunnelWindow;
  breakdown: BreakdownDim | null;
  x?: ExclusionStep[];
  f?: FunnelFilter[];
}
/** Filter all steps on a built-in session field or an attribute column; `not` keeps sessions that never match. */
export interface FunnelFilter {
  field: string;
  op: MatchOp;
  values: string[];
  not?: true;
}
export interface FunnelCohort {
  funnel: FunnelDef;
  stepIndex: number;
  side: "dropped";
  /** The saved funnel's name at hand-off; absent for an unsaved funnel. */
  name?: string;
  /** The saved funnel's id at hand-off, so "Back to funnel" reopens this one and not whichever is open. */
  funnelId?: string;
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
  app: "application_id",
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

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const opMatch = (op: MatchOp, col: string, value: string | string[]): string => {
  if (op === "in") return `${col} IN (${lits(Array.isArray(value) ? value : [value])})`;
  const v = lit(value);
  if (op === "eq") return `${col} = ${v}`;
  if (op === "prefix") return `starts_with(${col}, ${v})`;
  if (op === "suffix") return `ends_with(${col}, ${v})`;
  if (op === "contains") return `strpos(${col}, ${v}) > 0`;
  return `regexp_like(${col}, ${v})`;
};

const opMiss = (op: Exclude<MatchOp, "in">, col: string, value: string): string => {
  const v = lit(value);
  if (op === "eq") return `${col} <> ${v}`;
  if (op === "contains") return `strpos(${col}, ${v}) = 0`;
  return `NOT ${opMatch(op, col, value)}`;
};

// One condition per value, except `in`, which lists them all; NULL never excludes.
const ruleKeeps = (r: SessionRule): string[] =>
  r.op === "in"
    ? [`(${r.field} IS NULL OR ${r.field} NOT IN (${lits(r.values)}))`]
    : r.values.map(
        (v) => `(${r.field} IS NULL OR ${opMiss(r.op as Exclude<MatchOp, "in">, r.field, v)})`,
      );

const ruleMatches = (r: SessionRule): string[] =>
  (r.op === "in" ? [r.values] : r.values).map(
    (v) => `${r.field} IS NOT NULL AND ${opMatch(r.op, r.field, v)}`,
  );

const anyOf = (conds: string[]): string =>
  conds.length === 1 ? conds[0] : `(${conds.map((c) => `(${c})`).join(" OR ")})`;

const isIdentityRule = (r: SessionRule): boolean =>
  (IDENTITY_FIELDS as readonly string[]).includes(r.field);

const scopeApps = (scope: AnalyticsScope): string[] => [
  ...new Set([scope.app, ...(scope.apps ?? [])]),
];

const settingsOf = (scope: AnalyticsScope, app: string): AppExclusions | undefined =>
  app === scope.app ? scope.exclusions : scope.appExclusions?.[app];

// `xall` lifts the session rules only; ignored pages read settingsOf directly.
const activeRules = (scope: AnalyticsScope, app: string): AppExclusions | undefined =>
  scope.xall ? undefined : settingsOf(scope, app);

const builtinKeeps = (scope: AnalyticsScope, ex: AppExclusions | undefined): string[] => {
  if (!ex?.bots) return [];
  const halves: [string, string[]][] = [
    ["user_agent_user_agent_family", ex.builtinBots.families],
    ["user_agent_device_family", ex.builtinBots.devices],
  ];
  return halves
    .filter(([f, labels]) => has(scope, f) && labels.length)
    .map(([f, labels]) => `(${f} IS NULL OR ${f} NOT IN (${lits(labels)}))`);
};

const savedRules = (
  scope: AnalyticsScope,
  ex: AppExclusions | undefined,
  identity: boolean,
): SessionRule[] =>
  (ex?.sessions ?? []).filter((r) => has(scope, r.field) && isIdentityRule(r) === identity);

const rowKeeps = (
  scope: AnalyticsScope,
  ex: AppExclusions | undefined,
  identityRows: boolean,
): string[] => [
  ...builtinKeeps(scope, ex),
  ...savedRules(scope, ex, false).flatMap(ruleKeeps),
  ...(identityRows ? savedRules(scope, ex, true).flatMap(ruleKeeps) : []),
];

const appScope = (scope: AnalyticsScope): string => {
  const apps = scopeApps(scope);
  return apps.length > 1
    ? `application_id IN (${lits(apps)})`
    : `application_id = ${lit(scope.app)}`;
};

// Compared apps each keep their own rules, so every app gets its own branch of one OR.
const rulesClause = (scope: AnalyticsScope, identityRows: boolean): string[] => {
  const apps = scopeApps(scope);
  const branches = apps.map((a) => ({
    a,
    keeps: rowKeeps(scope, activeRules(scope, a), identityRows),
  }));
  if (apps.length === 1) return branches[0].keeps;
  if (!branches.some((b) => b.keeps.length)) return [];
  const one = ({ a, keeps }: { a: string; keeps: string[] }) =>
    keeps.length
      ? `(application_id = ${lit(a)} AND ${keeps.join(" AND ")})`
      : `application_id = ${lit(a)}`;
  return [`(${branches.map(one).join(" OR ")})`];
};

const scopeWhere = (scope: AnalyticsScope, sample: SampleRatio, identityRows: boolean): string => {
  const parts = [appScope(scope), "session_id IS NOT NULL"];
  if (has(scope, "env") && scope.env.length) parts.push(sqlIn("env", scope.env));
  if (has(scope, "version") && scope.version.length) parts.push(sqlIn("version", scope.version));
  if (has(scope, "session_type"))
    parts.push("(session_type IS NULL OR session_type <> 'synthetics')");
  if (sample > 1) parts.push(samplePredicate("session_id", sample));
  return [...parts, ...rulesClause(scope, identityRows)].join(" AND ");
};

/** The scope with every row-level exclusion; identity rules are left to each builder's session pass. */
export function scopeClause(scope: AnalyticsScope, sample: SampleRatio = 1): string {
  return scopeWhere(scope, sample, false);
}

// Clicks, click pages, active users and identity tops filter identity rules row by row.
const rowScope = (scope: AnalyticsScope): string => scopeWhere(scope, 1, true);

// One WHEN per app keeps compared apps' rules apart; MIN flags only sessions whose every row matches, as row filters drop them whole.
const appFlag = (
  scope: AnalyticsScope,
  cond: (ex: AppExclusions | undefined) => string[],
  agg: "MAX" | "MIN" = "MAX",
): string => {
  const apps = scopeApps(scope);
  const whens = apps.flatMap((a) => {
    const conds = cond(activeRules(scope, a));
    if (!conds.length) return [];
    const app = apps.length > 1 ? `application_id = ${lit(a)} AND ` : "";
    return [`WHEN ${app}${anyOf(conds)} THEN 1`];
  });
  return whens.length ? `${agg}(CASE ${whens.join(" ")} ELSE 0 END)` : "0";
};

const eitherFlag = (a: string, b: string): string => {
  if (a === "0") return b;
  if (b === "0") return a;
  return `CASE WHEN ${a} = 1 OR ${b} = 1 THEN 1 ELSE 0 END`;
};

interface SessionPass {
  xi: string;
  widen: string;
  over: string[];
  keep: string[];
}

const PASS_XS = "MAX(xi) OVER (PARTITION BY sid) AS xs";

// Identity rules flag the whole session, because its first views carry no identity yet.
const sessionPass = (scope: AnalyticsScope): SessionPass | null => {
  const rules = scopeApps(scope).flatMap((a) => savedRules(scope, activeRules(scope, a), true));
  if (!rules.length) return null;
  const xi = appFlag(scope, (ex) => savedRules(scope, ex, true).flatMap(ruleMatches));
  const fields = [...new Set(rules.map((r) => r.field))];
  return {
    xi: `${xi} AS xi`,
    widen: fields.map((f) => ` OR ${f} IS NOT NULL`).join(""),
    over: [PASS_XS],
    keep: ["xs = 0"],
  };
};

const isBuiltinFilter = (field: string): boolean =>
  (FILTER_FIELDS as readonly string[]).includes(field);

// An attribute name is parsed to [a-z0-9_] before it gets here, so quoting it is safe.
const filterColumn = (field: string): string => (isBuiltinFilter(field) ? field : `"${field}"`);

// Attribute columns may be numeric or boolean, and the filter's values are text.
const filterValue = (field: string): string =>
  isBuiltinFilter(field) ? field : `CAST("${field}" AS VARCHAR)`;

const funnelFilterConds = (r: FunnelFilter): string[] => {
  const col = filterValue(r.field);
  return (r.op === "in" ? [r.values] : r.values).map(
    (v) => `${filterColumn(r.field)} IS NOT NULL AND ${opMatch(r.op, col, v)}`,
  );
};

// A field the stream lacks is NULL on every row, so it matches nothing.
const filterMatch = (scope: AnalyticsScope, r: FunnelFilter): string =>
  has(scope, r.field) ? `(${anyOf(funnelFilterConds(r))})` : "(1 = 0)";

const rowFilterMatch = (scope: AnalyticsScope, r: FunnelFilter): string =>
  r.not ? `NOT ${filterMatch(scope, r)}` : filterMatch(scope, r);

// Identity and attribute values are missing from a session's first views, so they are checked per session.
const isSessionFilter = (r: FunnelFilter): boolean =>
  (IDENTITY_FIELDS as readonly string[]).includes(r.field) || !isBuiltinFilter(r.field);

const funnelFilters = (def: FunnelDef, perSession: boolean): FunnelFilter[] =>
  (def.f ?? []).filter((r) => isSessionFilter(r) === perSession);

/** Filter all steps on fields every row carries, as WHERE predicates so rows are pruned early. */
const funnelFilterKeeps = (scope: AnalyticsScope, def: FunnelDef): string =>
  funnelFilters(def, false)
    .map((r) => ` AND ${rowFilterMatch(scope, r)}`)
    .join("");

const sessionFilterWiden = (scope: AnalyticsScope, filters: FunnelFilter[]): string =>
  [...new Set(filters.map((r) => r.field))]
    .filter((f) => has(scope, f))
    .map((f) => ` OR ${filterColumn(f)} IS NOT NULL`)
    .join("");

const sessionFilterFlags = (scope: AnalyticsScope, filters: FunnelFilter[]): string[] =>
  filters.map((r, i) => `MAX(CASE WHEN ${filterMatch(scope, r)} THEN 1 ELSE 0 END) AS ki${i + 1}`);

// A negated filter keeps the sessions where no event ever matched.
const sessionFilterKeep = (r: FunnelFilter, flag: string): string => `${flag} = ${r.not ? 0 : 1}`;

const funnelPass = (scope: AnalyticsScope, def: FunnelDef): SessionPass | null => {
  const base = sessionPass(scope);
  const ids = funnelFilters(def, true);
  if (!ids.length) return base;
  const n = range1(ids.length);
  return {
    xi: [...(base ? [base.xi] : []), ...sessionFilterFlags(scope, ids)].join(", "),
    widen: `${base?.widen ?? ""}${sessionFilterWiden(scope, ids)}`,
    over: [...(base?.over ?? []), ...n.map((i) => `MAX(ki${i}) OVER (PARTITION BY sid) AS ks${i}`)],
    keep: [...(base?.keep ?? []), ...ids.map((r, i) => sessionFilterKeep(r, `ks${i + 1}`))],
  };
};

const filtered = (
  src: string,
  pass: SessionPass | null,
  where = "",
  newSince: number | null = null,
  alias = `${src}s`,
  unit = "sid",
): string => {
  const cols = [
    ...(pass?.over ?? []),
    ...(newSince !== null ? [`MIN(t0) OVER (PARTITION BY ${unit}) AS first_t`] : []),
  ];
  const conds = [...(pass?.keep ?? []), ...(newSince !== null ? [`first_t >= ${newSince}`] : [])];
  if (where) conds.push(conds.length ? `(${where})` : where);
  const from = cols.length ? `(SELECT *, ${cols.join(", ")} FROM ${src}) ${alias}` : src;
  return conds.length ? `${from} WHERE ${conds.join(" AND ")}` : from;
};

const pageMatch = (k: string, pages: PageRule[], tagged: boolean): string => {
  const text = tagged ? `substr(${k}, 3)` : k;
  const onPage = (cond: string) => (tagged ? `(starts_with(${k}, 'p:') AND ${cond})` : cond);
  const eqs = pages.filter((p) => p.op === "eq").map((p) => (tagged ? `p:${p.value}` : p.value));
  return [
    ...(eqs.length ? [`${k} IN (${lits(eqs)})`] : []),
    ...pages
      .filter((p) => p.op === "prefix")
      .map((p) => onPage(`starts_with(${text}, ${lit(p.value)})`)),
    ...pages
      .filter((p) => p.op === "regex")
      .map((p) => onPage(`regexp_like(${text}, ${lit(p.value)})`)),
  ].join(" OR ");
};

const ignoredPagePredicate = (k: string, pages: PageRule[], tagged = false): string =>
  `NOT (${pageMatch(k, pages, tagged)})`;

// Each compared app hides its own pages, so the rows carry their app.
const ignoredFilter = (scope: AnalyticsScope, keep: (pages: PageRule[]) => string): string => {
  const apps = scopeApps(scope);
  const pagesOf = (a: string) => settingsOf(scope, a)?.pages ?? [];
  if (!apps.some((a) => pagesOf(a).length)) return "";
  if (apps.length === 1) return keep(pagesOf(scope.app));
  const one = (a: string) =>
    pagesOf(a).length ? `(app = ${lit(a)} AND ${keep(pagesOf(a))})` : `app = ${lit(a)}`;
  return `(${apps.map(one).join(" OR ")})`;
};

const APP_COL = "MIN(application_id) AS app";

const comparing = (scope: AnalyticsScope): boolean => scopeApps(scope).length > 1;

export function identityExpr(id: IdentitySql): string {
  if (!IDENTITY_FIELDS.includes(id.field)) throw new Error(`Unknown identity field ${id.field}`);
  const u = `NULLIF(${id.field}, '')`;
  return id.excluded.length
    ? `CASE WHEN ${u} IN (${lits(id.excluded)}) THEN NULL ELSE ${u} END`
    : u;
}

const findEvent = (id: string, events: readonly NamedEvent[]): NamedEvent | undefined =>
  events.find((e) => e.id === id);

const MASK_TOKEN = /:(id|num|email|token)/;

const paramPattern = (name: string, value: string | undefined): string =>
  `[?#&]${escapeRegex(name)}${value === undefined ? "(=|&|#|$)" : `=${escapeRegex(value)}(&|#|$)`}`;

const refPattern = (host: string): string => `^https?://([^/]*\\.)?${escapeRegex(host)}(/|:|$)`;

const onPageAnd = (pk: string, onPage: string | undefined): string =>
  onPage ? ` AND ${pk} = ${lit(onPage)}` : "";

const rawRule = (rule: NamedRule, scope: AnalyticsScope): string => {
  const pk = pageKeyExpr("view_url", scope.schema);
  if (rule.t === "error")
    return has(scope, "error_message")
      ? `(type = 'error' AND ${opMatch(rule.op, "error_message", rule.value)}${onPageAnd(pk, rule.onPage)})`
      : "(1 = 0)";
  if (rule.t === "action") {
    if (!has(scope, "action_target_name")) return "(1 = 0)";
    const op = rule.op ?? "in";
    const value = rule.value ?? "";
    // A masked token never appears in the raw name, so only a literal value can prefilter.
    const pre =
      (op === "prefix" || op === "contains") && !MASK_TOKEN.test(value)
        ? ` AND strpos(action_target_name, ${lit(value)}) > 0`
        : "";
    const match = opMatch(op, clickKeyExpr("action_target_name"), rule.targets ?? value);
    return `(type = 'action' AND action_target_name <> ''${pre} AND ${match}${onPageAnd(pk, rule.onPage)})`;
  }
  if (rule.op === "param") {
    const pre = rule.value === undefined ? rule.name : `${rule.name}=`;
    return `(type = 'view' AND strpos(view_url, ${lit(pre)}) > 0 AND regexp_like(view_url, ${lit(paramPattern(rule.name, rule.value))})${onPageAnd(pk, rule.onPage)})`;
  }
  if (rule.op === "ref") {
    if (!has(scope, "view_referrer")) return "(1 = 0)";
    return `(type = 'view' AND strpos(view_referrer, ${lit(rule.value)}) > 0 AND regexp_like(view_referrer, ${lit(refPattern(rule.value))})${onPageAnd(pk, rule.onPage)})`;
  }
  if (rule.op === "eq") return stepPredicateRaw({ kind: "p", key: rule.value }, scope, []);
  if (rule.op === "prefix") {
    const pf = prefixPrefilter(rule.value, "view_url");
    return `(type = 'view' AND ${pf ? `${pf} AND ` : ""}starts_with(${pk}, ${lit(rule.value)}))`;
  }
  return `(type = 'view' AND regexp_like(${pk}, ${lit(rule.value)}))`;
};

const groupedRule = (rule: NamedRule, scope: AnalyticsScope): string => {
  const pk = pageKeyExpr("url", scope.schema, "vn");
  if (rule.t === "error")
    return `(ty = 'error' AND ${opMatch(rule.op, "em", rule.value)}${onPageAnd(pk, rule.onPage)})`;
  if (rule.t === "action")
    return `(ty = 'action' AND ${opMatch(rule.op ?? "in", "k", rule.targets ?? rule.value ?? "")}${onPageAnd(pk, rule.onPage)})`;
  if (rule.op === "param")
    return `(ty = 'view' AND regexp_like(url, ${lit(paramPattern(rule.name, rule.value))})${onPageAnd(pk, rule.onPage)})`;
  if (rule.op === "ref")
    return `(ty = 'view' AND regexp_like(ref, ${lit(refPattern(rule.value))})${onPageAnd(pk, rule.onPage)})`;
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
  if (step.kind === "r")
    return has(scope, "error_message")
      ? `(type = 'error' AND starts_with(error_message, ${lit(step.key)}))`
      : "(1 = 0)";
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
  if (step.kind === "r") return `ty = 'error' AND starts_with(em, ${lit(step.key)})`;
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
  const parts = [appScope(scope), "session_id IS NOT NULL"];
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

const sumWhen = (conds: string[], value: string, alias: string): string =>
  conds.length
    ? `SUM(CASE WHEN ${conds.join(" AND ")} THEN ${value} ELSE 0 END) AS ${alias}`
    : `SUM(${value}) AS ${alias}`;

// Every session stays in g with its rule flags, so one scan returns the total and the kept counts.
export function summarySql(scope: AnalyticsScope, currentStartUs: number): string {
  const cs = Math.trunc(currentStartUs);
  const ids = presentCandidates(scope);
  const xb = appFlag(
    scope,
    (ex) => {
      const keeps = builtinKeeps(scope, ex);
      return keeps.length ? [`NOT (${keeps.join(" AND ")})`] : [];
    },
    "MIN",
  );
  const xr = eitherFlag(
    appFlag(
      scope,
      (ex) => {
        const keeps = savedRules(scope, ex, false).flatMap(ruleKeeps);
        return keeps.length ? [`NOT (${keeps.join(" AND ")})`] : [];
      },
      "MIN",
    ),
    appFlag(scope, (ex) => savedRules(scope, ex, true).flatMap(ruleMatches)),
  );
  const tagged = ids.map(
    (f) =>
      `array_agg(DISTINCT CASE WHEN _timestamp >= ${cs} AND NULLIF(${f}, '') IS NOT NULL THEN ${lit(`${f}:`)} || ${f} END)`,
  );
  const g = [
    "session_id AS sid",
    `${xb} AS xb`,
    `${xr} AS xr`,
    `${has(scope, "session_type") ? "MAX(CASE WHEN session_type = 'synthetics' THEN 1 ELSE 0 END)" : "0"} AS syn`,
    `MAX(CASE WHEN _timestamp >= ${cs} THEN 1 ELSE 0 END) AS cur`,
    `MAX(CASE WHEN _timestamp < ${cs} THEN 1 ELSE 0 END) AS prv`,
    `COUNT(DISTINCT CASE WHEN _timestamp >= ${cs} AND type = 'view' THEN view_id END) AS views`,
    `COUNT(CASE WHEN _timestamp >= ${cs} AND type IN ('view', 'action') THEN 1 END) AS va`,
    "MAX(_timestamp) AS dt",
    ...ids.map(
      (f) =>
        `MAX(CASE WHEN _timestamp >= ${cs} AND NULLIF(${f}, '') IS NOT NULL THEN 1 ELSE 0 END) AS ${f}__has`,
    ),
    ...(ids.length
      ? [`${tagged.length > 1 ? `array_concat(${tagged.join(", ")})` : tagged[0]} AS ivs`]
      : []),
  ];
  // A session's values fan out to one row each; the appended NULL keeps a session without any.
  const first = ids.length ? ["rn = 1"] : [];
  const kept = ["xb = 0", "xr = 0"];
  const cols = [
    sumWhen([...first, "cur = 1", "syn = 0", ...kept], "1", "sessions"),
    sumWhen([...first, "prv = 1", "syn = 0", ...kept], "1", "prev_sessions"),
    sumWhen([...first, "cur = 1", "syn = 0"], "1", "total_sessions"),
    sumWhen([...first, "cur = 1", "syn = 0", "xb = 0"], "1", "builtin_kept_sessions"),
    sumWhen([...first, "syn = 0", ...kept], "views", "views"),
    sumWhen([...first, "syn = 0"], "va", "va_rows"),
    sumWhen([...first, "cur = 1", "syn = 1"], "1", "synthetic_sessions"),
    "MAX(dt) AS data_through_us",
    ...ids.flatMap((f) => [
      `COUNT(DISTINCT CASE WHEN ${kept.join(" AND ")} AND syn = 0 AND starts_with(v, ${lit(`${f}:`)}) THEN v END) AS ${f}__values`,
      `COUNT(DISTINCT CASE WHEN ${kept.join(" AND ")} AND syn = 0 AND ${f}__has = 1 THEN sid END) AS ${f}__sessions`,
    ]),
  ];
  const ctes = [
    `g AS (SELECT ${g.join(", ")} FROM "_rumdata" WHERE ${unfilteredScope(scope)} GROUP BY session_id)`,
    ...(ids.length
      ? [
          "gv AS (SELECT *, unnest(array_append(ivs, CAST(NULL AS VARCHAR))) AS v FROM g)",
          "gr AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY v) AS rn FROM gv)",
        ]
      : []),
  ];
  return withCtes(ctes, `SELECT ${cols.join(", ")} FROM ${ids.length ? "gr" : "g"} LIMIT 1`);
}

export function identityTopSql(scope: AnalyticsScope, field: IdentityField): string {
  const u = identityExpr({ field, excluded: [] });
  return withCtes(
    [
      `v AS (SELECT ${u} AS u, COUNT(DISTINCT session_id) AS s FROM "_rumdata" WHERE ${rowScope(scope)} AND type IN ('view','action') AND ${u} IS NOT NULL GROUP BY ${u})`,
      "r AS (SELECT u, s, SUM(s) OVER () AS total_s, COUNT(*) OVER () AS n_values FROM v)",
    ],
    "SELECT u, s, total_s, n_values FROM r ORDER BY s DESC, u LIMIT 3",
  );
}

/** A Filter all steps field's top values with their sessions, shaped like identityTopSql. */
export function filterValuesSql(scope: AnalyticsScope, field: FunnelFilter["field"]): string {
  if (!has(scope, field)) throw new Error(`Field ${field} is not in the stream`);
  const v = filterValue(field);
  return `SELECT ${v} AS v, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE ${rowScope(scope)} AND ${filterColumn(field)} IS NOT NULL AND ${v} <> '' GROUP BY ${v} ORDER BY sessions DESC, v LIMIT 20`;
}

/** Top browser and device families over the scope without any exclusion, for the likely-bot suggestions. */
export function userAgentSuggestionSql(scope: AnalyticsScope): string {
  const bare = { app: scope.app, env: scope.env, version: scope.version, schema: scope.schema };
  return `SELECT user_agent_user_agent_family AS ua, user_agent_device_family AS dev, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE ${scopeClause(bare)} GROUP BY user_agent_user_agent_family, user_agent_device_family ORDER BY sessions DESC LIMIT 15`;
}

/** Matched sessions of a draft event's rules, as one `e0_sessions` row; the preview always applies the exclusions. */
export function namedEventPreviewSql(
  scope: AnalyticsScope,
  event: Pick<NamedEvent, "rules">,
): string {
  const ruled = { ...scope, xall: false };
  const hit = event.rules.length
    ? `(${event.rules.map((r) => rawRule(r, ruled)).join(" OR ")})`
    : "FALSE";
  const pass = sessionPass(ruled);
  if (!pass)
    return `SELECT COUNT(DISTINCT session_id) AS e0_sessions FROM "_rumdata" WHERE ${scopeClause(ruled)} AND ${hit} LIMIT 1`;
  return withCtes(
    [
      `g AS (SELECT session_id AS sid, MAX(CASE WHEN ${hit} THEN 1 ELSE 0 END) AS hit, ${pass.xi} FROM "_rumdata" WHERE ${scopeClause(ruled)} AND (${hit}${pass.widen}) GROUP BY session_id)`,
    ],
    "SELECT COUNT(CASE WHEN hit = 1 THEN 1 END) AS e0_sessions FROM g WHERE xi = 0 LIMIT 1",
  );
}

// A query naming a field the stream lacks fails whole, so an absent field reads as NULL.
const viewCol = (scope: AnalyticsScope, field: string, type: "BIGINT" | "VARCHAR"): string =>
  has(scope, field) ? field : `CAST(NULL AS ${type})`;

const errorCol = (scope: AnalyticsScope): string =>
  has(scope, "error_message") ? "error_message" : "CAST(NULL AS VARCHAR)";

export function errorPickerSql(scope: AnalyticsScope, term?: string): string {
  const msg = errorCol(scope);
  const filter = term ? ` AND strpos(lower(${msg}), ${lit(term.toLowerCase())}) > 0` : "";
  const pass = sessionPass(scope);
  if (!pass)
    return `SELECT substr(${msg}, 1, 120) AS k, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE ${scopeClause(scope)} AND type = 'error'${filter} GROUP BY 1 ORDER BY sessions DESC LIMIT 50`;
  const k = `CASE WHEN type = 'error'${filter} THEN substr(${msg}, 1, 120) END`;
  return withCtes(
    [
      `e0 AS (SELECT session_id AS sid, ${k} AS k, ${pass.xi} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (type = 'error'${pass.widen}) GROUP BY session_id, ${k})`,
    ],
    `SELECT k, COUNT(DISTINCT sid) AS sessions FROM ${filtered("e0", pass, "k IS NOT NULL")} GROUP BY k ORDER BY sessions DESC LIMIT 50`,
  );
}

// The SDK records nothing about the clicked element, so a container is told apart by its name only.
export function unnamedClicksSql(scope: AnalyticsScope): string {
  const container = `regexp_like(${atnRawRef(scope)}, '-(${CONTAINER_SUFFIXES.join("|")})$')`;
  const pk = pageKeyExpr("view_url", scope.schema);
  const click = actionClickAnd(scope);
  const pass = sessionPass(scope);
  if (!pass)
    return `SELECT ${pk} AS pg, COUNT(*) AS clicks, COUNT(CASE WHEN ${container} THEN 1 END) AS unnamed FROM "_rumdata" WHERE ${scopeClause(scope)} AND ${click} GROUP BY 1 ORDER BY unnamed DESC LIMIT 20`;
  return withCtes(
    [
      `c0 AS (SELECT session_id AS sid, ${pk} AS pg, COUNT(CASE WHEN ${click} THEN 1 END) AS clicks, COUNT(CASE WHEN ${click} AND ${container} THEN 1 END) AS unnamed, ${pass.xi} FROM "_rumdata" WHERE ${scopeClause(scope)} AND ((${click})${pass.widen}) GROUP BY session_id, ${pk})`,
    ],
    `SELECT pg, SUM(clicks) AS clicks, SUM(unnamed) AS unnamed FROM ${filtered("c0", pass, "clicks > 0")} GROUP BY pg ORDER BY unnamed DESC LIMIT 20`,
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

// The page key is computed once per view, so the ignored-page filter runs before the entry/exit aggregate.
export function entryExitSql(
  scope: AnalyticsScope,
  currentStartUs: number,
  id: IdentitySql | null,
): string {
  const cs = Math.trunc(currentStartUs);
  const pass = sessionPass(scope);
  const app = comparing(scope);
  const u = id ? identityExpr(id) : null;
  // Identity rows join the view rows, so a view is told apart by its id and the rest dropped later.
  const mixed = !!u || !!pass;
  const vid = "CASE WHEN type = 'view' THEN view_id END";
  const v0 = [
    "session_id AS sid",
    ...(mixed ? [`${vid} AS vid`] : []),
    "MIN(_timestamp) AS ts",
    "MIN(date) AS t",
    "MIN(view_url) AS url",
    ...(has(scope, "view_name") ? ["MIN(view_name) AS vn"] : []),
    ...(app ? [APP_COL] : []),
    ...(u
      ? [`first_value(${u} ORDER BY CASE WHEN ${u} IS NULL THEN 1 ELSE 0 END, date) AS u0`]
      : []),
    ...(pass ? [pass.xi] : []),
  ];
  const rows = mixed
    ? `(type = 'view'${u ? ` OR ${u} IS NOT NULL` : ""}${pass?.widen ?? ""})`
    : "type = 'view'";
  const v1 = [
    "sid",
    ...(mixed ? ["vid"] : []),
    "ts",
    "t",
    `${pageKeyExpr("url", scope.schema, "vn")} AS k`,
    ...(app ? ["app"] : []),
    ...(u
      ? [
          "first_value(u0) OVER (PARTITION BY sid ORDER BY CASE WHEN u0 IS NULL THEN 1 ELSE 0 END, t) AS u",
        ]
      : []),
    ...(pass ? [PASS_XS] : []),
  ];
  const ignored = ignoredFilter(scope, (p) => ignoredPagePredicate("k", p));
  const keep = [
    ...(pass ? ["xs = 0"] : []),
    ...(mixed ? ["vid IS NOT NULL"] : []),
    "k IS NOT NULL",
    ...(ignored ? [ignored] : []),
  ];
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
      `v0 AS (SELECT ${v0.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND ${rows} GROUP BY session_id, ${mixed ? vid : "view_id"})`,
      `v1 AS (SELECT ${v1.join(", ")} FROM v0)`,
      `v AS (SELECT * FROM v1 WHERE ${keep.join(" AND ")})`,
      `s0 AS (SELECT sid, CASE WHEN MIN(ts) >= ${cs} THEN 1 ELSE 0 END AS ce, CASE WHEN MAX(ts) >= ${cs} THEN 1 ELSE 0 END AS cx, substr(MIN(CAST(t AS VARCHAR) || k), 14) AS fk, substr(MAX(CAST(t AS VARCHAR) || k), 14) AS lk${u ? ", MAX(u) AS u" : ""} FROM v GROUP BY sid)`,
      `s1 AS (SELECT sid${u ? ", u" : ""}, unnest(make_array(ce, cx)) AS cur, unnest(make_array(fk, lk)) AS k, unnest(make_array(1, 2)) AS side FROM s0)`,
      `g AS (SELECT k, ${agg.join(", ")} FROM s1 GROUP BY k)`,
    ],
    "SELECT *, entry_sessions + exit_sessions + prev_entry_sessions + prev_exit_sessions AS rank_key FROM g ORDER BY rank_key DESC, k LIMIT 1000",
  );
}

export function stepPickerSql(scope: AnalyticsScope, term?: string): string {
  const filter = term ? ` AND strpos(lower(k), ${lit(term.toLowerCase())}) > 0` : "";
  const groupKey = has(scope, "action_target_name") ? "action_target_name" : actionKey(scope);
  const pass = sessionPass(scope);
  const app = comparing(scope);
  const at = has(scope, "action_type");
  const cols = [
    "session_id AS sid",
    "type AS ty",
    "MIN(view_url) AS url",
    atnCol(scope),
    ...(has(scope, "view_name") ? ["MIN(view_name) AS vn"] : []),
    ...(at ? ["MIN(action_type) AS at"] : []),
    ...(app ? [APP_COL] : []),
    ...(pass ? [pass.xi] : []),
  ];
  const ignored = ignoredFilter(scope, (p) => `NOT (kind = 'p' AND (${pageMatch("k", p, false)}))`);
  return withCtes(
    [
      `e0 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (type = 'view' OR ${actionClickExpr(scope)}${pass?.widen ?? ""}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id ELSE ${groupKey} END)`,
      `e AS (SELECT sid, CASE WHEN ty = 'view' THEN 'p' ELSE 'c' END AS kind, CASE WHEN ty = 'view' THEN ${pageKeyExpr("url", scope.schema, "vn")} ELSE ${clickKeyExpr("atn")} END AS k${at ? ", at" : ""}${app ? ", app" : ""} FROM ${filtered("e0", pass)})`,
    ],
    `SELECT kind, k, COUNT(DISTINCT sid) AS sessions${at ? ", MIN(at) AS at" : ""} FROM e WHERE k IS NOT NULL AND k <> ''${ignored ? ` AND ${ignored}` : ""}${filter} GROUP BY kind, k ORDER BY sessions DESC, kind, k LIMIT ${term ? 50 : 200}`,
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
  const pass = sessionPass(scope);
  const app = comparing(scope);
  const cols = [
    "session_id AS sid",
    "type AS ty",
    `${c} AS cur`,
    "MIN(CASE WHEN type = 'view' THEN view_id END) AS vid",
    "MIN(CASE WHEN type = 'view' THEN view_url END) AS url",
    ...(has(scope, "view_name") ? ["MIN(CASE WHEN type = 'view' THEN view_name END) AS vn"] : []),
    ...(id ? identityGroupCols(id) : []),
    ...(app ? [APP_COL] : []),
    ...(pass ? [pass.xi] : []),
  ];
  const extra = `${id ? ` OR ${identityExpr(id)} IS NOT NULL` : ""}${pass?.widen ?? ""}`;
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
  const ignored = ignoredFilter(scope, (p) => ignoredPagePredicate("k", p));
  const appCol = app ? ", app" : "";
  return withCtes(
    [
      `v0 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (type = 'view'${extra}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id END, ${c})`,
      `v1 AS (SELECT sid, ty, cur, vid, url${has(scope, "view_name") ? ", vn" : ""}${id ? `, ${UID_WINDOW} AS u` : ""}${appCol} FROM ${filtered("v0", pass)})`,
      `v AS (SELECT ${pageKeyExpr("url", scope.schema, "vn")} AS k, sid, cur, vid${id ? ", u" : ""}${appCol} FROM v1 WHERE ty = 'view')`,
      `g AS (SELECT k, ${agg.join(", ")} FROM v WHERE k IS NOT NULL${ignored ? ` AND ${ignored}` : ""} GROUP BY k)`,
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
      `g AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${rowScope(scope)} AND ${actionClickAnd(scope)} GROUP BY ${ck})`,
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
  return `SELECT ${ck} AS k, ${pk} AS pg, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE ${rowScope(scope)} AND _timestamp >= ${Math.trunc(currentStartUs)} AND ${actionClickAnd(scope)} AND ${ck} IN (${lits(keys)}) GROUP BY ${ck}, ${pk} ORDER BY sessions DESC, k, pg LIMIT 2000`;
}

// With identity rules each session's rows group per bucket first, so the session pass can flag them.
const trendPassSql = (
  scope: AnalyticsScope,
  pass: SessionPass,
  histogram: string,
  cols: string[],
  rows: string,
  ys: string[],
  groupBy = "",
  keep = "",
): string => {
  const tail = "GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 1000";
  return withCtes(
    [
      `g AS (SELECT session_id AS sid, ${histogram} AS x_axis_1, ${[...cols, pass.xi].join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND ${rows} GROUP BY session_id, ${histogram}${groupBy})`,
    ],
    `SELECT x_axis_1, ${ys.join(", ")} FROM ${filtered("g", pass, keep)} ${tail}`,
  );
};

export function trendSql(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  interval: "1 day" | "1 week",
  tz: string,
  series: StepRef[],
  events: NamedEvent[],
): string {
  const histogram = `histogram(_timestamp, ${lit(interval === "1 week" ? "1 week" : "1 day")}, ${lit(tz)})`;
  const bucket = `${histogram} AS x_axis_1`;
  const tail = "GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 1000";
  const pass = sessionPass(scope);
  if (!series.length) {
    if (pass) {
      // Grouping by the identity value too counts every value a session-day carries.
      const u = id ? identityExpr(id) : null;
      const ys = [
        "COUNT(DISTINCT sid) AS y_axis_1",
        ...(u ? ["COUNT(DISTINCT u) AS y_axis_2"] : []),
      ];
      const va = "type IN ('view', 'action')";
      // Rows the pass widened in only flag the session; they never count as activity.
      const cols = [...(u ? [`${u} AS u`] : []), `MAX(CASE WHEN ${va} THEN 1 ELSE 0 END) AS va`];
      const rows = `(${va}${pass.widen})`;
      return trendPassSql(scope, pass, histogram, cols, rows, ys, u ? `, ${u}` : "", "va = 1");
    }
    const users = id
      ? `, COUNT(DISTINCT CASE WHEN type IN ('view', 'action') THEN ${identityExpr(id)} END) AS y_axis_2`
      : "";
    return `SELECT ${bucket}, COUNT(DISTINCT session_id) AS y_axis_1${users} FROM "_rumdata" WHERE ${scopeClause(scope)} AND type IN ('view', 'action') ${tail}`;
  }
  const preds = series.slice(0, 5).map((s) => stepPredicateRaw(s, scope, events));
  if (pass) {
    const cols = preds.map((p, i) => `MAX(CASE WHEN ${p} THEN 1 ELSE 0 END) AS y${i + 1}`);
    const ys = preds.map(
      (_, i) => `COUNT(DISTINCT CASE WHEN y${i + 1} = 1 THEN sid END) AS y_axis_${i + 1}`,
    );
    return trendPassSql(scope, pass, histogram, cols, `(${preds.join(" OR ")}${pass.widen})`, ys);
  }
  const ys = preds.map(
    (p, i) => `COUNT(DISTINCT CASE WHEN ${p} THEN session_id END) AS y_axis_${i + 1}`,
  );
  return `SELECT ${bucket}, ${ys.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (${preds.join(" OR ")}) ${tail}`;
}

export function activeUsersSql(scope: AnalyticsScope, id: IdentitySql, endUs: number): string {
  const u = identityExpr(id);
  const end = Math.trunc(endUs);
  return `SELECT COUNT(DISTINCT CASE WHEN _timestamp >= ${end - DAY_US} THEN ${u} END) AS dau, COUNT(DISTINCT CASE WHEN _timestamp >= ${end - 7 * DAY_US} THEN ${u} END) AS wau, COUNT(DISTINCT ${u}) AS mau FROM "_rumdata" WHERE ${rowScope(scope)} AND type IN ('view', 'action') AND ${u} IS NOT NULL LIMIT 1`;
}

const actionKey = (scope: AnalyticsScope): string =>
  has(scope, "action_id") ? "COALESCE(action_id, CAST(date AS VARCHAR))" : "CAST(date AS VARCHAR)";

const groupKey = (scope: AnalyticsScope, errors: boolean): string =>
  `CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN ${actionKey(scope)} ${errors ? "WHEN type = 'error' THEN CAST(date AS VARCHAR) " : ""}ELSE type END`;

const unique = (items: string[]): string[] => [...new Set(items)];

const stepEvents = (steps: StepRef[], events: NamedEvent[]): NamedEvent[] =>
  steps.flatMap((s) =>
    s.kind === "e" ? [findEvent(s.key, events)].filter((e): e is NamedEvent => !!e) : [],
  );

const eventRules = (steps: StepRef[], events: NamedEvent[]): NamedRule[] =>
  stepEvents(steps, events).flatMap((e) => e.rules);

const hasCond = (steps: StepRef[], t: ViewCond["t"]): boolean =>
  steps.some((s) => s.f?.vc?.some((c) => c.t === t));

// On-page and URL parameter rules read the row's own URL, so the grouped rows must keep it.
const needsUrl = (steps: StepRef[], events: NamedEvent[]): boolean =>
  hasCond(steps, "param") ||
  eventRules(steps, events).some(
    (r) => ("onPage" in r && !!r.onPage) || (r.t === "view" && r.op === "param"),
  );

const needsRef = (steps: StepRef[], events: NamedEvent[]): boolean =>
  hasCond(steps, "ref") || eventRules(steps, events).some((r) => r.t === "view" && r.op === "ref");

const actionRowPredicates = (
  scope: AnalyticsScope,
  steps: StepRef[],
  events: NamedEvent[],
): string[] =>
  unique([
    ...steps.filter((s) => s.kind === "c").map((s) => stepPredicateRaw(s, scope, events)),
    ...eventRules(steps, events)
      .filter((r) => r.t === "action")
      .map((r) => rawRule(r, scope)),
  ]);

const errorRowPredicates = (
  scope: AnalyticsScope,
  steps: StepRef[],
  events: NamedEvent[],
): string[] =>
  unique([
    ...steps.filter((s) => s.kind === "r").map((s) => stepPredicateRaw(s, scope, events)),
    ...eventRules(steps, events)
      .filter((r) => r.t === "error")
      .map((r) => rawRule(r, scope)),
  ]);

const errorKeepPredicates = (
  scope: AnalyticsScope,
  steps: StepRef[],
  events: NamedEvent[],
): string[] =>
  unique([
    ...steps
      .filter((s) => s.kind === "r")
      .map((s) => `(${stepPredicateGrouped(s, scope, events)})`),
    ...eventRules(steps, events)
      .filter((r) => r.t === "error")
      .map((r) => groupedRule(r, scope)),
  ]);

const viewKeepPredicates = (
  scope: AnalyticsScope,
  steps: StepRef[],
  events: NamedEvent[],
): string[] => {
  const pk = pageKeyExpr("url", scope.schema, "vn");
  const eq = (key: string) => `(${urlPrefilter(key, "url")} AND ${pk} = ${lit(key)})`;
  const fromRules = eventRules(steps, events).flatMap((r) => {
    if (r.t !== "view") return [];
    if (r.op === "eq") return [eq(r.value)];
    if (r.op === "prefix") {
      const pf = prefixPrefilter(r.value, "url");
      return [`(${pf ? `${pf} AND ` : ""}starts_with(${pk}, ${lit(r.value)}))`];
    }
    if (r.op === "regex") return [`regexp_like(${pk}, ${lit(r.value)})`];
    return [groupedRule(r, scope)];
  });
  return unique([...steps.filter((s) => s.kind === "p").map((s) => eq(s.key)), ...fromRules]);
};

interface Exclusion {
  j: number;
  e: ExclusionStep;
}

const exclusionsOf = (def: FunnelDef): Exclusion[] =>
  (def.x ?? []).map((e, i) => ({ j: i + 1, e }));

const betweenOf = (def: FunnelDef): Exclusion[] =>
  exclusionsOf(def).filter((x) => x.e.b !== undefined);

const withinOf = (def: FunnelDef): Exclusion[] =>
  exclusionsOf(def).filter((x) => x.e.b === undefined);

// Exclusion rows enter the scan like steps, but never the sequence conditions.
const scannedSteps = (def: FunnelDef): StepRef[] => [
  ...def.steps,
  ...(def.x ?? []).map((e) => e.step),
];

const flag = (pred: string, alias: string): string =>
  `CASE WHEN ${pred} THEN 1 ELSE 0 END AS ${alias}`;

// A grouped view row keeps its URL as `url` and its referrer as `ref`, as the named-event rules read them.
const viewCondGrouped = (c: ViewCond, scope: AnalyticsScope): string => {
  if (c.t === "ref" && !has(scope, "view_referrer")) return "(1 = 0)";
  const hits = c.values.map((v) =>
    c.t === "param"
      ? `regexp_like(url, ${lit(paramPattern(c.key, v))})`
      : `regexp_like(ref, ${lit(refPattern(v))})`,
  );
  return hits.length === 1 ? `(${hits[0]})` : anyOf(hits);
};

/** A view condition on raw rows, prefiltered like the named-event param and referrer rules. */
export function viewCondRaw(c: ViewCond, scope: AnalyticsScope): string {
  if (c.t === "param") {
    const hits = c.values.map((v) => `regexp_like(view_url, ${lit(paramPattern(c.key, v))})`);
    return `(strpos(view_url, ${lit(`${c.key}=`)}) > 0 AND ${anyOf(hits)})`;
  }
  if (!has(scope, "view_referrer")) return "(1 = 0)";
  const hits = c.values.map(
    (v) =>
      `(strpos(view_referrer, ${lit(v)}) > 0 AND regexp_like(view_referrer, ${lit(refPattern(v))}))`,
  );
  return `(${anyOf(hits)})`;
}

// view_time_spent is in nanoseconds.
const filterConds = (f: StepFilters | undefined, scope: AnalyticsScope): string =>
  [
    ...(f?.minMs !== undefined ? [`vts >= ${f.minMs * 1000000}`] : []),
    ...(f?.frustrated ? ["vf = 1"] : []),
    ...(f?.errored ? ["ve = 1"] : []),
    ...(f?.vc ?? []).map((c) => viewCondGrouped(c, scope)),
  ]
    .map((c) => ` AND ${c}`)
    .join("");

const stepFlags = (
  scope: AnalyticsScope,
  def: FunnelDef,
  events: NamedEvent[],
  ungated: boolean,
): string => {
  const step = (s: StepRef) =>
    `${stepPredicateGrouped(s, scope, events)}${filterConds(s.f, scope)}`;
  const near = (i: number, except = 0) =>
    withinOf(def)
      .filter((x) => x.e.a === i && x.j !== except)
      .map((x) => ` AND (nx${x.j} IS NULL OR nx${x.j} - t > ${x.e.withinMs})`)
      .join("");
  return [
    ...def.steps.map((s, i) => flag(`${step(s)}${near(i + 1)}`, `m${i + 1}`)),
    ...betweenOf(def).map((x) => flag(stepPredicateGrouped(x.e.step, scope, events), `mx${x.j}`)),
    // Each gate is lifted alone, so a unit removed by another within exclusion is not counted here.
    ...(ungated
      ? withinOf(def).map((x) =>
          flag(`${step(def.steps[x.e.a - 1])}${near(x.e.a, x.j)}`, `ma${x.j}`),
        )
      : []),
  ].join(", ");
};

const scanCols = (scope: AnalyticsScope, def: FunnelDef, events: NamedEvent[]): string[] => {
  const f = def.steps.map((s) => s.f);
  const all = scannedSteps(def);
  return [
    ...(f.some((x) => x?.minMs !== undefined)
      ? [`MAX(${viewCol(scope, "view_time_spent", "BIGINT")}) AS vts`]
      : []),
    ...(f.some((x) => x?.frustrated)
      ? [
          `CASE WHEN MAX(${viewCol(scope, "view_frustration_count", "BIGINT")}) > 0 THEN 1 ELSE 0 END AS vf`,
        ]
      : []),
    ...(f.some((x) => x?.errored)
      ? [
          `CASE WHEN MAX(${viewCol(scope, "view_error_count", "BIGINT")}) > 0 THEN 1 ELSE 0 END AS ve`,
        ]
      : []),
    ...(errorRowPredicates(scope, all, events).length ? [`MIN(${errorCol(scope)}) AS em`] : []),
    ...(needsRef(all, events) ? [`MIN(${viewCol(scope, "view_referrer", "VARCHAR")}) AS ref`] : []),
  ];
};

const colAlias = (col: string): string => col.slice(col.lastIndexOf(" AS ") + 4);

// The RANGE frame counts an exclusion row that ties the step row on t.
const withinCtes = (scope: AnalyticsScope, def: FunnelDef, events: NamedEvent[]): string[] => {
  const near = withinOf(def);
  if (!near.length) return [];
  const flags = near.map((x) => flag(stepPredicateGrouped(x.e.step, scope, events), `mx${x.j}`));
  const next = near.map(
    (x) =>
      `MIN(CASE WHEN mx${x.j} = 1 THEN t END) OVER (PARTITION BY sid ORDER BY t RANGE BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS nx${x.j}`,
  );
  return [
    `x0f AS (SELECT *, ${flags.join(", ")} FROM x0)`,
    `x1a AS (SELECT *, ${next.join(", ")} FROM x0f)`,
  ];
};

const range1 = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

const stepConds = (n: number): string =>
  range1(n)
    .map((i) => `m${i} = 1`)
    .join(", ");

const exAgg = (j: number): string =>
  `MAX(CASE WHEN mx${j} = 1 AND t > ta${j} AND t < tb${j} THEN 1 ELSE 0 END)`;

// A window bounds the span to the converting chain: step a's latest reach before b, not its first.
const spanCtes = (
  names: [string, string, string],
  src: string,
  partition: string,
  windowMs: number | null,
  n: number,
  between: Exclusion[],
): string[] => {
  const [w, r0, r] = names;
  const over = `OVER (PARTITION BY ${partition})`;
  const conds = stepConds(n);
  const matches = between.flatMap(({ j, e }) => [
    `sequence_step_match(${windowMs ?? 0}, ${e.a}, t, ${conds}) ${over} AS va${j}`,
    `sequence_step_match(${windowMs ?? 0}, ${e.b}, t, ${conds}) ${over} AS vb${j}`,
  ]);
  const tb = between.map(({ j }) => `MIN(CASE WHEN vb${j} THEN t END) ${over} AS tb${j}`);
  const first = `${w} AS (SELECT *, ${matches.join(", ")} FROM ${src})`;
  if (!windowMs) {
    const ta = between.map(({ j }) => `MIN(CASE WHEN va${j} THEN t END) ${over} AS ta${j}`);
    return [first, `${r} AS (SELECT *, ${[...ta, ...tb].join(", ")} FROM ${w})`];
  }
  const ta = between.map(
    ({ j }) =>
      `MAX(CASE WHEN va${j} AND t < tb${j} AND t >= tb${j} - ${windowMs} THEN t END) ${over} AS ta${j}`,
  );
  return [
    first,
    `${r0} AS (SELECT *, ${tb.join(", ")} FROM ${w})`,
    `${r} AS (SELECT *, ${ta.join(", ")} FROM ${r0})`,
  ];
};

// One window stage replaces the n-1 chain windows: the partition's depth and whether a row is a matched step k.
const sequenceCtes = (
  n: number,
  partition: string,
  windowMs: number | null,
  k: number,
  src: string,
  between: Exclusion[],
): string[] => {
  const conds = stepConds(n);
  const w = windowMs ?? 0;
  const over = `OVER (PARTITION BY ${partition})`;
  const ex = between.map(({ j }) => `, ${exAgg(j)} ${over} AS ex${j}`).join("");
  const gate = (i: number) =>
    between
      .filter((x) => (x.e.b ?? 0) <= i)
      .map((x) => ` AND ex${x.j} = 0`)
      .join("");
  const next =
    k < n ? `, CASE WHEN wr >= ${k + 1}${gate(k + 1)} THEN 1 ELSE 0 END AS v${k + 1}` : "";
  return [
    `w AS (SELECT *, sequence_depth(${w}, t, ${conds}) ${over} AS wr, sequence_step_match(${w}, ${k}, t, ${conds}) ${over} AS wv${ex} FROM ${src})`,
    `v AS (SELECT *, CASE WHEN wv${gate(k)} THEN 1 ELSE 0 END AS v${k}${next} FROM w)`,
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

interface FunnelParts {
  n1: number[];
  between: Exclusion[];
  within: Exclusion[];
  windowMs: number | null;
}

const fromStepTimes = (p: FunnelParts, xrInSource: boolean): string[] => {
  const gate = (i: number) =>
    p.between
      .filter((x) => (x.e.b ?? 0) <= i)
      .map((x) => `ex${x.j} = 0`)
      .join(" AND ");
  const reach = (i: number) =>
    `CASE WHEN f[${i}] IS NOT NULL${gate(i) ? ` AND ${gate(i)}` : ""} THEN 1 ELSE 0 END AS r${i}`;
  const dur = (i: number) => (gate(i) ? `CASE WHEN ${gate(i)} THEN f[${i}] END` : `f[${i}]`);
  return [
    ...p.n1.map(reach),
    ...p.n1.slice(1).map((i) => `${dur(i)} AS d${i}`),
    ...p.n1.map((i) => `seen${i}`),
    ...p.between.map(({ j, e }) =>
      xrInSource
        ? `xr${j}`
        : `CASE WHEN f[${e.b}] IS NOT NULL AND ex${j} = 1 THEN 1 ELSE 0 END AS xr${j}`,
    ),
    ...p.within.map(
      ({ j, e }) =>
        `CASE WHEN g${j}[${e.a}] IS NOT NULL AND f[${e.a}] IS NULL THEN 1 ELSE 0 END AS xr${j}`,
    ),
  ];
};

// Step a's chain without its within-N gate, so the gate's removals can be counted.
const ungatedTimes = (p: FunnelParts): string[] =>
  p.within.map(
    ({ j, e }) =>
      `sequence_step_times(${p.windowMs ?? 0}, t, ${range1(e.a)
        .map((i) => (i === e.a ? `ma${j} = 1` : `m${i} = 1`))
        .join(", ")}) AS g${j}`,
  );

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
  const all = scannedSteps(def);
  const url = needsUrl(all, events);
  const vnAvail = has(scope, "view_name");
  const pass = funnelPass(scope, def);
  const extra = scanCols(scope, def, events);
  const errors = errorRowPredicates(scope, all, events);
  const newSince = users ? (scope.newSince ?? null) : null;
  const p: FunnelParts = {
    n1: range1(n),
    between: betweenOf(def),
    within: withinOf(def),
    windowMs,
  };
  const cols = [
    "session_id AS sid",
    "type AS ty",
    "MIN(date) AS t",
    "MIN(view_url) AS url",
    atnCol(scope),
    ...(users && id ? identityGroupCols(id) : []),
    ...(dim ? [`MIN(${dim}) AS dim`] : []),
    ...(vnAvail ? ["MIN(view_name) AS vn"] : []),
    ...extra,
    ...(newSince !== null ? ["MIN(date) AS t0"] : []),
    ...(pass ? [pass.xi] : []),
  ];
  const rowFilter = [
    "type = 'view'",
    ...actionRowPredicates(scope, all, events),
    ...errors,
    ...(users ? [`${u} IS NOT NULL`] : []),
  ].join(" OR ");
  const keep = viewKeepPredicates(scope, all, events).join(" OR ") || "FALSE";
  const k = `CASE WHEN ty = 'view' THEN ${pageKeyExpr("url", scope.schema, "vn")} WHEN ty = 'action' THEN ${clickKeyExpr("atn")} END AS k`;
  const carry = [
    ...(users ? ["u0", "ut"] : []),
    ...(dim ? ["dim"] : []),
    ...(url ? ["url"] : []),
    ...(url && vnAvail ? ["vn"] : []),
    ...extra.map(colAlias),
    ...(newSince !== null ? ["t0"] : []),
  ];
  const errorKeep = errorKeepPredicates(scope, all, events)
    .map((e) => ` OR ${e}`)
    .join("");
  const x0Where = `ty = 'action' OR (ty = 'view' AND (${keep}))${errorKeep}${users ? " OR u0 IS NOT NULL" : ""}`;
  const near = withinCtes(scope, def, events);
  const ctes = [
    `x00 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)}${funnelFilterKeeps(scope, def)} AND (${rowFilter}${pass?.widen ?? ""}) GROUP BY session_id, type, ${groupKey(scope, errors.length > 0)})`,
    `x0 AS (SELECT sid, t, ty, ${k}${carry.map((c) => `, ${c}`).join("")} FROM ${filtered("x00", pass, x0Where)})`,
    ...near,
    `x1 AS (SELECT sid, t, ty, k${dim ? ", dim" : ""}, ${stepFlags(scope, def, events, true)}, ${users ? `${UID_WINDOW} AS uid` : "CAST(NULL AS VARCHAR) AS uid"}${newSince !== null ? ", t0" : ""} FROM ${near.length ? "x1a" : "x0"})`,
  ];
  let source = "x1";
  if (users) {
    const flags = [
      ...p.n1.map((i) => `m${i}`),
      ...p.between.map((x) => `mx${x.j}`),
      ...p.within.map((x) => `ma${x.j}`),
    ];
    const x2Cols = ["sid", "t", "ty", "k", ...(dim ? ["dim"] : []), ...flags, "uid"];
    const rows = flags.map((f) => `${f} = 1`).join(" OR ");
    if (newSince !== null)
      ctes.push(
        "fs AS (SELECT *, MIN(t0) OVER (PARTITION BY COALESCE(uid, 's:' || sid)) AS first_t FROM x1)",
      );
    ctes.push(
      `x2 AS (SELECT ${x2Cols.join(", ")} FROM ${newSince !== null ? `fs WHERE (${rows}) AND first_t >= ${newSince}` : `x1 WHERE ${rows}`})`,
    );
    source = "x2";
  }
  if (p.between.length) {
    ctes.push(...spanCtes(["w", "r0", "r"], source, partition, windowMs, n, p.between));
    source = "r";
  }
  const f = `sequence_step_times(${windowMs ?? 0}, t, ${stepConds(n)}) AS f`;
  const exs = p.between.map((x) => `${exAgg(x.j)} AS ex${x.j}`);
  const seen = p.n1.map((i) => `SUM(m${i}) AS seen${i}`);
  const firstDim = "first_value(dim ORDER BY CASE WHEN m1 = 1 THEN 0 ELSE 1 END, t) AS dim";
  if (users && windowMs) {
    // A windowed sequence spans the user's sessions, so it aggregates the user's rows directly.
    const su = [
      "CASE WHEN uid IS NULL THEN 1 ELSE 0 END AS anon",
      f,
      ...ungatedTimes(p),
      ...exs,
      // ex needs tb, the unit's reach of step b, so a flagged unit is one removed at b.
      ...p.between.map((x) => `${exAgg(x.j)} AS xr${x.j}`),
      ...seen,
      "COUNT(DISTINCT CASE WHEN m1 = 1 THEN sid END) AS s1s",
      ...(dim ? [firstDim] : []),
    ];
    ctes.push(
      `su AS (SELECT ${su.join(", ")} FROM ${source} GROUP BY ${partition}, CASE WHEN uid IS NULL THEN 1 ELSE 0 END)`,
      `pu AS (SELECT anon, ${[...fromStepTimes(p, true), "s1s", ...(dim ? ["dim"] : [])].join(", ")} FROM su)`,
    );
    return { ctes, users };
  }
  const dimCols = dim ? [firstDim, "MIN(CASE WHEN m1 = 1 THEN t END) AS t1"] : [];
  ctes.push(
    `s AS (SELECT ${["sid", "MAX(uid) AS uid", f, ...ungatedTimes(p), ...exs, ...seen, ...dimCols].join(", ")} FROM ${source} GROUP BY sid)`,
    `ps AS (SELECT ${["sid", "uid", ...fromStepTimes(p, false), ...(dim ? ["dim", "t1"] : [])].join(", ")} FROM s)`,
  );
  if (users) {
    const pu = [
      "CASE WHEN uid IS NULL THEN 1 ELSE 0 END AS anon",
      ...p.n1.map((i) => `MAX(r${i}) AS r${i}`),
      ...p.n1.slice(1).map((i) => `MIN(d${i}) AS d${i}`),
      ...p.n1.map((i) => `SUM(seen${i}) AS seen${i}`),
      "SUM(r1) AS s1s",
      // A user who converted cleanly in any session is not counted as removed.
      ...exclusionsOf(def).map(
        ({ j, e }) => `CASE WHEN MAX(r${e.b ?? e.a}) = 0 THEN MAX(xr${j}) ELSE 0 END AS xr${j}`,
      ),
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
  // Every scope already filters on application_id, so the stream always has it.
  return field && (field === "application_id" || has(scope, field)) ? field : null;
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
  const xr = exclusionsOf(def).map(({ j }) => j);
  if (dim) {
    const cnt = [
      ...range1(n).map((i) => `SUM(r${i}) AS c${i}`),
      ...xr.map((j) => `SUM(xr${j}) AS xr${j}`),
    ];
    return withCtes(
      ctes,
      `SELECT dim, ${cnt.join(", ")} FROM ${users ? "pu WHERE anon = 0" : "ps"} GROUP BY dim ORDER BY c1 DESC, dim LIMIT 1000`,
    );
  }
  const cnt = range1(n).map((i) =>
    users ? `SUM(CASE WHEN anon = 0 THEN r${i} ELSE 0 END) AS c${i}` : `SUM(r${i}) AS c${i}`,
  );
  const seen = range1(n).map((i) => `SUM(seen${i}) AS seen${i}`);
  const removed = xr.map((j) =>
    users ? `SUM(CASE WHEN anon = 0 THEN xr${j} ELSE 0 END) AS xr${j}` : `SUM(xr${j}) AS xr${j}`,
  );
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
    `SELECT ${[...cnt, ...seen, ...removed, ...extra, ...pcts].join(", ")} FROM ${users ? "pu" : "ps"} LIMIT 1`,
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

/** Sessions that opened step 1 (`opened`) and those of them inside Filter all steps (`kept`), for "Why N?". */
export function whyEnteredSql(scope: AnalyticsScope, def: FunnelDef, opts: BuildOpts): string {
  const s1 = def.steps[0];
  const conds = (s1.f?.vc ?? []).map((c) => ` AND ${viewCondRaw(c, scope)}`).join("");
  const opened = `(${stepPredicateRaw(s1, scope, opts.events)}${conds})`;
  const keeps = funnelFilters(def, false).map((r) => rowFilterMatch(scope, r));
  const kept = [opened, ...keeps].join(" AND ");
  const base = sessionPass(scope);
  const ids = funnelFilters(def, true);
  const widen = `${base?.widen ?? ""}${sessionFilterWiden(scope, ids)}`;
  const g = [
    "session_id AS sid",
    `MAX(CASE WHEN ${opened} THEN 1 ELSE 0 END) AS o1`,
    `MAX(CASE WHEN ${kept} THEN 1 ELSE 0 END) AS k1`,
    ...sessionFilterFlags(scope, ids),
    ...(base ? [base.xi] : []),
  ];
  const inFilter = ["k1 = 1", ...ids.map((r, i) => sessionFilterKeep(r, `ki${i + 1}`))].join(
    " AND ",
  );
  return withCtes(
    [
      `g AS (SELECT ${g.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope, opts.sample)} AND (${opened}${widen}) GROUP BY session_id)`,
    ],
    `SELECT SUM(o1) AS opened, SUM(CASE WHEN ${inFilter} THEN 1 ELSE 0 END) AS kept FROM g${base ? " WHERE xi = 0" : ""} LIMIT 1`,
  );
}

/** The scope stored SQL compiles with: the app and its filters, never the page's env, version, compared apps or new users. */
export function storedFunnelScope(scope: AnalyticsScope): AnalyticsScope {
  return {
    app: scope.app,
    env: [],
    version: [],
    schema: scope.schema,
    ...(scope.exclusions ? { exclusions: scope.exclusions } : {}),
  };
}

interface FullChainOpts {
  errors: boolean;
  label: boolean;
  sample: SampleRatio;
  // Funnel drill-ins follow the funnel, which keeps new users in Users mode only; cohort paths always do.
  newUsers: boolean;
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
  const newSince = o.newUsers && id ? (scope.newSince ?? null) : null;
  const idf = !!id && (users || o.label || newSince !== null);
  const frustration = o.errors && has(scope, "action_frustration_type");
  const all = scannedSteps(def);
  const url = needsUrl(all, events);
  const vnAvail = has(scope, "view_name");
  const pass = funnelPass(scope, def);
  const extra = scanCols(scope, def, events);
  const app = comparing(scope);
  const between = betweenOf(def);
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
    ...extra,
    ...(newSince !== null ? ["MIN(date) AS t0"] : []),
    ...(app ? [APP_COL] : []),
    ...(pass ? [pass.xi] : []),
  ];
  const types = o.errors ? "'view', 'error'" : "'view'";
  const errorRows = errorRowPredicates(scope, all, events)
    .map((e) => ` OR ${e}`)
    .join("");
  const identityRows = idf && id ? ` OR ${identityExpr(id)} IS NOT NULL` : "";
  const k = `CASE WHEN ty = 'view' THEN ${pageKeyExpr("url", scope.schema, "vn")} WHEN ty = 'action' THEN ${clickKeyExpr("atn")} END AS k`;
  const fr = frustration ? ", fr" : "";
  const carry = [
    ...(url ? ["url"] : []),
    ...(url && vnAvail ? ["vn"] : []),
    ...extra.map(colAlias),
    ...(newSince !== null ? ["t0"] : []),
    ...(app ? ["app"] : []),
  ]
    .map((c) => `, ${c}`)
    .join("");
  const near = withinCtes(scope, def, events);
  const ctes = [
    `x00 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope, users ? 1 : o.sample)}${funnelFilterKeeps(scope, def)} AND (type IN (${types}) OR ${actionClickExpr(scope)}${errorRows}${identityRows}${pass?.widen ?? ""}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN ${actionKey(scope)} WHEN type = 'error' THEN CAST(date AS VARCHAR) ELSE type END)`,
    idf
      ? `x0 AS (SELECT sid, ty, t, hr${fr}, u0, ut${carry}, ${k} FROM ${filtered("x00", pass)})`
      : `x0 AS (SELECT sid, ty, t, hr${fr}${carry}, ${k} FROM ${filtered("x00", pass, "ty IN ('view', 'action', 'error')")})`,
    ...near,
    `x1 AS (SELECT sid, ty, t, hr${fr}, k${app ? ", app" : ""}, ${stepFlags(scope, def, events, false)}, ${idf ? `${UID_WINDOW} AS uid` : "CAST(NULL AS VARCHAR) AS uid"}${newSince !== null ? ", t0" : ""} FROM ${near.length ? "x1a" : "x0"})`,
    newSince !== null
      ? `x2 AS (SELECT * FROM (SELECT *, MAX(m1) OVER (PARTITION BY ${partition}) AS h1, MIN(t0) OVER (PARTITION BY COALESCE(uid, 's:' || sid)) AS first_t FROM x1) q WHERE h1 = 1 AND first_t >= ${newSince} AND ty IN ('view', 'action', 'error'))`
      : `x2 AS (SELECT * FROM (SELECT *, MAX(m1) OVER (PARTITION BY ${partition}) AS h1 FROM x1) q WHERE h1 = 1 AND ty IN ('view', 'action', 'error'))`,
    ...(between.length
      ? spanCtes(["xw", "xr0", "xrr"], "x2", partition, windowMs, def.steps.length, between)
      : []),
    ...sequenceCtes(
      def.steps.length,
      partition,
      windowMs,
      stepK,
      between.length ? "xrr" : "x2",
      between,
    ),
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
    { errors: false, label: false, sample: opts.sample, newUsers: def.unit === "users" },
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
  // Paths counts its cohort as its Sankey does, which keeps new users whatever the funnel's unit.
  newUsers = def.unit === "users",
): string {
  const k = stepIndex;
  const { ctes, unit, windowMs, frustration } = fullChainCtes(
    scope,
    id,
    def,
    opts.events,
    { errors: true, label: false, sample: opts.sample, newUsers },
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
    { errors: true, label: true, sample: opts.sample, newUsers: cohort.funnel.unit === "users" },
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
const pathTail = (
  def: PathsDef,
  attrs: boolean,
  anchor: string,
  ignored: string,
  uid: boolean,
): string[] => {
  // Ignored pages drop out before the LAG dedup, so A, ignored, A reads as one A.
  const where = ignored ? ` WHERE ${attrs ? `key IS NULL OR ${ignored}` : ignored}` : "";
  const d = attrs
    ? `d AS (SELECT *, LAG(key) OVER (PARTITION BY sid, CASE WHEN ty = 'error' THEN 1 ELSE 0 END ORDER BY t, key) AS pk, SUM(CASE WHEN ty = 'error' THEN 1 ELSE 0 END) ${ATTR_WINDOW} AS errors, MIN(t) ${ATTR_WINDOW} AS started, MAX(t) ${ATTR_WINDOW} AS ended, MAX(hr) ${ATTR_WINDOW} AS has_replay FROM e${where})`
    : `d AS (SELECT *, LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk FROM e${where})`;
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
          `${uid ? "MAX(uid)" : "CAST(NULL AS VARCHAR)"} AS user_label`,
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

const pathIgnored = (scope: AnalyticsScope): string =>
  ignoredFilter(scope, (p) => ignoredPagePredicate("key", p, true));

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
    { errors: attrs, label: attrs, sample: opts.sample, newUsers: true },
    k,
  );
  const uid = attrs && !!id;
  const include = attrs
    ? `(${GROUPED_INCLUDE[def.include]} OR ty = 'error')`
    : GROUPED_INCLUDE[def.include];
  const app = comparing(scope) ? ", app" : "";
  // Per session tk already is the step time; a user's first reach can sit in another session.
  const stepT =
    unit === "sid" ? "tk" : `MIN(CASE WHEN v${k} = 1 THEN t END) OVER (PARTITION BY sid)`;
  const uidCol = uid ? ", uid" : "";
  // A sessions chain admits unnamed clicks only for their identity; the users chain already had them in the Sankey.
  const unnamed = uid && unit === "sid" ? " AND (ty <> 'action' OR COALESCE(k, '') <> '')" : "";
  return [
    ...ctes,
    reachCte(unit, k, true),
    `cr AS (SELECT sid, t, ty, hr, k${app}${uidCol}, ${stepT} AS step_t FROM r WHERE rk = 1 AND rk1 = 0)`,
    `e AS (SELECT sid, t, ty, hr, step_t${app}${uidCol}, CASE WHEN ty = 'view' THEN 'p:' || k WHEN ty = 'action' THEN 'c:' || k END AS key FROM cr WHERE step_t IS NOT NULL AND ${include}${unnamed})`,
    ...pathTail(def, attrs, "MAX(CASE WHEN t <= step_t THEN n END)", pathIgnored(scope), uid),
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
  const include = attrs
    ? `(${pathsIncludeExpr(scope, def.include)} OR type = 'error')`
    : pathsIncludeExpr(scope, def.include);
  // "all" already covers both kinds, and a "pages"/"clicks" filter already covers a same-kind
  // anchor. Otherwise (e.g. a page anchor under "Clicks") the anchor's own event must be let
  // through regardless, or it can never be found as "reached" downstream.
  const anchorKindCovered =
    (def.include === "all" && anchor.kind !== "r") ||
    (anchor.kind === "p" && def.include === "pages") ||
    (anchor.kind === "c" && def.include === "clicks");
  const types = anchorKindCovered
    ? include
    : `(${include} OR ${stepPredicateRaw(anchor, scope, opts.events)})`;
  const pass = sessionPass(scope);
  // New users are told apart by their identity, as in a Users funnel.
  const newSince = id ? (scope.newSince ?? null) : null;
  // The sessions drawer labels each row with its user, so it reads the identity even without new users.
  const idRows = newSince !== null || attrs ? id : null;
  const app = comparing(scope);
  const widen = `${pass?.widen ?? ""}${idRows ? ` OR ${identityExpr(idRows)} IS NOT NULL` : ""}`;
  const anchorCols = [
    ...(errorRowPredicates(scope, [anchor], opts.events).length
      ? [`MIN(${errorCol(scope)}) AS em`]
      : []),
    ...(needsRef([anchor], opts.events)
      ? [`MIN(${viewCol(scope, "view_referrer", "VARCHAR")}) AS ref`]
      : []),
  ];
  const cols = [
    "session_id AS sid",
    "type AS ty",
    "MIN(date) AS t",
    "MIN(view_url) AS url",
    atnCol(scope),
    hrExpr(scope),
    ...(has(scope, "view_name") ? ["MIN(view_name) AS vn"] : []),
    ...anchorCols,
    ...(idRows ? identityGroupCols(idRows) : []),
    ...(newSince !== null ? ["MIN(date) AS t0"] : []),
    ...(app ? [APP_COL] : []),
    ...(pass ? [pass.xi] : []),
    // Rows widened in for the identity are dropped after it, so they never become path steps.
    ...(widen ? [`MAX(CASE WHEN ${types} THEN 1 ELSE 0 END) AS kp`] : []),
  ];
  const ctes = [
    `e0 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope, opts.sample)} AND ${widen ? `(${types}${widen})` : types} GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN ${actionKey(scope)} ELSE CAST(date AS VARCHAR) END)`,
  ];
  if (idRows) ctes.push(`e0u AS (SELECT *, ${UID_WINDOW} AS uid FROM e0)`);
  const src = filtered(
    idRows ? "e0u" : "e0",
    pass,
    widen ? "kp = 1" : "",
    newSince,
    idRows ? "e0us" : "e0s",
    "COALESCE(uid, 's:' || sid)",
  );
  const pk = pageKeyExpr("url", scope.schema, "vn");
  const ck = clickKeyExpr("atn");
  const appCol = app ? ", app" : "";
  const uidCol = idRows ? ", uid" : "";
  const ignored = pathIgnored(scope);
  if (anchor.kind === "e") {
    const keepVn = has(scope, "view_name") ? ", vn" : "";
    ctes.push(
      `e1 AS (SELECT sid, t, ty, hr, url${keepVn}${anchorCols.map((c) => `, ${colAlias(c)}`).join("")}${appCol}${uidCol}, CASE WHEN ty = 'view' THEN ${pk} WHEN ty = 'action' THEN ${ck} END AS k FROM ${src})`,
      `e AS (SELECT sid, t, ty, hr${appCol}${uidCol}, CASE WHEN ty = 'view' THEN 'p:' || k WHEN ty = 'action' THEN 'c:' || k END AS key, CASE WHEN ${stepPredicateGrouped(anchor, scope, opts.events)} THEN 1 ELSE 0 END AS am FROM e1)`,
    );
    return [
      ...ctes,
      ...pathTail(def, attrs, "MIN(CASE WHEN am = 1 THEN n END)", ignored, !!idRows && attrs),
    ];
  }
  const anchorKey = lit(`${anchor.kind}:${anchor.key}`);
  // An error anchor is the only error row with a key, so it can be found in the sequence.
  const errorKey =
    anchor.kind === "r"
      ? ` WHEN ${stepPredicateGrouped(anchor, scope, opts.events)} THEN ${anchorKey}`
      : "";
  ctes.push(
    `e AS (SELECT sid, t, ty, hr${appCol}${uidCol}, CASE WHEN ty = 'view' THEN 'p:' || ${pk} WHEN ty = 'action' THEN 'c:' || ${ck}${errorKey} END AS key FROM ${src})`,
  );
  return [
    ...ctes,
    ...pathTail(
      def,
      attrs,
      `MIN(CASE WHEN key = ${anchorKey} THEN n END)`,
      ignored,
      !!idRows && attrs,
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
    `SELECT sid, t${j} AS step_t, errors, 0 AS frustrations, has_replay, started, ended, user_label, COUNT(*) OVER () AS total FROM pa WHERE ${predicate} ORDER BY has_replay DESC, step_t DESC, sid LIMIT ${PAGE_LIMIT} OFFSET ${PAGE_LIMIT * Math.max(0, Math.trunc(page))}`,
  );
}

// With `before`, rows ahead of the first column read as -1 rather than joining period 0.
const periodCase = (boundariesUs: number[], before = false): string => {
  const whens = [
    ...(before ? [`WHEN _timestamp < ${Math.trunc(boundariesUs[0])} THEN -1`] : []),
    ...boundariesUs.slice(1).map((b, i) => `WHEN _timestamp < ${Math.trunc(b)} THEN ${i}`),
  ].join(" ");
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
  // The first column can start before the range, and a user first seen in that gap is new too.
  const newSince =
    scope.newSince === undefined
      ? null
      : Math.min(scope.newSince, Math.trunc(boundariesUs[0] / 1000));
  // New users read back before the first column only to find each user's first activity.
  const p = periodCase(boundariesUs, newSince !== null);
  const pred = (step: StepRef | null) =>
    step ? stepPredicateRaw(step, scope, opts.events) : "1 = 1";
  const pass = sessionPass(scope);
  // Rows without the identity only flag their session for the rules, so sampling must not drop them.
  const sampled = opts.sample > 1 ? samplePredicate(u, opts.sample) : "";
  const sample = !sampled ? "" : pass ? ` AND (${u} IS NULL OR ${sampled})` : ` AND ${sampled}`;
  // The session pass needs each session's rows apart, so the first group keeps session_id and rolls up after.
  const bySession = perSession || !!pass;
  const anchors = [def.start, def.ret].filter((s): s is StepRef => !!s);
  const errors = errorRowPredicates(scope, anchors, opts.events);
  const types = errors.length
    ? `(type IN ('view', 'action') OR ${errors.join(" OR ")})`
    : "type IN ('view', 'action')";
  const cols = [
    `${u} AS u`,
    `${p} AS p`,
    `MAX(CASE WHEN ${pred(def.start)} THEN 1 ELSE 0 END) AS s`,
    `MAX(CASE WHEN ${pred(def.ret)} THEN 1 ELSE 0 END) AS r`,
    ...(bySession ? ["session_id AS sid"] : []),
    ...(perSession ? ["MAX(_timestamp) AS ts"] : []),
    ...(newSince !== null ? ["MIN(date) AS t0"] : []),
    // Rows the pass widened in only flag the session, so kp drops groups made of them alone.
    ...(pass ? [pass.xi, `MAX(CASE WHEN ${types} THEN 1 ELSE 0 END) AS kp`] : []),
  ];
  const rows = `${types} AND ${u} IS NOT NULL`;
  const ctes = [
    `a AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND ${pass ? `((${rows})${pass.widen})` : rows}${sample} GROUP BY ${u}, ${p}${bySession ? ", session_id" : ""})`,
  ];
  let src = "a";
  if (pass) {
    const roll = [
      "u",
      "p",
      "MAX(s) AS s",
      "MAX(r) AS r",
      ...(perSession ? ["sid", "MAX(ts) AS ts"] : []),
      ...(newSince !== null ? ["MIN(t0) AS t0"] : []),
    ];
    ctes.push(
      `a1 AS (SELECT ${roll.join(", ")} FROM ${filtered("a", pass, "u IS NOT NULL AND kp = 1", null, "a0")} GROUP BY u, p${perSession ? ", sid" : ""})`,
    );
    src = "a1";
  }
  const from =
    newSince !== null
      ? `(SELECT *, MIN(t0) OVER (PARTITION BY u) AS first_t FROM ${src}) an WHERE first_t >= ${newSince} AND p >= 0`
      : src;
  ctes.push(
    `c AS (SELECT *, MIN(CASE WHEN s = 1 THEN p END) OVER (PARTITION BY u) AS cohort, MAX(CASE WHEN r = 1 THEN p END) OVER (PARTITION BY u) AS last_ret FROM ${from})`,
  );
  return ctes;
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

const featureRule = (rule: NamedRule): string => {
  const onPage = "onPage" in rule && rule.onPage ? ` AND pg = ${lit(rule.onPage)}` : "";
  if (rule.t === "error")
    return `(ty = 'error' AND ${opMatch(rule.op, "em", rule.value)}${onPage})`;
  if (rule.t === "action")
    return `(ty = 'action' AND ${opMatch(rule.op ?? "in", "k", rule.targets ?? rule.value ?? "")}${onPage})`;
  if (rule.op === "param")
    return `(ty = 'view' AND regexp_like(url, ${lit(paramPattern(rule.name, rule.value))})${onPage})`;
  if (rule.op === "ref")
    return `(ty = 'view' AND regexp_like(ref, ${lit(refPattern(rule.value))})${onPage})`;
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
  const pass = sessionPass(scope);
  const steps = events.map((e): StepRef => ({ kind: "e", key: e.id }));
  const errors = errorRowPredicates(scope, steps, events);
  const ref = needsRef(steps, events);
  const url = eventRules(steps, events).some((r) => r.t === "view" && r.op === "param");
  const cols = [
    "session_id AS sid",
    "type AS ty",
    `${c} AS cur`,
    "MIN(view_url) AS url",
    atnCol(scope),
    ...(has(scope, "view_name") ? ["MIN(view_name) AS vn"] : []),
    ...(id ? identityGroupCols(id) : []),
    ...(errors.length ? [`MIN(${errorCol(scope)}) AS em`] : []),
    ...(ref ? [`MIN(${viewCol(scope, "view_referrer", "VARCHAR")}) AS ref`] : []),
    ...(pass ? [pass.xi] : []),
  ];
  const extra = `${errors.map((e) => ` OR ${e}`).join("")}${id ? ` OR ${identityExpr(id)} IS NOT NULL` : ""}${pass?.widen ?? ""}`;
  const carry = [...(url ? ["url"] : []), ...(errors.length ? ["em"] : []), ...(ref ? ["ref"] : [])]
    .map((col) => `, ${col}`)
    .join("");
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
  const errorGroup = errors.length ? " WHEN type = 'error' THEN CAST(date AS VARCHAR)" : "";
  return withCtes(
    [
      `e0 AS (SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${scopeClause(scope)} AND (type = 'view' OR ${actionClickExpr(scope)}${extra}) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN ${actionKey(scope)}${errorGroup} END, ${c})`,
      `e1 AS (SELECT sid, ty, cur, ${pageKeyExpr("url", scope.schema, "vn")} AS pg, ${clickKeyExpr("atn")} AS k${carry}${id ? `, ${UID_WINDOW} AS u` : ""} FROM ${filtered("e0", pass)})`,
    ],
    `SELECT ${agg.join(", ")} FROM e1 LIMIT 1`,
  );
}
