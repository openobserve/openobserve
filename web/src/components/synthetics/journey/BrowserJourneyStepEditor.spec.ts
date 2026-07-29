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
