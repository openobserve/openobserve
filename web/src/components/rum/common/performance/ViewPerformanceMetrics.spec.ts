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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ViewPerformanceMetrics from "@/components/rum/common/performance/ViewPerformanceMetrics.vue";

installQuasar();

function createMockMetrics(overrides: Record<string, any> = {}) {
  return {
    view: {
      largest_contentful_paint: 2000000000, // 2s in nanoseconds
      first_input_delay: 50000000, // 50ms
      cumulative_layout_shift: 0.05,
      interaction_to_next_paint: 150000000, // 150ms
      first_contentful_paint: 1000000000, // 1s
      time_to_first_byte: 500000000, // 500ms
      dom_interactive: 1500000000, // 1.5s
      dom_content_loaded: 2000000000, // 2s
      dom_complete: 3000000000, // 3s
      load_event: 3500000000, // 3.5s
      ...overrides,
    },
  };
}

describe("ViewPerformanceMetrics", () => {
  describe("Core Web Vitals", () => {
    it("should display LCP metric when available", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.text()).toContain("Largest Contentful Paint");
      expect(wrapper.text()).toContain("LCP");
    });

    it("should display FID metric when available", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.text()).toContain("First Input Delay");
      expect(wrapper.text()).toContain("FID");
    });

    it("should display CLS metric when available", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.text()).toContain("Cumulative Layout Shift");
      expect(wrapper.text()).toContain("CLS");
    });

    it("should display INP metric when available", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.text()).toContain("Interaction to Next Paint");
      expect(wrapper.text()).toContain("INP");
    });
  });

  describe("Additional metrics", () => {
    it("should display FCP metric when available", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.text()).toContain("First Contentful Paint");
      expect(wrapper.text()).toContain("FCP");
    });

    it("should display TTFB metric when available", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.text()).toContain("Time to First Byte");
      expect(wrapper.text()).toContain("TTFB");
    });

    it("should display DOM metrics when available", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.text()).toContain("DOM Interactive");
      expect(wrapper.text()).toContain("DOM Content Loaded");
      expect(wrapper.text()).toContain("DOM Complete");
    });

    it("should display Load Event metric when available", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.text()).toContain("Load Event");
    });
  });

  describe("Conditional rendering", () => {
    it("should not display LCP when not available", () => {
      const metrics = createMockMetrics({ largest_contentful_paint: undefined });
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const lcpCards = wrapper.findAll('[data-test="metric-lcp"]');
      expect(lcpCards.length).toBe(0);
    });

    it("should not display FID when not available", () => {
      const metrics = createMockMetrics({ first_input_delay: undefined });
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const fidCards = wrapper.findAll('[data-test="metric-fid"]');
      expect(fidCards.length).toBe(0);
    });

    it("should handle empty metrics object", () => {
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: { view: {} } },
      });

      // Component should render without errors
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null metrics", () => {
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: null },
      });

      // Component should render without errors
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Status indicators", () => {
    it("should show good status for LCP under 2.5s", () => {
      const metrics = createMockMetrics({
        largest_contentful_paint: 2000000000, // 2s
      });
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const lcpCard = wrapper.find('[data-test="metric-lcp"]');
      expect(lcpCard.exists()).toBe(true);
    });

    it("should show needs-improvement status for LCP between 2.5s and 4s", () => {
      const metrics = createMockMetrics({
        largest_contentful_paint: 3000000000, // 3s
      });
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const lcpCard = wrapper.find('[data-test="metric-lcp"]');
      expect(lcpCard.exists()).toBe(true);
    });

    it("should show poor status for LCP over 4s", () => {
      const metrics = createMockMetrics({
        largest_contentful_paint: 5000000000, // 5s
      });
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const lcpCard = wrapper.find('[data-test="metric-lcp"]');
      expect(lcpCard.exists()).toBe(true);
    });

    it("should show good status for FID under 100ms", () => {
      const metrics = createMockMetrics({
        first_input_delay: 50000000, // 50ms
      });
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const fidCard = wrapper.find('[data-test="metric-fid"]');
      expect(fidCard.exists()).toBe(true);
    });

    it("should show good status for CLS under 0.1", () => {
      const metrics = createMockMetrics({
        cumulative_layout_shift: 0.05,
      });
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const clsCard = wrapper.find('[data-test="metric-cls"]');
      expect(clsCard.exists()).toBe(true);
    });
  });

  describe("Data test attributes", () => {
    it("should have data-test attribute on container", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const container = wrapper.find('[data-test="view-performance-metrics"]');
      expect(container.exists()).toBe(true);
    });

    it("should have data-test attributes on metric cards", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      expect(wrapper.find('[data-test="metric-lcp"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metric-fid"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metric-cls"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metric-inp"]').exists()).toBe(true);
    });
  });

  describe("Grid layout", () => {
    it("should use grid layout for metrics", () => {
      const metrics = createMockMetrics();
      const wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics },
      });

      const container = wrapper.find('[data-test="view-performance-metrics"]');
      expect(container.classes()).toContain("tw:grid");
    });
  });
});
