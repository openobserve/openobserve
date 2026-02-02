// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, reactive } from "vue";

interface RangeFilter {
  panelId: string;
  panelTitle: string;
  start: number | null;
  end: number | null;
}

interface AlertInsightsState {
  rangeFilters: Map<string, RangeFilter>;
  showFailedOnly: boolean;
  showSilencedOnly: boolean;
  selectedAlertName: string | null;
  selectedStatus: string | null;
}

const state = reactive<AlertInsightsState>({
  rangeFilters: new Map(),
  showFailedOnly: false,
  showSilencedOnly: false,
  selectedAlertName: null,
  selectedStatus: null,
});

export function useAlertInsights() {
  const rangeFilters = computed(() => state.rangeFilters);

  const showFailedOnly = computed({
    get: () => state.showFailedOnly,
    set: (value: boolean) => {
      state.showFailedOnly = value;
    },
  });

  const showSilencedOnly = computed({
    get: () => state.showSilencedOnly,
    set: (value: boolean) => {
      state.showSilencedOnly = value;
    },
  });

  const selectedAlertName = computed({
    get: () => state.selectedAlertName,
    set: (value: string | null) => {
      state.selectedAlertName = value;
    },
  });

  const selectedStatus = computed({
    get: () => state.selectedStatus,
    set: (value: string | null) => {
      state.selectedStatus = value;
    },
  });

  const addRangeFilter = (filter: RangeFilter) => {
    state.rangeFilters.set(filter.panelId, filter);
  };

  const removeRangeFilter = (panelId: string) => {
    state.rangeFilters.delete(panelId);
  };

  const clearAllFilters = () => {
    state.rangeFilters.clear();
    state.showFailedOnly = false;
    state.showSilencedOnly = false;
    state.selectedAlertName = null;
    state.selectedStatus = null;
  };

  const getBaseFilters = (): string[] => {
    const filters: string[] = [];

    // Range filters
    rangeFilters.value.forEach((filter) => {
      if (filter.panelTitle === "Alert Volume Over Time") {
        // Time-based filter from zoom
        if (filter.start !== null && filter.end !== null) {
          filters.push(
            `_timestamp >= ${filter.start} AND _timestamp <= ${filter.end}`
          );
        }
      } else if (
        filter.panelTitle === "Alert Frequency (Dedup Candidates)"
      ) {
        // Frequency threshold filter
        if (filter.start !== null) {
          // This creates a subquery to filter alerts by frequency
          // Note: This is a simplified version, actual implementation may need adjustment
          filters.push(`alert_name IN (
            SELECT alert_name
            FROM triggers
            GROUP BY alert_name
            HAVING COUNT(*) >= ${filter.start}
          )`);
        }
      } else if (filter.start !== null || filter.end !== null) {
        // Generic numeric filter for other panels
        if (filter.start !== null && filter.end !== null) {
          filters.push(
            `metric_value >= ${filter.start} AND metric_value <= ${filter.end}`
          );
        } else if (filter.start !== null) {
          filters.push(`metric_value >= ${filter.start}`);
        } else if (filter.end !== null) {
          filters.push(`metric_value <= ${filter.end}`);
        }
      }
    });

    // Toggle filters
    if (showFailedOnly.value) {
      filters.push("status = 'failed'");
    }

    if (showSilencedOnly.value) {
      filters.push("is_silenced = true");
    }

    // Alert name filter
    if (selectedAlertName.value) {
      filters.push(`alert_name = '${selectedAlertName.value}'`);
    }

    // Status filter
    if (selectedStatus.value) {
      filters.push(`status = '${selectedStatus.value}'`);
    }

    return filters;
  };

  return {
    rangeFilters,
    showFailedOnly,
    showSilencedOnly,
    selectedAlertName,
    selectedStatus,
    addRangeFilter,
    removeRangeFilter,
    clearAllFilters,
    getBaseFilters,
  };
}
