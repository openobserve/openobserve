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
 * W-E3: plan provenance is PER ROW, and a duration renders on a row if and
 * only if that row carries one.
 *
 * Two producers feed the Plans section now. The generic NULL-bound estimate
 * was never executed and must keep its `gap` tag and show no latency; an
 * auto_explain row is the plan Postgres really ran and may show its measured
 * durations, phrased as captured executions. The failure this file exists to
 * prevent is the one the DBA cold review forced the contract for: a latency
 * rendered beside a plan that never ran, or a section-level label that calls
 * an executed plan an estimate.
 *
 * Read off the source rather than by mounting, for the reason
 * dbmPlansEmptyState.spec.ts gives: this view needs a router, a store and a
 * dozen O2 children, and a harness that heavy fails for unrelated reasons.
 * plans.spec.ts pins the row arithmetic; what is pinned HERE is the wiring —
 * which guard sits on which template branch.
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

/** The per-plan `<article>` loop body. */
const planLoop = (): string => {
  const section = plansSection();
  const at = section.indexOf('v-for="plan in plans"');
  expect(at, "the plan list must exist").toBeGreaterThan(-1);
  return section.slice(at);
};

describe("per-row plan provenance", () => {
  it("moves the gap tag off the section header and onto generic rows only", () => {
    const section = plansSection();
    const loopAt = section.indexOf('v-for="plan in plans"');
    const beforeLoop = section.slice(0, loopAt);

    // The header must no longer brand EVERY plan an estimate — with two
    // producers that label is wrong for half the rows.
    expect(beforeLoop, "a section-level gap tag calls executed plans estimates").not.toContain(
      'value="gap"',
    );

    // Inside the loop the gap tag survives, guarded to the generic rows.
    const loop = planLoop();
    const gapAt = loop.indexOf('value="gap"');
    expect(gapAt, "generic rows must keep their gap tag").toBeGreaterThan(-1);
    const guards = [...loop.slice(0, gapAt).matchAll(/v-(?:else-)?if="([^"]+)"|v-else\b/g)];
    expect(guards.length, "the gap tag must sit behind a provenance guard").toBeGreaterThan(0);
    // The guard chain keys on planSource — the row's provenance, nothing else.
    expect(loop.slice(0, gapAt)).toMatch(/plan\.planSource\s*===\s*'auto_explain'/);
  });

  it("labels executed rows as executed, with the slow-tail caveat in reach", () => {
    const loop = planLoop();
    expect(loop).toContain("dbm.detail.plans.executedLabel");
    expect(loop).toContain("dbm.detail.plans.executedTooltip");
  });

  it("renders a duration exactly when the hit carries one", () => {
    const loop = planLoop();
    const durationAt = loop.indexOf("dbm.detail.plans.capturedDurations");
    expect(durationAt, "executed rows must show their captured durations").toBeGreaterThan(-1);

    // The guard is presence of the measurement itself — not the source tag —
    // because an executed plan captured under log_analyze=off has NO duration
    // and must render none (absent, never a fabricated 0 or a dash).
    const guards = [...loop.slice(0, durationAt).matchAll(/v-if="([^"]+)"/g)];
    const nearest = guards[guards.length - 1][1];
    expect(
      nearest,
      `the duration is gated on "${nearest}", which must test the measurement's presence`,
    ).toMatch(/avgDurationMs\s*!==\s*undefined/);
  });

  it("shows est → act only where the plan measured actuals", () => {
    const loop = planLoop();
    const estActAt = loop.indexOf("dbm.detail.plans.estVsAct");
    expect(estActAt, "executed nodes must show estimate vs actual").toBeGreaterThan(-1);
    const guards = [...loop.slice(0, estActAt).matchAll(/v-if="([^"]+)"/g)];
    const nearest = guards[guards.length - 1][1];
    expect(
      nearest,
      `est→act is gated on "${nearest}" — null actuals mean "not measured", never 0`,
    ).toMatch(/actualRows\s*!==\s*null/);
  });
});
