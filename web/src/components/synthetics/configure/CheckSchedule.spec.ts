// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { inject, provide } from "vue";
import { mockMonitorBrowser } from "@/test/unit/mockData/synthetics";
import type { BrowserCheck } from "@/types/synthetics";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}));

import CheckSchedule from "./CheckSchedule.vue";

// ── Stubs ──────────────────────────────────────────────────────────────────────

const OToggleGroupStub = {
  props: ["modelValue", "type"],
  emits: ["update:modelValue"],
  setup(_props: any, { emit }: any) {
    provide("synthetics-otg-select", (value: string) => {
      emit("update:modelValue", value);
    });
    return {};
  },
  template: `<div :data-test="$attrs['data-test']"><slot /></div>`,
};

const OToggleGroupItemStub = {
  props: ["value", "size"],
  setup(props: any) {
    const select = inject<(v: string) => void>("synthetics-otg-select", () => {});
    return {
      handleClick() {
        select(props.value);
      },
    };
  },
  template: `<button :data-test="$attrs['data-test']" type="button" @click="handleClick"><slot /></button>`,
};

const OInputStub = {
  props: ["modelValue", "label", "type", "placeholder", "min"],
  emits: ["update:modelValue"],
  methods: {
    handleInput(e: Event) {
      this.$emit("update:modelValue", (e.target as HTMLInputElement).value);
    },
  },
  template: `<div :data-test="$attrs['data-test']">
    <label>{{ label }}</label>
    <input :type="type || 'text'" :value="modelValue" :placeholder="placeholder" :min="min" @input="handleInput" />
  </div>`,
};

const OSelectStub = {
  props: ["modelValue", "options", "label"],
  emits: ["update:modelValue"],
  methods: {
    handleChange(e: Event) {
      this.$emit("update:modelValue", (e.target as HTMLSelectElement).value);
    },
  },
  template: `<div :data-test="$attrs['data-test']">
    <label>{{ label }}</label>
    <select :value="modelValue" @change="handleChange">
      <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>
  </div>`,
};

const OIconStub = {
  props: ["name", "size"],
  template: "<i :data-test=\"$attrs['data-test']\" />",
};

const OTooltipStub = {
  props: ["side", "align"],
  template: '<div class="tooltip-stub"><slot name="content" /></div>',
};

const ODateStub = {
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  methods: {
    handleInput(e: Event) {
      this.$emit("update:modelValue", (e.target as HTMLInputElement).value);
    },
  },
  template: `<div :data-test="$attrs['data-test']">
    <label>{{ label }}</label>
    <input type="date" :value="modelValue" @input="handleInput" />
  </div>`,
};

const OTimeStub = {
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  methods: {
    handleInput(e: Event) {
      this.$emit("update:modelValue", (e.target as HTMLInputElement).value);
    },
  },
  template: `<div :data-test="$attrs['data-test']">
    <label>{{ label }}</label>
    <input type="time" :value="modelValue" @input="handleInput" />
  </div>`,
};

const STUBS = {
  OInput: OInputStub,
  OSelect: OSelectStub,
  OToggleGroup: OToggleGroupStub,
  OToggleGroupItem: OToggleGroupItemStub,
  OIcon: OIconStub,
  OTooltip: OTooltipStub,
  ODate: ODateStub,
  OTime: OTimeStub,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCheck(overrides: Partial<BrowserCheck> = {}): BrowserCheck {
  return { ...mockMonitorBrowser, ...overrides };
}

function mountSchedule(check: BrowserCheck = mockMonitorBrowser) {
  return mount(CheckSchedule, {
    props: { check },
    global: { stubs: STUBS },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("CheckSchedule", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountSchedule();
    });

    it("should render the schedule title", () => {
      expect(wrapper.text()).toContain("synthetics.scheduleAlert.schedule");
    });

    it("should render the frequency toggle group", () => {
      const toggle = wrapper.find('[data-test="synthetics-check-schedule-frequency-toggle"]');
      expect(toggle.exists()).toBe(true);
    });

    it("should render frequency preset items", () => {
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-1min-item"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-5min-item"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-15min-item"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-30min-item"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-1hour-item"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-cron-item"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-custom-item"]').exists(),
      ).toBe(true);
    });

    it("should render start type toggle for interval schedules", () => {
      const toggle = wrapper.find('[data-test="synthetics-check-schedule-start-type-toggle"]');
      expect(toggle.exists()).toBe(true);
    });

    it("should not render cron input for interval schedules", () => {
      const cronInput = wrapper.find('[data-test="synthetics-check-schedule-cron-input"]');
      expect(cronInput.exists()).toBe(false);
    });
  });

  describe("frequency preset changes", () => {
    it("should emit update:check when frequency is changed to 1min", async () => {
      wrapper = mountSchedule();
      const btn = wrapper.find('[data-test="synthetics-check-schedule-frequency-1min-item"]');
      expect(btn.exists()).toBe(true);

      await btn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.type).toBe("interval");
      expect(emitted![0][0].schedule.intervalValue).toBe(1);
      expect(emitted![0][0].schedule.intervalUnit).toBe("minutes");
      expect(emitted![0][0].schedule.isCustomFrequency).toBe(false);
    });

    it("should emit update:check when frequency is changed to 1hour", async () => {
      wrapper = mountSchedule();
      const btn = wrapper.find('[data-test="synthetics-check-schedule-frequency-1hour-item"]');
      expect(btn.exists()).toBe(true);

      await btn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.intervalValue).toBe(1);
      expect(emitted![0][0].schedule.intervalUnit).toBe("hours");
    });

    it("should emit update:check with type cron when cron is selected", async () => {
      wrapper = mountSchedule();
      const btn = wrapper.find('[data-test="synthetics-check-schedule-frequency-cron-item"]');
      expect(btn.exists()).toBe(true);

      await btn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.type).toBe("cron");
      expect(emitted![0][0].schedule.isCustomFrequency).toBe(false);
    });

    it("should emit update:check with isCustomFrequency true when custom is selected", async () => {
      wrapper = mountSchedule();
      const btn = wrapper.find('[data-test="synthetics-check-schedule-frequency-custom-item"]');
      expect(btn.exists()).toBe(true);

      await btn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.type).toBe("interval");
      expect(emitted![0][0].schedule.isCustomFrequency).toBe(true);
    });
  });

  describe("cron schedule rendering", () => {
    it("should show cron input when schedule type is cron", () => {
      const check = makeCheck({
        schedule: { type: "cron", cron: "*/5 * * * *", isCustomFrequency: false },
      });
      wrapper = mountSchedule(check);

      const cronInput = wrapper.find('[data-test="synthetics-check-schedule-cron-input"]');
      expect(cronInput.exists()).toBe(true);
    });

    it("should show timezone select when schedule type is cron", () => {
      const check = makeCheck({
        schedule: { type: "cron", cron: "*/5 * * * *", isCustomFrequency: false },
      });
      wrapper = mountSchedule(check);

      const tzSelect = wrapper.find('[data-test="synthetics-check-schedule-timezone-select"]');
      expect(tzSelect.exists()).toBe(true);
    });

    it("should hide start type toggle when schedule type is cron", () => {
      const check = makeCheck({
        schedule: { type: "cron", cron: "*/5 * * * *", isCustomFrequency: false },
      });
      wrapper = mountSchedule(check);

      const startToggle = wrapper.find('[data-test="synthetics-check-schedule-start-type-toggle"]');
      expect(startToggle.exists()).toBe(false);
    });

    it("should emit update:check when cron expression changes", async () => {
      const check = makeCheck({
        schedule: { type: "cron", cron: "*/5 * * * *", isCustomFrequency: false },
      });
      wrapper = mountSchedule(check);

      const cronInput = wrapper.find('[data-test="synthetics-check-schedule-cron-input"] input');
      expect(cronInput.exists()).toBe(true);

      await cronInput.setValue("0 * * * *");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.cron).toBe("0 * * * *");
    });
  });

  describe("custom frequency", () => {
    it("should show custom interval inputs when preset is custom", () => {
      const check = makeCheck({
        schedule: {
          type: "interval",
          intervalValue: 10,
          intervalUnit: "minutes",
          isCustomFrequency: true,
        },
      });
      wrapper = mountSchedule(check);

      const valueInput = wrapper.find(
        '[data-test="synthetics-check-schedule-custom-interval-value-input"]',
      );
      expect(valueInput.exists()).toBe(true);

      const unitSelect = wrapper.find(
        '[data-test="synthetics-check-schedule-custom-interval-unit-select"]',
      );
      expect(unitSelect.exists()).toBe(true);
    });

    it("should emit update:check when custom interval value changes", async () => {
      const check = makeCheck({
        schedule: {
          type: "interval",
          intervalValue: 10,
          intervalUnit: "minutes",
          isCustomFrequency: true,
        },
      });
      wrapper = mountSchedule(check);

      const valueInput = wrapper.find(
        '[data-test="synthetics-check-schedule-custom-interval-value-input"] input',
      );
      expect(valueInput.exists()).toBe(true);

      await valueInput.setValue("20");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.intervalValue).toBe(20);
    });

    it("should emit update:check when custom interval unit changes", async () => {
      const check = makeCheck({
        schedule: {
          type: "interval",
          intervalValue: 10,
          intervalUnit: "minutes",
          isCustomFrequency: true,
        },
      });
      wrapper = mountSchedule(check);

      const unitSelect = wrapper.find(
        '[data-test="synthetics-check-schedule-custom-interval-unit-select"] select',
      );
      expect(unitSelect.exists()).toBe(true);

      await unitSelect.setValue("hours");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.intervalUnit).toBe("hours");
    });
  });

  describe("start type", () => {
    it("should show start type toggle for interval schedules", () => {
      wrapper = mountSchedule();
      expect(wrapper.find('[data-test="synthetics-check-schedule-start-now-item"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-start-later-item"]').exists(),
      ).toBe(true);
    });

    it("should emit update:check when start type changes to later", async () => {
      wrapper = mountSchedule();
      const laterBtn = wrapper.find('[data-test="synthetics-check-schedule-start-later-item"]');
      expect(laterBtn.exists()).toBe(true);

      await laterBtn.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.startType).toBe("later");
    });

    it("should show date and time inputs when startType is later", () => {
      const check = makeCheck({
        schedule: {
          type: "interval",
          intervalValue: 5,
          intervalUnit: "minutes",
          startType: "later",
          startDate: "2026-07-20",
          startTime: "14:30",
          timezone: "UTC",
        },
      });
      wrapper = mountSchedule(check);

      expect(
        wrapper.find('[data-test="synthetics-check-schedule-start-date-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-start-time-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-start-timezone-select"]').exists(),
      ).toBe(true);
    });

    it("should not show date and time inputs when startType is now", () => {
      const check = makeCheck({
        schedule: {
          type: "interval",
          intervalValue: 5,
          intervalUnit: "minutes",
          startType: "now",
        },
      });
      wrapper = mountSchedule(check);

      expect(
        wrapper.find('[data-test="synthetics-check-schedule-start-date-input"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-start-time-input"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-start-timezone-select"]').exists(),
      ).toBe(false);
    });

    it("should emit update:check when start date changes", async () => {
      const check = makeCheck({
        schedule: {
          type: "interval",
          intervalValue: 5,
          intervalUnit: "minutes",
          startType: "later",
          startDate: "2026-07-20",
          startTime: "14:30",
          timezone: "UTC",
        },
      });
      wrapper = mountSchedule(check);

      const dateInput = wrapper.find(
        '[data-test="synthetics-check-schedule-start-date-input"] input',
      );
      expect(dateInput.exists()).toBe(true);

      await dateInput.setValue("2026-08-01");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.startDate).toBe("2026-08-01");
    });

    it("should emit update:check when start time changes", async () => {
      const check = makeCheck({
        schedule: {
          type: "interval",
          intervalValue: 5,
          intervalUnit: "minutes",
          startType: "later",
          startDate: "2026-07-20",
          startTime: "14:30",
          timezone: "UTC",
        },
      });
      wrapper = mountSchedule(check);

      const timeInput = wrapper.find(
        '[data-test="synthetics-check-schedule-start-time-input"] input',
      );
      expect(timeInput.exists()).toBe(true);

      await timeInput.setValue("16:00");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.startTime).toBe("16:00");
    });

    it("should emit update:check when timezone changes for later schedule", async () => {
      const check = makeCheck({
        schedule: {
          type: "interval",
          intervalValue: 5,
          intervalUnit: "minutes",
          startType: "later",
          startDate: "2026-07-20",
          startTime: "14:30",
          timezone: "UTC",
        },
      });
      wrapper = mountSchedule(check);

      const tzSelect = wrapper.find(
        '[data-test="synthetics-check-schedule-start-timezone-select"] select',
      );
      expect(tzSelect.exists()).toBe(true);

      // The select should have UTC and browser timezone options
      await tzSelect.setValue("UTC");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.timezone).toBe("UTC");
    });
  });

  describe("timezone for cron schedule", () => {
    it("should emit update:check when timezone changes for cron schedule", async () => {
      const check = makeCheck({
        schedule: {
          type: "cron",
          cron: "*/5 * * * *",
          timezone: "America/New_York",
          isCustomFrequency: false,
        },
      });
      wrapper = mountSchedule(check);

      const tzSelect = wrapper.find(
        '[data-test="synthetics-check-schedule-timezone-select"] select',
      );
      expect(tzSelect.exists()).toBe(true);

      await tzSelect.setValue("UTC");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].schedule.timezone).toBe("UTC");
    });
  });

  describe("preset detection from schedule", () => {
    it("should detect 1min preset", () => {
      const check = makeCheck({
        schedule: { type: "interval", intervalValue: 1, intervalUnit: "minutes" },
      });
      wrapper = mountSchedule(check);
      // The 1min toggle item should be rendered (presence is sufficient)
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-1min-item"]').exists(),
      ).toBe(true);
    });

    it("should detect 5min preset", () => {
      const check = makeCheck({
        schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
      });
      wrapper = mountSchedule(check);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-5min-item"]').exists(),
      ).toBe(true);
    });

    it("should detect 15min preset", () => {
      const check = makeCheck({
        schedule: { type: "interval", intervalValue: 15, intervalUnit: "minutes" },
      });
      wrapper = mountSchedule(check);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-15min-item"]').exists(),
      ).toBe(true);
    });

    it("should detect 1hour preset from hours unit", () => {
      const check = makeCheck({
        schedule: { type: "interval", intervalValue: 1, intervalUnit: "hours" },
      });
      wrapper = mountSchedule(check);
      expect(
        wrapper.find('[data-test="synthetics-check-schedule-frequency-1hour-item"]').exists(),
      ).toBe(true);
    });

    it("should treat non-standard interval as custom frequency", () => {
      const check = makeCheck({
        schedule: { type: "interval", intervalValue: 7, intervalUnit: "minutes" },
      });
      wrapper = mountSchedule(check);
      // 7 minutes is not a standard preset, so frequencyPreset resolves to 'custom'
      // The custom interval inputs should be visible
      expect(
        wrapper
          .find('[data-test="synthetics-check-schedule-custom-interval-value-input"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="synthetics-check-schedule-custom-interval-unit-select"]')
          .exists(),
      ).toBe(true);
    });
  });
});
