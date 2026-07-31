// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import StepEvidence from "./StepEvidence.vue";
import type { FailureDetail } from "@/composables/synthetics/syntheticResultsSchema";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({ legacy: false, locale: "en-US", messages: { "en-US": en } });

function detail(over: Partial<FailureDetail> = {}): FailureDetail {
  return {
    stepId: "s2",
    stepName: "Profile visible",
    stepIndex: 2,
    error: "locator.waitFor: Timeout 60000ms exceeded",
    candidatesTried: [],
    settleSignals: [],
    settleMs: null,
    observedDurationMs: null,
    screenshotKey: null,
    traceKey: null,
    ...over,
  };
}

function render(d: FailureDetail) {
  return mount(StepEvidence, { props: { detail: d }, global: { plugins: [i18n] } });
}

describe("StepEvidence — locator resolution (P5.4 item 3)", () => {
  it("says the element was absent when no candidate matched", () => {
    const w = render(
      detail({
        candidatesTried: [
          { kind: "test_attribute", value: "[data-test=x]", outcome: "not_found" },
          { kind: "role", value: "internal:role=button", outcome: "not_found" },
        ],
      }),
    );
    expect(w.find('[data-test="synthetics-run-detail-locator-none-matched"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-run-detail-locator-healed"]').exists()).toBe(false);
  });

  it("says the markup moved when a fallback matched instead of the primary", () => {
    // This is the mechanical answer to "locator rot?" — and a different
    // diagnosis from "not found", which is why they are separate messages.
    const w = render(
      detail({
        candidatesTried: [
          { kind: "test_attribute", value: "[data-test=x]", outcome: "not_found" },
          { kind: "role", value: "internal:role=button", outcome: "matched" },
        ],
      }),
    );
    expect(w.find('[data-test="synthetics-run-detail-locator-healed"]').exists()).toBe(true);
  });

  it("does not claim healing when the primary itself matched", () => {
    const w = render(
      detail({
        candidatesTried: [{ kind: "test_attribute", value: "[data-test=x]", outcome: "matched" }],
      }),
    );
    expect(w.find('[data-test="synthetics-run-detail-locator-healed"]').exists()).toBe(false);
  });
});

describe("StepEvidence — settle signals (P5.4 item 4)", () => {
  it("flags a stale signal as the likely real cause", () => {
    const w = render(
      detail({
        settleSignals: [
          {
            kind: "response",
            signal: "response matching **/auth/login",
            status: "stale",
            required: false,
            waitedMs: 30000,
          },
        ],
      }),
    );
    expect(w.find('[data-test="synthetics-run-detail-settle-stale-note"]').exists()).toBe(true);
    expect(w.text()).toContain("**/auth/login");
  });

  it("stays quiet when every signal fired", () => {
    const w = render(
      detail({
        settleSignals: [
          {
            kind: "navigation",
            signal: "navigation to **/web/**",
            status: "fired",
            required: false,
            waitedMs: 800,
          },
        ],
      }),
    );
    expect(w.find('[data-test="synthetics-run-detail-settle-stale-note"]').exists()).toBe(false);
  });
});

describe("StepEvidence — settle timing (P5.4 item 5)", () => {
  it("shows today against recording, and calls out a large regression", () => {
    // Slow-but-healthy separates from broken on this line alone.
    const w = render(detail({ settleMs: 41000, observedDurationMs: 2300 }));
    expect(w.text()).toContain("41.0s");
    expect(w.text()).toContain("2.3s");
    expect(w.find('[data-test="synthetics-run-detail-settle-slower"]').exists()).toBe(true);
  });

  it("does not cry regression when timing is comparable", () => {
    const w = render(detail({ settleMs: 2400, observedDurationMs: 2300 }));
    expect(w.find('[data-test="synthetics-run-detail-settle-slower"]').exists()).toBe(false);
  });

  it("renders nothing for a record that carries no evidence", () => {
    // Backwards compatibility: runs predating the probe change must degrade,
    // not break the view.
    const w = render(detail());
    expect(w.find('[data-test="synthetics-run-detail-locator-resolution"]').exists()).toBe(false);
    expect(w.find('[data-test="synthetics-run-detail-settle-signals"]').exists()).toBe(false);
    expect(w.find('[data-test="synthetics-run-detail-settle-timing"]').exists()).toBe(false);
  });
});

describe("StepEvidence — what the application did (Phase 6)", () => {
  const appEvidence = {
    stepId: "s2",
    consoleErrors: 1,
    pageErrors: 1,
    requestsFailed: 0,
    responsesNon2xx: 3,
    worstResponses: [{ method: "POST", url: "https://x/auth/login", status: 503, count: 3 }],
    firstConsoleErrors: ["[auth] sign-in failed: 503 Service Unavailable"],
  };

  function renderWith(over: Record<string, unknown> = {}) {
    return mount(StepEvidence, {
      props: { detail: detail(), evidence: appEvidence, ...over },
      global: { plugins: [i18n] },
    });
  }

  it("shows the failing response — the thing no field distinguishes today", () => {
    const w = renderWith();
    expect(w.find('[data-test="synthetics-run-detail-app-evidence"]').exists()).toBe(true);
    expect(w.text()).toContain("503");
    expect(w.text()).toContain("/auth/login");
  });

  it("collapses repeats into a count rather than listing them", () => {
    expect(renderWith().text()).toContain("x3");
  });

  it("shows the application's own console error", () => {
    expect(renderWith().text()).toContain("sign-in failed");
  });

  it("stays hidden when the step had nothing to report", () => {
    // A healthy step contributes no rows — sparse by construction, not padded.
    const w = renderWith({
      evidence: {
        ...appEvidence,
        consoleErrors: 0,
        pageErrors: 0,
        requestsFailed: 0,
        responsesNon2xx: 0,
        worstResponses: [],
        firstConsoleErrors: [],
      },
    });
    expect(w.find('[data-test="synthetics-run-detail-app-evidence"]').exists()).toBe(false);
  });

  it("stays hidden on a record that predates evidence capture", () => {
    const w = renderWith({ evidence: null });
    expect(w.find('[data-test="synthetics-run-detail-app-evidence"]').exists()).toBe(false);
  });

  it("reports truncation rather than letting it pass silently", () => {
    // X-8.2 — a capped buffer that drops events without saying so reads as
    // "nothing else happened".
    const w = renderWith({ truncated: true });
    expect(w.find('[data-test="synthetics-run-detail-evidence-truncated"]').exists()).toBe(true);
  });

  it("says nothing about truncation when nothing was dropped", () => {
    expect(
      renderWith({ truncated: false })
        .find('[data-test="synthetics-run-detail-evidence-truncated"]')
        .exists(),
    ).toBe(false);
  });
});
