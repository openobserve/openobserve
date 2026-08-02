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

import type { ServerQueryFunction } from "@/services/query_functions";
import { SORT_LANE, type SqlCompletionEntry } from "./sqlCompletion";

/**
 * Turn the server's function catalog into completion entries.
 *
 * Division of authority between the two sources:
 *
 *   the SERVER is authoritative for WHAT exists — it is derived from the live
 *   DataFusion registry, so it tracks the pinned fork, build features and each
 *   org's VRL transforms;
 *
 *   the LOCAL catalog is authoritative for HOW an entry is inserted, because
 *   only it knows which arguments are columns and which are string literals.
 *
 * That second point is why nothing here ever quotes an argument. The server
 * reports arity, not argument types, and guessing is precisely how
 * `sum('field')` — invalid SQL — got shipped in the first place.
 */

/** Parse "(a, b)" into ["a", "b"]. Returns null when unparseable. */
const parseArgs = (signature?: string): string[] | null => {
  if (typeof signature !== "string") return null;
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return null;
  const inner = match[1].trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
};

const buildInsertText = (name: string, signature?: string): string => {
  const args = parseArgs(signature);
  // Unparseable signature: still make it callable with one placeholder rather
  // than inserting a bare name that is not valid SQL.
  if (args === null) return `${name}(\${1:arg})`;
  if (args.length === 0) return `${name}()`;
  const stops = args.map((arg, i) => `\${${i + 1}:${arg}}`);
  return `${name}(${stops.join(", ")})`;
};

export const toCompletionEntries = (
  functions: ServerQueryFunction[] | null | undefined,
): SqlCompletionEntry[] => {
  if (!Array.isArray(functions)) return [];
  return functions
    .filter((fn) => typeof fn?.name === "string" && fn.name.length > 0)
    .map((fn) => {
      const entry: SqlCompletionEntry = {
        name: fn.name,
        label: fn.name,
        kind: "Function",
        insertText: buildInsertText(fn.name, fn.signature),
        insertTextRules: "InsertAsSnippet",
        sortText: SORT_LANE.function + fn.name,
      };
      if (fn.signature) entry.detail = fn.signature;
      if (fn.doc) entry.documentation = fn.doc;
      if (fn.deprecated) entry.deprecated = true;
      return entry;
    });
};

/**
 * Merge server entries into the local catalog, local winning on collision.
 *
 * Preferring the server entry would replace `sum(${1:field})` with a generic
 * `sum(${1:expr})` and lose the knowledge that the argument is a column.
 */
export const mergeServerFunctions = (
  local: SqlCompletionEntry[],
  server: ServerQueryFunction[] | null | undefined,
): SqlCompletionEntry[] => {
  if (!Array.isArray(server) || server.length === 0) return local;

  const known = new Set(local.map((f) => f.name.toLowerCase()));
  const additions: SqlCompletionEntry[] = [];

  for (const entry of toCompletionEntries(server)) {
    const key = entry.name.toLowerCase();
    if (known.has(key)) continue; // local wins
    known.add(key); // and the server list may itself repeat
    additions.push(entry);
  }

  // Sorted so the same inputs in any order produce the same output.
  additions.sort((a, b) => a.name.localeCompare(b.name));
  return [...local, ...additions];
};
