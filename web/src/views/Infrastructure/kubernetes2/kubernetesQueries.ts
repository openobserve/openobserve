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

export type QueryId =
  | "P1"
  | "P2"
  | "P3"
  | "P4"
  | "P5"
  | "P6"
  | "P7"
  | "P8"
  | "P9"
  | "P10"
  | "P11"
  | "P12"
  | "K1"
  | "K2"
  | "K3"
  | "K4"
  | "N1"
  | "N2"
  | "D1"
  | "D2";

export type K8sKind = "pods" | "nodes" | "deployments";

export type IssueKey =
  | "podsNotRunning"
  | "podsContainerErrors"
  | "podsOomKilled"
  | "podsRestarting"
  | "podsNearMemoryLimit"
  | "nodesNotReady"
  | "nodesPressure"
  | "deploymentsUnavailable";

export interface TrendTarget {
  clusterLabel: "k8s_cluster" | "k8s_cluster_name" | null;
  cluster: string;
  namespace: string;
  pod: string;
  uid: string | null;
}

// Collectors disagree on the cluster label's spelling, so every query keeps both.
const C = "k8s_cluster, k8s_cluster_name";

const POD = `${C}, namespace, pod, uid`;

const KUBELET_POD = `${C}, k8s_namespace_name, k8s_pod_name, k8s_pod_uid`;

const QUERIES: Record<Exclude<QueryId, "P7">, string> = {
  P1: `max by (${POD}, phase) (last_over_time(kube_pod_status_phase[10m]) == 1)`,
  P2: `max by (${POD}, container, reason) (kube_pod_container_status_waiting_reason == 1)`,
  P3: `max by (${POD}, container, reason) (kube_pod_container_status_last_terminated_reason == 1)`,
  P4: `max by (${POD}, owner_kind, owner_name) (last_over_time(kube_pod_owner{owner_is_controller="true"}[10m]))`,
  P5: `max by (${C}, namespace, replicaset, owner_kind, owner_name) (last_over_time(kube_replicaset_owner{owner_is_controller="true"}[10m]))`,
  P6: `max by (${POD}, node) (last_over_time(kube_pod_info[10m]))`,
  P8: `max by (${POD}, container, resource) (last_over_time(kube_pod_container_resource_requests{resource=~"cpu|memory"}[10m]))`,
  P9: `max by (${POD}, container, resource) (last_over_time(kube_pod_container_resource_limits{resource=~"cpu|memory"}[10m]))`,
  P10: `max by (${POD}, container) (last_over_time(kube_pod_container_info[10m]))`,
  P11: `max by (${POD}, condition) (last_over_time(kube_pod_status_ready[10m]) == 1)`,
  P12: `max by (${POD}) (last_over_time(kube_pod_created[10m]))`,
  K1: `sum by (${KUBELET_POD}) (k8s_pod_cpu_usage)`,
  K2: `sum by (${KUBELET_POD}) (k8s_pod_memory_working_set)`,
  K3: `sum by (${C}, k8s_node_name) (k8s_node_cpu_usage)`,
  K4: `sum by (${C}, k8s_node_name) (k8s_node_memory_working_set)`,
  N1: `max by (${C}, node, condition, status) (last_over_time(kube_node_status_condition[10m]) == 1)`,
  N2: `max by (${C}, node, resource) (last_over_time(kube_node_status_allocatable{resource=~"cpu|memory"}[10m]))`,
  D1: `max by (${C}, namespace, deployment) (last_over_time(kube_deployment_spec_replicas[10m]))`,
  D2: `max by (${C}, namespace, deployment) (last_over_time(kube_deployment_status_replicas_available[10m]))`,
};

export const QUERY_STREAM: Record<QueryId, string> = {
  P1: "kube_pod_status_phase",
  P2: "kube_pod_container_status_waiting_reason",
  P3: "kube_pod_container_status_last_terminated_reason",
  P4: "kube_pod_owner",
  P5: "kube_replicaset_owner",
  P6: "kube_pod_info",
  P7: "kube_pod_container_status_restarts_total",
  P8: "kube_pod_container_resource_requests",
  P9: "kube_pod_container_resource_limits",
  P10: "kube_pod_container_info",
  P11: "kube_pod_status_ready",
  P12: "kube_pod_created",
  K1: "k8s_pod_cpu_usage",
  K2: "k8s_pod_memory_working_set",
  K3: "k8s_node_cpu_usage",
  K4: "k8s_node_memory_working_set",
  N1: "kube_node_status_condition",
  N2: "kube_node_status_allocatable",
  D1: "kube_deployment_spec_replicas",
  D2: "kube_deployment_status_replicas_available",
};

export const KSM_ANCHOR: Record<K8sKind, string> = {
  pods: "kube_pod_status_phase",
  nodes: "kube_node_status_condition",
  deployments: "kube_deployment_spec_replicas",
};

// Kubeletstats queries have no family: each is gated on its own stream.
export const QUERY_FAMILY: Partial<Record<QueryId, K8sKind>> = {
  P1: "pods",
  P2: "pods",
  P3: "pods",
  P4: "pods",
  P5: "pods",
  P6: "pods",
  P7: "pods",
  P8: "pods",
  P9: "pods",
  P10: "pods",
  P11: "pods",
  P12: "pods",
  N1: "nodes",
  N2: "nodes",
  D1: "deployments",
  D2: "deployments",
};

// Absent under a present anchor means "no container is in that state", so the result is empty, not unknown.
export const SPARSE_STREAMS: ReadonlySet<string> = new Set([
  "kube_pod_container_status_waiting_reason",
  "kube_pod_container_resource_limits",
]);

// The openobserve-collector chart drops this stream, so its absence says nothing about OOMs.
export const OPTIONAL_STREAM = "kube_pod_container_status_last_terminated_reason";

export const ALWAYS_QUERIES: readonly QueryId[] = [
  "P1",
  "P2",
  "P3",
  "P7",
  "P9",
  "P10",
  "P11",
  "P12",
  "K2",
  "N1",
  "D1",
  "D2",
];

export const TAB_QUERIES: Record<K8sKind, readonly QueryId[]> = {
  pods: ["P4", "P5", "P6", "P8", "K1"],
  nodes: ["P6", "N2", "K3", "K4"],
  deployments: ["P4", "P5"],
};

export const DETECTION_STREAMS: readonly string[] = [
  KSM_ANCHOR.pods,
  KSM_ANCHOR.nodes,
  KSM_ANCHOR.deployments,
  QUERY_STREAM.K1,
  QUERY_STREAM.K2,
  QUERY_STREAM.K3,
  QUERY_STREAM.K4,
];

export const ISSUE_KIND: Record<IssueKey, K8sKind> = {
  podsNotRunning: "pods",
  podsContainerErrors: "pods",
  podsOomKilled: "pods",
  podsRestarting: "pods",
  podsNearMemoryLimit: "pods",
  nodesNotReady: "nodes",
  nodesPressure: "nodes",
  deploymentsUnavailable: "deployments",
};

// A tile is hidden, never a false 0, while any query it counts over is unavailable.
export const ISSUE_INPUTS: Record<IssueKey, readonly QueryId[]> = {
  podsNotRunning: ["P1"],
  podsContainerErrors: ["P1", "P2"],
  podsOomKilled: ["P1", "P3", "P7"],
  podsRestarting: ["P1", "P7"],
  podsNearMemoryLimit: ["P1", "P9", "P10", "K2"],
  nodesNotReady: ["N1"],
  nodesPressure: ["N1"],
  deploymentsUnavailable: ["D1", "D2"],
};

export const rangeSeconds = (startUs: number, endUs: number) =>
  Math.max(1, Math.round((endUs - startUs) / 1_000_000));

export const queryText = (id: QueryId, seconds: number) =>
  id === "P7"
    ? `sum by (${POD}, container) (increase(kube_pod_container_status_restarts_total[${seconds}s]))`
    : QUERIES[id];

const escapeLabel = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const podTrendQuery = (metric: string, target: TrendTarget) => {
  const matchers: string[] = [];
  if (target.clusterLabel && target.cluster) {
    matchers.push(`${target.clusterLabel}="${escapeLabel(target.cluster)}"`);
  }
  matchers.push(`k8s_namespace_name="${escapeLabel(target.namespace)}"`);
  matchers.push(`k8s_pod_name="${escapeLabel(target.pod)}"`);
  if (target.uid) matchers.push(`k8s_pod_uid="${escapeLabel(target.uid)}"`);
  return `sum(${metric}{${matchers.join(",")}})`;
};
