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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import PerformanceMetrics from "./PerformanceMetrics.vue";

installQuasar();

vi.mock("./performance/ViewPerformanceMetrics.vue", () => ({
  default: {
    name: "ViewPerformanceMetrics",
    template: '<div data-test="view-performance-metrics">View</div>',
    props: ["metrics"],
  },
}));

vi.mock("./performance/ActionPerformanceMetrics.vue", () => ({
  default: {
    name: "ActionPerformanceMetrics",
    template: '<div data-test="action-performance-metrics">Action</div>',
    props: ["metrics"],
  },
}));

vi.mock("./performance/ResourcePerformanceMetrics.vue", () => ({
  default: {
    name: "ResourcePerformanceMetrics",
    template: '<div data-test="resource-performance-metrics">Resource</div>',
    props: ["metrics"],
  },
}));

vi.mock("./performance/ErrorPerformanceMetrics.vue", () => ({
  default: {
    name: "ErrorPerformanceMetrics",
    template: '<div data-test="error-performance-metrics">Error</div>',
    props: ["metrics"],
  },
}));

const sampleMetrics = { view: { lcp: 2000 } };

describe("PerformanceMetrics", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "view", metrics: sampleMetrics },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should have data-test=performance-metrics on root", () => {
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "view", metrics: sampleMetrics },
      });
      expect(wrapper.find('[data-test="performance-metrics"]').exists()).toBe(true);
    });
  });

  describe("eventType routing", () => {
    it("should render ViewPerformanceMetrics when eventType=view", () => {
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "view", metrics: sampleMetrics },
      });
      expect(wrapper.find('[data-test="view-performance-metrics"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="action-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="resource-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="error-performance-metrics"]').exists()).toBe(false);
    });

    it("should render ActionPerformanceMetrics when eventType=action", () => {
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "action", metrics: sampleMetrics },
      });
      expect(wrapper.find('[data-test="action-performance-metrics"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="view-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="resource-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="error-performance-metrics"]').exists()).toBe(false);
    });

    it("should render ResourcePerformanceMetrics when eventType=resource", () => {
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "resource", metrics: sampleMetrics },
      });
      expect(wrapper.find('[data-test="resource-performance-metrics"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="view-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="action-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="error-performance-metrics"]').exists()).toBe(false);
    });

    it("should render ErrorPerformanceMetrics when eventType=error", () => {
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "error", metrics: sampleMetrics },
      });
      expect(wrapper.find('[data-test="error-performance-metrics"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="view-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="action-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="resource-performance-metrics"]').exists()).toBe(false);
    });

    it("should render fallback message for unknown eventType", () => {
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "unknown" as any, metrics: sampleMetrics },
      });
      expect(wrapper.find('[data-test="view-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="action-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="resource-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="error-performance-metrics"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("No performance data available");
    });
  });

  describe("metrics prop passing", () => {
    it("should pass metrics to the child component", () => {
      const metrics = { view: { lcp: 3000000000 } };
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "view", metrics },
      });
      expect(wrapper.find('[data-test="view-performance-metrics"]').exists()).toBe(true);
    });

    it("should handle null metrics without crashing", () => {
      wrapper = mount(PerformanceMetrics, {
        props: { eventType: "view", metrics: null as any },
      });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
