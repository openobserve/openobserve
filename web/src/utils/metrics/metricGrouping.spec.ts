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

import { describe, it, expect } from "vitest";
import {
  classifyMetric,
  groupMetricsByCategory,
  getDefaultMetricSelections,
  DEFAULT_METRIC_GROUP_DEFINITIONS,
  K8S_METRIC_GROUP_DEFINITIONS,
  type MetricGroupDefinition,
} from "./metricGrouping";
import type { StreamInfo } from "@/services/service_streams";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal StreamInfo factory — only stream_name is exercised by this module. */
function makeStream(stream_name: string): StreamInfo {
  return { stream_name, stream_type: "metrics", filters: {} };
}

// ---------------------------------------------------------------------------
// DEFAULT_METRIC_GROUP_DEFINITIONS
// ---------------------------------------------------------------------------

describe("DEFAULT_METRIC_GROUP_DEFINITIONS", () => {
  it("should contain exactly 5 entries in order: compute, memory, network, storage, others", () => {
    expect(DEFAULT_METRIC_GROUP_DEFINITIONS).toHaveLength(5);
    expect(DEFAULT_METRIC_GROUP_DEFINITIONS.map((d) => d.id)).toEqual([
      "compute",
      "memory",
      "network",
      "storage",
      "others",
    ]);
  });

  it("should have label and icon for every entry", () => {
    for (const def of DEFAULT_METRIC_GROUP_DEFINITIONS) {
      expect(def.label).toBeTruthy();
      expect(def.icon).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// classifyMetric — network patterns
// ---------------------------------------------------------------------------

describe("classifyMetric — network group", () => {
  const defs = DEFAULT_METRIC_GROUP_DEFINITIONS;

  it("should classify a metric containing 'network' as network", () => {
    expect(classifyMetric("node_network_receive_bytes_total", defs)).toBe(
      "network",
    );
  });

  it("should classify a metric containing 'packet' as network", () => {
    expect(classifyMetric("node_network_transmit_packets_total", defs)).toBe(
      "network",
    );
  });

  it("should classify a metric prefixed with tcp_ as network", () => {
    expect(classifyMetric("tcp_retransmits_total", defs)).toBe("network");
  });

  it("should classify a metric prefixed with udp_ as network", () => {
    expect(classifyMetric("udp_datagrams_received", defs)).toBe("network");
  });

  it("should classify a metric prefixed with dns_ as network", () => {
    expect(classifyMetric("dns_query_duration_seconds", defs)).toBe("network");
  });

  it("should classify a metric prefixed with net_ as network", () => {
    expect(classifyMetric("net_conntrack_entries", defs)).toBe("network");
  });

  it("should classify a metric containing 'receive_bytes' as network", () => {
    expect(classifyMetric("interface_receive_bytes", defs)).toBe("network");
  });

  it("should classify a metric containing 'transmit_bytes' as network", () => {
    expect(classifyMetric("interface_transmit_bytes", defs)).toBe("network");
  });

  it("should classify a metric containing 'socket' as network", () => {
    expect(classifyMetric("socket_connections_open", defs)).toBe("network");
  });

  it("should classify a metric containing 'bandwidth' as network", () => {
    expect(classifyMetric("link_bandwidth_mbps", defs)).toBe("network");
  });

  it("should classify a metric containing 'throughput' as network", () => {
    expect(classifyMetric("disk_throughput_bytes", defs)).toBe("network");
  });

  it("should classify a metric containing 'latency' as a whole word (dot-separated) as network", () => {
    // \blatency\b matches when surrounded by non-word chars; underscore is a word char
    expect(classifyMetric("grpc.latency.seconds", defs)).toBe("network");
  });

  it("should classify a metric containing 'rtt' as a whole word as network", () => {
    expect(classifyMetric("tcp_rtt_ms", defs)).toBe("network");
  });

  it("should classify a metric containing 'inbound' as a whole word (dot-separated) as network", () => {
    // \binbound\b matches when surrounded by non-word chars
    expect(classifyMetric("traffic.inbound.bytes", defs)).toBe("network");
  });

  it("should classify a metric containing 'outbound' as a whole word (dot-separated) as network", () => {
    // \boutbound\b matches when surrounded by non-word chars
    expect(classifyMetric("traffic.outbound.bytes", defs)).toBe("network");
  });

  it("should match network patterns case-insensitively", () => {
    expect(classifyMetric("TCP_RETRANSMITS_TOTAL", defs)).toBe("network");
    expect(classifyMetric("Node_Network_Receive_Bytes_Total", defs)).toBe(
      "network",
    );
  });
});

// ---------------------------------------------------------------------------
// classifyMetric — network takes priority over infra
// ---------------------------------------------------------------------------

describe("classifyMetric — network priority over infra", () => {
  const defs: MetricGroupDefinition[] = [
    { id: "network", label: "Network", icon: "wifi" },
    { id: "infra", label: "Infra", icon: "dns" },
    { id: "others", label: "Others", icon: "category" },
  ];

  it("should classify container_network_receive_bytes_total as network, not infra", () => {
    // matches both INFRA (container_ prefix) and NETWORK (network keyword, receive_bytes)
    // network group is listed first in DEFAULT_METRIC_GROUP_DEFINITIONS → wins
    expect(
      classifyMetric("container_network_receive_bytes_total", defs),
    ).toBe("network");
  });

  it("should classify container_network_transmit_bytes_total as network, not infra", () => {
    expect(
      classifyMetric("container_network_transmit_bytes_total", defs),
    ).toBe("network");
  });

  it("should classify node_network_transmit_packets_total as network, not infra", () => {
    // node_ prefix matches infra; 'network' keyword matches network — network wins
    expect(classifyMetric("node_network_transmit_packets_total", defs)).toBe(
      "network",
    );
  });
});

// ---------------------------------------------------------------------------
// classifyMetric — infra patterns (tested via explicit defs that include infra)
// ---------------------------------------------------------------------------

describe("classifyMetric — infra group", () => {
  const defs: MetricGroupDefinition[] = [
    { id: "network", label: "Network", icon: "wifi" },
    { id: "infra", label: "Infra", icon: "dns" },
    { id: "others", label: "Others", icon: "category" },
  ];

  it("should classify container_ prefix metrics as infra", () => {
    expect(classifyMetric("container_cpu_usage_seconds_total", defs)).toBe(
      "infra",
    );
  });

  it("should classify k8s_container prefix metrics as infra", () => {
    expect(classifyMetric("k8s_container_cpu_limit_cores", defs)).toBe("infra");
  });

  it("should classify kube_pod prefix metrics as infra", () => {
    expect(classifyMetric("kube_pod_status_ready", defs)).toBe("infra");
  });

  it("should classify k8s_pod prefix metrics as infra", () => {
    expect(classifyMetric("k8s_pod_memory_usage_bytes", defs)).toBe("infra");
  });

  it("should classify kube_node prefix metrics as infra", () => {
    expect(classifyMetric("kube_node_status_condition", defs)).toBe("infra");
  });

  it("should classify k8s_node prefix metrics as infra", () => {
    expect(classifyMetric("k8s_node_allocatable_cpu_cores", defs)).toBe(
      "infra",
    );
  });

  it("should classify node_ prefix metrics as infra when no network keyword present", () => {
    expect(classifyMetric("node_cpu_seconds_total", defs)).toBe("infra");
  });

  it("should classify kubelet_ prefix metrics as infra", () => {
    expect(classifyMetric("kubelet_running_pods", defs)).toBe("infra");
  });

  it("should classify kube_ prefix metrics as infra", () => {
    expect(classifyMetric("kube_deployment_replicas", defs)).toBe("infra");
  });

  it("should classify k8s_ prefix metrics as infra", () => {
    expect(classifyMetric("k8s_cluster_cpu_usage", defs)).toBe("infra");
  });

  it("should classify kubernetes_ prefix metrics as infra", () => {
    expect(classifyMetric("kubernetes_build_info", defs)).toBe("infra");
  });

  it("should classify system. dot-style prefix metrics as infra", () => {
    expect(classifyMetric("system.cpu.utilization", defs)).toBe("infra");
  });

  it("should classify system_ underscore-style prefix metrics as infra", () => {
    expect(classifyMetric("system_memory_usage_bytes", defs)).toBe("infra");
  });

  it("should classify process_ prefix metrics as infra", () => {
    expect(classifyMetric("process_resident_memory_bytes", defs)).toBe("infra");
  });

  it("should classify host_ prefix metrics as infra", () => {
    expect(classifyMetric("host_disk_read_bytes_total", defs)).toBe("infra");
  });

  it("should classify machine_ prefix metrics as infra", () => {
    expect(classifyMetric("machine_memory_bytes", defs)).toBe("infra");
  });

  it("should classify metrics containing 'pod' keyword at a word boundary as infra", () => {
    // \bpod\b does not match underscore-delimited names; dot-separated works
    expect(classifyMetric("my.custom.pod.restarts", defs)).toBe("infra");
  });

  it("should classify metrics containing 'container' keyword at a word boundary as infra", () => {
    // \bcontainer\b does not match underscore-delimited names; dot-separated works
    expect(classifyMetric("my.custom.container.cpu", defs)).toBe("infra");
  });

  it("should classify storage_ prefix metrics as infra", () => {
    expect(classifyMetric("storage_capacity_bytes", defs)).toBe("infra");
  });

  it("should classify filesystem_ prefix metrics as infra", () => {
    expect(classifyMetric("filesystem_avail_bytes", defs)).toBe("infra");
  });

  it("should classify disk_ prefix metrics as infra", () => {
    expect(classifyMetric("disk_io_time_seconds_total", defs)).toBe("infra");
  });

  it("should match infra patterns case-insensitively", () => {
    expect(classifyMetric("CONTAINER_CPU_USAGE_SECONDS_TOTAL", defs)).toBe(
      "infra",
    );
  });
});

// ---------------------------------------------------------------------------
// classifyMetric — catch-all / others fallback
// ---------------------------------------------------------------------------

describe("classifyMetric — catch-all fallback with DEFAULT_METRIC_GROUP_DEFINITIONS", () => {
  const defs = DEFAULT_METRIC_GROUP_DEFINITIONS; // compute, memory, storage, network, others

  it("should classify http_server_request_duration_seconds as network (http keyword)", () => {
    expect(classifyMetric("http_server_request_duration_seconds", defs)).toBe(
      "network",
    );
  });

  it("should classify an entirely unknown metric name as others", () => {
    expect(classifyMetric("my_custom_business_metric_total", defs)).toBe(
      "others",
    );
  });

  it("should classify an empty string as others", () => {
    expect(classifyMetric("", defs)).toBe("others");
  });

  it("should classify go_goroutines as compute (goroutine keyword)", () => {
    expect(classifyMetric("go_goroutines", defs)).toBe("compute");
  });

  it("should classify promhttp_metric_handler_requests_total as others", () => {
    expect(classifyMetric("promhttp_metric_handler_requests_total", defs)).toBe(
      "others",
    );
  });
});

// ---------------------------------------------------------------------------
// classifyMetric — pods group (custom groupDefs)
// ---------------------------------------------------------------------------

describe("classifyMetric — pods group with custom groupDefs", () => {
  const defsWithPods: MetricGroupDefinition[] = [
    { id: "pods", label: "Pods", icon: "bubble_chart" },
    { id: "others", label: "Others", icon: "category" },
  ];

  it("should classify kube_pod prefix metrics as pods", () => {
    expect(classifyMetric("kube_pod_status_ready", defsWithPods)).toBe("pods");
  });

  it("should classify k8s_pod prefix metrics as pods", () => {
    expect(classifyMetric("k8s_pod_memory_usage_bytes", defsWithPods)).toBe(
      "pods",
    );
  });

  it("should classify metrics containing 'pod' keyword at a word boundary as pods", () => {
    // \bpod\b matches dot/hyphen-separated names but not underscore-delimited ones
    expect(classifyMetric("my.pod.restart.count", defsWithPods)).toBe("pods");
  });

  it("should fall back to others for non-pod metrics", () => {
    expect(classifyMetric("http_requests_total", defsWithPods)).toBe("others");
  });
});

// ---------------------------------------------------------------------------
// classifyMetric — nodes group (custom groupDefs)
// ---------------------------------------------------------------------------

describe("classifyMetric — nodes group with custom groupDefs", () => {
  const defsWithNodes: MetricGroupDefinition[] = [
    { id: "nodes", label: "Nodes", icon: "storage" },
    { id: "others", label: "Others", icon: "category" },
  ];

  it("should classify kube_node prefix metrics as nodes", () => {
    expect(classifyMetric("kube_node_status_condition", defsWithNodes)).toBe(
      "nodes",
    );
  });

  it("should classify k8s_node prefix metrics as nodes", () => {
    expect(
      classifyMetric("k8s_node_allocatable_cpu_cores", defsWithNodes),
    ).toBe("nodes");
  });

  it("should classify node_ prefix metrics as nodes", () => {
    expect(classifyMetric("node_cpu_seconds_total", defsWithNodes)).toBe(
      "nodes",
    );
  });

  it("should classify host_ prefix metrics as nodes", () => {
    expect(classifyMetric("host_disk_read_bytes_total", defsWithNodes)).toBe(
      "nodes",
    );
  });

  it("should classify machine_ prefix metrics as nodes", () => {
    expect(classifyMetric("machine_memory_bytes", defsWithNodes)).toBe("nodes");
  });

  it("should fall back to others for non-node metrics", () => {
    expect(classifyMetric("http_requests_total", defsWithNodes)).toBe("others");
  });
});

// ---------------------------------------------------------------------------
// classifyMetric — priority ordering with custom groupDefs
// ---------------------------------------------------------------------------

describe("classifyMetric — priority ordering with custom groupDefs", () => {
  it("should use the first matching group when multiple groups could match", () => {
    // pods patterns are a strict subset of infra patterns
    // placing pods before infra means pod metrics → pods
    const defsPodsFirst: MetricGroupDefinition[] = [
      { id: "pods", label: "Pods", icon: "bubble_chart" },
      { id: "infra", label: "Infra", icon: "dns" },
      { id: "others", label: "Others", icon: "category" },
    ];
    expect(classifyMetric("kube_pod_status_ready", defsPodsFirst)).toBe("pods");
  });

  it("should fall through to infra when pods is after infra for the same metric", () => {
    const defsInfraFirst: MetricGroupDefinition[] = [
      { id: "infra", label: "Infra", icon: "dns" },
      { id: "pods", label: "Pods", icon: "bubble_chart" },
      { id: "others", label: "Others", icon: "category" },
    ];
    // kube_pod matches infra (kube_ prefix) before pods check is reached
    expect(classifyMetric("kube_pod_status_ready", defsInfraFirst)).toBe(
      "infra",
    );
  });

  it("should return the id of the last group when groupDefs has no catch-all and no patterns match", () => {
    // all groups have registered patterns, so no catch-all exists
    // fallback: last group id
    const defsNoCatchAll: MetricGroupDefinition[] = [
      { id: "network", label: "Network", icon: "wifi" },
      { id: "infra", label: "Infra", icon: "dns" },
    ];
    // http_server_request_duration_seconds matches network via /\bhttp\b/i now
    expect(
      classifyMetric("http_server_request_duration_seconds", defsNoCatchAll),
    ).toBe("network");
    // purely unknown metric falls through to last group (infra)
    expect(
      classifyMetric("my_custom_business_metric_total", defsNoCatchAll),
    ).toBe("infra");
  });

  it("should return 'others' when groupDefs is empty", () => {
    expect(classifyMetric("some_metric", [])).toBe("others");
  });
});

// ---------------------------------------------------------------------------
// groupMetricsByCategory — structure and ordering
// ---------------------------------------------------------------------------

describe("groupMetricsByCategory — return structure", () => {
  it("should return byGroup with all group ids as keys even when empty", () => {
    const result = groupMetricsByCategory([]);
    expect(Object.keys(result.byGroup).sort()).toEqual(
      ["compute", "memory", "network", "others", "storage"].sort(),
    );
  });

  it("should return groups array in definition order", () => {
    const result = groupMetricsByCategory([]);
    expect(result.groups.map((g) => g.id)).toEqual([
      "compute",
      "memory",
      "network",
      "storage",
      "others",
    ]);
  });

  it("should include id, label, icon, and streams on each group entry", () => {
    const result = groupMetricsByCategory([]);
    for (const group of result.groups) {
      expect(group).toHaveProperty("id");
      expect(group).toHaveProperty("label");
      expect(group).toHaveProperty("icon");
      expect(group).toHaveProperty("streams");
      expect(Array.isArray(group.streams)).toBe(true);
    }
  });

  it("should return empty streams arrays when no streams are provided", () => {
    const result = groupMetricsByCategory([]);
    for (const group of result.groups) {
      expect(group.streams).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// groupMetricsByCategory — classification accuracy
// ---------------------------------------------------------------------------

describe("groupMetricsByCategory — classification", () => {
  it("should place network metrics into the network group", () => {
    const streams = [
      makeStream("node_network_receive_bytes_total"),
      makeStream("tcp_retransmits_total"),
    ];
    const result = groupMetricsByCategory(streams);
    expect(result.byGroup["network"]).toHaveLength(2);
    expect(result.byGroup["compute"]).toHaveLength(0);
    expect(result.byGroup["others"]).toHaveLength(0);
  });

  it("should place cpu metrics into the compute group", () => {
    const streams = [
      makeStream("container_cpu_usage_seconds_total"),
      makeStream("node_cpu_seconds_total"),
    ];
    const result = groupMetricsByCategory(streams);
    expect(result.byGroup["compute"]).toHaveLength(2);
    expect(result.byGroup["network"]).toHaveLength(0);
    expect(result.byGroup["others"]).toHaveLength(0);
  });

  it("should place http metrics into network and go_goroutines into compute", () => {
    const streams = [
      makeStream("http_server_request_duration_seconds"), // http keyword → network
      makeStream("go_goroutines"), // goroutine keyword → compute
    ];
    const result = groupMetricsByCategory(streams);
    expect(result.byGroup["network"]).toHaveLength(1);
    expect(result.byGroup["compute"]).toHaveLength(1);
    expect(result.byGroup["others"]).toHaveLength(0);
  });

  it("should split a mixed list across correct groups", () => {
    const streams = [
      makeStream("container_network_receive_bytes_total"), // network wins
      makeStream("container_cpu_usage_seconds_total"), // compute
      makeStream("http_server_request_duration_seconds"), // network (http keyword)
      makeStream("container_memory_usage_bytes"), // memory
    ];
    const result = groupMetricsByCategory(streams);
    expect(result.byGroup["network"]).toHaveLength(2); // network_receive + http_server
    expect(
      result.byGroup["network"].some(
        (s) => s.stream_name === "container_network_receive_bytes_total",
      ),
    ).toBe(true);
    expect(result.byGroup["compute"]).toHaveLength(1);
    expect(result.byGroup["memory"]).toHaveLength(1);
    expect(result.byGroup["others"]).toHaveLength(0);
  });

  it("should preserve the original StreamInfo objects (same reference)", () => {
    const stream = makeStream("container_cpu_usage_seconds_total");
    const result = groupMetricsByCategory([stream]);
    expect(result.byGroup["compute"][0]).toBe(stream);
  });

  it("should reflect stream counts in the groups array streams field", () => {
    const streams = [
      makeStream("node_network_receive_bytes_total"),
      makeStream("container_cpu_usage_seconds_total"),
    ];
    const result = groupMetricsByCategory(streams);
    const networkGroup = result.groups.find((g) => g.id === "network");
    const computeGroup = result.groups.find((g) => g.id === "compute");
    expect(networkGroup?.streams).toHaveLength(1);
    expect(computeGroup?.streams).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// groupMetricsByCategory — custom groupDefs
// ---------------------------------------------------------------------------

describe("groupMetricsByCategory — custom groupDefs", () => {
  const customDefs: MetricGroupDefinition[] = [
    { id: "pods", label: "Pods", icon: "bubble_chart" },
    { id: "nodes", label: "Nodes", icon: "storage" },
    { id: "custom_bucket", label: "Custom Bucket", icon: "folder" },
  ];

  it("should use the provided groupDefs instead of defaults", () => {
    const streams = [
      makeStream("kube_pod_status_ready"),
      makeStream("node_cpu_seconds_total"),
      makeStream("http_requests_total"),
    ];
    const result = groupMetricsByCategory(streams, customDefs);
    expect(result.byGroup).toHaveProperty("pods");
    expect(result.byGroup).toHaveProperty("nodes");
    expect(result.byGroup).toHaveProperty("custom_bucket");
    expect(result.byGroup).not.toHaveProperty("network");
    expect(result.byGroup).not.toHaveProperty("infra");
  });

  it("should route kube_pod metrics to pods group with custom defs", () => {
    const streams = [makeStream("kube_pod_status_ready")];
    const result = groupMetricsByCategory(streams, customDefs);
    expect(result.byGroup["pods"]).toHaveLength(1);
  });

  it("should route node_ metrics to nodes group with custom defs", () => {
    const streams = [makeStream("node_cpu_seconds_total")];
    const result = groupMetricsByCategory(streams, customDefs);
    expect(result.byGroup["nodes"]).toHaveLength(1);
  });

  it("should route unmatched metrics to the catch-all group with custom defs", () => {
    // custom_bucket has no registered patterns → acts as catch-all
    const streams = [makeStream("http_requests_total")];
    const result = groupMetricsByCategory(streams, customDefs);
    expect(result.byGroup["custom_bucket"]).toHaveLength(1);
  });

  it("should maintain groups array in definition order with custom defs", () => {
    const result = groupMetricsByCategory([], customDefs);
    expect(result.groups.map((g) => g.id)).toEqual([
      "pods",
      "nodes",
      "custom_bucket",
    ]);
  });

  it("should carry correct label and icon from custom defs", () => {
    const result = groupMetricsByCategory([], customDefs);
    const podsGroup = result.groups.find((g) => g.id === "pods");
    expect(podsGroup?.label).toBe("Pods");
    expect(podsGroup?.icon).toBe("bubble_chart");
  });
});

// ---------------------------------------------------------------------------
// K8S_METRIC_GROUP_DEFINITIONS
// ---------------------------------------------------------------------------

describe("K8S_METRIC_GROUP_DEFINITIONS", () => {
  it("should contain exactly 2 outer entries: pods, nodes", () => {
    expect(K8S_METRIC_GROUP_DEFINITIONS).toHaveLength(2);
    expect(K8S_METRIC_GROUP_DEFINITIONS.map((d) => d.id)).toEqual([
      "pods",
      "nodes",
    ]);
  });

  it("should have label and icon for every outer entry", () => {
    for (const def of K8S_METRIC_GROUP_DEFINITIONS) {
      expect(def.label).toBeTruthy();
      expect(def.icon).toBeTruthy();
    }
  });

  it("should have children on pods and nodes (nested sub-tabs)", () => {
    const pods = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "pods");
    const nodes = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "nodes");
    expect(pods?.children?.length).toBeGreaterThan(0);
    expect(nodes?.children?.length).toBeGreaterThan(0);
  });

  it("pods children should include compute, memory, network, others", () => {
    const pods = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "pods");
    const ids = pods!.children!.map((c) => c.id);
    expect(ids).toContain("compute");
    expect(ids).toContain("memory");
    expect(ids).toContain("network");
    expect(ids).toContain("others");
  });

  it("nodes children should include compute, memory, network, others", () => {
    const nodes = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "nodes");
    const ids = nodes!.children!.map((c) => c.id);
    expect(ids).toContain("compute");
    expect(ids).toContain("memory");
    expect(ids).toContain("network");
    expect(ids).toContain("others");
  });

  it("should have pod cpu defaultMetrics in pods>compute child", () => {
    const pods = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "pods");
    const compute = pods!.children!.find((c) => c.id === "compute");
    const names = compute!.defaultMetrics!.map((m) => m.streamName);
    expect(names).toContain("k8s_pod_cpu_usage");
    expect(names).toContain("k8s_pod_cpu_request_utilization");
    expect(names).toContain("k8s_pod_cpu_limit_utilization");
  });

  it("should have pod memory defaultMetrics in pods>memory child", () => {
    const pods = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "pods");
    const memory = pods!.children!.find((c) => c.id === "memory");
    const names = memory!.defaultMetrics!.map((m) => m.streamName);
    expect(names).toContain("k8s_pod_memory_usage");
    expect(names).toContain("k8s_pod_memory_request_utilization");
    expect(names).toContain("k8s_pod_memory_limit_utilization");
  });

  it("should have k8s_pod_network_io in pods>network child", () => {
    const pods = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "pods");
    const network = pods!.children!.find((c) => c.id === "network");
    const names = network!.defaultMetrics!.map((m) => m.streamName);
    expect(names).toContain("k8s_pod_network_io");
  });

  it("should have k8s_node_cpu_usage in nodes>compute child", () => {
    const nodes = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "nodes");
    const compute = nodes!.children!.find((c) => c.id === "compute");
    const names = compute!.defaultMetrics!.map((m) => m.streamName);
    expect(names).toContain("k8s_node_cpu_usage");
  });

  it("should have k8s_node_memory_rss in nodes>memory child", () => {
    const nodes = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "nodes");
    const memory = nodes!.children!.find((c) => c.id === "memory");
    const names = memory!.defaultMetrics!.map((m) => m.streamName);
    expect(names).toContain("k8s_node_memory_rss");
  });

  it("should have k8s_node_network_io in nodes>network child", () => {
    const nodes = K8S_METRIC_GROUP_DEFINITIONS.find((d) => d.id === "nodes");
    const network = nodes!.children!.find((c) => c.id === "network");
    const names = network!.defaultMetrics!.map((m) => m.streamName);
    expect(names).toContain("k8s_node_network_io");
  });

  it("should have no direction filters on any default metric config in children", () => {
    for (const group of K8S_METRIC_GROUP_DEFINITIONS) {
      for (const child of group.children ?? []) {
        for (const m of child.defaultMetrics ?? []) {
          expect(m.filters?.direction).toBeUndefined();
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getDefaultMetricSelections
// ---------------------------------------------------------------------------

describe("getDefaultMetricSelections", () => {
  function makeStream(
    stream_name: string,
    filters: Record<string, string> = {},
  ): StreamInfo {
    return { stream_name, stream_type: "metrics", filters };
  }

  it("should return an empty array when no group has defaultMetrics", () => {
    const defs: MetricGroupDefinition[] = [
      { id: "others", label: "Others", icon: "category" },
    ];
    const streams = [makeStream("k8s_pod_cpu_usage")];
    expect(getDefaultMetricSelections(defs, streams)).toEqual([]);
  });

  it("should return an empty array when none of the default streams are available", () => {
    const result = getDefaultMetricSelections(K8S_METRIC_GROUP_DEFINITIONS, []);
    expect(result).toEqual([]);
  });

  it("should match a default metric by stream_name alone when no filters defined", () => {
    const streams = [makeStream("k8s_pod_cpu_usage")];
    const result = getDefaultMetricSelections(K8S_METRIC_GROUP_DEFINITIONS, streams);
    expect(result).toHaveLength(1);
    expect(result[0].stream_name).toBe("k8s_pod_cpu_usage");
  });

  it("should match all 6 pod CPU/memory defaults when all are present", () => {
    const podStreams = [
      "k8s_pod_cpu_usage",
      "k8s_pod_memory_usage",
      "k8s_pod_cpu_request_utilization",
      "k8s_pod_memory_request_utilization",
      "k8s_pod_cpu_limit_utilization",
      "k8s_pod_memory_limit_utilization",
    ].map((n) => makeStream(n));
    const result = getDefaultMetricSelections(
      K8S_METRIC_GROUP_DEFINITIONS,
      podStreams,
    );
    expect(result).toHaveLength(6);
  });

  it("should skip defaults whose stream_name is not in availableStreams", () => {
    const streams = [makeStream("k8s_pod_cpu_usage")];
    const result = getDefaultMetricSelections(K8S_METRIC_GROUP_DEFINITIONS, streams);
    // Only 1 of many defaults is available
    expect(result).toHaveLength(1);
    expect(result[0].stream_name).toBe("k8s_pod_cpu_usage");
  });

  it("should match k8s_pod_network_io without requiring any direction filter", () => {
    // K8S_METRIC_GROUP_DEFINITIONS has no direction filter — any network_io stream matches
    const streams = [makeStream("k8s_pod_network_io")];
    const result = getDefaultMetricSelections(K8S_METRIC_GROUP_DEFINITIONS, streams);
    const matched = result.filter((s) => s.stream_name === "k8s_pod_network_io");
    expect(matched).toHaveLength(1);
  });

  it("should require all declared filters to match when a custom definition uses filters", () => {
    const defs: MetricGroupDefinition[] = [
      {
        id: "custom",
        label: "Custom",
        icon: "star",
        defaultMetrics: [{ streamName: "my_metric", filters: { env: "prod" } }],
      },
    ];
    const streams = [
      makeStream("my_metric", { env: "staging" }),
      makeStream("my_metric", { env: "prod" }),
    ];
    const result = getDefaultMetricSelections(defs, streams);
    expect(result).toHaveLength(1);
    expect(result[0].filters?.env).toBe("prod");
  });

  it("should return no match when a custom filter requirement is not satisfied by any stream", () => {
    const defs: MetricGroupDefinition[] = [
      {
        id: "custom",
        label: "Custom",
        icon: "star",
        defaultMetrics: [{ streamName: "my_metric", filters: { env: "prod" } }],
      },
    ];
    const streams = [makeStream("my_metric", { env: "staging" })];
    const result = getDefaultMetricSelections(defs, streams);
    expect(result).toHaveLength(0);
  });

  it("should return streams in group definition order (pods → nodes)", () => {
    const streams = [
      makeStream("k8s_node_cpu_usage"),
      makeStream("k8s_pod_cpu_usage"),
      makeStream("k8s_pod_network_io"),
    ];
    const result = getDefaultMetricSelections(K8S_METRIC_GROUP_DEFINITIONS, streams);
    // pods group is first: k8s_pod_cpu_usage (first pod default) then k8s_pod_network_io (last pod default)
    expect(result[0].stream_name).toBe("k8s_pod_cpu_usage");
    expect(result[1].stream_name).toBe("k8s_pod_network_io");
    // nodes group is second
    expect(result[2].stream_name).toBe("k8s_node_cpu_usage");
  });

  it("should return the same StreamInfo reference from availableStreams", () => {
    const stream = makeStream("k8s_pod_cpu_usage");
    const result = getDefaultMetricSelections(K8S_METRIC_GROUP_DEFINITIONS, [stream]);
    expect(result[0]).toBe(stream);
  });

  it("should not include duplicates when the same stream appears multiple times in availableStreams", () => {
    const streams = [
      makeStream("k8s_pod_cpu_usage"),
      makeStream("k8s_pod_cpu_usage"),
    ];
    const result = getDefaultMetricSelections(K8S_METRIC_GROUP_DEFINITIONS, streams);
    // getDefaultMetricSelections uses Array.find — picks first match per default entry
    const cpuMatches = result.filter((s) => s.stream_name === "k8s_pod_cpu_usage");
    expect(cpuMatches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// NEW: compute / memory / storage group definitions
// ---------------------------------------------------------------------------

const COMPUTE_MEMORY_STORAGE_GROUPS: MetricGroupDefinition[] = [
  { id: "compute", label: "Compute", icon: "insights" },
  { id: "memory", label: "Memory", icon: "memory" },
  { id: "storage", label: "Storage", icon: "storage" },
  { id: "network", label: "Network", icon: "lan" },
  { id: "others", label: "Others", icon: "category" },
];

describe("groupMetricsByCategory with compute/memory/storage groups", () => {
  it("classifies cpu streams as compute", () => {
    const result = groupMetricsByCategory(
      [makeStream("container_cpu_usage_seconds_total")],
      COMPUTE_MEMORY_STORAGE_GROUPS,
    );
    expect(result.byGroup["compute"]).toHaveLength(1);
    expect(result.byGroup["memory"]).toHaveLength(0);
  });

  it("classifies memory streams as memory", () => {
    const result = groupMetricsByCategory(
      [makeStream("container_memory_usage_bytes")],
      COMPUTE_MEMORY_STORAGE_GROUPS,
    );
    expect(result.byGroup["memory"]).toHaveLength(1);
    expect(result.byGroup["compute"]).toHaveLength(0);
  });

  it("classifies disk/fs streams as storage", () => {
    const result = groupMetricsByCategory(
      [makeStream("node_disk_io_time_seconds_total")],
      COMPUTE_MEMORY_STORAGE_GROUPS,
    );
    expect(result.byGroup["storage"]).toHaveLength(1);
  });

  it("classifies network streams correctly", () => {
    const result = groupMetricsByCategory(
      [makeStream("node_network_transmit_bytes_total")],
      COMPUTE_MEMORY_STORAGE_GROUPS,
    );
    expect(result.byGroup["network"]).toHaveLength(1);
  });

  it("classifies node_cpu_seconds_total as compute", () => {
    const result = groupMetricsByCategory(
      [makeStream("node_cpu_seconds_total")],
      COMPUTE_MEMORY_STORAGE_GROUPS,
    );
    expect(result.byGroup["compute"]).toHaveLength(1);
  });

  it("classifies k8s_pod_memory_usage as memory", () => {
    const result = groupMetricsByCategory(
      [makeStream("k8s_pod_memory_usage")],
      COMPUTE_MEMORY_STORAGE_GROUPS,
    );
    expect(result.byGroup["memory"]).toHaveLength(1);
  });

  it("classifies node_filesystem_avail_bytes as storage", () => {
    const result = groupMetricsByCategory(
      [makeStream("node_filesystem_avail_bytes")],
      COMPUTE_MEMORY_STORAGE_GROUPS,
    );
    expect(result.byGroup["storage"]).toHaveLength(1);
  });

  it("classifies http_requests_total as network (http keyword)", () => {
    const result = groupMetricsByCategory(
      [makeStream("http_requests_total")],
      COMPUTE_MEMORY_STORAGE_GROUPS,
    );
    expect(result.byGroup["network"]).toHaveLength(1);
    expect(result.byGroup["others"]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// NEW: DEFAULT_METRIC_GROUP_DEFINITIONS has compute/memory/storage (not infra)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// groupMetricsByCategory — edge cases
// ---------------------------------------------------------------------------

describe("groupMetricsByCategory — edge cases", () => {
  it("should handle a single-group definition with no patterns (all catch-all)", () => {
    const singleDef: MetricGroupDefinition[] = [
      { id: "everything", label: "Everything", icon: "all_inclusive" },
    ];
    const streams = [
      makeStream("container_cpu_usage_seconds_total"),
      makeStream("http_requests_total"),
    ];
    const result = groupMetricsByCategory(streams, singleDef);
    expect(result.byGroup["everything"]).toHaveLength(2);
  });

  it("should handle a large number of streams without error", () => {
    const streams = Array.from({ length: 500 }, (_, i) =>
      makeStream(`metric_${i}_total`),
    );
    const result = groupMetricsByCategory(streams);
    const totalClassified = Object.values(result.byGroup).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    expect(totalClassified).toBe(500);
  });

  it("should produce the same result when called twice with the same input (idempotent)", () => {
    const streams = [
      makeStream("container_cpu_usage_seconds_total"),
      makeStream("http_requests_total"),
    ];
    const first = groupMetricsByCategory(streams);
    const second = groupMetricsByCategory(streams);
    expect(first.byGroup["compute"].length).toBe(second.byGroup["compute"].length);
    expect(first.byGroup["others"].length).toBe(
      second.byGroup["others"].length,
    );
  });
});
