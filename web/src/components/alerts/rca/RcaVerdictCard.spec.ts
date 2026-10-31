// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import type * as VueRouter from "vue-router";
import type * as Vuex from "vuex";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof VueRouter>()),
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof Vuex>()),
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));

import i18n from "@/locales";
import RcaVerdictCard from "./RcaVerdictCard.vue";
import {
  rcaBlindSpot,
  rcaRunSummary,
  rcaRunSummaryBlocked,
  rcaRunSummaryCancelled,
  rcaRunSummaryInconclusive,
  rcaRunSummaryLegacy,
  rcaRunSummaryLive,
} from "@/test/unit/fixtures/rcaThread";

// ODropdown renders its menu only when open; the stubs render every item in order.
const stubs = {
  ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    emits: ["select"],
    template: "<div role='menuitem' @click=\"$emit('select')\"><slot /></div>",
  },
};

const mountCard = (props: Record<string, unknown>) =>
  mount(RcaVerdictCard, {
    props: { runId: "run-2", ...props },
    global: { plugins: [i18n], stubs },
  });

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

const BANNERS = [
  "rca-stale-banner",
  "rca-reanalyzing-banner",
  "rca-error-banner",
  "rca-cancelled-banner",
];

const shownBanners = (wrapper: VueWrapper) => BANNERS.filter((id) => byTest(wrapper, id).exists());

const buttonTexts = (wrapper: VueWrapper, bannerId: string) =>
  byTest(wrapper, bannerId)
    .findAll("button")
    .map((button) => button.text());

describe("RcaVerdictCard", () => {
  describe("state pill and headline", () => {
    it.each([
      ["investigating", "Investigating", "Investigating"],
      ["analyzed", "Analyzed", "Analysis complete"],
      ["failed", "Failed", "Analysis failed"],
      ["cancelled", "Cancelled", "Analysis cancelled"],
    ])("%s → pill %s, headline %s", (cardState, pill, headline) => {
      const wrapper = mountCard({ cardState });

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe(pill);
      expect(byTest(wrapper, "rca-verdict-headline").text()).toBe(headline);
    });

    it("TH37: shows the stage stepper only while investigating", () => {
      const live = mountCard({ cardState: "investigating", stageIndex: 5 });
      expect(byTest(live, "rca-stage-label").text()).toBe("Stage 5/7 · Log patterns");

      const done = mountCard({ cardState: "analyzed", stageIndex: 7 });
      expect(byTest(done, "rca-stage-stepper").exists()).toBe(false);
    });

    it("a first live run with no earlier report shows no banner", () => {
      const wrapper = mountCard({ cardState: "investigating" });

      expect(shownBanners(wrapper)).toEqual([]);
    });

    it("TH37 / R-D13: no credits on the card", () => {
      const wrapper = mountCard({ cardState: "investigating", stageIndex: 2 });

      expect(wrapper.text().toLowerCase()).not.toContain("credit");
    });
  });

  describe("TH40 banners", () => {
    it("M (fresh): re-analyzing text, Follow in thread and Cancel", async () => {
      const wrapper = mountCard({
        cardState: "investigating",
        liveMode: "fresh",
        hasEarlierReport: true,
      });

      expect(shownBanners(wrapper)).toEqual(["rca-reanalyzing-banner"]);
      expect(byTest(wrapper, "rca-reanalyzing-message").text()).toBe("Re-analyzing from scratch…");
      expect(buttonTexts(wrapper, "rca-reanalyzing-banner")).toEqual([
        "Follow in thread",
        "Cancel",
      ]);

      await byTest(wrapper, "rca-follow-thread-btn").trigger("click");
      await byTest(wrapper, "rca-banner-cancel-btn").trigger("click");
      expect(wrapper.emitted("follow-thread")).toHaveLength(1);
      expect(wrapper.emitted("cancel")).toHaveLength(1);
    });

    it("M (build_on_previous): building text", () => {
      const wrapper = mountCard({
        cardState: "investigating",
        liveMode: "build_on_previous",
        hasEarlierReport: true,
      });

      expect(byTest(wrapper, "rca-reanalyzing-message").text()).toBe(
        "Building on the previous report…",
      );
    });

    it.each([
      ["after an analyzed run", true],
      ["after a run that never finished", false],
    ])("M (resumed %s): names the step the run resumed from", (_label, hasEarlierReport) => {
      const wrapper = mountCard({
        cardState: "investigating",
        liveMode: "fresh",
        liveResumeStep: "Await flag change actor",
        hasEarlierReport,
      });

      expect(shownBanners(wrapper)).toEqual(["rca-reanalyzing-banner"]);
      expect(byTest(wrapper, "rca-reanalyzing-message").text()).toBe(
        "Resuming from “Await flag change actor”…",
      );
    });

    it("L: the reason, collapsed details, and Retry with the failed mode first", async () => {
      const wrapper = mountCard({
        cardState: "failed",
        failedMode: "build_on_previous",
        hasEarlierReport: true,
        error: {
          code: "agent_unavailable",
          reason: "Agent unavailable",
          details: "connect ECONNREFUSED 10.0.0.4:8080",
          trigger_type: null,
        },
      });

      expect(shownBanners(wrapper)).toEqual(["rca-error-banner"]);
      expect(byTest(wrapper, "rca-error-reason").text()).toBe("Agent unavailable");
      expect(byTest(wrapper, "rca-error-details").exists()).toBe(false);
      const menu = wrapper.findAll('[role="menuitem"]');
      expect(menu.map((item) => item.attributes("data-test"))).toEqual([
        "rca-retry-build",
        "rca-retry-fresh",
      ]);
      expect(menu.map((item) => item.text())).toEqual([
        "Build on previous report",
        "Fresh analysis",
      ]);
      expect(byTest(wrapper, "rca-retry-btn").text()).toBe("Retry analysis");

      await byTest(wrapper, "rca-error-details-toggle").trigger("click");
      expect(byTest(wrapper, "rca-error-details").text()).toContain("ECONNREFUSED");

      await byTest(wrapper, "rca-retry-build").trigger("click");
      await byTest(wrapper, "rca-retry-fresh").trigger("click");
      expect(wrapper.emitted("retry")).toEqual([
        [{ buildOnPrevious: true }],
        [{ buildOnPrevious: false }],
      ]);
    });

    it("L: a fresh failed run lists Fresh analysis first", () => {
      const wrapper = mountCard({
        cardState: "failed",
        failedMode: "fresh",
        hasEarlierReport: true,
        error: { code: "timeout", reason: "Timed out", details: null, trigger_type: null },
      });

      expect(
        wrapper.findAll('[role="menuitem"]').map((item) => item.attributes("data-test")),
      ).toEqual(["rca-retry-fresh", "rca-retry-build"]);
      expect(byTest(wrapper, "rca-error-details-toggle").exists()).toBe(false);
    });

    it("L without an earlier report: a plain Retry for a fresh run", async () => {
      const wrapper = mountCard({ cardState: "failed", error: null });

      expect(byTest(wrapper, "rca-error-reason").text()).toBe("AI analysis failed");
      expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(0);
      await byTest(wrapper, "rca-retry-btn").trigger("click");
      expect(wrapper.emitted("retry")).toEqual([[{ buildOnPrevious: false }]]);
    });

    it("L: details collapse again for a new failed run", async () => {
      const error = { code: "x", reason: "Boom", details: "trace", trigger_type: null };
      const wrapper = mountCard({ cardState: "failed", error });
      await byTest(wrapper, "rca-error-details-toggle").trigger("click");
      expect(byTest(wrapper, "rca-error-details").exists()).toBe(true);

      await wrapper.setProps({ runId: "run-3" });

      expect(byTest(wrapper, "rca-error-details").exists()).toBe(false);
    });

    it("N: the stale warning with its time and Cancel run", async () => {
      const wrapper = mountCard({
        cardState: "investigating",
        stale: true,
        staleSince: "14:07:04",
        hasEarlierReport: true,
      });

      expect(shownBanners(wrapper)).toEqual(["rca-stale-banner"]);
      expect(byTest(wrapper, "rca-stale-message").text()).toBe(
        "This analysis has been running unusually long and may have stopped. No new messages since 14:07:04 UTC. Cancel it and try again.",
      );
      expect(buttonTexts(wrapper, "rca-stale-banner")).toEqual(["Cancel run"]);
      await byTest(wrapper, "rca-stale-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel")).toHaveLength(1);
    });

    it("E: the cancelled message and no buttons", () => {
      const message =
        "Cancelled by a.rao at 08:56:20 UTC after 1m00s. 2 of 3 checks finished; the partial results below are not a verdict.";
      const wrapper = mountCard({ cardState: "cancelled", cancelledText: message });

      expect(shownBanners(wrapper)).toEqual(["rca-cancelled-banner"]);
      expect(byTest(wrapper, "rca-cancelled-message").text()).toBe(message);
      expect(buttonTexts(wrapper, "rca-cancelled-banner")).toEqual([]);
    });

    describe("J9: Resume run on L and E", () => {
      const FAILED = {
        cardState: "failed",
        error: { code: "timeout", reason: "Timed out", details: null, trigger_type: null },
      };
      const CANCELLED = { cardState: "cancelled", cancelledText: "Cancelled." };

      it.each([
        ["L", "rca-error-banner", FAILED],
        ["E", "rca-cancelled-banner", CANCELLED],
      ])("%s offers Resume run with canResume and emits resume", async (_f, bannerId, props) => {
        const wrapper = mountCard({ ...props, canResume: true });

        const button = byTest(wrapper, bannerId).find('[data-test="rca-resume-btn"]');
        expect(button.text()).toBe("Resume run");
        await button.trigger("click");
        expect(wrapper.emitted("resume")).toHaveLength(1);
      });

      it.each([
        ["L", FAILED],
        ["E", CANCELLED],
      ])("%s without canResume has no Resume run", (_f, props) => {
        const wrapper = mountCard(props);

        expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
        expect(wrapper.text()).not.toContain("Resume");
      });

      it("L: Retry stays next to Resume run", () => {
        const wrapper = mountCard({ ...FAILED, canResume: true });

        expect(buttonTexts(wrapper, "rca-error-banner")).toEqual(["Resume run", "Retry analysis"]);
      });

      it.each([
        ["a live run", { cardState: "investigating", liveMode: "fresh", hasEarlierReport: true }],
        ["a stale run", { cardState: "investigating", stale: true, staleSince: "14:07:04" }],
        ["an analyzed run", { cardState: "analyzed", summary: rcaRunSummary() }],
      ])("never on %s, even with canResume", (_label, props) => {
        const wrapper = mountCard({ ...props, canResume: true });

        expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
      });

      it("while a trigger is in flight Resume is disabled; while resuming Retry is disabled", async () => {
        const triggering = mountCard({ ...FAILED, canResume: true, triggering: true });
        const resumeBtn = byTest(triggering, "rca-resume-btn");
        expect(resumeBtn.attributes("disabled")).toBeDefined();
        await resumeBtn.trigger("click");
        expect(triggering.emitted("resume")).toBeUndefined();

        const resuming = mountCard({ ...FAILED, canResume: true, resuming: true });
        const retry = byTest(resuming, "rca-retry-btn");
        expect(retry.attributes("disabled")).toBeDefined();
        await retry.trigger("click");
        expect(resuming.emitted("retry")).toBeUndefined();
      });

      it("E: Resume is disabled while a trigger is in flight", async () => {
        const wrapper = mountCard({ ...CANCELLED, canResume: true, triggering: true });
        const button = byTest(wrapper, "rca-resume-btn");

        expect(button.attributes("disabled")).toBeDefined();
        await button.trigger("click");
        expect(wrapper.emitted("resume")).toBeUndefined();
      });
    });

    // The global `p` colour must not override the banner text token.
    it.each([
      [
        "N",
        "rca-stale-banner",
        "text-banner-warning-text",
        { cardState: "investigating", stale: true, staleSince: "14:07:04" },
      ],
      ["M", "rca-reanalyzing-banner", "text-banner-info-text", { cardState: "investigating" }],
      [
        "L",
        "rca-error-banner",
        "text-banner-error-soft-text",
        {
          cardState: "failed",
          error: { code: "x", reason: "Boom", details: "trace", trigger_type: null },
        },
      ],
      [
        "E",
        "rca-cancelled-banner",
        "text-banner-error-soft-text",
        { cardState: "cancelled", cancelledText: "Cancelled." },
      ],
    ])(
      "%s: every banner paragraph carries %s's text token",
      async (_frame, bannerId, token, props) => {
        const wrapper = mountCard({ ...props, hasEarlierReport: true });
        const details = byTest(wrapper, "rca-error-details-toggle");
        if (details.exists()) await details.trigger("click");

        const paragraphs = byTest(wrapper, bannerId).findAll("p");
        expect(paragraphs.length).toBeGreaterThanOrEqual(1);
        for (const p of paragraphs) expect(p.classes()).toContain(token);
      },
    );

    it("L: the details toggle controls the details element", async () => {
      const wrapper = mountCard({
        cardState: "failed",
        error: { code: "x", reason: "Boom", details: "trace", trigger_type: null },
      });
      const toggle = byTest(wrapper, "rca-error-details-toggle");
      await toggle.trigger("click");

      expect(
        wrapper.find(`[id="${toggle.attributes("aria-controls")}"]`).attributes("data-test"),
      ).toBe("rca-error-details");
    });
  });

  describe("Phase 3 card (03 VE17–VE22, VE32–VE35; F2)", () => {
    const text = (wrapper: VueWrapper, id: string) => byTest(wrapper, id).text();

    it("A live: Leading headline, Verdict so far, and no band, suspect change or impact (VE21, VE22, VE-D2)", () => {
      const base = rcaRunSummaryLive();
      const wrapper = mountCard({
        cardState: "investigating",
        stageIndex: 3,
        summary: rcaRunSummaryLive({
          card: { ...base.card, verdict_so_far: { label: "preliminary" } },
        }),
      });

      expect(text(wrapper, "rca-verdict-state")).toBe("Investigating");
      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "Leading: Deploy 4f2c1e exhausted the orders-db pool",
      );
      expect(text(wrapper, "rca-verdict-qualifier")).toBe("Verdict so far: Preliminary");
      expect(byTest(wrapper, "rca-verdict-confidence").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-facts").exists()).toBe(false);
      expect(byTest(wrapper, "rca-stage-stepper").exists()).toBe(true);
      expect(wrapper.text().toLowerCase()).not.toContain("credit");
    });

    it("F revised: 'Verdict so far: Revised · was “…”'", () => {
      const wrapper = mountCard({ cardState: "investigating", summary: rcaRunSummaryLive() });

      expect(text(wrapper, "rca-verdict-qualifier")).toBe(
        "Verdict so far: Revised · was “Pool too small for the load after deploy 4f2c1e”",
      );
    });

    it("live with no leading hypothesis: 'No leading hypothesis yet' and no label", () => {
      const base = rcaRunSummaryLive();
      const wrapper = mountCard({
        cardState: "investigating",
        summary: rcaRunSummaryLive({
          card: { ...base.card, leading: undefined, verdict_so_far: undefined },
        }),
      });

      expect(text(wrapper, "rca-verdict-headline")).toBe("No leading hypothesis yet");
      expect(byTest(wrapper, "rca-verdict-qualifier").exists()).toBe(false);
    });

    it("waiting_input: the pill 'Blocked · waiting for an answer' and the leading headline (VE22)", () => {
      const wrapper = mountCard({
        cardState: "investigating",
        waitingInput: true,
        summary: rcaRunSummaryLive(),
      });

      expect(text(wrapper, "rca-verdict-state")).toBe("Blocked · waiting for an answer");
      expect(text(wrapper, "rca-verdict-headline")).toContain("Leading: ");
      expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
    });

    it("B: 'Root cause identified', band chip High with what the agent claimed and what the evidence allows, suspect change and impact (VE33, VE35)", async () => {
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummary() });

      expect(text(wrapper, "rca-verdict-state")).toBe("Root cause identified");
      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "checkout-api deploy 4f2c1e exhausted the orders-db connection pool",
      );
      const band = byTest(wrapper, "rca-verdict-band");
      expect(band.attributes("data-band")).toBe("high");
      expect(band.text()).toContain("High");
      expect(text(wrapper, "rca-confidence-claimed")).toBe("High");
      expect(text(wrapper, "rca-confidence-evidence")).toBe(
        "High · 2 decisive sources (traces + change), 1 alternative ruled out",
      );
      expect(byTest(wrapper, "rca-confidence-caps").exists()).toBe(false);
      expect(text(wrapper, "rca-verdict-unverified-count")).toBe("1 citation not verified");
      expect(text(wrapper, "rca-verdict-blind-link")).toBe("2 blind spots below");
      expect(text(wrapper, "rca-verdict-suspect")).toBe("Deploy 4f2c1e · 08:53 UTC");
      expect(text(wrapper, "rca-verdict-impact")).toBe(
        "3 services · peak 4.1% 5xx · 08:55:20–09:22:20 UTC",
      );
      expect(byTest(wrapper, "rca-verdict-qualifier").exists()).toBe(false);
      expect(byTest(wrapper, "rca-stage-stepper").exists()).toBe(false);

      // The band chip opens "Cited but not verified"; the blind-spot link scrolls to them.
      await band.trigger("click");
      await byTest(wrapper, "rca-verdict-blind-link").trigger("click");
      expect(wrapper.emitted("show-unverified")).toHaveLength(1);
      expect(wrapper.emitted("show-blind-spots")).toHaveLength(1);
    });

    it("B: shows the stored impacted services; proposed actions have their own section", () => {
      const verdictDetails = {
        impactedServices: ["service=checkout-api", "service=orders-db"],
        proposedActions: [{ title: "Roll back 4f2c1e", kind: "rollback", detail: "" }],
      };
      const wrapper = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummary(),
        verdictDetails,
      });

      expect(text(wrapper, "rca-verdict-services")).toBe("service=checkout-api, service=orders-db");
      expect(wrapper.text()).not.toContain("Roll back 4f2c1e");
    });

    it("a run that is not graded shows no services", () => {
      const verdictDetails = {
        impactedServices: ["service=checkout-api"],
        proposedActions: [{ title: "Roll back", kind: "rollback", detail: "" }],
      };
      const wrapper = mountCard({
        cardState: "cancelled",
        summary: rcaRunSummaryCancelled(),
        verdictDetails,
      });

      expect(byTest(wrapper, "rca-verdict-services").exists()).toBe(false);
    });

    it("the breakdown names the caps that lowered the band and what the next level needs (CG §5.3.4)", async () => {
      const base = rcaRunSummary();
      const withConfidence = (confidence: NonNullable<typeof base.card.confidence>) =>
        mountCard({
          cardState: "analyzed",
          summary: rcaRunSummary({ card: { ...base.card, band: "medium", confidence } }),
        });

      const capped = withConfidence({
        claimed: "high",
        evidence: "high",
        evidence_reason: "2 decisive sources (logs + traces), 1 alternative ruled out",
        caps: ["change history not reachable"],
      });
      expect(capped.find('[data-test="rca-verdict-confidence-why"]').text()).toMatch(
        /Capped to Medium\s*change history not reachable$/,
      );

      const limited = withConfidence({
        claimed: "high",
        evidence: "medium",
        evidence_reason: "1 decisive source (logs)",
        next_level: "High needs a second decisive source and a ruled-out alternative",
        caps: [],
      });
      expect(text(limited, "rca-confidence-evidence")).toBe(
        "Medium · 1 decisive source (logs) · High needs a second decisive source and a ruled-out alternative",
      );
      expect(byTest(limited, "rca-confidence-caps").exists()).toBe(false);
    });

    it("a band chip with no unverified citations is not a button", () => {
      const wrapper = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummary({ unverified: [] }),
      });

      expect(byTest(wrapper, "rca-verdict-band").element.tagName).toBe("SPAN");
      expect(byTest(wrapper, "rca-verdict-unverified-count").exists()).toBe(false);
    });

    it("contributing factor: the pill and 'No single root cause confirmed' (VE32)", () => {
      const base = rcaRunSummary();
      const wrapper = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummary({
          card: {
            ...base.card,
            outcome: "contributing_factor",
            band: "medium",
          },
        }),
      });

      expect(text(wrapper, "rca-verdict-state")).toBe("Contributing factor");
      expect(text(wrapper, "rca-verdict-below")).toBe("No single root cause confirmed");
      expect(text(wrapper, "rca-verdict-band")).toContain("Medium");
    });

    it("multiple root causes: the verdict sentence heads the card and each cause shows its onset and band", () => {
      const base = rcaRunSummary();
      const card = {
        ...base.card,
        outcome: "multiple_root_causes" as const,
        outcome_reason: "root_causes_graded" as const,
        headline: "Pool exhaustion and a cache eviction storm",
        band: "medium" as const,
        causes: [
          {
            id: "h1",
            statement: "orders-db pool exhausted",
            // 2025-10-09T09:00:20Z.
            onset_us: 1_760_000_420_000_000,
            band: "high" as const,
          },
          { id: "h2", statement: "cache eviction storm", band: "medium" as const },
        ],
      };
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummary({ card }) });

      expect(text(wrapper, "rca-verdict-state")).toBe("Multiple root causes");
      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "Pool exhaustion and a cache eviction storm",
      );
      expect(byTest(wrapper, "rca-verdict-qualifier").exists()).toBe(false);
      const causes = wrapper.findAll('[data-test="rca-verdict-cause"]');
      expect(causes.map((c) => c.text().replace(/\s+/g, " "))).toEqual([
        "orders-db pool exhausted · from 09:00 UTC · High confidence",
        "cache eviction storm · Medium confidence",
      ]);

      // Another outcome never lists causes.
      const single = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummary({ card: { ...card, outcome: "root_cause_identified" } }),
      });
      expect(byTest(single, "rca-verdict-causes").exists()).toBe(false);
    });

    it("agent inline code shows as code, never as backticks, in the headline, causes and impact", () => {
      const base = rcaRunSummary().card;
      const card = {
        ...base,
        outcome: "multiple_root_causes" as const,
        headline: "The `adFailure` flag was toggled on",
        causes: [
          { id: "h1", statement: "frontend `GET /api/data` failed", band: "medium" as const },
        ],
        impact: { ...base.impact!, summary: "`frontend` 5xx" },
      };
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummary({ card }) });

      const headline = byTest(wrapper, "rca-verdict-headline");
      expect(headline.text()).toBe("The adFailure flag was toggled on");
      expect(headline.find("code").text()).toBe("adFailure");
      const cause = byTest(wrapper, "rca-verdict-cause");
      expect(cause.text()).not.toContain("`");
      expect(cause.find("code").text()).toBe("GET /api/data");
      expect(byTest(wrapper, "rca-verdict-impact").find("code").text()).toBe("frontend");
    });

    it("C: Inconclusive, 'Suspected, not confirmed' with the subject statement, band Low, '(diff not read)' (VE17, VE35)", () => {
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummaryInconclusive() });

      expect(text(wrapper, "rca-verdict-state")).toBe("Inconclusive");
      expect(text(wrapper, "rca-verdict-qualifier")).toBe("Suspected, not confirmed");
      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "orders-db connection pool exhaustion after checkout-api deploy 4f2c1e",
      );
      expect(text(wrapper, "rca-verdict-band")).toContain("Low");
      expect(text(wrapper, "rca-confidence-claimed")).toBe("Medium");
      expect(text(wrapper, "rca-confidence-evidence")).toBe("Low · no confirmed cause");
      expect(text(wrapper, "rca-verdict-suspect")).toBe(
        "Deploy 4f2c1e · 08:53 UTC (diff not read)",
      );
    });

    it("C with no subject: 'No hypothesis recorded' and no qualifier (VE17)", () => {
      const base = rcaRunSummaryInconclusive();
      const wrapper = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummaryInconclusive({ card: { ...base.card, headline: undefined } }),
      });

      expect(text(wrapper, "rca-verdict-headline")).toBe("No hypothesis recorded");
      expect(byTest(wrapper, "rca-verdict-qualifier").exists()).toBe(false);
    });

    it("suspect change from a steering lead (VE35)", () => {
      const base = rcaRunSummary();
      const wrapper = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummary({
          card: {
            ...base.card,
            suspect_change: {
              ...base.card.suspect_change!,
              shown_state: "confirmed",
              lead_author: "a.rao",
            },
          },
        }),
      });

      expect(text(wrapper, "rca-verdict-suspect")).toBe("Deploy 4f2c1e · 08:53 UTC (from a.rao)");
    });

    it("D: Blocked with 'Needs: Change history'; no suspect change hides its row (VE32, VE44)", () => {
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummaryBlocked() });

      expect(text(wrapper, "rca-verdict-state")).toBe("Blocked");
      expect(text(wrapper, "rca-verdict-below")).toBe("Needs: Change history");
      expect(byTest(wrapper, "rca-verdict-suspect").exists()).toBe(false);
    });

    it("D without a need: 'Needs input' (VE32)", () => {
      const card = { ...rcaRunSummaryBlocked().card, needs: undefined };
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummaryBlocked({ card }) });

      expect(text(wrapper, "rca-verdict-state")).toBe("Blocked");
      expect(text(wrapper, "rca-verdict-below")).toBe("Needs input");
    });

    it("E: 'Run cancelled before a verdict. Partial results below', No confidence, no facts (VE16, VE32, VE34)", () => {
      const wrapper = mountCard({
        cardState: "cancelled",
        cancelledText: "Cancelled.",
        summary: rcaRunSummaryCancelled(),
      });

      expect(text(wrapper, "rca-verdict-state")).toBe("Cancelled");
      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "Run cancelled before a verdict. Partial results below",
      );
      const band = byTest(wrapper, "rca-verdict-band");
      expect(band.attributes("data-band")).toBe("none");
      expect(band.text()).toBe("No confidence");
      expect(byTest(wrapper, "rca-verdict-confidence-why").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-facts").exists()).toBe(false);
      expect(text(wrapper, "rca-verdict-blind-link")).toBe("1 blind spot below");
      expect(shownBanners(wrapper)).toEqual(["rca-cancelled-banner"]);
    });

    it("a recordless cancelled run keeps the Phase 2 'Cancelled' pill", () => {
      const wrapper = mountCard({
        cardState: "cancelled",
        cancelledText: "Cancelled.",
        summary: null,
      });

      expect(text(wrapper, "rca-verdict-state")).toBe("Cancelled");
      expect(text(wrapper, "rca-verdict-headline")).toBe("Analysis cancelled");
    });

    it("failed with a partial record: 'Run failed before a verdict. Partial results below'", () => {
      const wrapper = mountCard({
        cardState: "failed",
        summary: rcaRunSummaryCancelled({ state: "failed" }),
      });

      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "Run failed before a verdict. Partial results below",
      );
      expect(text(wrapper, "rca-verdict-band")).toBe("No confidence");
    });

    it("legacy and outcome-null completed runs keep the Phase 2 card: 'Analyzed', no band (VE42)", () => {
      const base = rcaRunSummary();
      for (const summary of [
        null,
        rcaRunSummaryLegacy(),
        rcaRunSummary({ card: { ...base.card, outcome: undefined, outcome_reason: undefined } }),
      ]) {
        const wrapper = mountCard({ cardState: "analyzed", summary });

        expect(text(wrapper, "rca-verdict-state")).toBe("Analyzed");
        expect(text(wrapper, "rca-verdict-headline")).toBe("Analysis complete");
        expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
        expect(byTest(wrapper, "rca-verdict-facts").exists()).toBe(false);
      }
    });

    it("no Ask or Disprove on the card; Resume only with canResume (F2)", () => {
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummary() });

      for (const label of ["Ask", "Resume", "Disprove"]) {
        expect(wrapper.text()).not.toContain(label);
      }
    });
  });

  describe("04 SG39: paused banner (frame D) and unblocked line (frame G)", () => {
    const text = (wrapper: VueWrapper, id: string) => byTest(wrapper, id).text();
    const PAUSED = {
      cardState: "investigating",
      waitingInput: true,
      summary: rcaRunSummaryLive(),
      pausedStep: "Check recent deploys",
      pausedQuestion: "Which change went out to checkout-api around 14:02?",
      deadlineText: "14:40",
    };

    it("frame D: 'Paused after …', the question and the deadline", () => {
      const wrapper = mountCard(PAUSED);

      expect(text(wrapper, "rca-paused-title")).toBe("Paused after “Check recent deploys”");
      expect(text(wrapper, "rca-paused-question")).toBe(
        "Which change went out to checkout-api around 14:02?",
      );
      expect(text(wrapper, "rca-paused-deadline")).toBe(
        "The agent waits until 14:40 for an answer, then closes the run as Blocked.",
      );
    });

    it("frame D without a step or deadline uses the plain strings", () => {
      const wrapper = mountCard({ ...PAUSED, pausedStep: null, deadlineText: null });

      expect(text(wrapper, "rca-paused-title")).toBe("Paused for an answer");
      expect(text(wrapper, "rca-paused-deadline")).toBe(
        "The agent waits for an answer, then closes the run as Blocked.",
      );
    });

    it("'Tell the agent' shows with can_steer and emits tell-agent", async () => {
      const reader = mountCard(PAUSED);
      expect(byTest(reader, "rca-paused-tell-agent-btn").exists()).toBe(false);

      const steerer = mountCard({ ...PAUSED, canSteer: true });
      await byTest(steerer, "rca-paused-tell-agent-btn").trigger("click");
      expect(steerer.emitted("tell-agent")).toHaveLength(1);
    });

    it("'Connect AI Toolset' shows only when a blind spot asks for it", () => {
      const withSpot = mountCard({
        ...PAUSED,
        summary: rcaRunSummaryLive({ blind_spots: [rcaBlindSpot()] }),
      });
      expect(byTest(withSpot, "rca-paused-connect-btn").text()).toBe("Connect AI Toolset");

      const without = mountCard({ ...PAUSED, summary: rcaRunSummaryLive({ blind_spots: [] }) });
      expect(byTest(without, "rca-paused-connect-btn").exists()).toBe(false);
    });

    it("no paused banner while running", () => {
      const wrapper = mountCard({ ...PAUSED, waitingInput: false });
      expect(byTest(wrapper, "rca-paused-banner").exists()).toBe(false);
    });

    it("frame G: 'Unblocked by <author> at <time>'", () => {
      const plain = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummary(),
        unblocked: { author: "a.rao", time: "14:13", need: null },
      });
      expect(text(plain, "rca-verdict-unblocked")).toBe("Unblocked by a.rao at 14:13");

      const withNeed = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummary(),
        unblocked: { author: "a.rao", time: "14:13", need: "change history" },
      });
      expect(text(withNeed, "rca-verdict-unblocked")).toBe(
        "Unblocked by a.rao at 14:13 · change history from a human lead",
      );
    });
  });

  describe("blocked: the server refused to start a run", () => {
    const refusal = (
      remedy: "plans" | "contact" | null,
      retry: unknown = { buildOnPrevious: true },
    ) => ({
      reason: "Your organization has used all of its AI credits.",
      remedy,
      retry,
    });

    it("replaces the run's banner and leads with Plans, then Retry", () => {
      const wrapper = mountCard({ cardState: "failed", refusal: refusal("plans") });

      expect(byTest(wrapper, "rca-blocked-banner").exists()).toBe(true);
      expect(shownBanners(wrapper)).toEqual([]);
      expect(byTest(wrapper, "rca-blocked-reason").text()).toBe(
        "Your organization has used all of its AI credits.",
      );
      expect(buttonTexts(wrapper, "rca-blocked-banner")).toEqual(["Plans", "Retry analysis"]);
    });

    it("Plans opens the plans page of the org", async () => {
      const wrapper = mountCard({ cardState: "analyzed", refusal: refusal("plans") });

      await byTest(wrapper, "rca-plans-btn").trigger("click");

      expect(pushMock).toHaveBeenCalledWith({
        name: "plans",
        query: { org_identifier: "acme" },
      });
    });

    it("a contract org gets Contact sales instead of Plans", () => {
      const wrapper = mountCard({ cardState: "analyzed", refusal: refusal("contact") });

      expect(byTest(wrapper, "rca-contact-btn").exists()).toBe(true);
      expect(byTest(wrapper, "rca-plans-btn").exists()).toBe(false);
    });

    it("with no page to open, only Retry shows", () => {
      const wrapper = mountCard({ cardState: "analyzed", refusal: refusal(null) });

      expect(buttonTexts(wrapper, "rca-blocked-banner")).toEqual(["Retry analysis"]);
    });

    it("Retry resends the refused trigger's options", async () => {
      const options = { buildOnPrevious: true, guidance: "Check the pool" };
      const wrapper = mountCard({ cardState: "analyzed", refusal: refusal("plans", options) });

      await byTest(wrapper, "rca-blocked-retry-btn").trigger("click");

      expect(wrapper.emitted("retry")).toEqual([[options]]);
    });

    it("Retry of a refused resume resumes again", async () => {
      const wrapper = mountCard({ cardState: "failed", refusal: refusal("plans", null) });

      await byTest(wrapper, "rca-blocked-retry-btn").trigger("click");

      expect(wrapper.emitted("resume")).toHaveLength(1);
      expect(wrapper.emitted("retry")).toBeUndefined();
    });
  });

  it("the retry modes carry the re-analysis cost only when it is known", () => {
    const failed = { cardState: "failed", hasEarlierReport: true };
    const costed = mountCard({ ...failed, reanalyzeCreditCost: 5 });
    expect(byTest(costed, "rca-retry-fresh").attributes("description")).toBe("Uses 5 AI credits");

    const unknown = mountCard(failed);
    expect(byTest(unknown, "rca-retry-fresh").attributes("description")).toBeUndefined();
  });
});
