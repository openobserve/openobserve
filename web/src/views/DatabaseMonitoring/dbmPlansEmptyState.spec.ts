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
 * The Plans section must tell "nothing was captured" apart from "one stable
 * shape was captured".
 *
 * The two states look adjacent and are not. "No plans captured" sends the
 * reader to their collector config; "one stable plan" is the ordinary healthy
 * answer and must SHOW them the plan. Render the config hint over a query whose
 * plan was captured and the page tells a DBA to switch on a flag that is
 * already on, while hiding the plan the API just returned — the exact
 * misdiagnosis this file exists to prevent.
 *
 * `planDriftLevel` already separates them (`none` = zero hits, `stable` = one),
 * and plans.spec.ts pins that arithmetic. What is pinned HERE is that the
 * template branches on that three-valued level rather than collapsing it to a
 * drift boolean — the wiring, which no unit test of the util can see.
 *
 * Read off the source rather than by mounting, for the reason
 * dbmSectionTabCounts.spec.ts and dbmRequestGuard.spec.ts give: this view needs
 * a router, a store and a dozen O2 children, and a harness that heavy fails for
 * reasons unrelated to the wiring and gets deleted the first time it does.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = () => readFileSync(join(here, "QueryDetailPage.vue"), "utf8");

/** The `<section data-test="dbm-detail-plans">` block, template only. */
const plansSection = (): string => {
  const text = source();
  const open = text.indexOf('data-test="dbm-detail-plans"');
  expect(open, "QueryDetailPage must render the plans section").toBeGreaterThan(-1);
  const close = text.indexOf("</section>", open);
  expect(close, "the plans section must be closed").toBeGreaterThan(open);
  return text.slice(open, close);
};

/** The branch guarding the "No plans captured" copy. */
const emptyStateGuard = (): string => {
  const section = plansSection();
  const hint = section.indexOf("plans.noPlans");
  expect(hint, "the plans section must carry a no-plans empty state").toBeGreaterThan(-1);
  // Walk back to the v-if/v-else-if that opens the branch holding the copy.
  const guards = [...section.slice(0, hint).matchAll(/v-(?:else-)?if="([^"]+)"/g)];
  expect(guards.length, "the empty state must sit behind a guard").toBeGreaterThan(0);
  return guards[guards.length - 1][1];
};

describe("the Plans empty state means zero captures, not zero drift", () => {
  /**
   * The defect shape: gating the config hint on the absence of DRIFT. `stable`
   * is not drift and is not emptiness, so any guard that swallows `stable`
   * shows a "turn capture on" hint over a query whose plan WAS captured.
   */
  it("does not show the config hint merely because no drift was detected", () => {
    const guard = emptyStateGuard();

    // A guard that fires on "not drifted" — however it is spelled — is the bug.
    expect(
      guard,
      `the no-plans hint is gated on "${guard}", which is true for a stable plan`,
    ).not.toMatch(
      /drift\s*!==\s*['"]drifted['"]|!\s*\w*[Dd]rift\b|drift(?:Detected)?\s*===\s*false/,
    );
  });

  /**
   * The positive half: the hint fires on emptiness. Every honest signal is
   * accepted — `plans.length === 0`, the level's own `none`, or an empty-REASON
   * of `captureOff` — because all three mean zero captures and plans.spec.ts
   * pins them equivalent (`planEmptyReason` returns a reason at all only when
   * `hits.length === 0`).
   */
  it("shows the config hint exactly when nothing was captured", () => {
    const guard = emptyStateGuard();
    expect(guard, `"${guard}" must test for zero captured plans`).toMatch(
      /plans\.length\s*===\s*0|!plans\.length|planDrift\s*===\s*['"]none['"]|planEmpty\s*===\s*['"]captureOff['"]/,
    );
  });

  /**
   * The consequence a reader actually sees: a stable capture reaches the list.
   * The stable caveat and the plan loop must NOT be nested inside the
   * empty-state branch, or the caveat renders over an empty section.
   */
  it("renders the captured plans when one stable shape was seen", () => {
    const section = plansSection();
    const hintAt = section.indexOf("plans.noPlans");
    const caveatAt = section.indexOf("dbm-detail-plans-stable");
    const loopAt = section.indexOf('v-for="plan in plans"');

    expect(caveatAt, "the stable caveat must exist").toBeGreaterThan(-1);
    expect(loopAt, "the plan list must exist").toBeGreaterThan(-1);
    // Both must live in a branch that is a SIBLING of the empty state, i.e.
    // after it and outside it — never as its children.
    expect(caveatAt, "the stable caveat must not sit inside the no-plans branch").toBeGreaterThan(
      hintAt,
    );
    expect(loopAt, "the plan list must not sit inside the no-plans branch").toBeGreaterThan(hintAt);
  });

  /**
   * The two causes of zero plans get two different sentences.
   *
   * Capture off is a config problem the reader can fix. Capture on with no plan
   * for THIS statement is normal — `COMMIT`, `ROLLBACK` and `SHOW` cannot be
   * EXPLAINed — and showing the config hint over it tells a DBA to switch on a
   * flag that is already on. The template must therefore branch on the reason,
   * not render one sentence for both.
   */
  it("branches the empty state on why there are no plans", () => {
    const section = plansSection();
    expect(
      section,
      "the empty state must render the unplannable-statement copy for capture-on",
    ).toContain("plans.noPlanForQuery");

    // Both sentences must be reachable, i.e. guarded against each other rather
    // than one of them being dead markup below an unconditional branch.
    const reasonGuards = [...section.matchAll(/v-(?:else-)?if="([^"]*planEmpty\b[^"]*)"/g)];
    expect(
      reasonGuards.length,
      "each empty-state sentence must be guarded on the reason",
    ).toBeGreaterThanOrEqual(2);
  });

  it("keeps the config hint behind the capture-off reason only", () => {
    const section = plansSection();
    const hintAt = section.indexOf("plans.noPlansHint");
    expect(hintAt, "the config hint must still exist").toBeGreaterThan(-1);
    // The nearest guard above the config hint must name the capture-off case.
    const guards = [...section.slice(0, hintAt).matchAll(/v-(?:else-)?if="([^"]+)"/g)];
    expect(guards.length, "the config hint must sit behind a guard").toBeGreaterThan(0);
    expect(
      guards[guards.length - 1][1],
      "the ZO_DB_MONITORING_TOP_QUERY_ENABLED hint may only render when capture is OFF",
    ).toContain("captureOff");
  });

  /**
   * W3 honesty contract, forced by a DBA review. These must survive any change
   * to the branching above: the section stays labelled a generic, null-bound
   * ESTIMATE, and carries no per-plan latency. A plan captured under
   * `force_generic_plan` with NULL binds never executed, so any duration beside
   * it would be borrowed from a different plan's real runs — invented causality.
   */
  it("keeps the generic null-bound labelling on the section", () => {
    const section = plansSection();
    expect(section).toContain('type="dataConfidence"');
    expect(section).toContain('value="gap"');
    expect(section).toContain("plans.sourceLabel");
    expect(section).toContain("plans.sourceTooltip");
  });

  it("attaches no latency to any plan", () => {
    const section = plansSection();
    expect(section).not.toMatch(/plan\.(latency|duration|avgTime|meanTime|elapsed)/i);
    expect(section).not.toMatch(/formatDuration\(\s*plan\./);
  });
});
