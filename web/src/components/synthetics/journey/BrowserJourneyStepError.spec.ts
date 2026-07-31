// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { StepReplayResult } from "@/types/synthetics";
import BrowserJourneyStepError from "./BrowserJourneyStepError.vue";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const test = (name: string) => `[data-test="${name}"]`;

function render(result: Partial<StepReplayResult> = {}, stepNumber?: number) {
  const full: StepReplayResult = {
    stepId: "s3",
    stepName: "Click sign in",
    passed: false,
    durationMs: 30_000,
    error: "locator.click: Timeout 30000ms exceeded.",
    ...result,
  };
  return mount(BrowserJourneyStepError, {
    props: { result: full, stepNumber },
    global: { plugins: [i18n] },
  });
}

// SE-4. This evidence was computed and thrown away: when JourneySteps replaced the
// old row component the error card was not carried across, so a failed replay showed
// only a red dot and a one-line journey banner.
describe("BrowserJourneyStepError", () => {
  it("shows the error message", () => {
    const wrapper = render();
    expect(wrapper.find(test("synthetics-journey-step-error-message")).text()).toContain(
      "Timeout 30000ms exceeded",
    );
  });

  it("prefers the structured error's message over the raw string", () => {
    const wrapper = render({
      structuredError: { name: "TimeoutError", message: "waiting for locator" } as never,
    });
    expect(wrapper.find(test("synthetics-journey-step-error-message")).text()).toContain(
      "waiting for locator",
    );
  });

  it("names the exit reason and the duration", () => {
    const wrapper = render({
      structuredError: { name: "TimeoutError", message: "x" } as never,
    });
    const card = wrapper.find(test("synthetics-journey-step-error-card")).text();
    expect(card).toMatch(/timeout/i);
    expect(card).toContain("30.0 s");
  });

  it("shows the selector the runner could not act on", () => {
    const wrapper = render({
      structuredError: {
        name: "TimeoutError",
        message: "x",
        selector: '[data-test="sign-in"]',
      } as never,
    });
    expect(wrapper.find(test("synthetics-journey-step-error-selector")).text()).toBe(
      '[data-test="sign-in"]',
    );
  });

  // X-8.2 — "A step the player skipped MUST NOT render as a pass. Silent divergence
  // is the failure mode this whole section exists to prevent."
  it("renders the player's fidelity notes", () => {
    const wrapper = render({
      fidelity: {
        level: "reduced",
        notes: [
          "primary locator only",
          'Flow control not simulated: the preview stops at the first failure regardless of "optional" or "always run".',
        ],
      },
    });
    const fidelity = wrapper.find(test("synthetics-journey-step-fidelity"));
    expect(fidelity.exists()).toBe(true);
    expect(fidelity.text()).toContain("primary locator only");
    expect(fidelity.text()).toContain("Flow control not simulated");
  });

  it("omits the fidelity block when the player reported nothing", () => {
    expect(render().find(test("synthetics-journey-step-fidelity")).exists()).toBe(false);
  });

  // SE-4: the old button said "Re-run" inside a per-step card but replayed the whole
  // journey. A single step is not independently runnable, so the honest affordance
  // names the prefix it will actually run.
  it("names the prefix the re-run will execute", () => {
    const wrapper = render({}, 3);
    expect(wrapper.find(test("synthetics-journey-error-retry-btn")).text()).toContain("1–3");
  });

  it("emits retry-replay when the re-run is clicked", async () => {
    const wrapper = render({}, 3);
    await wrapper.find(test("synthetics-journey-error-retry-btn")).trigger("click");
    expect(wrapper.emitted("retry-replay")).toBeTruthy();
  });
});
