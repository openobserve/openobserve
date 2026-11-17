// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import config from "@/aws-exports";
import i18n, { localeFileMap } from "@/locales";
import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillThresholdInput,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import { gt, type I18nText } from "@/types/i18n";
import { escapeSingleQuotes } from "@/utils/queryUtils";
import { sanitizeAlertNamePart, warn } from "../alertPrefill";
import {
  ANY_ERROR,
  draftThreshold,
  suggestErrors,
  suggestLatency,
} from "@/components/autoobserve/insight/targets/thresholds";

export const AUTOOBSERVE_SOURCE = "autoobserve";

// The identity field names the coverage analyzer joins services on (o2-enterprise autoobserve names.rs).
export const SERVICE_FIELDS = [
  "service_name",
  "service",
  "job",
  "app",
  "kubernetes_labels_app",
  "kubernetes_labels_app_kubernetes_io_name",
];
export const CLUSTER_FIELDS = ["k8s_cluster", "cluster", "k8s_cluster_name"];
export const NAMESPACE_FIELDS = ["k8s_namespace_name", "namespace", "kubernetes_namespace_name"];
// Traces keep a span's resource attributes under a service_ prefix, so its cluster is service_k8s_cluster_name.
export const SPAN_CLUSTER_FIELDS = [...CLUSTER_FIELDS, "service_k8s_cluster_name"];
export const SPAN_NAMESPACE_FIELDS = [...NAMESPACE_FIELDS, "service_k8s_namespace_name"];
export const WORKLOAD_FIELDS = [
  "k8s_deployment_name",
  "k8s_statefulset_name",
  "k8s_daemonset_name",
  "k8s_container_name",
];
const EVENT_REASON_FIELDS = ["body_object_reason", "reason", "k8s_event_reason"];
// A level-3 events stream keeps the regarding object as JSON; level 0 and core/v1 events flatten its name.
const EVENT_REGARDING_JSON = "body_object_regarding";
const EVENT_REGARDING_NAMES = ["body_object_regarding_name", "body_object_involvedobject_name"];

const TEXT_TYPES = new Set(["Utf8", "LargeUtf8", "Utf8View"]);
const NUMERIC_TYPE = /^(U?Int\d+|Float\d+|Decimal)/;

const NO_DATA_MINUTES = 15;
// SS1-D2 reads outages in hourly buckets, so an outage member's alert waits the same hour.
const SOURCE_NO_DATA_MINUTES = 60;
const ERRORS_MINUTES = 60;
const LATENCY_MINUTES = 15;
const RESTART_MINUTES = 10;
const RESTART_COUNT = 3;
const PROM_MINUTES = 5;
const FREQUENCY_MINUTES = 5;
const SILENCE_MINUTES = 60;
const MIN_LATENCY_SPANS = 20;
const UTILIZATION_LIMIT = 0.9;
const RESTART_REASONS = ["BackOff", "OOMKilling"];
/** Log levels that count as errors; the service charts and every drafted alert read the same list. */
export const ERROR_LEVELS = [
  "error",
  "fatal",
  "critical",
  "err",
  "crit",
  "alert",
  "emerg",
  "emergency",
];

/** Who owns a service's alerts: the folder most of them live in, else the org default (PD-4). */
export interface TeamPick {
  name: string;
  folderId: string;
  folderName: string;
  source: "folder" | "default";
  reason: I18nText;
  /** How many of the service's alerts live in the folder; absent for the org default. */
  alertCount?: number;
}

/** Who a service's alerts notify, and how many of them do; `reason: "none"` when none notify anyone. */
export type NotifyPick =
  | { destinations: string[]; reason: I18nText; alertCount?: number }
  | { destinations: []; reason: "none" };

export interface ServiceScope {
  service: string;
  /** How the coverage page names this service, such as "svc-b · no namespace"; the bare name when absent. */
  label?: string;
  cluster: string | null;
  namespace: string | null;
  stream: { type: string; name: string };
  /** The stream's field names; scope filters use only names found here, defaults when absent. */
  schema?: string[];
  /** Each field's data type, when read with the schema. */
  fieldTypes?: Record<string, string>;
}

export interface AutoObserveAlertOptions {
  team: TeamPick;
  notify: NotifyPick;
  /** The 15-minute default is the no-data window of m12. */
  minutes?: number;
  /** Microseconds; the date the origin line names. */
  now?: number;
}

/** Which field says a record is an error, and how it says it. */
export interface FieldPick {
  name: string;
  kind: "span_status" | "level" | "status_code";
}

export interface OutageMember {
  stream: { type: string; name: string };
  field: string;
  value: string;
  /** Sources that stopped together, this one included. */
  cohortSize: number;
}

interface Scope {
  where: string[];
  warnings: AlertPrefillWarning[];
  blocked: boolean;
}

interface Shape {
  kind: string;
  sql?: string;
  promql?: string;
  periodMinutes: number;
  threshold: number | null;
  warnings: AlertPrefillWarning[];
}

/** Every builder answers null on an OSS build, so no AutoObserve surface can open anything there. */
export const isAutoObserveBuild = (): boolean => config.isEnterprise === "true";

/** A field name with its double quotes stripped, always quoted so a field named like a keyword still parses. */
export const sqlField = (name: string): string => `"${String(name ?? "").replace(/"/g, "")}"`;

export const sqlLiteral = (value: string | number): string =>
  `'${escapeSingleQuotes(String(value))}'`;

export const sqlStream = (name: string): string => `"${String(name ?? "").replace(/"/g, "")}"`;

const promLabel = (name: string): string => String(name ?? "").replace(/[^A-Za-z0-9_]/g, "");

const promValue = (value: string): string =>
  `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const likeLiteral = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The first candidate the schema has; without a schema, the analyzer's canonical name. */
export const pickField = (candidates: string[], schema?: string[]): string | null => {
  if (!schema) return candidates[0] ?? null;
  const present = new Set(schema);
  return candidates.find((name) => present.has(name)) ?? null;
};

/** The cluster and namespace field names a stream of this type can carry. */
export const scopeFieldsOf = (streamType?: string): { cluster: string[]; namespace: string[] } =>
  streamType === "traces"
    ? { cluster: SPAN_CLUSTER_FIELDS, namespace: SPAN_NAMESPACE_FIELDS }
    : { cluster: CLUSTER_FIELDS, namespace: NAMESPACE_FIELDS };

const localeOf = (): string => localeFileMap[String(i18n.global.locale)] ?? "en-US";

/** The origin line m6/m12 draw in the description until a durable origin field exists (G29). */
export const originLine = (service: string, now: number = Date.now() * 1000): string =>
  gt("insight.targets.origin", {
    service,
    date: new Intl.DateTimeFormat(localeOf(), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(now / 1000)),
  });

const dedupe = (warnings: AlertPrefillWarning[]): AlertPrefillWarning[] =>
  warnings.filter((w, i) => warnings.findIndex((o) => o.key === w.key) === i);

/** Service, cluster and namespace filters; cluster or namespace is skipped when the stream cannot carry it. */
const serviceScope = (s: ServiceScope, serviceFields = SERVICE_FIELDS): Scope => {
  const warnings: AlertPrefillWarning[] = [];
  const where: string[] = [];
  const service = s.service?.trim() ?? "";
  if (!service) {
    return { where, warnings: [warn("autoobserve.noService", "blocking")], blocked: true };
  }
  const serviceField = pickField(serviceFields, s.schema);
  if (!serviceField) {
    const params = { stream: s.stream?.name ?? "", service };
    return {
      where,
      warnings: [warn("autoobserve.noServiceField", "blocking", params)],
      blocked: true,
    };
  }
  where.push(`${sqlField(serviceField)} = ${sqlLiteral(service)}`);
  const extra: [string | null, string[], string][] = [
    [s.cluster, scopeFieldsOf(s.stream?.type).cluster, "autoobserve.noClusterField"],
    [s.namespace, scopeFieldsOf(s.stream?.type).namespace, "autoobserve.noNamespaceField"],
  ];
  const emptyNs =
    !s.namespace && s.schema ? pickField(scopeFieldsOf(s.stream?.type).namespace, s.schema) : null;
  // Same pair as the charts; without it the no-namespace entity's alert watches every namespace's rows.
  if (emptyNs) where.push(`(${sqlField(emptyNs)} IS NULL OR ${sqlField(emptyNs)} = '')`);
  for (const [value, candidates, missing] of extra) {
    if (!value) continue;
    // Without the schema a guessed cluster field could match nothing, which a no-data alert reads as an outage.
    const field = s.schema ? pickField(candidates, s.schema) : null;
    if (field) where.push(`${sqlField(field)} = ${sqlLiteral(value)}`);
    else if (!s.schema) warnings.push(warn("autoobserve.scopeServiceOnly", "info", { service }));
    // Unfiltered, a same-named service elsewhere would keep the alert quiet through this one's outage.
    else warnings.push(warn(missing, "blocking", { stream: s.stream?.name ?? "", value }));
  }
  return { where, warnings: dedupe(warnings), blocked: false };
};

const whereOf = (parts: string[]): string => (parts.length ? ` WHERE ${parts.join(" AND ")}` : "");

/** The series selector, with which of service, cluster and namespace it could actually match on. */
const promSelector = (
  s: ServiceScope,
  serviceFields: string[],
): { selector: string; matched: Set<"service" | "cluster" | "namespace"> } => {
  const labels: string[] = [];
  const matched = new Set<"service" | "cluster" | "namespace">();
  const add = (
    part: "service" | "cluster" | "namespace",
    candidates: string[],
    value: string | null,
  ) => {
    const field = value ? pickField(candidates, s.schema) : null;
    if (!field || !value) return;
    labels.push(`${promLabel(field)}=${promValue(value)}`);
    matched.add(part);
  };
  add("service", serviceFields, s.service?.trim() || null);
  add("cluster", CLUSTER_FIELDS, s.cluster);
  add("namespace", NAMESPACE_FIELDS, s.namespace);
  return { selector: `${promLabel(s.stream?.name ?? "")}{${labels.join(", ")}}`, matched };
};

const nameOf = (
  s: { service: string; cluster?: string | null; namespace?: string | null },
  kind: string,
) =>
  sanitizeAlertNamePart(
    [s.service, s.cluster, s.namespace, kind].filter(Boolean).join("_"),
    `autoobserve_${kind}`,
  );

const assemble = (
  label: { service: string; label?: string; cluster?: string | null; namespace?: string | null },
  stream: { type: string; name: string },
  shape: Shape,
  o: AutoObserveAlertOptions,
): AlertPrefill => {
  const warnings = [...shape.warnings];
  if (!stream?.name?.trim()) warnings.push(warn("noStream", "blocking"));
  const promql = shape.promql !== undefined;
  const thresholded = shape.threshold !== null;
  return {
    version: ALERT_PREFILL_VERSION,
    source: AUTOOBSERVE_SOURCE,
    sourceLabel: gt("alerts.prefill.sources.autoobserve.sourceLabel", {
      service: label.label || label.service,
    }),
    name: nameOf(label, shape.kind),
    streamType: stream?.type || "logs",
    streamName: stream?.name?.trim() ?? "",
    queryType: promql ? "promql" : "sql",
    ...(promql ? { promql: shape.promql } : { sql: shape.sql }),
    ...(promql
      ? {
          promqlCondition:
            shape.threshold === null
              ? null
              : { column: "value", operator: ">", value: shape.threshold },
          promqlMultiAlert: true,
        }
      : {}),
    periodMinutes: shape.periodMinutes,
    frequencyMinutes: FREQUENCY_MINUTES,
    silenceMinutes: SILENCE_MINUTES,
    thresholdShape: "count",
    // AutoObserve is the destination: the incident pages on-call when no person is named.
    createsIncident: true,
    // The condition lives in the query, so one returned row means it was met; an empty threshold leaves the form's own.
    ...(thresholded && !promql ? { triggerThreshold: 1, triggerOperator: ">=" } : {}),
    warnings: dedupe(warnings),
    meta: {
      check: shape.kind,
      threshold: shape.threshold,
      description: originLine(label.service, o.now),
      folderId: o.team.folderId,
      destinations: [...o.notify.destinations],
      service: {
        name: label.service,
        cluster: label.cluster ?? null,
        namespace: label.namespace ?? null,
      },
    },
  };
};

const noBaseline = (service: string) => warn("autoobserve.noBaseline", "warning", { service });

const errorPredicate = (pick: FieldPick): string => {
  const field = sqlField(pick.name);
  if (pick.kind === "span_status") return `${field} = 'ERROR'`;
  if (pick.kind === "status_code") return `${field} >= 500`;
  return `lower(${field}) IN (${ERROR_LEVELS.map(sqlLiteral).join(", ")})`;
};

/** The schema's error field: span status on traces, else a level or status field; never the message body. */
export const errorFieldOf = (
  streamType: string,
  schema: string[] = [],
  types?: Record<string, string>,
): FieldPick | null => {
  const present = new Set(schema);
  if (streamType === "traces") return { name: "span_status", kind: "span_status" };
  // lower() fails on a non-text level and >= 500 on a status that is not a number, so known types must fit.
  const fits = (f: string, type: (t: string) => boolean) =>
    present.has(f) && (!types?.[f] || type(types[f]));
  const level = ["level", "severity", "severity_text", "log_level", "loglevel"].find((f) =>
    fits(f, (t) => TEXT_TYPES.has(t)),
  );
  if (level) return { name: level, kind: "level" };
  const status = ["status_code", "http_status_code", "response_code", "status"].find((f) =>
    fits(f, (t) => NUMERIC_TYPE.test(t)),
  );
  return status ? { name: status, kind: "status_code" } : null;
};

/** Fires when the service sends no rows for the window (m12 "no rows for 15 min"), in the analyzer's absence shape. */
export const noDataAlert = (s: ServiceScope, o: AutoObserveAlertOptions): AlertPrefill | null => {
  if (!isAutoObserveBuild()) return null;
  const scope = serviceScope(s);
  const minutes = o.minutes ?? NO_DATA_MINUTES;
  const sql = scope.blocked
    ? ""
    : `SELECT count(*) AS row_count FROM ${sqlStream(s.stream?.name)}${whereOf(scope.where)} HAVING count(*) = 0`;
  return assemble(
    s,
    s.stream,
    { kind: "no_data", sql, periodMinutes: minutes, threshold: 0, warnings: scope.warnings },
    o,
  );
};

/** What the usual level is measured on, with the inputs its alert reads. */
export type BaselineInputs =
  { kind: "errors"; errorField: FieldPick | null } | { kind: "latency"; durationField: string };

const errorPick = (s: ServiceScope, field: FieldPick | null): FieldPick | null =>
  field ?? (s.stream?.type === "traces" ? errorFieldOf("traces") : null);

const p95Of = (s: ServiceScope, durationField: string): string =>
  `approx_percentile_cont(${sqlField(durationField || "duration")}, 0.95)${s.stream?.type === "traces" ? " / 1000" : ""}`;

/** The alert's query before its threshold: the error count, or the p95 in ms with its request count. */
const levelSql = (s: ServiceScope, scope: Scope, b: BaselineInputs): string | null => {
  if (b.kind === "latency") {
    return `SELECT ${p95Of(s, b.durationField)} AS p95_ms, count(*) AS requests FROM ${sqlStream(s.stream?.name)}${whereOf(scope.where)}`;
  }
  const pick = errorPick(s, b.errorField);
  if (!pick) return null;
  return `SELECT count(*) AS errors FROM ${sqlStream(s.stream?.name)}${whereOf([...scope.where, errorPredicate(pick)])}`;
};

/** The query that measures the usual level over a past window, scoped like the alert; null when it can't be scoped. */
export const baselineSql = (s: ServiceScope, b: BaselineInputs): string | null => {
  const scope = serviceScope(s);
  if (scope.blocked || scope.warnings.some((w) => w.level === "blocking")) return null;
  if (b.kind === "latency") return levelSql(s, scope, b);
  const pick = errorPick(s, b.errorField);
  if (!pick) return null;
  // Counted over every row so first_seen is when the service's data starts, not its first error.
  return `SELECT sum(CASE WHEN ${errorPredicate(pick)} THEN 1 ELSE 0 END) AS errors, min("_timestamp") AS first_seen FROM ${sqlStream(s.stream?.name)}${whereOf(scope.where)}`;
};

/** The field that asks for a threshold when there is no usual level to suggest one. */
const thresholdInput = (
  kind: "errors" | "latency",
  s: ServiceScope,
  value: number | null,
): AlertPrefillThresholdInput => ({
  label: gt("insight.threshold.label"),
  suffix: gt(`insight.threshold.${kind}Suffix`),
  reason: gt(`insight.threshold.${kind}Reason`, { service: scopeLabel(s) }),
  ...(kind === "errors" && value === ANY_ERROR
    ? { note: gt("insight.threshold.anyErrorNote", { service: scopeLabel(s) }) }
    : {}),
  value,
});

/** "svc-a · cluster-k / ns-b": the scope the baseline was measured on, as the review list names it. */
const scopeLabel = (s: ServiceScope): string => {
  const where = [s.cluster, s.namespace].filter(Boolean).join(" / ");
  return where ? `${s.service} · ${where}` : s.service;
};

/** PD-11: fires above three times the usual hourly error count; with no usual count it fires on any error until the user sets one. */
export const errorsAlert = (
  s: ServiceScope,
  o: AutoObserveAlertOptions & {
    errorField: FieldPick | null;
    usualPerHour: number | null;
    threshold?: number | null;
  },
): AlertPrefill | null => {
  if (!isAutoObserveBuild()) return null;
  if (!errorPick(s, o.errorField)) return null;
  const scope = serviceScope(s);
  const suggested = suggestErrors(o.usualPerHour);
  const threshold = draftThreshold("errors", o.usualPerHour, o.threshold);
  const having = threshold === null ? "" : ` HAVING count(*) > ${threshold}`;
  const sql = scope.blocked
    ? ""
    : `${levelSql(s, scope, { kind: "errors", errorField: o.errorField })}${having}`;
  const prefill = assemble(
    s,
    s.stream,
    { kind: "errors", sql, periodMinutes: ERRORS_MINUTES, threshold, warnings: scope.warnings },
    o,
  );
  return suggested === null
    ? { ...prefill, thresholdInput: thresholdInput("errors", s, threshold) }
    : prefill;
};

/** PD-11: fires when p95 rises above twice its usual value; traces durations are microseconds, so the query reads milliseconds. */
export const latencyAlert = (
  s: ServiceScope,
  o: AutoObserveAlertOptions & {
    durationField: string;
    p95Ms: number | null;
    threshold?: number | null;
  },
): AlertPrefill | null => {
  if (!isAutoObserveBuild()) return null;
  const scope = serviceScope(s);
  const suggested = suggestLatency(o.p95Ms);
  const threshold = draftThreshold("latency", o.p95Ms, o.threshold);
  const warnings = [...scope.warnings];
  const field = o.durationField || "duration";
  if (s.stream?.type !== "traces")
    warnings.push(warn("autoobserve.latencyUnit", "info", { field: field.replace(/"/g, "") }));
  const having =
    threshold === null
      ? ""
      : ` HAVING ${p95Of(s, field)} > ${threshold} AND count(*) >= ${MIN_LATENCY_SPANS}`;
  const sql = scope.blocked
    ? ""
    : `${levelSql(s, scope, { kind: "latency", durationField: field })}${having}`;
  const prefill = assemble(
    s,
    s.stream,
    { kind: "latency", sql, periodMinutes: LATENCY_MINUTES, threshold, warnings },
    o,
  );
  return suggested === null
    ? { ...prefill, thresholdInput: thresholdInput("latency", s, threshold) }
    : prefill;
};

/** A memory alert must match the service's own series and a node alert its cluster's, else it watches everyone's. */
const utilizationShape = (s: ServiceScope, kind: string, scopeBy: "service" | "cluster"): Shape => {
  const utilization = /utilization/i.test(s.stream?.name ?? "");
  const serviceFields = scopeBy === "service" ? [...SERVICE_FIELDS, ...WORKLOAD_FIELDS] : [];
  const { selector, matched } = promSelector(s, serviceFields);
  const warnings: AlertPrefillWarning[] = [];
  const params = { stream: s.stream?.name ?? "", service: s.service?.trim() ?? "" };
  if (!params.service) warnings.push(warn("autoobserve.noService", "blocking"));
  else if (!matched.has(scopeBy)) {
    const key = scopeBy === "service" ? "autoobserve.noServiceLabel" : "autoobserve.noCluster";
    warnings.push(warn(key, "blocking", params));
  }
  // A series without the cluster or namespace label would mix in the same-named service elsewhere.
  for (const [part, value, key] of [
    ["cluster", s.cluster, "autoobserve.noClusterField"],
    ["namespace", s.namespace, "autoobserve.noNamespaceField"],
  ] as const) {
    if (part !== scopeBy && value && s.schema && !matched.has(part))
      warnings.push(warn(key, "blocking", { stream: params.stream, value }));
  }
  if (!utilization) warnings.push(noBaseline(s.service));
  return {
    kind,
    promql: `max(${selector})`,
    periodMinutes: PROM_MINUTES,
    threshold: utilization ? UTILIZATION_LIMIT : null,
    warnings,
  };
};

/** PromQL on the memory series coverage matched; a utilization series fires above 90% of its limit. */
export const memoryAlert = (s: ServiceScope, o: AutoObserveAlertOptions): AlertPrefill | null => {
  if (!isAutoObserveBuild()) return null;
  return assemble(s, s.stream, utilizationShape(s, "memory", "service"), o);
};

/** PromQL on the node series coverage matched, scoped to the service's cluster since nodes have no namespace. */
export const nodeAlert = (s: ServiceScope, o: AutoObserveAlertOptions): AlertPrefill | null => {
  if (!isAutoObserveBuild()) return null;
  const nodeScope = { ...s, namespace: null };
  return assemble(nodeScope, s.stream, utilizationShape(nodeScope, "node", "cluster"), o);
};

/** The event's object name in each layout the schema has; without a schema, the level-3 JSON column. */
const regardingNames = (schema?: string[]): string[] => {
  const json = `json_get_str(${sqlField(EVENT_REGARDING_JSON)}, 'name')`;
  if (!schema) return [json];
  const present = new Set(schema);
  return [
    ...(present.has(EVENT_REGARDING_JSON) ? [json] : []),
    ...EVENT_REGARDING_NAMES.filter((f) => present.has(f)).map(sqlField),
  ];
};

const workloadPredicate = (s: ServiceScope): string | null => {
  const service = s.service.trim();
  const workload = s.schema ? pickField(WORKLOAD_FIELDS, s.schema) : null;
  if (workload) return `${sqlField(workload)} = ${sqlLiteral(service)}`;
  const names = regardingNames(s.schema);
  if (!names.length) return null;
  // A re-levelled stream keeps both layouts side by side, so rows of either must match.
  const name = names.length === 1 ? names[0] : `COALESCE(${names.join(", ")})`;
  // A pod's name starts with its workload's, so the event's object name narrows it to the service.
  return `${name} LIKE ${sqlLiteral(`${likeLiteral(service)}-%`)}`;
};

/** Fires when the service's pods restart three times in ten minutes (m3), read from Kubernetes events. */
export const restartAlert = (s: ServiceScope, o: AutoObserveAlertOptions): AlertPrefill | null => {
  if (!isAutoObserveBuild()) return null;
  const stream = { type: s.stream?.type || "logs", name: s.stream?.name?.trim() || "k8s_events" };
  const warnings: AlertPrefillWarning[] = [];
  const where: string[] = [];
  if (!s.service?.trim()) warnings.push(warn("autoobserve.noService", "blocking"));
  const workload = s.service?.trim() ? workloadPredicate(s) : null;
  if (workload) where.push(workload);
  else if (s.service?.trim()) {
    const params = { stream: stream.name, service: s.service.trim() };
    warnings.push(warn("autoobserve.noWorkload", "blocking", params));
  }
  for (const [value, candidates, missing] of [
    [s.cluster, CLUSTER_FIELDS, "autoobserve.noClusterField"],
    [s.namespace, NAMESPACE_FIELDS, "autoobserve.noNamespaceField"],
  ] as const) {
    const field = value ? pickField(candidates, s.schema) : null;
    if (field && value) where.push(`${sqlField(field)} = ${sqlLiteral(value)}`);
    // Unfiltered, a same-named workload in another namespace would count toward this one's restarts.
    else if (value) warnings.push(warn(missing, "blocking", { stream: stream.name, value }));
  }
  const reason = pickField(EVENT_REASON_FIELDS, s.schema) ?? EVENT_REASON_FIELDS[0];
  where.push(`${sqlField(reason)} IN (${RESTART_REASONS.map(sqlLiteral).join(", ")})`);
  const sql = `SELECT count(*) AS restarts FROM ${sqlStream(stream.name)}${whereOf(where)} HAVING count(*) >= ${RESTART_COUNT}`;
  return assemble(
    s,
    stream,
    { kind: "restarts", sql, periodMinutes: RESTART_MINUTES, threshold: RESTART_COUNT, warnings },
    o,
  );
};

/** One outage member's no-data alert; with others stopped too, it says it covers this one only. */
export const sourceNoDataAlert = (
  m: OutageMember,
  o: AutoObserveAlertOptions,
): AlertPrefill | null => {
  if (!isAutoObserveBuild()) return null;
  const value = m.value?.trim() ?? "";
  const warnings: AlertPrefillWarning[] = [];
  if (!value || !m.field?.replace(/"/g, "").trim())
    warnings.push(warn("autoobserve.noService", "blocking"));
  const others = Math.max(0, Math.floor(m.cohortSize) - 1);
  if (others > 0) {
    const key = others === 1 ? "autoobserve.outageOther" : "autoobserve.outageOthers";
    warnings.push(warn(key, "warning", { source: value, count: others }));
  }
  const where = value ? whereOf([`${sqlField(m.field)} = ${sqlLiteral(value)}`]) : "";
  const sql = value
    ? `SELECT count(*) AS row_count FROM ${sqlStream(m.stream?.name)}${where} HAVING count(*) = 0`
    : "";
  return assemble(
    { service: value },
    m.stream,
    {
      kind: "source_no_data",
      sql,
      periodMinutes: o.minutes ?? SOURCE_NO_DATA_MINUTES,
      threshold: 0,
      warnings,
    },
    o,
  );
};

/** The server's heartbeat action as sent: its conditions, window, schedule and silence, nothing guessed (FU heartbeat). */
export interface HeartbeatAction {
  stream_type: string;
  stream_name: string;
  conditions: { field: string; op: "eq" | "contains"; value: string; ignore_case: boolean }[];
  period_secs: number;
  frequency_secs: number | null;
  cron: string | null;
  silence_secs: number;
}

const heartbeatPredicate = (c: HeartbeatAction["conditions"][number]): string => {
  const field = sqlField(c.field);
  if (c.op === "eq") return `${field} = ${sqlLiteral(c.value)}`;
  const value = c.ignore_case ? c.value.toLowerCase() : c.value;
  const column = c.ignore_case ? `lower(${field})` : field;
  return `${column} LIKE ${sqlLiteral(`%${likeLiteral(value)}%`)}`;
};

/** Fires when the job's success line is missing for its whole window; null for a cron schedule the form can't carry. */
export const heartbeatAlert = (
  a: HeartbeatAction,
  job: string,
  o: AutoObserveAlertOptions,
): AlertPrefill | null => {
  // AlertPrefill has no cron schedule, so saving would run the check on the form's default frequency instead.
  if (!isAutoObserveBuild() || a.cron) return null;
  const stream = { type: a.stream_type || "logs", name: a.stream_name };
  const sql = `SELECT count(*) AS row_count FROM ${sqlStream(stream.name)}${whereOf(a.conditions.map(heartbeatPredicate))} HAVING count(*) = 0`;
  const prefill = assemble(
    { service: job },
    stream,
    {
      kind: "heartbeat",
      sql,
      periodMinutes: Math.max(1, Math.round(a.period_secs / 60)),
      threshold: 0,
      warnings: [],
    },
    o,
  );
  return {
    ...prefill,
    frequencyMinutes: a.frequency_secs ? Math.max(1, Math.round(a.frequency_secs / 60)) : undefined,
    silenceMinutes: Math.round(a.silence_secs / 60),
  };
};
