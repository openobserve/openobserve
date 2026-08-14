import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div>Home</div>" } }],
});

vi.mock("@/utils/zincutils", () => ({
  formatDateWithTimezone: vi.fn(() => "2023-01-01 10:00:00"),
  timestampToTimezoneDate: vi.fn(() => "2025/01/01"), // Use future date for optionsFn
  parseDateString: vi.fn(() => new Date("2023-01-01T10:00:00Z")),
  generateDurationLabel: vi.fn(() => "15m"),
  getCachedTimestamp: vi.fn(() => Date.now()),
  useLocalTimezone: vi.fn(() => "UTC"),
  getImageURL: vi.fn((path) => `/mocked/${path}`),
  convertToUtcTimestamp: vi.fn((dateStr) => new Date(dateStr).getTime() * 1000),
}));

vi.mock("@/utils/date", () => ({
  generateDurationLabel: vi.fn(() => "15m"),
  formatDateWithTimezone: vi.fn(() => "2023-01-01 10:00:00"),
  subtractRelativeTime: vi.fn((endDate: Date) => {
    const result = new Date(endDate);
    result.setMinutes(result.getMinutes() - 15);
    return result;
  }),
}));

vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((date) => new Date(date)),
}));

describe("DateTime Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    store.state.timezone = "UTC";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(DateTime, {
      props: {
        modelValue: {
          tab: "relative",
          relative: {
            period: { label: "Last 15 minutes", value: "15m" },
            value: 15,
            type: "minutes",
          },
          startDate: "",
          endDate: "",
          startTime: "",
          endTime: "",
        },
        ...props,
      },
      global: {
        plugins: [i18n, mockRouter],
        provide: {
          store,
        },
        stubs: {},
      },
    });
  };

  it("should mount DateTime component", () => {
    wrapper = createWrapper();
    expect(wrapper).toBeTruthy();
  });

  it("should have correct props", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeDefined();
  });

  it("should render without errors", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  describe("Function Coverage Tests", () => {
    it("should test setRelativeDate function", () => {
      wrapper = createWrapper();

      // Test setRelativeDate
      wrapper.vm.setRelativeDate("m", 30);

      expect(wrapper.vm.selectedType).toBe("relative");
      expect(wrapper.vm.relativePeriod).toBe("m");
      expect(wrapper.vm.relativeValue).toBe(30);
    });

    it("should test onCustomPeriodSelect function", () => {
      wrapper = createWrapper({
        queryRangeRestrictionInHour: 24,
        autoApply: false,
      });

      // Set up initial values
      wrapper.vm.selectedType = "relative";
      wrapper.vm.relativePeriod = "h";
      wrapper.vm.relativeValue = 48; // Exceeds restriction

      wrapper.vm.onCustomPeriodSelect();

      // Should be limited by restriction
      expect(wrapper.vm.relativeValue).toBeLessThanOrEqual(24);
    });

    it("should test setRelativeTime function", () => {
      wrapper = createWrapper();

      // Test valid period string
      wrapper.vm.setRelativeTime("30m");
      expect(wrapper.vm.relativePeriod).toBe("m");
      expect(wrapper.vm.relativeValue).toBe(30);

      // Test different period
      wrapper.vm.setRelativeTime("2h");
      expect(wrapper.vm.relativePeriod).toBe("h");
      expect(wrapper.vm.relativeValue).toBe(2);
    });

    it("should test resetTime function", () => {
      wrapper = createWrapper();

      // Test with no parameters
      wrapper.vm.resetTime("", "");

      expect(wrapper.vm.selectedTime.startTime).toBe("00:00:00");
      expect(wrapper.vm.selectedDate.from).toBeDefined();
      expect(wrapper.vm.selectedDate.to).toBeDefined();
    });

    it("should test setAbsoluteTime function", () => {
      wrapper = createWrapper();

      const startTime = new Date("2023-01-01T10:00:00").getTime() * 1000;
      const endTime = new Date("2023-01-01T12:00:00").getTime() * 1000;

      wrapper.vm.setAbsoluteTime(startTime, endTime);

      expect(wrapper.vm.selectedDate.from).toBeDefined();
      expect(wrapper.vm.selectedDate.to).toBeDefined();
      expect(wrapper.vm.selectedTime.startTime).toBeDefined();
      expect(wrapper.vm.selectedTime.endTime).toBeDefined();
    });

    it("should test saveDate function", async () => {
      wrapper = createWrapper();
      store.state.savedViewFlag = false;

      wrapper.vm.saveDate("relative");
      await wrapper.vm.$nextTick();

      // Should emit date change
      expect(wrapper.emitted("on:date-change")).toBeTruthy();
    });

    it("should stamp userChangedValue=true on a direct (user-initiated) saveDate", async () => {
      wrapper = createWrapper();
      // Let the mount-time programmatic flag reset back to user-initiated.
      await wrapper.vm.$nextTick();
      store.state.savedViewFlag = false;

      wrapper.vm.saveDate("relative");
      await wrapper.vm.$nextTick();

      const events = wrapper.emitted("on:date-change");
      expect(events).toBeTruthy();
      const lastPayload = events[events.length - 1][0];
      expect(lastPayload.userChangedValue).toBe(true);
    });

    it("should stamp userChangedValue=false when a programmatic setter precedes the emit", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      store.state.savedViewFlag = false;

      // setAbsoluteTime marks the change programmatic; the immediately-following
      // saveDate runs before the nextTick reset, so it must be tagged false.
      wrapper.vm.setAbsoluteTime(Date.now() * 1000 - 3_600_000_000, Date.now() * 1000);
      wrapper.vm.saveDate("absolute");
      await wrapper.vm.$nextTick();

      const events = wrapper.emitted("on:date-change");
      expect(events).toBeTruthy();
      const lastPayload = events[events.length - 1][0];
      expect(lastPayload.userChangedValue).toBe(false);
    });

    it("should test setCustomDate function", () => {
      wrapper = createWrapper();

      const dateobj = {
        start: new Date("2023-01-01T10:00:00").getTime(),
        end: new Date("2023-01-01T12:00:00").getTime(),
      };

      wrapper.vm.setCustomDate("absolute", dateobj);

      expect(wrapper.vm.selectedType).toBe("absolute");
      expect(wrapper.vm.selectedDate.from).toBeDefined();
      expect(wrapper.vm.selectedDate.to).toBeDefined();
    });

    it("should test onBeforeHide function", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedType = "absolute";
      wrapper.vm.selectedTime = { startTime: "10:00:00", endTime: "12:00:00" };

      wrapper.vm.onBeforeHide();

      // Should call resetTime for absolute type
      expect(wrapper.vm.selectedTime).toBeDefined();
    });

    it("should test getPeriodLabel computed property", () => {
      wrapper = createWrapper();

      wrapper.vm.relativePeriod = "m";
      expect(wrapper.vm.getPeriodLabel).toBe("Minutes");

      wrapper.vm.relativePeriod = "h";
      expect(wrapper.vm.getPeriodLabel).toBe("Hours");

      wrapper.vm.relativePeriod = "d";
      expect(wrapper.vm.getPeriodLabel).toBe("Days");
    });

    it("should test getConsumableDateTime function for relative type", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedType = "relative";
      wrapper.vm.relativePeriod = "m";
      wrapper.vm.relativeValue = 15;

      const result = wrapper.vm.getConsumableDateTime();

      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("endTime");
      expect(result).toHaveProperty("relativeTimePeriod");
      expect(result.relativeTimePeriod).toBe("15m");
    });

    it("should test getConsumableDateTime function for absolute type", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedType = "absolute";
      wrapper.vm.selectedDate = {
        from: "2023/01/01",
        to: "2023/01/01",
      };
      wrapper.vm.selectedTime = {
        startTime: "10:00:00",
        endTime: "12:00:00",
      };

      const result = wrapper.vm.getConsumableDateTime();

      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("endTime");
      expect(result).toHaveProperty("selectedDate");
      expect(result).toHaveProperty("selectedTime");
    });

    it("should test setSavedDate function with relative type", () => {
      wrapper = createWrapper();

      const dateobj = {
        type: "relative",
        relativeTimePeriod: "30m",
      };

      wrapper.vm.setSavedDate(dateobj);

      expect(wrapper.vm.selectedType).toBe("relative");
      expect(wrapper.vm.relativePeriod).toBe("m");
      expect(wrapper.vm.relativeValue).toBe(30);
    });

    it("should test setSavedDate function with absolute type", () => {
      wrapper = createWrapper();

      const dateobj = {
        type: "absolute",
        selectedDate: { from: "2023/01/01", to: "2023/01/01" },
        selectedTime: { startTime: "10:00:00", endTime: "12:00:00" },
      };

      wrapper.vm.setSavedDate(dateobj);

      expect(wrapper.vm.selectedType).toBe("absolute");
      expect(wrapper.vm.selectedDate).toEqual(dateobj.selectedDate);
      expect(wrapper.vm.selectedTime).toEqual(dateobj.selectedTime);
    });

    it("should test getDisplayValue computed property for relative type", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedType = "relative";
      wrapper.vm.relativeValue = 15;
      wrapper.vm.relativePeriod = "m";

      expect(wrapper.vm.getDisplayValue).toBe("Past 15 Minutes");
    });

    it("should test getDisplayValue computed property for absolute type", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedType = "absolute";
      wrapper.vm.selectedDate = {
        from: "2023/01/01",
        to: "2023/01/01",
      };
      wrapper.vm.selectedTime = {
        startTime: "10:00:00",
        endTime: "12:00:00",
      };

      const displayValue = wrapper.vm.getDisplayValue;
      expect(displayValue).toContain("2023/01/01");
      expect(displayValue).toContain("10:00:00");
      expect(displayValue).toContain("12:00:00");
    });

    it("should test timezoneFilterFn function", () => {
      wrapper = createWrapper();

      const mockUpdate = vi.fn((fn) => fn());
      wrapper.vm.timezoneFilterFn("UTC", mockUpdate);

      expect(mockUpdate).toHaveBeenCalled();
      expect(wrapper.vm.filteredTimezone).toBeDefined();
    });

    it("should test optionsFn function", () => {
      wrapper = createWrapper();

      // Test valid date
      const result1 = wrapper.vm.optionsFn("2023/01/15");
      expect(result1).toBe(true);

      // Test date too far in past
      const result2 = wrapper.vm.optionsFn("1990/01/01");
      expect(result2).toBe(false);
    });

    it("should test optionsFn with disableRelative and minDate", () => {
      wrapper = createWrapper({
        disableRelative: true,
        minDate: "2023/01/01",
      });

      // Test date after minDate
      const result1 = wrapper.vm.optionsFn("2023/06/15");
      expect(result1).toBe(true);

      // Test date before minDate
      const result2 = wrapper.vm.optionsFn("2022/12/31");
      expect(result2).toBe(false);
    });

    it("should test setDateType function", () => {
      wrapper = createWrapper();

      wrapper.vm.setDateType("absolute");
      expect(wrapper.vm.selectedType).toBe("absolute");

      wrapper.vm.setDateType("relative");
      expect(wrapper.vm.selectedType).toBe("relative");
    });

    it("should test computeRelativePeriod function", () => {
      wrapper = createWrapper({
        queryRangeRestrictionInHour: 48,
      });

      wrapper.vm.selectedType = "relative";
      wrapper.vm.computeRelativePeriod();

      expect(wrapper.vm.relativePeriodsMaxValue.s).toBe(60);
      expect(wrapper.vm.relativePeriodsMaxValue.m).toBe(60);
      expect(wrapper.vm.relativePeriodsMaxValue.h).toBe(48);
    });

    it("should test onTimezoneChange function", async () => {
      wrapper = createWrapper();

      wrapper.vm.timezone = "America/New_York";
      await wrapper.vm.onTimezoneChange();

      expect(wrapper.emitted("on:timezone-change")).toBeTruthy();
    });

    it("should test onTimezoneChange with browser time", async () => {
      wrapper = createWrapper();

      wrapper.vm.timezone = "browser time (utc)";
      await wrapper.vm.onTimezoneChange();

      expect(wrapper.emitted("on:timezone-change")).toBeTruthy();
    });

    it("should test showOnlyAbsolute function", () => {
      wrapper = createWrapper({
        disableRelative: true,
      });

      wrapper.vm.showOnlyAbsolute();
      expect(wrapper.vm.selectedType).toBe("absolute");
    });

    it("should test onHide and onShow functions", () => {
      wrapper = createWrapper();

      wrapper.vm.onHide();
      expect(wrapper.emitted("hide")).toBeTruthy();

      wrapper.vm.onShow();
      expect(wrapper.emitted("show")).toBeTruthy();
    });

    it("should test refresh function", async () => {
      wrapper = createWrapper();
      store.state.savedViewFlag = false;

      wrapper.vm.refresh();
      await wrapper.vm.$nextTick();

      // Should call saveDate
      expect(wrapper.emitted("on:date-change")).toBeTruthy();
    });

    it("should test timezoneFilterFn indirectly", () => {
      wrapper = createWrapper();

      // Test that filteredTimezone is accessible
      expect(wrapper.vm.filteredTimezone).toBeDefined();
      expect(wrapper.vm.timezoneFilterFn).toBeTypeOf("function");
    });

    it("should test date validation through getConsumableDateTime", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedType = "absolute";
      wrapper.vm.selectedDate = {
        from: "invalid",
        to: "invalid",
      };
      wrapper.vm.selectedTime = {
        startTime: "invalid",
        endTime: "invalid",
      };

      // Should handle invalid dates gracefully
      const result = wrapper.vm.getConsumableDateTime();
      expect(result).toBeDefined();
    });

    it("should test week conversion in getConsumableDateTime", () => {
      wrapper = createWrapper();

      wrapper.vm.selectedType = "relative";
      wrapper.vm.relativePeriod = "w";
      wrapper.vm.relativeValue = 2;

      const result = wrapper.vm.getConsumableDateTime();

      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("endTime");
      expect(result).toHaveProperty("relativeTimePeriod");
      expect(result.relativeTimePeriod).toBe("2w");
    });

    it("should test computeRelativePeriod with restrictions", () => {
      wrapper = createWrapper({
        queryRangeRestrictionInHour: 168, // 1 week
      });

      wrapper.vm.selectedType = "relative";
      wrapper.vm.relativePeriod = "w";
      wrapper.vm.relativeValue = 5;

      wrapper.vm.computeRelativePeriod();

      // Should compute appropriate restrictions
      expect(wrapper.vm.relativePeriodsMaxValue).toBeDefined();
      expect(wrapper.vm.relativePeriodsSelect).toBeDefined();
    });

    it("should test onCustomPeriodSelect with no restriction", async () => {
      wrapper = createWrapper({
        queryRangeRestrictionInHour: 0,
        autoApply: true,
      });
      store.state.savedViewFlag = false;

      wrapper.vm.selectedType = "relative";
      wrapper.vm.relativePeriod = "h";
      wrapper.vm.relativeValue = 48;

      wrapper.vm.onCustomPeriodSelect();
      await wrapper.vm.$nextTick();

      // Should not be limited when no restriction
      expect(wrapper.vm.relativeValue).toBe(48);
      expect(wrapper.emitted("on:date-change")).toBeTruthy();
    });

    it("should test setRelativeDate with autoApply", async () => {
      wrapper = createWrapper({ autoApply: true });
      store.state.savedViewFlag = false;

      wrapper.vm.setRelativeDate("h", 2);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedType).toBe("relative");
      expect(wrapper.vm.relativePeriod).toBe("h");
      expect(wrapper.vm.relativeValue).toBe(2);
      expect(wrapper.emitted("on:date-change")).toBeTruthy();
    });
  });
});
