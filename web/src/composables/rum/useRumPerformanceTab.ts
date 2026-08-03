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
 * Shared adaptation logic for the static RUM Performance dashboards (Overview, Vitals,
 * Errors, API).
 *
 * Each tab loads a fixed dashboard JSON that hardcodes browser and/or mobile columns
 * against the shared `_rumdata` stream. This composable:
 *   1. ensures the `_rumdata` schema is available (from the shared performance state, or a
 *      cached fetch — so a tab is correct regardless of parent load timing);
 *   2. drops any panel whose columns are absent from the schema, reflowing the survivors
 *      (via `filterDashboardBySchema`), so no persona ever hits a "column not found" error;
 *   3. when the tab passes its `dateTime`, additionally drops panels tagged for a platform
 *      with no data in that range (via `useRumPlatforms`) — this is what keeps a mobile
 *      section from lingering, empty, over a stream that merely *once* carried mobile data;
 *   4. reports when every panel was dropped, so the tab can show a friendly empty state.
 *
 * When the schema is unknown, filtering is a no-op — the full dashboard renders, exactly
 * as the browser-only experience did before. See
 * docs/designs/MOBILE_RUM_ADAPTIVE_UI_DESIGN.md.
 */

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import usePerformance from "@/composables/rum/usePerformance";
import useRumPlatforms from "@/composables/rum/useRumPlatforms";
import useStreams from "@/composables/useStreams";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import {
  filterDashboardBySchema,
  presentFieldsFromSchemaMap,
  type PlatformAvailability,
  type RumDashboard,
} from "@/utils/rum/dashboardCapability";

const RUM_STREAM = "_rumdata";

/** The `dateTime` object the Performance tabs receive from their parent page. */
export interface RumTabDateTime {
  start_time?: Date | number | null;
  end_time?: Date | number | null;
}

/** Search APIs take microseconds; the tabs carry `Date`s (or raw ms). */
const toMicros = (value: Date | number | null | undefined): number => {
  if (value instanceof Date) return value.getTime() * 1000;
  return typeof value === "number" && Number.isFinite(value) ? value * 1000 : 0;
};

export interface RumPerformanceTab {
  /** The schema-migrated, capability-filtered dashboard to hand to RenderDashboardCharts. */
  dashboardData: ComputedRef<RumDashboard>;
  /** True once the `_rumdata` schema has been read (or a fetch was attempted). */
  schemaResolved: Ref<boolean>;
  /** True only when the schema is known and every panel was filtered out. */
  showEmptyState: ComputedRef<boolean>;
  /** True when at least one panel was dropped — e.g. to hide browser-oriented section labels. */
  wasFiltered: ComputedRef<boolean>;
  /** Platform availability in the selected range, or null while unresolved. */
  platforms: ComputedRef<PlatformAvailability | null>;
  /** Kick off schema resolution — call from the tab's onMounted. */
  ensureRumSchema: () => Promise<void>;
}

/**
 * @param rawDashboard The tab's static dashboard JSON.
 * @param dateTime     Optional. When supplied, the tab additionally gates panels tagged
 *                     `o2Platform` on which platforms actually have data in that range
 *                     (`useRumPlatforms`). Tabs that omit it keep pure field gating.
 */
const useRumPerformanceTab = (
  rawDashboard: unknown,
  dateTime?: Ref<RumTabDateTime | undefined>,
): RumPerformanceTab => {
  const { performanceState } = usePerformance();
  const { getStream } = useStreams();
  const {
    hasBrowser,
    hasMobile,
    resolvedKey,
    detectPlatforms,
  } = useRumPlatforms();

  // Schema migration runs once; the raw JSON is a module-level import.
  const baseDashboard = convertDashboardSchemaVersion(rawDashboard) as RumDashboard;

  const schemaResolved = ref(false);

  const rumSchemaMap = computed(
    () => performanceState.data.streams?.[RUM_STREAM]?.schema ?? null,
  );
  const presentFields = computed(() => presentFieldsFromSchemaMap(rumSchemaMap.value));

  // Null until this tab has opted in (by passing a range) AND the probe has answered.
  // `useRumPlatforms` holds module-level state shared by every tab, so gating on
  // `resolvedKey` alone would silently platform-gate the tabs that never asked for it the
  // moment another tab resolved. Platform hints are also ignored while detection is in
  // flight, so a tab never hides mobile panels just because the probe hasn't landed.
  const platforms = computed<PlatformAvailability | null>(() =>
    !dateTime || resolvedKey.value === null
      ? null
      : { hasBrowser: hasBrowser.value, hasMobile: hasMobile.value },
  );

  // A watcher, not a computed: probing is an imperative side effect (a search request) that
  // has to re-run when the page's time range changes, and there is no event to hang it off —
  // the range arrives as a prop from the parent page.
  if (dateTime) {
    watch(
      dateTime,
      (value) => {
        const startTime = toMicros(value?.start_time);
        const endTime = toMicros(value?.end_time);
        if (!startTime || !endTime) return;
        // Cached per range and self-recovering (schema fallback), so fire-and-forget.
        detectPlatforms({ startTime, endTime });
      },
      { immediate: true, deep: true },
    );
  }

  const filtered = computed(() =>
    filterDashboardBySchema(baseDashboard, presentFields.value, { platforms: platforms.value }),
  );

  const dashboardData = computed(() => filtered.value.dashboard);

  const wasFiltered = computed(() => filtered.value.droppedCount > 0);

  // Empty only when something was genuinely resolved (schema or platforms) and nothing
  // survived filtering — never on an unresolved/inconclusive gate, which renders in full.
  const showEmptyState = computed(
    () =>
      schemaResolved.value &&
      (presentFields.value != null || platforms.value != null) &&
      filtered.value.keptCount === 0,
  );

  const ensureRumSchema = async (): Promise<void> => {
    try {
      if (presentFields.value) return;

      const stream = await getStream(RUM_STREAM, "logs", true);
      const schemaMap: Record<string, unknown> = {};
      (stream?.schema ?? []).forEach((field: any) => {
        schemaMap[field.name] = field;
      });
      performanceState.data.streams[RUM_STREAM] = { schema: schemaMap, name: RUM_STREAM };
    } catch {
      // Inconclusive schema — leave presentFields null so the full dashboard renders
      // rather than hiding panels from a browser user on a transient error.
    } finally {
      schemaResolved.value = true;
    }
  };

  return {
    dashboardData,
    schemaResolved,
    showEmptyState,
    wasFiltered,
    platforms,
    ensureRumSchema,
  };
};

export default useRumPerformanceTab;
