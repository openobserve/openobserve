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
  encodeDef,
  exclusionProblem,
  parseFunnelDef,
  parsePathsDef,
} from "@/utils/rum/productAnalyticsModel";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

const p = (key: string): StepRef => ({ kind: "p", key });
const c = (key: string): StepRef => ({ kind: "c", key });
const STEPS = [p("/a"), p("/b"), c("save"), p("/d")];
const RAW_STEPS = [
  ["p", "/a"],
  ["p", "/b"],
  ["c", "save"],
  ["p", "/d"],
];

describe("exclusionProblem", () => {
  it("a between row on a page strictly inside its span can never hold", () => {
    expect(exclusionProblem(STEPS, { step: p("/b"), a: 1, b: 4 })).toEqual({
      kind: "inside",
      step: 2,
      b: 4,
    });
  });

  it("a between row on a click strictly inside its span can never hold", () => {
    expect(exclusionProblem(STEPS, { step: c("save"), a: 2, b: 4 })).toEqual({
      kind: "inside",
      step: 3,
      b: 4,
    });
  });

  it("a between row on step a's or step b's own page is valid, matching is strictly inside", () => {
    expect(exclusionProblem(STEPS, { step: p("/a"), a: 1, b: 2 })).toBeNull();
    expect(exclusionProblem(STEPS, { step: p("/b"), a: 1, b: 2 })).toBeNull();
    expect(exclusionProblem(STEPS, { step: p("/b"), a: 2, b: 4 })).toBeNull();
    expect(exclusionProblem(STEPS, { step: p("/d"), a: 1, b: 4 })).toBeNull();
  });

  it("a between row on a step outside its span is valid", () => {
    expect(exclusionProblem(STEPS, { step: p("/d"), a: 1, b: 3 })).toBeNull();
  });

  it("a within row on step a's own page is invalid, as the server rules", () => {
    expect(exclusionProblem(STEPS, { step: p("/b"), a: 2, withinMs: 5000 })).toEqual({
      kind: "anchor",
      a: 2,
    });
    expect(exclusionProblem(STEPS, { step: p("/b"), a: 1, withinMs: 5000 })).toBeNull();
    expect(exclusionProblem(STEPS, { step: c("save"), a: 3, withinMs: 5000 })).toBeNull();
  });
});

describe("parseFunnelDef", () => {
  it("accepts a definition with only the known keys", () => {
    const def = parseFunnelDef({
      s: RAW_STEPS,
      u: "users",
      w: "1d",
      b: "browser",
      x: [{ s: ["p", "/z"], a: 1, b: 4 }],
    });
    expect(def?.steps).toHaveLength(4);
    expect(def?.x).toEqual([{ step: p("/z"), a: 1, b: 4 }]);
  });

  it("accepts an old link that carries steps alone", () => {
    expect(parseFunnelDef({ s: RAW_STEPS })?.unit).toBe("sessions");
  });

  it("rejects an unknown top-level key", () => {
    expect(parseFunnelDef({ s: RAW_STEPS, vc: [] })).toBeNull();
    expect(parseFunnelDef({ s: RAW_STEPS, u: "sessions", sc: 1 })).toBeNull();
  });

  it("rejects a link whose between exclusion sits strictly inside its span", () => {
    expect(parseFunnelDef({ s: RAW_STEPS, x: [{ s: ["p", "/b"], a: 1, b: 4 }] })).toBeNull();
    expect(parseFunnelDef({ s: RAW_STEPS, x: [{ s: ["p", "/b"], a: 1, b: 2 }] })).not.toBeNull();
  });

  it("rejects a link whose exclusion step carries options, which no query applies", () => {
    const x = [{ s: ["p", "/z", { min: 1000 }], a: 1, b: 2 }];
    expect(parseFunnelDef({ s: RAW_STEPS, x })).toBeNull();
    expect(parseFunnelDef({ s: RAW_STEPS, x: [{ s: ["p", "/z"], a: 1, b: 2 }] })).not.toBeNull();
  });

  it("rejects a link whose within exclusion is step a's page", () => {
    expect(parseFunnelDef({ s: RAW_STEPS, x: [{ s: ["p", "/a"], a: 1, w: 5000 }] })).toBeNull();
  });

  it("a paths cohort still carries its step index next to the funnel keys", () => {
    const cohort = encodeDef({ s: RAW_STEPS, u: "sessions", w: "session", k: 2 });
    expect(parsePathsDef({ cohort })?.cohort?.stepIndex).toBe(2);
  });
});
