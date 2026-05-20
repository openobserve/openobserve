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
import { mount, VueWrapper } from "@vue/test-utils";
import ViewPerformanceMetrics from "./ViewPerformanceMetrics.vue";

function createMockMetrics(overrides: Record<string, any> = {}) {
  return {
    view: {
      largest_contentful_paint: 2000000000, // 2s
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
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("core web vitals", () => {
    it("renders LCP metric text when largest_contentful_paint is present", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.text()).toContain("Largest Contentful Paint");
      expect(wrapper.text()).toContain("LCP");
    });

    it("renders FID metric text when first_input_delay is present", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.text()).toContain("First Input Delay");
      expect(wrapper.text()).toContain("FID");
    });

    it("renders CLS metric text when cumulative_layout_shift is present", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.text()).toContain("Cumulative Layout Shift");
      expect(wrapper.text()).toContain("CLS");
    });

    it("renders INP metric text when interaction_to_next_paint is present", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.text()).toContain("Interaction to Next Paint");
      expect(wrapper.text()).toContain("INP");
    });
  });

  describe("additional metrics", () => {
    it("renders FCP metric text when first_contentful_paint is present", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.text()).toContain("First Contentful Paint");
      expect(wrapper.text()).toContain("FCP");
    });

    it("renders TTFB metric text when time_to_first_byte is present", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.text()).toContain("Time to First Byte");
      expect(wrapper.text()).toContain("TTFB");
    });

    it("renders DOM timing metric texts when dom metrics are present", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.text()).toContain("DOM Interactive");
      expect(wrapper.text()).toContain("DOM Content Loaded");
      expect(wrapper.text()).toContain("DOM Complete");
    });

    it("renders Load Event metric text when load_event is present", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.text()).toContain("Load Event");
    });
  });

  describe("conditional rendering", () => {
    it("does not render metric-lcp card when largest_contentful_paint is undefined", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: {
          metrics: createMockMetrics({ largest_contentful_paint: undefined }),
        },
      });

      // Assert
      expect(wrapper.findAll('[data-test="metric-lcp"]').length).toBe(0);
    });

    it("does not render metric-fid card when first_input_delay is undefined", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics({ first_input_delay: undefined }) },
      });

      // Assert
      expect(wrapper.findAll('[data-test="metric-fid"]').length).toBe(0);
    });

    it("renders without errors when view object is empty", () => {
      // Arrange + Act
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: { view: {} } },
      });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders without errors when metrics prop is null", () => {
      // Arrange + Act
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: null },
      });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("data-test attributes", () => {
    it("has data-test=view-performance-metrics on the container", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(
        wrapper.find('[data-test="view-performance-metrics"]').exists(),
      ).toBe(true);
    });

    it("has data-test attributes on all core web vital metric cards", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: { metrics: createMockMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-lcp"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metric-fid"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metric-cls"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metric-inp"]').exists()).toBe(true);
    });
  });

  describe("status indicators via card presence", () => {
    it("renders metric-lcp card for LCP under 2.5s (good threshold)", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: {
          metrics: createMockMetrics({ largest_contentful_paint: 2000000000 }),
        },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-lcp"]').exists()).toBe(true);
    });

    it("renders metric-lcp card for LCP between 2.5s and 4s (needs-improvement threshold)", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: {
          metrics: createMockMetrics({ largest_contentful_paint: 3000000000 }),
        },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-lcp"]').exists()).toBe(true);
    });

    it("renders metric-lcp card for LCP over 4s (poor threshold)", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: {
          metrics: createMockMetrics({ largest_contentful_paint: 5000000000 }),
        },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-lcp"]').exists()).toBe(true);
    });

    it("renders metric-fid card for FID under 100ms (good threshold)", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: {
          metrics: createMockMetrics({ first_input_delay: 50000000 }),
        },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-fid"]').exists()).toBe(true);
    });

    it("renders metric-cls card for CLS under 0.1 (good threshold)", () => {
      // Arrange
      wrapper = mount(ViewPerformanceMetrics, {
        props: {
          metrics: createMockMetrics({ cumulative_layout_shift: 0.05 }),
        },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-cls"]').exists()).toBe(true);
    });
  });
});
