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
    expect(wrapper.find(test("synthetics-journey-step-selector-type-select")).exists()).toBe(false);
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
    expect(wrapper.find(test("synthetics-journey-step-assertion-expected-input")).text()).toContain(
      "Enter the value this assertion should expect",
    );
  });

  it("renders no error text when the host passes none", () => {
    const wrapper = renderWithErrors({}, {});
    expect(wrapper.find(test("synthetics-journey-step-name-input")).text()).not.toContain(
      "Give this step a name",
    );
  });
});

// Phase 2 / SE-5, revised. Two tiers, not three peer collapsibles: what the step
// DOES is plain always-visible markup, and everything a recording or a runner
// default already answers sits behind one `Advanced` collapsible.
//
// The three-group shape charged the same price for the step's identity as for its
// tuning — and wrapped always-visible content in a `default-open` collapsible,
// which is a control whose only effect is to let an author close what they need.
describe("BrowserJourneyStepEditor field layout", () => {
  const groups = (wrapper: ReturnType<typeof render>) =>
    wrapper
      .findAll('[data-test^="synthetics-journey-step-group-"]')
      .map((g) => g.attributes("data-test"));

  it("renders the always-visible block and exactly one collapsible", () => {
    const wrapper = render();
    expect(groups(wrapper)).toEqual([
      "synthetics-journey-step-group-does",
      "synthetics-journey-step-group-advanced",
    ]);
  });

  // OCollapsible unmounts collapsed content, so `Advanced` must be opened before
  // its fields are in the DOM — it being closed by default is the point.
  async function openAdvanced(wrapper: ReturnType<typeof render>) {
    await wrapper.find(`${test("synthetics-journey-step-group-advanced")} button`).trigger("click");
  }

  it("needs no click to reach action, name, target and value", () => {
    const wrapper = render({ action: "type", value: "hunter2" });
    const visible = wrapper.find(test("synthetics-journey-step-group-does"));
    expect(visible.find(test("synthetics-journey-step-action-select")).exists()).toBe(true);
    expect(visible.find(test("synthetics-journey-step-name-input")).exists()).toBe(true);
    expect(visible.find(test("synthetics-journey-step-locator")).exists()).toBe(true);
    expect(visible.find(test("synthetics-journey-step-value-input")).exists()).toBe(true);
  });

  // One disclosure in the whole editor. The locator block used to add a second
  // (its "N fallbacks" collapse), which nested two levels of hiding over one short
  // read-only list.
  it("renders one disclosure region in the whole editor", () => {
    const wrapper = render({
      locator: {
        candidates: [
          { kind: "test_attribute", value: '[data-test="a"]' },
          { kind: "role", value: "role=button" },
        ],
      },
    });
    expect(wrapper.findAll('[data-test="o-collapsible-content"]').length).toBe(1);
  });

  // SE-16: the settle fields used to be gated on hasSettle, so a hand-added step
  // could never be given a budget — the field that creates one was hidden until
  // one existed.
  it("reaches the settle budget on a hand-added step with no settle data", async () => {
    const wrapper = render();
    expect(wrapper.find(test("synthetics-journey-step-settle-budget-input")).exists()).toBe(false);
    await openAdvanced(wrapper);
    expect(wrapper.find(test("synthetics-journey-step-settle-budget-input")).exists()).toBe(true);
  });

  it("puts settling, timeout and flow control in Advanced", async () => {
    const wrapper = render();
    await openAdvanced(wrapper);
    const advanced = wrapper.find(test("synthetics-journey-step-group-advanced"));
    expect(advanced.find(test("synthetics-journey-step-settle-budget-input")).exists()).toBe(true);
    expect(advanced.find(test("synthetics-journey-step-timeout-input")).exists()).toBe(true);
    expect(advanced.find(test("synthetics-journey-step-optional-checkbox")).exists()).toBe(true);
    expect(advanced.find(test("synthetics-journey-step-always-run-checkbox")).exists()).toBe(true);
  });

  it("opens Advanced already when the step holds a non-default value", () => {
    const wrapper = render({ optional: true });
    expect(wrapper.find(test("synthetics-journey-step-timeout-input")).exists()).toBe(true);
  });

  it("captions Advanced with what it is for when the step holds only defaults", () => {
    const wrapper = render();
    const caption = wrapper.find(test("synthetics-journey-step-group-advanced")).text();
    expect(caption).toContain("Page settling");
    expect(caption).not.toMatch(/Optional|Always run|Timeout \d/);
  });

  it("captions Advanced with each non-default value instead", () => {
    const wrapper = render({ optional: true, alwaysRun: true, timeout: 10000 });
    const caption = wrapper.find(test("synthetics-journey-step-group-advanced")).text();
    expect(caption).toContain("Optional");
    expect(caption).toContain("Always run");
    expect(caption).toContain("10");
    expect(caption).not.toContain("Page settling");
  });

  it("captions Advanced when settle evidence was recorded", () => {
    const wrapper = render({
      settle: { navigation: { url_pattern: "**/home" }, observed_duration_ms: 1200 },
    });
    expect(wrapper.find(test("synthetics-journey-step-group-advanced")).text()).toContain(
      "recorded",
    );
  });
});

// Phase 2 / SE-15. The configure forms size fields with flex, not fixed widths;
// the step editor was the outlier with `!important` overrides that defeated reflow.
describe("BrowserJourneyStepEditor layout", () => {
  it("uses no !important width overrides", () => {
    const wrapper = render({ action: "type", value: "x" });
    const offenders = wrapper
      .findAll("*")
      .map((n) => n.attributes("class") ?? "")
      .filter((c) => /\bw-\d+!/.test(c));
    expect(offenders).toEqual([]);
  });
});

// Phase 3 / SE-6, SE-9, SE-20.
describe("BrowserJourneyStepEditor plain language", () => {
  it("leads with a sentence describing the step", () => {
    const wrapper = render({
      action: "click",
      locator: { candidates: [{ kind: "test_attribute", value: '[data-test="sign-in"]' }] },
    });
    const summary = wrapper.find(test("synthetics-journey-step-summary")).text();
    expect(summary).toContain("Click");
    expect(summary).toContain('[data-test="sign-in"]');
    // the effective timeout, not a raw ms number
    expect(summary).toContain("30");
  });

  it("uses the pinned locator in the summary, since that is what runs", () => {
    const wrapper = render({
      locator: {
        candidates: [{ kind: "css", value: ".ignored" }],
        user_override: { kind: "css", value: "#pinned" },
      },
    });
    expect(wrapper.find(test("synthetics-journey-step-summary")).text()).toContain("#pinned");
  });

  it("reflects an explicit timeout in the summary", () => {
    const wrapper = render({ timeout: 5000 });
    expect(wrapper.find(test("synthetics-journey-step-summary")).text()).toContain("5");
  });

  it("names the runner default in the timeout helper for an interaction", async () => {
    const wrapper = render();
    await wrapper.find(`${test("synthetics-journey-step-group-advanced")} button`).trigger("click");
    const help = wrapper.find(test("synthetics-journey-step-timeout-help")).text();
    expect(help).toContain("30");
    expect(help).toContain("Maximum 60");
  });

  // SE-20: on navigate/assert the category default IS the server maximum, so the
  // field can only shorten — saying so stops the below-default warning reading as
  // a malfunction.
  it("says the field can only shorten on navigate, where default equals the maximum", async () => {
    const wrapper = render({ action: "navigate", value: "https://example.com" });
    await wrapper.find(`${test("synthetics-journey-step-group-advanced")} button`).trigger("click");
    const help = wrapper.find(test("synthetics-journey-step-timeout-help")).text();
    expect(help).toContain("60");
    expect(help).toMatch(/only shorten/i);
  });

  it("renames the Playwright terms out of the visible copy", () => {
    const wrapper = render({
      locator: {
        candidates: [
          { kind: "css", value: "#a" },
          { kind: "css", value: "#b" },
        ],
      },
    });
    const txt = wrapper.text();
    expect(txt).toContain("How to find this element");
    expect(txt).toContain("Always use this one");
    expect(txt).not.toMatch(/\bLocator\b/);
  });
});

// Phase 4 / SE-13, D11. Both flow-control flags are fully implemented in the probe
// with semantics the labels omit. Both-set is legitimate — run during cleanup, and
// if it fails do not fail the run — so this explains rather than prevents.
describe("BrowserJourneyStepEditor flow-control help", () => {
  async function openAdvanced(wrapper: ReturnType<typeof render>) {
    await wrapper.find(`${test("synthetics-journey-step-group-advanced")} button`).trigger("click");
  }

  it("attaches an info tooltip to each flag", async () => {
    const wrapper = render();
    await openAdvanced(wrapper);
    expect(wrapper.find(test("synthetics-journey-step-optional-help")).exists()).toBe(true);
    expect(wrapper.find(test("synthetics-journey-step-always-run-help")).exists()).toBe(true);
  });

  it("explains the probe behaviour the labels omit", async () => {
    const wrapper = render();
    await openAdvanced(wrapper);
    const tips = wrapper.findAllComponents({ name: "OTooltip" }).map((c) => c.props("content"));
    const optional = tips.find((c) => /Skipped/i.test(String(c)));
    const always = tips.find((c) => /cleanup/i.test(String(c)));
    expect(optional).toMatch(/never fails the run/i);
    expect(always).toMatch(/after the failed one/i);
  });

  it("leaves both flags independently settable — the combination is legal", async () => {
    const wrapper = render({ optional: true, alwaysRun: true });
    const optional = wrapper.find(test("synthetics-journey-step-optional-checkbox"));
    const always = wrapper.find(test("synthetics-journey-step-always-run-checkbox"));
    expect(optional.attributes("disabled")).toBeUndefined();
    expect(always.attributes("disabled")).toBeUndefined();
  });
});

// Phase 5c / SE-11, D9. Discarding the wire on an action change is correct — its
// payload belongs to the old action — but it used to happen in silence.
//
// Scope note: after the storage path stopped preserving `wire` (SE-24), a step
// loaded from a saved monitor carries none, so there is nothing to discard and the
// notice correctly stays silent. It applies to a live recording session, which is
// the only place a wire is still present.
describe("BrowserJourneyStepEditor action-change notice", () => {
  const selectAction = async (wrapper: ReturnType<typeof render>, action: string) => {
    await wrapper.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", action);
  };

  it("says the step is rebuilt when a recorded wire is discarded", async () => {
    const wrapper = render({ wire: { id: "w1", action: "click" } as never });
    expect(wrapper.find(test("synthetics-journey-step-action-changed-notice")).exists()).toBe(
      false,
    );

    await selectAction(wrapper, "navigate");
    expect(wrapper.find(test("synthetics-journey-step-action-changed-notice")).text()).toMatch(
      /rebuilds this step/i,
    );
  });

  it("stays silent for a stored step, which carries no wire to lose", async () => {
    const wrapper = render(); // no `wire` — the shape mapWireSteps now produces
    await selectAction(wrapper, "navigate");
    expect(wrapper.find(test("synthetics-journey-step-action-changed-notice")).exists()).toBe(
      false,
    );
  });

  it("stays silent when the action is re-selected unchanged", async () => {
    const wrapper = render({ wire: { id: "w1", action: "click" } as never });
    await selectAction(wrapper, "click");
    expect(wrapper.find(test("synthetics-journey-step-action-changed-notice")).exists()).toBe(
      false,
    );
  });
});
