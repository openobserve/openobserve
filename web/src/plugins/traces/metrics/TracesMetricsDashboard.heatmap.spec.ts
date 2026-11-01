// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";
import searchService from "@/services/search";

vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: { template: '<div data-test="render-dashboard-charts"></div>' },
}));

// `__esModule` is load-bearing: the heatmap reaches this through defineAsyncComponent.
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: {
    name: "ChartRenderer",
    props: ["data"],
    emits: ["updated:dataZoom"],
    template: '<div class="chart-renderer-stub" />',
  },
}));

vi.mock("./TracesComparison.vue", () => ({
  __esModule: true,
  default: {
    name: "TracesComparison",
    template: '<div data-test="traces-comparison-stub"></div>',
    props: ["selection", "streamName", "presetContext"],
    emits: ["close", "apply-filter"],
  },
}));

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));

const S = 1_000_000;
const START = Date.UTC(2026, 9, 6, 10, 0, 0) * 1000;
const END = START + 60 * S;

const searchObj = reactive({
  loading: false,
  data: {
    editorValue: "service_name = 'a'",
    datetime: { startTime: START, endTime: END },
    stream: { selectedStream: { value: "default" }, selectedStreamFields: [] },
  },
  meta: { showHistogram: true, metricsRangeFilters: new Map(), searchMode: "spans" },
});

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj, tracesParser: { value: null } }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

vi.mock("@/composables/useDurationPercentiles", () => ({
  parseDurationWhereClause: vi.fn((filter: string) => filter),
}));

import TracesMetricsDashboard from "./TracesMetricsDashboard.vue";

const store = createStore({
  state: { theme: "light", timezone: "UTC", selectedOrganization: { identifier: "test-org" } },
});

const settle = async () => {
  for (let i = 0; i < 6; i++) await flushPromises();
};

let wrapper: VueWrapper<any> | null = null;

beforeAll(async () => {
  await import("@/components/dashboards/panels/ChartRenderer.vue");
  await import("./TracesComparison.vue");
});

beforeEach(() => {
  const target = document.createElement("div");
  target.id = "traces-drill-down-page";
  document.body.appendChild(target);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  searchObj.data.editorValue = "service_name = 'a'";
  searchObj.meta.metricsRangeFilters.clear();
  document.body.innerHTML = "";
});

const HEATMAP_DATA = {
  data: {
    hits: [
      { x_axis: "2026-10-06T10:00:10", duration_bucket: 16, span_count: 40, error_count: 4 },
      { x_axis: "2026-10-06T10:00:20", duration_bucket: 18, span_count: 3, error_count: 0 },
    ],
    histogram_interval: 10,
  },
};
const item = (name: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="traces-latency-heatmap-selection-${name}"]`,
  );

describe("TracesMetricsDashboard with the real latency heatmap", () => {
  it("keeps a filtered box through Drill down, so Clear still restores the editor", async () => {
    vi.mocked(searchService.search).mockResolvedValue(HEATMAP_DATA as any);
    wrapper = mount(TracesMetricsDashboard, {
      props: { streamName: "default", show: true },
      attachTo: document.body,
      global: { plugins: [store, i18n] },
    });
    await settle();
    wrapper
      .findComponent({ name: "ChartRenderer" })
      .vm.$emit("updated:dataZoom", { start: 1, end: 2, start1: 0, end1: 1 });
    await settle();
    const box = () => wrapper!.find('[data-test="traces-latency-heatmap-selection"]');
    const reopen = async () => {
      item("reopen")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
    };

    item("filter")!.click();
    await settle();
    // The page writes the staged filter into the editor, as Index.vue does.
    searchObj.data.editorValue = wrapper.emitted("editor-filter-set")!.at(-1)![0] as string;
    await reopen();
    item("drill-down")!.click();
    await settle();
    expect(box().exists()).toBe(true);
    expect(wrapper.findComponent({ name: "TracesComparison" }).exists()).toBe(true);

    await reopen();
    item("clear")!.click();
    await settle();
    expect(box().exists()).toBe(false);
    expect(wrapper.emitted("editor-filter-set")!.at(-1)).toEqual(["service_name = 'a'"]);
  });

  it("erases the drawn box on Drill down while the page still opens on that selection", async () => {
    vi.mocked(searchService.search).mockResolvedValue({
      data: {
        hits: [
          { x_axis: "2026-10-06T10:00:10", duration_bucket: 16, span_count: 40, error_count: 4 },
          { x_axis: "2026-10-06T10:00:20", duration_bucket: 18, span_count: 3, error_count: 0 },
        ],
        histogram_interval: 10,
      },
    } as any);
    wrapper = mount(TracesMetricsDashboard, {
      props: { streamName: "default", show: true },
      attachTo: document.body,
      global: { plugins: [store, i18n] },
    });
    await settle();
    wrapper
      .findComponent({ name: "ChartRenderer" })
      .vm.$emit("updated:dataZoom", { start: 1, end: 2, start1: 0, end1: 1 });
    await settle();
    const box = () => wrapper!.find('[data-test="traces-latency-heatmap-selection"]');
    expect(box().exists()).toBe(true);

    document.body
      .querySelector<HTMLElement>('[data-test="traces-latency-heatmap-selection-drill-down"]')!
      .click();
    await settle();

    expect(box().exists()).toBe(false);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(wrapper.findComponent({ name: "TracesComparison" }).props("selection")).toEqual({
      kind: "duration",
      windowStartUs: START + 10 * S,
      windowEndUs: START + 30 * S,
      rangeStartUs: START,
      rangeEndUs: END,
      durationLoUs: 100_000,
      durationHiUs: 500_000,
      filter: "service_name = 'a'",
    });
  });

  it("renders Drill down inside the page target, not in place", async () => {
    vi.mocked(searchService.search).mockResolvedValue(HEATMAP_DATA as any);
    wrapper = mount(TracesMetricsDashboard, {
      props: { streamName: "default", show: true },
      attachTo: document.body,
      global: { plugins: [store, i18n] },
    });
    await settle();
    wrapper
      .findComponent({ name: "ChartRenderer" })
      .vm.$emit("updated:dataZoom", { start: 1, end: 2, start1: 0, end1: 1 });
    await settle();

    item("drill-down")!.click();
    await settle();

    // TracesComparison is stubbed here; it is the root that holds TracesDrillDownPage.
    const page = document.body.querySelector('[data-test="traces-comparison-stub"]');
    expect(page).not.toBeNull();
    expect(page!.closest("#traces-drill-down-page")).not.toBeNull();
    expect(wrapper.element.contains(page)).toBe(false);
  });
});
