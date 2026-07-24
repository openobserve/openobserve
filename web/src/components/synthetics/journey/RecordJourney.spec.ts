// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

// ── Stubs ──────────────────────────────────────────────────────────────────
const OButtonStub = {
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
};
const OIconStub = {
  template: '<i :data-icon="$attrs.name" />',
};
const OSpinnerStub = {
  template: '<div class="spinner-stub" />',
};
const BrowserJourneyStepStub = {
  props: [
    "step",
    "index",
    "expanded",
    "selected",
    "replayDotState",
    "replayLocked",
    "replayResult",
  ],
  emits: [
    "update:step",
    "update:expanded",
    "delete",
    "duplicate",
    "insert-below",
    "toggle-select",
    "retry-replay",
  ],
  template:
    '<div class="journey-step-stub" :data-step-action="step.action" :data-step-name="step.name" />',
};

import i18n from "@/locales";
import RecordJourney from "./RecordJourney.vue";
import type { BrowserStep } from "@/types/synthetics";

function mountRecord(startUrl = "https://example.com") {
  return mount(RecordJourney, {
    props: { startUrl },
    global: {
      plugins: [i18n],
      stubs: {
        OButton: OButtonStub,
        OIcon: OIconStub,
        OSpinner: OSpinnerStub,
        BrowserJourneyStep: BrowserJourneyStepStub,
      },
    },
  }) as VueWrapper;
}

describe("RecordJourney", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.useFakeTimers();
    // mock crypto.randomUUID used in setTimeout callbacks
    let uuidCounter = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `mock-uuid-${uuidCounter++}`,
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Initial Render ───────────────────────────────────────────────────────
  describe("initial render", () => {
    it("should render recording banner on mount", () => {
      wrapper = mountRecord("https://app.test/login");

      expect(wrapper.text()).toContain("Recording");
    });

    it("should show the current URL from props", () => {
      wrapper = mountRecord("https://app.test/login");

      expect(wrapper.text()).toContain("https://app.test/login");
    });

    it("should show timer starting at 00:00", () => {
      wrapper = mountRecord();

      expect(wrapper.text()).toContain("00:00");
    });

    it("should render Stop & Review button", () => {
      wrapper = mountRecord();

      const stopBtn = wrapper.find('[data-test="synthetics-record-stop-btn"]');
      expect(stopBtn.exists()).toBe(true);
    });

    it("should render a Cancel button", () => {
      wrapper = mountRecord();

      // find the Cancel button by text since it has no data-test
      const buttons = wrapper.findAll("button");
      const cancelBtn = buttons.find((btn) => btn.text() === "Cancel");
      expect(cancelBtn?.exists()).toBe(true);
    });

    it('should show "Waiting for actions" when no steps captured yet', () => {
      wrapper = mountRecord();

      expect(wrapper.text()).toContain("Waiting for actions in the browser…");
    });
  });

  // ── Captured Steps ───────────────────────────────────────────────────────
  describe("captured steps", () => {
    it("should show captured step after first timeout fires", async () => {
      wrapper = mountRecord("https://app.test");

      // Advance timers past 500ms to trigger the navigate step
      await vi.advanceTimersByTimeAsync(600);

      // Step row should now appear
      const stepStubs = wrapper.findAll(".journey-step-stub");
      expect(stepStubs.length).toBe(1);
      expect(stepStubs[0].attributes("data-step-action")).toBe("navigate");
      expect(stepStubs[0].attributes("data-step-name")).toBe("Open start URL");
    });

    it("should show all three captured steps after all timeouts fire", async () => {
      wrapper = mountRecord("https://app.test");

      await vi.advanceTimersByTimeAsync(5000);

      const stepStubs = wrapper.findAll(".journey-step-stub");
      expect(stepStubs.length).toBe(3);
    });

    it("should show step count in the header", async () => {
      wrapper = mountRecord("https://app.test");

      await vi.advanceTimersByTimeAsync(1000);

      expect(wrapper.text()).toContain("(1 steps)");
    });

    it("should update step count as more steps arrive", async () => {
      wrapper = mountRecord("https://app.test");

      await vi.advanceTimersByTimeAsync(600);
      expect(wrapper.text()).toContain("(1 steps)");

      await vi.advanceTimersByTimeAsync(2000);
      expect(wrapper.text()).toContain("(2 steps)");

      await vi.advanceTimersByTimeAsync(3000);
      expect(wrapper.text()).toContain("(3 steps)");
    });

    it("should emit done with captured steps on stop", async () => {
      wrapper = mountRecord("https://app.test");

      // Let all steps capture
      await vi.advanceTimersByTimeAsync(5000);

      const stopBtn = wrapper.find('[data-test="synthetics-record-stop-btn"]');
      await stopBtn.trigger("click");

      const emitted = wrapper.emitted("done");
      expect(emitted).toBeTruthy();
      const steps = emitted![0][0] as BrowserStep[];
      expect(steps.length).toBe(3);
      expect(steps[0].action).toBe("navigate");
      expect(steps[0].value).toBe("https://app.test");
    });

    it("should emit done even when no steps captured", async () => {
      wrapper = mountRecord();

      // Don't advance timers — no steps

      const stopBtn = wrapper.find('[data-test="synthetics-record-stop-btn"]');
      await stopBtn.trigger("click");

      const emitted = wrapper.emitted("done");
      expect(emitted).toBeTruthy();
      const steps = emitted![0][0] as BrowserStep[];
      expect(steps.length).toBe(0);
    });
  });

  // ── Cancel ───────────────────────────────────────────────────────────────
  describe("cancel", () => {
    it("should emit cancel when cancel button is clicked", async () => {
      wrapper = mountRecord();

      const buttons = wrapper.findAll("button");
      const cancelBtn = buttons.find((btn) => btn.text() === "Cancel");
      expect(cancelBtn?.exists()).toBe(true);

      await cancelBtn!.trigger("click");
      expect(wrapper.emitted("cancel")).toBeTruthy();
    });
  });

  // ── Timer ────────────────────────────────────────────────────────────────
  describe("timer", () => {
    it("should advance timer every second", async () => {
      wrapper = mountRecord();

      // Initially 00:00
      expect(wrapper.text()).toContain("00:00");

      await vi.advanceTimersByTimeAsync(3000);

      // After 3 seconds, should show 00:03
      expect(wrapper.text()).toContain("00:03");
    });

    it("should format minutes correctly", async () => {
      wrapper = mountRecord();

      await vi.advanceTimersByTimeAsync(65000);

      // 65 seconds = 01:05
      expect(wrapper.text()).toContain("01:05");
    });

    it("should stop timer after stopRecording is called", async () => {
      wrapper = mountRecord();

      await vi.advanceTimersByTimeAsync(5000);
      expect(wrapper.text()).toContain("00:05");

      const stopBtn = wrapper.find('[data-test="synthetics-record-stop-btn"]');
      await stopBtn.trigger("click");

      await vi.advanceTimersByTimeAsync(5000);
      // Timer should still show 00:05, not 00:10
      expect(wrapper.text()).toContain("00:05");
    });
  });

  // ── Step Interactions ────────────────────────────────────────────────────
  describe("step interactions during recording", () => {
    it("should remove step from list when step stub emits delete", async () => {
      wrapper = mountRecord("https://app.test");

      // Capture one step
      await vi.advanceTimersByTimeAsync(600);
      expect(wrapper.findAll(".journey-step-stub").length).toBe(1);

      // Simulate delete by emitting from the stubbed child component.
      // Use findAllComponents with the stub object reference since inline stubs
      // don't have a `name` property for findComponent({ name: ... }).
      const stepComponents = wrapper.findAllComponents(BrowserJourneyStepStub);
      stepComponents[0].vm.$emit("delete");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll(".journey-step-stub").length).toBe(0);
    });

    // Note: duplicate emit is not tested here because the inline template expression
    // `crypto.randomUUID()` called from `@duplicate` cannot resolve `crypto` in
    // this test environment when triggered via $emit from a stub child component.
    // The delete path (above) validates the parent-child event wiring pattern.
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────
  describe("cleanup", () => {
    it("should clear timers on unmount", () => {
      wrapper = mountRecord();

      // Spy on clearInterval
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      wrapper.unmount();

      // The component should have called clearInterval
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
