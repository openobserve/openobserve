<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div>
    <div class="tw:px-[0.625rem] tw:py-[0.1rem]">
      <div class="card-container tw:mb-[0.625rem]">
        <!-- Header -->
        <div
          class="insights-header flex justify-between items-center"
        >
          <div class="flex items-center">
            <q-btn
              no-caps
              padding="xs"
              outline
              icon="arrow_back_ios_new"
              class="hideOnPrintMode el-border"
              @click="goBack"
              data-test="alert-insights-back-btn"
            />
            <div class="q-table__title tw:font-[600] q-ml-sm">{{ t("alerts.insights.title") }}</div>
          </div>

          <div class="flex items-center">
            <date-time
              ref="dateTimeRef"
              auto-apply
              :default-type="dateTimeType"
              :default-absolute-time="{
                startTime: timeRange.__global.start_time.getTime(),
                endTime: timeRange.__global.end_time.getTime(),
              }"
              :default-relative-time="relativeTime"
              @on:date-change="updateDateTime"
              @on:timezone-change="updateTimezone"
              class="datetime-picker"
              data-test="alert-insights-datetime"
            />

            <q-btn
              icon="refresh"
              @click="refreshDashboard"
              :loading="isLoading"
              class="q-mr-xs download-logs-btn q-px-sm element-box-shadow el-border"
              size="sm"
              data-test="alert-insights-refresh-btn"
            >
              <q-tooltip>{{ t("common.refresh") }}</q-tooltip>
            </q-btn>
          </div>
        </div>

        <!-- Tabs -->
        <q-tabs
          v-model="currentTab"
          dense
          class="alert-insights-tabs q-ml-sm"
          indicator-color="primary"
          align="left"
          data-test="alert-insights-tabs"
        >
          <q-tab name="overview" :label="t('alerts.insights.tabs.overview')" data-test="tab-overview" />
          <q-tab
            v-if="isEnterprise"
            name="frequency"
            :label="t('alerts.insights.tabs.frequency')"
            data-test="tab-frequency"
          />
          <q-tab
            v-if="isEnterprise"
            name="correlation"
            :label="t('alerts.insights.tabs.correlation')"
            data-test="tab-correlation"
          />
          <q-tab name="quality" :label="t('alerts.insights.tabs.quality')" data-test="tab-quality" />
        </q-tabs>

        <!-- Filters Section -->
        <div
          v-if="show"
          class="filters-section tw:flex tw:items-center tw:gap-2 tw:flex-wrap"
        >
          <span class="filter-label">{{ t("common.filters") }}:</span>

          <!-- Failed Only Toggle -->
          <q-toggle
            v-model="showFailedOnly"
            :label="t('alerts.insights.filters.failedOnly')"
            class="o2-toggle-button-sm"
            :class="store.state.theme === 'dark' ? 'o2-toggle-button-sm-dark' : 'o2-toggle-button-sm-light'"
            @update:model-value="onFilterChange"
            data-test="failed-only-toggle"
          >
            <q-tooltip>{{ t("alerts.insights.filters.failedOnlyTooltip") }}</q-tooltip>
          </q-toggle>

          <!-- Silenced Only Toggle -->
          <q-toggle
            v-model="showSilencedOnly"
            :label="t('alerts.insights.filters.silenced')"
            class="o2-toggle-button-sm"
            :class="store.state.theme === 'dark' ? 'o2-toggle-button-sm-dark' : 'o2-toggle-button-sm-light'"
            @update:model-value="onFilterChange"
            data-test="silenced-only-toggle"
          >
            <q-tooltip>{{ t("alerts.insights.filters.silencedTooltip") }}</q-tooltip>
          </q-toggle>

          <!-- Range Filter Chips -->
          <div
            v-for="[panelId, filter] in rangeFilters"
            :key="panelId"
            class="filter-chip tw:rounded tw:flex tw:items-center"
            :class="
              store.state.theme === 'dark'
                ? 'tw:bg-indigo-900 tw:text-indigo-100'
                : 'tw:bg-blue-100 tw:text-blue-800'
            "
            data-test="range-filter-chip"
          >
            <span class="chip-label">
              {{ filter.panelTitle }}
              <span v-if="filter.start !== null && filter.end !== null">
                {{ formatFilterValue(filter.start) }} -
                {{ formatFilterValue(filter.end) }}
              </span>
              <span v-else-if="filter.start !== null">
                >= {{ formatFilterValue(filter.start) }}
              </span>
              <span v-else-if="filter.end !== null">
                <= {{ formatFilterValue(filter.end) }}
              </span>
            </span>
            <q-icon
              name="close"
              class="chip-close-icon tw:cursor-pointer"
              @click="removeRangeFilter(panelId)"
            />
          </div>

          <!-- Clear All Filters -->
          <q-btn
            v-if="hasActiveFilters"
            flat
            dense
            size="sm"
            class="clear-filters-btn"
            :label="t('alerts.insights.filters.clearAll')"
            icon="clear"
            @click="clearAllFilters"
            data-test="clear-all-filters-btn"
          />
        </div>
      </div>
    </div>

    <!-- Action Buttons Row -->
    <div
      v-if="selectedAlertForAction"
      class="action-buttons-row tw:bg-primary tw:bg-opacity-10 tw:flex tw:items-center"
      data-test="action-buttons-row"
    >
      <q-icon name="campaign" color="primary" size="sm" />
      <span class="tw:text-sm tw:font-medium"
        >{{ t("alerts.insights.actions.actionsFor") }} <strong>{{ selectedAlertForAction }}</strong></span
      >

      <q-btn
        flat
        dense
        color="primary"
        icon="settings"
        :label="t('alerts.insights.actions.configureDedup')"
        @click="openDedupConfig"
        data-test="configure-dedup-btn"
      >
        <q-tooltip>{{ t("alerts.insights.actions.configureDedupTooltip") }}</q-tooltip>
      </q-btn>

      <q-btn
        flat
        dense
        color="primary"
        icon="edit"
        :label="t('alerts.insights.actions.editAlert')"
        @click="editAlert"
        data-test="edit-alert-btn"
      >
        <q-tooltip>{{ t("alerts.insights.actions.editAlertTooltip") }}</q-tooltip>
      </q-btn>

      <q-btn
        flat
        dense
        color="primary"
        icon="history"
        :label="t('alerts.insights.actions.viewHistory')"
        @click="viewHistory"
        data-test="view-history-btn"
      >
        <q-tooltip>{{ t("alerts.insights.actions.viewHistoryTooltip") }}</q-tooltip>
      </q-btn>

      <q-space />

      <q-btn
        flat
        dense
        round
        icon="close"
        @click="selectedAlertForAction = null"
        data-test="close-actions-btn"
      >
        <q-tooltip>Close actions</q-tooltip>
      </q-btn>
    </div>

    <!-- Dashboard Content -->
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem]">
      <div class="card-container tw:mb-[0.625rem] tw:h-[calc(100vh-208px)]">
        <div
          @contextmenu="handleNativeContextMenu"
        >
          <div v-show="isLoading" class="loading-container flex items-center justify-center">
            <q-spinner-hourglass color="primary" size="40px" />
            <div class="q-ml-md">Loading insights...</div>
          </div>

          <div :style="{ visibility: isLoading ? 'hidden' : 'visible' }">
            <div v-if="!dashboardData" class="loading-message">
              {{ t("alerts.insights.loading.dashboardConfig") }}
            </div>
            <div v-else-if="!show" class="loading-message">
              {{ t("alerts.insights.loading.refreshing") }}
            </div>
            <RenderDashboardCharts
              v-else
              :key="dashboardData.dashboardId + '-' + currentTab"
              ref="dashboardRef"
              :viewOnly="true"
              :dashboardData="dashboardData"
              :currentTimeObj="timeRange"
              :allowAlertCreation="false"
              searchType="dashboards"
              @updated:dataZoom="onDataZoom"
              @chart:contextmenu="handleChartContextMenu"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <AlertInsightsContextMenu
      v-if="contextMenu.show"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :value="contextMenu.value"
      :panel-title="contextMenu.panelTitle"
      :panel-id="contextMenu.panelId"
      @close="contextMenu.show = false"
      @filter="handleContextMenuFilter"
      @configure-dedup="handleConfigureDedup"
      @edit-alert="handleEditAlert"
      @view-history="handleViewHistory"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, reactive, provide } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import dateTime from "@/components/DateTimePickerDashboard.vue";
import AlertInsightsContextMenu from "./AlertInsightsContextMenu.vue";
import { useAlertInsights } from "@/composables/useAlertInsights";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import insightsConfig from "@/utils/alerts/insights-metrics.json";
import config from "@/aws-exports";
import alertsService from "@/services/alerts";

const router = useRouter();
const route = useRoute();
const store = useStore();
const $q = useQuasar();
const { t } = useI18n();

// Check if enterprise features are enabled
const isEnterprise = config.isEnterprise === "true";

// Composable
const {
  rangeFilters,
  showFailedOnly,
  showSilencedOnly,
  selectedAlertName,
  addRangeFilter,
  removeRangeFilter,
  clearAllFilters: clearFiltersFromComposable,
  getBaseFilters,
} = useAlertInsights();

// State
const show = ref(true);
const isLoading = ref(false);
const dashboardRef = ref(null);
const dateTimeRef = ref(null);
const currentTab = ref("overview");
const selectedAlertForAction = ref<string | null>(null);
const dashboardData = ref<any>(null); // Store dashboard config as ref instead of computed
const alertsList = ref<any[]>([]); // Cache alerts list

// Provide selectedTabId to RenderDashboardCharts
provide("selectedTabId", currentTab);

// Context menu
const contextMenu = reactive({
  show: false,
  x: 0,
  y: 0,
  value: 0,
  panelTitle: "",
  panelId: "",
});

// Date/Time
const dateTimeType = ref("relative");
const relativeTime = ref("24h");
const now = Date.now();
const oneDayAgo = now - 24 * 60 * 60 * 1000;
const timeRange = ref({
  __global: {
    start_time: new Date(oneDayAgo),
    end_time: new Date(now),
  },
});

// Computed
const hasActiveFilters = computed(() => {
  return (
    rangeFilters.value.size > 0 ||
    showFailedOnly.value ||
    showSilencedOnly.value ||
    selectedAlertName.value
  );
});

// Function to load dashboard data (replaces computed)
const loadDashboard = () => {
  // Deep clone to avoid mutating the original imported config
  const config = convertDashboardSchemaVersion(JSON.parse(JSON.stringify(insightsConfig)));
  const baseFilters = getBaseFilters();
  const org = store.state.selectedOrganization.identifier;

  // Find the current tab
  const currentTabData = config.tabs?.find(
    (tab: any) => tab.tabId === currentTab.value
  );

  if (!currentTabData) {
    dashboardData.value = config;
    return;
  }

  // Inject WHERE clause into all queries for the current tab
  if (currentTabData.panels) {
    currentTabData.panels = currentTabData.panels.map((panel: any) => {
      if (panel.queries?.[0]) {
        let query = panel.queries[0].query;

        // Build base filters that always apply
        // Note: module = 'alert' is now hardcoded in all queries in insights-metrics.json
        const mandatoryFilters = [
          `org = '${org}'`
        ];

        // Combine with user filters
        const allFilters = [...mandatoryFilters, ...baseFilters];

        // Build WHERE clause
        let whereClause = "";
        if (allFilters.length > 0) {
          whereClause = `WHERE ${allFilters.join(" AND ")}`;
        }

        // Replace placeholders
        query = query.replace(/\[WHERE_CLAUSE\]/g, whereClause);

        // Handle [WHERE_CLAUSE_ADDITIONAL] for queries that already have WHERE
        const additionalClause = allFilters.length > 0 ? `AND ${allFilters.join(" AND ")}` : "";
        query = query.replace(/\[WHERE_CLAUSE_ADDITIONAL\]/g, additionalClause);

        panel.queries[0].query = query;

        // Update stream to query "triggers"
        if (panel.queries[0].fields) {
          panel.queries[0].fields.stream = "triggers";
          panel.queries[0].fields.stream_type = "logs";
        }
      }
      return panel;
    });
  }

  const result = {
    ...config,
    tabs: [currentTabData],
  };

  dashboardData.value = result;
};

// Methods
const fetchAlerts = async () => {
  try {
    const res = await alertsService.listByFolderId(
      1,
      10000, // Fetch all alerts
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,//store.state.selectedOrganization.identifier,
      "", // Empty folder to get all alerts
      ""
    );
    alertsList.value = res.data.list || [];
  } catch (error) {
    $q.notify({
      type: "negative",
      message: "Failed to load alerts",
      timeout: 2000,
    });
  }
};

const goBack = () => {
  router.push({ name: "alertList", query: { org_identifier: store.state.selectedOrganization.identifier } });
};

const updateDateTime = (value: any) => {
  timeRange.value = {
    __global: {
      start_time: new Date(value.startTime ),
      end_time: new Date(value.endTime ),
    },
  };

  if (value.relativeTimePeriod) {
    dateTimeType.value = "relative";
    relativeTime.value = value.relativeTimePeriod;
  } else {
    dateTimeType.value = "absolute";
  }

  refreshDashboard();
};

const updateTimezone = (value: any) => {
  // Handle timezone changes if needed
  // Currently the date-time component manages timezone internally
  // This is here for compatibility with the logs date picker
};

const refreshDashboard = async () => {
  isLoading.value = true;
  show.value = false;
  loadDashboard(); // Rebuild dashboard config
  await nextTick();
  show.value = true;
  await nextTick();
  isLoading.value = false;
};

const onFilterChange = () => {
  refreshDashboard();
};

const clearAllFilters = () => {
  clearFiltersFromComposable();
  refreshDashboard();
};

const onDataZoom = (data: any) => {
  // Handle zoom on timeline
  const { panelId, start, end } = data;

  addRangeFilter({
    panelId,
    panelTitle: "Alert Volume Over Time",
    start,
    end,
  });

  refreshDashboard();
};

const handleNativeContextMenu = (event: MouseEvent) => {
  // Only handle context menu on Frequency & Dedup tab
  if (currentTab.value !== 'frequency') {
    return; // Let other handlers or default behavior work
  }

  const target = event.target as HTMLElement;

  // Find if we clicked on a table cell
  const tableCell = target.closest('td');
  if (!tableCell) {
    return; // Not a table cell, let default behavior work
  }

  // Get the text content of the cell (this is the alert key)
  const alertKey = tableCell.textContent?.trim();

  // Extract alert name (remove the /unique_id part)
  // Format: alert_name/unique_id -> alert_name
  const alertName = alertKey?.split('/')[0];

  // Check if this is the "Alert Key" column (first column in Dedup table)
  const cellIndex = Array.from(tableCell.parentElement?.children || []).indexOf(tableCell);

  // Only show context menu for the first column (Alert Key column)
  if (cellIndex === 0 && alertName && alertName.length > 0) {
    // ONLY prevent default if we're showing our custom menu
    event.preventDefault();
    event.stopPropagation();

    // Find the panel title from dashboard data
    const currentTabData = dashboardData.value?.tabs?.[0];
    const dedupPanel = currentTabData?.panels?.find((p: any) =>
      p.title?.includes('Dedup')
    );

    contextMenu.show = true;
    contextMenu.x = event.clientX;
    contextMenu.y = event.clientY;
    contextMenu.value = alertName;
    contextMenu.panelId = dedupPanel?.id || '';
    contextMenu.panelTitle = dedupPanel?.title || 'Dedup Impact Analysis';
  }
  // If not first column or no alert name, let default context menu show
};

const handleChartContextMenu = (event: any) => {
  const { x, y, value, panelId, panel } = event;

  // Only show context menu for alert name panels
  const alertNamePanels = [
    "Panel_Alert_Frequency",
    "Panel_Dedup_Impact",
    "Panel_Alert_Correlation",
    "Panel_Alert_Effectiveness",
    "Panel_Retry_Analysis",
    "Panel_Execution_Duration",
  ];

  // Only show context menu if it's an alert name panel with a string value
  if (typeof value === "string" && alertNamePanels.includes(panelId)) {
    contextMenu.show = true;
    contextMenu.x = x;
    contextMenu.y = y;
    contextMenu.value = value;
    contextMenu.panelId = panelId;
    contextMenu.panelTitle = panel?.title || "";
  }
};

const handleContextMenuFilter = (filter: any) => {
  addRangeFilter({
    panelId: filter.panelId,
    panelTitle: filter.panelTitle,
    start: filter.operator === ">=" ? filter.value : null,
    end: filter.operator === "<=" ? filter.value : null,
  });

  contextMenu.show = false;
  refreshDashboard();
};

const handleConfigureDedup = async (alertName: string) => {
  try {
    // Use cached alerts list
    const alert = alertsList.value.find((a: any) => a.name === alertName);

    if (!alert) {
      $q.notify({
        type: "negative",
        message: `Alert "${alertName}" not found in ${alertsList.value.length} alerts`,
        timeout: 3000,
      });
      return;
    }

    // Navigate to alert edit page with dedup section
    await router.push({
      name: "alertList",
      query: {
        action: "update",
        alert_id: alert.alert_id, // Use alert_id instead of id
        name: alert.name,
        org_identifier: store.state.selectedOrganization.identifier,
        folder: alert.folder_id || "default",
        section: "dedup",
      },
    });
  } catch (error) {
    $q.notify({
      type: "negative",
      message: "Failed to navigate to alert",
      timeout: 2000,
    });
  }
};

const handleEditAlert = async (alertName: string) => {
  try {
    // Use cached alerts list
    const alert = alertsList.value.find((a: any) => a.name === alertName);

    if (!alert) {
      $q.notify({
        type: "negative",
        message: "Alert not found",
        timeout: 2000,
      });
      return;
    }

    await router.push({
      name: "alertList",
      query: {
        action: "update",
        alert_id: alert.alert_id, // Use alert_id instead of id
        name: alert.name,
        org_identifier: store.state.selectedOrganization.identifier,
        folder: alert.folder_id || "default",
      },
    });
  } catch (error) {
    $q.notify({
      type: "negative",
      message: "Failed to navigate to alert",
      timeout: 2000,
    });
  }
};

const handleViewHistory = (alertName: string) => {
  router.push({
    name: "alertHistory",
    query: {
      alert_name: alertName,
    },
  });
};

const formatFilterValue = (value: number): string => {
  if (value > 1000000) {
    // Likely a timestamp
    return new Date(value / 1000).toLocaleString();
  }
  return Math.round(value).toLocaleString();
};

// Action button methods
const openDedupConfig = () => {
  $q.notify({
    type: "info",
    message: `Opening dedup configuration for: ${selectedAlertForAction.value}`,
    caption: "This would navigate to alert edit page with dedup section focused",
  });

  // TODO: Navigate to alert edit page with dedup section
  // router.push({
  //   name: 'alertEdit',
  //   params: { alertName: selectedAlertForAction.value },
  //   query: { section: 'dedup' }
  // });
};

const editAlert = () => {
  $q.notify({
    type: "info",
    message: `Editing alert: ${selectedAlertForAction.value}`,
    caption: "This would navigate to alert edit page",
  });

  // TODO: Navigate to alert edit page
  // router.push({
  //   name: 'alertEdit',
  //   params: { alertName: selectedAlertForAction.value }
  // });
};
const org = 'default'
const viewHistory = () => {
  // Navigate to alert history with filter
  router.push({
    name: "alertHistory",
    query: {
      alert_name: selectedAlertForAction.value,
    },
  });
};

// Watch for tab changes
watch(currentTab, async () => {
  isLoading.value = true;
  show.value = false;
  loadDashboard(); // Rebuild dashboard config for new tab
  await nextTick();
  show.value = true;
  await nextTick();
  await nextTick();
  window.dispatchEvent(new Event("resize"));
  isLoading.value = false;
});

// Lifecycle
onMounted(async () => {
  // Check if there's a tab in query params
  if (route.query.tab) {
    currentTab.value = route.query.tab as string;
  }

  // Fetch alerts list once on mount
  await fetchAlerts();

  // Load initial dashboard data
  loadDashboard();

  isLoading.value = true;
  await nextTick();
  await nextTick();
  isLoading.value = false;
});
</script>

<style scoped lang="scss">
.alert-insights-container {
  height: calc(100vh - 65px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.insights-header {
  padding: 0.5rem 1rem;
}

.back-btn {
  margin-right: 0.5rem;
}

.insights-title {
  font-size: 1.25rem;
  font-weight: 500;
}

.datetime-picker {
  margin-right: 0.5rem;
}

.alert-insights-tabs {
  :deep(.q-tab__label) {
    text-transform: none !important;
  }
}

.filters-section {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--q-border-color);
}

.filter-label {
  font-size: 0.875rem;
  font-weight: 600;
  position: relative;
  top: 4px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  cursor: default;

  .chip-close-icon {
    font-size: 0.875rem;
    margin-left: 0.5rem;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s;

    &:hover {
      opacity: 1;
    }
  }
}

.clear-filters-btn {
  margin-left: 0.5rem;
}

.action-buttons-row {
  padding: 0.75rem 1rem;
  gap: 0.75rem;
  border-bottom: 1px solid var(--q-border-color);
}

.dashboard-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.loading-container {
  height: 25rem;
}

.loading-message {
  padding: 1.25rem;
  text-align: center;
  color: #666;
}
</style>
