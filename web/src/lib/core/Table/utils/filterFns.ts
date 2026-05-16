// Copyright 2026 OpenObserve Inc.

import type { FilterFn } from "@tanstack/vue-table";

/**
 * Built-in filter functions for OTable.
 * These can be used as column-level filters via TanStack's filterFns.
 */

/** Case-insensitive text contains filter */
export const textFilter: FilterFn<any> = (row, columnId, filterValue) => {
  const value = String(row.getValue(columnId) ?? "").toLowerCase();
  return value.includes(String(filterValue).toLowerCase());
};

/** Exact match filter */
export const exactFilter: FilterFn<any> = (row, columnId, filterValue) => {
  return row.getValue(columnId) === filterValue;
};

/** Number range filter — filterValue is { min?, max? } */
export const numberRangeFilter: FilterFn<any> = (row, columnId, filterValue) => {
  const value = Number(row.getValue(columnId));
  if (filterValue.min !== undefined && value < filterValue.min) return false;
  if (filterValue.max !== undefined && value > filterValue.max) return false;
  return true;
};

/** Array includes filter */
export const arrayIncludesFilter: FilterFn<any> = (row, columnId, filterValue) => {
  const value = row.getValue(columnId);
  if (!Array.isArray(value)) return false;
  return value.includes(filterValue);
};

/** Global text search across all columns */
export const globalSearchFilter: FilterFn<any> = (row, columnId, filterValue) => {
  const search = String(filterValue).toLowerCase();
  if (!search) return true;
  // Search across all values in the row
  const allValues = row.getAllCells().map((cell) => {
    const val = cell.getValue();
    return String(val ?? "").toLowerCase();
  });
  return allValues.some((v) => v.includes(search));
};
