// Copyright 2023 Zinc Labs Inc.
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
  formatDate,
  formatUnitValue,
  getUnitValue,
  isTimeSeries,
  isTimeStamp,
} from "./convertDataIntoUnitValue";

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
  store: any
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
  const columnData = [...x, ...y];

  const tableRows = JSON.parse(JSON.stringify(searchQueryData[0]));
  const histogramFields: string[] = [];

  // identify histogram fields for auto and custom sql
  if (panelSchema?.queries[0]?.customQuery === false) {
    for (const field of columnData) {
      if (field?.aggregationFunction === "histogram") {
        histogramFields.push(field.alias);
      } else {
        const sample = tableRows
          ?.slice(0, Math.min(20, tableRows.length))
          ?.map((it: any) => it[field.alias]);

        const isTimeSeriesData = isTimeSeries(sample);
        const isTimeStampData = isTimeStamp(sample);

        if (isTimeSeriesData || isTimeStampData) {
          histogramFields.push(field.alias);
        }
      }
    }
  } else {
    // need sampling to identify timeseries data
    for (const field of columnData) {
      if (field?.aggregationFunction === "histogram") {
        histogramFields.push(field.alias);
      } else {
        const sample = tableRows
          ?.slice(0, Math.min(20, tableRows.length))
          ?.map((it: any) => it[field.alias]);

        const isTimeSeriesData = isTimeSeries(sample);
        const isTimeStampData = isTimeStamp(sample);

        if (isTimeSeriesData || isTimeStampData) {
          histogramFields.push(field.alias);
        }
      }
    }
  }

  const columns = columnData.map((it: any) => {
    let obj: any = {};
    const isNumber = isSampleValuesNumbers(tableRows, it.alias, 20);
    obj["name"] = it.label;
    obj["field"] = it.alias;
    obj["label"] = it.label;
    obj["align"] = !isNumber ? "left" : "right";
    obj["sortable"] = true;
    // if number then sort by number and use decimal point config option in format
    if (isNumber) {
      obj["sort"] = (a: any, b: any) => parseFloat(a) - parseFloat(b);
      obj["format"] = (val: any) => {
        return !Number.isNaN(val)
          ? `${
              formatUnitValue(
                getUnitValue(
                  val,
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals ?? 2
                )
              ) ?? 0
            }`
          : val;
      };
    }

    // if current field is histogram field then return formatted date
    if (histogramFields.includes(it.alias)) {
      // if current field is histogram field then return formatted date
      obj["format"] = (val: any) => {
        return formatDate(
          toZonedTime(
            typeof val === "string"
              ? `${val}Z`
              : new Date(val)?.getTime() / 1000,
            store.state.timezone
          )
        );
      };
    }
    return obj;
  });

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
    const value = obj[key];
    return (
      value === undefined ||
      value === null ||
      value === "" ||
      typeof value === "number"
    );
  });
};
