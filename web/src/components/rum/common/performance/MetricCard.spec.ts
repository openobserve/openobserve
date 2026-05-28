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
import MetricCard from "./MetricCard.vue";

describe("MetricCard", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("component rendering", () => {
    it("renders label and value when both are provided", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: 1000, unit: "" },
      });

      // Assert
      expect(wrapper.text()).toContain("Test Metric");
      expect(wrapper.text()).toContain("1,000");
    });

    it("renders icon element when icon prop is provided", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: 100, icon: "speed" },
        global: {
          stubs: {
            OIcon: {
              name: "OIcon",
              template: '<span data-test="o-icon"></span>',
              props: ["name", "size", "color"],
            },
            OProgressBar: {
              template: "<div />",
              props: ["value", "variant", "size"],
            },
          },
        },
      });

      // Assert
      expect(wrapper.find('[data-test="o-icon"]').exists()).toBe(true);
    });

    it("does not render icon element when icon prop is omitted", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: 100 },
        global: {
          stubs: {
            OIcon: {
              name: "OIcon",
              template: '<span data-test="o-icon"></span>',
              props: ["name", "size", "color"],
            },
            OProgressBar: {
              template: "<div />",
              props: ["value", "variant", "size"],
            },
          },
        },
      });

      // Assert — no icon stub renders because v-if="icon" is false
      expect(wrapper.find('[data-test="o-icon"]').exists()).toBe(false);
    });

    it("renders description text when description prop is provided", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: {
          label: "Test Metric",
          value: 100,
          description: "This is a test metric",
        },
      });

      // Assert
      expect(wrapper.text()).toContain("This is a test metric");
    });
  });

  describe("value formatting", () => {
    it("formats nanosecond values by converting to a human-readable duration", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Duration", value: 2500000000, unit: "ns" },
      });

      // Assert — 2.5 billion ns = 2.5s; formatted output contains numeric portion
      expect(wrapper.text()).toMatch(/2\.5|2500/);
    });

    it("formats numeric values with comma separators", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Count", value: 1234567, unit: "" },
      });

      // Assert
      expect(wrapper.text()).toContain("1,234,567");
    });

    it("shows N/A when value is null", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: null },
      });

      // Assert
      expect(wrapper.text()).toContain("N/A");
    });

    it("shows N/A when value is undefined", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: undefined },
      });

      // Assert
      expect(wrapper.text()).toContain("N/A");
    });

    it("renders decimal values without truncation", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Resource Size", value: 10.5, unit: "MB" },
      });

      // Assert
      expect(wrapper.text()).toContain("10.5");
    });

    it("renders zero value as 0", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Count", value: 0 },
      });

      // Assert
      expect(wrapper.text()).toContain("0");
    });

    it("renders negative values with minus sign", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Delta", value: -100 },
      });

      // Assert
      expect(wrapper.text()).toContain("-100");
    });

    it("renders very large numbers with commas", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Count", value: 999999999999 },
      });

      // Assert
      expect(wrapper.text()).toContain("999,999,999,999");
    });

    it("renders floating point numbers without loss of precision", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "CLS", value: 0.125, unit: "" },
      });

      // Assert
      expect(wrapper.text()).toContain("0.125");
    });
  });

  describe("status indicators", () => {
    it("renders a status icon when status=good is provided", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "LCP", value: 2000000000, unit: "ns", status: "good" },
        global: {
          stubs: {
            OIcon: {
              name: "OIcon",
              template: '<span data-test="o-icon"></span>',
              props: ["name", "size", "color"],
            },
            OProgressBar: {
              template: "<div />",
              props: ["value", "variant", "size"],
            },
          },
        },
      });

      // Assert — status icon is rendered (v-if="status" branch)
      expect(wrapper.find('[data-test="o-icon"]').exists()).toBe(true);
    });

    it("renders a status icon when status=needs-improvement is provided", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: {
          label: "LCP",
          value: 3000000000,
          unit: "ns",
          status: "needs-improvement",
        },
        global: {
          stubs: {
            OIcon: {
              name: "OIcon",
              template: '<span data-test="o-icon"></span>',
              props: ["name", "size", "color"],
            },
            OProgressBar: {
              template: "<div />",
              props: ["value", "variant", "size"],
            },
          },
        },
      });

      // Assert
      expect(wrapper.find('[data-test="o-icon"]').exists()).toBe(true);
    });

    it("renders a status icon when status=poor is provided", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: {
          label: "LCP",
          value: 5000000000,
          unit: "ns",
          status: "poor",
        },
        global: {
          stubs: {
            OIcon: {
              name: "OIcon",
              template: '<span data-test="o-icon"></span>',
              props: ["name", "size", "color"],
            },
            OProgressBar: {
              template: "<div />",
              props: ["value", "variant", "size"],
            },
          },
        },
      });

      // Assert
      expect(wrapper.find('[data-test="o-icon"]').exists()).toBe(true);
    });

    it("does not render a status icon when status is not provided", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: 100 },
        global: {
          stubs: {
            OIcon: {
              name: "OIcon",
              template: '<span data-test="o-icon"></span>',
              props: ["name", "size", "color"],
            },
            OProgressBar: {
              template: "<div />",
              props: ["value", "variant", "size"],
            },
          },
        },
      });

      // Assert — no icon at all (no icon prop, no status)
      expect(wrapper.find('[data-test="o-icon"]').exists()).toBe(false);
    });

    it("does not render data-test status-indicator element when status is absent", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: 100 },
      });

      // Assert
      expect(wrapper.find('[data-test="status-indicator"]').exists()).toBe(false);
    });
  });

  describe("data-test attribute", () => {
    it("attaches data-test attribute to root element when dataTest prop is set", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: 100, dataTest: "test-metric-card" },
      });

      // Assert
      expect(wrapper.find('[data-test="test-metric-card"]').exists()).toBe(true);
    });

    it("renders root div element when dataTest prop is not provided", () => {
      // Arrange
      wrapper = mount(MetricCard, {
        props: { label: "Test Metric", value: 100 },
      });

      // Assert — root element exists; data-test is empty string (default)
      expect(wrapper.find("div").exists()).toBe(true);
      const dataTest = wrapper.attributes("data-test");
      expect(dataTest === undefined || dataTest === "").toBe(true);
    });
  });
});
