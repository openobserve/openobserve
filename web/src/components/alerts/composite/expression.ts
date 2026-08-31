// Copyright 2026 OpenObserve Inc.

import type { CompositeAlertChild, CompositeExpressionValidation } from "@/ts/interfaces/alert";

export interface CompositeChildDisplay {
  alert_id: string;
  accessible: boolean;
  name?: string;
}

/** A child alert as the composite form/pickers consume it (display + state). */
export interface CompositeChildOption extends CompositeChildDisplay {
  alert_type?: string;
  folder_id?: string;
  folder_name?: string;
  enabled?: boolean;
  level?: string | null;
  stale?: boolean;
}

export const expressionChildIds = (expression: string): string[] => {
  const ids: string[] = [];
  for (const match of expression.matchAll(/\{([^{}]+)\}/g)) {
    if (match[1]) ids.push(match[1]);
  }
  return ids;
};

export const validateExpression = (
  expression: string,
  children: readonly CompositeChildDisplay[],
): CompositeExpressionValidation => {
  const usedIds = expressionChildIds(expression);
  const selectedIds = children.map((child) => child.alert_id);
  const uniqueUsedIds = [...new Set(usedIds)];
  const unusedIds = selectedIds.filter((id) => !uniqueUsedIds.includes(id));
  const unknownIds = uniqueUsedIds.filter((id) => !selectedIds.includes(id));
  const remaining = expression.replace(/\{[^{}]+\}/g, "").replace(/&&|\|\||!|\(|\)|\s/g, "");
  let balance = 0;
  let balanced = true;
  for (const token of expression) {
    if (token === "(") balance += 1;
    if (token === ")") balance -= 1;
    if (balance < 0) balanced = false;
  }
  balanced = balanced && balance === 0;

  return {
    valid:
      selectedIds.length >= 2 &&
      selectedIds.length <= 10 &&
      expression.trim().length > 0 &&
      remaining.length === 0 &&
      balanced &&
      usedIds.length === uniqueUsedIds.length &&
      unusedIds.length === 0 &&
      unknownIds.length === 0,
    used_child_ids: uniqueUsedIds,
    unused_child_ids: unusedIds,
    unknown_child_ids: unknownIds,
  };
};

export const nameResolvedExpression = (
  expression: string,
  children: readonly CompositeChildDisplay[] | readonly CompositeAlertChild[],
): string => {
  const names = new Map(
    children.map((child) => [
      child.alert_id,
      child.accessible && "name" in child && child.name ? child.name : child.alert_id,
    ]),
  );
  return expression
    .replace(/\{([^{}]+)\}/g, (_token, id: string) => names.get(id) ?? id)
    .replace(/&&/g, " AND ")
    .replace(/\|\|/g, " OR ")
    .replace(/!/g, "NOT ")
    .replace(/\s+/g, " ")
    .trim();
};

export const removeExpressionOperand = (expression: string, id: string): string => {
  const tokens = tokenizeExpression(expression);
  const out: ExpressionToken[] = [];
  for (const token of tokens) {
    if (token.kind === "operand" && token.id === id) {
      // Drop a preceding negation applied to this operand.
      const last = out[out.length - 1];
      if (last?.kind === "operator" && last.text === "!") out.pop();
      continue;
    }
    out.push(token);
  }

  // Collapse the residue of the removal: empty groups, operators left dangling
  // by the dropped operand, and doubled operators.
  let s = out.map((t) => (t.kind === "operand" ? `{${t.id}}` : t.text)).join(" ");
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s
      .replace(/\(\s*\)/g, " ")
      .replace(/\(\s*(?:&&|\|\|)/g, "(")
      .replace(/(?:&&|\|\|)\s*\)/g, ")")
      .replace(/^\s*(?:&&|\|\|)/, "")
      .replace(/(?:&&|\|\|)\s*$/, "")
      .replace(/(&&|\|\|)\s+(?:&&|\|\|)/g, "$1")
      .replace(/\s+/g, " ");
  }

  // Removing from the backend's fully-nested canonical form can still leave the
  // parens unbalanced; fall back to a flat AND join (the backend re-canonicalizes
  // on save anyway).
  let balance = 0;
  for (const ch of s) {
    if (ch === "(") balance += 1;
    else if (ch === ")") balance -= 1;
  }
  if (balance !== 0 || /(?:^|\()\s*(?:&&|\|\|)|(?:&&|\|\|)\s*(?:\)|$)/.test(s)) {
    return out
      .filter((t): t is Extract<ExpressionToken, { kind: "operand" }> => t.kind === "operand")
      .map((t) => `{${t.id}}`)
      .join(" && ");
  }
  return s.trim();
};

/** Sub-alert slot letters, indexed by child position (A, B, C, …). */
export const LETTERS = "ABCDEFGHIJ";

export const letterFor = (index: number): string => LETTERS[index] ?? "?";

export type ExpressionToken =
  | { kind: "operand"; id: string }
  | { kind: "operator"; text: string }
  | { kind: "paren"; text: string };

/** Split an expression into renderable tokens (operand ids, operators, parens). */
export const tokenizeExpression = (expression: string): ExpressionToken[] =>
  [...expression.matchAll(/\{([^{}]+)\}|&&|\|\||!|\(|\)/g)].map((match) =>
    match[1] !== undefined
      ? { kind: "operand", id: match[1] }
      : match[0] === "(" || match[0] === ")"
        ? { kind: "paren", text: match[0] }
        : { kind: "operator", text: match[0] },
  );

/** Render a stored `{id}` expression as its human-friendly lettered form. */
export const rawToLettered = (
  expression: string,
  children: readonly { alert_id: string }[],
): string => {
  const idToLetter = new Map(children.map((child, index) => [child.alert_id, LETTERS[index]]));
  return tokenizeExpression(expression)
    .map((token) =>
      token.kind === "operand" ? (idToLetter.get(token.id) ?? `{${token.id}}`) : token.text,
    )
    .join(" ");
};

/** Translate a lettered expression ("A && B") back to the stored `{id}` form. */
export const letteredToRaw = (
  expression: string,
  children: readonly { alert_id: string }[],
): string =>
  expression.replace(/[A-J]/g, (letter) => {
    const child = children[LETTERS.indexOf(letter)];
    return child ? `{${child.alert_id}}` : letter;
  });
