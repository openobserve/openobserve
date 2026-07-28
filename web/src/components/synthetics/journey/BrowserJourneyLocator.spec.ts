// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { StepLocator } from "@/types/synthetics";
import BrowserJourneyLocator from "./BrowserJourneyLocator.vue";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const BUNDLE: StepLocator = {
  candidates: [
    { kind: "test_attribute", value: '[data-test="login-sign-in"]' },
    { kind: "role", value: 'role=button[name="Sign In"]' },
    { kind: "css", value: ".btn-primary" },
  ],
};

function render(locator: StepLocator = BUNDLE) {
  return mount(BrowserJourneyLocator, {
    props: { locator },
    global: { plugins: [i18n] },
  });
}

const test = (name: string) => `[data-test="${name}"]`;

describe("BrowserJourneyLocator", () => {
  it("shows the primary candidate as the effective locator", () => {
    const wrapper = render();
    const primary = wrapper.find(test("synthetics-journey-step-locator-primary"));
    expect(primary.text()).toContain('[data-test="login-sign-in"]');
    expect(primary.text()).toContain("Test attribute");
  });

  it("collapses the remaining candidates behind a fallback count", () => {
    const wrapper = render();
    expect(wrapper.find(test("synthetics-journey-step-locator-fallbacks")).exists()).toBe(true);
    expect(wrapper.text()).toContain("2 fallbacks");
  });

  // P2.5.0 — the list is machine-derived evidence. Pinning is the only way for
  // an author to express intent, which is what keeps the stored list
  // byte-comparable for the self-healing precondition.
  it("emits a user_override when a candidate is pinned, leaving the list untouched", async () => {
    const wrapper = render();
    await wrapper.find(test("synthetics-journey-step-locator-pin-primary-btn")).trigger("click");

    const emitted = wrapper.emitted("update:locator")?.[0]?.[0] as StepLocator;
    expect(emitted.user_override).toEqual({
      kind: "test_attribute",
      value: '[data-test="login-sign-in"]',
    });
    expect(emitted.candidates).toEqual(BUNDLE.candidates);
  });

  it("pins a fallback candidate without reordering the list", async () => {
    const wrapper = render();
    // The fallbacks are collapsed by default — the effective locator is the
    // thing an author usually needs, and the rest is evidence behind a click.
    await wrapper.find(`${test("synthetics-journey-step-locator-fallbacks")} button`).trigger("click");

    const pinButtons = wrapper.findAll(test("synthetics-journey-step-locator-pin-btn"));
    expect(pinButtons.length).toBe(2);
    await pinButtons[0].trigger("click");

    const emitted = wrapper.emitted("update:locator")?.[0]?.[0] as StepLocator;
    expect(emitted.user_override?.value).toBe('role=button[name="Sign In"]');
    expect(emitted.candidates.map((c) => c.value)).toEqual(BUNDLE.candidates.map((c) => c.value));
  });

  it("shows the pinned locator as the effective one, and says it will not fall back", () => {
    const wrapper = render({
      ...BUNDLE,
      user_override: { kind: "css", value: "#pinned" },
    });
    expect(wrapper.find(test("synthetics-journey-step-locator-primary")).text()).toContain("#pinned");
    expect(wrapper.find(test("synthetics-journey-step-locator-pinned-note")).exists()).toBe(true);
  });

  it("clears the pin, restoring fallback", async () => {
    const wrapper = render({ ...BUNDLE, user_override: { kind: "css", value: "#pinned" } });
    await wrapper.find(test("synthetics-journey-step-locator-unpin-btn")).trigger("click");
    const emitted = wrapper.emitted("update:locator")?.[0]?.[0] as StepLocator;
    expect(emitted.user_override).toBeNull();
  });

  // Free text is intent, not evidence. Editing a candidate in place would
  // corrupt the list the healing precondition compares against.
  it("turns free text into a user_override rather than editing a candidate", async () => {
    const wrapper = render();
    await wrapper
      .find(`${test("synthetics-journey-step-locator-override-input")} input`)
      .setValue("#hand-written");
    await wrapper.find(test("synthetics-journey-step-locator-override-btn")).trigger("click");

    const emitted = wrapper.emitted("update:locator")?.[0]?.[0] as StepLocator;
    expect(emitted.user_override).toEqual({ kind: "css", value: "#hand-written" });
    expect(emitted.candidates).toEqual(BUNDLE.candidates);
  });

  it("renders a single-candidate bundle with no fallback section", () => {
    const wrapper = render({ candidates: [{ kind: "css", value: "#only" }] });
    expect(wrapper.find(test("synthetics-journey-step-locator-primary")).text()).toContain("#only");
    expect(wrapper.find(test("synthetics-journey-step-locator-fallbacks")).exists()).toBe(false);
  });
});
