import { computed, type ComputedRef, type Ref } from "vue";
import type { TranslateFn } from "@/types/i18n";
import { fold, rankItems } from "./rank";
import {
  SCOPE_CREATE_ACTION,
  scopeOfType,
  type PaletteItem,
  type PaletteRow,
  type PaletteScope,
} from "./types";

export interface PaletteRowsInput {
  query: Ref<string>;
  scope: Ref<PaletteScope | null>;
  pages: Ref<PaletteItem[]>;
  actions: Ref<PaletteItem[]>;
  entities: Ref<PaletteItem[]>;
  /** Row offered when nothing matches (the AI hand-off); null when unavailable. */
  fallback: (query: string) => PaletteItem | null;
  /** item id → decayed frecency score, re-read on every recompute. */
  frecency: () => Map<string, number>;
  t: TranslateFn;
}

const RECENT_LIMIT = 7;
const SCOPE_LIMIT = 50;
const FALLBACK_MIN_QUERY = 3;

function section(key: string, label: string, items: PaletteItem[]): PaletteRow[] {
  if (items.length === 0) return [];
  return [
    { kind: "header", key: `h:${key}`, label },
    ...items.map((item): PaletteRow => ({ kind: "item", key: `${key}:${item.id}`, item })),
  ];
}

function toRows(items: PaletteItem[]): PaletteRow[] {
  return items.map((item): PaletteRow => ({ kind: "item", key: item.id, item }));
}

/** Rows for the list: sectioned when the query is empty, one ranked list otherwise. */
export function usePaletteRows({
  query,
  scope,
  pages,
  actions,
  entities,
  fallback,
  frecency,
  t,
}: PaletteRowsInput): {
  rows: ComputedRef<PaletteRow[]>;
  itemIndexes: ComputedRef<number[]>;
} {
  const all = computed(() => [...actions.value, ...pages.value, ...entities.value]);

  const inScope = computed(() =>
    scope.value ? all.value.filter((i) => scopeOfType(i.type) === scope.value) : all.value,
  );

  const emptyStateRows = (scores: Map<string, number>): PaletteRow[] => {
    const byId = new Map(all.value.map((i) => [i.id, i]));
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
  };

  // Scoped empty state: the scope's create verb first, then its items by frecency then label.
  const scopedEmptyRows = (current: PaletteScope, scores: Map<string, number>): PaletteRow[] => {
    const createId = SCOPE_CREATE_ACTION[current];
    const create = createId ? actions.value.find((a) => a.id === createId) : undefined;
    const items = inScope.value
      .filter((i) => i.id !== createId)
      .sort(
        (a, b) =>
          (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || a.label.localeCompare(b.label),
      )
      .slice(0, SCOPE_LIMIT);
    return toRows(create ? [create, ...items] : items);
  };

  const rows = computed<PaletteRow[]>(() => {
    const scores = frecency();
    const q = fold(query.value);
    if (q === "")
      return scope.value ? scopedEmptyRows(scope.value, scores) : emptyStateRows(scores);
    const ranked = rankItems(inScope.value, query.value, { frecency: scores });
    if (ranked.length === 0 && q.length >= FALLBACK_MIN_QUERY) {
      const row = fallback(query.value);
      if (row) return toRows([row]);
    }
    return toRows(ranked);
  });

  const itemIndexes = computed(() =>
    rows.value.map((r, i) => (r.kind === "item" ? i : -1)).filter((i) => i >= 0),
  );

  return { rows, itemIndexes };
}
