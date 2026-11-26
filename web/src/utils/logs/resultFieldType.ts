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

/** The schema type of a field that only exists in a result set, read from its first non-null value. */
export const inferResultFieldType = (
  hits: Record<string, unknown>[],
  key: string,
): "Int64" | "Float64" | "Boolean" | "Utf8" => {
  for (const hit of hits) {
    const value = hit?.[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") return "Boolean";
    if (typeof value === "number")
      return hits.every((h) => typeof h?.[key] !== "number" || Number.isInteger(h[key]))
        ? "Int64"
        : "Float64";
    return "Utf8";
  }
  return "Utf8";
};
