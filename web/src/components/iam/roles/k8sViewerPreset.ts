// Copyright 2026 OpenObserve Inc.
//
// The "Kubernetes viewer" role preset: the metric streams the curated
// Infrastructure pages query, and the per-stream permission objects a role
// needs to render them. Pure data plus a pure builder — the UI owns the save.

import type { RolePermission } from "./readonlyPreset";

export const K8S_VIEWER_PERMS = ["AllowList", "AllowGet"];

// The union of every `requiresStreams` in the curated packs, kept BY HAND —
// k8sViewerPreset.spec.ts fails when a pack adds or drops one.
export const K8S_VIEWER_STREAMS: string[] = [
  "k8s_node_cpu_usage",
  "k8s_node_cpu_utilization",
  "k8s_node_memory_rss",
  "k8s_node_memory_usage",
  "k8s_node_network_io",
  "k8s_pod_cpu_request_utilization",
  "k8s_pod_cpu_usage",
  "k8s_pod_cpu_utilization",
  "k8s_pod_filesystem_capacity",
  "k8s_pod_filesystem_usage",
  "k8s_pod_memory_limit_utilization",
  "k8s_pod_memory_request_utilization",
  "k8s_pod_memory_usage",
  "k8s_pod_network_io",
  "kube_daemonset_status_number_unavailable",
  "kube_deployment_spec_replicas",
  "kube_deployment_status_replicas_ready",
  "kube_horizontalpodautoscaler_status_condition",
  "kube_job_status_failed",
  "kube_node_status_allocatable",
  "kube_node_status_condition",
  "kube_persistentvolumeclaim_status_phase",
  "kube_pod_container_resource_requests",
  "kube_pod_container_status_restarts_total",
  "kube_pod_container_status_terminated_reason",
  "kube_pod_container_status_waiting_reason",
  "kube_pod_status_phase",
  "kube_statefulset_replicas",
  "kube_statefulset_status_replicas_ready",
  "system_cpu_load_average_15m",
  "system_cpu_load_average_1m",
  "system_cpu_load_average_5m",
  "system_cpu_time",
  "system_disk_io",
  "system_filesystem_usage",
  "system_memory_usage",
  "system_network_io",
];

// Same permission-object format EditRole saves for an INDIVIDUAL stream: the
// resource name is the stream TYPE and the entity is the bare stream name. Names
// are passed through verbatim — the frontend has no counterpart to the backend's
// into_ofga_supported_format, so every name here must already be OFGA-safe.
export const buildK8sViewerPermissions = (
  streams: string[] = K8S_VIEWER_STREAMS,
): RolePermission[] =>
  streams.flatMap((name) =>
    K8S_VIEWER_PERMS.map((permission) => ({ object: `metrics:${name}`, permission })),
  );
