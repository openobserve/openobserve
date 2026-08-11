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

import { describe, expect, it, afterEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import ErrorOccurrencesChart from "@/components/rum/errorTracking/view/ErrorOccurrencesChart.vue";
import type { OccurrenceBucket } from "@/composables/rum/useErrorDetail";
import i18n from "@/locales";

const HOUR_US = 3_600_000_000;
const BASE_TS = Date.UTC(2026, 0, 10, 0, 0, 0) * 1000;

const buckets = (counts: number[]): OccurrenceBucket[] =>
  counts.map((events, index) => ({ ts: BASE_TS + index * HOUR_US, events }));

const store = createStore({ state: { theme: "light" } });

describe("ErrorOccurrencesChart", () => {
  let wrapper: VueWrapper<any>;

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(ErrorOccurrencesChart, {
      props: { buckets: buckets([1, 4, 2]), ...props },
      global: {
        plugins: [i18n, store],
        stubs: {
          // The real renderer boots ECharts against a canvas; stubbing it also
          // removes the async boundary and exposes `data` for assertion.
          ChartRenderer: {
            name: "ChartRenderer",
            template: '<div data-test="chart-renderer-stub" />',
            props: ["data"],
          },
        },
      },
    });

  /** ECharts options handed to the (stubbed) renderer. */
  const chartOptions = () => wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("states", () => {
    it("renders the chart when there are occurrences", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="rum-error-occurrences-canvas"]').exists()).toBe(true);
    });

    it("shows skeleton bars while loading", () => {
      wrapper = mountComponent({ loading: true });

      expect(wrapper.find('[data-test="rum-error-occurrences-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-error-occurrences-canvas"]').exists()).toBe(false);
    });

    it("shows an empty state when every bucket is zero", () => {
      wrapper = mountComponent({ buckets: buckets([0, 0, 0]) });

      expect(wrapper.find('[data-test="rum-error-occurrences-empty"]').exists()).toBe(true);
    });

    it("shows an empty state when there are no buckets at all", () => {
      wrapper = mountComponent({ buckets: [] });

      expect(wrapper.find('[data-test="rum-error-occurrences-empty"]').exists()).toBe(true);
    });
  });

  describe("peak caption", () => {
    it("reports the busiest bucket", () => {
      wrapper = mountComponent({ buckets: buckets([1, 9, 2]) });

      expect(wrapper.find('[data-test="rum-error-occurrences-peak"]').text()).toContain("9");
    });

    it("is hidden while loading", () => {
      wrapper = mountComponent({ loading: true });

      expect(wrapper.find('[data-test="rum-error-occurrences-peak"]').exists()).toBe(false);
    });

    it("is hidden when there is nothing to peak at", () => {
      wrapper = mountComponent({ buckets: buckets([0, 0]) });

      expect(wrapper.find('[data-test="rum-error-occurrences-peak"]').exists()).toBe(false);
    });
  });

  describe("chart options", () => {
    it("plots one bar per bucket", async () => {
      wrapper = mountComponent({ buckets: buckets([1, 4, 2]) });
      await flushPromises();

      expect(chartOptions().series[0].data).toEqual([1, 4, 2]);
    });

    it("marks the bucket that holds the event being viewed", async () => {
      wrapper = mountComponent({
        buckets: buckets([1, 4, 2]),
        currentTimestamp: BASE_TS + HOUR_US + 60_000_000,
      });
      await flushPromises();

      expect(chartOptions().series[0].markLine.data).toEqual([{ xAxis: 1 }]);
    });

    it("draws no marker when the viewed event falls outside the window", async () => {
      wrapper = mountComponent({
        buckets: buckets([1, 4, 2]),
        currentTimestamp: BASE_TS - HOUR_US,
      });
      await flushPromises();

      expect(chartOptions().series[0].markLine).toBeUndefined();
    });

    it("draws no marker when no event timestamp was given", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(chartOptions().series[0].markLine).toBeUndefined();
    });
  });
});
