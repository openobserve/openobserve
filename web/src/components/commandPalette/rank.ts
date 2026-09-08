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

import { matchAliases, type AliasEntry } from "./aliases";
import type { PaletteItem, PaletteItemType } from "./types";

export interface RankOptions {
  aliases?: AliasEntry[];
  /** item id → decayed frecency score. */
  frecency?: Map<string, number>;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const FRECENCY_BOOST_MAX = 30;

// Stable tie-break between types so results interleave predictably, like Datadog.
const TYPE_BIAS: Partial<Record<PaletteItemType, number>> = {
  page: 3,
  action: 2,
  dashboard: 2,
  alert: 2,
  stream: 1,
};

/** Lowercase, strip diacritics and collapse whitespace so matching is forgiving. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function wordStart(haystack: string, needle: string): boolean {
  return haystack.split(" ").some((w) => w.startsWith(needle));
}

interface Folded {
  label: string;
  subtitle: string;
  keywords: string[];
}

// Folding runs Unicode normalisation; caching it per item keeps every keystroke O(items), not O(items × strings).
const foldedCache = new WeakMap<PaletteItem, Folded>();

function folded(item: PaletteItem): Folded {
  let f = foldedCache.get(item);
  if (!f) {
    f = {
      label: fold(item.label),
      subtitle: item.subtitle ? fold(item.subtitle) : "",
      keywords: (item.keywords ?? []).map(fold),
    };
    foldedCache.set(item, f);
  }
  return f;
}

function matchScore(item: PaletteItem, q: string, aliasHits: Set<string>): number {
  if (aliasHits.has(item.id)) return 100;
  const { label, subtitle, keywords } = folded(item);
  if (label === q) return 80;
  // A pasted entity id is an exact keyword; it must beat every label substring.
  if (keywords.some((k) => k === q)) return 70;
  if (label.startsWith(q)) return 60;
  if (wordStart(label, q)) return 40;
  if (label.includes(q)) return 20;
  if (subtitle.includes(q)) return 10;
  if (keywords.some((k) => k.includes(q))) return 10;
  return 0;
}

/** 0 when the item does not match; otherwise match strength + frecency boost + type bias. */
export function scoreItem(item: PaletteItem, q: string, opts: RankOptions = {}): number {
  const aliasHits = matchAliases(q, opts.aliases);
  const base = matchScore(item, q, aliasHits);
  if (base === 0) return 0;
  const frecency = Math.min(1, opts.frecency?.get(item.id) ?? 0);
  return base + frecency * FRECENCY_BOOST_MAX + (TYPE_BIAS[item.type] ?? 0);
}

/** Ranked, deduped, capped list for a non-empty query. */
export function rankItems(
  items: PaletteItem[],
  query: string,
  opts: RankOptions = {},
): PaletteItem[] {
  const q = fold(query);
  if (!q) return [];
  const aliasHits = matchAliases(q, opts.aliases);
  const seen = new Set<string>();
  const scored: Array<{ item: PaletteItem; score: number }> = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const base = matchScore(item, q, aliasHits);
    if (base === 0) continue;
    const frecency = Math.min(1, opts.frecency?.get(item.id) ?? 0);
    scored.push({
      item,
      score: base + frecency * FRECENCY_BOOST_MAX + (TYPE_BIAS[item.type] ?? 0),
    });
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, opts.limit ?? DEFAULT_LIMIT).map((s) => s.item);
}
