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
import {
  formulaInputs,
  formulaRefs,
  legendFallbackOf,
  isFormulaQuery,
  queryRefs,
  substituteFormula,
} from "./formula";

const ERR_RATE = 'sum by (job)(rate(http_requests_total{code=~"5.."}[5m]))';
const ALL_RATE = "sum by (job)(rate(http_requests_total[5m]))";

describe("substituteFormula", () => {
  it("wraps each standalone letter in parentheses", () => {
    expect(substituteFormula("A / B * 100", { A: ERR_RATE, B: ALL_RATE })).toEqual({
      expr: `(${ERR_RATE}) / (${ALL_RATE}) * 100`,
    });
  });

  it("substitutes a letter used more than once", () => {
    expect(substituteFormula("A - A", { A: "up" })).toEqual({ expr: "(up) - (up)" });
  });

  it("leaves letters inside double, single and backtick quotes alone", () => {
    expect(substituteFormula('label_replace(A, "B", \'C\', `D`, "x")', { A: "up" })).toEqual({
      expr: 'label_replace((up), "B", \'C\', `D`, "x")',
    });
  });

  it("leaves an escaped quote inside a string alone", () => {
    expect(substituteFormula('label_replace(A, "a\\"B", "", "", "")', { A: "up" })).toEqual({
      expr: 'label_replace((up), "a\\"B", "", "", "")',
    });
  });

  it("leaves a label value inside braces alone", () => {
    expect(substituteFormula('A + up{job="A", B="x"}', { A: "m" })).toEqual({
      expr: '(m) + up{job="A", B="x"}',
    });
  });

  it("keeps a closing brace inside a quoted label value from ending the braces early", () => {
    expect(substituteFormula('up{x="}B"} + A', { A: "m" })).toEqual({
      expr: 'up{x="}B"} + (m)',
    });
  });

  it("leaves label names after by, without, on and ignoring alone", () => {
    expect(
      substituteFormula(
        "sum by (A) (B) + sum without (B) (A) + A * on (B) C + A / ignoring (B) C",
        {
          A: "a",
          B: "b",
          C: "c",
        },
      ),
    ).toEqual({
      expr: "sum by (A) ((b)) + sum without (B) ((a)) + (a) * on (B) (c) + (a) / ignoring (B) (c)",
    });
  });

  it("treats the grouping keywords case-insensitively", () => {
    expect(substituteFormula("sum BY (A) (B)", { B: "b" })).toEqual({ expr: "sum BY (A) ((b))" });
  });

  it("substitutes the operand after group_left when no label list follows", () => {
    expect(substituteFormula("A + on(job) group_left B", { A: "a", B: "b" })).toEqual({
      expr: "(a) + on(job) group_left (b)",
    });
  });

  it("leaves the label list after group_left and group_right alone", () => {
    expect(
      substituteFormula("A * on(job) group_left(B) B + A * on(job) group_right (A) B", {
        A: "a",
        B: "b",
      }),
    ).toEqual({
      expr: "(a) * on(job) group_left(B) (b) + (a) * on(job) group_right (A) (b)",
    });
  });

  it("does not split identifiers, numbers or durations", () => {
    expect(substituteFormula("rate(A[5m]) * 1e3 + ABC + A_x + 0x1F", { A: "up" })).toEqual({
      expr: "rate((up)[5m]) * 1e3 + ABC + A_x + 0x1F",
    });
  });

  it("leaves letters inside a comment alone", () => {
    expect(substituteFormula("A # B is ignored\n", { A: "up" })).toEqual({
      expr: "(up) # B is ignored\n",
    });
  });

  it("ends a comment at the newline even when it holds a quote", () => {
    expect(substituteFormula("A # don't\n+ A", { A: "up" })).toEqual({
      expr: "(up) # don't\n+ (up)",
    });
  });

  it("keeps an input ending in a comment from swallowing its closing parenthesis", () => {
    expect(substituteFormula("A * 2", { A: "up # note" })).toEqual({
      expr: "(up # note\n) * 2",
    });
  });

  it("reports an unknown letter", () => {
    expect(substituteFormula("A / B", { A: "up" })).toEqual({
      error: "B is not a query in this panel",
    });
  });

  it("reports a letter that belongs to another formula", () => {
    expect(substituteFormula("A / F", { A: "up", F: null })).toEqual({
      error: "F is a formula, and a formula may not reference another formula",
    });
  });
});

describe("formulaRefs", () => {
  it("lists each referenced letter once, in order, skipping literals", () => {
    expect(formulaRefs('B / A + B + up{x="C"} + sum by (D) (A)')).toEqual(["B", "A"]);
  });
});

describe("isFormulaQuery", () => {
  it("is true for any string formula, even an empty one", () => {
    expect(isFormulaQuery({ config: { formula: "" } })).toBe(true);
    expect(isFormulaQuery({ config: { formula: null } })).toBe(false);
    expect(isFormulaQuery({ config: {} })).toBe(false);
  });
});

describe("queryRefs", () => {
  it("keeps stored letters and gives a legacy query the first unused letter", () => {
    const queries = [
      { config: {} },
      { config: { ref: "A" } },
      { config: { formula: "A + B" } },
      { config: {} },
    ];
    expect(queryRefs(queries)).toEqual(["B", "A", undefined, "C"]);
  });

  it("gives legacy queries letters by position", () => {
    expect(queryRefs([{ config: {} }, { config: {} }, {}])).toEqual(["A", "B", "C"]);
  });

  it("keeps a stored formula letter reserved", () => {
    expect(queryRefs([{ config: { formula: "", ref: "A" } }, { config: {} }])).toEqual(["A", "B"]);
  });
});

describe("formulaInputs", () => {
  it("maps each input's letter to its final text", () => {
    const queries = [{ config: { ref: "B" } }, { config: {} }, { config: { formula: "A * B" } }];
    expect(formulaInputs(queries, ["b_final", "a_final", "A * B"])).toEqual({
      B: "b_final",
      A: "a_final",
    });
  });

  it("maps a lettered formula to null", () => {
    const queries = [{ config: { formula: "", ref: "F" } }, { config: { ref: "A" } }];
    expect(formulaInputs(queries, ["", "up"])).toEqual({ F: null, A: "up" });
  });
});

describe("legendFallbackOf", () => {
  const withFormula = [{ config: { ref: "A" } }, { config: {} }, { config: { formula: "B / A" } }];

  it("names a formula's label-less series after the formula", () => {
    expect(legendFallbackOf(withFormula, 2)).toBe("B / A");
  });

  it("names an input's label-less series after its letter when the panel has a formula", () => {
    expect(legendFallbackOf(withFormula, 0)).toBe("A");
    expect(legendFallbackOf(withFormula, 1)).toBe("B");
  });

  it("leaves an input with its own legend alone", () => {
    const queries = [
      { config: { ref: "A", promql_legend: "{pod}" } },
      { config: { formula: "A" } },
    ];
    expect(legendFallbackOf(queries, 0)).toBeUndefined();
  });

  it("keeps an explicit fallback, and gives queries in a formula-free panel none", () => {
    expect(legendFallbackOf([{ config: { formula: "A", promql_legend_fallback: "e" } }], 0)).toBe(
      "e",
    );
    expect(legendFallbackOf([{ config: { promql_legend_fallback: "x" } }], 0)).toBe("x");
    expect(legendFallbackOf([{ config: { ref: "A" } }, { config: {} }], 0)).toBeUndefined();
    expect(legendFallbackOf(undefined, 0)).toBeUndefined();
  });
});
