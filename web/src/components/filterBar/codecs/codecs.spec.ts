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
import type { DimensionCondition } from "@/services/downtimes";
import {
  appendNode,
  insertNode,
  makeCondition,
  removeNode,
  replaceNode,
  toggleConnector,
  type FilterCondition,
  type FilterField,
  type FilterGroup,
} from "@/utils/query/filterBar";
import {
  anomalyCodec,
  dashboardFilterCodec,
  dashboardVariableCodec,
  downtimeCodec,
  engineCodec,
  leafConditions,
  metricsLabelsCodec,
  modelPricingCodec,
  profilesCodec,
  promqlLabelsCodec,
  rumExclusionCodec,
  rumFunnelCodec,
  sqlCodec,
  syntheticsCodec,
  TIER_USAGE_PAYLOAD,
  type CodecContext,
  type FilterCodec,
} from "./index";
import { pruneIncomplete } from "../filterValidation";
import { FILTER_PROFILES } from "../filterProfiles";
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
import { buildCondition } from "@/utils/dashboard/dashboardAutoQueryBuilder";

const context: CodecContext = {
  fields: [
    { name: "level", type: "string" },
    { name: "status", type: "number" },
    { name: "k8s_namespace_name", type: "string" },
  ] as FilterField[],
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The golden rule: an untouched filter is written back exactly as it was loaded. */
function expectRoundTrip<T>(codec: FilterCodec<T>, saved: T) {
  const before = JSON.stringify(saved);
  const out = codec.serialize(codec.parse(clone(saved), context), context);
  expect(JSON.stringify(out)).toBe(before);
}

const leaves = (tree: FilterGroup) => leafConditions(tree);

const edit = (tree: FilterGroup, index: number, patch: Partial<FilterCondition>) => {
  const target = leaves(tree)[index];
  return replaceNode(tree, target.id, { ...target, ...patch });
};

describe("engine codec (alerts, pipelines, workflows, evals, annotations)", () => {
  const codec = engineCodec();

  const v2 = {
    filterType: "group",
    logicalOperator: "AND",
    groupId: "g-root",
    conditions: [
      {
        filterType: "condition",
        column: "level",
        operator: "=",
        value: "error",
        values: [],
        logicalOperator: "AND",
        id: "c1",
      },
      {
        filterType: "condition",
        column: "message",
        operator: "contains",
        value: "timeout",
        case_insensitive: true,
        logicalOperator: "OR",
      },
      {
        filterType: "group",
        logicalOperator: "AND",
        groupId: "g1",
        conditions: [
          {
            filterType: "condition",
            column: "status",
            operator: ">=",
            value: 500,
            logicalOperator: "AND",
            id: "c3",
          },
          {
            filterType: "condition",
            column: "trace_id",
            operator: "is_null",
            value: "",
            logicalOperator: "OR",
            id: "c4",
          },
          {
            filterType: "group",
            logicalOperator: "OR",
            groupId: "g2",
            conditions: [
              {
                filterType: "condition",
                column: "k8s_namespace_name",
                operator: "in",
                value: ["prod", "staging"],
                logicalOperator: "AND",
                id: "c5",
              },
            ],
          },
        ],
      },
    ],
  };

  const v1be = {
    and: [
      { column: "level", operator: "=", value: "error", ignore_case: false },
      { or: [{ column: "status", operator: ">", value: "400", ignore_case: false }] },
    ],
  };

  const v1fe = {
    groupId: "g",
    label: "or",
    items: [
      { column: "level", operator: "NotContains", value: "debug", ignore_case: true, id: "a" },
      { groupId: "h", label: "and", items: [{ column: "x", operator: "<", value: 3, id: "b" }] },
    ],
  };

  const v0 = [
    { column: "level", operator: "=", value: "error" },
    { column: "status", operator: "!=", value: "200" },
  ];

  it("writes every untouched format back unchanged", () => {
    for (const saved of [v2, v1be, v1fe, v0, null]) expectRoundTrip(codec, saved as never);
  });

  it("reads per-item connectors, case-insensitive contains and JSON-array lists", () => {
    const tree = codec.parse(clone(v2) as never, context);
    const [level, message, status, traceId, namespace] = leaves(tree);
    expect(level).toMatchObject({ field: "level", operator: "eq", values: ["error"] });
    expect(message).toMatchObject({ operator: "contains_ci", connector: "OR" });
    expect(status).toMatchObject({ operator: "gte", values: ["500"] });
    expect(traceId).toMatchObject({ operator: "is_null", values: [], connector: "OR" });
    expect(namespace).toMatchObject({ operator: "in", values: ["prod", "staging"] });
    expect(tree.items[2]).toMatchObject({ kind: "group", connector: "AND" });
  });

  it("changes only the edited leaf and keeps the others' saved objects", () => {
    const tree = codec.parse(clone(v2) as never, context);
    const out = codec.serialize(edit(tree, 0, { values: ["warn"] }), context) as typeof v2;
    expect(out.conditions[0]).toEqual({ ...v2.conditions[0], value: "warn" });
    expect(out.conditions[1]).toEqual(v2.conditions[1]);
    expect(out.conditions[2]).toEqual(v2.conditions[2]);
  });

  it("keeps a numeric saved value numeric and writes lists as arrays", () => {
    const tree = codec.parse(clone(v2) as never, context);
    const changed = edit(edit(tree, 2, { values: ["502"] }), 4, { values: ["dev"] });
    const out = codec.serialize(changed, context) as any;
    expect(out.conditions[2].conditions[0].value).toBe(502);
    expect(out.conditions[2].conditions[2].conditions[0].value).toEqual(["dev"]);
  });

  it("writes new operators with the backend's canonical names and case_insensitive for contains_ci", () => {
    let tree = codec.parse(null, context);
    tree = appendNode(tree, makeCondition("message", "contains_ci", ["Timeout"]));
    tree = appendNode(tree, makeCondition("path", "starts_with", ["/api"], "OR"));
    tree = appendNode(tree, makeCondition("status", "not_in", ["200", "204"]));
    tree = appendNode(tree, makeCondition("user", "not_regex", ["^bot"]));
    const out = codec.serialize(tree, context) as any;
    expect(out.filterType).toBe("group");
    expect(out.conditions.map((c: any) => [c.operator, c.value, c.logicalOperator])).toEqual([
      ["Contains", "Timeout", "AND"],
      ["starts_with", "/api", "OR"],
      ["not_in", [200, 204], "AND"],
      ["re_not_match", "^bot", "AND"],
    ]);
    expect(out.conditions[0].case_insensitive).toBe(true);
    expect(out.conditions[0]).not.toHaveProperty("ignore_case");
  });

  it("drops case_insensitive once the operator is no longer case-insensitive contains", () => {
    for (const operator of ["contains", "eq", "not_contains"] as const) {
      const tree = codec.parse(clone(v2) as never, context);
      const out = codec.serialize(edit(tree, 1, { operator }), context) as any;
      expect(out.conditions[1]).not.toHaveProperty("case_insensitive");
    }
  });

  it("keeps case_insensitive saved on a non-contains operator when the value or field is edited", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "level",
          operator: "=",
          value: "Error",
          case_insensitive: true,
          logicalOperator: "AND",
          id: "c1",
        },
      ],
    };
    expectRoundTrip(codec, saved as never);
    const tree = codec.parse(clone(saved) as never, context);
    expect(leaves(tree)[0].operator).toBe("eq");
    const changes: Partial<FilterCondition>[] = [
      { values: ["Warn"] },
      { field: "k8s_namespace_name" },
      { operator: "neq" },
    ];
    for (const change of changes) {
      const out = codec.serialize(edit(tree, 0, change), context) as any;
      expect(out.conditions[0].case_insensitive).toBe(true);
    }
  });

  it("keeps a legacy ignore_case as saved and does not read it as case-insensitive", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "a",
          operator: "Contains",
          value: "x",
          ignore_case: true,
          logicalOperator: "AND",
          id: "c1",
        },
      ],
    };
    expectRoundTrip(codec, saved as never);
    const tree = codec.parse(clone(saved) as never, context);
    expect(leaves(tree)[0].operator).toBe("contains");
    const out = codec.serialize(edit(tree, 0, { operator: "eq" }), context) as any;
    expect(out.conditions[0]).toMatchObject({ operator: "=", ignore_case: true });
    expect(out.conditions[0]).not.toHaveProperty("case_insensitive");
  });

  describe("legacy ignore_case moving onto a new operator", () => {
    const legacySaved = () => ({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "level",
          operator: "=",
          value: "error",
          ignore_case: true,
          logicalOperator: "AND",
          id: "c1",
        },
      ],
    });
    const previewSql = (group: unknown) =>
      buildConditionsString(group, {
        sqlMode: true,
        formatValues: true,
        streamFieldsMap: { level: { label: "level", value: "level", type: "Utf8" } } as any,
      });

    it("saves level = error changed to IN without ignore_case and previews case-sensitive SQL", () => {
      expectRoundTrip(codec, legacySaved() as never);
      const tree = codec.parse(legacySaved() as never, context);
      const out = codec.serialize(
        edit(tree, 0, { operator: "in", values: ["error"] }),
        context,
      ) as any;
      expect(out.conditions[0]).toMatchObject({ operator: "in", value: ["error"] });
      expect(out.conditions[0]).not.toHaveProperty("ignore_case");
      expect(out.conditions[0]).not.toHaveProperty("case_insensitive");
      expect(previewSql(out)).toBe("level IN ('error')");
    });

    it.each(["in", "not_in", "starts_with", "ends_with", "regex", "not_regex"] as const)(
      "drops it on %s",
      (operator) => {
        const tree = codec.parse(legacySaved() as never, context);
        const out = codec.serialize(edit(tree, 0, { operator }), context) as any;
        expect(out.conditions[0]).not.toHaveProperty("ignore_case");
        expect(previewSql(out)).not.toMatch(/lower\(|\(\?i\)/);
      },
    );

    it("keeps it on an edited condition that stays on an original operator", () => {
      const tree = codec.parse(legacySaved() as never, context);
      const out = codec.serialize(edit(tree, 0, { values: ["warn"] }), context) as any;
      expect(out.conditions[0]).toMatchObject({ operator: "=", value: "warn", ignore_case: true });
    });
  });

  it("saves a toggled connector on a locked part and writes a null item back as null", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        null,
        {
          filterType: "condition",
          column: "a",
          operator: "~~",
          value: "x",
          logicalOperator: "AND",
        },
        { filterType: "condition", column: "b", operator: "=", value: "x", logicalOperator: "AND" },
      ],
    };
    const tree = codec.parse(clone(saved) as never, context);
    const locked = tree.items[1];
    const out = codec.serialize(toggleConnector(tree, locked.id), context) as any;
    expect(out.conditions[0]).toBeNull();
    expect(out.conditions[1]).toEqual({ ...saved.conditions[1], logicalOperator: "OR" });
    const edited = codec.serialize(edit(tree, 0, { values: ["y"] }), context) as any;
    expect(edited.conditions[0]).toBeNull();
    expect(edited.conditions[1]).toEqual(saved.conditions[1]);
  });

  it("leaves out a group opened but not yet filled", () => {
    let tree = codec.parse(null, context);
    tree = appendNode(tree, makeCondition("a", "eq", ["1"]));
    tree = appendNode(tree, { kind: "group", id: "g-new", connector: "AND", items: [] });
    const out = codec.serialize(tree, context) as any;
    expect(out.conditions).toHaveLength(1);
  });

  it("keeps the saved spelling of an unchanged operator", () => {
    const tree = codec.parse(clone(v2) as never, context);
    const out = codec.serialize(edit(tree, 1, { values: ["refused"] }), context) as any;
    expect(out.conditions[1].operator).toBe("contains");
    const annotation = engineCodec();
    const fresh = appendNode(
      annotation.parse(null, context),
      makeCondition("a", "not_contains", ["b"]),
    );
    expect((annotation.serialize(fresh, context) as any).conditions[0].operator).toBe(
      "NotContains",
    );
  });

  it("converts V1 to V2 once edited, with the group's AND/OR on every item", () => {
    const tree = codec.parse(clone(v1be) as never, context);
    expect(tree.connector).toBe("AND");
    const out = codec.serialize(toggleConnector(tree, tree.items[1].id), context) as any;
    expect(out.filterType).toBe("group");
    expect(out.conditions[0]).toMatchObject({ column: "level", operator: "=", value: "error" });
    expect(out.conditions[1]).toMatchObject({ filterType: "group", logicalOperator: "OR" });
    expect(out.conditions[1].conditions[0]).toMatchObject({ column: "status", operator: ">" });
  });

  it("reads a V1 frontend tree and a V0 list", () => {
    const fe = codec.parse(clone(v1fe) as never, context);
    expect(leaves(fe)[0]).toMatchObject({ operator: "not_contains", connector: "OR" });
    expect(fe.items[1]).toMatchObject({ kind: "group", connector: "OR" });
    const flat = codec.parse(clone(v0) as never, context);
    expect(leaves(flat).map((c) => c.operator)).toEqual(["eq", "neq"]);
    const out = codec.serialize(removeNode(flat, flat.items[1].id), context) as any;
    expect(out.conditions).toHaveLength(1);
    expect(out.conditions[0]).toMatchObject({ filterType: "condition", column: "level" });
  });

  it("locks an operator it does not know and saves it back", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "a",
          operator: "fuzzy",
          value: "x",
          logicalOperator: "AND",
        },
        { filterType: "condition", column: "b", operator: "=", value: "y", logicalOperator: "AND" },
      ],
    };
    const tree = codec.parse(clone(saved) as never, context);
    expect(tree.items[0]).toMatchObject({ kind: "raw", label: "a fuzzy x" });
    const out = codec.serialize(edit(tree, 0, { values: ["z"] }), context) as any;
    expect(out.conditions[0]).toEqual(saved.conditions[0]);
    expect(out.conditions[1].value).toBe("z");
  });
});

describe("downtime codec", () => {
  const codec = downtimeCodec();
  const eq = (key: string, value: string): DimensionCondition => ({
    type: "pair",
    key,
    operator: "=",
    value,
  });
  const ne = (key: string, value: string): DimensionCondition => ({
    type: "pair",
    key,
    operator: "!=",
    value,
  });
  const and = (...items: DimensionCondition[]): DimensionCondition => ({
    type: "group",
    op: "and",
    items,
  });
  const or = (...items: DimensionCondition[]): DimensionCondition => ({
    type: "group",
    op: "or",
    items,
  });

  const flow7 = and(
    or(eq("service", "payments"), eq("service", "checkout-api")),
    ne("env", "staging"),
  );
  const orRoot = or(eq("host", "a"), and(eq("host", "b"), eq("env", "prod*")));

  it("writes untouched conditions back unchanged, an OR root and a lone pair included", () => {
    for (const saved of [flow7, orRoot, eq("service", "x"), null]) expectRoundTrip(codec, saved);
  });

  it("puts a group's one op on each of its items", () => {
    const tree = codec.parse(clone(orRoot), context);
    expect(tree.items.map((i) => i.connector)).toEqual(["OR", "OR"]);
    const inner = tree.items[1] as FilterGroup;
    expect(inner.items.map((i) => i.connector)).toEqual(["AND", "AND"]);
  });

  it("writes the group op from its items after an edit", () => {
    const tree = codec.parse(clone(flow7), context);
    const inner = tree.items[0] as FilterGroup;
    const flipped = replaceNode(tree, inner.id, {
      ...inner,
      items: inner.items.map((item) => ({ ...item, connector: "AND" as const })),
    });
    expect(codec.serialize(flipped, context)).toEqual(
      and(and(eq("service", "payments"), eq("service", "checkout-api")), ne("env", "staging")),
    );
  });

  it("saves an emptied tree as null and an edited lone pair as a pair", () => {
    const tree = codec.parse(clone(flow7), context);
    expect(codec.serialize({ ...tree, items: [] }, context)).toBeNull();
    const single = codec.parse(eq("service", "x"), context);
    expect(codec.serialize(edit(single, 0, { values: ["y"] }), context)).toEqual(
      eq("service", "y"),
    );
  });
});

describe("dashboard filter codec", () => {
  const codec = dashboardFilterCodec();
  const saved = {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [
      {
        type: "list",
        column: { field: "level", streamAlias: null },
        filterType: "condition",
        operator: null,
        value: null,
        logicalOperator: "AND",
        values: ["error", "warn"],
      },
      {
        type: "condition",
        column: { field: "service", streamAlias: "s" },
        filterType: "condition",
        operator: "=",
        value: "$service",
        logicalOperator: "OR",
        values: [],
      },
      {
        conditions: [
          {
            type: "condition",
            column: "status",
            filterType: "condition",
            operator: "NOT IN",
            value: "'200', '204'",
            logicalOperator: "AND",
            values: [],
          },
          {
            type: "condition",
            column: { field: "msg" },
            filterType: "condition",
            operator: "str_match",
            value: "timeout",
            logicalOperator: "OR",
            values: [],
          },
          {
            type: "condition",
            column: { field: "host" },
            filterType: "condition",
            operator: "Is Not Null",
            value: "",
            logicalOperator: "AND",
            values: [],
          },
        ],
        filterType: "group",
        logicalOperator: "AND",
      },
    ],
  };

  it("writes an untouched panel filter back unchanged", () => {
    expectRoundTrip(codec, saved as never);
    expectRoundTrip(codec, null);
  });

  it("reads list and condition leaves, joined-stream columns and $variables", () => {
    const tree = codec.parse(clone(saved) as never, context);
    const [level, service, status, msg, host] = leaves(tree);
    expect(level).toMatchObject({ field: "level", operator: "in", values: ["error", "warn"] });
    expect(service).toMatchObject({ field: "s.service", values: ["$service"], connector: "OR" });
    expect(status).toMatchObject({ field: "status", operator: "not_in", values: ["200", "204"] });
    expect(msg).toMatchObject({ operator: "contains", connector: "OR" });
    expect(host).toMatchObject({ operator: "is_not_null", values: [] });
  });

  it("keeps the leaf type and the saved spelling while editing values", () => {
    const tree = codec.parse(clone(saved) as never, context);
    const out = codec.serialize(
      edit(edit(edit(tree, 0, { values: ["info"] }), 2, { values: ["200", "a,b"] }), 3, {
        values: ["refused"],
      }),
      context,
    ) as any;
    expect(out.conditions[0]).toMatchObject({ type: "list", values: ["info"], operator: null });
    expect(out.conditions[2].conditions[0]).toMatchObject({
      value: "200,'a,b'",
      operator: "NOT IN",
    });
    expect(out.conditions[2].conditions[1]).toMatchObject({
      operator: "str_match",
      value: "refused",
    });
    expect(out.conditions[2].conditions[0].column).toBe("status");
  });

  it("writes new conditions with dashboard names and the field's stream alias", () => {
    let tree = codec.parse(null, context);
    tree = appendNode(tree, makeCondition("s.service", "contains_ci", ["api"]));
    tree = appendNode(tree, makeCondition("level", "in", ["error"], "OR"));
    const out = codec.serialize(tree, {
      fields: [
        { name: "s.service", type: "string", payload: { field: "service", streamAlias: "s" } },
      ],
    }) as any;
    expect(out.conditions[0]).toMatchObject({
      type: "condition",
      operator: "str_match_ignore_case",
      value: "api",
      column: { field: "service", streamAlias: "s" },
    });
    expect(out.conditions[1]).toMatchObject({
      type: "list",
      values: ["error"],
      logicalOperator: "OR",
    });
  });

  it("writes an IN with a $variable as a condition leaf, since a list leaf quotes each value", () => {
    let tree = codec.parse(null, context);
    tree = appendNode(tree, makeCondition("level", "in", ["(${level})"]));
    const out = codec.serialize(tree, context) as any;
    expect(out.conditions[0]).toMatchObject({
      type: "condition",
      operator: "IN",
      value: "(${level})",
    });
  });
});

describe("dashboard filter codec, an empty literal from SQL", () => {
  const codec = dashboardFilterCodec();
  const context = { fields: [] };
  const leaf = {
    type: "condition",
    column: { field: "service", streamAlias: null },
    filterType: "condition",
    operator: "<>",
    value: "",
    logicalOperator: "AND",
    values: [],
    emptyLiteral: true,
  };
  const group = (item: unknown) => ({
    filterType: "group",
    logicalOperator: "AND",
    conditions: [item],
  });

  it("reads `x <> ''` as a finished condition and saves it back as loaded", () => {
    const saved = group(leaf);
    const tree = codec.parse(saved as never, context);
    expect((tree.items[0] as FilterCondition).values).toEqual([""]);
    expect(codec.serialize(tree, context)).toEqual(saved);
  });

  it("clears the flag once the user types a value", () => {
    const tree = codec.parse(group(leaf) as never, context);
    (tree.items[0] as FilterCondition).values = ["api"];
    const out = codec.serialize(tree, context) as any;
    expect(out.conditions[0].value).toBe("api");
    expect(out.conditions[0].emptyLiteral).toBeUndefined();
  });

  it("still reads a value not entered yet as no value", () => {
    const { emptyLiteral: _flag, ...blank } = leaf;
    const tree = codec.parse(group(blank) as never, context);
    expect((tree.items[0] as FilterCondition).values).toEqual([]);
  });
});

describe("label group codecs", () => {
  const codec = promqlLabelsCodec();
  const context = { fields: [] };
  const saved = [
    { label: "code", op: "=", value: "500", group: 3 },
    { label: "job", op: "=", value: "api" },
    { label: "env", op: "=", value: "prod", group: 5, negate: true },
  ];

  it("shows base matchers first, then one group per number, and saves back untouched", () => {
    const tree = codec.parse(saved, context);
    expect(tree.items.map((item) => item.kind)).toEqual(["condition", "group", "group"]);
    expect((tree.items[2] as FilterGroup).negate).toBe(true);
    expect(codec.serialize(tree, context)).toBe(saved);
  });

  it("keeps group numbers on an edit, and gives a new group the next one", () => {
    const tree = codec.parse(saved, context);
    const added = { ...(tree.items[0] as FilterCondition), id: "new", field: "path" };
    tree.items.push({ kind: "group", id: "g", connector: "AND", items: [added] });
    expect(codec.serialize(tree, context)).toEqual([
      { label: "job", op: "=", value: "api" },
      { label: "code", op: "=", value: "500", group: 3 },
      { label: "env", op: "=", value: "prod", group: 5, negate: true },
      { label: "path", op: "=", value: "api", group: 6 },
    ]);
  });

  it("writes NOT onto every matcher of the group and off again", () => {
    const tree = codec.parse(saved, context);
    (tree.items[1] as FilterGroup).negate = true;
    delete (tree.items[2] as FilterGroup).negate;
    expect(codec.serialize(tree, context)).toEqual([
      { label: "job", op: "=", value: "api" },
      { label: "code", op: "=", value: "500", group: 3, negate: true },
      { label: "env", op: "=", value: "prod", group: 5 },
    ]);
  });

  it("the metrics explorer's filters group the same way", () => {
    const filters = [{ label: "code", operator: "=", value: "500", group: 1 }];
    const tree = metricsLabelsCodec().parse(filters, context);
    expect(tree.items[0].kind).toBe("group");
  });
});

describe("flat codecs", () => {
  it("dashboard variable filters keep text IN lists and `!=`", () => {
    const codec = dashboardVariableCodec();
    const saved = [
      { name: "k8s_namespace_name", operator: "IN", value: "('prod','dev')" },
      { name: "level", operator: "!=", value: "$level" },
      { name: "host", operator: "Is Null", value: "" },
    ];
    expectRoundTrip(codec, saved);
    const tree = codec.parse(clone(saved), context);
    expect(leaves(tree)[0].values).toEqual(["prod", "dev"]);
    const out = codec.serialize(edit(tree, 1, { operator: "neq", values: ["x"] }), context);
    expect(out[1]).toEqual({ name: "level", operator: "!=", value: "x" });
    const added = codec.serialize(appendNode(tree, makeCondition("a", "neq", ["b"])), context);
    expect(added[3]).toEqual({ name: "a", operator: "!=", value: "b" });
  });

  it("dashboard variable filters drop a variable's quotes, as addLabelsToSQlQuery re-quotes each value", () => {
    const codec = dashboardVariableCodec();
    const saved = [{ name: "env", operator: "IN", value: "'prod','$env'" }];
    expectRoundTrip(codec, saved);
    const tree = codec.parse(clone(saved), context);
    expect(leaves(tree)[0].values).toEqual(["prod", "$env"]);
    const out = codec.serialize(edit(tree, 0, { values: ["prod", "$env", "stage"] }), context);
    expect(out[0].value).toBe("prod,$env,stage");
  });

  it("anomaly filters stay a flat list while AND-only, and become a V2 group with OR", () => {
    const codec = anomalyCodec();
    const saved = [
      { field: "level", operator: "<>", value: "debug" },
      { field: "status", operator: "IN", value: "'500', '502'" },
    ];
    expectRoundTrip(codec, saved);
    const tree = codec.parse(clone(saved), context);
    const flat = codec.serialize(edit(tree, 1, { values: ["503"] }), context) as any[];
    expect(flat[1]).toEqual({ field: "status", operator: "IN", value: "'503'" });
    const grouped = codec.serialize(toggleConnector(tree, tree.items[1].id), context) as any;
    expect(grouped.filterType).toBe("group");
    expect(grouped.conditions[1]).toMatchObject({
      operator: "in",
      value: [500, 502],
      logicalOperator: "OR",
    });
    expectRoundTrip(codec, grouped);
  });

  it("PromQL matchers read a literal alternation as a list", () => {
    const codec = promqlLabelsCodec();
    const saved = [
      { label: "job", op: "=~", value: "api|web" },
      { label: "pod", op: "=~", value: "api-.*" },
      { label: "env", op: "!=", value: "$env" },
    ];
    expectRoundTrip(codec, saved);
    const tree = codec.parse(clone(saved), context);
    expect(leaves(tree).map((c) => c.operator)).toEqual(["in", "regex", "neq"]);
    const out = codec.serialize(edit(tree, 0, { values: ["a.b", "c"] }), context);
    expect(out[0]).toEqual({ label: "job", op: "=~", value: "a\\.b|c" });
    const added = codec.serialize(
      appendNode(tree, makeCondition("env", "in", ["$env", "prod"])),
      context,
    );
    expect(added[3]).toEqual({ label: "env", op: "=~", value: "$env|prod" });
    expect(leaves(codec.parse(added, context))[3]).toMatchObject({
      operator: "in",
      values: ["$env", "prod"],
    });
    const metrics = metricsLabelsCodec();
    const filters = [{ label: "job", operator: "!~", value: "x|y" }];
    expectRoundTrip(metrics, filters);
    expect(leaves(metrics.parse(clone(filters), context))[0].operator).toBe("not_in");
  });

  it('keeps a saved `label=""` matcher through an unrelated edit', () => {
    const codec = promqlLabelsCodec();
    const saved = [
      { label: "job", op: "=", value: "" },
      { label: "a", op: "=", value: "x" },
    ];
    const tree = codec.parse(clone(saved), context);
    expect(leaves(tree)[0]).toMatchObject({ operator: "eq", values: [""] });
    const next = appendNode(tree, makeCondition("b", "neq", ["y"]));
    expect(codec.serialize(pruneIncomplete(next), context)).toEqual([
      ...saved,
      { label: "b", op: "!=", value: "y" },
    ]);
    const unfinished = appendNode(tree, makeCondition("c", "regex", []));
    expect(codec.serialize(pruneIncomplete(unfinished), context)).toEqual(saved);
  });

  it("profiles, synthetics and RUM keep their own operator names", () => {
    expectRoundTrip(profilesCodec(), [{ key: "service", op: "=", value: "api" }]);
    const synthetics = syntheticsCodec();
    const assertions = [
      { field: "status_code", operator: "eq", value: "200" },
      { field: "body", operator: "not_contains", value: "error" },
    ];
    expectRoundTrip(synthetics, assertions);
    const edited = synthetics.serialize(
      edit(synthetics.parse(clone(assertions), context), 0, { operator: "neq" }),
      context,
    );
    expect(edited[0]).toEqual({ field: "status_code", operator: "ne", value: "200" });

    const funnel = rumFunnelCodec();
    const rules = [
      { field: "country", op: "eq" as const, values: ["IN"] },
      { field: "url", op: "prefix" as const, values: ["/a", "/b"], not: true as const },
    ];
    expectRoundTrip(funnel, rules);
    const tree = funnel.parse(clone(rules), context);
    expect(leaves(tree).map((c) => c.operator)).toEqual(["in", "not_starts_with"]);
    const out = funnel.serialize(
      edit(edit(tree, 0, { values: ["IN", "US"] }), 1, { operator: "starts_with" }),
      context,
    );
    expect(out).toEqual([
      { field: "country", op: "eq", values: ["IN", "US"] },
      { field: "url", op: "prefix", values: ["/a", "/b"] },
    ]);
    expectRoundTrip(rumExclusionCodec(), [{ field: "browser", op: "regex", values: ["bot"] }]);
  });
});

describe("model pricing codec", () => {
  const codec = modelPricingCodec();
  const saved = {
    condition: { usage_key: "input", operator: "gt", value: 200000 },
    rules: [
      { keys: ["openai.request.service_tier", "service_tier"], op: "in", values: ["flex"] },
      { keys: ["speed"], op: "exists" },
      { keys: ["x"], op: "future_op", value: 3 },
    ],
  };

  it("writes an untouched tier back unchanged, an unknown rule included", () => {
    expectRoundTrip(codec, saved);
    expectRoundTrip(codec, { condition: null });
  });

  it("keeps the usage condition apart from the rules", () => {
    const tree = codec.parse(clone(saved), context);
    expect(tree.items.map((i) => i.kind)).toEqual(["condition", "condition", "condition", "raw"]);
    const out = codec.serialize(
      appendNode(edit(tree, 0, { values: ["300000"] }), makeCondition("input", "lte", ["10"])),
      context,
    );
    expect(out.condition).toEqual({ usage_key: "input", operator: "gt", value: 300000 });
    expect(out.rules?.[2]).toEqual(saved.rules[2]);
    expect(out.rules?.[3]).toEqual({ keys: ["input"], op: "lte", value: 10 });
  });

  const usage: CodecContext = {
    fields: [
      { name: "input", type: "number", payload: TIER_USAGE_PAYLOAD },
      { name: "usage.input", type: "number" },
      { name: "service_tier", type: "string" },
    ],
  };

  it("routes a new usage-key threshold to the tier condition, so the tier can match", () => {
    let tree = codec.parse({ condition: null, rules: [] }, usage);
    tree = appendNode(tree, makeCondition("input", "gt", ["200000"]));
    expect(codec.serialize(tree, usage)).toEqual({
      condition: { usage_key: "input", operator: "gt", value: 200000 },
      rules: [],
    });
  });

  it("writes a second usage-key threshold as a `usage.<key>` rule", () => {
    const tree = appendNode(
      codec.parse(clone(saved), usage),
      makeCondition("input", "lte", ["10"]),
    );
    const out = codec.serialize(tree, usage);
    expect(out.condition).toEqual(saved.condition);
    expect(out.rules?.[3]).toEqual({ keys: ["usage.input"], op: "lte", value: 10 });
  });

  describe("a tier with no condition and a rule keyed like a usage field", () => {
    const tier = {
      rules: [
        { keys: ["input"], op: "gt", value: 5 },
        { keys: ["tier"], op: "in", values: ["x"] },
      ],
    };

    it("keeps the untouched rule as it was when another rule is edited", () => {
      const tree = codec.parse(clone(tier), usage);
      const out = codec.serialize(edit(tree, 1, { values: ["x", "y"] }), usage);
      expect(out.condition).toBeNull();
      expect(out.rules).toEqual([tier.rules[0], { keys: ["tier"], op: "in", values: ["x", "y"] }]);
    });

    it("keeps an edited rule a rule with its original keys", () => {
      const tree = codec.parse(clone(tier), usage);
      const out = codec.serialize(edit(tree, 0, { values: ["7"] }), usage);
      expect(out.condition).toBeNull();
      expect(out.rules).toEqual([{ keys: ["input"], op: "gt", value: 7 }, tier.rules[1]]);
    });

    it("still lets a newly added usage threshold become the tier condition", () => {
      const tree = codec.parse(clone(tier), usage);
      const out = codec.serialize(appendNode(tree, makeCondition("input", "lte", ["10"])), usage);
      expect(out.condition).toEqual({ usage_key: "input", operator: "lte", value: 10 });
      expect(out.rules).toEqual(tier.rules);
    });
  });

  it("keeps the saved condition when a usage threshold is inserted before it", () => {
    const tree = codec.parse(clone(saved), usage);
    const inserted = insertNode(tree, makeCondition("input", "lte", ["10"]), null, 0);
    const out = codec.serialize(inserted, usage);
    expect(out.condition).toEqual(saved.condition);
    expect(out.rules?.[0]).toEqual({ keys: ["usage.input"], op: "lte", value: 10 });
  });

  it("leaves an unfinished threshold rule without a value instead of writing 0 or null", () => {
    let tree = codec.parse(clone(saved), usage);
    tree = appendNode(tree, makeCondition("service_tier", "gt", []));
    const out = codec.serialize(tree, usage);
    expect(out.rules?.[3]).toEqual({ keys: ["service_tier"], op: "gt" });
  });
});

describe("sql codec", () => {
  const codec = sqlCodec();

  it("writes untouched text back as typed and compiles an edited tree", () => {
    expectRoundTrip(codec, "level='error'   and status >= 500");
    const tree = codec.parse("level = 'error' AND status >= 500", context);
    expect(codec.serialize(edit(tree, 0, { values: ["warn"] }), context)).toBe(
      "level = 'warn' AND status >= 500",
    );
  });

  it("keeps a query it cannot draw as one locked chip", () => {
    const tree = codec.parse("count(*) > 1", context);
    expect(tree.items[0]).toMatchObject({ kind: "raw", label: "count(*) > 1" });
    expectRoundTrip(codec, "count(*) > 1");
    const more = appendNode(tree, makeCondition("level", "eq", ["a"]));
    expect(codec.serialize(more, context)).toBe("(count(*) > 1) AND level = 'a'");
  });
});

describe("dashboard filter codec, an IN list with a $variable", () => {
  const codec = dashboardFilterCodec();
  const panel = {
    data: { queries: [{ fields: { stream: "s" }, joins: [] }] },
    layout: { currentQueryIndex: 0 },
    meta: {
      streamFields: {
        groupedFields: [{ stream_alias: null, schema: [{ name: "env", type: "Utf8" }] }],
      },
    },
  };
  const written = (values: string[]) => {
    const tree = appendNode(codec.parse(null, context), makeCondition("env", "in", values));
    return (codec.serialize(tree, context) as any).conditions[0];
  };

  it("quotes every literal next to a variable, so the panel SQL stays valid", () => {
    const leaf = written(["prod", "$env"]);
    expect(leaf).toMatchObject({ type: "condition", operator: "IN", value: "'prod',$env" });
    expect(buildCondition(leaf, panel)).toBe("env IN ('prod',$env)");
    expect(
      leaves(codec.parse({ ...leaf, filterType: "group", conditions: [leaf] } as never, context))[0]
        .values,
    ).toEqual(["prod", "$env"]);
  });

  it("quotes a literal that only holds a $, alone or in a list", () => {
    expect(buildCondition(written(["a", "$5.00"]), panel)).toBe("env IN ('a','$5.00')");
    expect(buildCondition(written(["$5.00"]), panel)).toBe("env IN ('$5.00')");
  });

  it("reads back what it writes, quotes and every variable spelling included", () => {
    const values = ["O'Brien", "${env}", "{{ region }}", "a,b"];
    const leaf = written(values);
    expect(leaf.value).toBe("'O''Brien',${env},{{ region }},'a,b'");
    const group = { filterType: "group", logicalOperator: "AND", conditions: [leaf] };
    expect(leaves(codec.parse(group as never, context))[0].values).toEqual(values);
  });

  it("keeps a lone variable as typed, and plain lists in the comma form", () => {
    expect(written(["$env"]).value).toBe("$env");
    expect(written(["($env)"]).value).toBe("($env)");
    expect(written(["a", "($env)"]).value).toBe("'a',$env");
    expect(written(["a", "b c"])).toMatchObject({ type: "list", values: ["a", "b c"] });
  });

  describe("a saved IN text holding a variable, edited", () => {
    const savedLeaf = (value: string) => ({
      type: "condition",
      column: { field: "env" },
      filterType: "condition",
      operator: "IN",
      value,
      logicalOperator: "AND",
      values: [],
    });
    const savedGroup = (value: string) => ({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [{ ...savedLeaf("a"), operator: "=" }, savedLeaf(value)],
    });
    const parsed = (value: string) => codec.parse(clone(savedGroup(value)) as never, context);
    const sqlAfter = (value: string, change: (tree: FilterGroup) => FilterGroup) => {
      const out = codec.serialize(change(parsed(value)), context) as any;
      return buildCondition(out.conditions[1], panel);
    };
    const addStage = (tree: FilterGroup) =>
      edit(tree, 1, { values: [...leaves(tree)[1].values, "stage"] });
    const toggle = (tree: FilterGroup) => toggleConnector(tree, leaves(tree)[1].id);
    const cases: [string, string[], string, string][] = [
      ["'$env'", ["'$env'"], "env IN ('$env','stage')", "env IN ('$env')"],
      [
        "'prod','$env'",
        ["prod", "'$env'"],
        "env IN ('prod','$env','stage')",
        "env IN ('prod','$env')",
      ],
      ["prod,$env", ["prod", "$env"], "env IN ('prod',$env,'stage')", "env IN (prod,$env)"],
    ];

    it.each(cases)("keeps %s byte-identical when untouched", (value) => {
      expectRoundTrip(codec, savedGroup(value) as never);
    });

    it.each(cases)("reads %s with a quoted variable kept quoted", (value, chips) => {
      expect(leaves(parsed(value))[1].values).toEqual(chips);
    });

    it.each(cases)("writes %s as valid SQL after adding a value", (value, _chips, added) => {
      expect(sqlAfter(value, addStage)).toBe(added);
    });

    it.each(cases)("keeps %s and main's SQL after toggling AND/OR", (value, _c, _a, toggled) => {
      const out = codec.serialize(toggle(parsed(value)), context) as any;
      expect(out.conditions[1]).toEqual({ ...savedLeaf(value), logicalOperator: "OR" });
      expect(buildCondition(out.conditions[1], panel)).toBe(toggled);
    });
  });

  it("still splits an IN text with no variable as the SQL builder does", () => {
    const leaf = {
      type: "condition",
      column: { field: "env" },
      filterType: "condition",
      operator: "IN",
      value: "('prod','dev'), qa",
      logicalOperator: "AND",
      values: [],
    };
    const group = { filterType: "group", logicalOperator: "AND", conditions: [leaf] };
    expectRoundTrip(codec, group as never);
    expect(leaves(codec.parse(clone(group) as never, context))[0].values).toEqual([
      "prod",
      "dev",
      "qa",
    ]);
  });
});

describe("dashboard filter codec, a locked chip", () => {
  const codec = dashboardFilterCodec();
  const locked = {
    type: "condition",
    column: { field: "msg" },
    filterType: "condition",
    operator: "future_op",
    value: "x",
    logicalOperator: "AND",
    values: [],
  };
  const saved = {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [{ ...locked, column: { field: "level" }, operator: "=", value: "a" }, locked],
  };

  it("saves a changed AND/OR and nothing else of it", () => {
    expectRoundTrip(codec, saved as never);
    const tree = codec.parse(clone(saved) as never, context);
    expect(tree.items[1].kind).toBe("raw");
    const out = codec.serialize(toggleConnector(tree, tree.items[1].id), context) as any;
    expect(out.conditions[1]).toEqual({ ...locked, logicalOperator: "OR" });
  });
});

describe("anomaly codec, IN values and the V2 group", () => {
  const codec = anomalyCodec();

  it("reads a doubled quote inside an IN value as one value", () => {
    const saved = [{ field: "name", operator: "IN", value: "'O''Brien', 'x'" }];
    expectRoundTrip(codec, saved);
    const tree = codec.parse(clone(saved), context);
    expect(leaves(tree)[0].values).toEqual(["O'Brien", "x"]);
    const out = codec.serialize(edit(tree, 0, { values: ["O'Brien", "x", "y"] }), context) as any[];
    expect(out[0].value).toBe("'O''Brien', 'x', 'y'");
  });

  it("still reads the plain, double-quoted and bare IN values the old form saved", () => {
    const saved = [{ field: "s", operator: "NOT IN", value: "('a', \"b\", c)" }];
    expectRoundTrip(codec, saved);
    expect(leaves(codec.parse(clone(saved), context))[0].values).toEqual(["a", "b", "c"]);
  });

  const grouped = {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [
      {
        filterType: "condition",
        column: "level",
        operator: "=",
        value: "error",
        logicalOperator: "AND",
      },
      {
        filterType: "condition",
        column: "status",
        operator: "in",
        value: [500],
        logicalOperator: "OR",
      },
    ],
  };

  it("writes the flat rows, field included, when a group is edited down to AND", () => {
    const tree = codec.parse(clone(grouped) as never, context);
    const out = codec.serialize(toggleConnector(tree, tree.items[1].id), context);
    expect(out).toEqual([
      { field: "level", operator: "=", value: "error" },
      { field: "status", operator: "IN", value: "'500'" },
    ]);
  });

  it("stays a group when a locked leaf of it has no flat row", () => {
    const withLocked = {
      ...grouped,
      conditions: [
        grouped.conditions[0],
        { ...grouped.conditions[1], operator: "future_op", logicalOperator: "AND" },
        { ...grouped.conditions[0], column: "host", logicalOperator: "OR" },
      ],
    };
    const tree = codec.parse(clone(withLocked) as never, context);
    const out = codec.serialize(toggleConnector(tree, tree.items[2].id), context) as any;
    expect(out.filterType).toBe("group");
    expect(out.conditions[1]).toEqual(withLocked.conditions[1]);
  });
});

describe("engine profiles' operators by column type", () => {
  const TEXT_ONLY = ["contains_ci", "starts_with", "ends_with", "regex", "not_regex"];
  const OLD = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains"];
  const UNARY = ["is_null", "is_not_null", "is_empty", "is_not_empty"];

  it.each(["alert", "pipeline", "workflow", "eval", "annotation"] as const)(
    "%s offers the text operators on text columns only",
    (name) => {
      const { operators } = FILTER_PROFILES[name];
      expect(operators.string).toEqual(expect.arrayContaining([...OLD, ...TEXT_ONLY, ...UNARY]));
      for (const type of ["number", "boolean"] as const) {
        expect(operators[type]).toEqual([...OLD, "in", "not_in", ...UNARY]);
      }
    },
  );
});

describe("profiles regex validation", () => {
  const { validate } = FILTER_PROFILES.profiles;
  const t = ((key: string) => key) as never;
  const issuesFor = (value: string) => {
    const saved = [{ key: "service", op: "=~", value }];
    const tree = profilesCodec().parse(saved, context);
    return validate!(tree, { t, saved }).map((issue) => issue.message);
  };

  it("accepts the Rust syntax JS does not compile", () => {
    expect(issuesFor("(?i)prod")).toEqual([]);
    expect(issuesFor("(?P<name>api)-\\d+")).toEqual([]);
    expect(issuesFor("a(?i:B)c(?-s)")).toEqual([]);
  });

  it("leaves an escaped paren alone, so it is checked as a literal", () => {
    expect(issuesFor("(a\\(?i)")).toEqual([]);
    expect(issuesFor("a\\\\(?i)b")).toEqual([]);
    expect(issuesFor("\\\\(?P<n>x)")).toEqual([]);
    expect(issuesFor("(?i)(?s)x")).toEqual([]);
    expect(issuesFor("a\\\\(?P<n>x")).toEqual(["filterBar.validation.regexInvalid"]);
  });

  it("still refuses a pattern no engine compiles", () => {
    expect(issuesFor("(api")).toEqual(["filterBar.validation.regexInvalid"]);
    expect(issuesFor("[a-")).toEqual(["filterBar.validation.regexInvalid"]);
  });
});

describe("model pricing validation", () => {
  const codec = modelPricingCodec();
  const { validate } = FILTER_PROFILES["model-pricing"];
  const t = ((key: string) => key) as never;
  const usage: CodecContext = {
    fields: [{ name: "input", type: "number", payload: TIER_USAGE_PAYLOAD }],
  };
  const issuesFor = (tree: FilterGroup) =>
    validate!(tree, { t, saved: codec.serialize(tree, usage) }).map((issue) => issue.nodeId);

  it("flags a new = line while the tier's condition slot is taken, since a rule cannot hold it", () => {
    const tree = codec.parse(
      { condition: { usage_key: "input", operator: "gt", value: 10 }, rules: [] },
      usage,
    );
    const added = makeCondition("input", "eq", ["5"]);
    const next = appendNode(tree, added);
    expect(codec.serialize(next, usage).rules).toEqual([{ keys: ["usage.input"], op: "eq" }]);
    expect(issuesFor(next)).toEqual([added.id]);
  });

  it("lets one = line take a free slot and flags a second one", () => {
    const first = makeCondition("input", "eq", ["5"]);
    const second = makeCondition("input", "neq", ["6"]);
    const tree = codec.parse({ condition: null, rules: [] }, usage);
    expect(issuesFor(appendNode(tree, first))).toEqual([]);
    expect(issuesFor(appendNode(appendNode(tree, first), second))).toEqual([second.id]);
  });

  it("does not flag a saved = condition loaded as it was", () => {
    const tree = codec.parse(
      { condition: { usage_key: "input", operator: "eq", value: "5" }, rules: [] },
      usage,
    );
    expect(issuesFor(tree)).toEqual([]);
  });
});
