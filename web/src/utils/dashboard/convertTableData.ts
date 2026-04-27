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

import {
  formatUnitValue,
  getUnitValue,
} from "./convertDataIntoUnitValue";
import { getDataValue } from "./aliasUtils";
import {
  buildValueMappingCache,
  lookupValueMapping,
  parseOverrideConfigs,
  parseTimestampValue,
  detectTimestampFields,
} from "./tableConfigUtils";

/**
 * Converts table data based on the panel schema and search query data.
 *
 * @param {any} panelSchema - The panel schema containing queries and fields.
 * @param {any} searchQueryData - The search query data.
 * @return {object} An object containing rows and columns.
 */
export const convertTableData = (
  panelSchema: any,
  searchQueryData: any,
  store: any,
) => {
  // if no data than return it
  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !panelSchema
  ) {
    return { rows: [], columns: [] };
  }

  const x = panelSchema?.queries[0].fields?.x || [];
  const y = panelSchema?.queries[0].fields?.y || [];
  let columnData = [...x, ...y];
  // Avoid deep cloning - use shallow copy and work with original data
  let tableRows = searchQueryData[0];
  const histogramFields: string[] = [];

  // Build value mapping cache once for all cells
  const valueMappingCache = buildValueMappingCache(panelSchema.config?.mappings);

  const { colorConfigMap, unitConfigMap } = parseOverrideConfigs(
    panelSchema.config.override_config,
  );
  const fieldNameCache: Record<string, string> = {}; // Cache for case-insensitive lookups

  // Cache timezone to avoid repeated store lookups
  const timezone = store.state.timezone;

  // Value to display when a cell is null/undefined/empty (configured per panel)
  const missingValue = String(panelSchema.config?.no_value_replacement ?? "");

  try {
    // Pre-build case-insensitive field name cache
    if (tableRows.length > 0) {
      Object.keys(tableRows[0]).forEach((key) => {
        fieldNameCache[key.toLowerCase()] = key;
      });
    }
  } catch (e) {}

  // use all response keys if tableDynamicColumns is true
  if (panelSchema?.config?.table_dynamic_columns == true) {
    let responseKeys: any = new Set();

    // insert all keys of searchQueryData into responseKeys
    tableRows?.forEach((row: any) => {
      Object.keys(row).forEach((key) => {
        responseKeys?.add(key);
      });
    });

    // set to array
    responseKeys = Array.from(responseKeys);

    // remove x and y keys
    const xAxisKeys = x.map((key: any) => key.alias);
    const yAxisKeys = y.map((key: any) => key.alias);
    responseKeys = responseKeys?.filter(
      (key: any) => !xAxisKeys.includes(key) && !yAxisKeys.includes(key),
    );

    // create panelSchema fields object
    responseKeys = responseKeys.map((key: any) => ({
      label: key,
      alias: key,
      column: key,
      color: null,
      isDerived: false,
      treatAsNonTimestamp: false,
    }));

    // add responseKeys to columnData
    columnData = [...columnData, ...responseKeys];
  }

  // identify histogram / timestamp fields (shared logic with pivot converter)
  const detectedTimestampAliases = detectTimestampFields(columnData, tableRows);
  detectedTimestampAliases.forEach((alias) => histogramFields.push(alias));

  const isTransposeEnabled = panelSchema.config.table_transpose;
  const transposeColumn = columnData[0]?.alias || "";
  const transposeColumnLabel = columnData[0]?.label || "";
  let columns;

  if (!isTransposeEnabled) {
    columns = columnData.map((it: any) => {
      let obj: any = {};
      const isNumber = isSampleValuesNumbers(tableRows, it.alias, 20);
      // Use cached field name lookup
      const aliasLower = it.alias.toLowerCase();
      const actualField = fieldNameCache[aliasLower] || it.alias;

      obj["name"] = it.label || it.alias;
      obj["field"] = actualField;
      obj["label"] = it.label || it.alias;
      obj["align"] = !isNumber ? "left" : "right";
      obj["sortable"] = true;

      // pass color mode info for renderer - use pre-lowercased lookup
      if (colorConfigMap?.[aliasLower]?.autoColor) {
        obj["colorMode"] = "auto";
      }

      // pass showFieldAsJson flag to renderer
      if (it.showFieldAsJson) {
        obj["showFieldAsJson"] = true;
      }

      obj["format"] = (val: any) => {
        if (val === null || val === undefined || val === "") return missingValue;
        // value mapping - use cached lookup
        const valueMapping = lookupValueMapping(val, valueMappingCache);
        if (valueMapping != null) {
          return valueMapping;
        }
        return val;
      };

      // if number then sort by number and use decimal point config option in format
      if (isNumber) {
        obj["sort"] = (a: any, b: any) => parseFloat(a) - parseFloat(b);

        // Pre-fetch unit config to avoid repeated lookups
        let unitToUse = null;
        let customUnitToUse = null;
        if (unitConfigMap[aliasLower]) {
          unitToUse = unitConfigMap[aliasLower].unit;
          customUnitToUse = unitConfigMap[aliasLower].customUnit;
        }
        if (!unitToUse) {
          unitToUse = panelSchema.config?.unit;
          customUnitToUse = panelSchema.config?.unit_custom;
        }
        const decimals = panelSchema.config?.decimals ?? 2;

        obj["format"] = (val: any) => {
          if (val === null || val === undefined || val === "") return missingValue;
          // value mapping - use cached lookup
          const valueMapping = lookupValueMapping(val, valueMappingCache);

          if (valueMapping != null) {
            return valueMapping;
          }

          return !Number.isNaN(val)
            ? `${
                formatUnitValue(
                  getUnitValue(
                    val,
                    unitToUse,
                    customUnitToUse,
                    decimals,
                  ),
                ) ?? 0
              }`
            : val;
        };
      }

      // if current field is histogram field, timestamps are pre-formatted in rows
      // Just apply value mapping if needed
      if (histogramFields.includes(it.alias)) {
        obj["format"] = (val: any) => {
          if (val === null || val === undefined || val === "") return missingValue;
          // value mapping - use cached lookup
          const valueMapping = lookupValueMapping(val, valueMappingCache);
          if (valueMapping != null) {
            return valueMapping;
          }
          // Use unified parser to format for display
          return parseTimestampValue(val, timezone) || val;
        };
      }
      return obj;
    });
  } else {
    // lets get all columns from a particular field
    // Note: do NOT use ?? "" here — null/undefined values must stay as-is so that
    // String(null) = "null" gives a non-empty column key that passes TanStack's filter.
    // Using "" as a fallback would produce an empty column id that TanStack can't handle.
    const transposeColumns = searchQueryData[0].map(
      (it: any) => getDataValue(it, transposeColumn),
    );

    let uniqueTransposeColumns: any = [];
    const columnDuplicationMap: any = {};

    transposeColumns.forEach((col: any, index: any) => {
      if (!columnDuplicationMap[col]) {
        uniqueTransposeColumns.push(col);
        columnDuplicationMap[col] = 1;
      } else {
        const uniqueCol = `${col}_${columnDuplicationMap[col]}`;
        uniqueTransposeColumns.push(uniqueCol);
        columnDuplicationMap[col] += 1;
      }
    });

    const isFirstColumnHistogram = histogramFields.includes(transposeColumn);

    if (isFirstColumnHistogram) {
      uniqueTransposeColumns = uniqueTransposeColumns.map((val: any) => {
        let formattedDate = null;

        if (val) {
          // Check if the value contains an underscore (e.g., "2024-09-23T08:12:00_1")
          let baseVal = val;
          let underscorePart = "";

          // If underscore is found, split the value and retain the underscore part
          if (typeof val === "string" && val.includes("_")) {
            const parts = val.split("_");
            baseVal = parts[0]; // The date part (e.g., "2024-09-23T08:12:00")
            underscorePart = `_${parts[1]}`; // The underscore and suffix part (e.g., "_1")
          }

          // Parse and format the base date part
          formattedDate = parseTimestampValue(baseVal, timezone);

          // Append the underscore part (if it exists) back to the formatted date
          formattedDate = formattedDate
            ? `${formattedDate}${underscorePart}`
            : null;
        }

        // Return the formatted date with the underscore or the original value if it can't be parsed
        return formattedDate || val;
      });
    }

    // Filter out the first column but retain the label
    columnData = columnData.filter((it: any) => it.alias !== transposeColumn);

    // Generate label and corresponding transposed data rows
    columns = [
      {
        name: "label",
        field: "label",
        label: transposeColumnLabel,
        align: "left",
      }, // Add label column with the first column's label
      ...uniqueTransposeColumns.map((it: any) => {
        let obj: any = {};
        const isNumber = isSampleValuesNumbers(tableRows, it, 20);

        // String(null) = "null", String(undefined) = "undefined" — always non-empty,
        // so the TanStack filter never strips this column. The label is blank for
        // null/undefined values so the header renders as empty visually.
        obj["name"] = String(it);
        obj["field"] = String(it);
        obj["label"] = it != null && it !== "" ? String(it) : "";
        obj["align"] = !isNumber ? "left" : "right";
        obj["sortable"] = true;
        // pass color mode info for renderer
        if (colorConfigMap?.[it]?.autoColor) {
          obj["colorMode"] = "auto";
        }

        obj["format"] = (val: any) => {
          if (val === null || val === undefined || val === "") return missingValue;
          // value mapping - use cached lookup
          const valueMapping = lookupValueMapping(val, valueMappingCache);
          if (valueMapping != null) {
            return valueMapping;
          }
          return val;
        };

        if (isNumber) {
          obj["sort"] = (a: any, b: any) => parseFloat(a) - parseFloat(b);

          // Pre-fetch config values
          const unit = panelSchema.config?.unit;
          const unitCustom = panelSchema.config?.unit_custom;
          const decimals = panelSchema.config?.decimals ?? 2;

          obj["format"] = (val: any) => {
            if (val === null || val === undefined || val === "") return missingValue;
            // value mapping - use cached lookup
            const valueMapping = lookupValueMapping(val, valueMappingCache);

            if (valueMapping != null) {
              return valueMapping;
            }

            return !Number.isNaN(val)
              ? `${
                  formatUnitValue(
                    getUnitValue(
                      val,
                      unit,
                      unitCustom,
                      decimals,
                    ),
                  ) ?? 0
                }`
              : val;
          };
        }

        // Check if it's a histogram field
        if (histogramFields.includes(it)) {
          obj["format"] = (val: any) => {
            if (val === null || val === undefined || val === "") return missingValue;
            // value mapping - use cached lookup
            const valueMapping = lookupValueMapping(val, valueMappingCache);
            if (valueMapping != null) {
              return valueMapping;
            }
            // Use unified parser to format for display
            return parseTimestampValue(val, timezone) || val;
          };
        }

        return obj;
      }),
    ];

    // Transpose rows, adding 'label' as the first column

    tableRows = columnData.map((it: any) => {
      const isHistogramField = histogramFields.includes(it.alias);
      let obj = uniqueTransposeColumns.reduce(
        (acc: any, curr: any, reduceIndex: any) => {
          const value =
            getDataValue(searchQueryData[0][reduceIndex], it.alias) ?? "";
          acc[curr] = value;
          return acc;
        },
        {},
      );
      obj["label"] = it.label || transposeColumnLabel; // Add the label corresponding to each column
      return obj;
    });
  }

  return {
    rows: tableRows,
    columns,
  };
};

/**
 * Checks if the sample values of a given array are numbers based on a specified key.
 *
 * @param {any[]} arr - The array to check.
 * @param {string} key - The key to access the values.
 * @param {number} sampleSize - The number of sample values to check.
 * @return {boolean} True if all sample values are numbers or are undefined, null, or empty strings; otherwise, false.
 */
const isSampleValuesNumbers = (arr: any, key: string, sampleSize: number) => {
  if (!Array.isArray(arr)) {
    return false;
  }
  const sample = arr.slice(0, Math.min(sampleSize, arr.length));
  return sample.every((obj) => {
    const value = getDataValue(obj, key);
    return (
      value === undefined ||
      value === null ||
      value === "" ||
      typeof value === "number"
    );
  });
};

/**
 * Merges table data from multiple SQL queries in UNION mode.
 * Rows from all queries are combined into a single list.
 * Column set is the union of all queries' columns, ordered per query:
 *   - Query 1 selected fields, (Query 1 dynamic fields if enabled),
 *   - Query 2 selected fields, (Query 2 dynamic fields if enabled), ...
 * Supports value mapping, unit formatting, and timestamp formatting.
 * Transpose is not supported — a warning should be shown at the UI level.
 */
export const convertMultiQueryTableData = (
  panelSchema: any,
  searchQueryData: any[],
  store: any,
): { rows: any[]; columns: any[] } => {
  if (!searchQueryData || searchQueryData.length <= 1) {
    return convertTableData(panelSchema, searchQueryData, store);
  }

  const allRows: any[] = [];
  const isDynamicColumns = panelSchema?.config?.table_dynamic_columns == true;

  // Collect all rows
  searchQueryData.forEach((queryData: any[]) => {
    if (!queryData || !Array.isArray(queryData)) return;
    queryData.forEach((row: any) => {
      allRows.push({ ...row });
    });
  });

  // Build value mapping cache once for all cells
  const valueMappingCache = buildValueMappingCache(
    panelSchema.config?.mappings,
  );

  const { colorConfigMap, unitConfigMap } = parseOverrideConfigs(
    panelSchema.config.override_config,
  );

  const timezone = store.state.timezone;

  // Build ordered column list:
  // For each query: selected fields first, then dynamic fields (if enabled)
  const orderedColumnNames: string[] = [];
  const seenColumns = new Set<string>();

  // Collect field configs from all queries for known columns
  const knownAliases = new Map<string, any>();

  panelSchema.queries.forEach((query: any, queryIdx: number) => {
    const queryFields = [
      ...(query.fields?.x || []),
      ...(query.fields?.y || []),
      ...(query.fields?.breakdown || []),
    ];

    // Add selected fields for this query first
    queryFields.forEach((f: any) => {
      if (f.alias && !seenColumns.has(f.alias)) {
        orderedColumnNames.push(f.alias);
        seenColumns.add(f.alias);
      }
      if (f.alias && !knownAliases.has(f.alias)) {
        knownAliases.set(f.alias, f);
      }
    });

    // Then add dynamic fields from this query's response data
    if (isDynamicColumns) {
      const queryData = searchQueryData[queryIdx];
      if (queryData && Array.isArray(queryData)) {
        const selectedAliases = new Set(
          queryFields.map((f: any) => f.alias),
        );
        queryData.forEach((row: any) => {
          Object.keys(row).forEach((key) => {
            if (!seenColumns.has(key) && !selectedAliases.has(key)) {
              orderedColumnNames.push(key);
              seenColumns.add(key);
            }
          });
        });
      }
    }
  });

  // When dynamic columns is disabled, only show explicitly selected fields.
  // Extra response keys (e.g. VRL-computed fields) are not added.

  // Detect timestamp fields from all rows
  const allFields: any[] = [];
  panelSchema.queries.forEach((query: any) => {
    allFields.push(
      ...(query.fields?.x || []),
      ...(query.fields?.y || []),
      ...(query.fields?.breakdown || []),
    );
  });
  const detectedTimestampAliases = detectTimestampFields(allFields, allRows);

  const isTransposeEnabled = panelSchema.config?.table_transpose;
  const transposeColumn = orderedColumnNames[0] || "";
  const transposeColumnConfig = knownAliases.get(transposeColumn);
  const transposeColumnLabel =
    transposeColumnConfig?.label || transposeColumn;

  if (isTransposeEnabled && transposeColumn) {
    // Transpose: first column's values become column headers,
    // remaining columns become rows (works on the unioned allRows)
    const transposeValues = allRows.map(
      (row: any) => getDataValue(row, transposeColumn) ?? "",
    );

    let uniqueTransposeColumns: any[] = [];
    const columnDuplicationMap: any = {};

    transposeValues.forEach((col: any) => {
      if (!columnDuplicationMap[col]) {
        uniqueTransposeColumns.push(col);
        columnDuplicationMap[col] = 1;
      } else {
        const uniqueCol = `${col}_${columnDuplicationMap[col]}`;
        uniqueTransposeColumns.push(uniqueCol);
        columnDuplicationMap[col] += 1;
      }
    });

    const isFirstColumnTimestamp =
      detectedTimestampAliases.has(transposeColumn);

    if (isFirstColumnTimestamp) {
      uniqueTransposeColumns = uniqueTransposeColumns.map((val: any) => {
        if (!val) return val;
        let baseVal = val;
        let underscorePart = "";
        if (typeof val === "string" && val.includes("_")) {
          const parts = val.split("_");
          baseVal = parts[0];
          underscorePart = `_${parts[1]}`;
        }
        const formattedDate = parseTimestampValue(baseVal, timezone);
        return formattedDate ? `${formattedDate}${underscorePart}` : val;
      });
    }

    // Remaining columns (excluding the transpose pivot column)
    const remainingColumns = orderedColumnNames.filter(
      (c) => c !== transposeColumn,
    );

    // Build column definitions: label column + transposed value columns
    const columns: any[] = [
      {
        name: "label",
        field: "label",
        label: transposeColumnLabel,
        align: "left" as const,
      },
      ...uniqueTransposeColumns.map((it: any) => {
        const isNumber = isSampleValuesNumbers(allRows, it, 20);
        const col: any = {
          name: it,
          field: it,
          label: it,
          align: isNumber ? "right" : "left",
          sortable: true,
        };
        if (colorConfigMap?.[it]?.autoColor) {
          col["colorMode"] = "auto";
        }

        col["format"] = (val: any) => {
          const valueMapping = lookupValueMapping(val, valueMappingCache);
          if (valueMapping != null) return valueMapping;
          return val;
        };

        if (isNumber) {
          col["sort"] = (a: any, b: any) => parseFloat(a) - parseFloat(b);
          const unit = panelSchema.config?.unit;
          const unitCustom = panelSchema.config?.unit_custom;
          const decimals = panelSchema.config?.decimals ?? 2;

          col["format"] = (val: any) => {
            const valueMapping = lookupValueMapping(val, valueMappingCache);
            if (valueMapping != null) return valueMapping;
            return !Number.isNaN(val)
              ? `${
                  formatUnitValue(
                    getUnitValue(val, unit, unitCustom, decimals),
                  ) ?? 0
                }`
              : val;
          };
        }

        if (detectedTimestampAliases.has(it)) {
          col["format"] = (val: any) => {
            const valueMapping = lookupValueMapping(val, valueMappingCache);
            if (valueMapping != null) return valueMapping;
            return parseTimestampValue(val, timezone) || val;
          };
        }

        return col;
      }),
    ];

    // Transpose rows: each remaining column becomes a row
    const tableRows = remainingColumns.map((colName) => {
      const fieldConfig = knownAliases.get(colName);
      const obj = uniqueTransposeColumns.reduce(
        (acc: any, curr: any, reduceIndex: number) => {
          acc[curr] = getDataValue(allRows[reduceIndex], colName) ?? "";
          return acc;
        },
        {} as any,
      );
      obj["label"] = fieldConfig?.label || colName;
      return obj;
    });

    return { rows: tableRows, columns };
  }

  // Non-transpose: build column definitions in the determined order
  const columns: any[] = [];

  orderedColumnNames.forEach((colName) => {
    const fieldConfig = knownAliases.get(colName);
    const colNameLower = colName.toLowerCase();
    const isNumber = isSampleValuesNumbers(allRows, colName, 20);
    const isTimestamp = detectedTimestampAliases.has(colName);

    const col: any = {
      name: colName,
      field: colName,
      label: fieldConfig?.label || colName,
      align: isNumber || fieldConfig?.aggregationFunction ? "right" : "left",
      sortable: true,
    };

    if (colorConfigMap?.[colNameLower]?.autoColor) {
      col["colorMode"] = "auto";
    }

    if (isTimestamp) {
      col["format"] = (val: any) => {
        const valueMapping = lookupValueMapping(val, valueMappingCache);
        if (valueMapping != null) return valueMapping;
        return parseTimestampValue(val, timezone) || val;
      };
    } else if (isNumber) {
      col["sort"] = (a: any, b: any) => parseFloat(a) - parseFloat(b);

      let unitToUse = null;
      let customUnitToUse = null;
      if (unitConfigMap[colNameLower]) {
        unitToUse = unitConfigMap[colNameLower].unit;
        customUnitToUse = unitConfigMap[colNameLower].customUnit;
      }
      if (!unitToUse) {
        unitToUse = panelSchema.config?.unit;
        customUnitToUse = panelSchema.config?.unit_custom;
      }
      const decimals = panelSchema.config?.decimals ?? 2;

      col["format"] = (val: any) => {
        const valueMapping = lookupValueMapping(val, valueMappingCache);
        if (valueMapping != null) return valueMapping;
        return !Number.isNaN(val)
          ? `${
              formatUnitValue(
                getUnitValue(val, unitToUse, customUnitToUse, decimals),
              ) ?? 0
            }`
          : val;
      };
    } else {
      col["format"] = (val: any) => {
        const valueMapping = lookupValueMapping(val, valueMappingCache);
        if (valueMapping != null) return valueMapping;
        return val;
      };
    }

    columns.push(col);
  });

  return { rows: allRows, columns };
};
