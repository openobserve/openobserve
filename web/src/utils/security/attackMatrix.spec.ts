// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { buildAttackMatrix, heatLevel, parentTechnique, summarizeMatrix } from "./attackMatrix";
import { sigmaCatalog } from "./sigma";

const rule = (techniques: string[], tactics: string[], title = "r") => ({
  title,
  techniques,
  tactics,
});

describe("buildAttackMatrix", () => {
  it("places a technique under every tactic its rules tag it with, in matrix order", () => {
    const m = buildAttackMatrix(
      [rule(["T1078.004"], ["privilege_escalation"]), rule(["t1078.004"], ["initial_access"])],
      [],
      [],
    );
    const cell = m.cells.get("T1078.004")!;
    expect(cell.tactics).toEqual(["initial_access", "privilege_escalation"]);
    expect(cell.catalogRules).toHaveLength(2);
    expect(m.columns.find((c) => c.tactic === "initial_access")!.cells[0].id).toBe("T1078.004");
  });

  it("derives state from enabled detections and firings, strongest first", () => {
    const m = buildAttackMatrix(
      [rule(["T1110"], ["credential_access"]), rule(["T1490"], ["impact"])],
      [
        { name: "a", enabled: true, sigmaId: "", level: "low", techniques: ["T1110"], tactics: [] },
        {
          name: "b",
          enabled: false,
          sigmaId: "",
          level: "low",
          techniques: ["T1490"],
          tactics: [],
        },
      ],
      [
        { name: "a", timeMs: 10, techniques: ["T1110"] },
        { name: "a", timeMs: 30, techniques: ["T1110", "T1110"] },
      ],
    );
    const brute = m.cells.get("T1110")!;
    expect(brute.state).toBe("firing");
    expect(brute.firings).toBe(2);
    expect(brute.lastFiredMs).toBe(30);
    // A disabled detection is not coverage.
    expect(m.cells.get("T1490")!.state).toBe("available");
    expect(m.cells.get("T1490")!.detections).toHaveLength(1);
  });

  it("never drops a technique without a known tactic", () => {
    const m = buildAttackMatrix([rule(["T9999"], ["not_a_tactic"])], [], []);
    expect(m.unmapped.map((c) => c.id)).toEqual(["T9999"]);
    expect(m.columns.every((c) => c.cells.length === 0)).toBe(true);
  });

  it("ignores firings for techniques no rule carries", () => {
    const m = buildAttackMatrix([], [], [{ name: "x", timeMs: 1, techniques: ["T1"] }]);
    expect(m.cells.size).toBe(0);
  });

  it("summarises the shipped catalog with nothing enabled as all gaps", () => {
    const catalog = sigmaCatalog();
    const summary = summarizeMatrix(buildAttackMatrix(catalog, [], []));
    expect(summary.tacticsTotal).toBe(14);
    expect(summary.techniquesCovered).toBe(0);
    expect(summary.techniquesTotal).toBeGreaterThan(20);
    expect(summary.gaps).toBe(summary.techniquesTotal);
  });
});

describe("helpers", () => {
  it("finds the parent technique", () => {
    expect(parentTechnique("t1078.004")).toBe("T1078");
    expect(parentTechnique("T1110")).toBe("T1110");
  });

  it("steps heat by firing count", () => {
    expect([0, 1, 4, 5, 19, 20].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});
