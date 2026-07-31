// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import TestIdMisconfiguredNotice from "./TestIdMisconfiguredNotice.vue";
import type { BrowserStep } from "@/types/synthetics";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({ legacy: false, locale: "en-US", messages: { "en-US": en } });

const NOTICE = '[data-test="synthetics-journey-testid-misconfigured"]';

function step(kind: string | null): BrowserStep {
  return {
    id: "s1",
    action: "click",
    name: "Click",
    locator: kind ? { candidates: [{ kind, value: "x" }], user_override: null } : undefined,
  } as unknown as BrowserStep;
}

function render(steps: BrowserStep[]) {
  return mount(TestIdMisconfiguredNotice, {
    props: { steps, testIdAttr: "data-testid" },
    global: { plugins: [i18n] },
  });
}

describe("TestIdMisconfiguredNotice", () => {
  it("warns when no step in the recording produced a test_attribute candidate", () => {
    // The silent failure: upstream's generator emits nothing at test-id rank
    // when the configured attribute is not the one the app uses, and every step
    // degrades to role/text/css without an error anywhere.
    expect(
      render([step("role"), step("css")])
        .find(NOTICE)
        .exists(),
    ).toBe(true);
  });

  it("names the attribute that was actually used, so the fix is obvious", () => {
    expect(render([step("css")]).text()).toContain("data-testid");
  });

  it("stays silent when any step found a test attribute", () => {
    expect(
      render([step("css"), step("test_attribute")])
        .find(NOTICE)
        .exists(),
    ).toBe(false);
  });

  it("stays silent for a journey with no element steps at all", () => {
    // A navigate-only journey has nothing to find; zero test attributes there
    // is not evidence of anything.
    expect(
      render([step(null)])
        .find(NOTICE)
        .exists(),
    ).toBe(false);
    expect(render([]).find(NOTICE).exists()).toBe(false);
  });

  it("can be dismissed — a page may genuinely have no test attributes", () => {
    const wrapper = render([step("css")]);
    wrapper.find('[data-test="synthetics-journey-testid-misconfigured-dismiss"]').trigger("click");
    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.find(NOTICE).exists()).toBe(false);
    });
  });
});
