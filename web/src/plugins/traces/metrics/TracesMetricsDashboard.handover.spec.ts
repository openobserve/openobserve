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

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";

// `__esModule` is load-bearing: the component reaches this through defineAsyncComponent.
vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  __esModule: true,
  default: {
    name: "RenderDashboardCharts",
    template: '<div data-test="render-dashboard-charts"></div>',
  },
}));

vi.mock("./TracesLatencyHeatmap.vue", () => ({
  __esModule: true,
  default: {
    name: "TracesLatencyHeatmap",
    template: '<div data-test="traces-latency-heatmap"></div>',
  },
}));

const mockSearchObj = reactive({
  loading: false,
  data: {
    editorValue: "",
    datetime: { startTime: 1_000_000, endTime: 2_000_000 },
    stream: {
      selectedStream: { value: "default" },
      selectedStreamFields: [],
      userDefinedSchema: [],
    },
  },
  meta: { showHistogram: true, metricsRangeFilters: new Map(), searchMode: "traces" },
});

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj, tracesParser: { value: null } }),
}));

vi.mock("@/composables/useParser", () => ({
  default: vi.fn(() => ({ sqlParser: vi.fn().mockResolvedValue({}) })),
}));

import TracesMetricsDashboard from "./TracesMetricsDashboard.vue";

const store = createStore({
  state: { theme: "light", timezone: "UTC", selectedOrganization: { identifier: "test-org" } },
});

describe("TracesMetricsDashboard hand-over from the page placeholder", () => {
  it("draws the RED placeholder, never a blank, until its charts component resolves", async () => {
    const wrapper = mount(TracesMetricsDashboard, {
      props: { streamName: "my_traces_stream", show: true },
      global: { plugins: [store, i18n], stubs: { teleport: true } },
    });
    const placeholder = () => wrapper.find('[data-test="traces-red-placeholder"]');
    expect(placeholder().exists()).toBe(true);
    expect(placeholder().findAll('[role="img"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(false);
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(true),
    );
    expect(placeholder().exists()).toBe(false);
    wrapper.unmount();
  });
});
