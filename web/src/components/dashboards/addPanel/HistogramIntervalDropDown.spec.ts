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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import HistogramIntervalDropDown from "@/components/dashboards/addPanel/HistogramIntervalDropDown.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

const defaultModelValue = {
  label: "Auto",
  value: null,
};

describe("HistogramIntervalDropDown", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: defaultModelValue
  };

  beforeEach(() => {
    vi.clearAllMocks();
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

    it("should have correct component structure", () => {
      wrapper = createWrapper();

      expect(wrapper.find('select, .q-select').exists() || wrapper.find('[data-test="histogram-interval-dropdown"]').exists()).toBe(true);
    });

    it("should display Auto as default value", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');
    });
  });

  describe("Props and Model Value", () => {
    it("should accept and display custom model value", () => {
      const customValue = {
        label: "1 minute",
        value: "1 minute"
      };

      wrapper = createWrapper({ modelValue: customValue });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('1 minute');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('1 minute');
    });

    it("should react to model value changes", async () => {
      wrapper = createWrapper();

      const newValue = {
        label: "5 minutes",
        value: "5 minutes"
      };

      await wrapper.setProps({ modelValue: newValue });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('5 minutes');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('5 minutes');
    });

    it("should handle null model value", () => {
      const nullValue = {
        label: null,
        value: null
      };

      wrapper = createWrapper({ modelValue: nullValue });

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
  });

  describe("Event Emissions", () => {
    it("should handle model value changes through component interaction", async () => {
      wrapper = createWrapper();

      // Test that we can change the internal model
      wrapper.vm.histogramIntervalModel = {
        label: "1 hour",
        value: "1 hour"
      };

      expect(wrapper.vm.histogramIntervalModel.label).toBe("1 hour");
    });

    it("should handle auto value selection", async () => {
      const customValue = {
        label: "1 minute", 
        value: "1 minute"
      };

      wrapper = createWrapper({ modelValue: customValue });

      // Change back to auto
      wrapper.vm.histogramIntervalModel = {
        label: "Auto",
        value: null
      };

      expect(wrapper.vm.histogramIntervalModel.label).toBe("Auto");
      expect(wrapper.vm.histogramIntervalModel.value).toBe(null);
    });
  });

  describe("Display Value Logic", () => {
    it("should handle null label correctly", () => {
      const nullLabelValue = {
        label: null,
        value: null
      };

      wrapper = createWrapper({ modelValue: nullLabelValue });

      expect(wrapper.vm.histogramIntervalModel.label).toBe(null);
    });

    it("should handle defined label correctly", () => {
      const customValue = {
        label: "5 minutes",
        value: "5 minutes"
      };

      wrapper = createWrapper({ modelValue: customValue });

      expect(wrapper.vm.histogramIntervalModel.label).toBe("5 minutes");
    });

    it("should handle undefined label correctly", () => {
      const undefinedLabelValue = {
        value: "1 minute"
      };

      wrapper = createWrapper({ modelValue: undefinedLabelValue });

      expect(wrapper.vm.histogramIntervalModel.label).toBeUndefined();
    });
  });

  describe("Component Properties", () => {
    it("should have dropdown element with correct attributes", () => {
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
  });

  describe("Edge Cases", () => {
    it("should handle invalid model value gracefully", () => {
      const invalidValue = "not an object";

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      wrapper = createWrapper({ modelValue: invalidValue as any });

      expect(wrapper.exists()).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it("should handle empty model value", () => {
      wrapper = createWrapper({ modelValue: {} });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Reactivity", () => {
    it("should update internal model when props change", async () => {
      wrapper = createWrapper();

      expect(wrapper.vm.histogramIntervalModel.label).toBe('Auto');

      const newValue = {
        label: "30 minutes",
        value: "30 minutes"
      };

      await wrapper.setProps({ modelValue: newValue });

      expect(wrapper.vm.histogramIntervalModel.label).toBe('30 minutes');
      expect(wrapper.vm.histogramIntervalModel.value).toBe('30 minutes');
    });

    it("should maintain reactivity with multiple prop changes", async () => {
      wrapper = createWrapper();

      const values = [
        { label: "1 minute", value: "1 minute" },
        { label: "1 hour", value: "1 hour" },
        { label: "1 day", value: "1 day" },
        { label: "Auto", value: null }
      ];

      for (const value of values) {
        await wrapper.setProps({ modelValue: value });
        expect(wrapper.vm.histogramIntervalModel).toEqual(value);
      }
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
});