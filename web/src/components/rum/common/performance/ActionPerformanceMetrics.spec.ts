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
import ActionPerformanceMetrics from "./ActionPerformanceMetrics.vue";

installQuasar();

function createMetrics(overrides: Record<string, any> = {}) {
  return {
    action: {
      loading_time: 800000000,   // 800ms — good
      duration: 1200000000,      // 1.2s
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
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mount(ActionPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.exists()).toBe(true);
    });

    it("should have data-test=action-performance-metrics on root", () => {
      wrapper = mount(ActionPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="action-performance-metrics"]').exists()).toBe(true);
    });

    it("should use grid layout", () => {
      wrapper = mount(ActionPerformanceMetrics, { props: { metrics: createMetrics() } });
      const classes = wrapper.classes().join(" ");
      expect(classes).toContain("tw:grid");
    });
  });

  describe("conditional metric card rendering", () => {
    it("should render loading time metric when available", () => {
      wrapper = mount(ActionPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(true);
    });

    it("should not render loading time metric when missing", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: { action: {} } },
      });
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(false);
    });

    it("should render action duration metric when available", () => {
      wrapper = mount(ActionPerformanceMetrics, { props: { metrics: createMetrics() } });
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(true);
    });

    it("should not render duration when missing", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: { action: { loading_time: 1000 } } },
      });
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(false);
    });

    it("should render long tasks metric when count is 0", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ long_task: { count: 0 } }) },
      });
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(true);
    });

    it("should not render long tasks when count is undefined", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: { action: {} } },
      });
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(false);
    });

    it("should render resources loaded metric when count is 0", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ resource: { count: 0 } }) },
      });
      expect(wrapper.find('[data-test="metric-resources"]').exists()).toBe(true);
    });

    it("should render errors metric when count is 0", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ error: { count: 0 } }) },
      });
      expect(wrapper.find('[data-test="metric-errors"]').exists()).toBe(true);
    });

    it("should show no metrics when action object is empty", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: { action: {} } },
      });
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-duration"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-resources"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="metric-errors"]').exists()).toBe(false);
    });

    it("should show no metrics when metrics is null", () => {
      wrapper = mount(ActionPerformanceMetrics, { props: { metrics: null } });
      expect(wrapper.find('[data-test="metric-loading-time"]').exists()).toBe(false);
    });
  });

  describe("loading time status thresholds", () => {
    it("should pass good status for loading time <= 1s (1000000000 ns)", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ loading_time: 1000000000 }) },
      });
      const card = wrapper.find('[data-test="metric-loading-time"]');
      expect(card.exists()).toBe(true);
    });

    it("should pass needs-improvement status for loading time 1s–3s", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ loading_time: 2000000000 }) },
      });
      const card = wrapper.find('[data-test="metric-loading-time"]');
      expect(card.exists()).toBe(true);
    });

    it("should pass poor status for loading time > 3s", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ loading_time: 4000000000 }) },
      });
      const card = wrapper.find('[data-test="metric-loading-time"]');
      expect(card.exists()).toBe(true);
    });
  });

  describe("long task status thresholds", () => {
    it("should show good status for 0 long tasks", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ long_task: { count: 0 } }) },
      });
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(true);
    });

    it("should show needs-improvement for 1-2 long tasks", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ long_task: { count: 2 } }) },
      });
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(true);
    });

    it("should show poor status for > 2 long tasks", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ long_task: { count: 5 } }) },
      });
      expect(wrapper.find('[data-test="metric-long-tasks"]').exists()).toBe(true);
    });
  });

  describe("errors status", () => {
    it("should show good status when error count is 0", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ error: { count: 0 } }) },
      });
      expect(wrapper.find('[data-test="metric-errors"]').exists()).toBe(true);
    });

    it("should show poor status when error count > 0", () => {
      wrapper = mount(ActionPerformanceMetrics, {
        props: { metrics: createMetrics({ error: { count: 3 } }) },
      });
      expect(wrapper.find('[data-test="metric-errors"]').exists()).toBe(true);
    });
  });
});
