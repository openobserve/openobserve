// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import HistogramIntervalDropDown from "@/components/dashboards/addPanel/HistogramIntervalDropDown.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

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

    it("should have correct component structure with q-select", () => {
      wrapper = createWrapper();

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      expect(qSelect.exists()).toBe(true);
      expect(qSelect.classes()).toContain('q-select');
    });

    it("should display Auto as default value when modelValue is null", () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');
      expect(wrapper.vm.histogramIntervalModel.value).toBe(null);
    });

    it("should display Auto as default value when modelValue is undefined", () => {
      wrapper = createWrapper({ modelValue: undefined });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');
      expect(wrapper.vm.histogramIntervalModel.value).toBe(null);
    });
  });

  describe("Props and Model Value", () => {
    it("should accept and display 1 minute interval", () => {
      wrapper = createWrapper({ modelValue: "1 minute" });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('1 minute');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('1 minute');
    });

    it("should accept and display 5 minutes interval", () => {
      wrapper = createWrapper({ modelValue: "5 minutes" });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('5 minutes');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('5 minutes');
    });

    it("should accept and display 1 hour interval", () => {
      wrapper = createWrapper({ modelValue: "1 hour" });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('1 hour');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('1 hour');
    });

    it("should react to model value changes from null to specific interval", async () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');

      await wrapper.setProps({ modelValue: "5 minutes" });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('5 minutes');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('5 minutes');
    });

    it("should react to model value changes between intervals", async () => {
      wrapper = createWrapper({ modelValue: "1 minute" });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('1 minute');

      await wrapper.setProps({ modelValue: "1 hour" });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('1 hour');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('1 hour');
    });

    it("should handle null model value", () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');
      expect(wrapper.vm.histogramIntervalModel.value).toBe(null);
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
    it("should emit update:modelValue when QSelect value changes", async () => {
      wrapper = createWrapper({ modelValue: null });

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      const newInterval = { label: "1 hour", value: "1 hour" };

      // Trigger the update:model-value event on QSelect
      await qSelect.vm.$emit('update:model-value', newInterval);

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeDefined();
      expect(emitted![0][0]).toEqual(newInterval);
    });

    it("should emit update:modelValue with correct value when changing from Auto to specific interval", async () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.histogramIntervalModel.label).toBe("Auto");

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      const minuteInterval = { label: "1 minute", value: "1 minute" };

      await qSelect.vm.$emit('update:model-value', minuteInterval);

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeDefined();
      expect(emitted![0][0].value).toBe("1 minute");
    });

    it("should emit update:modelValue with null when changing to Auto", async () => {
      wrapper = createWrapper({ modelValue: "1 hour" });

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      const autoInterval = { label: "Auto", value: null };

      await qSelect.vm.$emit('update:model-value', autoInterval);

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeDefined();
      expect(emitted![0][0].value).toBe(null);
    });
  });

  describe("Display Value Logic", () => {
    it("should display 'Auto' for null modelValue", () => {
      wrapper = createWrapper({ modelValue: null });

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      expect(qSelect.exists()).toBe(true);
      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');
    });

    it("should display correct label for specific interval", () => {
      wrapper = createWrapper({ modelValue: "5 minutes" });

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      expect(qSelect.exists()).toBe(true);
      expect(wrapper.vm.histogramIntervalModel.label).toBe('5 minutes');
    });

    it("should display 'Auto' for undefined modelValue", () => {
      wrapper = createWrapper({ modelValue: undefined });

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      expect(qSelect.exists()).toBe(true);
      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');
    });
  });

  describe("Component Properties", () => {
    it("should have dropdown element accessible via data-test attribute", () => {
      wrapper = createWrapper();

      const dropdown = wrapper.find('[data-test="histogram-interval-dropdown"]');
      expect(dropdown.exists()).toBe(true);
    });

    it("should have QSelect component with correct props", () => {
      wrapper = createWrapper();

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      expect(qSelect.exists()).toBe(true);
      expect(qSelect.props('label')).toBe('Histogram interval');
      expect(qSelect.props('behavior')).toBe('menu');
      expect(qSelect.props('dense')).toBe(true);
      expect(qSelect.props('borderless')).toBe(true);
    });

    it("should have correct component structure", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.histogramIntervalModel).toBeDefined();
      expect(wrapper.vm.histogramIntervalOptions).toBeDefined();
      expect(Array.isArray(wrapper.vm.histogramIntervalOptions)).toBe(true);
    });

    it("should have QSelect with o2-custom-select-dashboard class", () => {
      wrapper = createWrapper();

      const qSelect = wrapper.findComponent({ name: 'QSelect' });
      expect(qSelect.classes()).toContain('o2-custom-select-dashboard');
    });
  });

  describe("Edge Cases", () => {
    it("should handle invalid string value gracefully", () => {
      wrapper = createWrapper({ modelValue: "invalid_interval" });

      // When invalid value is provided, component should default to Auto
      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');
      expect(wrapper.vm.histogramIntervalModel.value).toBe(null);
    });

    it("should handle empty string value", () => {
      wrapper = createWrapper({ modelValue: "" });

      // Empty string should be treated as Auto
      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');
      expect(wrapper.vm.histogramIntervalModel.value).toBe(null);
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

      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');

      await wrapper.setProps({ modelValue: "30 minutes" });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('30 minutes');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('30 minutes');
    });

    it("should maintain reactivity with multiple prop changes", async () => {
      wrapper = createWrapper({ modelValue: null });

      const values = [
        { modelValue: "1 minute", expected: { label: "1 minute", value: "1 minute" } },
        { modelValue: "1 hour", expected: { label: "1 hour", value: "1 hour" } },
        { modelValue: "1 day", expected: { label: "1 day", value: "1 day" } },
        { modelValue: null, expected: { label: "Auto", value: null } }
      ];

      for (const { modelValue, expected } of values) {
        await wrapper.setProps({ modelValue });
        expect(wrapper.vm.histogramIntervalModel.label).toBe(expected.label);
        expect(wrapper.vm.histogramIntervalModel.value).toBe(expected.value);
      }
    });

    it("should watch modelValue changes correctly", async () => {
      wrapper = createWrapper({ modelValue: "1 second" });

      expect(wrapper.vm.histogramIntervalModel.value).toBe("1 second");

      await wrapper.setProps({ modelValue: "30 days" });

      expect(wrapper.vm.histogramIntervalModel.value).toBe("30 days");
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
    it("should find correct option object from string modelValue", () => {
      wrapper = createWrapper({ modelValue: "10 seconds" });

      const model = wrapper.vm.histogramIntervalModel;
      expect(model).toEqual({ label: "10 seconds", value: "10 seconds" });
    });

    it("should handle consecutive value changes", async () => {
      wrapper = createWrapper({ modelValue: "1 second" });

      expect(wrapper.vm.histogramIntervalModel.value).toBe("1 second");

      await wrapper.setProps({ modelValue: "5 minutes" });
      expect(wrapper.vm.histogramIntervalModel.value).toBe("5 minutes");

      await wrapper.setProps({ modelValue: "2 hours" });
      expect(wrapper.vm.histogramIntervalModel.value).toBe("2 hours");

      await wrapper.setProps({ modelValue: null });
      expect(wrapper.vm.histogramIntervalModel.label).toBe("Auto");
    });

    it("should handle same value being set multiple times", async () => {
      wrapper = createWrapper({ modelValue: "1 hour" });

      expect(wrapper.vm.histogramIntervalModel.value).toBe("1 hour");

      await wrapper.setProps({ modelValue: "1 hour" });
      expect(wrapper.vm.histogramIntervalModel.value).toBe("1 hour");

      await wrapper.setProps({ modelValue: "1 hour" });
      expect(wrapper.vm.histogramIntervalModel.value).toBe("1 hour");
    });
  });
});
