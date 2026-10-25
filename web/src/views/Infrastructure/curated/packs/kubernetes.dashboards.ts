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

// The four ready-made Kubernetes dashboards as curated manifests; not registered in curatedPacks, so no page renders them.

import type { I18nKey } from "@/types/i18n";
import {
  QUERY_STREAM,
  queryText,
  type QueryId,
} from "@/views/Infrastructure/kubernetes2/kubernetesQueries";
import {
  GROUP,
  type CuratedPageManifest,
  type CuratedPanelDef,
  type CuratedSection,
  type ScopePickerDef,
} from "../types";
import { explorerDrilldown } from "./drilldown";
import { kubernetesPage } from "./kubernetes.page";

export type KubernetesDashboardKey = "cluster" | "node" | "pod" | "workload";

/** Where a click on a panel leads: another ready-made dashboard, carrying every variable. */
export interface KubernetesDashboardLink {
  to: KubernetesDashboardKey;
  /** Target section id; the target's first tab when omitted. */
  section?: string;
  /** Variable filled from the clicked series name, for charts whose legend is that one label. */
  seriesVariable?: string;
}

export interface KubernetesDashboardLayout {
  key: KubernetesDashboardKey;
  manifest: CuratedPageManifest;
  /** By panel id; a panel with no entry gets no link. */
  links: Record<string, KubernetesDashboardLink>;
}

/** The node picker the curated page lacks; kube-state keeps reporting a NotReady node, so its values come from there. */
export const NODE_PICKER: ScopePickerDef = {
  name: "node",
  group: GROUP.node,
  valuesFrom: {
    groupId: "kube-state",
    stream: "kube_node_status_condition",
    streamType: "metrics",
  },
  multiSelect: true,
  chainedOn: [{ picker: "cluster" }],
  omitWhenFieldAbsent: true,
};

const CLUSTER_SCOPE = "${scope:cluster}";
const NODE_SCOPE = "${scope:node}";
const KIND_SCOPE = { ksm: "${scope:cluster},${scope:namespace}", kubelet: null };

const pageSection = (id: string): CuratedSection => {
  const found = kubernetesPage.sections.find((section) => section.id === id);
  if (!found) throw new Error(`kubernetes pack has no section ${id}`);
  return found;
};

const pagePanel = (id: string): CuratedPanelDef => {
  for (const section of kubernetesPage.sections) {
    const found = section.panels.find((panel) => panel.id === id);
    if (found) return found;
  }
  throw new Error(`kubernetes pack has no panel ${id}`);
};

/** Adds `${scope:node}` beside every `${scope:cluster}`, owning the braces where the cluster token stood alone. */
export function addNodeScope(query: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < query.length; i++) {
    if (query.startsWith("${", i)) {
      const end = query.indexOf("}", i);
      const token = query.slice(i, end + 1);
      if (token === CLUSTER_SCOPE) {
        out += depth === 0 ? `{${token},${NODE_SCOPE}}` : `${token},${NODE_SCOPE}`;
      } else {
        out += token;
      }
      i = end;
      continue;
    }
    const char = query[i];
    if (char === "{") depth++;
    else if (char === "}") depth = Math.max(0, depth - 1);
    out += char;
  }
  return out;
}

/** A Nodes-tab panel narrowed by the node picker; everything but the matcher is the pack's own. */
const withNodeScope = (panel: CuratedPanelDef): CuratedPanelDef => {
  const variants = panel.variants.map((variant) => ({
    ...variant,
    queries: variant.queries.map((query) => ({ ...query, query: addNodeScope(query.query) })),
  }));
  const explorerUrl = panel.drilldown?.[0]?.data?.url ?? "";
  const stream = new URL(explorerUrl, "http://localhost").searchParams.get("stream_name") ?? "";
  return {
    ...panel,
    variants,
    drilldown: [explorerDrilldown(stream, variants[0].queries[0].query)],
  };
};

/** Fleet-wide by design, so it says so; sized to sit two to a row. */
const fleetPanel = (id: string): CuratedPanelDef => ({
  ...pagePanel(id),
  layout: { w: 96, h: 16 },
  fleetWide: ["cluster"],
});

/** Three tiles to a row: a dashboard panel header reserves room for its controls, which cut a sixth-width title. */
const roomyTiles = (section: CuratedSection, extra: CuratedPanelDef[] = []): CuratedSection => ({
  ...section,
  panels: [
    ...section.panels.map((panel) =>
      panel.type === "metric" ? { ...panel, layout: { ...panel.layout, w: 64 } } : panel,
    ),
    ...extra,
  ],
});

/** Desired against ready replicas per workload, reusing the Kubernetes explorer's own queries. */
const replicaPanel = (
  id: string,
  label: string,
  desired: QueryId,
  ready: QueryId,
  readyWord: string,
): CuratedPanelDef => {
  const desiredQuery = `topk(10, ${queryText(desired, KIND_SCOPE)})`;
  return {
    id,
    titleKey: "infra.k8s2.columnReplicas",
    type: "line",
    unit: "numbers",
    groupId: "kube-state",
    layout: { w: 96, h: 16 },
    variants: [
      {
        requiresStreams: [QUERY_STREAM[desired], QUERY_STREAM[ready]],
        queryType: "promql",
        queries: [
          { query: desiredQuery, legend: `{namespace}/{${label}} desired` },
          {
            query: `topk(10, ${queryText(ready, KIND_SCOPE)})`,
            legend: `{namespace}/{${label}} ${readyWord}`,
          },
        ],
      },
    ],
    drilldown: [explorerDrilldown(QUERY_STREAM[desired], desiredQuery)],
  };
};

const kindSection = (id: string, titleKey: I18nKey, panels: CuratedPanelDef[]): CuratedSection => ({
  id,
  titleKey,
  scopedBy: ["cluster", "namespace"],
  panels,
});

const manifestFor = (pickers: string[], sections: CuratedSection[]): CuratedPageManifest => ({
  ...kubernetesPage,
  scopePickers: [...kubernetesPage.scopePickers, NODE_PICKER].filter((picker) =>
    pickers.includes(picker.name),
  ),
  sections,
});

const linksFor = (
  link: KubernetesDashboardLink,
  ids: string[],
): Record<string, KubernetesDashboardLink> => Object.fromEntries(ids.map((id) => [id, link]));

const sectionPanelIds = (section: CuratedSection) => section.panels.map((panel) => panel.id);

const inventory = pageSection("inventory");
const health = pageSection("health");
const utilization = pageSection("utilization");
const nodes = pageSection("nodes");
const workloads = pageSection("workloads");

const clusterLayout: KubernetesDashboardLayout = {
  key: "cluster",
  manifest: manifestFor(
    ["cluster", "namespace"],
    [
      roomyTiles(inventory, [fleetPanel("k8s_sm_fleet_cpu"), fleetPanel("k8s_sm_fleet_memory")]),
      roomyTiles(health),
      roomyTiles(utilization),
    ],
  ),
  links: {
    ...linksFor({ to: "pod" }, [
      "k8s_ov_pods_running",
      "k8s_ov_pods_pending",
      "k8s_ov_pods_failed",
      "k8s_ov_pods_by_phase",
      "k8s_ov_unhealthy_pods",
      "k8s_wh_containers_failing",
      "k8s_wh_waiting_top",
      "k8s_wh_terminated_top",
      "k8s_ut_over_limit",
      "k8s_ut_near_limit",
      "k8s_ut_cpu_idle_pods",
      "k8s_ut_mem_idle_pods",
      "k8s_ut_over_limit_top",
      "k8s_ut_cpu_waste_top",
      "k8s_ut_mem_waste_top",
    ]),
    ...linksFor({ to: "node" }, [
      "k8s_ov_nodes",
      "k8s_ov_nodes_ready",
      "k8s_ov_cpu_used",
      "k8s_sm_fleet_cpu",
      "k8s_sm_fleet_memory",
      "k8s_ut_cpu_commit",
      "k8s_ut_cpu_free",
      "k8s_ut_commit_trend",
      "k8s_ut_node_commit_top",
    ]),
    k8s_ov_node_cpu_top: { to: "node", seriesVariable: "node" },
    ...linksFor({ to: "workload", section: "deployments" }, [
      "k8s_wh_deploy_short",
      "k8s_wh_deploy_short_top",
      "k8s_wh_hpa_limited",
    ]),
    ...linksFor({ to: "workload", section: "statefulsets" }, [
      "k8s_wh_sts_short",
      "k8s_wh_sts_short_top",
      "k8s_wh_pvc_unbound",
      "k8s_wh_pvc_unbound_top",
    ]),
    ...linksFor({ to: "workload", section: "daemonsets" }, [
      "k8s_wh_ds_unavailable",
      "k8s_wh_ds_unavailable_top",
    ]),
    ...linksFor({ to: "workload", section: "jobs" }, [
      "k8s_wh_jobs_failed",
      "k8s_wh_jobs_failed_top",
    ]),
  },
};

const nodeSection: CuratedSection = {
  id: "nodes",
  titleKey: nodes.titleKey,
  scopedBy: ["cluster", "node"],
  panels: nodes.panels.map(withNodeScope),
};

const nodeLayout: KubernetesDashboardLayout = {
  key: "node",
  manifest: manifestFor(["cluster", "node"], [nodeSection]),
  links: linksFor({ to: "pod" }, sectionPanelIds(nodeSection)),
};

const podSection: CuratedSection = {
  ...workloads,
  id: "pods",
  titleKey: "infra.k8s2.viewPods",
};

const podLayout: KubernetesDashboardLayout = {
  key: "pod",
  manifest: manifestFor(["cluster", "namespace", "pod"], [podSection]),
  links: linksFor({ to: "workload" }, sectionPanelIds(podSection)),
};

const workloadSections: CuratedSection[] = [
  kindSection("deployments", "infra.k8s2.viewDeployments", [
    pagePanel("k8s_wh_deploy_short_top"),
    pagePanel("k8s_wh_hpa_limited"),
    replicaPanel("k8s_rm_deploy_replicas", "deployment", "D1", "D2", "available"),
  ]),
  kindSection("statefulsets", "infra.k8s2.viewStatefulSets", [
    pagePanel("k8s_wh_sts_short_top"),
    pagePanel("k8s_wh_pvc_unbound_top"),
    replicaPanel("k8s_rm_sts_replicas", "statefulset", "SS1", "SS2", "ready"),
  ]),
  kindSection("daemonsets", "infra.k8s2.viewDaemonSets", [
    pagePanel("k8s_wh_ds_unavailable_top"),
    replicaPanel("k8s_rm_ds_replicas", "daemonset", "DS1", "DS5", "ready"),
  ]),
  kindSection("jobs", "infra.k8s2.viewJobs", [pagePanel("k8s_wh_jobs_failed_top")]),
];

const workloadLayout: KubernetesDashboardLayout = {
  key: "workload",
  manifest: manifestFor(["cluster", "namespace"], workloadSections),
  links: linksFor({ to: "pod" }, workloadSections.flatMap(sectionPanelIds)),
};

/** In the catalog's order: Cluster, Node, Pod, Workload. */
export const kubernetesDashboardLayouts: readonly KubernetesDashboardLayout[] = [
  clusterLayout,
  nodeLayout,
  podLayout,
  workloadLayout,
];
