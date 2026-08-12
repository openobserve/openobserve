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
 * The Activity table has to hand off to Query Detail (W4/B13).
 *
 * `activityQueryDetailTarget` decides WHERE a row goes and is unit-tested on
 * its own in `utils/dbm/activity.spec.ts` — including the refusal to navigate a
 * session that names no query. But the defect this closes was never in that
 * decision: it was that the page had no row navigation at all, so an operator
 * watching one session saturate an instance retyped its fingerprint into the
 * Queries search. The regression worth pinning here is therefore the WIRING —
 * that the table binds a row click, and that the handler routes through the
 * helper rather than assembling a route of its own.
 *
 * Read off the source rather than by mounting: this view needs a router, a
 * store and a dozen O2 children, and a harness that heavy would fail for
 * reasons unrelated to the hand-off and get deleted the first time it did.
 * Same convention as the sibling specs in this directory.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "ActivityPage.vue"), "utf8");

describe("an Activity row hands off to its query detail", () => {
  it("binds a row click on the table", () => {
    expect(
      source,
      "with no @row-click the row is inert and the fingerprint has to be retyped",
    ).toMatch(/@row-click="onRowClick"/);
  });

  it("defines the handler the table binds", () => {
    expect(source).toMatch(/const onRowClick = \(/);
  });

  /**
   * The destination must come from the shared helper, not from a route object
   * hand-assembled at the call site. A second copy of this decision is how the
   * no-fingerprint guard gets lost: the helper is where that refusal lives and
   * where it is tested.
   */
  it("resolves the destination through the shared helper", () => {
    expect(source).toContain("activityQueryDetailTarget");
    expect(source).toMatch(/from "@\/utils\/dbm\/activity"/);
  });

  /**
   * A row the helper declined must not navigate. Pinned as the early return
   * that reads the helper's null — the same shape as the fleet page's
   * trafficless guard.
   */
  it("declines the hop when the helper returns no target", () => {
    expect(source).toMatch(/if \(!target\) return;/);
  });

  /** It goes to the query detail route, and carries the helper's target. */
  it("pushes the query detail route with the resolved target", () => {
    expect(source).toMatch(/name: "dbmQueryDetail"/);
    expect(source).toMatch(/\.\.\.target/);
  });
});
