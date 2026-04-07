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

import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

import HorizontalStepper from "@/components/alerts/HorizontalStepper.vue";

const steps = [
  { id: 1, label: "Step 1", description: "First step" },
  { id: 2, label: "Step 2" },
  { id: 3, label: "Step 3", description: "Third step" },
];

async function mountComp(props: Record<string, any> = {}) {
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

describe("HorizontalStepper - rendering", () => {
  it("renders all steps", async () => {
    const w = await mountComp();
    const items = w.findAll(".step-item");
    expect(items.length).toBe(3);
  });

  it("renders step labels", async () => {
    const w = await mountComp();
    expect(w.text()).toContain("Step 1");
    expect(w.text()).toContain("Step 2");
    expect(w.text()).toContain("Step 3");
  });

  it("renders step description when provided", async () => {
    const w = await mountComp();
    expect(w.text()).toContain("First step");
    expect(w.text()).toContain("Third step");
  });

  it("does not render description when not provided", async () => {
    const w = await mountComp();
    const descriptions = w.findAll(".step-description");
    // Only steps with description have it
    expect(descriptions.length).toBe(2);
  });

  it("renders step numbers for non-completed, non-error steps", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [] });
    const numbers = w.findAll(".step-number");
    expect(numbers.length).toBeGreaterThan(0);
  });
});

describe("HorizontalStepper - active/completed/disabled CSS classes", () => {
  it("active step has step-active class", async () => {
    const w = await mountComp({ currentStep: 2, completedSteps: [1] });
    const items = w.findAll(".step-item");
    expect(items[1].classes()).toContain("step-active");
  });

  it("completed step has step-completed class", async () => {
    const w = await mountComp({ currentStep: 2, completedSteps: [1] });
    const items = w.findAll(".step-item");
    expect(items[0].classes()).toContain("step-completed");
  });

  it("non-navigable step has step-disabled class", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [] });
    const items = w.findAll(".step-item");
    // Step 3 (id=3) is not current(1), not completed, and not next after current(1 -> 2)
    expect(items[2].classes()).toContain("step-disabled");
  });

  it("step with error has step-error class", async () => {
    const stepsWithError = [
      { id: 1, label: "Step 1", hasError: true },
      { id: 2, label: "Step 2" },
    ];
    const w = await mountComp({ steps: stepsWithError, currentStep: 1 });
    expect(w.findAll(".step-item")[0].classes()).toContain("step-error");
  });

  it("next step after completed current has no step-disabled class", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [1] });
    const items = w.findAll(".step-item");
    // Step 2 (next after current 1 which is completed) should NOT be disabled
    expect(items[1].classes()).not.toContain("step-disabled");
  });
});

describe("HorizontalStepper - canNavigateToStep", () => {
  it("can navigate to current step", async () => {
    const w = await mountComp({ currentStep: 2, completedSteps: [1] });
    expect((w.vm as any).canNavigateToStep(2)).toBe(true);
  });

  it("can navigate to completed step", async () => {
    const w = await mountComp({ currentStep: 3, completedSteps: [1, 2] });
    expect((w.vm as any).canNavigateToStep(1)).toBe(true);
    expect((w.vm as any).canNavigateToStep(2)).toBe(true);
  });

  it("cannot navigate to future step that is not next", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [] });
    expect((w.vm as any).canNavigateToStep(3)).toBe(false);
  });

  it("can navigate to next step if current is completed", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [1] });
    expect((w.vm as any).canNavigateToStep(2)).toBe(true);
  });

  it("cannot navigate to next step if current is NOT completed", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [] });
    expect((w.vm as any).canNavigateToStep(2)).toBe(false);
  });
});

describe("HorizontalStepper - click behavior", () => {
  it("clicking current step emits update:currentStep", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [] });
    const items = w.findAll(".step-item");
    await items[0].trigger("click");
    expect(w.emitted("update:currentStep")).toBeTruthy();
    expect(w.emitted("update:currentStep")![0]).toEqual([1]);
  });

  it("clicking completed step emits update:currentStep with that step id", async () => {
    const w = await mountComp({ currentStep: 2, completedSteps: [1] });
    const items = w.findAll(".step-item");
    await items[0].trigger("click");
    expect(w.emitted("update:currentStep")).toBeTruthy();
    expect(w.emitted("update:currentStep")![0]).toEqual([1]);
  });

  it("clicking disabled step does NOT emit update:currentStep", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [] });
    const items = w.findAll(".step-item");
    await items[2].trigger("click"); // step 3 is disabled
    expect(w.emitted("update:currentStep")).toBeFalsy();
  });

  it("clicking navigable next step emits event", async () => {
    const w = await mountComp({ currentStep: 1, completedSteps: [1] });
    const items = w.findAll(".step-item");
    await items[1].trigger("click"); // step 2 should be navigable
    expect(w.emitted("update:currentStep")).toBeTruthy();
    expect(w.emitted("update:currentStep")![0]).toEqual([2]);
  });
});

describe("HorizontalStepper - connector lines", () => {
  it("renders connector lines between steps (not after last step)", async () => {
    const w = await mountComp();
    const connectors = w.findAll(".step-connector");
    expect(connectors.length).toBe(steps.length - 1);
  });

  it("completed step connector has connector-active class", async () => {
    const w = await mountComp({ currentStep: 2, completedSteps: [1] });
    const connectors = w.findAll(".step-connector");
    expect(connectors[0].classes()).toContain("connector-active");
  });
});
