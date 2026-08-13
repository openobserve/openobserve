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
 * pinning is the WIRING: each page claims a token on entry to `load()` and
 * checks it before writing anything the response produced.
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

/** Every page that fetches on a filter, a search, a sort or the date picker. */
const PAGES = [
  "QueriesPage.vue",
  "DatabasesPage.vue",
  "SamplesPage.vue",
  "ActivityPage.vue",
  "DeadlocksPage.vue",
  "BlockedQueriesPage.vue",
  "TableHealthPage.vue",
  "QueryDetailPage.vue",
];

describe("DBM pages guard against out-of-order responses", () => {
  it.each(PAGES)("%s owns a request sequence", (page) => {
    const source = read(page);
    expect(source).toContain('from "@/composables/dbm/useDbmRequestSeq"');
    expect(source).toContain("useDbmRequestSeq()");
  });

  it.each(PAGES)("%s claims a token before fetching", (page) => {
    expect(read(page)).toContain("requestSeq.begin()");
  });

  it.each(PAGES)("%s discards a response a newer load superseded", (page) => {
    expect(read(page)).toContain("requestSeq.isStale(token)");
  });

  /**
   * The spinner is the only thing that would otherwise admit a mismatch, so a
   * superseded load clearing it reports "done" over a fetch still in flight.
   */
  it.each(PAGES)("%s lets only the owning load clear the spinner", (page) => {
    expect(read(page)).toMatch(
      /if \(!requestSeq\.isStale\(token\)\)[\s\S]{0,80}loading\.value = false/,
    );
  });

  /**
   * P1-7: `load()` clears the breakdown cache before its await, but the
   * in-flight per-database fetches were not invalidated and refilled it with
   * the OLD window's numbers under a NEW window's parent.
   */
  it("DatabasesPage invalidates in-flight breakdowns from the parent load", () => {
    const source = read("DatabasesPage.vue");
    // The breakdown JOINS the load rather than claiming the page for itself.
    expect(source).toMatch(/loadBreakdown = async \([\s\S]{0,120}requestSeq\.current\(\)/);
    // The token is claimed before the cache is cleared, so anything still in
    // flight is already stale when it tries to write back.
    const begin = source.indexOf("requestSeq.begin()");
    const clear = source.indexOf("breakdowns.value = {};");
    expect(begin).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(begin);
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
