// Copyright 2026 OpenObserve Inc.

import type { SortingFn } from "@tanstack/vue-table";

/**
 * Built-in sort functions for OTable.
 */

/** Case-insensitive string sort */
export const caseInsensitiveSort: SortingFn<any> = (rowA, rowB, columnId) => {
  const a = String(rowA.getValue(columnId) ?? "").toLowerCase();
  const b = String(rowB.getValue(columnId) ?? "").toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/** Numeric sort (handles null/undefined as 0) */
export const numericSort: SortingFn<any> = (rowA, rowB, columnId) => {
  const a = Number(rowA.getValue(columnId) ?? 0);
  const b = Number(rowB.getValue(columnId) ?? 0);
  return a - b;
};

/** Date sort (handles ISO strings and timestamps) */
export const dateSort: SortingFn<any> = (rowA, rowB, columnId) => {
  const a = new Date(rowA.getValue(columnId) ?? 0).getTime();
  const b = new Date(rowB.getValue(columnId) ?? 0).getTime();
  return a - b;
};

/** Sort by string length */
export const stringLengthSort: SortingFn<any> = (rowA, rowB, columnId) => {
  const a = String(rowA.getValue(columnId) ?? "").length;
  const b = String(rowB.getValue(columnId) ?? "").length;
  return a - b;
};
