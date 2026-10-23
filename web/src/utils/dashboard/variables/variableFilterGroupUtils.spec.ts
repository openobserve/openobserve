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
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import {
  buildAutoPromqlQuery,
  buildAutoSqlQuery,
  buildFilterGroupSql,
  expandMultiValueFilter,
  PROMQL_FILTER_OPERATORS,
  substituteQueryVariables,
} from "./queryVariableUtils";
import {
  createFilterCondition,
  createFilterGroup,
  filterGroupHasNesting,
  filterGroupHasOr,
  filterGroupToQueryData,
  getFilterConditionIssues,
  getVariableFilterGroup,
  getVariableFilterValues,
  isLegacyCompatibleFilterGroup,
  legacyFiltersToGroup,
  normalizeFilterGroup,
} from "./variableFilterGroupUtils";

const leaf = (field: string, operator: string, value: string, logic: "AND" | "OR" = "AND") => ({
  ...createFilterCondition(logic),
  column: { field },
  operator,
  value,
});

const legacy = [
  { name: "env", operator: "=", value: "$env" },
  { name: "level", operator: "Is Null", value: "" },
];

describe("variableFilterGroupUtils — load", () => {
  it("reads a legacy flat filter array as one AND group of panel-shaped conditions", () => {
    expect(getVariableFilterGroup({ filter: legacy })).toEqual(
      createFilterGroup("AND", [leaf("env", "=", "$env"), leaf("level", "Is Null", "")]),
    );
  });

  it("prefers filter_group when a variable carries both shapes", () => {
    const group = createFilterGroup("AND", [leaf("a", "=", "1"), leaf("b", "=", "2", "OR")]);
    expect(getVariableFilterGroup({ filter: legacy, filter_group: group })).toEqual(group);
  });

  it("reads neither shape as an empty AND group", () => {
    expect(getVariableFilterGroup({})).toEqual(createFilterGroup("AND", []));
    expect(getVariableFilterGroup(null)).toEqual(createFilterGroup("AND", []));
  });

  it("fills every key the backend PanelFilter needs when normalizing", () => {
    const normalized = normalizeFilterGroup({
      conditions: [{ filterType: "condition", column: { field: "x" }, operator: "=" }],
    });
    expect(normalized).toEqual(createFilterGroup("AND", [leaf("x", "=", "")]));
  });
});

describe("variableFilterGroupUtils — save shape", () => {
  it("writes an AND-only flat group as the legacy filter array, unchanged", () => {
    const saved = filterGroupToQueryData(legacyFiltersToGroup(legacy));
    expect(saved).toEqual({ filter: legacy });
    expect(JSON.stringify(saved)).toBe(JSON.stringify({ filter: legacy }));
    expect(filterGroupToQueryData(createFilterGroup("AND", []))).toEqual({ filter: [] });
  });

  it("writes filter_group and no flat copy once OR is used", () => {
    const group = createFilterGroup("AND", [leaf("a", "=", "1"), leaf("b", "=", "2", "OR")]);
    expect(filterGroupHasOr(group)).toBe(true);
    expect(filterGroupToQueryData(group)).toEqual({ filter_group: group });
  });

  it("writes filter_group once a group is nested, even if it is all AND", () => {
    const group = createFilterGroup("AND", [
      leaf("a", "=", "1"),
      createFilterGroup("AND", [leaf("b", "=", "2")]),
    ]);
    expect(filterGroupHasNesting(group)).toBe(true);
    expect(isLegacyCompatibleFilterGroup(group)).toBe(false);
    expect(filterGroupToQueryData(group)).toEqual({ filter_group: group });
  });

  it("ignores the operator on the first condition of a group", () => {
    const group = createFilterGroup("AND", [leaf("a", "=", "1", "OR"), leaf("b", "=", "2")]);
    expect(isLegacyCompatibleFilterGroup(group)).toBe(true);
  });
});

describe("variableFilterGroupUtils — validation and dependencies", () => {
  it("reports missing field, value and PromQL-only operators", () => {
    expect(getFilterConditionIssues(leaf("", "=", ""))).toEqual(["field", "value"]);
    expect(getFilterConditionIssues(leaf("a", "Is Null", ""))).toEqual([]);
    expect(getFilterConditionIssues(leaf("a", ">", "1"), PROMQL_FILTER_OPERATORS)).toEqual([
      "promqlOperator",
    ]);
  });

  it("collects $var values from nested groups and from the legacy array", () => {
    const group = createFilterGroup("AND", [
      leaf("a", "=", "$one"),
      createFilterGroup("OR", [leaf("b", "=", "x"), leaf("c", "IN", "${two}", "OR")]),
    ]);
    expect(getVariableFilterValues({ filter_group: group })).toEqual(["$one", "x", "${two}"]);
    expect(getVariableFilterValues({ filter: legacy })).toEqual(["$env", ""]);
  });
});

describe("variableFilterGroupUtils — SQL execution", () => {
  const group = createFilterGroup("AND", [
    leaf("env", "=", "$env"),
    createFilterGroup("AND", [
      leaf("level", "=", "error"),
      createFilterGroup("OR", [leaf("level", "!=", "$level"), leaf("code", ">=", "500")]),
    ]),
    leaf("host", "str_match", "web", "OR"),
  ]);

  it("parenthesises nested groups and keeps each AND/OR", () => {
    expect(buildFilterGroupSql(group)).toBe(
      `"env" = '$env' AND ("level" = 'error' OR ("level" != '$level' AND "code" >= '500')) OR str_match("host", 'web')`,
    );
  });

  it("expands = / != on a multi-value $var to IN / NOT IN inside groups", () => {
    const values: Record<string, unknown> = { env: ["a", "b"], level: ["x", "y"] };
    const sql = buildFilterGroupSql(group, (filter) =>
      expandMultiValueFilter(filter, (name) => values[name]),
    );
    expect(sql).toContain(`"env" IN ('$env')`);
    expect(sql).toContain(`"level" NOT IN ('$level')`);
    expect(
      substituteQueryVariables(
        sql,
        [
          { name: "env", type: "custom", value: ["a", "b"], isVariablePartialLoaded: true },
          { name: "level", type: "custom", value: ["x", "y"], isVariablePartialLoaded: true },
        ],
        "sql",
      ),
    ).toContain(`"env" IN ('a', 'b') AND ("level" = 'error' OR ("level" NOT IN ('x', 'y')`);
  });

  it("passes an _o2_all_ pick through as the placeholder the backend rewrites", () => {
    const sql = buildFilterGroupSql(group, (filter) =>
      expandMultiValueFilter(filter, (name) => (name === "env" ? [SELECT_ALL_VALUE] : "x")),
    );
    expect(
      substituteQueryVariables(
        sql,
        [
          { name: "env", type: "custom", value: [SELECT_ALL_VALUE], isVariablePartialLoaded: true },
          { name: "level", type: "custom", value: "x", isVariablePartialLoaded: true },
        ],
        "sql",
      ),
    ).toMatch(/^"env" IN \('_o2_all_'\) AND /);
  });

  it("prefills custom SQL with the same WHERE the auto variable runs", () => {
    expect(buildAutoSqlQuery({ stream: "logs", field: "svc", filter_group: group })).toBe(
      `SELECT DISTINCT "svc" FROM "logs" WHERE ${buildFilterGroupSql(group)}`,
    );
    expect(buildAutoSqlQuery({ stream: "logs", field: "svc", filter: legacy })).toBe(
      `SELECT DISTINCT "svc" FROM "logs" WHERE "env" = '$env' AND "level" IS NULL`,
    );
  });

  it("walks the AND conditions of a group for PromQL", () => {
    expect(
      buildAutoPromqlQuery({
        stream: "up",
        field: "job",
        filter_group: createFilterGroup("AND", [leaf("env", "=", "$env"), leaf("dc", "!=", "x")]),
      }),
    ).toBe('label_values(up{env=~"$env",dc!="x"}, job)');
  });
});
