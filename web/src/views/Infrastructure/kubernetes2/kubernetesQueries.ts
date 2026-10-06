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

export type View =
  | "cluster"
  | "map"
  | "nodes"
  | "workloads"
  | "pods"
  | "deployments"
  | "daemonsets"
  | "statefulsets"
  | "replicasets"
  | "jobs"
  | "cronjobs"
  | "pvcs"
  | "hpas"
  | "namespaces"
  | "events";

export type DetailKind =
  | "pod"
  | "node"
  | "deployment"
  | "daemonset"
  | "statefulset"
  | "replicaset"
  | "job"
  | "cronjob"
  | "pvc"
  | "hpa"
  | "namespace";

export type MapEntity = "pods" | "nodes";

export type MapGroup = "node" | "namespace" | "workload" | "none";

export type MetricFamily = "kube-state-metrics" | "kubeletstats";

// One matcher per family, e.g. `k8s_cluster="prod"`; null sends the family unscoped.
export interface ClusterMatchers {
  ksm: string | null;
  kubelet: string | null;
}

export interface TrendTarget {
  clusterLabel: "k8s_cluster" | "k8s_cluster_name" | null;
  cluster: string;
  namespace: string;
  pod: string;
  uid: string | null;
}

export interface KindInfo {
  view: View;
  // The Kubernetes kind as events and owner references spell it.
  kind: string;
  // KSM's label for the object name.
  label: string;
  // k8s_events' plural resource name for object records.
  resource: string;
  namespaced: boolean;
  title: I18nKey;
}

// Collectors disagree on the cluster label's spelling, so every query keeps both.
const C = "k8s_cluster, k8s_cluster_name";

const POD = `${C}, namespace, pod, uid`;

const KUBELET_POD = `${C}, k8s_namespace_name, k8s_pod_name, k8s_pod_uid`;

const CPU_MEMORY = 'resource=~"cpu|memory"';

const QUERIES = {
  P1: (m: M) => `max by (${POD}, phase) (${L("kube_pod_status_phase", m)} == 1)`,
  P2: (m: M) =>
    `max by (${POD}, container, reason) (${sel("kube_pod_container_status_waiting_reason", m)} == 1)`,
  P3: (m: M) =>
    `max by (${POD}, container, reason) (${sel("kube_pod_container_status_last_terminated_reason", m)} == 1)`,
  P4: (m: M) =>
    `max by (${POD}, owner_kind, owner_name) (${L("kube_pod_owner", m, 'owner_is_controller="true"')})`,
  P5: (m: M) =>
    `max by (${C}, namespace, replicaset, owner_kind, owner_name) (${L("kube_replicaset_owner", m, 'owner_is_controller="true"')})`,
  P6: (m: M) => `max by (${POD}, node, pod_ip, priority_class) (${L("kube_pod_info", m)})`,
  P7: (m: M) => `max by (${POD}, container) (${L("kube_pod_container_status_restarts_total", m)})`,
  P8: (m: M) =>
    `max by (${POD}, container, resource) (${L("kube_pod_container_resource_requests", m, CPU_MEMORY)})`,
  P9: (m: M) =>
    `max by (${POD}, container, resource) (${L("kube_pod_container_resource_limits", m, CPU_MEMORY)})`,
  P10: (m: M) => `max by (${POD}, container, image) (${L("kube_pod_container_info", m)})`,
  P11: (m: M) => `max by (${POD}, condition) (${L("kube_pod_status_ready", m)} == 1)`,
  P12: (m: M) => `max by (${POD}) (${L("kube_pod_created", m)})`,
  P13: (m: M) => `max by (${POD}, container) (${L("kube_pod_container_status_ready", m)})`,
  P14: (m: M) =>
    `max by (${POD}, container, reason) (${sel("kube_pod_container_status_terminated_reason", m)} == 1)`,
  P15: (m: M) => `max by (${POD}, reason) (${L("kube_pod_status_reason", m)} == 1)`,
  K1: (m: M) => `sum by (${KUBELET_POD}) (${sel("k8s_pod_cpu_usage", m)})`,
  K2: (m: M) => `sum by (${KUBELET_POD}) (${sel("k8s_pod_memory_working_set", m)})`,
  K3: (m: M) => `sum by (${C}, k8s_node_name) (${sel("k8s_node_cpu_usage", m)})`,
  K4: (m: M) => `sum by (${C}, k8s_node_name) (${sel("k8s_node_memory_working_set", m)})`,
  K5: (m: M) => `sum by (${C}, k8s_node_name) (${sel("k8s_node_filesystem_usage", m)})`,
  K6: (m: M) => `sum by (${C}, k8s_node_name) (${sel("k8s_node_filesystem_capacity", m)})`,
  K7: (m: M) =>
    `max by (${C}, k8s_namespace_name, k8s_pod_name, k8s_persistentvolumeclaim_name) (${sel("k8s_volume_capacity", m)})`,
  N1: (m: M) =>
    `max by (${C}, node, condition, status) (${L("kube_node_status_condition", m)} == 1)`,
  N2: (m: M) =>
    `max by (${C}, node, resource) (${L("kube_node_status_allocatable", m, 'resource=~"cpu|memory|pods|ephemeral_storage"')})`,
  N3: (m: M) =>
    `max by (${C}, node, kubelet_version, internal_ip, os_image, kernel_version, container_runtime_version) (${L("kube_node_info", m)})`,
  N4: (m: M) => `max by (${C}, node, key, value, effect) (${L("kube_node_spec_taint", m)})`,
  N5: (m: M) => `max by (${C}, node) (${L("kube_node_created", m)})`,
  O1: (m: M) =>
    `sum by (${C}, resource) (${L("kube_node_status_allocatable", m, 'resource=~"cpu|memory|pods"')})`,
  O2: (m: M) =>
    `sum by (${C}, resource) (${L("kube_pod_container_resource_requests", m, CPU_MEMORY)})`,
  O3: (m: M) =>
    `sum by (${C}, resource) (${L("kube_pod_container_resource_limits", m, CPU_MEMORY)})`,
  O4: (m: M) => `sum by (${C}) (${sel("k8s_node_cpu_usage", m)})`,
  O5: (m: M) => `sum by (${C}) (${sel("k8s_node_memory_working_set", m)})`,
  D1: ksm("kube_deployment_spec_replicas", "deployment"),
  D2: ksm("kube_deployment_status_replicas_available", "deployment"),
  D3: ksm("kube_deployment_status_replicas", "deployment"),
  D4: ksm("kube_deployment_status_replicas_updated", "deployment"),
  D5: ksm("kube_deployment_created", "deployment"),
  D6: ksm("kube_deployment_status_replicas_unavailable", "deployment"),
  DS1: ksm("kube_daemonset_status_desired_number_scheduled", "daemonset"),
  DS2: ksm("kube_daemonset_created", "daemonset"),
  DS3: ksm("kube_daemonset_status_current_number_scheduled", "daemonset"),
  DS5: ksm("kube_daemonset_status_number_ready", "daemonset"),
  SS1: ksm("kube_statefulset_replicas", "statefulset"),
  SS2: ksm("kube_statefulset_status_replicas_ready", "statefulset"),
  SS3: ksm("kube_statefulset_status_replicas_current", "statefulset"),
  SS4: ksm("kube_statefulset_created", "statefulset"),
  RS2: ksm("kube_replicaset_spec_replicas", "replicaset"),
  RS3: ksm("kube_replicaset_status_replicas", "replicaset"),
  RS4: ksm("kube_replicaset_status_ready_replicas", "replicaset"),
  RS5: ksm("kube_replicaset_created", "replicaset"),
  J1: ksm("kube_job_status_active", "job_name"),
  J2: ksm("kube_job_status_succeeded", "job_name"),
  J3: ksm("kube_job_status_failed", "job_name, reason"),
  J4: ksm("kube_job_spec_completions", "job_name"),
  J5: ksm("kube_job_complete", "job_name", { inner: 'condition="true"' }),
  J6: ksm("kube_job_created", "job_name"),
  J7: ksm("kube_job_owner", "job_name, owner_kind, owner_name"),
  CJ1: ksm("kube_cronjob_info", "cronjob, schedule"),
  CJ2: ksm("kube_cronjob_spec_suspend", "cronjob"),
  CJ3: ksm("kube_cronjob_status_active", "cronjob"),
  CJ4: ksm("kube_cronjob_created", "cronjob"),
  V1: ksm("kube_persistentvolumeclaim_status_phase", "persistentvolumeclaim, phase", { one: true }),
  V2: ksm("kube_persistentvolumeclaim_info", "persistentvolumeclaim, storageclass"),
  V3: ksm("kube_persistentvolumeclaim_resource_requests_storage_bytes", "persistentvolumeclaim"),
  V4: ksm("kube_persistentvolumeclaim_created", "persistentvolumeclaim"),
  H1: ksm("kube_horizontalpodautoscaler_spec_max_replicas", "horizontalpodautoscaler"),
  H2: ksm("kube_horizontalpodautoscaler_spec_min_replicas", "horizontalpodautoscaler"),
  H3: ksm("kube_horizontalpodautoscaler_status_current_replicas", "horizontalpodautoscaler"),
  H4: ksm(
    "kube_horizontalpodautoscaler_status_condition",
    "horizontalpodautoscaler, condition, status",
    {
      one: true,
    },
  ),
  H5: ksm("kube_horizontalpodautoscaler_created", "horizontalpodautoscaler"),
  H8: ksm(
    "kube_horizontalpodautoscaler_info",
    "horizontalpodautoscaler, scaletargetref_kind, scaletargetref_name",
  ),
  NS1: ksm("kube_namespace_status_phase", "phase", { one: true }),
  NS2: ksm("kube_namespace_created", ""),
  CL1N: () => `count by (k8s_cluster, k8s_cluster_name) (${L("kube_node_status_condition", null)})`,
  CL1P: () => `count by (k8s_cluster, k8s_cluster_name) (${L("kube_pod_status_phase", null)})`,
  CL1D: () =>
    `count by (k8s_cluster, k8s_cluster_name) (${L("kube_deployment_spec_replicas", null)})`,
  CL2N: () => `count by (k8s_cluster, k8s_cluster_name) (k8s_node_cpu_usage)`,
  CL2P: () => `count by (k8s_cluster, k8s_cluster_name) (k8s_pod_cpu_usage)`,
} satisfies Record<string, (m: M) => string>;

type M = string | null;

export type QueryId = keyof typeof QUERIES;

export const CLUSTER_QUERIES: readonly QueryId[] = ["CL1N", "CL1P", "CL1D", "CL2N", "CL2P"];

export const KIND_INFO: Record<DetailKind, KindInfo> = {
  pod: {
    view: "pods",
    kind: "Pod",
    label: "pod",
    resource: "pods",
    namespaced: true,
    title: "infra.k8s2.kindPod",
  },
  node: {
    view: "nodes",
    kind: "Node",
    label: "node",
    resource: "nodes",
    namespaced: false,
    title: "infra.k8s2.kindNode",
  },
  deployment: {
    view: "deployments",
    kind: "Deployment",
    label: "deployment",
    resource: "deployments",
    namespaced: true,
    title: "infra.k8s2.kindDeployment",
  },
  daemonset: {
    view: "daemonsets",
    kind: "DaemonSet",
    label: "daemonset",
    resource: "daemonsets",
    namespaced: true,
    title: "infra.k8s2.kindDaemonSet",
  },
  statefulset: {
    view: "statefulsets",
    kind: "StatefulSet",
    label: "statefulset",
    resource: "statefulsets",
    namespaced: true,
    title: "infra.k8s2.kindStatefulSet",
  },
  replicaset: {
    view: "replicasets",
    kind: "ReplicaSet",
    label: "replicaset",
    resource: "replicasets",
    namespaced: true,
    title: "infra.k8s2.kindReplicaSet",
  },
  job: {
    view: "jobs",
    kind: "Job",
    label: "job_name",
    resource: "jobs",
    namespaced: true,
    title: "infra.k8s2.kindJob",
  },
  cronjob: {
    view: "cronjobs",
    kind: "CronJob",
    label: "cronjob",
    resource: "cronjobs",
    namespaced: true,
    title: "infra.k8s2.kindCronJob",
  },
  pvc: {
    view: "pvcs",
    kind: "PersistentVolumeClaim",
    label: "persistentvolumeclaim",
    resource: "persistentvolumeclaims",
    namespaced: true,
    title: "infra.k8s2.kindPvc",
  },
  hpa: {
    view: "hpas",
    kind: "HorizontalPodAutoscaler",
    label: "horizontalpodautoscaler",
    resource: "horizontalpodautoscalers",
    namespaced: true,
    title: "infra.k8s2.kindHpa",
  },
  namespace: {
    view: "namespaces",
    kind: "Namespace",
    label: "namespace",
    resource: "namespaces",
    namespaced: false,
    title: "infra.k8s2.kindNamespace",
  },
};

export const DETAIL_KINDS = Object.keys(KIND_INFO) as DetailKind[];

export const VIEWS: readonly View[] = [
  "cluster",
  "map",
  "nodes",
  "workloads",
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "pvcs",
  "hpas",
  "namespaces",
  "events",
];

const POD_SET: QueryId[] = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12",
  "P13",
  "P14",
  "P15",
  "K1",
  "K2",
];

const MAP_POD_SET: QueryId[] = POD_SET.filter((id) => !["P13", "P14"].includes(id));

// §7.2: the PromQL each view sends; the CL queries and NS1 are added for every view.
export const VIEW_QUERIES: Record<Exclude<View, "map">, readonly QueryId[]> = {
  cluster: ["O1", "O2", "O3", "O4", "O5", "N1", "P1", "P2", "P11", "P12"],
  nodes: ["N1", "N2", "N3", "N4", "N5", "K3", "K4", "K5", "K6"],
  workloads: [
    "P1",
    "P2",
    "P4",
    "P5",
    "P11",
    "P12",
    "P15",
    "D1",
    "DS1",
    "SS1",
    "RS2",
    "J1",
    "J2",
    "J3",
    "J5",
    "CJ2",
  ],
  pods: POD_SET,
  deployments: ["D1", "D2", "D3", "D5"],
  daemonsets: ["DS1", "DS2", "DS3", "DS5"],
  statefulsets: ["SS1", "SS2", "SS3", "SS4"],
  replicasets: ["RS2", "RS3", "RS4", "RS5", "P5"],
  jobs: ["J1", "J2", "J3", "J4", "J5", "J6"],
  cronjobs: ["CJ1", "CJ2", "CJ3", "CJ4", "J6", "J7"],
  pvcs: ["V1", "V2", "V3", "V4", "K7"],
  hpas: ["H1", "H2", "H3", "H4", "H5"],
  namespaces: ["NS1", "NS2"],
  events: [],
};

// Drawer additions on top of the kind's own list set (§7.2).
export const DETAIL_EXTRA_QUERIES: Record<DetailKind, readonly QueryId[]> = {
  pod: [],
  node: [],
  deployment: ["D4", "D6", "P5", "RS2", "RS4"],
  daemonset: [],
  statefulset: [],
  replicaset: [],
  job: ["J7"],
  cronjob: ["J1", "J2", "J3", "J7"],
  pvc: [],
  hpa: ["H8"],
  namespace: [],
};

// Kinds whose drawer lists related pods, so it also loads the Pods set.
export const DETAIL_WITH_PODS: ReadonlySet<DetailKind> = new Set([
  "node",
  "deployment",
  "daemonset",
  "statefulset",
  "replicaset",
  "job",
  "namespace",
]);

// A view is usable when any of its anchor streams exists; null means the view is not metric-anchored.
export const VIEW_ANCHORS: Record<View, readonly string[] | null> = {
  cluster: null,
  map: null,
  nodes: ["kube_node_status_condition"],
  workloads: null,
  pods: ["kube_pod_status_phase"],
  deployments: ["kube_deployment_spec_replicas"],
  daemonsets: ["kube_daemonset_status_desired_number_scheduled"],
  statefulsets: ["kube_statefulset_replicas"],
  replicasets: ["kube_replicaset_spec_replicas"],
  jobs: ["kube_job_status_failed", "kube_job_status_succeeded", "kube_job_status_active"],
  cronjobs: ["kube_cronjob_info"],
  pvcs: ["kube_persistentvolumeclaim_status_phase"],
  hpas: ["kube_horizontalpodautoscaler_spec_max_replicas"],
  namespaces: ["kube_namespace_status_phase"],
  events: null,
};

export const MAP_ANCHOR: Record<MapEntity, string> = {
  pods: "kube_pod_status_phase",
  nodes: "kube_node_status_condition",
};

export const POD_ANCHOR = "kube_pod_status_phase";

export const EVENTS_STREAM = "k8s_events";

// Absent under a present pod anchor means "no container is in that state", so the result is empty, not unknown.
export const SPARSE_STREAMS: ReadonlySet<string> = new Set([
  "kube_pod_container_status_waiting_reason",
  "kube_pod_container_resource_limits",
  "kube_pod_container_status_terminated_reason",
]);

// The openobserve-collector chart drops this stream, so its absence says nothing about OOMs.
export const OPTIONAL_STREAM = "kube_pod_container_status_last_terminated_reason";

export const DETECTION_STREAMS: readonly string[] = [
  "kube_pod_status_phase",
  "kube_node_status_condition",
  "kube_deployment_spec_replicas",
  "k8s_pod_cpu_usage",
  "k8s_pod_memory_working_set",
  "k8s_node_cpu_usage",
  "k8s_node_memory_working_set",
];

const STREAM_OF = /\b(kube_[a-z_]+|k8s_[a-z_]+)\b/;

export const QUERY_STREAM = Object.fromEntries(
  (Object.keys(QUERIES) as QueryId[]).map((id) => {
    const text = QUERIES[id](null).replace(/^[a-z]+ by \([^)]*\) /, "");
    return [id, STREAM_OF.exec(text)?.[1] ?? ""];
  }),
) as Record<QueryId, string>;

export const familyOf = (id: QueryId): MetricFamily =>
  QUERY_STREAM[id].startsWith("k8s_") ? "kubeletstats" : "kube-state-metrics";

// CL queries are what decide the matchers, so they are never scoped themselves.
export const queryText = (id: QueryId, matchers: ClusterMatchers | null = null) => {
  if (CLUSTER_QUERIES.includes(id) || !matchers) return QUERIES[id](null);
  return QUERIES[id](familyOf(id) === "kubeletstats" ? matchers.kubelet : matchers.ksm);
};

export const mapQueries = (entity: MapEntity, group: MapGroup): QueryId[] =>
  entity === "nodes"
    ? ["N1", "N2", "K3", "K4"]
    : group === "node"
      ? [...MAP_POD_SET, "N1"]
      : [...MAP_POD_SET];

export const detailQueries = (kind: DetailKind): QueryId[] => {
  const own = VIEW_QUERIES[KIND_INFO[kind].view as Exclude<View, "map">];
  const pods = DETAIL_WITH_PODS.has(kind) ? POD_SET : [];
  return [...new Set([...own, ...pods, ...DETAIL_EXTRA_QUERIES[kind]])];
};

export const escapeLabel = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const podTrendQuery = (metric: string, target: TrendTarget) =>
  `sum(${metric}{${podMatchers(target)}})`;

export const podMatchers = (target: TrendTarget) => {
  const matchers: string[] = [];
  if (target.clusterLabel && target.cluster) {
    matchers.push(`${target.clusterLabel}="${escapeLabel(target.cluster)}"`);
  }
  matchers.push(`k8s_namespace_name="${escapeLabel(target.namespace)}"`);
  matchers.push(`k8s_pod_name="${escapeLabel(target.pod)}"`);
  if (target.uid) matchers.push(`k8s_pod_uid="${escapeLabel(target.uid)}"`);
  return matchers.join(",");
};

function sel(metric: string, m: M, inner = "") {
  const parts = [inner, m].filter(Boolean);
  return parts.length ? `${metric}{${parts.join(",")}}` : metric;
}

function L(metric: string, m: M, inner = "") {
  return `last_over_time(${sel(metric, m, inner)}[10m])`;
}

function ksm(metric: string, keyLabels: string, opts: { inner?: string; one?: boolean } = {}) {
  const by = keyLabels ? `${C}, namespace, ${keyLabels}` : `${C}, namespace`;
  return (m: M) => `max by (${by}) (${L(metric, m, opts.inner)}${opts.one ? " == 1" : ""})`;
}
