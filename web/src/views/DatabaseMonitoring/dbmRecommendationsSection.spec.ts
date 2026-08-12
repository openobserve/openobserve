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
 * W11 · The Recommendations section's WIRING.
 *
 * The arithmetic of every rule is pinned in `utils/dbm/recommendations.spec.ts`
 * against pure functions. What cannot be seen from there is whether the page
 * actually calls them, and whether it renders the honesty properties the rules
 * depend on. Three things are pinned here:
 *
 *   • The section reads `getIndexHealth` — the rule is worthless if the page
 *     never fetches the data it predicates on.
 *   • The lifetime-counter disclosure is rendered, and gated on the API's own
 *     flag rather than hardcoded. Without it "not scanned" reads as a claim
 *     about the selected time range, which a cumulative counter cannot support.
 *   • The empty state distinguishes "nothing crossed a threshold" from "some
 *     checks did not run on this engine". Collapsing them tells a MySQL user
 *     they have no unused indexes when the check never ran.
 *
 * Read off the SOURCE rather than by mounting, following the convention the six
 * sibling specs in this directory set: this view needs a router, a store and a
 * dozen O2 children, and a harness that heavy fails for reasons unrelated to
 * the wiring and gets deleted the first time it does. Values live in pure
 * functions with their own unit tests.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = () => readFileSync(join(here, "TableHealthPage.vue"), "utf8");

describe("recommendations section wiring", () => {
  it("fetches index health, or the unused-index rule has nothing to read", () => {
    expect(source()).toContain("getIndexHealth");
  });

  it("runs the rules through buildRecommendations rather than re-deriving them", () => {
    const src = source();
    expect(src).toContain("buildRecommendations");
    // The page must not re-implement a predicate the util owns; a second copy
    // of `idx_scan_count === 0` here could silently disagree with the rule.
    expect(src).not.toMatch(/idx_scan_count\s*===\s*0/);
  });

  it("renders the lifetime-counter disclosure from the API's own flag", () => {
    const src = source();
    expect(src).toContain("dbm.recommendations.countersCumulative");
    // Gated on the response flag: a build that omits it has not made the claim,
    // and rendering the sentence anyway would invent a disclosure.
    expect(src).toMatch(/counters_are_cumulative/);
  });

  it("keeps 'nothing found' apart from 'not collected for this engine'", () => {
    const src = source();
    expect(src).toContain("recommendationsEmptyCause");
    expect(src).toContain("dbm.recommendations.enginePartialTitle");
    expect(src).toContain("dbm.recommendations.allClearTitle");
  });

  it("shows each rule's arithmetic, so a card can be audited", () => {
    expect(source()).toContain("recommendationRuleParams");
  });

  /**
   * These are deterministic predicates over counters. Gating them on
   * `ai_enabled`/`isEnterprise` — the gate `DbmSuggestFixButton` applies —
   * would make an OSS-only feature enterprise-only by association.
   */
  it("does not gate the section on the AI or enterprise flags", () => {
    const src = source();
    // Anchored on the CALL, not on the word: "recommendations" also appears in
    // this page's prose, so an `indexOf` on the bare word matches a comment and
    // makes the assertions below vacuously true on a page with no section.
    const at = src.indexOf("buildRecommendations");
    expect(at).toBeGreaterThan(-1);
    const section = src.slice(at);
    expect(section).not.toContain("ai_enabled");
    expect(section).not.toContain("isEnterprise");
  });

  /**
   * THE VOLUME FIX. `buildRecommendations` emits one entry PER DETECTED ITEM,
   * so a database with fifteen blocked sessions rendered fifteen list items and
   * the strip became a wall nobody read. The page must render the COLLAPSED
   * list — one row per rule — rather than iterating the raw one.
   */
  it("renders one row per rule, not one per detected item", () => {
    const src = source();
    expect(src).toContain("collapseRecommendations");
    // The v-for must walk the collapsed list. Iterating `recommendations`
    // directly is the uncapped rendering this replaced.
    expect(src).toMatch(/v-for="entry in collapsedRecommendations"/);
    expect(src).not.toMatch(/v-for="rec in recommendations"/);
  });

  /**
   * Collapsing is only honest if the reader can SEE that entries are hidden.
   * The row that stands for several must say how many, and must say it ONLY
   * when something is actually hidden — a bare "and 0 more" would claim a
   * remainder that does not exist.
   */
  it("discloses the entries a collapsed row stands for", () => {
    const src = source();
    expect(src).toContain("dbm.recommendations.andMore");
    expect(src).toMatch(/hiddenCount\s*>\s*0/);
  });
});
