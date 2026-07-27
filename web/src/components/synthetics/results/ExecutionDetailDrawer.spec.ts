// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

import i18n from "@/locales";
import ExecutionDetailDrawer from "./ExecutionDetailDrawer.vue";
import type {
  RunLocationResult,
  RecordedStep,
  StepResult,
} from "@/composables/synthetics/syntheticResultsSchema";

// ── Stubs ──────────────────────────────────────────────────────────────────
const OIconStub = {
  props: ["name", "size"],
  template: '<i :data-icon="name" :data-size="size" />',
};

// Teleport stub: renders content in-place so wrapper.find() can access it
const TeleportStub = {
  props: ["to"],
  template: '<div class="teleport-stub"><slot /></div>',
};

// Transition stub: renders children immediately (no enter/leave animations in jsdom)
const TransitionStub = {
  props: ["name"],
  template: '<div class="transition-stub"><slot /></div>',
};

const STUBS = {
  OIcon: OIconStub,
  OButton: {
    props: ["iconLeft", "variant", "size", "disabled"],
    emits: ["click"],
    template:
      '<button v-bind="$attrs" @click="$emit(\'click\')"><i v-if="iconLeft" :data-icon="iconLeft" /></button>',
  },
  Teleport: TeleportStub,
  Transition: TransitionStub,
};

// ── Fixtures ──────────────────────────────────────────────────────────────
function makeRecordedStep(overrides: Partial<RecordedStep> = {}): RecordedStep {
  return {
    id: "step-1",
    action: "navigate",
    name: "Go to page",
    selector: null,
    url: "https://example.com",
    timeout_ms: 30000,
    value: null,
    key: null,
    text: null,
    ...overrides,
  };
}

function makeStepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    stepId: "step-1",
    status: "ok",
    durationMs: 1200,
    error: "",
    screenshotKey: null,
    ...overrides,
  };
}

function makeExecution(overrides: Partial<RunLocationResult> = {}): RunLocationResult {
  return {
    timestampMs: 1700000000000,
    status: "passed",
    durationMs: 1240,
    location: "us-east-1",
    device: "laptop_large",
    browserEngine: "chromium",
    error: "",
    jobId: "job-001",
    executionId: "exec-001",
    traceKey: null,
    steps: [
      makeStepResult({ stepId: "step-1", status: "ok", durationMs: 300 }),
      makeStepResult({ stepId: "step-2", status: "ok", durationMs: 800 }),
    ],
    recordedSteps: [
      makeRecordedStep({ id: "step-1", action: "navigate", name: "Go to page" }),
      makeRecordedStep({ id: "step-2", action: "click", name: "Click button" }),
    ],
    retryHistory: [],
    ...overrides,
  };
}

function mountDrawer(props: Record<string, unknown> = {}) {
  return mount(ExecutionDetailDrawer, {
    props: {
      execution: null,
      artifactUrlFn: (key: string) => `https://artifacts.example.com/${key}`,
      ...props,
    },
    global: { plugins: [i18n], stubs: STUBS },
  }) as VueWrapper;
}

describe("ExecutionDetailDrawer", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Closed State ─────────────────────────────────────────────────────────
  describe("when execution is null", () => {
    it("should not render the drawer content", () => {
      wrapper = mountDrawer({ execution: null });

      // The v-if="execution" in the template prevents content rendering
      expect(wrapper.text()).toBe("");
    });

    it("should not render any step content", () => {
      wrapper = mountDrawer({ execution: null });

      expect(wrapper.text()).toBe("");
    });
  });

  // ── Open State ───────────────────────────────────────────────────────────
  describe("when execution is provided", () => {
    beforeEach(() => {
      wrapper = mountDrawer({
        execution: makeExecution(),
      });
    });

    it("should render the drawer backdrop", () => {
      // With Teleport stubbed, elements render in-place
      expect(wrapper.text()).not.toBe("");
    });

    it("should display the device and browser engine", () => {
      // Template renders device.replace(/_/g, ' ') → 'laptop large'
      expect(wrapper.text()).toContain("laptop large");
      expect(wrapper.text()).toContain("chromium");
    });

    it("should display the execution status with capital first letter", () => {
      expect(wrapper.text()).toContain("Passed");
    });

    it("should display the duration", () => {
      // 1240ms >= 1000ms → formatted as '1.24 s'
      expect(wrapper.text()).toContain("1.24 s");
    });

    it("should render step results with names", () => {
      expect(wrapper.text()).toContain("Go to page");
      expect(wrapper.text()).toContain("Click button");
    });

    it("should render step IDs", () => {
      expect(wrapper.text()).toContain("step-1");
      expect(wrapper.text()).toContain("step-2");
    });

    it("should render step durations", () => {
      expect(wrapper.text()).toContain("300 ms");
      expect(wrapper.text()).toContain("800 ms");
    });

    it("should render close button with close icon", () => {
      const closeIcons = wrapper.findAll('[data-icon="close"]');
      expect(closeIcons.length).toBeGreaterThan(0);
    });
  });

  // ── Close Button ─────────────────────────────────────────────────────────
  describe("close button", () => {
    it("should emit close when close button is clicked", async () => {
      wrapper = mountDrawer({ execution: makeExecution() });

      // Find the close button by its icon
      const closeButtons = wrapper.findAll("button");
      const closeBtn = closeButtons.find((btn) => {
        const icon = btn.find('[data-icon="close"]');
        return icon.exists();
      });
      expect(closeBtn).toBeTruthy();

      await closeBtn!.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  // ── Error State ──────────────────────────────────────────────────────────
  describe("error state", () => {
    it("should show error banner when execution has error and no steps", () => {
      wrapper = mountDrawer({
        execution: makeExecution({
          status: "failed",
          error: "TimeoutError: page navigation timed out",
          steps: [],
          recordedSteps: [
            makeRecordedStep({ id: "step-1", action: "navigate", name: "Go to page" }),
          ],
        }),
      });

      expect(wrapper.text()).toContain("Probe error");
      expect(wrapper.text()).toContain("TimeoutError: page navigation timed out");
    });

    it("should show recorded steps as pending when no step results", () => {
      wrapper = mountDrawer({
        execution: makeExecution({
          status: "failed",
          error: "Connection refused",
          steps: [],
          recordedSteps: [
            makeRecordedStep({ id: "step-1", action: "navigate", name: "Go to page" }),
          ],
        }),
      });

      expect(wrapper.text()).toContain("Go to page");
      expect(wrapper.text()).toContain("step-1");
    });

    it("should not show error banner when steps are present", () => {
      wrapper = mountDrawer({
        execution: makeExecution({
          status: "failed",
          error: "Step 2 failed",
          steps: [
            makeStepResult({ stepId: "step-1", status: "ok", durationMs: 300 }),
            makeStepResult({
              stepId: "step-2",
              status: "fail",
              durationMs: 5000,
              error: "Element not found",
            }),
          ],
        }),
      });

      // Error banner should not appear since steps array is not empty
      expect(wrapper.text()).not.toContain("Probe error");
    });

    it("should show step-level error for failed steps", () => {
      wrapper = mountDrawer({
        execution: makeExecution({
          status: "failed",
          error: "",
          steps: [
            makeStepResult({ stepId: "step-1", status: "ok", durationMs: 300 }),
            makeStepResult({
              stepId: "step-2",
              status: "fail",
              durationMs: 5000,
              error: "Selector not found: #btn",
            }),
          ],
        }),
      });

      expect(wrapper.text()).toContain("Selector not found: #btn");
    });
  });

  // ── Trace Link ───────────────────────────────────────────────────────────
  describe("trace download link", () => {
    it("should show trace download link when traceKey is present", () => {
      wrapper = mountDrawer({
        execution: makeExecution({
          traceKey: "synthetics/org/mon-1/run-001/trace.json",
        }),
      });

      expect(wrapper.text()).toContain("trace.zip");
    });

    it("should not show trace download link when traceKey is null", () => {
      wrapper = mountDrawer({
        execution: makeExecution({ traceKey: null }),
      });

      expect(wrapper.text()).not.toContain("trace.zip");
    });
  });

  // ── Empty Steps ──────────────────────────────────────────────────────────
  describe("empty steps", () => {
    it("should show empty message when no steps and no error", () => {
      wrapper = mountDrawer({
        execution: makeExecution({
          status: "passed",
          error: "",
          steps: [],
          recordedSteps: [],
        }),
      });

      expect(wrapper.text()).toContain("No step data available");
    });
  });

  // ── fDuration Helper ─────────────────────────────────────────────────────
  describe("fDuration helper", () => {
    it("should format duration over 1000ms in seconds", () => {
      wrapper = mountDrawer({
        execution: makeExecution({
          durationMs: 30000,
        }),
      });

      expect(wrapper.text()).toContain("30.00 s");
    });

    it("should format duration under 1000ms in milliseconds", () => {
      wrapper = mountDrawer({
        execution: makeExecution({
          durationMs: 450,
        }),
      });

      expect(wrapper.text()).toContain("450 ms");
    });
  });

  // ── Status Variations ────────────────────────────────────────────────────
  describe("status variations", () => {
    it("should capitalize and display Passed status", () => {
      wrapper = mountDrawer({
        execution: makeExecution({ status: "passed" }),
      });

      expect(wrapper.text()).toContain("Passed");
    });

    it("should capitalize and display Failed status", () => {
      wrapper = mountDrawer({
        execution: makeExecution({ status: "failed" }),
      });

      expect(wrapper.text()).toContain("Failed");
    });

    it("should capitalize and display Warning status", () => {
      wrapper = mountDrawer({
        execution: makeExecution({ status: "warning" }),
      });

      expect(wrapper.text()).toContain("Warning");
    });

    it("should capitalize and display Error status", () => {
      wrapper = mountDrawer({
        execution: makeExecution({ status: "error" }),
      });

      expect(wrapper.text()).toContain("Error");
    });
  });
});
