// Copyright 2026 OpenObserve Inc.

import type {
  CompositeAlertChild,
  CompositeExpressionValidation,
} from "@/ts/interfaces/alert";

export interface CompositeChildDisplay {
  alert_id: string;
  accessible: boolean;
  name?: string;
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
  const remaining = expression
    .replace(/\{[^{}]+\}/g, "")
    .replace(/&&|\|\||!|\(|\)|\s/g, "");
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

export const removeExpressionOperand = (expression: string, id: string): string =>
  expression
    .replace(new RegExp(`\\{${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g"), "")
    .replace(/^\s*(?:&&|\|\|)\s*|\s*(?:&&|\|\|)\s*$/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
