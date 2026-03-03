<!-- Copyright 2025 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <q-dialog
    v-model="isOpen"
    position="right"
    full-height
    :maximized="true"
    transition-show="slide-left"
    transition-hide="slide-right"
    @hide="onClose"
  >
    <q-card class="analysis-dashboard-card">
      <!-- Header -->
      <q-card-section
        class="analysis-header tw:flex tw:items-center tw:justify-between tw:py-3 tw:px-[0.675rem]"
      >
        <div class="tw:flex tw:items-center tw:gap-1 tw:flex-wrap">
          <q-icon name="timeline" size="1.5rem" color="primary" />
          <span
            class="tw:text-[var(--o2-text-4)]! tw:text-lg tw:font-semibold tw:whitespace-nowrap"
          >
            <template v-if="props.analysisType === 'duration'">{{
              t("latencyInsights.title")
            }}</template>
            <template v-else-if="props.analysisType === 'volume'">{{
              t("volumeInsights.title")
            }}</template>
            <template v-else-if="props.analysisType === 'error'">{{
              t("errorInsights.title")
            }}</template>
          </span>

          <!-- Time Range Display: Inline chips -->
          <div
            class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap tw:ml-[1rem]"
          >
            <!-- Baseline Chip -->
            <div
              class="time-range-chip baseline-chip tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-[0.375rem] tw:rounded tw:text-[0.85rem]"
              :style="{ '--chip-color': chipColors.baseline }"
            >
              <span class="tw:uppercase tw:tracking-wide tw:opacity-70"
                >Baseline:</span
              >
              <span class="tw:whitespace-nowrap tw:text-[0.7rem]">{{
                formatSmartTimestamp(
                  baselineTimeRange.startTime,
                  baselineTimeRange.endTime,
                ).start
              }}</span>
              <span class="tw:opacity-60 tw:text-[0.65rem]">→</span>
              <span class="tw:whitespace-nowrap tw:text-[0.7rem]">{{
                formatSmartTimestamp(
                  baselineTimeRange.startTime,
                  baselineTimeRange.endTime,
                ).end
              }}</span>
            </div>

            <!-- Selected Chip -->
            <div
              v-if="hasSelectedTimeRange"
              class="time-range-chip selected-chip tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-[0.375rem] tw:rounded tw:text-[0.85rem]"
              :style="{ '--chip-color': chipColors.selected }"
            >
              <span class="tw:uppercase tw:tracking-wide tw:opacity-70"
                >Selected:</span
              >
              <span class="tw:whitespace-nowrap tw:text-[0.7rem]">{{
                formatSmartTimestamp(
                  selectedTimeRangeDisplay.startTime,
                  selectedTimeRangeDisplay.endTime,
                ).start
              }}</span>
              <span class="tw:opacity-70 tw:text-[0.65rem]">→</span>
              <span class="tw:whitespace-nowrap tw:text-[0.7rem]">{{
                formatSmartTimestamp(
                  selectedTimeRangeDisplay.startTime,
                  selectedTimeRangeDisplay.endTime,
                ).end
              }}</span>
            </div>

            <!-- Additional filter info -->
            <span
              v-if="filterMetadata"
              class="tw:opacity-60 tw:text-[0.65rem] tw:ml-1"
            >
              {{ filterMetadata }}
            </span>
          </div>
        </div>

        <div class="tw:flex tw:items-center tw:gap-3">
          <!-- Refresh button (shown when percentile changes on duration tab) -->
          <q-btn
            v-if="showRefreshButton"
            dense
            no-caps
            color="primary"
            icon="refresh"
            @click="refreshAfterPercentileChange"
            data-test="percentile-refresh-button"
            class="tw:px-[0.5rem]!"
          >
            <q-tooltip>{{ t("latencyInsights.refreshTooltip") }}</q-tooltip>
          </q-btn>

          <q-btn
            flat
            round
            dense
            size="sm"
            :icon="outlinedClose"
            @click="isOpen = false"
            data-test="analysis-dashboard-close"
            class="traces-analysis-close-btn"
          />
        </div>
      </q-card-section>

      <!-- Tabs (only shown if multiple analysis types available) -->
      <q-tabs
        v-if="showTabs"
        v-model="activeAnalysisType"
        dense
        inline-label
        class="tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:text-[var(--o2-text-1)]! insights-dashboard-tabs"
        active-color="primary"
        indicator-color="primary"
        align="left"
      >
        <q-tab
          v-for="tab in availableTabs"
          :key="tab.name"
          :name="tab.name"
          :label="tab.label"
          :icon="tab.icon"
          class="tw:min-h-[3rem]"
        />
      </q-tabs>

      <!-- Dashboard Content with Sidebar -->
      <q-card-section class="analysis-content tw:flex-1 tw:p-0">
        <q-splitter
          v-model="splitterModel"
          :limits="splitterLimits"
          class="full-height full-width analysis-splitter-smooth"
          @update:model-value="onSplitterUpdate"
        >
          <!-- LEFT: Dimension Selector Sidebar -->
          <template #before>
            <div class="relative-position tw:h-full">
              <div
                v-if="showDimensionSelector"
                class="dimension-sidebar card-container tw:h-full tw:flex tw:flex-col"
                data-test="dimension-selector-sidebar"
              >
                <!-- Sidebar Header -->
                <div
                  class="tw:p-[0.625rem] tw:border-solid tw:border-[var(--o2-border-color)]"
                >
                  <!-- Search Input -->
                  <q-input
                    v-model="dimensionSearchText"
                    dense
                    borderless
                    :placeholder="t('search.searchDimension')"
                    clearable
                    class="tw:w-full"
                    data-test="dimension-search-input"
                  >
                    <template #prepend>
                      <q-icon
                        name="search"
                        class="tw:text-[1.2rem]! tw:text-[var(--o2-text-3)]"
                      />
                    </template>
                  </q-input>
                </div>

                <!-- Dimension List -->
                <div
                  class="dimension-list-container tw:flex-1 tw:overflow-y-auto tw:px-[0.325rem]"
                >
                  <q-list v-if="filteredDimensions.length > 0">
                    <q-item
                      v-for="dimension in filteredDimensions"
                      :key="dimension.value"
                      dense
                      class="dimension-list-item tw:border-none!"
                    >
                      <q-item-section side>
                        <q-checkbox
                          :model-value="
                            selectedDimensions.includes(dimension.value)
                          "
                          @update:model-value="toggleDimension(dimension.value)"
                          color="primary"
                          size="xs"
                          dense
                          :data-test="`dimension-checkbox-${dimension.value}`"
                        />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label
                          class="dimension-label tw:truncate tw:cursor-pointer tw:text-[var(--o2-text-2)]!"
                        >
                          {{ dimension.label }}
                          <q-tooltip
                            anchor="top middle"
                            self="bottom middle"
                            :offset="[0, 8]"
                            :delay="500"
                            max-width="300px"
                          >
                            {{ dimension.label }}
                          </q-tooltip>
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>

                  <!-- No results message -->
                  <div v-else class="tw:p-4 tw:text-center tw:text-gray-500">
                    {{ t("search.noResult") }}
                  </div>
                </div>

                <!-- Selected Count Footer -->
                <div
                  class="tw:p-3 tw:border-t tw:border-solid tw:border-[var(--o2-border-color)] o2-table-footer-title tw:text-[var(--o2-text-4)]!"
                >
                  {{ selectedDimensions.length }}
                  {{ t("latencyInsights.dimensionsSelected") }}
                </div>
              </div>
            </div>
          </template>

          <!-- SEPARATOR: Collapse/Expand Button -->
          <template #separator>
            <q-btn
              data-test="dimension-selector-collapse-btn"
              :icon="showDimensionSelector ? 'chevron_left' : 'chevron_right'"
              :title="
                showDimensionSelector
                  ? 'Collapse Dimensions'
                  : 'Expand Dimensions'
              "
              :class="
                showDimensionSelector
                  ? 'splitter-icon-expand'
                  : 'splitter-icon-collapse'
              "
              color="primary"
              size="sm"
              dense
              round
              @click="toggleDimensionSelector"
            />
          </template>

          <!-- RIGHT: Dashboard Charts -->
          <template #after>
            <div class="tw:h-full">
              <div
                class="tw:h-full tw:w-full relative-position tw:overflow-auto"
              >
                <!-- Loading State -->
                <div
                  v-if="loading"
                  class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
                >
                  <q-spinner-hourglass
                    color="primary"
                    size="3.75rem"
                    class="tw:mb-4"
                  />
                  <div class="tw:text-base">
                    {{ t("latencyInsights.analyzingDimensions") }}
                  </div>
                  <div class="tw:text-xs tw:text-gray-500 tw:mt-2">
                    {{
                      t("latencyInsights.computingDistributions", {
                        count: selectedDimensions.length,
                      })
                    }}
                  </div>
                </div>

                <!-- Error State -->
                <div
                  v-else-if="error"
                  class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
                >
                  <q-icon
                    name="error_outline"
                    size="3.75rem"
                    color="negative"
                    class="tw:mb-4"
                  />
                  <div class="tw:text-base tw:mb-2">
                    {{ t("latencyInsights.failedToLoad") }}
                  </div>
                  <div class="tw:text-sm tw:text-gray-500">{{ error }}</div>
                  <q-btn
                    outline
                    color="primary"
                    :label="t('latencyInsights.retryButton')"
                    class="tw:mt-4"
                    @click="loadAnalysis"
                  />
                </div>

                <!-- Dashboard -->
                <RenderDashboardCharts
                  v-else-if="dashboardData"
                  :key="`${activeAnalysisType}-${dashboardRenderKey}`"
                  ref="dashboardChartsRef"
                  :dashboardData="dashboardData"
                  :currentTimeObj="currentTimeObj"
                  :viewOnly="false"
                  :allowAlertCreation="false"
                  :simplifiedPanelView="true"
                  :searchType="props.streamType === 'logs' ? 'insights' : 'dashboards'"
                  @variablesManagerReady="onVariablesManagerReady"
                  @onDeletePanel="handlePanelDelete"
                  class="tw:p-[0.4rem] trace-analysis-dashboards"
                />
              </div>
            </div>
          </template>
        </q-splitter>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts" setup>
import { ref, computed, watch, defineAsyncComponent, nextTick } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";
import { formatTimeWithSuffix } from "@/utils/zincutils";
import {
  useLatencyInsightsAnalysis,
  type LatencyInsightsConfig,
} from "@/composables/useLatencyInsightsAnalysis";
import {
  useLatencyInsightsDashboard,
  COMPARISON_COLORS,
} from "@/composables/useLatencyInsightsDashboard";
import {
  selectDimensionsFromData,
  selectTraceDimensions,
} from "@/composables/useDimensionSelector";
import { outlinedClose } from "@quasar/extras/material-icons-outlined";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

interface DurationFilter {
  start: number;
  end: number;
}

interface RateFilter {
  start: number;
  end: number;
  timeStart?: number;
  timeEnd?: number;
}

interface ErrorFilter {
  start: number;
  end: number;
  timeStart?: number;
  timeEnd?: number;
}

interface TimeRange {
  startTime: number;
  endTime: number;
}

interface Props {
  durationFilter?: DurationFilter;
  rateFilter?: RateFilter;
  errorFilter?: ErrorFilter;
  timeRange: TimeRange;
  streamName: string;
  streamType?: string; // logs or traces
  baseFilter?: string;
  analysisType?: "duration" | "volume" | "error"; // Initial/default analysis type
  availableAnalysisTypes?: Array<"duration" | "volume" | "error">; // Which tabs to show
  streamFields?: any[]; // Stream schema fields for smart dimension selection
  logSamples?: any[]; // Actual log data for sample-based analysis (logs only)
}

const props = withDefaults(defineProps<Props>(), {
  analysisType: "duration",
  availableAnalysisTypes: () => ["volume"], // Default to just volume
});

const emit = defineEmits<{
  (e: "close"): void;
}>();

const { showErrorNotification } = useNotifications();
const store = useStore();
const { t } = useI18n();
const chipColors = computed(() =>
  store.state.theme === "dark"
    ? COMPARISON_COLORS.dark
    : COMPARISON_COLORS.light,
);
const { loading, error, analyzeAllDimensions } = useLatencyInsightsAnalysis();
const { generateDashboard } = useLatencyInsightsDashboard();

// Variables manager will be initialized by RenderDashboardCharts
// and we'll receive a reference to it via the @variablesManagerReady event
const variablesManager = ref(null);

const isOpen = ref(true);
const dashboardData = ref<any>(null);
const dashboardChartsRef = ref<any>(null);
const showDimensionSelector = ref(true); // Changed to true - now controls sidebar visibility
const dashboardRenderKey = ref(0); // Only increment on full reload to avoid re-rendering on panel append
const dimensionSearchText = ref("");

// Splitter configuration for dimension selector sidebar (using percentage)
const splitterModel = ref(25); // 25% width for dimension selector (default)
const splitterLimits = [0, 30]; // Min 0% (allow full collapse), Max 30%
const lastSplitterPosition = ref(25); // Remember last position before collapse

// Percentile change tracking - use variables manager's hasUncommittedChanges
// This matches the pattern used in ViewDashboard
const showRefreshButton = computed(() => {
  if (activeAnalysisType.value !== "duration") {
    return false;
  }

  // Use variables manager to check for uncommitted changes (same as ViewDashboard)
  const manager = variablesManager.value;
  // Use optional chaining for safer property access
  if (manager?.hasUncommittedChanges !== undefined) {
    // Access the value if it's a ref, otherwise use directly
    const hasChanges =
      typeof manager.hasUncommittedChanges === "object" &&
      "value" in manager.hasUncommittedChanges
        ? manager.hasUncommittedChanges.value
        : manager.hasUncommittedChanges;
    return hasChanges;
  }

  return false;
});

// Detect custom SQL mode
const isCustomSQLMode = computed(() => {
  return props.baseFilter?.trim().toUpperCase().startsWith("SELECT") || false;
});

// Active tab management
const activeAnalysisType = ref<"duration" | "volume" | "error">(
  props.analysisType,
);

// Tab configuration
const availableTabs = computed(() => {
  return props.availableAnalysisTypes.map((type) => {
    switch (type) {
      case "volume":
        return {
          name: "volume",
          label: t("volumeInsights.tabLabel"),
          icon: "trending_up",
        };
      case "duration":
        return {
          name: "duration",
          label: t("latencyInsights.tabLabel"),
          icon: "schedule",
        };
      case "error":
        return {
          name: "error",
          label: t("errorInsights.tabLabel"),
          icon: "error_outline",
        };
    }
  });
});

// Show tabs only if multiple analysis types available
const showTabs = computed(() => props.availableAnalysisTypes.length > 1);

/**
 * Smart dimension selection
 * - For logs: Uses sample-based analysis with schema metadata
 * - For traces: Uses OpenTelemetry semantic conventions
 */
const getInitialDimensions = () => {
  const streamType = props.streamType || "traces";
  const schemaFields = (props.streamFields || []).map((f: any) => ({
    name: f.name || f,
    type: f.type,
    isIndexed: f.isIndexed || false,
    isFTS: f.ftsKey || false,
    isInteresting: f.isInterestingField || false,
  }));

  // For LOGS: Use sample-based analysis if we have log data
  if (
    streamType === "logs" &&
    props.logSamples &&
    props.logSamples.length >= 10
  ) {
    return selectDimensionsFromData(props.logSamples, schemaFields, 6);
  }

  // For TRACES: Use OTel conventions
  if (streamType === "traces") {
    return selectTraceDimensions(schemaFields, 6);
  }

  // Fallback for logs without samples
  return selectDimensionsFromData([], schemaFields, 6);
};

// Selected dimensions (user can modify)
const selectedDimensions = ref<string[]>(getInitialDimensions());

// Available dimensions for dropdown (all stream fields)
const availableDimensions = computed(() => {
  return (props.streamFields || [])
    .map((f: any) => ({
      label: f.name || f,
      value: f.name || f,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

// Filter dimensions based on search text and sort (selected items first)
const filteredDimensions = computed(() => {
  let dimensions = availableDimensions.value;

  // Filter by search text if provided
  if (dimensionSearchText.value?.trim()) {
    const searchLower = dimensionSearchText.value.toLowerCase();
    dimensions = dimensions.filter((dim) =>
      dim.label.toLowerCase().includes(searchLower),
    );
  }

  // Sort: selected dimensions first, then unselected
  return dimensions.sort((a, b) => {
    const aSelected = selectedDimensions.value.includes(a.value);
    const bSelected = selectedDimensions.value.includes(b.value);

    // If one is selected and other is not, selected comes first
    if (aSelected && !bSelected) return -1;
    if (!aSelected && bSelected) return 1;

    // If both selected or both unselected, maintain original order (alphabetical)
    return a.label.localeCompare(b.label);
  });
});

const currentOrgIdentifier = computed(() => {
  return store.state.selectedOrganization.identifier;
});

const currentTimeObj = computed(() => {
  return {
    __global: {
      start_time: new Date(baselineTimeRange.value.startTime),
      end_time: new Date(baselineTimeRange.value.endTime),
    },
  };
});

// Toggle dimension selection
const toggleDimension = (dimensionValue: string) => {
  const index = selectedDimensions.value.indexOf(dimensionValue);
  if (index > -1) {
    // Prevent removing the last dimension - at least one must remain
    if (selectedDimensions.value.length <= 1) {
      return;
    }
    // Remove dimension - create new array to trigger reactivity
    selectedDimensions.value = selectedDimensions.value.filter(
      (d) => d !== dimensionValue,
    );
  } else {
    // Add dimension - create new array to trigger reactivity
    selectedDimensions.value = [...selectedDimensions.value, dimensionValue];
  }
};

// Get dimension label from value
const getDimensionLabel = (dimensionValue: string): string => {
  const dimension = availableDimensions.value.find(
    (d) => d.value === dimensionValue,
  );
  return dimension?.label || dimensionValue;
};

// Handle panel deletion - extract dimension name from panel and remove from selection
const handlePanelDelete = (panelId: string) => {
  if (!dashboardData.value?.tabs?.[0]?.panels) return;

  // Find the panel by ID
  const panel = dashboardData.value.tabs[0].panels.find(
    (p: any) => p.id === panelId,
  );

  if (panel?.title) {
    // Panel title is the dimension name - remove it from selectedDimensions
    const dimensionName = panel.title;
    toggleDimension(dimensionName);
  }
};

// Toggle dimension selector sidebar visibility (same pattern as settings page controlManagementTabs)
const toggleDimensionSelector = () => {
  if (showDimensionSelector.value) {
    // Collapsing: save current position and set to 0
    const prevVal = splitterModel.value;
    lastSplitterPosition.value = prevVal;
    splitterModel.value = 0;
    showDimensionSelector.value = false;
  } else {
    // Expanding: restore previous position, but use 25% if it was too small (< 10) or not set
    const savedPosition = lastSplitterPosition.value;
    splitterModel.value =
      savedPosition && savedPosition >= 10 ? savedPosition : 25;
    showDimensionSelector.value = true;
  }

  // Redraw charts after sidebar collapse/expand
  nextTick(() => {
    window.dispatchEvent(new Event("resize"));
  });
};

// Handle splitter resize to redraw charts
const onSplitterUpdate = () => {
  // Save position when user manually drags (but only if > 0)
  if (splitterModel.value > 0) {
    lastSplitterPosition.value = splitterModel.value;
  }

  window.dispatchEvent(new Event("resize"));
};

const baselineTimeRange = computed(() => {
  // Baseline is always the original/global time range (before brush selection)
  return props.timeRange;
});

// Compute selected time range from filters
const selectedTimeRangeDisplay = computed(() => {
  // Check for time-based filter from any RED metrics panel
  if (props.rateFilter?.timeStart && props.rateFilter?.timeEnd) {
    return {
      startTime: props.rateFilter.timeStart,
      endTime: props.rateFilter.timeEnd,
    };
  } else if (props.durationFilter?.timeStart && props.durationFilter?.timeEnd) {
    return {
      startTime: props.durationFilter.timeStart,
      endTime: props.durationFilter.timeEnd,
    };
  } else if (props.errorFilter?.timeStart && props.errorFilter?.timeEnd) {
    return {
      startTime: props.errorFilter.timeStart,
      endTime: props.errorFilter.timeEnd,
    };
  }
  return null;
});

// Check if a selected time range exists (brush selection)
const hasSelectedTimeRange = computed(() => {
  return selectedTimeRangeDisplay.value !== null;
});

// Additional filter metadata (duration, rate, or error count)
const filterMetadata = computed(() => {
  if (
    props.analysisType === "duration" &&
    props.durationFilter &&
    !props.durationFilter.timeStart
  ) {
    return `${t("latencyInsights.durationLabel")} ${formatTimeWithSuffix(props.durationFilter.start)} - ${formatTimeWithSuffix(props.durationFilter.end)}`;
  } else if (
    props.analysisType === "volume" &&
    props.rateFilter &&
    !props.rateFilter.timeStart
  ) {
    return `${t("volumeInsights.rateLabel")} ${props.rateFilter.start} - ${props.rateFilter.end} traces/interval`;
  } else if (
    props.analysisType === "error" &&
    props.errorFilter &&
    !props.errorFilter.timeStart
  ) {
    return `${t("errorInsights.errorsGreaterThan")} ${props.errorFilter.start}`;
  }
  return null;
});

const loadAnalysis = async () => {
  try {
    // Determine which filter to use based on active analysis type
    let filterConfig;
    if (activeAnalysisType.value === "duration") {
      filterConfig = {
        durationFilter: props.durationFilter,
        rateFilter: undefined,
        errorFilter: undefined,
      };
    } else if (activeAnalysisType.value === "volume") {
      filterConfig = {
        durationFilter: undefined,
        rateFilter: props.rateFilter,
        errorFilter: undefined,
      };
    } else if (activeAnalysisType.value === "error") {
      filterConfig = {
        durationFilter: undefined,
        rateFilter: undefined,
        errorFilter: props.errorFilter,
      };
    }

    // For volume/error analysis with filter, use the actual selected time range from the brush
    // Otherwise, use the global time range
    let selectedTimeRange = props.timeRange;

    // Check for ANY time-based filter (from any RED metrics panel)
    // Use whichever filter has a time range selection - applies to ALL tabs
    if (props.rateFilter?.timeStart && props.rateFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.rateFilter.timeStart,
        endTime: props.rateFilter.timeEnd,
      };
    } else if (
      props.durationFilter?.timeStart &&
      props.durationFilter?.timeEnd
    ) {
      selectedTimeRange = {
        startTime: props.durationFilter.timeStart,
        endTime: props.durationFilter.timeEnd,
      };
    } else if (props.errorFilter?.timeStart && props.errorFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.errorFilter.timeStart,
        endTime: props.errorFilter.timeEnd,
      };
    }

    const config: LatencyInsightsConfig = {
      streamName: props.streamName,
      streamType: props.streamType || "traces",
      orgIdentifier: currentOrgIdentifier.value,
      selectedTimeRange,
      baselineTimeRange: baselineTimeRange.value,
      ...filterConfig,
      baseFilter: props.baseFilter,
      dimensions: selectedDimensions.value,
      analysisType: activeAnalysisType.value,
      percentile: getCurrentPercentile() || undefined,
    };

    // OPTIMIZATION: Skip analyzeAllDimensions() to avoid 20 extra queries
    // Instead, create mock analyses with dimension names only
    // The dashboard UNION queries will fetch the actual data
    const mockAnalyses = selectedDimensions.value.map((dimensionName) => ({
      dimensionName,
      data: [], // Empty - dashboard will fetch via UNION query
      baselinePopulation: 0, // Will be calculated from query results
      selectedPopulation: 0, // Will be calculated from query results
      differenceScore: 0, // Will be calculated from query results
    }));

    // Generate dashboard JSON with UNION queries
    const dashboard = generateDashboard(
      mockAnalyses,
      config,
      store.state.theme,
    );

    dashboardData.value = dashboard;
    dashboardRenderKey.value++; // Increment to force re-render on full reload

    // Don't reset percentile values - keep them synchronized with the dashboard
    // The handleVariablesDataChange event will update them if needed
  } catch (err: any) {
    console.error("Error loading analysis:", err);
    showErrorNotification(err.message || t("latencyInsights.failedToLoad"));
  }
};

// Handler for when variables manager is ready from RenderDashboardCharts
const onVariablesManagerReady = (manager: any) => {
  variablesManager.value = manager;

  // Load analysis immediately when manager is ready to populate dashboard
  // This ensures the dashboard shows data on initial load instead of remaining blank
  if (activeAnalysisType.value === "duration" && !dashboardData.value) {
    loadAnalysis();
  }
};

// Helper to get current percentile from variables manager
const getCurrentPercentile = (): string => {
  const manager = variablesManager.value;
  if (manager && manager.committedVariablesData) {
    // committedVariablesData has structure: { global: [], tabs: {}, panels: {} }
    // Percentile is likely a global variable
    const percentileVar = manager.committedVariablesData.global?.find(
      (v: any) => v.name === "percentile",
    );
    if (percentileVar && percentileVar.value !== undefined) {
      return percentileVar.value;
    }
  }
  return "0.95"; // Default to P95
};

const refreshAfterPercentileChange = () => {
  // Commit all variable changes before reloading (same as ViewDashboard's refreshData)
  if (dashboardChartsRef.value?.commitAllVariables) {
    dashboardChartsRef.value.commitAllVariables();
  }

  // Reload the analysis with new percentile
  loadAnalysis();
};

const onClose = () => {
  emit("close");
};

// Helper functions for formatting
const formatTimestamp = (microseconds: number) => {
  const date = new Date(microseconds / 1000);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const formatFullTimestamp = (microseconds: number) => {
  const date = new Date(microseconds / 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const formatCompactTimestamp = (microseconds: number) => {
  const date = new Date(microseconds / 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  // Format as MM/DD HH:MM:SS (more compact)
  return `${month}/${day} ${hours}:${minutes}:${seconds}`;
};

// Smart timestamp formatter - shows date only once if same day
const formatSmartTimestamp = (
  startMicroseconds: number,
  endMicroseconds: number,
) => {
  const startDate = new Date(startMicroseconds / 1000);
  const endDate = new Date(endMicroseconds / 1000);

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  const formatDate = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}/${day}`;
  };

  const isSameDay = startDate.toDateString() === endDate.toDateString();

  if (isSameDay) {
    // Same day: show "MM/DD HH:MM:SS" for start, only "HH:MM:SS" for end
    return {
      start: `${formatDate(startDate)} ${formatTime(startDate)}`,
      end: formatTime(endDate),
    };
  } else {
    // Different days: show both full timestamps
    return {
      start: `${formatDate(startDate)} ${formatTime(startDate)}`,
      end: `${formatDate(endDate)} ${formatTime(endDate)}`,
    };
  }
};

const formatTimeWithSuffix = (milliseconds: number) => {
  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }
  return `${milliseconds.toFixed(2)}ms`;
};

// Load analysis when modal opens
watch(
  () => isOpen.value,
  (newVal) => {
    if (newVal) {
      loadAnalysis();
    }
  },
  { immediate: true },
);

// Add new dimension panels without re-rendering existing ones
const addDimensionPanels = async (addedDimensions: string[]) => {
  if (!dashboardData.value || !dashboardData.value.tabs?.[0]?.panels) {
    loadAnalysis();
    return;
  }

  try {
    // Get current config from existing dashboard setup
    const currentPanels = dashboardData.value.tabs[0].panels;
    const existingCount = currentPanels.length;

    // Build config (reuse logic from loadAnalysis)
    let filterConfig: any = {};
    if (activeAnalysisType.value === "duration") {
      filterConfig = {
        durationFilter: props.durationFilter,
        rateFilter: undefined,
        errorFilter: undefined,
      };
    } else if (activeAnalysisType.value === "volume") {
      filterConfig = {
        durationFilter: undefined,
        rateFilter: props.rateFilter,
        errorFilter: undefined,
      };
    } else if (activeAnalysisType.value === "error") {
      filterConfig = {
        durationFilter: undefined,
        rateFilter: undefined,
        errorFilter: props.errorFilter,
      };
    }

    let selectedTimeRange = props.timeRange;
    if (props.rateFilter?.timeStart && props.rateFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.rateFilter.timeStart,
        endTime: props.rateFilter.timeEnd,
      };
    } else if (
      props.durationFilter?.timeStart &&
      props.durationFilter?.timeEnd
    ) {
      selectedTimeRange = {
        startTime: props.durationFilter.timeStart,
        endTime: props.durationFilter.timeEnd,
      };
    } else if (props.errorFilter?.timeStart && props.errorFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.errorFilter.timeStart,
        endTime: props.errorFilter.timeEnd,
      };
    }

    const config: LatencyInsightsConfig = {
      streamName: props.streamName,
      streamType: props.streamType || "traces",
      orgIdentifier: currentOrgIdentifier.value,
      selectedTimeRange,
      baselineTimeRange: baselineTimeRange.value,
      ...filterConfig,
      baseFilter: props.baseFilter,
      dimensions: addedDimensions,
      analysisType: activeAnalysisType.value,
    };

    // Generate mock analyses for new dimensions only
    const mockAnalyses = addedDimensions.map((dimensionName) => ({
      dimensionName,
      data: [],
      baselinePopulation: 0,
      selectedPopulation: 0,
      differenceScore: 0,
    }));

    // Generate new panels using the same logic as generateDashboard
    const newPanels = generateDashboard(mockAnalyses, config, store.state.theme)
      .tabs[0].panels;

    // Update layout positions for new panels to appear after existing ones
    const timestamp = Date.now();
    newPanels.forEach((panel, index) => {
      const absoluteIndex = existingCount + index;
      // Use a completely unique ID that includes timestamp to avoid any collision
      const uniqueId = `${panel.layout.i}_${timestamp}_${absoluteIndex}`;
      panel.layout = {
        x: (absoluteIndex % 3) * 64,
        y: Math.floor(absoluteIndex / 3) * 16,
        w: 64,
        h: 16,
        i: uniqueId,
      };
      // Also update the panel ID to match
      panel.id = `${panel.id}_${timestamp}`;
    });

    // Create a new dashboard object to ensure Vue detects the change
    // We need to increment the render key to force grid re-layout, but this will cause re-queries
    // Unfortunately, without modifying RenderDashboardCharts to cache panel data, we can't avoid this
    const updatedDashboard = {
      ...dashboardData.value,
      tabs: [
        {
          ...dashboardData.value.tabs[0],
          panels: [...currentPanels, ...newPanels],
        },
        ...dashboardData.value.tabs.slice(1),
      ],
    };

    dashboardData.value = updatedDashboard;

    // DON'T increment dashboardRenderKey - let Vue's reactivity handle it
    // Since each panel has a unique ID (item.id + timestamp), Vue will only render the new panel

    // Wait for DOM to update, then refresh GridStack to position new panels
    await nextTick();
    if (dashboardChartsRef.value?.refreshGridStack) {
      await dashboardChartsRef.value.refreshGridStack();
    }
  } catch (err: any) {
    console.error("Error adding dimension panels:", err);
    loadAnalysis();
  }
};

// Reload when selected dimensions change
watch(
  selectedDimensions,
  (newDimensions, oldDimensions) => {
    // Skip if this is the initial load (already handled by isOpen watcher)
    if (!oldDimensions || oldDimensions.length === 0) {
      return;
    }

    // Check if dimensions actually changed
    const changed =
      newDimensions.length !== oldDimensions.length ||
      newDimensions.some((d, i) => d !== oldDimensions[i]);

    if (!changed) {
      return;
    }

    const addedDimensions = newDimensions.filter(
      (d) => !oldDimensions.includes(d),
    );
    const removedDimensions = oldDimensions.filter(
      (d) => !newDimensions.includes(d),
    );

    if (isOpen.value && newDimensions.length > 0) {
      if (removedDimensions.length > 0) {
        // If dimensions were removed, we need to regenerate to remove panels
        dashboardData.value = null;
        nextTick(() => {
          loadAnalysis();
        });
      } else if (addedDimensions.length > 0) {
        // If only added, append new panels without regenerating existing ones
        addDimensionPanels(addedDimensions);
      }
    }
  },
  { deep: true },
);

// Reload when active analysis type (tab) changes
watch(
  () => activeAnalysisType.value,
  (newTab, oldTab) => {
    if (isOpen.value && !loading.value) {
      loadAnalysis();
    }
  },
);

// Watch for changes in props
watch(
  () => [
    props.durationFilter,
    props.rateFilter,
    props.timeRange,
    props.streamName,
    props.analysisType,
  ],
  () => {
    if (isOpen.value) {
      loadAnalysis();
    }
  },
  { deep: true },
);
</script>

<style lang="scss" scoped>
.analysis-dashboard-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 90vw;
  max-width: 87.5rem;
  .analysis-header {
    flex-shrink: 0;
    z-index: 1;
    margin: 8px 0px;
  }

  .traces-analysis-close-btn {
    :deep(.q-icon) {
      font-size: 1.2rem;
      color: var(--o2-text-1);
    }
  }

  .insights-dashboard-tabs {
    :deep(.q-tabs__content .q-icon) {
      font-size: 1.2rem;
      display: flex;
      align-items: center;
    }

    :deep(.q-tab__label) {
      font-weight: bold;
      padding-left: 0.13rem;
    }
  }

  .trace-analysis-dashboards {
    :deep(.render-dashboard-charts-container) {
      padding: 0rem !important;
    }

    :deep(.global-variables-selector) {
      margin-top: 0rem !important;
    }
  }

  .trace-analysis-dashboards {
    :deep(.panelHeader) {
      padding-left: 0.325rem !important;
    }
  }

  // Time range chips styling - matching chart colors
  .time-range-chip {
    font-size: 0.7rem;
    line-height: 1.2;
    transition: all 0.2s ease;

    &.baseline-chip,
    &.selected-chip {
      background: color-mix(in srgb, var(--chip-color) 20%, transparent);
      border: 1px solid color-mix(in srgb, var(--chip-color) 50%, transparent);
      color: color-mix(in srgb, var(--chip-color) 80%, #000) !important;
      font-weight: 500;
    }
  }

  .analysis-content {
    flex: 1;
    overflow: hidden; // Changed to hidden - q-splitter handles overflow
    min-height: 0;
    background: #f5f5f5 !important;
  }
  .q-card__section--vert {
    padding: 8px !important;
  }
}

// Dimension sidebar (in splitter)
.dimension-sidebar {
  background: #ffffff;
  // border-right: 1px solid var(--q-border-color, #e0e0e0);
}

.dimension-list-container {
  // max-height removed - now handled by flex container

  .dimension-list-item {
    border-bottom: none;

    &:hover {
      background-color: var(--q-hover-color, rgba(0, 0, 0, 0.04));
    }

    .dimension-label {
      font-size: 0.875rem;
      line-height: 1.25rem;
    }
  }
}

// Splitter smooth transition
.analysis-splitter-smooth {
  transition: all 0.3s ease;
}

// Splitter icon positioning (at top, like logs page)
.analysis-splitter-icon-collapse {
  min-height: 3em !important;
  min-width: 0.3rem !important;
  position: absolute !important;
  top: 26px !important;
  left: 15px !important;
}

// Dark mode support
body.body--dark {
  .analysis-dashboard-card {
    background: #1e1e1e !important;

    .analysis-header {
      background: #1e1e1e !important;
    }

    .analysis-content {
      background: #2a2a2a !important;
    }
  }

  .dimension-sidebar {
    background: #202223 !important;
  }

  .dimension-list-item {
    border-bottom-color: rgba(255, 255, 255, 0.1);

    &:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }
  }

  // Time range chips: dark mode text adjustment
  .time-range-chip {
    &.baseline-chip,
    &.selected-chip {
      color: color-mix(in srgb, var(--chip-color) 80%, #fff) !important;
    }
  }
}
</style>
