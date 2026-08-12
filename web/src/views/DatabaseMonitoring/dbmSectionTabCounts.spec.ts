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
  "TableHealthPage.vue",
];

/** The six badges the bar can carry, in the order the bar renders them. */
const COUNT_PROPS = [
  "database-count",
  "query-count",
  "activity-count",
  "deadlock-count",
  "blocked-count",
  "table-health-count",
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
  it.each(PAGES)("%s passes all six counts to the tab bar", (page) => {
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
   *
   * Two shapes satisfy this, and the test accepts both because the REQUIREMENT
   * is the empty rendering, not the control flow that reaches it: a `catch`
   * that assigns the blank, or the settled-result ternary the concurrent badge
   * fetches use (`status === "fulfilled" ? … : null`). Pinning `catch` alone
   * failed a page that had become MORE correct — it fetches the badges
   * concurrently now — which is how a test starts training people to edit it.
   */
  it.each(PAGES)("%s leaves the activity badge bare when the fetch fails", (page) => {
    const source = read(page);
    // Which name THIS page's fan-out actually produces. Matched on the
    // declaration/assignment, not a bare mention: `activityCount` also appears
    // as a tab-bar prop and an i18n key on pages whose badge is
    // `activityStates`, and matching those picked the wrong variable.
    const name = /activityCount(:|\.value =)/.test(source) ? "activityCount" : "activityStates";

    // WHERE the badge's value is decided, which is not always where it is
    // assigned. Since the badge counts moved behind the shared window cache
    // (useDbmCountCache), the fan-out builds `activityStates: …` as a property
    // of the cached object and the assignment is a plain `= badges.…` read.
    // Both spellings are accepted because the REQUIREMENT is the blank
    // rendering, not the statement that produces it — an earlier version
    // pinned the assignment alone and failed six pages that had lost none of
    // this honesty, which is how a test starts training people to edit it.
    const decided =
      // `activityStates: fulfilled ? … : null` inside the cached value…
      new RegExp(
        `${name}:[\\s\\S]{0,200}?status === "fulfilled"[\\s\\S]{0,200}?:\\s*(null|\\[\\])`,
      ).exec(source)?.[0] ??
      // …or the direct assignment, as it was written before the cache.
      (() => {
        const at = source.indexOf(`${name}.value =`);
        if (at === -1) return null;
        const stmt = source.slice(at, source.indexOf(";", at) + 1);
        if (/status === "fulfilled"[\s\S]*:\s*(null|\[\])\s*;/.test(stmt)) return stmt;
        // A `catch` nearby that blanks it counts too.
        return new RegExp(`${name}\\.value =\\s*(null|\\[\\])`).test(
          source.slice(at - 200, at + 200),
        )
          ? stmt
          : null;
      })();

    expect(
      decided,
      `${page} must leave the activity badge blank on a failed read — no ` +
        `fallback to null/[] found for ${name}`,
    ).not.toBeNull();

    // And whatever it falls back to, it must never be a zero: that is a
    // measurement ("nothing is running") standing in for "we could not count".
    expect(decided, `${page} falls the activity badge back to 0 on failure`).not.toMatch(
      /:\s*0\s*[,;]/,
    );
  });

  /**
   * **A capped read may not reach the badge as a bare total.**
   *
   * Measured against a live backend, default window and default `limit`:
   *   /deadlocks → total 90,  truncated true  (limit=1000 → 814, still capped)
   *   /blocking  → total 100, truncated true  (limit=1000 → 426, complete)
   * So the Deadlocks badge printed `90` for a window holding at least 814
   * events, and Blocked printed `100` for 426. Both are CEILINGS rendered as
   * populations, and both are stable across windows in which the real number
   * moves — the badge looks like a measurement that is not changing rather
   * than one that is not being taken.
   *
   * The fix is the one the codebase already uses for prose (`countClaim`):
   * carry the server's `truncated` alongside the count and let `badgeCount`
   * print `90+`. This pins that the page PASSES the flag — the arithmetic is
   * unit-tested in format.spec.ts, and the defect here was never arithmetic.
   *
   * Only the three endpoints that actually disclose a cap are asserted:
   * `/queries`, `/table_health` and `/index_health` return no `truncated`
   * field at all (verified against the running backend), so demanding one
   * there would pin a disclosure the API never makes.
   */
  const CAPPED_BADGE_FETCHES: [string, string][] = [
    ["getDeadlocks", "deadlockCount"],
    ["getBlocking", "blockedCount"],
  ];

  it.each(PAGES)("%s carries the server's cap into its capped badges", (page) => {
    const source = read(page);
    for (const [fetcher, countVar] of CAPPED_BADGE_FETCHES) {
      const call = source.indexOf(`dbMonitoringService.${fetcher}(`);
      if (call === -1) continue; // the page owning that view need not fetch it
      // Nor need it feed the SIBLING badge from that fetch: DeadlocksPage reads
      // /deadlocks for its own table and publishes `eventCount`, never a
      // `deadlockCount` badge. The old test skipped these via its
      // `${countVar}.value =` lookup; this keeps that exemption explicit.
      if (!new RegExp(`${countVar}(:|\\.value =)`).test(source)) continue;

      // WHERE the claim is built, which since the badge counts moved behind
      // the shared window cache (useDbmCountCache) is a property of the cached
      // object (`deadlockCount: … countClaim(…)`) rather than the assignment.
      // The assignment itself is now `= badges.deadlockCount`. Asserting the
      // old position would fail pages that still pass the cap correctly —
      // indeed the cache is exactly what keeps the flag alive across a hit.
      //
      // Scoped to THIS property's own value, up to the next sibling property
      // — never a fixed window over the file. A loose `[\s\S]{0,300}` let the
      // NEIGHBOURING badge's `countClaim` satisfy this one: deleting
      // deadlockCount's claim entirely still passed, because blockedCount's
      // sat within the window. Caught by doing exactly that and watching this
      // test stay green.
      const prop = new RegExp(`\\b${countVar}:\\s*([\\s\\S]*?),\\n\\s{0,10}(//|\\w+:|\\})`).exec(
        source,
      );
      const built = prop
        ? /countClaim\(([\s\S]*)\)/.exec(prop[1])
        : (() => {
            // Pre-cache spelling: a direct `countVar.value = …;` assignment.
            const at = source.indexOf(`${countVar}.value =`);
            if (at === -1) return null;
            return /countClaim\(([\s\S]*)\)/.exec(source.slice(at, source.indexOf(";", at) + 1));
          })();
      expect(
        built,
        `${page} sets ${countVar} from ${fetcher} without building a ` +
          `countClaim, so a capped read prints as a total`,
      ).not.toBeNull();
      expect(
        built?.[1],
        `${page} calls countClaim for ${countVar} but never passes the server's ` +
          `cap, so every count claims to be complete`,
      ).toMatch(/\.truncated/);
    }
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
