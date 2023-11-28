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

/**
 * Converts table data based on the panel schema and search query data.
 *
 * @param {any} panelSchema - The panel schema containing queries and fields.
 * @param {any} searchQueryData - The search query data.
 * @return {object} An object containing rows and columns.
 */
export const convertTableData = (panelSchema: any, searchQueryData: any) => {
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

  const columns = columnData.map((it: any) => {
    let obj: any = {};
    obj["name"] = it.label;
    obj["field"] = it.alias;
    obj["label"] = it.label;
    obj["align"] = !isSampleValuesNumbers(searchQueryData[0], it.alias, 20)
      ? "left"
      : "right";
    obj["sortable"] = true;
    return obj;
  });

  return {
    rows: searchQueryData[0],
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
