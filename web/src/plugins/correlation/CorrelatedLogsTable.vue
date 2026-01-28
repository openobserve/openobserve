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
      class="correlation-controls tw:p-3 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)]"
    >
      <!-- Dimension Filters - Inline Dropdowns -->
      <div class="tw:flex tw:items-center tw:gap-3 tw:flex-wrap tw:mb-3">
        <span class="tw:text-xs tw:font-semibold tw:opacity-70">
          {{ t('correlation.logs.filters') }}:
        </span>

        <!-- Show inline filters if loaded -->
        <template v-if="!isLoading || hasResults">
          <!-- Matched dimensions (stable) -->
          <div
            v-for="(value, key) in matchedDimensions"
            :key="`matched-${key}`"
            class="tw:flex tw:items-center tw:gap-2"
            :data-test="`filter-${key}`"
          >
            <span class="tw:text-xs tw:font-semibold tw:opacity-100">
              {{ key }}:
            </span>
            <q-select
              :model-value="currentFilters[key]"
              :options="getFilterOptions(key)"
              dense
              outlined
              borderless
              emit-value
              map-options
              class="dimension-dropdown"
              style="min-width: 120px"
              @update:model-value="(val) => handleFilterChange(key, val)"
              :data-test="`filter-select-${key}`"
            />
          </div>

          <!-- Additional dimensions (unstable) -->
          <div
            v-for="(value, key) in additionalDimensions"
            :key="`additional-${key}`"
            class="tw:flex tw:items-center tw:gap-2"
            :data-test="`filter-${key}`"
          >
            <span class="tw:text-xs tw:font-semibold tw:opacity-60">
              {{ key }}:
            </span>
            <q-select
              :model-value="currentFilters[key]"
              :options="getFilterOptions(key)"
              dense
              outlined
              borderless
              emit-value
              map-options
              class="dimension-dropdown"
              style="min-width: 120px"
              @update:model-value="(val) => handleFilterChange(key, val)"
              :data-test="`filter-select-${key}`"
            />
            <q-tooltip>
              {{ t('correlation.logs.unstableDimension') }}
            </q-tooltip>
          </div>
        </template>

        <!-- Show skeleton while loading -->
        <template v-else>
          <q-skeleton type="rect" width="200px" height="32px" />
          <q-skeleton type="rect" width="200px" height="32px" />
          <q-skeleton type="rect" width="200px" height="32px" />
        </template>
      </div>

      <!-- Action Buttons Row -->
      <div class="tw:flex tw:items-center tw:justify-between tw:gap-2">
        <!-- Left side: Results summary -->
        <div class="tw:text-xs tw:opacity-70" data-test="results-summary">
          <template v-if="hasResults && !isLoading">
            {{
              t('correlation.logs.resultsCount', {
                count: totalHits,
                stream: primaryStream,
                time: took,
              })
            }}
          </template>
          <q-skeleton v-else-if="isLoading" type="text" width="200px" height="14px" />
        </div>

        <!-- Right side: Action buttons -->
        <div class="tw:flex tw:items-center tw:gap-2">
          <q-btn
            flat
            dense
            no-caps
            :label="t('correlation.logs.resetFilters')"
            icon="restart_alt"
            class="o2-secondary-button"
            @click="handleResetFilters"
            :disable="isLoading && !hasResults"
            data-test="reset-filters-btn"
          />
          <q-btn
            flat
            dense
            no-caps
            :label="t('common.refresh')"
            icon="refresh"
            class="o2-secondary-button"
            @click="handleRefresh"
            :loading="isLoading"
            data-test="refresh-btn"
          />
        </div>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="tw:flex-1 tw:overflow-hidden tw:relative">
      <!-- Logs Table or Skeleton -->
      <div class="tw:h-full tw:w-full tw:overflow-auto">
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
          :default-columns="true"
          :jsonpreview-stream-name="primaryStream"
          :highlight-query="highlightQuery"
          :selected-stream-fts-keys="ftsFields"
          :selected-stream-fields="selectedFields"
          @click:dataRow="handleRowClick"
          @copy="handleCopy"
          @addSearchTerm="handleAddSearchTerm"
          @addFieldToTable="handleAddFieldToTable"
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
          <div class="tw:flex tw:gap-4 tw:mb-4 tw:pb-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]">
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
          <div class="tw:flex tw:items-center tw:justify-center tw:mt-8 tw:gap-3">
            <q-spinner color="primary" size="24px" />
            <span class="tw:text-sm tw:text-gray-600">
              {{ t('correlation.logs.loading') }}
            </span>
          </div>
        </div>

        <!-- Error State -->
        <div
          v-else-if="hasError"
          class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:py-20"
          data-test="error-state"
        >
          <q-icon name="error_outline" size="3rem" color="negative" class="tw:mb-4" />
          <p class="tw:text-base tw:text-negative tw:font-medium tw:mb-2">
            {{ t('correlation.logs.error') }}
          </p>
          <p class="tw:text-sm tw:text-gray-600 tw:mb-4 tw:max-w-md tw:text-center">
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
          <q-icon name="search_off" size="3rem" color="grey-6" class="tw:mb-4" />
          <p class="tw:text-base tw:font-medium tw:text-gray-600 tw:mb-2">
            {{ t('correlation.logs.noData') }}
          </p>
          <p class="tw:text-sm tw:text-gray-500 tw:mb-4">
            {{ t('correlation.logs.noDataDetails') }}
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
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import { useCorrelatedLogs } from '@/composables/useCorrelatedLogs';
import type { CorrelatedLogsProps } from '@/composables/useCorrelatedLogs';
import TenstackTable from '@/plugins/logs/TenstackTable.vue';
import { date } from 'quasar';
import type { ColumnDef } from '@tanstack/vue-table';
import { SELECT_ALL_VALUE } from '@/utils/dashboard/constants';

// Props
const props = defineProps<CorrelatedLogsProps>();

// Composables
const { t } = useI18n();
const store = useStore();

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
  resetFilters,
  refresh,
  isMatchedDimension,
  isAdditionalDimension,
} = useCorrelatedLogs(props);

// Component state
const wrapTableCells = ref(false);
const expandedRows = ref<any[]>([]);
const selectedFields = ref<any[]>([]);

// Computed
const themeClass = computed(() =>
  store.state.theme === 'dark' ? 'dark-theme' : 'light-theme'
);

const matchedDimensions = computed(() => props.matchedDimensions);
const additionalDimensions = computed(() => props.additionalDimensions || {});
const availableDimensions = computed(() => props.availableDimensions || {});
const ftsFields = computed(() => props.ftsFields || []);

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
    if (field.startsWith('_')) {
      continue;
    }

    // Skip null/undefined values
    if (value === null || value === undefined || value === '') {
      continue;
    }

    // Escape single quotes in values
    const escapedValue = String(value).replace(/'/g, "''");
    conditions.push(`${field} = '${escapedValue}'`);
  }

  return conditions.join(' and ').toLowerCase();
});

/**
 * Get filter options for a dimension
 * Returns the current value + wildcard option
 */
const getFilterOptions = (key: string): Array<{ label: string; value: string }> => {
  const currentValue = currentFilters.value[key];
  const uniqueValues = new Set<string>();

  // Always include current value and wildcard
  if (currentValue) uniqueValues.add(currentValue);
  uniqueValues.add(SELECT_ALL_VALUE);

  // Add available dimension values if they exist
  if (availableDimensions.value[key]) {
    const dimensionValues = availableDimensions.value[key];
    if (Array.isArray(dimensionValues)) {
      dimensionValues.forEach((val: string) => {
        if (val !== null && val !== undefined && val !== '') {
          uniqueValues.add(val);
        }
      });
    }
  }

  // Convert to { label, value } format for q-select with map-options
  return Array.from(uniqueValues).map(val => ({
    label: val === SELECT_ALL_VALUE ? 'All Values' : val,
    value: val
  }));
};

// Generate table columns dynamically from search results
const tableColumns = computed<ColumnDef<any>[]>(() => {
  if (!searchResults.value || searchResults.value.length === 0) {
    return [];
  }

  // Get all unique field names from results
  const fieldSet = new Set<string>();
  searchResults.value.forEach((row) => {
    Object.keys(row).forEach((key) => fieldSet.add(key));
  });

  const fields = Array.from(fieldSet).sort((a, b) => {
    // Prioritize _timestamp first
    if (a === '_timestamp') return -1;
    if (b === '_timestamp') return 1;

    // Then matched dimensions
    const aIsMatched = isMatchedDimension(a);
    const bIsMatched = isMatchedDimension(b);
    if (aIsMatched && !bIsMatched) return -1;
    if (!aIsMatched && bIsMatched) return 1;

    // Then alphabetically
    return a.localeCompare(b);
  });

  return fields.map((field) => ({
    id: field,
    accessorKey: field,
    header: field,
    size: field === '_timestamp' ? 180 : field === 'message' ? 400 : 150,
    cell: (info: any) => {
      const value = info.getValue();

      // Format timestamp
      if (field === '_timestamp' && typeof value === 'number') {
        return formatTimestamp(value);
      }

      // Return value as string
      return value !== null && value !== undefined ? String(value) : '';
    },
    meta: {
      closable: field !== '_timestamp', // Don't allow closing timestamp column
      showWrap: false,
    },
  }));
});

/**
 * Format timestamp (microsecond precision) to human-readable format
 */
const formatTimestamp = (timestamp: number): string => {
  // Convert microseconds to milliseconds
  const ms = Math.floor(timestamp / 1000);
  return date.formatDate(ms, 'YYYY-MM-DD HH:mm:ss.SSS');
};

/**
 * Format time range for display
 */
const formatTimeRange = (range: { startTime: number; endTime: number }): string => {
  const start = formatTimestamp(range.startTime);
  const end = formatTimestamp(range.endTime);
  return `${start} - ${end}`;
};

/**
 * Event Handlers
 */
const handleFilterChange = (key: string, value: string) => {
  console.log('[CorrelatedLogsTable] Filter changed:', { key, value });
  updateFilter(key, value);
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
  console.log('[CorrelatedLogsTable] Row clicked:', row);
};

const handleCopy = (data: any) => {
  console.log('[CorrelatedLogsTable] Copy:', data);
};

const handleAddSearchTerm = (data: any) => {
  console.log('[CorrelatedLogsTable] Add search term:', data);
};

const handleAddFieldToTable = (field: string) => {
  console.log('[CorrelatedLogsTable] Add field to table:', field);
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
  console.log('[CorrelatedLogsTable] Nested correlation disabled');
};

// Lifecycle
onMounted(() => {
  console.log('[CorrelatedLogsTable] Component mounted with props:', {
    serviceName: props.serviceName,
    matchedDimensions: props.matchedDimensions,
    additionalDimensions: props.additionalDimensions,
    logStreams: props.logStreams,
    sourceStream: props.sourceStream,
    sourceType: props.sourceType,
    timeRange: props.timeRange,
    primaryStream: primaryStream.value
  });

  // Fetch logs on mount
  fetchCorrelatedLogs();
});

// Watch for prop changes
watch(
  () => props.timeRange,
  (newRange) => {
    console.log('[CorrelatedLogsTable] Time range changed:', newRange);
  },
  { deep: true }
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
