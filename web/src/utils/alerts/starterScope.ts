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

import type { StarterScope } from "@/components/create-starter/createStarter.types";
import type { FieldAlias, ServiceIdentityConfig } from "@/services/service_streams";
import type { AlertPrefill, AlertPrefillConditionGroup } from "@/ts/interfaces/alertPrefill";
import { locationDimensions } from "@/plugins/correlation/correlationHeader";
import { SERVICE_GROUP_ID } from "@/plugins/correlation/correlationVersions";
import { addToSqlWhere } from "@/utils/security/eventQuery";
import { quoteIdent, quoteString } from "@/utils/security/sql";

/** Why a scope left the prefill as it was; the pane words it. */
export type ScopeSkipReason = "streamDiffers" | "noField" | "queryShape";

export type ScopeStreamType = "logs" | "metrics" | "traces";

/** One row of `GET /service_streams`, as far as the scope reads it. */
export interface ScopeServiceRow {
  service_name?: string;
  display_name?: string;
  display_qualifier?: string;
  named_after_stream?: boolean;
  disambiguation?: Record<string, string>;
  all_dimensions?: Record<string, string>;
  /** Identity dimension id → the raw field the service's records carry it in. */
  field_name_mapping?: Record<string, string> | null;
  logs_streams?: string[];
  traces_streams?: string[];
  metrics_streams?: string[];
}

export interface ScopeOption {
  key: string;
  label: string;
  scope: StarterScope;
  /** The streams the option's services write to, by type; absent for a stream option. */
  streams?: Record<ScopeStreamType, ReadonlySet<string>>;
}

export interface ScopeDimensionGroup {
  id: string;
  label: string;
  options: ScopeOption[];
}

export interface ScopeEntry {
  stream: string;
  stream_type: string;
  required_streams: string[];
}

const STREAM_TYPES: readonly ScopeStreamType[] = ["logs", "metrics", "traces"];
const PROMQL_LABEL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PROMQL_KEYWORDS = new Set(["bool", "and", "or", "unless", "offset", "inf", "nan"]);
const PROMQL_LABEL_LISTS = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
]);

let conditionSeq = 0;

export const scopeKey = (scope: StarterScope): string => {
  if (scope.kind === "all") return "all";
  if (scope.kind === "stream") return `stream:${scope.streamType}/${scope.streamName}`;
  const sorted = Object.entries(scope.dimensions).sort(([a], [b]) => a.localeCompare(b));
  return `service:${JSON.stringify(sorted)}`;
};

const fieldOf = (id: string, row: ScopeServiceRow, groups: readonly FieldAlias[]) =>
  row.field_name_mapping?.[id] || groups.find((group) => group.id === id)?.fields?.[0] || "";

const valueOf = (row: ScopeServiceRow, id: string) =>
  row.disambiguation?.[id] || row.all_dimensions?.[id] || "";

const emptyStreams = () =>
  Object.fromEntries(STREAM_TYPES.map((type) => [type, new Set<string>()])) as Record<
    ScopeStreamType,
    Set<string>
  >;

const addStreams = (into: Record<ScopeStreamType, Set<string>>, row: ScopeServiceRow) => {
  for (const type of STREAM_TYPES) {
    for (const name of row[`${type}_streams` as const] ?? []) into[type].add(name);
  }
};

/** Services, then one group per identity dimension; every field name comes from the org's config. */
export function buildScopeOptions(
  rows: readonly ScopeServiceRow[],
  identity: ServiceIdentityConfig | null | undefined,
  groups: readonly FieldAlias[],
): { services: ScopeOption[]; dimensions: ScopeDimensionGroup[] } {
  const named = rows.filter((row) => row.service_name && row.named_after_stream !== true);
  const services = new Map<
    string,
    ScopeOption & { streams: Record<ScopeStreamType, Set<string>> }
  >();
  for (const row of named) {
    const dimensions: Record<string, string> = {};
    const ids = [SERVICE_GROUP_ID, ...Object.keys(row.disambiguation ?? {})];
    for (const id of ids) {
      const field = fieldOf(id, row, groups);
      const value = valueOf(row, id);
      if (field && value) dimensions[field] = value;
    }
    if (!Object.keys(dimensions).length) continue;
    const scope: StarterScope = { kind: "service", service: row.service_name!, dimensions };
    const key = scopeKey(scope);
    const name = row.display_name || row.service_name!;
    const option = services.get(key) ?? {
      key,
      label: row.display_qualifier ? `${name} · ${row.display_qualifier}` : name,
      scope,
      streams: emptyStreams(),
    };
    addStreams(option.streams, row);
    services.set(key, option);
  }

  const dimensions = locationDimensions(identity ?? undefined).flatMap((id) => {
    const byValue = new Map<string, ScopeServiceRow[]>();
    for (const row of named) {
      const value = valueOf(row, id);
      if (value) byValue.set(value, [...(byValue.get(value) ?? []), row]);
    }
    const field = named.map((row) => fieldOf(id, row, groups)).find(Boolean);
    if (!field || !byValue.size) return [];
    const options = [...byValue.entries()].map(([value, members]) => {
      const scope: StarterScope = {
        kind: "service",
        service: value,
        dimensions: { [field]: value },
      };
      const streams = emptyStreams();
      members.forEach((row) => addStreams(streams, row));
      return { key: scopeKey(scope), label: value, scope, streams };
    });
    const label = groups.find((group) => group.id === id)?.display || id;
    return [{ id, label, options: options.sort(byLabel) }];
  });

  return { services: withDistinctLabels([...services.values()]).sort(byLabel), dimensions };
}

/** Options sharing a label gain the dimension values that tell them apart: "cadvisor · shop". */
function withDistinctLabels<T extends ScopeOption>(options: T[]): T[] {
  const sameLabel = new Map<string, T[]>();
  options.forEach((o) => sameLabel.set(o.label, [...(sameLabel.get(o.label) ?? []), o]));
  return [...sameLabel.values()].flatMap((same) => {
    if (same.length < 2) return same;
    const dims = (o: T) => (o.scope.kind === "service" ? o.scope.dimensions : {});
    const fields = Object.keys(dims(same[0])).filter(
      (field) => new Set(same.map((o) => dims(o)[field])).size > 1,
    );
    return same.map((o) => ({
      ...o,
      label: [o.label, ...fields.map((field) => dims(o)[field]).filter(Boolean)].join(" · "),
    }));
  });
}

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

/** Whether a library entry reads data the scope covers; a service scope needs its option's streams. */
export function entryInScope(
  entry: ScopeEntry,
  scope: StarterScope,
  option?: Pick<ScopeOption, "streams"> | null,
): boolean {
  if (scope.kind === "all") return true;
  const streams = entry.required_streams?.length ? entry.required_streams : [entry.stream];
  if (scope.kind === "stream") {
    return entry.stream_type === scope.streamType && streams.includes(scope.streamName);
  }
  const held = option?.streams?.[entry.stream_type as ScopeStreamType];
  return !!held && streams.some((name) => held.has(name));
}

/** Each scope field the stream holds, or its alias the stream holds; all of them when the schema is unknown. */
const resolveFields = (
  dimensions: Record<string, string>,
  fields: ReadonlySet<string> | undefined,
  groups: readonly FieldAlias[],
): [string, string][] =>
  Object.entries(dimensions).flatMap(([field, value]): [string, string][] => {
    if (!fields || fields.has(field)) return [[field, value]];
    const alias = groups
      .find((group) => group.fields?.includes(field))
      ?.fields.find((spelling) => fields.has(spelling));
    return alias ? [[alias, value]] : [];
  });

const promqlValue = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const closingAt = (query: string, from: number, close: string): number => {
  for (let i = from + 1; i < query.length; i++) {
    const ch = query[i];
    if (ch === close) return i;
    if (ch === '"' || ch === "'" || ch === "`") {
      i = stringEnd(query, i);
      if (i === -1) return -1;
    }
  }
  return -1;
};

const stringEnd = (query: string, from: number): number => {
  const quote = query[from];
  for (let i = from + 1; i < query.length; i++) {
    if (query[i] === "\\" && quote !== "`") i += 1;
    else if (query[i] === quote) return i;
  }
  return -1;
};

const withMatchers = (braces: string, matchers: string) => {
  const inner = braces.slice(1, -1).trim().replace(/,\s*$/, "");
  return inner ? `{${inner}, ${matchers}}` : `{${matchers}}`;
};

/** Adds the matchers to every vector selector; null when the query has none or does not parse. */
export function narrowPromql(query: string, matchers: string): string | null {
  let out = "";
  let changed = false;
  let i = 0;
  while (i < query.length) {
    const ch = query[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = stringEnd(query, i);
      if (end === -1) return null;
      out += query.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === "[" || ch === "{") {
      const end = closingAt(query, i, ch === "[" ? "]" : "}");
      if (end === -1) return null;
      const part = query.slice(i, end + 1);
      out += ch === "{" ? withMatchers(part, matchers) : part;
      changed ||= ch === "{";
      i = end + 1;
      continue;
    }
    if (!/[a-zA-Z_:]/.test(ch) || /[\w:.]/.test(query[i - 1] ?? "")) {
      out += ch;
      i += 1;
      continue;
    }
    let end = i;
    while (end < query.length && /[\w:]/.test(query[end])) end += 1;
    const word = query.slice(i, end);
    let next = end;
    while (next < query.length && /\s/.test(query[next])) next += 1;
    if (PROMQL_LABEL_LISTS.has(word.toLowerCase()) && query[next] === "(") {
      const close = closingAt(query, next, ")");
      if (close === -1) return null;
      out += query.slice(i, close + 1);
      i = close + 1;
    } else if (PROMQL_KEYWORDS.has(word.toLowerCase()) || query[next] === "(") {
      out += word;
      i = end;
    } else if (query[next] === "{") {
      const close = closingAt(query, next, "}");
      if (close === -1) return null;
      out += query.slice(i, next) + withMatchers(query.slice(next, close + 1), matchers);
      changed = true;
      i = close + 1;
    } else {
      out += `${word}{${matchers}}`;
      changed = true;
      i = end;
    }
  }
  return changed ? out : null;
}

const withConditions = (
  group: AlertPrefillConditionGroup | undefined,
  pairs: [string, string][],
): AlertPrefillConditionGroup => {
  const added = pairs.map(([column, value]) => ({
    filterType: "condition",
    column,
    operator: "=",
    value,
    values: [],
    logicalOperator: "AND",
    id: `starter-scope-${(conditionSeq += 1)}`,
  }));
  if (!group) {
    return {
      filterType: "group",
      logicalOperator: "AND",
      groupId: "starter-scope",
      conditions: added,
    };
  }
  // An OR group would let either side match, so it is nested and the scope sits beside it.
  const kept = group.logicalOperator === "AND" ? group.conditions : [group];
  return { ...group, logicalOperator: "AND", conditions: [...kept, ...added] };
};

/**
 * A library prefill narrowed to the scope. A kind that cannot be narrowed safely comes back as it
 * was, with the reason; `fields` is the stream's schema, used to pick the spelling it holds.
 */
export function scopePrefill(
  prefill: AlertPrefill,
  scope: StarterScope,
  context: { fields?: ReadonlySet<string>; groups?: readonly FieldAlias[] } = {},
): { prefill: AlertPrefill; reason: ScopeSkipReason | null } {
  const unchanged = (reason: ScopeSkipReason | null) => ({ prefill, reason });
  if (scope.kind === "all") return unchanged(null);
  if (scope.kind === "stream") {
    const same = prefill.streamType === scope.streamType && prefill.streamName === scope.streamName;
    return unchanged(same ? null : "streamDiffers");
  }
  const pairs = resolveFields(scope.dimensions, context.fields, context.groups ?? []);
  if (!pairs.length) return unchanged("noField");
  const meta = { ...prefill.meta, scope: Object.fromEntries(pairs) };

  if (prefill.queryType === "promql") {
    if (!pairs.every(([field]) => PROMQL_LABEL.test(field))) return unchanged("queryShape");
    const matchers = pairs.map(([field, value]) => `${field}=${promqlValue(value)}`).join(", ");
    const promql = narrowPromql(prefill.promql ?? "", matchers);
    return promql
      ? { prefill: { ...prefill, promql, meta }, reason: null }
      : unchanged("queryShape");
  }
  if (prefill.queryType === "sql" && prefill.sql) {
    const clause = pairs
      .map(([field, value]) => `${quoteIdent(field)} = ${quoteString(value)}`)
      .join(" AND ");
    const sql = addToSqlWhere(prefill.sql, clause);
    return sql ? { prefill: { ...prefill, sql, meta }, reason: null } : unchanged("queryShape");
  }
  const conditions = withConditions(prefill.conditions, pairs);
  return { prefill: { ...prefill, conditions, meta }, reason: null };
}

/** The contract's form: the narrowed prefill, or the prefill as it was. */
export const applyScope = (prefill: AlertPrefill, scope: StarterScope): AlertPrefill =>
  scopePrefill(prefill, scope).prefill;
