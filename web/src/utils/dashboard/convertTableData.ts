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

import { toZonedTime } from "date-fns-tz";
import {
  findFirstValidMappedValue,
  formatDate,
  formatUnitValue,
  getUnitValue,
  isTimeSeries,
  isTimeStamp,
} from "./convertDataIntoUnitValue";
import { getDataValue } from "./aliasUtils";

// Build a lookup map for value mappings to avoid repeated searches
const buildValueMappingCache = (mappings: any) => {
  if (!mappings || !Array.isArray(mappings)) {
    return null;
  }

  const cache = new Map<any, string>();

  mappings.forEach((mapping: any) => {
    if (mapping && mapping.text) {
      // Handle range mappings
      if (mapping.from !== undefined && mapping.to !== undefined) {
        // Store range info for later lookup
        cache.set(`__range_${mapping.from}_${mapping.to}`, mapping.text);
      } else if (mapping.value !== undefined && mapping.value !== null) {
        // Direct value mapping
        cache.set(mapping.value, mapping.text);
      }
    }
  });

  return cache.size > 0 ? cache : null;
};

const applyValueMapping = (value: any, mappings: any) => {
  // Find the first valid mapping with a valid text
  const foundValue = findFirstValidMappedValue(value, mappings, "text");

  // if foundValue is not null and foundValue.text is not null, then return foundValue.text
  if (foundValue && foundValue.text) {
    return foundValue.text;
  }

  return null;
};

// Fast lookup using pre-built cache
const lookupValueMapping = (value: any, cache: Map<any, string> | null) => {
  if (!cache) return null;

  // Direct lookup first
  if (cache.has(value)) {
    return cache.get(value);
  }

  // Check range mappings
  if (typeof value === 'number') {
    const entries = Array.from(cache.entries());
    for (let i = 0; i < entries.length; i++) {
      const [key, text] = entries[i];
      if (typeof key === 'string' && key.startsWith('__range_')) {
        const parts = key.split('_');
        const from = parseFloat(parts[2]);
        const to = parseFloat(parts[3]);
        if (!isNaN(from) && !isNaN(to) && value >= from && value <= to) {
          return text;
        }
      }
    }
  }

  return null;
};

/**
 * Parses a potential timestamp value (string, number, or Date) and returns a formatted string.
 * This handles 16-digit microseconds (string or number), ISO strings, and standard milliseconds.
 * 
 * @param value - The value to parse
 * @param timezone - The target timezone for conversion
 * @returns Formatted timestamp string or null
 */
const parseTimestampValue = (value: any, timezone: string) => {
  if (value === undefined || value === null || value === "") return null;

  let timestamp: number;

  // Handle 16-digit microseconds (string or number)
  // This is the key fix for the "year 50002" issue where numeric micros were treated as millis
  if (
    (typeof value === "number" || typeof value === "string") &&
    /^\d{16}$/.test(value.toString())
  ) {
    timestamp = parseInt(value.toString()) / 1000;
  } else if (typeof value === "string") {
    // If the string is already a formatted date (no 'T', looks like "YYYY-MM-DD HH:mm:ss")
    // return it as-is to avoid double timezone conversion
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
      return value;
    }

    // Regular ISO string - treat as UTC timestamp
    // Only append 'Z' if it looks like an ISO string with 'T' and lacks an offset/timezone indicator
    const iso8601WithT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
    const hasOffsetOrZ = /[+-]\d{2}(:?\d{2})?$/.test(value) || value.endsWith("Z");

    const isoString = (iso8601WithT && !hasOffsetOrZ) ? `${value}Z` : value;
    timestamp = new Date(isoString).getTime();

    // Fallback if the 'Z' trick failed (already has an offset or is invalid)
    if (isNaN(timestamp)) {
      timestamp = new Date(value).getTime();
    }
  } else if (typeof value === "number") {
    // Numeric timestamp - assume it's already in milliseconds
    timestamp = value;
  } else if (value instanceof Date) {
    timestamp = value.getTime();
  } else {
    timestamp = new Date(value)?.getTime();
  }

  if (isNaN(timestamp)) return null;

  return formatDate(toZonedTime(timestamp, timezone));
};

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

  const overrideConfigs = panelSchema.config.override_config || [];
  const colorConfigMap: Record<string, any> = {};
  const unitConfigMap: Record<string, any> = {};
  const fieldNameCache: Record<string, string> = {}; // Cache for case-insensitive lookups

 // Cache timezone to avoid repeated store lookups
  const timezone = store.state.timezone;

  try {
    // Build maps for both color and unit configs
    overrideConfigs.forEach((o: any) => {
      const alias = o?.field?.value;
      const config = o?.config?.[0];

      if (alias && config) {
        const aliasLower = alias.toLowerCase();
        if (config.type === "unique_value_color") {
          const autoColor = config.autoColor;
          colorConfigMap[aliasLower] = { autoColor };
        } else if (config.type === "unit") {
          const unit = config.value?.unit;
          const customUnit = config.value?.customUnit;
          unitConfigMap[aliasLower] = { unit, customUnit };
        }
      }
    });

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

  // identify histogram fields for auto and custom sql
  if (panelSchema?.queries[0]?.customQuery === false) {
    for (const field of columnData) {
      if (field?.functionName === "histogram") {
        histogramFields.push(field.alias);
      } else {
        const sample = tableRows
          ?.slice(0, Math.min(20, tableRows.length))
          ?.map((it: any) => getDataValue(it, field.alias));
        const isTimeSeriesData = isTimeSeries(sample);
        const isTimeStampData = isTimeStamp(sample, field.treatAsNonTimestamp);

        if (isTimeSeriesData || isTimeStampData) {
          histogramFields.push(field.alias);
        }
      }
    }
  } else {
    // need sampling to identify timeseries data
    for (const field of columnData) {
      if (field?.functionName === "histogram") {
        histogramFields.push(field.alias);
      } else {
        const sample = tableRows
          ?.slice(0, Math.min(20, tableRows.length))
          ?.map((it: any) => getDataValue(it, field.alias));
        const isTimeSeriesData = isTimeSeries(sample);
        const isTimeStampData = isTimeStamp(sample, field.treatAsNonTimestamp);

        if (isTimeSeriesData || isTimeStampData) {
          histogramFields.push(field.alias);
        }
      }
    }
  }

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
