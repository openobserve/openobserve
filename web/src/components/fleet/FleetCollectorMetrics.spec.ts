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

import { describe, it, expect, vi, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";
import { queryClient } from "@/composables/query/queryClient";
import FleetCollectorMetrics from "./FleetCollectorMetrics.vue";

vi.mock("@/services/search", () => ({ default: { metrics_query: vi.fn() } }));

// The real renderer pulls in ECharts, which the test runner cannot load.
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({ default: {} }));

const PanelStub = {
  name: "PanelSchemaRenderer",
  props: ["panelSchema", "selectedTimeObj"],
  template: '<div data-test="panel-stub" />',
};

const vector = (value?: number) => ({
  data: {
    status: "success",
    data: {
      resultType: "vector",
      result: value === undefined ? [] : [{ metric: {}, value: [0, String(value)] }],
    },
  },
});

// Answers each tile's PromQL by the metric it reads.
function answer(values: Partial<Record<string, number>>) {
  vi.mocked(searchService.metrics_query).mockImplementation((async ({ query }: any) => {
    const q = decodeURIComponent(query);
    const hit = Object.keys(values).find((k) => q.includes(k));
    return vector(hit ? values[hit] : undefined);
  }) as any);
}

const queries = () =>
  vi.mocked(searchService.metrics_query).mock.calls.map((c) => decodeURIComponent(c[0].query));

function mountMetrics() {
  return mount(FleetCollectorMetrics, {
    props: { collectorId: "c-1", collectorName: "edge-01" },
    global: { plugins: [i18n, store], stubs: { PanelSchemaRenderer: PanelStub } },
  });
}

const sel = (name: string) => `[data-test="fleet-collector-metrics-${name}"]`;

describe("FleetCollectorMetrics", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("fills the tiles from the instant queries", async () => {
    answer({
      process_cpu_seconds: 12.34,
      process_memory_rss: 50 * 1024 * 1024,
      process_uptime: 3725,
      receiver_accepted: 1500,
      exporter_sent: 1400,
    });
    wrapper = mountMetrics();
    await flushPromises();
    expect(wrapper.find(sel("value-cpu")).text()).toBe("12.3%");
    expect(wrapper.find(sel("value-memory")).text()).toBe("50.00 MB");
    expect(wrapper.find(sel("value-uptime")).text()).toBe("1h 2m 5s");
    expect(wrapper.find(sel("value-received")).text()).toBe("1.5K/s");
    expect(wrapper.find(sel("value-sent")).text()).toBe("1.4K/s");
    expect(wrapper.find(sel("value-failed")).text()).toBe("0/s");
    expect(wrapper.findAll('[data-test="panel-stub"]')).toHaveLength(5);
  });

  it("scopes every query to the collector", async () => {
    answer({ process_uptime: 1 });
    wrapper = mountMetrics();
    await flushPromises();
    expect(queries()).toHaveLength(6);
    for (const q of queries()) expect(q).toContain('service_instance_id="c-1"');
    const schemas = wrapper
      .findAllComponents({ name: "PanelSchemaRenderer" })
      .flatMap((p) => p.props("panelSchema").queries.map((x: { query: string }) => x.query));
    for (const q of schemas) expect(q).toContain('service_instance_id="c-1"');
  });

  it("shows skeletons, not zeros, while loading", async () => {
    vi.mocked(searchService.metrics_query).mockReturnValue(new Promise(() => {}) as any);
    wrapper = mountMetrics();
    await flushPromises();
    expect(wrapper.find(sel("value-cpu")).exists()).toBe(false);
    expect(wrapper.find('[data-test="panel-stub"]').exists()).toBe(false);
  });

  it("shows one empty state when the collector reports no metrics", async () => {
    answer({});
    wrapper = mountMetrics();
    await flushPromises();
    expect(wrapper.find(sel("empty")).exists()).toBe(true);
    expect(wrapper.find(sel("tiles")).exists()).toBe(false);
  });

  it.each([
    [{ response: { status: 403 } }, "forbidden"],
    [new Error("boom"), "error"],
  ])("shows why the metrics cannot load (%j)", async (err, shown) => {
    vi.mocked(searchService.metrics_query).mockRejectedValue(err);
    wrapper = mountMetrics();
    await flushPromises();
    expect(wrapper.find(sel(shown)).exists()).toBe(true);
  });

  it("re-queries the tiles and charts for the chosen window", async () => {
    answer({ process_uptime: 1, receiver_accepted: 2 });
    wrapper = mountMetrics();
    await flushPromises();
    expect(queries().some((q) => q.includes("[1h]"))).toBe(true);
    const span = () => {
      const t = wrapper.findComponent({ name: "PanelSchemaRenderer" }).props("selectedTimeObj");
      return t.end_time.getTime() - t.start_time.getTime();
    };
    expect(span()).toBe(3600 * 1_000_000);

    vi.mocked(searchService.metrics_query).mockClear();
    wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "24h");
    await flushPromises();
    expect(queries().some((q) => q.includes("[24h]"))).toBe(true);
    expect(span()).toBe(86_400 * 1_000_000);
    const throughput = wrapper.findComponent({ name: "PanelSchemaRenderer" }).props("panelSchema");
    expect(throughput.queries[0].query).toContain("[10m]");
  });
});
