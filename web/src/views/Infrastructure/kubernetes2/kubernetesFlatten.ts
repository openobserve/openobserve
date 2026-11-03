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

import { escapeSingleQuotes } from "@/utils/zincutils";

export type JsonKind = "str" | "json" | "bool";

let known: ReadonlySet<string> | null = null;

export const setStreamColumns = (names: Iterable<string> | null) => {
  known = names ? new Set(names) : null;
};

const seg = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_");

const flatName = (path: string[]) => `body_object_${path.map(seg).join("_")}`;

const jsonGet = (kind: JsonKind, column: string, path: string[]) =>
  `json_get_${kind}(${column},${path.map((s) => `'${escapeSingleQuotes(s)}'`).join(",")})`;

/** SQL for the logical field body.object.<path>, resolved against the stream's actual columns. */
export function col(path: string[], kind: JsonKind = "str"): string {
  const level3 = () =>
    path.length === 1 ? flatName(path) : jsonGet(kind, flatName(path.slice(0, 1)), path.slice(1));
  if (!known) return level3();
  const found: string[] = [];
  for (let n = path.length; n >= 1; n--) {
    const name = flatName(path.slice(0, n));
    if (known.has(name)) found.push(n === path.length ? name : jsonGet(kind, name, path.slice(n)));
  }
  if (known.has("body_object")) found.push(jsonGet(kind, "body_object", path));
  if (known.has("body")) found.push(jsonGet(kind, "body", ["object", ...path]));
  // A re-levelled stream keeps old and new columns side by side, so rows of either layout must resolve.
  if (found.length === 1) return found[0];
  if (found.length > 1) return `COALESCE(${found.join(",")})`;
  return known.has("body_object_kind") ? "NULL" : level3();
}

/** SQL for body_type, which sits beside body.object. */
export function bodyTypeCol(): string {
  return known && !known.has("body_type") && known.has("body")
    ? jsonGet("str", "body", ["type"])
    : "body_type";
}

export const selectAs = (expr: string, alias: string) =>
  expr === alias ? expr : `${expr} AS ${alias}`;

/** Select items for a JSON-object field, falling back to its flattened children when the parent column is gone. */
export function selectObject(path: string[], alias: string, children: string[]): string[] {
  const parent = col(path, "json");
  if (parent !== "NULL") return [selectAs(parent, alias)];
  const flat = children.map((c) => flatName([...path, c])).filter((n) => known?.has(n));
  return flat.length ? flat : [selectAs("NULL", alias)];
}
