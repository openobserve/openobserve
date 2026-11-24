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

import { describe, expect, it } from "vitest";
import "@/locales";
import { gt } from "@/types/i18n";
import type {
  AutoObserveCauseLine,
  AutoObserveChecked,
  AutoObserveImpactLine,
  AutoObserveIssueContext,
} from "@/services/autoobserve";
import { causeBlockCopy, impactCopy, type CauseBlockCopy } from "./causeCopy";

const MIN_US = 60_000_000;
const ONSET_US = Date.UTC(2026, 10, 16, 14, 2) * 1000;
const zone = { locale: "en-GB", timeZone: "UTC" };
const NOW_MS = ONSET_US / 1000 + 10 * 60_000;

const cause = (i: number, used = false): AutoObserveCauseLine => ({
  id: `c${i}`,
  record: {
    provider: "pipelines",
    kind: "pipeline_failing",
    at: ONSET_US - 4 * MIN_US,
    until: null,
    actor: null,
    subject: { kind: "pipeline", key_dims: { entity_id: `p${i}` } },
    subject_name: `pipeline-${i}`,
    affects: [],
    link: "exact",
    count: null,
    facts: {},
    needs: null,
    open: { path: "pipeline/pipelines/edit", query: { id: `p${i}` } },
  },
  relates: "direct",
  grade: i === 0 ? "likely" : "possible",
  sentence: `Pipeline pipeline-${i} started failing, 4 minutes before the issue started.`,
  used,
});

const checks = (state: AutoObserveChecked["kind"], label = "pipelines") => [
  { label: "deploys", state: { kind: "ok" as const } },
  {
    label,
    state: (state === "failed"
      ? { kind: state, reason: "timeout" }
      : { kind: state }) as AutoObserveChecked,
  },
];

const context = (over: Partial<AutoObserveIssueContext> = {}): AutoObserveIssueContext => ({
  causes: { top: [], more: 0 },
  impact: [],
  classes: [],
  window: [ONSET_US - 30 * MIN_US, ONSET_US + 5 * MIN_US],
  asked_at: ONSET_US + 10 * MIN_US,
  settled: true,
  checks: checks("ok"),
  hidden: 0,
  region_only: false,
  next_step: null,
  ...over,
});

const causes = (n: number, used = 0, more = 0) => ({
  top: Array.from({ length: n }, (_, i) => cause(i, i < used)),
  more,
});

describe("causeBlockCopy", () => {
  it.each<[string, AutoObserveIssueContext, (c: CauseBlockCopy) => void]>([
    [
      "0 causes, settled: nothing changed on our side, no fold",
      context(),
      (c) => {
        expect(c.empty).toContain("Nothing changed on our side");
        expect([c.fold, c.failed, c.gap, c.hidden]).toEqual([null, null, null, null]);
        expect(c.footer).toContain("and again at 14:12");
      },
    ],
    [
      "0 causes, not settled: found nothing so far and says when it checks again",
      context({ settled: false, recheck_at: ONSET_US + 20 * MIN_US }),
      (c) => {
        expect(c.empty).toContain("so far");
        expect(c.footer).toContain("checks again at 14:22");
      },
    ],
    [
      "not settled, the served recheck already due: checks again shortly",
      context({ settled: false, recheck_at: ONSET_US + 5 * MIN_US }),
      (c) => expect(c.footer).toContain("checks again shortly."),
    ],
    [
      "not settled, no recheck served: no time promised",
      context({ settled: false }),
      (c) => {
        expect(c.footer).toContain("may not be visible yet.");
        expect(c.footer).not.toContain("checks again");
      },
    ],
    [
      "1 cause: no empty line, no fold",
      context({ causes: causes(1) }),
      (c) => {
        expect([c.empty, c.fold]).toEqual([null, null]);
        expect(c.rows.shown).toHaveLength(1);
      },
    ],
    [
      "3 causes: all shown",
      context({ causes: causes(3) }),
      (c) => expect([c.rows.shown.length, c.fold]).toEqual([3, null]),
    ],
    [
      "12 causes, 3 used: 3 shown, the other 9 folded and counted, none of them used",
      context({ causes: causes(10, 3, 2) }),
      (c) => {
        expect(c.rows.shown.every((r) => r.used)).toBe(true);
        expect([c.rows.folded.length, c.rows.unlisted]).toEqual([7, 2]);
        expect(c.fold?.more).toContain("9 more changes, none used");
        expect(c.unlisted).toContain("2 more");
      },
    ],
    [
      "a used row ranked below the fold is still shown",
      context({
        causes: { top: [cause(0), cause(1), cause(2), cause(3), cause(4, true)], more: 0 },
      }),
      (c) => expect(c.rows.shown.map((r) => r.id)).toEqual(["c0", "c1", "c4"]),
    ],
    [
      "off: amber, names the check, and nothing-changed names only what ran",
      context({ checks: checks("off", "changes by people") }),
      (c) => {
        expect([c.failed, c.gap]).toEqual([null, expect.stringContaining("changes by people")]);
        expect(c.empty).toContain("Nothing changed in deploys");
      },
    ],
    [
      "partial: amber",
      context({ checks: checks("partial") }),
      (c) => expect([c.failed, c.gap]).toEqual([null, expect.stringContaining("pipelines")]),
    ],
    [
      "failed after the second ask: red, no retry time",
      context({ checks: checks("failed") }),
      (c) => {
        expect(c.failed).toContain("pipelines");
        expect(c.failed).not.toContain("Trying again");
      },
    ],
    [
      "failed before the second ask: red with the retry time",
      context({ checks: checks("failed"), settled: false, recheck_at: ONSET_US + 20 * MIN_US }),
      (c) => expect(c.failed).toContain("Trying again at 14:22"),
    ],
    [
      "failed with the retry due: red, trying again shortly",
      context({ checks: checks("failed"), settled: false, recheck_at: ONSET_US }),
      (c) => expect(c.failed).toContain("Trying again shortly"),
    ],
    [
      "failed with no retry served: red, no retry promised",
      context({ checks: checks("failed"), settled: false }),
      (c) => expect(c.failed).not.toContain("Trying again"),
    ],
    [
      "not recorded: a neutral footer sentence, not a gap",
      context({ checks: checks("not_recorded", "refused ingestion") }),
      (c) => {
        expect([c.failed, c.gap]).toEqual([null, null]);
        expect(c.footer).toContain("Refused ingestion is not recorded");
      },
    ],
    [
      "this region only",
      context({ region_only: true }),
      (c) => expect(c.footer).toContain("this region only"),
    ],
    [
      "2 hidden: counted, and the block does not claim nothing changed",
      context({ hidden: 2 }),
      (c) => expect([c.hidden, c.empty]).toEqual([expect.stringContaining("2 changes"), null]),
    ],
  ])("%s", (_name, cx, check) => check(causeBlockCopy(gt, zone, cx, NOW_MS)));
});

describe("impactCopy", () => {
  const line = (
    over: Partial<AutoObserveImpactLine["record"]>,
    redacted = false,
  ): AutoObserveImpactLine => ({
    id: "i1",
    record: {
      provider: "security_blind_spot",
      kind: "detection",
      effect: "blind",
      subject: { kind: "stream", key_dims: {} },
      counts: { detections: 1 },
      items: [
        {
          dependent: { kind: "alert", key_dims: {} },
          name: "Okta admin role assigned",
          attrs: { level: "high" },
          open: { path: "/security/detections", query: { detection: "d1" } },
        },
      ],
      more: 0,
      needs: "security",
      classes: ["security_source"],
      issue: null,
      ...over,
    },
    sentence: "1 detection gets no data: Okta admin role assigned.",
    redacted,
    used: false,
  });

  it.each<[string, AutoObserveImpactLine, boolean, Partial<ReturnType<typeof impactCopy>>]>([
    ["one blind detection: red, with its link", line({}), false, { tone: "error", redacted: null }],
    ["partial drop: amber", line({ effect: "partial" }), false, { tone: "warning" }],
    ["recovered: neutral", line({}), true, { tone: "neutral" }],
    [
      "redacted: a note, and no link once the names are gone",
      line({ items: [], more: 12 }, true),
      false,
      { link: null, redacted: expect.stringContaining("Security access") },
    ],
  ])("%s", (_name, impact, recovered, want) => {
    expect(impactCopy(gt, impact, recovered)).toMatchObject(want as object);
  });

  it("draws no callout for an empty sentence (0 detections)", () => {
    expect(impactCopy(gt, { ...line({}), sentence: "" }, false)).toBeNull();
  });
});
