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
const describe_ = (n: FilterCondition | FilterRawNode) => ({
  text: n.kind === "raw" ? n.label : n.field,
});
const kinds = (g: FilterGroup) =>
  filterSentenceParts(g, describe_).map((p) =>
    p.kind === "connector"
      ? p.connector
      : `${"(".repeat(p.opens)}${p.phrase.text}${")".repeat(p.closes)}`,
  );
// The sentence as it reads: one word space between parts, brackets on the words they hold.
const prose = (g: FilterGroup) =>
  kinds(g)
    .map((word) => (word === "AND" || word === "OR" ? word.toLowerCase() : word))
    .join(" ");

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
      ["level", "AND", "(service", "OR", "service)"],
    ],
    ["an empty group", group([]), []],
    [
      "an empty group between two",
      group([cond("a"), group([]), cond("b", "OR")]),
      ["a", "OR", "b"],
    ],
  ])("%s", (_name, g, expected) => {
    expect(kinds(g)).toEqual(expected);
  });

  it.each<[string, FilterGroup, string]>([
    ["one condition", group([cond("a")]), "a"],
    ["three conditions", group([cond("a"), cond("b"), cond("c")]), "a and b and c"],
    [
      "eight conditions, mixed and/or",
      group([1, 2, 3, 4, 5, 6, 7, 8].map((i) => cond(`a${i}`, i % 3 ? "AND" : "OR"))),
      "a1 and a2 or a3 and a4 and a5 or a6 and a7 and a8",
    ],
    [
      "a group first, last and nested",
      group([
        group([cond("a"), cond("b", "OR")]),
        cond("c"),
        group([cond("d"), group([cond("e")])]),
      ]),
      "(a or b) and c and (d and (e))",
    ],
  ])("spaces %s as one sentence", (_name, g, expected) => {
    expect(prose(g)).toBe(expected);
  });

  it("reads every condition of a deep tree and never shortens it (Review Focus 4)", () => {
    const parts = kinds(deep);
    expect(parts.filter((p) => /^\(*[abc]\d\)*$/.test(p))).toHaveLength(12);
    expect(parts.join(" ")).toContain("(b1");
    expect(parts.join(" ")).toContain("(c1");
    expect(parts.join(" ")).toContain("c6))");
    expect(parts.join(" ")).not.toMatch(/more/);
  });
});

describe("describeFilterNode", () => {
  it.each<[FilterCondition | FilterRawNode, string, object]>([
    [
      { ...cond("log"), operator: "contains", values: ["error"] },
      "sql",
      { field: "log", operator: "contains", value: "error", text: "log contains error" },
    ],
    [
      { ...cond("level"), values: [""] },
      "sql",
      { field: "level", operator: "is", value: "(empty)", text: "level is (empty)" },
    ],
    [
      { ...cond("pod"), operator: "is_null", values: [] },
      "sql",
      { field: "pod", operator: "has no value", value: "", text: "pod has no value" },
    ],
    [
      { ...cond("job"), operator: "regex", values: ["api.*"] },
      "promql",
      { field: "job", operator: "=~", value: "api.*", text: "job =~ api.*" },
    ],
    [
      { kind: "raw", id: "r1", connector: "AND", label: "match_all('x')" },
      "sql",
      { text: "match_all('x')" },
    ],
  ])("%j in %s", (node, dialect, expected) => {
    expect(describeFilterNode(node, dialect, t)).toEqual(expected);
  });
});
