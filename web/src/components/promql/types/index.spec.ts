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

import { describe, it, expect } from "vitest";
import { PromqlStepId, normalizeStepId, normalizeSteps } from "./index";

/**
 * The scalar-math steps were renamed away from the ids panels were originally
 * saved under. Dashboards persist the id verbatim, so these two functions are
 * the whole of the compatibility story: `normalizeStepId` keeps an old panel
 * RENDERING, and `normalizeSteps` is what eventually MIGRATES it.
 *
 * Every stored id is listed explicitly below rather than derived from the map
 * being tested — a test that reads its expectations out of the code under test
 * would still pass if someone deleted an entry, which is the exact mistake
 * these tests exist to catch.
 */
const STORED_TO_CURRENT: Array<[string, PromqlStepId]> = [
  ["__addition", PromqlStepId.Addition],
  ["__subtraction", PromqlStepId.Subtraction],
  ["__multiply_by", PromqlStepId.MultiplyBy],
  ["__divide_by", PromqlStepId.DivideBy],
  ["__modulo", PromqlStepId.Modulo],
  ["__exponent", PromqlStepId.Exponent],
];

describe("normalizeStepId", () => {
  it.each(STORED_TO_CURRENT)("upgrades a stored %s", (stored, current) => {
    expect(normalizeStepId(stored)).toBe(current);
  });

  it("leaves a current id alone", () => {
    expect(normalizeStepId(PromqlStepId.MultiplyBy)).toBe("scalar_multiply");
    expect(normalizeStepId(PromqlStepId.Rate)).toBe("rate");
  });

  it("is idempotent — upgrading twice is upgrading once", () => {
    for (const [stored] of STORED_TO_CURRENT) {
      expect(normalizeStepId(normalizeStepId(stored))).toBe(
        normalizeStepId(stored),
      );
    }
  });

  it("passes an unknown id straight through", () => {
    // A step this build does not know about must survive the round trip rather
    // than be silently dropped: the panel that owns it may be newer than us.
    expect(normalizeStepId("some_future_function")).toBe("some_future_function");
    expect(normalizeStepId("")).toBe("");
  });

  it.each([
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
    "isPrototypeOf",
  ])("returns a plain string for the inherited key %s", (key) => {
    // The lookup table is a plain object, so it inherits from Object.prototype.
    // Indexed naively, these keys return FUNCTIONS. Such an id can reach us from
    // a hand-edited or imported dashboard, and a non-string here is not a
    // cosmetic problem: it is written back into the panel and then dropped by
    // JSON.stringify on save, losing the step's id for good.
    const result = normalizeStepId(key);

    expect(typeof result).toBe("string");
    expect(result).toBe(key);
  });

  it("never maps a current id back onto a stored one", () => {
    // Guards against someone inverting the table.
    for (const [stored, current] of STORED_TO_CURRENT) {
      expect(normalizeStepId(current)).not.toBe(stored);
    }
  });
});

describe("normalizeSteps", () => {
  it("upgrades every stored id in a saved operations array", () => {
    const saved = [
      { id: "rate", params: ["$__rate_interval"] },
      { id: "__multiply_by", params: [8] },
      { id: "sum", params: [[]] },
    ];

    expect(normalizeSteps(saved)).toEqual([
      { id: "rate", params: ["$__rate_interval"] },
      { id: "scalar_multiply", params: [8] },
      { id: "sum", params: [[]] },
    ]);
  });

  it("carries each step's params across untouched", () => {
    // The id is upgraded; nothing else about the step may change, or the panel
    // would come back rendering different numbers.
    const [step] = normalizeSteps([
      { id: "__divide_by", params: [1024], extra: "kept" } as any,
    ]);

    expect(step).toEqual({ id: "scalar_divide", params: [1024], extra: "kept" });
  });

  it("returns the SAME array when nothing needs upgrading", () => {
    // Identity is load-bearing: the builder hangs a deep watcher off this state
    // and copies it into the panel on every change, so handing back a fresh
    // array would mark every modern panel dirty the moment it was opened.
    const current = [{ id: "scalar_multiply", params: [2] }];

    expect(normalizeSteps(current)).toBe(current);
  });

  it("does not mutate the array it was given", () => {
    const saved = [{ id: "__exponent", params: [2] }];
    const before = JSON.parse(JSON.stringify(saved));

    normalizeSteps(saved);

    expect(saved).toEqual(before);
  });

  it("is idempotent — a migrated panel re-opens unchanged", () => {
    const once = normalizeSteps([{ id: "__modulo", params: [3] }]);
    const twice = normalizeSteps(once);

    expect(twice).toEqual(once);
    // ...and the second pass is a no-op, so it hands the same array back.
    expect(twice).toBe(once);
  });

  it("survives an empty or absent operations array", () => {
    expect(normalizeSteps([])).toEqual([]);
    expect(normalizeSteps(undefined as any)).toEqual([]);
    expect(normalizeSteps(null as any)).toEqual([]);
  });

  it("leaves a step whose id collides with an inherited key untouched", () => {
    // The write-back is what makes this matter: were the id to come back as a
    // function, it would be persisted into the panel and then silently dropped
    // by JSON.stringify, and the step would lose its id permanently.
    const steps = [{ id: "constructor", params: [1] }];
    const result = normalizeSteps(steps);

    expect(result).toBe(steps); // nothing changed => same array, panel not dirtied
    expect(typeof result[0].id).toBe("string");
    expect(JSON.parse(JSON.stringify(result))).toEqual([
      { id: "constructor", params: [1] },
    ]);
  });
});
