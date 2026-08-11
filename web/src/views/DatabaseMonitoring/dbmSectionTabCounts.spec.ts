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
 * The L2 tab bar states how much is happening in EVERY view, from whichever
 * view you are standing in.
 *
 * DbmSectionTabs already accepts and renders `activityCount`; the defect was
 * that only ActivityPage ever passed it, so on the other four pages the
 * Activity tab rendered bare beside four tabs carrying numbers. A blank badge
 * does not read as "unknown" — beside populated siblings it reads as "nothing
 * is happening there", which is the one wrong answer that stops a reader
 * opening the tab during an incident.
 *
 * Read off the source rather than by mounting, for the reason
 * dbmRequestGuard.spec.ts gives: these views need a router, a store and a dozen
 * O2 children, and a harness that heavy fails for reasons unrelated to the
 * wiring and gets deleted the first time it does.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/**
 * The four pages the defect was on. ActivityPage is deliberately NOT here: it
 * already passed `activityCount` and is the reference these four are brought up
 * to, so asserting it alongside them would let a green run mean nothing. It has
 * its own case at the bottom, pinning it as the reference rather than re-proving
 * the fix.
 */
const PAGES = [
  "DatabasesPage.vue",
  "QueriesPage.vue",
  "DeadlocksPage.vue",
  "BlockedQueriesPage.vue",
];

/** The five badges the bar can carry, in the order the bar renders them. */
const COUNT_PROPS = [
  "database-count",
  "query-count",
  "activity-count",
  "deadlock-count",
  "blocked-count",
];

/** The `<DbmSectionTabs …/>` element as written on the page. */
const tabsTag = (page: string): string => {
  const source = read(page);
  const open = source.indexOf("<DbmSectionTabs");
  expect(open, `${page} must render DbmSectionTabs`).toBeGreaterThan(-1);
  const close = source.indexOf("/>", open);
  expect(close, `${page}'s DbmSectionTabs must be self-closing`).toBeGreaterThan(open);
  return source.slice(open, close);
};

describe("every DBM page states every sibling tab's count", () => {
  it.each(PAGES)("%s passes all five counts to the tab bar", (page) => {
    const tag = tabsTag(page);
    const missing = COUNT_PROPS.filter((prop) => !tag.includes(`:${prop}=`));
    expect(missing, `${page} leaves ${missing.join(", ")} unpassed`).toEqual([]);
  });

  /**
   * The badge means SESSIONS in the window, which is what the state breakdown
   * counts (`COUNT(DISTINCT pid)` server-side). `hits`/`total` on the activity
   * response is a row-limited sample and is documented as such, so a page
   * sourcing the badge from it would render a constant cap as the population.
   */
  it.each(PAGES)("%s sources the activity badge from the state breakdown", (page) => {
    const tag = tabsTag(page);
    const bound = /:activity-count="([^"]+)"/.exec(tag)?.[1];
    expect(bound, `${page} must bind :activity-count`).toBeTruthy();

    const source = read(page);
    // Whatever the page calls it, it must be the sum over `by_state` — never
    // `hits.length` and never the response's own `total`.
    expect(source, `${page} must derive ${bound} from the activity state breakdown`).toContain(
      "activitySampleTotal",
    );
    expect(source).toMatch(/activitySampleTotal\(/);
  });

  /** A page that never fetches activity can only ever render a bare badge. */
  it.each(PAGES)("%s fetches the activity breakdown it reports", (page) => {
    expect(read(page)).toContain("dbMonitoringService.getActivity(");
  });

  /**
   * The badge must be `null` — bare — when the fetch failed, not 0. Zero is a
   * measurement ("nothing is running"); a failed read has measured nothing, and
   * printing 0 for it is the same lie in the other direction.
   */
  it.each(PAGES)("%s leaves the activity badge bare when the fetch fails", (page) => {
    const source = read(page);
    const call = source.indexOf("dbMonitoringService.getActivity(");
    const tail = source.slice(call, call + 700);
    expect(tail, `${page} must null the activity state on a failed read`).toMatch(
      /catch[\s\S]{0,120}=\s*(null|\[\])/,
    );
  });

  /**
   * The reference the four above are held to. If ActivityPage ever stops
   * sourcing its own badge from the state breakdown, the rule the other four
   * follow has quietly changed and these tests would be enforcing a shape
   * nothing ships any more.
   */
  it("ActivityPage remains the reference the other four copy", () => {
    const tag = tabsTag("ActivityPage.vue");
    expect(tag).toMatch(/:activity-count="/);
    expect(read("ActivityPage.vue")).toContain("activitySampleTotal(");
  });
});

/**
 * The coverage caveat under each open database.
 *
 * `showsShortfall` is unit-tested in breakdownRows.spec.ts; what is pinned here
 * is that the page ASKS it. The defect was never in the arithmetic — the
 * per-row percentages were always distinct — it was that the page gated the
 * caveat on `shortfall !== null` directly, which is true even when nothing was
 * attributed and every row therefore reported the identical 100%.
 */
describe("DatabasesPage gates the coverage caveat on the shared rule", () => {
  const source = read("DatabasesPage.vue");

  it("asks showsShortfall rather than reading shortfall itself", () => {
    expect(source).toContain('from "@/utils/dbm/breakdownRows"');
    expect(source).toMatch(/const hasShortfall[\s\S]{0,400}showsShortfall\(/);
  });

  it("no longer gates the caveat on a bare non-null shortfall", () => {
    expect(source).not.toMatch(/hasShortfall[\s\S]{0,200}breakdown\.shortfall !== null/);
  });

  /** The figure still rides along — a caveat without one is the disclaimer. */
  it("still prints the row's own percentage in the caveat", () => {
    expect(source).toMatch(/shortfallLine[\s\S]{0,300}dbm\.breakdown\.shortfall/);
    expect(source).toMatch(/shortfallLine[\s\S]{0,300}percent:/);
  });
});
