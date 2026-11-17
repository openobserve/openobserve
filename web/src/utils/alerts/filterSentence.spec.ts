// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type {
  FilterCondition,
  FilterConnector,
  FilterGroup,
  FilterNode,
  FilterRawNode,
} from "@/utils/query/filterBar";
import { describeFilterNode, filterSentenceParts } from "./filterSentence";

const t = i18n.global.t as unknown as TranslateFn;
let seq = 0;
const cond = (field: string, connector: FilterConnector = "AND"): FilterCondition => ({
  kind: "condition",
  id: `c${++seq}`,
  connector,
  field,
  operator: "eq",
  values: ["x"],
});
const group = (items: FilterNode[], connector: FilterConnector = "AND"): FilterGroup => ({
  kind: "group",
  id: `g${++seq}`,
  connector,
  items,
});
const describe_ = (n: FilterCondition | FilterRawNode) => (n.kind === "raw" ? n.label : n.field);
const kinds = (g: FilterGroup) =>
  filterSentenceParts(g, describe_).map((p) =>
    p.kind === "connector" ? p.connector : p.kind === "condition" ? p.text : p.kind,
  );

// Twelve conditions, three levels deep: 4 at the top, 4 in a group, 4 in a group inside that.
const deep = group([
  ...[1, 2, 3].map((i) => cond(`a${i}`)),
  group([
    ...[1, 2, 3].map((i) => cond(`b${i}`, "OR")),
    group([1, 2, 3, 4, 5, 6].map((i) => cond(`c${i}`))),
  ]),
]);

describe("filterSentenceParts", () => {
  it.each<[string, FilterGroup, string[]]>([
    ["one condition", group([cond("level")]), ["level"]],
    [
      "per-item connectors",
      group([cond("a"), cond("b"), cond("c", "OR")]),
      ["a", "AND", "b", "OR", "c"],
    ],
    [
      "a nested group",
      group([cond("level"), group([cond("service"), cond("service", "OR")])]),
      ["level", "AND", "open", "service", "OR", "service", "close"],
    ],
    ["an empty group", group([]), []],
  ])("%s", (_name, g, expected) => {
    expect(kinds(g)).toEqual(expected);
  });

  it("reads every condition of a deep tree and never shortens it (Review Focus 4)", () => {
    const parts = kinds(deep);
    expect(parts.filter((p) => /^[abc]\d$/.test(p))).toHaveLength(12);
    expect(parts.filter((p) => p === "open")).toHaveLength(2);
    expect(parts.filter((p) => p === "close")).toHaveLength(2);
    expect(parts.join(" ")).not.toMatch(/more/);
  });
});

describe("describeFilterNode", () => {
  it.each<[FilterCondition | FilterRawNode, string]>([
    [{ ...cond("log"), operator: "contains", values: ["error"] }, "log contains error"],
    [{ kind: "raw", id: "r1", connector: "AND", label: "match_all('x')" }, "match_all('x')"],
  ])("%j", (node, expected) => {
    expect(describeFilterNode(node, "sql", t)).toBe(expected);
  });
});
