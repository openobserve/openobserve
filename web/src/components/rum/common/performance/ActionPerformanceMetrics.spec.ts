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
import ActionPerformanceMetrics from "./ActionPerformanceMetrics.vue";

function createMetrics(overrides: Record<string, any> = {}) {
  return {
    action: {
      loading_time: 800000000, // 800ms — good
      duration: 1200000000, // 1.2s
      long_task: { count: 0 },
      resource: { count: 5 },
      error: { count: 0 },
      ...overrides,
    },
  };
}

describe("ActionPerformanceMetrics", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("initial render", () => {
    it("renders without errors when valid metrics are provided", () => {
      // Arrange + Act
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders root container with data-test=action-performance-metrics", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(
        wrapper.find('[data-test="action-performance-metrics"]').exists(),
      ).toBe(true);
    });

    it("renders root element as a div", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find("div").exists()).toBe(true);
    });
  });

  describe("conditional metric card rendering", () => {
    it("renders loading-time card when action.loading_time is present", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(
        true,
      );
    });

    it("does not render loading-time card when action.loading_time is missing", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: { action: {} } },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(
        false,
      );
    });

    it("renders duration card when action.duration is present", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });

    it("does not render duration card when action.duration is missing", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: { action: { loading_time: 1000 } } },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(false);
    });

    it("renders long-tasks card when action.long_task.count is 0", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ long_task: { count: 0 } }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(
        true,
      );
    });

    it("does not render long-tasks card when action.long_task.count is undefined", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: { action: {} } },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(
        false,
      );
    });

    it("renders resources card when action.resource.count is 0", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ resource: { count: 0 } }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-resources"]').exists()).toBe(true);
    });

    it("renders errors card when action.error.count is 0", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ error: { count: 0 } }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-errors"]').exists()).toBe(true);
    });

    it("renders no metric cards when action object is empty", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: { action: {} } },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="metric-resources"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="metric-errors"]').exists()).toBe(false);
    });

    it("renders no metric cards when metrics prop is null", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: null },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(
        false,
      );
    });
  });

  describe("loading time status thresholds", () => {
    it("renders loading-time card for good loading time (<=1s)", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ loading_time: 1000000000 }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(
        true,
      );
    });

    it("renders loading-time card for needs-improvement loading time (1s–3s)", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ loading_time: 2000000000 }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(
        true,
      );
    });

    it("renders loading-time card for poor loading time (>3s)", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ loading_time: 4000000000 }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(
        true,
      );
    });
  });

  describe("long task status thresholds", () => {
    it("renders long-tasks card for 0 long tasks (good)", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ long_task: { count: 0 } }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(
        true,
      );
    });

    it("renders long-tasks card for 1-2 long tasks (needs-improvement)", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ long_task: { count: 2 } }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(
        true,
      );
    });

    it("renders long-tasks card for >2 long tasks (poor)", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ long_task: { count: 5 } }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(
        true,
      );
    });
  });

  describe("errors status", () => {
    it("renders errors card when error count is 0 (good)", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ error: { count: 0 } }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-errors"]').exists()).toBe(true);
    });

    it("renders errors card when error count is greater than 0 (poor)", () => {
      // Arrange
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ error: { count: 3 } }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-errors"]').exists()).toBe(true);
    });
  });
});
