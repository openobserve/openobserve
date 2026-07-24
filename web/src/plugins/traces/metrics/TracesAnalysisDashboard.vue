<!-- Copyright 2026 OpenObserve Inc.

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
  <ODrawer
    data-test="traces-analysis-dashboard-drawer"
    bleed
    v-model:open="isOpen"
    :width="80"
    :title="drawerTitle"
    @update:open="(v) => !v && onClose()"
  >
    <template #header-left>
      <OIcon name="timeline" size="md" />
      <!-- Time Range Display: Inline chips -->
      <div class="ml-2 flex flex-wrap items-center gap-2">
        <!-- Baseline Chip -->
        <div
          class="time-range-chip baseline-chip rounded-default flex items-center gap-1 px-2 py-1.5 text-sm"
          :style="{ '--chip-color': chipColors.baseline }"
        >
          <span class="tracking-wide uppercase opacity-70">{{
            t("traces.tracesAnalysisDashboard.baseline")
          }}</span>
          <span class="text-2xs whitespace-nowrap">{{
            formatSmartTimestamp(baselineTimeRange.startTime, baselineTimeRange.endTime).start
          }}</span>
          <span class="text-3xs opacity-60">{{ t("latencyInsights.arrowSeparator") }}</span>
          <span class="text-2xs whitespace-nowrap">{{
            formatSmartTimestamp(baselineTimeRange.startTime, baselineTimeRange.endTime).end
          }}</span>
        </div>

        <!-- Selected Chip -->
        <div
          v-if="hasSelectedTimeRange"
          class="time-range-chip selected-chip rounded-default flex items-center gap-1 px-2 py-1.5 text-sm"
          :style="{ '--chip-color': chipColors.selected }"
        >
          <span class="tracking-wide uppercase opacity-70">{{
            t("traces.tracesAnalysisDashboard.selected")
          }}</span>
          <span class="text-2xs whitespace-nowrap">{{
            formatSmartTimestamp(
              selectedTimeRangeDisplay!.startTime,
              selectedTimeRangeDisplay!.endTime,
            ).start
          }}</span>
          <span class="text-3xs opacity-70">{{ t("latencyInsights.arrowSeparator") }}</span>
          <span class="text-2xs whitespace-nowrap">{{
            formatSmartTimestamp(
              selectedTimeRangeDisplay!.startTime,
              selectedTimeRangeDisplay!.endTime,
            ).end
          }}</span>
        </div>

        <!-- Additional filter info -->
        <span v-if="filterMetadata" class="text-3xs ml-1 opacity-60">
          {{ filterMetadata }}
        </span>

        <!-- Refresh button (shown when percentile changes on duration tab) -->
        <OButton
          v-if="showRefreshButton"
          variant="primary"
          size="icon-xs-sq"
          @click="refreshAfterPercentileChange"
          data-test="percentile-refresh-button"
          icon-left="refresh"
        >
          <OTooltip :content="t('latencyInsights.refreshTooltip')" />
        </OButton>
      </div>
    </template>

    <!-- Tabs (only shown if multiple analysis types available) -->
    <OTabs
      v-if="showTabs"
      v-model="activeAnalysisType"
      dense
      class="px-page-edge border-card-glass-border text-text-secondary! insights-dashboard-tabs border-b border-solid"
      align="left"
    >
      <OTab
        v-for="tab in availableTabs"
        :key="tab.name"
        :name="tab.name"
        :label="tab.label"
        :icon="tab.icon"
        :data-test="`traces-analysis-dashboard-${tab.name}-tab`"
        class="min-h-12"
      />
    </OTabs>

    <!-- Dashboard Content with Sidebar -->
    <div class="analysis-content bg-surface-subtle flex min-h-0 flex-1 overflow-hidden pt-2">
      <!-- Collapsed dimension sidebar bar (shown when hidden) -->
      <div
        v-if="!showDimensionSelector"
        class="bg-surface-panel! flex h-full w-12.5 shrink-0 cursor-pointer flex-col items-center justify-start gap-1.5 overflow-y-auto pt-2"
        data-test="dimension-selector-collapsed-bar"
        @click="toggleDimensionSelector"
      >
        <OIcon name="expand-all" size="sm" class="mt-2.5 rotate-90 text-xl" />
        <div class="text-xs font-bold [text-orientation:mixed] [writing-mode:vertical-rl]">
          {{ t("traces.tracesAnalysisDashboard.dimensions") }}
        </div>
      </div>

      <OSplitter
        v-model="splitterModel"
        :limits="splitterLimits"
        :style="{ width: showDimensionSelector ? '100%' : 'calc(100% - 50px)', height: '100%' }"
        class="analysis-splitter-smooth [transition:all_0.3s_ease]"
        @update:model-value="onSplitterUpdate"
      >
        <!-- LEFT: Dimension Selector Sidebar -->
        <template #before>
          <div class="relative-position h-full">
            <div
              v-if="showDimensionSelector"
              class="dimension-sidebar bg-card-glass-bg flex h-full flex-col"
              data-test="dimension-selector-sidebar"
            >
              <!-- Sidebar Header with collapse button -->
              <div
                class="border-card-glass-border flex shrink-0 items-center justify-between border-b border-solid px-3 py-2"
              >
                <span class="text-sm font-semibold">{{
                  t("traces.tracesAnalysisDashboard.dimensions")
                }}</span>
                <OButton
                  variant="outline"
                  size="icon-xs-sq"
                  class="rotate-90"
                  icon-left="unfold-less"
                  :title="t('traces.tracesAnalysisDashboard.collapseDimensions')"
                  data-test="dimension-selector-collapse-btn"
                  @click="toggleDimensionSelector"
                />
              </div>
              <!-- Search Input -->
              <div class="border-card-glass-border border-solid p-2.5">
                <OSearchInput
                  v-model="dimensionSearchText"
                  :placeholder="t('search.searchDimension')"
                  clearable
                  class="w-full"
                  data-test="dimension-search-input"
                />
              </div>

              <!-- Dimension List -->
              <div class="dimension-list-container flex-1 overflow-y-auto px-[0.325rem]">
                <ul v-if="filteredDimensions.length > 0" class="flex flex-col">
                  <li
                    v-for="dimension in filteredDimensions"
                    :key="dimension.value"
                    class="dimension-list-item hover:bg-interactive-hover-bg flex items-center gap-2 border-none! px-3 py-1"
                  >
                    <div class="flex shrink-0 items-center">
                      <OCheckbox
                        :model-value="selectedDimensions.includes(dimension.value)"
                        @update:model-value="toggleDimension(dimension.value)"
                        size="xs"
                        :data-test="`dimension-checkbox-${dimension.value}`"
                      />
                    </div>
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span
                        class="dimension-label text-text-secondary! cursor-pointer truncate text-sm [line-height:1.25rem]"
                      >
                        {{ dimension.label }}
                        <OTooltip
                          side="top"
                          align="center"
                          :side-offset="8"
                          :delay="500"
                          max-width="300px"
                          :content="dimension.label"
                        />
                      </span>
                    </div>
                  </li>
                </ul>

                <!-- No results message -->
                <div v-else class="text-text-muted p-4 text-center">
                  {{ t("search.noResult") }}
                </div>
              </div>

              <!-- Selected Count Footer -->
              <div class="border-card-glass-border border-t border-solid p-3 text-xs font-normal">
                {{ selectedDimensions.length }}
                {{ t("latencyInsights.dimensionsSelected") }}
              </div>
            </div>
          </div>
        </template>

        <template #separator>
          <div
            class="h-full w-1 bg-transparent transition-colors duration-300 hover:bg-[var(--color-orange-500)]"
          ></div>
        </template>

        <!-- RIGHT: Dashboard Charts -->
        <template #after>
          <div class="h-full">
            <div class="relative-position h-full w-full overflow-auto">
              <!-- Loading State -->
              <div v-if="loading" class="flex h-full flex-col items-center justify-center py-20">
                <OSpinner
                  size="lg"
                  class="mb-4"
                  data-test="traces-analysis-dashboard-loading-indicator"
                />
                <div class="text-base">
                  {{ t("latencyInsights.analyzingDimensions") }}
                </div>
                <div class="text-text-secondary mt-2 text-xs">
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
                data-test="traces-analysis-dashboard-error"
                class="flex h-full flex-col items-center justify-center py-20"
              >
                <OIcon name="error-outline" class="mb-4" style="width: 3.75rem; height: 3.75rem" />
                <div class="mb-2 text-base">
                  {{ t("latencyInsights.failedToLoad") }}
                </div>
                <div class="text-text-secondary text-sm">{{ error }}</div>
                <OButton
                  variant="outline"
                  size="sm-action"
                  class="mt-4"
                  data-test="traces-analysis-dashboard-retry-btn"
                  @click="loadAnalysis"
                >
                  {{ t("latencyInsights.retryButton") }}
                </OButton>
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
                class="trace-analysis-dashboards p-[0.4rem]"
              />
            </div>
          </div>
        </template>
      </OSplitter>
    </div>
  </ODrawer>
</template>

<script lang="ts" setup>
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { ref, computed, watch, defineAsyncComponent, nextTick } from "vue";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";
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
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

interface DurationFilter {
  start: number;
  end: number;
  timeStart?: number;
  timeEnd?: number;
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
const { isDark } = useTheme();
const chipColors = computed(() =>
  isDark.value ? COMPARISON_COLORS.dark : COMPARISON_COLORS.light,
);
const { loading, error } = useLatencyInsightsAnalysis();
const { generateDashboard } = useLatencyInsightsDashboard();

// Variables manager will be initialized by RenderDashboardCharts
// and we'll receive a reference to it via the @variablesManagerReady event
interface VariablesManager {
  hasUncommittedChanges?: boolean | { value: boolean };
  committedVariablesData?: {
    global?: Array<{ name: string; value?: string }>;
  };
}
const variablesManager = ref<VariablesManager | null>(null);

const isOpen = ref(true);

// Computed title for the drawer header based on analysis type
const drawerTitle = computed(() => {
  if (props.analysisType === "duration") return t("latencyInsights.title");
  if (props.analysisType === "volume") return t("volumeInsights.title");
  if (props.analysisType === "error") return t("errorInsights.title");
  return "";
});
const dashboardData = ref<any>(null);
const dashboardChartsRef = ref<any>(null);
const showDimensionSelector = ref(true); // Changed to true - now controls sidebar visibility
const dashboardRenderKey = ref(0); // Only increment on full reload to avoid re-rendering on panel append
const dimensionSearchText = ref("");

// Splitter configuration for dimension selector sidebar (using percentage)
const splitterModel = ref(25); // 25% width for dimension selector (default)
const splitterLimits: [number, number] = [0, 30]; // Min 0% (allow full collapse), Max 30%
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
      typeof manager.hasUncommittedChanges === "object" && "value" in manager.hasUncommittedChanges
        ? manager.hasUncommittedChanges.value
        : manager.hasUncommittedChanges;
    return hasChanges;
  }

  return false;
});

// Active tab management
const activeAnalysisType = ref<"duration" | "volume" | "error">(props.analysisType);

// Tab configuration
const availableTabs = computed(() => {
  return props.availableAnalysisTypes.map((type) => {
    switch (type) {
      case "volume":
        return {
          name: "volume",
          label: t("volumeInsights.tabLabel"),
          icon: "trending-up",
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
          icon: "error-outline",
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
  if (streamType === "logs" && props.logSamples && props.logSamples.length >= 10) {
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
    dimensions = dimensions.filter((dim) => dim.label.toLowerCase().includes(searchLower));
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
    selectedDimensions.value = selectedDimensions.value.filter((d) => d !== dimensionValue);
  } else {
    // Add dimension - create new array to trigger reactivity
    selectedDimensions.value = [...selectedDimensions.value, dimensionValue];
  }
};

// Handle panel deletion - extract dimension name from panel and remove from selection
const handlePanelDelete = (panelId: string) => {
  if (!dashboardData.value?.tabs?.[0]?.panels) return;

  // Find the panel by ID
  const panel = dashboardData.value.tabs[0].panels.find((p: any) => p.id === panelId);

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
    splitterModel.value = savedPosition && savedPosition >= 10 ? savedPosition : 25;
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
  } else if (props.analysisType === "volume" && props.rateFilter && !props.rateFilter.timeStart) {
    return `${t("volumeInsights.rateLabel")} ${props.rateFilter.start} - ${props.rateFilter.end} ${t("traces.tracesAnalysisDashboard.tracesPerInterval")}`;
  } else if (props.analysisType === "error" && props.errorFilter && !props.errorFilter.timeStart) {
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
    } else if (props.durationFilter?.timeStart && props.durationFilter?.timeEnd) {
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
    const dashboard = generateDashboard(mockAnalyses, config, store.state.theme);

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
      (v: { name: string; value?: string }) => v.name === "percentile",
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

// Smart timestamp formatter - shows date only once if same day
const formatSmartTimestamp = (startMicroseconds: number, endMicroseconds: number) => {
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
    } else if (props.durationFilter?.timeStart && props.durationFilter?.timeEnd) {
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
    const newPanels = generateDashboard(mockAnalyses, config, store.state.theme).tabs[0].panels;

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

    const addedDimensions = newDimensions.filter((d) => !oldDimensions.includes(d));
    const removedDimensions = oldDimensions.filter((d) => !newDimensions.includes(d));

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
  () => {
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

<style scoped>
/* keep(lib-override:o-drawer): ODrawer renders its own panel; the Insights drawer
 * needs the body cell (4th child — after the two sr-only nodes h2/p and the header
 * div) to flex to full height for the splitter layout, reachable only via :deep. */
[data-test="traces-analysis-dashboard-drawer"] > :deep(div:nth-child(4)) {
  flex: 1 1 0 !important;
  overflow: hidden !important;
  display: flex;
  flex-direction: column;
}

/* keep(brand): comparison chips are tinted from the runtime --chip-color
 * (COMPARISON_COLORS baseline/selected palette) via color-mix — a dynamic brand
 * color Tailwind can't express; the text mix flips through --color-text-heading. */
.time-range-chip {
  font-size: var(--text-2xs);
  line-height: 1.2;
  transition: all 0.2s ease;
}

.time-range-chip.baseline-chip,
.time-range-chip.selected-chip {
  background: color-mix(in srgb, var(--chip-color) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--chip-color) 50%, transparent);
  color: color-mix(in srgb, var(--chip-color) 80%, var(--color-text-heading)) !important;
  font-weight: 500;
}
</style>
