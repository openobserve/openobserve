// Copyright 2023 OpenObserve Inc.
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

import { getDataValue } from "./aliasUtils";
import {
  PIVOT_TABLE_MAX_COLUMNS,
  PIVOT_TABLE_SEPARATOR,
  PIVOT_TABLE_ROW_KEY_SEPARATOR,
  PIVOT_TABLE_TOTAL_LABEL,
  PIVOT_TABLE_OTHERS_LABEL,
} from "./constants";
import {
  buildValueMappingCache,
  parseOverrideConfigs,
  formatNumericValue,
  parseTimestampValue,
  detectTimestampFields,
} from "./tableConfigUtils";

/**
 * Builds N-level header metadata for the TableRenderer.
 *
 * header_rows = max(1, pivot_count + (y_count > 1 ? 1 : 0))
 *
 * When header_rows === 1 (1 pivot + 1 Y), returns [] to use standard q-table headers.
 * Otherwise returns an array of header level objects with cells[] and isLeaf flag.
 */
function buildPivotHeaderLevels(
  breakdownFields: any[],
  allPivotKeys: string[],
  yFields: any[],
  showRowTotals: boolean,
  timestampFieldAliases: Set<string>,
  timezone: string,
): any[] {
  const pivotCount = breakdownFields.length;
  const yCount = yFields.length;
  const needsMultiRowHeader = pivotCount > 1 || yCount > 1;

  if (!needsMultiRowHeader) return [];

  const levels: any[] = [];

  // Parse pivot keys into per-level values
  // e.g., "GET\x00200" → ["GET", "200"]
  const parsedKeys = allPivotKeys.map((pk) => pk.split(PIVOT_TABLE_SEPARATOR));

  // Track top-level (level 0) group boundary positions (leaf column indices)
  // These propagate down so borders align across all header rows.
  const topLevelBoundaries: Set<number> = new Set();

  const formatPivotLabel = (value: string, levelIndex: number) => {
    if (!value) return value;
    const fieldAlias = breakdownFields[levelIndex]?.alias;
    if (!fieldAlias || !timestampFieldAliases.has(fieldAlias)) return value;
    if (
      value === PIVOT_TABLE_TOTAL_LABEL ||
      value === PIVOT_TABLE_OTHERS_LABEL
    ) {
      return value;
    }
    return parseTimestampValue(value, timezone) || value;
  };

  // Build one header row per pivot level
  for (let lvl = 0; lvl < pivotCount; lvl++) {
    const cells: any[] = [];
    let i = 0;
    let leafColPos = 0; // tracks leaf column position

    while (i < parsedKeys.length) {
      const groupValue = parsedKeys[i][lvl];
      const labelValue = formatPivotLabel(groupValue, lvl);
      let span = 0;

      while (
        i + span < parsedKeys.length &&
        parsedKeys[i + span][lvl] === groupValue &&
        parsedKeys[i + span]
          .slice(0, lvl)
          .every(
            (v: string, idx: number) => v === parsedKeys[i].slice(0, lvl)[idx],
          )
      ) {
        span++;
      }

      const colspan = span * (yCount > 1 ? yCount : 1);

      // For level 0, record group boundary positions
      if (lvl === 0 && cells.length > 0) {
        topLevelBoundaries.add(leafColPos);
      }

      // For deeper levels, check if this cell starts at a top-level boundary
      const hasBorder =
        lvl === 0
          ? cells.length > 0 // level 0: border on every group except first
          : topLevelBoundaries.has(leafColPos); // deeper: align with level 0

      const cell: any = {
        key: `${lvl}_${groupValue}_${i}`,
        label: labelValue,
        colspan,
        hasBorder,
        // Sort by the first leaf column under this group header.
        // allPivotKeys[i] is the first pivot key in this group.
        _sortColumn: `${allPivotKeys[i]}_${yFields[0].alias}`,
      };

      cells.push(cell);

      leafColPos += colspan;
      i += span;
    }

    // Total group at level 0 only
    if (lvl === 0 && showRowTotals) {
      topLevelBoundaries.add(leafColPos);
      cells.push({
        key: `${lvl}_${PIVOT_TABLE_TOTAL_LABEL}`,
        label: PIVOT_TABLE_TOTAL_LABEL,
        colspan: yCount > 1 ? yCount : 1,
        rowspan: pivotCount,
        hasBorder: true,
        _isTotalHeader: true,
        // Sort by the first total column
        _sortColumn: `${PIVOT_TABLE_TOTAL_LABEL}_${yFields[0].alias}`,
      });
    }

    levels.push({ cells, isLeaf: false });
  }

  // Add Y-label row if 2+ Y fields
  if (yCount > 1) {
    const yCells: any[] = [];
    let leafColPos = 0;
    for (const pk of allPivotKeys) {
      for (const yField of yFields) {
        yCells.push({
          key: `${pk}_${yField.alias}`,
          label: yField.label,
          colspan: 1,
          hasBorder: topLevelBoundaries.has(leafColPos),
          _sortColumn: `${pk}_${yField.alias}`,
        });
        leafColPos++;
      }
    }
    if (showRowTotals) {
      for (let tIdx = 0; tIdx < yFields.length; tIdx++) {
        yCells.push({
          key: `${PIVOT_TABLE_TOTAL_LABEL}_${yFields[tIdx].alias}`,
          label: yFields[tIdx].label,
          colspan: 1,
          hasBorder: topLevelBoundaries.has(leafColPos),
          _isTotalHeader: true,
          _totalColRightIndex: yFields.length - 1 - tIdx,
          _sortColumn: `${PIVOT_TABLE_TOTAL_LABEL}_${yFields[tIdx].alias}`,
        });
        leafColPos++;
      }
    }
    levels.push({ cells: yCells, isLeaf: true });
  } else {
    // Mark the last pivot level as the leaf
    if (levels.length > 0) {
      levels[levels.length - 1].isLeaf = true;
    }
  }

  return levels;
}

/**
 * Converts flat query results into a pivoted table.
 *
 * Pivot mode is active when: x.length > 0 && breakdown.length > 0 && y.length > 0
 * The breakdown field values become column headers, y values fill the cells.
 *
 * Supports multi-level pivot (multiple breakdown fields) and
 * multiple value fields (grouped hierarchical column headers).
 */
export const convertPivotTableData = (
  panelSchema: any,
  searchQueryData: any,
  store: any,
): {
  rows: any[];
  columns: any[];
  pivotHeaderLevels: any[];
  stickyTotalRow?: any;
  stickyRowTotals?: boolean;
  stickyColTotals?: boolean;
} => {
  const empty = { rows: [], columns: [], pivotHeaderLevels: [] };

  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !panelSchema
  ) {
    return empty;
  }

  const tableRows = searchQueryData[0];
  if (tableRows.length === 0) {
    return empty;
  }

  const query = panelSchema.queries[0];
  const config = panelSchema.config || {};
  const valueMappingCache = buildValueMappingCache(config.mappings);
  const xFields = query.fields?.x || [];
  const yFields = query.fields?.y || [];
  const breakdownFields = query.fields?.breakdown || [];

  if (
    breakdownFields.length === 0 ||
    yFields.length === 0 ||
    xFields.length === 0
  ) {
    return empty;
  }

  const xAliases = xFields.map((f: any) => f.alias);
  const yAliases = yFields.map((f: any) => f.alias);
  const breakdownAliases = breakdownFields.map((f: any) => f.alias);

  const missingValue = config.no_value_replacement ?? "";
  const showRowTotals = config.table_pivot_show_row_totals ?? false;
  const showColTotals = config.table_pivot_show_col_totals ?? false;
  const stickyRowTotals = config.table_pivot_sticky_row_totals ?? false;
  const stickyColTotals = config.table_pivot_sticky_col_totals ?? false;

  // --- Step 1: Build pivot keys and count totals ---
  const pivotKeyTotals: Map<string, number> = new Map();

  const getPivotKey = (row: any): string => {
    return breakdownAliases
      .map((alias: string) => String(getDataValue(row, alias) ?? "(empty)"))
      .join(PIVOT_TABLE_SEPARATOR);
  };

  for (const row of tableRows) {
    const pk = getPivotKey(row);
    let total = pivotKeyTotals.get(pk) || 0;
    for (const yAlias of yAliases) {
      total += Math.abs(Number(getDataValue(row, yAlias)) || 0);
    }
    pivotKeyTotals.set(pk, total);
  }

  // Sort by total descending first, then limit
  let pivotKeys = Array.from(pivotKeyTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  const hasOthers = pivotKeys.length > PIVOT_TABLE_MAX_COLUMNS;
  if (hasOthers) {
    pivotKeys = pivotKeys.slice(0, PIVOT_TABLE_MAX_COLUMNS);
  }
  const pivotKeySet = new Set(pivotKeys);

  // For multi-level pivot (2+ breakdown fields), re-sort hierarchically so
  // same-parent entries are grouped together. This ensures "China > Beijing"
  // and "China > Shanghai" are adjacent, allowing proper colspan grouping.
  // Within each parent group, the original total-value order is preserved.
  if (breakdownAliases.length > 1) {
    const parsed = pivotKeys.map((pk) => ({
      key: pk,
      parts: pk.split(PIVOT_TABLE_SEPARATOR),
    }));

    // Stable hierarchical sort: sort by level-0, then level-1, etc.
    // Within same parent group, preserve original order (by total desc).
    parsed.sort((a, b) => {
      for (let lvl = 0; lvl < breakdownAliases.length - 1; lvl++) {
        if (a.parts[lvl] !== b.parts[lvl]) {
          return a.parts[lvl].localeCompare(b.parts[lvl]);
        }
      }
      return 0; // same parent group — keep original total-value order
    });

    pivotKeys = parsed.map((p) => p.key);
  }

  // --- Step 2: Build pivoted rows ---
  const rowMap: Map<string, any> = new Map();

  for (const row of tableRows) {
    const keyParts: string[] = [];
    const rowObj: any = {};

    for (const xAlias of xAliases) {
      const val = getDataValue(row, xAlias);
      keyParts.push(String(val ?? ""));
      rowObj[xAlias] = val;
    }

    const rowKey = keyParts.join(PIVOT_TABLE_ROW_KEY_SEPARATOR);
    const pivotKey = getPivotKey(row);

    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, { ...rowObj });
    }

    const targetRow = rowMap.get(rowKey)!;

    for (const yAlias of yAliases) {
      const numericValue = Number(getDataValue(row, yAlias)) || 0;

      if (pivotKeySet.has(pivotKey)) {
        const colKey = `${pivotKey}_${yAlias}`;
        targetRow[colKey] = numericValue;
      } else if (hasOthers) {
        const othersKey = `${PIVOT_TABLE_OTHERS_LABEL}_${yAlias}`;
        targetRow[othersKey] = (targetRow[othersKey] || 0) + numericValue;
      }
    }
  }

  // --- Step 3: Fill missing values + row totals ---
  const allPivotKeys = hasOthers ? [...pivotKeys, PIVOT_TABLE_OTHERS_LABEL] : pivotKeys;
  const pivotedRows = Array.from(rowMap.values());

  for (const row of pivotedRows) {
    for (const yAlias of yAliases) {
      let rowTotal = 0;
      for (const pk of allPivotKeys) {
        const colKey = `${pk}_${yAlias}`;
        if (row[colKey] === undefined || row[colKey] === null) {
          row[colKey] = null; // Keep null for correct totals/sorting; format() handles display
        }
        rowTotal += Number(row[colKey]) || 0;
      }
      if (showRowTotals) {
        row[`${PIVOT_TABLE_TOTAL_LABEL}_${yAlias}`] = rowTotal;
      }
    }
  }

  // --- Step 4: Column totals row ---
  if (showColTotals && pivotedRows.length > 0) {
    const totalRow: any = { __isTotalRow: true };
    for (let i = 0; i < xAliases.length; i++) {
      totalRow[xAliases[i]] = i === 0 ? PIVOT_TABLE_TOTAL_LABEL : "";
    }

    for (const yAlias of yAliases) {
      for (const pk of allPivotKeys) {
        const colKey = `${pk}_${yAlias}`;
        let colTotal = 0;
        for (const row of pivotedRows) {
          colTotal += Number(row[colKey]) || 0;
        }
        totalRow[colKey] = colTotal;
      }
      if (showRowTotals) {
        let grandTotal = 0;
        for (const row of pivotedRows) {
          grandTotal += Number(row[`${PIVOT_TABLE_TOTAL_LABEL}_${yAlias}`]) || 0;
        }
        totalRow[`${PIVOT_TABLE_TOTAL_LABEL}_${yAlias}`] = grandTotal;
      }
    }

    pivotedRows.push(totalRow);
  }

  // --- Step 5: Build column definitions ---
  const { colorConfigMap, unitConfigMap } = parseOverrideConfigs(
    config.override_config,
  );

  const columns: any[] = [];
  const isSingleValueField = yAliases.length === 1;
  const needsMultiRowHeader =
    breakdownAliases.length > 1 || yAliases.length > 1;

  // Row field columns (x-axis) — marked with _isRowField for header rendering
  const timezone = store.state.timezone;
  const timestampFieldAliases = detectTimestampFields(xFields, tableRows);
  const breakdownTimestampAliases = detectTimestampFields(
    breakdownFields,
    tableRows,
  );

  for (const xField of xFields) {
    const col: any = {
      name: xField.alias,
      field: xField.alias,
      label: xField.label,
      align: "left",
      sortable: true,
      _isRowField: true,
    };
    if (timestampFieldAliases.has(xField.alias)) {
      col.format = (val: any) => parseTimestampValue(val, timezone) || val;
    }
    if (colorConfigMap[xField.alias.toLowerCase()]?.autoColor) {
      col.colorMode = "auto";
    }
    columns.push(col);
  }

  // Pivot value columns
  for (let pkIdx = 0; pkIdx < allPivotKeys.length; pkIdx++) {
    const pk = allPivotKeys[pkIdx];
    for (let yIdx = 0; yIdx < yFields.length; yIdx++) {
      const yField = yFields[yIdx];
      const colKey = `${pk}_${yField.alias}`;
      // Mark the first Y column of each pivot group as a group boundary
      const isGroupStart = yIdx === 0;

      // When multi-row headers are used, parent headers provide context,
      // so the leaf column label is just the value field label ("Count").
      // When single-row, use the full label ("GET" or "GET - Count").
      const formattedPivotKey = breakdownTimestampAliases.has(
        breakdownFields[0]?.alias,
      )
        ? parseTimestampValue(pk, timezone) || pk
        : pk;
      const label = needsMultiRowHeader
        ? yField.label
        : isSingleValueField
          ? formattedPivotKey
          : `${formattedPivotKey} - ${yField.label}`;

      const yAliasLower = yField.alias.toLowerCase();
      const unitToUse = unitConfigMap[yAliasLower]?.unit || config.unit;
      const customUnitToUse =
        unitConfigMap[yAliasLower]?.customUnit || config.unit_custom;
      const decimals = config.decimals ?? 2;

      columns.push({
        name: colKey,
        field: colKey,
        label,
        align: "right",
        sortable: true,
        _groupStart: isGroupStart,
        sort: (a: any, b: any) => (Number(a) || 0) - (Number(b) || 0),
        format: (val: any) =>
          formatNumericValue(val, valueMappingCache, unitToUse, customUnitToUse, decimals, missingValue),
      });
    }
  }

  // Total column(s)
  if (showRowTotals) {
    for (let tIdx = 0; tIdx < yFields.length; tIdx++) {
      const yField = yFields[tIdx];
      const colKey = `${PIVOT_TABLE_TOTAL_LABEL}_${yField.alias}`;
      const label = needsMultiRowHeader
        ? yField.label
        : isSingleValueField
          ? PIVOT_TABLE_TOTAL_LABEL
          : `${PIVOT_TABLE_TOTAL_LABEL} - ${yField.label}`;

      const yAliasLower = yField.alias.toLowerCase();
      const unitToUse = unitConfigMap[yAliasLower]?.unit || config.unit;
      const customUnitToUse =
        unitConfigMap[yAliasLower]?.customUnit || config.unit_custom;
      const decimals = config.decimals ?? 2;

      columns.push({
        name: colKey,
        field: colKey,
        label,
        align: "right",
        sortable: true,
        _groupStart: tIdx === 0,
        _isTotalColumn: true,
        _totalColRightIndex: yFields.length - 1 - tIdx,
        sort: (a: any, b: any) => (Number(a) || 0) - (Number(b) || 0),
        format: (val: any) =>
          formatNumericValue(val, valueMappingCache, unitToUse, customUnitToUse, decimals, missingValue),
        headerStyle: "font-weight: bold",
      });
    }
  }

  // --- Step 6: Build N-level header metadata ---
  const pivotHeaderLevels = buildPivotHeaderLevels(
    breakdownFields,
    allPivotKeys,
    yFields,
    showRowTotals,
    breakdownTimestampAliases,
    timezone,
  );

  // --- Step 7: Separate sticky total row if needed ---
  let stickyTotalRow: any = undefined;
  if (stickyRowTotals && showColTotals && pivotedRows.length > 0) {
    const lastRow = pivotedRows[pivotedRows.length - 1];
    if (lastRow?.__isTotalRow) {
      stickyTotalRow = pivotedRows.pop();
    }
  }

  return {
    rows: pivotedRows,
    columns,
    pivotHeaderLevels,
    stickyTotalRow,
    stickyRowTotals,
    stickyColTotals,
  };
};
