import type { Scope } from "@/services/service_versions";
import { inEnv, isExplicitEnv } from "@/services/service_versions.envs";
import type { StreamInfo } from "@/services/service_streams";
import type { FieldAlias } from "@/services/service_streams";
import {
  buildSqlCondition,
  extractSemanticDimensions,
  quoteSqlLiteral,
} from "@/utils/telemetryCorrelation";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { serviceKey, serviceKeySql } from "@/utils/serviceCount";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { sortStreamsByOverlap, type StreamWithOverlap } from "@/utils/streamTimeOverlap";

export interface SemanticGroupFields {
  id: string;
  fields: string[];
  is_workload_type?: boolean;
}

export interface CorrelationPlace {
  /** The identity config's location dimensions, widest first. */
  location: string[];
  /** The record's value of each location dimension it carries, by semantic group id. */
  values: Record<string, string>;
  groups: SemanticGroupFields[];
}

export interface VersionPodRow {
  version: string | null;
  pod: string | null;
  last_seen: number | string | null;
}

export interface VersionPods {
  version: string;
  /** Distinct pods sending this version; null when the stream has no pod column. */
  pods: number | null;
}

export interface VersionsSummary {
  versions: VersionPods[];
}

export interface VersionColumns {
  pod: string | null;
}

export interface CorrelationTimeRange {
  startTime: number;
  endTime: number;
}

export interface WhereColumns {
  /** The stream's aliases of the service, any of which names it. */
  service: string[];
}

export interface WhereRow {
  where_key: string | null;
}

export interface CorrelationInstance {
  /** The record's dimensions that are neither its service nor its place. */
  dimensions: Record<string, string>;
  groups: SemanticGroupFields[];
  /** The filters correlation applied to the trace stream already name the instance. */
  pinned: boolean;
}

/** The semantic group naming a record's service, the one dimension correlation shares across orgs. */
export const SERVICE_GROUP_ID = "service";
const ALL_VALUE = "_o2_all";
const VERSION_COLUMN = "o2_service_version";
const WHERE_COLUMN = "o2_service_where";
const INSTANCE_WINDOW_US = 5 * 60 * 1_000_000;

// The catalog folds spellings by service key, so a display name matches spans spelled another way.
function sameService(a: string, b: string): boolean {
  return serviceKey(a) === serviceKey(b);
}

function serviceMatchSql(column: string, service: string): string {
  return `${serviceKeySql(column)} = ${quoteSqlLiteral(serviceKey(service))}`;
}

function serviceAliases(names: Set<string>, groups: SemanticGroupFields[]): string[] {
  const aliases = groups.find((group) => group.id === SERVICE_GROUP_ID)?.fields ?? [];
  return [...new Set(aliases)].filter((field) => names.has(field));
}

// Streams spell the service under different aliases, so any alias the stream carries matches it.
function serviceAliasSql(columns: string[], service: string): string {
  const matches = columns.map((field) => serviceMatchSql(field, service));
  return matches.length > 1 ? `(${matches.join(" OR ")})` : (matches[0] ?? "");
}

// The group's id leads, then its aliases in the group's own order, as the identity resolver reads them.
function locationValue(
  id: string,
  dimensionSets: Record<string, unknown>[],
  groups: SemanticGroupFields[],
): string | undefined {
  const keys = [id, ...(groups.find((group) => group.id === id)?.fields ?? [])];
  for (const dimensions of dimensionSets) {
    for (const key of keys) {
      const value = dimensions[key];
      if (typeof value === "string" && value !== "" && value !== ALL_VALUE) return value;
    }
  }
  return undefined;
}

/** Reads each location dimension from the correlation's dimensions, earlier sets first. */
export function placeFromDimensions(
  dimensionSets: (Record<string, unknown> | undefined)[],
  groups: SemanticGroupFields[] = [],
  location: string[] = [],
): CorrelationPlace {
  const sets = dimensionSets.filter((set): set is Record<string, unknown> => !!set);
  const values: Record<string, string> = {};
  for (const id of location) {
    const value = locationValue(id, sets, groups);
    if (value) values[id] = value;
  }
  return { location, values, groups };
}

function groupOf(key: string, groups: SemanticGroupFields[]): SemanticGroupFields | undefined {
  const lower = key.toLowerCase();
  return (
    groups.find((group) => group.id === key) ??
    groups.find((group) => group.fields.some((field) => field.toLowerCase() === lower))
  );
}

function isServiceOrPlace(
  key: string,
  group: SemanticGroupFields | undefined,
  location: string[],
): boolean {
  const id = group?.id ?? key;
  return id === SERVICE_GROUP_ID || location.includes(id) || location.includes(key);
}

/** The dimensions naming the record's instance, one per semantic group, earlier sets first. */
export function instanceDimensions(
  dimensionSets: (Record<string, unknown> | undefined)[],
  groups: SemanticGroupFields[] = [],
  location: string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const set of dimensionSets) {
    for (const [key, value] of Object.entries(set ?? {})) {
      if (typeof value !== "string" || !value || key.startsWith("_")) continue;
      if (value === ALL_VALUE || value === SELECT_ALL_VALUE) continue;
      const group = groupOf(key, groups);
      const identity = group?.id ?? key.toLowerCase();
      if (seen.has(identity) || isServiceOrPlace(key, group, location)) continue;
      seen.add(identity);
      out[key] = value;
    }
  }
  return out;
}

/** The record's raw fields keyed by the semantic groups they alias; fields no group aliases are dropped. */
export function semanticRecordDimensions(
  record: Record<string, unknown> | undefined,
  groups: FieldAlias[],
): Record<string, string> {
  return extractSemanticDimensions({ timestamp: 0, fields: record ?? {} }, groups);
}

/** The record's instance dimensions, and whether the trace stream's applied filters already name it. */
export function correlationInstance(
  applied: StreamInfo | undefined,
  dimensionSets: (Record<string, unknown> | undefined)[],
  groups: SemanticGroupFields[] = [],
  location: string[] = [],
): CorrelationInstance {
  return {
    dimensions: instanceDimensions(dimensionSets, groups, location),
    groups,
    pinned: Object.keys(instanceDimensions([applied?.filters], groups, location)).length > 0,
  };
}

/** Each instance dimension matched on any trace field aliasing it; null when the stream has none of them. */
export function instancePinSql(
  fields: string[],
  instance: Pick<CorrelationInstance, "dimensions" | "groups">,
): string | null {
  const names = new Set(fields);
  const conditions = Object.entries(instance.dimensions).flatMap(([key, value]) => {
    const group = groupOf(key, instance.groups);
    const aliases = [...new Set([key, ...(group?.fields ?? [])])].filter((f) => names.has(f));
    const matches = aliases.map((field) => buildSqlCondition(field, value));
    return matches.length > 1 ? [`(${matches.join(" OR ")})`] : matches;
  });
  return conditions.length ? conditions.join(" AND ") : null;
}

// A stream that dropped a dimension reads wider than the chips (other services' spans), so fuller matches lead.
// The backend lists streams in no fixed order, so names break the remaining ties.
export function rankCorrelatedStreams(streams: StreamWithOverlap[]): StreamWithOverlap[] {
  const byName = [...streams].sort((a, b) =>
    a.stream_name < b.stream_name ? -1 : a.stream_name > b.stream_name ? 1 : 0,
  );
  return sortStreamsByOverlap(byName).sort(
    (a, b) => (a.dropped_dimensions?.length ?? 0) - (b.dropped_dimensions?.length ?? 0),
  );
}

/** The SQL of the filters correlation applied to a stream, which are the record's own dimensions there. */
export function appliedFilterSql(stream: StreamInfo | undefined): string {
  return Object.entries(stream?.filters ?? {})
    .filter(([, value]) => value !== SELECT_ALL_VALUE)
    .map(([field, value]) => buildSqlCondition(field, value, stream?.filter_spellings?.[field]))
    .join(" AND ");
}

/** The record's spans pinned to the resolved scope's place; null when the stream cannot pin them there. */
export function instanceVersionFilter(
  fields: string[],
  applied: string,
  scope: Pick<Scope, "service" | "where_key">,
  pin: string | null = null,
  groups: SemanticGroupFields[] = [],
): string | null {
  const names = new Set(fields);
  if (!applied || !names.has(VERSION_COLUMN) || !names.has(WHERE_COLUMN)) return null;
  return [
    `(${applied})`,
    pin ? `(${pin})` : "",
    scope.where_key
      ? `${WHERE_COLUMN} = ${quoteSqlLiteral(scope.where_key)}`
      : `COALESCE(${WHERE_COLUMN}, '') = ''`,
    serviceAliasSql(serviceAliases(names, groups), scope.service),
  ]
    .filter(Boolean)
    .join(" AND ");
}

// The backend keys a scope's where by field name, so each entry maps to a location group by its aliases.
function wherePlace(scope: Scope, place: CorrelationPlace): [string, string][] {
  return Object.entries(scope.where ?? {}).flatMap(([key, value]): [string, string][] => {
    if (typeof value !== "string" || !value) return [];
    const id = place.location.find(
      (loc) =>
        loc === key || !!place.groups.find((group) => group.id === loc)?.fields.includes(key),
    );
    return id ? [[id, value]] : [];
  });
}

/** The scope matching the row's own location; null when ambiguous, undefined when it cannot decide. */
export function scopeByOwnPlace(
  scopes: Scope[],
  service: string,
  place: CorrelationPlace,
): Scope | null | undefined {
  let undecided = false;
  const byWhere = scopes.filter((scope) => {
    if (!sameService(scope.service, service)) return false;
    const where = wherePlace(scope, place);
    if (where.some(([id]) => !place.values[id])) undecided = true;
    return where.length > 0 && where.every(([id, value]) => place.values[id] === value);
  });
  if (undecided) return undefined;
  if (byWhere.length > 1) return null;
  return byWhere[0];
}

/** Picks by own location, then the one place the record's spans name (null: read failed), then env, then the only scope. */
export function pickScope(
  scopes: Scope[],
  service: string,
  place: CorrelationPlace,
  spanWheres?: string[] | null,
): Scope | null {
  const own = scopes.filter((scope) => sameService(scope.service, service));
  const byPlace = scopeByOwnPlace(own, service, place);
  if (byPlace !== undefined) return byPlace;
  if (spanWheres === null) return null;
  // A dimension shared across places (an HTTP method) names none, so it decides nothing.
  if (spanWheres?.length === 1)
    return own.find((scope) => scope.where_key === spanWheres[0]) ?? null;
  // The env is the one the backend reports as sent or set; a location value names it when it equals it.
  const values = Object.values(place.values);
  const byEnv = own.filter(
    (scope) => isExplicitEnv(scope) && values.some((value) => inEnv(scope, value)),
  );
  if (byEnv.length === 1) return byEnv[0];
  if (byEnv.length > 1) return null;
  return own.length === 1 ? own[0] : null;
}

// A workload group names a deployment its instances share, so only per-instance groups count instances.
function instanceColumn(
  names: Set<string>,
  instance: Pick<CorrelationInstance, "dimensions" | "groups"> | undefined,
): string | null {
  for (const key of Object.keys(instance?.dimensions ?? {})) {
    const group = groupOf(key, instance?.groups ?? []);
    if (group?.is_workload_type) continue;
    const field = [key, ...(group?.fields ?? [])].find((name) => names.has(name));
    if (field) return field;
  }
  return null;
}

/** The instance column a versions read groups by, or null when the stream carries no version column. */
export function versionColumns(
  fields: string[],
  instance?: Pick<CorrelationInstance, "dimensions" | "groups">,
): VersionColumns | null {
  const names = new Set(fields);
  if (!names.has(VERSION_COLUMN)) return null;
  return { pod: instanceColumn(names, instance) };
}

/** The service aliases a where read filters on, or null when the stream stamps no where. */
export function whereColumns(
  fields: string[],
  groups: SemanticGroupFields[] = [],
): WhereColumns | null {
  const names = new Set(fields);
  if (!names.has(WHERE_COLUMN)) return null;
  return { service: serviceAliases(names, groups) };
}

/** Five minutes either side of the log time, in microseconds. */
export function instanceWindow(logTime: number): CorrelationTimeRange {
  return { startTime: logTime - INSTANCE_WINDOW_US, endTime: logTime + INSTANCE_WINDOW_US };
}

// Two places are enough to know the record's spans do not name one, so the read stops there.
export function instanceWhereSql(
  stream: string,
  service: string,
  applied: string,
  columns: WhereColumns,
  pin: string | null = null,
): string {
  const where = [
    `(${applied})`,
    pin ? `(${pin})` : "",
    serviceAliasSql(columns.service, service),
    `${WHERE_COLUMN} IS NOT NULL`,
  ]
    .filter(Boolean)
    .join(" AND ");
  return `SELECT ${WHERE_COLUMN} AS where_key FROM "${stream.replace(/"/g, '""')}" WHERE ${where} GROUP BY ${WHERE_COLUMN} LIMIT 2`;
}

/** The distinct places a where read returned. */
export function instanceWheres(rows: WhereRow[]): string[] {
  return [...new Set(rows.map((row) => row.where_key).filter((key): key is string => !!key))];
}

export function versionsSql(stream: string, filter: string, columns: VersionColumns): string {
  const where = [filter ? `(${filter})` : "", `${VERSION_COLUMN} IS NOT NULL`]
    .filter(Boolean)
    .join(" AND ");
  const from = `"${stream.replace(/"/g, '""')}"`;
  return columns.pod
    ? `SELECT ${VERSION_COLUMN} AS version, ${columns.pod} AS pod, MAX(_timestamp) AS last_seen FROM ${from} WHERE ${where} GROUP BY ${VERSION_COLUMN}, ${columns.pod}`
    : `SELECT ${VERSION_COLUMN} AS version, MAX(_timestamp) AS last_seen FROM ${from} WHERE ${where} GROUP BY ${VERSION_COLUMN}`;
}

export function versionCondition(version: string): string {
  return `o2_service_version = ${quoteSqlLiteral(version)}`;
}

/** The version the newest of these spans ran; ties go to the higher version. */
export function latestVersion(rows: Pick<VersionPodRow, "version" | "last_seen">[]): string | null {
  let latest: { version: string; at: number } | null = null;
  for (const row of rows) {
    const at = Number(row.last_seen ?? 0);
    if (
      row.version &&
      (!latest || at > latest.at || (at === latest.at && row.version > latest.version))
    )
      latest = { version: row.version, at };
  }
  return latest?.version ?? null;
}

/** Counts distinct pods per version, most pods first. */
export function summarizeVersions(rows: VersionPodRow[], countsPods = true): VersionsSummary {
  const pods = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.version) continue;
    const set = pods.get(row.version) ?? new Set<string>();
    if (row.pod) set.add(row.pod);
    pods.set(row.version, set);
  }
  const versions = [...pods]
    .map(([version, set]) => ({ version, pods: countsPods ? set.size : null }))
    .sort(
      (a, b) =>
        (b.pods ?? 0) - (a.pods ?? 0) ||
        (a.version < b.version ? 1 : a.version > b.version ? -1 : 0),
    );
  return { versions };
}

/** The `correlation.timeRangeWithDuration` params of a microsecond range in the user's timezone. */
export function timeRangeParams(range: CorrelationTimeRange, timezone: string) {
  const at = (micros: number) =>
    timestampToTimezoneDate(Math.floor(micros / 1000), timezone, "HH:mm:ss");
  return {
    start: at(range.startTime),
    end: at(range.endTime),
    minutes: Math.round((range.endTime - range.startTime) / 1000 / 60000),
  };
}

/** Copies each trace summary's `first_event.o2_service_version` onto its formatted row, by position. */
export function withTraceVersions<T extends Record<string, unknown>>(
  rows: T[],
  hits: { first_event?: { o2_service_version?: unknown } }[],
): T[] {
  return rows.map((row, index) => {
    const version = hits[index]?.first_event?.o2_service_version;
    return typeof version === "string" && version ? { ...row, o2_service_version: version } : row;
  });
}
