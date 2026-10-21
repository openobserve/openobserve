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
  condOf,
  conditionOf,
  condProblem,
  draftOf,
  removeFilter,
  setFilter,
  withConds,
} from "./funnelFilters";
import { whyLines, type WhyInput } from "./whyEntered";
import { fitsLink } from "./funnelEdits";
import type { FunnelDef, FunnelFilter } from "@/utils/rum/productAnalyticsQueries";

const DEF: FunnelDef = {
  steps: [
    { kind: "p", key: "/a" },
    { kind: "p", key: "/b" },
  ],
  unit: "sessions",
  window: "session",
  breakdown: null,
};

const isIn = (field: string, values: string[]): FunnelFilter => ({ field, op: "in", values });

describe("Filter all steps edits", () => {
  it("one filter per field: setting a field again replaces its values", () => {
    const one = setFilter(DEF, isIn("geo_info_country", ["India", "India", "Brazil"]))!;
    expect(one.f).toEqual([{ field: "geo_info_country", op: "in", values: ["India", "Brazil"] }]);
    const two = setFilter(
      setFilter(one, isIn("usr_email", ["a@x.io"]))!,
      isIn("geo_info_country", ["Peru"]),
    )!;
    expect(two.f?.map((r) => [r.field, r.values])).toEqual([
      ["usr_email", ["a@x.io"]],
      ["geo_info_country", ["Peru"]],
    ]);
  });

  it("refuses what the server would refuse", () => {
    expect(setFilter(DEF, isIn("geo_info_country", []))).toBeNull();
    expect(setFilter(DEF, isIn("env", ["prod"]))).toBeNull();
    expect(setFilter(DEF, isIn("_all", ["x"]))).toBeNull();
    expect(setFilter(DEF, isIn("context_Plan", ["x"]))).toBeNull();
    expect(setFilter(DEF, { field: "usr_email", op: "regex", values: ["(a"] })).toBeNull();
  });

  it("takes an attribute column and a negated condition, and keeps not only when set", () => {
    const d = setFilter(DEF, {
      field: "context_plan",
      op: "contains",
      values: ["pro"],
      not: true,
    })!;
    expect(d.f).toEqual([{ field: "context_plan", op: "contains", values: ["pro"], not: true }]);
    expect(conditionOf(d.f![0]).id).toBe("notContains");
    expect(setFilter(DEF, isIn("usr_name", ["Ann"]))!.f![0]).not.toHaveProperty("not");
  });

  it("reads eq as is one of, since one listed value matches the same rows", () => {
    expect(conditionOf({ op: "eq" }).id).toBe("in");
    expect(conditionOf({ op: "eq", not: true }).id).toBe("notIn");
  });

  it("removing the last filter drops f entirely", () => {
    const one = setFilter(DEF, isIn("geo_info_city", ["Pune"]))!;
    expect(removeFilter(one, "geo_info_city")).not.toHaveProperty("f");
    expect(removeFilter(one, "usr_id").f).toHaveLength(1);
  });

  it("a definition past a link's length is caught after any edit, not only an added step", () => {
    const many = Array.from({ length: 20 }, (_, i) => `${"v".repeat(400)}${i}`);
    let d: FunnelDef | null = DEF;
    for (const field of ["geo_info_city", "usr_email", "usr_id"] as const)
      d = d && setFilter(d, isIn(field, many));
    expect(d).not.toBeNull();
    expect(fitsLink(DEF)).toBe(true);
    expect(fitsLink(d!)).toBe(false);
  });
});

describe("Only when rows", () => {
  it("a typed row becomes a condition once it is complete and valid", () => {
    expect(condOf({ t: "param", key: "", values: "ads" })).toBeNull();
    expect(condOf({ t: "param", key: "utm_source", values: " ads, mail ,ads" })).toEqual({
      t: "param",
      key: "utm_source",
      op: "eq",
      values: ["ads", "mail"],
    });
    expect(condOf({ t: "ref", key: "", values: "Google.com" })).toEqual({
      t: "ref",
      op: "eq",
      values: ["google.com"],
    });
  });

  it("names a credential parameter and a malformed row, and stays quiet while a row is incomplete", () => {
    expect(condProblem({ t: "param", key: "token", values: "x" })).toBe("credential");
    expect(condProblem({ t: "param", key: "a b", values: "x" })).toBe("invalid");
    expect(condProblem({ t: "ref", key: "", values: "https://x.com" })).toBe("invalid");
    expect(condProblem({ t: "param", key: "", values: "x" })).toBeNull();
    expect(condProblem({ t: "param", key: "plan", values: "" })).toBeNull();
  });

  it("a condition round-trips through its draft", () => {
    const c = { t: "param" as const, key: "plan", op: "eq" as const, values: ["pro", "team"] };
    expect(condOf(draftOf(c))).toEqual(c);
  });

  it("withConds keeps the step's other filters and drops vc when empty", () => {
    const step = { kind: "p" as const, key: "/a", f: { minMs: 1000 } };
    const c = { t: "ref" as const, op: "eq" as const, values: ["a.io"] };
    expect(withConds(step, [c])).toEqual({ kind: "p", key: "/a", f: { minMs: 1000, vc: [c] } });
    expect(withConds(step, [])).toEqual(step);
    expect(withConds({ kind: "p", key: "/a", f: { vc: [c] } }, [])).toEqual({
      kind: "p",
      key: "/a",
    });
  });
});

describe("Why N? lines", () => {
  const base: WhyInput = {
    total: 1195,
    synthetic: 20,
    builtinKept: 471,
    kept: 433,
    opened: 423,
    inFilter: 212,
    entered: 212,
    removed: [4],
    atStep1: [false],
    hasFilters: true,
  };

  it("lists each removal once, in SQL order, and the removals add up to the entry count", () => {
    const { lines, exact } = whyLines(base);
    expect(lines.map((l) => [l.id, l.count])).toEqual([
      ["app", 1215],
      ["synthetic", 20],
      ["bots", 724],
      ["appFilters", 38],
      ["step1", 10],
      ["filters", 211],
      ["entered", 212],
      ["excluded", 4],
    ]);
    const removals = lines.filter((l) => !["app", "entered", "excluded"].includes(l.id));
    expect(lines[0].count - removals.reduce((s, l) => s + l.count, 0)).toBe(base.entered);
    expect(exact).toBe(true);
  });

  it("names step 1's own conditions only when they removed someone, and leaves out unused lines", () => {
    const { lines } = whyLines({
      ...base,
      entered: 200,
      removed: [],
      atStep1: [],
      hasFilters: false,
      inFilter: 423,
    });
    expect(lines.map((l) => l.id)).toEqual([
      "app",
      "synthetic",
      "bots",
      "appFilters",
      "step1",
      "conditions",
      "entered",
    ]);
    expect(lines.find((l) => l.id === "conditions")?.count).toBe(223);
  });

  it("hidden traffic included: the summary keeps everyone, so the rule lines read zero", () => {
    const { lines } = whyLines({
      ...base,
      builtinKept: 1195,
      kept: 1195,
      opened: 1100,
      inFilter: 300,
      entered: 300,
    });
    expect(lines.find((l) => l.id === "bots")?.count).toBe(0);
    expect(lines.find((l) => l.id === "appFilters")?.count).toBe(0);
    expect(lines.find((l) => l.id === "step1")?.count).toBe(95);
  });

  it("a within exclusion on step 1 gets its own line before Entered, not the conditions line", () => {
    const { lines, exact } = whyLines({
      ...base,
      inFilter: 212,
      entered: 197,
      removed: [15, 4],
      atStep1: [true, false],
    });
    expect(lines.map((l) => [l.id, l.count]).slice(-3)).toEqual([
      ["excludedStep1", 15],
      ["entered", 197],
      ["excluded", 4],
    ]);
    expect(lines.some((l) => l.id === "conditions")).toBe(false);
    expect(exact).toBe(true);
  });

  it("is estimated when step-1 exclusions overlap or their counts are missing", () => {
    expect(
      whyLines({ ...base, entered: 190, removed: [15, 15], atStep1: [true, true] }).exact,
    ).toBe(false);
    expect(whyLines({ ...base, removed: [], atStep1: [true] }).exact).toBe(false);
  });

  it("is not exact when the lines cannot add up", () => {
    expect(whyLines({ ...base, entered: 250 }).exact).toBe(false);
  });
});
