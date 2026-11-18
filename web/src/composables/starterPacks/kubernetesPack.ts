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

import { S3_BASE, S3_PREFIX } from "@/composables/useDashboardGallery";

import bundledAlerts from "./bundledKubernetesAlerts.json";
import { HOSTS_PACK } from "./hostsPack";
import type { PackBundledAlert, StarterPack } from "./types";

const GALLERY_DASHBOARD_PATH = "Kubernetes(openobserve-collector)/kubernetes_overview.json";

// Placeholder selection until the pack's real alert list is chosen.
export const PLACEHOLDER_KUBERNETES_ALERT_IDS = [
  "k8s/apiserver_high_latency",
  "k8s/cluster_cpu_capacity_high",
  "k8s/cluster_memory_capacity_high",
  "k8s/cluster_pod_count_high",
];

const GALLERY_TIMEOUT_MS = 10_000;

// The gallery holds the full dashboard; the bundled tab keeps the pack working offline.
const loadKubernetesOverview = async (): Promise<Record<string, any>> => {
  try {
    const response = await fetch(`${S3_BASE}/${S3_PREFIX}${GALLERY_DASHBOARD_PATH}`, {
      signal: AbortSignal.timeout(GALLERY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`gallery answered ${response.status}`);
    const doc = await response.json();
    if (!Array.isArray(doc?.tabs)) throw new Error("gallery dashboard has no tabs");
    return doc;
  } catch {
    const bundled = await import("@/assets/dashboards/kubernetes_overview.dashboard.json");
    return bundled.default;
  }
};

export const KUBERNETES_PACK: StarterPack = {
  id: "kubernetes",
  version: "1.0.0",
  titleKey: "starterPacks.kubernetes.title",
  descriptionKey: "starterPacks.kubernetes.description",
  folder: { name: "Kubernetes", description: "Installed by the Kubernetes starter pack" },
  dashboards: [
    {
      id: "overview",
      title: "Kubernetes Overview",
      load: loadKubernetesOverview,
    },
  ],
  alerts: PLACEHOLDER_KUBERNETES_ALERT_IDS,
  bundledAlerts: bundledAlerts as PackBundledAlert[],
  nativeView: { feature: "kubernetes_monitoring", route: "infraKubernetes" },
  clusterScoped: true,
  collectorRoute: "ingestFromKubernetes",
  logo: "images/common/kubernetes.svg",
  tiles: {
    dashboard: "starterPacks.kubernetes.tileDashboard",
    alert: "starterPacks.kubernetes.tileAlerts",
    savedView: "starterPacks.kubernetes.tileSavedView",
  },
  aliases: [
    ["k8s_cluster", "k8s_cluster_name", "cluster", "cluster_name"],
    [
      "k8s_namespace_name",
      "k8s_namespace",
      "namespace",
      "body_k8s_namespace_name",
      "body_namespace",
    ],
    ["k8s_pod_name", "k8s_pod", "pod", "body_k8s_pod_name", "body_pod"],
    ["k8s_node_name", "k8s_node", "node", "body_k8s_node_name", "body_node"],
    [
      "k8s_container_name",
      "k8s_container",
      "container",
      "body_k8s_container_name",
      "body_container",
    ],
    ["kind", "body_kind"],
    ["reason", "body_reason"],
    ["message", "body_message", "body_note"],
  ],
  aliasTitles: {
    k8s_cluster: "starterPacks.kubernetes.fieldCluster",
    k8s_namespace_name: "starterPacks.kubernetes.fieldNamespace",
    k8s_pod_name: "starterPacks.kubernetes.fieldPod",
    k8s_node_name: "starterPacks.kubernetes.fieldNode",
    k8s_container_name: "starterPacks.kubernetes.fieldContainer",
    kind: "starterPacks.kubernetes.fieldKind",
    reason: "starterPacks.kubernetes.fieldReason",
    message: "starterPacks.kubernetes.fieldMessage",
  },
  roles: [
    {
      id: "events",
      titleKey: "starterPacks.kubernetes.roleEvents",
      stream: "k8s_events",
      fields: ["kind", "reason", "message", "k8s_namespace_name"],
      identity: [
        { field: "instrumentation_library_name", pattern: "k8sobjects|k8s_events|k8sevents" },
        { field: "service_name", pattern: "k8s[-_]?events" },
        { field: "container_image_name", pattern: "event-exporter" },
      ],
    },
  ],
  flavours: [
    {
      id: "opentelemetry",
      titleKey: "starterPacks.kubernetes.flavourOtel",
      detect: ["k8s_pod_phase", "k8s_node_allocatable_cpu", "k8s_container_cpu_request"],
      alerts: {
        "k8s/cluster_cpu_capacity_high": {
          promql:
            "clamp_max(floor(sum by(k8s_cluster)(k8s_container_cpu_request) / on(k8s_cluster) sum by(k8s_cluster)(k8s_node_allocatable_cpu) * 10000) / 100, 100)",
          streams: ["k8s_container_cpu_request", "k8s_node_allocatable_cpu"],
        },
        "k8s/cluster_memory_capacity_high": {
          promql:
            "clamp_max(floor(sum by(k8s_cluster)(k8s_container_memory_request) / on(k8s_cluster) sum by(k8s_cluster)(k8s_node_allocatable_memory) * 10000) / 100, 100)",
          streams: ["k8s_container_memory_request", "k8s_node_allocatable_memory"],
        },
        "k8s/cluster_pod_count_high": {
          promql:
            "floor(count by(k8s_cluster) (k8s_pod_phase) / sum by(k8s_cluster) (k8s_node_allocatable_pods) * 10000) / 100",
          streams: ["k8s_pod_phase", "k8s_node_allocatable_pods"],
        },
      },
    },
  ],
  savedViews: [
    {
      id: "events",
      name: "Kubernetes events",
      search: {
        meta: {},
        data: {
          stream: { streamType: "logs", selectedStream: ["k8s_events"] },
          query: "",
        },
      },
    },
  ],
};

export const STARTER_PACKS: StarterPack[] = [KUBERNETES_PACK, HOSTS_PACK];
