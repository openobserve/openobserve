// Copyright 2026 OpenObserve Inc.

import { unescapeSqlLiteral } from "@/utils/query/sqlFilterBuilder";

export interface ActiveFilterValues {
  include: Record<string, string[]>;
  exclude: Record<string, string[]>;
}

interface WhereNode {
  operator?: string;
  left?: WhereNode & { type?: string; column?: unknown };
  right?: WhereNode & { value?: unknown };
}

const columnName = (col: unknown): string | null => {
  if (typeof col === "string") return col.replace(/^"|"$/g, "");
  const value = (col as { expr?: { value?: unknown } })?.expr?.value;
  return value === null || value === undefined ? null : String(value);
};

const push = (target: Record<string, string[]>, field: string, value: string) => {
  if (!target[field]) target[field] = [];
  if (!target[field].includes(value)) target[field].push(value);
};

/** Walks a parsed WHERE tree and lists the values each field is filtered to (`=`, `IS NULL`) or away from (`!=`, `<>`, `IS NOT NULL`). */
export const collectActiveValues = (where: unknown): ActiveFilterValues => {
  const include: Record<string, string[]> = {};
  const exclude: Record<string, string[]> = {};
  const walk = (node: WhereNode | undefined | null) => {
    if (!node) return;
    const op = String(node.operator ?? "").toUpperCase();
    if (op === "AND" || op === "OR") {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (node.left?.type !== "column_ref") return;
    const col = columnName(node.left.column);
    if (!col) return;
    const literal = node.right?.value;
    const hasLiteral = literal !== null && literal !== undefined;
    // `f=''` is the + placeholder and `f!=''` half of the null row's exclude; no row is keyed "".
    if ((op === "=" || op === "!=" || op === "<>") && hasLiteral && literal === "") return;
    if (op === "=" && hasLiteral) {
      push(include, col, unescapeSqlLiteral(literal));
    } else if ((op === "!=" || op === "<>") && hasLiteral) {
      push(exclude, col, unescapeSqlLiteral(literal));
    } else if (op === "IS") {
      push(include, col, "null");
    } else if (op === "IS NOT") {
      push(exclude, col, "null");
    }
  };
  walk(where as WhereNode);
  return { include, exclude };
};
