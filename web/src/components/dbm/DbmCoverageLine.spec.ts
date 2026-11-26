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

// The long sentence, which sits behind the banner's Details button.
const lineText = (wrapper: ReturnType<typeof mountLine>) =>
  String((wrapper.vm as unknown as { entry: { long: string } | null }).entry?.long ?? "");

const bannerText = (wrapper: ReturnType<typeof mountLine>) =>
  wrapper.find("[data-test='dbm-coverage-text']").text();

/** `data_through` set so the component computes exactly `minutes` of lag. */
const behindBy = (minutes: number) =>
  freshness({ data_through: (Date.now() - minutes * 60_000) * 1000 });

describe("DbmCoverageLine", () => {
  /**
   * The summary is a single-sentence priority chain, and a narrowing filter
   * must not win it outright — that would silently drop the staleness warning.
   * A filtered table during an incident is exactly when the reader most needs
   * to know the numbers are behind, so the two facts share one sentence rather
   * than one evicting the other.
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
     * `truncated` sits one branch below `filterLabel` in the chain and could
     * evict staleness the same way. Both undercount, but for unrelated reasons
     * — the tail was too big to take in, AND the counting is behind — so
     * reporting only the first lets a reader believe the shortfall is bounded
     * and already known. Same rule as the filter: one sentence, both facts.
     */
    it("names the truncation AND the lag when both hold", () => {
      // behindBy() rebuilds freshness, so truncation is asserted on top of it.
      const wrapperTruncated = mountLine({
        freshness: { ...behindBy(45), tail_truncated: true },
      });
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

    it("shows no banner for a filter while the counting is current", () => {
      expect(
        mountLine({ filterLabel: "checkout-service" }).find("[data-test='dbm-coverage']").exists(),
      ).toBe(false);
    });

    /**
     * The lag rides along only once the counting is genuinely stale; at the
     * threshold itself the filter sentence stands alone.
     */
    it("does not add the lag at the staleness threshold itself", () => {
      const wrapper = mountLine({ filterLabel: "checkout-service", freshness: behindBy(30) });
      expect(wrapper.find("[data-test='dbm-coverage']").exists()).toBe(false);
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

  describe("the banner", () => {
    const now = () => Date.now() * 1000;
    const gapFresh = (fromMinAgo: number, toMinAgo: number) =>
      freshness({
        data_through: now() - fromMinAgo * 60_000_000,
        tail_covers_from: now() - toMinAgo * 60_000_000,
        tail_through: now(),
      });
    const banner = (w: ReturnType<typeof mountLine>) => w.findComponent({ name: "OBanner" });

    it("renders nothing when all is well", () => {
      expect(mountLine().find("[data-test='dbm-coverage']").exists()).toBe(false);
    });

    it("renders nothing while empty", () => {
      expect(
        mountLine({ hits: [], freshness: behindBy(45) })
          .find("[data-test='dbm-coverage']")
          .exists(),
      ).toBe(false);
    });

    it("warns with a short dated gap message clipped to the window", () => {
      const w = mountLine({
        freshness: gapFresh(300, 100),
        windowStart: now() - 150 * 60_000_000,
        windowEnd: now(),
      });
      expect(banner(w).props("variant")).toBe("warning");
      expect(bannerText(w)).toMatch(/\(50 min\)\. Collection may have stopped\.$/);
    });

    it("ignores a gap that lies outside the window", () => {
      const w = mountLine({
        freshness: gapFresh(300, 100),
        windowStart: now() - 60 * 60_000_000,
        windowEnd: now(),
      });
      expect(lineText(w)).not.toContain("missing from this window");
    });

    it("warns when behind and shows no banner for a subset", () => {
      expect(banner(mountLine({ freshness: behindBy(45) })).props("variant")).toBe("warning");
      expect(
        mountLine({ filterLabel: "checkout-service" }).find("[data-test='dbm-coverage']").exists(),
      ).toBe(false);
    });

    it("warns about failures with no driver status code", () => {
      const w = mountLine({ codedErrorShare: 0.5, errorCount: 4 });
      expect(banner(w).props("variant")).toBe("warning");
    });

    it("warns about uncoded failures even when 20% or more of the time is outside the shown rows", () => {
      const w = mountLine({
        other: [{ total_time_ns: 1_000 }],
        codedErrorShare: 0.5,
        errorCount: 4,
      });
      expect(banner(w).props("variant")).toBe("warning");
    });

    it("keeps the long sentence behind a Details button", () => {
      const w = mountLine({ freshness: behindBy(45) });
      expect(w.find("[data-test='dbm-coverage-details']").exists()).toBe(true);
    });
  });
});
