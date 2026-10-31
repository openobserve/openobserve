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
import HostsDependenciesView from "./HostsDependenciesView.vue";

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

const row = (host: string, src: string, dst: string, direction: string, value: number) => ({
  metric: { host_name: host, host_id: `id-${host}`, src_cidr: src, dst_cidr: dst, direction },
  value: [1, String(value)],
});

const FLOWS = [
  row("web", "web", "api", "request", 2048),
  row("api", "web", "api", "request", 2000),
  row("api", "api", "web", "response", 4096),
  row("web", "web", "lan", "unknown", 10),
  row("web", "loopback", "loopback", "unknown", 50),
];

describe("HostsDependenciesView", () => {
  let wrapper: VueWrapper<any>;

  const mountView = async (props: Record<string, any> = {}, attachTo?: HTMLElement) => {
    wrapper = mount(HostsDependenciesView, {
      attachTo,
      props: {
        orgId: "org1",
        range: { start: END - 60 * MIN_US, end: END, relative: true },
        refreshNonce: 0,
        knownHosts: [],
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
  const node = (id: string) =>
    chart()
      .props("nodes")
      .find((n: any) => n.id === id);
  const testId = (id: string) => wrapper.find(`[data-test="${id}"]`);

  beforeEach(() => {
    vi.clearAllMocks();
    metricsQuery.mockResolvedValue({ data: { data: { result: FLOWS } } } as any);
  });

  afterEach(() => wrapper?.unmount());

  it("asks for flows per reporting host, rated over the selected range", async () => {
    await mountView();
    const sent = decodeURIComponent((metricsQuery.mock.calls[0][0] as any).query);
    expect(sent).toBe(
      "sum by (src_cidr, dst_cidr, direction, host_name, host_id) " +
        '(rate(obi_network_flow_bytes{k8s_cluster=""}[3600s]))',
    );
    expect(metricsQuery.mock.calls[0][0]).toMatchObject({ org_identifier: "org1", end_time: END });
    expect(testId("hosts-deps-caption").text()).toContain("over 1h");
    const caption = testId("hosts-deps-caption-more").attributes("aria-label");
    expect(caption).toContain("same --network-flows list on every host");
    expect(caption).toContain("a /32 entry named after each host's host name");
    expect(caption).toContain("busiest host's traffic");
  });

  it("names a window that is not a whole number of hours in minutes", async () => {
    await mountView({ range: { start: END - 90 * MIN_US, end: END, relative: true } });
    expect(testId("hosts-deps-caption").text()).toContain("over 90m");
  });

  it("draws hosts and networks, and leaves out traffic within a name", async () => {
    await mountView();
    expect(edges()).toHaveLength(2);
    expect(edges()[0]).toMatchObject({ source: "web", target: "api", directed: true });
    expect(node("api")).toMatchObject({ detail: "Host", icon: "computer", clickable: true });
    expect(node("lan")).toMatchObject({ detail: "Network", icon: "lan", clickable: false });
    // A network many hosts talk to sits in a column past the hosts, not among the callers.
    expect(node("lan").position.x).toBeGreaterThan(node("api").position.x);
    expect(node("loopback")).toBeUndefined();
    expect(chart().props("legend")).toBeUndefined();
    expect(chart().props("label")).toBe("Host dependency map of 2 connections");
  });

  it("draws a known host that reports no flows as a host", async () => {
    await mountView({ knownHosts: ["lan"] });
    expect(node("lan")).toMatchObject({ detail: "Host", clickable: true });
    chart().vm.$emit("open", "lan");
    expect(wrapper.emitted("open")).toEqual([["lan"]]);
  });

  it("counts traffic both agents report once, from the busier host", async () => {
    await mountView();
    const link = edges().find((l: any) => l.source === "web" && l.target === "api");
    expect(link.total).toBe(2048 + 4096);
  });

  it("opens a host's drawer from its box and ignores a network box", async () => {
    await mountView();
    chart().vm.$emit("open", "lan");
    chart().vm.$emit("open", "api");
    expect(wrapper.emitted("open")).toEqual([["api"]]);
  });

  it("shows an edge's bytes each way and its direction split", async () => {
    await mountView();
    chart().vm.$emit("select", "api\nweb");
    await flushPromises();
    const ways = wrapper.findAll('[data-test="hosts-deps-edge-way"]').map((w) => w.text());
    expect(ways[0]).toMatch(/^web to api: approximately 2(\.0+)?\s?KB\/s$/);
    expect(ways[1]).toMatch(/^api to web: approximately 4(\.0+)?\s?KB\/s$/);
    expect(testId("hosts-deps-edge-split").text()).toBe(
      "Request 33%, response 67%, unknown direction 0%",
    );
    await testId("hosts-deps-edge-target").trigger("click");
    expect(wrapper.emitted("open")).toEqual([["api"]]);
  });

  it("lists the edges as buttons for keyboard users, busiest first", async () => {
    await mountView({}, document.body);
    const links = wrapper.findAll('[data-test="hosts-deps-link"]');
    expect(links.map((l) => l.text())).toEqual(["web → api", "lan ↔ web"]);
    await links[1].trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(testId("hosts-deps-edge").element);
    expect(testId("hosts-deps-edge-source").attributes("disabled")).toBeDefined();
    expect(testId("hosts-deps-edge-target").attributes("disabled")).toBeUndefined();
    expect(testId("hosts-deps-edge-undirected").text()).toContain("without seeing");
    await testId("hosts-deps-edge-close").trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(links[1].element);
  });

  it("draws at most 200 edges, busiest first, and says how many it left out", async () => {
    // 21 hosts all talking to each other: 210 pairs between only 21 ends.
    const names = Array.from({ length: 21 }, (_, i) => `h${String(i).padStart(2, "0")}`);
    const many = names.flatMap((a, i) =>
      names.slice(i + 1).map((b, j) => row(a, a, b, "request", 1000 - i * 21 - j)),
    );
    metricsQuery.mockResolvedValue({ data: { data: { result: many } } } as any);
    await mountView();
    expect(edges()).toHaveLength(200);
    expect(wrapper.findAll('[data-test="hosts-deps-link"]')).toHaveLength(200);
    expect(testId("hosts-deps-capped").text()).toBe("Showing the 200 busiest of 210 connections.");
  });

  it("explains how to get flows when there are none, and links to the Linux setup", async () => {
    metricsQuery.mockResolvedValue({ data: { data: { result: [] } } } as any);
    await mountView();
    const empty = testId("hosts-deps-no-flows");
    expect(empty.text()).toContain("--network-flows");
    expect(empty.text()).toContain("in the last 1h of the selected time range");
    await empty.find("button").trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "ingestFromLinux",
      query: { org_identifier: "org1" },
    });
  });

  it("reads traffic only within names as no flows", async () => {
    metricsQuery.mockResolvedValue({ data: { data: { result: [FLOWS[4]] } } } as any);
    await mountView();
    expect(testId("hosts-deps-no-flows").exists()).toBe(true);
  });

  it("shows the no-access state on a 403 and a retry on other failures", async () => {
    metricsQuery.mockRejectedValue(Object.assign(new Error("no"), { response: { status: 403 } }));
    await mountView();
    expect(testId("hosts-deps-forbidden").exists()).toBe(true);
    expect(testId("hosts-deps-error").exists()).toBe(false);
    wrapper.unmount();
    metricsQuery.mockRejectedValue(new Error("boom"));
    await mountView();
    await testId("hosts-deps-error").find("button").trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("reloads on a refresh, keeping the graph while it loads", async () => {
    await mountView();
    let resolve!: (v: any) => void;
    metricsQuery.mockReturnValue(new Promise((r) => (resolve = r)) as any);
    await wrapper.setProps({
      refreshNonce: 1,
      range: { start: END - 59 * MIN_US, end: END + MIN_US, relative: true },
    });
    expect(metricsQuery).toHaveBeenCalledTimes(2);
    expect(chart().exists()).toBe(true);
    const refresh = wrapper.findComponent({ name: "ORefreshButton" });
    expect(refresh.props("loading")).toBe(true);
    expect(refresh.props("lastRunAt")).toEqual(expect.any(Number));
    resolve({ data: { data: { result: [] } } });
    await flushPromises();
    expect(refresh.props("loading")).toBe(false);
    expect(testId("hosts-deps-no-flows").exists()).toBe(true);
    await testId("hosts-deps-refresh").trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("drops another org's graph at once and ignores its late response", async () => {
    await mountView();
    let resolve!: (v: any) => void;
    metricsQuery.mockReturnValueOnce(new Promise((r) => (resolve = r)) as any);
    metricsQuery.mockResolvedValueOnce({ data: { data: { result: [] } } } as any);
    await wrapper.setProps({ orgId: "org2" });
    expect(testId("hosts-deps-loading").exists()).toBe(true);
    await wrapper.setProps({ orgId: "org3" });
    await flushPromises();
    resolve({ data: { data: { result: FLOWS } } });
    await flushPromises();
    expect(testId("hosts-deps-no-flows").exists()).toBe(true);
  });
});
