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
 * Read off the source, for the reason dbmRequestGuard.spec.ts gives.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = () => readFileSync(join(here, "QueryDetailPage.vue"), "utf8");

/**
 * The `<DbmSection data-test="dbm-detail-plans">` block, template only. The
 * card shell is the shared `DbmSection` component now — the section markup
 * itself was identical across six cards — so the block closes on that tag.
 */
const plansSection = (): string => {
  const text = source();
  const open = text.indexOf('data-test="dbm-detail-plans"');
  expect(open, "QueryDetailPage must render the plans section").toBeGreaterThan(-1);
  const close = text.indexOf("</DbmSection>", open);
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
   * Asserted by ORDER: the stable caveat and the plan loop must appear after
   * the no-plans copy, which is where the sibling `v-else` branches place
   * them. A source scan cannot prove nesting outright, so this pins the
   * ordering that arrangement produces.
   */
  it("renders the captured plans when one stable shape was seen", () => {
    const section = plansSection();
    const hintAt = section.indexOf("plans.noPlans");
    const caveatAt = section.indexOf("dbm-detail-plans-stable");
    const loopAt = section.indexOf('v-for="plan in plans"');

    expect(caveatAt, "the stable caveat must exist").toBeGreaterThan(-1);
    expect(loopAt, "the plan list must exist").toBeGreaterThan(-1);
    expect(caveatAt, "the stable caveat must follow the no-plans copy").toBeGreaterThan(hintAt);
    expect(loopAt, "the plan list must follow the no-plans copy").toBeGreaterThan(hintAt);
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

/**
 * The drift finding is promoted; the section is not.
 *
 * "It got slow because the plan changed" is the most actionable sentence this
 * page can produce, and the section that computes it used to sit below three
 * tables. The contract pinned here: the FINDING surfaces beside the headline
 * stats — only when there IS drift, reusing the section's own state and copy —
 * and the plans section itself reads before the raw samples it explains.
 */
describe("the drift finding is promoted and plans precede samples", () => {
  /** The promoted callout's opening tag, attributes included. */
  const topCalloutTag = (): string => {
    const text = source();
    const at = text.indexOf('data-test="dbm-detail-plans-drift-top"');
    expect(at, "the promoted drift callout must exist").toBeGreaterThan(-1);
    const open = text.lastIndexOf("<OBanner", at);
    expect(open, "the callout must be an OBanner").toBeGreaterThan(-1);
    return text.slice(open, text.indexOf(">", at));
  };

  it("renders the top callout only when drift was detected", () => {
    // Anything looser than the drifted level breaks the page's discipline that
    // only exceptions get a chip — a no-drift page must be unchanged.
    expect(topCalloutTag()).toContain(`v-if="planDrift === 'drifted'"`);
  });

  it("reuses the plans section's drift statement rather than recomputing", () => {
    const text = source();
    const at = text.indexOf('data-test="dbm-detail-plans-drift-top"');
    const block = text.slice(at, text.indexOf("</OBanner>", at));
    expect(block, "the callout must quote the section's own drift copy").toContain(
      "dbm.detail.plans.driftCallout",
    );
    expect(block, "the callout must jump to the plans section").toContain('@click="scrollToPlans"');
  });

  /**
   * The page is tabbed now, so "order" is TAB order rather than scroll order —
   * but the contract it encodes is unchanged and is the reason the tab split
   * was drawn where it was: the diagnosis reads before the raw evidence.
   *
   * Plans has its own tab; the endpoints table and the samples scatter share
   * the one after it, because both are trace-vantage reads off the same
   * resolved stream. So plans must precede BOTH of them, where the old
   * single-column stack had the callers table above it.
   */
  it("orders the tabs plans → callers, with the two trace sections together", () => {
    const text = source();
    const plansAt = text.indexOf('data-test="dbm-detail-plans"');
    const endpointsAt = text.indexOf('data-test="dbm-detail-endpoints"');
    const samplesAt = text.indexOf('data-test="dbm-detail-samples"');
    expect(endpointsAt).toBeGreaterThan(-1);
    expect(plansAt).toBeGreaterThan(-1);
    expect(samplesAt).toBeGreaterThan(-1);
    // Diagnosis before rawest evidence: samples are individual executions, the
    // plan is the explanation, and the explanation reads first.
    expect(plansAt, "plans must sit above the samples").toBeLessThan(samplesAt);
    expect(plansAt, "plans must sit above the callers table too").toBeLessThan(endpointsAt);

    // And the grouping itself: both trace sections live on ONE panel, so no
    // panel boundary may separate them.
    const between = text.slice(endpointsAt, samplesAt);
    expect(between, "endpoints and samples must share a tab panel").not.toContain("<OTabPanel");
  });

  /**
   * The jump the drift callout performs now crosses a tab boundary, and the
   * inactive panel is UNMOUNTED (`OTabPanel` defaults to `v-if`) — so the
   * section it scrolls to does not exist at click time. Scrolling before the
   * switch has rendered is a silent no-op that looks exactly like a jump
   * nobody clicked, which is the failure `dbmPlansJump.spec.ts` exists to
   * prevent. The handler must therefore select the tab and await a tick.
   */
  it("selects the plans tab before scrolling to it", () => {
    const text = source();
    const at = text.indexOf("const scrollToPlans");
    expect(at, "the jump handler must exist").toBeGreaterThan(-1);
    const handler = text.slice(at, text.indexOf("\n};", at));

    expect(handler, "the jump must switch to the plans tab").toContain('selectTab("plans")');
    expect(handler, "the jump must wait for the panel to mount").toContain("await nextTick()");
    expect(handler).toContain("scrollIntoView");
    // Order matters: scrolling first would aim at an unmounted section.
    expect(handler.indexOf('selectTab("plans")')).toBeLessThan(handler.indexOf("scrollIntoView"));
    expect(handler.indexOf("await nextTick()")).toBeLessThan(handler.indexOf("scrollIntoView"));
  });
});
