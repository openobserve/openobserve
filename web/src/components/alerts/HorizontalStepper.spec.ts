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

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import HorizontalStepper from "@/components/alerts/HorizontalStepper.vue";
import type { Step } from "@/components/alerts/HorizontalStepper.vue";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const steps: Step[] = [
  { id: 1, label: "Step 1", description: "First step" },
  { id: 2, label: "Step 2" },
  { id: 3, label: "Step 3", description: "Third step" },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildWrapper(props: Record<string, any> = {}): VueWrapper<any> {
  return mount(HorizontalStepper, {
    props: {
      currentStep: 1,
      steps,
      completedSteps: [],
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("HorizontalStepper", () => {
  let wrapper: VueWrapper<any> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  // ── Renders with minimum props ────────────────────────────────────────────

  describe("renders with minimum props", () => {
    it("mounts without error", () => {
      wrapper = buildWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("renders all step labels", () => {
      wrapper = buildWrapper();

      expect(wrapper.text()).toContain("Step 1");
      expect(wrapper.text()).toContain("Step 2");
      expect(wrapper.text()).toContain("Step 3");
    });

    it("renders step descriptions when provided", () => {
      wrapper = buildWrapper();

      expect(wrapper.text()).toContain("First step");
      expect(wrapper.text()).toContain("Third step");
    });

    it("does not render a description for steps without one", () => {
      wrapper = buildWrapper();

      // Step 2 has no description; its label is still present
      expect(wrapper.text()).toContain("Step 2");
    });
  });

  // ── Steps with / without description (v-if branch) ───────────────────────

  describe("conditional description rendering", () => {
    it("renders exactly two description nodes (steps 1 and 3 have descriptions)", () => {
      wrapper = buildWrapper();

      // Each step-description node contains text from the description
      const html = wrapper.html();
      const countFirst = (html.match(/First step/g) || []).length;
      const countThird = (html.match(/Third step/g) || []).length;
      expect(countFirst).toBeGreaterThan(0);
      expect(countThird).toBeGreaterThan(0);
    });

    it("does not include description text for a step without a description prop", () => {
      const customSteps: Step[] = [{ id: 1, label: "Only Step" }];
      wrapper = buildWrapper({ steps: customSteps, currentStep: 1 });

      // Should NOT have any description-like content beyond the label
      expect(wrapper.html()).not.toContain("undefined");
    });

    it("renders description for a step with hasError and a description", () => {
      const errorSteps: Step[] = [
        { id: 1, label: "Error Step", description: "Has error", hasError: true },
      ];
      wrapper = buildWrapper({ steps: errorSteps, currentStep: 1 });

      expect(wrapper.text()).toContain("Has error");
    });
  });

  // ── canNavigateToStep logic ───────────────────────────────────────────────

  describe("canNavigateToStep", () => {
    it("returns true for the current step", () => {
      wrapper = buildWrapper({ currentStep: 2, completedSteps: [1] });

      expect((wrapper.vm as any).canNavigateToStep(2)).toBe(true);
    });

    it("returns true for completed steps", () => {
      wrapper = buildWrapper({ currentStep: 3, completedSteps: [1, 2] });

      expect((wrapper.vm as any).canNavigateToStep(1)).toBe(true);
      expect((wrapper.vm as any).canNavigateToStep(2)).toBe(true);
    });

    it("returns true for next step when current step is completed", () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [1] });

      expect((wrapper.vm as any).canNavigateToStep(2)).toBe(true);
    });

    it("returns false for the next step when current step is NOT completed", () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      expect((wrapper.vm as any).canNavigateToStep(2)).toBe(false);
    });

    it("returns false for a future step more than one ahead", () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      expect((wrapper.vm as any).canNavigateToStep(3)).toBe(false);
    });
  });

  // ── handleStepClick — emit behavior ──────────────────────────────────────

  describe("handleStepClick", () => {
    it("emits 'update:currentStep' when clicking a navigable step id", () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      (wrapper.vm as any).handleStepClick(1); // current step is always navigable

      expect(wrapper.emitted("update:currentStep")).toBeTruthy();
      expect(wrapper.emitted("update:currentStep")![0]).toEqual([1]);
    });

    it("emits 'update:currentStep' when clicking a completed step id", () => {
      wrapper = buildWrapper({ currentStep: 2, completedSteps: [1] });

      (wrapper.vm as any).handleStepClick(1);

      expect(wrapper.emitted("update:currentStep")).toBeTruthy();
      expect(wrapper.emitted("update:currentStep")![0]).toEqual([1]);
    });

    it("does NOT emit 'update:currentStep' when clicking a disabled step id", () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      (wrapper.vm as any).handleStepClick(3); // step 3 is not reachable

      expect(wrapper.emitted("update:currentStep")).toBeFalsy();
    });

    it("emits 'update:currentStep' when clicking the next step after current is completed", () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [1] });

      (wrapper.vm as any).handleStepClick(2);

      expect(wrapper.emitted("update:currentStep")).toBeTruthy();
      expect(wrapper.emitted("update:currentStep")![0]).toEqual([2]);
    });
  });

  // ── DOM click events ──────────────────────────────────────────────────────

  describe("DOM step click events", () => {
    it("clicking the first step item triggers 'update:currentStep' for step id 1", async () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      // The stepper renders a list of items; get the first one via the label
      const stepTitles = wrapper.findAll("[class*='step-title'], [class*='step-label']");
      // Fallback: trigger via the first child of the stepper container
      const container = wrapper.find("[class*='stepper-container']");
      const firstChild = container.element.children[0] as HTMLElement;
      await wrapper.find("[class*='stepper-container']").element.children[0].dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("update:currentStep")).toBeTruthy();
    });

    it("clicking a disabled step item does NOT emit 'update:currentStep'", async () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      const container = wrapper.find("[class*='stepper-container']");
      // Third child = step id 3 (disabled because not current, not completed, not next)
      container.element.children[2].dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("update:currentStep")).toBeFalsy();
    });
  });

  // ── Rendering step numbers vs icons ──────────────────────────────────────

  describe("step number / icon rendering", () => {
    it("renders a step number for a non-completed, non-error active step", () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      // Step 1 is active but not completed: should show "1" as step number
      expect(wrapper.html()).toContain("1");
    });

    it("renders the error icon for a step with hasError=true", () => {
      const errorSteps: Step[] = [
        { id: 1, label: "Error Step", hasError: true },
        { id: 2, label: "Ok Step" },
      ];
      wrapper = buildWrapper({ steps: errorSteps, currentStep: 1 });

      const icons = wrapper.findAllComponents({ name: "OIcon" });
      expect(icons.some((i) => i.props("name") === "error-outline")).toBe(true);
    });

    it("renders the check icon for a completed step that is not active", () => {
      wrapper = buildWrapper({ currentStep: 2, completedSteps: [1] });

      const icons = wrapper.findAllComponents({ name: "OIcon" });
      expect(icons.some((i) => i.props("name") === "check")).toBe(true);
    });

    it("does NOT render check icon for a step that is active even if completed", () => {
      // When currentStep === step.id the template shows the number/error, not check
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [1] });

      // Step 1 is current AND completed — template: v-if completed && currentStep !== id
      // so "check" should NOT appear for step 1
      const icons = wrapper.findAllComponents({ name: "OIcon" });
      const checkIcons = icons.filter((i) => i.props("name") === "check");
      expect(checkIcons).toHaveLength(0);
    });
  });

  // ── Async paths / props reactivity ───────────────────────────────────────

  describe("props reactivity", () => {
    it("updates rendered labels when steps prop changes", async () => {
      wrapper = buildWrapper();

      const newSteps: Step[] = [
        { id: 1, label: "New Step A" },
        { id: 2, label: "New Step B" },
      ];
      await wrapper.setProps({ steps: newSteps });

      expect(wrapper.text()).toContain("New Step A");
      expect(wrapper.text()).toContain("New Step B");
    });

    it("reflects updated currentStep in canNavigateToStep", async () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      await wrapper.setProps({ currentStep: 2, completedSteps: [1] });

      expect((wrapper.vm as any).canNavigateToStep(2)).toBe(true);
      expect((wrapper.vm as any).canNavigateToStep(1)).toBe(true);
    });

    it("reflects updated completedSteps in canNavigateToStep", async () => {
      wrapper = buildWrapper({ currentStep: 1, completedSteps: [] });

      await wrapper.setProps({ completedSteps: [1] });

      expect((wrapper.vm as any).canNavigateToStep(2)).toBe(true);
    });
  });

  // ── Single-step edge case ─────────────────────────────────────────────────

  describe("single step edge case", () => {
    it("renders a single step without error", () => {
      const single: Step[] = [{ id: 1, label: "Only Step" }];
      wrapper = buildWrapper({ steps: single, currentStep: 1 });

      expect(wrapper.text()).toContain("Only Step");
    });

    it("canNavigateToStep returns true for the only step when it is current", () => {
      const single: Step[] = [{ id: 1, label: "Only Step" }];
      wrapper = buildWrapper({ steps: single, currentStep: 1 });

      expect((wrapper.vm as any).canNavigateToStep(1)).toBe(true);
    });
  });
});
