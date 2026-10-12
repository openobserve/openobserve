// Copyright 2026 OpenObserve Inc.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "vue/compiler-sfc";

// The compiler-core NodeTypes values the scan reads; the fixture test fails if they drift.
const ELEMENT = 1;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;

interface TemplateProp {
  type: number;
  name: string;
  value?: { content: string };
  arg?: { content?: string };
  exp?: { content?: string };
}

interface TemplateNode {
  type: number;
  tag?: string;
  props?: TemplateProp[];
  children?: TemplateNode[];
  loc: { start: { line: number } };
}

interface SlotUse {
  name: string;
  line: number;
}

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const REMOVED_PROPS = new Set([
  "footer-title",
  "footerTitle",
  "custom-pagination-bar",
  "customPaginationBar",
]);
const BAR_SLOTS = new Set(["selection-actions", "footer-note"]);

const propName = (prop: TemplateProp): string | undefined => {
  if (prop.type === ATTRIBUTE) return prop.name;
  return prop.type === DIRECTIVE && prop.name === "bind" ? prop.arg?.content : undefined;
};

const slotDirectiveName = (prop: TemplateProp): string | undefined =>
  prop.type === DIRECTIVE && prop.name === "slot" ? (prop.arg?.content ?? "default") : undefined;

const isPaginationNone = (prop: TemplateProp): boolean =>
  propName(prop) === "pagination" &&
  (prop.type === ATTRIBUTE
    ? prop.value?.content === "none"
    : /^(['"`])none\1$/.test(prop.exp?.content?.trim() ?? ""));

// A slot can sit on the OTable tag itself (`<OTable #bottom>`) as well as on a child `<template>`.
const slotsOf = (table: TemplateNode): SlotUse[] => [
  ...(table.props ?? []).flatMap((prop) => {
    const name = slotDirectiveName(prop);
    return name ? [{ name, line: table.loc.start.line }] : [];
  }),
  ...(table.children ?? []).flatMap((child) => {
    if (child.type !== ELEMENT || child.tag !== "template") return [];
    const name = (child.props ?? []).map(slotDirectiveName).find((found) => found !== undefined);
    return name ? [{ name, line: child.loc.start.line }] : [];
  }),
];

const tablesIn = (source: string, file: string): TemplateNode[] => {
  const found: TemplateNode[] = [];
  const collect = (node: TemplateNode) => {
    if (node.type === ELEMENT && (node.tag === "OTable" || node.tag === "o-table"))
      found.push(node);
    node.children?.forEach(collect);
  };
  const ast = parse(source, { filename: file }).descriptor.template?.ast;
  if (ast) collect(ast as unknown as TemplateNode);
  return found;
};

const leftoversIn = (file: string, table: TemplateNode): string[] => [
  ...(table.props ?? [])
    .map(propName)
    .filter((name): name is string => !!name && REMOVED_PROPS.has(name))
    .map((name) => `${file}:${table.loc.start.line} ${name}`),
  ...slotsOf(table)
    .filter((slot) => slot.name === "bottom")
    .map((slot) => `${file}:${slot.line} #bottom`),
];

const inertSlotsIn = (file: string, table: TemplateNode): string[] => {
  const slots = slotsOf(table);
  const noBar =
    (table.props ?? []).some(isPaginationNone) ||
    slots.some((slot) => slot.name === "pagination-bar");
  if (!noBar) return [];
  return slots
    .filter((slot) => BAR_SLOTS.has(slot.name))
    .map((slot) => `${file}:${slot.line} #${slot.name}`);
};

// Read off disk rather than through vue-tsc, which never checks the `@ts-nocheck` SFCs that render OTables.
const tables: { file: string; node: TemplateNode }[] = [];
for (const file of readdirSync(SRC, { recursive: true }) as string[]) {
  if (!file.endsWith(".vue")) continue;
  const source = readFileSync(join(SRC, file), "utf8");
  if (!/<(OTable|o-table)\b/.test(source)) continue;
  tablesIn(source, file).forEach((node) => tables.push({ file, node }));
}

describe("OTable call sites", () => {
  it("are all found by the scan", () => {
    expect(tables.length).toBeGreaterThan(100);
  });

  it("are checked by a scan that catches every pattern it guards against", () => {
    const fixture = [
      "<template>",
      `  <OTable footer-title="x" :custom-pagination-bar="true"><template v-if="ok" #bottom /></OTable>`,
      `  <OTable pagination="none"><template #footer-note /></OTable>`,
      `  <OTable :pagination="'none'" #selection-actions />`,
      "  <OTable #bottom />",
      "  <OTable><template #pagination-bar /><template #footer-note /></OTable>",
      "  <OTable><template #selection-actions /><template #footer-note /></OTable>",
      "</template>",
    ].join("\n");
    const found = tablesIn(fixture, "fixture.vue");

    expect(found).toHaveLength(6);
    expect(found.flatMap((table) => leftoversIn("fixture.vue", table))).toEqual([
      "fixture.vue:2 footer-title",
      "fixture.vue:2 custom-pagination-bar",
      "fixture.vue:2 #bottom",
      "fixture.vue:5 #bottom",
    ]);
    expect(found.flatMap((table) => inertSlotsIn("fixture.vue", table))).toEqual([
      "fixture.vue:3 #footer-note",
      "fixture.vue:4 #selection-actions",
      "fixture.vue:6 #footer-note",
    ]);
  });

  it("use none of the removed footer API", () => {
    expect(tables.flatMap(({ file, node }) => leftoversIn(file, node))).toEqual([]);
  });

  it("hand no footer slot to a table without the built-in bar", () => {
    expect(tables.flatMap(({ file, node }) => inertSlotsIn(file, node))).toEqual([]);
  });
});
