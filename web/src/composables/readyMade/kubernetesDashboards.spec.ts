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

import { describe, it, expect, vi, beforeEach } from "vitest";

const { loadSemanticGroupsMock } = vi.hoisted(() => ({ loadSemanticGroupsMock: vi.fn() }));

vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/utils/semanticGroupsCache", () => ({
  loadSemanticGroups: loadSemanticGroupsMock,
  clearSemanticGroupsCacheForOrg: vi.fn(),
  getCachedSemanticGroups: vi.fn(() => null),
}));

import stream from "@/services/stream";
import { queryClient } from "@/composables/query/queryClient";
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import type { FieldAlias } from "@/services/service_streams";
import defaultSemanticGroups from "@/views/Infrastructure/curated/packs/__fixtures__/semanticGroups.default.json";
import { buildKubernetesDashboards } from "./kubernetesDashboards";
import { getReadyMadeSource, readyMadeMarker } from "./catalog";
import { READYMADE_K8S_STREAMS, k8sSchemaEntry, k8sStreamList } from "./__fixtures__/k8sStreams";

const ORG = "org1";
const svc = stream as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** Keys the v8 dashboards API keeps; anything else is dropped on save. */
const STORED_VARIABLE_KEYS = new Set([
  "type",
  "name",
  "label",
  "query_data",
  "value",
  "options",
  "multiSelect",
  "hideOnDashboard",
  "selectAllValueForMultiSelect",
  "customMultiSelectValue",
  "escapeSingleQuotes",
  "scope",
  "tabs",
  "panels",
]);
const STORED_CONFIG_KEYS = new Set([
  "show_legends",
  "legends_position",
  "unit",
  "unit_custom",
  "decimals",
  "drilldown",
  "promql_table_mode",
  "show_symbol",
  "connect_nulls",
]);

const serveStreams = (names: readonly string[] = READYMADE_K8S_STREAMS) => {
  svc.nameList.mockImplementation(async () => ({ data: { list: k8sStreamList(names) } }));
  svc.schema.mockImplementation(async (_org: string, name: string) => ({
    data: k8sSchemaEntry(name),
  }));
};

const build = async () => {
  const docs = await buildKubernetesDashboards(ORG);
  return Object.fromEntries(
    ["cluster", "node", "pod", "workload"].map((key, index) => [key, docs[index]]),
  ) as Record<string, any>;
};

const panelsOf = (doc: any): any[] => doc.tabs.flatMap((tab: any) => tab.panels);
const panel = (doc: any, id: string) => {
  const found = panelsOf(doc).find((p) => p.id === id);
  if (!found) throw new Error(`no panel ${id} on ${doc.title}`);
  return found;
};
const variable = (doc: any, name: string) =>
  doc.variables.list.find((entry: any) => entry.name === name);

const keysDeep = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, out));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      keysDeep(inner, out);
    }
  }
  return out;
};

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  loadSemanticGroupsMock.mockResolvedValue(defaultSemanticGroups as FieldAlias[]);
  serveStreams();
});

describe("buildKubernetesDashboards — documents", () => {
  it("returns the catalog's four v8 docs in order, titled and marked", async () => {
    const docs = await buildKubernetesDashboards(ORG);
    const refs = getReadyMadeSource("kubernetes").dashboards;
    expect(docs.map((doc) => doc.title)).toEqual(refs.map((ref) => ref.title));
    expect(docs.map((doc) => doc.role)).toEqual(
      refs.map((ref) => readyMadeMarker("kubernetes", ref.key)),
    );
    for (const doc of docs) {
      expect(doc.version).toBe(8);
      expect(doc.dashboardId).toBe("");
      // The curated page's own default window, so a side-by-side reads the same range.
      expect(doc.defaultDatetimeDuration).toEqual({ type: "relative", relativeTimePeriod: "3h" });
    }
  });

  it("names the frozen field spellings in the description", async () => {
    const { node } = await build();
    expect(node.description).toMatch(/^Kubernetes v1 · /);
    expect(node.description).toContain("k8s_node_name");
    expect(node.description).toContain("k8s_cluster");
  });

  it("tabs: cluster = inventory/health/utilization, node, pod, one per workload kind", async () => {
    const docs = await build();
    expect(docs.cluster.tabs.map((tab: any) => tab.name)).toEqual([
      "Inventory",
      "Health",
      "Utilization",
    ]);
    expect(docs.node.tabs.map((tab: any) => tab.name)).toEqual(["Nodes"]);
    expect(docs.pod.tabs.map((tab: any) => tab.name)).toEqual(["Pods"]);
    expect(docs.workload.tabs.map((tab: any) => tab.name)).toEqual([
      "Deployments",
      "StatefulSets",
      "DaemonSets",
      "Jobs",
    ]);
  });

  it("titles panels in plain text, never as i18n keys", async () => {
    const docs = await build();
    for (const doc of Object.values(docs)) {
      for (const p of panelsOf(doc)) expect(p.title).not.toMatch(/^infra\./);
    }
    expect(panel(docs.cluster, "k8s_ov_nodes").title).toBe("Nodes");
    expect(panel(docs.workload, "k8s_rm_deploy_replicas").title).toBe("Replicas");
  });
});

describe("buildKubernetesDashboards — what the curated page alone understands is gone", () => {
  it("carries no curated key, theme token, custom chart or hex colour anywhere", async () => {
    const docs = await build();
    for (const doc of Object.values(docs)) {
      expect(keysDeep(doc).filter((key) => key.startsWith("curated"))).toEqual([]);
      const text = JSON.stringify(doc);
      expect(text).not.toContain("${theme:");
      expect(text).not.toContain("customChartContent");
      expect(text).not.toMatch(/#[0-9a-f]{6}\b/i);
    }
  });

  it("keeps only the variable and panel-config keys the dashboards API stores", async () => {
    const docs = await build();
    for (const doc of Object.values(docs)) {
      for (const entry of doc.variables.list) {
        expect(Object.keys(entry).filter((key) => !STORED_VARIABLE_KEYS.has(key))).toEqual([]);
      }
      for (const p of panelsOf(doc)) {
        if (p.type === "markdown") continue;
        expect(Object.keys(p.config).filter((key) => !STORED_CONFIG_KEYS.has(key))).toEqual([]);
      }
    }
  });

  it("drops the fleet quadrant and keeps the fleet CPU and memory bars on Inventory", async () => {
    const { cluster } = await build();
    const ids = cluster.tabs[0].panels.map((p: any) => p.id);
    expect(ids).toContain("k8s_sm_fleet_cpu");
    expect(ids).toContain("k8s_sm_fleet_memory");
    expect(panelsOf(cluster).some((p) => p.id === "k8s_sm_fleet_quadrant")).toBe(false);
    expect(panel(cluster, "k8s_sm_fleet_cpu").layout.w).toBe(96);
  });

  it("prints each tab's caveat as a markdown note above its grid", async () => {
    const { cluster } = await build();
    const [note, first] = cluster.tabs[0].panels;
    expect(note.type).toBe("markdown");
    expect(note.markdownContent).toContain("three of five phases");
    expect(note.layout).toMatchObject({ x: 0, y: 0, w: 192 });
    expect(first.layout.y).toBeGreaterThanOrEqual(note.layout.h);
    const layoutIds = cluster.tabs[0].panels.map((p: any) => p.layout.i);
    expect(new Set(layoutIds).size).toBe(layoutIds.length);
  });
});

describe("buildKubernetesDashboards — links between the four", () => {
  it("replaces every explorer drilldown with a dashboard link that passes all variables", async () => {
    const docs = await build();
    const titles = Object.values(docs).map((doc: any) => doc.title);
    for (const doc of Object.values(docs)) {
      for (const p of panelsOf(doc)) {
        for (const link of p.config.drilldown ?? []) {
          expect(link.type).toBe("byDashboard");
          expect(link.data.folder).toBe("Kubernetes");
          expect(titles).toContain(link.data.dashboard);
          expect(link.data.passAllVariables).toBe(true);
          const target = Object.values(docs).find((d: any) => d.title === link.data.dashboard);
          expect(target.tabs.map((tab: any) => tab.name)).toContain(link.data.tab);
        }
      }
      expect(JSON.stringify(doc)).not.toContain("openInMetricsExplorer");
    }
  });

  it("routes nodes to Node, pods to Pod, and kinds to their Workload tab", async () => {
    const { cluster, node, pod, workload } = await build();
    const linkOf = (doc: any, id: string) => panel(doc, id).config.drilldown[0].data;
    expect(linkOf(cluster, "k8s_ov_nodes").dashboard).toBe("Kubernetes / Node");
    expect(linkOf(cluster, "k8s_ov_pods_failed").dashboard).toBe("Kubernetes / Pod");
    expect(linkOf(cluster, "k8s_wh_sts_short_top")).toMatchObject({
      dashboard: "Kubernetes / Workload",
      tab: "StatefulSets",
    });
    expect(linkOf(node, "k8s_nd_cpu").dashboard).toBe("Kubernetes / Pod");
    expect(linkOf(pod, "k8s_wl_pod_restarts").dashboard).toBe("Kubernetes / Workload");
    expect(linkOf(workload, "k8s_rm_deploy_replicas").dashboard).toBe("Kubernetes / Pod");
  });

  it("a per-node chart hands the clicked node to the Node dashboard", async () => {
    const { cluster } = await build();
    expect(panel(cluster, "k8s_ov_node_cpu_top").config.drilldown[0].data.variables).toEqual([
      { name: "node", value: "${series.__name}" },
    ]);
  });
});

describe("buildKubernetesDashboards — variables", () => {
  it("names them cluster/namespace/pod/node, as the curated page does", async () => {
    const docs = await build();
    const names = (doc: any) => doc.variables.list.map((entry: any) => entry.name);
    expect(names(docs.cluster)).toEqual(["cluster", "namespace"]);
    expect(names(docs.node)).toEqual(["cluster", "node"]);
    expect(names(docs.pod)).toEqual(["cluster", "namespace", "pod"]);
    expect(names(docs.workload)).toEqual(["cluster", "namespace"]);
  });

  it("keeps every variable dashboard-wide, never the page's per-tab scope", async () => {
    const docs = await build();
    for (const doc of Object.values(docs)) {
      for (const entry of doc.variables.list) {
        expect(entry.scope).toBe("global");
        expect(entry.tabs).toBeUndefined();
      }
    }
  });

  it("a pick made on one dashboard reaches the next through the URL a link passes", async () => {
    const { cluster, pod } = await build();
    // The REAL manager on both ends: a `passAllVariables` link hands the target the source's own `var-` keys.
    const source = useVariablesManager((key: string) => key);
    await source.initialize(cluster.variables.list, cluster);
    source.updateVariableValue("cluster", "global", undefined, undefined, ["prod-eu-1"]);
    source.updateVariableValue("namespace", "global", undefined, undefined, ["payments"]);
    source.commitAll();
    const query = source.getUrlParams({ useLive: false });
    expect(query).toEqual({ "var-cluster": ["prod-eu-1"], "var-namespace": ["payments"] });

    const target = useVariablesManager((key: string) => key);
    await target.initialize(pod.variables.list, pod);
    target.loadFromUrl({ query });
    expect(target.getVariable("cluster", "global")?.value).toEqual(["prod-eu-1"]);
    expect(target.getVariable("namespace", "global")?.value).toEqual(["payments"]);
  });

  it("node values come from kube-state's `node`, chained on the cluster", async () => {
    const { node } = await build();
    expect(variable(node, "node")).toMatchObject({
      type: "query_values",
      multiSelect: true,
      selectAllValueForMultiSelect: "all",
      query_data: {
        stream: "kube_node_status_condition",
        field: "node",
        filter: [{ name: "k8s_cluster", operator: "IN", value: "$cluster" }],
      },
    });
    expect(variable(node, "cluster").selectAllValueForMultiSelect).toBe("first");
  });

  it("each node panel spells the node matcher its own collector's way", async () => {
    const { node } = await build();
    expect(panel(node, "k8s_nd_cpu").queries[0].query).toContain('k8s_node_name=~"$node"');
    expect(panel(node, "k8s_nd_conditions").queries[0].query).toContain('node=~"$node"');
    expect(panel(node, "k8s_nd_conditions").queries[0].query).not.toContain("k8s_node_name");
  });

  it("labels fall back to plain nouns when the field dictionary cannot be read", async () => {
    loadSemanticGroupsMock.mockImplementation(async (_org: string, onError: any) => {
      onError?.(Object.assign(new Error("403"), { response: { status: 403 } }));
      return [];
    });
    const { pod } = await build();
    expect(pod.variables.list.map((entry: any) => entry.label)).toEqual([
      "Cluster",
      "Namespace",
      "Pod",
    ]);
    // Rung 4a still spells kubeletstats from the pack's own net.
    expect(panel(pod, "k8s_wl_pod_cpu_top").queries[0].query).toContain("k8s_pod_name");
  });
});

describe("buildKubernetesDashboards — resolved against this org's data", () => {
  it("picks the variant whose streams exist (usage, not utilization, on this collector)", async () => {
    const { node } = await build();
    const cpu = panel(node, "k8s_nd_cpu");
    expect(cpu.queries[0].query).toContain("k8s_node_cpu_usage");
    expect(cpu.config.unit).toBe("numbers");
  });

  it("switches to the utilization variant once that stream exists", async () => {
    serveStreams([...READYMADE_K8S_STREAMS, "k8s_node_cpu_utilization"]);
    const { node } = await build();
    const cpu = panel(node, "k8s_nd_cpu");
    expect(cpu.queries[0].query).toContain("k8s_node_cpu_utilization");
    expect(cpu.config.unit).toBe("percent-1");
  });

  it("leaves out panels whose streams this org does not send, as the page hides them", async () => {
    const { workload } = await build();
    const ids = panelsOf(workload).map((p) => p.id);
    expect(ids).not.toContain("k8s_wh_hpa_limited");
    expect(ids).not.toContain("k8s_wh_pvc_unbound_top");
    expect(ids).toContain("k8s_rm_sts_replicas");
  });

  it("reads one stream list and only the schemas the resolution asks for", async () => {
    await buildKubernetesDashboards(ORG);
    expect(svc.nameList).toHaveBeenCalledTimes(1);
    expect(svc.nameList).toHaveBeenCalledWith(ORG, "metrics", false);
    const fetched = svc.schema.mock.calls.map((call) => call[1]);
    expect(new Set(fetched).size).toBe(fetched.length);
    expect(fetched).toContain("kube_node_status_condition");
    expect(fetched).not.toContain("k8s_volume_capacity");
  });

  it("fails rather than saving an empty dashboard when no Kubernetes metrics exist", async () => {
    serveStreams([]);
    await expect(buildKubernetesDashboards(ORG)).rejects.toThrow(/Kubernetes \/ Cluster/);
  });

  it("fails when the stream list cannot be read", async () => {
    svc.nameList.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500 } }));
    await expect(buildKubernetesDashboards(ORG)).rejects.toThrow();
  });
});
