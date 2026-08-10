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
});
