// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { heatLevel, normalizeTactic, parentTechnique, techniqueUrl } from "./mitre";

describe("mitre helpers", () => {
  it("reads a sub-technique's parent, and a base technique as its own", () => {
    expect(parentTechnique("t1078.004")).toBe("T1078");
    expect(parentTechnique("T1110")).toBe("T1110");
  });

  it("steps firing counts into four heat levels", () => {
    expect([0, 1, 4, 5, 19, 20].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it("normalises tactic spellings and links sub-techniques by path", () => {
    expect(normalizeTactic("Defense-Evasion")).toBe("defense_evasion");
    expect(normalizeTactic("nonsense")).toBeNull();
    expect(techniqueUrl("T1078.004")).toBe("https://attack.mitre.org/techniques/T1078/004/");
  });
});
