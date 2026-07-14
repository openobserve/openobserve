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
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import TimeRangeEditor from "./TimeRangeEditor.vue";
import store from "@/test/unit/helpers/store";

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
  messages: { en: mockTranslations },
});

// Stub ONLY the ODialog overlay (renders its slot inline, exposes the
// click:secondary/neutral + update:open emits we drive). The OForm + OForm*
// fields stay REAL so the schema cross-field refine is exercised.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "formId",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div data-test="o-dialog-stub" :data-open="String(open)">
      <slot />
      <button data-test="o-dialog-stub-secondary" @click="$emit('click:secondary')">Cancel</button>
      <button data-test="o-dialog-stub-neutral" @click="$emit('click:neutral')">Reset</button>
    </div>
  `,
};

const SOURCE_TIMESTAMP_US = 1704110400000000; // Jan 1, 2024 12:00:00 UTC (µs)
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

  const createWrapper = (props = {}) =>
    mount(TimeRangeEditor, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [i18n, store],
        stubs: { ODialog: ODialogStub },
      },
      attachTo: document.body,
    });

  const getForm = (w: any) =>
    (w.findComponent({ name: "OForm" }).vm as any).form;

  const submit = async (w: any) => {
    await getForm(w).handleSubmit();
    await flushPromises();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe("Mounting & wiring", () => {
    it("mounts and renders the dialog", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(
        wrapper.find('[data-test="time-range-editor-dialog"]').exists(),
      ).toBe(true);
    });

    it("forwards title + button labels + form-id to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("Edit Time Range");
      expect(dialog.props("primaryButtonLabel")).toBe("Apply");
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
      expect(dialog.props("neutralButtonLabel")).toBe("Reset");
      expect(dialog.props("formId")).toBe("time-range-editor-form");
    });

    it("renders the window radio options + preserves data-tests", () => {
      wrapper = createWrapper();
      for (const t of [
        "window-1min",
        "window-5min",
        "window-15min",
        "window-30min",
        "window-1hour",
        "window-custom",
      ]) {
        expect(wrapper.find(`[data-test="${t}"]`).exists()).toBe(true);
      }
    });
  });

  describe("detect window + preview (seeded from currentRange)", () => {
    it("seeds 5min when range is ±5 minutes", () => {
      wrapper = createWrapper();
      expect(getForm(wrapper).state.values.selectedWindow).toBe("5min");
      expect(wrapper.vm.pendingStartTime).toBe(
        defaultProps.currentRange.startTime,
      );
      expect(wrapper.vm.pendingEndTime).toBe(defaultProps.currentRange.endTime);
    });

    it.each([
      ["1min", 1],
      ["15min", 15],
      ["30min", 30],
      ["1hour", 60],
    ])("seeds %s for the matching symmetric range", (win, minutes) => {
      const half = minutes * 60 * 1000 * 1000;
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - half,
          endTime: SOURCE_TIMESTAMP_US + half,
        },
      });
      expect(getForm(wrapper).state.values.selectedWindow).toBe(win);
    });

    it("falls back to custom for an asymmetric range", () => {
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - 1000000,
          endTime: SOURCE_TIMESTAMP_US + 9999000,
        },
      });
      expect(getForm(wrapper).state.values.selectedWindow).toBe("custom");
    });

    it("updates the preview when a preset window is chosen", async () => {
      wrapper = createWrapper();
      getForm(wrapper).setFieldValue("selectedWindow", "1hour");
      await nextTick();
      const oneHour = 60 * 60 * 1000 * 1000;
      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - oneHour);
      expect(wrapper.vm.pendingEndTime).toBe(SOURCE_TIMESTAMP_US + oneHour);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Real-OForm cross-field validation (playbook §5 / R22): the superRefine
  // gates custom mode — both times required AND start < end.
  describe("OForm schema validation (real form)", () => {
    it("preset window submits + emits the preview range", async () => {
      wrapper = createWrapper();
      await submit(wrapper);

      expect(getForm(wrapper).state.isValid).toBe(true);
      expect(wrapper.emitted("update:range")?.[0]).toEqual([
        SOURCE_TIMESTAMP_US - FIVE_MIN_US,
        SOURCE_TIMESTAMP_US + FIVE_MIN_US,
      ]);
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("custom window with empty times blocks submit", async () => {
      wrapper = createWrapper();
      const form = getForm(wrapper);
      form.setFieldValue("selectedWindow", "custom");
      form.setFieldValue("customStartTime", "");
      form.setFieldValue("customEndTime", "");
      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(wrapper.emitted("update:range")).toBeFalsy();
    });

    it("custom window with start >= end blocks submit (cross-field)", async () => {
      wrapper = createWrapper();
      const form = getForm(wrapper);
      form.setFieldValue("selectedWindow", "custom");
      form.setFieldValue("customStartTime", "2024-01-01T13:00");
      form.setFieldValue("customEndTime", "2024-01-01T11:00");
      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(wrapper.emitted("update:range")).toBeFalsy();
    });

    it("custom window with a valid range submits + emits the custom range", async () => {
      wrapper = createWrapper();
      const form = getForm(wrapper);
      form.setFieldValue("selectedWindow", "custom");
      form.setFieldValue("customStartTime", "2024-01-01T11:00");
      form.setFieldValue("customEndTime", "2024-01-01T13:00");
      await submit(wrapper);

      const startMicros = new Date("2024-01-01T11:00").getTime() * 1000;
      const endMicros = new Date("2024-01-01T13:00").getTime() * 1000;
      expect(form.state.isValid).toBe(true);
      expect(wrapper.emitted("update:range")?.[0]).toEqual([
        startMicros,
        endMicros,
      ]);
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });
  });

  describe("reset / cancel / close", () => {
    it("reset switches back to the ±5 minute preset", async () => {
      wrapper = createWrapper({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - 60 * 60 * 1000 * 1000,
          endTime: SOURCE_TIMESTAMP_US + 60 * 60 * 1000 * 1000,
        },
      });
      expect(getForm(wrapper).state.values.selectedWindow).toBe("1hour");

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:neutral");
      await nextTick();

      expect(getForm(wrapper).state.values.selectedWindow).toBe("5min");
      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - FIVE_MIN_US);
      expect(wrapper.vm.pendingEndTime).toBe(SOURCE_TIMESTAMP_US + FIVE_MIN_US);
    });

    it("cancel emits update:modelValue false + close", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("update:range")).toBeFalsy();
    });

    it("dialog update:open=false forwards modelValue false + close", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", false);

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("dialog update:open=true forwards modelValue true without close", async () => {
      wrapper = createWrapper({ modelValue: false });
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", true);

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([true]);
      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  describe("currentRange reactivity", () => {
    it("re-seeds the form when currentRange changes while open", async () => {
      wrapper = createWrapper();
      const oneMin = 1 * 60 * 1000 * 1000;
      await wrapper.setProps({
        currentRange: {
          startTime: SOURCE_TIMESTAMP_US - oneMin,
          endTime: SOURCE_TIMESTAMP_US + oneMin,
        },
      });
      await flushPromises();
      await nextTick();

      expect(getForm(wrapper).state.values.selectedWindow).toBe("1min");
      expect(wrapper.vm.pendingStartTime).toBe(SOURCE_TIMESTAMP_US - oneMin);
    });
  });
});
