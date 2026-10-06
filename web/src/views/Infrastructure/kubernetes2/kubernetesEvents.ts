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

import { escapeSingleQuotes } from "@/utils/zincutils";
import type { I18nKey } from "@/types/i18n";
import { EVENTS_STREAM, KIND_INFO, type DetailKind } from "./kubernetesQueries";
import { inScope, type Inventory, type PodRow, type WarningEvent } from "./kubernetesModel";

export interface InvolvedObject {
  kind: string;
  name: string;
  namespace: string;
  uid: string;
}

export interface EventRow {
  key: string;
  type: string;
  reason: string;
  note: string;
  object: InvolvedObject;
  source: string;
  count: number | null;
  // µs
  firstSeen: number | null;
  lastSeen: number | null;
}

export interface WarningListRow {
  key: string;
  message: { text?: string; key?: I18nKey };
  object: InvolvedObject;
  // µs; null for node conditions, whose transition times are not in KSM.
  lastSeen: number | null;
}

export interface EventScope {
  // null in the unscoped mode, where k8s_events carries no cluster label.
  cluster: string | null;
  namespaces: string[];
}

export const W_ROW_LIMIT = 20000;

const EK =
  "COALESCE(json_get_str(body_object_metadata,'uid'), k8s_namespace_name || '/' || event_name)";

const REGARDING = (field: string) => `json_get_str(body_object_regarding,'${field}')`;

const q = (value: string) => `'${escapeSingleQuotes(value)}'`;

const clusterTerm = (cluster: string | null) => (cluster ? ` AND k8s_cluster = ${q(cluster)}` : "");

const eventNsFilter = (namespaces: string[]) =>
  namespaces.length ? ` AND ${REGARDING("namespace")} IN (${namespaces.map(q).join(", ")})` : "";

const EVENT_COLUMNS = [
  "event_name",
  "body_object_type",
  "body_object_reason",
  "body_object_note",
  "body_object_regarding",
  "body_object_reportingcontroller",
  "body_object_reportinginstance",
  "body_object_series",
  "body_object_deprecatedcount",
  "body_object_eventtime",
  "k8s_namespace_name",
  "_timestamp",
].join(", ");

const KIND_BY_NAME = new Map(
  Object.entries(KIND_INFO).map(([kind, info]) => [info.kind, kind as DetailKind]),
);

// The Lens issue rules P1, P2 and P11 can evaluate (events/store.ts:56-60).
const LENS_POD_ISSUE = (pod: PodRow) =>
  pod.phase === "Pending" ||
  pod.phase === "Failed" ||
  pod.phase === "Unknown" ||
  (pod.phase === "Running" && pod.ready !== "true") ||
  pod.containers.some((c) => c.waitingReason);

export const detailKindOf = (kind: string): DetailKind | null => KIND_BY_NAME.get(kind) ?? null;

export function warningSql(scope: EventScope, kind: string | null, namespaced: boolean) {
  const nsFilter = namespaced ? eventNsFilter(scope.namespaces) : "";
  const kindFilter = kind ? ` AND ${REGARDING("kind")} = ${q(kind)}` : "";
  return (
    "SELECT kind, name, namespace, uid, count(*) AS events, max(last_seen) AS last_seen, " +
    "first_value(reason ORDER BY last_seen DESC) AS reason, " +
    "first_value(note ORDER BY last_seen DESC) AS note FROM (" +
    `SELECT ${REGARDING("kind")} AS kind, ${REGARDING("name")} AS name, ` +
    `${REGARDING("namespace")} AS namespace, ${REGARDING("uid")} AS uid, ` +
    "body_object_reason AS reason, body_object_note AS note, _timestamp AS last_seen, " +
    `ROW_NUMBER() OVER (PARTITION BY ${EK} ORDER BY _timestamp DESC) AS rn ` +
    `FROM "${EVENTS_STREAM}" WHERE body_object_kind = 'Event' AND body_object_type = 'Warning'` +
    `${clusterTerm(scope.cluster)}${nsFilter}${kindFilter}` +
    ") WHERE rn = 1 GROUP BY kind, name, namespace, uid ORDER BY last_seen DESC"
  );
}

export function eventsSql(scope: EventScope, limit: number) {
  return eventsQuery(`${clusterTerm(scope.cluster)}${eventNsFilter(scope.namespaces)}`, limit);
}

export function detailEventsSql(
  cluster: string | null,
  target: { kind: DetailKind; namespace: string; name: string; uid: string | null },
) {
  const info = KIND_INFO[target.kind];
  let terms = `${clusterTerm(cluster)} AND ${REGARDING("kind")} = ${q(info.kind)} AND ${REGARDING("name")} = ${q(target.name)}`;
  if (info.namespaced) terms += ` AND ${REGARDING("namespace")} = ${q(target.namespace)}`;
  if (target.uid) terms += ` AND ${REGARDING("uid")} = ${q(target.uid)}`;
  return eventsQuery(terms, 100);
}

export function clusterFallbackSql() {
  return `SELECT DISTINCT k8s_cluster AS c FROM "${EVENTS_STREAM}"`;
}

export function parseWarnings(
  hits: any[],
  cluster: string,
): { rows: WarningEvent[]; truncated: boolean } {
  return {
    truncated: hits.length > W_ROW_LIMIT,
    rows: hits.slice(0, W_ROW_LIMIT).map((h) => ({
      cluster,
      kind: String(h.kind ?? ""),
      name: String(h.name ?? ""),
      namespace: String(h.namespace ?? ""),
      uid: String(h.uid ?? ""),
      events: Number(h.events ?? 1),
      lastSeen: Number(h.last_seen ?? 0),
      reason: String(h.reason ?? ""),
      note: String(h.note ?? ""),
    })),
  };
}

export function parseEvents(hits: any[]): EventRow[] {
  return hits.map((h) => {
    const regarding = parseJson(h.body_object_regarding);
    const series = parseJson(h.body_object_series);
    const seriesCount = Number(series.count);
    const deprecated = Number(h.body_object_deprecatedcount);
    const source = [h.body_object_reportingcontroller, h.body_object_reportinginstance]
      .filter(Boolean)
      .join(" ");
    return {
      key: `${h.k8s_namespace_name ?? ""}/${h.event_name ?? ""}/${h._timestamp ?? ""}`,
      type: String(h.body_object_type ?? ""),
      reason: String(h.body_object_reason ?? ""),
      note: String(h.body_object_note ?? ""),
      object: {
        kind: String(regarding.kind ?? ""),
        name: String(regarding.name ?? ""),
        namespace: String(regarding.namespace ?? ""),
        uid: String(regarding.uid ?? ""),
      },
      source,
      count:
        Number.isFinite(seriesCount) && series.count != null
          ? seriesCount
          : Number.isFinite(deprecated) && h.body_object_deprecatedcount != null
            ? deprecated
            : null,
      firstSeen: isoToUs(h.body_object_eventtime),
      lastSeen: isoToUs(series.lastObservedTime) ?? numberOrNull(h._timestamp),
    };
  });
}

export function warningListRows(
  inventory: Inventory,
  events: WarningEvent[],
  cluster: string | null,
): WarningListRow[] {
  const scope = { cluster, namespaces: [] };
  const rows: WarningListRow[] = [];
  for (const node of inventory.nodes.filter((n) => inScope(n, scope))) {
    const object = { kind: "Node", name: node.name, namespace: "", uid: "" };
    for (const [condition, status] of Object.entries(node.conditions)) {
      if (condition !== "Ready" && status === "true") {
        rows.push({
          key: `node|${node.name}|${condition}`,
          message: { text: condition },
          object,
          lastSeen: null,
        });
      }
    }
    if (node.ready === "false" || node.ready === "unknown") {
      rows.push({
        key: `node|${node.name}|Ready`,
        message: { key: "infra.k8s2.nodeIsNotReady" },
        object,
        lastSeen: null,
      });
    }
  }
  const pods = inventory.pods.filter((p) => inScope(p, scope));
  const kept = events.filter((e) => e.kind !== "Pod" || keepPodEvent(e, pods));
  const latest = new Map<string, WarningEvent>();
  const merge = (id: string, event: WarningEvent) => {
    const prev = latest.get(id);
    latest.set(
      id,
      !prev
        ? event
        : {
            ...(event.lastSeen >= prev.lastSeen ? event : prev),
            uid: prev.uid || event.uid,
            events: prev.events + event.events,
          },
    );
  };
  const named = (e: WarningEvent) => `${e.kind}|${e.namespace}|${e.name}`;
  // A uid tells a recreated object from its predecessor; uid-less events join the newest of that name.
  for (const event of kept) if (event.uid) merge(`${named(event)}|${event.uid}`, event);
  for (const event of kept.filter((e) => !e.uid)) {
    const owners = [...latest.entries()].filter(([, e]) => named(e) === named(event));
    const newest = owners.sort(([, a], [, b]) => b.lastSeen - a.lastSeen)[0];
    merge(newest ? newest[0] : named(event), event);
  }
  for (const [id, event] of latest) {
    rows.push({
      key: id,
      message: { text: event.note },
      object: { kind: event.kind, name: event.name, namespace: event.namespace, uid: event.uid },
      lastSeen: event.lastSeen,
    });
  }
  return rows;
}

// Lens drops a pod's events unless the pod still exists and still has an issue.
function keepPodEvent(event: WarningEvent, pods: PodRow[]) {
  const pod = pods.find(
    (p) =>
      p.namespace === event.namespace &&
      p.name === event.name &&
      p.phase != null &&
      (!event.uid || !p.uid || p.uid === event.uid),
  );
  return !!pod && LENS_POD_ISSUE(pod);
}

function eventsQuery(terms: string, limit: number) {
  return (
    `SELECT * FROM (SELECT ${EVENT_COLUMNS}, ` +
    `ROW_NUMBER() OVER (PARTITION BY ${EK} ORDER BY _timestamp DESC) AS rn ` +
    `FROM "${EVENTS_STREAM}" WHERE body_object_kind = 'Event'${terms}` +
    `) WHERE rn = 1 ORDER BY _timestamp DESC LIMIT ${limit}`
  );
}

function parseJson(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isoToUs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms * 1000 : null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? n : null;
}
