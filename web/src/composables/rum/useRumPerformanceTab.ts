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
 *   3. reports when every panel was dropped, so the tab can show a friendly empty state.
 *
 * When the schema is unknown, filtering is a no-op — the full dashboard renders, exactly
 * as the browser-only experience did before. See
 * docs/designs/MOBILE_RUM_ADAPTIVE_UI_DESIGN.md.
 */

import { computed, ref, type ComputedRef, type Ref } from "vue";
import usePerformance from "@/composables/rum/usePerformance";
import useStreams from "@/composables/useStreams";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import {
  filterDashboardBySchema,
  presentFieldsFromSchemaMap,
  type RumDashboard,
} from "@/utils/rum/dashboardCapability";

const RUM_STREAM = "_rumdata";

export interface RumPerformanceTab {
  /** The schema-migrated, capability-filtered dashboard to hand to RenderDashboardCharts. */
  dashboardData: ComputedRef<RumDashboard>;
  /** True once the `_rumdata` schema has been read (or a fetch was attempted). */
  schemaResolved: Ref<boolean>;
  /** True only when the schema is known and every panel was filtered out. */
  showEmptyState: ComputedRef<boolean>;
  /** True when at least one panel was dropped — e.g. to hide browser-oriented section labels. */
  wasFiltered: ComputedRef<boolean>;
  /** Kick off schema resolution — call from the tab's onMounted. */
  ensureRumSchema: () => Promise<void>;
}

const useRumPerformanceTab = (rawDashboard: unknown): RumPerformanceTab => {
  const { performanceState } = usePerformance();
  const { getStream } = useStreams();

  // Schema migration runs once; the raw JSON is a module-level import.
  const baseDashboard = convertDashboardSchemaVersion(rawDashboard) as RumDashboard;

  const schemaResolved = ref(false);

  const rumSchemaMap = computed(
    () => performanceState.data.streams?.[RUM_STREAM]?.schema ?? null,
  );
  const presentFields = computed(() => presentFieldsFromSchemaMap(rumSchemaMap.value));

  const filtered = computed(() => filterDashboardBySchema(baseDashboard, presentFields.value));

  const dashboardData = computed(() => filtered.value.dashboard);

  const wasFiltered = computed(() => filtered.value.droppedCount > 0);

  // Empty only when the schema is genuinely known and nothing survived filtering — never
  // on an unresolved/inconclusive schema (that path renders the full dashboard).
  const showEmptyState = computed(
    () =>
      schemaResolved.value &&
      presentFields.value != null &&
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

  return { dashboardData, schemaResolved, showEmptyState, wasFiltered, ensureRumSchema };
};

export default useRumPerformanceTab;
