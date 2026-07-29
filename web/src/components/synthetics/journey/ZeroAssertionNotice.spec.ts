// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";
import ZeroAssertionNotice from "./ZeroAssertionNotice.vue";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

function step(overrides: Partial<BrowserStep> = {}): BrowserStep {
  return { id: "s1", action: "click", name: "Sign In", code: "", ...overrides };
}

function render(steps: BrowserStep[]) {
  return mount(ZeroAssertionNotice, { props: { steps }, global: { plugins: [i18n] } });
}

const test = (name: string) => `[data-test="${name}"]`;
const NOTICE = test("synthetics-journey-zero-assertion-notice");

describe("ZeroAssertionNotice", () => {
  it("warns when a journey verifies nothing", () => {
    expect(render([step()]).find(NOTICE).exists()).toBe(true);
  });

  it("stays quiet once the journey asserts something", () => {
    expect(
      render([step(), step({ id: "s2", action: "assert" })])
        .find(NOTICE)
        .exists(),
    ).toBe(false);
  });

  it("stays quiet for an empty journey — there is nothing to assert about yet", () => {
    expect(render([]).find(NOTICE).exists()).toBe(false);
  });

  // P5.2.1 — the assertion is offered, never generated. A recorder cannot know
  // what "correct" means for an application, so the step arrives with the kind
  // chosen and the target left to the author.
  it("adds an empty element_visible assertion rather than guessing one", async () => {
    const wrapper = render([step()]);
    await wrapper.find(test("synthetics-journey-add-assertion-btn")).trigger("click");

    const added = wrapper.emitted("add-assertion")?.[0]?.[0] as BrowserStep;
    expect(added.action).toBe("assert");
    expect(added.assertion).toEqual({ kind: "element_visible" });
    expect(added.selector).toBeUndefined();
    expect(added.locator).toBeUndefined();
  });

  // An author who has decided is not told twice.
  it("can be dismissed", async () => {
    const wrapper = render([step()]);
    await wrapper.find(test("synthetics-journey-zero-assertion-dismiss-btn")).trigger("click");
    expect(wrapper.find(NOTICE).exists()).toBe(false);
  });
});
