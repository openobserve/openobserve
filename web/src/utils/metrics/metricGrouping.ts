// Copyright 2026 OpenObserve Inc.
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

import type { Component } from "vue";
import type { StreamInfo } from "@/services/service_streams";

/**
 * Metric Group Classification Utility
 *
 * Generic functions to classify and group metric streams by category.
 * Classification patterns are stored in an internal registry (METRIC_GROUP_PATTERNS).
 * Groups are configured via MetricGroupDefinition objects that carry only display
 * metadata (id, label, icon) — no patterns. To add a new group, add its entry to
 * METRIC_GROUP_PATTERNS and reference it by id in MetricGroupDefinition arrays.
 *
 * Designed to be reusable across multiple pages
 * (logs correlation tab, traces correlation tab, metrics explorer, etc.)
 */

export type MetricGroupId = string;

export interface DefaultMetricConfig {
  streamName: string;
  filters?: Record<string, string>;
}

export interface MetricGroupDefinition {
  id: string;
  label: string;
  icon: string | {};
  defaultMetrics?: DefaultMetricConfig[];
}

export interface MetricGroupConfig {
  id: string;
  label: string;
  icon: string | Component;
  streams: StreamInfo[];
}

export interface GroupedMetricStreams {
  byGroup: Record<string, StreamInfo[]>;
  /**
   * Ordered list of all groups (in definition order).
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

/**
 * Patterns for Pod metric classification.
 * Covers Kubernetes pod-level metrics from Prometheus and OTel conventions.
 */
const POD_PATTERNS: RegExp[] = [/^kube_pod/, /^k8s_pod/, /\bpod\b/];

/**
 * Patterns for Node metric classification.
 * Covers Kubernetes node-level and host/machine metrics.
 */
const NODE_PATTERNS: RegExp[] = [
  /^kube_node/,
  /^k8s_node/,
  /^node_/,
  /^host_/,
  /^machine_/,
];

/**
 * Central registry mapping group ids to their classification patterns.
 * Groups with no entry (or an empty array) here are treated as catch-all buckets.
 *
 * To add a new group (e.g., "database"):
 *   1. Add its patterns here:  database: [/^pg_/, /^mysql_/, /^redis_/]
 *   2. Reference the id in a MetricGroupDefinition array passed as a prop.
 *   No other changes are needed.
 */
const METRIC_GROUP_PATTERNS: Record<string, RegExp[]> = {
  network: NETWORK_PATTERNS,
  infra: INFRA_PATTERNS,
  pods: POD_PATTERNS,
  nodes: NODE_PATTERNS,
};

/**
 * Default group definitions used when no metricGroupDefinitions prop is provided.
 * Ordering matters — classifyMetric checks groups in this order (first match wins).
 */
export const DEFAULT_METRIC_GROUP_DEFINITIONS: MetricGroupDefinition[] = [
  { id: "network", label: "Network", icon: "wifi" },
  { id: "infra", label: "Infra", icon: "dns" },
  { id: "others", label: "Others", icon: "category" },
];

/**
 * Group definitions for Kubernetes-instrumented deployments using OTel semantic
 * naming conventions (kubeletstats / cluster receiver).
 *
 * Splits pod and node metrics into dedicated tabs and pre-selects the most
 * operationally relevant streams by default. Falls back to slice(0,6) for
 * deployments that use Prometheus-style naming (no OTel k8s_* metrics present).
 */
export const K8S_METRIC_GROUP_DEFINITIONS: MetricGroupDefinition[] = [
  {
    id: "pods",
    label: "Pods",
    icon: "view-in-ar",
    defaultMetrics: [
      { streamName: "k8s_pod_cpu_usage" },
      { streamName: "k8s_pod_memory_usage" },
      { streamName: "k8s_pod_cpu_request_utilization" },
      { streamName: "k8s_pod_memory_request_utilization" },
      { streamName: "k8s_pod_cpu_limit_utilization" },
      { streamName: "k8s_pod_memory_limit_utilization" },
      { streamName: "k8s_pod_network_io" },
    ],
  },
  {
    id: "nodes",
    label: "Nodes",
    icon: "computer",
    defaultMetrics: [
      { streamName: "k8s_node_cpu_usage" },
      { streamName: "k8s_node_memory_rss" },
      { streamName: "k8s_node_network_io" },
    ],
  },
  { id: "network", label: "Network", icon: "wifi" },
  { id: "others", label: "Others", icon: "category" },
];

/**
 * Return the ordered list of streams that match the defaultMetrics declared on
 * each group definition. Only streams present in `availableStreams` are included.
 *
 * Matching rules:
 * - stream_name must equal DefaultMetricConfig.streamName
 * - every key/value in DefaultMetricConfig.filters must match the stream's filters
 *
 * Returns an empty array when no group has defaultMetrics configured, allowing
 * the caller to apply a fallback (e.g. slice(0, 6)).
 */
export function getDefaultMetricSelections(
  groupDefs: MetricGroupDefinition[],
  availableStreams: StreamInfo[],
): StreamInfo[] {
  const results: StreamInfo[] = [];
  for (const group of groupDefs) {
    if (!group.defaultMetrics?.length) continue;
    for (const def of group.defaultMetrics) {
      const match = availableStreams.find(
        (s) =>
          s.stream_name === def.streamName &&
          (!def.filters ||
            Object.entries(def.filters).every(
              ([k, v]) => s.filters?.[k] === v,
            )),
      );
      if (match) results.push(match);
    }
  }
  return results;
}

/**
 * Classify a single metric stream name into a group.
 *
 * Classification order: groups are checked in the order of `groupDefs`.
 * The first group whose registered patterns match the metric name wins.
 * Groups with no patterns in METRIC_GROUP_PATTERNS act as catch-all buckets.
 *
 * @param metricName - The metric stream name (case-insensitive matching)
 * @param groupDefs  - Ordered group definitions (controls priority)
 * @returns The id of the matched group
 */
export function classifyMetric(
  metricName: string,
  groupDefs: MetricGroupDefinition[],
): string {
  const nameLower = metricName.toLowerCase();

  for (const group of groupDefs) {
    const patterns = METRIC_GROUP_PATTERNS[group.id];
    if (!patterns?.length) continue; // no patterns = catch-all, skip in priority pass
    for (const pattern of patterns) {
      if (pattern.test(nameLower)) return group.id;
    }
  }

  // Fall back to first group with no registered patterns (catch-all)
  return (
    groupDefs.find((g) => !METRIC_GROUP_PATTERNS[g.id]?.length)?.id ??
    groupDefs[groupDefs.length - 1]?.id ??
    "others"
  );
}

/**
 * Group an array of metric streams into categories defined by `groupDefs`.
 *
 * @param streams   - Array of StreamInfo objects to group
 * @param groupDefs - Ordered group definitions (controls priority and display)
 * @returns Grouped metrics with a `byGroup` record and an ordered `groups` list
 *          ready for UI rendering.
 *
 * @example
 * const grouped = groupMetricsByCategory(streams);
 * // grouped.byGroup['infra']   → [container_cpu_usage_seconds_total, ...]
 * // grouped.byGroup['network'] → [node_network_transmit_bytes_total, ...]
 * // grouped.byGroup['others']  → [http_server_request_duration_seconds, ...]
 * //
 * // grouped.groups → [{id:'network',...}, {id:'infra',...}, {id:'others',...}]
 */
export function groupMetricsByCategory(
  streams: StreamInfo[],
  groupDefs: MetricGroupDefinition[] = DEFAULT_METRIC_GROUP_DEFINITIONS,
): GroupedMetricStreams {
  const buckets: Record<string, StreamInfo[]> = {};
  for (const g of groupDefs) buckets[g.id] = [];

  for (const stream of streams) {
    const gId = classifyMetric(stream.stream_name, groupDefs);
    (buckets[gId] ??= []).push(stream);
  }

  const groups: MetricGroupConfig[] = groupDefs.map((def) => ({
    id: def.id,
    label: def.label,
    icon: def.icon,
    streams: buckets[def.id] ?? [],
  }));

  return { byGroup: buckets, groups };
}
