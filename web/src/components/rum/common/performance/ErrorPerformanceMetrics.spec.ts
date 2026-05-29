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
import ErrorPerformanceMetrics from "./ErrorPerformanceMetrics.vue";

function createMetrics(
  errorOverrides: Record<string, any> = {},
  viewOverrides: Record<string, any> = {},
) {
  return {
    error: {
      handling_duration: 250000000, // 250ms
      resource_status: 200,
      ...errorOverrides,
    },
    view: {
      time_spent: 5000000000, // 5s
      dom_interactive: 1500000000, // 1.5s
      ...viewOverrides,
    },
  };
}

describe("ErrorPerformanceMetrics", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("initial render", () => {
    it("renders without errors when valid metrics are provided", () => {
      // Arrange + Act
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders root container with data-test=error-performance-metrics", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(
        wrapper.find('[data-test="error-performance-metrics"]').exists(),
      ).toBe(true);
    });

    it("renders root container as a div element", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find("div").exists()).toBe(true);
    });
  });

  describe("conditional rendering", () => {
    it("renders handling-duration card when error.handling_duration is present", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(
        wrapper.find('[data-test="metric-handling-duration"]').exists(),
      ).toBe(true);
    });

    it("does not render handling-duration card when error.handling_duration is missing", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ handling_duration: undefined }) },
      });

      // Assert
      expect(
        wrapper.find('[data-test="metric-handling-duration"]').exists(),
      ).toBe(false);
    });

    it("renders time-spent card when view.time_spent is present", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-time-spent"]').exists()).toBe(
        true,
      );
    });

    it("does not render time-spent card when view.time_spent is missing", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({}, { time_spent: undefined }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-time-spent"]').exists()).toBe(
        false,
      );
    });

    it("renders dom-interactive card when view.dom_interactive is present", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-dom-interactive"]').exists()).toBe(
        true,
      );
    });

    it("does not render dom-interactive card when view.dom_interactive is missing", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({}, { dom_interactive: undefined }) },
      });

      // Assert
      expect(wrapper.find('[data-test="metric-dom-interactive"]').exists()).toBe(
        false,
      );
    });

    it("renders resource-status card when error.resource_status is a defined value", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics() },
      });

      // Assert
      expect(
        wrapper.find('[data-test="metric-resource-status"]').exists(),
      ).toBe(true);
    });

    it("does not render resource-status card when error.resource_status is undefined", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: {
          metrics: createMetrics({ resource_status: undefined }),
        },
      });

      // Assert
      expect(
        wrapper.find('[data-test="metric-resource-status"]').exists(),
      ).toBe(false);
    });

    it("renders resource-status card when error.resource_status is 0 (truthy check uses !== undefined)", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 0 }) },
      });

      // Assert — 0 !== undefined so the card should appear
      expect(
        wrapper.find('[data-test="metric-resource-status"]').exists(),
      ).toBe(true);
    });

    it("renders no metric cards when metrics is an empty object", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: {} } });

      // Assert
      expect(
        wrapper.find('[data-test="metric-handling-duration"]').exists(),
      ).toBe(false);
      expect(wrapper.find('[data-test="metric-time-spent"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="metric-dom-interactive"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="metric-resource-status"]').exists(),
      ).toBe(false);
    });
  });

  describe("resource status thresholds", () => {
    it("shows resource-status card for 2xx status codes", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 200 }) },
      });

      // Assert
      expect(
        wrapper.find('[data-test="metric-resource-status"]').exists(),
      ).toBe(true);
    });

    it("shows resource-status card for 3xx status codes", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 301 }) },
      });

      // Assert
      expect(
        wrapper.find('[data-test="metric-resource-status"]').exists(),
      ).toBe(true);
    });

    it("shows resource-status card for 4xx status codes", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 404 }) },
      });

      // Assert
      expect(
        wrapper.find('[data-test="metric-resource-status"]').exists(),
      ).toBe(true);
    });

    it("shows resource-status card for 5xx status codes", () => {
      // Arrange
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 500 }) },
      });

      // Assert
      expect(
        wrapper.find('[data-test="metric-resource-status"]').exists(),
      ).toBe(true);
    });
  });
});
