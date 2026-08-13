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
 * The fleet page has to open on the question an operator actually arrives with.
 *
 * `load` ranks by `total_time_ns` — cumulative client-observed wait, which is
 * VOLUME. Sorting by it answers "which database is busiest", and on a real
 * fleet that is the same three databases every day and is almost never the
 * incident. `attention` ranks by `healthSortValue`, which is saturation against
 * the engine's own published ceiling, and puts instances we cannot assess at
 * the top rather than burying them.
 *
 * Read off the source, for the reason dbmRequestGuard.spec.ts gives.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "DatabasesPage.vue"), "utf8");

describe("the fleet page opens on health, not on volume", () => {
  it("defaults the sort to the attention column", () => {
    expect(
      source,
      "landing on `load` answers 'who is busiest', which is the wrong question on arrival",
    ).toMatch(/const sortBy = ref\("attention"\)/);
  });

  it("sorts descending, so the row needing attention leads", () => {
    expect(source).toMatch(/const sortOrder = ref<"asc" \| "desc">\("desc"\)/);
  });

  /**
   * The default is only meaningful if the column it names exists and carries
   * the health scalar — a default pointing at a removed or renamed column would
   * silently fall through to server response order, which is the arbitrary
   * ordering the comment above `sortBy` says it exists to prevent.
   */
  it("names a column that exists and is backed by the health scalar", () => {
    expect(source).toMatch(/id: "attention"/);
    expect(source).toMatch(/case "attention":\s*\n\s*return healthSortValue\(row\.metrics\)/);
  });

  /**
   * `load` keeps its column and its own sort semantics. The two measure
   * different things from different vantages, so this pins that the change is a
   * new default and not a removal.
   */
  it("leaves the volume column in place beside it", () => {
    expect(source).toMatch(/id: "load"/);
  });
});

describe("the overview badge counts the fleet it shows", () => {
  /**
   * On a server-vantage-only org (collector wired, no APM) the table is
   * entirely trafficless rows. A badge that filtered them out would read "0"
   * directly above rendered databases — denying working data, which is the one
   * wrong answer the null-vs-0 rule exists to prevent. So the badge counts the
   * rendered fleet union, trafficless included, and a traffic-only filter must
   * not quietly return.
   */
  it("overrides the tab badge with the rendered row count, not a traffic-only count", () => {
    // While loading the page yields (`undefined`) to the shared snapshot's
    // zero-trace fallback instead of stamping a transient 0 over it; the
    // exact fleet count takes over when the union settles.
    expect(source).toMatch(
      /"databaseCount",\s*\n\s*loading\.value \? undefined : fleetRowCount\.value/,
    );
    expect(source).toMatch(/const fleetRowCount = computed\(\(\) => rows\.value\.length\)/);
    expect(
      source,
      "no count on this page may exclude trafficless rows from the fleet total",
    ).not.toMatch(/filter\(\(row\) => !row\.trafficless\)\.length/);
  });

  it("keeps the Databases tile on the same number as the badge", () => {
    expect(source).toMatch(/value: fleetRowCount\.value/);
  });

  /**
   * A trafficless row navigates like any other: Top queries falls back to the
   * database-reported list, and this handoff's system/instance scope filters
   * it to exactly the clicked instance. The old early-return predated the
   * fallback and made every row on a no-APM fleet a dead click.
   */
  it("hands trafficless rows off to Top queries instead of swallowing the click", () => {
    expect(source).not.toMatch(/if \(row\.trafficless\) return;/);
  });
});
