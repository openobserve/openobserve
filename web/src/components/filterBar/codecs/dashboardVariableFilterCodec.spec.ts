// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import {
  appendNode,
  makeCondition,
  replaceNode,
  toggleConnector,
  type FilterCondition,
  type FilterGroup,
} from "@/utils/query/filterBar";
import {
  dashboardVariableFilterCodec,
  leafConditions,
  makeGroup,
  type CodecContext,
} from "./index";
import { FILTER_PROFILES } from "../filterProfiles";
import { filterIssues } from "../filterValidation";

const context: CodecContext = { fields: [{ name: "level", type: "string" }] };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const t = ((key: string) => key) as any;

const rows = [
  { name: "env", operator: "=", value: "$env" },
  { name: "level", operator: "!=", value: "debug" },
];

const leaf = (field: string, operator: string, value: string, logicalOperator = "AND") => ({
  type: "condition",
  column: { field },
  filterType: "condition",
  operator,
  value,
  logicalOperator,
  values: [],
});

const orGroup = {
  filterType: "group",
  logicalOperator: "AND",
  conditions: [leaf("env", "=", "prod"), leaf("level", "=", "error", "OR")],
};

const edit = (tree: FilterGroup, index: number, patch: Partial<FilterCondition>) => {
  const target = leafConditions(tree)[index];
  return replaceNode(tree, target.id, { ...target, ...patch });
};

describe("dashboard variable filter codec (SQL)", () => {
  const codec = dashboardVariableFilterCodec();

  it("writes an untouched AND-only filter back as the same flat rows", () => {
    const out = codec.serialize(codec.parse({ filter: clone(rows) }, context), context);
    expect(JSON.stringify(out)).toBe(JSON.stringify({ filter: rows }));
  });

  it("keeps an edited AND-only filter flat, in the variable spelling", () => {
    const tree = codec.parse({ filter: clone(rows) }, context);
    const out = codec.serialize(edit(tree, 1, { values: ["info"] }), context);
    expect(out).toEqual({
      filter: [rows[0], { name: "level", operator: "!=", value: "info" }],
    });
  });

  it("writes filter_group in the panel shape once OR is used, with no flat copy", () => {
    const tree = codec.parse({ filter: clone(rows) }, context);
    const out = codec.serialize(toggleConnector(tree, tree.items[1].id), context);
    expect(out).not.toHaveProperty("filter");
    expect(out.filter_group).toEqual({
      conditions: [leaf("env", "=", "$env"), { ...leaf("level", "<>", "debug", "OR"), values: [] }],
      filterType: "group",
      logicalOperator: "AND",
    });
  });

  it("writes a nested group as filter_group", () => {
    const tree = codec.parse({ filter: clone(rows) }, context);
    const nested = appendNode(tree, makeGroup([makeCondition("level", "eq", ["warn"])]));
    const out = codec.serialize(nested, context);
    expect(out).not.toHaveProperty("filter");
    expect(out.filter_group?.conditions[2]).toMatchObject({
      filterType: "group",
      conditions: [{ column: { field: "level" }, operator: "=", value: "warn" }],
    });
  });

  it("turns a locked flat row into a panel leaf when the filter becomes a group", () => {
    const saved = [rows[0], { name: "host", operator: "~~", value: "x" }];
    const tree = codec.parse({ filter: clone(saved) }, context);
    expect(tree.items[1].kind).toBe("raw");
    const out = codec.serialize(toggleConnector(tree, tree.items[1].id), context);
    expect(out.filter_group?.conditions[1]).toEqual(leaf("host", "~~", "x", "OR"));
  });

  it("reads filter_group before the flat rows and writes it back untouched", () => {
    const tree = codec.parse({ filter: clone(rows), filter_group: clone(orGroup) as any }, context);
    expect(leafConditions(tree).map((c) => c.field)).toEqual(["env", "level"]);
    const out = codec.serialize(tree, context);
    expect(JSON.stringify(out)).toBe(JSON.stringify({ filter_group: orGroup }));
  });

  it("goes back to flat rows when the OR is removed from a saved group", () => {
    const tree = codec.parse({ filter_group: clone(orGroup) as any }, context);
    const out = codec.serialize(toggleConnector(tree, tree.items[1].id), context);
    expect(out).toEqual({
      filter: [
        { name: "env", operator: "=", value: "prod" },
        { name: "level", operator: "=", value: "error" },
      ],
    });
  });
});

describe("dashboard variable profiles", () => {
  it("allows AND/OR and groups for SQL, like panel filters", () => {
    const sql = FILTER_PROFILES["dashboard-variable"];
    expect(sql.connectors).toBe("per-item");
    expect(sql.maxDepth).toBeNull();
  });

  it("keeps PromQL to a flat AND list and flags operators no label matcher has", () => {
    const promql = FILTER_PROFILES["dashboard-variable-promql"];
    expect(promql.connectors).toBe("and-only");
    expect(promql.maxDepth).toBe(1);
    const tree = promql.codec.parse(
      { filter: [{ name: "status", operator: ">", value: "1" }] },
      context,
    );
    const issues = filterIssues(tree, promql, { t, saved: promql.codec.serialize(tree, context) });
    expect(issues.map((issue) => issue.message)).toEqual([
      "dashboard.queryVariable.promqlOperatorUnsupported",
    ]);
  });

  it("keeps a group written under SQL for PromQL and reports it instead of rewriting it", () => {
    const promql = FILTER_PROFILES["dashboard-variable-promql"];
    const tree = promql.codec.parse({ filter_group: clone(orGroup) as any }, context);
    const saved = promql.codec.serialize(tree, context);
    expect(JSON.stringify(saved)).toBe(JSON.stringify({ filter_group: orGroup }));
    expect(filterIssues(tree, promql, { t, saved })).toEqual([
      { nodeId: null, message: "dashboard.queryVariable.promqlFiltersAndOnly" },
    ]);
  });
});
