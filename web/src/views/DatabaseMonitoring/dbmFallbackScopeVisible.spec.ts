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
 * A scope filter that is APPLIED must be VISIBLE, in every state that applies
 * it — and the coverage line must follow the table it describes.
 *
 * The bug this pins, on both trace-derived pages: `DbmScopeFilters` lived
 * inside the CLIENT table's `#toolbar` slot, and that table is `v-if`-ed away
 * in fallback mode. So the control unmounted with it — while the load kept
 * spreading all five dimensions into the request. Measured against the live
 * fleet, that was not theoretical: a fallback fetched under
 * `instance=<nonexistent>` returned 0 rows (the server DOES apply `instance`),
 * so a reader who had set an instance and then hit a traceless window got a
 * database-reported list silently narrowed to it, with no chip saying so and
 * no control to clear it, beneath a subtitle claiming the list spanned every
 * client. The page stated one scope and applied another.
 *
 * The same unmount took `DbmCoverageLine` with it, so freshness, the top-N
 * truncation disclosure and the "counted to" timestamp all vanished at exactly
 * the moment the numbers changed vantage.
 *
 * Source-read like dbmFallbackCoversLoading.spec.ts, and for the same reason:
 * these views need a router, a store and a dozen O2 children to mount, and a
 * harness that heavy fails for unrelated reasons and gets deleted. What is
 * pinned here is structural and survives that: WHERE the control is rendered
 * relative to the table that can unmount.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/** The two pages that fall back to a database-reported list. */
const PAGES = ["QueriesPage.vue", "SamplesPage.vue"] as const;

/**
 * The template half of an SFC — everything before `<script setup`.
 *
 * The structural claims below are about MARKUP, and the script holds strings
 * (`"DbmScopeFilters"` in an import, `serverListShown` in a computed) that
 * would otherwise satisfy a naive `toContain` and let the real regression
 * through.
 */
const templateOf = (source: string): string => {
  const end = source.indexOf("<script setup");
  expect(end, "SFC must have a <script setup> block").toBeGreaterThan(-1);
  return source.slice(0, end);
};

describe("DBM scope filter survives the fallback", () => {
  it.each(PAGES)("%s renders DbmScopeFilters exactly once", (page) => {
    const template = templateOf(read(page));
    const occurrences = template.match(/<DbmScopeFilters\b/g) ?? [];
    // Exactly one, so there is ONE source of truth for the filter state and no
    // duplicated DOM in any state where both tables could mount.
    expect(occurrences).toHaveLength(1);
  });

  it.each(PAGES)("%s renders it OUTSIDE the client table that unmounts", (page) => {
    const template = templateOf(read(page));
    const filterAt = template.indexOf("<DbmScopeFilters");
    const tableAt = template.indexOf('<OTable\n        v-if="!serverListShown"');

    expect(tableAt, `${page} must still gate its client table on serverListShown`).toBeGreaterThan(
      -1,
    );
    // Before the `v-if`-ed table means it cannot be unmounted by it. This is
    // the whole fix: position, not presence.
    expect(filterAt).toBeGreaterThan(-1);
    expect(filterAt).toBeLessThan(tableAt);
  });

  it.each(PAGES)("%s keeps the filter out of any table toolbar slot", (page) => {
    const template = templateOf(read(page));
    const filterAt = template.indexOf("<DbmScopeFilters");
    const toolbarAt = template.indexOf("<template #toolbar>");
    expect(filterAt).toBeGreaterThan(-1);
    // A toolbar slot belongs to a table, so anything inside one shares that
    // table's mount lifetime — the exact defect being fixed. These two pages
    // now have NO toolbar slot at all: search moved up onto the scope row so
    // both live above the tables (see dbmScopeRowLayout.spec.ts), which
    // satisfies the rule more strongly than ordering did. If a toolbar ever
    // comes back, the filter must still precede it.
    if (toolbarAt > -1) expect(filterAt).toBeLessThan(toolbarAt);
  });

  it.each(PAGES)("%s still offers a way to clear the scope", (page) => {
    const template = templateOf(read(page));
    // The control is only honest if the reader can undo it; `clearScope` drops
    // the search and the active insight too.
    expect(template).toContain('@clear="clearScope"');
  });
});

describe("DBM fallback options describe the list on screen", () => {
  /**
   * The options used to derive from the CLIENT rows alone — which are empty
   * exactly when the fallback fires. Hoisting the control without this would
   * have produced a visible filter with five empty selects.
   */
  it.each(PAGES)("%s unions the server rows into the option derivation", (page) => {
    const source = read(page);
    const start = source.indexOf("const dimensionFilters");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("\n});", start));

    // The list must be the REAL fallback rows, gated on fallback mode — not an
    // empty stand-in that merely mentions the name. A mutant that kept
    // `filteredServerRows` only in a type annotation passed a bare
    // `toContain`, so the binding is pinned to its actual value expression.
    expect(block).toMatch(
      /const serverList\s*=\s*serverListShown\.value\s*\?\s*filteredServerRows\.value\s*:\s*\[\]/,
    );

    // …and it must actually REACH the three server-backed dimensions, rather
    // than being computed and then ignored.
    for (const dimension of ["db_instance", "db_system", "db_namespace"]) {
      expect(block).toContain(`serverList.map((r) => r.${dimension})`);
    }
  });

  /**
   * DatabasesPage's rule: only the dimensions the endpoint ACCEPTS are
   * offered, because a select that silently did nothing would be worse than
   * its absence. `/server_queries` and `/server_samples` take system, instance
   * and namespace — not env or service. Verified live: a fallback fetched
   * under `service=<nonexistent>` still returned 50 rows because the server
   * never applied it.
   */
  it.each(PAGES)("%s withholds env/service selects while the fallback shows", (page) => {
    const source = read(page);
    const start = source.indexOf("const dimensionFilters");
    const block = source.slice(start, source.indexOf("\n});", start));

    // The unsupported pair is returned only behind a set-value guard, so a
    // fresh fallback offers three dimensions rather than five.
    expect(block).toContain("envFilter.value ? [{ ...env, options: [] }] : []");
    expect(block).toContain("serviceFilter.value ? [{ ...service, options: [] }] : []");
  });

  /**
   * A value already set on an unsupported dimension is kept as a removable
   * chip rather than silently cleared. It is not inert — env/service still
   * narrow the CLIENT read whose emptiness put the page in fallback — so
   * dropping it would change which list is shown, under a scope the reader
   * never asked to leave.
   */
  it.each(PAGES)("%s keeps a set env/service visible rather than clearing it", (page) => {
    const source = read(page);
    const start = source.indexOf("const dimensionFilters");
    const block = source.slice(start, source.indexOf("\n});", start));
    // Spread from the real entry, so it keeps its model and its onChange —
    // which is what makes the chip removable.
    expect(block).toContain("{ ...env, options: [] }");
    expect(block).toContain("{ ...service, options: [] }");
  });
});

describe("DBM coverage line follows the table", () => {
  /**
   * The stat band was already moved into the fallback subheader; the coverage
   * line was left behind. Both are claims about exactly the rows below them.
   */
  it("QueriesPage renders coverage in the fallback subheader too", () => {
    const template = templateOf(read("QueriesPage.vue"));
    const occurrences = template.match(/<DbmCoverageLine\b/g) ?? [];
    // One for the client table, one for the database-reported list.
    expect(occurrences).toHaveLength(2);
    expect(template).toContain('data-test="dbm-server-queries-coverage"');
  });

  /**
   * `DbmCoverageLine` sums `total_time_ns`; a server row carries `exec_time_s`.
   * Handing it the raw rows would make every row contribute 0, so the line
   * would report "we cannot tell" over a list whose time it can in fact add up.
   */
  it("QueriesPage converts server seconds into the shape coverage measures", () => {
    const source = read("QueriesPage.vue");
    expect(source).toContain("const serverCoverageHits");
    const start = source.indexOf("const serverCoverageHits");
    const block = source.slice(start, source.indexOf("\n);", start));
    expect(block).toContain("total_time_ns");
    // The same conversion the fallback stat tile does, so the two cannot
    // disagree about how much time the list represents.
    expect(block).toContain("1e9");
  });

  /**
   * The failure tile is trace-only, and the coverage line's error count is
   * too: the server feed carries none, and a `0` there would read as an
   * all-clear nobody measured.
   */
  it("QueriesPage withholds the error count from the fallback coverage line", () => {
    const template = templateOf(read("QueriesPage.vue"));
    const start = template.indexOf('data-test="dbm-server-queries-coverage"');
    expect(start).toBeGreaterThan(-1);
    const openedAt = template.lastIndexOf("<DbmCoverageLine", start);
    const block = template.slice(openedAt, start);
    expect(block).not.toContain(":error-count");
  });
});
