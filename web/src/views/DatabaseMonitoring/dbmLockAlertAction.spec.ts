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
 * "Alert me" reaches the lock surfaces.
 *
 * The action existed on Top queries and Databases only, so an operator looking
 * at a blocking chain or a deadlock — the two pages people arrive at DURING an
 * incident — had to leave and rebuild the query by hand.
 *
 * WHAT THIS PINS IS WIRING, deliberately. Whether the row's action list offers
 * the item, whether the handler routes it, and whether the prefill is built
 * from the row rather than a constant. The VALUES the prefill contains — the
 * SQL, the threshold, the warnings, the provenance in the name — belong to
 * `utils/alerts/prefill/fromDbmLocks.ts` and are pinned by its own unit tests
 * against the real builder. Splitting it that way is the rule these sibling
 * specs follow, and it is why this file asserts no SQL.
 *
 * Read off the source rather than by mounting: these views need a router, a
 * store and a dozen O2 children, and a harness that heavy would fail for
 * reasons unrelated to the action and get deleted the first time it did. Same
 * convention as the sibling specs in this directory.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/**
 * The two lock surfaces, with the row field each one's alert must be scoped by
 * and the condition it fires on.
 */
const LOCK_PAGES = [
  { page: "BlockedQueriesPage.vue", kind: "blocking" },
  { page: "DeadlocksPage.vue", kind: "deadlocks" },
];

describe("the lock surfaces can create an alert from the row on screen", () => {
  it.each(LOCK_PAGES)("$page imports the lock adapter, not the rollup one", ({ page }) => {
    const source = read(page);
    expect(source).toContain('from "@/utils/alerts/prefill/fromDbmLocks"');
    expect(source).toContain("buildDbmLockPrefill");
    // The rollup adapter reads client-observed spans from a different stream.
    // Using it here would alert on query latency while claiming to alert on
    // locks — the provenance confusion the honesty contract exists to prevent.
    expect(source, "locks are server-vantage; fromDbm reads client spans").not.toContain(
      'from "@/utils/alerts/prefill/fromDbm"',
    );
  });

  it.each(LOCK_PAGES)("$page routes the action through the shared launcher", ({ page }) => {
    const source = read(page);
    expect(source).toContain('from "@/composables/alerts/useAlertCreation"');
    expect(source).toContain("requestAlertCreation(");
  });

  /**
   * An action the handler does not implement is worse than no action — both
   * pages' own comments say so where they list their row actions.
   */
  it.each(LOCK_PAGES)("$page offers the action in its row menu", ({ page }) => {
    const source = read(page);
    const actions = source.split("const rowActions")[1]?.split("\n);")[0] ?? "";
    expect(actions, "rowActions must exist").not.toBe("");
    expect(actions).toContain('id: "alert"');
  });

  it.each(LOCK_PAGES)("$page handles the action it advertises", ({ page }) => {
    const source = read(page);
    const handler = source.split("const onRowAction")[1]?.split("\nconst ")[0] ?? "";
    expect(handler, "onRowAction must exist").not.toBe("");
    expect(handler).toContain('id === "alert"');
    expect(handler).toContain("buildDbmLockPrefill");
  });

  /**
   * Scoped to the ROW, not to a page-level constant. An alert that silently
   * watches a different database than the one the operator was looking at is
   * the defect this whole flow exists to avoid, and it is invisible until the
   * alert fails to fire months later.
   */
  it.each(LOCK_PAGES)("$page scopes the prefill to the row's database", ({ page }) => {
    const source = read(page);
    const handler = source.split("const onRowAction")[1]?.split("\nconst ")[0] ?? "";
    expect(handler).toMatch(/dbSystem:\s*row\.db_system/);
    expect(handler).toMatch(/dbInstance:\s*row\.db_instance/);
  });

  it.each(LOCK_PAGES)("$page asks for the condition its own surface shows", ({ page, kind }) => {
    const source = read(page);
    const handler = source.split("const onRowAction")[1]?.split("\nconst ")[0] ?? "";
    expect(handler).toContain(`kind: "${kind}"`);
  });
});

/**
 * The observation the threshold is derived from has to come from the window the
 * user is actually looking at. Passing nothing would silently arm every alert
 * at the module's floor, which reads as a considered default but is not one.
 */
describe("the suggested threshold is derived from what is on screen", () => {
  it("BlockedQueriesPage hands over the wait it measured", () => {
    const handler =
      read("BlockedQueriesPage.vue").split("const onRowAction")[1]?.split("\nconst ")[0] ?? "";
    expect(handler).toMatch(/observedWaitSeconds:/);
  });

  it("DeadlocksPage hands over the event count it measured", () => {
    const handler =
      read("DeadlocksPage.vue").split("const onRowAction")[1]?.split("\nconst ")[0] ?? "";
    expect(handler).toMatch(/observedEvents:/);
  });
});
