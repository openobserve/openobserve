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

import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { escapeSingleQuotes } from "@/utils/queryUtils";

export const LOG_LINK_PARAMS = ["log_stream", "log_ts", "log_id", "log_fp"] as const;
export const RESOLVE_SIZE = 5000;
export const DEFAULT_QUICK_MODE_NUM_FIELDS = 500;
export const LOG_LINK_I18N = {
  disabledFunction: "search.linePermalink.disabledFunction",
  disabledTimestampRewrite: "search.linePermalink.disabledTimestampRewrite",
  disabledNotSingleLines: "search.linePermalink.disabledNotSingleLines",
  disabledNoTimestamp: "search.linePermalink.disabledNoTimestamp",
  disabledEnrichmentTable: "search.linePermalink.disabledEnrichmentTable",
  toastNotUnique: "search.linePermalink.toastNotUnique",
  toastWideStream: "search.linePermalink.toastWideStream",
  bannerInvalid: "search.linePermalink.bannerInvalid",
  bannerDenied: "search.linePermalink.bannerDenied",
  bannerStreamMissing: "search.linePermalink.bannerStreamMissing",
  bannerError: "search.linePermalink.bannerError",
  bannerIncomplete: "search.linePermalink.bannerIncomplete",
  bannerGone: "search.linePermalink.bannerGone",
  bannerGoneRetention: "search.linePermalink.bannerGoneRetention",
  bannerFound: "search.linePermalink.bannerFound",
  bannerAmbiguous: "search.linePermalink.bannerAmbiguous",
  bannerChanged: "search.linePermalink.bannerChanged",
  actionRetry: "common.retry",
  actionShowLines: "search.linePermalink.actionShowLines",
  actionShowInContext: "search.linePermalink.actionShowInContext",
} as const;

const O2_ID = "_o2_id";
const STREAM_NAME = "_stream_name";
const INTERNAL_COLUMNS = ["_timestamp", "_o2_ingest_ts", O2_ID, "_original", "_all_values"];
const STREAM_MAX_LENGTH = 256;
const STREAM_NOT_FOUND_CODE = 20002;
const TS_PATTERN = /^\d{1,19}$/;
const ID_PATTERN = /^-?\d{1,20}$/;
const FP_PATTERN = /^[0-9a-z]{1,14}$/;
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;
const VIEW_MODES_WITHOUT_ROWS = new Set(["visualize", "patterns", "build"]);
const AGGREGATE_FUNCTIONS = new Set([
  "count",
  "sum",
  "min",
  "max",
  "avg",
  "mean",
  "median",
  "array_agg",
  "string_agg",
  "approx_distinct",
  "approx_median",
  "approx_percentile_cont",
  "approx_percentile_cont_with_weight",
  "approx_topk",
  "approx_topk_distinct",
  "percentile_cont",
  "stddev",
  "stddev_pop",
  "stddev_samp",
  "var",
  "var_pop",
  "var_samp",
  "variance",
  "corr",
  "covar",
  "covar_pop",
  "covar_samp",
  "first_value",
  "last_value",
  "bit_and",
  "bit_or",
  "bit_xor",
  "bool_and",
  "bool_or",
]);

const OUTCOME_SEVERITY: Record<PermalinkState, PermalinkOutcome["severity"]> = {
  invalid: "warning",
  denied: "error",
  stream_missing: "warning",
  error: "error",
  incomplete: "warning",
  gone: "warning",
  found: "info",
  ambiguous: "info",
};

const OUTCOME_ACTION: Record<PermalinkState, I18nKey | null> = {
  invalid: null,
  denied: null,
  stream_missing: null,
  error: LOG_LINK_I18N.actionRetry,
  incomplete: LOG_LINK_I18N.actionShowLines,
  gone: null,
  found: LOG_LINK_I18N.actionShowInContext,
  ambiguous: LOG_LINK_I18N.actionShowLines,
};

export type LogRow = Record<string, unknown>;

export interface LineLink {
  stream: string;
  ts: number;
  id?: string;
  fp?: string;
}

export type ParsedPermalink =
  { kind: "none" } | { kind: "invalid" } | { kind: "valid"; link: LineLink };

export type TrustworthyFields = string[] | "all";

export type LineLinkEligibility =
  { kind: "hidden" } | { kind: "disabled"; reasonKey: I18nKey } | { kind: "enabled" };

export interface LineLinkEligibilityInput {
  viewMode: string;
  functionActive: boolean;
  sqlMode: boolean;
  parsedSql: unknown;
  timestampColumn: string;
  streamType: string;
  row: LogRow;
}

export interface WideStreamInput {
  schemaFieldCount: number;
  quickModeNumFields?: number | null;
  quickModeForceEnabled?: boolean | null;
}

export interface ResolveRequest {
  searchType: "other";
  useCache: false;
  options: {
    org_identifier: string;
    page_type: "logs";
    query: {
      query: {
        sql: string;
        start_time: number;
        end_time: number;
        from: number;
        size: number;
        quick_mode: false;
      };
      regions?: string[];
      clusters?: string[];
    };
  };
}

export interface ResolveRequestInput {
  orgIdentifier: string;
  stream: string;
  ts: number;
  id?: string;
  regions?: string[];
  clusters?: string[];
}

export interface ResolveResult {
  status: number | null;
  data?: unknown;
}

export interface CopyLinkInput {
  stream: string;
  ts: number;
  row: LogRow;
  timestampColumn: string;
  trustworthy: TrustworthyFields;
  wide: boolean;
  resolve: ResolveResult | null;
  allFieldsName?: string;
  size?: number;
}

export type CopyLinkDecision =
  { kind: "exact"; link: LineLink } | { kind: "timestamp"; link: LineLink; toastKey: I18nKey };

export type PermalinkState =
  "invalid" | "denied" | "stream_missing" | "error" | "incomplete" | "gone" | "found" | "ambiguous";

export interface PermalinkOutcome {
  state: PermalinkState;
  severity: "info" | "warning" | "error";
  messageKey: I18nKey;
  messageParams: Record<string, string | number>;
  pluralCount: number | null;
  actionKey: I18nKey | null;
  record: LogRow | null;
}

export interface PermalinkOutcomeInput {
  parsed: Exclude<ParsedPermalink, { kind: "none" }>;
  result: ResolveResult | null;
  allFieldsName?: string;
  retentionDays?: number | null;
  size?: number;
}

export const canonicalRecordJson = (record: LogRow, allFieldsName?: string): string => {
  const excluded = new Set([...INTERNAL_COLUMNS, STREAM_NAME]);
  if (allFieldsName) excluded.add(allFieldsName);
  const kept: LogRow = {};
  for (const key of Object.keys(record)) {
    if (!excluded.has(key)) setOwn(kept, key, record[key]);
  }
  return JSON.stringify(canonicalValue(kept) ?? {});
};

export const fingerprintRecord = (record: LogRow, allFieldsName?: string): string => {
  const bytes = new TextEncoder().encode(canonicalRecordJson(record, allFieldsName));
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(36);
};

export const parsePermalinkQuery = (query: Record<string, unknown>): ParsedPermalink => {
  const present = (key: string) => query[key] !== undefined;
  if (!LOG_LINK_PARAMS.some(present)) return { kind: "none" };
  const stream = query.log_stream;
  const ts = parseTimestampParam(query.log_ts);
  if (!isValidStreamName(stream) || ts === null) return { kind: "invalid" };
  if (present("log_id") && present("log_fp")) return { kind: "invalid" };
  if (present("log_id")) {
    return matchesPattern(query.log_id, ID_PATTERN)
      ? { kind: "valid", link: { stream, ts, id: query.log_id } }
      : { kind: "invalid" };
  }
  if (present("log_fp")) {
    return matchesPattern(query.log_fp, FP_PATTERN)
      ? { kind: "valid", link: { stream, ts, fp: query.log_fp } }
      : { kind: "invalid" };
  }
  return { kind: "valid", link: { stream, ts } };
};

export const buildLineLinkQuery = (
  shareQuery: Record<string, unknown>,
  link: LineLink,
): Record<string, unknown> | null => {
  if (!isValidLineLink(link)) return null;
  const query: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(shareQuery)) {
    if (!isDroppedOnLineLink(key)) setOwn(query, key, value);
  }
  const from = toFiniteNumber(shareQuery.from);
  const to = toFiniteNumber(shareQuery.to);
  query.from = from === null ? link.ts : Math.min(from, link.ts);
  query.to = to === null ? link.ts + 1 : Math.max(to, link.ts + 1);
  query.refresh = 0;
  query.log_stream = link.stream;
  query.log_ts = String(link.ts);
  if (link.id !== undefined) query.log_id = link.id;
  else if (link.fp !== undefined) query.log_fp = link.fp;
  return query;
};

export const lineStreamOf = (row: LogRow, selectedStreams: string[]): string | null => {
  const fromHit = row[STREAM_NAME];
  if (typeof fromHit === "string" && fromHit !== "") return fromHit;
  return selectedStreams[0] ?? null;
};

export const readRowTimestamp = (row: LogRow, timestampColumn: string): number | null => {
  const value = row[timestampColumn];
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  return parseTimestampParam(value);
};

export const lineLinkEligibility = (input: LineLinkEligibilityInput): LineLinkEligibility => {
  if (VIEW_MODES_WITHOUT_ROWS.has(input.viewMode)) return { kind: "hidden" };
  const reasonKey = disabledReason(input);
  return reasonKey === null ? { kind: "enabled" } : { kind: "disabled", reasonKey };
};

export const isWideStream = (input: WideStreamInput): boolean => {
  const limit =
    typeof input.quickModeNumFields === "number" && input.quickModeNumFields > 0
      ? input.quickModeNumFields
      : DEFAULT_QUICK_MODE_NUM_FIELDS;
  const forced = input.quickModeForceEnabled ?? true;
  return forced && input.schemaFieldCount > limit;
};

export const buildResolveRequest = (input: ResolveRequestInput): ResolveRequest => {
  let sql = `SELECT * FROM ${quoteSqlIdentifierIfNeeded(input.stream)}`;
  if (input.id !== undefined) sql += ` WHERE ${O2_ID} = '${escapeSingleQuotes(input.id)}'`;
  const query: ResolveRequest["options"]["query"] = {
    query: {
      sql,
      start_time: input.ts,
      end_time: input.ts + 1,
      from: 0,
      size: RESOLVE_SIZE,
      quick_mode: false,
    },
  };
  if (input.regions?.length) query.regions = [...input.regions];
  if (input.clusters?.length) query.clusters = [...input.clusters];
  return {
    searchType: "other",
    useCache: false,
    options: { org_identifier: input.orgIdentifier, page_type: "logs", query },
  };
};

export const isResolveComplete = (result: ResolveResult, size: number = RESOLVE_SIZE): boolean => {
  if (result.status !== 200 || !isRecord(result.data)) return false;
  const body = result.data;
  if (body.is_partial === true || hasFunctionError(body.function_error)) return false;
  return Array.isArray(body.hits) && body.hits.length < size;
};

export const decideCopyLink = (input: CopyLinkInput): CopyLinkDecision => {
  const base: LineLink = { stream: input.stream, ts: input.ts };
  if (input.wide && rowId(input.row) === null) {
    return { kind: "timestamp", link: base, toastKey: LOG_LINK_I18N.toastWideStream };
  }
  const notUnique: CopyLinkDecision = {
    kind: "timestamp",
    link: base,
    toastKey: LOG_LINK_I18N.toastNotUnique,
  };
  if (input.resolve === null || !isResolveComplete(input.resolve, input.size)) return notUnique;
  const candidates = recordsOf(input.resolve.data);
  const matches = candidates.filter((candidate) => isCopyMatch(candidate, input));
  const distinct = distinctRecords(matches, input.allFieldsName);
  if (distinct.length !== 1) return notUnique;
  const picked = distinct[0];
  const id = rowId(picked);
  if (id !== null) return { kind: "exact", link: { ...base, id } };
  return { kind: "exact", link: { ...base, fp: fingerprintRecord(picked, input.allFieldsName) } };
};

export const permalinkOutcome = (input: PermalinkOutcomeInput): PermalinkOutcome => {
  if (input.parsed.kind !== "valid") return outcome("invalid", LOG_LINK_I18N.bannerInvalid);
  const { link } = input.parsed;
  const result = input.result ?? { status: null };
  const body = isRecord(result.data) ? result.data : {};
  if (result.status === 403) {
    return outcome("denied", LOG_LINK_I18N.bannerDenied, { stream: link.stream });
  }
  if (result.status !== 200 && body.code === STREAM_NOT_FOUND_CODE) {
    return outcome("stream_missing", LOG_LINK_I18N.bannerStreamMissing, { stream: link.stream });
  }
  if (result.status !== 200 || !Array.isArray(body.hits)) {
    return outcome("error", LOG_LINK_I18N.bannerError);
  }
  if (!isResolveComplete(result, input.size)) {
    return outcome("incomplete", LOG_LINK_I18N.bannerIncomplete);
  }
  const rows = recordsOf(body);
  if (rows.length === 0) return goneOutcome(input.retentionDays);
  return link.id === undefined && link.fp === undefined
    ? timestampOutcome(rows)
    : identityOutcome(link, rows, input.allFieldsName);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const setOwn = (target: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

const canonicalValue = (value: unknown): unknown => {
  if (value === null || value === undefined || value === "") return undefined;
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item) ?? null);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const canonical = canonicalValue(value[key]);
      if (canonical !== undefined) setOwn(out, key, canonical);
    }
    return out;
  }
  return String(value);
};

const sameFieldValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalValue(left) ?? null) === JSON.stringify(canonicalValue(right) ?? null);

const matchesPattern = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);

const parseTimestampParam = (value: unknown): number | null => {
  if (!matchesPattern(value, TS_PATTERN)) return null;
  const ts = Number(value);
  return ts <= Number.MAX_SAFE_INTEGER ? ts : null;
};

const isValidStreamName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= STREAM_MAX_LENGTH &&
  !CONTROL_CHARS.test(value);

const isValidLineLink = (link: LineLink): boolean => {
  if (!isValidStreamName(link.stream)) return false;
  if (!Number.isSafeInteger(link.ts) || link.ts < 0) return false;
  if (link.id !== undefined && link.fp !== undefined) return false;
  if (link.id !== undefined && !ID_PATTERN.test(link.id)) return false;
  return link.fp === undefined || FP_PATTERN.test(link.fp);
};

const isDroppedOnLineLink = (key: string): boolean =>
  key === "page" ||
  key === "period" ||
  key.startsWith("cmp_") ||
  (LOG_LINK_PARAMS as readonly string[]).includes(key);

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const disabledReason = (input: LineLinkEligibilityInput): I18nKey | null => {
  if (input.functionActive) return LOG_LINK_I18N.disabledFunction;
  if (input.sqlMode) {
    const statement = singleStatement(input.parsedSql);
    if (statement !== null && rewritesIdentity(statement, input.timestampColumn)) {
      return LOG_LINK_I18N.disabledTimestampRewrite;
    }
    if (statement === null || !isSingleLineShape(statement)) {
      return LOG_LINK_I18N.disabledNotSingleLines;
    }
  }
  if (readRowTimestamp(input.row, input.timestampColumn) === null) {
    return LOG_LINK_I18N.disabledNoTimestamp;
  }
  if (input.streamType === "enrichment_tables") return LOG_LINK_I18N.disabledEnrichmentTable;
  return null;
};

const singleStatement = (parsed: unknown): Record<string, unknown> | null => {
  if (Array.isArray(parsed)) return parsed.length === 1 ? singleStatement(parsed[0]) : null;
  return isRecord(parsed) ? parsed : null;
};

const someNode = (
  node: unknown,
  predicate: (node: Record<string, unknown>) => boolean,
): boolean => {
  if (Array.isArray(node)) return node.some((item) => someNode(item, predicate));
  if (!isRecord(node)) return false;
  if (predicate(node)) return true;
  return Object.values(node).some((value) => someNode(value, predicate));
};

const isSubquery = (node: Record<string, unknown>): boolean =>
  isRecord(node.ast) || node.type === "select";

const functionName = (name: unknown): string => {
  if (typeof name === "string") return name;
  if (isRecord(name) && Array.isArray(name.name)) {
    return name.name.map((part) => (isRecord(part) ? String(part.value ?? "") : "")).join(".");
  }
  return "";
};

const isAggregate = (node: Record<string, unknown>): boolean => {
  if (node.over !== null && node.over !== undefined) return false;
  if (node.type === "aggr_func") return true;
  return node.type === "function" && AGGREGATE_FUNCTIONS.has(functionName(node.name).toLowerCase());
};

const isSingleLineShape = (statement: Record<string, unknown>): boolean => {
  if (statement.type !== "select" || statement.with || statement._next || statement.set_op) {
    return false;
  }
  if (isRecord(statement.distinct) && statement.distinct.type) return false;
  if (hasClause(statement.groupby) || hasClause(statement.having)) return false;
  const from = statement.from;
  if (!Array.isArray(from) || from.length !== 1) return false;
  const source = from[0];
  if (!isRecord(source) || typeof source.table !== "string" || source.join || source.expr) {
    return false;
  }
  const clauses = [statement.columns, statement.where, statement.orderby];
  if (clauses.some((clause) => someNode(clause, isSubquery))) return false;
  return !someNode(statement.columns, isAggregate);
};

const hasClause = (clause: unknown): boolean => {
  if (clause === null || clause === undefined) return false;
  if (Array.isArray(clause)) return clause.length > 0;
  if (isRecord(clause) && Array.isArray(clause.columns)) return clause.columns.length > 0;
  return true;
};

const columnRefName = (expr: unknown): string | null => {
  if (!isRecord(expr) || expr.type !== "column_ref") return null;
  const column = expr.column;
  if (typeof column === "string") return column.toLowerCase();
  if (isRecord(column) && isRecord(column.expr) && typeof column.expr.value === "string") {
    const name = column.expr.value;
    return column.expr.type === "double_quote_string" ? name : name.toLowerCase();
  }
  return null;
};

const aliasName = (alias: unknown): string | null => {
  if (typeof alias === "string") return alias;
  return isRecord(alias) && typeof alias.value === "string" ? alias.value : null;
};

const rewritesIdentity = (statement: Record<string, unknown>, timestampColumn: string): boolean => {
  const guarded = new Set([timestampColumn, O2_ID]);
  const guardedLower = new Set([...guarded].map((name) => name.toLowerCase()));
  const columns = Array.isArray(statement.columns) ? statement.columns : [];
  return columns.some((item) => {
    if (!isRecord(item)) return false;
    const alias = aliasName(item.as)?.toLowerCase() ?? null;
    if (alias === null) return false;
    const ref = columnRefName(item.expr);
    const touchesIdentity =
      guardedLower.has(alias) || (ref !== null && guardedLower.has(ref.toLowerCase()));
    const sameIdentityColumn = ref !== null && guarded.has(ref) && ref.toLowerCase() === alias;
    return touchesIdentity && !sameIdentityColumn;
  });
};

const rowId = (row: LogRow): string | null => {
  const value = row[O2_ID];
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }
  const id = String(value);
  return ID_PATTERN.test(id) ? id : null;
};

const recordsOf = (body: unknown): LogRow[] => {
  if (!isRecord(body) || !Array.isArray(body.hits)) return [];
  return body.hits.filter(isRecord);
};

const hasFunctionError = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some((item) => item !== "" && item !== null);
  return value !== undefined && value !== null && value !== "";
};

const comparedFields = (row: LogRow, trustworthy: TrustworthyFields): string[] =>
  (trustworthy === "all" ? Object.keys(row) : trustworthy).filter((field) => field !== STREAM_NAME);

const isCopyMatch = (candidate: LogRow, input: CopyLinkInput): boolean => {
  const visibleId = rowId(input.row);
  if (visibleId !== null && rowId(candidate) !== visibleId) return false;
  if (!sameFieldValue(candidate[input.timestampColumn], input.row[input.timestampColumn])) {
    return false;
  }
  return comparedFields(input.row, input.trustworthy).every((field) =>
    sameFieldValue(candidate[field], input.row[field]),
  );
};

const distinctRecords = (rows: LogRow[], allFieldsName?: string): LogRow[] => {
  const seen = new Map<string, LogRow>();
  for (const row of rows) {
    const key = canonicalRecordJson(row, allFieldsName);
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
};

const outcome = (
  state: PermalinkState,
  messageKey: I18nKey,
  messageParams: Record<string, string | number> = {},
  extra: Partial<PermalinkOutcome> = {},
): PermalinkOutcome => ({
  state,
  severity: OUTCOME_SEVERITY[state],
  messageKey,
  messageParams,
  pluralCount: typeof messageParams.count === "number" ? messageParams.count : null,
  actionKey: OUTCOME_ACTION[state],
  record: null,
  ...extra,
});

const goneOutcome = (retentionDays: number | null | undefined): PermalinkOutcome => {
  if (typeof retentionDays === "number" && retentionDays > 0) {
    return outcome(
      "gone",
      LOG_LINK_I18N.bannerGoneRetention,
      { days: retentionDays },
      { pluralCount: retentionDays },
    );
  }
  return outcome("gone", LOG_LINK_I18N.bannerGone);
};

const timestampOutcome = (rows: LogRow[]): PermalinkOutcome =>
  rows.length === 1
    ? outcome("found", LOG_LINK_I18N.bannerFound, {}, { record: rows[0] })
    : outcome("ambiguous", LOG_LINK_I18N.bannerAmbiguous, { count: rows.length });

const identityOutcome = (
  link: LineLink,
  rows: LogRow[],
  allFieldsName?: string,
): PermalinkOutcome => {
  const matches = rows.filter((row) =>
    link.id !== undefined
      ? rowId(row) === link.id
      : fingerprintRecord(row, allFieldsName) === link.fp,
  );
  if (matches.length === 0) return outcome("ambiguous", LOG_LINK_I18N.bannerChanged);
  const distinct = distinctRecords(matches, allFieldsName);
  if (distinct.length === 1) {
    return outcome("found", LOG_LINK_I18N.bannerFound, {}, { record: distinct[0] });
  }
  return outcome("ambiguous", LOG_LINK_I18N.bannerAmbiguous, { count: rows.length });
};
