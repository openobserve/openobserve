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

import { categoryLabel, packLabel } from "@/components/alertLibrary/libraryFacets";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

/** One run of text, marked when it is part of a search match. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Lowercased, de-duplicated words of a search query. */
export const searchWords = (query: string): string[] => [
  ...new Set(
    String(query ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
  ),
];

// The manifest is fetched content and only some fields are validated, so every read is defensive.
const searchHaystack = (entry: AlertLibraryEntry): string => {
  const tags = Array.isArray(entry?.tags) ? entry.tags : [];
  return [
    entry?.title,
    entry?.id,
    entry?.description,
    entry?.stream,
    ...tags,
    entry?.category,
    String(categoryLabel(entry?.category)),
    entry?.pack,
    String(packLabel(entry?.pack)),
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join("\n")
    .toLowerCase();
};

/** True when every word occurs in at least one searchable field of the entry. */
export const matchesSearchWords = (entry: AlertLibraryEntry, words: string[]): boolean => {
  if (words.length === 0) return true;
  const haystack = searchHaystack(entry);
  return words.every((word) => haystack.includes(word));
};

/** Sorted, merged `[start, end)` ranges of every word's occurrences in `text`. */
export const highlightRanges = (text: string, words: string[]): Array<[number, number]> => {
  if (typeof text !== "string" || text === "") return [];
  const lower = text.toLowerCase();
  const found: Array<[number, number]> = [];
  for (const word of words) {
    if (!word) continue;
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
      found.push([at, at + word.length]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
};

/** `text` cut into runs that rejoin to the original, matched runs flagged. */
export const highlightSegments = (text: string, words: string[]): HighlightSegment[] => {
  if (typeof text !== "string") return [];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of highlightRanges(text, words)) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments;
};
