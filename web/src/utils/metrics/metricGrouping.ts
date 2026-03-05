// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { StreamInfo } from "@/services/service_streams";

/**
 * Metric Group Classification Utility
 *
 * Generic functions to classify and group metric streams by category:
 * - Infra:   Container, pod, node, and other infrastructure resource metrics
 * - Network: Network traffic, latency, packet, and networking metrics
 * - Others:  Metrics that do not belong to Infra or Network groups
 *
 * Designed to be reusable across multiple pages
 * (logs correlation tab, traces correlation tab, metrics explorer, etc.)
 */

export type MetricGroupId = "infra" | "network" | "others";

export interface MetricGroupConfig {
  id: MetricGroupId;
  label: string;
  icon: string;
  streams: StreamInfo[];
}

export interface GroupedMetricStreams {
  infra: StreamInfo[];
  network: StreamInfo[];
  others: StreamInfo[];
  /**
   * Ordered list of all groups (Infra → Network → Others).
   * Empty groups are still included so consumers can decide whether to show them.
   */
  groups: MetricGroupConfig[];
}

/**
 * Patterns for Network metric classification.
 * Network is evaluated first and takes priority over Infra.
 *
 * Covers:
 * - Network traffic: bytes received/transmitted, packets
 * - Network latency: RTT, end-to-end latency
 * - Protocol-level: TCP, UDP, DNS
 * - Socket and connection metrics
 * - Bandwidth and throughput
 */
const NETWORK_PATTERNS: RegExp[] = [
  // Keyword "network" (catches container_network_*, node_network_*, etc.)
  /network/,
  // Packet metrics
  /packet/,
  // Protocol prefixes
  /^tcp_/,
  /^udp_/,
  /^dns_/,
  /^net_/,
  // Network-specific byte flows (receive / transmit are network-specific terms)
  /receive_bytes/,
  /transmit_bytes/,
  /bytes_recv(ed)?/,
  /bytes_sent/,
  /bytes_received/,
  /bytes_transmitted/,
  // Socket metrics
  /socket/,
  // Bandwidth / throughput
  /bandwidth/,
  /throughput/,
  // Latency at network level
  /\blatency\b/,
  /\brtt\b/,
  // Inbound / outbound traffic
  /\binbound\b/,
  /\boutbound\b/,
];

/**
 * Patterns for Infrastructure metric classification.
 * Infra is evaluated after Network.
 *
 * Covers:
 * - Container metrics (container_cpu, container_memory, container_fs)
 * - Pod metrics (kube_pod_*, k8s_pod_*)
 * - Node metrics (node_*, kube_node_*, k8s_node_*)
 * - Kubernetes / Kubelet control plane metrics
 * - System resource metrics (system_cpu, system_memory, system_disk)
 * - Process-level metrics
 * - Host / machine metrics
 */
const INFRA_PATTERNS: RegExp[] = [
  // Container metrics
  /^container_/,
  /^k8s_container/,
  // Pod metrics
  /^kube_pod/,
  /^k8s_pod/,
  // Node metrics
  /^kube_node/,
  /^k8s_node/,
  /^node_/,
  // Kubernetes control plane / kubelet
  /^kubelet_/,
  /^kube_/,
  /^k8s_/,
  /^kubernetes_/,
  // System resource metrics (OTel dot-style and Prometheus underscore-style)
  /^system\./,
  /^system_/,
  // Process-level metrics
  /^process_/,
  // Host and machine-level metrics
  /^host_/,
  /^machine_/,
  // Generic keywords: metrics that mention pods or containers in their name
  /\bpod\b/,
  /\bcontainer\b/,
  // Storage
  /^storage_/,
  /^filesystem_/,
  /^disk_/,
];

/** Metadata config for each group (icon used in UI). */
const GROUP_META: Record<MetricGroupId, { label: string; icon: string }> = {
  infra: { label: "Infra", icon: "dns" },
  network: { label: "Network", icon: "wifi" },
  others: { label: "Others", icon: "category" },
};

/**
 * Classify a single metric stream name into a group.
 *
 * Classification order (higher priority first):
 * 1. Network — matches any NETWORK_PATTERNS
 * 2. Infra   — matches any INFRA_PATTERNS
 * 3. Others  — everything else
 *
 * @param metricName - The metric stream name (case-insensitive matching)
 * @returns The group ID: "infra" | "network" | "others"
 */
export function classifyMetric(metricName: string): MetricGroupId {
  const nameLower = metricName.toLowerCase();

  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(nameLower)) return "network";
  }

  for (const pattern of INFRA_PATTERNS) {
    if (pattern.test(nameLower)) return "infra";
  }

  return "others";
}

/**
 * Group an array of metric streams into Infra, Network, and Others categories.
 *
 * @param streams - Array of StreamInfo objects to group
 * @returns Grouped metrics with `infra`, `network`, `others` arrays
 *          and an ordered `groups` list ready for UI rendering.
 *
 * @example
 * const grouped = groupMetricsByCategory(streams);
 * // grouped.infra   → [container_cpu_usage_seconds_total, kube_pod_status_ready, ...]
 * // grouped.network → [node_network_transmit_bytes_total, container_network_receive_bytes_total, ...]
 * // grouped.others  → [http_server_request_duration_seconds, ...]
 * //
 * // grouped.groups  → [{id:'infra',...}, {id:'network',...}, {id:'others',...}]
 */
export function groupMetricsByCategory(streams: StreamInfo[]): GroupedMetricStreams {
  const infra: StreamInfo[] = [];
  const network: StreamInfo[] = [];
  const others: StreamInfo[] = [];

  for (const stream of streams) {
    const groupId = classifyMetric(stream.stream_name);
    if (groupId === "infra") infra.push(stream);
    else if (groupId === "network") network.push(stream);
    else others.push(stream);
  }

  const groups: MetricGroupConfig[] = (
    ["infra", "network", "others"] as MetricGroupId[]
  ).map((id) => ({
    id,
    label: GROUP_META[id].label,
    icon: GROUP_META[id].icon,
    streams: id === "infra" ? infra : id === "network" ? network : others,
  }));

  return { infra, network, others, groups };
}
