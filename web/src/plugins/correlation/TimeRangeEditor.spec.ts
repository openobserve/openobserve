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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import {
  Quasar,
  QDialog,
  QCard,
  QCardSection,
  QCardActions,
  QBtn,
  QInput,
  QRadio,
  QIcon,
  QSeparator,
} from "quasar";
import TimeRangeEditor from "./TimeRangeEditor.vue";
import store from "@/test/unit/helpers/store";
import { nextTick } from "vue";

const mockTranslations = {
  "correlation.logs.timeRange.title": "Edit Time Range",
  "correlation.logs.timeRange.sourceTime": "Source Log Time",
  "correlation.logs.timeRange.window": "Time Window",
  "correlation.logs.timeRange.minute1": "±1 minute",
  "correlation.logs.timeRange.minute5": "±5 minutes",
  "correlation.logs.timeRange.minute15": "±15 minutes",
  "correlation.logs.timeRange.minute30": "±30 minutes",
  "correlation.logs.timeRange.hour1": "±1 hour",
  "correlation.logs.timeRange.custom": "Custom",
  "correlation.logs.timeRange.customStart": "Start Time",
  "correlation.logs.timeRange.customEnd": "End Time",
  "correlation.logs.timeRange.currentRange": "Current Range",
  "correlation.logs.timeRange.start": "Start",
  "correlation.logs.timeRange.end": "End",
  "correlation.logs.timeRange.duration": "Duration",
  "correlation.logs.timeRange.startBeforeEnd": "Start must be before end",
  "correlation.logs.timeRange.endAfterStart": "End must be after start",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.reset": "Reset",
  "common.apply": "Apply",
  "validation.required": "Required",
};

const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: {
    en: mockTranslations,
  },
});

// Source timestamp: Jan 1, 2024 12:00:00 UTC in microseconds
const SOURCE_TIMESTAMP_US = 1704110400000000;
// 5 minutes in microseconds
const FIVE_MIN_US = 5 * 60 * 1000 * 1000;

describe("TimeRangeEditor.vue", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: true,
    currentRange: {
      startTime: SOURCE_TIMESTAMP_US - FIVE_MIN_US,
      endTime: SOURCE_TIMESTAMP_US + FIVE_MIN_US,
    },
    sourceTimestamp: SOURCE_TIMESTAMP_US,
  };

  const createWrapper = (props = {}) => {
    return mount(TimeRangeEditor, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [
          [
            Quasar,
            {
              components: {
                QDialog,
                QCard,
                QCardSection,
                QCardActions,
                QBtn,
                QInput,
                QRadio,
                QIcon,
                QSeparator,
              },
            },
          ],
          i18n,
          store,
        ],
      },
      attachTo: document.body,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render dialog component", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(QDialog);
      expect(dialog.exists()).toBe(true);
    });

    it("should pass modelValue to dialog", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(QDialog);
      expect(dialog.props("modelValue")).toBe(true);
    });
  });

  describe("Initial State", () => {
    it("should default selectedWindow to 5min", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.selectedWindow).toBe("5min");
    });

    it("should initialize pendingStartTime from currentRange", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.pendingStartTime).toBe(defaultProps.currentRange.startTime);
    });

    it("should initialize pendingEndTime from currentRange", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.pendingEndTime).toBe(defaultProps.currentRange.endTime);
    });

    it("should initialize customStartTime as empty string", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.customStartTime).toBe("");
    });

    it("should initialize customEndTime as empty string", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.customEndTime).toBe("");
    });
  });

  describe("detectCurrentWindow", () => {
    it("should detect 5min preset when range is ±5 minutes", () => {
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - FIVE_MIN_US,
          endTime: SOURCE_TIMESTAMP_US + FIVE_MIN_US,
        },
      });
      expect(wrapper.vm.selectedWindow).toBe("5min");
    });

    it("should detect 1min preset when range is ±1 minute", () => {
      const oneMinUs = 1 * 60 * 1000 * 1000;
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - oneMinUs,
          endTime: SOURCE_TIMESTAMP_US + oneMinUs,
        },
      });
      expect(wrapper.vm.selectedWindow).toBe("1min");
    });

    it("should detect 15min preset when range is ±15 minutes", () => {
      const fifteenMinUs = 15 * 60 * 1000 * 1000;
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - fifteenMinUs,
          endTime: SOURCE_TIMESTAMP_US + fifteenMinUs,
        },
      });
      expect(wrapper.vm.selectedWindow).toBe("15min");
    });

    it("should detect 30min preset when range is ±30 minutes", () => {
      const thirtyMinUs = 30 * 60 * 1000 * 1000;
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - thirtyMinUs,
          endTime: SOURCE_TIMESTAMP_US + thirtyMinUs,
        },
      });
      expect(wrapper.vm.selectedWindow).toBe("30min");
    });

    it("should detect 1hour preset when range is ±1 hour", () => {
      const oneHourUs = 60 * 60 * 1000 * 1000;
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - oneHourUs,
          endTime: SOURCE_TIMESTAMP_US + oneHourUs,
        },
      });
      expect(wrapper.vm.selectedWindow).toBe("1hour");
    });

    it("should fall back to custom for asymmetric range", () => {
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - 1000000,
          endTime: SOURCE_TIMESTAMP_US + 9999000,
        },
      });
      expect(wrapper.vm.selectedWindow).toBe("custom");
    });
  });

  describe("applyPreset", () => {
    it("should set ±1 minute around sourceTimestamp for 1min preset", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "1min";
      wrapper.vm.applyPreset();
      await nextTick();

      const oneMinUs = 1 * 60 * 1000 * 1000;
      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - oneMinUs);
      expect(wrapper.vm.pendingEndTime).toBe(SOURCE_TIMESTAMP_US + oneMinUs);
    });

    it("should set ±5 minutes around sourceTimestamp for 5min preset", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "5min";
      wrapper.vm.applyPreset();
      await nextTick();

      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - FIVE_MIN_US);
      expect(wrapper.vm.pendingEndTime).toBe(SOURCE_TIMESTAMP_US + FIVE_MIN_US);
    });

    it("should set ±15 minutes around sourceTimestamp for 15min preset", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "15min";
      wrapper.vm.applyPreset();
      await nextTick();

      const fifteenMinUs = 15 * 60 * 1000 * 1000;
      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - fifteenMinUs);
      expect(wrapper.vm.pendingEndTime).toBe(SOURCE_TIMESTAMP_US + fifteenMinUs);
    });

    it("should set ±30 minutes around sourceTimestamp for 30min preset", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "30min";
      wrapper.vm.applyPreset();
      await nextTick();

      const thirtyMinUs = 30 * 60 * 1000 * 1000;
      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - thirtyMinUs);
      expect(wrapper.vm.pendingEndTime).toBe(SOURCE_TIMESTAMP_US + thirtyMinUs);
    });

    it("should set ±1 hour around sourceTimestamp for 1hour preset", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "1hour";
      wrapper.vm.applyPreset();
      await nextTick();

      const oneHourUs = 60 * 60 * 1000 * 1000;
      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - oneHourUs);
      expect(wrapper.vm.pendingEndTime).toBe(SOURCE_TIMESTAMP_US + oneHourUs);
    });

    it("should not change times for custom window preset", async () => {
      wrapper = createWrapper();
      const originalStart = wrapper.vm.pendingStartTime;
      const originalEnd = wrapper.vm.pendingEndTime;
      wrapper.vm.selectedWindow = "custom";
      wrapper.vm.applyPreset();
      await nextTick();

      expect(wrapper.vm.pendingStartTime).toBe(originalStart);
      expect(wrapper.vm.pendingEndTime).toBe(originalEnd);
    });
  });

  describe("formatDuration", () => {
    it("should format seconds correctly", () => {
      wrapper = createWrapper();
      const thirtySecsUs = 30 * 1000 * 1000;
      const result = wrapper.vm.formatDuration(thirtySecsUs);
      expect(result).toContain("30");
      expect(result).toContain("second");
    });

    it("should format minutes correctly", () => {
      wrapper = createWrapper();
      const tenMinsUs = 10 * 60 * 1000 * 1000;
      const result = wrapper.vm.formatDuration(tenMinsUs);
      expect(result).toContain("10");
      expect(result).toContain("min");
    });

    it("should format hours correctly", () => {
      wrapper = createWrapper();
      const twoHoursUs = 2 * 60 * 60 * 1000 * 1000;
      const result = wrapper.vm.formatDuration(twoHoursUs);
      expect(result).toContain("2");
      expect(result).toContain("hour");
    });

    it("should format minutes with seconds remainder", () => {
      wrapper = createWrapper();
      const ninetySecsUs = 90 * 1000 * 1000;
      const result = wrapper.vm.formatDuration(ninetySecsUs);
      expect(result).toContain("1");
      expect(result).toContain("min");
    });
  });

  describe("formatTimestamp", () => {
    it("should return a string", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.formatTimestamp(SOURCE_TIMESTAMP_US);
      expect(typeof result).toBe("string");
    });

    it("should format timestamp correctly", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.formatTimestamp(SOURCE_TIMESTAMP_US);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("datetimeToMicros", () => {
    it("should convert datetime-local string to microseconds", () => {
      wrapper = createWrapper();
      const datetime = "2024-01-01T12:00";
      const result = wrapper.vm.datetimeToMicros(datetime);
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThan(0);
    });

    it("should return value in microseconds (larger than ms)", () => {
      wrapper = createWrapper();
      const datetime = "2024-01-01T12:00";
      const result = wrapper.vm.datetimeToMicros(datetime);
      const expectedMs = new Date(datetime).getTime();
      expect(result).toBe(expectedMs * 1000);
    });
  });

  describe("microsToDatetime", () => {
    it("should convert microseconds to datetime-local format", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.microsToDatetime(SOURCE_TIMESTAMP_US);
      expect(typeof result).toBe("string");
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    });
  });

  describe("isValid computed", () => {
    it("should be true when pendingStartTime < pendingEndTime for preset window", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingStartTime = SOURCE_TIMESTAMP_US - FIVE_MIN_US;
      wrapper.vm.pendingEndTime = SOURCE_TIMESTAMP_US + FIVE_MIN_US;
      wrapper.vm.selectedWindow = "5min";

      expect(wrapper.vm.isValid).toBe(true);
    });

    it("should be false when pendingStartTime >= pendingEndTime", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingStartTime = SOURCE_TIMESTAMP_US + FIVE_MIN_US;
      wrapper.vm.pendingEndTime = SOURCE_TIMESTAMP_US - FIVE_MIN_US;

      expect(wrapper.vm.isValid).toBe(false);
    });

    it("should require both custom inputs when custom window selected", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "custom";
      wrapper.vm.customStartTime = "";
      wrapper.vm.customEndTime = "";

      expect(wrapper.vm.isValid).toBeFalsy();
    });

    it("should be valid for custom window with both inputs and valid order", () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "custom";
      wrapper.vm.customStartTime = "2024-01-01T10:00";
      wrapper.vm.customEndTime = "2024-01-01T12:00";
      wrapper.vm.pendingStartTime = SOURCE_TIMESTAMP_US - FIVE_MIN_US;
      wrapper.vm.pendingEndTime = SOURCE_TIMESTAMP_US + FIVE_MIN_US;

      expect(wrapper.vm.isValid).toBeTruthy();
    });
  });

  describe("handleApply", () => {
    it("should emit update:range with preset times for non-custom window", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "5min";
      wrapper.vm.pendingStartTime = SOURCE_TIMESTAMP_US - FIVE_MIN_US;
      wrapper.vm.pendingEndTime = SOURCE_TIMESTAMP_US + FIVE_MIN_US;

      wrapper.vm.handleApply();
      await nextTick();

      expect(wrapper.emitted("update:range")).toBeTruthy();
      expect(wrapper.emitted("update:range")?.[0]).toEqual([
        SOURCE_TIMESTAMP_US - FIVE_MIN_US,
        SOURCE_TIMESTAMP_US + FIVE_MIN_US,
      ]);
    });

    it("should emit update:modelValue false when applying", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "5min";
      wrapper.vm.pendingStartTime = SOURCE_TIMESTAMP_US - FIVE_MIN_US;
      wrapper.vm.pendingEndTime = SOURCE_TIMESTAMP_US + FIVE_MIN_US;

      wrapper.vm.handleApply();
      await nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should emit update:range with custom times for custom window", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "custom";
      wrapper.vm.customStartTime = "2024-01-01T11:00";
      wrapper.vm.customEndTime = "2024-01-01T13:00";

      const startMicros = new Date("2024-01-01T11:00").getTime() * 1000;
      const endMicros = new Date("2024-01-01T13:00").getTime() * 1000;

      wrapper.vm.handleApply();
      await nextTick();

      expect(wrapper.emitted("update:range")).toBeTruthy();
      expect(wrapper.emitted("update:range")?.[0]).toEqual([startMicros, endMicros]);
    });

    it("should not emit update:range for custom window when start >= end", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "custom";
      wrapper.vm.customStartTime = "2024-01-01T13:00";
      wrapper.vm.customEndTime = "2024-01-01T11:00";

      wrapper.vm.handleApply();
      await nextTick();

      expect(wrapper.emitted("update:range")).toBeFalsy();
    });
  });

  describe("handleCancel", () => {
    it("should restore original range on cancel", async () => {
      wrapper = createWrapper();
      const originalStart = defaultProps.currentRange.startTime;
      const originalEnd = defaultProps.currentRange.endTime;

      wrapper.vm.pendingStartTime = SOURCE_TIMESTAMP_US - 99999;
      wrapper.vm.pendingEndTime = SOURCE_TIMESTAMP_US + 99999;

      wrapper.vm.handleCancel();
      await nextTick();

      expect(wrapper.vm.pendingStartTime).toBe(originalStart);
      expect(wrapper.vm.pendingEndTime).toBe(originalEnd);
    });

    it("should emit update:modelValue false on cancel", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleCancel();
      await nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should emit close event on cancel", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleCancel();
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("handleReset", () => {
    it("should reset selectedWindow to 5min", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWindow = "1hour";

      wrapper.vm.handleReset();
      await nextTick();

      expect(wrapper.vm.selectedWindow).toBe("5min");
    });

    it("should reset times to ±5 minutes around source timestamp", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingStartTime = 0;
      wrapper.vm.pendingEndTime = 0;

      wrapper.vm.handleReset();
      await nextTick();

      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - FIVE_MIN_US);
      expect(wrapper.vm.pendingEndTime).toBe(SOURCE_TIMESTAMP_US + FIVE_MIN_US);
    });
  });

  describe("handleClose", () => {
    it("should restore original range on close", async () => {
      wrapper = createWrapper();
      const originalStart = defaultProps.currentRange.startTime;
      const originalEnd = defaultProps.currentRange.endTime;

      wrapper.vm.pendingStartTime = 0;
      wrapper.vm.pendingEndTime = 0;

      wrapper.vm.handleClose();
      await nextTick();

      expect(wrapper.vm.pendingStartTime).toBe(originalStart);
      expect(wrapper.vm.pendingEndTime).toBe(originalEnd);
    });

    it("should emit close event on dialog close", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleClose();
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("Props Reactivity", () => {
    it("should sync times when currentRange prop changes", async () => {
      wrapper = createWrapper();

      const newRange = {
        startTime: SOURCE_TIMESTAMP_US - 1000000,
        endTime: SOURCE_TIMESTAMP_US + 1000000,
      };

      await wrapper.setProps({ currentRange: newRange });
      await nextTick();

      expect(wrapper.vm.pendingStartTime).toBe(newRange.startTime);
      expect(wrapper.vm.pendingEndTime).toBe(newRange.endTime);
    });

    it("should reset pending times when dialog opens", async () => {
      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.pendingStartTime = 0;
      wrapper.vm.pendingEndTime = 0;

      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect(wrapper.vm.pendingStartTime).toBe(defaultProps.currentRange.startTime);
      expect(wrapper.vm.pendingEndTime).toBe(defaultProps.currentRange.endTime);
    });

    it("should initialize custom inputs when dialog opens", async () => {
      wrapper = createWrapper({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await nextTick();

      // customStartTime and customEndTime should be initialized
      expect(typeof wrapper.vm.customStartTime).toBe("string");
      expect(typeof wrapper.vm.customEndTime).toBe("string");
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero timestamp", () => {
      wrapper = createWrapper({
        sourceTimestamp: 0,
        currentRange: { startTime: 0, endTime: 1000000 },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle very large timestamps", () => {
      const largeTs = 9999999999999999;
      wrapper = createWrapper({
        sourceTimestamp: largeTs,
        currentRange: {
          startTime: largeTs - FIVE_MIN_US,
          endTime: largeTs + FIVE_MIN_US,
        },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should have all action handlers defined", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.handleApply).toBe("function");
      expect(typeof wrapper.vm.handleCancel).toBe("function");
      expect(typeof wrapper.vm.handleReset).toBe("function");
      expect(typeof wrapper.vm.handleClose).toBe("function");
    });
  });
});
