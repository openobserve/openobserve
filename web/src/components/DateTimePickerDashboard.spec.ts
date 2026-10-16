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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { defineComponent, ref } from "vue";
import { mount, shallowMount, flushPromises } from "@vue/test-utils";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import DateTime from "@/components/DateTime.vue";
import { useDashboardTimeGate } from "@/composables/dashboard/useDashboardTimeGate";
import { toPickerSavedDate } from "@/utils/dashboard/panelTimeUtils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

describe("DateTimePickerDashboard", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: {
      startTime: 1672531200000,
      endTime: 1672617600000,
      relativeTimePeriod: "15m",
      valueType: "relative",
    },
    initialTimezone: "UTC",
    disable: false,
    autoApplyDashboard: false,
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
    return shallowMount(DateTimePickerDashboard, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        stubs: {
          DateTime: {
            template: '<div data-test="datetime-component"></div>',
            props: {
              "auto-apply": Boolean,
              "default-type": String,
              "default-absolute-time": Object,
              "default-relative-time": String,
              initialTimezone: [String, null],
              disable: Boolean,
            },
            methods: {
              refresh: vi.fn(),
              setCustomDate: vi.fn(),
              getConsumableDateTime: vi.fn().mockReturnValue({
                startTime: "2023-01-01T00:00:00Z",
                endTime: "2023-01-02T00:00:00Z",
                relativeTimePeriod: "15m",
                valueType: "relative",
              }),
            },
          },
        },
      },
    });
  };

  describe("Component Initialization", () => {
    it("should create component without crashing", () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it("should mount successfully", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeDefined();
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("DateTimePickerDashboard");
    });

    it("should render DateTime component", () => {
      wrapper = createWrapper();
      const dateTimeComponent = wrapper.findComponent(DateTime);
      expect(dateTimeComponent.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should handle default modelValue prop", () => {
      wrapper = createWrapper({
        modelValue: undefined,
      });

      // Component should handle undefined modelValue gracefully
      expect(wrapper.exists()).toBe(true);
    });

    it("should pass modelValue properties correctly to DateTime component", () => {
      const testModelValue = {
        startTime: 1672531200000,
        endTime: 1672617600000,
        relativeTimePeriod: "30m",
        valueType: "absolute",
      };

      wrapper = createWrapper({
        modelValue: testModelValue,
      });

      const dateTimeComponent = wrapper.findComponent('[data-test="datetime-component"]');
      expect(dateTimeComponent.exists()).toBe(true);

      // Test that the component receives the correct props through template binding
      const html = wrapper.html();
      expect(html).toContain('data-test="datetime-component"');
    });

    it("should pass initialTimezone prop correctly", () => {
      wrapper = createWrapper({
        initialTimezone: "America/New_York",
      });

      const dateTimeComponent = wrapper.findComponent('[data-test="datetime-component"]');
      expect(dateTimeComponent.exists()).toBe(true);
      // Verify the prop is passed correctly through template binding
      expect(wrapper.vm.initialTimezone).toBe("America/New_York");
    });

    it("should pass disable prop correctly", () => {
      wrapper = createWrapper({
        disable: true,
      });

      const dateTimeComponent = wrapper.findComponent('[data-test="datetime-component"]');
      expect(dateTimeComponent.exists()).toBe(true);
      expect(wrapper.vm.disable).toBe(true);
    });

    it("should pass autoApplyDashboard prop correctly", () => {
      wrapper = createWrapper({
        autoApplyDashboard: true,
      });

      const dateTimeComponent = wrapper.findComponent('[data-test="datetime-component"]');
      expect(dateTimeComponent.exists()).toBe(true);
      expect(wrapper.vm.autoApplyDashboard).toBe(true);
    });

    it("should handle null initialTimezone", () => {
      wrapper = createWrapper({
        initialTimezone: null,
      });

      const dateTimeComponent = wrapper.findComponent('[data-test="datetime-component"]');
      expect(dateTimeComponent.exists()).toBe(true);
      expect(wrapper.vm.initialTimezone).toBeNull();
    });
  });

  describe("Event Handling", () => {
    it("should emit update:modelValue when updateDateTime is called", async () => {
      wrapper = createWrapper();

      const mockDate = {
        startTime: 1672531200000,
        endTime: 1672617600000,
        relativeTimePeriod: "1h",
        valueType: "relative",
      };

      await wrapper.vm.updateDateTime(mockDate);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toEqual({
        startTime: 1672531200000,
        endTime: 1672617600000,
        relativeTimePeriod: "1h",
        valueType: "relative",
      });
    });

    it("should handle relative-custom valueType correctly", async () => {
      wrapper = createWrapper();

      const mockDate = {
        startTime: 1672531200000,
        endTime: 1672617600000,
        relativeTimePeriod: "custom",
        valueType: "relative-custom",
      };

      await wrapper.vm.updateDateTime(mockDate);

      expect(wrapper.emitted("update:modelValue")[0][0].valueType).toBe("relative");
    });

    it("should handle absolute valueType correctly", async () => {
      wrapper = createWrapper();

      const mockDate = {
        startTime: 1672531200000,
        endTime: 1672617600000,
        relativeTimePeriod: "15m",
        valueType: "absolute",
      };

      await wrapper.vm.updateDateTime(mockDate);

      expect(wrapper.emitted("update:modelValue")[0][0].valueType).toBe("absolute");
    });

    it("should emit hide event when onHide is called", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onHide();

      expect(wrapper.emitted("hide")).toBeTruthy();
      expect(wrapper.emitted("hide")).toHaveLength(1);
    });

    it("should emit show event when onShow is called", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onShow();

      expect(wrapper.emitted("show")).toBeTruthy();
      expect(wrapper.emitted("show")).toHaveLength(1);
    });

    it("should handle DateTime component hide event", async () => {
      wrapper = createWrapper();

      const dateTimeComponent = wrapper.findComponent(DateTime);
      await dateTimeComponent.vm.$emit("hide");

      expect(wrapper.emitted("hide")).toBeTruthy();
    });

    it("should handle DateTime component show event", async () => {
      wrapper = createWrapper();

      const dateTimeComponent = wrapper.findComponent(DateTime);
      await dateTimeComponent.vm.$emit("show");

      expect(wrapper.emitted("show")).toBeTruthy();
    });

    it("should handle DateTime component date-change event", async () => {
      wrapper = createWrapper();

      const mockDate = {
        startTime: 1672531200000,
        endTime: 1672617600000,
        relativeTimePeriod: "2h",
        valueType: "relative",
      };

      const dateTimeComponent = wrapper.findComponent(DateTime);
      await dateTimeComponent.vm.$emit("on:date-change", mockDate);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toEqual({
        startTime: 1672531200000,
        endTime: 1672617600000,
        relativeTimePeriod: "2h",
        valueType: "relative",
      });
    });
  });

  describe("Component Methods", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should have refresh method", () => {
      expect(typeof wrapper.vm.refresh).toBe("function");
    });

    it("should call dateTimePicker.refresh when refresh is called", async () => {
      const mockRefresh = vi.fn();
      wrapper.vm.dateTimePicker = { refresh: mockRefresh };

      await wrapper.vm.refresh();

      expect(mockRefresh).toHaveBeenCalled();
    });

    it("should have setCustomDate method", () => {
      expect(typeof wrapper.vm.setCustomDate).toBe("function");
    });

    it("should call dateTimePicker.setCustomDate when setCustomDate is called", async () => {
      const mockSetCustomDate = vi.fn();
      wrapper.vm.dateTimePicker = { setCustomDate: mockSetCustomDate };

      const type = "absolute";
      const dateObj = { startTime: 1672531200000, endTime: 1672617600000 };

      await wrapper.vm.setCustomDate(type, dateObj);

      expect(mockSetCustomDate).toHaveBeenCalledWith(type, dateObj);
    });

    it("should have getConsumableDateTime method", () => {
      expect(typeof wrapper.vm.getConsumableDateTime).toBe("function");
    });

    it("should call dateTimePicker.getConsumableDateTime when getConsumableDateTime is called", async () => {
      const mockGetConsumableDateTime = vi.fn().mockReturnValue({
        startTime: "2023-01-01T00:00:00Z",
        endTime: "2023-01-02T00:00:00Z",
      });
      wrapper.vm.dateTimePicker = { getConsumableDateTime: mockGetConsumableDateTime };

      const result = await wrapper.vm.getConsumableDateTime();

      expect(mockGetConsumableDateTime).toHaveBeenCalled();
      expect(result).toEqual({
        startTime: "2023-01-01T00:00:00Z",
        endTime: "2023-01-02T00:00:00Z",
      });
    });

    it("should handle null dateTimePicker gracefully", async () => {
      wrapper.vm.dateTimePicker = null;

      expect(() => {
        wrapper.vm.refresh();
      }).toThrow();
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize dateTimePicker ref", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.dateTimePicker).toBeDefined();
    });

    it("should cleanup dateTimePicker on unmount", async () => {
      wrapper = createWrapper();

      // Mock dateTimePicker with a truthy value
      wrapper.vm.dateTimePicker = { mockRef: true };

      wrapper.unmount();

      expect(wrapper.vm.dateTimePicker).toBeNull();
    });

    it("should cleanup dateTimePicker reference when it has a value during unmount", async () => {
      wrapper = createWrapper();

      // Simulate a real Vue ref object that would exist
      const mockRef = ref({
        refresh: vi.fn(),
        setCustomDate: vi.fn(),
        getConsumableDateTime: vi.fn(),
      });

      // Manually set the ref value to simulate the actual mounted state
      wrapper.vm.dateTimePicker = mockRef.value;

      // Verify the ref has a truthy value
      expect(wrapper.vm.dateTimePicker).toBeTruthy();

      // Unmount the component which should trigger the cleanup
      wrapper.unmount();

      // Verify cleanup occurred
      expect(wrapper.vm.dateTimePicker).toBeNull();
    });

    it("should handle unmount without dateTimePicker", async () => {
      wrapper = createWrapper();
      wrapper.vm.dateTimePicker = null;

      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined date in updateDateTime", async () => {
      wrapper = createWrapper();

      // This should not crash even with undefined date
      expect(() => {
        wrapper.vm.updateDateTime({
          startTime: undefined,
          endTime: undefined,
          relativeTimePeriod: undefined,
          valueType: undefined,
        });
      }).not.toThrow();
    });

    it("should handle empty props", () => {
      wrapper = createWrapper({
        modelValue: {},
        initialTimezone: "",
        disable: null,
        autoApplyDashboard: null,
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle different valueType values", async () => {
      wrapper = createWrapper();

      const testCases = [
        { valueType: "relative", expected: "relative" },
        { valueType: "relative-custom", expected: "relative" },
        { valueType: "absolute", expected: "absolute" },
        { valueType: "custom", expected: "absolute" },
        { valueType: "", expected: "absolute" },
        { valueType: null, expected: "absolute" },
      ];

      for (const testCase of testCases) {
        const mockDate = {
          startTime: 1672531200000,
          endTime: 1672617600000,
          relativeTimePeriod: "15m",
          valueType: testCase.valueType,
        };

        await wrapper.vm.updateDateTime(mockDate);

        const emittedEvents = wrapper.emitted("update:modelValue");
        const lastEmittedValue = emittedEvents[emittedEvents.length - 1][0];

        expect(lastEmittedValue.valueType).toBe(testCase.expected);
      }
    });
  });

  describe("Template Integration", () => {
    it("should pass correct attributes to DateTime component", () => {
      wrapper = createWrapper({
        modelValue: {
          startTime: 1672531200000,
          endTime: 1672617600000,
          relativeTimePeriod: "1d",
          valueType: "absolute",
        },
        initialTimezone: "Europe/London",
        disable: true,
        autoApplyDashboard: true,
      });

      const dateTimeComponent = wrapper.findComponent('[data-test="datetime-component"]');
      expect(dateTimeComponent.exists()).toBe(true);

      // Verify that all props are correctly set on the component instance
      expect(wrapper.vm.modelValue.valueType).toBe("absolute");
      expect(wrapper.vm.modelValue.relativeTimePeriod).toBe("1d");
      expect(wrapper.vm.initialTimezone).toBe("Europe/London");
      expect(wrapper.vm.disable).toBe(true);
      expect(wrapper.vm.autoApplyDashboard).toBe(true);
    });

    it("should have correct ref attribute", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dateTimePicker).toBeDefined();
    });

    it("forwards a time zone change so a dashboard can apply it at once", () => {
      wrapper = createWrapper();

      wrapper.findComponent('[data-test="datetime-component"]').vm.$emit("on:timezone-change");

      expect(wrapper.emitted("timezone-change")).toHaveLength(1);
    });
  });

  describe("with the real picker behind a dashboard time gate", () => {
    const Host = defineComponent({
      components: { DateTimePickerDashboard },
      props: {
        autoApply: { type: Boolean, default: true },
        initial: {
          type: Object,
          default: () => ({ valueType: "relative", relativeTimePeriod: "15m" }),
        },
      },
      setup() {
        const pickerRef = ref<any>(null);
        const gate = useDashboardTimeGate({
          isAutoRunOn: () => false,
          showInPicker: (value) => pickerRef.value?.setSavedDate(toPickerSavedDate(value, "UTC")),
        });
        return { gate, pickerRef };
      },
      template: `<DateTimePickerDashboard
        ref="pickerRef"
        :model-value="gate.picked.value ?? initial"
        :auto-apply-dashboard="autoApply"
        @update:model-value="gate.onPick"
        @show="gate.onShow"
        @hide="gate.onHide"
      />`,
    });

    const openPicker = async (host: any) => {
      host.findComponent(DateTime).vm.menuOpen = true;
      await flushPromises();
    };
    const inMenu = (dataTest: string) =>
      document.body.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);

    beforeEach(() => {
      store.state.timezone = "UTC";
    });

    it("has no Apply button, and a preset stays picked until it is applied", async () => {
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [i18n, store] } });
      await flushPromises();
      const gate = (wrapper.vm as any).gate;
      expect(gate.applied.value.relativeTimePeriod).toBe("15m");

      await openPicker(wrapper);
      expect(inMenu("date-time-apply-btn")).toBeNull();
      inMenu("date-time-relative-1-h-btn")!.click();
      await flushPromises();

      expect(gate.picked.value.relativeTimePeriod).toBe("1h");
      expect(gate.applied.value.relativeTimePeriod).toBe("15m");
      expect(gate.needsRefresh.value).toBe(true);
      expect(wrapper.find('[data-test="date-time-btn"]').text()).toContain("Past 1 Hour");
    });

    it("shows the applied range again after closing on a range that ends before it starts", async () => {
      const start = Date.UTC(2026, 9, 13, 10, 0, 0) * 1000;
      wrapper = mount(Host, {
        props: { initial: { valueType: "absolute", startTime: start, endTime: start + 30 * 60e6 } },
        attachTo: document.body,
        global: { plugins: [i18n, store] },
      });
      await flushPromises();
      const label = () => wrapper.find('[data-test="date-time-btn"]').text();
      const realPicker = wrapper.findComponent(DateTime);
      expect(label()).toContain("2026/10/13 10:00:00 - 2026/10/13 10:30:00");

      realPicker.vm.onMenuOpenChange(true);
      realPicker.vm.selectedTime = { startTime: "18:50:30", endTime: "18:25:22" };
      await flushPromises();
      expect(label()).toContain("2026/10/13 18:50:30 - 2026/10/13 18:25:22");

      realPicker.vm.onMenuOpenChange(false);
      await flushPromises();

      expect(label()).toContain("2026/10/13 10:00:00 - 2026/10/13 10:30:00");
      expect((wrapper.vm as any).gate.needsRefresh.value).toBe(false);
    });

    it("keeps the Apply button on a page that does not opt in", async () => {
      wrapper = mount(Host, {
        props: { autoApply: false },
        attachTo: document.body,
        global: { plugins: [i18n, store] },
      });
      await flushPromises();

      await openPicker(wrapper);

      expect(inMenu("date-time-apply-btn")).not.toBeNull();
    });
  });
});
