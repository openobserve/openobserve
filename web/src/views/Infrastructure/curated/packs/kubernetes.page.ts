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

// Kubernetes content pack (design §4.2): drift variants where both collector spellings exist, instant-vector inventory tables.

import { GROUP, STALENESS_24H_US, type CuratedPageManifest, type CuratedPanelDef } from "../types";
import { explorerDrilldown } from "./drilldown";

const NODE = "${f:k8s-node-name}";
const NS = "${f:k8s-namespace}";
const POD = "${f:k8s-pod-name}";

/** One-variant panels share this shape; the drilldown always carries variant 1. */
const panel = (
  def: Omit<CuratedPanelDef, "drilldown">,
  drilldownStream: string,
): CuratedPanelDef => ({
  ...def,
  drilldown: [explorerDrilldown(drilldownStream, def.variants[0].queries[0].query)],
});

export const kubernetesPage: CuratedPageManifest = {
  id: "kubernetes",
  titleKey: "infra.workload.kubernetesTitle",
  icon: "hub",
  contentVersion: 1,
  defaultRelativePeriod: "3h",
  stalenessThresholdUs: STALENESS_24H_US,

  groups: [
    {
      id: "kubelet-node",
      labelKey: "infra.k8s.group.nodeMetrics",
      capabilityKey: "infra.k8s.group.nodeMetricsCap",
      setupHintKey: "infra.k8s.group.nodeMetricsHint",
      setup: { kind: "card", slug: "kubernetes" },
      streamType: "metrics",
      // The rung-4a net for an org whose saved override dropped the group, and for OSS until the groups are exposed.
      probeFields: {
        [GROUP.node]: ["k8s_node_name", "k8s_node", "node"],
        [GROUP.cluster]: ["k8s_cluster_name", "k8s_cluster", "cluster"],
      },
    },
    {
      id: "kubelet-pod",
      labelKey: "infra.k8s.group.podMetrics",
      capabilityKey: "infra.k8s.group.podMetricsCap",
      setupHintKey: "infra.k8s.group.podMetricsHint",
      setup: { kind: "card", slug: "kubernetes" },
      streamType: "metrics",
      anchorStream: "k8s_pod_memory_usage",
      probeFields: {
        [GROUP.namespace]: ["k8s_namespace_name", "k8s_namespace", "namespace"],
        [GROUP.pod]: ["k8s_pod_name", "k8s_pod", "pod"],
      },
    },
    {
      id: "kube-state",
      labelKey: "infra.k8s.group.kubeState",
      capabilityKey: "infra.k8s.group.kubeStateCap",
      setupHintKey: "infra.k8s.group.kubeStateHint",
      setup: { kind: "card", slug: "kubernetes" },
      streamType: "metrics",
      // kube_pod_status_phase carries no node field at all, while the node panels query kube_node_status_condition, which does.
      fieldOverrides: {
        [GROUP.namespace]: "namespace",
        [GROUP.pod]: "pod",
        [GROUP.node]: "node",
      },
    },
  ],

  scopePickers: [
    {
      name: "cluster",
      group: GROUP.cluster,
      // The dead utilization spelling returned 0 values where the live usage stream returned all 10 clusters (dry run finding 6).
      valuesFrom: { groupId: "kubelet-node", stream: "k8s_node_cpu_usage", streamType: "metrics" },
      multiSelect: true,
      omitWhenFieldAbsent: true,
      omitWhenValuesEmpty: true,
    },
    {
      name: "namespace",
      group: GROUP.namespace,
      valuesFrom: { groupId: "kubelet-pod", stream: "k8s_pod_memory_usage", streamType: "metrics" },
      multiSelect: true,
      omitWhenValuesEmpty: true,
    },
    {
      name: "pod",
      group: GROUP.pod,
      valuesFrom: { groupId: "kubelet-pod", stream: "k8s_pod_memory_usage", streamType: "metrics" },
      multiSelect: true,
      chainedOn: [{ picker: "namespace" }],
      omitWhenValuesEmpty: true,
    },
  ],

  sections: [
    {
      id: "overview",
      titleKey: "infra.k8s.section.overview",
      scopedBy: ["cluster"],
      panels: [
        panel(
          {
            id: "k8s_ov_nodes",
            titleKey: "infra.k8s.panel.nodes",
            type: "metric",
            unit: "numbers",
            groupId: "kubelet-node",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["k8s_node_cpu_utilization"],
                queryType: "promql",
                queries: [
                  { query: `count(count by (${NODE}) (k8s_node_cpu_utilization))`, legend: "" },
                ],
              },
              {
                requiresStreams: ["k8s_node_cpu_usage"],
                queryType: "promql",
                queries: [{ query: `count(count by (${NODE}) (k8s_node_cpu_usage))`, legend: "" }],
              },
            ],
          },
          "k8s_node_cpu_utilization",
        ),

        // `status="true"` selects series; the assertion lives in the series VALUE, so counting READY nodes needs `== 1`.
        panel(
          {
            id: "k8s_ov_nodes_ready",
            titleKey: "infra.k8s.panel.nodesReady",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_node_status_condition"],
                queryType: "promql",
                queries: [
                  {
                    query:
                      'count(kube_node_status_condition{condition="Ready",status="true"} == 1)',
                    legend: "",
                  },
                ],
              },
            ],
          },
          "kube_node_status_condition",
        ),

        panel(
          {
            id: "k8s_ov_pods_running",
            titleKey: "infra.k8s.panel.podsRunning",
            subtitleKey: "infra.k8s.panel.podsRunningSub",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [{ query: 'sum(kube_pod_status_phase{phase="Running"})', legend: "" }],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_ov_pods_pending",
            titleKey: "infra.k8s.panel.podsPending",
            subtitleKey: "infra.k8s.panel.podsPendingSub",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [{ query: 'sum(kube_pod_status_phase{phase="Pending"})', legend: "" }],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_ov_pods_failed",
            titleKey: "infra.k8s.panel.podsFailed",
            subtitleKey: "infra.k8s.panel.podsFailedSub",
            type: "metric",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [{ query: 'sum(kube_pod_status_phase{phase="Failed"})', legend: "" }],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_ov_fleet_cpu",
            titleKey: "infra.k8s.panel.fleetCpu",
            type: "metric",
            unit: "percent-1",
            groupId: "kubelet-node",
            layout: { w: 32, h: 6 },
            variants: [
              {
                requiresStreams: ["k8s_node_cpu_utilization"],
                queryType: "promql",
                queries: [{ query: "avg(k8s_node_cpu_utilization${scope:cluster})", legend: "" }],
              },
              {
                requiresStreams: ["k8s_node_cpu_usage"],
                queryType: "promql",
                // Cores in use — a ratio is not derivable from usage alone.
                unit: "numbers",
                queries: [{ query: "sum(k8s_node_cpu_usage${scope:cluster})", legend: "" }],
              },
            ],
          },
          "k8s_node_cpu_utilization",
        ),

        // Five phases exist on a live org, so this chart is deliberately unfiltered — the superset the three tiles draw from.
        panel(
          {
            id: "k8s_ov_pods_by_phase",
            titleKey: "infra.k8s.panel.podsByPhase",
            type: "line",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [{ query: "sum by (phase)(kube_pod_status_phase)", legend: "{phase}" }],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_ov_node_cpu_top",
            titleKey: "infra.k8s.panel.nodeCpuTop",
            type: "line",
            unit: "percent-1",
            groupId: "kubelet-node",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_node_cpu_utilization"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, avg by (${NODE}) (k8s_node_cpu_utilization\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
              {
                requiresStreams: ["k8s_node_cpu_usage"],
                queryType: "promql",
                unit: "numbers",
                queries: [
                  {
                    query: `topk(10, sum by (${NODE}) (k8s_node_cpu_usage\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
            ],
          },
          "k8s_node_cpu_utilization",
        ),

        // The inventory the tiles above imply, instant-vector shaped so the outer topk(20) really returns twenty rows.
        panel(
          {
            id: "k8s_ov_unhealthy_pods",
            titleKey: "infra.k8s.panel.unhealthyPods",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, last_over_time(sum by (${NS}, ${POD}, phase)(kube_pod_status_phase{phase=~"Pending|Failed|Unknown"} > 0)[5m:]))`,
                    legend: `{${NS}}/{${POD}} {phase}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_status_phase",
        ),
      ],
    },

    {
      id: "nodes",
      titleKey: "infra.k8s.section.nodes",
      scopedBy: ["cluster"],
      panels: [
        panel(
          {
            id: "k8s_nd_cpu",
            titleKey: "infra.k8s.panel.nodeCpu",
            type: "line",
            unit: "percent-1",
            groupId: "kubelet-node",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_node_cpu_utilization"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, avg by (${NODE}) (k8s_node_cpu_utilization\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
              {
                requiresStreams: ["k8s_node_cpu_usage"],
                queryType: "promql",
                unit: "numbers",
                queries: [
                  {
                    query: `topk(20, avg by (${NODE}) (k8s_node_cpu_usage\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
            ],
          },
          "k8s_node_cpu_utilization",
        ),

        panel(
          {
            id: "k8s_nd_memory",
            titleKey: "infra.k8s.panel.nodeMemory",
            type: "line",
            unit: "bytes",
            groupId: "kubelet-node",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_node_memory_usage"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NODE}) (k8s_node_memory_usage\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
              {
                requiresStreams: ["k8s_node_memory_rss"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NODE}) (k8s_node_memory_rss\${scope:cluster}))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
            ],
          },
          "k8s_node_memory_usage",
        ),

        panel(
          {
            id: "k8s_nd_conditions",
            titleKey: "infra.k8s.panel.nodeConditions",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_node_status_condition"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, last_over_time(sum by (${NODE}, condition)(kube_node_status_condition{status="true"} == 1)[5m:]))`,
                    legend: `{${NODE}} {condition}`,
                  },
                ],
              },
            ],
          },
          "kube_node_status_condition",
        ),

        panel(
          {
            id: "k8s_nd_network",
            titleKey: "infra.k8s.panel.nodeNetwork",
            type: "line",
            unit: "bps",
            groupId: "kubelet-node",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_node_network_io"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NODE}, direction)(irate(k8s_node_network_io\${scope:cluster}[5m])))`,
                    legend: `{${NODE}} {direction}`,
                  },
                ],
              },
            ],
          },
          "k8s_node_network_io",
        ),

        // `condition!="Ready"` selected 13 unrelated conditions; `{condition="Ready"} == 0` stays correct when Ready="unknown".
        panel(
          {
            id: "k8s_nd_not_ready",
            titleKey: "infra.k8s.panel.nodesNotReady",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_node_status_condition"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, last_over_time(sum by (${NODE})(kube_node_status_condition{condition="Ready"} == 0)[5m:]))`,
                    legend: `{${NODE}}`,
                  },
                ],
              },
            ],
          },
          "kube_node_status_condition",
        ),
      ],
    },

    {
      id: "workloads",
      titleKey: "infra.k8s.section.workloads",
      scopedBy: ["namespace", "pod"],
      panels: [
        panel(
          {
            id: "k8s_wl_pod_cpu_top",
            titleKey: "infra.k8s.panel.podCpuTop",
            type: "line",
            unit: "numbers",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_cpu_usage"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, sum by (${NS}, ${POD}) (k8s_pod_cpu_usage{\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
              {
                requiresStreams: ["k8s_pod_cpu_utilization"],
                queryType: "promql",
                unit: "percent-1",
                queries: [
                  {
                    query: `topk(10, avg by (${NS}, ${POD}) (k8s_pod_cpu_utilization{\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_cpu_usage",
        ),

        panel(
          {
            id: "k8s_wl_pod_mem_top",
            titleKey: "infra.k8s.panel.podMemTop",
            type: "line",
            unit: "bytes",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_usage"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, sum by (${NS}, ${POD}) (k8s_pod_memory_usage{\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_usage",
        ),

        panel(
          {
            id: "k8s_wl_nonrunning_by_ns",
            titleKey: "infra.k8s.panel.nonRunningByNs",
            type: "line",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_status_phase"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NS}) (kube_pod_status_phase{phase=~"Pending|Failed|Unknown",\${scope:namespace}}))`,
                    legend: `{${NS}}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_status_phase",
        ),

        panel(
          {
            id: "k8s_wl_cpu_requests",
            titleKey: "infra.k8s.panel.cpuRequestsByNs",
            type: "line",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_container_resource_requests"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NS}) (kube_pod_container_resource_requests{resource="cpu",\${scope:namespace}}))`,
                    legend: `{${NS}}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_container_resource_requests",
        ),

        panel(
          {
            id: "k8s_wl_pod_network",
            titleKey: "infra.k8s.panel.podNetwork",
            type: "line",
            unit: "bps",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_network_io"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, sum by (${NS}) (irate(k8s_pod_network_io{\${scope:namespace}}[5m])))`,
                    legend: `{${NS}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_network_io",
        ),

        panel(
          {
            id: "k8s_wl_pod_fs",
            titleKey: "infra.k8s.panel.podFilesystem",
            type: "line",
            unit: "percent",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_filesystem_usage", "k8s_pod_filesystem_capacity"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, 100 * sum by (${NS}, ${POD}) (k8s_pod_filesystem_usage{\${scope:namespace}}) / sum by (${NS}, ${POD}) (k8s_pod_filesystem_capacity{\${scope:namespace}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_filesystem_usage",
        ),

        panel(
          {
            id: "k8s_wl_pod_mem_limit_pct",
            titleKey: "infra.k8s.panel.podMemLimitPct",
            type: "line",
            unit: "percent-1",
            groupId: "kubelet-pod",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["k8s_pod_memory_limit_utilization"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(10, avg by (${NS}, ${POD}) (k8s_pod_memory_limit_utilization{\${scope:namespace},\${scope:pod}}))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "k8s_pod_memory_limit_utilization",
        ),

        panel(
          {
            id: "k8s_wl_pod_restarts",
            titleKey: "infra.k8s.panel.podRestarts",
            type: "table",
            unit: "numbers",
            groupId: "kube-state",
            layout: { w: 96, h: 16 },
            variants: [
              {
                requiresStreams: ["kube_pod_container_status_restarts_total"],
                queryType: "promql",
                queries: [
                  {
                    query: `topk(20, last_over_time(sum by (${NS}, ${POD}) (increase(kube_pod_container_status_restarts_total{\${scope:namespace}}[1h]))[5m:]))`,
                    legend: `{${NS}}/{${POD}}`,
                  },
                ],
              },
            ],
          },
          "kube_pod_container_status_restarts_total",
        ),
      ],
    },
  ],
};
