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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import RcaVerdictSummary from "./RcaVerdictSummary.vue";
import { RCA_T0, rcaHypothesis, rcaRunSummary, sec } from "@/test/unit/fixtures/rcaThread";

// The popovers render their body inline so the text can be read.
const stubs = { OPopover: { template: "<div><slot name='trigger' /><slot /></div>" } };

const ACTIONS = [
  { title: "Restrict admin-port security groups", kind: "other" as const, detail: "a" },
  { title: "Check admin logins", kind: "other" as const, detail: "b" },
  { title: "Re-tune the rule", kind: "other" as const, detail: "c" },
];

const mountSummary = (props: Record<string, unknown> = {}) =>
  mount(RcaVerdictSummary, {
    props: {
      summary: rcaRunSummary(),
      timezone: "UTC",
      ...props,
    },
    global: { plugins: [i18n], stubs },
  });

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);
const fact = (wrapper: VueWrapper, id: string) => byTest(wrapper, `rca-fact-${id}`);

describe("RcaVerdictSummary", () => {
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  });

  describe("verdict chips", () => {
    it("an open Likely finding is an amber chip that jumps to its hypothesis", async () => {
      const summary = rcaRunSummary({
        hypotheses: [
          rcaHypothesis(),
          rcaHypothesis({ id: "h9", statement: "Admin ports exposed", status: "likely" }),
        ],
      });
      const wrapper = mountSummary({ summary });
      const chip = byTest(wrapper, "rca-verdict-open-finding");

      expect(chip.text()).toBe("1 open finding · Likely");
      await chip.trigger("click");
      expect(wrapper.emitted("open-hypothesis")).toEqual([["h9"]]);
      expect(byTest(mountSummary(), "rca-verdict-open-finding").exists()).toBe(false);
    });

    it.each([
      ["page", "Page", "warn"],
      ["downgrade", "Downgrade", "neutral"],
    ] as const)("the agent's %s advice is a chip with its reason", (action, label, tone) => {
      const wrapper = mountSummary({
        verdictDetails: {
          impactedServices: [],
          proposedActions: [],
          pageRecommendation: { action, reason: "Exposure needs review." },
        },
      });
      const chip = byTest(wrapper, "rca-verdict-page");
      expect(chip.text()).toContain("Agent suggests");
      expect(chip.find('[data-test="rca-verdict-page-action"]').text()).toBe(label);
      expect(chip.find('[data-test="rca-verdict-page-action"]').attributes("data-tone")).toBe(tone);
      expect(byTest(wrapper, "rca-verdict-page-why").text()).toContain("Exposure needs review.");
    });

    it("no paging advice, no chip", () => {
      expect(byTest(mountSummary(), "rca-verdict-page").exists()).toBe(false);
    });
  });

  describe("AI sentence", () => {
    it("is cut at two lines with Show more when it does not fit", async () => {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get: () => 80,
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get: () => 48,
      });
      const wrapper = mountSummary();
      await flushPromises();

      const more = byTest(wrapper, "rca-verdict-headline-toggle");
      expect(more.text()).toBe("Show more");
      await more.trigger("click");
      expect(more.text()).toBe("Show less");
    });

    it("has no toggle when it fits", async () => {
      const wrapper = mountSummary();
      await flushPromises();
      expect(byTest(wrapper, "rca-verdict-headline-toggle").exists()).toBe(false);
    });
  });

  describe("facts", () => {
    it("Impact reads the report's Customer Impact row, with the peak below", () => {
      const wrapper = mountSummary({
        reportText: "- **Customer Impact**: None — no outage.",
      });
      expect(fact(wrapper, "impact").find('[data-test="rca-fact-value"]').text()).toBe(
        "Customer impact: None",
      );
      expect(fact(wrapper, "impact").text()).toContain("Peak 4.1% 5xx");
    });

    it("Impact names the services when the run lists them, else says none was recorded", () => {
      const services = mountSummary({
        verdictDetails: { impactedServices: ["a", "b", "c", "d"], proposedActions: [] },
      });
      expect(fact(services, "impact").find('[data-test="rca-fact-value"]').text()).toBe(
        "a, b and 2 more",
      );

      const summary = rcaRunSummary();
      delete summary.card.impact;
      expect(
        fact(mountSummary({ summary }), "impact").find('[data-test="rca-fact-value"]').text(),
      ).toBe("No service impact recorded");
    });

    it("In this incident counts this incident's firings and alerts, first to last", () => {
      const wrapper = mountSummary({
        timezone: "Asia/Kolkata",
        firingScope: { firings: 2, alerts: 2, firstAt: RCA_T0, lastAt: RCA_T0 + sec(1_200) },
      });
      expect(fact(wrapper, "incident").find('[data-test="rca-fact-value"]').text()).toBe(
        "2 firings · 2 alerts",
      );
      expect(fact(wrapper, "incident").text()).toContain("14:23 to 14:43 GMT+5:30");

      const once = mountSummary({
        firingScope: { firings: 1, alerts: 1, firstAt: RCA_T0, lastAt: RCA_T0 },
      });
      expect(fact(once, "incident").find('[data-test="rca-fact-value"]').text()).toBe("Fired once");
      expect(fact(once, "incident").text()).toContain("08:53 UTC");
    });

    it.each([
      [
        { firing: 2, quiet: 0, unknown: 0, total: 2, lastFiring: RCA_T0 },
        "2 of 2 alerts firing now",
      ],
      [{ firing: 0, quiet: 3, unknown: 0, total: 3 }, "Quiet now"],
      [{ firing: 0, quiet: 1, unknown: 1, total: 2 }, "1 of 2 alerts quiet now"],
      [{ firing: 0, quiet: 0, unknown: 2, total: 2 }, "—"],
      [null, "—"],
    ])("Alerts now reads like the header chip, a dash when unknown: %o", (alertsNow, words) => {
      const now = fact(mountSummary({ alertsNow }), "now");
      expect(now.find('[data-test="rca-fact-value"]').text()).toBe(words);
      expect(/Last firing .+ ago/.test(now.text())).toBe(!!alertsNow?.lastFiring);
    });

    it("First action names the first proposed action and how many follow", () => {
      const many = mountSummary({
        verdictDetails: { impactedServices: [], proposedActions: ACTIONS },
      });
      expect(fact(many, "action").find('[data-test="rca-fact-value"]').text()).toBe(
        "Restrict admin-port security groups",
      );
      expect(fact(many, "action").text()).toContain("and 2 more below");

      const one = mountSummary({
        verdictDetails: { impactedServices: [], proposedActions: ACTIONS.slice(0, 1) },
      });
      expect(fact(one, "action").text()).toContain("Suggestion only");
      expect(fact(mountSummary(), "action").exists()).toBe(false);
    });

    it("Blind spots shows the count and the first title, and jumps to the list", async () => {
      const wrapper = mountSummary();
      expect(fact(wrapper, "blind").find('[data-test="rca-fact-value"]').text()).toBe("2");
      expect(fact(wrapper, "blind").text()).toContain("Feature-flag history");
      await fact(wrapper, "blind").find("button").trigger("click");
      expect(wrapper.emitted("show-blind-spots")).toHaveLength(1);

      const none = mountSummary({ summary: rcaRunSummary({ blind_spots: [] }) });
      expect(fact(none, "blind").exists()).toBe(false);
    });
  });
});
