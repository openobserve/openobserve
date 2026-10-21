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
import {
  createFilterCondition,
  createFilterGroup,
  legacyFiltersToGroup,
} from "@/utils/dashboard/variables/variableFilterGroupUtils";

const schema = makeAddSettingVariableSchema((key: string) => key);

const issuesFor = (value: Record<string, unknown>) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

const autoSql = { stream_type: "logs", stream: "default", field: "host" };

describe("AddSettingVariable schema — query_values modes", () => {
  it("asks an auto variable for stream type, stream and field, never for a query", () => {
    expect(issuesFor({ name: "svc", type: "query_values", query_data: {} })).toEqual([
      "query_data.stream_type",
      "query_data.stream",
      "query_data.field",
    ]);
    expect(issuesFor({ name: "svc", type: "query_values", query_data: autoSql })).toEqual([]);
  });

  it("asks a custom variable for a query and stream type, not for stream or field", () => {
    expect(
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: { custom_query: true, stream_type: "logs", query: "  " },
      }),
    ).toEqual(["query_data.query"]);
    expect(
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: {
          custom_query: true,
          stream_type: "metrics",
          query_type: "promql",
          query: "label_values(job)",
        },
      }),
    ).toEqual([]);
  });

  it("reports the query-required message", () => {
    const result = schema.safeParse({
      name: "svc",
      type: "query_values",
      query_data: { custom_query: true, stream_type: "logs" },
    });
    expect(result.error?.issues[0].message).toBe("dashboard.queryVariable.queryRequired");
  });

  it("ignores half-filled filter rows while the variable is custom", () => {
    expect(
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: {
          custom_query: true,
          stream_type: "logs",
          query: "SELECT 1",
          filter_group: legacyFiltersToGroup([{ name: "", operator: "", value: "" }]),
        },
      }),
    ).toEqual([]);
  });

  it("only accepts operators an auto PromQL variable can turn into label matchers", () => {
    const promql = (operator: string) =>
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: {
          stream_type: "metrics",
          stream: "up",
          field: "job",
          query_type: "promql",
          filter_group: legacyFiltersToGroup([{ name: "env", operator, value: "prod" }]),
        },
      });
    expect(promql("=")).toEqual([]);
    expect(promql("re_match")).toEqual([]);
    expect(promql(">")).toEqual(["query_data.filter_group.conditions.0.operator"]);
    expect(promql("str_match")).toEqual(["query_data.filter_group.conditions.0.operator"]);
    expect(
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: {
          ...autoSql,
          filter_group: legacyFiltersToGroup([{ name: "env", operator: ">", value: "1" }]),
        },
      }),
    ).toEqual([]);
  });

  const condition = (field: string, operator: string, value: string, logic: "AND" | "OR") => ({
    ...createFilterCondition(logic),
    column: { field },
    operator,
    value,
  });

  const orGroup = createFilterGroup("AND", [
    condition("env", "=", "prod", "AND"),
    createFilterGroup("OR", [
      condition("level", "=", "error", "AND"),
      condition("", "=", "", "OR"),
    ]),
  ]);

  it("validates conditions inside nested groups by their full path", () => {
    expect(
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: { ...autoSql, filter_group: orGroup },
      }),
    ).toEqual([
      "query_data.filter_group.conditions.1.conditions.1.column.field",
      "query_data.filter_group.conditions.1.conditions.1.value",
    ]);
  });

  it("allows OR and nesting for SQL but blocks them for PromQL with a clear message", () => {
    const sqlOr = createFilterGroup("AND", [
      condition("env", "=", "prod", "AND"),
      condition("env", "=", "dev", "OR"),
    ]);
    expect(
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: { ...autoSql, filter_group: sqlOr },
      }),
    ).toEqual([]);
    const promqlData = { stream_type: "metrics", stream: "up", field: "job", query_type: "promql" };
    const orResult = schema.safeParse({
      name: "svc",
      type: "query_values",
      query_data: { ...promqlData, filter_group: sqlOr },
    });
    expect(orResult.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["query_data.filter_group", "dashboard.queryVariable.promqlFiltersAndOnly"],
    ]);
    const nested = createFilterGroup("AND", [
      createFilterGroup("AND", [condition("env", "=", "prod", "AND")]),
    ]);
    expect(
      issuesFor({
        name: "svc",
        type: "query_values",
        query_data: { ...promqlData, filter_group: nested },
      }),
    ).toEqual(["query_data.filter_group"]);
  });

  it("defaults to auto SQL and keeps the custom fields it is given", () => {
    expect(
      schema.parse({ name: "svc", type: "query_values", query_data: autoSql }).query_data,
    ).toMatchObject({ custom_query: false, query_type: "sql" });
    const result = schema.parse({
      name: "svc",
      type: "query_values",
      query_data: {
        custom_query: true,
        stream_type: "logs",
        query: "SELECT a FROM t",
        value_field: "a",
        label_field: null,
      },
    });
    expect(result.query_data).toMatchObject({
      custom_query: true,
      query_type: "sql",
      query: "SELECT a FROM t",
      value_field: "a",
      label_field: null,
    });
  });
});
