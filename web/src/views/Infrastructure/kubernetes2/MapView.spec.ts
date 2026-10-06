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
import { createStore } from "vuex";
import i18n from "@/locales";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import MapView from "./MapView.vue";
import {
  ANSWERED,
  CRASH,
  GEN,
  HEALTHY,
  INVENTORY,
  NODES,
  byName,
  generatorResults,
  inventory,
  labelledInventory,
  observed,
} from "./__fixtures__/mapInventory";
import { buildInventory, severityOf, type QueryResults, type Series } from "./kubernetesModel";
import { parseUrlState, type K8sUrlState } from "./kubernetesUrlState";
import { fillClass, fillValue, groupRows, listTarget, statusClass, type MapRow } from "./mapFill";
import type { MapObjects } from "./mapFilter";

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

const mapState = (query: Record<string, string> = {}): K8sUrlState =>
  parseUrlState({ view: "map", cluster: GEN, ...query });

let wrapper: VueWrapper<any>;

const mountView = async (
  state = mapState(),
  inv = inventory(),
  over: Partial<{
    anchorMissing: string | null;
    loading: boolean;
    forbidden: boolean;
    objects: MapObjects;
  }> = {},
) => {
  wrapper = mount(MapView, {
    props: {
      state,
      pods: inv.pods,
      nodes: inv.nodes,
      namespaceOptions: ["chat", "commerce", "data", "default", "gateway", "media", "monitoring"],
      anchorMissing: null,
      objects: { state: "ok" },
      forbidden: false,
      loading: false,
      lastUpdatedAt: 1_700_000_000_000,
      ...over,
    },
    global: { plugins: [i18n, createStore({ state: { theme: "light" } })] },
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
const countText = () =>
  wrapper.find('[data-test="k8s2-list-count"]').text().replace(/\s+/g, " ").trim();
const legendItems = () => wrapper.findAll('[data-test^="k8s2-map-legend-"]');
const legendCount = (item: any) => Number(item.find('[data-test="k8s2-map-count"]').text());
const filterOptions = () => byTest(OSelect, "k8s2-map-filter").props("options") as any[];
const groupOptions = () => byTest(OSelect, "k8s2-map-group").props("options") as any[];
const updates = () => (wrapper.emitted("update") ?? []).map(([patch]: any) => patch);
const GATEWAY = "app.kubernetes.io/name:api-gateway";

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
    const noData = options().series[0].data[hexIndex("gateway/debug-shell")][2];
    expect(
      options().series[0].data[hexIndex("media/transcoding-service-nkgbp5xp5l-vwvn2")][2],
    ).toBe(noData);
    expect(fillClass(byName(hexRows(), "gateway/debug-shell"), "cpuReq")).toBe("noData");
    expect(options().series[0].data[hexIndex(INVENTORY)][2]).not.toBe(noData);
    const range = (cls: string) =>
      wrapper.find(`[data-test="k8s2-map-legend-${cls}"] [data-test="k8s2-map-range"]`).text();
    expect(range("noData")).toBe("No data");
    expect(range("b5")).toBe("≥ 100%");
  });
});

describe("MapView groups (AC 44, 45)", () => {
  it("groups by namespace into 6 groups ordered by size then name, summing to 41, with none for the empty default namespace", async () => {
    await mountView(mapState({ group: "namespace" }));
    const groups = hexMap().props("groups");
    expect(groups.map((g: any) => [g.name, g.rows.length])).toEqual([
      ["commerce", 10],
      ["data", 8],
      ["gateway", 7],
      ["chat", 6],
      ["media", 5],
      ["monitoring", 5],
    ]);
    expect(wrapper.findAll('[data-test="k8s2-map-group-link"]')).toHaveLength(6);
    expect(
      hexMap()
        .props("headers")
        .map((h: any) => h.title),
    ).toEqual(["commerce", "data", "gateway", "chat", "media", "monitoring"]);
  });

  it('puts each pod in its node\'s card, with the node status word on line 2, and node="" in Unscheduled', async () => {
    await mountView();
    const groups = hexMap().props("groups");
    const headers = hexMap().props("headers");
    for (const g of groups) {
      for (const row of g.rows) expect(g.special ? "" : g.name).toBe(row.node);
    }
    const unscheduled = groups.findIndex((g: any) => g.special === "unscheduled");
    expect(groups[unscheduled].rows.map((r: MapRow) => r.name)).toEqual([
      "transcoding-service-nkgbp5xp5l-vwvn2",
    ]);
    expect(headers[unscheduled]).toMatchObject({ title: "Unscheduled", count: "1", word: null });
    const pressured = groups.findIndex((g: any) => g.name === NODES[1]);
    expect(headers[pressured]).toMatchObject({
      title: "ip-10-0-13-37",
      count: String(groups[pressured].rows.length),
      word: { text: "MemoryPressure", tone: "warning" },
    });
    const ready = groups.findIndex((g: any) => g.name === NODES[0]);
    expect(headers[ready]).toMatchObject({ title: "ip-10-0-10-38", word: { text: "Ready" } });
    const short = headers
      .filter((h: any, i: number) => !groups[i].special)
      .map((h: any) => h.title);
    expect(short.sort()).toEqual([
      "ip-10-0-10-38",
      "ip-10-0-11-39",
      "ip-10-0-12-36",
      "ip-10-0-13-37",
    ]);
    expect(headers[pressured].tip).toContain(NODES[1]);
  });

  it("groups by workload: Deployment via ReplicaSet, DaemonSet, and No owner", async () => {
    await mountView(mapState({ group: "workload" }));
    const headers = hexMap().props("headers");
    expect(headers.find((h: any) => h.title === "api-gateway").word).toEqual({
      text: "deploy",
      tone: null,
    });
    expect(headers.find((h: any) => h.title === "fluent-bit").word).toEqual({
      text: "ds",
      tone: null,
    });
    expect(headers.find((h: any) => h.title === "No owner").word).toBeNull();
    const { groups } = groupRows(inventory().pods, "workload");
    const named = (name: string) => groups.find((g) => g.name === name)!;
    expect(
      named("api-gateway")
        .rows.map((r) => r.name)
        .sort(),
    ).toEqual(["api-gateway-5d8f7c9b4f-m3n7q", "api-gateway-5d8f7c9b4f-x2k9p"]);
    expect(named("fluent-bit").rows.every((r) => r.name.startsWith("fluent-bit-"))).toBe(true);
    expect(named("fluent-bit").rows).toHaveLength(4);
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
    const tags = legendItems().map((w) => w.find('[data-test="k8s2-map-range"]').text());
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
    expect(tip).toContain("commerce · Deployment/inventory-service");
    expect(tip).toContain(`Node: ${row.node}`);
    expect(tip).toContain("Memory % of limit: 92%");
    expect(tip).toContain("Running");
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

  it("offers the node fills, None or a label as the node grouping, and no namespace filter", async () => {
    await mountView(mapState({ entity: "nodes", fill: "memory" }), labelledInventory());
    const fills = byTest(OSelect, "k8s2-map-fill")
      .props("options")
      .map((o: any) => o.value);
    expect(fills).toEqual(["cpu", "memory", "status"]);
    const groups = groupOptions();
    expect(groups[0].value).toBe("none");
    expect(groups.find((o) => o.header).label).toBe("Labels (seen on 4 of 4 nodes)");
    expect(groups.map((o) => o.value)).toContain("label.topology.kubernetes.io/zone");
    expect(groups.map((o) => o.value)).not.toContain("node");
    expect(wrapper.find('[data-test="k8s2-namespace-select"]').exists()).toBe(false);
  });

  it("emits refresh from the header refresh button", async () => {
    await mountView();
    await wrapper.find('[data-test="k8s2-map-refresh"]').trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });
});

describe("MapView on phones (§4.8)", () => {
  it("keeps the canvas at least 24rem tall and gives the filter its own row", async () => {
    await mountView();
    expect(wrapper.find('[data-test="k8s2-map-area"]').classes()).toContain("max-md:min-h-96");
    expect(wrapper.find('[data-test="k8s2-map-filter"]').classes()).toContain("max-md:w-full");
    expect(wrapper.find('[data-test="k8s2-map-scale"]').classes()).toContain("shrink-0");
  });
});

describe("MapView empty states (AC 49)", () => {
  it("shows the no-access state, not a partial map, when the anchor query is forbidden", async () => {
    await mountView(mapState(), inventory(), { forbidden: true });
    expect(wrapper.find('[data-test="k8s2-map-forbidden"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "K8sHexMap" }).exists()).toBe(false);
  });

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
    expect(wrapper.emitted("update")).toEqual([[{ namespaces: [], search: "", filter: [] }]]);
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
    expect(wrapper.find('[data-test="k8s2-map-group-disclosure"]').text()).toContain(
      "Unscheduled (1)",
    );
    wrapper.unmount();

    await mountView(mapState({ group: "workload" }));
    const gateway = wrapper
      .findAll('[data-test="k8s2-map-group-link"]')
      .find((l) => l.text().startsWith("api-gateway"))!;
    await gateway.trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "deployment", cluster: GEN, namespace: "gateway", name: "api-gateway" }],
    ]);
    expect(wrapper.findAll('[data-test="k8s2-map-group-disclosure"]').map((w) => w.text())).toEqual(
      ["No owner (1)"],
    );
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
    expect(hexMap().props("groups")).toHaveLength(300);
    const all = wrapper.find('[data-test="k8s2-map-show-all"]');
    expect(all.text()).toBe("Show all 300 in list");
    await all.trigger("click");
    expect(wrapper.emitted("navigate")).toEqual([[listTarget(state)]]);
  });
});

describe("MapView label filter: hidden, not dimmed (AC 79)", () => {
  it("draws only the matching pods and re-counts header and legend", async () => {
    await mountView(mapState({ filter: GATEWAY }), labelledInventory());
    expect(
      hexRows()
        .map((r) => r.name)
        .sort(),
    ).toEqual(["api-gateway-5d8f7c9b4f-m3n7q", "api-gateway-5d8f7c9b4f-x2k9p"]);
    expect(countText()).toContain("Filtered: 2 / 41");
    expect(legendItems().reduce((sum, item) => sum + legendCount(item), 0)).toBe(2);
    await wrapper.find('[data-test="k8s2-list-filtered-clear"]').trigger("click");
    expect(updates()).toEqual([{ namespaces: [], search: "", filter: [] }]);
  });

  it("keeps the trigger plain: Filter (1), with no chip or nested button", async () => {
    await mountView(mapState({ filter: GATEWAY }), labelledInventory());
    const select = wrapper.find('[data-test="k8s2-map-filter"]');
    const trigger = select.find("button");
    expect(trigger.text()).toBe("Filter (1)");
    expect(trigger.findAll("button")).toHaveLength(0);
    expect(select.findComponent(ODimensionChip).exists()).toBe(false);
  });

  it("shows one removable chip per term, with Clear, only while the filter is set", async () => {
    await mountView(mapState({ filter: GATEWAY }), labelledInventory());
    const row = wrapper.find('[data-test="k8s2-map-filter-chips"]');
    const chips = row.findAllComponents(ODimensionChip);
    expect(chips).toHaveLength(1);
    expect(chips[0].props()).toMatchObject({
      dimKey: "app.kubernetes.io/name",
      value: "api-gateway",
      removable: true,
      removeDataTest: "k8s2-map-filter-chip-remove",
    });
    await row.find('[data-test="k8s2-map-filter-chip-remove"]').trigger("click");
    await row.find('[data-test="k8s2-map-filter-clear"]').trigger("click");
    expect(updates()).toEqual([{ filter: [] }, { filter: [] }]);
    wrapper.unmount();
    await mountView(mapState(), labelledInventory());
    expect(wrapper.find('[data-test="k8s2-map-filter-chips"]').exists()).toBe(false);
  });

  it("notes that the list ignores the filter, and Show as list stays enabled", async () => {
    await mountView(mapState({ filter: GATEWAY }), labelledInventory());
    expect(
      wrapper.find('[data-test="k8s2-map-filter-chips"] [data-test="k8s2-map-list-note"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="k8s2-list-header"] [data-test="k8s2-map-show-list"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="k8s2-map-controls"] [data-test="k8s2-map-show-list"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-test="k8s2-map-list-note"]').text()).toBe(
      "List ignores the map filter",
    );
    expect(wrapper.find('[data-test="k8s2-map-show-list"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
    await mountView(mapState(), labelledInventory());
    expect(wrapper.find('[data-test="k8s2-map-list-note"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="k8s2-map-show-list"]').attributes("disabled")).toBeUndefined();
  });

  it("emits picked terms, and builds options before search and the filter (AC 78)", async () => {
    await mountView(mapState({ filter: GATEWAY, search: "inventory" }), labelledInventory());
    const values = filterOptions().map((o) => o.value);
    expect(values).toContain("app.kubernetes.io/name:cart-service");
    expect(values).toContain(GATEWAY);
    byTest(OSelect, "k8s2-map-filter").vm.$emit("update:modelValue", [
      GATEWAY,
      "app.kubernetes.io/name:cart-service",
    ]);
    expect(updates()).toEqual([{ filter: [GATEWAY, "app.kubernetes.io/name:cart-service"] }]);
  });
});

describe("MapView label states (AC 80)", () => {
  const unlabelled = () => inventory();
  const pickerText = () =>
    filterOptions()
      .map((o) => String(o.label))
      .join(" | ");

  it("says no pod labels were seen when the query ran and found none", async () => {
    await mountView(mapState(), unlabelled());
    expect(filterOptions()).toEqual([
      expect.objectContaining({
        label: "No pod labels seen in the last 24 hours",
        disabled: true,
      }),
    ]);
  });

  it.each([
    [{ state: "skipped", reason: "noStream" }, "Labels need Kubernetes objects in k8s_events"],
    [
      { state: "skipped", reason: "unscoped" },
      "Labels unavailable: k8s_events has no cluster label",
    ],
    [{ state: "loading" }, "Loading labels…"],
    [{ state: "failed" }, "Labels could not be loaded (query failed)"],
  ] as [MapObjects, string][])("explains %j in one disabled row", async (objects, text) => {
    await mountView(mapState(), labelledInventory(), { objects });
    expect(pickerText()).toBe(text);
    expect(pickerText()).not.toContain("seen");
    expect(groupOptions().map((o) => String(o.label))).toContain(text);
  });

  it.each([
    [{ state: "loading" }],
    [{ state: "skipped", reason: "unscoped" }],
    [{ state: "failed" }],
  ] as [MapObjects][])(
    "replaces the canvas with Filter unavailable while %j, and its action clears the filter",
    async (objects) => {
      await mountView(mapState({ filter: GATEWAY }), labelledInventory(), { objects });
      const empty = byTest(OEmptyState, "k8s2-map-filter-unavailable");
      expect(empty.text()).toContain("Filter unavailable");
      expect(wrapper.find('[data-test="k8s2-map-empty"]').exists()).toBe(false);
      expect(hexMap().exists()).toBe(false);
      empty.vm.$emit("action");
      expect(updates()).toEqual([{ filter: [] }]);
    },
  );

  it("resets a label grouping from Filter unavailable", async () => {
    const state = mapState({ group: "label.app.kubernetes.io/name" });
    await mountView(state, labelledInventory(), { objects: { state: "failed" } });
    byTest(OEmptyState, "k8s2-map-filter-unavailable").vm.$emit("action");
    expect(updates()).toEqual([{ group: "node" }]);
  });

  it("filters once labels are ok, with the coverage header", async () => {
    await mountView(mapState({ filter: GATEWAY }), labelledInventory());
    expect(hexRows()).toHaveLength(2);
    expect(filterOptions()[0]).toMatchObject({
      header: true,
      label: "Labels (seen on 39 of 41 pods)",
    });
  });

  it("adds the coverage suffix while a label term or group is active, and only then", async () => {
    await mountView(mapState({ filter: GATEWAY }), labelledInventory());
    expect(countText()).toBe("Filtered: 2 / 41 · labels seen on 39 of 41");
    wrapper.unmount();
    await mountView(mapState({ group: "label.app.kubernetes.io/name" }), labelledInventory());
    expect(countText()).toBe("41 pods · labels seen on 39 of 41");
    wrapper.unmount();
    await mountView(mapState(), labelledInventory());
    expect(countText()).toBe("41 pods");
  });

  it("keeps a URL value missing from the data as a chip, matching nothing", async () => {
    await mountView(mapState({ filter: "app.kubernetes.io/name:ghost" }), labelledInventory());
    expect(wrapper.findAllComponents(ODimensionChip)[0].props("value")).toBe("ghost");
    const empty = byTest(OEmptyState, "k8s2-map-empty");
    expect(empty.props("filtered")).toBe(true);
    empty.vm.$emit("action", "clear-filters");
    expect(updates()).toEqual([{ namespaces: [], search: "", filter: [] }]);
  });
});

describe("MapView group headers and nav (AC 85)", () => {
  const clickHeader = (dataIndex: number) =>
    wrapper
      .findComponent({ name: "ChartRenderer" })
      .vm.$emit("click", { seriesIndex: 1, dataIndex });
  const indexOf = (pred: (g: any) => boolean) => hexMap().props("groups").findIndex(pred);

  it("navigates from a namespace header, opens a node's drawer, and ignores Unscheduled", async () => {
    await mountView(mapState({ group: "namespace" }));
    clickHeader(indexOf((g) => g.name === "commerce"));
    expect((wrapper.emitted("navigate") as any)[0][0]).toMatchObject({
      view: "pods",
      namespaces: ["commerce"],
    });
    wrapper.unmount();
    await mountView();
    clickHeader(indexOf((g) => g.name === NODES[2]));
    clickHeader(indexOf((g) => g.special === "unscheduled"));
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "node", cluster: GEN, namespace: "", name: NODES[2] }],
    ]);
    const headers = hexMap().props("headers");
    expect(headers[indexOf((g) => g.special === "unscheduled")].clickable).toBe(false);
    expect(headers[indexOf((g) => g.name === NODES[2])].clickable).toBe(true);
  });

  it("gives every header a tooltip with the full title, count and summary", async () => {
    await mountView(mapState({ group: "label.app.kubernetes.io/name" }), labelledInventory());
    const groups = hexMap().props("groups");
    const headers = hexMap().props("headers");
    const last = headers[groups.length - 1].tip;
    expect(last).toContain("No app.kubernetes.io/name");
    expect(last).toContain("2 pods");
    expect(last).toContain("0 without the label, 2 not observed");
    for (const h of headers) expect(h.tip).toMatch(/error, \d+ warning, \d+ OK/);
  });

  it("keeps the nav in the DOM, visually hidden, with ≤ 50 entries", async () => {
    await mountView(mapState({ group: "namespace" }));
    const nav = wrapper.find('[data-test="k8s2-map-groups"]');
    expect(nav.classes()).toEqual(expect.arrayContaining(["sr-only", "focus-within:not-sr-only"]));
    expect(nav.element.parentElement!.classList).toContain("absolute");
    expect(nav.element.parentElement!.classList).toContain("top-3");
    expect(nav.findAll('[data-test="k8s2-map-group-link"]')).toHaveLength(6);
  });

  it("draws 100 cards for a 2,000-value label and offers all 2,000 in the list", async () => {
    const inv = labelledInventory();
    const pods = Array.from({ length: 2000 }, (_, i) => ({
      ...inv.pods[0],
      key: `${GEN}/bulk/p${i}`,
      name: `p${i}`,
      namespace: "bulk",
      object: observed({ build: `b${i}` }),
    }));
    await mountView(mapState({ group: "label.build" }), { ...inv, pods } as any);
    expect(hexMap().props("groups")).toHaveLength(100);
    expect(wrapper.find('[data-test="k8s2-map-show-all"]').text()).toBe("Show all 2,000 in list");
    const headers = hexMap().props("headers");
    expect(headers[headers.length - 1].tip).toContain("Other (1,901 groups)");
  });

  it("renders no nav entries while ungrouped", async () => {
    await mountView(mapState({ entity: "nodes" }));
    expect(wrapper.find('[data-test="k8s2-map-groups"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="k8s2-map-group-link"]')).toHaveLength(0);
  });

  it("lists a label group's members in a closed disclosure that opens drawers", async () => {
    await mountView(mapState({ group: "label.app.kubernetes.io/name" }), labelledInventory());
    const disclosures = wrapper.findAllComponents(OCollapsible);
    expect(disclosures.length).toBe(hexMap().props("groups").length);
    expect(wrapper.findAll('[data-test="k8s2-map-group-member"]')).toHaveLength(0);
    const gateway = disclosures.find((d) => d.text().startsWith("api-gateway (2)"))!;
    await gateway.find("button").trigger("click");
    await flushPromises();
    const members = gateway.findAll('[data-test="k8s2-map-group-member"]');
    expect(members).toHaveLength(2);
    await members[0].trigger("click");
    expect((wrapper.emitted("open") as any)[0][0]).toMatchObject({
      kind: "pod",
      namespace: "gateway",
    });
  });

  it("caps a disclosure at 50 members, then says how many more", async () => {
    const inv = labelledInventory();
    const pods = Array.from({ length: 60 }, (_, i) => ({
      ...inv.pods[0],
      key: `${GEN}/bulk/p${i}`,
      name: `p${i}`,
      object: observed({ app: "big" }),
    }));
    await mountView(mapState({ group: "label.app" }), { ...inv, pods } as any);
    const big = wrapper.findAllComponents(OCollapsible)[0];
    await big.find("button").trigger("click");
    await flushPromises();
    expect(big.findAll('[data-test="k8s2-map-group-member"]')).toHaveLength(50);
    expect(big.text()).toContain("10 more: use search");
  });

  it("lists the transcoding pod under the Unscheduled disclosure", async () => {
    await mountView();
    const unscheduled = wrapper.findAllComponents(OCollapsible)[0];
    expect(unscheduled.text()).toContain("Unscheduled (1)");
    await unscheduled.find("button").trigger("click");
    await flushPromises();
    expect(unscheduled.find('[data-test="k8s2-map-group-member"]').text()).toBe(
      "transcoding-service-nkgbp5xp5l-vwvn2",
    );
  });
});

describe("MapView legend (AC 86)", () => {
  it("scales cpuReq in 6 steps and status in 4, each with a range and a count summing to the hexes", async () => {
    await mountView();
    expect(legendItems()).toHaveLength(6);
    expect(legendItems().reduce((sum, item) => sum + legendCount(item), 0)).toBe(41);
    for (const item of legendItems())
      expect(item.find('[data-test="k8s2-map-range"]').text()).not.toBe("");
    wrapper.unmount();
    await mountView(mapState({ fill: "status" }));
    expect(legendItems()).toHaveLength(4);
    expect(wrapper.find('[data-test="k8s2-map-scale"]').attributes("aria-label")).toBe(
      "Legend: Status",
    );
  });

  it("highlights the picked classes and clears them on a fill change", async () => {
    await mountView();
    byTest(OToggleGroup, "k8s2-map-scale").vm.$emit("update:modelValue", ["b5"]);
    await flushPromises();
    expect(hexMap().props("highlight")).toEqual(["b5"]);
    await wrapper.setProps({ state: mapState({ fill: "memLim" }) });
    expect(hexMap().props("highlight")).toEqual([]);
  });
});

describe("MapView selection (AC 88)", () => {
  it("passes the open drawer's row as the selected hex", async () => {
    const pod = byName(inventory().pods, CRASH);
    await mountView(mapState({ details: `pod/${GEN}/data/${pod.name}` }));
    expect(hexMap().props("selectedKey")).toBe(pod.key);
    wrapper.unmount();
    await mountView();
    expect(hexMap().props("selectedKey")).toBeNull();
  });
});

describe("MapView review fixes", () => {
  it("keeps label values whole: dotted suffixes are stripped from node names only", async () => {
    const inv = labelledInventory();
    inv.pods.forEach((p, i) => (p.object = observed({ version: i % 2 ? "1.5" : "2.5" })));
    await mountView(mapState({ group: "label.version" }), inv);
    expect(
      hexMap()
        .props("headers")
        .map((h: any) => h.title)
        .sort(),
    ).toEqual(["1.5", "2.5"]);
  });

  it("says no labels were seen when every observed key is noise or empty", async () => {
    const inv = labelledInventory();
    inv.pods.forEach((p) => (p.object = observed({ "pod-template-hash": "abc", tier: "" })));
    await mountView(mapState(), inv);
    expect(filterOptions()).toEqual([
      expect.objectContaining({ label: "No pod labels seen in the last 24 hours", disabled: true }),
    ]);
  });

  it("lets the map view scroll on phones, where titled groupings grow taller than the screen", async () => {
    await mountView();
    expect(wrapper.find('[data-test="k8s2-map-view"]').classes()).toContain(
      "max-md:overflow-y-auto",
    );
  });
});

describe("MapView label grouping (AC 96)", () => {
  it("lists built-ins, then the Labels header, then keys by coverage without noise keys", async () => {
    await mountView(mapState(), labelledInventory());
    const options = groupOptions();
    expect(options.slice(0, 4).map((o) => o.value)).toEqual([
      "node",
      "namespace",
      "workload",
      "none",
    ]);
    expect(options[4]).toMatchObject({ header: true, label: "Labels (seen on 39 of 41 pods)" });
    const keys = options.slice(5).map((o) => o.value);
    expect(keys[0]).toBe("label.app.kubernetes.io/name");
    expect(keys).toContain("label.statefulset.kubernetes.io/pod-name");
    expect(keys).not.toContain("label.pod-template-hash");
  });

  it("puts the unobserved pods last, labels the canvas by key, and ignores a label header click", async () => {
    await mountView(mapState({ group: "label.app.kubernetes.io/name" }), labelledInventory());
    const groups = hexMap().props("groups");
    expect(groups[groups.length - 1]).toMatchObject({ special: "noLabel" });
    expect(groups[groups.length - 1].rows).toHaveLength(2);
    expect(wrapper.find('[data-test="k8s2-map-canvas"]').attributes("aria-label")).toBe(
      "Map of 41 pods grouped by label app.kubernetes.io/name, filled by CPU % of request",
    );
    wrapper
      .findComponent({ name: "ChartRenderer" })
      .vm.$emit("click", { seriesIndex: 1, dataIndex: 0 });
    expect(wrapper.emitted("open")).toBeUndefined();
    expect(wrapper.emitted("navigate")).toBeUndefined();
  });

  it("groups nodes by zone into framed cards", async () => {
    await mountView(
      mapState({ entity: "nodes", group: "label.topology.kubernetes.io/zone" }),
      labelledInventory(),
    );
    expect(
      hexMap()
        .props("headers")
        .map((h: any) => [h.title, h.count]),
    ).toEqual([
      ["us-east-1a", "2"],
      ["us-east-1b", "1"],
      ["us-east-1c", "1"],
    ]);
    expect(options().series[1].data).toHaveLength(3);
  });
});
