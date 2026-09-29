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
import { exemplarQueryIndexes, isExemplarEligible } from "./exemplarEligibility";

const panel = (type: string, queryType: string, queryTypes: (string | undefined)[]) => ({
  type,
  queryType,
  queries: queryTypes.map((query_type) => ({ config: { query_type } })),
});

describe("isExemplarEligible", () => {
  it.each(["line", "area", "bar", "scatter"])("accepts a PromQL range %s panel", (type) => {
    expect(isExemplarEligible(panel(type, "promql", ["range"]))).toBe(true);
  });

  it("treats a query without query_type as a range query", () => {
    expect(isExemplarEligible(panel("line", "promql", [undefined]))).toBe(true);
  });

  it.each([
    "h-bar",
    "stacked",
    "area-stacked",
    "h-stacked",
    "table",
    "metric",
    "gauge",
    "heatmap",
    "pie",
  ])("rejects chart type %s", (type) => {
    expect(isExemplarEligible(panel(type, "promql", ["range"]))).toBe(false);
  });

  it.each(["sql", "builder", "custom"])("rejects a %s panel", (queryType) => {
    expect(isExemplarEligible(panel("line", queryType, ["range"]))).toBe(false);
  });

  it("rejects a panel whose queries are all instant", () => {
    expect(isExemplarEligible(panel("line", "promql", ["instant", "instant"]))).toBe(false);
  });

  it("rejects a missing panel", () => {
    expect(isExemplarEligible(undefined)).toBe(false);
  });
});

describe("exemplarQueryIndexes", () => {
  it("skips instant and hidden queries", () => {
    const p = panel("line", "promql", ["range", "instant", undefined, "range"]);
    expect(exemplarQueryIndexes(p)).toEqual([0, 2, 3]);
    expect(exemplarQueryIndexes(p, [2])).toEqual([0, 3]);
  });

  it("returns nothing for an ineligible panel", () => {
    expect(exemplarQueryIndexes(panel("table", "promql", ["range"]))).toEqual([]);
  });
});
