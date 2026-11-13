import type { Scope } from "@/services/service_versions";
import { inEnv } from "@/services/service_versions.envs";
import { quoteSqlLiteral } from "@/utils/telemetryCorrelation";
import { timestampToTimezoneDate } from "@/utils/timezone";

export interface CorrelationPlace {
  cluster?: string;
  namespace?: string;
  env?: string;
  pod?: string;
}

export interface SemanticGroupFields {
  id: string;
  fields: string[];
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
  sourcePodVersion: string | null;
}

export interface VersionColumns {
  pod: string | null;
}

export interface CorrelationTimeRange {
  startTime: number;
  endTime: number;
}

export interface PodWhereColumns {
  pod: string;
  service: string | null;
}

export interface PodWhereRow {
  where_key: string | null;
}

const ALL_VALUE = "_o2_all";
const VERSION_COLUMN = "o2_service_version";
const WHERE_COLUMN = "o2_service_where";
const SERVICE_COLUMN = "service_name";
const POD_WINDOW_US = 5 * 60 * 1_000_000;
const POD_COLUMNS = ["service_k8s_pod_name", "k8s_pod_name"];
// Place fields lead with the identity resolver's keys, as the enterprise detection orders its place groups.
const PLACE_SOURCES: Record<
  keyof CorrelationPlace,
  { ids: string[]; fields: string[]; resolverFirst?: boolean }
> = {
  cluster: {
    ids: ["k8s-cluster"],
    fields: ["service_k8s_cluster_name", "service_k8s_cluster", "k8s_cluster_name", "k8s_cluster"],
    resolverFirst: true,
  },
  namespace: {
    ids: ["k8s-namespace"],
    fields: ["service_k8s_namespace_name", "k8s_namespace_name"],
    resolverFirst: true,
  },
  env: {
    ids: ["environment", "env"],
    fields: ["o2_service_env", "deployment_environment", "service_deployment_environment"],
  },
  pod: {
    ids: ["k8s-pod", "k8s-pod-name"],
    fields: ["k8s_pod_name", "service_k8s_pod_name"],
  },
};

function placeValue(
  slot: keyof CorrelationPlace,
  dimensionSets: Record<string, unknown>[],
  groups: SemanticGroupFields[],
): string | undefined {
  const source = PLACE_SOURCES[slot];
  const grouped = groups
    .filter((group) => source.ids.includes(group.id))
    .flatMap((group) => group.fields);
  const keys = [
    ...source.ids,
    ...(source.resolverFirst ? [...source.fields, ...grouped] : [...grouped, ...source.fields]),
  ];
  for (const dimensions of dimensionSets) {
    for (const key of keys) {
      const value = dimensions[key];
      if (typeof value === "string" && value !== "" && value !== ALL_VALUE) return value;
    }
  }
  return undefined;
}

/** Reads cluster, namespace, env and pod from the correlation's dimensions, earlier sets first. */
export function placeFromDimensions(
  dimensionSets: (Record<string, unknown> | undefined)[],
  groups: SemanticGroupFields[] = [],
): CorrelationPlace {
  const sets = dimensionSets.filter((set): set is Record<string, unknown> => !!set);
  return {
    cluster: placeValue("cluster", sets, groups),
    namespace: placeValue("namespace", sets, groups),
    env: placeValue("env", sets, groups),
    pod: placeValue("pod", sets, groups),
  };
}

/** The scope matching the row's own cluster + namespace; null when ambiguous, undefined when it cannot decide. */
export function scopeByOwnPlace(
  scopes: Scope[],
  service: string,
  place: CorrelationPlace,
): Scope | null | undefined {
  if (!place.cluster || !place.namespace) return undefined;
  const byWhere = scopes.filter(
    (scope) =>
      scope.service === service &&
      scope.where?.k8s_cluster === place.cluster &&
      scope.where?.k8s_namespace === place.namespace,
  );
  if (byWhere.length > 1) return null;
  return byWhere[0];
}

/** Picks by own cluster + namespace, then the pod's span places (null: read failed), then env, then the only scope. */
export function pickScope(
  scopes: Scope[],
  service: string,
  place: CorrelationPlace,
  podWheres?: string[] | null,
): Scope | null {
  const own = scopes.filter((scope) => scope.service === service);
  const byPlace = scopeByOwnPlace(own, service, place);
  if (byPlace !== undefined) return byPlace;
  if (podWheres === null || (podWheres && podWheres.length > 1)) return null;
  if (podWheres?.length === 1) return own.find((scope) => scope.where_key === podWheres[0]) ?? null;
  if (place.env) {
    const env = place.env;
    const byEnv = own.filter((scope) => inEnv(scope, env));
    if (byEnv.length === 1) return byEnv[0];
    if (byEnv.length > 1) return null;
  }
  return own.length === 1 ? own[0] : null;
}

/** The pod column a versions read groups by, or null when the stream carries no version column. */
export function versionColumns(fields: string[]): VersionColumns | null {
  const names = new Set(fields);
  if (!names.has(VERSION_COLUMN)) return null;
  return { pod: POD_COLUMNS.find((name) => names.has(name)) ?? null };
}

/** The pod and service columns a pod read filters on, or null when the stream stamps no where or has no pod. */
export function podWhereColumns(fields: string[]): PodWhereColumns | null {
  const names = new Set(fields);
  const pod = POD_COLUMNS.find((name) => names.has(name));
  if (!names.has(WHERE_COLUMN) || !pod) return null;
  return { pod, service: names.has(SERVICE_COLUMN) ? SERVICE_COLUMN : null };
}

/** Five minutes either side of the log time, in microseconds. */
export function podWindow(logTime: number): CorrelationTimeRange {
  return { startTime: logTime - POD_WINDOW_US, endTime: logTime + POD_WINDOW_US };
}

// Two places are enough to know the pod's spans do not name one, so the read stops there.
export function podWhereSql(
  stream: string,
  service: string,
  pod: string,
  columns: PodWhereColumns,
): string {
  const where = [
    `${columns.pod} = ${quoteSqlLiteral(pod)}`,
    columns.service ? `${columns.service} = ${quoteSqlLiteral(service)}` : "",
    `${WHERE_COLUMN} IS NOT NULL`,
  ]
    .filter(Boolean)
    .join(" AND ");
  return `SELECT ${WHERE_COLUMN} AS where_key FROM "${stream.replace(/"/g, '""')}" WHERE ${where} GROUP BY ${WHERE_COLUMN} LIMIT 2`;
}

/** The distinct places a pod read returned. */
export function podWheres(rows: PodWhereRow[]): string[] {
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

/** Counts distinct pods per version (most pods first) and finds the source pod's latest version. */
export function summarizeVersions(
  rows: VersionPodRow[],
  sourcePod?: string,
  countsPods = true,
): VersionsSummary {
  const pods = new Map<string, Set<string>>();
  let latest: { version: string; at: number } | null = null;
  for (const row of rows) {
    if (!row.version) continue;
    const set = pods.get(row.version) ?? new Set<string>();
    if (row.pod) set.add(row.pod);
    pods.set(row.version, set);
    const at = Number(row.last_seen ?? 0);
    if (
      sourcePod &&
      row.pod === sourcePod &&
      (!latest || at > latest.at || (at === latest.at && row.version > latest.version))
    )
      latest = { version: row.version, at };
  }
  const versions = [...pods]
    .map(([version, set]) => ({ version, pods: countsPods ? set.size : null }))
    .sort(
      (a, b) =>
        (b.pods ?? 0) - (a.pods ?? 0) ||
        (a.version < b.version ? 1 : a.version > b.version ? -1 : 0),
    );
  return { versions, sourcePodVersion: latest?.version ?? null };
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
