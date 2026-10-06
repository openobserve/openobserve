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
import { EVENTS_STREAM, KIND_INFO, type DetailKind } from "./kubernetesQueries";
import {
  INVENTORY_KEY,
  observedDeploymentConditions,
  rowKey,
  type AnyRow,
  type Inventory,
  type K8sObject,
  type QosClass,
} from "./kubernetesModel";

export interface ObjectRecord {
  namespace: string;
  name: string;
  deleted: boolean;
  object: K8sObject;
}

// Each list variant reads only what its list renders (§7.3), plus the creation time for Age.
const LIST_COLUMNS: Partial<Record<DetailKind, Record<string, string>>> = {
  pod: { qos_class: "json_get_str(body_object_status,'qosClass')" },
  node: {
    labels: "json_get_json(body_object_metadata,'labels')",
    unschedulable: "json_get_bool(body_object_spec,'unschedulable')",
  },
  deployment: { conditions: "json_get_json(body_object_status,'conditions')" },
  daemonset: { node_selector: "json_get_json(body_object_spec,'template','spec','nodeSelector')" },
  cronjob: { last_schedule: "json_get_str(body_object_status,'lastScheduleTime')" },
  namespace: { labels: "json_get_json(body_object_metadata,'labels')" },
};

const CREATED = "json_get_str(body_object_metadata,'creationTimestamp')";

const OBJECT_LIST_LIMIT = 5000;

const q = (value: string) => `'${escapeSingleQuotes(value)}'`;

export const LIST_OBJECT_KINDS = Object.keys(LIST_COLUMNS) as DetailKind[];

export function objectListSql(kind: DetailKind, cluster: string, namespaces: string[]) {
  const columns = Object.entries({ ...LIST_COLUMNS[kind], created: CREATED });
  const nsTerm =
    KIND_INFO[kind].namespaced && namespaces.length
      ? ` AND k8s_namespace_name IN (${namespaces.map(q).join(", ")})`
      : "";
  return objectSql(
    kind,
    cluster,
    columns.map(([alias, expr]) => `${expr} AS ${alias}`).join(", "),
    columns.map(([alias]) => alias).join(", "),
    nsTerm,
    OBJECT_LIST_LIMIT,
  );
}

export function objectDetailSql(
  kind: DetailKind,
  cluster: string,
  target: { namespace: string; name: string; uid: string | null },
) {
  let terms = ` AND event_name = ${q(target.name)}`;
  if (KIND_INFO[kind].namespaced) terms += ` AND k8s_namespace_name = ${q(target.namespace)}`;
  if (kind === "pod" && target.uid) {
    terms += ` AND json_get_str(body_object_metadata,'uid') = ${q(target.uid)}`;
  }
  const bodies = "body_object_metadata, body_object_spec, body_object_status";
  return objectSql(kind, cluster, bodies, bodies, terms, 1);
}

export function parseObjects(hits: any[]): ObjectRecord[] {
  const out: ObjectRecord[] = [];
  for (const h of hits) {
    const metadata = json(h.body_object_metadata ?? "{}");
    const spec = json(h.body_object_spec ?? "{}");
    const status = json(h.body_object_status ?? "{}");
    const labels = h.labels == null ? undefined : json(h.labels);
    const conditions = h.conditions == null ? undefined : json(h.conditions);
    const nodeSelector = h.node_selector == null ? undefined : json(h.node_selector);
    // Malformed JSON means the object was not observed, never a crash.
    if ([metadata, spec, status, labels, conditions, nodeSelector].includes(null)) continue;
    const object: K8sObject = {
      uid: h.uid || null,
      metadata: { ...metadata },
      spec: { ...spec },
      status: { ...status },
    };
    if (labels !== undefined) object.metadata.labels = labels;
    if (h.created) object.metadata.creationTimestamp = h.created;
    if (h.unschedulable != null)
      object.spec.unschedulable = h.unschedulable === true || h.unschedulable === "true";
    if (nodeSelector !== undefined) object.spec.template = { spec: { nodeSelector } };
    if (conditions !== undefined) object.status.conditions = conditions;
    if (h.last_schedule) object.status.lastScheduleTime = h.last_schedule;
    if (h.qos_class) object.status.qosClass = h.qos_class;
    out.push({
      namespace: String(h.k8s_namespace_name ?? ""),
      name: String(h.event_name ?? ""),
      deleted: h.body_type === "DELETED",
      object,
    });
  }
  return out;
}

export function joinObjects(
  inventory: Inventory,
  kind: DetailKind,
  cluster: string,
  records: ObjectRecord[],
) {
  const rows = new Map(
    (inventory[INVENTORY_KEY[kind]] as AnyRow[]).map((row) => [row.key, row] as const),
  );
  for (const record of records) {
    if (record.deleted) continue;
    const row = rows.get(rowKey(kind, cluster, record.namespace, record.name));
    if (!row) continue;
    // A pod object of another generation describes a pod that no longer exists.
    if (kind === "pod" && record.object.uid !== row.uid) continue;
    enrich(row, record.object);
  }
}

export function labelsOf(object: K8sObject | null): Record<string, string> | null {
  const labels = object?.metadata?.labels;
  return labels && typeof labels === "object" ? labels : null;
}

function enrich(row: AnyRow, object: K8sObject) {
  row.object = object;
  if (row.kind !== "pod") row.uid = object.uid;
  const created = Date.parse(object.metadata?.creationTimestamp ?? "");
  if (row.createdAt == null && Number.isFinite(created)) row.createdAt = created * 1000;
  switch (row.kind) {
    case "pod": {
      const cls = object.status?.qosClass as QosClass | undefined;
      if (cls) row.qos = { cls, estimated: false };
      const init: any[] = Array.isArray(object.spec?.initContainers)
        ? object.spec.initContainers
        : [];
      const statuses: any[] = object.status?.initContainerStatuses ?? [];
      row.containers = [
        ...init.map((c) => {
          const s = statuses.find((x) => x?.name === c?.name);
          const terminated = s?.state?.terminated?.reason ?? null;
          return {
            name: String(c?.name ?? ""),
            init: true,
            image: c?.image ?? null,
            ready: s?.ready ?? null,
            state: terminated ? ("terminated" as const) : ("unknown" as const),
            running: false,
            waitingReason: s?.state?.waiting?.reason ?? null,
            terminatedReason: terminated,
            lastTerminatedReason: null,
            restarts: s?.restartCount ?? null,
            cpuRequest: null,
            cpuLimit: null,
            memoryRequest: null,
            memoryLimit: null,
          };
        }),
        ...row.containers.filter((c) => !c.init),
      ];
      break;
    }
    case "node": {
      const labels = labelsOf(object) ?? {};
      row.roles = Object.keys(labels)
        .filter((k) => k.startsWith("node-role.kubernetes.io/"))
        .map((k) => k.slice("node-role.kubernetes.io/".length))
        .filter(Boolean)
        .sort();
      row.unschedulable = object.spec?.unschedulable === true;
      break;
    }
    case "deployment":
      if (Array.isArray(object.status?.conditions)) {
        row.conditions = observedDeploymentConditions(object);
        row.conditionsDerived = false;
      }
      break;
    case "daemonset": {
      const selector = object.spec?.template?.spec?.nodeSelector;
      row.nodeSelector = selector && typeof selector === "object" ? selector : null;
      break;
    }
    case "cronjob": {
      const at = Date.parse(object.status?.lastScheduleTime ?? "");
      if (Number.isFinite(at)) row.lastSchedule = at * 1000;
      break;
    }
    default:
      break;
  }
}

// The latest record per object identity, across uids, so only the newest generation survives.
function objectSql(
  kind: DetailKind,
  cluster: string,
  innerColumns: string,
  outerColumns: string,
  terms: string,
  limit: number,
) {
  return (
    `SELECT uid, event_name, k8s_namespace_name, body_type, ${outerColumns}, _timestamp FROM (` +
    "SELECT json_get_str(body_object_metadata,'uid') AS uid, event_name, k8s_namespace_name, " +
    `body_type, ${innerColumns}, _timestamp, ` +
    "ROW_NUMBER() OVER (PARTITION BY k8s_cluster, k8s_resource_name, " +
    "COALESCE(k8s_namespace_name, ''), event_name ORDER BY _timestamp DESC) AS rn " +
    `FROM "${EVENTS_STREAM}" WHERE k8s_resource_name = ${q(KIND_INFO[kind].resource)} ` +
    `AND k8s_cluster = ${q(cluster)}${terms}` +
    `) WHERE rn = 1 ORDER BY _timestamp DESC LIMIT ${limit}`
  );
}

function json(value: unknown): any {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
