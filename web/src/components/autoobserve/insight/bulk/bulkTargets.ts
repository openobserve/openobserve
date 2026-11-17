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

// Stand-in for the CTA-targets contract (prefill builders, team and destination picks); swapped for re-exports when that lane lands.

import config from "@/aws-exports";
import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import type { I18nText } from "@/types/i18n";
import { warn } from "@/utils/alerts/alertPrefill";
import { escapeSingleQuotes } from "@/utils/queryUtils";
import { ERROR_LEVELS } from "@/utils/alerts/prefill/fromAutoObserve";

// The identity field names the coverage analyzer joins services on, in the contract's order.
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
// Traces keep a span's resource attributes under a service_ prefix.
export const SPAN_CLUSTER_FIELDS = [...CLUSTER_FIELDS, "service_k8s_cluster_name"];
export const SPAN_NAMESPACE_FIELDS = [...NAMESPACE_FIELDS, "service_k8s_namespace_name"];
const NO_DATA_MINUTES = 15;
const SOURCE_MINUTES = 60;

export interface ServiceScope {
  service: string;
  /** How the coverage page names this service, such as "svc-b · no namespace"; the bare name when absent. */
  label?: string;
  cluster: string | null;
  namespace: string | null;
  stream: { type: string; name: string };
  schema?: string[];
  fieldTypes?: Record<string, string>;
}

export interface OutageMember {
  stream: { type: string; name: string };
  field: string;
  value: string;
  cohortSize: number;
}

export type SourceScope = OutageMember;

export interface TeamPick {
  name: string;
  folderId: string;
  folderName: string;
  source: "folder" | "default";
  reason: I18nText;
}

export type NotifyPick =
  { destinations: string[]; reason: I18nText } | { destinations: []; reason: "none" };

export interface FieldPick {
  name: string;
  kind: "span_status" | "level" | "status_code";
}

export interface BuilderOptions {
  team: TeamPick;
  notify: NotifyPick;
  minutes?: number;
  now?: number;
}

interface Scope {
  where: string[];
  warnings: AlertPrefillWarning[];
  blocked: boolean;
}

const quoteStream = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const quoteField = (name: string): string => `"${name.replace(/"/g, "")}"`;
const literal = (value: string): string => `'${escapeSingleQuotes(value)}'`;

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

/** Service, cluster and namespace filters on the fields the schema has; without a schema only the service. */
const serviceScope = (s: ServiceScope): Scope => {
  const service = s.service?.trim() ?? "";
  const serviceField = service ? pickField(SERVICE_FIELDS, s.schema) : null;
  if (!serviceField) {
    const key = service ? "autoobserve.noServiceField" : "autoobserve.noService";
    return { where: [], warnings: [warn(key, "blocking", { service })], blocked: true };
  }
  const where = [`${quoteField(serviceField)} = ${literal(service)}`];
  const fields = scopeFieldsOf(s.stream?.type);
  const extra: [string | null, string[]][] = [
    [s.cluster, fields.cluster],
    [s.namespace, fields.namespace],
  ];
  let serviceOnly = false;
  for (const [value, candidates] of extra) {
    if (!value) continue;
    // Without the schema a guessed field could match nothing, which a no-data alert reads as an outage.
    const field = s.schema ? pickField(candidates, s.schema) : null;
    if (field) where.push(`${quoteField(field)} = ${literal(value)}`);
    else if (!s.schema) serviceOnly = true;
  }
  const warnings = serviceOnly ? [warn("autoobserve.scopeServiceOnly", "info", { service })] : [];
  return { where, warnings, blocked: false };
};

/** The filter a scoped alert puts on its stream, or null when the stream cannot be filtered to the service. */
export const scopeWhereOf = (s: ServiceScope): string | null => {
  const scope = serviceScope(s);
  return scope.blocked ? null : scope.where.join(" AND ");
};

const errorPredicate = (pick: FieldPick): string => {
  const field = quoteField(pick.name);
  if (pick.kind === "span_status") return `${field} = 'ERROR'`;
  if (pick.kind === "status_code") return `${field} >= 500`;
  return `lower(${field}) IN (${ERROR_LEVELS.map(literal).join(", ")})`;
};

const scopeName = (s: ServiceScope): string =>
  [s.service, s.cluster, s.namespace].filter(Boolean).join("-");

const NAME_SUFFIX = { no_data: "no-data", errors: "errors", latency: "latency" } as const;

/** The name a review row's alert is created under, known before its threshold is measured. */
export const draftNameOf = (
  scope: ServiceScope | SourceScope,
  kind: "no_data" | "errors" | "latency" | "source",
): string =>
  "field" in scope
    ? `${scope.value}-no-data`
    : `${scopeName(scope)}-${NAME_SUFFIX[kind === "source" ? "no_data" : kind]}`;

const today = (): string => new Date().toISOString().slice(0, 10);

const origin = (what: string): string =>
  `Created from an AutoObserve suggestion for ${what} on ${today()}.`;

const absencePrefill = (
  stream: { type: string; name: string },
  where: string,
  name: string,
  what: string,
  minutes: number,
): AlertPrefill => ({
  version: ALERT_PREFILL_VERSION,
  source: "autoobserve",
  sourceLabel: `Suggested by AutoObserve for ${what}`,
  name,
  streamType: stream.type,
  streamName: stream.name,
  queryType: "sql",
  sql: `SELECT count(*) AS row_count FROM ${quoteStream(stream.name)} WHERE ${where} HAVING count(*) = 0`,
  periodMinutes: minutes,
  frequencyMinutes: 5,
  triggerThreshold: 1,
  triggerOperator: ">=",
  // AutoObserve is the destination: the incident pages on-call when no person is named.
  createsIncident: true,
  warnings: [],
  meta: { description: origin(what), destinations: [] },
});

/** A scoped prefill, or a blocked one carrying the scope's reason when the stream cannot be filtered to the service. */
const scopedPrefill = (scope: Scope, prefill: (where: string) => AlertPrefill): AlertPrefill => {
  const built = prefill(scope.where.join(" AND "));
  return scope.blocked
    ? { ...built, sql: "", warnings: scope.warnings }
    : { ...built, warnings: [...built.warnings, ...scope.warnings] };
};

const enterprise = (): boolean => config.isEnterprise === "true";

/** One scoped no-data alert for a service. */
export const noDataAlert = (s: ServiceScope, o: BuilderOptions): AlertPrefill | null =>
  enterprise()
    ? scopedPrefill(serviceScope(s), (where) =>
        absencePrefill(
          s.stream,
          where,
          draftNameOf(s, "no_data"),
          s.service,
          o.minutes ?? NO_DATA_MINUTES,
        ),
      )
    : null;

/** One no-data alert for a source member of an outage. */
export const sourceNoDataAlert = (m: SourceScope, o: BuilderOptions): AlertPrefill | null =>
  enterprise()
    ? absencePrefill(
        m.stream,
        `${quoteField(m.field)} = ${literal(m.value)}`,
        draftNameOf(m, "source"),
        m.value,
        o.minutes ?? SOURCE_MINUTES,
      )
    : null;

/** An errors alert at three times the usual hourly rate, or at the threshold the user set; null without either or an error field. */
export const errorsAlert = (
  s: ServiceScope,
  o: BuilderOptions & {
    errorField: FieldPick | null;
    usualPerHour: number | null;
    threshold?: number | null;
  },
): AlertPrefill | null => {
  const pick =
    o.errorField ??
    (s.stream?.type === "traces" ? { name: "span_status", kind: "span_status" as const } : null);
  const threshold = o.threshold ?? (o.usualPerHour ? o.usualPerHour * 3 : null);
  if (!enterprise() || threshold === null || !(threshold >= 0) || !pick) return null;
  return scopedPrefill(serviceScope(s), (where) => {
    const filter = `${where} AND ${errorPredicate(pick)}`;
    return {
      ...absencePrefill(s.stream, filter, "", s.service, 60),
      name: draftNameOf(s, "errors"),
      sql: `SELECT count(*) AS errors FROM ${quoteStream(s.stream.name)} WHERE ${filter} HAVING count(*) > ${threshold}`,
    };
  });
};

/** A latency alert at twice the usual p95, or at the threshold in ms the user set; null without either. */
export const latencyAlert = (
  s: ServiceScope,
  o: BuilderOptions & { durationField: string; p95Ms: number | null; threshold?: number | null },
): AlertPrefill | null => {
  const thresholdMs = o.threshold || (o.p95Ms ? o.p95Ms * 2 : null);
  if (!enterprise() || !thresholdMs) return null;
  const field = quoteField(o.durationField);
  return scopedPrefill(serviceScope(s), (where) => ({
    ...absencePrefill(s.stream, where, "", s.service, NO_DATA_MINUTES),
    name: draftNameOf(s, "latency"),
    sql: `SELECT approx_percentile_cont(${field}, 0.95) AS p95 FROM ${quoteStream(s.stream.name)} WHERE ${where} HAVING approx_percentile_cont(${field}, 0.95) > ${thresholdMs * 1000}`,
  }));
};

/** The origin line a builder writes into the alert description. */
export const prefillDescription = (prefill: AlertPrefill): string =>
  typeof prefill.meta?.description === "string" ? prefill.meta.description : "";
