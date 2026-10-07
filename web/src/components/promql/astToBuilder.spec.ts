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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { promqlToBuilder, stripParens, treeToBuilder } from "./astToBuilder";
import { promqlRenderer } from "./operations/queryModeller";

const { parsePromqlQuery } = vi.hoisted(() => ({ parsePromqlQuery: vi.fn() }));
vi.mock("@/services/metrics", () => ({ default: { parsePromqlQuery } }));

const sel = (name: string | null, matchers: any[] = []) => ({ type: "selector", name, matchers });
const num = (value: number) => ({ type: "number", value });
const matrix = (name: string, range: string, matchers: any[] = []) => ({
  type: "matrix",
  range,
  selector: { name, matchers },
});
const call = (func: string, ...args: any[]) => ({ type: "call", func, args });
const agg = (op: string, expr: any, by: string[] = [], param: any = null) => ({
  type: "aggregate",
  op,
  by,
  param,
  expr,
});
const bin = (op: string, lhs: any, rhs: any) => ({ type: "binary", op, lhs, rhs });
const paren = (expr: any) => ({ type: "paren", expr });

const ok = (tree: any) => {
  const mapped = treeToBuilder(tree);
  if (!mapped.ok) throw new Error(`expected a mapping, got: ${mapped.reason}`);
  return mapped.query;
};
const reason = (tree: any) => {
  const mapped = treeToBuilder(tree);
  if (mapped.ok) throw new Error("expected no mapping");
  return mapped.reason;
};

describe("treeToBuilder", () => {
  it("maps a selector and its matchers", () => {
    const matchers = [{ label: "job", op: "=~", value: "a|b" }];
    expect(ok(sel("up", matchers))).toEqual({ metric: "up", labels: matchers, operations: [] });
  });

  it("maps a chain inside-out: range function, aggregate, scalar step", () => {
    const tree = bin(
      "*",
      agg("sum", call("rate", matrix("x", "5m", [{ label: "code", op: "=", value: "500" }])), [
        "job",
      ]),
      num(100),
    );
    expect(ok(tree)).toEqual({
      metric: "x",
      labels: [{ label: "code", op: "=", value: "500" }],
      operations: [
        { id: "rate", params: ["5m"] },
        { id: "sum", params: [["job"]] },
        { id: "scalar_multiply", params: [100] },
      ],
    });
  });

  it("maps step parameters: quantile_over_time, topk, histogram_quantile, clamp, round", () => {
    expect(ok(call("quantile_over_time", num(0.9), matrix("x", "$__interval"))).operations).toEqual(
      [{ id: "quantile_over_time", params: [0.9, "$__interval"] }],
    );
    expect(ok(agg("topk", sel("x"), ["job"], num(5))).operations).toEqual([
      { id: "topk", params: [5, ["job"]] },
    ]);
    expect(ok(call("histogram_quantile", num(0.99), sel("x"))).operations).toEqual([
      { id: "histogram_quantile", params: [0.99] },
    ]);
    expect(ok(call("clamp", sel("x"), num(0), num(10))).operations).toEqual([
      { id: "clamp", params: [0, 10] },
    ]);
    expect(ok(call("clamp_max", sel("x"), num(10))).operations).toEqual([
      { id: "clamp_max", params: [10] },
    ]);
    expect(ok(call("round", sel("x"))).operations).toEqual([{ id: "round", params: [1] }]);
    expect(ok(call("round", sel("x"), num(5))).operations).toEqual([{ id: "round", params: [5] }]);
    expect(ok(call("abs", sel("x"))).operations).toEqual([{ id: "abs", params: [] }]);
  });

  it("maps an aggregate times a constant", () => {
    const tree = bin(
      "*",
      agg("avg", sel("node_load1", [{ label: "job", op: "=", value: "node" }]), ["instance"]),
      num(100),
    );
    const query = ok(tree);
    expect(query.operations).toEqual([
      { id: "avg", params: [["instance"]] },
      { id: "scalar_multiply", params: [100] },
    ]);
    expect(promqlRenderer.renderQuery(query)).toBe(
      'avg by (instance) (node_load1{job="node"}) * 100',
    );
  });

  it("looks through parentheses", () => {
    expect(ok(bin("*", paren(bin("+", sel("x"), num(1))), num(2))).operations).toEqual([
      { id: "scalar_add", params: [1] },
      { id: "scalar_multiply", params: [2] },
    ]);
  });

  it("names the first construct it cannot show", () => {
    expect(reason({ type: "unsupported", kind: "without" })).toBe(
      "The builder cannot show a without (…) grouping",
    );
    expect(reason(call("rate", { type: "unsupported", kind: "subquery" }))).toBe(
      "The builder cannot show a subquery",
    );
    expect(reason(call("label_replace", sel("x")))).toBe(
      "The builder cannot show the function label_replace()",
    );
    expect(reason(agg("count_values", sel("x")))).toBe(
      "The builder cannot show the aggregation count_values",
    );
    expect(reason(bin("+", num(1), sel("x")))).toBe(
      "The builder cannot show a number on the left of +",
    );
    expect(reason(bin(">", sel("x"), num(1)))).toBe("The builder cannot show the operator >");
    expect(reason(sel(null))).toBe("The builder needs a query over one named metric");
    expect(reason(num(3))).toBe("The builder needs a query over one named metric");
  });

  it("describes every construct the backend marks unsupported in words", () => {
    const said = (kind: string) => reason({ type: "unsupported", kind });
    expect(said("@")).toBe("The builder cannot show an @ modifier");
    expect(said("or matchers")).toBe("The builder cannot show an or between label matchers");
    expect(said("vector matching")).toBe(
      "The builder cannot show on (…) or ignoring (…) vector matching",
    );
    expect(said("bool")).toBe("The builder cannot show a bool comparison");
    expect(said("unary minus")).toBe("The builder cannot show a negated expression");
    expect(said("string")).toBe("The builder cannot show a string argument");
    expect(said("or")).toBe("The builder cannot show the set operator or");
    expect(said("unless")).toBe("The builder cannot show the set operator unless");
    expect(reason(matrix("x", "5m"))).toBe("The builder cannot show a bare range vector");
  });

  it("says only that it cannot show the query for a kind it has no words for", () => {
    expect(reason({ type: "unsupported", kind: "extension" })).toBe(
      "The builder cannot show this query exactly",
    );
  });

  it("names an unsupported construct on either side of a binary", () => {
    expect(reason(bin("/", sel("x"), { type: "unsupported", kind: "offset" }))).toBe(
      "The builder cannot show an offset modifier",
    );
  });

  it("does not map onto a retired step", () => {
    expect(reason(call("pi", sel("x")))).toBe("The builder cannot show the function pi()");
  });

  it("points a binary between two metrics at formulas", () => {
    expect(reason(bin("/", call("rate", matrix("a", "5m")), call("rate", matrix("b", "5m"))))).toBe(
      "The builder cannot show an operation between two metrics — use a formula",
    );
  });
});

describe("stripParens", () => {
  it("removes paren nodes at every depth", () => {
    expect(stripParens(paren(bin("+", paren(sel("x")), num(1))))).toEqual(
      bin("+", sel("x"), num(1)),
    );
  });
});

describe("promqlToBuilder", () => {
  const TEXT = "sum by (job)(rate(x[5m]))";
  const TREE = agg("sum", call("rate", matrix("x", "5m")), ["job"]);

  beforeEach(() => {
    parsePromqlQuery.mockReset();
  });

  it("maps a query whose rendering parses back to the same tree", async () => {
    parsePromqlQuery.mockResolvedValue({ data: { data: TREE } });
    const result = await promqlToBuilder("org", TEXT);
    expect(result.ok).toBe(true);
    expect(parsePromqlQuery).toHaveBeenNthCalledWith(1, { org_identifier: "org", query: TEXT });
    expect(parsePromqlQuery.mock.calls[1][0].query).toBe("sum by (job) (rate(x{}[5m]))");
  });

  it("refuses when the rendering parses to a different tree", async () => {
    parsePromqlQuery.mockResolvedValueOnce({ data: { data: TREE } }).mockResolvedValueOnce({
      data: { data: agg("sum", call("rate", matrix("x", "1m")), ["job"]) },
    });
    expect(await promqlToBuilder("org", TEXT)).toEqual({
      ok: false,
      reason: "The builder cannot show this query exactly",
    });
  });

  it("returns the parser's message for a query that does not parse", async () => {
    parsePromqlQuery.mockRejectedValue({
      response: { data: { status: "error", error: "unclosed left parenthesis" } },
    });
    expect(await promqlToBuilder("org", "sum(x")).toEqual({
      ok: false,
      reason: "unclosed left parenthesis",
    });
  });
});
