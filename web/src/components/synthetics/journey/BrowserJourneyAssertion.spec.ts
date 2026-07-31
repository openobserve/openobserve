// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { StepAssertion } from "@/types/synthetics";
import BrowserJourneyAssertion from "./BrowserJourneyAssertion.vue";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

function render(assertion?: StepAssertion) {
  return mount(BrowserJourneyAssertion, {
    props: { assertion },
    global: { plugins: [i18n] },
  });
}

const test = (name: string) => `[data-test="${name}"]`;
const EXPECTED = test("synthetics-journey-step-assertion-expected-input");
const ATTRIBUTE = test("synthetics-journey-step-assertion-attribute-input");

describe("BrowserJourneyAssertion", () => {
  // An assert step that predates Phase 5 keeps its original meaning rather than
  // rendering as an empty, invalid form.
  it("defaults to element_visible when the step has no typed assertion", () => {
    const wrapper = render();
    expect(wrapper.find(test("synthetics-journey-step-assertion")).exists()).toBe(true);
    // Visibility asks "is it there?" — there is nothing to compare.
    expect(wrapper.find(EXPECTED).exists()).toBe(false);
    expect(wrapper.find(ATTRIBUTE).exists()).toBe(false);
  });

  it("asks for an expected value on every kind except the visibility ones", () => {
    expect(render({ kind: "element_text", expected: "Welcome" }).find(EXPECTED).exists()).toBe(
      true,
    );
    expect(render({ kind: "url_matches", expected: "**/web/**" }).find(EXPECTED).exists()).toBe(
      true,
    );
    expect(render({ kind: "page_title", expected: "Dashboard" }).find(EXPECTED).exists()).toBe(
      true,
    );
    expect(render({ kind: "element_not_visible" }).find(EXPECTED).exists()).toBe(false);
  });

  it("asks for an attribute name only for element_attribute", () => {
    expect(
      render({ kind: "element_attribute", attribute: "href", expected: "/web/" })
        .find(ATTRIBUTE)
        .exists(),
    ).toBe(true);
    expect(render({ kind: "element_text", expected: "x" }).find(ATTRIBUTE).exists()).toBe(false);
  });

  it("emits the edited expected value", async () => {
    const wrapper = render({ kind: "element_text", expected: "" });
    await wrapper.find(`${EXPECTED} input`).setValue("Welcome back");
    const emitted = wrapper.emitted("update:assertion")?.at(-1)?.[0] as StepAssertion;
    expect(emitted).toEqual({ kind: "element_text", expected: "Welcome back" });
  });

  // A stale `attribute` left on a page_title assertion would be refused by
  // server validation with no visible cause, so switching kind drops what no
  // longer applies.
  it("drops values that no longer apply when the kind changes", async () => {
    const wrapper = render({ kind: "element_attribute", attribute: "href", expected: "/web/" });
    (wrapper.vm as unknown as { kindComputed: string }).kindComputed = "element_visible";
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted("update:assertion")?.at(-1)?.[0] as StepAssertion;
    expect(emitted).toEqual({ kind: "element_visible" });
  });

  it("offers exactly the closed kind set the server accepts", () => {
    const wrapper = render();
    const options = (wrapper.vm as unknown as { kindOptions: { value: string }[] }).kindOptions;
    expect(options.map((o) => o.value)).toEqual([
      "element_visible",
      "element_not_visible",
      "element_text",
      "url_matches",
      "page_title",
      "element_attribute",
    ]);
  });
});
