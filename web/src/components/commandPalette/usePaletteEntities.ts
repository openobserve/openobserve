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

import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";
import type { PaletteItem, PaletteScope } from "./types";

export interface EntityProvider {
  id: string;
  scope: PaletteScope;
  enabled(): boolean;
  /** Full list, fetched when the palette opens and cached for LIST_TTL_MS. */
  list?(signal: AbortSignal): Promise<PaletteItem[]>;
  /** Keyword search per query, for sources too large to list. */
  search?(query: string, signal: AbortSignal): Promise<PaletteItem[]>;
}

export interface PaletteEntitiesInput {
  open: Ref<boolean>;
  query: Ref<string>;
  scopes: Ref<PaletteScope[]>;
  org: Ref<string>;
  providers: Ref<EntityProvider[]>;
}

const LIST_TTL_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 120;

interface CacheEntry {
  org: string;
  at: number;
  items: PaletteItem[];
}

// Module-level so reopening the palette within the TTL costs no network.
const listCache = new Map<string, CacheEntry>();

export function resetPaletteEntityCache(): void {
  listCache.clear();
}

function dedupe(items: PaletteItem[]): PaletteItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

export function usePaletteEntities({ open, query, scopes, org, providers }: PaletteEntitiesInput): {
  entities: ComputedRef<PaletteItem[]>;
  loading: Ref<boolean>;
  refresh: () => Promise<void>;
} {
  const listed = ref<PaletteItem[]>([]);
  const searched = ref<PaletteItem[]>([]);
  const loading = ref(false);
  let listController: AbortController | null = null;
  let searchController: AbortController | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const active = () => providers.value.filter((p) => p.enabled());

  const refresh = async (): Promise<void> => {
    listController?.abort();
    listController = new AbortController();
    const { signal } = listController;
    const now = Date.now();
    const current = org.value;
    const pending = active()
      .filter((p) => p.list)
      .map(async (p) => {
        const hit = listCache.get(p.id);
        if (hit && hit.org === current && now - hit.at < LIST_TTL_MS) return hit.items;
        try {
          const items = await p.list!(signal);
          listCache.set(p.id, { org: current, at: Date.now(), items });
          return items;
        } catch (e) {
          if (!signal.aborted) console.warn(`[palette] provider ${p.id} failed`, e);
          return hit?.org === current ? hit.items : [];
        }
      });
    loading.value = true;
    const results = await Promise.all(pending);
    if (signal.aborted) return;
    listed.value = results.flat();
    loading.value = false;
  };

  const runSearch = async (q: string): Promise<void> => {
    searchController?.abort();
    searchController = new AbortController();
    const { signal } = searchController;
    const targets = active().filter(
      (p) => p.search && (scopes.value.length === 0 || scopes.value.includes(p.scope)),
    );
    const results = await Promise.all(
      targets.map(async (p) => {
        try {
          return await p.search!(q, signal);
        } catch (e) {
          if (!signal.aborted) console.warn(`[palette] provider ${p.id} search failed`, e);
          return [];
        }
      }),
    );
    if (signal.aborted) return;
    searched.value = results.flat();
  };

  watch(
    open,
    (isOpen) => {
      if (isOpen) {
        void refresh();
      } else {
        listController?.abort();
        searchController?.abort();
        if (searchTimer) clearTimeout(searchTimer);
        searched.value = [];
      }
    },
    { immediate: true },
  );

  watch([query, scopes], ([q]) => {
    if (searchTimer) clearTimeout(searchTimer);
    const trimmed = q.trim();
    if (!open.value || trimmed === "") {
      searchController?.abort();
      searched.value = [];
      return;
    }
    searchTimer = setTimeout(() => void runSearch(trimmed), SEARCH_DEBOUNCE_MS);
  });

  onBeforeUnmount(() => {
    listController?.abort();
    searchController?.abort();
    if (searchTimer) clearTimeout(searchTimer);
  });

  const entities = computed(() => dedupe([...listed.value, ...searched.value]));
  return { entities, loading, refresh };
}
