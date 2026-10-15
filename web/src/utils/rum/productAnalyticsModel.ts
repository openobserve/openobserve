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

import { addCommasToNumber, b64DecodeUnicode, b64EncodeUnicode } from "@/utils/formatters";
import { escapeHtml } from "@/utils/html";
import { sqlIn, sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { gt, type I18nText } from "@/types/i18n";
import i18n, { localeFileMap } from "@/locales";
import { addDays, addMonths, addWeeks, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  DIMENSIONS,
  IDENTITY_FIELDS,
  MAX_FUNNEL_STEPS,
  type BreakdownDim,
  type FunnelCohort,
  type FunnelDef,
  type FunnelUnit,
  type FunnelWindow,
  type Granularity,
  type IdentityField,
  type PathsDef,
  type PathsInclude,
  type RetentionDef,
  type RetentionMode,
  type SampleRatio,
  type StepKind,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";

export interface NamedEventRule {
  t: "view";
  op: "eq" | "prefix" | "regex";
  value: string;
}
export interface NamedActionRule {
  t: "action";
  targets: string[];
  onPage?: string;
}
export interface NamedEvent {
  id: string;
  app: string;
  name: string;
  rules: (NamedEventRule | NamedActionRule)[];
  version: number;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
}
export type NamedEventDraftShape = Pick<NamedEvent, "app" | "name" | "rules">;
export interface SavedFunnel {
  id: string;
  app: string;
  name: string;
  description?: string;
  def: FunnelDef;
  sql: string;
  eventIds: string[];
  version: number;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
}
export interface SavedFunnelBody {
  name: string;
  description?: string;
  def: Record<string, unknown>;
  sql: string;
}
export interface IdentityGap {
  reason: "absent" | "placeholder";
  field: IdentityField | null;
  share: number;
}
export interface IdentityResolution {
  field: IdentityField | null;
  excluded: string[];
  excludedShare: number;
  users: number;
  coverage: number;
  unidentifiedSessions: number;
  sessions: number;
  partial: boolean;
  gap: IdentityGap | null;
}
export interface IdentityLabels {
  label: I18nText;
  short: I18nText;
  noun: I18nText;
  one: I18nText;
  partial: boolean;
}
export interface IdentityNote {
  field: IdentityField;
  count: number;
  share: number;
  fallback: IdentityField | null;
}
export interface IdentityTopRow {
  u: string;
  s: number;
  total_s: number;
  n_values: number;
}
export type Delta = { kind: "pct"; value: number } | { kind: "new" } | { kind: "none" };
export type ChipFilter = "all" | "rising" | "declining" | "not_used";
export type RankedView = "all" | "entry" | "exit";
export interface RankedRow {
  kind: StepKind;
  key: string;
  sessions: number;
  prevSessions: number;
  users: number | null;
  prevUsers: number | null;
  events: number | null;
  prevEvents: number | null;
  share: number;
  prevShare: number;
  delta: Delta;
  pages: number | null;
  topPage: string | null;
}
export interface FunnelStepResult {
  step: StepRef;
  units: number;
  ofFirst: number;
  ofPrevious: number;
  dropoff: number;
  seen: number;
  medianMs: number | null;
  p90Ms: number | null;
}
export interface FunnelResult {
  steps: FunnelStepResult[];
  step1Sessions: number | null;
  leftOut: number | null;
}
export interface BreakdownRow {
  value: string | null;
  label: string;
  counts: number[];
  conversion: number;
  atLeast: boolean;
  other: boolean;
  notSet: boolean;
}
export type PathNodeKind = StepKind | "other" | "exit" | "start";
export interface PathNode {
  name: string;
  depth: number;
  key: string;
  kind: PathNodeKind;
  value: number;
  pct: number;
  keys?: number;
}
export interface PathLink {
  source: string;
  target: string;
  value: number;
  pathKeys: string[];
}
export interface PathFlow {
  nodes: PathNode[];
  links: PathLink[];
  kept: Map<string, string[]>;
  anchorSessions: number;
  truncated: boolean;
}
export interface BranchTarget {
  depth: number;
  key: string | null;
  parentKey: string | null;
  type: "node" | "link" | "other" | "exit" | "tuple";
  tuple?: (string | null)[];
}
export interface RetentionPeriods {
  granularity: "day" | "week" | "month";
  boundariesUs: number[];
  runningIndex: number | null;
  dataStartUs: number | null;
  clipped: boolean;
}
export interface RetentionCell {
  k: number;
  users: number;
  pct: number;
  incomplete: boolean;
}
export interface RetentionGrid {
  rows: { cohort: number; label: string; size: number; cells: RetentionCell[] }[];
  average: (number | null)[];
}
export interface AnalyticsDateTime {
  valueType: "relative" | "absolute";
  relativeTimePeriod: string | null;
  startTime: number;
  endTime: number;
}
export interface AnalyticsScopeState {
  app: string;
  env: string[];
  version: string[];
  datetime: AnalyticsDateTime;
  includeAllIdentities: boolean;
  exact: boolean;
}

export const MAX_EVENTS_PER_APP = 50 as const;
export const MAX_FUNNELS_PER_APP = 50 as const;
export const MIN_SAVED_STEPS = 2;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_SQL_BYTES = 65536;
export const MAX_PARAM_LENGTH = 8192 as const;
export const MAX_KEY_LENGTH = 1024 as const;
export const MAX_RULES = 10;
export const MAX_TARGETS = 20;
export const MAX_NAME_LENGTH = 80;
// The server's unique name key is varchar(128) of the lowercased name, so one character can count twice.
export const MAX_NAME_KEY_CHARS = 128;
export const MAX_REGEX_LENGTH = 256;
export const MAX_RECENT_FUNNELS = 10;
export const EXACT_ROW_LIMIT = 1000000;
export const CHANGE_THRESHOLD = 0.5;
const DOMINANT_SHARE = 0.2;
const FULL_COVERAGE = 0.5;
const DATA_TEST_SHARE = 0.2;
const BREAKDOWN_TOP = 5;
const BREAKDOWN_LIMIT = 1000;
const PATH_BRANCHES = 5;
const PATH_ROW_LIMIT = 5000;
const DAY_US = 86400000000;
const MIN_PERIODS = 2;
const MAX_PERIODS = 36;
const DAILY_MAX_DAYS = 14;
const WEEKLY_MAX_DAYS = 90;
const MONTH_DATA_DAYS = 60;
const DATA_TEST_NAME = /^[a-z0-9]+([-_./:][a-z0-9]+)*$/;
const MIN_REMAINING_VALUES = 3;
const MAX_SCOPE_VALUE = 256;
const MAX_SCOPE_VALUES = 50;
const MAX_PATH_DEPTH = 5;
const RELATIVE_PERIOD = /^[1-9][0-9]{0,4}[smhdwM]$/;
const WINDOWS: readonly FunnelWindow[] = ["session", "1h", "1d", "7d"];
const GRANULARITIES: readonly Granularity[] = ["auto", "day", "week", "month"];
const INCLUDES: readonly PathsInclude[] = ["all", "pages", "clicks"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isKey = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_KEY_LENGTH;

const ENTITY_ID = /^[0-9A-Za-z]{27}$/;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sqlBytes = (sql: string): number => new TextEncoder().encode(sql).length;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const RUST_ESCAPE_LETTERS = new Set("dDwWsSbBAznrtfvaxuUpP");
const RUST_CLASS_BAD_ESCAPES = new Set("bBAz");
const RUST_FLAGS = /^[imsxuUR]*(-[imsxuUR]+)?$/;
const GROUP_OPEN = /^\(\?(P?<\w+>|[imsxuUR-]*[:)])?/;
const COUNTED_REPETITION = /^\{\d+(,\d*)?\}/;
// The only one-letter Unicode classes are the general categories, in either case.
const PROPERTY_LETTER = /^[CLMNPSZ]$/i;
const HEX_ESCAPE_DIGITS: Record<string, number> = { x: 2, u: 4, U: 8 };

type RustProblem = "backreference" | "unsupported" | "invalid";

// The engine accepts only literals as class range bounds, so `[\d-z]` fails there while JS compiles it.
interface ClassRange {
  from: "literal" | "class" | null;
  dash: boolean;
}

const escapeProblem = (n: string, depth: number): RustProblem | null => {
  if (/[1-9]/.test(n) || n === "k") return "backreference";
  if (/[0-9A-Za-z]/.test(n) && !RUST_ESCAPE_LETTERS.has(n)) return "unsupported";
  return depth > 0 && RUST_CLASS_BAD_ESCAPES.has(n) ? "unsupported" : null;
};

const flagProblem = (open: string): RustProblem | null => {
  if (!open.startsWith("(?") || open.includes("<")) return null;
  const flags = open.slice(2, -1);
  if (!flags && open.endsWith(":")) return null;
  const letters = flags.replace("-", "");
  return RUST_FLAGS.test(flags) && letters && new Set(letters).size === letters.length
    ? null
    : "invalid";
};

const classRangeProblem = (range: ClassRange, bound: "literal" | "class"): RustProblem | null => {
  if (!range.dash) {
    range.from = bound;
    return null;
  }
  const bad = range.from === "class" || bound === "class";
  range.from = null;
  range.dash = false;
  return bad ? "unsupported" : null;
};

// Rust reads `]` right after `[` or `[^` as a literal, and `[` inside a class opens a nested class.
const classOpenLength = (value: string, i: number): number => {
  const neg = value[i + 1] === "^" ? 1 : 0;
  return 1 + neg + (value[i + 1 + neg] === "]" ? 1 : 0);
};

// The engine takes a hex escape only when it names a Unicode scalar value, so surrogates and values past U+10FFFF fail.
const isScalarHex = (hex: string): boolean => {
  if (!/^[0-9a-f]+$/i.test(hex)) return false;
  const cp = parseInt(hex, 16);
  return cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);
};

// Length of the escape at `i`, or 0 when the engine cannot parse it: a bad brace or hex body, or `\p` without a class.
const escapeLength = (value: string, i: number): number => {
  const n = value[i + 1] ?? "";
  if (/[pPxuU]/.test(n) && value[i + 2] === "{") {
    const close = value.indexOf("}", i + 3);
    if (close <= i + 3) return 0;
    return n in HEX_ESCAPE_DIGITS && !isScalarHex(value.slice(i + 3, close)) ? 0 : close - i + 1;
  }
  if (/[pP]/.test(n)) return PROPERTY_LETTER.test(value[i + 2] ?? "") ? 3 : 0;
  const digits = HEX_ESCAPE_DIGITS[n];
  if (!digits) return 2;
  const hex = value.slice(i + 2, i + 2 + digits);
  return hex.length === digits && isScalarHex(hex) ? digits + 2 : 0;
};

// Returns where a pattern breaks the engine's Rust regex syntax, which lacks lookaround, backreferences and many JS escapes.
const rustSyntaxProblem = (value: string): RustProblem | null => {
  let depth = 0;
  let atom = false;
  const range: ClassRange = { from: null, dash: false };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    const rest = value.slice(i);
    if (c === "\\") {
      const n = value[i + 1] ?? "";
      const bad =
        escapeProblem(n, depth) ??
        (depth > 0 ? classRangeProblem(range, /[dDwWsSpP]/.test(n) ? "class" : "literal") : null);
      if (bad) return bad;
      const step = escapeLength(value, i);
      if (!step) return "invalid";
      i += step - 1;
      atom = true;
      continue;
    }
    if (depth > 0) {
      const posix = rest.startsWith("[:") ? rest.indexOf(":]") : -1;
      if (posix > 0 || c === "]" || c === "[") Object.assign(range, { from: null, dash: false });
      if (posix > 0) i += posix + 1;
      else if (c === "]") depth--;
      else if (c === "[") {
        depth++;
        i += classOpenLength(value, i) - 1;
      } else if (c === "-" && range.from && !range.dash && value[i + 1] !== "]") range.dash = true;
      else {
        const bad = classRangeProblem(range, "literal");
        if (bad) return bad;
      }
      atom = true;
      continue;
    }
    if (c === "[") {
      i += classOpenLength(value, i) - 1;
      depth = 1;
      Object.assign(range, { from: null, dash: false });
    } else if (c === "(") {
      if (/^\(\?<?[=!]/.test(rest)) return "unsupported";
      const open = GROUP_OPEN.exec(rest)?.[0] ?? "(";
      const bad = flagProblem(open);
      if (bad) return bad;
      i += open.length - 1;
    } else if (c === "{" && (!atom || !COUNTED_REPETITION.test(rest))) return "unsupported";
    atom = c !== "(" && c !== "|";
  }
  return depth > 0 ? "invalid" : null;
};

export function regexProblem(
  value: string,
): "length" | "backreference" | "unsupported" | "invalid" | null {
  if (!value || value.length > MAX_REGEX_LENGTH) return "length";
  const rust = rustSyntaxProblem(value);
  if (rust) return rust;
  try {
    new RegExp(
      value
        .replace(/\(\?[imsxuUR-]+\)/g, "")
        .replace(/\(\?[imsxuUR-]+:/g, "(?:")
        .replace(/\(\?P</g, "(?<"),
    );
  } catch {
    return "invalid";
  }
  return null;
}

const parseRule = (raw: unknown): NamedEventRule | NamedActionRule | null => {
  if (!isRecord(raw)) return null;
  if (raw.t === "view") {
    if (raw.op !== "eq" && raw.op !== "prefix" && raw.op !== "regex") return null;
    if (!isKey(raw.value)) return null;
    if (raw.op === "regex" && regexProblem(raw.value)) return null;
    return { t: "view", op: raw.op, value: raw.value };
  }
  if (raw.t === "action") {
    const targets = raw.targets;
    if (!Array.isArray(targets) || !targets.length || targets.length > MAX_TARGETS) return null;
    if (!targets.every(isKey)) return null;
    if (raw.onPage !== undefined && raw.onPage !== null && !isKey(raw.onPage)) return null;
    return raw.onPage
      ? { t: "action", targets: [...targets], onPage: raw.onPage as string }
      : { t: "action", targets: [...targets] };
  }
  return null;
};

/** The server's name rule: 1 to 80 UTF-16 units once trimmed, and at most 128 code points once lowercased. */
export function nameFits(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_NAME_LENGTH &&
    [...trimmed.toLowerCase()].length <= MAX_NAME_KEY_CHARS
  );
}

/** The server's id rule: a 27-character KSUID, which also bounds `e` step keys and the `sf` link. */
export function isEntityId(v: unknown): v is string {
  return typeof v === "string" && ENTITY_ID.test(v);
}

export function parseNamedEventDraft(raw: unknown, app: string): NamedEventDraftShape | null {
  if (!isRecord(raw) || raw.app !== app) return null;
  if (typeof raw.name !== "string" || raw.name.length > MAX_NAME_LENGTH || !nameFits(raw.name))
    return null;
  if (!Array.isArray(raw.rules) || !raw.rules.length || raw.rules.length > MAX_RULES) return null;
  const rules = raw.rules.map(parseRule);
  if (rules.some((r) => r === null)) return null;
  return { app, name: raw.name, rules: rules as (NamedEventRule | NamedActionRule)[] };
}

const parseAudit = (raw: Record<string, unknown>) => {
  const { id, version, createdBy, createdAt, updatedBy, updatedAt } = raw;
  if (!isEntityId(id) || !Number.isInteger(version) || (version as number) < 1) return null;
  if (!isCount(createdAt) || !isCount(updatedAt)) return null;
  if (typeof createdBy !== "string" || typeof updatedBy !== "string") return null;
  return { id, version: version as number, createdBy, createdAt, updatedBy, updatedAt };
};

export function parseNamedEvent(raw: unknown, app: string): NamedEvent | null {
  const draft = parseNamedEventDraft(raw, app);
  const audit = draft && isRecord(raw) ? parseAudit(raw) : null;
  if (!draft || !audit) return null;
  return {
    id: audit.id,
    app,
    name: draft.name,
    rules: draft.rules,
    version: audit.version,
    createdBy: audit.createdBy,
    createdAt: audit.createdAt,
    updatedBy: audit.updatedBy,
    updatedAt: audit.updatedAt,
  };
}

const coveragePct = (share: number): string => (num(share) * 100).toFixed(1);

// One candidate after the dominant-value guard, or null when at most one distinct value remains.
const resolveCandidate = (
  field: IdentityField,
  summary: Record<string, number>,
  rows: IdentityTopRow[],
  includeAll: boolean,
  sessions: number,
): IdentityResolution | null => {
  const nValues = rows.length ? num(rows[0].n_values) : num(summary[`${field}__values`]);
  const total = rows.length ? num(rows[0].total_s) : 0;
  let excludedRows = includeAll
    ? []
    : rows.filter((r) => total > 0 && num(r.s) / total > DOMINANT_SHARE);
  if (nValues - excludedRows.length < MIN_REMAINING_VALUES) excludedRows = [];
  const users = nValues - excludedRows.length;
  if (users <= 1) return null;
  const excludedSessions = excludedRows.reduce((a, r) => a + num(r.s), 0);
  const identified = Math.max(0, num(summary[`${field}__sessions`]) - excludedSessions);
  return {
    field,
    excluded: excludedRows.map((r) => r.u),
    excludedShare: total > 0 ? excludedSessions / total : 0,
    users,
    coverage: sessions > 0 ? identified / sessions : 0,
    unidentifiedSessions: Math.max(0, sessions - identified),
    sessions,
    partial: false,
    gap: null,
  };
};

// A candidate fails only with at most one distinct value, so a lone value is a placeholder and none is absent.
const identityGap = (
  summary: Record<string, number>,
  top: Record<string, IdentityTopRow[]>,
  schema: Record<string, boolean>,
  sessions: number,
): IdentityGap => {
  let gap: IdentityGap = { reason: "absent", field: null, share: 0 };
  for (const field of IDENTITY_FIELDS) {
    if (schema[field] !== true) continue;
    const rows = top[field] ?? [];
    const nValues = rows.length ? num(rows[0].n_values) : num(summary[`${field}__values`]);
    if (nValues !== 1) continue;
    const valueSessions = rows.length ? num(rows[0].s) : num(summary[`${field}__sessions`]);
    const share = sessions > 0 ? Math.min(1, valueSessions / sessions) : 0;
    if (gap.reason === "absent" || share > gap.share) gap = { reason: "placeholder", field, share };
  }
  return gap;
};

export function resolveIdentity(
  summary: Record<string, number>,
  top: Record<string, IdentityTopRow[]>,
  schema: Record<string, boolean>,
  includeAll: boolean,
): IdentityResolution {
  const sessions = num(summary.sessions);
  const resolved = IDENTITY_FIELDS.filter((f) => schema[f] === true)
    .map((f) => resolveCandidate(f, summary, top[f] ?? [], includeAll, sessions))
    .filter((r): r is IdentityResolution => r !== null);
  const full = resolved.find((r) => r.coverage >= FULL_COVERAGE);
  if (full) return full;
  const best = resolved.reduce<IdentityResolution | null>(
    (a, r) => (a && a.coverage >= r.coverage ? a : r),
    null,
  );
  if (best) return { ...best, partial: true };
  return {
    field: null,
    excluded: [],
    excludedShare: 0,
    users: 0,
    coverage: 0,
    unidentifiedSessions: sessions,
    sessions,
    partial: false,
    gap: identityGap(summary, top, schema, sessions),
  };
}

// Include it counts by the unguarded choice, so the note names that field's exclusions even when the guard moved identity elsewhere.
export function identityExclusionNote(
  resolved: Pick<IdentityResolution, "field" | "excluded">,
  summary: Record<string, number>,
  top: Record<string, IdentityTopRow[]>,
  schema: Record<string, boolean>,
): IdentityNote | null {
  const field = resolved.excluded.length
    ? resolved.field
    : resolveIdentity(summary, top, schema, true).field;
  if (!field) return null;
  const guarded = resolveCandidate(field, summary, top[field] ?? [], false, num(summary.sessions));
  if (!guarded?.excluded.length) return null;
  return {
    field,
    count: guarded.excluded.length,
    share: guarded.excludedShare,
    fallback: field === resolved.field ? null : resolved.field,
  };
}

export function identityLabels(
  id: Pick<IdentityResolution, "field" | "partial" | "coverage"> | null,
): IdentityLabels {
  const visitors = id?.field === "usr_anonymous_id";
  const partial = !!id?.field && id.partial;
  const pct = coveragePct(id?.coverage ?? 0);
  if (visitors) {
    return {
      label: partial
        ? gt("rum.analytics.identity.visitorsPartial", { pct })
        : gt("rum.analytics.identity.visitors"),
      short: partial
        ? gt("rum.analytics.identity.visitorsIdentified")
        : gt("rum.analytics.identity.visitors"),
      noun: partial
        ? gt("rum.analytics.identity.visitorsIdentifiedNoun")
        : gt("rum.analytics.identity.visitorsNoun"),
      one: gt("rum.analytics.identity.visitorOne"),
      partial,
    };
  }
  return {
    label: partial
      ? gt("rum.analytics.identity.usersPartial", { pct })
      : gt("rum.analytics.identity.users"),
    short: partial
      ? gt("rum.analytics.identity.usersIdentified")
      : gt("rum.analytics.identity.users"),
    noun: partial
      ? gt("rum.analytics.identity.usersIdentifiedNoun")
      : gt("rum.analytics.identity.usersNoun"),
    one: gt("rum.analytics.identity.userOne"),
    partial,
  };
}

// Says why no identity resolved; the placeholder's share is shown, never its value.
export function identityGapMessage(
  id: Pick<IdentityResolution, "field" | "gap"> | null,
  short = false,
): I18nText | null {
  if (!id || id.field || !id.gap) return null;
  if (id.gap.reason === "absent") {
    return short ? gt("rum.analytics.identity.absentShort") : gt("rum.analytics.identity.absent");
  }
  const named = { field: id.gap.field ?? "", pct: coveragePct(id.gap.share) };
  return short
    ? gt("rum.analytics.identity.placeholderShort", named)
    : gt("rum.analytics.identity.placeholder", named);
}

export function samplingRatio(vaRows: number, exact: boolean): SampleRatio {
  if (exact || vaRows <= EXACT_ROW_LIMIT) return 1;
  const r = 2 ** Math.ceil(Math.log2(vaRows / EXACT_ROW_LIMIT));
  return Math.min(16, r) as SampleRatio;
}

export const formatPct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function formatCount(n: number, ratio: SampleRatio): string {
  const value = Math.round(num(n) * ratio);
  return ratio > 1 ? `~${addCommasToNumber(value)}` : addCommasToNumber(value);
}

export function encodeDef(value: unknown): string {
  return b64EncodeUnicode(JSON.stringify(value)) ?? "";
}

export function decodeDef(param: string | undefined): unknown {
  if (typeof param !== "string" || !param || param.length > MAX_PARAM_LENGTH) return undefined;
  const text = b64DecodeUnicode(param);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseStepRef(raw: unknown): StepRef | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [kind, key] = raw;
  if (kind !== "p" && kind !== "c" && kind !== "e") return null;
  if (kind === "e" ? !isEntityId(key) : !isKey(key)) return null;
  return { kind: kind as StepKind, key };
}

export function stepRefParam(step: StepRef): [StepKind, string] {
  return [step.kind, step.key];
}

export function parseFunnelDef(raw: unknown): FunnelDef | null {
  if (!isRecord(raw) || !Array.isArray(raw.s)) return null;
  if (!raw.s.length || raw.s.length > MAX_FUNNEL_STEPS) return null;
  const steps = raw.s.map(parseStepRef);
  if (steps.some((s) => s === null)) return null;
  const unit: FunnelUnit | null =
    raw.u === "users" ? "users" : raw.u === "sessions" || raw.u === undefined ? "sessions" : null;
  if (!unit) return null;
  const w = raw.w === undefined ? "session" : raw.w;
  if (!WINDOWS.includes(w as FunnelWindow)) return null;
  const b = raw.b === undefined || raw.b === null ? null : raw.b;
  if (b !== null && !Object.prototype.hasOwnProperty.call(DIMENSIONS, b as string)) return null;
  return {
    steps: steps as StepRef[],
    unit,
    window: unit === "sessions" ? "session" : (w as FunnelWindow),
    breakdown: b as BreakdownDim | null,
  };
}

export function funnelParam(def: FunnelDef): Record<string, unknown> {
  const out: Record<string, unknown> = {
    s: def.steps.map(stepRefParam),
    u: def.unit,
    w: def.window,
  };
  if (def.breakdown) out.b = def.breakdown;
  return out;
}

const savedName = (v: unknown): string | null => (typeof v === "string" && nameFits(v) ? v : null);

const savedDescription = (v: unknown): string | undefined | null => {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "string" && v.length <= MAX_DESCRIPTION_LENGTH ? v : null;
};

const savedDef = (v: unknown): FunnelDef | null => {
  const def = parseFunnelDef(v);
  return def && def.steps.length >= MIN_SAVED_STEPS ? def : null;
};

const savedSql = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && sqlBytes(v) <= MAX_SQL_BYTES;

/** The server caps stored SQL in bytes, so a 1,024-character key of quotes or non-ASCII can overflow it. */
export function fitsSqlCap(sql: string): boolean {
  return sqlBytes(sql) <= MAX_SQL_BYTES;
}

export function parseSavedFunnel(raw: unknown, app: string): SavedFunnel | null {
  if (!isRecord(raw) || raw.app !== app) return null;
  const audit = parseAudit(raw);
  const name = savedName(raw.name);
  const description = savedDescription(raw.description);
  const def = savedDef(raw.def);
  if (!audit || !name || description === null || !def || !savedSql(raw.sql)) return null;
  const eventIds = Array.isArray(raw.eventIds) ? raw.eventIds.filter(isEntityId) : [];
  return {
    id: audit.id,
    app,
    name,
    ...(description === undefined ? {} : { description }),
    def,
    sql: raw.sql,
    eventIds,
    version: audit.version,
    createdBy: audit.createdBy,
    createdAt: audit.createdAt,
    updatedBy: audit.updatedBy,
    updatedAt: audit.updatedAt,
  };
}

/** The request body for a save, or null when the server's validator would refuse it. */
export function parseSavedFunnelDraft(draft: {
  name: string;
  description?: string;
  def: FunnelDef;
  sql: string;
}): SavedFunnelBody | null {
  const name = savedName(draft.name)?.trim();
  const description = savedDescription(draft.description?.trim());
  const def = savedDef(funnelParam(draft.def));
  if (!name || description === null || !def || !savedSql(draft.sql)) return null;
  return {
    name,
    ...(description === undefined ? {} : { description }),
    def: funnelParam(def),
    sql: draft.sql,
  };
}

const parseCohort = (raw: unknown): FunnelCohort | null => {
  const funnel = parseFunnelDef(raw);
  if (!funnel || !isRecord(raw)) return null;
  const k = raw.k;
  if (typeof k !== "number" || !Number.isInteger(k) || k < 1 || k >= funnel.steps.length)
    return null;
  return { funnel: { ...funnel, breakdown: null }, stepIndex: k, side: "dropped" };
};

export function cohortParam(cohort: FunnelCohort): string {
  return encodeDef({ ...funnelParam({ ...cohort.funnel, breakdown: null }), k: cohort.stepIndex });
}

export function parsePathsDef(raw: unknown): PathsDef | null {
  if (!isRecord(raw)) return null;
  let anchor: StepRef | null = null;
  if (raw.anchor !== undefined) {
    anchor = parseStepRef(decodeDef(raw.anchor as string));
    if (!anchor) return null;
  }
  const direction = raw.dir === undefined ? "next" : raw.dir;
  if (direction !== "next" && direction !== "prev") return null;
  const depth = raw.depth === undefined ? 3 : Number(raw.depth);
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_PATH_DEPTH) return null;
  const include = raw.inc === undefined ? "all" : raw.inc;
  if (!INCLUDES.includes(include as PathsInclude)) return null;
  let cohort: FunnelCohort | null = null;
  if (raw.cohort !== undefined) {
    cohort = parseCohort(decodeDef(raw.cohort as string));
    if (!cohort) return null;
  }
  return { anchor, direction, depth, include: include as PathsInclude, cohort };
}

export function parseRetentionDef(raw: unknown): RetentionDef | null {
  if (!isRecord(raw)) return null;
  const step = (v: unknown): StepRef | null | undefined =>
    v === undefined ? null : (parseStepRef(decodeDef(v as string)) ?? undefined);
  const start = step(raw.rs);
  const ret = step(raw.rr);
  if (start === undefined || ret === undefined) return null;
  const per = raw.per === undefined ? "auto" : raw.per;
  if (!GRANULARITIES.includes(per as Granularity)) return null;
  const mode = raw.rmode === undefined ? "on" : raw.rmode;
  if (mode !== "on" && mode !== "after") return null;
  return { start, ret, per: per as Granularity, mode: mode as RetentionMode };
}

const scopeValues = (v: unknown): string[] | null => {
  const list = Array.isArray(v) ? v : [v];
  if (list.length > MAX_SCOPE_VALUES) return null;
  if (!list.every((x) => typeof x === "string" && x.length > 0 && x.length <= MAX_SCOPE_VALUE))
    return null;
  return list as string[];
};

const flagParam = (v: unknown): boolean | null => (v === "1" ? true : v === "0" ? false : null);

export function parseScope(query: Record<string, unknown>): {
  scope: Partial<AnalyticsScopeState>;
  invalid: string[];
} {
  const scope: Partial<AnalyticsScopeState> = {};
  const invalid: string[] = [];
  if (query.app !== undefined) {
    if (
      typeof query.app === "string" &&
      query.app.length > 0 &&
      query.app.length <= MAX_SCOPE_VALUE
    )
      scope.app = query.app;
    else invalid.push("app");
  }
  for (const key of ["env", "version"] as const) {
    if (query[key] === undefined) continue;
    const values = scopeValues(query[key]);
    if (values) scope[key] = values;
    else invalid.push(key);
  }
  if (query.period !== undefined) {
    if (typeof query.period === "string" && RELATIVE_PERIOD.test(query.period)) {
      scope.datetime = {
        valueType: "relative",
        relativeTimePeriod: query.period,
        startTime: 0,
        endTime: 0,
      };
    } else invalid.push("period");
  } else if (query.from !== undefined || query.to !== undefined) {
    const from = Number(query.from);
    const to = Number(query.to);
    if (Number.isInteger(from) && Number.isInteger(to) && from > 0 && from < to) {
      scope.datetime = {
        valueType: "absolute",
        relativeTimePeriod: null,
        startTime: from,
        endTime: to,
      };
    } else invalid.push("from");
  }
  for (const [param, key] of [
    ["idall", "includeAllIdentities"],
    ["exact", "exact"],
  ] as const) {
    if (query[param] === undefined) continue;
    const flag = flagParam(query[param]);
    if (flag === null) invalid.push(param);
    else scope[key] = flag;
  }
  return { scope, invalid };
}

export function computeDelta(cur: number, prev: number, prevWindowHasData: boolean): Delta {
  if (!prevWindowHasData) return cur > 0 ? { kind: "new" } : { kind: "none" };
  if (prev > 0) return { kind: "pct", value: (cur - prev) / prev };
  return cur > 0 ? { kind: "new" } : { kind: "none" };
}

const COLUMNS: Record<RankedView, { s: string; ps: string; u: string; pu: string }> = {
  all: { s: "sessions", ps: "prev_sessions", u: "users", pu: "prev_users" },
  entry: {
    s: "entry_sessions",
    ps: "prev_entry_sessions",
    u: "entry_users",
    pu: "prev_entry_users",
  },
  exit: { s: "exit_sessions", ps: "prev_exit_sessions", u: "exit_users", pu: "prev_exit_users" },
};

export function toRankedRows(
  hits: Record<string, unknown>[],
  kind: StepKind,
  view: RankedView,
  identity: IdentityField | null,
  totalSessions: number,
  prevTotalSessions: number,
  prevWindowHasData: boolean,
): RankedRow[] {
  const c = COLUMNS[view];
  const ev = kind === "c" ? ["clicks", "prev_clicks"] : ["views", "prev_views"];
  return hits
    .filter((h) => typeof h.k === "string" && h.k !== "")
    .map((h) => {
      const sessions = num(h[c.s]);
      const prevSessions = num(h[c.ps]);
      return {
        kind,
        key: h.k as string,
        sessions,
        prevSessions,
        users: identity ? num(h[c.u]) : null,
        prevUsers: identity ? num(h[c.pu]) : null,
        events: view === "all" ? num(h[ev[0]]) : null,
        prevEvents: view === "all" ? num(h[ev[1]]) : null,
        share: totalSessions > 0 ? sessions / totalSessions : 0,
        prevShare: prevTotalSessions > 0 ? prevSessions / prevTotalSessions : 0,
        delta: computeDelta(sessions, prevSessions, prevWindowHasData),
        pages: null,
        topPage: null,
      };
    })
    .filter((r) => r.sessions > 0 || r.prevSessions > 0)
    .sort((a, b) => b.sessions - a.sessions || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function applyClickPages(
  rows: RankedRow[],
  hits: { k: string; pg: string; sessions: number }[],
): RankedRow[] {
  const byKey = new Map<string, { pages: Set<string>; top: string | null; topSessions: number }>();
  for (const h of hits) {
    if (!h.pg) continue;
    const entry = byKey.get(h.k) ?? { pages: new Set<string>(), top: null, topSessions: -1 };
    entry.pages.add(h.pg);
    if (num(h.sessions) > entry.topSessions) {
      entry.top = h.pg;
      entry.topSessions = num(h.sessions);
    }
    byKey.set(h.k, entry);
  }
  return rows.map((r) => {
    const entry = byKey.get(r.key);
    return entry ? { ...r, pages: entry.pages.size, topPage: entry.top } : r;
  });
}

export function matchesChip(row: RankedRow, chip: ChipFilter, prevWindowHasData: boolean): boolean {
  if (chip === "all") return row.sessions > 0;
  if (!prevWindowHasData) return false;
  if (chip === "not_used") return row.prevSessions > 0 && row.sessions === 0;
  if (chip === "rising")
    return (
      row.delta.kind === "new" || (row.delta.kind === "pct" && row.delta.value >= CHANGE_THRESHOLD)
    );
  return row.delta.kind === "pct" && row.delta.value <= -CHANGE_THRESHOLD;
}

export function sortForChip(rows: RankedRow[], chip: ChipFilter): RankedRow[] {
  const field: "sessions" | "prevSessions" = chip === "not_used" ? "prevSessions" : "sessions";
  return [...rows].sort(
    (a, b) => b[field] - a[field] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

export function chipCounts(
  lists: RankedRow[][],
  prevWindowHasData: boolean,
): Record<ChipFilter, number> {
  const out: Record<ChipFilter, number> = { all: 0, rising: 0, declining: 0, not_used: 0 };
  for (const rows of lists) {
    for (const r of rows) {
      for (const chip of Object.keys(out) as ChipFilter[]) {
        if (matchesChip(r, chip, prevWindowHasData)) out[chip]++;
      }
    }
  }
  return out;
}

export function clickNameHint(rows: { key: string; clicks: number }[]): boolean {
  const total = rows.reduce((a, r) => a + num(r.clicks), 0);
  if (total <= 0) return false;
  const named = rows
    .filter((r) => DATA_TEST_NAME.test(r.key))
    .reduce((a, r) => a + num(r.clicks), 0);
  return named / total < DATA_TEST_SHARE;
}

const nullableNum = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : num(v);

export function toFunnelResult(hit: Record<string, number>, def: FunnelDef): FunnelResult {
  const units: number[] = [];
  def.steps.forEach((_, i) => {
    const raw = num(hit[`c${i + 1}`]);
    units.push(i === 0 ? raw : Math.min(raw, units[i - 1]));
  });
  const first = units[0] ?? 0;
  const steps = def.steps.map((step, i) => ({
    step,
    units: units[i],
    ofFirst: i === 0 ? (first > 0 ? 1 : 0) : first > 0 ? units[i] / first : 0,
    ofPrevious: i === 0 ? (first > 0 ? 1 : 0) : units[i - 1] > 0 ? units[i] / units[i - 1] : 0,
    dropoff: i < units.length - 1 ? units[i] - units[i + 1] : 0,
    seen: num(hit[`seen${i + 1}`]),
    medianMs: i === 0 ? null : nullableNum(hit[`med${i + 1}`]),
    p90Ms: i === 0 ? null : nullableNum(hit[`p90_${i + 1}`]),
  }));
  const users = def.unit === "users" && hit.s1_sessions !== undefined;
  return {
    steps,
    step1Sessions: users ? num(hit.s1_sessions) : null,
    leftOut: users ? num(hit.left_out) : null,
  };
}

export function foldBreakdown(
  hits: Record<string, unknown>[],
  steps: number,
  top: number = BREAKDOWN_TOP,
): { rows: BreakdownRow[]; total: number[] } {
  const counts = (h: Record<string, unknown>) =>
    Array.from({ length: steps }, (_, i) => num(h[`c${i + 1}`]));
  const sorted = [...hits].sort((a, b) => num(b.c1) - num(a.c1));
  const named = sorted.filter((h) => h.dim !== null && h.dim !== undefined && h.dim !== "");
  const head = named.slice(0, top);
  const rest = sorted.filter((h) => !head.includes(h));
  const conversion = (c: number[]) => (c[0] > 0 ? c[c.length - 1] / c[0] : 0);
  const rows: BreakdownRow[] = head.map((h) => {
    const c = counts(h);
    return {
      value: String(h.dim),
      label: String(h.dim),
      counts: c,
      conversion: conversion(c),
      atLeast: false,
      other: false,
      notSet: false,
    };
  });
  if (rest.length) {
    const c = rest.reduce<number[]>(
      (acc, h) => acc.map((v, i) => v + counts(h)[i]),
      Array(steps).fill(0),
    );
    const notSet = rest.every((h) => h.dim === null || h.dim === undefined || h.dim === "");
    rows.push({
      value: null,
      label: "",
      counts: c,
      conversion: conversion(c),
      atLeast: hits.length >= BREAKDOWN_LIMIT,
      other: !notSet,
      notSet,
    });
  }
  const total = rows.reduce<number[]>(
    (acc, r) => acc.map((v, i) => v + r.counts[i]),
    Array(steps).fill(0),
  );
  return { rows, total };
}

const UNITS = [
  [86400000, "d"],
  [3600000, "h"],
  [60000, "min"],
  [1000, "s"],
] as const;

export function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const [div, unit] = UNITS.find(([d]) => ms >= d) ?? UNITS[UNITS.length - 1];
  const v = ms / div;
  return gt(`rum.analytics.duration.${unit}`, {
    n: v >= 10 ? Math.round(v).toString() : v.toPrecision(2),
  });
}

const recentKey = (org: string, app: string) => `o2.rum.analytics.${org}.${app}.recent`;

export function readRecentFunnels(org: string, app: string): FunnelDef[] {
  try {
    const raw = window.localStorage.getItem(recentKey(org, app));
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .map(parseFunnelDef)
      .filter((d): d is FunnelDef => d !== null)
      .slice(0, MAX_RECENT_FUNNELS);
  } catch {
    return [];
  }
}

export function pushRecentFunnel(org: string, app: string, def: FunnelDef): FunnelDef[] {
  const sig = (d: FunnelDef) => JSON.stringify(funnelParam(d));
  const next = [def, ...readRecentFunnels(org, app).filter((d) => sig(d) !== sig(def))].slice(
    0,
    MAX_RECENT_FUNNELS,
  );
  try {
    window.localStorage.setItem(recentKey(org, app), JSON.stringify(next.map(funnelParam)));
  } catch {
    /* storage is best-effort */
  }
  return next;
}

const nodeKind = (key: string): StepKind =>
  key.startsWith("c:") ? "c" : key.startsWith("e:") ? "e" : "p";

interface LiveRow {
  row: Record<string, unknown>;
  parent: string;
  parentKey: string;
  prefix: string[];
}

export function buildPathFlow(
  rows: Record<string, string | number | null>[],
  depth: number,
  direction: "next" | "prev",
  anchorKey: string = "",
): PathFlow {
  const total = rows.reduce((a, r) => a + num(r.sessions), 0);
  const anchorSessions = num(rows[0]?.anchor_sessions) || total;
  const nodes = new Map<string, PathNode>();
  const links = new Map<string, PathLink>();
  const kept = new Map<string, string[]>();
  const anchorName = `0:${anchorKey}`;
  nodes.set(anchorName, {
    name: anchorName,
    depth: 0,
    key: anchorKey,
    kind: nodeKind(anchorKey),
    value: anchorSessions,
    pct: 1,
  });
  const addNode = (name: string, node: Omit<PathNode, "value" | "pct" | "name">, value: number) => {
    const existing = nodes.get(name);
    if (existing) existing.value += value;
    else nodes.set(name, { name, ...node, value, pct: 0 });
  };
  const addLink = (source: string, target: string, value: number, pathKeys: string[]) => {
    const id = `${source}->${target}`;
    const existing = links.get(id);
    if (existing) existing.value += value;
    else links.set(id, { source, target, value, pathKeys });
  };
  let live: LiveRow[] = rows.map((row) => ({
    row,
    parent: anchorName,
    parentKey: "0",
    prefix: [],
  }));
  for (let j = 1; j <= depth && live.length; j++) {
    const byParent = new Map<string, LiveRow[]>();
    for (const l of live) {
      const group = byParent.get(l.parentKey);
      if (group) group.push(l);
      else byParent.set(l.parentKey, [l]);
    }
    const next: LiveRow[] = [];
    const otherKeys = new Set<string>();
    for (const [parentKey, group] of byParent) {
      const parent = group[0].parent;
      const sums = new Map<string | null, number>();
      for (const l of group) {
        const k = (l.row[`s${j}`] as string | null) ?? null;
        sums.set(k, (sums.get(k) ?? 0) + num(l.row.sessions));
      }
      const ranked = [...sums.entries()]
        .filter((e): e is [string, number] => e[0] !== null)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      const top = ranked.slice(0, PATH_BRANCHES).map(([k]) => k);
      kept.set(parentKey, top);
      const prefix = group[0].prefix;
      for (const k of top) {
        const name = `${j}:${k}`;
        addNode(name, { depth: j, key: k, kind: nodeKind(k) }, sums.get(k) ?? 0);
        addLink(parent, name, sums.get(k) ?? 0, [...prefix, k]);
      }
      const rest = ranked.slice(PATH_BRANCHES);
      if (rest.length) {
        rest.forEach(([k]) => otherKeys.add(k));
        const name = `${j}:__other__`;
        const value = rest.reduce((a, [, v]) => a + v, 0);
        addNode(name, { depth: j, key: "", kind: "other" }, value);
        addLink(parent, name, value, prefix);
      }
      if (sums.has(null)) {
        const name = `${j}:__exit__`;
        addNode(
          name,
          { depth: j, key: "", kind: direction === "next" ? "exit" : "start" },
          sums.get(null) ?? 0,
        );
        addLink(parent, name, sums.get(null) ?? 0, prefix);
      }
      for (const l of group) {
        const k = l.row[`s${j}`] as string | null;
        if (k !== null && k !== undefined && top.includes(k)) {
          next.push({
            row: l.row,
            parent: `${j}:${k}`,
            parentKey: `${j}:${k}`,
            prefix: [...l.prefix, k],
          });
        }
      }
    }
    const other = nodes.get(`${j}:__other__`);
    if (other) other.keys = otherKeys.size;
    live = next;
  }
  for (const n of nodes.values()) n.pct = anchorSessions > 0 ? n.value / anchorSessions : 0;
  return {
    nodes: [...nodes.values()],
    links: [...links.values()],
    kept,
    anchorSessions,
    truncated: num(rows[0]?.path_count) > PATH_ROW_LIMIT,
  };
}

/** A path key without its kind prefix; a named event's key is its id, so it reads as the event's name while known. */
export const pathStepLabel = (
  key: string,
  events: readonly Pick<NamedEvent, "id" | "name">[],
): string => {
  const bare = key.replace(/^[pce]:/, "");
  return key.startsWith("e:") ? (events.find((e) => e.id === bare)?.name ?? bare) : bare;
};

export function pathKeyLabel(
  node: Pick<PathNode, "kind" | "key" | "keys">,
  events: readonly Pick<NamedEvent, "id" | "name">[] = [],
): string {
  if (node.kind === "other")
    return gt("rum.analytics.paths.otherKeys", { count: node.keys ?? 0 }, node.keys ?? 0);
  if (node.kind === "exit") return gt("rum.analytics.paths.leftApp");
  if (node.kind === "start") return gt("rum.analytics.paths.sessionStart");
  return pathStepLabel(node.key, events);
}

const kindTag = (kind: PathNodeKind): string =>
  ({
    p: gt("rum.analytics.kind.page"),
    c: gt("rum.analytics.kind.click"),
    e: gt("rum.analytics.kind.event"),
    other: gt("rum.analytics.funnel.other"),
    exit: gt("rum.analytics.paths.leftApp"),
    start: gt("rum.analytics.paths.sessionStart"),
  })[kind];

export function sankeyLabel(
  node: PathNode,
  events: readonly Pick<NamedEvent, "id" | "name">[] = [],
): string {
  const pct = (node.pct * 100).toFixed(1);
  return `${pathKeyLabel(node, events)}\n${gt("rum.analytics.paths.nodeSessions", { count: addCommasToNumber(node.value), pct }, node.value)}`;
}

const nameLabel = (name: string, events: readonly Pick<NamedEvent, "id" | "name">[]): string => {
  const key = name.slice(name.indexOf(":") + 1);
  if (key === "__other__") return gt("rum.analytics.funnel.other");
  if (key === "__exit__") return gt("rum.analytics.paths.leftApp");
  return pathStepLabel(key, events);
};

export function sankeyTooltip(
  params: {
    dataType: "node" | "edge";
    data: PathNode | PathLink;
  },
  events: readonly Pick<NamedEvent, "id" | "name">[] = [],
): string {
  // The anchor node (depth 0) has no branch to open, so it gets no click hint.
  const hint = `<div><i>${escapeHtml(gt("rum.analytics.paths.clickHint"))}</i></div>`;
  if (params.dataType === "edge") {
    const link = params.data as PathLink;
    return `<div>${escapeHtml(nameLabel(link.source, events))} → ${escapeHtml(nameLabel(link.target, events))}</div><div>${escapeHtml(
      gt("rum.analytics.paths.linkSessions", { count: addCommasToNumber(link.value) }, link.value),
    )}</div>${hint}`;
  }
  const node = params.data as PathNode;
  return `<div><b>${escapeHtml(pathKeyLabel(node, events))}</b> · ${escapeHtml(kindTag(node.kind))}</div><div>${escapeHtml(
    gt("rum.analytics.paths.linkSessions", { count: addCommasToNumber(node.value) }, node.value),
  )}</div><div>${escapeHtml(gt("rum.analytics.paths.ofAnchor", { pct: (node.pct * 100).toFixed(1) }))}</div>${node.depth > 0 ? hint : ""}`;
}

// Every drawn branch keeps only prefixes the flow drew, so the drawer counts the same sessions.
const keptPrefix = (flow: PathFlow, depth: number): string[] => {
  if (depth < 1) return [];
  const parts = [sqlIn("s1", flow.kept.get("0") ?? [])];
  for (let i = 2; i <= depth; i++) {
    const cases = [...flow.kept.entries()]
      .filter(([k]) => k.startsWith(`${i - 1}:`))
      .map(
        ([k, children]) =>
          `WHEN ${sqlLiteral(k.slice(String(i - 1).length + 1))} THEN ${sqlIn(`s${i}`, children)}`,
      );
    parts.push(`CASE s${i - 1} ${cases.join(" ")} ELSE FALSE END`);
  }
  return parts;
};

export function branchPredicate(flow: PathFlow, target: BranchTarget): string {
  const j = target.depth;
  if (target.type === "tuple") {
    return (target.tuple ?? [])
      .map((k, i) => (k === null ? `s${i + 1} IS NULL` : `s${i + 1} = ${sqlLiteral(k)}`))
      .join(" AND ");
  }
  if (target.type === "node") {
    return [...keptPrefix(flow, j), `s${j} = ${sqlLiteral(target.key)}`].join(" AND ");
  }
  const prefix = keptPrefix(flow, j - 1);
  const parent =
    target.parentKey !== null && j > 1 ? [`s${j - 1} = ${sqlLiteral(target.parentKey)}`] : [];
  if (target.type === "link")
    return [...prefix, ...parent, `s${j} = ${sqlLiteral(target.key)}`].join(" AND ");
  if (target.type === "exit") return [...prefix, ...parent, `s${j} IS NULL`].join(" AND ");
  if (target.parentKey !== null || j === 1) {
    const siblings = flow.kept.get(j === 1 ? "0" : `${j - 1}:${target.parentKey}`) ?? [];
    const notKept = siblings.length ? [`s${j} NOT IN (${siblings.map(sqlLiteral).join(",")})`] : [];
    return [...prefix, ...parent, `s${j} IS NOT NULL`, ...notKept].join(" AND ");
  }
  const cases = [...flow.kept.entries()]
    .filter(([k]) => k.startsWith(`${j - 1}:`))
    .map(
      ([k, children]) =>
        `WHEN ${sqlLiteral(k.slice(String(j - 1).length + 1))} THEN ${children.length ? `s${j} NOT IN (${children.map(sqlLiteral).join(",")})` : "TRUE"}`,
    );
  return [...prefix, `s${j} IS NOT NULL`, `CASE s${j - 1} ${cases.join(" ")} ELSE FALSE END`].join(
    " AND ",
  );
}

type Period = "day" | "week" | "month";

const periodStart = (d: Date, g: Period): Date =>
  g === "day"
    ? startOfDay(d)
    : g === "week"
      ? startOfWeek(d, { weekStartsOn: 1 })
      : startOfMonth(d);

const nextPeriod = (d: Date, g: Period): Date =>
  g === "day" ? addDays(d, 1) : g === "week" ? addWeeks(d, 1) : addMonths(d, 1);

// Boundaries are stepped in zoned wall time and converted back, so a DST day is 23 or 25 hours long.
const boundaries = (
  startUs: number,
  endUs: number,
  tz: string,
  g: Period,
  dataStartUs: number | null,
) => {
  let local = periodStart(toZonedTime(new Date(startUs / 1000), tz), g);
  let clipped = false;
  if (dataStartUs !== null && fromZonedTime(local, tz).getTime() * 1000 < dataStartUs) {
    const dataLocal = toZonedTime(new Date(dataStartUs / 1000), tz);
    let b = periodStart(dataLocal, g);
    if (fromZonedTime(b, tz).getTime() * 1000 < dataStartUs) b = nextPeriod(b, g);
    if (b.getTime() > local.getTime()) {
      local = b;
      clipped = true;
    }
  }
  const out: number[] = [];
  while (fromZonedTime(local, tz).getTime() * 1000 < endUs && out.length <= MAX_PERIODS) {
    out.push(fromZonedTime(local, tz).getTime() * 1000);
    local = nextPeriod(local, g);
  }
  return { out, clipped };
};

const dataDays = (endUs: number, dataStartUs: number | null): number | null =>
  dataStartUs === null ? null : Math.max(0, Math.floor((endUs - dataStartUs) / DAY_US));

const monthBlocked = (endUs: number, dataStartUs: number | null): boolean => {
  const days = dataDays(endUs, dataStartUs);
  return days !== null && days < MONTH_DATA_DAYS;
};

const autoGranularity = (
  startUs: number,
  endUs: number,
  dataStartUs: number | null,
): Period | null => {
  const days = (endUs - startUs) / DAY_US;
  if (days < MIN_PERIODS) return null;
  if (days <= DAILY_MAX_DAYS) return "day";
  if (days <= WEEKLY_MAX_DAYS || monthBlocked(endUs, dataStartUs)) return "week";
  return "month";
};

export function granularityOptions(
  startUs: number,
  endUs: number,
  timezone: string,
  dataStartUs: number | null,
): { value: Granularity; disabled: boolean; reason: string | null }[] {
  const check = (g: Period): { disabled: boolean; reason: string | null } => {
    if (g === "month" && monthBlocked(endUs, dataStartUs)) {
      return { disabled: true, reason: `dataDays:${dataDays(endUs, dataStartUs)}` };
    }
    const n = boundaries(startUs, endUs, timezone, g, null).out.length;
    if (n < MIN_PERIODS) return { disabled: true, reason: "tooFew" };
    if (n > MAX_PERIODS) return { disabled: true, reason: "tooMany" };
    return { disabled: false, reason: null };
  };
  const auto = autoGranularity(startUs, endUs, dataStartUs);
  return [
    { value: "auto", disabled: auto === null, reason: auto === null ? "tooFew" : null },
    { value: "day", ...check("day") },
    { value: "week", ...check("week") },
    { value: "month", ...check("month") },
  ];
}

export function retentionPeriods(
  startUs: number,
  endUs: number,
  timezone: string,
  nowUs: number,
  dataStartUs: number | null,
  per: Granularity,
): RetentionPeriods | { tooShort: true } | { tooMany: true } {
  const g = per === "auto" ? autoGranularity(startUs, endUs, dataStartUs) : per;
  if (!g) return { tooShort: true };
  const { out, clipped } = boundaries(startUs, endUs, timezone, g, dataStartUs);
  if (out.length > MAX_PERIODS) return { tooMany: true };
  if (out.length < MIN_PERIODS) return { tooShort: true };
  const lastEnd =
    fromZonedTime(
      nextPeriod(toZonedTime(new Date(out[out.length - 1] / 1000), timezone), g),
      timezone,
    ).getTime() * 1000;
  return {
    granularity: g,
    boundariesUs: out,
    runningIndex: lastEnd > nowUs ? out.length - 1 : null,
    dataStartUs,
    clipped,
  };
}

const LABEL_FORMAT: Record<Period, Intl.DateTimeFormatOptions> = {
  day: { month: "short", day: "numeric" },
  week: { month: "short", day: "numeric" },
  month: { month: "short", year: "numeric" },
};

const cohortLabel = (us: number, timezone: string, period: Period): string =>
  new Intl.DateTimeFormat(localeFileMap[String(i18n.global.locale)] ?? "en-US", {
    ...LABEL_FORMAT[period],
    timeZone: timezone,
  }).format(new Date(us / 1000));

export function toRetentionGrid(
  hits: Record<string, number | null>[],
  periods: RetentionPeriods,
  timezone: string,
  mode: RetentionMode,
): RetentionGrid {
  const m = periods.boundariesUs.length;
  const byCohort = new Map<number, Map<number, Record<string, number | null>>>();
  for (const h of hits) {
    const c = num(h.cohort);
    const cells = byCohort.get(c) ?? new Map<number, Record<string, number | null>>();
    cells.set(num(h.k), h);
    byCohort.set(c, cells);
  }
  const sums = Array.from({ length: m }, () => ({ users: 0, size: 0, any: false }));
  const rows = [...byCohort.keys()]
    .sort((a, b) => a - b)
    .filter((c) => c >= 0 && c < m)
    .map((c) => {
      const cells = byCohort.get(c)!;
      const size = num(cells.get(0)?.size_part);
      const span = m - c;
      const suffix: number[] = Array(span + 1).fill(0);
      for (let k = span - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + num(cells.get(k)?.users_last);
      const row = Array.from({ length: span }, (_, k) => {
        const users = mode === "after" ? suffix[k] : num(cells.get(k)?.users_on);
        const incomplete = periods.runningIndex !== null && c + k === periods.runningIndex;
        if (!incomplete && size > 0) {
          sums[k].users += users;
          sums[k].size += size;
          sums[k].any = true;
        }
        return { k, users, pct: size > 0 ? users / size : 0, incomplete };
      });
      return {
        cohort: c,
        label: cohortLabel(periods.boundariesUs[c], timezone, periods.granularity),
        size,
        cells: row,
      };
    });
  return { rows, average: sums.map((x) => (x.any && x.size > 0 ? x.users / x.size : null)) };
}

export function toFeatureRows(
  hit: Record<string, number>,
  events: NamedEvent[],
  totalSessions: number,
  prevTotalSessions: number,
  prevWindowHasData: boolean,
): RankedRow[] {
  return events.map((ev, i) => {
    const sessions = num(hit[`e${i}_sessions`]);
    const prevSessions = num(hit[`e${i}_prev_sessions`]);
    const hasUsers = hit[`e${i}_users`] !== undefined;
    return {
      kind: "e" as const,
      key: ev.id,
      sessions,
      prevSessions,
      users: hasUsers ? num(hit[`e${i}_users`]) : null,
      prevUsers: hasUsers ? num(hit[`e${i}_prev_users`]) : null,
      events: num(hit[`e${i}_events`]),
      prevEvents: num(hit[`e${i}_prev_events`]),
      share: totalSessions > 0 ? sessions / totalSessions : 0,
      prevShare: prevTotalSessions > 0 ? prevSessions / prevTotalSessions : 0,
      delta: computeDelta(sessions, prevSessions, prevWindowHasData),
      pages: null,
      topPage: null,
    };
  });
}
