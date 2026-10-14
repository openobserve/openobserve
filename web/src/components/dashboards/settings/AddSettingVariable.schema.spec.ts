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
import { makeAddSettingVariableSchema } from "./AddSettingVariable.schema";

const schema = makeAddSettingVariableSchema((key: string) => key);

const issuesFor = (value: Record<string, unknown>) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("AddSettingVariable schema — query type", () => {
  it("requires a query", () => {
    expect(issuesFor({ name: "svc", type: "query", query_data: { query: "  " } })).toEqual([
      "query_data.query",
    ]);
  });

  it("reports the query-required message", () => {
    const result = schema.safeParse({ name: "svc", type: "query" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("dashboard.queryVariable.queryRequired");
  });

  it("does not require a stream or field", () => {
    expect(
      issuesFor({
        name: "svc",
        type: "query",
        query_data: { query_type: "promql", query: "label_values(job)", stream: "", field: "" },
      }),
    ).toEqual([]);
  });

  it("keeps the query fields and defaults the language to SQL", () => {
    const result = schema.parse({
      name: "svc",
      type: "query",
      query_data: { query: "SELECT a FROM t", value_field: "a", label_field: null },
    });
    expect(result.query_data).toMatchObject({
      query_type: "sql",
      query: "SELECT a FROM t",
      value_field: "a",
      label_field: null,
    });
  });

  it("does not ask a query_values variable for a query", () => {
    expect(
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: { stream_type: "logs", stream: "s", field: "f" },
      }),
    ).toEqual([]);
  });
});
