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

/**
 * The query detail page's three tabs, as pure functions.
 *
 * The page itself pulls the router, the store, six services and a chart
 * runtime, so mounting it in a spec is impractical (`dbmRequestGuard.spec.ts`
 * records why this directory stays out of it). The tab decisions that can be
 * got wrong — which tab a URL selects, which tab a section lives on, whether
 * `?tab=` survives a scope change — are therefore extracted here and driven
 * directly.
 */

import { describe, expect, it } from "vitest";

import {
  QUERY_DETAIL_TABS,
  isQueryDetailTab,
  resolveQueryDetailTab,
  type QueryDetailTab,
} from "./queryDetailTabs";

describe("the tab set", () => {
  /**
   * Three tabs, in troubleshooting order: how bad it is, why it is slow, then
   * the raw evidence. Pinned as a list because the ORDER is the design — the
   * diagnosis (plans) reads before the raw samples, which is the same ordering
   * the single-column page expressed by stacking plans above samples.
   */
  it("is overview, plans, callers — in that order", () => {
    expect(QUERY_DETAIL_TABS).toEqual(["overview", "plans", "callers"]);
  });

  it("recognises exactly those three keys", () => {
    for (const tab of QUERY_DETAIL_TABS) expect(isQueryDetailTab(tab)).toBe(true);
    for (const other of ["", "samples", "endpoints", "Overview", "plans "]) {
      expect(isQueryDetailTab(other)).toBe(false);
    }
  });
});

describe("resolving the tab from the URL", () => {
  /**
   * The default is Overview — the headline numbers and the trend, which is
   * what minute 0 of an incident needs. Every unusable value lands there
   * rather than on a blank page: absent (the ordinary deep link and every link
   * pasted before this feature existed), unknown, or an array, which is what
   * vue-router hands back for a repeated `?tab=a&tab=b`.
   */
  it("defaults to overview when no tab is in the URL", () => {
    expect(resolveQueryDetailTab(undefined)).toBe("overview");
    expect(resolveQueryDetailTab(null)).toBe("overview");
    expect(resolveQueryDetailTab("")).toBe("overview");
  });

  it("falls back to overview on a value that names no tab", () => {
    expect(resolveQueryDetailTab("deadlocks")).toBe("overview");
    expect(resolveQueryDetailTab("PLANS")).toBe("overview");
    expect(resolveQueryDetailTab(["plans", "callers"])).toBe("overview");
  });

  /**
   * The deep link half: a pasted `?tab=plans` opens on Plans. This is what
   * makes the tabs shareable — the reason the state lives in the URL at all
   * rather than in a `ref`.
   */
  it("selects the named tab for each of the three", () => {
    const expected: Record<string, QueryDetailTab> = {
      overview: "overview",
      plans: "plans",
      callers: "callers",
    };
    for (const [param, tab] of Object.entries(expected)) {
      expect(resolveQueryDetailTab(param)).toBe(tab);
    }
  });

  /**
   * vue-router's `LocationQueryValue` is `string | null`, so a repeated param
   * is `(string | null)[]` — `?tab=&tab=plans` really does arrive as
   * `[null, "plans"]`. Every one of those shapes reaches this function as-is
   * and must resolve, not throw: a hand-edited URL is the ordinary way this is
   * reached, and a throw here would blank the whole page.
   */
  it("never throws on the shapes vue-router can produce", () => {
    for (const value of [undefined, null, "", "x", [], ["plans"], [null], [null, "plans"], 7, {}]) {
      expect(() => resolveQueryDetailTab(value)).not.toThrow();
      expect(QUERY_DETAIL_TABS).toContain(resolveQueryDetailTab(value));
    }
  });
});
