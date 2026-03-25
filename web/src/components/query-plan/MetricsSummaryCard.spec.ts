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

import { describe, expect, it, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import MetricsSummaryCard from "./MetricsSummaryCard.vue";
import type { SummaryMetrics } from "@/utils/queryPlanParser";

installQuasar();

const defaultMetrics: SummaryMetrics = {
  totalTime: "1.23ms",
  totalRows: "1,000",
  peakMemory: "256KB",
};

function mountComponent(metrics: SummaryMetrics = defaultMetrics) {
  return mount(MetricsSummaryCard, {
    props: { metrics },
    global: {
      plugins: [i18n],
    },
  });
}

describe("MetricsSummaryCard", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render a q-card element", () => {
      wrapper = mountComponent();
      expect(wrapper.find(".metrics-summary-card").exists()).toBe(true);
    });

    it("should render all three metric items", () => {
      wrapper = mountComponent();
      const metricItems = wrapper.findAll(".metric-item");
      expect(metricItems).toHaveLength(3);
    });
  });

  describe("metrics display", () => {
    it("should display the totalTime value", () => {
      wrapper = mountComponent({ ...defaultMetrics, totalTime: "42.50ms" });
      const values = wrapper.findAll(".metric-value");
      expect(values.some((v) => v.text() === "42.50ms")).toBe(true);
    });

    it("should display the totalRows value", () => {
      wrapper = mountComponent({ ...defaultMetrics, totalRows: "5,678" });
      const values = wrapper.findAll(".metric-value");
      expect(values.some((v) => v.text() === "5,678")).toBe(true);
    });

    it("should display the peakMemory value", () => {
      wrapper = mountComponent({ ...defaultMetrics, peakMemory: "1.50MB" });
      const values = wrapper.findAll(".metric-value");
      expect(values.some((v) => v.text() === "1.50MB")).toBe(true);
    });

    it("should display all three values simultaneously", () => {
      wrapper = mountComponent({
        totalTime: "100ms",
        totalRows: "999",
        peakMemory: "N/A",
      });
      const text = wrapper.text();
      expect(text).toContain("100ms");
      expect(text).toContain("999");
      expect(text).toContain("N/A");
    });
  });

  describe("zero / edge-case values", () => {
    it("should display 0ms for zero total time", () => {
      wrapper = mountComponent({ ...defaultMetrics, totalTime: "0ms" });
      expect(wrapper.text()).toContain("0ms");
    });

    it("should display N/A for zero peak memory", () => {
      wrapper = mountComponent({ ...defaultMetrics, peakMemory: "N/A" });
      expect(wrapper.text()).toContain("N/A");
    });

    it("should display 0 for zero total rows", () => {
      wrapper = mountComponent({ ...defaultMetrics, totalRows: "0" });
      expect(wrapper.text()).toContain("0");
    });
  });

  describe("metric icons", () => {
    it("should render three metric icons", () => {
      wrapper = mountComponent();
      const icons = wrapper.findAll(".metric-icon");
      expect(icons).toHaveLength(3);
    });
  });

  describe("metric labels", () => {
    it("should render three metric labels", () => {
      wrapper = mountComponent();
      const labels = wrapper.findAll(".metric-label");
      expect(labels).toHaveLength(3);
    });
  });

  describe("props reactivity", () => {
    it("should update displayed values when metrics prop changes", async () => {
      wrapper = mountComponent({ totalTime: "1ms", totalRows: "10", peakMemory: "1KB" });
      expect(wrapper.text()).toContain("1ms");

      await wrapper.setProps({
        metrics: { totalTime: "999ms", totalRows: "10", peakMemory: "1KB" },
      });
      expect(wrapper.text()).toContain("999ms");
    });
  });
});
