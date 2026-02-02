<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page :key="store.state.selectedOrganization.identifier" class="tw:h-full">
    <div
      ref="fullscreenDiv"
      :class="{
        fullscreen: isFullscreen,
        'tw:h-[calc(100vh-105px)]': !store.state.printMode,
        'print-mode-container': store.state.printMode,
      }"
      class="tw:mx-[0.625rem] q-pt-xs"
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
            <q-btn
              v-if="!isFullscreen"
              no-caps
              @click="goBackToDashboardList"
              padding="xs"
              outline
              icon="arrow_back_ios_new"
              data-test="dashboard-back-btn"
              class="hideOnPrintMode el-border"
            />
            <span
              class="q-table__title folder-name tw:px-2 tw:cursor-pointer tw:transition-all tw:rounded-sm tw:ml-2"
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
          <div class="tw:flex">
            <q-btn
              v-if="!isFullscreen"
              outline
              class="dashboard-icons q-px-sm hideOnPrintMode el-border"
              size="sm"
              no-caps
              icon="add"
              @click="addPanelData"
              data-test="dashboard-panel-add"
            >
              <q-tooltip>{{ t("panel.add") }}</q-tooltip>
            </q-btn>
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
              class="dashboard-icons q-ml-sm"
              size="sm"
              v-model="selectedDate"
              :initialTimezone="initialTimezone"
              :disable="arePanelsLoading"
              @hide="setTimeForVariables"
            />
            <AutoRefreshInterval
              v-model="refreshInterval"
              trigger
              :min-refresh-interval="
                store.state?.zoConfig?.min_auto_refresh_interval || 5
              "
              @trigger="refreshData"
              class="dashboard-icons hideOnPrintMode q-ml-sm"
              style="padding-left: 0px; padding-right: 0px"
              size="sm"
            />
            <q-btn
              v-if="config.isEnterprise == 'true' && arePanelsLoading"
              outline
              class="dashboard-icons q-px-sm q-ml-sm hideOnPrintMode el-border"
              size="sm"
              no-caps
              icon="cancel"
              @click="cancelQuery"
              data-test="dashboard-cancel-btn"
              color="negative"
            >
              <q-tooltip>{{ t("panel.cancel") }}</q-tooltip>
            </q-btn>
            <q-btn
              v-else
              :outline="isVariablesChanged ? false : true"
              class="dashboard-icons q-px-sm q-ml-sm hideOnPrintMode el-border"
              size="sm"
              no-caps
              icon="refresh"
              @click="refreshData"
              :disable="arePanelsLoading"
              :loading="arePanelsLoading"
              data-test="dashboard-refresh-btn"
              :color="isVariablesChanged ? 'warning' : ''"
              :text-color="store.state.theme == 'dark' ? 'white' : 'dark'"
            >
              <q-tooltip>
                {{
                  isVariablesChanged
                    ? "Refresh to apply latest variable changes"
                    : "Refresh"
                }}
              </q-tooltip>
            </q-btn>

            <ExportDashboard
              v-if="!isFullscreen"
              class="hideOnPrintMode el-border"
              :dashboardId="currentDashboardData.data?.dashboardId"
            />
            <share-button
              v-if="!isFullscreen"
              :url="dashboardShareURL"
              button-class="dashboard-icons q-px-sm q-ml-sm hideOnPrintMode el-border"
              button-size="sm"
              data-test="dashboard-share-btn"
            />
            <q-btn
              v-if="!isFullscreen"
              outline
              class="dashboard-icons q-px-sm q-ml-sm hideOnPrintMode el-border"
              size="sm"
              no-caps
              icon="settings"
              data-test="dashboard-setting-btn"
              @click="openSettingsDialog"
            >
              <q-tooltip>{{ t("dashboard.setting") }}</q-tooltip>
            </q-btn>
            <q-btn
              outline
              class="dashboard-icons q-px-sm q-ml-sm el-border"
              size="sm"
              no-caps
              :icon="store.state.printMode === true ? 'close' : 'print'"
              @click="printDashboard"
              data-test="dashboard-print-btn"
              ><q-tooltip>{{
                store.state.printMode === true
                  ? t("common.close")
                  : t("dashboard.print")
              }}</q-tooltip></q-btn
            >
            <q-btn
              outline
              class="dashboard-icons q-px-sm q-ml-sm hideOnPrintMode el-border"
              size="sm"
              no-caps
              :icon="
                quasar.fullscreen.isActive ? 'fullscreen_exit' : 'fullscreen'
              "
              @click="toggleFullscreen"
              data-test="dashboard-fullscreen-btn"
              ><q-tooltip>{{
                quasar.fullscreen.isActive
                  ? t("dashboard.exitFullscreen")
                  : t("dashboard.fullscreen")
              }}</q-tooltip></q-btn
            >
            <q-btn
              v-if="!isFullscreen"
              outline
              class="dashboard-icons q-px-sm q-ml-sm hideOnPrintMode el-border"
              size="sm"
              no-caps
              :icon="outlinedDescription"
              @click="openScheduledReports"
              data-test="view-dashboard-scheduled-reports"
              ><q-tooltip>
                {{ t("dashboard.scheduledDashboards") }}
              </q-tooltip></q-btn
            >
            <q-btn
              v-if="!isFullscreen"
              outline
              class="dashboard-icons q-px-sm q-ml-sm hideOnPrintMode el-border"
              size="sm"
              no-caps
              icon="code"
              data-test="dashboard-json-edit-btn"
              @click="openJsonEditor"
            >
              <q-tooltip>{{ t("dashboard.editJson") }}</q-tooltip>
            </q-btn>
          </div>
        </div>
        <q-separator></q-separator>
      </div>

      <RenderDashboardCharts
        :key="currentDashboardData.data?.dashboardId"
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

      <q-dialog
        v-model="showDashboardSettingsDialog"
        position="right"
        full-height
        maximized
      >
        <DashboardSettings @refresh="loadDashboard" />
      </q-dialog>

      <q-dialog
        v-model="selectedPanelConfig.show"
        position="right"
        full-height
        maximized
      >
        <PanelLayoutSettings
          :layout="selectedPanelConfig.data.layout"
          @save:layout="savePanelLayout"
        />
      </q-dialog>

      <q-dialog
        v-model="showScheduledReportsDialog"
        position="right"
        full-height
        maximized
      >
        <ScheduledDashboards
          :reports="scheduledReports"
          :loading="isLoadingReports"
          :folderId="folderId"
          :dashboardId="dashboardId"
          :tabId="tabId"
          :tabs="currentDashboardData?.data?.tabs || []"
        />
      </q-dialog>

      <q-dialog
        v-model="showJsonEditorDialog"
        position="right"
        full-height
        maximized
        :persistent="true"
      >
        <DashboardJsonEditor
          :dashboard-data="currentDashboardData.data"
          :save-json-dashboard="saveJsonDashboard"
          @close="showJsonEditorDialog = false"
        />
      </q-dialog>
    </div>
  </q-page>
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
import { parseDuration, generateDurationLabel } from "../../utils/date";
import { useRoute } from "vue-router";
import { deletePanel } from "../../utils/commons";
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
import { useLoading } from "@/composables/useLoading";
import shortURLService from "@/services/short_url";
import { isEqual } from "lodash-es";
import { panelIdToBeRefreshed } from "@/utils/dashboard/convertCustomChartData";
import { getUUID } from "@/utils/zincutils";
import {
  createDashboardsContextProvider,
  contextRegistry,
} from "@/composables/contextProviders";

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

      if (manager && 'hasUncommittedChanges' in manager) {
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

    const initialVariableValues = { value: {} };
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

    const loadDashboard = async (onlyIfRequired = false) => {
      // check if drilldown or soft-refresh request
      if (onlyIfRequired) {
        // if current dashboard id and tab is same,  skip loading
        if (
          currentDashboardData?.data?.dashboardId === route.query.dashboard &&
          // check for tab
          selectedTabId.value === route.query.tab
        ) {
          return;
        }
      }
      const dashboard = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default",
      );

      if (
        !dashboard ||
        typeof dashboard !== "object" ||
        !Object.keys(dashboard).length
      ) {
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

    // when the date changes from the picker, update the current time object for the dashboard
    watch(selectedDate, () => {
      if (selectedDate.value && dateTimePicker.value) {
        const date = dateTimePicker.value?.getConsumableDateTime();

        currentTimeObj.value = {
          start_time: new Date(date.startTime),
          end_time: new Date(date.endTime),
        };

        currentTimeObjPerPanel.value = {
          __global: {
            start_time: new Date(date.startTime),
            end_time: new Date(date.endTime),
          },
        };

        setTimeString();
      }
    });

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

      if (data.relativeTimePeriod) {
        return {
          period: data.relativeTimePeriod,
        };
      } else {
        return {
          from: data.startTime,
          to: data.endTime,
        };
      }
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
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
          tab: route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
        },
      });
    };

    const refreshData = () => {
      if (!arePanelsLoading.value) {
        // Generate new run ID for whole dashboard refresh
        generateNewDashboardRunId();

        // Set shouldRefreshWithoutCache to false for all panels
        const allPanelIds = [];
        currentDashboardData.data.tabs?.forEach((tab: any) => {
          tab.panels?.forEach((panel: any) => {
            if (panel.id) {
              allPanelIds.push(panel?.id);
              shouldRefreshWithoutCachePerPanel.value[panel.id] = false;
            }
          });
        });

        // CRITICAL: Commit all live variable changes to committed state
        // This is the key mechanism that prevents premature API calls
        // Call commitAllVariables via the RenderDashboardCharts ref
        renderDashboardChartsRef.value?.commitAllVariables();

        // Refresh the dashboard
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

      router.replace({
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          tab: selectedTabId.value,
          refresh: generateDurationLabel(refreshInterval.value),
          ...getQueryParamsForDuration(selectedDate.value),
          ...variableParams, // Use variables from manager or route
          print: store.state.printMode,
          searchtype: route.query.searchtype,
        },
      });
    };

    // whenever the refreshInterval is changed, update the query params
    // Note: We're removing the variablesManager.committedVariablesData watch
    // because URL updates should only happen when user clicks refresh (handled in refreshData)
    // This watch is just for time/tab/refresh interval changes
    watch(
      [
        refreshInterval,
        selectedDate,
        selectedTabId,
      ],
      () => {
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

    onUnmounted(() => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);

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

      // when the date changes from the picker, update the current time object for the dashboard
      if (selectedDate.value && dateTimePicker.value) {
        const date = dateTimePicker.value?.getConsumableDateTime();

        currentTimeObjPerPanel.value = {
          ...currentTimeObjPerPanel.value,
          [panelId]: {
            start_time: new Date(date.startTime),
            end_time: new Date(date.endTime),
          },
        };

        setTimeString();
      }
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
  top: 40px;
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
    max-height: none !important;
  }
}

.dashboard-icons {
  height: 30px;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--o2-hover-accent);
  }

  :deep(.date-time-button) {
    height: 30px;
    min-height: 30px;
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
