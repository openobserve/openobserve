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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";

// RenderDashboardCharts is real here; only GridStack, the panel body and the heatmap are stood in for.
vi.mock("gridstack", () => ({
  GridStack: {
    init: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
      removeAll: vi.fn(),
      makeWidget: vi.fn(),
      batchUpdate: vi.fn(),
      getGridItems: vi.fn().mockReturnValue([]),
      float: vi.fn(),
      setAnimation: vi.fn(),
      setStatic: vi.fn(),
      load: vi.fn(),
      getRow: vi.fn().mockReturnValue(60),
      getCellHeight: vi.fn().mockReturnValue(17),
      cellHeight: vi.fn(),
      engine: { nodes: [] },
    })),
  },
}));
vi.mock("gridstack/dist/gridstack.min.css", () => ({}));

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

type Frame = "page" | "cells" | "panels" | "default-lazy" | "blank";

const redFrame = (root: Element): Frame => {
  if (root.querySelector('[data-test="dashboard-placeholder-title-Panel_ID8254010"]'))
    return "default-lazy";
  if (root.querySelector('[data-test="traces-red-placeholder"]')) return "page";
  if (root.querySelectorAll('[data-test="stub-panel-container"]').length === 2) return "panels";
  if (root.querySelectorAll('[data-test="traces-red-panel-placeholder"]').length === 2)
    return "cells";
  return "blank";
};

describe("TracesMetricsDashboard RED panels from first paint to panel mount", () => {
  let io: ReturnType<typeof installFakeIntersectionObserver> | null = null;

  afterEach(() => {
    io?.restore();
    io = null;
  });

  it("keeps the same RED cells through the charts component and its lazy mount, never the shared lazy block", async () => {
    io = installFakeIntersectionObserver();
    const frames: Frame[] = [];
    const wrapper = mount(TracesMetricsDashboard, {
      props: { streamName: "my_traces_stream", show: true },
      attachTo: document.body,
      global: {
        plugins: [store, router, i18n],
        stubs: {
          teleport: true,
          PanelContainer: { template: '<div data-test="stub-panel-container"></div>' },
        },
      },
    });
    const observer = new MutationObserver(() => frames.push(redFrame(wrapper.element)));
    observer.observe(wrapper.element, { childList: true, subtree: true, attributes: true });
    frames.push(redFrame(wrapper.element));
    expect(frames[0]).toBe("page");

    await vi.waitFor(
      () => expect(wrapper.find('[data-test^="dashboard-panel-placeholder-"]').exists()).toBe(true),
      { timeout: 15000 },
    );
    await flushPromises();
    const cells = wrapper.findAll('[data-test="traces-red-panel-placeholder"]');
    expect(
      cells.map((c) => c.find('[data-test="traces-metrics-placeholder-title"]').text()),
    ).toEqual([expect.stringContaining("Rate"), "Errors"]);
    expect(cells[0].text()).toContain(i18n.global.t("traces.metrics.perSecond.traces"));
    cells.forEach((c) => expect(c.findAll('[role="img"]')).toHaveLength(1));
    expect(wrapper.find(".bg-surface-subtle").exists()).toBe(false);

    wrapper.findAll(".grid-stack-item").forEach((item) => io!.setVisible(item.element, true));
    await flushPromises();
    expect(wrapper.findAll('[data-test="stub-panel-container"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="traces-red-panel-placeholder"]').exists()).toBe(false);
    await flushPromises();
    observer.disconnect();

    const seen = frames.filter((f, i) => f !== frames[i - 1]);
    expect(seen).toEqual(["page", "cells", "panels"]);
    wrapper.unmount();
  }, 30000);
});
