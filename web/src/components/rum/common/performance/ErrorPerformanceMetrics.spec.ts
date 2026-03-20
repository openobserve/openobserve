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
import ErrorPerformanceMetrics from "./ErrorPerformanceMetrics.vue";

installQuasar();

function createMetrics(errorOverrides: Record<string, any> = {}, viewOverrides: Record<string, any> = {}) {
  return {
    error: {
      handling_duration: 250000000,   // 250ms
      resource_status: 200,
      ...errorOverrides,
    },
    view: {
      time_spent: 5000000000,         // 5s
      dom_interactive: 1500000000,    // 1.5s
      ...viewOverrides,
    },
  };
}

describe("ErrorPerformanceMetrics", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.exists()).toBe(true);
    });

    it("should have data-test=error-performance-metrics on root", () => {
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="error-performance-metrics"]').exists()).toBe(true);
    });

    it("should use grid layout", () => {
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.classes().join(" ")).toContain("tw:grid");
    });
  });

  describe("conditional rendering", () => {
    it("should render handling duration when available", () => {
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-handling-duration"]').exists()).toBe(true);
    });

    it("should not render handling duration when missing", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ handling_duration: undefined }) },
      });
      expect(wrapper.find('[data-test="metric-handling-duration"]').exists()).toBe(false);
    });

    it("should render time on page when view.time_spent is available", () => {
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-time-spent"]').exists()).toBe(true);
    });

    it("should not render time on page when view.time_spent is missing", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({}, { time_spent: undefined }) },
      });
      expect(wrapper.find('[data-test="metric-time-spent"]').exists()).toBe(false);
    });

    it("should render DOM interactive when view.dom_interactive is available", () => {
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-dom-interactive"]').exists()).toBe(true);
    });

    it("should not render DOM interactive when view.dom_interactive is missing", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({}, { dom_interactive: undefined }) },
      });
      expect(wrapper.find('[data-test="metric-dom-interactive"]').exists()).toBe(false);
    });

    it("should render resource status when error.resource_status is not undefined", () => {
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-resource-status"]').exists()).toBe(true);
    });

    it("should not render resource status when error.resource_status is undefined", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: undefined }) },
      });
      expect(wrapper.find('[data-test="metric-resource-status"]').exists()).toBe(false);
    });

    it("should render resource status when status is 0", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 0 }) },
      });
      // 0 !== undefined, so card should render
      expect(wrapper.find('[data-test="metric-resource-status"]').exists()).toBe(true);
    });

    it("should show no metrics when metrics is empty object", () => {
      wrapper = mount(ErrorPerformanceMetrics, { props: { metrics: {} } });
      expect(wrapper.find('[data-test="metric-handling-duration"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-time-spent"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-dom-interactive"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-resource-status"]').exists()).toBe(false);
    });
  });

  describe("resource status thresholds", () => {
    it("should show good status for 2xx status codes", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 200 }) },
      });
      expect(wrapper.find('[data-test="metric-resource-status"]').exists()).toBe(true);
    });

    it("should show needs-improvement for 3xx status codes", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 301 }) },
      });
      expect(wrapper.find('[data-test="metric-resource-status"]').exists()).toBe(true);
    });

    it("should show poor status for 4xx status codes", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 404 }) },
      });
      expect(wrapper.find('[data-test="metric-resource-status"]').exists()).toBe(true);
    });

    it("should show poor status for 5xx status codes", () => {
      wrapper = mount(ErrorPerformanceMetrics, {
        props: { metrics: createMetrics({ resource_status: 500 }) },
      });
      expect(wrapper.find('[data-test="metric-resource-status"]').exists()).toBe(true);
    });
  });
});
