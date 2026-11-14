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

// Helpers for multi-select filter chips (OStatStrip `multiple`), whose selection is a key list.

type QueryValue = string | null | undefined | readonly (string | null)[];

/** Reads a stored or URL filter: a comma list, a repeated param, or a legacy single key. */
export function readFilterKeys<K extends string>(
  value: unknown,
  isKey: (key: string) => key is K,
): K[] {
  const raw = value as QueryValue;
  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return [...new Set(parts.map((p) => p.trim()).filter(isKey))];
}

/** The URL form of a selection: a comma list, or nothing when unfiltered. */
export function filterKeysToQuery(keys: readonly string[]): string | undefined {
  return keys.length ? keys.join(",") : undefined;
}

/** Adds or removes one key; `resetKey` (the "All" chip) empties the selection. */
export function toggleFilterKey<K extends string>(
  keys: readonly K[],
  key: string,
  resetKey?: string,
): K[] {
  if (key === resetKey) return [];
  return keys.includes(key as K) ? keys.filter((k) => k !== key) : [...keys, key as K];
}

/** True when a row passes: nothing selected, or it matches any selected key. */
export function matchesAnyKey<K extends string, R>(
  keys: readonly K[],
  row: R,
  matches: (row: R, key: K) => boolean,
): boolean {
  return keys.length === 0 || keys.some((key) => matches(row, key));
}
