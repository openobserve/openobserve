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

/**
 * Axis utilities for extracting axis keys from panel schema
 */

/**
 * Get the X-axis keys from panel schema
 * @param {any} panelSchema - The panel schema object
 * @return {string[]} Array of X-axis field aliases
 */
export const getXAxisKeys = (panelSchema: any) => {
  return panelSchema?.queries[0]?.fields?.x?.length
    ? panelSchema?.queries[0]?.fields?.x.map((it: any) => it.alias)
    : [];
};

/**
 * Get the Y-axis keys from panel schema
 * @param {any} panelSchema - The panel schema object
 * @return {string[]} Array of Y-axis field aliases
 */
export const getYAxisKeys = (panelSchema: any) => {
  return panelSchema?.queries[0]?.fields?.y?.length
    ? panelSchema?.queries[0]?.fields?.y.map((it: any) => it.alias)
    : [];
};

/**
 * Get the Z-axis keys from panel schema
 * @param {any} panelSchema - The panel schema object
 * @return {string[]} Array of Z-axis field aliases
 */
export const getZAxisKeys = (panelSchema: any) => {
  return panelSchema?.queries[0]?.fields?.z?.length
    ? panelSchema?.queries[0]?.fields?.z.map((it: any) => it.alias)
    : [];
};

/**
 * Get the breakdown keys from panel schema
 * @param {any} panelSchema - The panel schema object
 * @return {string[]} Array of breakdown field aliases
 */
export const getBreakDownKeys = (panelSchema: any) => {
  return panelSchema?.queries[0]?.fields?.breakdown?.length
    ? panelSchema?.queries[0]?.fields?.breakdown.map((it: any) => it.alias)
    : [];
};

/**
 * Extract data for a specific axis key from the processed data
 * @param {string} key - The axis key to extract data for
 * @param {any[]} data - The processed data array
 * @return {any[]} Array of values for the specified key
 */
export const getAxisDataFromKey = (key: string, data: any[]) => {
  if (!key || !data?.length) return [];
  
  const keys = Object.keys((data.length && data[0]) || {});
  const keyArrays: any = {};

  for (const k of keys) {
    keyArrays[k] = data.map((obj: any) => obj[k]);
  }

  return keyArrays[key] || [];
};
