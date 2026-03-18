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

      obj["name"] = it.label;
      obj["field"] = actualField;
      obj["label"] = it.label;
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
    const transposeColumns = searchQueryData[0].map(
      (it: any) => getDataValue(it, transposeColumn) ?? "",
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

        obj["name"] = it;
        obj["field"] = it;
        obj["label"] = it;
        obj["align"] = !isNumber ? "left" : "right";
        obj["sortable"] = true;
        // pass color mode info for renderer
        if (colorConfigMap?.[it]?.autoColor) {
          obj["colorMode"] = "auto";
        }

        obj["format"] = (val: any) => {
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
 * Each query's rows are appended with a __query identifier column.
 * Column set is the union of all queries' columns.
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
  const allColumnNames = new Set<string>();

  // Collect rows and discover all column names
  searchQueryData.forEach((queryData: any[], queryIndex: number) => {
    if (!queryData || !Array.isArray(queryData)) return;

    const queryLabel =
      panelSchema.queries[queryIndex]?.config?.query_label ||
      `Q${queryIndex + 1}`;

    queryData.forEach((row: any) => {
      Object.keys(row).forEach((key) => allColumnNames.add(key));
      allRows.push({ __query: queryLabel, ...row });
    });
  });

  // Remove __query from discovered columns (we add it manually as first column)
  allColumnNames.delete("__query");

  // Build column definitions
  const columns: any[] = [
    {
      name: "__query",
      field: "__query",
      label: "Query",
      align: "left",
      sortable: true,
    },
  ];

  // Try to use field configs from queries for known columns
  const knownAliases = new Map<string, any>();
  panelSchema.queries.forEach((query: any) => {
    const allFields = [
      ...(query.fields?.x || []),
      ...(query.fields?.y || []),
      ...(query.fields?.breakdown || []),
    ];
    allFields.forEach((f: any) => {
      if (f.alias && !knownAliases.has(f.alias)) {
        knownAliases.set(f.alias, f);
      }
    });
  });

  allColumnNames.forEach((colName) => {
    const fieldConfig = knownAliases.get(colName);
    columns.push({
      name: colName,
      field: colName,
      label: fieldConfig?.label || colName,
      align: fieldConfig?.aggregationFunction ? "right" : "left",
      sortable: true,
    });
  });

  return { rows: allRows, columns };
};
