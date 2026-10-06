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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import MapView from "./MapView.vue";
import {
  buildInventory,
  severityOf,
  type Inventory,
  type QueryResults,
  type Series,
} from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";
import { parseUrlState, type K8sUrlState } from "./kubernetesUrlState";
import { fillClass, fillValue, groupRows, listTarget, statusClass, type MapRow } from "./mapFill";

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "ChartRenderer",
      props: ["data"],
      emits: ["click"],
      setup: () => () => h("div", { "data-test": "chart-stub" }),
    }),
  };
});

const GEN = "prod-us-east-1";
const MI = 1024 ** 2;
const NODES = [
  "ip-10-0-1-10.ec2.internal",
  "ip-10-0-13-37.ec2.internal",
  "ip-10-0-2-20.ec2.internal",
  "ip-10-0-3-30.ec2.internal",
];
const ANSWERED: QueryId[] = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12",
  "P15",
  "K1",
  "K2",
  "N1",
  "N2",
  "K3",
  "K4",
];

const INVENTORY = "commerce/inventory-service-blkdl5tcm2-94jdl";
const CRASH = "data/recommendation-service-9x58zgdb6z-sclvv";
const HEALTHY = "gateway/api-gateway-5d8f7c9b4f-x2k9p";

interface PodOpts {
  phase?: string;
  ready?: string | null;
  rs?: string;
  deployment?: string;
  ds?: string;
  ss?: string;
  job?: string;
  node?: string;
  cpuRequest?: number;
  cpu?: number;
  memoryLimit?: number;
  memory?: number;
}

// Generator-shaped (traces_generator PR #5): KSM carries k8s_cluster, kubeletstats k8s_cluster_name.
function generatorResults(): QueryResults {
  const results: QueryResults = new Map(ANSWERED.map((id) => [id, [] as Series[]]));
  const add = (id: QueryId, metric: Record<string, string>, value = 1) =>
    results.get(id)!.push({ metric: { k8s_cluster: GEN, ...metric }, value });
  const usage = (id: QueryId, metric: Record<string, string>, value: number) =>
    results.get(id)!.push({ metric: { k8s_cluster_name: GEN, ...metric }, value });
  let spread = 0;
  const pod = (namespace: string, name: string, opts: PodOpts = {}) => {
    const p = { namespace, pod: name, uid: name };
    add("P1", { ...p, phase: opts.phase ?? "Running" });
    if (opts.ready !== null) add("P11", { ...p, condition: opts.ready ?? "true" });
    if (opts.rs) {
      add("P4", { ...p, owner_kind: "ReplicaSet", owner_name: opts.rs });
      add("P5", {
        namespace,
        replicaset: opts.rs,
        owner_kind: "Deployment",
        owner_name: opts.deployment!,
      });
    }
    const direct = opts.ds
      ? ["DaemonSet", opts.ds]
      : opts.ss
        ? ["StatefulSet", opts.ss]
        : opts.job
          ? ["Job", opts.job]
          : null;
    if (direct) add("P4", { ...p, owner_kind: direct[0], owner_name: direct[1] });
    add("P6", { ...p, node: opts.node ?? NODES[spread++ % NODES.length] });
    add("P7", { ...p, container: "main" }, 0);
    add("P10", { ...p, container: "main" });
    if (opts.cpuRequest !== 0) {
      add("P8", { ...p, container: "main", resource: "cpu" }, opts.cpuRequest ?? 0.5);
      add("P9", { ...p, container: "main", resource: "memory" }, opts.memoryLimit ?? 256 * MI);
    }
    const k = { k8s_namespace_name: namespace, k8s_pod_name: name, k8s_pod_uid: name };
    if (opts.cpu !== 0) usage("K1", k, opts.cpu ?? 0.2);
    if (opts.memory !== 0) usage("K2", k, opts.memory ?? 100 * MI);
    return p;
  };
  const deployment = (namespace: string, name: string, hash: string, suffixes: string[]) => {
    for (const s of suffixes)
      pod(namespace, `${name}-${hash}-${s}`, { rs: `${name}-${hash}`, deployment: name });
  };
  pod("commerce", "order-service-6xphqm265w-nb2sq", {
    ready: "false",
    rs: "order-service-6xphqm265w",
    deployment: "order-service",
  });
  pod("commerce", "inventory-service-blkdl5tcm2-94jdl", {
    rs: "inventory-service-blkdl5tcm2",
    deployment: "inventory-service",
    cpu: 0.4,
    memoryLimit: 100 * MI,
    memory: 92 * MI,
  });
  deployment("commerce", "cart-service", "7c6d5b4a3z", ["a1", "a2"]);
  deployment("commerce", "payment-service", "6b5c4d3e2f", ["b1", "b2"]);
  deployment("commerce", "catalog-service", "5a4b3c2d1e", ["c1", "c2"]);
  deployment("commerce", "checkout-service", "4z3y2x1w0v", ["d1", "d2"]);
  const crash = pod("data", "recommendation-service-9x58zgdb6z-sclvv", {
    ready: "false",
    rs: "recommendation-service-9x58zgdb6z",
    deployment: "recommendation-service",
    cpu: 0.1,
    memory: 50 * MI,
  });
  add("P2", { ...crash, container: "main", reason: "CrashLoopBackOff" });
  deployment("data", "recommendation-service", "9x58zgdb6z", ["jwhzq"]);
  deployment("data", "analytics-service", "x6xv7pjxhb", ["zqcl4"]);
  pod("data", "analytics-backfill-hc9zb", {
    phase: "Failed",
    ready: null,
    job: "analytics-backfill",
    cpuRequest: 0,
    cpu: 0,
    memory: 0,
  });
  pod("data", "postgres-0", { ss: "postgres" });
  pod("data", "postgres-1", { ss: "postgres" });
  deployment("data", "etl-service", "3q2w1e0r9t", ["e1", "e2"]);
  pod("chat", "chat-service-8g7f88v79d-2hth6", {
    rs: "chat-service-8g7f88v79d",
    deployment: "chat-service",
    cpu: 0.025,
  });
  deployment("chat", "chat-service", "8g7f88v79d", ["k2j4m"]);
  pod("chat", "user-session-service-rm5b8ldqdv-l4phb", {
    rs: "user-session-service-rm5b8ldqdv",
    deployment: "user-session-service",
    cpu: 0.025,
  });
  deployment("chat", "user-session-service", "rm5b8ldqdv", ["p8x7c"]);
  deployment("chat", "notification-service", "2n3m4b5v6c", ["f1", "f2"]);
  pod("media", "transcoding-service-nkgbp5xp5l-vwvn2", {
    phase: "Pending",
    ready: null,
    rs: "transcoding-service-nkgbp5xp5l",
    deployment: "transcoding-service",
    node: "",
    cpu: 0,
    memory: 0,
  });
  deployment("media", "media-service", "1a2s3d4f5g", ["g1", "g2"]);
  deployment("media", "thumbnail-service", "6h7j8k9l0z", ["h1", "h2"]);
  for (const [i, node] of NODES.entries())
    pod("monitoring", `fluent-bit-${i}x7q`, { ds: "fluent-bit", node });
  pod("monitoring", "prometheus-0", { ss: "prometheus" });
  deployment("gateway", "api-gateway", "5d8f7c9b4f", ["x2k9p", "m3n7q"]);
  deployment("gateway", "auth-service", "8c7v6b5n4m", ["i1", "i2"]);
  pod("default", "debug-shell", { cpuRequest: 0, cpu: 0 });
  deployment("default", "nginx-test", "0p9o8i7u6y", ["j1", "j2"]);
  for (const node of NODES) {
    add("N1", { node, condition: "Ready", status: "true" });
    add("N2", { node, resource: "cpu" }, 4);
    add("N2", { node, resource: "memory" }, 16 * 1024 * MI);
    usage("K3", { k8s_node_name: node }, 1);
    usage("K4", { k8s_node_name: node }, 4 * 1024 * MI);
  }
  add("N1", { node: NODES[1], condition: "MemoryPressure", status: "true" });
  return results;
}

const inventory = (results = generatorResults()): Inventory => buildInventory(results);

const byName = (rows: MapRow[], ref: string) =>
  rows.find((r) => `${r.namespace}/${r.name}` === ref)!;

const mapState = (query: Record<string, string> = {}): K8sUrlState =>
  parseUrlState({ view: "map", cluster: GEN, ...query });

let wrapper: VueWrapper<any>;

const mountView = async (
  state = mapState(),
  inv = inventory(),
  over: Partial<{ anchorMissing: string | null; loading: boolean }> = {},
) => {
  wrapper = mount(MapView, {
    props: {
      state,
      pods: inv.pods,
      nodes: inv.nodes,
      namespaceOptions: ["chat", "commerce", "data", "default", "gateway", "media", "monitoring"],
      anchorMissing: null,
      loading: false,
      lastUpdatedAt: 1_700_000_000_000,
      ...over,
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const byTest = (component: any, id: string) =>
  wrapper.findAllComponents(component).find((c: any) => c.vm.$attrs["data-test"] === id) as any;
const hexMap = () => wrapper.findComponent({ name: "K8sHexMap" });
const options = () => wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;
const hexRows = (): MapRow[] =>
  hexMap()
    .props("groups")
    .flatMap((g: any) => g.rows);
const hexIndex = (ref: string) => hexRows().findIndex((r) => `${r.namespace}/${r.name}` === ref);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1200,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 700,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
});

afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as any).clientWidth;
  delete (HTMLElement.prototype as any).clientHeight;
});

describe("MapView hex counts (AC 42)", () => {
  it("draws 41 pod hexes and 4 node hexes", async () => {
    await mountView();
    expect(options().series[0].data).toHaveLength(41);
    expect(wrapper.find('[data-test="k8s2-list-count"]').text()).toBe("41 pods");
    wrapper.unmount();
    await mountView(mapState({ entity: "nodes" }));
    expect(options().series[0].data).toHaveLength(4);
    expect(wrapper.find('[data-test="k8s2-list-count"]').text()).toBe("4 nodes");
  });

  it("removes hexes that the namespace and search filters exclude, and the count follows", async () => {
    await mountView(mapState({ namespace: "commerce" }));
    expect(options().series[0].data).toHaveLength(10);
    expect(wrapper.find('[data-test="k8s2-list-count"]').text()).toContain("10 / 41");
    wrapper.unmount();
    await mountView(mapState({ search: "inventory" }));
    expect(options().series[0].data).toHaveLength(1);
    expect(wrapper.find('[data-test="k8s2-list-count"]').text()).toContain("1 / 41");
  });
});

describe("MapView fill buckets (AC 43)", () => {
  it("puts inventory-service, at about 92% of its limit, in the hottest occupied memLim bucket", async () => {
    const { pods } = inventory();
    const inv = byName(pods, INVENTORY);
    expect(fillValue(inv, "memLim")).toBeCloseTo(92, 6);
    const classes = pods
      .map((p) => fillClass(p, "memLim"))
      .filter((c) => c !== "noData")
      .sort();
    expect(fillClass(inv, "memLim")).toBe(classes[classes.length - 1]);
    for (const p of pods)
      expect(fillValue(p, "memLim") ?? 0).toBeLessThanOrEqual(fillValue(inv, "memLim")!);
  });

  it("puts chat-service and user-session-service in the coldest cpuReq bucket with the lowest values", async () => {
    const { pods } = inventory();
    const values = pods.map((p) => fillValue(p, "cpuReq")).filter((v): v is number => v != null);
    const lowest = Math.min(...values);
    for (const ref of [
      "chat/chat-service-8g7f88v79d-2hth6",
      "chat/user-session-service-rm5b8ldqdv-l4phb",
    ]) {
      const p = byName(pods, ref);
      expect(fillClass(p, "cpuReq")).toBe("b1");
      expect(fillValue(p, "cpuReq")).toBe(lowest);
    }
    expect(values.filter((v) => v === lowest)).toHaveLength(2);
  });

  it("draws pods with no request or no usage in the No data swatch", async () => {
    await mountView();
    const noData = options().series[0].data[hexIndex("default/debug-shell")][2];
    expect(
      options().series[0].data[hexIndex("media/transcoding-service-nkgbp5xp5l-vwvn2")][2],
    ).toBe(noData);
    expect(fillClass(byName(hexRows(), "default/debug-shell"), "cpuReq")).toBe("noData");
    expect(options().series[0].data[hexIndex(INVENTORY)][2]).not.toBe(noData);
    expect(wrapper.find('[data-test="k8s2-map-legend-noData"]').text()).toBe("No data");
    expect(wrapper.find('[data-test="k8s2-map-legend-b5"]').text()).toBe("≥ 100%");
  });
});

describe("MapView groups (AC 44, 45)", () => {
  it("groups by namespace into 7 groups ordered by size then name, summing to 41", async () => {
    await mountView(mapState({ group: "namespace" }));
    const groups = hexMap().props("groups");
    expect(groups.map((g: any) => [g.name, g.rows.length])).toEqual([
      ["commerce", 10],
      ["data", 8],
      ["chat", 6],
      ["media", 5],
      ["monitoring", 5],
      ["gateway", 4],
      ["default", 3],
    ]);
    expect(wrapper.findAll('[data-test="k8s2-map-group-link"]')).toHaveLength(7);
  });

  it('puts each pod in its node\'s frame with the node status word, and node="" in Unscheduled', async () => {
    await mountView();
    const groups = hexMap().props("groups");
    const labels: string[] = hexMap().props("frameLabels");
    for (const g of groups) {
      for (const row of g.rows) expect(g.special ? "" : g.name).toBe(row.node);
    }
    const unscheduled = groups.find((g: any) => g.special === "unscheduled");
    expect(unscheduled.rows.map((r: MapRow) => r.name)).toEqual([
      "transcoding-service-nkgbp5xp5l-vwvn2",
    ]);
    expect(labels[groups.indexOf(unscheduled)]).toBe("Unscheduled (1)");
    const pressured = groups.findIndex((g: any) => g.name === NODES[1]);
    expect(labels[pressured]).toBe(
      `MemoryPressure · ${NODES[1]} (${groups[pressured].rows.length})`,
    );
    const ready = groups.findIndex((g: any) => g.name === NODES[0]);
    expect(labels[ready]).toBe(`Ready · ${NODES[0]} (${groups[ready].rows.length})`);
  });

  it("groups by workload: Deployment via ReplicaSet, DaemonSet, and No owner", async () => {
    const groups = groupRows(inventory().pods, "workload");
    const named = (name: string) => groups.find((g) => g.name === name)!;
    expect(
      named("Deployment api-gateway")
        .rows.map((r) => r.name)
        .sort(),
    ).toEqual(["api-gateway-5d8f7c9b4f-m3n7q", "api-gateway-5d8f7c9b4f-x2k9p"]);
    expect(named("DaemonSet fluent-bit").rows.every((r) => r.name.startsWith("fluent-bit-"))).toBe(
      true,
    );
    expect(named("DaemonSet fluent-bit").rows).toHaveLength(4);
    expect(groups.find((g) => g.special === "noOwner")!.rows.map((r) => r.name)).toEqual([
      "debug-shell",
    ]);
  });
});

describe("MapView status fill (AC 46)", () => {
  it("colours errors, warnings and ok by the ⚠ rules", async () => {
    const { pods } = inventory();
    expect(statusClass(byName(pods, CRASH))).toBe("error");
    expect(statusClass(byName(pods, "data/analytics-backfill-hc9zb"))).toBe("error");
    expect(statusClass(byName(pods, "commerce/order-service-6xphqm265w-nb2sq"))).toBe("warning");
    expect(statusClass(byName(pods, "media/transcoding-service-nkgbp5xp5l-vwvn2"))).toBe("warning");
    expect(statusClass(byName(pods, HEALTHY))).toBe("ok");
  });

  it("agrees with the ⚠ column for every fixture row", async () => {
    const { pods, nodes } = inventory();
    for (const row of [...pods, ...nodes]) {
      const cls = statusClass(row);
      const severity = severityOf(row.warnings);
      if (severity) expect(cls).toBe(severity);
      else expect(["ok", "noData"]).toContain(cls);
    }
  });

  it("renders No data, never ok, when the healthy pod's P11 series is absent or P11 is rejected", async () => {
    const absent = generatorResults();
    absent.set(
      "P11",
      absent.get("P11")!.filter((s) => s.metric.pod !== "api-gateway-5d8f7c9b4f-x2k9p"),
    );
    expect(statusClass(byName(inventory(absent).pods, HEALTHY))).toBe("noData");
    const rejected = generatorResults();
    rejected.delete("P11");
    expect(statusClass(byName(inventory(rejected).pods, HEALTHY))).toBe("noData");
  });

  it("renders a node with no N1 Ready condition as No data", async () => {
    const results = generatorResults();
    results.set(
      "N1",
      results
        .get("N1")!
        .filter((s) => !(s.metric.node === NODES[2] && s.metric.condition === "Ready")),
    );
    const node = inventory(results).nodes.find((n) => n.name === NODES[2])!;
    expect(statusClass(node)).toBe("noData");
  });

  it("draws the status legend as ok, warning, error and No data", async () => {
    await mountView(mapState({ fill: "status" }));
    const tags = wrapper.findAll('[data-test^="k8s2-map-legend-"]').map((w) => w.text());
    expect(tags).toEqual(["OK", "Warning", "Error", "No data"]);
  });
});

describe("MapView hover and click (AC 47)", () => {
  it("shows name, namespace, node, the fill value and status in the tooltip", async () => {
    await mountView(mapState({ fill: "memLim" }));
    const row = byName(hexRows(), INVENTORY) as any;
    const tip: string = options().tooltip.formatter({
      seriesIndex: 0,
      dataIndex: hexIndex(INVENTORY),
    });
    expect(tip).toContain("inventory-service-blkdl5tcm2-94jdl");
    expect(tip).toContain("Namespace: commerce");
    expect(tip).toContain(`Node: ${row.node}`);
    expect(tip).toContain("Memory % of limit: 92%");
    expect(tip).toContain("Status: Running");
  });

  it("opens the pod's drawer on a hex click", async () => {
    await mountView();
    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      seriesIndex: 0,
      dataIndex: hexIndex(INVENTORY),
    });
    expect(wrapper.emitted("open")).toEqual([
      [
        {
          kind: "pod",
          cluster: GEN,
          namespace: "commerce",
          name: "inventory-service-blkdl5tcm2-94jdl",
        },
      ],
    ]);
  });

  it("opens a node's drawer on a node hex click", async () => {
    await mountView(mapState({ entity: "nodes" }));
    wrapper
      .findComponent({ name: "ChartRenderer" })
      .vm.$emit("click", { seriesIndex: 0, dataIndex: 0 });
    const [[ref]] = wrapper.emitted("open") as any;
    expect(ref).toMatchObject({ kind: "node", cluster: GEN, namespace: "" });
    expect(NODES).toContain(ref.name);
  });
});

describe("MapView URL updates (AC 48)", () => {
  it("emits entity, fill, group, search and namespace changes", async () => {
    await mountView();
    byTest(OToggleGroup, "k8s2-map-entity").vm.$emit("update:modelValue", "nodes");
    byTest(OSelect, "k8s2-map-fill").vm.$emit("update:modelValue", "memLim");
    byTest(OSelect, "k8s2-map-group").vm.$emit("update:modelValue", "workload");
    wrapper.findComponent({ name: "K8sListHeader" }).vm.$emit("update:search", "api");
    wrapper.findComponent({ name: "K8sListHeader" }).vm.$emit("update:namespaces", ["data"]);
    expect(wrapper.emitted("update")).toEqual([
      [{ entity: "nodes" }],
      [{ fill: "memLim" }],
      [{ group: "workload" }],
      [{ search: "api" }],
      [{ namespaces: ["data"] }],
    ]);
  });

  it("offers the node fills and no Group by or namespace filter for nodes", async () => {
    await mountView(mapState({ entity: "nodes", fill: "memory" }));
    const fills = byTest(OSelect, "k8s2-map-fill")
      .props("options")
      .map((o: any) => o.value);
    expect(fills).toEqual(["cpu", "memory", "status"]);
    expect(wrapper.find('[data-test="k8s2-map-group"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="k8s2-namespace-select"]').exists()).toBe(false);
  });

  it("emits refresh from the header refresh button", async () => {
    await mountView();
    await wrapper.find('[data-test="k8s2-map-refresh"]').trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });
});

describe("MapView empty states (AC 49)", () => {
  it("shows the anchor empty state naming the stream", async () => {
    await mountView(mapState(), inventory(), { anchorMissing: "kube_pod_status_phase" });
    const empty = wrapper.find('[data-test="k8s2-map-anchor-empty"]');
    expect(empty.text()).toContain("No pod data");
    expect(empty.text()).toContain("kube_pod_status_phase");
    expect(wrapper.findComponent({ name: "K8sHexMap" }).exists()).toBe(false);
  });

  it("shows No pods match with clear when a filter matches nothing", async () => {
    await mountView(mapState({ search: "nothing-matches" }));
    const empty = byTest(OEmptyState, "k8s2-map-empty");
    expect(empty.text()).toContain("No pods match");
    expect(empty.props("filtered")).toBe(true);
    empty.vm.$emit("action", "clear-filters");
    expect(wrapper.emitted("update")).toEqual([[{ namespaces: [], search: "" }]]);
  });

  it("draws every hex as No data with fill=cpuReq when k8s_pod_cpu_usage is absent", async () => {
    const results = generatorResults();
    results.delete("K1");
    await mountView(mapState(), inventory(results));
    const classes = new Set(options().series[0].data.map((d: number[]) => d[2]));
    expect(classes.size).toBe(1);
    expect(hexRows().every((r) => fillClass(r, "cpuReq") === "noData")).toBe(true);
  });
});

describe("MapView accessibility and fallback (AC 51)", () => {
  it("labels the canvas wrapper with the count, grouping and fill", async () => {
    await mountView(mapState({ fill: "memLim" }));
    const canvas = wrapper.find('[data-test="k8s2-map-canvas"]');
    expect(canvas.attributes("role")).toBe("img");
    expect(canvas.attributes("aria-label")).toBe(
      "Map of 41 pods grouped by Node, filled by Memory % of limit",
    );
  });

  it.each([
    ["memLim", "memLim"],
    ["cpuReq", "cpuReq"],
    ["cpuLim", "cpuLim"],
    ["memReq", "memReq"],
    ["restarts", "restarts"],
    ["status", "warnings"],
  ])(
    "Show as list with fill=%s opens the Pods list sorted by %s, keeping namespace and search",
    async (fill, sort) => {
      const state = mapState({ fill, namespace: "commerce", search: "service" });
      await mountView(state);
      await wrapper.find('[data-test="k8s2-map-show-list"]').trigger("click");
      const [[target]] = wrapper.emitted("navigate") as any;
      expect(target).toEqual(listTarget(state));
      expect(target).toMatchObject({
        view: "pods",
        sort,
        desc: true,
        namespaces: ["commerce"],
        search: "service",
      });
    },
  );

  it("links a namespace group to the Pods list, a node to its drawer and a workload to its drawer", async () => {
    await mountView(mapState({ group: "namespace" }));
    await wrapper.findAll('[data-test="k8s2-map-group-link"]')[0].trigger("click");
    expect((wrapper.emitted("navigate") as any)[0][0]).toMatchObject({
      view: "pods",
      namespaces: ["commerce"],
    });
    wrapper.unmount();

    await mountView();
    const nodeLink = wrapper
      .findAll('[data-test="k8s2-map-group-link"]')
      .find((l) => l.text().startsWith(NODES[0]))!;
    await nodeLink.trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "node", cluster: GEN, namespace: "", name: NODES[0] }],
    ]);
    expect(wrapper.find('[data-test="k8s2-map-group-text"]').text()).toBe("Unscheduled (1)");
    wrapper.unmount();

    await mountView(mapState({ group: "workload" }));
    const gateway = wrapper
      .findAll('[data-test="k8s2-map-group-link"]')
      .find((l) => l.text().startsWith("Deployment api-gateway"))!;
    await gateway.trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "deployment", cluster: GEN, namespace: "gateway", name: "api-gateway" }],
    ]);
    expect(wrapper.findAll('[data-test="k8s2-map-group-text"]').map((w) => w.text())).toEqual([
      "No owner (1)",
    ]);
  });

  it("caps the group links at 50, then offers Show all 300 in list", async () => {
    const results: QueryResults = new Map(ANSWERED.map((id) => [id, [] as Series[]]));
    for (let i = 0; i < 300; i++) {
      const p = { k8s_cluster: GEN, namespace: "bulk", pod: `svc-${i}-abc-x`, uid: `u${i}` };
      results.get("P1")!.push({ metric: { ...p, phase: "Running" }, value: 1 });
      results
        .get("P4")!
        .push({ metric: { ...p, owner_kind: "ReplicaSet", owner_name: `svc-${i}-abc` }, value: 1 });
      results.get("P5")!.push({
        metric: {
          k8s_cluster: GEN,
          namespace: "bulk",
          replicaset: `svc-${i}-abc`,
          owner_kind: "Deployment",
          owner_name: `svc-${i}`,
        },
        value: 1,
      });
    }
    const state = mapState({ group: "workload" });
    await mountView(state, buildInventory(results));
    expect(wrapper.findAll('[data-test="k8s2-map-group-link"]')).toHaveLength(50);
    const all = wrapper.find('[data-test="k8s2-map-show-all"]');
    expect(all.text()).toBe("Show all 300 in list");
    await all.trigger("click");
    expect(wrapper.emitted("navigate")).toEqual([[listTarget(state)]]);
  });
});
