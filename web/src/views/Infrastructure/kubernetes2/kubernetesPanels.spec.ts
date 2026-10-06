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
import { promqlPanelSchema } from "./kubernetesPanels";

describe("promqlPanelSchema", () => {
  it("builds a self-querying PromQL panel with one entry per query", () => {
    const schema = promqlPanelSchema({
      id: "cpu",
      type: "area",
      unit: null,
      queries: [
        { query: "sum(a)", stream: "a" },
        { query: "sum(b)", stream: "b", legend: "Allocatable" },
      ],
    });
    expect(schema).toMatchObject({ version: 2, type: "area", queryType: "promql" });
    expect(
      schema.queries.map((q: any) => [
        q.query,
        q.customQuery,
        q.fields.stream,
        q.fields.stream_type,
      ]),
    ).toEqual([
      ["sum(a)", true, "a", "metrics"],
      ["sum(b)", true, "b", "metrics"],
    ]);
    expect(schema.queries[1].config.promql_legend).toBe("Allocatable");
    expect(schema.config.mark_line).toEqual([]);
  });

  it("draws allocatable as a horizontal mark line", () => {
    const schema = promqlPanelSchema({
      id: "o",
      type: "bar",
      unit: "bytes",
      queries: [{ query: "sum(x)", stream: "x" }],
      markLines: [{ value: 8, name: "Allocatable" }],
    });
    expect(schema.config.mark_line).toEqual([{ type: "yAxis", value: 8, name: "Allocatable" }]);
    expect(schema.config.unit).toBe("bytes");
  });
});
