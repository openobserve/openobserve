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

/**
 * In-memory, selection-scoped caches for the two LLM Insights data paths the
 * dashboards' IndexedDB panel cache can't cover: the **KPI strip** (fetched by
 * the dashboard via `useLLMInsights`) and the **error table** (fetched by the
 * table via `useLLMStreamQuery`). The chart panels reuse the dashboards'
 * own IndexedDB cache instead.
 *
 * Both caches key identically — stream + agent + time window — via
 * `selectionKey`, so a tab toggle back to the same selection is an instant hit
 * and a new selection/window is a clean miss that refetches.
 *
 * These are **module singletons** on purpose: they must survive a component
 * remount. The error table is recreated on every tab toggle (the dashboard
 * keys panels by selection), and a `Map` declared inside a component's
 * `setup()` would be reset to empty each time and never hit. Module scope means
 * one shared instance for the page's lifetime; cleared only on a full reload.
 *
 * Bounded (`MAX_ENTRIES`) so a long session that visits many windows can't grow
 * without limit — the oldest entry is evicted FIFO when full.
 */
import type { LLMKPI, LLMSparklineSeries } from "./composables/useLLMInsights";

const MAX_ENTRIES = 60;

/** One KPI-strip result, snapshotted for a single selection+window. */
export interface KpiSnapshot {
  kpi: LLMKPI;
  sparklines: LLMSparklineSeries;
  lastRunAt: number | null;
}

/**
 * The shared cache key: `stream :: agent :: start-end`. `agent` is the current
 * agent's NAME, or a placeholder when there isn't one — `_stream` on the Stream
 * tab, `_none` on the Agent tab before an agent resolves. The dashboard builds
 * this once (`panelCacheDashboardId`) and reuses it as the panel cache id, the
 * KPI cache key, and the table's `cacheKey` prop, so every cache agrees on one
 * identity per selection. (The KPI strip also calls this directly with the same
 * name/placeholder.)
 */
export function selectionKey(stream: string, agent: string, start: number, end: number): string {
  return `${stream}::${agent}::${start}-${end}`;
}

export function createSelectionCache<T>() {
  const map = new Map<string, T>();
  return {
    has: (key: string): boolean => map.has(key),
    get: (key: string): T | undefined => map.get(key),
    set: (key: string, value: T): void => {
      // Bounded FIFO: drop the oldest entry when full (Map preserves insertion
      // order, so the first key is the oldest).
      if (!map.has(key) && map.size >= MAX_ENTRIES) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(key, value);
    },
    // Empty the cache. The singletons survive for the page's lifetime in the
    // app; this is mainly for test isolation between mounts.
    clear: (): void => map.clear(),
  };
}

/** KPI summary numbers per selection+window (dashboard-owned fetch). */
export const kpiCache = createSelectionCache<KpiSnapshot>();

/** Recent-error rows per selection+window (error table's own fetch). */
export const errorRowsCache = createSelectionCache<any[]>();
