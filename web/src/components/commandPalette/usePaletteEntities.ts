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
  /** Rail categories this source's rows belong to; empty when the rail shows none of them. */
  groups: PaletteScope[];
  enabled(): boolean;
  /** Server-side search for the query, narrowed to the selected rail categories. */
  search(query: string, scopes: PaletteScope[], signal: AbortSignal): Promise<PaletteItem[]>;
}

export interface PaletteEntitiesInput {
  open: Ref<boolean>;
  query: Ref<string>;
  scopes: Ref<PaletteScope[]>;
  org: Ref<string>;
  providers: Ref<EntityProvider[]>;
}

// 300ms is the app's standard search-as-you-type delay (Logs, Traces, LogStream, alerts).
const SEARCH_DEBOUNCE_MS = 300;
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  items: PaletteItem[];
}

// Module-level so retyping a query, or reopening on it, within the TTL costs no network.
const searchCache = new Map<string, CacheEntry>();

export function resetPaletteEntityCache(): void {
  searchCache.clear();
}

function cacheKey(org: string, scopes: PaletteScope[], query: string): string {
  return `${org}|${[...scopes].sort().join(",")}|${query}`;
}

function dedupe(items: PaletteItem[]): PaletteItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

export function usePaletteEntities({ open, query, scopes, org, providers }: PaletteEntitiesInput): {
  entities: ComputedRef<PaletteItem[]>;
  loading: Ref<boolean>;
} {
  const found = ref<PaletteItem[]>([]);
  const loading = ref(false);
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const active = () =>
    providers.value.filter(
      (p) =>
        p.enabled() &&
        (scopes.value.length === 0 || p.groups.some((g) => scopes.value.includes(g))),
    );

  const cancel = (): void => {
    controller?.abort();
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const clear = (): void => {
    cancel();
    found.value = [];
    loading.value = false;
  };

  const run = async (q: string, key: string): Promise<void> => {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    loading.value = true;
    const results = await Promise.all(
      active().map(async (p) => {
        try {
          return await p.search(q, scopes.value, signal);
        } catch (e) {
          if (!signal.aborted) console.warn(`[palette] provider ${p.id} search failed`, e);
          return [];
        }
      }),
    );
    if (signal.aborted) return;
    const items = dedupe(results.flat());
    searchCache.set(key, { at: Date.now(), items });
    found.value = items;
    loading.value = false;
  };

  watch(
    [open, query, scopes, org],
    ([isOpen, q, selected, currentOrg]) => {
      const trimmed = q.trim();
      // Nothing to ask for: the empty state is pages, commands and recents, all local.
      if (!isOpen || (trimmed === "" && selected.length === 0)) {
        clear();
        return;
      }
      cancel();
      const key = cacheKey(currentOrg, selected, trimmed);
      const hit = searchCache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        found.value = hit.items;
        loading.value = false;
        return;
      }
      timer = setTimeout(() => void run(trimmed, key), SEARCH_DEBOUNCE_MS);
    },
    { immediate: true },
  );

  onBeforeUnmount(clear);

  const entities = computed(() => found.value);
  return { entities, loading };
}
