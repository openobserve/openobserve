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
import {
  filterRcaEvidence,
  groupRcaHypotheses,
  rcaBandLabel,
  rcaBandLevel,
  rcaEvidenceNumbers,
  rcaEvidenceTitle,
  rcaHypothesisGroupTitle,
  rcaHypothesisStatusLabel,
  rcaStatusHistoryLine,
  rcaUtcRange,
  sortedRcaTimeline,
  rcaVerdictDetails,
} from "./rcaSummary";
import {
  RCA_T0,
  rcaEvidenceEntry,
  rcaHypothesis,
  rcaRunSummary,
  rcaRunSummaryLegacy,
  sec,
} from "@/test/unit/fixtures/rcaThread";
import type { RcaHypothesisStatus, RcaOutcome } from "@/services/incidents";

const byStatus = (status: RcaHypothesisStatus, id: string, firstSeen: number) =>
  rcaHypothesis({ id, status, first_seen_seq: firstSeen });

/** Ids of each group, in order. */
const groupIds = (outcome: RcaOutcome | undefined, statuses: Parameters<typeof byStatus>[]) =>
  groupRcaHypotheses(
    statuses.map((args) => byStatus(...args)),
    outcome,
  ).map((group) => [group.id, group.items.map((h) => h.id)]);

describe("rcaSummary helpers", () => {
  describe("groupRcaHypotheses (F8, VE12, VE36)", () => {
    const ALL: Parameters<typeof byStatus>[] = [
      ["symptom", "sym", 1],
      ["ruled_out", "out2", 2],
      ["contributing", "con", 3],
      ["untested", "unt", 4],
      ["root_cause", "rc", 5],
      ["likely", "lik", 6],
      ["ruled_out", "out1", 0],
      ["blocked", "blk", 7],
      ["testing", "tst", 8],
      ["inconclusive", "inc", 9],
    ];

    it.each(["root_cause_identified", "contributing_factor"] as const)(
      "%s: Explains first (root cause, contributing, symptom), then Not confirmed by rank, Ruled out last",
      (outcome) => {
        expect(groupIds(outcome, ALL)).toEqual([
          ["explains", ["rc", "con", "sym"]],
          ["open", ["lik", "tst", "blk", "inc", "unt"]],
          ["out", ["out1", "out2"]],
        ]);
      },
    );

    it.each(["inconclusive", "blocked", undefined] as const)(
      "%s: Not confirmed first, then Explains, Ruled out last",
      (outcome) => {
        expect(groupIds(outcome, ALL).map(([id]) => id)).toEqual(["open", "explains", "out"]);
      },
    );

    it("same status orders by first_seen_seq; empty groups are dropped", () => {
      expect(
        groupIds("root_cause_identified", [
          ["testing", "b", 9],
          ["testing", "a", 2],
        ]),
      ).toEqual([["open", ["a", "b"]]]);
    });

    it("frame B renders root cause, contributing, then blocked, then ruled out", () => {
      const summary = rcaRunSummary();
      expect(
        groupRcaHypotheses(summary.hypotheses, summary.card.outcome).flatMap((group) =>
          group.items.map((h) => h.status),
        ),
      ).toEqual(["root_cause", "contributing", "blocked", "ruled_out"]);
    });

    it("group titles follow the redesign; the open group reads Being tested while live", () => {
      expect(rcaHypothesisGroupTitle("explains", false)).toBe("Explains the incident");
      expect(rcaHypothesisGroupTitle("open", false)).toBe("Not confirmed");
      expect(rcaHypothesisGroupTitle("open", true)).toBe("Being tested");
      expect(rcaHypothesisGroupTitle("out", false)).toBe("Ruled out");
    });
  });

  describe("rcaHypothesisStatusLabel (VE18)", () => {
    it.each([
      ["root_cause_identified", "Root cause"],
      ["contributing_factor", "Root cause · not confirmed"],
      ["inconclusive", "Root cause · not confirmed"],
      ["blocked", "Root cause · not confirmed"],
      [null, "Root cause · not confirmed"],
    ] as const)("root_cause under %s reads %s", (outcome, label) => {
      expect(rcaHypothesisStatusLabel("root_cause", outcome)).toBe(label);
    });

    it("other statuses keep their word", () => {
      expect(rcaHypothesisStatusLabel("contributing", "inconclusive")).toBe("Contributing");
      expect(rcaHypothesisStatusLabel("ruled_out", undefined)).toBe("Ruled out");
    });
  });

  it("status history line names the agent, or the person whose steer it followed (VE11)", () => {
    expect(rcaStatusHistoryLine({ at: RCA_T0 + sec(60), status: "testing" })).toBe(
      "08:54:20 UTC · Testing (agent)",
    );
    expect(
      rcaStatusHistoryLine({ at: RCA_T0, status: "ruled_out", steered_by: "a.rao@acme.io" }),
    ).toBe("08:53:20 UTC · Ruled out (agent · after a.rao@acme.io)");
  });

  it("attributes automatic demotion to run end, not to the agent or a responder", () => {
    const line = rcaStatusHistoryLine({
      at: RCA_T0,
      status: "untested",
      run_ended: true,
      steered_by: "a.rao@acme.io",
    });
    expect(line).toContain("(run ended)");
    expect(line).not.toContain("agent");
    expect(line).not.toContain("a.rao");
  });

  describe("filterRcaEvidence (VE28)", () => {
    const entries = [
      rcaEvidenceEntry({ number: 1, decisive: true }),
      rcaEvidenceEntry({ number: 2, decisive: false }),
      rcaEvidenceEntry({ number: 3, decisive: true }),
    ];

    it.each([
      ["all", [1, 2, 3]],
      ["decisive", [1, 3]],
      ["supporting", [2]],
    ] as const)("%s shows %j", (filter, numbers) => {
      expect(filterRcaEvidence(entries, filter).map((entry) => entry.number)).toEqual(numbers);
    });
  });

  it("evidence numbers map every id of an entry; no map for no summary or a legacy run (VE24)", () => {
    const summary = rcaRunSummary({
      evidence: [
        rcaEvidenceEntry({ number: 1, ids: ["e2", "e7"] }),
        rcaEvidenceEntry({ number: 2, ids: ["e5"] }),
      ],
    });
    expect(Object.fromEntries(rcaEvidenceNumbers(summary)!)).toEqual({ e2: 1, e7: 1, e5: 2 });
    expect(rcaEvidenceNumbers(null)).toBeNull();
    expect(rcaEvidenceNumbers(rcaRunSummaryLegacy())).toBeNull();
  });

  it("a reused id keeps the number of the entry that cites it first (VE5, VE24)", () => {
    const summary = rcaRunSummary({
      evidence: [
        rcaEvidenceEntry({ number: 1, ids: ["e2"] }),
        rcaEvidenceEntry({ number: 2, ids: ["e2", "e4"] }),
      ],
    });
    expect(Object.fromEntries(rcaEvidenceNumbers(summary)!)).toEqual({ e2: 1, e4: 2 });
  });

  it("sorts the timeline by time (VE31)", () => {
    expect(sortedRcaTimeline(rcaRunSummary().timeline).map((entry) => entry.at)).toEqual([
      RCA_T0,
      RCA_T0 + sec(234),
      RCA_T0 + sec(379),
    ]);
  });

  it("band label and bars: High/Medium/Low, None for no grade (VE33)", () => {
    expect([
      rcaBandLabel("high"),
      rcaBandLabel("medium"),
      rcaBandLabel("low"),
      rcaBandLabel(undefined),
    ]).toEqual(["High confidence", "Medium confidence", "Low confidence", "No confidence"]);
    expect([
      rcaBandLevel("high"),
      rcaBandLevel("medium"),
      rcaBandLevel("low"),
      rcaBandLevel(undefined),
    ]).toEqual([3, 2, 1, 0]);
  });

  it("evidence title and UTC range", () => {
    expect(rcaEvidenceTitle(rcaEvidenceEntry())).toBe("Logs · checkout_api");
    expect(
      rcaEvidenceTitle(
        rcaEvidenceEntry({ target: "change", link: { signal: "change", streams: [] } }),
      ),
    ).toBe("Change");
    expect(rcaUtcRange(RCA_T0, RCA_T0 + sec(60))).toBe("08:53:20–08:54:20 UTC");
    expect(rcaUtcRange(RCA_T0, undefined)).toBe("");
  });
});

describe("rcaVerdictDetails (stored verdict on the card)", () => {
  it("reads impacted services and proposed actions from a completed run's record", () => {
    const result = {
      schema_version: 1,
      verdict: {
        probable_cause: "pool shrank",
        impacted_services: ["service=checkout-api"],
        proposed_actions: [{ title: "Roll back", kind: "rollback", detail: "Revert 4f2c1e." }],
      },
      ledger: { hypotheses: [] },
    };

    expect(rcaVerdictDetails(result)).toEqual({
      impactedServices: ["service=checkout-api"],
      proposedActions: [{ title: "Roll back", kind: "rollback", detail: "Revert 4f2c1e." }],
    });
  });

  it("is null for a record with no verdict (a cancelled or failed run) and for no record", () => {
    expect(rcaVerdictDetails({ schema_version: 1, ledger: { hypotheses: [] } })).toBeNull();
    expect(rcaVerdictDetails(undefined)).toBeNull();
  });
});
