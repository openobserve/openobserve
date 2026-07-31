// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";
import UpgradeJourneyBanner from "./UpgradeJourneyBanner.vue";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

function step(overrides: Partial<BrowserStep> = {}): BrowserStep {
  return {
    id: "s1",
    action: "click",
    name: "Sign In",
    selector: '[data-test="login-sign-in"]',
    selectorType: "TestID",
    code: "",
    ...overrides,
  };
}

function render(steps: BrowserStep[]) {
  return mount(UpgradeJourneyBanner, { props: { steps }, global: { plugins: [i18n] } });
}

const test = (name: string) => `[data-test="${name}"]`;
const BANNER = test("synthetics-journey-upgrade-banner");

describe("UpgradeJourneyBanner", () => {
  it("stays out of the way when there is nothing to upgrade", () => {
    const alreadyV2 = step({
      locator: { candidates: [{ kind: "test_attribute", value: "#a" }], user_override: null },
      selector: undefined,
      selectorType: undefined,
    });
    expect(render([alreadyV2]).find(BANNER).exists()).toBe(false);
  });

  it("offers the upgrade when a journey still carries a hard sleep", () => {
    const wrapper = render([step(), step({ id: "s2", action: "wait", timeout: 30000 })]);
    expect(wrapper.find(BANNER).exists()).toBe(true);
  });

  // Dropping a step or removing a sleep is a real behaviour change. An author
  // should read it before committing, not discover it from a diff.
  it("previews every change before anything is applied", async () => {
    const wrapper = render([step(), step({ id: "s2", action: "wait", timeout: 30000 })]);
    expect(wrapper.find(test("synthetics-journey-upgrade-changes")).exists()).toBe(false);

    await wrapper.find(test("synthetics-journey-upgrade-preview-btn")).trigger("click");
    const changes = wrapper.find(test("synthetics-journey-upgrade-changes"));
    expect(changes.exists()).toBe(true);
    expect(changes.text()).toMatch(/settle budget/i);
  });

  it("emits the lifted journey, sleep converted and bundle created", async () => {
    const wrapper = render([step(), step({ id: "s2", action: "wait", timeout: 30000 })]);
    await wrapper.find(test("synthetics-journey-upgrade-apply-btn")).trigger("click");

    const lifted = wrapper.emitted("upgrade")?.[0]?.[0] as BrowserStep[];
    expect(lifted.map((s) => s.id)).toEqual(["s1"]);
    expect(lifted[0].locator?.candidates[0]).toEqual({
      kind: "test_attribute",
      value: '[data-test="login-sign-in"]',
    });
    expect(lifted[0].settle?.budget_ms).toBe(30000);
  });

  it("does not mutate the journey it was given", async () => {
    const original = [step(), step({ id: "s2", action: "wait", timeout: 30000 })];
    const snapshot = JSON.stringify(original);
    const wrapper = render(original);
    await wrapper.find(test("synthetics-journey-upgrade-apply-btn")).trigger("click");
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
