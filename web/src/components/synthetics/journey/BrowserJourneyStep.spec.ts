// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";

// ── Stubs ──────────────────────────────────────────────────────────────────
const OButtonStub = {
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
};
const OIconStub = {
  template: '<i :data-icon="$attrs.name" />',
};
const OBadgeStub = {
  template: '<span class="badge-stub"><slot /></span>',
};
const OInputStub = {
  props: ["modelValue", "label", "placeholder", "type"],
  emits: ["update:modelValue"],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :data-label="label" :placeholder="placeholder" />',
};
const OSelectStub = {
  props: ["modelValue", "label", "options"],
  emits: ["update:modelValue"],
  template:
    '<select v-bind="$attrs" @change="$emit(\'update:modelValue\', $event.target.value)" :data-label="label"><option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
};
const OCheckboxStub = {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" v-bind="$attrs" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
};
const OSpinnerStub = {
  template: '<div class="spinner-stub" />',
};

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

import i18n from "@/locales";
import BrowserJourneyStep from "./BrowserJourneyStep.vue";
import type { BrowserStep } from "@/types/synthetics";

// ── Factory ────────────────────────────────────────────────────────────────
function makeStep(overrides: Partial<BrowserStep> = {}): BrowserStep {
  return {
    id: "step-1",
    action: "navigate",
    name: "Open page",
    value: "https://example.com",
    timeout: 30000,
    code: "",
    ...overrides,
  };
}

function mountStep(props: Record<string, unknown> = {}) {
  return mount(BrowserJourneyStep, {
    props: {
      step: makeStep(),
      index: 0,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        OButton: OButtonStub,
        OIcon: OIconStub,
        OBadge: OBadgeStub,
        OInput: OInputStub,
        OSelect: OSelectStub,
        OCheckbox: OCheckboxStub,
        OSpinner: OSpinnerStub,
      },
    },
  }) as VueWrapper;
}

describe("BrowserJourneyStep", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Initial Render ───────────────────────────────────────────────────────
  describe("initial render", () => {
    it("should render action icon for the step action", () => {
      wrapper = mountStep({
        step: makeStep({ action: "click", name: "Click login", selector: "#login" }),
      });

      const icon = wrapper.find('[data-icon="ads-click"]');
      expect(icon.exists()).toBe(true);
    });

    it("should render the action label badge", () => {
      wrapper = mountStep({ step: makeStep({ action: "click", name: "Click login" }) });

      const badge = wrapper.find(".badge-stub");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Click");
    });

    it("should render step display name", () => {
      wrapper = mountStep({ step: makeStep({ action: "click", name: "Click login" }) });

      expect(wrapper.text()).toContain("Click login");
    });

    it("should render selector preview text", () => {
      wrapper = mountStep({ step: makeStep({ action: "click", selector: "#login-btn" }) });

      expect(wrapper.text()).toContain("#login-btn");
    });

    it("should render value as preview when no selector", () => {
      wrapper = mountStep({ step: makeStep({ action: "navigate", value: "https://example.com" }) });

      expect(wrapper.text()).toContain("https://example.com");
    });

    it("should show step index plus one", () => {
      wrapper = mountStep({ step: makeStep(), index: 2 });

      expect(wrapper.text()).toContain("3");
    });

    it("should render a checkbox for selection", () => {
      wrapper = mountStep();

      const checkbox = wrapper.find('[data-test="synthetics-journey-step-checkbox-0"]');
      expect(checkbox.exists()).toBe(true);
    });
  });

  // ── Expand / Collapse ────────────────────────────────────────────────────
  describe("expanded editor", () => {
    it("should show editor fields when expanded", () => {
      wrapper = mountStep({
        step: makeStep({ action: "click", selector: "#btn" }),
        expanded: true,
      });

      const actionSelect = wrapper.find('[data-test="synthetics-journey-step-action-select"]');
      expect(actionSelect.exists()).toBe(true);
    });

    it("should hide editor fields when not expanded", () => {
      wrapper = mountStep({ step: makeStep({ action: "click" }), expanded: false });

      const actionSelect = wrapper.find('[data-test="synthetics-journey-step-action-select"]');
      expect(actionSelect.exists()).toBe(false);
    });

    // The v1 Selector-type + Selector pair is gone (SE-7 / SE-18): a version-2
    // step names its element through the locator bundle, and that is the only
    // targeting UI. `stepNeedsTarget` decides when it renders.
    it("should show the target block for click action", () => {
      wrapper = mountStep({
        step: makeStep({ action: "click", selector: "#btn" }),
        expanded: true,
      });

      expect(wrapper.find('[data-test="synthetics-journey-step-locator"]').exists()).toBe(true);
    });

    it("should hide the target block for navigate action", () => {
      wrapper = mountStep({
        step: makeStep({ action: "navigate", value: "https://example.com" }),
        expanded: true,
      });

      expect(wrapper.find('[data-test="synthetics-journey-step-locator"]').exists()).toBe(false);
    });

    it("should show value input for type action", () => {
      wrapper = mountStep({
        step: makeStep({ action: "type", selector: "#input", value: "hello" }),
        expanded: true,
      });

      const valueInput = wrapper.find('[data-test="synthetics-journey-step-value-input"]');
      expect(valueInput.exists()).toBe(true);
    });

    it("should show value input for navigate action", () => {
      wrapper = mountStep({
        step: makeStep({ action: "navigate", value: "https://example.com" }),
        expanded: true,
      });

      const valueInput = wrapper.find('[data-test="synthetics-journey-step-value-input"]');
      expect(valueInput.exists()).toBe(true);
    });

    // ── Timeout guard rails (spec P1.1.4, P1.1.5 / T1-13, T1-14) ───────────
    // Only the warning is asserted here. The field itself, its placeholder and
    // the retired-action notice all live inside BrowserJourneyStepEditor — the
    // input behind its Advanced group — and are covered by that component's own
    // spec. Reaching for them through this wrapper tested the layout of a
    // component this one only embeds.
    describe("timeout guard rails", () => {
      const timeoutInput = (w: VueWrapper) =>
        w.find('[data-test="synthetics-journey-step-timeout-input"]');
      const warning = (w: VueWrapper) =>
        w.find('[data-test="synthetics-journey-step-timeout-warning"]');

      // SE-5 moved the timeout behind the one `Advanced` collapsible, which
      // opens itself only when the step carries a non-default. A step with no
      // explicit timeout is exactly the case that stays closed, and
      // OCollapsible unmounts collapsed content — so these cases have to open
      // it before the field is in the DOM.
      const openAdvanced = (w: VueWrapper) =>
        w.find('[data-test="synthetics-journey-step-group-advanced"] button').trigger("click");

      it("shows the 60s navigate/assert default as placeholder when unset", async () => {
        wrapper = mountStep({
          step: makeStep({ action: "navigate", timeout: undefined }),
          expanded: true,
        });
        await openAdvanced(wrapper);
        expect(timeoutInput(wrapper).attributes("placeholder")).toBe("60000");
      });

      it("shows the 30s interaction default as placeholder when unset", async () => {
        wrapper = mountStep({
          step: makeStep({ action: "click", timeout: undefined }),
          expanded: true,
        });
        await openAdvanced(wrapper);
        expect(timeoutInput(wrapper).attributes("placeholder")).toBe("30000");
      });

      it("warns when the author lowers the timeout below the category default", () => {
        wrapper = mountStep({
          step: makeStep({ action: "click", timeout: 5000 }),
          expanded: true,
        });
        expect(warning(wrapper).exists()).toBe(true);
      });

      it("does not warn at or above the category default", () => {
        wrapper = mountStep({
          step: makeStep({ action: "click", timeout: 30000 }),
          expanded: true,
        });
        expect(warning(wrapper).exists()).toBe(false);
      });

      // Opens `Advanced` first, or the absence proves nothing: an unset timeout
      // is the one case that leaves the section collapsed, so the warning would
      // be missing whether or not the component wanted to render it.
      it("does not warn when no explicit timeout is set", async () => {
        wrapper = mountStep({
          step: makeStep({ action: "click", timeout: undefined }),
          expanded: true,
        });
        await openAdvanced(wrapper);
        expect(timeoutInput(wrapper).exists()).toBe(true);
        expect(warning(wrapper).exists()).toBe(false);
      });

      // The warning is advisory. Lowering is the author's call — it must never
      // block, only inform.
      it("keeps the timeout editable while warning", () => {
        wrapper = mountStep({
          step: makeStep({ action: "click", timeout: 5000 }),
          expanded: true,
        });
        expect(timeoutInput(wrapper).attributes("disabled")).toBeUndefined();
      });
    });

    // ── Retired actions (spec X-9 / T1-9) ──────────────────────────────────
    // T1-9 is "the editor no longer OFFERS the four retired actions" — the
    // picker filter, covered by constants/synthetics.spec.ts. The per-step
    // notice this file used to assert was deleted deliberately: `actionOptions`
    // filters RETIRED_ACTIONS out, the recorder never emits one, and no v1
    // journeys exist, so nothing could reach it — and it named no replacement.
    // Its absence is pinned by BrowserJourneyStepEditor.spec.ts.

    it("should show timeout input when expanded", () => {
      wrapper = mountStep({ step: makeStep(), expanded: true });

      const timeoutInput = wrapper.find('[data-test="synthetics-journey-step-timeout-input"]');
      expect(timeoutInput.exists()).toBe(true);
    });

    it("should show step name input when expanded", () => {
      wrapper = mountStep({ step: makeStep({ name: "My Step" }), expanded: true });

      const nameInput = wrapper.find('[data-test="synthetics-journey-step-name-input"]');
      expect(nameInput.exists()).toBe(true);
    });
  });

  // ── Emit Events ──────────────────────────────────────────────────────────
  describe("emit events", () => {
    it("should emit toggle-select when checkbox is toggled", async () => {
      wrapper = mountStep();

      const checkbox = wrapper.find('[data-test="synthetics-journey-step-checkbox-0"]');
      await checkbox.trigger("change");

      expect(wrapper.emitted("toggle-select")).toBeTruthy();
    });

    it("should emit update:expanded when expand button is clicked", async () => {
      wrapper = mountStep();

      const expandBtn = wrapper.find('[data-test="synthetics-journey-step-expand-btn"]');
      await expandBtn.trigger("click");

      expect(wrapper.emitted("update:expanded")).toBeTruthy();
      expect(wrapper.emitted("update:expanded")?.[0]).toEqual([true]);
    });

    it("should emit delete when delete button is clicked", async () => {
      wrapper = mountStep();

      const deleteBtn = wrapper.find('[data-test="synthetics-journey-step-delete-btn"]');
      await deleteBtn.trigger("click");

      expect(wrapper.emitted("delete")).toBeTruthy();
    });

    it("should emit duplicate when duplicate button is clicked", async () => {
      wrapper = mountStep();

      const duplicateBtn = wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]');
      await duplicateBtn.trigger("click");

      expect(wrapper.emitted("duplicate")).toBeTruthy();
    });

    it("should emit insert-below when insert button is clicked", async () => {
      wrapper = mountStep();

      const insertBtn = wrapper.find('[data-test="synthetics-journey-step-insert-btn"]');
      await insertBtn.trigger("click");

      expect(wrapper.emitted("insert-below")).toBeTruthy();
    });

    it("should emit update:step when value field is changed", async () => {
      wrapper = mountStep({
        step: makeStep({ action: "navigate", value: "https://old.example.com" }),
        expanded: true,
      });

      const valueInput = wrapper.find('[data-test="synthetics-journey-step-value-input"]');
      await valueInput.setValue("https://new.example.com");

      const emitted = wrapper.emitted("update:step");
      expect(emitted).toBeTruthy();
      expect((emitted![0][0] as BrowserStep).value).toBe("https://new.example.com");
    });

    it("should emit update:step when name field is changed", async () => {
      wrapper = mountStep({ step: makeStep({ name: "Old name" }), expanded: true });

      const nameInput = wrapper.find('[data-test="synthetics-journey-step-name-input"]');
      await nameInput.setValue("New name");

      const emitted = wrapper.emitted("update:step");
      expect(emitted).toBeTruthy();
      expect((emitted![0][0] as BrowserStep).name).toBe("New name");
    });
  });

  // ── Replay State ─────────────────────────────────────────────────────────
  describe("replay state", () => {
    it("should hide row action buttons when replayLocked is true", () => {
      wrapper = mountStep({ step: makeStep(), replayLocked: true });

      const deleteBtn = wrapper.find('[data-test="synthetics-journey-step-delete-btn"]');
      const duplicateBtn = wrapper.find('[data-test="synthetics-journey-step-duplicate-btn"]');
      const insertBtn = wrapper.find('[data-test="synthetics-journey-step-insert-btn"]');

      expect(deleteBtn.attributes("disabled")).toBeDefined();
      expect(duplicateBtn.attributes("disabled")).toBeDefined();
      expect(insertBtn.attributes("disabled")).toBeDefined();
    });

    it("should show active spinner when replayDotState is active", () => {
      wrapper = mountStep({ step: makeStep(), replayDotState: "active" });

      const spinner = wrapper.find(".spinner-stub");
      expect(spinner.exists()).toBe(true);
    });

    it("should show error card when replayDotState is fail with error", () => {
      wrapper = mountStep({
        step: makeStep(),
        replayDotState: "fail",
        replayResult: {
          stepId: "step-1",
          stepName: "Click login",
          passed: false,
          durationMs: 1500,
          error: "Element not found",
        },
      });

      const errorCard = wrapper.find('[data-test="synthetics-journey-step-error-card"]');
      expect(errorCard.exists()).toBe(true);
      expect(errorCard.text()).toContain("Element not found");
    });

    it("should not show error card when replayDotState is fail without error", () => {
      wrapper = mountStep({
        step: makeStep(),
        replayDotState: "fail",
        replayResult: {
          stepId: "step-1",
          stepName: "Click login",
          passed: false,
          durationMs: 1500,
        },
      });

      const errorCard = wrapper.find('[data-test="synthetics-journey-step-error-card"]');
      expect(errorCard.exists()).toBe(false);
    });

    it("should show error card with structured error message", () => {
      wrapper = mountStep({
        step: makeStep(),
        replayDotState: "fail",
        replayResult: {
          stepId: "step-1",
          stepName: "Click login",
          passed: false,
          durationMs: 1500,
          error: "Timeout waiting for element",
          structuredError: {
            message: "Timeout 30000ms exceeded",
            name: "TimeoutError",
            selector: "#login-btn",
          },
        },
      });

      const errorCard = wrapper.find('[data-test="synthetics-journey-step-error-card"]');
      expect(errorCard.exists()).toBe(true);
      // Component maps 'TimeoutError' name to human label 'Timeout Error'
      expect(errorCard.text()).toContain("Timeout Error");
      expect(errorCard.text()).toContain("Timeout 30000ms exceeded");
    });

    it("should emit retry-replay from error card", async () => {
      wrapper = mountStep({
        step: makeStep(),
        replayDotState: "fail",
        replayResult: {
          stepId: "step-1",
          stepName: "Click login",
          passed: false,
          durationMs: 1500,
          error: "Element not found",
        },
      });

      const retryBtn = wrapper.find('[data-test="synthetics-journey-error-retry-btn"]');
      expect(retryBtn.exists()).toBe(true);
      await retryBtn.trigger("click");

      expect(wrapper.emitted("retry-replay")).toBeTruthy();
    });

    it("should render step dot with correct data-test for active state", () => {
      wrapper = mountStep({ step: makeStep(), replayDotState: "active", index: 2 });

      const dot = wrapper.find('[data-test="synthetics-journey-step-dot-2"]');
      expect(dot.exists()).toBe(true);
    });

    it("should render pass dot state", () => {
      wrapper = mountStep({ step: makeStep(), replayDotState: "pass", index: 0 });

      const dot = wrapper.find('[data-test="synthetics-journey-step-dot-0"]');
      expect(dot.exists()).toBe(true);
    });
  });

  // ── Value inputs per action ───────────────────────────────────────────────
  describe("value input", () => {
    const valueInput = () => wrapper.find('[data-test="synthetics-journey-step-value-input"]');

    it("should render the file path input for an upload step", () => {
      wrapper = mountStep({
        step: makeStep({ action: "upload", value: "/tmp/a.pdf" }),
        expanded: true,
      });

      expect(valueInput().exists()).toBe(true);
      expect(valueInput().attributes("value")).toBe("/tmp/a.pdf");
    });

    it("should render the option input for a select step", () => {
      wrapper = mountStep({
        step: makeStep({ action: "select", value: "India" }),
        expanded: true,
      });

      expect(valueInput().attributes("value")).toBe("India");
    });

    it("should not render a generic value input for an assert step", () => {
      // BrowserJourneyAssertion owns the expected value; a second input took
      // typing and had it dropped at save (buildV2Steps drops `value` on assert).
      wrapper = mountStep({
        step: makeStep({ action: "assert", assertion: { kind: "element_text", expected: "Hi" } }),
        expanded: true,
      });

      expect(valueInput().exists()).toBe(false);
    });
  });

  // ── Wire round-trip on edit ───────────────────────────────────────────────
  describe("value edits reach the replayed wire step", () => {
    function editedWire(step: BrowserStep, newValue: string) {
      wrapper = mountStep({ step, expanded: true });
      const input = wrapper.find('[data-test="synthetics-journey-step-value-input"]');
      input.setValue(newValue);
      const emitted = wrapper.emitted("update:step") as BrowserStep[][];
      return emitted[0][0].wire!;
    }

    it("should write an edited navigate URL to wire.url, not wire.value", async () => {
      const step = makeStep({
        action: "navigate",
        value: "https://old.test",
        wire: { id: "step-1", action: "navigate", url: "https://old.test", pageAlias: "page" },
      });

      const wire = editedWire(step, "https://new.test");

      expect(wire.url).toBe("https://new.test");
      expect(wire.pageAlias).toBe("page"); // extension metadata survives the edit
    });

    it("should write an edited press key to wire.key", async () => {
      const step = makeStep({
        action: "press",
        value: "Enter",
        wire: { id: "step-1", action: "press", key: "Enter" },
      });

      expect(editedWire(step, "Tab").key).toBe("Tab");
    });

    it("should write an edited select option to wire.options", async () => {
      const step = makeStep({
        action: "select",
        value: "India",
        wire: { id: "step-1", action: "select", options: ["India"] },
      });

      expect(editedWire(step, "Japan").options).toEqual(["Japan"]);
    });
  });

  // ── Settle block (spec P4.1.5, P3.4.3) ────────────────────────────────────
  describe("settle", () => {
    const settleStep = () =>
      makeStep({
        action: "click",
        settle: {
          navigation: { url_pattern: "**/web/**" },
          responses: [{ url_pattern: "**/api/login", method: "POST", required: false }],
          observed_duration_ms: 1200,
          budget_ms: 5000,
        },
        wire: { id: "step-1", action: "click" },
      });

    it("should let the author mark a recorded response as required", async () => {
      wrapper = mountStep({ step: settleStep(), expanded: true });

      const checkbox = wrapper.find('[data-test="synthetics-journey-step-settle-required-0"]');
      expect(checkbox.exists()).toBe(true);

      await checkbox.setValue(true);

      const emitted = wrapper.emitted("update:step") as BrowserStep[][];
      const next = emitted[0][0];
      expect(next.settle?.responses?.[0].required).toBe(true);
      // ...and it travels with the replayed step, not just the saved one.
      expect(next.wire?.settle?.responses?.[0].required).toBe(true);
    });

    it("should show the settle budget and let the author change it", async () => {
      wrapper = mountStep({ step: settleStep(), expanded: true });

      const budget = wrapper.find('[data-test="synthetics-journey-step-settle-budget-input"]');
      expect(budget.attributes("value")).toBe("5000");

      await budget.setValue("12000");

      const emitted = wrapper.emitted("update:step") as BrowserStep[][];
      expect(emitted[0][0].settle?.budget_ms).toBe(12000);
    });

    it("should drop the budget when the field is cleared", async () => {
      wrapper = mountStep({ step: settleStep(), expanded: true });

      await wrapper.find('[data-test="synthetics-journey-step-settle-budget-input"]').setValue("");

      const emitted = wrapper.emitted("update:step") as BrowserStep[][];
      const next = emitted[0][0];
      expect(next.settle?.budget_ms).toBeUndefined();
      expect(next.settle?.navigation?.url_pattern).toBe("**/web/**"); // evidence kept
    });

    it("should warn when the budget falls outside the server-accepted range", () => {
      const step = settleStep();
      step.settle!.budget_ms = 90000;
      wrapper = mountStep({ step, expanded: true });

      expect(
        wrapper.find('[data-test="synthetics-journey-step-settle-budget-warning"]').exists(),
      ).toBe(true);
    });

    it("should not warn for a budget inside the range", () => {
      wrapper = mountStep({ step: settleStep(), expanded: true });

      expect(
        wrapper.find('[data-test="synthetics-journey-step-settle-budget-warning"]').exists(),
      ).toBe(false);
    });

    // Only the recorded lines are conditional. The block itself holds the budget
    // input, which is the ONLY way to create a budget — gating it on "has settle
    // data" made it unreachable on a hand-added step (SE-16). This asserted the
    // wrapper's absence, which happened to hold while the settle fields sat in
    // their own collapsed group; merging that group into `Advanced` means a step
    // carrying any non-default (this fixture sets `timeout`) opens it.
    it("should render no recorded evidence when the step has none", () => {
      wrapper = mountStep({ step: makeStep({ action: "click" }), expanded: true });

      expect(wrapper.find('[data-test="synthetics-journey-step-settle"]').text()).not.toContain(
        "Waits for (recorded)",
      );
      expect(
        wrapper.find('[data-test="synthetics-journey-step-settle-budget-input"]').exists(),
      ).toBe(true);
    });
  });
});
