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

import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MetricChartTile from "./MetricChartTile.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { PreviewCancelledError } from "@/composables/metrics/useMetricsPreviewQueue";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";

const MetricCardChartStub = {
  name: "MetricCardChart",
  props: ["results", "queries", "chartType", "unit", "color", "timeRange", "legend"],
  template: `<div data-test="tile-chart-stub" />`,
};

const SERIES = { resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] };
const EMPTY = { resultType: "matrix", result: [] };
const QUERIES = [{ expr: "sum(rate(x[4m]))" }];

const runQuery = vi.fn();
const cancelQueries = vi.fn();

const mountTile = (props: Record<string, any> = {}) =>
  mount(MetricChartTile, {
    props: {
      queries: QUERIES,
      color: "#000",
      timeRange: { start_time: 1, end_time: 2 },
      runQuery,
      cancelQueries,
      dataTest: "tile",
      ...props,
    },
    slots: { header: "<span data-test='tile-header'>head</span>" },
    global: { plugins: [i18n, store], stubs: { MetricCardChart: MetricCardChartStub } },
  });

describe("MetricChartTile", () => {
  let wrapper: VueWrapper<any>;
  let shown: ReturnType<typeof installFakeIntersectionObserver>;

  beforeEach(() => {
    vi.clearAllMocks();
    runQuery.mockResolvedValue(SERIES);
    shown = installFakeIntersectionObserver({ autoVisible: true });
  });

  afterEach(() => {
    wrapper?.unmount();
    shown.restore();
  });

  it("renders its header and charts the result", async () => {
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.find('[data-test="tile-header"]').exists()).toBe(true);
    expect(runQuery).toHaveBeenCalledWith("sum(rate(x[4m]))");
    expect(wrapper.findComponent({ name: "MetricCardChart" }).props("results")).toEqual([SERIES]);
  });

  it("shows a skeleton while the query is not yet known, and runs nothing", async () => {
    wrapper = mountTile({ queries: null });
    await flushPromises();
    expect(runQuery).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="tile-loading"]').exists()).toBe(true);
  });

  it("says no data when the query returns no samples", async () => {
    runQuery.mockResolvedValue(EMPTY);
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.find('[data-test="tile-nodata"]').exists()).toBe(true);
  });

  it("says so when the metric has no chartable query", async () => {
    wrapper = mountTile({ queries: [] });
    await flushPromises();
    expect(runQuery).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="tile-nopreview"]').exists()).toBe(true);
  });

  it("shows a failed query with a retry that re-runs it", async () => {
    runQuery.mockRejectedValueOnce(new Error("boom"));
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.find('[data-test="tile-error"]').exists()).toBe(true);

    await wrapper.find('[data-test="tile-retry"]').trigger("click");
    await flushPromises();
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="tile-chart-stub"]').exists()).toBe(true);
  });

  it("treats a cancelled query as no error", async () => {
    runQuery.mockRejectedValue(new PreviewCancelledError("k"));
    wrapper = mountTile();
    await flushPromises();
    expect(wrapper.find('[data-test="tile-error"]').exists()).toBe(false);
  });

  it("cancels the old query and runs the new one when the query changes", async () => {
    runQuery.mockImplementation(() => new Promise(() => {}));
    wrapper = mountTile();
    await flushPromises();
    await wrapper.setProps({ queries: [{ expr: "y" }] });
    await flushPromises();
    expect(cancelQueries).toHaveBeenCalledWith(["sum(rate(x[4m]))"]);
    expect(runQuery).toHaveBeenLastCalledWith("y");
  });

  it("re-queries when the window moves", async () => {
    wrapper = mountTile();
    await flushPromises();
    await wrapper.setProps({ timeRange: { start_time: 3, end_time: 4 } });
    await flushPromises();
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("cancels its query when it unmounts", async () => {
    runQuery.mockImplementation(() => new Promise(() => {}));
    wrapper = mountTile();
    await flushPromises();
    wrapper.unmount();
    expect(cancelQueries).toHaveBeenCalledWith(["sum(rate(x[4m]))"]);
  });

  describe("lazy loading", () => {
    let io: ReturnType<typeof installFakeIntersectionObserver>;

    beforeEach(() => {
      io = installFakeIntersectionObserver();
    });

    afterEach(() => io.restore());

    it("runs nothing until the tile scrolls into view", async () => {
      wrapper = mountTile();
      await flushPromises();
      expect(runQuery).not.toHaveBeenCalled();

      io.setVisible(wrapper.element, true);
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(1);
    });

    it("cancels an unfinished query when the tile scrolls away, and resumes on return", async () => {
      runQuery.mockImplementationOnce(() => new Promise(() => {}));
      wrapper = mountTile();
      io.setVisible(wrapper.element, true);
      await flushPromises();

      io.setVisible(wrapper.element, false);
      await flushPromises();
      expect(cancelQueries).toHaveBeenCalledWith(["sum(rate(x[4m]))"]);

      io.setVisible(wrapper.element, true);
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="tile-chart-stub"]').exists()).toBe(true);
    });

    it("keeps a drawn chart when the tile scrolls away", async () => {
      wrapper = mountTile();
      io.setVisible(wrapper.element, true);
      await flushPromises();
      io.setVisible(wrapper.element, false);
      io.setVisible(wrapper.element, true);
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(1);
      expect(cancelQueries).not.toHaveBeenCalled();
    });

    it("defers a window change on an off-screen tile until it is seen", async () => {
      wrapper = mountTile();
      io.setVisible(wrapper.element, true);
      await flushPromises();
      io.setVisible(wrapper.element, false);
      await wrapper.setProps({ timeRange: { start_time: 3, end_time: 4 } });
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(1);

      io.setVisible(wrapper.element, true);
      await flushPromises();
      expect(runQuery).toHaveBeenCalledTimes(2);
    });
  });
});
