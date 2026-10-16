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
});
