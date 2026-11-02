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
  formulaLeafRefs,
  formulaRefs,
  legendFallbackOf,
  isFormulaQuery,
  queryRefs,
  substituteFormula,
  legendExprOf,
} from "./formula";

const ERR_RATE = 'sum by (job)(rate(http_requests_total{code=~"5.."}[5m]))';
const ALL_RATE = "sum by (job)(rate(http_requests_total[5m]))";

const q = (text: string) => ({ text, isFormula: false });
const f = (text: string) => ({ text, isFormula: true });

describe("substituteFormula", () => {
  it("wraps each standalone letter in parentheses", () => {
    expect(substituteFormula("A / B * 100", { A: q(ERR_RATE), B: q(ALL_RATE) })).toEqual({
      expr: `(${ERR_RATE}) / (${ALL_RATE}) * 100`,
    });
  });

  it("substitutes a letter used more than once", () => {
    expect(substituteFormula("A - A", { A: q("up") })).toEqual({ expr: "(up) - (up)" });
  });

  it("leaves letters inside double, single and backtick quotes alone", () => {
    expect(substituteFormula('label_replace(A, "B", \'C\', `D`, "x")', { A: q("up") })).toEqual({
      expr: 'label_replace((up), "B", \'C\', `D`, "x")',
    });
  });

  it("leaves an escaped quote inside a string alone", () => {
    expect(substituteFormula('label_replace(A, "a\\"B", "", "", "")', { A: q("up") })).toEqual({
      expr: 'label_replace((up), "a\\"B", "", "", "")',
    });
  });

  it("leaves a label value inside braces alone", () => {
    expect(substituteFormula('A + up{job="A", B="x"}', { A: q("m") })).toEqual({
      expr: '(m) + up{job="A", B="x"}',
    });
  });

  it("keeps a closing brace inside a quoted label value from ending the braces early", () => {
    expect(substituteFormula('up{x="}B"} + A', { A: q("m") })).toEqual({
      expr: 'up{x="}B"} + (m)',
    });
  });

  it("leaves label names after by, without, on and ignoring alone", () => {
    expect(
      substituteFormula(
        "sum by (A) (B) + sum without (B) (A) + A * on (B) C + A / ignoring (B) C",
        {
          A: q("a"),
          B: q("b"),
          C: q("c"),
        },
      ),
    ).toEqual({
      expr: "sum by (A) ((b)) + sum without (B) ((a)) + (a) * on (B) (c) + (a) / ignoring (B) (c)",
    });
  });

  it("treats the grouping keywords case-insensitively", () => {
    expect(substituteFormula("sum BY (A) (B)", { B: q("b") })).toEqual({
      expr: "sum BY (A) ((b))",
    });
  });

  it("substitutes the operand after group_left when no label list follows", () => {
    expect(substituteFormula("A + on(job) group_left B", { A: q("a"), B: q("b") })).toEqual({
      expr: "(a) + on(job) group_left (b)",
    });
  });

  it("leaves the label list after group_left and group_right alone", () => {
    expect(
      substituteFormula("A * on(job) group_left(B) B + A * on(job) group_right (A) B", {
        A: q("a"),
        B: q("b"),
      }),
    ).toEqual({
      expr: "(a) * on(job) group_left(B) (b) + (a) * on(job) group_right (A) (b)",
    });
  });

  it("does not split identifiers, numbers or durations", () => {
    expect(substituteFormula("rate(A[5m]) * 1e3 + ABC + A_x + 0x1F", { A: q("up") })).toEqual({
      expr: "rate((up)[5m]) * 1e3 + ABC + A_x + 0x1F",
    });
  });

  it("leaves letters inside a comment alone", () => {
    expect(substituteFormula("A # B is ignored\n", { A: q("up") })).toEqual({
      expr: "(up) # B is ignored\n",
    });
  });

  it("ends a comment at the newline even when it holds a quote", () => {
    expect(substituteFormula("A # don't\n+ A", { A: q("up") })).toEqual({
      expr: "(up) # don't\n+ (up)",
    });
  });

  it("keeps an input ending in a comment from swallowing its closing parenthesis", () => {
    expect(substituteFormula("A * 2", { A: q("up # note") })).toEqual({
      expr: "(up # note\n) * 2",
    });
  });

  it("reports an unknown letter", () => {
    expect(substituteFormula("A / B", { A: q("up") })).toEqual({
      error: "B is not a query in this panel",
    });
  });

  it("leaves a single-level formula over queries unchanged", () => {
    expect(substituteFormula("A / B", { A: q("x"), B: q("y"), C: f("A / B") }, "C")).toEqual({
      expr: "(x) / (y)",
    });
  });

  describe("formulas that reference formulas", () => {
    it("inlines a formula referenced by its F name", () => {
      const inputs = { A: q("x"), B: q("y"), F1: f("A / B"), F2: f("F1 * 100") };
      expect(substituteFormula("F2 - F1", inputs, "F3")).toEqual({
        expr: "(((x) / (y)) * 100) - ((x) / (y))",
      });
    });

    it("does not read F names inside longer identifiers or label lists", () => {
      const inputs = { A: q("x"), F1: f("A") };
      expect(substituteFormula("F1 + F10x + F01 + sum by (F1) (F1)", inputs, "F2")).toEqual({
        expr: "((x)) + F10x + F01 + sum by (F1) (((x)))",
      });
    });

    it("keeps an F name no query holds as literal PromQL, as saved formulas read it", () => {
      expect(substituteFormula("A + F1", { A: q("up") }, "F2")).toEqual({ expr: "(up) + F1" });
      // A legacy formula is assigned F1 itself, so its own name is still the metric.
      expect(substituteFormula("A + F1", { A: q("up"), F1: f("A + F1") }, "F1")).toEqual({
        expr: "(up) + F1",
      });
      expect(substituteFormula("A + F1", { A: q("up"), F1: f("A * 2") }, "F2")).toEqual({
        expr: "(up) + ((up) * 2)",
      });
    });

    it("refuses nesting deeper than the depth cap", () => {
      const inputs: Record<string, any> = { A: q("x"), F1: f("A") };
      for (let n = 2; n <= 12; n++) inputs[`F${n}`] = f(`F${n - 1}`);
      expect(substituteFormula("F12", inputs, "F13")).toEqual({
        error: "Formulas nest more than 10 levels deep",
      });
      expect("expr" in substituteFormula("F8", inputs, "F13")).toBe(true);
    });

    it("inlines a referenced formula in parentheses", () => {
      const inputs = { A: q("x"), B: q("y"), C: f("A + B") };
      expect(substituteFormula("C * 2", inputs, "D")).toEqual({ expr: "((x) + (y)) * 2" });
    });

    it("keeps precedence through each level of nesting", () => {
      const inputs = { A: q("x"), B: q("y"), C: f("A - B"), D: f("C / A") };
      expect(substituteFormula("D * 100", inputs, "E")).toEqual({
        expr: "(((x) - (y)) / (x)) * 100",
      });
    });

    it("expands three levels deep", () => {
      const inputs = { A: q("up"), B: f("A + 1"), C: f("B * 2"), D: f("C - B") };
      expect(substituteFormula("D", inputs, "E")).toEqual({
        expr: "((((up) + 1) * 2) - ((up) + 1))",
      });
    });

    it("reads a hidden query or formula like any other", () => {
      const inputs = { A: q("hidden_metric"), B: f("A * 2") };
      expect(substituteFormula("B + A", inputs, "C")).toEqual({
        expr: "((hidden_metric) * 2) + (hidden_metric)",
      });
    });

    it("reports a formula that references itself", () => {
      expect(substituteFormula("A + 1", { A: f("A + 1") }, "A")).toEqual({
        error: "Formulas refer to each other in a loop: A → A",
      });
    });

    it("reports a cycle through other formulas, starting from the edited one", () => {
      const inputs = { A: q("up"), B: f("C + A"), C: f("D"), D: f("B * 2") };
      expect(substituteFormula("C + A", inputs, "B")).toEqual({
        error: "Formulas refer to each other in a loop: B → C → D → B",
      });
    });

    it("reports a cycle below the edited formula", () => {
      const inputs = { B: f("C"), C: f("B") };
      expect(substituteFormula("B", inputs, "D")).toEqual({
        error: "Formulas refer to each other in a loop: B → C → B",
      });
    });

    it("finds a self-reference even without the formula's own letter", () => {
      expect(substituteFormula("A + 1", { A: f("A + 1") })).toEqual({
        error: "Formulas refer to each other in a loop: A → A",
      });
    });

    it("reports an unknown letter inside a referenced formula", () => {
      expect(substituteFormula("B * 2", { A: q("up"), B: f("A / Z") }, "C")).toEqual({
        error: "Z is not a query in this panel",
      });
    });

    it("refuses an expansion that grows past the size cap", () => {
      const inputs = {
        A: q("x".repeat(1000)),
        F1: f(Array(60).fill("A").join(" + ")),
        F2: f("F1 + F1"),
      };
      expect("expr" in substituteFormula("F1", inputs, "F3")).toBe(true);
      expect(substituteFormula("F2", inputs, "F3")).toEqual({
        error: "The formula expands to more than 100000 characters",
      });
    });
  });
});

describe("formulaRefs", () => {
  it("lists each referenced letter once, in order, skipping literals", () => {
    expect(formulaRefs('B / A + B + up{x="C"} + sum by (D) (A)')).toEqual(["B", "A"]);
  });

  it("reads an F name only when a query in the panel holds it", () => {
    expect(formulaRefs("A + F1")).toEqual(["A"]);
    expect(formulaRefs("A + F1", ["A", "F1"])).toEqual(["A", "F1"]);
    expect(formulaRefs("A + F1", ["A", "F1"], "F1")).toEqual(["A"]);
  });
});

describe("formulaLeafRefs", () => {
  it("follows referenced formulas down to the queries they read", () => {
    const queries = [
      { config: { ref: "A" } },
      { config: { ref: "B" } },
      { config: { ref: "C" } },
      { config: { formula: "A * 2", ref: "D" } },
      { config: { formula: "D + B", ref: "E" } },
    ];
    expect([...formulaLeafRefs(queries, "E / 2")].sort()).toEqual(["A", "B"]);
  });

  it("treats an F name no query holds as a metric, and one a formula holds as that formula", () => {
    const metric = [{ config: { ref: "A" } }, { config: { formula: "A + F1" } }];
    expect([...formulaLeafRefs(metric, "A + F1", "F1")]).toEqual(["A"]);
    const formula = [
      { config: { ref: "A" } },
      { config: { ref: "B" } },
      { config: { formula: "B * 2" } },
    ];
    expect([...formulaLeafRefs(formula, "A + F1")].sort()).toEqual(["A", "B"]);
  });

  it("stops at a cycle", () => {
    const queries = [
      { config: { ref: "A" } },
      { config: { formula: "C + A", ref: "B" } },
      { config: { formula: "B", ref: "C" } },
    ];
    expect([...formulaLeafRefs(queries, "B")]).toEqual(["A"]);
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
    expect(queryRefs(queries)).toEqual(["B", "A", "F1", "C"]);
  });

  it("gives legacy queries letters by position", () => {
    expect(queryRefs([{ config: {} }, { config: {} }, {}])).toEqual(["A", "B", "C"]);
  });

  it("names formulas F1, F2, … apart from the query letters", () => {
    const queries = [
      { config: { ref: "A" } },
      { config: { formula: "A + B" } },
      { config: {} },
      { config: { formula: "", ref: "F1" } },
      { config: { formula: "" } },
    ];
    expect(queryRefs(queries)).toEqual(["A", "F2", "B", "F1", "F3"]);
  });

  it("keeps a stored formula letter reserved", () => {
    expect(queryRefs([{ config: { formula: "", ref: "A" } }, { config: {} }])).toEqual(["A", "B"]);
  });
});

describe("formulaInputs", () => {
  it("maps each input's letter to its final text", () => {
    const queries = [{ config: { ref: "B" } }, { config: {} }, { config: { formula: "A * B" } }];
    expect(formulaInputs(queries, ["b_final", "a_final", "A * B"])).toEqual({
      B: q("b_final"),
      A: q("a_final"),
      F1: f("A * B"),
    });
  });

  it("marks a formula's text as a formula", () => {
    const queries = [{ config: { formula: "A * 2", ref: "F" } }, { config: { ref: "A" } }];
    expect(formulaInputs(queries, ["A * 2", "up"])).toEqual({ F: f("A * 2"), A: q("up") });
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

describe("legendExprOf", () => {
  const queries = [{ query: 'avg(up{ns="$ns"})' }];

  it("prefers the query as sent, with variables filled in", () => {
    const metadata = { queries: [{ panelQueryIndex: 0, query: 'avg(up{ns="prod"})' }] };
    expect(legendExprOf(queries, metadata, 0)).toBe('avg(up{ns="prod"})');
  });

  it("falls back to the saved query without metadata", () => {
    expect(legendExprOf(queries, null, 0)).toBe('avg(up{ns="$ns"})');
  });
});
