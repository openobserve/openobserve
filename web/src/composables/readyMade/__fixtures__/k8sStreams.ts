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

// Every kube_* / k8s_* metric stream and its labels, as measured on a kind cluster running the OpenObserve collector chart (contrib 0.158, kube-state-metrics 2.15).

const COMMON = [
  "__hash__",
  "__name__",
  "_timestamp",
  "flag",
  "instrumentation_library_name",
  "instrumentation_library_version",
  "start_time",
  "value",
];

/** Scrape-target labels kube-state carries on every family. */
const SCRAPE = [
  "server_address",
  "server_port",
  "service_instance_id",
  "service_name",
  "url_scheme",
];

const LABELS: Record<string, string> = {
  k8s_node_cpu_time: "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_cpu_usage: "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_filesystem_available:
    "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_filesystem_capacity:
    "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_filesystem_usage:
    "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_memory_available:
    "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_memory_major_page_faults:
    "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_memory_page_faults:
    "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_memory_rss: "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_memory_usage: "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_memory_working_set:
    "host_name k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_network_errors:
    "direction host_name interface k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_node_network_io:
    "direction host_name interface k8s_cluster k8s_cluster_uid k8s_node_name k8s_node_uid os_type",
  k8s_pod_cpu_limit_utilization:
    "host_name k8s_app_component k8s_app_instance k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_cpu_request_utilization:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_cpu_time:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_cpu_usage:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_filesystem_available:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_filesystem_capacity:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_filesystem_usage:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_memory_available:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_memory_limit_utilization:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_memory_major_page_faults:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_memory_page_faults:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_memory_request_utilization:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_memory_rss:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_memory_usage:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_memory_working_set:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_network_errors:
    "direction host_name interface k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_pod_network_io:
    "direction host_name interface k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid os_type service_version",
  k8s_volume_available:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid k8s_volume_name k8s_volume_type os_type service_version",
  k8s_volume_capacity:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid k8s_volume_name k8s_volume_type os_type service_version",
  k8s_volume_inodes:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid k8s_volume_name k8s_volume_type os_type service_version",
  k8s_volume_inodes_free:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid k8s_volume_name k8s_volume_type os_type service_version",
  k8s_volume_inodes_used:
    "host_name k8s_app_component k8s_app_instance k8s_app_name k8s_cluster k8s_cluster_uid k8s_container_name k8s_deployment_name k8s_namespace_name k8s_node_name k8s_node_uid k8s_pod_ip k8s_pod_name k8s_pod_start_time k8s_pod_uid k8s_volume_name k8s_volume_type os_type service_version",
  kube_daemonset_created: "daemonset k8s_cluster namespace",
  kube_daemonset_status_current_number_scheduled: "daemonset k8s_cluster namespace",
  kube_daemonset_status_desired_number_scheduled: "daemonset k8s_cluster namespace",
  kube_daemonset_status_number_available: "daemonset k8s_cluster namespace",
  kube_daemonset_status_number_misscheduled: "daemonset k8s_cluster namespace",
  kube_daemonset_status_number_ready: "daemonset k8s_cluster namespace",
  kube_daemonset_status_number_unavailable: "daemonset k8s_cluster namespace",
  kube_daemonset_status_observed_generation: "daemonset k8s_cluster namespace",
  kube_daemonset_status_updated_number_scheduled: "daemonset k8s_cluster namespace",
  kube_deployment_created: "deployment k8s_cluster namespace",
  kube_deployment_spec_replicas: "deployment k8s_cluster namespace",
  kube_deployment_status_replicas: "deployment k8s_cluster namespace",
  kube_deployment_status_replicas_available: "deployment k8s_cluster namespace",
  kube_deployment_status_replicas_ready: "deployment k8s_cluster namespace",
  kube_deployment_status_replicas_unavailable: "deployment k8s_cluster namespace",
  kube_deployment_status_replicas_updated: "deployment k8s_cluster namespace",
  kube_endpoint_address:
    "endpoint ip k8s_cluster namespace port_name port_number port_protocol ready",
  kube_job_created: "job_name k8s_cluster namespace",
  kube_job_failed: "condition job_name k8s_cluster namespace",
  kube_job_info: "job_name k8s_cluster namespace",
  kube_job_owner: "job_name k8s_cluster namespace",
  kube_job_spec_completions: "job_name k8s_cluster namespace",
  kube_job_spec_parallelism: "job_name k8s_cluster namespace",
  kube_job_status_active: "job_name k8s_cluster namespace",
  kube_job_status_failed: "job_name k8s_cluster namespace reason",
  kube_job_status_start_time: "job_name k8s_cluster namespace",
  kube_job_status_succeeded: "job_name k8s_cluster namespace",
  kube_namespace_created: "k8s_cluster namespace",
  kube_namespace_status_phase: "k8s_cluster namespace phase",
  kube_node_created: "k8s_cluster node",
  kube_node_info:
    "container_runtime_version internal_ip k8s_cluster kernel_version kubelet_version kubeproxy_version node os_image pod_cidr provider_id system_uuid",
  kube_node_status_allocatable: "k8s_cluster node resource unit",
  kube_node_status_condition: "condition k8s_cluster node status",
  kube_pod_container_info:
    "container container_id image image_id image_spec k8s_cluster namespace pod uid",
  kube_pod_container_resource_limits: "container k8s_cluster namespace node pod resource uid unit",
  kube_pod_container_resource_requests:
    "container k8s_cluster namespace node pod resource uid unit",
  kube_pod_container_status_ready: "container k8s_cluster namespace pod uid",
  kube_pod_container_status_restarts_total: "container k8s_cluster namespace pod uid",
  kube_pod_container_status_terminated_reason: "container k8s_cluster namespace pod reason uid",
  kube_pod_container_status_waiting: "container k8s_cluster namespace pod uid",
  kube_pod_container_status_waiting_reason: "container k8s_cluster namespace pod reason uid",
  kube_pod_created: "k8s_cluster namespace pod uid",
  kube_pod_info:
    "created_by_kind created_by_name host_ip host_network k8s_cluster namespace node pod pod_ip priority_class uid",
  kube_pod_owner: "k8s_cluster namespace owner_is_controller owner_kind owner_name pod uid",
  kube_pod_status_phase: "k8s_cluster namespace phase pod uid",
  kube_pod_status_ready: "condition k8s_cluster namespace pod uid",
  kube_pod_status_reason: "k8s_cluster namespace pod reason uid",
  kube_replicaset_annotations:
    "annotation_deployment_kubernetes_io_revision k8s_cluster namespace replicaset",
  kube_replicaset_created: "k8s_cluster namespace replicaset",
  kube_replicaset_owner:
    "k8s_cluster namespace owner_is_controller owner_kind owner_name replicaset",
  kube_replicaset_spec_replicas: "k8s_cluster namespace replicaset",
  kube_replicaset_status_fully_labeled_replicas: "k8s_cluster namespace replicaset",
  kube_replicaset_status_observed_generation: "k8s_cluster namespace replicaset",
  kube_replicaset_status_ready_replicas: "k8s_cluster namespace replicaset",
  kube_replicaset_status_replicas: "k8s_cluster namespace replicaset",
  kube_service_created: "k8s_cluster namespace service uid",
  kube_service_info: "cluster_ip k8s_cluster namespace service uid",
  kube_service_spec_type: "k8s_cluster namespace service type uid",
  kube_statefulset_created: "k8s_cluster namespace statefulset",
  kube_statefulset_replicas: "k8s_cluster namespace statefulset",
  kube_statefulset_status_current_revision: "k8s_cluster namespace revision statefulset",
  kube_statefulset_status_observed_generation: "k8s_cluster namespace statefulset",
  kube_statefulset_status_replicas: "k8s_cluster namespace statefulset",
  kube_statefulset_status_replicas_available: "k8s_cluster namespace statefulset",
  kube_statefulset_status_replicas_current: "k8s_cluster namespace statefulset",
  kube_statefulset_status_replicas_ready: "k8s_cluster namespace statefulset",
  kube_statefulset_status_replicas_updated: "k8s_cluster namespace statefulset",
  kube_statefulset_status_update_revision: "k8s_cluster namespace revision statefulset",
};

export const READYMADE_K8S_STREAMS: readonly string[] = Object.keys(LABELS);

/** Streams this collector never sends get the labels of their family. */
const labelsOf = (name: string): string[] => {
  const own = LABELS[name];
  if (own !== undefined) return own.split(" ").filter(Boolean);
  if (name.startsWith("k8s_node_")) return LABELS.k8s_node_cpu_usage.split(" ");
  if (name.startsWith("k8s_pod_")) return LABELS.k8s_pod_cpu_usage.split(" ");
  return ["k8s_cluster", "namespace"];
};

const HOUR_US = 60 * 60 * 1_000_000;

/** The stream list as the API returns it with fetchSchema=false: names and stats, no schema. */
export const k8sStreamList = (names: readonly string[] = READYMADE_K8S_STREAMS) => {
  const nowUs = Date.now() * 1000;
  return names.map((name) => ({
    name,
    stream_type: "metrics",
    stats: {
      created_at: nowUs - 2 * HOUR_US,
      doc_time_min: nowUs - 2 * HOUR_US,
      doc_time_max: nowUs - 60_000_000,
      doc_num: 100,
      file_num: 1,
      storage_size: 1,
      compressed_size: 1,
      index_size: 0,
    },
    schema: [] as { name: string; type: string }[],
  }));
};

/** One stream's schema read, as /streams/{name}/schema returns it. */
export const k8sSchemaEntry = (name: string) => {
  const own = labelsOf(name);
  const scrape = name.startsWith("kube_") ? SCRAPE : [];
  return {
    name,
    stream_type: "metrics",
    schema: [...new Set([...COMMON, ...scrape, ...own])].map((field) => ({
      name: field,
      type: "Utf8",
    })),
  };
};
