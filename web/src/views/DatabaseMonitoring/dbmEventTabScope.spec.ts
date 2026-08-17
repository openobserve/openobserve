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
 * The four EVENT tabs now carry scope, and it must never apply invisibly.
 *
 * Activity, Deadlocks, Blocked queries and Table health each accept
 * `system`/`instance`/`namespace` on the wire (Table health takes only the
 * first two) and each IGNORED them: the tab strip spreads `carriedQuery` into
 * every tab link, so a reader who set an engine on Overview and clicked
 * through arrived at a page that showed the whole fleet under a URL claiming
 * otherwise. Deadlocks was the sharpest case — it WROTE `system` into the URL
 * on both drill-outs and then ignored it on arrival, producing scoped links it
 * could not itself honour.
 *
 * What is pinned here is the invariant that makes the fix safe rather than the
 * wiring that implements it: a dimension may not reach the REQUEST unless the
 * same page also renders a CLEARABLE control for it. That is the
 * applied-but-invisible defect `dbmFallbackScopeVisible.spec.ts` pins on the
 * two trace pages, arriving here by a different route.
 *
 * Source-read, like its two siblings and for the same reason: these views need
 * a router, a store and a dozen O2 children to mount, and a harness that heavy
 * fails for unrelated reasons and gets deleted. The claims below are
 * structural and survive that.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/** The four tabs that gained scope, with the dimensions each endpoint accepts. */
const PAGES = [
  { file: "ActivityPage.vue", dimensions: ["system", "instance", "namespace"] },
  { file: "DeadlocksPage.vue", dimensions: ["system", "instance", "namespace"] },
  { file: "BlockedQueriesPage.vue", dimensions: ["system", "instance", "namespace"] },
  // Table health takes NO namespace — its feed carries no database at all.
  { file: "TableHealthPage.vue", dimensions: ["system", "instance"] },
] as const;

/**
 * The template half of an SFC — everything before `<script setup`.
 *
 * The structural claims below are about MARKUP, and the script holds strings
 * (`"DbmScopeFilters"` in an import) that would otherwise satisfy a naive
 * `toContain` and let the real regression through.
 */
const templateOf = (source: string): string => {
  const end = source.indexOf("<script setup");
  expect(end, "SFC must have a <script setup> block").toBeGreaterThan(-1);
  return source.slice(0, end);
};

describe("the event tabs render their scope, exactly once and outside the table", () => {
  it.each(PAGES)("$file renders DbmScopeFilters exactly once", ({ file }) => {
    const template = templateOf(read(file));
    const occurrences = template.match(/<DbmScopeFilters\b/g) ?? [];
    // Exactly one, so there is ONE source of truth for the filter state and no
    // duplicated DOM in any state where two tables could mount.
    expect(occurrences).toHaveLength(1);
  });

  /**
   * The control must never share a mount lifetime with something that can hide
   * it — a filter that unmounts while still being SENT is the whole defect.
   *
   * On these four tabs that is satisfied by the table being unconditional:
   * each renders ONE `<OTable>` with no `v-if`, so its toolbar is always on
   * screen and the filter rides there beside search (one row instead of two —
   * see dbmScopeRowLayout.spec.ts). The pages where the table DOES disappear
   * are Top queries and Slowest calls, and `dbmFallbackScopeVisible.spec.ts`
   * keeps the control above both tables there.
   *
   * So what is pinned here is the premise rather than the position: if one of
   * these tables ever becomes conditional, this fails and the filter has to
   * move back out.
   */
  it.each(PAGES)("$file renders its table unconditionally", ({ file }) => {
    const template = templateOf(read(file));
    const tableAt = template.indexOf("<OTable");
    expect(tableAt, `${file} must render a table`).toBeGreaterThan(-1);

    // The props of that one table, up to the end of its opening tag.
    const openingTag = template.slice(tableAt, template.indexOf(">", tableAt));
    expect(
      openingTag,
      `${file} gates its table — the scope control must move out of the toolbar`,
    ).not.toContain("v-if");
  });

  it.each(PAGES)("$file offers a way to clear the scope", ({ file }) => {
    // The control is only honest if the reader can undo what it applied.
    expect(templateOf(read(file))).toContain('@clear="clearScope"');
  });
});

describe("the event tabs read scope from the URL and send it", () => {
  /**
   * Seeded from `route.query`, which is how scope carried in from a sibling tab
   * arrives. Reading it at setup is what turns the tab strip's `carriedQuery`
   * spread from a decorative URL into an applied filter.
   */
  it.each(PAGES)("$file seeds its filters from the route query", ({ file }) => {
    const source = read(file);
    expect(source).toContain("useDbmScopeFilters({");
    expect(source).toMatch(/query:\s*route\.query/);
  });

  /**
   * The request half. `requestParams` is derived from the same refs the
   * toolbar renders, so a dimension cannot reach the wire without also being
   * offered as a clearable control — that is the invariant, enforced by
   * construction rather than by each page remembering.
   */
  it.each(PAGES)("$file spreads the scope into its request", ({ file }) => {
    const source = read(file);
    const start = source.indexOf("const load = () =>");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, start + 1400);

    expect(block).toContain("...scopeParams.value");
  });

  /**
   * The URL half. Without it a filter narrows the table while the route (and
   * everything reading it — the shell's badge fan-out, a shared link, a
   * reload) still describes the unfiltered question.
   */
  it.each(PAGES)("$file publishes the scope back to the URL", ({ file }) => {
    const source = read(file);
    const start = source.indexOf("const syncUrl = () =>");
    expect(start, `${file} must define its own syncUrl`).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("\n};", start));

    expect(block).toContain("...scopeQuery.value");
    // `replace`, not `push`: a filter change is not a navigation the back
    // button should have to walk through.
    expect(block).toContain("router\n    .replace(");
  });

  /**
   * The page must hand its own `syncUrl` to the shared spine, or a DATE change
   * would fall back to the default writer and silently drop the filters from
   * the URL while leaving them applied to the table.
   */
  it.each(PAGES)("$file rides its syncUrl on the shared date change", ({ file }) => {
    expect(read(file)).toContain("syncUrl: () => syncUrl()");
  });
});

describe("only the dimensions an endpoint accepts are offered", () => {
  /**
   * DatabasesPage's rule: a select that silently did nothing would be worse
   * than its absence. `/table_health` takes no `namespace` — the feed carries
   * no database, so every value a reader could pick would return nothing.
   */
  it("TableHealthPage withholds the namespace dimension", () => {
    const source = read("TableHealthPage.vue");
    expect(source).toContain('dimensions: ["instance", "system"]');
  });

  it.each(PAGES.filter((p) => p.dimensions.length === 3))(
    "$file offers all three dimensions",
    ({ file }) => {
      const source = read(file);
      const start = source.indexOf("useDbmScopeFilters({");
      const block = source.slice(start, source.indexOf("});", start));
      // No `dimensions:` override means the composable's default — all three.
      expect(block).not.toContain("dimensions:");
    },
  );

  /**
   * Options must come from a ref that actually CARRIES the dimension.
   * `DeadlockRow` and `BlockedRow` both drop `db_namespace` in their builders,
   * so deriving from the rendered rows would offer an empty schema select on
   * exactly the two pages whose wire rows have one.
   */
  it("DeadlocksPage derives options from the events, which carry the namespace", () => {
    const source = read("DeadlocksPage.vue");
    const start = source.indexOf("useDbmScopeFilters({");
    const block = source.slice(start, source.indexOf("});", start));

    expect(block).toContain("events.value.map((e) => e.db_namespace)");
  });

  it("BlockedQueriesPage derives options from the samples, which carry the namespace", () => {
    const source = read("BlockedQueriesPage.vue");
    const start = source.indexOf("useDbmScopeFilters({");
    const block = source.slice(start, source.indexOf("});", start));

    expect(block).toContain("samples.value.map((s) => s.db_namespace)");
  });
});

describe("Deadlocks no longer writes a scope it cannot honour", () => {
  /**
   * THE inconsistency this task set out to close. Both drill-outs put
   * `system: row.db_system` in the destination URL, and the page ignored
   * `system` on arrival — so following its own link changed the URL and not
   * the table.
   */
  it("still writes system on its drill-outs", () => {
    const source = read("DeadlocksPage.vue");
    expect(source).toContain("system: row.db_system");
  });

  it("and now reads it back", () => {
    const source = read("DeadlocksPage.vue");
    // The seed is what closes the loop: the same key it writes is the key it
    // reads at setup.
    const start = source.indexOf("useDbmScopeFilters({");
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, source.indexOf("});", start))).toContain("query: route.query");
  });

  /**
   * The "widen the window" empty-state action used to hand-roll its own
   * `router.replace` with only the range params, dropping the filters from the
   * URL while leaving them applied. It goes through the page's `syncUrl` now.
   */
  it("widens the window through syncUrl, so the filters ride along", () => {
    const source = read("DeadlocksPage.vue");
    const start = source.indexOf('if (id === "widen")');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, start + 400);

    expect(block).toContain("syncUrl();");
    expect(block).not.toContain("router.replace(");
  });
});
