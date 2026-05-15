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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div class="tw:rounded-md tw:h-full" :key="store.state.selectedOrganization.identifier">
    <div
      ref="fullscreenDiv"
      :class="{
        fullscreen: isFullscreen,
        'print-mode-container': store.state.printMode,
      }"
      :style="
        !store.state.printMode && !isFullscreen
          ? { height: 'calc(100vh - var(--navbar-height))' }
          : {}
      "
      class="tw:mx-[0.625rem] tw:flex tw:flex-col tw:overflow-hidden q-pt-xs"
    >
      <div
        :class="`${
          store.state.theme === 'light' ? 'bg-white' : 'dark-mode'
        } stickyHeader ${
          isFullscreen || store.state.printMode === true
            ? 'fullscreenHeader'
            : ''
        }`"
        class="tw:mb-[0.625rem]"
      >
        <div
          class="tw:flex justify-between items-center tw:w-full tw:px-[0.626rem] tw:min-w-0 card-container tw:h-[48px]"
        >
          <div class="tw:flex tw:flex-1 tw:overflow-hidden">
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-xs"
              @click="goBackToDashboardList"
              data-test="dashboard-back-btn"
            >
              <template #icon-left
                ><q-icon name="arrow_back_ios_new"
              /></template>
            </OButton>
            <span
              class="q-table__title folder-name tw:px-2 tw:cursor-pointer tw:transition-all tw:rounded-sm tw:ml-2"
              data-test="dashboard-view-folder-breadcrumb"
              @click="goBackToDashboardList"
              >{{ folderNameFromFolderId }}
            </span>
            <q-spinner-dots
              v-if="!store.state.organizationData.folders.length"
              color="primary"
              size="2em"
            />
            <q-icon
              class="q-table__title tw:text-gray-400 tw:mt-1"
              name="chevron_right"
            ></q-icon>
            <span
              class="q-table__title q-mx-sm tw:truncate tw:flex-1"
              :title="currentDashboardData.data?.title"
            >
              {{ currentDashboardData.data?.title }}
            </span>
          </div>
          <div class="tw:flex tw:gap-2 tw:items-center">
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-xs"
              @click="addPanelData"
              data-test="dashboard-panel-add"
            >
              <template #icon-left><q-icon name="add" /></template>
              <q-tooltip>{{ t("panel.add") }}</q-tooltip>
            </OButton>
            <!-- <DateTimePicker 
            class="q-ml-sm"
            ref="refDateTime"
            v-model="selectedDate"
          /> -->
            <!-- for Print Mode -->
            <!-- if time is relative, show start and end time -->
            <!-- format: YYYY/MM/DD HH:mm - YYYY/MM/DD HH:mm (TIMEZONE) -->
            <div
              v-if="
                store.state.printMode === true &&
                currentTimeObj.start_time &&
                currentTimeObj.end_time
              "
              style="padding-top: 5px"
            >
              {{ timeString }} ({{ store.state.timezone }})
            </div>
            <!-- do not show date time picker for print mode -->
            <DateTimePickerDashboard
              v-if="selectedDate"
              v-show="store.state.printMode === false"
              ref="dateTimePicker"
              class="dashboard-icons"
              size="sm"
              v-model="selectedDate"
              :initialTimezone="initialTimezone"
              :disable="arePanelsLoading"
              @hide="setTimeForVariables"
              data-test="dashboard-global-date-time-picker"
            />
            <AutoRefreshInterval
              v-model="refreshInterval"
              trigger
              :min-refresh-interval="
                store.state?.zoConfig?.min_auto_refresh_interval || 5
              "
              @trigger="refreshData"
              class="dashboard-icons hideOnPrintMode"
              style="padding-left: 0px; padding-right: 0px"
              size="sm"
            />
            <OButton
              v-if="config.isEnterprise == 'true' && arePanelsLoading"
              v-show="store.state.printMode !== true"
              variant="outline-destructive"
              size="icon-xs"
              @click="cancelQuery"
              data-test="dashboard-cancel-btn"
            >
              <template #icon-left><q-icon name="cancel" /></template>
              <q-tooltip>{{ t("panel.cancel") }}</q-tooltip>
            </OButton>
            <OButton
              v-else
              v-show="store.state.printMode !== true"
              :variant="isVariablesChanged ? 'warning' : 'outline'"
              size="icon-xs"
              @click="refreshData"
              :disabled="arePanelsLoading"
              :loading="arePanelsLoading"
              data-test="dashboard-refresh-btn"
            >
              <template #icon-left><q-icon name="refresh" /></template>
              <q-tooltip>
                {{
                  isVariablesChanged
                    ? "Refresh to apply latest variable changes"
                    : "Refresh"
                }}
              </q-tooltip>
            </OButton>

            <ExportDashboard
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              :dashboardId="currentDashboardData.data?.dashboardId"
            />
            <share-button
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              :url="dashboardShareURL"
              variant="outline"
              size="icon-xs"
              data-test="dashboard-share-btn"
            />
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-xs"
              data-test="dashboard-setting-btn"
              @click="openSettingsDialog"
            >
              <template #icon-left><q-icon name="settings" /></template>
              <q-tooltip>{{ t("dashboard.setting") }}</q-tooltip>
            </OButton>
            <OButton
              variant="outline"
              size="icon-xs"
              @click="printDashboard"
              data-test="dashboard-print-btn"
            >
              <template #icon-left
                ><q-icon
                  :name="store.state.printMode === true ? 'close' : 'print'"
              /></template>
              <q-tooltip>{{
                store.state.printMode === true
                  ? t("common.close")
                  : t("dashboard.print")
              }}</q-tooltip>
            </OButton>
            <OButton
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-xs"
              @click="toggleFullscreen"
              data-test="dashboard-fullscreen-btn"
            >
              <template #icon-left
                ><q-icon
                  :name="
                    quasar.fullscreen.isActive
                      ? 'fullscreen_exit'
                      : 'fullscreen'
                  "
              /></template>
              <q-tooltip>{{
                quasar.fullscreen.isActive
                  ? t("dashboard.exitFullscreen")
                  : t("dashboard.fullscreen")
              }}</q-tooltip>
            </OButton>
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-xs"
              @click="openScheduledReports"
              data-test="view-dashboard-scheduled-reports"
            >
              <template #icon-left
                ><q-icon :name="outlinedDescription"
              /></template>
              <q-tooltip>{{ t("dashboard.scheduledDashboards") }}</q-tooltip>
            </OButton>
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-xs"
              data-test="dashboard-json-edit-btn"
              @click="openJsonEditor"
            >
              <template #icon-left><q-icon name="code" /></template>
              <q-tooltip>{{ t("dashboard.editJson") }}</q-tooltip>
            </OButton>
          </div>
        </div>
        <q-separator></q-separator>
      </div>

      <RenderDashboardCharts
        :class="store.state.printMode ? '' : 'tw:flex-1 tw:min-h-0'"
        :key="
          currentDashboardData.data?.dashboardId + '-' + dashboardRemountKey
        "
        v-if="selectedDate"
        ref="renderDashboardChartsRef"
        @variablesData="variablesDataUpdated"
        @refreshedVariablesDataUpdated="refreshedVariablesDataUpdated"
        @variablesManagerReady="onVariablesManagerReady"
        :initialVariableValues="initialVariableValues"
        :viewOnly="store.state.printMode"
        :dashboardData="currentDashboardData.data"
        :folderId="route.query.folder"
        :reportId="reportId"
        :currentTimeObj="currentTimeObjPerPanel"
        :shouldRefreshWithoutCacheObj="shouldRefreshWithoutCachePerPanel"
        :dashboardName="currentDashboardData.data?.title"
        :folderName="folderNameFromFolderId"
        :selectedDateForViewPanel="selectedDate"
        :allowAlertCreation="true"
        @onDeletePanel="onDeletePanel"
        @onMovePanel="onMovePanel"
        @updated:data-zoom="onDataZoom"
        @refresh="loadDashboard"
        @refreshPanelRequest="refreshPanelRequest"
        @openEditLayout="openLayoutConfig"
        :showTabs="true"
        :forceLoad="store.state.printMode"
        :searchType="searchType"
        :showLegendsButton="true"
        @panelsValues="handleEmittedData"
        @searchRequestTraceIds="searchRequestTraceIds"
        :runId="runId"
        @update:runId="updateRunId"
      />

      <DashboardSettings
        v-model:open="showDashboardSettingsDialog"
        @refresh="loadDashboard"
        @close="showDashboardSettingsDialog = false"
      />

      <PanelLayoutSettings
        v-if="selectedPanelConfig.data"
        v-model:open="selectedPanelConfig.show"
        :layout="selectedPanelConfig.data.layout"
        @save:layout="savePanelLayout"
        @close="selectedPanelConfig.show = false"
      />

      <ScheduledDashboards
        v-model:open="showScheduledReportsDialog"
        :reports="scheduledReports"
        :loading="isLoadingReports"
        :folderId="folderId"
        :dashboardId="dashboardId"
        :tabId="tabId"
        :tabs="currentDashboardData?.data?.tabs || []"
      />

      <DashboardJsonEditor
        v-model:open="showJsonEditorDialog"
        :dashboard-data="currentDashboardData.data"
        :save-json-dashboard="saveJsonDashboard"
      />
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  watch,
  onActivated,
  nextTick,
  provide,
  defineAsyncComponent,
  reactive,
  onMounted,
  onUnmounted,
  onBeforeMount,
  computed,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShareButton from "@/components/common/ShareButton.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import { useRouter } from "vue-router";
import {
  getDashboard,
  movePanelToAnotherTab,
  getFoldersList,
} from "../../utils/commons.ts";
import {
  parseDuration,
  generateDurationLabel,
  getConsumableRelativeTime,
} from "../../utils/date";
import { useRoute } from "vue-router";
import { deletePanel } from "../../utils/commons";
import {
  getPanelTimeFromURL,
  convertPanelTimeRangeToPicker,
} from "@/utils/dashboard/panelTimeUtils";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import ExportDashboard from "@/components/dashboards/ExportDashboard.vue";
import RenderDashboardCharts from "./RenderDashboardCharts.vue";
import { copyToClipboard, useQuasar } from "quasar";
import useNotifications from "@/composables/useNotifications";
import reports from "@/services/reports";
import destination from "@/services/alert_destination.js";
import { outlinedDescription } from "@quasar/extras/material-icons-outlined";
import config from "@/aws-exports";
import queryService from "../../services/search";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import PanelLayoutSettings from "./PanelLayoutSettings.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useLoading } from "@/composables/useLoading";
import shortURLService from "@/services/short_url";
import { isEqual } from "lodash-es";
import { panelIdToBeRefreshed } from "@/utils/dashboard/convertCustomChartData";
import { getUUID } from "@/utils/zincutils";
import {
  createDashboardsContextProvider,
  contextRegistry,
} from "@/composables/contextProviders";
import { hasPanelTime } from "@/utils/dashboard/panelTimeUtils";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";
import type { AiDashboardEvent } from "@/composables/useAiDashboardEvents";

const DashboardJsonEditor = defineAsyncComponent(() => {
  return import("./DashboardJsonEditor.vue");
});

const DashboardSettings = defineAsyncComponent(() => {
  return import("./DashboardSettings.vue");
});

const ScheduledDashboards = defineAsyncComponent(() => {
  return import("./ScheduledDashboards.vue");
});

export default defineComponent({
  name: "ViewDashboard",
  emits: ["onDeletePanel"],
  components: {
    DateTimePickerDashboard,
    ShareButton,
    AutoRefreshInterval,
    ExportDashboard,
    DashboardSettings,
    RenderDashboardCharts,
    ScheduledDashboards,
    PanelLayoutSettings,
    DashboardJsonEditor,
    OButton,
  },
  setup() {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const quasar = useQuasar();
    const currentDashboardData = reactive({
      data: {},
    });
    const showScheduledReportsDialog = ref(false);
    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();

    // Variables manager will be initialized by RenderDashboardCharts
    // and we'll receive a reference to it via the @variablesManagerReady event
    const variablesManager = ref(null);

    let moment: any = () => {};

    const folderNameFromFolderId = computed(() => {
      if (store.state.organizationData.folders.length === 0) {
        return "";
      }
      return (
        store.state.organizationData.folders.find(
          (item: any) => item.folderId === (route.query.folder ?? "default"),
        )?.name ?? "default"
      );
    });

    const importMoment = async () => {
      const momentModule: any = await import("moment-timezone");
      moment = momentModule.default;
    };

    const scheduledReports = ref([]);
    const isLoadingReports = ref(false);

    const dashboardId = computed(() => route.query.dashboard);

    const folderId = computed(() => route.query.folder);

    const tabId = computed(() => route.query.tab);

    const reportId = computed(() => route.query.tab);

    const renderDashboardChartsRef = ref(null);

    // Initialize dashboard run ID management
    const runId = ref(getUUID().replace(/-/g, ""));

    const generateNewDashboardRunId = () => {
      runId.value = getUUID().replace(/-/g, "");
      return runId.value;
    };

    onBeforeMount(async () => {
      await importMoment();
      setTimeString();
    });

    // [START] date picker related variables --------

    /**
     * Retrieves the selected date from the query parameters.
     */
    const getSelectedDateFromQueryParams = (params) => ({
      valueType: params.period
        ? "relative"
        : params.from && params.to
          ? "absolute"
          : "relative",
      startTime: params.from ? params.from : null,
      endTime: params.to ? params.to : null,
      relativeTimePeriod: params.period ? params.period : "15m",
    });

    const setTimeForVariables = () => {
      if (selectedDate.value && dateTimePicker.value) {
        const date = dateTimePicker.value?.getConsumableDateTime();
        const startTime = new Date(date.startTime);
        const endTime = new Date(date.endTime);

        // Update only the variables time object
        currentTimeObjPerPanel.value = {
          ...currentTimeObjPerPanel.value,
          __variables: {
            start_time: startTime,
            end_time: endTime,
          },
        };
      }
    };

    const dateTimePicker = ref(null); // holds a reference to the date time picker

    // holds the date picker v-modal
    const selectedDate = ref(null);

    // holds the current time for the dashboard
    const currentTimeObj = ref({});

    // refresh interval v-model
    const refreshInterval = ref(0);

    // initial timezone, which will come from the route query
    const initialTimezone = ref(route.query.timezone ?? null);

    // search_type for search query
    const searchType = ref(route.query.searchtype ?? null);

    // dispatch setPrintMode, to set print mode
    const setPrint = (printMode: any) => {
      store.dispatch("setPrintMode", printMode);
    };

    const timeString = ref("");

    const printDashboard = () => {
      // set print mode as true
      setPrint(store.state.printMode != true);

      const query = {
        ...route.query,
        print: store.state.printMode,
      };

      // replace query params with print=true
      router.replace({ query });
    };

    // boolean to show/hide settings sidebar
    const showDashboardSettingsDialog = ref(false);

    const selectedPanelConfig = ref({
      data: null,
      show: false,
    });

    // selected tab
    const selectedTabId: any = ref(route.query.tab ?? null);
    // provide it to child components
    provide("selectedTabId", selectedTabId);

    // variables data
    const variablesData = reactive({});
    const refreshedVariablesData = reactive({}); // Flag to track if variables have changed

    const variablesDataUpdated = (data: any) => {
      // ONLY update the live variables data - DO NOT update URL
      // URL updates should happen ONLY after commitAll() is called (on refresh button click)
      // This follows the __global mechanism from the main branch design
      Object.assign(variablesData, data);

      // NOTE: URL sync has been moved to refreshData() after commitAll()
      // This ensures URL only reflects COMMITTED variable values, not live changes
    };

    const refreshedVariablesDataUpdated = (variablesData: any) => {
      Object.assign(refreshedVariablesData, variablesData);
    };

    // Handler for when variables manager is ready from RenderDashboardCharts
    const onVariablesManagerReady = async (manager: any) => {
      variablesManager.value = manager;

      // Immediately update URL with initial committed values
      // This handles variables that don't require loading (constant, textbox, custom_value)
      await nextTick();
      if (selectedDate.value && variablesManager.value) {
        updateUrlWithCurrentState();
      }
    };

    // Watch for changes to committed variables data
    // This will trigger URL updates when variables finish loading (auto-commit for query_values)
    watch(
      () => {
        if (!variablesManager.value) return null;
        // Watch the committed variables data deeply
        return JSON.stringify(variablesManager.value.committedVariablesData);
      },
      async () => {
        // When committed variables change, update the URL
        // Skip during same-dashboard drilldown to avoid clobbering drilldown var-* params
        if (isDrilldownInProgress.value) return;
        await nextTick();
        if (selectedDate.value && variablesManager.value) {
          updateUrlWithCurrentState();
        }
      },
    );

    const isVariablesChanged = computed(() => {
      // If using variables manager, access hasUncommittedChanges directly from the manager
      // Explicitly dereference to ensure Vue tracks the dependency
      const manager = variablesManager.value;

      if (manager && "hasUncommittedChanges" in manager) {
        // Access the value (Vue auto-unwraps computed refs in composable returns)
        const hasChanges = manager.hasUncommittedChanges;
        return hasChanges;
      }
      // Legacy mode: Convert both objects to a consistent format for comparison
      const normalizeVariables = (obj) => {
        const normalized = JSON.parse(JSON.stringify(obj));
        // Sort arrays to ensure consistent ordering
        if (normalized.values) {
          normalized.values = normalized.values
            .map((variable) => {
              if (Array.isArray(variable.value)) {
                variable.value.sort((a, b) =>
                  JSON.stringify(a).localeCompare(JSON.stringify(b)),
                );
              }
              return variable;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        }
        return normalized;
      };

      const normalizedCurrent = normalizeVariables(variablesData);
      const normalizedRefreshed = normalizeVariables(refreshedVariablesData);

      return !isEqual(normalizedCurrent, normalizedRefreshed);
    });
    // ======= [START] default variable values

    const initialVariableValues = reactive({
      value: {} as Record<string, any>,
    });
    Object.keys(route.query).forEach((key) => {
      if (key.startsWith("var-")) {
        const newKey = key.slice(4);
        initialVariableValues.value[newKey] = route.query[key];
      }
    });
    // ======= [END] default variable values

    onMounted(async () => {
      await loadDashboard();
      if (!store.state.organizationData.folders.length) {
        await getFoldersList(store);
      }

      // Set up dashboard context provider
      const dashboardProvider = createDashboardsContextProvider(
        route,
        store,
        undefined,
        false,
        currentDashboardData,
      );
      contextRegistry.register("dashboards", dashboardProvider);
      contextRegistry.setActive("dashboards");

      // NEW: Compute panel times after dashboard loads
      // Wait for next tick to ensure dateTimePicker is initialized
      await nextTick();
      if (dateTimePicker.value) {
        computeAllPanelTimes();
      }
    });

    const setTimeString = () => {
      if (!moment()) return;
      timeString.value = ` ${moment(
        currentTimeObj.value?.start_time?.getTime() / 1000,
      )
        .tz(store.state.timezone)
        .format("YYYY/MM/DD HH:mm")}
              -
               ${moment(currentTimeObj.value?.end_time?.getTime() / 1000)
                 .tz(store.state.timezone)
                 .format("YYYY/MM/DD HH:mm")}

                  `;
    };

    // Guard flag: true while a cross-dashboard load is in progress.
    // Prevents updateUrlWithCurrentState() from overwriting the incoming tab ID.
    const isDashboardLoading = ref(false);

    // Guard flag: true while a same-dashboard drilldown is being processed.
    // Prevents updateUrlWithCurrentState() from clobbering drilldown var-* params
    // with stale committed variable values before the manager has been updated.
    const isDrilldownInProgress = ref(false);

    // Guard flag: true while updateUrlWithCurrentState is updating the URL.
    // Prevents the var-* watcher from re-triggering when the app itself syncs
    // variable params to the URL (e.g., after a normal dropdown change).
    const isInternalUrlUpdate = ref(false);

    const loadDashboard = async (onlyIfRequired = false) => {
      // check if drilldown or soft-refresh request
      if (onlyIfRequired) {
        // if current dashboard id and tab is same,  skip loading
        if (
          currentDashboardData?.data?.dashboardId === route.query.dashboard &&
          // check for tab
          selectedTabId.value === route.query.tab
        ) {
          // Even for same dashboard+tab, check if var-* params changed
          // This handles same-dashboard drilldown where variables are passed via URL
          const urlVarParams: Record<string, any> = {};
          Object.keys(route.query).forEach((key) => {
            if (key.startsWith("var-")) {
              urlVarParams[key.slice(4)] = route.query[key];
            }
          });

          const currentVarParams: Record<string, any> = {};
          Object.keys(initialVariableValues.value).forEach((name) => {
            currentVarParams[name] = initialVariableValues.value[name];
          });

          const sortedStringify = (obj: Record<string, any>) =>
            JSON.stringify(Object.fromEntries(Object.entries(obj).sort()));
          const hasVarChanges =
            sortedStringify(urlVarParams) !== sortedStringify(currentVarParams);

          if (!hasVarChanges) {
            return; // Truly nothing changed
          }
          // Fall through — variable values changed, need to re-apply
        }
      }

      let dashboard;
      try {
        dashboard = await getDashboard(
          store,
          route.query.dashboard,
          route.query.folder ?? "default",
        );

        if (
          !dashboard ||
          typeof dashboard !== "object" ||
          !Object.keys(dashboard).length
        ) {
          showErrorNotification(
            "Dashboard not found or has been deleted. Redirecting to dashboard list.",
          );
          goBackToDashboardList();
          return;
        }
      } catch (error: any) {
        showErrorNotification(
          error?.message ||
            "Failed to load dashboard. Redirecting to dashboard list.",
        );
        goBackToDashboardList();
        return;
      }

      // Set the dashboard data - RenderDashboardCharts will initialize the variables manager
      currentDashboardData.data = dashboard;

      // set selected tab from query params
      const selectedTab = dashboard?.tabs?.find(
        (tab: any) => tab.tabId === route.query.tab,
      );

      selectedTabId.value = selectedTab
        ? selectedTab.tabId
        : dashboard?.tabs?.[0]?.tabId;

      // if variables data is null, set it to empty list
      if (!(dashboard?.variables && dashboard?.variables?.list.length)) {
        variablesData.isVariablesLoading = false;
        variablesData.values = [];
        refreshedVariablesData.isVariablesLoading = false;
        refreshedVariablesData.values = [];
      }

      // check if route has time related query params
      // if not, take dashboard default time settings
      if (!((route.query.from && route.query.to) || route.query.period)) {
        // if dashboard has relative time settings
        if (
          (currentDashboardData.data?.defaultDatetimeDuration?.type ??
            "relative") === "relative"
        ) {
          selectedDate.value = {
            valueType: "relative",
            relativeTimePeriod:
              currentDashboardData.data?.defaultDatetimeDuration
                ?.relativeTimePeriod ?? "15m",
          };
        } else {
          // else, dashboard will have absolute time settings
          selectedDate.value = {
            valueType: "absolute",
            startTime:
              currentDashboardData.data?.defaultDatetimeDuration?.startTime,
            endTime:
              currentDashboardData.data?.defaultDatetimeDuration?.endTime,
          };
        }
      } else {
        // take route time related query params
        selectedDate.value = getSelectedDateFromQueryParams(route.query);
      }
    };

    // [START] cancel running queries

    const arePanelsLoading = ref(false);

    const handleEmittedData = (allPanelsLoaded) => {
      arePanelsLoading.value = !allPanelsLoaded;
    };

    const { traceIdRef, searchRequestTraceIds, cancelQuery } = useCancelQuery();

    // [END] cancel running queries

    const openSettingsDialog = () => {
      showDashboardSettingsDialog.value = true;
    };

    const openLayoutConfig = (id: string) => {
      selectedPanelConfig.value.show = true;

      const panelData = getPanelFromTab(selectedTabId.value, id);

      if (!panelData) {
        return;
      }

      selectedPanelConfig.value.data = JSON.parse(JSON.stringify(panelData));
    };

    const savePanelLayout = async (layout) => {
      const panel = getPanelFromTab(
        selectedTabId.value,
        selectedPanelConfig.value.data.id,
      );
      if (panel) panel.layout = layout;

      selectedPanelConfig.value.show = false;
      selectedPanelConfig.value.data = null;

      await nextTick();

      window.dispatchEvent(new Event("resize"));

      await renderDashboardChartsRef?.value?.saveDashboardData?.execute?.();
    };

    // ===== Panel Time Configuration (NEW FEATURE) =====

    // Helper: Convert picker format to time object
    const convertPickerToTimeObj = (pickerValue: any) => {
      if (!pickerValue) return null;

      if (
        pickerValue.valueType === "relative" &&
        pickerValue.relativeTimePeriod
      ) {
        const result = getConsumableRelativeTime(
          pickerValue.relativeTimePeriod,
        );
        if (result) {
          return {
            start_time: new Date(result.startTime),
            end_time: new Date(result.endTime),
          };
        }
      } else if (pickerValue.valueType === "absolute") {
        return {
          start_time: new Date(pickerValue.startTime),
          end_time: new Date(pickerValue.endTime),
        };
      }

      return null;
    };

    // Compute effective time for a specific panel (v4.0)
    // Priority: 1. URL params (highest) → 2. panel_time_range → 3. global time AS-IS
    const computePanelTime = (panel: any, globalTime: any) => {
      if (!panel) return globalTime;

      // Priority 1: Check URL params for this panel (highest priority)
      // URL params always win, even if panel_time_range is null
      const urlPanelTime = getPanelTimeFromURL(panel.id, route.query);
      if (urlPanelTime) {
        return convertPickerToTimeObj(urlPanelTime);
      }

      // Priority 2: Use panel's configured time range (if set)
      if (panel.config?.panel_time_range) {
        const pickerValue = convertPanelTimeRangeToPicker(
          panel.config.panel_time_range,
        );
        if (pickerValue) {
          return convertPickerToTimeObj(pickerValue);
        }
      }

      // Priority 3: No custom time → use global time AS-IS (no conversion)
      return globalTime;
    };

    // Compute time for a single specific panel (for panel-level refresh)
    const computeSinglePanelTime = (panelId: string) => {
      if (!currentDashboardData.data?.tabs || !dateTimePicker.value) {
        return;
      }

      // Find the panel across all tabs
      let targetPanel: any = null;
      for (const tab of currentDashboardData.data.tabs) {
        const found = tab.panels?.find((p: any) => p.id === panelId);
        if (found) {
          targetPanel = found;
          break;
        }
      }

      if (!targetPanel) {
        return;
      }

      const globalTime = {
        start_time: new Date(
          dateTimePicker.value.getConsumableDateTime().startTime,
        ),
        end_time: new Date(
          dateTimePicker.value.getConsumableDateTime().endTime,
        ),
      };

      // Check if panel has its own time configuration
      if (hasPanelTime(targetPanel)) {
        // Panel has panel-level time - only update this specific panel's time
        // DO NOT update __global to avoid triggering refreshes in other panels
        const effectiveTime = computePanelTime(targetPanel, globalTime);
        if (effectiveTime) {
          // CRITICAL: Update only this panel's time property, don't replace entire object
          currentTimeObjPerPanel.value[panelId] = effectiveTime;
        }
      } else {
        // Panel depends on global time
        // Create a panel-specific time entry (even though it normally uses __global)
        // This allows refreshing ONLY this panel without affecting other global-dependent panels
        // CRITICAL: Update only this panel's time property, don't replace entire object
        currentTimeObjPerPanel.value[panelId] = globalTime;
      }
    };

    // Helper: Check if two time objects are equal
    const areTimesEqual = (time1: any, time2: any) => {
      if (!time1 || !time2) return false;
      return (
        time1.start_time?.getTime() === time2.start_time?.getTime() &&
        time1.end_time?.getTime() === time2.end_time?.getTime()
      );
    };

    // Compute times for all panels in all tabs
    // @param forceRefresh - If true, always create new time objects to force all panels to refresh
    const computeAllPanelTimes = (forceRefresh = false) => {
      if (!currentDashboardData.data?.tabs || !dateTimePicker.value) {
        return;
      }

      const globalTime = {
        start_time: new Date(
          dateTimePicker.value.getConsumableDateTime().startTime,
        ),
        end_time: new Date(
          dateTimePicker.value.getConsumableDateTime().endTime,
        ),
      };

      // CRITICAL FIX: Preserve existing __global reference if time hasn't changed
      // This prevents unnecessary refreshes of panels that depend on global time
      const existingGlobalTime = currentTimeObjPerPanel.value.__global;
      const shouldUpdateGlobal =
        forceRefresh || !areTimesEqual(existingGlobalTime, globalTime);

      // Build the new panel times object
      const newPanelTimes: Record<string, any> = {
        __global: shouldUpdateGlobal ? globalTime : existingGlobalTime,
      };

      // For panels with panel-level time, compute and compare with existing
      currentDashboardData.data.tabs.forEach((tab: any) => {
        tab.panels?.forEach((panel: any) => {
          if (panel.id) {
            // Check if panel has its own time configuration
            if (hasPanelTime(panel)) {
              // Panel has its own time → compute it
              const effectiveTime = computePanelTime(panel, globalTime);
              if (effectiveTime) {
                if (forceRefresh) {
                  // Force refresh: always use new time object to trigger reactivity
                  newPanelTimes[panel.id] = effectiveTime;
                } else {
                  // Smart update: only update if the time has actually changed
                  const existingTime = currentTimeObjPerPanel.value[panel.id];
                  if (!areTimesEqual(existingTime, effectiveTime)) {
                    newPanelTimes[panel.id] = effectiveTime;
                  } else {
                    // Preserve the existing time object reference to avoid triggering reactivity
                    newPanelTimes[panel.id] = existingTime;
                  }
                }
              }
            }
            // If panel doesn't have panel-level time, it will use __global (don't add to object)
          }
        });
      });

      // CRITICAL: Update individual properties instead of replacing the entire object
      // This prevents triggering reactivity for panels whose time hasn't changed
      // Remove keys that no longer exist
      Object.keys(currentTimeObjPerPanel.value).forEach((key) => {
        if (!newPanelTimes.hasOwnProperty(key)) {
          delete currentTimeObjPerPanel.value[key];
        }
      });
      // Update or add keys
      Object.keys(newPanelTimes).forEach((key) => {
        if (currentTimeObjPerPanel.value[key] !== newPanelTimes[key]) {
          currentTimeObjPerPanel.value[key] = newPanelTimes[key];
        }
      });
    };

    // when the date changes from the picker, update the current time object for the dashboard
    watch(selectedDate, async () => {
      if (selectedDate.value && dateTimePicker.value) {
        // CRITICAL: Clear panelIdToBeRefreshed to ensure all panels refresh
        // When global date time changes, all panels should update
        panelIdToBeRefreshed.value = null;

        const date = dateTimePicker.value?.getConsumableDateTime();

        currentTimeObj.value = {
          start_time: new Date(date.startTime),
          end_time: new Date(date.endTime),
        };

        // DON'T reset currentTimeObjPerPanel here - let computeAllPanelTimes() handle it
        // This prevents losing panel-specific times during the update

        // Compute panel-specific times with forceRefresh=true
        // This ensures all panels refresh when global date time changes
        computeAllPanelTimes(true);

        setTimeString();

        // Ensure all updates are settled before updating URL
        await nextTick();

        // Update URL to reflect the new global date time
        // This ensures URL stays in sync when user changes the date picker
        updateUrlWithCurrentState();
      }
    });

    // Watch for URL query changes to handle panel time updates
    watch(
      () => route.query,
      (newQuery, oldQuery) => {
        // CRITICAL FIX: Only recompute if relevant params changed
        // Skip if only panel time params (pt-*) changed - those are handled separately
        // Check if global time params (period, from, to) or other params changed
        const globalTimeParamsChanged =
          newQuery.period !== oldQuery.period ||
          newQuery.from !== oldQuery.from ||
          newQuery.to !== oldQuery.to;

        // Check if only panel time params changed
        const onlyPanelParamsChanged =
          Object.keys(newQuery).some(
            (key) => key.startsWith("pt-") && newQuery[key] !== oldQuery?.[key],
          ) && !globalTimeParamsChanged;

        // If only panel params changed, don't recompute (panel refresh handles it)
        // If global time or other params changed, recompute all panel times
        if (!onlyPanelParamsChanged) {
          // Re-compute panel times when URL changes (e.g., panel time params updated)
          // Use forceRefresh=false to preserve existing time references where possible
          computeAllPanelTimes();
        }
      },
      { deep: true },
    );

    // Sync selectedTabId from URL changes (handles back/forward navigation and drilldown)
    watch(
      () => route.query.tab,
      (newTabId) => {
        if (newTabId && newTabId !== selectedTabId.value) {
          selectedTabId.value = newTabId;
          // Variable re-reading is handled by the var-* watcher below
        }
      },
    );

    // Watch for cross-dashboard navigation (e.g. drilldown to a different dashboard)
    watch(
      () => route.query.dashboard,
      async (newDashboardId, oldDashboardId) => {
        // Skip initial mount call (oldDashboardId is undefined on first run);
        // loadDashboard() is already called during onMounted setup.
        if (!oldDashboardId) return;
        if (newDashboardId && newDashboardId !== oldDashboardId) {
          isDashboardLoading.value = true;
          try {
            await loadDashboard();
          } finally {
            isDashboardLoading.value = false;
          }
        }
      },
    );

    // Watch for var-* query param changes (handles same-dashboard drilldown)
    // When a drilldown targets the same dashboard, only var-* params change in the URL.
    // This watcher detects that and re-reads variable values from the URL.
    watch(
      () => {
        const varParams: Record<string, any> = {};
        Object.keys(route.query).forEach((key) => {
          if (key.startsWith("var-")) {
            varParams[key] = route.query[key];
          }
        });
        return JSON.stringify(varParams);
      },
      async (newVarParamsStr, oldVarParamsStr) => {
        if (newVarParamsStr === oldVarParamsStr) {
          return;
        }
        // Skip during cross-dashboard navigation (loadDashboard handles it)
        if (isDashboardLoading.value) {
          return;
        }

        // Skip if this URL change was caused by updateUrlWithCurrentState (app-initiated sync)
        // This prevents redundant loadFromUrl+commitAll when user changes a variable via dropdown
        if (isInternalUrlUpdate.value) {
          return;
        }

        // Set drilldown guard to prevent updateUrlWithCurrentState from clobbering
        // the new var-* params before the manager processes them
        try {
          isDrilldownInProgress.value = true;

          // Re-read variable values from URL into initialVariableValues
          const newInitialVars: Record<string, any> = {};
          Object.keys(route.query).forEach((key) => {
            if (key.startsWith("var-")) {
              const newKey = key.slice(4);
              newInitialVars[newKey] = route.query[key];
            }
          });

          // Update initialVariableValues prop
          initialVariableValues.value = newInitialVars;

          // Directly call updateInitialVariableValues on RenderDashboardCharts
          // The emit chain from usePanelDrilldown doesn't reliably reach RenderDashboardCharts,
          // so we call the exposed method directly via the component ref
          if (renderDashboardChartsRef.value?.updateInitialVariableValues) {
            await renderDashboardChartsRef.value.updateInitialVariableValues();
          }

          // Clear the drilldown guard after reactivity settles
          await nextTick();
          await nextTick();

          // Now sync the full URL state (adds back from/to, refresh, print, etc.)
          // The drilldown's router.push may not include all params (e.g. when passAllVariables is false),
          // so we need updateUrlWithCurrentState to fill in the missing ones.
          // Only runs if updateInitialVariableValues() succeeded — avoids writing stale state on error.
          updateUrlWithCurrentState();
        } finally {
          isDrilldownInProgress.value = false;
        }
      },
    );

    const getPanelFromTab = (tabId: string, panelId: string) => {
      const tab = currentDashboardData.data.tabs.find(
        (tab) => tab.tabId === tabId,
      );

      if (!tab || !tab.panels) {
        return null;
      }

      return tab.panels.find((panel) => panel.id === panelId);
    };

    const getQueryParamsForDuration = (data: any) => {
      if (!data) {
        return {};
      }

      // Primary check: use valueType if available
      if (data.valueType === "relative" && data.relativeTimePeriod) {
        return {
          period: data.relativeTimePeriod,
        };
      } else if (
        data.valueType === "absolute" &&
        data.startTime &&
        data.endTime
      ) {
        return {
          from: data.startTime,
          to: data.endTime,
        };
      }

      // Fallback for backward compatibility (when valueType is missing)
      if (data.relativeTimePeriod) {
        return {
          period: data.relativeTimePeriod,
        };
      } else if (data.startTime && data.endTime) {
        return {
          from: data.startTime,
          to: data.endTime,
        };
      }

      return {};
    };

    // [END] date picker related variables

    // back button to render dashboard List page
    const goBackToDashboardList = () => {
      return router.push({
        path: "/dashboards",
        query: {
          folder: route.query.folder ?? "default",
        },
      });
    };

    //add panel
    const addPanelData = () => {
      return router.push({
        path: "/dashboards/add_panel",
        query: {
          ...route.query,
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
          tab: route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
        },
      });
    };

    const refreshData = async () => {
      if (!arePanelsLoading.value) {
        // CRITICAL FIX: Clear panelIdToBeRefreshed for global refresh
        // This allows all panels to refresh, not just the one previously refreshed
        panelIdToBeRefreshed.value = null;

        // Generate new run ID for whole dashboard refresh
        generateNewDashboardRunId();

        // Sync panel-level datetime pickers FIRST (updates URL)
        await renderDashboardChartsRef.value?.syncAllPanelDateTimePickers();

        // Recompute all panel times after syncing
        // Pass forceRefresh=true to ensure ALL panels refresh (create new time objects)
        computeAllPanelTimes(true);

        // Commit all live variable changes to committed state
        renderDashboardChartsRef.value?.commitAllVariables();

        // Refresh the dashboard (syncs global datetime picker)
        dateTimePicker.value.refresh();
      }
    };

    const onDataZoom = (event: any) => {
      const selectedDateObj = {
        start: new Date(event.start),
        end: new Date(event.end),
      };
      // Truncate seconds and milliseconds from the dates
      selectedDateObj.start.setMilliseconds(0);
      selectedDateObj.end.setMilliseconds(0);

      // Compare the truncated dates
      if (selectedDateObj.start.getTime() === selectedDateObj.end.getTime()) {
        // Increment the end date by 1 minute
        selectedDateObj.end.setMinutes(selectedDateObj.end.getMinutes() + 1);
      }

      // set it as a absolute time
      dateTimePicker?.value?.setCustomDate("absolute", selectedDateObj);

      // refresh dashboard
      dateTimePicker.value.refresh();
    };

    // ------- work with query params ----------
    onMounted(async () => {
      const params = route.query;

      if (params.refresh) {
        const refreshInSecs = parseDuration(params.refresh);
        if (store.state?.zoConfig?.min_auto_refresh_interval) {
          if (
            refreshInSecs < store.state?.zoConfig?.min_auto_refresh_interval
          ) {
            refreshInterval.value = 0;
          } else {
            refreshInterval.value = refreshInSecs;
          }
        }
      }

      // check if timezone query params exist
      // will be used for initial time zone only, so remove it from query
      if (params.timezone) {
        // get the query params
        const query = {
          ...route.query,
        };

        // remove timezone from query
        delete query.timezone;

        // replace route with query params
        router.replace({
          query,
        });
      }

      // check if print query params exist
      if (params.print !== undefined) {
        // set print mode
        setPrint(params.print == "true" ? true : false);
      } else {
        // set print mode as false which is default in store
        router.replace({
          query: {
            ...route.query,
            print: store.state.printMode,
          },
        });
      }
      // This is removed due to the bug of the new date time component
      // and is now rendered when the setup method is called
      // instead of onActivated
      // if (params.period || (params.to && params.from)) {
      //   selectedDate.value = getSelectedDateFromQueryParams(params);
      // }

      // resize charts if needed
      await nextTick();
      window.dispatchEvent(new Event("resize"));
    });

    // Get current variable params from manager (uses new centralized getUrlParams method)
    const getVariableParamsFromManager = (): Record<string, any> => {
      if (renderDashboardChartsRef.value?.getUrlParams) {
        return renderDashboardChartsRef.value.getUrlParams({ useLive: false });
      }
      return {};
    };

    // Helper function to update URL with current state
    const updateUrlWithCurrentState = () => {
      isInternalUrlUpdate.value = true;
      try {
        // Build variable params - prefer manager if available, otherwise use route.query
        let variableParams: Record<string, any> = {};

        if (variablesManager.value) {
          // Get from manager
          variableParams = getVariableParamsFromManager();

          // If manager returns empty but route.query has variables, use route.query
          // This handles the case where page just loaded and manager hasn't committed yet
          if (Object.keys(variableParams).length === 0) {
            Object.keys(route.query).forEach((key) => {
              if (key.startsWith("var-")) {
                variableParams[key] = route.query[key];
              }
            });
          }
        } else {
          // No manager, use route.query
          Object.keys(route.query).forEach((key) => {
            if (key.startsWith("var-")) {
              variableParams[key] = route.query[key];
            }
          });
        }

        // CRITICAL FIX: Generate panel time URL params for panels with panel_time_range
        // Only generate for the currently active tab to avoid polluting URL with inactive tabs
        const panelTimeParams: Record<string, any> = {};

        // Find the currently active tab and iterate through its panels only
        const activeTab = currentDashboardData?.data?.tabs?.find(
          (tab: any) => tab.tabId === selectedTabId.value,
        );
        if (currentDashboardData?.data?.tabs && selectedTabId.value) {
          if (activeTab?.panels) {
            activeTab.panels.forEach((panel: any) => {
              if (!panel.id) return;
              const panelId = panel.id;

              // Check if panel already has URL params (highest priority - preserve user changes)
              const hasExistingUrlParams = !!(
                route.query[`pt-period.${panelId}`] ||
                route.query[`pt-from.${panelId}`]
              );

              if (hasExistingUrlParams) {
                // Preserve existing URL params (they may have been set by panel refresh)
                if (route.query[`pt-period.${panelId}`]) {
                  panelTimeParams[`pt-period.${panelId}`] =
                    route.query[`pt-period.${panelId}`];
                }
                if (
                  route.query[`pt-from.${panelId}`] &&
                  route.query[`pt-to.${panelId}`]
                ) {
                  panelTimeParams[`pt-from.${panelId}`] =
                    route.query[`pt-from.${panelId}`];
                  panelTimeParams[`pt-to.${panelId}`] =
                    route.query[`pt-to.${panelId}`];
                }
              } else if (panel.config?.panel_time_range) {
                // Panel has an explicit custom time range configured (no URL params yet)
                const panelTimeRange = panel.config.panel_time_range;

                if (
                  panelTimeRange.type === "relative" &&
                  panelTimeRange.relativeTimePeriod
                ) {
                  panelTimeParams[`pt-period.${panelId}`] =
                    panelTimeRange.relativeTimePeriod;
                } else if (
                  panelTimeRange.type === "absolute" &&
                  panelTimeRange.startTime &&
                  panelTimeRange.endTime
                ) {
                  panelTimeParams[`pt-from.${panelId}`] =
                    panelTimeRange.startTime.toString();
                  panelTimeParams[`pt-to.${panelId}`] =
                    panelTimeRange.endTime.toString();
                }
              } else if (panel.config?.panel_time_enabled) {
                // Panel has time picker enabled but no custom range → use global time (initial load only)
                const globalTimeParams = getQueryParamsForDuration(
                  selectedDate.value,
                );
                if (globalTimeParams.period) {
                  panelTimeParams[`pt-period.${panelId}`] =
                    globalTimeParams.period;
                } else if (globalTimeParams.from && globalTimeParams.to) {
                  panelTimeParams[`pt-from.${panelId}`] =
                    globalTimeParams.from.toString();
                  panelTimeParams[`pt-to.${panelId}`] =
                    globalTimeParams.to.toString();
                }
              }
            });
          }
        }

        // Build set of existing panel IDs across ALL tabs (not just active tab)
        // This ensures we keep datetime params for panels in other tabs
        const existingPanelIds = new Set<string>();
        if (currentDashboardData.data?.tabs) {
          currentDashboardData.data.tabs.forEach((tab: any) => {
            if (tab.panels) {
              tab.panels.forEach((panel: any) => {
                if (panel.id) {
                  existingPanelIds.add(panel.id);
                }
              });
            }
          });
        }

        // Preserve only panel time params from URL for panels that still exist in ANY tab
        // This ensures deleted panel parameters are removed from the URL, but keeps params for other tabs
        Object.keys(route.query).forEach((key) => {
          if (key.startsWith("pt-")) {
            // Extract panel ID from parameter name (e.g., "pt-period.panel123" -> "panel123")
            const panelId = key.split(".").slice(1).join(".");

            // Only preserve if panel still exists in any tab of the dashboard
            if (panelId && existingPanelIds.has(panelId)) {
              panelTimeParams[key] = route.query[key];
            }
          }
        });

        // Get global time params - ensure we always have time params
        const timeParams = getQueryParamsForDuration(selectedDate.value);

        const newQuery = {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          tab: selectedTabId.value,
          refresh: generateDurationLabel(refreshInterval.value),
          ...timeParams, // Global time params (period or from/to)
          ...variableParams, // Use variables from manager or route
          ...panelTimeParams, // Panel time params (generated + preserved)
          print: store.state.printMode,
          searchtype: route.query.searchtype,
        };

        // CRITICAL: Only update URL if query has actually changed
        // This prevents unnecessary route updates and panel recomputations
        const hasQueryChanged =
          Object.keys(newQuery).some(
            (key) => newQuery[key] !== route.query[key],
          ) ||
          Object.keys(route.query).some((key) => !newQuery.hasOwnProperty(key));

        if (hasQueryChanged) {
          router.replace({ query: newQuery }).finally(() => {
            isInternalUrlUpdate.value = false;
          });
        } else {
          isInternalUrlUpdate.value = false;
        }
      } catch (e) {
        console.error(e);
        isInternalUrlUpdate.value = false;
      }
    };

    // whenever the refreshInterval or selectedTabId is changed, update the query params
    // Note: selectedDate changes are handled in the selectedDate watch above
    watch(
      [refreshInterval, selectedTabId],
      () => {
        if (isDashboardLoading.value) return; // skip during cross-dashboard navigation
        if (isDrilldownInProgress.value) return; // skip during same-dashboard drilldown
        generateNewDashboardRunId();
        updateUrlWithCurrentState();
      },
      { deep: true },
    );

    const onDeletePanel = async (panelId: any) => {
      try {
        await deletePanel(
          store,
          route.query.dashboard,
          panelId,
          route.query.folder ?? "default",
          route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
        );
        await loadDashboard();

        showPositiveNotification("Panel deleted successfully", {
          timeout: 2000,
        });
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Panel deletion failed",
          );
        } else {
          showErrorNotification(error?.message ?? "Panel deletion failed", {
            timeout: 2000,
          });
        }
      }
    };

    // move single panel to another tab
    const onMovePanel = async (panelId: any, newTabId: any) => {
      try {
        await movePanelToAnotherTab(
          store,
          route.query.dashboard,
          panelId,
          route.query.folder ?? "default",
          route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
          newTabId,
        );
        await loadDashboard();

        showPositiveNotification("Panel moved successfully!", {
          timeout: 2000,
        });
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Panel move failed",
          );
        } else {
          showErrorNotification(error?.message ?? "Panel move failed", {
            timeout: 2000,
          });
        }
      }
    };

    /**
     * Computed property for dashboard share URL
     * Converts relative time periods to absolute times for sharing
     */
    const dashboardShareURL = computed(() => {
      // Establish reactive dependency on route.fullPath to recompute when URL changes
      void route.fullPath;
      const urlObj = new URL(window.location.href);
      const urlSearchParams = urlObj?.searchParams;

      // if relative time period, convert to absolute time
      if (urlSearchParams?.has("period")) {
        urlSearchParams.delete("period");
        urlSearchParams.set(
          "from",
          currentTimeObj?.value?.start_time?.getTime(),
        );
        urlSearchParams.set("to", currentTimeObj?.value?.end_time?.getTime());
      }

      return urlObj?.href;
    });

    // Fullscreen
    const fullscreenDiv = ref(null);
    const isFullscreen = ref(false);

    const toggleFullscreen = () => {
      if (!quasar.fullscreen.isActive) {
        quasar.fullscreen
          .request()
          .then(() => {
            isFullscreen.value = true;
          })
          .catch(() => {
            isFullscreen.value = false;
          });
      } else {
        quasar.fullscreen
          .exit()
          .then(() => {
            isFullscreen.value = false;
          })
          .catch(() => {
            isFullscreen.value = true;
          });
      }
    };

    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        isFullscreen.value = false;
      }
    };

    const openScheduledReports = () => {
      if (isLoadingReports.value) return;

      showScheduledReportsDialog.value = true;
      scheduledReports.value = [];
      isLoadingReports.value = true;

      reports
        .list(
          store.state.selectedOrganization.identifier,
          folderId.value,
          dashboardId.value,
        )
        .then((response) => {
          scheduledReports.value = response.data;
        })
        .catch((error) => {
          showErrorNotification(error?.message || "Failed to fetch reports");
          isLoadingReports.value = false;
        })
        .finally(() => {
          isLoadingReports.value = false;
        });
    };

    // Cleanup references
    const cleanupRefs = () => {
      // Clear all component refs to prevent memory leaks
      if (dateTimePicker.value) {
        dateTimePicker.value = null;
      }
      if (renderDashboardChartsRef.value) {
        renderDashboardChartsRef.value = null;
      }
      if (fullscreenDiv.value) {
        fullscreenDiv.value = null;
      }
    };

    onMounted(() => {
      document.addEventListener("fullscreenchange", onFullscreenChange);
    });

    // Force remount key — bumped on AI dashboard events to force RenderDashboardCharts to remount
    const dashboardRemountKey = ref(0);

    // Listen for AI assistant dashboard mutations to auto-refresh
    const { on: onDashboardEvent, off: offDashboardEvent } =
      useAiDashboardEvents();
    const handleAiDashboardEvent = async (event: AiDashboardEvent) => {
      const currentDashboardId = route.query.dashboard as string;
      const shouldReload = event.dashboardId === currentDashboardId;

      if (shouldReload && currentDashboardId) {
        // Clear cached dashboard data so getDashboard() fetches fresh from API
        delete store.state.organizationData.allDashboardData[
          currentDashboardId
        ];
        await loadDashboard();
        // Bump key to force RenderDashboardCharts to fully remount with new data
        dashboardRemountKey.value++;
      }
    };
    onMounted(() => {
      onDashboardEvent(handleAiDashboardEvent);
    });

    onUnmounted(() => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);

      // Clean up AI dashboard event listener
      offDashboardEvent(handleAiDashboardEvent);

      // Clean up dashboard context provider
      contextRegistry.unregister("dashboards");
      contextRegistry.setActive("");

      // Clear all refs
      cleanupRefs();
    });

    onMounted(() => {
      isFullscreen.value = false;
    });

    const currentTimeObjPerPanel = ref({});
    const shouldRefreshWithoutCachePerPanel = ref({});

    const refreshPanelRequest = (panelId, shouldRefreshWithoutCache) => {
      // Set the panel ID to be refreshed
      panelIdToBeRefreshed.value = panelId;

      // Store the shouldRefreshWithoutCache value for this panel
      shouldRefreshWithoutCachePerPanel.value = {
        ...shouldRefreshWithoutCachePerPanel.value,
        [panelId]: shouldRefreshWithoutCache || false,
      };

      // Recompute time for this specific panel only
      computeSinglePanelTime(panelId);

      setTimeString();
    };

    const updateRunId = (newRunId) => {
      runId.value = newRunId;
    };

    // Add these new refs and methods
    const showJsonEditorDialog = ref(false);

    const openJsonEditor = () => {
      showJsonEditorDialog.value = true;
    };

    const saveJsonDashboard = useLoading(async (updatedJson: any) => {
      try {
        // Update the dashboard data
        currentDashboardData.data = JSON.parse(JSON.stringify(updatedJson));

        // Add a wait time for state update
        await nextTick();

        // Save changes using existing renderDashboardChartsRef
        if (renderDashboardChartsRef?.value?.saveDashboardData?.execute) {
          await renderDashboardChartsRef.value.saveDashboardData.execute();

          // Reload the dashboard to reflect changes
          await loadDashboard();
        } else {
          showErrorNotification(
            "Failed to update dashboard JSON: Save method not available",
          );
        }
      } catch (error) {
        showErrorNotification(
          error?.message || "Failed to save dashboard changes",
        );
      } finally {
        showJsonEditorDialog.value = false;
      }
    });

    return {
      currentDashboardData,
      dashboardRemountKey,
      toggleFullscreen,
      fullscreenDiv,
      isFullscreen,
      goBackToDashboardList,
      addPanelData,
      t,
      getDashboard,
      store,
      route,
      // date variables
      dateTimePicker,
      selectedDate,
      currentTimeObj,
      currentTimeObjPerPanel,
      shouldRefreshWithoutCachePerPanel,
      refreshInterval,
      // ----------------
      refreshData,
      isVariablesChanged,
      refreshedVariablesDataUpdated,
      onDeletePanel,
      variablesData,
      variablesDataUpdated,
      showDashboardSettingsDialog,
      openSettingsDialog,
      loadDashboard,
      refreshPanelRequest,
      updateRunId,
      initialVariableValues,
      getQueryParamsForDuration,
      onDataZoom,
      dashboardShareURL,
      selectedTabId,
      onMovePanel,
      printDashboard,
      initialTimezone,
      timeString,
      searchType,
      quasar,
      openScheduledReports,
      showScheduledReportsDialog,
      isLoadingReports,
      scheduledReports,
      dashboardId,
      folderId,
      reportId,
      tabId,
      outlinedDescription,
      searchRequestTraceIds,
      arePanelsLoading,
      cancelQuery,
      traceIdRef,
      handleEmittedData,
      config,
      openLayoutConfig,
      selectedPanelConfig,
      savePanelLayout,
      renderDashboardChartsRef,
      folderNameFromFolderId,
      showJsonEditorDialog,
      openJsonEditor,
      saveJsonDashboard,
      setTimeForVariables,
      runId,
      onVariablesManagerReady,
    };
  },
});
</script>

<style lang="scss" scoped>
.printMode {
  .hideOnPrintMode {
    display: none;
  }
}

.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}

.dark-mode {
  background-color: $dark-page;
}

.bg-white {
  background-color: $white;
}

.stickyHeader {
  position: sticky;
  top: 0;
  z-index: 1001;
}
.stickyHeader.fullscreenHeader {
  top: 0px;
  z-index: 5100 !important;
}

.fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  z-index: 5000 !important;
  margin: 0 !important;
  padding: 0 !important;
  background-color: var(--q-color-page-background, #ffffff) !important;
}

.print-mode-container {
  height: 100vh !important;
  overflow-y: auto !important;
}

@media print {
  .print-mode-container {
    height: auto !important;
    overflow: visible !important;
    // max-height: none !important;
  }
}

.dashboard-icons {
  height: 30px;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--o2-hover-accent);
  }

  :deep(.q-btn-dropdown) {
    height: 30px;
    min-height: 30px;
    padding: 0 8px;

    .q-btn__content {
      line-height: normal;
      align-items: center;
    }
  }
}

.folder-name {
  color: var(--o2-menu-color) !important;
}

.folder-name:hover {
  border-radius: 0.325rem;
  background-color: var(--o2-tab-bg) !important;
}

.el-border {
  transition: background-color 0.2s ease;

  &:hover {
    background-color: var(--o2-hover-accent) !important;
  }
}

.el-border {
  transition: background-color 0.2s ease;

  &:hover {
    background-color: var(--o2-hover-accent) !important;
  }
}

/* Outline state borders */
.refresh-btn-group .apply-btn-refresh.q-btn--outline::before {
  border-right: none !important;
}

.refresh-btn-group .apply-btn-dropdown.q-btn--outline::before {
  border-left: 1px solid $border-color !important;
}

/* Flat state borders (when loading/cancel) - using pseudo-elements to avoid layout shifts */
.refresh-btn-group .apply-btn-refresh.q-btn--flat::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border: 1px solid $border-color !important;
  border-right: none !important;
  border-radius: inherit;
  pointer-events: none;
}

.refresh-btn-group .apply-btn-dropdown.q-btn--flat::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border: 1px solid $border-color !important;
  border-left: 1px solid $border-color !important;
  border-radius: inherit;
  pointer-events: none;
}

.apply-btn-refresh {
  border-top-left-radius: 4px !important;
  border-bottom-left-radius: 4px !important;
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

.apply-btn-dropdown {
  border-top-left-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
  border-top-right-radius: 4px !important;
  border-bottom-right-radius: 4px !important;
}
</style>
