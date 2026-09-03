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

import { gt } from "@/types/i18n";
import { getDataValue } from "./aliasUtils";
import { getFieldsFromQuery } from "@/utils/query/sqlUtils";
import {
  PIVOT_TABLE_MAX_COLUMNS,
  PIVOT_TABLE_SEPARATOR,
  PIVOT_TABLE_ROW_KEY_SEPARATOR,
  PIVOT_TABLE_TOTAL_LABEL,
  PIVOT_TABLE_OTHERS_LABEL,
  PIVOT_TABLE_EMPTY_KEY,
  PIVOT_TABLE_EMPTY_LABEL,
} from "./constants";
import {
  buildValueMappingCache,
  parseOverrideConfigs,
  formatNumericValue,
  parseTimestampValue,
  detectTimestampFields,
} from "./tableConfigUtils";

// Parsed custom-SQL aggregations keyed by query text. A pivot re-converts on
// every streaming chunk while the query text stays put, and astify() is not
// cheap, so the parse is done once per distinct query.
const customQueryAggregationCache = new Map<string, Record<string, string | null>>();
const CUSTOM_QUERY_AGGREGATION_CACHE_LIMIT = 20;

/**
 * Maps each SELECT alias of a custom-SQL panel to the aggregation wrapping it,
 * so duplicate pivot cells combine the way the query says rather than the way
 * the field's placeholder `functionName` claims. Returns null for builder
 * panels, whose fields carry a trustworthy aggregation of their own.
 */
export const resolvePivotCustomQueryAggregations = async (
  query: any,
): Promise<Record<string, string | null> | null> => {
  const sql = query?.query;
  if (!query?.customQuery || typeof sql !== "string" || !sql.trim()) return null;

  const cached = customQueryAggregationCache.get(sql);
  if (cached) return cached;

  const byAlias: Record<string, string | null> = {};
  try {
    const { fields } = await getFieldsFromQuery(sql);
    for (const field of fields ?? []) {
      if (field?.alias) byAlias[field.alias] = field.aggregationFunction ?? null;
    }
  } catch {
    // Unparseable SQL leaves the map empty, which reads as "unknown" below.
  }

  if (customQueryAggregationCache.size >= CUSTOM_QUERY_AGGREGATION_CACHE_LIMIT) {
    customQueryAggregationCache.clear();
  }
  customQueryAggregationCache.set(sql, byAlias);
  return byAlias;
};

/**
 * Builds N-level header metadata for the TableRenderer.
 *
 * header_rows = max(1, pivot_count + (y_count > 1 ? 1 : 0))
 *
 * When header_rows === 1 (1 pivot + 1 Y), returns [] to use standard table headers.
 * Otherwise returns an array of header level objects with cells[] and isLeaf flag.
 */
function buildPivotHeaderLevels(
  breakdownFields: any[],
  allPivotKeys: string[],
  yFields: any[],
  showRowTotals: boolean,
  timestampFieldAliases: Set<string>,
  timezone: string,
  hasOthers: boolean,
): any[] {
  const pivotCount = breakdownFields.length;
  const yCount = yFields.length;
  const needsMultiRowHeader = pivotCount > 1 || yCount > 1;

  if (!needsMultiRowHeader) return [];

  const levels: any[] = [];

  // Parse pivot keys into per-level values
  // e.g., "GET\x00200" → ["GET", "200"]
  // The synthetic overflow bucket is excluded: it is a single app-authored
  // label, not a breakdown tuple, so splitting it would yield `undefined` at
  // every level below the first. It is emitted separately at level 0 with a
  // rowspan covering all pivot levels (the same shape as the Total group).
  const realPivotKeys = hasOthers ? allPivotKeys.slice(0, -1) : allPivotKeys;
  const parsedKeys = realPivotKeys.map((pk) => pk.split(PIVOT_TABLE_SEPARATOR));

  // Track top-level (level 0) group boundary positions (leaf column indices)
  // These propagate down so borders align across all header rows.
  const topLevelBoundaries: Set<number> = new Set();

  const formatPivotLabel = (value: string, levelIndex: number) => {
    if (!value) return value;
    // The empty-bucket sentinel never reaches the user: render its label
    // before any field-specific formatting (a timestamp parse would fail and
    // fall back to the raw sentinel).
    if (value === PIVOT_TABLE_EMPTY_KEY) return PIVOT_TABLE_EMPTY_LABEL;
    const fieldAlias = breakdownFields[levelIndex]?.alias;
    if (!fieldAlias || !timestampFieldAliases.has(fieldAlias)) return value;
    if (value === PIVOT_TABLE_TOTAL_LABEL || value === PIVOT_TABLE_OTHERS_LABEL) {
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
          .every((v: string, idx: number) => v === parsedKeys[i].slice(0, lvl)[idx])
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
        // realPivotKeys[i] is the first pivot key in this group.
        _sortColumn: `${realPivotKeys[i]}_${yFields[0].alias}`,
      };

      cells.push(cell);

      leafColPos += colspan;
      i += span;
    }

    // Synthetic groups at level 0 only — Others (overflow) then Total, each a
    // single cell whose rowspan spans every pivot level. One shared writer so
    // the two cells cannot drift apart: the renderer relies on them having
    // identical rowspan/border/colspan semantics. The constant stays the
    // machine key; only the rendered label is translated. Sorts by the group's
    // first leaf column.
    if (lvl === 0) {
      const pushSyntheticGroupCell = (machineKey: string, i18nKey: string, extra: any) => {
        topLevelBoundaries.add(leafColPos);
        cells.push({
          key: `${lvl}_${machineKey}`,
          label: gt(i18nKey),
          colspan: yCount,
          rowspan: pivotCount,
          hasBorder: true,
          _sortColumn: `${machineKey}_${yFields[0].alias}`,
          ...extra,
        });
        leafColPos += yCount;
      };

      if (hasOthers) {
        pushSyntheticGroupCell(PIVOT_TABLE_OTHERS_LABEL, "dashboard.pivotOthers", {});
      }
      if (showRowTotals) {
        pushSyntheticGroupCell(PIVOT_TABLE_TOTAL_LABEL, "dashboard.pivotTotal", {
          _isTotalHeader: true,
        });
      }
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
  // Alias → aggregation for custom-SQL panels, from
  // resolvePivotCustomQueryAggregations. Null for builder panels.
  customQueryAggregations: Record<string, string | null> | null = null,
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

  if (breakdownFields.length === 0 || yFields.length === 0 || xFields.length === 0) {
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
      .map((alias: string) => {
        // Fold null, undefined and "" into one bucket — `?? ` alone would
        // leave "" as a blank column header. Deliberately wider than the chart
        // path (sql/shared/seriesBuilder.ts), which drops null/undefined
        // breakdown series entirely and folds only "": a table column with no
        // header is unusable, a missing chart series is merely absent. The
        // bucket's machine key is a sentinel outside the user-data namespace,
        // so a genuine "(empty)" string value keeps its own column; the
        // "(empty)" label is applied only when rendering headers.
        const raw = getDataValue(row, alias);
        const value = raw === null || raw === undefined ? "" : String(raw);
        return value === "" ? PIVOT_TABLE_EMPTY_KEY : value;
      })
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
  // Several source rows land in one cell whenever the query groups more finely
  // than (x, breakdown) — an extra GROUP BY column — or when breakdown groups
  // fold into the overflow bucket. How they combine follows the y-field's
  // aggregation: additive ones combine exactly, min/max keep the exact bound
  // of the union, and anything else cannot be reconstructed from the values
  // the query returned, so the first value is kept. Keeping a real returned
  // value is the point: combining an avg or a max produces a number that
  // appears nowhere in the data and silently disagrees with the same query
  // shown anywhere else.
  //
  // Custom-SQL panels carry a hardcoded `functionName: "count"` placeholder
  // (usePanelFields stamps it on every y field; the real aggregation lives in
  // the SQL text), so their aggregation comes from parsing the query instead —
  // trusting the placeholder would add up rows the user asked to max. Builder
  // panels declare it on the field, in either of two live shapes: `functionName`
  // today, `aggregationFunction` on older saved panels (see utils/autoName.ts).
  type MergeKind = "add" | "min" | "max" | "first";
  const MERGE_FNS: Record<MergeKind, (a: number, b: number) => number> = {
    add: (a, b) => a + b,
    // Wrapped, not bare Math.min/max: those read every argument, so a bare
    // reference passed to reduce() would also consume its index/array args.
    min: (a, b) => Math.min(a, b),
    max: (a, b) => Math.max(a, b),
    first: (a) => a,
  };

  const resolveMergeKind = (yField: any): MergeKind => {
    const declared = query.customQuery
      ? customQueryAggregations?.[yField?.alias]
      : (yField?.functionName ?? yField?.aggregationFunction);

    switch (String(declared ?? "").toLowerCase()) {
      case "count":
      case "sum":
        return "add";
      case "min":
        return "min";
      case "max":
        return "max";
      default:
        return "first";
    }
  };

  const mergeKindByAlias: Record<string, MergeKind> = {};
  for (const yField of yFields) {
    mergeKindByAlias[yField.alias] = resolveMergeKind(yField);
  }

  // Totals combine a row/column the same way its cells combine, so a min/max
  // pivot reports the bound across the row instead of a sum of bounds. An
  // unknown aggregation keeps the historical sum: "Total" has to mean
  // something, and keeping one cell's value would not.
  const foldTotal = (yAlias: string, values: any[]): number | null => {
    const kind = mergeKindByAlias[yAlias];
    const nums = values
      .filter((v) => v !== null && v !== undefined)
      .map(Number)
      .filter((v) => !Number.isNaN(v));

    if (kind === "min" || kind === "max") {
      return nums.length ? nums.reduce((a, b) => MERGE_FNS[kind](a, b)) : null;
    }
    return nums.reduce((a, b) => a + b, 0);
  };

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

    const bucket = pivotKeySet.has(pivotKey)
      ? pivotKey
      : hasOthers
        ? PIVOT_TABLE_OTHERS_LABEL
        : null;
    if (bucket === null) continue;

    for (const yAlias of yAliases) {
      // A null/undefined aggregate (e.g. min() over an all-null group) is
      // absent, not zero: coercing it before merging corrupts min/max and can
      // lock keep-first onto a synthetic 0. Skip it — the cell stays unwritten
      // until a real value arrives, and Step 3 fills never-written cells with
      // null so they render as missing.
      const rawValue = getDataValue(row, yAlias);
      if (rawValue === null || rawValue === undefined) continue;

      const numericValue = Number(rawValue) || 0;
      const colKey = `${bucket}_${yAlias}`;
      const existing = targetRow[colKey];
      // First write assigns: seeding the merge with 0 would corrupt min/max.
      targetRow[colKey] =
        existing === undefined || existing === null
          ? numericValue
          : MERGE_FNS[mergeKindByAlias[yAlias]](existing, numericValue);
    }
  }

  // --- Step 3: Fill missing values + row totals ---
  const allPivotKeys = hasOthers ? [...pivotKeys, PIVOT_TABLE_OTHERS_LABEL] : pivotKeys;
  const pivotedRows = Array.from(rowMap.values());

  for (const row of pivotedRows) {
    for (const yAlias of yAliases) {
      const cells: any[] = [];
      for (const pk of allPivotKeys) {
        const colKey = `${pk}_${yAlias}`;
        if (row[colKey] === undefined || row[colKey] === null) {
          row[colKey] = null; // Keep null for correct totals/sorting; format() handles display
        }
        cells.push(row[colKey]);
      }
      if (showRowTotals) {
        row[`${PIVOT_TABLE_TOTAL_LABEL}_${yAlias}`] = foldTotal(yAlias, cells);
      }
    }
  }

  // --- Step 4: Column totals row ---
  if (showColTotals && pivotedRows.length > 0) {
    const totalRow: any = { __isTotalRow: true };
    for (let i = 0; i < xAliases.length; i++) {
      // Rendered cell text, not a key — safe to translate.
      totalRow[xAliases[i]] = i === 0 ? gt("dashboard.pivotTotal") : "";
    }

    for (const yAlias of yAliases) {
      for (const pk of allPivotKeys) {
        const colKey = `${pk}_${yAlias}`;
        totalRow[colKey] = foldTotal(
          yAlias,
          pivotedRows.map((row) => row[colKey]),
        );
      }
      if (showRowTotals) {
        const totalKey = `${PIVOT_TABLE_TOTAL_LABEL}_${yAlias}`;
        totalRow[totalKey] = foldTotal(
          yAlias,
          pivotedRows.map((row) => row[totalKey]),
        );
      }
    }

    pivotedRows.push(totalRow);
  }

  // --- Step 5: Build column definitions ---
  const { colorConfigMap, unitConfigMap } = parseOverrideConfigs(config.override_config);

  const columns: any[] = [];
  const isSingleValueField = yAliases.length === 1;
  const needsMultiRowHeader = breakdownAliases.length > 1 || yAliases.length > 1;

  // Row field columns (x-axis) — marked with _isRowField for header rendering
  const timezone = store.state.timezone;
  const timestampFieldAliases = detectTimestampFields(xFields, tableRows);
  const breakdownTimestampAliases = detectTimestampFields(breakdownFields, tableRows);

  for (const xField of xFields) {
    const col: any = {
      name: xField.alias,
      field: xField.alias,
      label: xField.label,
      align: "left",
      sortable: true,
      _isRowField: true,
      mono: timestampFieldAliases.has(xField.alias),
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
      // `pk` is a data value ("GET", "POST") except for the synthetic overflow bucket,
      // which is app-authored and therefore the only one that gets translated.
      const formattedPivotKey =
        pk === PIVOT_TABLE_OTHERS_LABEL
          ? gt("dashboard.pivotOthers")
          : pk === PIVOT_TABLE_EMPTY_KEY
            ? PIVOT_TABLE_EMPTY_LABEL
            : breakdownTimestampAliases.has(breakdownFields[0]?.alias)
              ? parseTimestampValue(pk, timezone) || pk
              : pk;
      const label = needsMultiRowHeader
        ? yField.label
        : isSingleValueField
          ? formattedPivotKey
          : `${formattedPivotKey} - ${yField.label}`;

      const yAliasLower = yField.alias.toLowerCase();
      const unitToUse = unitConfigMap[yAliasLower]?.unit || config.unit;
      const customUnitToUse = unitConfigMap[yAliasLower]?.customUnit || config.unit_custom;
      const decimals = config.decimals ?? 2;

      columns.push({
        name: colKey,
        field: colKey,
        label,
        align: "right",
        sortable: true,
        mono: true,
        _groupStart: isGroupStart,
        sort: (a: any, b: any) => (Number(a) || 0) - (Number(b) || 0),
        format: (val: any) =>
          formatNumericValue(
            val,
            valueMappingCache,
            unitToUse,
            customUnitToUse,
            decimals,
            missingValue,
          ),
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
          ? gt("dashboard.pivotTotal")
          : gt("dashboard.pivotTotalForField", {
              total: gt("dashboard.pivotTotal"),
              field: yField.label,
            });

      const yAliasLower = yField.alias.toLowerCase();
      const unitToUse = unitConfigMap[yAliasLower]?.unit || config.unit;
      const customUnitToUse = unitConfigMap[yAliasLower]?.customUnit || config.unit_custom;
      const decimals = config.decimals ?? 2;

      columns.push({
        name: colKey,
        field: colKey,
        label,
        align: "right",
        sortable: true,
        mono: true,
        _groupStart: tIdx === 0,
        _isTotalColumn: true,
        _totalColRightIndex: yFields.length - 1 - tIdx,
        sort: (a: any, b: any) => (Number(a) || 0) - (Number(b) || 0),
        format: (val: any) =>
          formatNumericValue(
            val,
            valueMappingCache,
            unitToUse,
            customUnitToUse,
            decimals,
            missingValue,
          ),
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
    hasOthers,
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
