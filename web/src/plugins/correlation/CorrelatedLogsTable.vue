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
  <div
    class="correlated-logs-table tw:flex tw:flex-col tw:h-full tw:w-full"
    :class="themeClass"
    data-test="correlated-logs-table"
  >
    <!-- Header with Inline Filters -->
    <div
      v-if="!props.hideDimensionFilters"
      class="correlation-controls tw:p-0 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)]"
    >
      <!-- Dimension Filters Bar with Pending/Apply Pattern -->
      <template v-if="!isLoading || hasResults">
        <div class="tw:flex tw:items-center tw:justify-between tw:gap-3">
          <div class="tw:flex-1">
            <DimensionFiltersBar
              :dimensions="pendingFilters"
              :unstable-dimension-keys="unstableDimensionKeys"
              :get-dimension-options="getFilterOptions"
              :has-pending-changes="hasPendingChanges"
              :show-apply-button="true"
              :filter-label="t('correlation.logs.filtersLabel')"
              :unstable-dimension-tooltip="
                t('correlation.logs.unstableDimension')
              "
              @update:dimension="handleDimensionUpdate"
              @apply="handleApplyFilters"
            />
          </div>

          <!-- Wrap Content Button -->
          <OButton
            variant="ghost"
            size="icon"
            :class="{ 'tw:text-white! tw:bg-[var(--o2-theme-color)]!': wrapTableCells }"
            data-test="correlated-logs-table-wrap-content-btn"
            @click="wrapTableCells = !wrapTableCells"
          >
            <OIcon name="wrap-text" size="sm" />
            <OTooltip :content="t('search.messageWrapContent')" />
          </OButton>

          <!-- Column Visibility Dropdown -->
          <div class="tw:pr-4">
            <ODropdown
              side="bottom"
              align="end"
              data-test="column-visibility-dropdown"
            >
              <template #trigger>
                <OButton
                  variant="outline"
                  size="sm"
                  :disabled="!hasResults"
                >
                  <template v-if="true">
                    <OIcon name="view-column"
size="sm"
class="tw:mr-1" />
                    {{ t('search.showHideColumns') }}
                  </template>
                </OButton>
              </template>
              <div class="column-visibility-list tw:min-w-[220px] tw:max-h-[320px] tw:overflow-y-auto">
                <!-- Select All / Deselect All -->
                <ODropdownItem
                  class="tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]"
                  data-test="select-all-columns"
                  @select="(e) => { e.preventDefault(); toggleSelectAll(); }"
                >
                  <template #icon-left>
                    <span @click.stop>
                      <OCheckbox
                        :model-value="areAllColumnsSelected"
                        :indeterminate="areSomeColumnsSelected && !areAllColumnsSelected"
                        @update:model-value="toggleSelectAll"
                      />
                    </span>
                  </template>
                  <span class="tw:font-semibold">
                    {{ areAllColumnsSelected ? t('common.deselectAll') : t('common.selectAll') }}
                  </span>
                </ODropdownItem>

                <!-- Draggable Column Items -->
                <ODropdownItem
                  v-for="(field, index) in orderedFields"
                  :key="field"
                  :disabled="field === '_timestamp'"
                  draggable="true"
                  @dragstart="handleDragStart($event, index)"
                  @dragover.prevent
                  @drop="handleDrop($event, index)"
                  :class="['column-item', { 'dragging': draggedIndex === index }]"
                  :data-test="`column-item-${field}`"
                  @select="(e) => { e.preventDefault(); toggleColumnVisibility(field); }"
                >
                  <template #icon-left>
                    <span @click.stop>
                      <OCheckbox
                        :model-value="visibleColumns.has(field)"
                        @update:model-value="toggleColumnVisibility(field)"
                        :disabled="field === '_timestamp'"
                      />
                    </span>
                  </template>
                  <span class="tw:flex-1">{{ field }}</span>
                  <template #icon-right>
                    <OIcon
                      name="drag-indicator"
                      size="xs"
                      class="drag-handle tw:cursor-move"
                    />
                  </template>
                </ODropdownItem>
              </div>
            </ODropdown>
          </div>
        </div>
      </template>

      <!-- Show skeleton while loading -->
      <div v-else class="tw:flex tw:items-center tw:gap-3 tw:flex-wrap tw:p-3">
        <OSkeleton class="tw:w-[200px] tw:h-8" />
        <OSkeleton class="tw:w-[200px] tw:h-8" />
        <OSkeleton class="tw:w-[200px] tw:h-8" />
      </div>

      <!-- Results Summary Row -->
      <!-- <div class="tw:p-3 tw:pt-2">
        <div class="tw:text-xs tw:opacity-70" data-test="results-summary">
          <template v-if="hasResults && !isLoading">
            {{
              t("correlation.logs.resultsCount", {
                count: totalHits,
                stream: primaryStream,
                time: took,
              })
            }}
          </template>
          <OSkeleton
            v-else-if="isLoading"
            class="tw:w-[200px] tw:h-[14px]"
          />
        </div>
      </div> -->
    </div>

    <!-- Source event + chips -->
    <CorrelationEventHeader
      :source-event="props.sourceEvent"
      :context-chips="unifiedChips"
      overflow-mode="responsive"
      :overflow-threshold="4"
    >
      <template v-if="unifiedChips.length > 0 || props.hideDimensionFilters" #chip-actions>
        <OButton
          variant="ghost"
          size="icon"
          class="tw:h-5!"
          :class="{ 'tw:text-white! tw:bg-[var(--o2-theme-color)]! tw:hover:opacity-80': wrapTableCells }"
          data-test="correlated-logs-table-wrap-content-btn"
          @click="wrapTableCells = !wrapTableCells"
        >
          <OIcon name="wrap-text" size="sm" />
          <OTooltip :content="t('search.messageWrapContent')" />
        </OButton>
      </template>
    </CorrelationEventHeader>

    <!-- Main Content Area -->
    <div class="tw:flex-1 tw:overflow-hidden tw:relative">
      <!-- Logs Table or Skeleton -->
      <div class="tw:h-full tw:w-full tw:overflow-auto logs-table-container">
        <!-- Actual Table (when data is loaded) -->
        <TenstackTable
          v-if="hasResults"
          :key="`page-${currentPage}`"
          :rows="pagedResults"
          :columns="tableColumns"
          :wrap="wrapTableCells"
          :loading="isLoading"
          :err-msg="''"
          :function-error-msg="''"
          :expanded-rows="expandedRows"
          :highlight-timestamp="-1"
          :default-columns="showingDefaultColumns"
          :jsonpreview-stream-name="jsonPreviewStreamName"
          :highlight-query="highlightQuery"
          :selected-stream-fts-keys="ftsFields"
          :selected-stream-fields="selectedFields"
          :hide-search-term-actions="hideSearchTermActions"
          :hide-view-related-button="hideViewRelatedButton"
          class="tw:overflow-y-auto!"
          @click:dataRow="handleRowClick"
          @copy="handleCopy"
          @sendToAiChat="handleSendToAiChat"
          @addSearchTerm="handleAddSearchTerm"
          @addFieldToTable="handleAddFieldToTable"
          @closeColumn="handleCloseColumn"
          @update:columnOrder="handleColumnOrderChange"
          @expandRow="handleExpandRow"
          @view-trace="handleViewTrace"
          @show-correlation="handleNestedCorrelation"
          data-test="logs-tenstack-table"
        />

        <!-- Table Skeleton (initial load) -->
        <div
          v-else-if="isLoading && !hasError"
          class="tw:h-full tw:flex tw:flex-col tw:items-center tw:justify-center"
          data-test="table-skeleton"
        >
          <!-- Loading indicator -->
          <div
            class="tw:flex tw:items-center tw:justify-center tw:gap-3"
          >
            <OSpinner size="sm" />
            <span class="tw:text-sm tw:opacity-70">
              {{ t("correlation.logs.loading") }}
            </span>
          </div>
        </div>

        <!-- Error State -->
        <div
          v-else-if="hasError"
          class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          data-test="error-state"
        >
          <p
            class="tw:text-base tw:opacity-70 tw:max-w-md tw:text-center"
          >
            {{ error || t("correlation.logs.errorDetails") }}
          </p>
        </div>

        <!-- Empty State -->
        <div
          v-else-if="isEmpty"
          class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          data-test="empty-state"
        >
          <p class="tw:text-base tw:font-medium tw:mb-2 tw:opacity-90">
            {{ t("correlation.logs.noData") }}
          </p>
          <p class="tw:text-sm tw:opacity-70 tw:mb-4">
            {{ t("correlation.logs.noDataDetails") }}
          </p>
        </div>
      </div>

      <!-- Pagination bar -->
      <div
        v-if="hasResults && totalPages > 1"
        class="tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-2 tw:border-t tw:border-solid tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-xs tw:shrink-0"
        data-test="correlated-logs-pagination"
      >
        <span class="tw:opacity-60">
          {{ (currentPage - 1) * displayPageSize + 1 }}–{{ Math.min(currentPage * displayPageSize, searchResults.length) }} of {{ searchResults.length }}
        </span>
        <OPagination
          :model-value="currentPage"
          :max="totalPages"
          :max-pages="5"
          data-test="correlated-logs-pagination-control"
          @update:model-value="goToPage"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import {
  buildSubjectButtons,
  streamMatchesPatterns,
  SUBJECT_BUTTONS_BY_SET,
  resolveSetId,
  type SubjectButton,
} from "@/composables/useMetricSubjectButtons";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useCorrelatedLogs } from "@/composables/useCorrelatedLogs";
import type { CorrelatedLogsProps } from "@/composables/useCorrelatedLogs";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import TenstackTable from "@/plugins/logs/TenstackTable.vue";
import DimensionFiltersBar from "./DimensionFiltersBar.vue";
import CorrelationEventHeader from "./CorrelationEventHeader.vue";
import { formatDate } from "@/utils/date";
import { copyToClipboard } from "@/utils/clipboard";
import type { ColumnDef } from "@tanstack/vue-table";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { byString } from "@/utils/json";
import { searchState } from "@/composables/useLogs/searchState";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

// Props
const props = defineProps<CorrelatedLogsProps>();

// Emits
const emit = defineEmits<{
  sendToAiChat: [value: any];
  addSearchTerm: [
    field: string | number,
    fieldValue: string | number | boolean,
    action: string,
  ];
}>();

// Composables
const { t } = useI18n();
const store = useStore();
const router = useRouter();
const { searchObj } = searchState();
const { loadKeyFields, semanticGroups } = useServiceCorrelation();

// Use correlated logs composable
const {
  loading,
  error,
  searchResults,
  pagedResults,
  totalHits,
  took,
  currentFilters,
  currentTimeRange,
  currentPage,
  totalPages,
  displayPageSize,
  logStreamsCount,
  hasResults,
  isLoading,
  hasError,
  isEmpty,
  fetchCorrelatedLogs,
  goToPage,
  updateFilter,
  updateFilters,
  resetFilters,
  refresh,
  isMatchedDimension,
  isAdditionalDimension,
} = useCorrelatedLogs(props);

// Stream name for JSON preview — use first correlated stream, or source stream
const jsonPreviewStreamName = computed(() => {
  if (props.logStreams && props.logStreams.length > 0) {
    return props.logStreams[0].stream_name;
  }
  if (props.sourceStream) {
    return props.sourceStream;
  }
  return '';
});

const TIMESTAMP_COL_WIDTH = 225;

// Component state
const wrapTableCells = ref(false);
const expandedRows = ref<any[]>([]);
const selectedFields = ref<any[]>([]);
const visibleColumns = ref<Set<string>>(new Set());
const columnOrder = ref<string[]>([]);
const defaultLogFields = ref<string[]>([]);
const draggedIndex = ref<number | null>(null);
const containerWidth = ref(window.innerWidth);

let isSaving = false; // Prevent recursive saves
let isUpdatingFromTable = false; // Prevent recursive updates from table

// Simple canvas context for width calculation
let canvasContext: CanvasRenderingContext2D | null = null;

// ResizeObserver for container-width tracking; isResizeObserverNeeded is set to false in
// onBeforeUnmount so the async onMounted continuation skips observer setup if the component
// has already been torn down.
let resizeObserver: ResizeObserver | null = null;
let isResizeObserverNeeded = true;

// Storage keys for persisting state
const STORAGE_KEY_COLUMNS = "correlatedLogs_visibleColumns";
const STORAGE_KEY_ORDER = "correlatedLogs_columnOrder";

// Load saved column state from localStorage
const loadColumnState = () => {
  try {
    const savedColumns = localStorage.getItem(STORAGE_KEY_COLUMNS);
    const savedOrder = localStorage.getItem(STORAGE_KEY_ORDER);

    if (savedColumns) {
      const parsed = JSON.parse(savedColumns);
      visibleColumns.value = new Set(parsed);
    }

    if (savedOrder) {
      columnOrder.value = JSON.parse(savedOrder);
    }
  } catch (error) {
    console.warn("[CorrelatedLogsTable] Failed to load column state:", error);
  }
};

// Save column state to localStorage
const saveColumnState = () => {
  try {
    localStorage.setItem(
      STORAGE_KEY_COLUMNS,
      JSON.stringify(Array.from(visibleColumns.value))
    );
    localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(columnOrder.value));
  } catch (error) {
    console.warn("[CorrelatedLogsTable] Failed to save column state:", error);
  }
};


// Load state and key fields config on component mount
onMounted(async () => {
  loadColumnState();
  try {
    const keyFieldsConfig = await loadKeyFields();
   let _defaultLogFields = keyFieldsConfig?.["logs"]?.fields ?? [];
   defaultLogFields.value = _defaultLogFields;
  } catch {
    defaultLogFields.value = [];
  }

  // Initialize canvas for width calculation
  try {
    const canvas = document.createElement("canvas");
    canvasContext = canvas.getContext("2d");
  } catch (error) {
    console.warn("Canvas not available, using default widths");
  }

  // Guard: component may have unmounted while awaiting loadKeyFields above.
  if (!isResizeObserverNeeded) return;

  // Track table container width for dynamic column cap
  const el = document.querySelector(".logs-table-container");
  if (el) {
    resizeObserver = new ResizeObserver(([entry]) => {
      containerWidth.value = entry.contentRect.width;
    });
    resizeObserver.observe(el);
  }
});

// Watch for changes and save to localStorage
watch(
  visibleColumns,
  () => {
    if (!isSaving) {
      saveColumnState();
    }
  },
  { deep: true }
);

watch(
  columnOrder,
  () => {
    if (!isSaving) {
      saveColumnState();
    }
  },
  { deep: true }
);

// Pending dimensions - for the apply button pattern
const pendingFilters = ref<Record<string, string>>({ ...currentFilters.value });

// Watch currentFilters to sync pendingFilters when filters are applied or reset
watch(
  currentFilters,
  (newFilters) => {
    pendingFilters.value = { ...newFilters };
  },
  { deep: true },
);

// Computed
const themeClass = computed(() =>
  store.state.theme === "dark" ? "dark-theme" : "light-theme",
);

const matchedDimensions = computed(() => props.matchedDimensions);
const additionalDimensions = computed(() => props.additionalDimensions || {});
const availableDimensions = computed(() => props.availableDimensions || {});
const ftsFields = computed(() => props.ftsFields || []);
const hideViewRelatedButton = computed(
  () => props.hideViewRelatedButton ?? false,
);
const hideSearchTermActions = computed(
  () => props.hideSearchTermActions ?? false,
);

// Combined dimensions for DimensionFiltersBar (merges matched and additional)
const allDimensions = computed(() => ({
  ...matchedDimensions.value,
  ...additionalDimensions.value,
}));

// Track which dimensions are unstable (for UI styling)
const unstableDimensionKeys = computed(
  () => new Set(Object.keys(additionalDimensions.value)),
);

// Track if there are pending changes that haven't been applied
const hasPendingChanges = computed(() => {
  const current = currentFilters.value;
  const pending = pendingFilters.value;

  const allKeys = new Set([...Object.keys(current), ...Object.keys(pending)]);
  for (const key of allKeys) {
    if (current[key] !== pending[key]) {
      return true;
    }
  }

  return false;
});

/**
 * Build highlight query from current filters for logs highlighting
 * Format: field1 = 'value1' AND field2 = 'value2'
 */
const highlightQuery = computed(() => {
  const conditions: string[] = [];

  for (const [field, value] of Object.entries(currentFilters.value)) {
    // Skip wildcard values
    if (value === SELECT_ALL_VALUE) {
      continue;
    }

    // Skip internal fields
    if (field.startsWith("_")) {
      continue;
    }

    // Skip null/undefined values
    if (value === null || value === undefined || value === "") {
      continue;
    }

    // Escape single quotes in values
    const escapedValue = String(value).replace(/'/g, "''");
    conditions.push(`${field} = '${escapedValue}'`);
  }

  return conditions.join(" and ").toLowerCase();
});

/**
 * Get filter options for a dimension
 * Returns the current value + wildcard option + original value
 */
const getFilterOptions = (
  key: string,
  currentValue: string,
): Array<{ label: string; value: string }> => {
  const uniqueValues = new Set<string>();

  // Always include wildcard option
  uniqueValues.add(SELECT_ALL_VALUE);

  // Get the original value from matched or additional dimensions
  const originalValue =
    matchedDimensions.value[key] || additionalDimensions.value[key];

  // Always include original value if it exists and is not SELECT_ALL_VALUE
  if (originalValue && originalValue !== SELECT_ALL_VALUE) {
    uniqueValues.add(originalValue);
  }

  // Include current value if it's different from original and SELECT_ALL_VALUE
  // This preserves previously selected values in the dropdown
  if (
    currentValue &&
    currentValue !== SELECT_ALL_VALUE &&
    currentValue !== originalValue
  ) {
    uniqueValues.add(currentValue);
  }

  // Add available dimension values if they exist
  if (availableDimensions.value[key]) {
    const dimensionValues = availableDimensions.value[key];
    if (Array.isArray(dimensionValues)) {
      dimensionValues.forEach((val: string) => {
        if (val !== null && val !== undefined && val !== "") {
          uniqueValues.add(val);
        }
      });
    }
  }

  // Convert to { label, value } format for q-select with map-options
  return Array.from(uniqueValues).map((val) => ({
    label: val === SELECT_ALL_VALUE ? "All Values" : val,
    value: val,
  }));
};

// Get all available fields from search results
const availableFields = computed(() => {
  if (!searchResults.value || searchResults.value.length === 0) {
    return [];
  }

  // Get all unique field names from results
  const fieldSet = new Set<string>();
  searchResults.value.forEach((row) => {
    Object.keys(row).forEach((key) => fieldSet.add(key));
  });

  return Array.from(fieldSet).sort((a, b) => {
    // Prioritize _timestamp first
    if (a === "_timestamp") return -1;
    if (b === "_timestamp") return 1;

    // Then matched dimensions
    const aIsMatched = isMatchedDimension(a);
    const bIsMatched = isMatchedDimension(b);
    if (aIsMatched && !bIsMatched) return -1;
    if (!aIsMatched && bIsMatched) return 1;

    // Then alphabetically
    return a.localeCompare(b);
  });
});

// Ordered fields based on user's drag-and-drop arrangement
const orderedFields = computed(() => {
  if (columnOrder.value.length === 0) {
    // Initialize order from availableFields
    return availableFields.value;
  }

  // Filter out fields that are no longer available and add new fields
  const currentFields = new Set(availableFields.value);
  const ordered = columnOrder.value.filter((field) => currentFields.has(field));

  // Add any new fields that aren't in the order yet
  availableFields.value.forEach((field) => {
    if (!ordered.includes(field)) {
      ordered.push(field);
    }
  });

  return ordered;
});

// Check if all columns (except timestamp) are selected
const areAllColumnsSelected = computed(() => {
  const selectableFields = availableFields.value.filter(
    (field) => field !== "_timestamp"
  );
  if (selectableFields.length === 0) return false;

  return selectableFields.every((field) => visibleColumns.value.has(field));
});

// Check if some columns are selected (for indeterminate state)
const areSomeColumnsSelected = computed(() => {
  const selectableFields = availableFields.value.filter(
    (field) => field !== "_timestamp"
  );
  if (selectableFields.length === 0) return false;

  return selectableFields.some((field) => visibleColumns.value.has(field));
});

// Initialize visibleColumns based on available fields and key fields config.
// Shows _timestamp + any key fields that exist in the data.
// Falls back to just _timestamp if no key fields match or key fields haven't loaded yet.
const initializeVisibleColumns = (fields: string[]) => {
  if (fields.length === 0) return;

  const defaults = new Set<string>();
  const timestampField = fields.find((f) => f === (store.state.zoConfig.timestamp_column || "_timestamp"));
  if (timestampField) defaults.add(timestampField);

  for (const keyField of defaultLogFields.value) {
    if (fields.includes(keyField)) defaults.add(keyField);
  }

  visibleColumns.value = defaults;
};

// Watch for new fields and initialize visibleColumns and columnOrder
watch(
  availableFields,
  (fields) => {
    if (fields.length === 0) return;
    
    // Added check for <=1 as _timestamp is also stored in localstorage, which is a bydefault column
    if(visibleColumns.value.size <= 1) initializeVisibleColumns(fields);

    // Initialize column order if not set
    if (columnOrder.value.length === 0) {
      columnOrder.value = [...fields];
    }
  },
  { immediate: true },
);

// If key fields load after availableFields, re-initialize to add matching key fields.
// Only overrides when user hasn't customized columns (empty or only _timestamp).
watch(defaultLogFields, (keyFields) => {
  if (keyFields.length === 0 || availableFields.value.length === 0) return;

  const isDefaultOrEmpty =
    visibleColumns.value.size === 0 ||
    (visibleColumns.value.size === 1 && visibleColumns.value.has("_timestamp"));

  if (!isDefaultOrEmpty) return;

  initializeVisibleColumns(availableFields.value);
});

// Filter out tw:hidden columns, respecting custom order
const visibleFields = computed(() => {
  return orderedFields.value.filter((field) =>
    visibleColumns.value.has(field),
  );
});

// Compute per-column max cap based on container width and number of visible columns.
// totalCols includes timestamp (+1). With only 2 columns (timestamp + 1 other) the
// other column can use all remaining width; with 3+ we reserve 20px for the scrollbar.
const columnMaxCap = computed(() => {
  const totalCols = visibleFields.value.length + 1;
  return totalCols <= 2
    ? Math.max(0, containerWidth.value - TIMESTAMP_COL_WIDTH)
    : Math.max(0, containerWidth.value - TIMESTAMP_COL_WIDTH - 30);
});

const DEFAULT_LONG_TEXT_FIELDS = [];

// Measures a field's content width and returns the capped size plus whether the
// raw measurement exceeded maxCap (used to build the dynamic long-text list).
const getColumnWidth = (
  field: string,
  maxCap: number,
): { width: number; exceededCap: boolean } => {
  if (field === "_timestamp" || field === "source") {
    return { width: 150, exceededCap: false };
  }

  if (!canvasContext) {
    return { width: 150, exceededCap: false };
  }

  try {
    // Font of table header
    canvasContext.font = "bold 14px sans-serif";
    let max = canvasContext.measureText(field).width + 16;

    // Font of the table content
    canvasContext.font = "12px monospace";

    const hits = searchResults.value || [];
    for (let i = 0; i < Math.min(5, hits.length); i++) {
      const cellValue = hits[i]?.[field];
      if (cellValue !== undefined && cellValue !== null && cellValue !== "") {
        const width = canvasContext.measureText(String(cellValue)).width;
        if (width > max) max = width;
      }
    }

    max += 24; // padding
    const exceededCap = max > maxCap;
    return { width: exceededCap ? maxCap : Math.max(150, max), exceededCap };
  } catch {
    return { width: 150, exceededCap: false };
  }
};

// Single computed that measures all visible fields in one canvas pass.
// Also builds the dynamic long-text list: any field whose raw measured width
// exceeds maxCap is added to the set (on top of the static defaults).
const memoizedData = computed(() => {
  const widthMap: Record<string, number> = {};
  const longText = new Set<string>(DEFAULT_LONG_TEXT_FIELDS);

  if (!searchResults.value || searchResults.value.length === 0) {
    return { widthMap, longTextFields: Array.from(longText) };
  }

  const maxCap = columnMaxCap.value;
  visibleFields.value.forEach((field) => {
    const { width, exceededCap } = getColumnWidth(field, maxCap);
    widthMap[field] = width;
    if (exceededCap) longText.add(field);
  });

  return { widthMap, longTextFields: Array.from(longText) };
});

const memoizedColumnWidths = computed(() => memoizedData.value.widthMap);

// Dynamic long-text fields: static defaults + any field whose content exceeded maxCap
const longTextFields = computed(() => memoizedData.value.longTextFields);

// Simple helper that uses memoized widths
const getColumnWidthHelper = (field: string): number => {
  return (
    memoizedColumnWidths.value[field] ||
    (longTextFields.value.includes(field) ? Math.min(400, columnMaxCap.value) : 150)
  );
};

// Generate table columns dynamically from visible fields in custom order
const tableColumns = computed<ColumnDef<any>[]>(() => {
  // Use the computed visibleFields
  const fields = visibleFields.value;

  // Check if only timestamp is visible - if so, add source column
  const hasOnlyTimestamp =
    fields.length === 1 && fields[0] === "_timestamp";

  const columns = fields.map((field) => {
    // Special handling for timestamp column
    if (field === "_timestamp") {
      return {
        name: field,
        id: field,
        accessorKey: field,
        label: t("search.timestamp") + ` (${store.state.timezone})`,
        header: t("search.timestamp") + ` (${store.state.timezone})`,
        align: "left",
        sortable: true,
        enableResizing: false,
        accessorFn: (row: any) => {
          const value = row[field];
          if (typeof value === "number") {
            return formatTimestamp(value);
          }
          return value !== null && value !== undefined ? String(value) : "";
        },
        cell: (info: any) => info.getValue(),
        prop: (row: any) => {
          const value = row[field];
          if (typeof value === "number") {
            return formatTimestamp(value);
          }
          return value !== null && value !== undefined ? String(value) : "";
        },
        size: TIMESTAMP_COL_WIDTH,
        meta: {
          closable: false,
          showWrap: false,
          wrapContent: false,
        },
      };
    }

    // Regular field columns
    return {
      name: field,
      id: field,
      accessorKey: field,
      header: field,
      align: "left",
      sortable: true,
      enableResizing: true,
      accessorFn: (row: any) => {
        return byString(row, field);
      },
      cell: (info: any) => info.getValue(),
      size: getColumnWidthHelper(field),
      maxSize: containerWidth.value,
      meta: {
        closable: true,
        showWrap: true,
        wrapContent: false,
      },
    };
  });

  // Add source column when only timestamp is visible
  if (hasOnlyTimestamp) {
    columns.push({
      name: "source",
      id: "source",
      accessorFn: (row: any) => JSON.stringify(row),
      cell: (info: any) => info.getValue(),
      header: t("search.source"),
      sortable: true,
      enableResizing: false,
      meta: {
        closable: false,
        showWrap: false,
        wrapContent: false,
      },
    } as any);
  }

  // Last-column fill: if total column widths leave unused horizontal space and the
  // last column is a long-text field, expand it to fill the remaining width.
  const totalWidth = columns.reduce((sum, col: any) => sum + (col.size ?? 150), 0);
  const lastCol = columns[columns.length - 1] as any;
  if (
    totalWidth < containerWidth.value &&
    lastCol &&
    longTextFields.value.includes(lastCol.name as string)
  ) {
    lastCol.size = Math.min(columnMaxCap.value, Math.max(150, (lastCol.size ?? 150) + (containerWidth.value - totalWidth)));
  }

  // Always leave 12px clearance on the last resizable column so the resize
  // handle stays visible and grabbable.
  const lastResizableCol = [...columns].reverse().find((col: any) => col.enableResizing) as any;
  if (lastResizableCol) {
    lastResizableCol.size = Math.max(150, (lastResizableCol.size ?? 150) - 12);
  }

  return columns;
});

// Determine if we're showing default columns (only timestamp + source)
const showingDefaultColumns = computed(() => {
  return visibleFields.value.length === 1 && visibleFields.value[0] === "_timestamp";
});

/**
 * Format timestamp (microsecond precision) to human-readable format
 */
const formatTimestamp = (timestamp: number): string => {
  // Convert microseconds to milliseconds
  const ms = Math.floor(timestamp / 1000);
  return formatDate(ms, "YYYY-MM-DD HH:mm:ss.SSS");
};

/**
 * Format time range for display
 */
const formatTimeRange = (range: {
  startTime: number;
  endTime: number;
}): string => {
  const start = formatTimestamp(range.startTime);
  const end = formatTimestamp(range.endTime);
  return `${start} - ${end}`;
};

// Compute selected fields from the columns
watch(
  tableColumns,
  (columns) => {
    selectedFields.value = columns.map((col: any) => ({
      name: col.name || col.id,
      type: "Utf8",
    })) as any;
  },
  { immediate: true },
);

/**
 * Event Handlers
 */
// Handle dimension update from DimensionFiltersBar - updates pending state only
const handleDimensionUpdate = ({
  key,
  value,
}: {
  key: string;
  value: string;
}) => {
  pendingFilters.value[key] = value;
};

// Apply pending filter changes
const handleApplyFilters = () => {
  // Update all filters at once using batch update (triggers single API call)
  updateFilters(pendingFilters.value);
};

const handleResetFilters = () => {
  resetFilters();
};

const handleRowClick = (row: any) => {
  console.log("[CorrelatedLogsTable] Row clicked:", row);
};

const handleCopy = (log: any, copyAsJson: boolean = true) => {
  const copyData = copyAsJson ? JSON.stringify(log) : log;
  copyToClipboard(copyData, {
    successMessage: "Content Copied Successfully!",
    timeout: 1000,
  });
};

const handleSendToAiChat = (value: any) => {
  emit("sendToAiChat", value);
};

const handleAddSearchTerm = (
  field: string | number,
  fieldValue: string | number | boolean,
  action: string,
) => {
  console.log("[CorrelatedLogsTable] Add search term:", {
    field,
    fieldValue,
    action,
  });
  emit("addSearchTerm", field, fieldValue, action);
};

const handleAddFieldToTable = (field: string) => {

  // Add the field to visible columns if it's not already visible
  if (!visibleColumns.value.has(field)) {
    visibleColumns.value.add(field);
    // Force reactivity by creating new Set
    visibleColumns.value = new Set(visibleColumns.value);

    // Show success notification
    toast({
      variant: "success",
      message: `Column "${field}" added to table`,
      timeout: 1500,
    });
  } else {
    // Field is already visible, show info notification
    toast({
      variant: "info",
      message: `Column "${field}" is already visible`,
      timeout: 1500,
    });
  }
};

const handleCloseColumn = (columnDef: any) => {
  const columnId = columnDef.id || columnDef.name;

  // Remove from visible columns
  if (columnId && visibleColumns.value.has(columnId)) {
    visibleColumns.value.delete(columnId);
    // Force reactivity by creating new Set
    visibleColumns.value = new Set(visibleColumns.value);
  }
};

const toggleColumnVisibility = (field: string) => {
  // Prevent hiding timestamp column
  if (field === "_timestamp") return;

  if (visibleColumns.value.has(field)) {
    visibleColumns.value.delete(field);
  } else {
    visibleColumns.value.add(field);
  }
  // Force reactivity by creating new Set
  visibleColumns.value = new Set(visibleColumns.value);
};

// Toggle all columns (select all / deselect all)
const toggleSelectAll = () => {
  const selectableFields = availableFields.value.filter(
    (field) => field !== "_timestamp"
  );

  if (areAllColumnsSelected.value) {
    // Deselect all (except timestamp)
    visibleColumns.value = new Set(["_timestamp"]);
  } else {
    // Select all
    visibleColumns.value = new Set(availableFields.value);
  }
};

// Handle column order change from TenstackTable drag-and-drop
const handleColumnOrderChange = (newOrder: string[]) => {
  // Prevent recursive calls
  if (isUpdatingFromTable) {
    return;
  }

  // Check if order actually changed to prevent recursive updates
  const currentOrder = JSON.stringify(columnOrder.value);
  const newOrderStr = JSON.stringify(newOrder);

  if (currentOrder === newOrderStr) {
    console.log("[CorrelatedLogsTable] Order unchanged, skipping update");
    return;
  }

  // Set flags to prevent recursive updates
  isUpdatingFromTable = true;
  isSaving = true;

  try {
    // Update columnOrder to match the new order from the table
    columnOrder.value = [...newOrder];

    // Manually save
    saveColumnState();
  } finally {
    // Always reset flags even if error occurs
    isSaving = false;
    // Use nextTick to ensure all reactive updates complete before allowing new updates
    setTimeout(() => {
      isUpdatingFromTable = false;
    }, 100);
  }
};

// Handle drag start for column reordering (dropdown)
const handleDragStart = (event: DragEvent, index: number) => {
  draggedIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
};

// Handle drop for column reordering
const handleDrop = (event: DragEvent, dropIndex: number) => {
  event.preventDefault();

  if (draggedIndex.value === null || draggedIndex.value === dropIndex) {
    draggedIndex.value = null;
    return;
  }

  // Reorder the columnOrder array
  const newOrder = [...columnOrder.value];
  const draggedField = newOrder[draggedIndex.value];
  newOrder.splice(draggedIndex.value, 1);
  newOrder.splice(dropIndex, 0, draggedField);

  columnOrder.value = newOrder;
  draggedIndex.value = null;
};

const handleExpandRow = (row: any) => {
  const index = expandedRows.value.findIndex((r) => r === row);
  if (index >= 0) {
    expandedRows.value.splice(index, 1);
  } else {
    expandedRows.value.push(row);
  }
};

const handleViewTrace = (log: any) => {
  // 15 mins +- from the log timestamp
  const from = log[store.state.zoConfig.timestamp_column] - 900000000;
  const to = log[store.state.zoConfig.timestamp_column] + 900000000;
  const refresh = 0;

  const query: any = {
    name: "traceDetails",
    query: {
      stream: searchObj.meta.selectedTraceStream,
      from,
      to,
      refresh,
      org_identifier: store.state.selectedOrganization.identifier,
      trace_id:
        log[
          store.state.organizationData.organizationSettings
            .trace_id_field_name
        ],
      reload: "true",
    },
  };

  query["span_id"] =
    log[
      store.state.organizationData.organizationSettings.span_id_field_name
    ];

  router.push(query);
};

const handleNestedCorrelation = (row: any) => {
  // Nested correlation is disabled (as per hideViewRelatedButton prop)
  console.log("[CorrelatedLogsTable] Nested correlation disabled");
};

// Lifecycle
onMounted(() => {
  // Fetch logs on mount
  fetchCorrelatedLogs();
});

onBeforeUnmount(() => {
  isResizeObserverNeeded = false;
  resizeObserver?.disconnect();
});

// Watch for prop changes
watch(
  () => props.timeRange,
  (newRange) => {
    console.log("[CorrelatedLogsTable] Time range changed:", newRange);
  },
  { deep: true },
);

// ── Chip row ───────────────────────────────────────────────────────────────

const LABEL_ACRONYMS = new Set([
  "aws", "ecs", "gcp", "iam", "vpc", "rds", "s3", "ec2",
  "id", "url", "uri", "ip", "dns", "ssl", "tls", "tcp", "udp",
  "api", "cpu", "gpu", "ram", "ssd", "hdd", "io",
  "k8s", "faas", "otel", "sql", "http", "https",
]);
const titleCaseWord = (w: string) => {
  if (!w) return w;
  if (LABEL_ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
  if (/^k8s$/i.test(w)) return "K8s";
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
};
const titleCase = (s: string) => s.split(/\s+/).map(titleCaseWord).join(" ");

const dimensionDisplayLabel = (key: string): string =>
  titleCase(key.replace(/[-_.]/g, " "));

const toChipString = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

const chipDimensionSource = computed<Record<string, string>>(() => {
  const src = props.chipDimensions && Object.keys(props.chipDimensions).length > 0
    ? props.chipDimensions
    : { ...(props.matchedDimensions ?? {}), ...(props.additionalDimensions ?? {}) };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    const s = toChipString(v);
    if (s !== null && s !== "" && s !== SELECT_ALL_VALUE) out[k] = s;
  }
  return out;
});

type ChipKind = "context" | "subject";
type DimensionChip = { key: string; label: string; value: string; kind: ChipKind; };

const subjectSemanticIds = computed<Set<string>>(() => {
  if (!props.matchedSetId) return new Set();
  const canonical = resolveSetId(props.matchedSetId);
  const specs = canonical ? SUBJECT_BUTTONS_BY_SET[canonical] : undefined;
  return specs?.length ? new Set(specs.flatMap((s: SubjectButton) => s.semanticIds)) : new Set();
});

const unifiedChips = computed<DimensionChip[]>(() =>
  Object.keys(chipDimensionSource.value)
    .filter((key) => !subjectSemanticIds.value.has(key))
    .map((key): DimensionChip => ({
      key,
      label: dimensionDisplayLabel(key),
      value: chipDimensionSource.value[key],
      kind: "context",
    })),
);

</script>

<style lang="scss" scoped>
.correlated-logs-table {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.correlation-controls {
  background-color: var(--o2-card-bg);
  border-bottom: 1px solid var(--o2-border-color);
}

.light-theme {
  background-color: var(--o2-bg-light);
  color: var(--o2-text-primary);
}

.dark-theme {
  background-color: var(--o2-bg-dark);
  color: var(--o2-text-primary-dark);
}

// Dimension dropdown styling (matches TelemetryCorrelationDashboard)
.dimension-dropdown {
  :deep(.q-field__control) {
    min-height: 2rem;
    padding: 0 0.5rem;
  }

  :deep(.q-field__native) {
    font-size: 0.875rem;
    padding: 0.25rem 0;
  }

  :deep(.q-field__append) {
    padding-left: 0.25rem;
  }
}

// Table skeleton container
[data-test="table-skeleton"] {
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

// Smooth transitions
.tw\:overflow-auto {
  scroll-behavior: smooth;
}


// Column visibility list styling
.column-visibility-list {
  max-height: 400px;
  overflow-y: auto;
  min-width: 250px;

  .column-item {
    cursor: grab;
    transition: background-color 0.2s ease;

    &:hover {
      background-color: var(--o2-hover-bg);
    }

    &.dragging {
      opacity: 0.5;
      cursor: grabbing;
    }

    .drag-handle {
      opacity: 0.4;
      transition: opacity 0.2s ease;
    }

    &:hover .drag-handle {
      opacity: 0.8;
    }
  }
}

// Responsive adjustments
@media (max-width: 768px) {
  .correlation-controls {
    padding: 0.5rem;
  }

  .tw\:flex-wrap {
    flex-direction: column;
    align-items: flex-start !important;
  }

  // Adjust skeleton for mobile
  [data-test="table-skeleton"] {
    .tw\:flex {
      flex-direction: column;
    }
  }
}

</style>

<style lang="scss">
.logs-table-container .container {
  height: 100% !important;
}
</style>
