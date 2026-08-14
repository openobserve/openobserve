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
 * Every DBM page has to carry the request-sequence guard.
 *
 * `useDbmRequestSeq` is unit-tested on its own, but the defect this closes was
 * never in the mechanism — it was that no page had one. So the regression worth
 * pinning is the WIRING. On the list pages the token claim and the
 * spinner-clearing now live ONCE, in `useDbmListPage`'s `run` envelope (its
 * spec proves both behaviourally), so what each page must still show in source
 * is: it routes its load through that envelope, and it checks the token before
 * writing anything a response produced. The detail page keeps its own guard
 * and is pinned in full.
 *
 * Read off the source rather than by mounting: these views need a router, a
 * store and a dozen O2 children to mount, and a harness that heavy would fail
 * for reasons unrelated to the guard and get deleted the first time it did.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");
const readComposable = () =>
  readFileSync(join(here, "../../composables/dbm/useDbmListPage.ts"), "utf8");

/** Every list page that fetches on a filter, a search, a sort or the date picker. */
const LIST_PAGES = [
  "QueriesPage.vue",
  "DatabasesPage.vue",
  "SamplesPage.vue",
  "ActivityPage.vue",
  "DeadlocksPage.vue",
  "BlockedQueriesPage.vue",
  "TableHealthPage.vue",
];

describe("DBM pages guard against out-of-order responses", () => {
  it.each(LIST_PAGES)("%s routes its load through the shared envelope", (page) => {
    const source = read(page);
    expect(source).toContain('from "@/composables/dbm/useDbmListPage"');
    expect(source).toContain("useDbmListPage({");
    // The page's load IS a run() of its fetcher — not a bare async that could
    // quietly skip the token claim.
    expect(source).toMatch(/const load = \(\) =>\s*\n?\s*run\(/);
  });

  /**
   * The envelope claims the token and hands it to the fetcher; the page must
   * still CHECK it after its awaits, because only the page knows where its
   * writes are.
   */
  it.each(LIST_PAGES)("%s discards a response a newer load superseded", (page) => {
    expect(read(page)).toContain("requestSeq.isStale(token)");
  });

  /**
   * The claim/clear pair itself lives once, in the composable. Its spec pins
   * the behaviour (a superseded run cannot clear the newer run's spinner);
   * this pins that the code has not quietly moved back out.
   */
  it("the shared envelope owns the token claim and the spinner", () => {
    const source = readComposable();
    expect(source).toContain("const token = requestSeq.begin();");
    expect(source).toMatch(/if \(!requestSeq\.isStale\(token\)\) \{\s*\n\s*loading\.value = false/);
  });

  /**
   * P1-7 (original): `load()` cleared the breakdown cache before its await,
   * but the in-flight per-database fetches were not invalidated and refilled it
   * with the OLD window's numbers under a NEW window's parent.
   *
   * The class of bug is now closed by CONSTRUCTION rather than by a token: the
   * split rides the overview response itself (`include_breakdown`), so there is
   * no per-row request that could still be in flight when the window moves.
   * What this pins is that structural property — no fetch inside the filing
   * path — plus the cache clear that keeps the old window's numbers off screen
   * while the new response is on its way.
   */
  it("DatabasesPage files breakdowns from the parent load, never from a per-row fetch", () => {
    const source = read("DatabasesPage.vue");
    // One response carries both the table and its splits.
    expect(source).toMatch(/getDatabases\([\s\S]{0,600}includeBreakdown: true/);
    // The filing path is synchronous — a lookup into what already arrived.
    expect(source).toMatch(/const fileBreakdown = \(row: DatabaseRow\) => \{/);
    expect(source).toMatch(/const fillOpenBreakdowns = \(\) => \{/);
    // No per-row request survives anywhere in the page: this is the property
    // the token used to protect, now enforced by absence.
    expect(source).not.toContain("loadBreakdown");
    expect(source).not.toMatch(/getQueries\(/);
    // The cache AND the section it is filed from are cleared in run's `before`
    // hook, which the envelope runs after claiming the token — so an open row
    // shows its loading placeholder rather than the previous window's split.
    expect(source).toMatch(
      /before: \(\) => \{[\s\S]{0,500}breakdowns\.value = \{\}[\s\S]{0,200}instanceBreakdowns\.value = null/,
    );
    const envelope = readComposable();
    const begin = envelope.indexOf("requestSeq.begin()");
    const before = envelope.indexOf("runOptions.before?.()");
    expect(begin).toBeGreaterThan(-1);
    expect(before).toBeGreaterThan(begin);
  });

  // ── QueryDetailPage: not a list page, keeps its own guard in full ──────────

  it("QueryDetailPage owns a request sequence", () => {
    const source = read("QueryDetailPage.vue");
    expect(source).toContain('from "@/composables/dbm/useDbmRequestSeq"');
    expect(source).toContain("useDbmRequestSeq()");
    expect(source).toContain("requestSeq.begin()");
    expect(source).toContain("requestSeq.isStale(token)");
    expect(source).toMatch(
      /if \(!requestSeq\.isStale\(token\)\)[\s\S]{0,80}loading\.value = false/,
    );
  });

  /**
   * P1-8: unguarded loads meant picking stream A then B showed A's callers and
   * samples under B-labelled headline stats.
   *
   * Asserts the PROPERTY — every load in the handler shares one token — rather
   * than a fixed list of load names. A version pinned to an exact call count
   * breaks the moment a correctly guarded load is added, and a test that fails
   * on correct code trains people to edit the test — which is how the next
   * genuinely unguarded load gets waved through.
   */
  it("QueryDetailPage voids every superseded stream-pick load together", () => {
    const source = read("QueryDetailPage.vue");
    const handler = source.split("const onStreamPick")[1]?.split("\nconst ")[0] ?? "";
    expect(handler, "onStreamPick must exist").not.toBe("");
    expect(handler).toContain("const token = requestSeq.begin();");

    const loads = handler.match(/\bload[A-Za-z]*\(/g) ?? [];
    expect(loads.length, "the handler must issue at least one load").toBeGreaterThan(0);
    // Every load takes the token; none may fire unguarded.
    const guarded = handler.match(/\bload[A-Za-z]*\(token\)/g) ?? [];
    expect(guarded.length, `every load must take the token, saw ${loads.join(" ")}`).toBe(
      loads.length,
    );
  });
});
