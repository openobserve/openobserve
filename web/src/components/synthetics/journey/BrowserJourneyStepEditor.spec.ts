// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";
import BrowserJourneyStepEditor from "./BrowserJourneyStepEditor.vue";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

function render(step: Partial<BrowserStep> = {}) {
  const full: BrowserStep = {
    id: "s1",
    action: "click",
    name: "Sign in",
    code: "",
    locator: { candidates: [], user_override: null },
    ...step,
  };
  return mount(BrowserJourneyStepEditor, {
    props: { step: full },
    global: { plugins: [i18n] },
  });
}

const test = (name: string) => `[data-test="${name}"]`;

// The locator bundle is the only way a v2 step names its element. The v1
// Selector-type + Selector pair is gone: no v1 journeys exist, so the fork it
// served could not occur, and keeping it produced two unrelated targeting
// editors in one journey (SE-7) plus a silent steps_version downgrade (SE-18).
describe("BrowserJourneyStepEditor targeting", () => {
  it("renders the locator block, never the v1 selector pair", () => {
    const wrapper = render();
    expect(wrapper.find(test("synthetics-journey-step-locator")).exists()).toBe(true);
    expect(wrapper.find(test("synthetics-journey-step-selector-type-select")).exists()).toBe(
      false,
    );
    expect(wrapper.find(test("synthetics-journey-step-selector-input")).exists()).toBe(false);
  });

  it("renders the locator block for a recorded step too", () => {
    const wrapper = render({
      locator: { candidates: [{ kind: "test_attribute", value: '[data-test="x"]' }] },
    });
    expect(wrapper.find(test("synthetics-journey-step-locator")).exists()).toBe(true);
  });

  // SE-1: the form and the validator now share one predicate, so the form can
  // neither demand a target the validator ignores nor omit one it requires.
  it("renders no target block for a page-level assertion", () => {
    const wrapper = render({
      action: "assert",
      assertion: { kind: "url_matches", expected: "**/web/**" },
    });
    expect(wrapper.find(test("synthetics-journey-step-locator")).exists()).toBe(false);
  });

  it("renders the target block for an element-level assertion", () => {
    const wrapper = render({ action: "assert", assertion: { kind: "element_visible" } });
    expect(wrapper.find(test("synthetics-journey-step-locator")).exists()).toBe(true);
  });

  it("renders no target block for navigate", () => {
    const wrapper = render({ action: "navigate", value: "https://example.com" });
    expect(wrapper.find(test("synthetics-journey-step-locator")).exists()).toBe(false);
  });
});

// `hover` is retired. It can no longer reach a step — actionOptions filters
// RETIRED_ACTIONS out of the picker, the recorder has never emitted one
// (upstream's ActionName omits them entirely), and no v1 journeys exist, which
// was the only other way one could have entered a journey. The notice also named
// no replacement, so it told an author to fix something without saying how.
describe("BrowserJourneyStepEditor retired actions", () => {
  it("renders no retired-action notice, even for a legacy action value", () => {
    const wrapper = render({ action: "hover" });
    expect(wrapper.find(test("synthetics-journey-step-retired-action")).exists()).toBe(false);
  });
});

// The host parses with zod and pushes the resulting issues back down as per-field
// messages. Before this, validation was save-time and toast-only, so a failure
// named no field (SE-3).
describe("BrowserJourneyStepEditor inline field errors", () => {
  function renderWithErrors(step: Partial<BrowserStep>, errors: Record<string, string>) {
    const full: BrowserStep = {
      id: "s1",
      action: "click",
      name: "Sign in",
      code: "",
      locator: { candidates: [], user_override: null },
      ...step,
    };
    return mount(BrowserJourneyStepEditor, {
      props: { step: full, ...errors },
      global: { plugins: [i18n] },
    });
  }

  it("renders a name error on the name field", () => {
    const wrapper = renderWithErrors({}, { nameErrorMessage: "Give this step a name" });
    expect(wrapper.find(test("synthetics-journey-step-name-input")).text()).toContain(
      "Give this step a name",
    );
  });

  it("renders a value error on the value field", () => {
    const wrapper = renderWithErrors(
      { action: "type", value: "" },
      { valueErrorMessage: "Enter the text this step should type" },
    );
    expect(wrapper.find(test("synthetics-journey-step-value-input")).text()).toContain(
      "Enter the text this step should type",
    );
  });

  it("renders an expected error on the assertion's expected field", () => {
    const wrapper = renderWithErrors(
      { action: "assert", assertion: { kind: "element_text", expected: "" } },
      { expectedErrorMessage: "Enter the value this assertion should expect" },
    );
    expect(
      wrapper.find(test("synthetics-journey-step-assertion-expected-input")).text(),
    ).toContain("Enter the value this assertion should expect");
  });

  it("renders no error text when the host passes none", () => {
    const wrapper = renderWithErrors({}, {});
    expect(wrapper.find(test("synthetics-journey-step-name-input")).text()).not.toContain(
      "Give this step a name",
    );
  });
});
