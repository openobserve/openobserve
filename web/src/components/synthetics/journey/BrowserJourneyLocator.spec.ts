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

  // The fallbacks used to sit behind an `OCollapsible "N fallbacks"` (P2.5/T5).
  // A count advertised nothing, and the list is what the runner will actually try
  // if the primary stops matching, so the click bought the author no information.
  it("shows every remaining candidate without a disclosure", () => {
    const wrapper = render();
    expect(wrapper.find(test("synthetics-journey-step-locator-fallbacks")).exists()).toBe(true);
    const list = wrapper.find(test("synthetics-journey-step-locator-fallbacks")).text();
    expect(list).toContain('role=button[name="Sign In"]');
    expect(list).toContain(".btn-primary");
    expect(wrapper.text()).not.toContain("2 fallbacks");
  });

  it("says what the fallback list is for rather than how long it is", () => {
    const wrapper = render();
    expect(
      wrapper.find(test("synthetics-journey-step-locator-fallbacks-lead")).text(),
    ).toMatch(/tried in order/i);
  });

  // A pinned step never falls back, so the lead-in would be a lie; the pinned note
  // stands in for it and the rows render inert.
  it("drops the fallback lead-in when the step is pinned", () => {
    const wrapper = render({ ...BUNDLE, user_override: { kind: "css", value: "#pinned" } });
    expect(
      wrapper.find(test("synthetics-journey-step-locator-fallbacks-lead")).exists(),
    ).toBe(false);
    expect(wrapper.find(test("synthetics-journey-step-locator-pinned-note")).exists()).toBe(true);
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
    expect(wrapper.find(test("synthetics-journey-step-locator-primary")).text()).toContain(
      "#pinned",
    );
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

describe("all-positional notice (Phase 2a)", () => {
  const positional = {
    candidates: [
      { kind: "test_attribute" as const, value: '[data-test="org-item"] >> nth=1' },
      { kind: "css" as const, value: "div >> internal:has-text=/^Acme$/ >> nth=0" },
    ],
    user_override: null,
  };

  it("warns when every candidate identifies the element by position", () => {
    const wrapper = mount(BrowserJourneyLocator, {
      props: { locator: positional },
      global: { plugins: [i18n] },
    });
    expect(
      wrapper.find('[data-test="synthetics-journey-step-locator-positional-warning"]').exists(),
    ).toBe(true);
  });

  it("stays silent when any candidate is unambiguous", () => {
    const wrapper = mount(BrowserJourneyLocator, {
      props: {
        locator: {
          candidates: [
            { kind: "role" as const, value: 'internal:role=button[name="Save"i]' },
            { kind: "test_attribute" as const, value: '[data-test="org-item"] >> nth=1' },
          ],
          user_override: null,
        },
      },
      global: { plugins: [i18n] },
    });
    expect(
      wrapper.find('[data-test="synthetics-journey-step-locator-positional-warning"]').exists(),
    ).toBe(false);
  });

  it("stays silent once the author has pinned — the question is answered", () => {
    const wrapper = mount(BrowserJourneyLocator, {
      props: {
        locator: { ...positional, user_override: { kind: "css" as const, value: "#chosen" } },
      },
      global: { plugins: [i18n] },
    });
    expect(
      wrapper.find('[data-test="synthetics-journey-step-locator-positional-warning"]').exists(),
    ).toBe(false);
  });
});

// ── Empty bundle ──────────────────────────────────────────────────────────
// A hand-added step carries `{ candidates: [], user_override: null }`. Every
// other block is v-if'd away, so the free-text input is the PRIMARY way to name
// the element — not an override of something — and it must say so, and be marked
// required, because the block only renders when a target is needed (D7).
describe("BrowserJourneyLocator empty bundle", () => {
  const EMPTY: StepLocator = { candidates: [], user_override: null };

  // `data-test` sits on the OInput root, so reach the inner <input> to set a
  // value — the pattern the pinning tests above already use.
  function overrideInput(wrapper: ReturnType<typeof render>) {
    return wrapper.find(`${test("synthetics-journey-step-locator-override-input")} input`);
  }

  it("labels the input as the primary control, not an override", () => {
    const wrapper = render(EMPTY);
    expect(overrideInput(wrapper).exists()).toBe(true);
    expect(wrapper.text()).toContain("How to find this element");
    expect(wrapper.text()).not.toContain("Use a different locator");
  });

  it("shows no primary card, no fallbacks and no positional warning", () => {
    const wrapper = render(EMPTY);
    expect(wrapper.find(test("synthetics-journey-step-locator-primary")).exists()).toBe(false);
    expect(wrapper.find(test("synthetics-journey-step-locator-fallbacks")).exists()).toBe(false);
    expect(
      wrapper.find(test("synthetics-journey-step-locator-positional-warning")).exists(),
    ).toBe(false);
  });

  it("marks the input required — the block only renders when a target is needed", () => {
    const wrapper = render(EMPTY);
    expect(wrapper.findComponent({ name: "OInput" }).props("required")).toBe(true);
  });

  it("still emits update:locator when a value is applied", async () => {
    const wrapper = render(EMPTY);
    await overrideInput(wrapper).setValue('[data-test="sign-in"]');
    await wrapper.find(test("synthetics-journey-step-locator-override-btn")).trigger("click");

    const emitted = wrapper.emitted("update:locator");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual({
      candidates: [],
      user_override: { kind: "css", value: '[data-test="sign-in"]' },
    });
  });

  it("keeps the override label, unmarked, when candidates exist", () => {
    const wrapper = render();
    expect(wrapper.text()).toContain("Use a different locator");
    expect(wrapper.findComponent({ name: "OInput" }).props("required")).toBe(false);
  });
});

// Phase 4 / SE-8, D3. The kind is derived from the value, never picked — `kind`
// labels a locator, it does not parse it, so a picker that only set `kind` would
// store `{ kind: "role", value: "button" }` where `button` resolves as CSS.
describe("BrowserJourneyLocator derived kind", () => {
  const typeOverride = async (wrapper: ReturnType<typeof render>, value: string) => {
    await wrapper
      .find(`${test("synthetics-journey-step-locator-override-input")} input`)
      .setValue(value);
  };

  it("stores the kind read from the value, not css", async () => {
    const wrapper = render();
    await typeOverride(wrapper, 'internal:role=button[name="Sign In"i]');
    await wrapper.find(test("synthetics-journey-step-locator-override-btn")).trigger("click");

    const emitted = wrapper.emitted("update:locator")!;
    expect((emitted[0][0] as StepLocator).user_override).toEqual({
      kind: "role",
      value: 'internal:role=button[name="Sign In"i]',
    });
  });

  it("still stores css for a bare attribute selector", async () => {
    const wrapper = render();
    await typeOverride(wrapper, '[data-qa="submit"]');
    await wrapper.find(test("synthetics-journey-step-locator-override-btn")).trigger("click");
    const emitted = wrapper.emitted("update:locator")!;
    expect((emitted[0][0] as StepLocator).user_override?.kind).toBe("css");
  });

  it("shows the derived kind as a read-only badge while typing", async () => {
    const wrapper = render();
    expect(wrapper.find(test("synthetics-journey-step-locator-derived-kind")).exists()).toBe(
      false,
    );
    await typeOverride(wrapper, "text=Sign in");
    expect(wrapper.find(test("synthetics-journey-step-locator-derived-kind")).text()).toBe(
      "Text",
    );
  });

  it("prefills the override from a candidate without carrying its stored kind", async () => {
    const wrapper = render();
    await wrapper
      .find(test("synthetics-journey-step-locator-start-from-primary-btn"))
      .trigger("click");
    const input = wrapper.find(
      `${test("synthetics-journey-step-locator-override-input")} input`,
    );
    // Primary candidate is a bare [data-test=…] stored as test_attribute; the badge
    // describes what is in the box, which is CSS. Documented and intended (D3).
    expect((input.element as HTMLInputElement).value).toBe('[data-test="login-sign-in"]');
    expect(wrapper.find(test("synthetics-journey-step-locator-derived-kind")).text()).toBe(
      "CSS",
    );
  });
});
