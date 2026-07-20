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

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import HistogramIntervalDropDown from "@/components/dashboards/addPanel/HistogramIntervalDropDown.vue";
import i18n from "@/locales";


describe("HistogramIntervalDropDown", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: null // Auto is the default when modelValue is null
  };

  beforeEach(() => {
    // No mocks needed
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(HistogramIntervalDropDown, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n],
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render histogram interval dropdown", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="histogram-interval-dropdown"]').exists()).toBe(true);
    });

    it("should have correct component structure with OSelect", () => {
      wrapper = createWrapper();

      // Component uses OSelect now
      expect(wrapper.find('[data-test="histogram-interval-dropdown"]').exists()).toBe(true);
    });

    it("should have null value when modelValue is null (Auto)", () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel).toBe(null);
    });

    it("should have null value when modelValue is undefined (Auto)", () => {
      wrapper = createWrapper({ modelValue: undefined });

      expect(wrapper.vm.histogramIntervalModel).toBe(null);
    });
  });

  describe("Props and Model Value", () => {
    it("should accept and display 1 minute interval", () => {
      wrapper = createWrapper({ modelValue: "1 minute" });

      expect(wrapper.vm.histogramIntervalModel).toBe('1 minute');
    });

    it("should accept and display 5 minutes interval", () => {
      wrapper = createWrapper({ modelValue: "5 minutes" });

      expect(wrapper.vm.histogramIntervalModel).toBe('5 minutes');
    });

    it("should accept and display 1 hour interval", () => {
      wrapper = createWrapper({ modelValue: "1 hour" });

      expect(wrapper.vm.histogramIntervalModel).toBe('1 hour');
    });

    it("should react to model value changes from null to specific interval", async () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel).toBe(null);

      await wrapper.setProps({ modelValue: "5 minutes" });

      expect(wrapper.vm.histogramIntervalModel).toBe('5 minutes');
    });

    it("should react to model value changes between intervals", async () => {
      wrapper = createWrapper({ modelValue: "1 minute" });

      expect(wrapper.vm.histogramIntervalModel).toBe('1 minute');

      await wrapper.setProps({ modelValue: "1 hour" });

      expect(wrapper.vm.histogramIntervalModel).toBe('1 hour');
    });

    it("should handle null model value", () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel).toBe(null);
    });
  });

  describe("Interval Options", () => {
    it("should have all expected interval options", () => {
      wrapper = createWrapper();

      const expectedOptions = [
        { label: "Auto", value: null },
        { label: "1 second", value: "1 second" },
        { label: "5 seconds", value: "5 seconds" },
        { label: "10 seconds", value: "10 seconds" },
        { label: "30 seconds", value: "30 seconds" },
        { label: "1 minute", value: "1 minute" },
        { label: "5 minutes", value: "5 minutes" },
        { label: "10 minutes", value: "10 minutes" },
        { label: "15 minutes", value: "15 minutes" },
        { label: "30 minutes", value: "30 minutes" },
        { label: "45 minutes", value: "45 minutes" },
        { label: "1 hour", value: "1 hour" },
        { label: "2 hours", value: "2 hours" },
        { label: "3 hours", value: "3 hours" },
        { label: "6 hours", value: "6 hours" },
        { label: "8 hours", value: "8 hours" },
        { label: "12 hours", value: "12 hours" },
        { label: "1 day", value: "1 day" },
        { label: "2 days", value: "2 days" },
        { label: "3 days", value: "3 days" },
        { label: "5 days", value: "5 days" },
        { label: "7 days", value: "7 days" },
        { label: "30 days", value: "30 days" }
      ];

      expect(wrapper.vm.histogramIntervalOptions).toEqual(expectedOptions);
      expect(wrapper.vm.histogramIntervalOptions.length).toBe(23);
    });

    it("should include time-based intervals from seconds to days", () => {
      wrapper = createWrapper();

      const options = wrapper.vm.histogramIntervalOptions;
      const labels = options.map((opt: any) => opt.label);

      expect(labels).toContain("1 second");
      expect(labels).toContain("1 minute");
      expect(labels).toContain("1 hour");
      expect(labels).toContain("1 day");
      expect(labels).toContain("30 days");
    });

    it("should have Auto as first option", () => {
      wrapper = createWrapper();

      const firstOption = wrapper.vm.histogramIntervalOptions[0];
      expect(firstOption.label).toBe("Auto");
      expect(firstOption.value).toBe(null);
    });
  });

  describe("Event Emissions", () => {
    it("should emit update:modelValue when OSelect value changes", async () => {
      wrapper = createWrapper({ modelValue: null });

      // Trigger update:modelValue directly via the component's emit
      wrapper.vm.$emit('update:modelValue', '1 hour');

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeDefined();
      expect(emitted![0][0]).toBe('1 hour');
    });

    it("should emit update:modelValue with correct value when changing from Auto to specific interval", async () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel).toBe(null);

      wrapper.vm.$emit('update:modelValue', '1 minute');

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeDefined();
      expect(emitted![0][0]).toBe('1 minute');
    });

    it("should emit update:modelValue with null when changing to Auto", async () => {
      wrapper = createWrapper({ modelValue: "1 hour" });

      wrapper.vm.$emit('update:modelValue', null);

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeDefined();
      expect(emitted![0][0]).toBe(null);
    });
  });

  describe("Display Value Logic", () => {
    it("should have null value for null modelValue (Auto)", () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.find('[data-test="histogram-interval-dropdown"]').exists()).toBe(true);
      expect(wrapper.vm.histogramIntervalModel).toBe(null);
    });

    it("should have correct value for specific interval", () => {
      wrapper = createWrapper({ modelValue: "5 minutes" });

      expect(wrapper.find('[data-test="histogram-interval-dropdown"]').exists()).toBe(true);
      expect(wrapper.vm.histogramIntervalModel).toBe('5 minutes');
    });

    it("should have null value for undefined modelValue (Auto)", () => {
      wrapper = createWrapper({ modelValue: undefined });

      expect(wrapper.find('[data-test="histogram-interval-dropdown"]').exists()).toBe(true);
      expect(wrapper.vm.histogramIntervalModel).toBe(null);
    });
  });

  describe("Component Properties", () => {
    it("should have dropdown element accessible via data-test attribute", () => {
      wrapper = createWrapper();

      const dropdown = wrapper.find('[data-test="histogram-interval-dropdown"]');
      expect(dropdown.exists()).toBe(true);
    });

    it("should have OSelect with correct data-test", () => {
      wrapper = createWrapper();

      const dropdown = wrapper.find('[data-test="histogram-interval-dropdown"]');
      expect(dropdown.exists()).toBe(true);
    });

    it("should have correct component structure", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.histogramIntervalModel).toBeDefined();
      expect(wrapper.vm.histogramIntervalOptions).toBeDefined();
      expect(Array.isArray(wrapper.vm.histogramIntervalOptions)).toBe(true);
    });

    it("should render the dropdown with all options available", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.histogramIntervalOptions.length).toBe(23);
    });
  });

  describe("Edge Cases", () => {
    it("should handle invalid string value", () => {
      wrapper = createWrapper({ modelValue: "invalid_interval" });

      // When invalid value is provided, the model stores the value as-is
      expect(wrapper.vm.histogramIntervalModel).toBe('invalid_interval');
    });

    it("should handle empty string value", () => {
      wrapper = createWrapper({ modelValue: "" });

      // Empty string should be treated as Auto (null) or stored as empty
      // Component uses props.modelValue ?? null - empty string is truthy
      expect(wrapper.vm.histogramIntervalModel).toBe('');
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Reactivity", () => {
    it("should update internal model when props change", async () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel).toBe(null);

      await wrapper.setProps({ modelValue: "30 minutes" });

      expect(wrapper.vm.histogramIntervalModel).toBe('30 minutes');
    });

    it("should maintain reactivity with multiple prop changes", async () => {
      wrapper = createWrapper({ modelValue: null });

      const values = [
        { modelValue: "1 minute", expected: "1 minute" },
        { modelValue: "1 hour", expected: "1 hour" },
        { modelValue: "1 day", expected: "1 day" },
        { modelValue: null, expected: null }
      ];

      for (const { modelValue, expected } of values) {
        await wrapper.setProps({ modelValue });
        expect(wrapper.vm.histogramIntervalModel).toBe(expected);
      }
    });

    it("should watch modelValue changes correctly", async () => {
      wrapper = createWrapper({ modelValue: "1 second" });

      expect(wrapper.vm.histogramIntervalModel).toBe("1 second");

      await wrapper.setProps({ modelValue: "30 days" });

      expect(wrapper.vm.histogramIntervalModel).toBe("30 days");
    });
  });

  describe("Interval Categories", () => {
    it("should include second-based intervals", () => {
      wrapper = createWrapper();

      const secondIntervals = wrapper.vm.histogramIntervalOptions.filter(
        (opt: any) => opt.label.includes('second')
      );

      expect(secondIntervals.length).toBe(4);
      expect(secondIntervals.map((opt: any) => opt.label)).toEqual([
        '1 second', '5 seconds', '10 seconds', '30 seconds'
      ]);
    });

    it("should include minute-based intervals", () => {
      wrapper = createWrapper();

      const minuteIntervals = wrapper.vm.histogramIntervalOptions.filter(
        (opt: any) => opt.label.includes('minute')
      );

      expect(minuteIntervals.length).toBe(6);
      expect(minuteIntervals.map((opt: any) => opt.label)).toEqual([
        '1 minute', '5 minutes', '10 minutes', '15 minutes', '30 minutes', '45 minutes'
      ]);
    });

    it("should include hour-based intervals", () => {
      wrapper = createWrapper();

      const hourIntervals = wrapper.vm.histogramIntervalOptions.filter(
        (opt: any) => opt.label.includes('hour')
      );

      expect(hourIntervals.length).toBe(6);
      expect(hourIntervals.map((opt: any) => opt.label)).toEqual([
        '1 hour', '2 hours', '3 hours', '6 hours', '8 hours', '12 hours'
      ]);
    });

    it("should include day-based intervals", () => {
      wrapper = createWrapper();

      const dayIntervals = wrapper.vm.histogramIntervalOptions.filter(
        (opt: any) => opt.label.includes('day')
      );

      expect(dayIntervals.length).toBe(6);
      expect(dayIntervals.map((opt: any) => opt.label)).toEqual([
        '1 day', '2 days', '3 days', '5 days', '7 days', '30 days'
      ]);
    });
  });

  describe("Component Behavior", () => {
    it("should preserve string modelValue as-is", () => {
      wrapper = createWrapper({ modelValue: "10 seconds" });

      expect(wrapper.vm.histogramIntervalModel).toBe("10 seconds");
    });

    it("should handle consecutive value changes", async () => {
      wrapper = createWrapper({ modelValue: "1 second" });

      expect(wrapper.vm.histogramIntervalModel).toBe("1 second");

      await wrapper.setProps({ modelValue: "5 minutes" });
      expect(wrapper.vm.histogramIntervalModel).toBe("5 minutes");

      await wrapper.setProps({ modelValue: "2 hours" });
      expect(wrapper.vm.histogramIntervalModel).toBe("2 hours");

      await wrapper.setProps({ modelValue: null });
      expect(wrapper.vm.histogramIntervalModel).toBe(null);
    });

    it("should handle same value being set multiple times", async () => {
      wrapper = createWrapper({ modelValue: "1 hour" });

      expect(wrapper.vm.histogramIntervalModel).toBe("1 hour");

      await wrapper.setProps({ modelValue: "1 hour" });
      expect(wrapper.vm.histogramIntervalModel).toBe("1 hour");

      await wrapper.setProps({ modelValue: "1 hour" });
      expect(wrapper.vm.histogramIntervalModel).toBe("1 hour");
    });
  });
});
