// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { gt, type I18nKey } from "@/types/i18n";
import { getDataValue } from "./aliasUtils";
import { parseOverrideConfigs } from "./tableConfigUtils";
import { getSeriesThresholds, resolveStepValues, stepColorFor } from "./thresholds";

export const TABLE_FOOTER_CALCS = ["sum", "mean", "min", "max", "count", "last"] as const;
export const TABLE_DENSITIES = ["compact", "standard", "comfortable"] as const;

export type TableFooterCalc = (typeof TABLE_FOOTER_CALCS)[number];

// Absent density keeps today's row height, which is the compact one.
const ROW_HEIGHTS: Record<string, number> = { compact: 22, standard: 28, comfortable: 36 };
const DEFAULT_ROW_HEIGHT = 22;

const CALC_LABEL_KEYS: Record<TableFooterCalc, I18nKey> = {
  sum: "dashboard.tableFooterCalcSum",
  mean: "dashboard.tableFooterCalcMean",
  min: "dashboard.tableFooterCalcMin",
  max: "dashboard.tableFooterCalcMax",
  count: "dashboard.tableFooterCalcCount",
  last: "dashboard.tableFooterCalcLast",
};

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** Row height in px for a table density; absent keeps today's height. */
export const tableRowHeight = (density: unknown): number =>
  ROW_HEIGHTS[String(density)] ?? DEFAULT_ROW_HEIGHT;

/** Parses a sparkline cell (a numeric array or its JSON text) into points, or null when it is not one. */
export const parseSparklineValue = (value: unknown): number[] | null => {
  let parsed: unknown = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("[")) return null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length < 2) return null;
  const points = parsed.map((item) => toNumber(item));
  return points.every((point) => point !== null) ? (points as number[]) : null;
};

/** One footer calculation over a column's values; non-numeric cells are skipped. */
export const computeFooterCalc = (calc: TableFooterCalc, values: unknown[]): number | null => {
  const numbers = values.map(toNumber).filter((value): value is number => value !== null);
  if (calc === "count") return numbers.length;
  if (numbers.length === 0) return null;
  switch (calc) {
    case "sum":
      return numbers.reduce((sum, value) => sum + value, 0);
    case "mean":
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
    case "last":
      return numbers[numbers.length - 1];
  }
  return null;
};

const columnKey = (column: any) => column?.field ?? column?.name;

const columnValues = (rows: any[], column: any) =>
  rows.map((row) => getDataValue(row, columnKey(column)));

const applyBarGauge = (column: any, rows: any[], config: any) => {
  const numbers = columnValues(rows, column)
    .map(toNumber)
    .filter((value): value is number => value !== null);
  const min = numbers.length ? Math.min(0, ...numbers) : 0;
  const max = numbers.length ? Math.max(...numbers) : 0;
  const thresholds = getSeriesThresholds(config, String(column.alias ?? column.field ?? ""));
  const steps = thresholds ? resolveStepValues(thresholds, { min, max }) : null;
  column.cellType = "bar_gauge";
  column.barRange = { min, max };
  column.barColor = (value: unknown) => (steps ? stepColorFor(value, steps, null) : null);
};

const applyCellTypes = (columns: any[], rows: any[], config: any) => {
  const { fieldTypeMap } = parseOverrideConfigs(config?.override_config);
  for (const column of columns) {
    const type = fieldTypeMap[String(column?.alias ?? column?.field ?? "").toLowerCase()];
    if (type === "bar_gauge") applyBarGauge(column, rows, config);
    else if (type === "sparkline") column.cellType = "sparkline";
    else if (type === "json") column.showFieldAsJson = true;
  }
};

const footerCell = (calc: TableFooterCalc, column: any, rows: any[]): string => {
  const result = computeFooterCalc(calc, columnValues(rows, column));
  if (result === null) return "—";
  if (calc === "count") return String(result);
  return String(typeof column.format === "function" ? column.format(result) : result);
};

const valuesAreNumeric = (column: any, rows: any[]): boolean =>
  columnValues(rows, column).every(
    (value) => value === null || value === undefined || value === "" || typeof value === "number",
  );

// A sparkline column is typed as text, yet its scalar cells still total like numbers.
const isNumericColumn = (column: any, rows: any[]): boolean =>
  column.cellType === "sparkline"
    ? valuesAreNumeric(column, rows)
    : (column.isNumeric ?? valuesAreNumeric(column, rows));

const applyFooterCalcs = (result: any, calcs: TableFooterCalc[]) => {
  const columns: any[] = result.columns;
  const rows: any[] = result.rows;
  const numeric = new Set(columns.filter((column) => isNumericColumn(column, rows)));
  const labelColumn = columns.find((column) => !numeric.has(column));
  const footers = calcs.map((calc) => {
    const footer: Record<string, any> = { __isFooterRow: true };
    for (const column of columns) {
      const key = columnKey(column);
      if (column === labelColumn) footer[key] = gt(CALC_LABEL_KEYS[calc]);
      else if (numeric.has(column)) footer[key] = footerCell(calc, column, rows);
    }
    return footer;
  });
  for (const column of columns) {
    const format = column.format;
    if (typeof format === "function") {
      column.format = (value: any, row?: any) => (row?.__isFooterRow ? value : format(value, row));
    }
  }
  result.stickyTotalRow = footers;
  result.stickyRowTotals = true;
};

/** Applies the table cell types and footer calculations to a converted flat table; a no-op while every key is absent. */
export const applyTableOptions = (result: any, panelSchema: any): void => {
  if (!result || !Array.isArray(result.columns) || !Array.isArray(result.rows)) return;
  const config = panelSchema?.config ?? {};
  if (config.table_transpose) return;
  applyCellTypes(result.columns, result.rows, config);
  const calcs = Array.isArray(config.table_footer_calcs)
    ? config.table_footer_calcs.filter((calc: string) =>
        (TABLE_FOOTER_CALCS as readonly string[]).includes(calc),
      )
    : [];
  if (calcs.length > 0 && result.columns.length > 0) applyFooterCalcs(result, calcs);
};
