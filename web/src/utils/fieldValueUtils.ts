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

/**
 * Extracts field → values mapping from search result hits.
 * Designed to be called inside an idle callback — must be fast.
 */

// Fields that should never be stored (meta / high-cardinality)
const EXCLUDED_FIELDS = new Set([
  "_timestamp",
  "_id",
  "__id",
  "timestamp",
  "@timestamp",
  "_stream",
  "_all",
  "body",
  "log",
  "message",
  "msg",
]);

const MAX_VALUE_LENGTH = 150; // chars — skip values too long to be useful filter candidates

/**
 * Extract deduplicated field→values from an array of search hits.
 *
 * @param hits - Raw search result records (max ~100 recommended)
 * @param schemaFields - Stream schema fields to restrict extraction to.
 *   Pass an empty array to allow all fields.
 * @param maxValuesPerField - Cap on unique values per field
 * @returns Map of fieldName → unique values array
 */
export const extractValuesFromHits = (
  hits: Record<string, any>[],
  schemaFields: string[],
  maxValuesPerField: number,
): Record<string, string[]> => {
  // fieldSets accumulates unique values per field using a Set so duplicates are
  // automatically ignored — no need to check "have I seen this value before?".
  const fieldSets: Map<string, Set<string>> = new Map();
  // Convert to a Set for O(1) lookups instead of O(n) Array.includes().
  const schemaSet = new Set(schemaFields);

  for (const hit of hits) {
    for (const [field, rawValue] of Object.entries(hit)) {
      // Skip meta / high-cardinality fields that are never useful as filter
      // values: timestamps (every value unique), IDs, internal OO fields,
      // and free-text fields like log/message that would just add noise.
      if (EXCLUDED_FIELDS.has(field)) continue;

      // If the stream has a known schema, only keep values for schema fields.
      // This prevents storing values from dynamic/temporary fields that users
      // would never filter on. When schemaFields is empty we allow all fields.
      if (schemaSet.size > 0 && !schemaSet.has(field)) continue;

      const value = String(rawValue ?? "");
      // Empty values and very long values (stack traces, JSON blobs, base64)
      // are useless as autocomplete suggestions — skip them.
      if (value.length === 0 || value.length > MAX_VALUE_LENGTH) continue;
      // These are JavaScript serialisation artifacts, not real field values.
      if (value === "null" || value === "undefined" || value === "NaN")
        continue;

      if (!fieldSets.has(field)) fieldSets.set(field, new Set());
      fieldSets.get(field)!.add(value);

      // Early memory cap: if a field accumulates too many unique values while
      // scanning (e.g. a high-cardinality "user_id" field with 100 unique
      // values across 100 hits), trim it back to maxValuesPerField immediately
      // instead of waiting until the loop finishes. Without this, a single
      // high-cardinality field could hold hundreds of strings in memory at once.
      // We keep the LAST maxValuesPerField entries (most recently seen hits)
      // because they are the freshest. The threshold of ×2 avoids trimming on
      // every insert — it fires at most once per field during extraction.
      if (fieldSets.get(field)!.size > maxValuesPerField * 2) {
        const arr = Array.from(fieldSets.get(field)!);
        fieldSets.set(field, new Set(arr.slice(-maxValuesPerField)));
      }
    }
  }

  // Convert each field's Set into a plain capped array for IndexedDB storage.
  const result: Record<string, string[]> = {};
  for (const [field, valueSet] of fieldSets.entries()) {
    result[field] = Array.from(valueSet).slice(0, maxValuesPerField);
  }
  return result;
};
