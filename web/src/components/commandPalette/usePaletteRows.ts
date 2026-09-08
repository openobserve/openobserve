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

import { computed, type ComputedRef, type Ref } from "vue";
import type { TranslateFn } from "@/types/i18n";
import { fold, rankItems } from "./rank";
import type { PaletteItem, PaletteRow } from "./types";

export interface PaletteRowsInput {
  query: Ref<string>;
  pages: Ref<PaletteItem[]>;
  actions: Ref<PaletteItem[]>;
  /** item id → decayed frecency score, re-read on every recompute. */
  frecency: () => Map<string, number>;
  t: TranslateFn;
}

const RECENT_LIMIT = 7;

function section(key: string, label: string, items: PaletteItem[]): PaletteRow[] {
  if (items.length === 0) return [];
  return [
    { kind: "header", key: `h:${key}`, label },
    ...items.map((item): PaletteRow => ({ kind: "item", key: `${key}:${item.id}`, item })),
  ];
}

/** Rows for the list: sectioned when the query is empty, one ranked list otherwise. */
export function usePaletteRows({ query, pages, actions, frecency, t }: PaletteRowsInput): {
  rows: ComputedRef<PaletteRow[]>;
  itemIndexes: ComputedRef<number[]>;
} {
  const rows = computed<PaletteRow[]>(() => {
    const all = [...actions.value, ...pages.value];
    const scores = frecency();
    if (fold(query.value) === "") {
      const byId = new Map(all.map((i) => [i.id, i]));
      const recent = [...scores.entries()]
        .filter(([id, score]) => score > 0 && byId.has(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, RECENT_LIMIT)
        .map(([id]) => byId.get(id)!);
      return [
        ...section("recent", String(t("palette.groups.recent")), recent),
        ...section("actions", String(t("palette.groups.actions")), actions.value),
        ...section("pages", String(t("palette.groups.pages")), pages.value),
      ];
    }
    return rankItems(all, query.value, { frecency: scores }).map((item): PaletteRow => ({
      kind: "item",
      key: item.id,
      item,
    }));
  });

  const itemIndexes = computed(() =>
    rows.value.map((r, i) => (r.kind === "item" ? i : -1)).filter((i) => i >= 0),
  );

  return { rows, itemIndexes };
}
