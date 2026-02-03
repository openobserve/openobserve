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
import MetricCard from "@/components/rum/common/performance/MetricCard.vue";

installQuasar();

describe("MetricCard", () => {
  describe("Component rendering", () => {
    it("should render metric card with label and value", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: 1000,
          unit: "",
        },
      });

      expect(wrapper.text()).toContain("Test Metric");
      expect(wrapper.text()).toContain("1,000");
    });

    it("should render icon when provided", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: 100,
          icon: "speed",
        },
      });

      const icon = wrapper.find('.q-icon[aria-hidden="true"]');
      expect(icon.exists()).toBe(true);
    });

    it("should not render icon when not provided", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: 100,
        },
      });

      const icons = wrapper.findAll('.q-icon');
      // Should have no icon since none was provided and no status
      expect(icons.length).toBe(0);
    });

    it("should render description when provided", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: 100,
          description: "This is a test metric",
        },
      });

      expect(wrapper.text()).toContain("This is a test metric");
    });
  });

  describe("Value formatting", () => {
    it("should format nanosecond values correctly", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Duration",
          value: 2500000000, // 2.5 seconds in nanoseconds
          unit: "ns",
        },
      });

      expect(wrapper.text()).toMatch(/2\.5|2500/);
    });

    it("should format numeric values with commas", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Count",
          value: 1234567,
          unit: "",
        },
      });

      expect(wrapper.text()).toContain("1,234,567");
    });

    it("should display N/A for null values", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: null,
        },
      });

      expect(wrapper.text()).toContain("N/A");
    });

    it("should display N/A for undefined values", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: undefined,
        },
      });

      expect(wrapper.text()).toContain("N/A");
    });

    it("should handle decimal values", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Resource Size",
          value: 10.5,
          unit: "MB",
        },
      });

      expect(wrapper.text()).toContain("10.5");
    });
  });

  describe("Status indicators", () => {
    it("should display good status with green styling", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "LCP",
          value: 2000000000,
          unit: "ns",
          status: "good",
        },
      });

      // Check for green background class on wrapper
      const wrapper_div = wrapper.find('.tw\\:bg-green-50');
      expect(wrapper_div.exists()).toBe(true);

      // Check for status icon
      const statusIcon = wrapper.findAll('.q-icon');
      expect(statusIcon.length).toBeGreaterThan(0);
    });

    it("should display needs-improvement status with yellow styling", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "LCP",
          value: 3000000000,
          unit: "ns",
          status: "needs-improvement",
        },
      });

      // Check for yellow background class on wrapper
      const wrapper_div = wrapper.find('.tw\\:bg-yellow-50');
      expect(wrapper_div.exists()).toBe(true);

      // Check for status icon
      const statusIcon = wrapper.findAll('.q-icon');
      expect(statusIcon.length).toBeGreaterThan(0);
    });

    it("should display poor status with red styling", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "LCP",
          value: 5000000000,
          unit: "ns",
          status: "poor",
        },
      });

      // Check for red background class on wrapper
      const wrapper_div = wrapper.find('.tw\\:bg-red-50');
      expect(wrapper_div.exists()).toBe(true);

      // Check for status icon
      const statusIcon = wrapper.findAll('.q-icon');
      expect(statusIcon.length).toBeGreaterThan(0);
    });

    it("should not display status indicator when status is not provided", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: 100,
        },
      });

      const statusIndicators = wrapper.findAll('[data-test="status-indicator"]');
      expect(statusIndicators.length).toBe(0);
    });
  });

  describe("Data test attributes", () => {
    it("should have data-test attribute when provided", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: 100,
          dataTest: "test-metric-card",
        },
      });

      const card = wrapper.find('[data-test="test-metric-card"]');
      expect(card.exists()).toBe(true);
    });

    it("should render without data-test attribute when not provided", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: 100,
        },
      });

      // Component should still render - it uses a div wrapper
      expect(wrapper.find('div').exists()).toBe(true);
      // data-test attribute should be empty string when not provided
      const dataTest = wrapper.attributes('data-test');
      expect(dataTest === undefined || dataTest === '').toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero value", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Count",
          value: 0,
        },
      });

      expect(wrapper.text()).toContain("0");
    });

    it("should handle negative values", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Delta",
          value: -100,
        },
      });

      expect(wrapper.text()).toContain("-100");
    });

    it("should handle very large numbers", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "Count",
          value: 999999999999,
        },
      });

      expect(wrapper.text()).toContain("999,999,999,999");
    });

    it("should handle floating point numbers", () => {
      const wrapper = mount(MetricCard, {
        props: {
          label: "CLS",
          value: 0.125,
          unit: "",
        },
      });

      expect(wrapper.text()).toContain("0.125");
    });
  });
});
