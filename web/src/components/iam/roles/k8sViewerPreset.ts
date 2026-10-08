// Copyright 2026 OpenObserve Inc.

export const K8S_VIEWER_STREAM_ROW_PERMS = ["AllowGet"] as const;

// ALLOW_GET on `metrics:_all_<org>` reads as a wildcard over every metric stream in the org, so the type node gets LIST only.
export const K8S_VIEWER_TYPE_NODE_PERMS = ["AllowList"] as const;

// Kept BY HAND — k8sViewerPreset.spec.ts fails when a curated pack adds or drops a stream.
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
