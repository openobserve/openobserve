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

/** Module singleton: panels remount on every tab toggle, so a per-setup `Map` would never hit. */
import { quantizeRange } from "@/composables/query/queryClient";
import type { LLMKPI, LLMSparklineSeries } from "./composables/useLLMInsights";

const MAX_ENTRIES = 60;

/** One KPI-strip result, snapshotted for a single selection+window. */
export interface KpiSnapshot {
  kpi: LLMKPI;
  sparklines: LLMSparklineSeries;
  lastRunAt: number | null;
}

/**
 * The shared cache key: `org :: stream :: agent :: start-end`. `agent` is the current
 * agent's NAME, or a placeholder when there isn't one — `_stream` on the Stream
 * tab, `_none` on the Agent tab before an agent resolves. The dashboard builds
 * this once (`panelCacheDashboardId`) and reuses it as the panel cache id, the
 * KPI cache key, and the table's `cacheKey` prop, so every cache agrees on one
 * identity per selection. (The KPI strip also calls this directly with the same
 * name/placeholder.)
 */
export function selectionKey(
  org: string,
  stream: string,
  agent: string,
  start: number,
  end: number,
): string {
  // Relative windows re-anchor to `now` on every mount; keying on the raw
  // anchors meant no visit could ever hit the caches. Only the key buckets —
  // the queries still run with the caller's exact timestamps.
  const { start: s, end: e } = quantizeRange(start, end);
  // The caches outlive an org switch, so orgs with same-named streams must never share an entry.
  return `${org}::${stream}::${agent}::${s}-${e}`;
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
