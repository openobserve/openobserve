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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import i18n from "@/locales";
import type { Freshness } from "@/services/db_monitoring";

import DbmCoverageLine from "./DbmCoverageLine.vue";

const freshness = (over: Partial<Freshness> = {}): Freshness => ({
  data_through: Date.now() * 1000,
  live_tail: true,
  tail_covers_from: null,
  tail_through: null,
  tail_truncated: false,
  percentiles_estimated: false,
  traces_upper_bound: true,
  ...over,
});

const mountLine = (props: Record<string, unknown> = {}) =>
  mount(DbmCoverageLine, {
    props: { freshness: freshness(), hits: [{ total_time_ns: 1_000 }], ...props },
    global: { plugins: [i18n] },
  });

const lineText = (wrapper: ReturnType<typeof mountLine>) =>
  wrapper.find("[data-test='dbm-coverage-text']").text();

/** `data_through` set so the component computes exactly `minutes` of lag. */
const behindBy = (minutes: number) =>
  freshness({ data_through: (Date.now() - minutes * 60_000) * 1000 });

describe("DbmCoverageLine", () => {
  /**
   * The backend fuses percentiles by request-weighting across windows, which is
   * an average and not a quantile — it says so by setting `percentiles_estimated`.
   * Any sentence claiming exactness has to be gated on that flag, or the page
   * contradicts the clipboard summary built from the same response.
   */
  describe("the exactness claim answers to percentiles_estimated", () => {
    it("says speeds are exact when the server did not fuse windows", () => {
      const wrapper = mountLine({
        exactPercentiles: true,
        freshness: freshness({ percentiles_estimated: false }),
      });
      expect(lineText(wrapper)).toContain("they're exact");
    });

    it("never claims exactness when the server fused windows", () => {
      const wrapper = mountLine({
        exactPercentiles: false,
        freshness: freshness({ percentiles_estimated: true }),
      });
      expect(lineText(wrapper)).not.toContain("they're exact");
      expect(lineText(wrapper)).toContain("close but not exact");
    });

    /**
     * `lineHealthyAll` carries the SAME "measured across every call, so they're
     * exact" claim as `lineExact` but was reachable with no flag at all — any
     * list page whose remainder bucket happens to be empty printed it.
     */
    it("does not claim exactness on a full list when percentiles were fused", () => {
      const wrapper = mountLine({
        exactPercentiles: false,
        other: [],
        freshness: freshness({ percentiles_estimated: true }),
      });
      expect(lineText(wrapper)).not.toContain("they're exact");
      expect(lineText(wrapper)).toContain("close but not exact");
    });

    it("still says the whole list is shown when the remainder is empty", () => {
      const wrapper = mountLine({
        other: [],
        freshness: freshness({ percentiles_estimated: true }),
      });
      expect(lineText(wrapper)).toContain("every query that ran");
    });
  });

  /**
   * The summary is a single-sentence priority chain, and a narrowing filter used
   * to win it outright — so on a filtered table the staleness warning was
   * silently dropped. A filtered table during an incident is exactly when the
   * reader most needs to know the numbers are behind, so the two facts share one
   * sentence rather than one evicting the other.
   */
  describe("a filtered view never hides staleness", () => {
    it("names the filter AND the lag when the counting is behind", () => {
      const wrapper = mountLine({
        filterLabel: "checkout-service",
        freshness: behindBy(45),
      });
      expect(lineText(wrapper)).toContain("checkout-service");
      expect(lineText(wrapper)).toContain("45 minutes behind");
    });

    /**
     * `truncated` sat one branch below `filterLabel` and evicted staleness the
     * same way. Both undercount, but for unrelated reasons — the tail was too
     * big to take in, AND the counting is behind — so reporting only the first
     * lets a reader believe the shortfall is bounded and already known. Same
     * defect, same fix: one sentence, both facts.
     */
    it("names the truncation AND the lag when both hold", () => {
      const wrapper = mountLine({
        freshness: behindBy(45),
      });
      // behindBy() rebuilds freshness, so re-assert truncation on top of it.
      const wrapperTruncated = mountLine({
        freshness: { ...behindBy(45), tail_truncated: true },
      });
      expect(lineText(wrapper)).toContain("45 minutes behind");
      expect(lineText(wrapperTruncated)).toContain("undercount");
      expect(
        lineText(wrapperTruncated),
        "a truncated tail must not silence the staleness warning",
      ).toContain("45 minutes behind");
    });

    it("names the filter AND the lag when an unnamed filter narrows the scope", () => {
      const wrapper = mountLine({
        topNSubset: true,
        freshness: behindBy(45),
      });
      expect(lineText(wrapper)).toContain("45 minutes behind");
      expect(lineText(wrapper)).toContain("rows shown");
    });

    it("still leads with the named filter, which is the actionable half", () => {
      const wrapper = mountLine({
        filterLabel: "checkout-service",
        freshness: behindBy(45),
      });
      const text = lineText(wrapper);
      expect(text.indexOf("checkout-service")).toBeLessThan(text.indexOf("45 minutes behind"));
    });

    it("keeps the plain filter sentence when the counting is current", () => {
      const wrapper = mountLine({ filterLabel: "checkout-service" });
      expect(lineText(wrapper)).toContain("checkout-service");
      expect(lineText(wrapper)).not.toContain("behind");
    });

    /**
     * The lag rides along only once the counting is genuinely stale; at the
     * threshold itself the filter sentence stands alone.
     */
    it("does not add the lag at the staleness threshold itself", () => {
      const wrapper = mountLine({ filterLabel: "checkout-service", freshness: behindBy(30) });
      expect(lineText(wrapper)).not.toContain("minutes behind");
    });

    it("adds the lag one minute past the staleness threshold", () => {
      const wrapper = mountLine({ filterLabel: "checkout-service", freshness: behindBy(31) });
      expect(lineText(wrapper)).toContain("31 minutes behind");
    });

    /** A genuine coverage gap is worse than either, and still outranks both. */
    it("does not let the filter displace a genuine coverage gap", () => {
      const now = Date.now() * 1000;
      const wrapper = mountLine({
        filterLabel: "checkout-service",
        freshness: freshness({
          data_through: now - 30 * 60_000_000,
          tail_covers_from: now - 5 * 60_000_000,
          tail_through: now,
        }),
      });
      expect(lineText(wrapper)).toContain("missing from this window");
    });
  });

  /**
   * Below the stale threshold the line printed "the last half-minute is still
   * coming in", which at 25 minutes behind is simply false. The copy must never
   * assert a freshness the data does not support.
   */
  describe("the counted-up-to note never overstates freshness", () => {
    const trailer = (wrapper: ReturnType<typeof mountLine>) =>
      wrapper.find("[data-test='dbm-coverage']").text();

    it("claims only the last half-minute when the counting really is current", () => {
      const wrapper = mountLine({ freshness: behindBy(0) });
      expect(trailer(wrapper)).toContain("last half-minute");
    });

    it("reports the real lag instead of half a minute when it is 25 minutes behind", () => {
      const wrapper = mountLine({ freshness: behindBy(25) });
      expect(trailer(wrapper)).not.toContain("last half-minute");
      expect(trailer(wrapper)).toContain("25 minutes behind");
    });

    it("does not cry lag over a minute or two of ordinary rollup delay", () => {
      const wrapper = mountLine({ freshness: behindBy(3) });
      expect(trailer(wrapper)).toContain("last half-minute");
      expect(trailer(wrapper)).not.toContain("behind");
    });

    /** The boundary itself is still ordinary delay; only PAST it is the claim false. */
    it("still claims the half-minute exactly at the ordinary-delay boundary", () => {
      const wrapper = mountLine({ freshness: behindBy(4) });
      expect(trailer(wrapper)).toContain("last half-minute");
    });

    it("reports the lag one minute past the boundary", () => {
      const wrapper = mountLine({ freshness: behindBy(5) });
      expect(trailer(wrapper)).not.toContain("last half-minute");
      expect(trailer(wrapper)).toContain("5 minutes behind");
    });
  });
});
