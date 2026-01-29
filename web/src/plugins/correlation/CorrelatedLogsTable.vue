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

          <!-- Column Visibility Dropdown -->
          <div class="tw:pr-4">
            <q-btn-dropdown
              flat
              dense
              no-caps
              :label="t('search.showHideColumns')"
              icon="view_column"
              class="o2-secondary-button"
              data-test="column-visibility-dropdown"
              auto-close
              :disable="!hasResults"
            >
              <q-list class="column-visibility-list">
                <q-item
                  v-for="field in availableFields"
                  :key="field"
                  dense
                  clickable
                  @click="toggleColumnVisibility(field)"
                  :disable="field === '_timestamp'"
                >
                  <q-item-section avatar>
                    <q-checkbox
                      :model-value="visibleColumns.has(field)"
                      @update:model-value="toggleColumnVisibility(field)"
                      :disable="field === '_timestamp'"
                      dense
                    />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>{{ field }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </div>
        </div>
      </template>

      <!-- Show skeleton while loading -->
      <div v-else class="tw:flex tw:items-center tw:gap-3 tw:flex-wrap tw:p-3">
        <q-skeleton type="rect" width="200px" height="32px" />
        <q-skeleton type="rect" width="200px" height="32px" />
        <q-skeleton type="rect" width="200px" height="32px" />
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
          <q-skeleton
            v-else-if="isLoading"
            type="text"
            width="200px"
            height="14px"
          />
        </div>
      </div> -->
    </div>

    <!-- Main Content Area -->
    <div class="tw:flex-1 tw:overflow-hidden tw:relative">
      <!-- Logs Table or Skeleton -->
      <div class="tw:h-full tw:w-full tw:overflow-auto logs-table-container">
        <!-- Actual Table (when data is loaded) -->
        <TenstackTable
          v-if="hasResults"
          :rows="searchResults"
          :columns="tableColumns"
          :wrap="wrapTableCells"
          :loading="isLoading"
          :err-msg="''"
          :function-error-msg="''"
          :expanded-rows="expandedRows"
          :highlight-timestamp="-1"
          :default-columns="showingDefaultColumns"
          :jsonpreview-stream-name="primaryStream"
          :highlight-query="highlightQuery"
          :selected-stream-fts-keys="ftsFields"
          :selected-stream-fields="selectedFields"
          :hide-search-term-actions="hideSearchTermActions"
          :hide-view-related-button="hideViewRelatedButton"
          @click:dataRow="handleRowClick"
          @copy="handleCopy"
          @sendToAiChat="handleSendToAiChat"
          @addSearchTerm="handleAddSearchTerm"
          @addFieldToTable="handleAddFieldToTable"
          @closeColumn="handleCloseColumn"
          @expandRow="handleExpandRow"
          @show-correlation="handleNestedCorrelation"
          data-test="logs-tenstack-table"
        />

        <!-- Table Skeleton (initial load) -->
        <div
          v-else-if="isLoading && !hasError"
          class="tw:p-4"
          data-test="table-skeleton"
        >
          <!-- Table Header Skeleton -->
          <div
            class="tw:flex tw:gap-4 tw:mb-4 tw:pb-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]"
          >
            <q-skeleton type="text" width="12%" height="20px" />
            <q-skeleton type="text" width="15%" height="20px" />
            <q-skeleton type="text" width="40%" height="20px" />
            <q-skeleton type="text" width="10%" height="20px" />
            <q-skeleton type="text" width="10%" height="20px" />
          </div>

          <!-- Table Row Skeletons -->
          <div v-for="i in 8" :key="i" class="tw:mb-3">
            <div class="tw:flex tw:gap-4 tw:items-center">
              <q-skeleton type="text" width="12%" height="16px" />
              <q-skeleton type="text" width="15%" height="16px" />
              <q-skeleton type="text" width="40%" height="16px" />
              <q-skeleton type="text" width="10%" height="16px" />
              <q-skeleton type="text" width="10%" height="16px" />
            </div>
          </div>

          <!-- Loading indicator inside skeleton -->
          <div
            class="tw:flex tw:items-center tw:justify-center tw:mt-8 tw:gap-3"
          >
            <q-spinner color="primary" size="24px" />
            <span class="tw:text-sm tw:text-gray-600">
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
          <q-icon
            name="error_outline"
            size="3rem"
            color="negative"
            class="tw:mb-4"
          />
          <p class="tw:text-base tw:text-negative tw:font-medium tw:mb-2">
            {{ t("correlation.logs.error") }}
          </p>
          <p
            class="tw:text-sm tw:text-gray-600 tw:mb-4 tw:max-w-md tw:text-center"
          >
            {{ error }}
          </p>
          <q-btn
            class="o2-secondary-button"
            :label="t('common.retry')"
            icon="refresh"
            @click="handleRetry"
            data-test="retry-btn"
          />
        </div>

        <!-- Empty State -->
        <div
          v-else-if="isEmpty"
          class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          data-test="empty-state"
        >
          <q-icon
            name="search_off"
            size="3rem"
            color="grey-6"
            class="tw:mb-4"
          />
          <p class="tw:text-base tw:font-medium tw:text-gray-600 tw:mb-2">
            {{ t("correlation.logs.noData") }}
          </p>
          <p class="tw:text-sm tw:text-gray-500 tw:mb-4">
            {{ t("correlation.logs.noDataDetails") }}
          </p>
          <q-btn
            class="o2-secondary-button"
            :label="t('correlation.logs.resetFilters')"
            outline
            icon="restart_alt"
            @click="handleResetFilters"
            data-test="reset-filters-btn"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useCorrelatedLogs } from "@/composables/useCorrelatedLogs";
import type { CorrelatedLogsProps } from "@/composables/useCorrelatedLogs";
import TenstackTable from "@/plugins/logs/TenstackTable.vue";
import DimensionFiltersBar from "./DimensionFiltersBar.vue";
import { date, copyToClipboard, useQuasar } from "quasar";
import type { ColumnDef } from "@tanstack/vue-table";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { byString } from "@/utils/json";

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
const $q = useQuasar();

// Use correlated logs composable
const {
  loading,
  error,
  searchResults,
  totalHits,
  took,
  currentFilters,
  currentTimeRange,
  primaryStream,
  hasResults,
  isLoading,
  hasError,
  isEmpty,
  fetchCorrelatedLogs,
  updateFilter,
  updateFilters,
  resetFilters,
  refresh,
  isMatchedDimension,
  isAdditionalDimension,
} = useCorrelatedLogs(props);

// Component state
const wrapTableCells = ref(false);
const expandedRows = ref<any[]>([]);
const selectedFields = ref<any[]>([]);
const visibleColumns = ref<Set<string>>(new Set());

// Pending filters for the apply button pattern (tracks user changes before applying)
const pendingFilters = ref<Record<string, string>>({ ...currentFilters.value });

// Watch currentFilters to sync pendingFilters when filters are applied or reset
watch(
  currentFilters,
  (newFilters) => {
    pendingFilters.value = { ...newFilters };
  },
  { deep: true },
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
 * Returns the current value + wildcard option
 */
const getFilterOptions = (
  key: string,
  currentValue: string,
): Array<{ label: string; value: string }> => {
  const uniqueValues = new Set<string>();

  // Always include current value and wildcard
  if (currentValue) uniqueValues.add(currentValue);
  uniqueValues.add(SELECT_ALL_VALUE);

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

// Watch for new fields and initialize visibleColumns
// By default, only show timestamp (which will trigger source column display)
watch(
  availableFields,
  (fields) => {
    if (fields.length > 0 && visibleColumns.value.size === 0) {
      // Only show timestamp by default - this will display timestamp + source columns
      const timestampField = fields.find((f) => f === "_timestamp");
      if (timestampField) {
        visibleColumns.value = new Set([timestampField]);
      }
    }
  },
  { immediate: true },
);

// Generate table columns dynamically from visible fields
const tableColumns = computed<ColumnDef<any>[]>(() => {
  // Filter out hidden columns
  const visibleFields = availableFields.value.filter((field) =>
    visibleColumns.value.has(field),
  );

  // Check if only timestamp is visible - if so, add source column
  const hasOnlyTimestamp =
    visibleFields.length === 1 && visibleFields[0] === "_timestamp";

  const columns = visibleFields.map((field) => {
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
        size: 260,
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
      size: field === "message" ? 400 : 150,
      maxSize: window.innerWidth,
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

  return columns;
});

// Determine if we're showing default columns (only timestamp + source)
const showingDefaultColumns = computed(() => {
  const visibleFields = availableFields.value.filter((field) =>
    visibleColumns.value.has(field),
  );
  return visibleFields.length === 1 && visibleFields[0] === "_timestamp";
});

/**
 * Format timestamp (microsecond precision) to human-readable format
 */
const formatTimestamp = (timestamp: number): string => {
  // Convert microseconds to milliseconds
  const ms = Math.floor(timestamp / 1000);
  return date.formatDate(ms, "YYYY-MM-DD HH:mm:ss.SSS");
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
    selectedFields.value = columns.map((col) => ({
      name: col.name,
      type: "Utf8",
    }));
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
  console.log("[CorrelatedLogsTable] Pending filter changed:", {
    key,
    value,
    pending: pendingFilters.value,
  });
};

// Apply pending filter changes
const handleApplyFilters = () => {
  console.log("[CorrelatedLogsTable] Applying filters:", pendingFilters.value);
  // Update all filters at once using batch update (triggers single API call)
  updateFilters(pendingFilters.value);
};

const handleRefresh = () => {
  refresh();
};

const handleRetry = () => {
  refresh();
};

const handleResetFilters = () => {
  resetFilters();
};

const handleRowClick = (row: any) => {
  console.log("[CorrelatedLogsTable] Row clicked:", row);
};

const handleCopy = (log: any, copyAsJson: boolean = true) => {
  const copyData = copyAsJson ? JSON.stringify(log) : log;
  copyToClipboard(copyData).then(() =>
    $q.notify({
      type: "positive",
      message: "Content Copied Successfully!",
      timeout: 1000,
    })
  );
};

const handleSendToAiChat = (value: any) => {
  console.log("[CorrelatedLogsTable] Send to AI chat:", value);
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
  console.log("[CorrelatedLogsTable] Add field to table:", field);

  // Add the field to visible columns if it's not already visible
  if (!visibleColumns.value.has(field)) {
    visibleColumns.value.add(field);
    // Force reactivity by creating new Set
    visibleColumns.value = new Set(visibleColumns.value);

    // Show success notification
    $q.notify({
      type: "positive",
      message: `Column "${field}" added to table`,
      timeout: 1500,
    });
  } else {
    // Field is already visible, show info notification
    $q.notify({
      type: "info",
      message: `Column "${field}" is already visible`,
      timeout: 1500,
    });
  }
};

const handleCloseColumn = (columnDef: any) => {
  console.log("[CorrelatedLogsTable] Close column:", columnDef);
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

const handleCloseColumn = (columnDef: any) => {
  console.log("[CorrelatedLogsTable] Close column:", columnDef);
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

const handleCloseColumn = (columnDef: any) => {
  console.log("[CorrelatedLogsTable] Close column:", columnDef);
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

const handleExpandRow = (row: any) => {
  const index = expandedRows.value.findIndex((r) => r === row);
  if (index >= 0) {
    expandedRows.value.splice(index, 1);
  } else {
    expandedRows.value.push(row);
  }
};

const handleNestedCorrelation = (row: any) => {
  // Nested correlation is disabled (as per hideViewRelatedButton prop)
  console.log("[CorrelatedLogsTable] Nested correlation disabled");
};

// Lifecycle
onMounted(() => {
  console.log("[CorrelatedLogsTable] Component mounted with props:", {
    serviceName: props.serviceName,
    matchedDimensions: props.matchedDimensions,
    additionalDimensions: props.additionalDimensions,
    logStreams: props.logStreams,
    sourceStream: props.sourceStream,
    sourceType: props.sourceType,
    timeRange: props.timeRange,
    primaryStream: primaryStream.value,
  });

  // Fetch logs on mount
  fetchCorrelatedLogs();
});

// Watch for prop changes
watch(
  () => props.timeRange,
  (newRange) => {
    console.log("[CorrelatedLogsTable] Time range changed:", newRange);
  },
  { deep: true },
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

// Skeleton loading styles
:deep(.q-skeleton) {
  opacity: 0.7;
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
  height: calc(100vh - 170px) !important;
}
</style>
