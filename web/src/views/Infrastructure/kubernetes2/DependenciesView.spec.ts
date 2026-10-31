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

const ChartStub = defineComponent({
  name: "ChartRenderer",
  props: ["data", "label"],
  emits: ["click"],
  setup() {
    return () => h("div", { "data-test": "chart-stub" });
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

  const mountView = async (props: Record<string, any> = {}) => {
    wrapper = mount(DependenciesView, {
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
        stubs: { ChartRenderer: ChartStub },
      },
    });
    await flushPromises();
    return wrapper;
  };

  const chart = () => wrapper.findComponent(ChartStub);
  const series = () => chart().props("data").options.series[0];
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

  it("names a window that is not a whole number of hours in minutes", async () => {
    await mountView({ range: { start: END - 90 * MIN_US, end: END, relative: true } });
    expect(testId("k8s2-deps-caption").text()).toContain("over 90m");
  });

  it("draws one edge per pair and hides system namespaces and node-to-node traffic by default", async () => {
    await mountView();
    expect(series().links).toHaveLength(1);
    expect(series().links[0]).toMatchObject({
      source: "prod/frontend/Deployment/web",
      target: "prod/backend/Deployment/api",
      symbol: ["none", "arrow"],
    });
    expect(series().data.map((n: any) => n.name)).toEqual(["web", "api"]);
    expect(series().categories.map((c: any) => c.name)).toEqual(["backend", "frontend"]);
    expect(series().data.map((n: any) => n.category)).toEqual([1, 0]);
    expect(chart().props("label")).toBe("Dependency map of 1 connection");
  });

  it("shows system namespaces and node traffic once switched on", async () => {
    await mountView();
    await testId("k8s2-deps-show-system-btn").trigger("click");
    await testId("k8s2-deps-show-node-traffic-btn").trigger("click");
    expect(series().links).toHaveLength(3);
  });

  it("opens the workload drawer from a node click", async () => {
    await mountView();
    chart().vm.$emit("click", { dataType: "node", data: { id: "prod/backend/Deployment/api" } });
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "deployment", cluster: "prod", namespace: "backend", name: "api" }],
    ]);
  });

  it("opens a details panel with the bytes each way from an edge click", async () => {
    await mountView();
    const id = series().links[0].id;
    chart().vm.$emit("click", { dataType: "edge", data: { id } });
    await flushPromises();
    const ways = wrapper.findAll('[data-test="k8s2-deps-edge-way"]').map((w) => w.text());
    expect(ways[0]).toMatch(/^web to api: approximately 2(\.0+)?\s?KB\/s$/);
    expect(ways[1]).toMatch(/^api to web: approximately 4(\.0+)?\s?KB\/s$/);
    expect(testId("k8s2-deps-edge-split").text()).toContain("Request 33%, response 67%");
    await testId("k8s2-deps-edge-close").trigger("click");
    expect(testId("k8s2-deps-edge").exists()).toBe(false);
  });

  it("explains and links to the Kubernetes data source when there is no flow stream", async () => {
    await mountView({ hasStream: () => false });
    expect(metricsQuery).not.toHaveBeenCalled();
    const empty = testId("k8s2-deps-no-stream");
    expect(empty.text()).toContain("obi_network_flow_bytes");
    await empty.find("button").trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "ingestFromKubernetes",
      query: { org_identifier: "org1" },
    });
  });

  it("says so when the range has no flows", async () => {
    metricsQuery.mockResolvedValue({ data: { data: { result: [] } } } as any);
    await mountView();
    expect(testId("k8s2-deps-no-flows").exists()).toBe(true);
  });

  it("offers a retry when the query fails", async () => {
    metricsQuery.mockRejectedValue(new Error("boom"));
    await mountView();
    expect(testId("k8s2-deps-error").exists()).toBe(true);
  });

  it("refetches on a refresh", async () => {
    await mountView();
    await queryClient.invalidateQueries();
    await wrapper.setProps({ refreshNonce: 1 });
    await flushPromises();
    expect(metricsQuery).toHaveBeenCalledTimes(2);
  });
});
