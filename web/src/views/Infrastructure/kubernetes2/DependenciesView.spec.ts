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
import { defineComponent, h } from "vue";
import { routerKey } from "vue-router";
import i18n from "@/locales";
import searchService from "@/services/search";
import { queryClient } from "@/composables/query/queryClient";
import { parseUrlState } from "./kubernetesUrlState";
import DependenciesView from "./DependenciesView.vue";

vi.mock("@/services/search", () => ({ default: { metrics_query: vi.fn() } }));

const metricsQuery = vi.mocked(searchService.metrics_query);
const push = vi.fn();

const MapStub = defineComponent({
  name: "DependencyMap",
  props: ["nodes", "edges", "selectedEdgeId", "label", "legend"],
  emits: ["open", "select"],
  setup() {
    return () => h("div", { "data-test": "map-stub" });
  },
});

const MIN_US = 60_000_000;
const END = 1_800_000_000_000_000;

type End = [namespace: string, type: string, name: string];

const row = (src: End, dst: End, direction: string, value: number) => ({
  metric: {
    k8s_cluster: "prod",
    k8s_src_namespace: src[0],
    k8s_src_owner_type: src[1],
    k8s_src_owner_name: src[2],
    k8s_dst_namespace: dst[0],
    k8s_dst_owner_type: dst[1],
    k8s_dst_owner_name: dst[2],
    direction,
  },
  value: [1, String(value)],
});

const WEB: End = ["frontend", "Deployment", "web"];
const API: End = ["backend", "Deployment", "api"];
const DNS: End = ["kube-system", "Deployment", "coredns"];

const FLOWS = [
  row(WEB, API, "request", 2048),
  row(API, WEB, "response", 4096),
  row(API, DNS, "request", 10),
  row(["", "Node", "n1"], ["", "Node", "n2"], "unknown", 100),
];

describe("DependenciesView", () => {
  let wrapper: VueWrapper<any>;

  const mountView = async (props: Record<string, any> = {}, attachTo?: HTMLElement) => {
    wrapper = mount(DependenciesView, {
      attachTo,
      props: {
        state: parseUrlState({ view: "dependencies" }),
        cluster: "prod",
        namespaceOptions: [],
        range: { start: END - 60 * MIN_US, end: END, relative: true },
        orgId: "org1",
        refreshNonce: 0,
        hasStream: () => true,
        ...props,
      },
      global: {
        plugins: [i18n],
        provide: { [routerKey as symbol]: { push } },
        stubs: { DependencyMap: MapStub },
      },
    });
    await flushPromises();
    return wrapper;
  };

  const chart = () => wrapper.findComponent(MapStub);
  const edges = () => chart().props("edges");
  const nodes = () => chart().props("nodes");
  const testId = (id: string) => wrapper.find(`[data-test="${id}"]`);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    metricsQuery.mockResolvedValue({ data: { data: { result: FLOWS } } } as any);
  });

  afterEach(() => wrapper?.unmount());

  it("asks for the cluster's flows, rated over the selected range", async () => {
    await mountView();
    const sent = decodeURIComponent((metricsQuery.mock.calls[0][0] as any).query);
    expect(sent).toContain('obi_network_flow_bytes{k8s_cluster="prod", ');
    expect(sent).toContain("[3600s]");
    expect(testId("k8s2-deps-caption").text()).toContain("1h");
  });

  it.each([
    [1, "over 5m"],
    [7 * 24 * 60, "over 1d"],
  ])("states the rate window actually used for a %s minute range", async (minutes, text) => {
    await mountView({ range: { start: END - minutes * MIN_US, end: END, relative: true } });
    expect(testId("k8s2-deps-caption").text()).toContain(text);
  });

  it("names a window that is not a whole number of hours in minutes", async () => {
    await mountView({ range: { start: END - 90 * MIN_US, end: END, relative: true } });
    expect(testId("k8s2-deps-caption").text()).toContain("over 90m");
  });

  it("draws one edge per pair and hides system namespaces and node-to-node traffic by default", async () => {
    await mountView();
    expect(edges()).toHaveLength(1);
    expect(edges()[0]).toMatchObject({
      source: "prod/frontend/Deployment/web",
      target: "prod/backend/Deployment/api",
      directed: true,
    });
    expect(nodes().map((n: any) => n.label)).toEqual(["web", "api"]);
    expect(nodes().map((n: any) => n.detail)).toEqual([
      "Deployment in frontend",
      "Deployment in backend",
    ]);
    const legend = chart().props("legend");
    expect(legend.map((l: any) => l.label)).toEqual(["backend", "frontend"]);
    expect(nodes().map((n: any) => n.color)).toEqual([legend[1].color, legend[0].color]);
    expect(nodes()[0].position.x).toBeLessThan(nodes()[1].position.x);
    expect(chart().props("label")).toBe("Dependency map of 1 connection");
  });

  it("shows system namespaces and node traffic once switched on, keeping the switches in the URL", async () => {
    await mountView();
    await testId("k8s2-deps-show-system-btn").trigger("click");
    await testId("k8s2-deps-show-node-traffic-btn").trigger("click");
    expect(wrapper.emitted("update")).toEqual([[{ system: true }], [{ nodeTraffic: true }]]);
    await wrapper.setProps({
      state: parseUrlState({ view: "dependencies", system: "true", nodeTraffic: "true" }),
    });
    expect(edges()).toHaveLength(3);
    const node = nodes().find((n: any) => n.id === "prod/node/n1");
    expect(node).toMatchObject({ label: "n1", detail: "Node", icon: "dns", clickable: true });
    expect(node.title).toContain("Host processes and host-network pods");
    expect(node.position.x).toBeGreaterThan(
      nodes().find((n: any) => n.label === "coredns").position.x,
    );
  });

  it("opens the workload drawer from a node click", async () => {
    await mountView();
    chart().vm.$emit("open", "prod/backend/Deployment/api");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "deployment", cluster: "prod", namespace: "backend", name: "api" }],
    ]);
  });

  it("opens a details panel with the bytes each way from an edge click", async () => {
    await mountView();
    const id = edges()[0].id;
    chart().vm.$emit("select", id);
    await flushPromises();
    expect(chart().props("selectedEdgeId")).toBe(id);
    const ways = wrapper.findAll('[data-test="k8s2-deps-edge-way"]').map((w) => w.text());
    expect(ways[0]).toMatch(/^web to api: approximately 2(\.0+)?\s?KB\/s$/);
    expect(ways[1]).toMatch(/^api to web: approximately 4(\.0+)?\s?KB\/s$/);
    expect(testId("k8s2-deps-edge-split").text()).toContain("Request 33%, response 67%");
    await testId("k8s2-deps-edge-close").trigger("click");
    expect(testId("k8s2-deps-edge").exists()).toBe(false);
  });

  it.each([
    [
      "mostly unknown",
      [row(API, DNS, "unknown", 90), row(DNS, API, "unknown", 90)],
      "without seeing",
    ],
    [
      "called both ways",
      [row(WEB, API, "request", 50), row(API, WEB, "request", 50)],
      "both act as client",
    ],
  ])("explains an undirected edge that is %s", async (_case, result, text) => {
    metricsQuery.mockResolvedValue({ data: { data: { result } } } as any);
    await mountView({
      state: parseUrlState({ view: "dependencies", namespace: "backend", system: "true" }),
    });
    chart().vm.$emit("select", edges()[0].id);
    await flushPromises();
    expect(testId("k8s2-deps-edge-undirected").text()).toContain(text);
  });

  it("clears only the namespace filter and search, leaving the switches as they are", async () => {
    await mountView({ state: parseUrlState({ view: "dependencies", namespace: "backend" }) });
    const header = wrapper.findComponent({ name: "K8sListHeader" });
    expect(header.props("filtered")).toBe(false);
    header.vm.$emit("clear");
    await flushPromises();
    expect(wrapper.emitted("update")).toEqual([[{ namespaces: [], search: "" }]]);
  });

  it("closes the edge panel on Escape and on empty map space", async () => {
    await mountView();
    chart().vm.$emit("select", edges()[0].id);
    await flushPromises();
    // From anywhere on the page, as after a mouse click on an edge, which leaves focus on the body.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(testId("k8s2-deps-edge").exists()).toBe(false);
    chart().vm.$emit("select", edges()[0].id);
    await flushPromises();
    chart().vm.$emit("select", null);
    await flushPromises();
    expect(testId("k8s2-deps-edge").exists()).toBe(false);
  });

  it("offers to show what the switches hide when they alone hide every edge", async () => {
    metricsQuery.mockResolvedValue({ data: { data: { result: [FLOWS[2], FLOWS[3]] } } } as any);
    await mountView();
    const empty = testId("k8s2-deps-empty");
    expect(empty.text()).toContain("which the switches above hide");
    await empty.find("button").trigger("click");
    expect(wrapper.emitted("update")).toEqual([
      [{ system: true, nodeTraffic: true, lowTraffic: true }],
    ]);
  });

  it("offers both to show what the switches hide and to clear a search they also hide", async () => {
    await mountView({ state: parseUrlState({ view: "dependencies", search: "coredns" }) });
    const empty = testId("k8s2-deps-empty");
    expect(empty.text()).toContain("which the switches above hide");
    const [show, clear] = empty.findAll("button");
    expect(clear.text()).toBe("Clear filters");
    await show.trigger("click");
    await clear.trigger("click");
    expect(wrapper.emitted("update")).toEqual([
      [{ system: true, nodeTraffic: true, lowTraffic: true }],
      [{ namespaces: [], search: "" }],
    ]);
  });

  it("offers to clear the filters when the namespace filter or search hides every edge", async () => {
    await mountView({ state: parseUrlState({ view: "dependencies", search: "nothing" }) });
    await testId("k8s2-deps-empty").find("button").trigger("click");
    expect(wrapper.emitted("update")).toEqual([[{ namespaces: [], search: "" }]]);
  });

  it("leaves Escape alone while no edge panel is open, or to a dialog open over the page", async () => {
    await mountView();
    const esc = () => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event;
    };
    expect(esc().defaultPrevented).toBe(false);
    chart().vm.$emit("select", edges()[0].id);
    await flushPromises();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    expect(esc().defaultPrevented).toBe(false);
    await flushPromises();
    expect(testId("k8s2-deps-edge").exists()).toBe(true);
    dialog.remove();
    // One animating closed no longer takes it, nor does Escape typed in a text field.
    const closing = document.createElement("div");
    closing.setAttribute("role", "dialog");
    closing.setAttribute("data-state", "closed");
    document.body.appendChild(closing);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const typed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    input.remove();
    expect(esc().defaultPrevented).toBe(true);
    await flushPromises();
    expect(testId("k8s2-deps-edge").exists()).toBe(false);
    closing.remove();
  });

  it("returns focus to the list when the map dismisses a panel that holds it", async () => {
    await mountView({}, document.body);
    await testId("k8s2-deps-link").trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(testId("k8s2-deps-edge").element);
    chart().vm.$emit("select", null);
    await flushPromises();
    expect(testId("k8s2-deps-edge").exists()).toBe(false);
    expect(document.activeElement).toBe(testId("k8s2-deps-link").element);
  });

  it("leaves focus alone when the map dismisses a panel that does not hold it", async () => {
    await mountView({}, document.body);
    await testId("k8s2-deps-link").trigger("click");
    await flushPromises();
    (document.activeElement as HTMLElement).blur();
    chart().vm.$emit("select", null);
    await flushPromises();
    expect(testId("k8s2-deps-edge").exists()).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("colours a namespace the same across the namespace filter, search and both switches", async () => {
    await mountView();
    const colour = (name: string) => nodes().find((n: any) => n.label === name)?.color;
    const before = { api: colour("api"), web: colour("web") };
    for (const query of [
      { system: "true", nodeTraffic: "true" },
      { namespace: "backend" },
      { search: "api" },
      { namespace: "frontend", system: "true" },
    ]) {
      await wrapper.setProps({ state: parseUrlState({ view: "dependencies", ...query }) });
      if (colour("api")) expect(colour("api")).toBe(before.api);
      if (colour("web")) expect(colour("web")).toBe(before.web);
    }
  });

  it("leaves colours alone when the inventory's namespaces arrive", async () => {
    await mountView();
    const before = nodes().map((n: any) => n.color);
    await wrapper.setProps({ namespaceOptions: ["aaa", "abc", "backend", "frontend", "zzz"] });
    expect(nodes().map((n: any) => n.color)).toEqual(before);
  });

  it("counts a picked system namespace's edges in the header total with the switch off", async () => {
    await mountView({ state: parseUrlState({ view: "dependencies", namespace: "kube-system" }) });
    const header = wrapper.findComponent({ name: "K8sListHeader" });
    // api -> coredns is drawn because kube-system is picked, so it is in the total too.
    expect(edges()).toHaveLength(1);
    expect(header.props("count")).toBeLessThanOrEqual(header.props("total"));
    expect(header.props("total")).toBe(2);
  });

  it("keeps an Escape it handles from reaching page-wide shortcuts, and only that one", async () => {
    await mountView();
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);
    try {
      const esc = () =>
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      esc();
      expect(shortcut).toHaveBeenCalledTimes(1);
      chart().vm.$emit("select", edges()[0].id);
      await flushPromises();
      esc();
      await flushPromises();
      expect(testId("k8s2-deps-edge").exists()).toBe(false);
      expect(shortcut).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", shortcut);
    }
  });

  it("hides connections below 1 B/s until the low-traffic switch shows them", async () => {
    metricsQuery.mockResolvedValue({
      data: {
        data: { result: [...FLOWS, row(WEB, ["backend", "Deployment", "cache"], "request", 0.4)] },
      },
    } as any);
    await mountView();
    const header = wrapper.findComponent({ name: "K8sListHeader" });
    expect(edges().some((e: any) => e.target.endsWith("/cache"))).toBe(false);
    expect(header.props("total")).toBe(1);
    await testId("k8s2-deps-show-low-traffic-btn").trigger("click");
    expect(wrapper.emitted("update")).toEqual([[{ lowTraffic: true }]]);
    await wrapper.setProps({ state: parseUrlState({ view: "dependencies", lowTraffic: "true" }) });
    expect(edges().some((e: any) => e.target.endsWith("/cache"))).toBe(true);
    expect(header.props("total")).toBe(2);
  });

  it("totals the connections the switches leave in the header", async () => {
    await mountView({ state: parseUrlState({ view: "dependencies", namespace: "backend" }) });
    const header = wrapper.findComponent({ name: "K8sListHeader" });
    // web -> api, and api -> coredns, drawn because it touches the picked backend; node-to-node traffic stays off.
    expect(header.props("total")).toBe(2);
    await wrapper.setProps({
      state: parseUrlState({ view: "dependencies", namespace: "backend", nodeTraffic: "true" }),
    });
    expect(header.props("total")).toBe(3);
  });

  it("counts what it draws when there are too many endpoints", async () => {
    const many = Array.from({ length: 90 }, (_, i) =>
      row(["shop", "Deployment", `w${i}`], API, "request", 1000 - i),
    );
    metricsQuery.mockResolvedValue({ data: { data: { result: many } } } as any);
    await mountView();
    expect(nodes()).toHaveLength(80);
    expect(testId("k8s2-list-count").text()).toContain("79 connections");
    expect(testId("k8s2-deps-capped").text()).toContain("Showing the 79 busiest of 90 connections");
  });

  it("explains and links to the Kubernetes data source when there is no flow stream", async () => {
    await mountView({ hasStream: () => false });
    expect(metricsQuery).not.toHaveBeenCalled();
    const empty = testId("k8s2-deps-no-stream");
    expect(empty.text()).toContain("obi_network_flow_bytes");
    expect(empty.text()).toContain("ebpf.network.enabled=true");
    await empty.find("button").trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "ingestFromKubernetes",
      query: { org_identifier: "org1" },
    });
  });

  it("says so when the range has no flows", async () => {
    metricsQuery.mockResolvedValue({ data: { data: { result: [] } } } as any);
    await mountView();
    expect(testId("k8s2-deps-no-flows").text()).toContain(
      "in the last 1h of the selected time range",
    );
  });

  it("offers a retry when the query fails", async () => {
    metricsQuery.mockRejectedValue(new Error("boom"));
    await mountView();
    expect(testId("k8s2-deps-error").exists()).toBe(true);
  });

  it("shows no access on a 403, as the map does", async () => {
    metricsQuery.mockRejectedValue(Object.assign(new Error("no"), { response: { status: 403 } }));
    await mountView();
    expect(testId("k8s2-deps-forbidden").exists()).toBe(true);
    expect(testId("k8s2-deps-error").exists()).toBe(false);
  });

  it("drops the old cluster's graph while the new cluster's flows load", async () => {
    await mountView();
    let resolve!: (value: unknown) => void;
    metricsQuery.mockReturnValue(new Promise((r) => (resolve = r)) as any);
    await wrapper.setProps({ cluster: "stage" });
    await flushPromises();
    expect(testId("k8s2-deps-loading").exists()).toBe(true);
    expect(chart().exists()).toBe(false);
    resolve({ data: { data: { result: FLOWS } } });
    await flushPromises();
    expect(chart().exists()).toBe(true);
  });

  it("drops the old window's graph on a range change but keeps it through a refresh", async () => {
    await mountView();
    let resolve!: (value: unknown) => void;
    metricsQuery.mockReturnValue(new Promise((r) => (resolve = r)) as any);
    await wrapper.setProps({
      range: { start: END - 59 * MIN_US, end: END + MIN_US, relative: true },
    });
    await flushPromises();
    expect(chart().exists()).toBe(true);
    await wrapper.setProps({ range: { start: END - 15 * MIN_US, end: END, relative: true } });
    await flushPromises();
    expect(testId("k8s2-deps-loading").exists()).toBe(true);
    resolve({ data: { data: { result: FLOWS } } });
    await flushPromises();
    expect(chart().exists()).toBe(true);
  });

  it("names workloads with their namespace in the keyboard list, and focuses the edge it opens", async () => {
    await mountView({}, document.body);
    expect(testId("k8s2-deps-link").text()).toBe("frontend/web → backend/api");
    await testId("k8s2-deps-link").trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(testId("k8s2-deps-edge").element);
    await testId("k8s2-deps-edge-close").trigger("click");
    await flushPromises();
    expect(testId("k8s2-deps-edge").exists()).toBe(false);
    expect(document.activeElement).toBe(testId("k8s2-deps-link").element);
  });

  it("lists every drawn edge for keyboard users", async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      row(["shop", "Deployment", `w${i}`], API, "request", 100),
    );
    metricsQuery.mockResolvedValue({ data: { data: { result: many } } } as any);
    await mountView();
    expect(wrapper.findAll('[data-test="k8s2-deps-link"]')).toHaveLength(60);
  });

  it("offers the namespaces seen in flows beside the inventory's", async () => {
    await mountView({ namespaceOptions: ["shop"] });
    const header = wrapper.findComponent({ name: "K8sListHeader" });
    expect(header.props("namespaceOptions")).toEqual([
      "backend",
      "frontend",
      "kube-system",
      "shop",
    ]);
  });

  it("waits for the page to learn the cluster before querying", async () => {
    await mountView({ cluster: null, clusterPending: true });
    expect(metricsQuery).not.toHaveBeenCalled();
    expect(testId("k8s2-deps-loading").exists()).toBe(true);
    await wrapper.setProps({ cluster: "prod", clusterPending: false });
    await flushPromises();
    expect(metricsQuery).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent((metricsQuery.mock.calls[0][0] as any).query)).toContain(
      'k8s_cluster="prod"',
    );
    expect(chart().exists()).toBe(true);
  });

  it("refetches on a refresh", async () => {
    await mountView();
    await queryClient.invalidateQueries();
    await wrapper.setProps({ refreshNonce: 1 });
    await flushPromises();
    expect(metricsQuery).toHaveBeenCalledTimes(2);
  });
});
