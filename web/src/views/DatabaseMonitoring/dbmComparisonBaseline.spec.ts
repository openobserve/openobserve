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
 * The comparison baseline has to be selectable, and it has to be NAMED (W5/B12).
 *
 * `useDbmScope` computes the baseline window and `insightRuleText` resolves the
 * name into each rule line; both are unit-tested on their own. What this pins
 * is the WIRING, which is where the honesty contract is actually at risk:
 *
 *  • The comparison fetch must use the SELECTED baseline window. Leaving it on
 *    `previous` while the picker says "yesterday" would label one measurement
 *    with another's provenance — the precise failure the contract forbids.
 *  • The strip must be told which baseline produced its numbers, or its rule
 *    lines silently describe a comparison that did not happen.
 *
 * Read off the source, for the reason dbmRequestGuard.spec.ts gives.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "QueriesPage.vue"), "utf8");

describe("the comparison baseline is selectable", () => {
  it("takes the baseline and its window from the shared scope", () => {
    expect(source).toMatch(/baselineWindow/);
    expect(source).toMatch(/setBaseline/);
  });

  /**
   * The load that produces every delta and every insight must read the SELECTED
   * window. A fetch still pinned to `previous` would leave the picker changing
   * the label while the arithmetic underneath never moved.
   */
  it("fetches the comparison window the reader chose", () => {
    // The baseline rides the SAME request as the current window
    // (`baseline_start_time`/`baseline_end_time`), so what is pinned is that
    // its bounds come from the reader's baseline choice.
    expect(source).toMatch(/baselineStartTime: baselineWindow\.value\.startTime/);
    expect(source).toMatch(/baselineEndTime: baselineWindow\.value\.endTime/);
    expect(
      source,
      "a comparison fetch still welded to `previous` ignores the reader's choice",
    ).not.toMatch(/baselineStartTime: previous\.value\.startTime/);
  });

  /** The strip cannot name a baseline it was never given. */
  it("tells the insight strip which baseline produced its numbers", () => {
    expect(source).toMatch(/:baseline="baseline"/);
  });

  /** Rule text goes through the shared resolver, never a second local copy. */
  it("renders rule text through the shared resolver", () => {
    expect(source).toContain("insightRuleText");
    expect(source).not.toContain("insightRuleParams");
  });

  it("offers the reader a control to change it", () => {
    expect(source).toMatch(/data-test="dbm-queries-baseline"/);
    expect(source).toMatch(/onBaselineChange/);
  });

  /** Changing the baseline has to re-fetch, or the table keeps stale deltas. */
  it("reloads when the baseline changes", () => {
    const handler = source.slice(source.indexOf("const onBaselineChange"));
    expect(handler.slice(0, handler.indexOf("};"))).toContain("load()");
  });
});
