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

import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import RcaVerdictCard from "./RcaVerdictCard.vue";
import {
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

const EARLIER = "The report below is from the 08:53 run.";

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
    it("M (fresh): re-analyzing text, the earlier-report note, Follow in thread and Cancel", async () => {
      const wrapper = mountCard({
        cardState: "investigating",
        liveMode: "fresh",
        earlierReportNote: EARLIER,
      });

      expect(shownBanners(wrapper)).toEqual(["rca-reanalyzing-banner"]);
      expect(byTest(wrapper, "rca-reanalyzing-message").text()).toBe("Re-analyzing from scratch…");
      expect(byTest(wrapper, "rca-earlier-report-note").text()).toBe(EARLIER);
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
        earlierReportNote: EARLIER,
      });

      expect(byTest(wrapper, "rca-reanalyzing-message").text()).toBe(
        "Building on the previous report…",
      );
    });

    it("L: the reason, the earlier-report note, collapsed details, and Retry with the failed mode first", async () => {
      const wrapper = mountCard({
        cardState: "failed",
        failedMode: "build_on_previous",
        earlierReportNote: EARLIER,
        error: {
          code: "agent_unavailable",
          reason: "Agent unavailable",
          details: "connect ECONNREFUSED 10.0.0.4:8080",
          trigger_type: null,
        },
      });

      expect(shownBanners(wrapper)).toEqual(["rca-error-banner"]);
      expect(byTest(wrapper, "rca-error-reason").text()).toBe("Agent unavailable");
      expect(byTest(wrapper, "rca-earlier-report-note").text()).toBe(EARLIER);
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
        earlierReportNote: EARLIER,
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
        earlierReportNote: EARLIER,
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

    it("no Resume run in Phase 2", () => {
      const wrapper = mountCard({ cardState: "cancelled", cancelledText: "Cancelled." });

      expect(wrapper.text()).not.toContain("Resume");
    });

    // M1 (01 RR-47): the global `p` colour must not override the banner text token.
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
        const wrapper = mountCard({ ...props, earlierReportNote: EARLIER });
        const details = byTest(wrapper, "rca-error-details-toggle");
        if (details.exists()) await details.trigger("click");

        const paragraphs = byTest(wrapper, bannerId).findAll("p");
        expect(paragraphs.length).toBeGreaterThanOrEqual(2);
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

    it("B: 'Root cause identified', band chip High with the reason line, suspect change and impact (VE33, VE35)", async () => {
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummary() });

      expect(text(wrapper, "rca-verdict-state")).toBe("Root cause identified");
      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "checkout-api deploy 4f2c1e exhausted the orders-db connection pool",
      );
      const band = byTest(wrapper, "rca-verdict-band");
      expect(band.attributes("data-band")).toBe("high");
      expect(band.text()).toContain("High");
      expect(text(wrapper, "rca-verdict-band-reason")).toBe(
        "high · decisive: traces + change · ruled out: node CPU",
      );
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
            band_reason: "medium",
          },
        }),
      });

      expect(text(wrapper, "rca-verdict-state")).toBe("Contributing factor");
      expect(text(wrapper, "rca-verdict-below")).toBe("No single root cause confirmed");
      expect(text(wrapper, "rca-verdict-band")).toContain("Medium");
    });

    it("C: Inconclusive, 'Suspected, not confirmed' with the subject statement, band Low, '(diff not read)' (VE17, VE35)", () => {
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummaryInconclusive() });

      expect(text(wrapper, "rca-verdict-state")).toBe("Inconclusive");
      expect(text(wrapper, "rca-verdict-qualifier")).toBe("Suspected, not confirmed");
      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "orders-db connection pool exhaustion after checkout-api deploy 4f2c1e",
      );
      expect(text(wrapper, "rca-verdict-band")).toContain("Low");
      expect(text(wrapper, "rca-verdict-band-reason")).toBe("low · no confirmed cause");
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

    it("suspect change under test and from a steering lead (VE35)", () => {
      const base = rcaRunSummary();
      const wrapper = mountCard({
        cardState: "analyzed",
        summary: rcaRunSummary({
          card: {
            ...base.card,
            suspect_change: {
              ...base.card.suspect_change!,
              shown_state: "under_test",
              lead_author: "a.rao",
            },
          },
        }),
      });

      expect(text(wrapper, "rca-verdict-suspect")).toBe(
        "Deploy 4f2c1e · 08:53 UTC (under test) (from a.rao)",
      );
    });

    it("D: Blocked with 'Needs: Change history' (VE32, VE44)", () => {
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummaryBlocked() });

      expect(text(wrapper, "rca-verdict-state")).toBe("Blocked");
      expect(text(wrapper, "rca-verdict-below")).toBe("Needs: Change history");
      expect(text(wrapper, "rca-verdict-suspect")).toBe("None found");
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

      // VE32 frame E: a stored record reads "Failed"; the headline says it was cancelled.
      expect(text(wrapper, "rca-verdict-state")).toBe("Failed");
      expect(text(wrapper, "rca-verdict-headline")).toBe(
        "Run cancelled before a verdict. Partial results below",
      );
      const band = byTest(wrapper, "rca-verdict-band");
      expect(band.attributes("data-band")).toBe("none");
      expect(band.text()).toBe("No confidence");
      expect(byTest(wrapper, "rca-verdict-band-reason").exists()).toBe(false);
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

    it("no Phase 4/5 controls on a graded card (F2)", () => {
      const wrapper = mountCard({ cardState: "analyzed", summary: rcaRunSummary() });

      for (const label of ["Is this the cause?", "Ask", "Resume", "Disprove"]) {
        expect(wrapper.text()).not.toContain(label);
      }
    });
  });
});
