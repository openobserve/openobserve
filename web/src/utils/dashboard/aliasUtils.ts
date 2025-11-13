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
 * Retrieves a value from an object using a case-insensitive fallback strategy.
 * 
 * This function is performance-critical and may be called millions of times in nested loops.
 * It handles various edge cases including:
 * - Numeric keys (100, 200, etc.)
 * - CamelCase string keys (xAxis)
 * - Lowercase string keys (xaxis)
 * - Falsy values (0, false, '', null) which are valid and should be returned
 * - Null/undefined objects and aliases (returns undefined safely without errors)
 * 
 * Search strategy:
 * 1. First checks for exact key match (case-sensitive)
 * 2. If not found and alias is a string, falls back to lowercase version
 * 3. Returns undefined only if no match is found
 * 
 * Performance optimizations:
 * - Early return on null/undefined objects or alias
 * - Uses strict inequality (!==) to properly handle falsy values like 0 and false
 * - Minimizes string operations (only converts to lowercase when necessary)
 * - No unnecessary intermediate variables or complex conditionals
 * 
 * @param obj - The object to search in (can be null/undefined)
 * @param alias - The key to search for (string or number, can be null/undefined)
 * @returns The value if found, undefined otherwise (never throws errors)
 * 
 * @example
 * getDataValue({ xAxis: 'time' }, 'xAxis') // Returns 'time'
 * getDataValue({ xaxis: 'time' }, 'xAxis') // Returns 'time' (lowercase fallback)
 * getDataValue({ 100: 25.5 }, 100) // Returns 25.5
 * getDataValue({ count: 0 }, 'count') // Returns 0 (not undefined)
 * getDataValue({ flag: false }, 'flag') // Returns false (not undefined)
 * getDataValue(null, 'key') // Returns undefined (no error)
 * getDataValue({ key: 'value' }, null) // Returns undefined (no error)
 */
export const getDataValue = (obj: any, alias: string | number): any => {
  // Early return for null/undefined objects or alias
  if (!obj || alias == null) return undefined;

  // Direct access - handle all types of keys (string, number)
  const value = obj[alias];
  if (value !== undefined) return value;

  // Lowercase fallback only for string keys
  // Numeric keys don't need this fallback
  return typeof alias === 'string' ? obj[alias.toLowerCase()] : undefined;
};
