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

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div style="overflow-y: auto" class="scroll">
    <!-- Header Section -->
    <div class="tw:px-[0.625rem] tw:mb-[0.625rem] q-pt-xs">
      <div
        class="flex items-center q-pa-sm card-container"
        :class="!store.state.isAiChatEnabled ? 'justify-between' : ''"
      >
        <div
          class="flex items-center q-table__title"
          :class="!store.state.isAiChatEnabled ? 'q-mr-md' : 'q-mr-sm'"
        >
          <span>
            {{ editMode ? t("panel.editPanel") : t("panel.addPanel") }}
          </span>
          <div>
            <q-input
              data-test="dashboard-panel-name"
              v-model="dashboardPanelData.data.title"
              :label="t('panel.name') + '*'"
              class="q-ml-xl dynamic-input"
              dense
              borderless
              :style="inputStyle"
            />
          </div>
        </div>
        <div class="flex q-gutter-sm">
          <q-btn
            outline
            padding="xs sm"
            class="q-mr-sm tw:h-[36px] el-border"
            no-caps
            label="Dashboard Tutorial"
            @click="showTutorial"
            data-test="dashboard-panel-tutorial-btn"
          ></q-btn>
          <q-btn
            v-if="
              !['html', 'markdown', 'custom_chart'].includes(
                dashboardPanelData.data.type,
              )
            "
            outline
            padding="sm"
            class="q-mr-sm tw:h-[36px] el-border"
            no-caps
            icon="info_outline"
            @click="showViewPanel = true"
            data-test="dashboard-panel-data-view-query-inspector-btn"
          >
            <q-tooltip anchor="center left" self="center right"
              >Query Inspector
            </q-tooltip>
          </q-btn>
          <DateTimePickerDashboard
            v-if="selectedDate"
            v-model="selectedDate"
            ref="dateTimePickerRef"
            :disable="disable"
            class="tw:h-[36px]"
            @hide="setTimeForVariables"
          />
          <q-btn
            outline
            color="red"
            no-caps
            flat
            class="o2-secondary-button tw:h-[36px] q-ml-md"
            style="color: red !important"
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            :label="t('panel.discard')"
            @click="goBackToDashboardList"
            data-test="dashboard-panel-discard"
          />
          <q-btn
            class="o2-secondary-button tw:h-[36px] q-ml-md"
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            no-caps
            flat
            :label="t('panel.save')"
            data-test="dashboard-panel-save"
            @click.stop="savePanelData.execute()"
            :loading="savePanelData.isLoading.value"
          />
          <template
            v-if="!['html', 'markdown'].includes(dashboardPanelData.data.type)"
          >
            <q-btn
              v-if="config.isEnterprise === 'false'"
              data-test="dashboard-apply"
              class="tw:h-[36px] q-ml-md o2-primary-button"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-primary-button-dark'
                  : 'o2-primary-button-light'
              "
              no-caps
              flat
              dense
              :loading="searchRequestTraceIds.length > 0"
              :disable="searchRequestTraceIds.length > 0"
              :label="t('panel.apply')"
              @click="() => runQuery(false)"
            />
            <q-btn-group
              v-if="config.isEnterprise === 'true'"
              class="tw:h-[36px] q-ml-md o2-primary-button"
              style="
                padding-left: 0px !important ;
                padding-right: 0px !important;
                display: inline-flex;
              "
              :class="
                store.state.theme === 'dark'
                  ? searchRequestTraceIds.length > 0
                    ? 'o2-negative-button-dark'
                    : 'o2-secondary-button-dark'
                  : searchRequestTraceIds.length > 0
                    ? 'o2-negative-button-light'
                    : 'o2-secondary-button-light'
              "
            >
              <q-btn
                :data-test="
                  searchRequestTraceIds.length > 0
                    ? 'dashboard-cancel'
                    : 'dashboard-apply'
                "
                no-caps
                :label="
                  searchRequestTraceIds.length > 0
                    ? t('panel.cancel')
                    : t('panel.apply')
                "
                @click="onApplyBtnClick"
              />

              <q-btn-dropdown
                class="text-bold no-border tw:px-0"
                no-caps
                flat
                dense
                auto-close
                dropdown-icon="keyboard_arrow_down"
                :disable="searchRequestTraceIds.length > 0"
              >
                <q-list>
                  <q-item
                    clickable
                    @click="runQuery(true)"
                    :disable="searchRequestTraceIds.length > 0"
                  >
                    <q-item-section avatar>
                      <q-icon
                        size="xs"
                        name="refresh"
                        style="align-items: baseline; padding: 0px"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label
                        style="
                          font-size: 12px;
                          align-items: baseline;
                          padding: 0px;
                        "
                        >Refresh Cache & Apply</q-item-label
                      >
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-btn-dropdown>
            </q-btn-group>
          </template>
        </div>
      </div>
    </div>

    <!-- PanelEditor Content Area -->
    <PanelEditor
      ref="panelEditorRef"
      pageType="dashboard"
      :editMode="editMode"
      :dashboardData="dashboardDataForPanelEditor"
      :variablesData="updatedVariablesData"
      :selectedDateTime="dateTimeForVariables || dashboardPanelData.meta.dateTime"
      @variablesDataUpdated="variablesDataUpdated"
      @openAddVariable="handleOpenAddVariable"
      @chartApiError="handleChartApiError"
      @dataZoom="onDataZoom"
      @metaDataUpdated="metaDataValue"
    />

    <!-- Query Inspector Dialog -->
    <q-dialog v-model="showViewPanel">
      <QueryInspector
        :metaData="metaData"
        :data="panelTitle"
      ></QueryInspector>
    </q-dialog>

    <!-- Add Variable Drawer -->
    <div
      v-if="isAddVariableOpen"
      class="add-variable-drawer-overlay"
      @click.self="handleCloseAddVariable"
    >
      <div class="add-variable-drawer-panel tw:px-4 tw:pt-4">
        <AddSettingVariable
          @save="handleSaveVariable"
          @close="handleCloseAddVariable"
          :dashboardVariablesList="
            currentDashboardData.data?.variables?.list || []
          "
          :variableName="selectedVariableToEdit"
          :isFromAddPanel="true"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  toRaw,
  nextTick,
  watch,
  reactive,
  onUnmounted,
  onMounted,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  addPanel,
  checkIfVariablesAreLoaded,
  getDashboard,
  getPanel,
  updatePanel,
  updateDashboard,
  deleteVariable,
} from "../../../utils/commons";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import DateTimePickerDashboard from "../../../components/DateTimePickerDashboard.vue";
import AddSettingVariable from "../../../components/dashboards/settings/AddSettingVariable.vue";
import { useLoading } from "@/composables/useLoading";
import { debounce, isEqual } from "lodash-es";
import { provide, inject } from "vue";
import useNotifications from "@/composables/useNotifications";
import config from "@/aws-exports";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import useAiChat from "@/composables/useAiChat";
import useStreams from "@/composables/useStreams";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import {
  createDashboardsContextProvider,
  contextRegistry,
} from "@/composables/contextProviders";
import { processQueryMetadataErrors } from "@/utils/zincutils";
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import { getConsumableRelativeTime } from "@/utils/date";
import {
  getPanelTimeFromURL,
  convertPanelTimeRangeToPicker,
  convertTimeObjToPickerFormat,
} from "@/utils/dashboard/panelTimeUtils";
import { PanelEditor } from "@/components/dashboards/PanelEditor";

const QueryInspector = defineAsyncComponent(() => {
  return import("@/components/dashboards/QueryInspector.vue");
});

export default defineComponent({
  name: "AddPanel",
  props: ["metaData"],

  components: {
    DateTimePickerDashboard,
    AddSettingVariable,
    QueryInspector,
    PanelEditor,
  },
  setup(props) {
    provide("dashboardPanelDataPageKey", "dashboard");

    // PanelEditor ref for accessing exposed methods/properties
    const panelEditorRef = ref<InstanceType<typeof PanelEditor> | null>(null);

    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref();
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();
    const store = useStore();

    // Initialize or inject variables manager
    const injectedManager = inject("variablesManager", null);
    const variablesManager = injectedManager || useVariablesManager();

    // Provide to child components
    if (!injectedManager) {
      provide("variablesManager", variablesManager);
    }
    const {
      showErrorNotification,
      showPositiveNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();
    const {
      dashboardPanelData,
      resetDashboardPanelData,
      resetDashboardPanelDataAndAddTimeField,
      resetAggregationFunction,
      validatePanel,
      makeAutoSQLQuery,
    } = useDashboardPanelData("dashboard");
    const editMode = ref(false);
    const selectedDate: any = ref(null);
    const dateTimePickerRef: any = ref(null);
    const errorData: any = reactive({
      errors: [],
    });
    let variablesData: any = reactive({});
    const { registerAiChatHandler, removeAiChatHandler } = useAiChat();
    const { getStream } = useStreams();
    const seriesData = ref([]);
    const shouldRefreshWithoutCache = ref(false);

    // Warning messages
    const maxQueryRangeWarning = ref("");
    const limitNumberOfSeriesWarningMessage = ref("");
    const errorMessage = ref("");

    // to store and show when the panel was last loaded
    const lastTriggeredAt = ref(null);
    const handleLastTriggeredAtUpdate = (data: any) => {
      lastTriggeredAt.value = data;
    };

    // Get merged variables for the current panel from variablesManager
    // This holds the COMMITTED state - what the chart is currently using
    // Only updates when user applies changes (similar to ViewDashboard's committed state)
    const updatedVariablesData: any = reactive({
      isVariablesLoading: false,
      values: [],
    });

    // Computed property for LIVE merged variables (for HTML/Markdown editors)
    // This includes global + tab + panel scoped variables with proper precedence
    const liveVariablesData = computed(() => {
      if (variablesManager && variablesManager.variablesData.isInitialized) {
        const mergedVars = variablesManager.getVariablesForPanel(
          currentPanelId.value,
          currentTabId.value || "",
        );
        return {
          isVariablesLoading: variablesManager.isLoading.value,
          values: mergedVars,
        };
      } else {
        // Fallback to variablesData
        return variablesData;
      }
    });

    // Helper function to update updatedVariablesData from variablesManager
    const updateCommittedVariables = () => {
      if (variablesManager && variablesManager.variablesData.isInitialized) {
        const mergedVars = variablesManager.getVariablesForPanel(
          currentPanelId.value,
          currentTabId.value || "",
        );

        updatedVariablesData.isVariablesLoading = variablesManager.isLoading.value;
        // IMPORTANT: Deep copy to prevent reactive updates from live state
        updatedVariablesData.values = JSON.parse(JSON.stringify(mergedVars));
      } else {
        // Fallback: deep copy from variablesData
        updatedVariablesData.isVariablesLoading = variablesData.isVariablesLoading;
        updatedVariablesData.values = JSON.parse(JSON.stringify(variablesData.values));
      }
    };

    // State for Add Variable functionality
    const isAddVariableOpen = ref(false);
    const selectedVariableToEdit = ref(null);

    // Track variables created during this edit session (for cleanup on discard)
    const variablesCreatedInSession = ref<string[]>([]);
    const initialVariableNames = ref<string[]>([]);

    // Track variables that use "current_panel" - these need special handling
    const variablesWithCurrentPanel = ref<string[]>([]);

    // Track if initial variables need auto-apply (similar to ViewDashboard behavior)
    let needsVariablesAutoUpdate = true;

    // this is used to again assign query params on discard or save
    let routeQueryParamsOnMount: any = {};

    // ======= [START] default variable values

    const initialVariableValues: any = { value: {} };
    Object.keys(route.query).forEach((key) => {
      if (key.startsWith("var-")) {
        const newKey = key.slice(4);
        initialVariableValues.value[newKey] = route.query[key];
      }
    });
    // ======= [END] default variable values

    const metaData = ref(null);
    const showViewPanel = ref(false);
    const metaDataValue = (metadata: any) => {
      metaData.value = metadata;
    };

    //dashboard tutorial link on click
    const showTutorial = () => {
      window.open("https://short.openobserve.ai/dashboard-tutorial");
    };

    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData, data);

      // Check if initial variables are loaded and auto-apply them (ONLY on first load)
      if (needsVariablesAutoUpdate) {
        // Check if the variables have loaded (length > 0)
        if (checkIfVariablesAreLoaded(data)) {
          needsVariablesAutoUpdate = false;
          // Auto-commit initial variable state - this ensures the chart renders with initial values
          updateCommittedVariables();

          // Trigger chart update with loaded variables
          if (editMode.value || !isInitialDashboardPanelData()) {
            // Copy the panel data to trigger chart render with initial variables
            chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
            panelEditorRef.value?.initChartData(dashboardPanelData.data);
          }
        }
        // After initial load, don't return - we still need to update URL params below
        // But we should NOT update chartData or updatedVariablesData
      }

      // Use variablesManager if available for URL sync
      let variableObj: any = {};

      if (variablesManager && variablesManager.variablesData.isInitialized) {
        // Manager mode: Use getUrlParams with useLive=true to sync live variable state
        variableObj = variablesManager.getUrlParams({ useLive: true });
      } else {
        // Legacy mode: build URL params manually
        data.values.forEach((variable: any) => {
          if (variable.type === "dynamic_filters") {
            const filters = (variable.value || []).filter(
              (item: any) => item.name && item.operator && item.value,
            );
            const encodedFilters = filters.map((item: any) => ({
              name: item.name,
              operator: item.operator,
              value: item.value,
            }));
            variableObj[`var-${variable.name}`] = encodeURIComponent(
              JSON.stringify(encodedFilters),
            );
          } else {
            // Simple: just set var-name=value
            variableObj[`var-${variable.name}`] = variable.value;
          }
        });
      }

      router.replace({
        query: {
          ...route.query,
          ...variableObj,
          ...getQueryParamsForDuration(selectedDate.value),
        },
      });

      // Note: updatedVariablesData is now a computed property that reads from variablesManager
      // No need to manually assign here - it will reactively update
    };

    const currentDashboardData: any = reactive({
      data: {},
    });

    // Dashboard data for PanelEditor (includes dashboard config plus current panel/tab IDs)
    const dashboardDataForPanelEditor = computed(() => ({
      ...currentDashboardData.data,
      dashboardId: route.query.dashboard,
      folderId: route.query.folder ?? "default",
      tabId: currentTabId.value,
      panelId: currentPanelId.value,
    }));

    // this is used to activate the watcher only after on mounted
    let isPanelConfigWatcherActivated = false;
    const isPanelConfigChanged = ref(false);

    const savePanelData = useLoading(async () => {
      const dashboardId = route.query.dashboard + "";
      await savePanelChangesToDashboard(dashboardId);
    });

    onUnmounted(async () => {
      // clear a few things
      resetDashboardPanelData();

      // remove beforeUnloadHandler event listener
      window.removeEventListener("beforeunload", beforeUnloadHandler);

      removeAiContextHandler();

      // Clean up dashboard context provider
      contextRegistry.unregister("dashboards");
      contextRegistry.setActive("");

      // Clear all refs to prevent memory leaks
      dateTimePickerRef.value = null;
    });

    onMounted(async () => {
      // assign the route query params
      routeQueryParamsOnMount = JSON.parse(JSON.stringify(route?.query ?? {}));

      errorData.errors = [];

      // todo check for the edit more
      if (route.query.panelId) {
        editMode.value = true;

        const panelData = await getPanel(
          store,
          route.query.dashboard,
          route.query.panelId,
          route.query.folder,
          route.query.tab,
        );

        try {
          Object.assign(
            dashboardPanelData.data,
            JSON.parse(JSON.stringify(panelData ?? {})),
          );

          // FIX: For custom_chart panels, ensure customQuery flag is always true
          // This prevents the query from being lost due to watchers that fire during mount
          if (dashboardPanelData.data.type === "custom_chart") {
            dashboardPanelData.data.queries.forEach((query: any) => {
              if (query.query) {
                // Only set customQuery=true if there's actually a query
                query.customQuery = true;
              }
            });
          }
        } catch (e) {
          console.error("Error while parsing panel data", e);
        }

        // check if vrl function exists
        if (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].vrlFunctionQuery
        ) {
          // enable vrl function editor
          dashboardPanelData.layout.vrlFunctionToggle = true;
        }

        await nextTick();
        // Initialize PanelEditor's chartData after loading panel data
        panelEditorRef.value?.initChartData(dashboardPanelData.data);
        updateDateTime(selectedDate.value);
      } else {
        editMode.value = false;
        resetDashboardPanelDataAndAddTimeField();
        // Initialize PanelEditor's chartData as empty for new panel
        panelEditorRef.value?.initChartData({});
        // set the value of the date time after the reset
        updateDateTime(selectedDate.value);
      }
      // let it call the wathcers and then mark the panel config watcher as activated
      await nextTick();
      isPanelConfigWatcherActivated = true;

      //event listener before unload and data is updated
      window.addEventListener("beforeunload", beforeUnloadHandler);
      await loadDashboard();

      // Call makeAutoSQLQuery after dashboard data is loaded
      // Only generate SQL if we're in auto query mode
      if (
        !editMode.value &&
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery
      ) {
        await makeAutoSQLQuery();
      }

      registerAiContextHandler();

      // Set up dashboard context provider
      const dashboardProvider = createDashboardsContextProvider(
        route,
        store,
        dashboardPanelData,
        editMode.value,
      );
      contextRegistry.register("dashboards", dashboardProvider);
      contextRegistry.setActive("dashboards");
    });

    let list = computed(function () {
      return [toRaw(store.state.currentSelectedDashboard)];
    });

    const currentDashboard = toRaw(store.state.currentSelectedDashboard);

    /**
     * Retrieves the selected date from the query parameters.
     */
    const getSelectedDateFromQueryParams = (params: any) => ({
      valueType: params.period
        ? "relative"
        : params.from && params.to
          ? "absolute"
          : "relative",
      startTime: params.from ? params.from : null,
      endTime: params.to ? params.to : null,
      relativeTimePeriod: params.period ? params.period : "15m",
    });

    const loadDashboard = async () => {
      let data = JSON.parse(
        JSON.stringify(
          (await getDashboard(
            store,
            route.query.dashboard,
            route.query.folder ?? "default",
          )) ?? {},
        ),
      );

      currentDashboardData.data = data;

      if (
        !currentDashboardData?.data ||
        typeof currentDashboardData.data !== "object" ||
        !Object.keys(currentDashboardData.data).length
      ) {
        window.removeEventListener("beforeunload", beforeUnloadHandler);
        forceSkipBeforeUnloadListener = true;
        goBack();
        return;
      }

      // Initialize variables manager with dashboard variables
      try {
        await variablesManager.initialize(
          currentDashboardData.data?.variables?.list || [],
          currentDashboardData.data,
          { [currentPanelId.value]: currentTabId.value || "" },
        );

        // Mark current tab and panel as visible so their variables can load
        const tabId =
          (route.query.tab as string) ??
          currentDashboardData.data?.tabs?.[0]?.tabId;
        if (tabId) {
          variablesManager.setTabVisibility(tabId, true);
        }

        // In edit mode, mark the panel as visible
        if (route.query.panelId) {
          variablesManager.setPanelVisibility(
            route.query.panelId as string,
            true,
          );
        } else {
          // In add mode (new panel), mark "current_panel" as visible
          // This allows variables scoped to "current_panel" to load
          variablesManager.setPanelVisibility("current_panel", true);
        }

        // Load variable values from URL parameters
        variablesManager.loadFromUrl(route);

        // Commit the URL values immediately so they're used by the chart
        variablesManager.commitAll();

        // Initialize updatedVariablesData with current variable state
        updateCommittedVariables();
      } catch (error) {
        console.error("Error initializing variables manager:", error);
      }

      // if variables data is null, set it to empty list
      if (
        !(
          currentDashboardData.data?.variables &&
          currentDashboardData.data?.variables?.list.length
        )
      ) {
        variablesData.isVariablesLoading = false;
        variablesData.values = [];
      }

      // Capture initial variable names on first load (only once during mount)
      if (initialVariableNames.value.length === 0) {
        initialVariableNames.value =
          currentDashboardData.data?.variables?.list?.map((v: any) => v.name) || [];
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

      // In edit mode, check if panel has panel-level time configured
      // If it does, use that instead of global time for the date picker
      if (editMode.value && route.query.panelId) {
        const panelId = route.query.panelId as string;
        let panelTimeValue = null;

        // Priority 1: Check URL params for panel-level time (pt-{panelId})
        const urlPanelTime = getPanelTimeFromURL(panelId, route.query);
        if (urlPanelTime) {
          panelTimeValue = urlPanelTime;
        }
        // Priority 2: Check panel config for panel_time_range
        else if (dashboardPanelData.data.config?.panel_time_range) {
          panelTimeValue = convertPanelTimeRangeToPicker(
            dashboardPanelData.data.config.panel_time_range
          );
        }

        // If panel has its own time, update the selectedDate to show it in the picker
        if (panelTimeValue) {
          selectedDate.value = panelTimeValue;
        }
      }
    };

    const isInitialDashboardPanelData = () => {
      return (
        dashboardPanelData.data.description == "" &&
        !dashboardPanelData.data.config.unit &&
        !dashboardPanelData.data.config.unit_custom &&
        dashboardPanelData.data.queries[0].fields.x.length == 0 &&
        dashboardPanelData.data.queries[0].fields?.breakdown?.length == 0 &&
        dashboardPanelData.data.queries[0].fields.y.length == 0 &&
        dashboardPanelData.data.queries[0].fields.z.length == 0 &&
        dashboardPanelData.data.queries[0].fields.filter.conditions.length ==
          0 &&
        dashboardPanelData.data.queries.length == 1
      );
    };

    const isOutDated = computed(() => {
      //check that is it addpanel initial call
      if (isInitialDashboardPanelData() && !editMode.value) return false;
      //compare chartdata and dashboardpaneldata and variables data as well

      const normalizeVariables = (obj: any) => {
        const normalized = JSON.parse(JSON.stringify(obj));
        // Sort arrays to ensure consistent ordering
        if (normalized.values && Array.isArray(normalized.values)) {
          normalized.values = normalized.values
            .map((variable: any) => {
              if (Array.isArray(variable.value)) {
                variable.value.sort((a: any, b: any) =>
                  JSON.stringify(a).localeCompare(JSON.stringify(b)),
                );
              }
              return variable;
            })
            .sort((a: any, b: any) => a.name.localeCompare(b.name));
        }
        return normalized;
      };

      // Get LIVE variables from variablesManager
      let liveVariables: any = { values: [] };
      if (variablesManager && variablesManager.variablesData.isInitialized) {
        const mergedVars = variablesManager.getVariablesForPanel(
          currentPanelId.value,
          currentTabId.value || "",
        );
        liveVariables = {
          isVariablesLoading: variablesManager.isLoading.value,
          values: mergedVars,
        };
      } else {
        liveVariables = variablesData;
      }

      const normalizedCurrent = normalizeVariables(liveVariables);
      const normalizedRefreshed = normalizeVariables(updatedVariablesData);
      const variablesChanged = !isEqual(normalizedCurrent, normalizedRefreshed);

      const configChanged = !isEqual(
        JSON.parse(JSON.stringify(chartData.value ?? {})),
        JSON.parse(JSON.stringify(dashboardPanelData.data ?? {})),
      );
      let configNeedsApiCall = false;

      if (configChanged) {
        configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          dashboardPanelData.data,
        );
      }

      return configNeedsApiCall || variablesChanged;
    });

    watch(isOutDated, () => {
      window.dispatchEvent(new Event("resize"));
    });

    watch(
      () => dashboardPanelData.data.type,
      async () => {
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        panelEditorRef.value?.initChartData(dashboardPanelData.data);
      },
    );
    const dateTimeForVariables = ref(null);

    const setTimeForVariables = () => {
      const date = dateTimePickerRef.value?.getConsumableDateTime();
      const startTime = new Date(date.startTime);
      const endTime = new Date(date.endTime);

      // Update only the variables time object
      dateTimeForVariables.value = {
        start_time: startTime,
        end_time: endTime,
      };
    };
    watch(selectedDate, () => {
      updateDateTime(selectedDate.value);
    });

    // Watch for panel-level time configuration changes and update URL
    watch(
      () => dashboardPanelData.data.config?.panel_time_range,
      (newPanelTime) => {
        // Get panel ID (only in edit mode)
        const panelId = route.query.panelId as string;
        if (!panelId) {
          // In create mode, don't update URL with panel time params yet
          // Panel time will be saved with the panel config
          return;
        }

        if (!newPanelTime) {
          // Panel time removed - clear panel time params from URL
          const query = { ...route.query };
          delete query[`pt-${panelId}`];
          delete query[`pt-${panelId}-from`];
          delete query[`pt-${panelId}-to`];
          router.replace({ query });
          return;
        }

        // Update URL with panel time parameters
        const query = { ...route.query };

        if (newPanelTime.type === 'relative' && newPanelTime.relativeTimePeriod) {
          // Relative time: pt-{panelId}={relativeTimePeriod}
          query[`pt-${panelId}`] = newPanelTime.relativeTimePeriod;
          // Remove absolute time params if they exist
          delete query[`pt-${panelId}-from`];
          delete query[`pt-${panelId}-to`];
        } else if (newPanelTime.type === 'absolute' && newPanelTime.startTime && newPanelTime.endTime) {
          // Absolute time: pt-{panelId}-from={startTime}&pt-{panelId}-to={endTime}
          query[`pt-${panelId}-from`] = newPanelTime.startTime.toString();
          query[`pt-${panelId}-to`] = newPanelTime.endTime.toString();
          // Remove relative time param if it exists
          delete query[`pt-${panelId}`];
        }

        router.replace({ query });
      },
      { deep: true }
    );

    // resize the chart when config panel is opened and closed
    watch(
      () => dashboardPanelData.layout.isConfigPanelOpen,
      () => {
        window.dispatchEvent(new Event("resize"));
      },
    );


    // resize the chart when query editor is opened and closed
    watch(
      () => dashboardPanelData.layout.showQueryBar,
      (newValue) => {
        if (!newValue) {
          dashboardPanelData.layout.querySplitter = 41;
        } else {
          if (expandedSplitterHeight.value !== null) {
            dashboardPanelData.layout.querySplitter =
              expandedSplitterHeight.value;
          }
        }
      },
    );

    const runQuery = (withoutCache = false) => {
      try {
        if (!isValid(true, true)) {
          // do not return if query is not valid
          // allow to fire query
        }

        // should use cache flag
        shouldRefreshWithoutCache.value = withoutCache;

        // Commit the current variable values to updatedVariablesData
        // This is what the chart will use for the query
        updateCommittedVariables();

        // copy the data object excluding the reactivity
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        panelEditorRef.value?.initChartData(dashboardPanelData.data);
        // refresh the date time based on current time if relative date is selected
        dateTimePickerRef.value && dateTimePickerRef.value.refresh();
        updateDateTime(selectedDate.value);

        // Call PanelEditor's runQuery if available
        if (panelEditorRef.value) {
          panelEditorRef.value.runQuery(withoutCache);
        }
      } catch (err) {
        // Error during query execution
      }
    };

    const getQueryParamsForDuration = (data: any) => {
      try {
        if (data.valueType === "relative") {
          return {
            period: data.relativeTimePeriod ?? "15m",
          };
        } else if (data.valueType === "absolute") {
          return {
            from: data.startTime,
            to: data.endTime,
            period: null,
          };
        }
        return {};
      } catch (error) {
        return {};
      }
    };

    const updateDateTime = (value: object) => {
      if (selectedDate.value && dateTimePickerRef?.value) {
        // CRITICAL FIX (Issue 4): Check if panel has its own time configured
        // Priority 1: Check URL params (highest priority)
        // Priority 2: Use panel's configured time range
        // Priority 3: Use global time
        const panelId = route.query.panelId as string;
        let effectiveTime;

        // Priority 1: URL params (only in edit mode)
        if (panelId) {
          const urlPanelTime = getPanelTimeFromURL(panelId, route.query);
          if (urlPanelTime) {
            if (urlPanelTime.valueType === 'relative' && urlPanelTime.relativeTimePeriod) {
              const result = getConsumableRelativeTime(urlPanelTime.relativeTimePeriod);
              if (result) {
                effectiveTime = {
                  start_time: new Date(result.startTime),
                  end_time: new Date(result.endTime),
                };
              }
            } else if (urlPanelTime.valueType === 'absolute') {
              effectiveTime = {
                start_time: new Date(urlPanelTime.startTime),
                end_time: new Date(urlPanelTime.endTime),
              };
            }
          }
        }

        // Priority 2: Panel's configured time range
        if (!effectiveTime) {
          const panelTimeRange = dashboardPanelData.data.config?.panel_time_range;
          const pickerValue = convertPanelTimeRangeToPicker(panelTimeRange);

          if (pickerValue) {
            if (pickerValue.valueType === 'relative' && pickerValue.relativeTimePeriod) {
              const result = getConsumableRelativeTime(pickerValue.relativeTimePeriod);
              if (result) {
                effectiveTime = {
                  start_time: new Date(result.startTime),
                  end_time: new Date(result.endTime),
                };
              }
            } else if (pickerValue.valueType === 'absolute') {
              effectiveTime = {
                start_time: new Date(pickerValue.startTime),
                end_time: new Date(pickerValue.endTime),
              };
            }
          }
        }

        // Priority 3: If panel doesn't have its own time or conversion failed, use global time
        if (!effectiveTime) {
          const date = dateTimePickerRef.value?.getConsumableDateTime();
          effectiveTime = {
            start_time: new Date(date.startTime),
            end_time: new Date(date.endTime),
          };
        }

        // Set the effective time for chart rendering
        dashboardPanelData.meta.dateTime = effectiveTime;

        // Use global time for variables (as variables should use global time context)
        dateTimeForVariables.value = {
          start_time: new Date(selectedDate.value.startTime),
          end_time: new Date(selectedDate.value.endTime),
        };

        router.replace({
          query: {
            ...route.query,
            ...getQueryParamsForDuration(selectedDate.value),
          },
        });
      }
    };

    const goBack = async () => {
      // Clean up variables created during this session (on discard)
      // Remove variables that were created in this session from the dashboard data
      if (variablesCreatedInSession.value.length > 0 && currentDashboardData.data?.variables?.list) {
        currentDashboardData.data.variables.list = currentDashboardData.data.variables.list.filter(
          (v: any) => !variablesCreatedInSession.value.includes(v.name)
        );
      }

      // Clear the tracking arrays
      variablesCreatedInSession.value = [];
      variablesWithCurrentPanel.value = [];

      return router.push({
        path: "/dashboards/view",
        query: {
          ...routeQueryParamsOnMount,
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          tab: route.query.tab ?? currentDashboardData?.data?.tabs?.[0]?.tabId,
        },
      });
    };

    //watch dashboardpaneldata when changes, isUpdated will be true
    watch(
      () => dashboardPanelData.data,
      () => {
        if (isPanelConfigWatcherActivated) {
          isPanelConfigChanged.value = true;
        }
      },
      { deep: true },
    );

    const beforeUnloadHandler = (e: any) => {
      //check is data updated or not
      if (isPanelConfigChanged.value) {
        // Display a confirmation message
        const confirmMessage = t("dashboard.unsavedMessage"); // Some browsers require a return statement to display the message
        e.returnValue = confirmMessage;
        return confirmMessage;
      }
      return;
    };

    // this is used to set to true, when we know we have to force the navigation
    // in cases where org is changed, we need to force a nvaigation, without warning
    let forceSkipBeforeUnloadListener = false;

    onBeforeRouteLeave((to, from, next) => {
      // check if it is a force navigation, then allow
      if (forceSkipBeforeUnloadListener) {
        next();
        return;
      }

      // else continue to warn user
      if (from.path === "/dashboards/add_panel" && isPanelConfigChanged.value) {
        const confirmMessage = t("dashboard.unsavedMessage");
        if (window.confirm(confirmMessage)) {
          // User confirmed navigation - clean up variables created during this session
          if (variablesCreatedInSession.value.length > 0 && currentDashboardData.data?.variables?.list) {
            currentDashboardData.data.variables.list = currentDashboardData.data.variables.list.filter(
              (v: any) => !variablesCreatedInSession.value.includes(v.name)
            );
          }
          variablesCreatedInSession.value = [];
          variablesWithCurrentPanel.value = [];
          // User confirmed, allow navigation
          next();
        } else {
          // User canceled, prevent navigation
          next(false);
        }
      } else {
        // No unsaved changes or not leaving the edit route, allow navigation
        next();
      }
    });
    const panelTitle = computed(() => {
      return { title: dashboardPanelData.data.title };
    });

    //validate the data
    const isValid = (onlyChart = false, isFieldsValidationRequired = true) => {
      const errors = errorData.errors;
      errors.splice(0);
      const dashboardData = dashboardPanelData;

      // check if name of panel is there
      if (!onlyChart) {
        if (
          dashboardData.data.title == null ||
          dashboardData.data.title.trim() == ""
        ) {
          errors.push("Name of Panel is required");
        }
      }

      // will push errors in errors array
      validatePanel(errors, isFieldsValidationRequired);

      if (errors.length) {
        showErrorNotification(
          "There are some errors, please fix them and try again",
        );
      }

      if (errors.length) {
        return false;
      } else {
        return true;
      }
    };

    const savePanelChangesToDashboard = async (dashId: string) => {
      if (
        dashboardPanelData.data.type === "custom_chart" &&
        errorData.errors.length > 0
      ) {
        showErrorNotification(
          "There are some errors, please fix them and try again",
        );
        return;
      }
      if (!isValid(false, true)) {
        return;
      }

      try {
        if (editMode.value) {
          // If variables were created during edit session, we need to save them too
          if (variablesCreatedInSession.value.length > 0) {
            // Update variables with "current_panel" to use the actual panel ID
            const currentPanelIdValue = route.query.panelId as string;

            variablesWithCurrentPanel.value.forEach((variableName) => {
              const variable = currentDashboardData.data?.variables?.list?.find(
                (v: any) => v.name === variableName,
              );
              if (variable && variable.panels && currentPanelIdValue) {
                const index = variable.panels.indexOf("current_panel");
                if (index !== -1) {
                  variable.panels[index] = currentPanelIdValue;
                }
              }
            });

            // Update the panel data in currentDashboardData
            const tab = currentDashboardData.data.tabs.find(
              (t: any) =>
                t.tabId ===
                (route.query.tab ?? currentDashboardData.data.tabs[0].tabId),
            );
            if (tab) {
              const panelIndex = tab.panels.findIndex(
                (p: any) => p.id === dashboardPanelData.data.id,
              );
              if (panelIndex !== -1) {
                tab.panels[panelIndex] = dashboardPanelData.data;
              }
            }

            // Save the entire dashboard (including new variables and updated panel)
            const errorMessageOnSave = await updateDashboard(
              store,
              store.state.selectedOrganization.identifier,
              dashId,
              currentDashboardData.data,
              route.query.folder ?? "default",
            );

            if (errorMessageOnSave instanceof Error) {
              errorData.errors.push(
                "Error saving panel configuration : " +
                  errorMessageOnSave.message,
              );
              return;
            }
          } else {
            // No new variables, just update the panel
            const errorMessageOnSave = await updatePanel(
              store,
              dashId,
              dashboardPanelData.data,
              route.query.folder ?? "default",
              route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
            );
            if (errorMessageOnSave instanceof Error) {
              errorData.errors.push(
                "Error saving panel configuration : " +
                  errorMessageOnSave.message,
              );
              return;
            }
          }
        } else {
          const panelId =
            "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;

          dashboardPanelData.data.id = panelId;
          chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
          panelEditorRef.value?.initChartData(dashboardPanelData.data);

          // Replace "current_panel" with actual panel ID in variables before saving
          if (variablesWithCurrentPanel.value.length > 0) {
            variablesWithCurrentPanel.value.forEach((variableName) => {
              const variable = currentDashboardData.data?.variables?.list?.find(
                (v: any) => v.name === variableName,
              );
              if (variable && variable.panels) {
                variable.panels = variable.panels.map((id: string) =>
                  id === "current_panel" ? panelId : id
                );
              }
            });
          }

          // Prepare variables to update (if any were created during this session)
          const variablesToUpdate = variablesCreatedInSession.value.length > 0
            ? { variableNames: variablesCreatedInSession.value, newPanelId: panelId }
            : undefined;

          // Prepare list of new variable objects to add to dashboard
          const newVariablesList = variablesCreatedInSession.value.length > 0
            ? variablesCreatedInSession.value.map((name: string) =>
                currentDashboardData.data?.variables?.list?.find((v: any) => v.name === name)
              ).filter((v: any) => v !== undefined)
            : undefined;

          const errorMessageOnSave = await addPanel(
            store,
            dashId,
            dashboardPanelData.data,
            route.query.folder ?? "default",
            route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
            variablesToUpdate,
            newVariablesList
          );
          if (errorMessageOnSave instanceof Error) {
            errorData.errors.push(
              "Error saving panel configuration  : " +
                errorMessageOnSave.message,
            );
            return;
          }
        }

        isPanelConfigWatcherActivated = false;
        isPanelConfigChanged.value = false;

        // Clear variables created during session since panel is being saved
        variablesCreatedInSession.value = [];
        variablesWithCurrentPanel.value = [];

        await nextTick();
        return router.push({
          path: "/dashboards/view",
          query: {
            ...routeQueryParamsOnMount,
            org_identifier: store.state.selectedOrganization.identifier,
            dashboard: dashId,
            folder: route.query.folder ?? "default",
            tab: route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
          },
        });
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              (editMode.value
                ? "Error while updating panel"
                : "Error while creating panel"),
          );
        } else {
          showErrorNotification(
            error?.message ??
              (editMode.value
                ? "Error while updating panel"
                : "Error while creating panel"),
            {
              timeout: 2000,
            },
          );
        }
      }
    };

    const expandedSplitterHeight = ref(null);

    const handleChartApiError = (errorMsg: any) => {
      if (typeof errorMsg === "string") {
        errorMessage.value = errorMsg;
        const errorList = errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg);
      } else if (errorMsg?.message) {
        errorMessage.value = errorMsg.message ?? "";
        const errorList = errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg.message);
      } else {
        errorMessage.value = "";
      }
    };

    const onDataZoom = (event: any) => {
      const selectedDateObj = {
        start: new Date(event.start),
        end: new Date(event.end),
      };
      // Truncate seconds and milliseconds from the dates
      selectedDateObj.start.setSeconds(0, 0);
      selectedDateObj.end.setSeconds(0, 0);

      // Compare the truncated dates
      if (selectedDateObj.start.getTime() === selectedDateObj.end.getTime()) {
        // Increment the end date by 1 minute
        selectedDateObj.end.setMinutes(selectedDateObj.end.getMinutes() + 1);
      }

      // set it as a absolute time
      dateTimePickerRef?.value?.setCustomDate("absolute", selectedDateObj);
    };

    // [START] cancel running queries

    //reactive object for loading state of variablesData and panels
    const variablesAndPanelsDataLoadingState = reactive({
      variablesData: {},
      panels: {},
      searchRequestTraceIds: {},
    });

    // provide variablesAndPanelsDataLoadingState to share data between components
    provide(
      "variablesAndPanelsDataLoadingState",
      variablesAndPanelsDataLoadingState,
    );

    const searchRequestTraceIds = computed(() => {
      const searchIds = Object.values(
        variablesAndPanelsDataLoadingState.searchRequestTraceIds,
      ).filter((item: any) => item.length > 0);

      return searchIds.flat() as string[];
    });
    const { traceIdRef, cancelQuery } = useCancelQuery();

    const cancelAddPanelQuery = () => {
      traceIdRef.value = searchRequestTraceIds.value;
      cancelQuery();
    };

    const disable = ref(false);

    watch(variablesAndPanelsDataLoadingState, () => {
      const panelsValues = Object.values(
        variablesAndPanelsDataLoadingState.panels,
      );
      disable.value = panelsValues.some((item: any) => item === true);
    });

    const onApplyBtnClick = () => {
      if (searchRequestTraceIds.value.length > 0) {
        cancelAddPanelQuery();
      } else {
        runQuery();
      }
    };

    // [END] cancel running queries

    const inputStyle = computed(() => {
      if (!dashboardPanelData.data.title) {
        return { width: "200px" };
      }

      const contentWidth = Math.min(
        dashboardPanelData.data.title.length * 8 + 60,
        400,
      );
      return { width: `${contentWidth}px` };
    });

    const debouncedUpdateChartConfig = debounce((newVal, oldVal) => {
      if (!isEqual(chartData.value, newVal)) {
        const configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          newVal,
        );

        if (!configNeedsApiCall) {
          chartData.value = JSON.parse(JSON.stringify(newVal));
          panelEditorRef.value?.initChartData(newVal);

          window.dispatchEvent(new Event("resize"));
        }
      }
    }, 1000);

    watch(() => dashboardPanelData.data, debouncedUpdateChartConfig, {
      deep: true,
    });
    // [START] ai chat

    // [START] O2 AI Context Handler

    const registerAiContextHandler = () => {
      registerAiChatHandler(getContext);
    };

    const getContext = async () => {
      return new Promise(async (resolve, reject) => {
        try {
          const isAddPanelPage = router.currentRoute.value.name === "addPanel";

          const isStreamSelectedInDashboardPage =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream;

          if (!isAddPanelPage || !isStreamSelectedInDashboardPage) {
            resolve("");
            return;
          }

          const payload = {};

          const stream =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream;

          const streamType =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream_type;

          if (!streamType || !stream?.length) {
            resolve("");
            return;
          }

          const schema = await getStream(stream, streamType, true);

          payload["stream_name"] = stream;
          payload["schema"] = schema.uds_schema || schema.schema || [];

          resolve(payload);
        } catch (error) {
          console.error("Error in getContext for add panel page", error);
          resolve("");
        }
      });
    };

    const removeAiContextHandler = () => {
      removeAiChatHandler();
    };

    // [END] O2 AI Context Handler

    // Computed properties for current tab and panel IDs
    const currentTabId = computed(() => {
      return (
        (route.query.tab as string) ??
        currentDashboardData.data?.tabs?.[0]?.tabId
      );
    });

    const currentPanelId = computed(() => {
      // In edit mode, use the panelId from query params
      if (editMode.value && route.query.panelId) {
        return route.query.panelId as string;
      }
      // In add mode, use "current_panel" as the panel ID before the panel is saved
      // This allows variables scoped to "current_panel" to be visible
      return dashboardPanelData.data.id || "current_panel";
    });

    /**
     * Opens the Add Variable panel
     */
    const handleOpenAddVariable = () => {
      selectedVariableToEdit.value = null;
      isAddVariableOpen.value = true;
    };

    /**
     * Closes the Add Variable panel without saving changes
     */
    const handleCloseAddVariable = () => {
      isAddVariableOpen.value = false;
      selectedVariableToEdit.value = null;
      // Don't reload dashboard - user is canceling/discarding the variable creation
    };

    /**
     * Handles saving a variable - reloads dashboard to reflect the saved variable
     */
    const handleSaveVariable = async (payload: any) => {
      isAddVariableOpen.value = false;

      const { variableData, isEdit, oldVariableName } = payload || {};

      // If payload is missing, return (should not happen)
      if (!variableData) {
        return;
      }

      if (!currentDashboardData.data.variables) {
        currentDashboardData.data.variables = { list: [] };
      }

      const variablesList = currentDashboardData.data.variables.list;

      if (isEdit) {
        // Find and update
        const index = variablesList.findIndex(
          (v: any) => v.name === oldVariableName,
        );
        if (index !== -1) {
          variablesList[index] = variableData;
          // Also update tracking
          if (
            variablesCreatedInSession.value.includes(oldVariableName) &&
            oldVariableName !== variableData.name
          ) {
            const trackIndex =
              variablesCreatedInSession.value.indexOf(oldVariableName);
            variablesCreatedInSession.value[trackIndex] = variableData.name;
          }
          if (
            variablesWithCurrentPanel.value.includes(oldVariableName) &&
            oldVariableName !== variableData.name
          ) {
            const trackIndex =
              variablesWithCurrentPanel.value.indexOf(oldVariableName);
            variablesWithCurrentPanel.value[trackIndex] = variableData.name;
          }
        }
      } else {
        // Add new
        variablesList.push(variableData);
        // Track
        if (!variablesCreatedInSession.value.includes(variableData.name)) {
          variablesCreatedInSession.value.push(variableData.name);
        }
      }

      // Update variablesWithCurrentPanel tracking
      const usesCurrentPanel =
        variableData.panels && variableData.panels.includes("current_panel");
      if (usesCurrentPanel) {
        if (!variablesWithCurrentPanel.value.includes(variableData.name)) {
          variablesWithCurrentPanel.value.push(variableData.name);
        }
      } else {
        // If it was tracked but no longer uses current_panel, remove it
        const idx = variablesWithCurrentPanel.value.indexOf(variableData.name);
        if (idx !== -1) {
          variablesWithCurrentPanel.value.splice(idx, 1);
        }
      }

      selectedVariableToEdit.value = null;

      // Re-initialize manager with updated list
      await variablesManager.initialize(
        variablesList,
        currentDashboardData.data,
      );

      // Restore visibility
      // 1. Tab visibility
      const tabId = currentTabId.value;
      if (tabId) {
        variablesManager.setTabVisibility(tabId, true);
      }

      // 2. Panel visibility (Edit Mode)
      if (editMode.value && route.query.panelId) {
        variablesManager.setPanelVisibility(
          route.query.panelId as string,
          true,
        );
      } else {
        // 3. Panel visibility (Add Mode - current_panel)
        // In add mode, mark "current_panel" as visible so variables can load
        variablesManager.setPanelVisibility("current_panel", true);
      }

      // 4. Additionally, if any variable uses "current_panel", ensure it's visible
      if (variablesWithCurrentPanel.value.length > 0) {
        variablesManager.setPanelVisibility("current_panel", true);
      }

      // 5. Trigger variable data reload to ensure new variables are displayed
      // Wait for Vue to process the manager updates
      await nextTick();

      // The VariablesValueSelector components should automatically pick up
      // the new variables from the manager through their computed properties
    };

    const isPartialData = ref(false);
    const isPanelLoading = ref(false);
    const isCachedDataDifferWithCurrentTimeRange = ref(false);

    const handleIsPartialDataUpdate = (data: boolean) => {
      isPartialData.value = data;
    };

    const handleLoadingStateChange = (data: boolean) => {
      isPanelLoading.value = data;
    };

    const handleIsCachedDataDifferWithCurrentTimeRangeUpdate = (data: boolean) => {
      isCachedDataDifferWithCurrentTimeRange.value = data;
    };

    return {
      t,
      updateDateTime,
      goBack,
      savePanelChangesToDashboard,
      runQuery,
      expandedSplitterHeight,
      currentDashboard,
      list,
      dashboardPanelData,
      chartData,
      editMode,
      selectedDate,
      errorData,
      handleChartApiError,
      variablesDataUpdated,
      currentDashboardData,
      variablesData,
      liveVariablesData,
      updatedVariablesData,
      savePanelData,
      resetAggregationFunction,
      isOutDated,
      store,
      dateTimePickerRef,
      showViewPanel,
      metaDataValue,
      metaData,
      panelTitle,
      onDataZoom,
      showTutorial,
      queryParams: route.query as any,
      initialVariableValues,
      lastTriggeredAt,
      handleLastTriggeredAtUpdate,
      searchRequestTraceIds,
      cancelAddPanelQuery,
      disable,
      config,
      inputStyle,
      setTimeForVariables,
      dateTimeForVariables,
      seriesData,
      onApplyBtnClick,
      shouldRefreshWithoutCache,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      errorMessage,
      isAddVariableOpen,
      selectedVariableToEdit,
      handleOpenAddVariable,
      handleCloseAddVariable,
      handleSaveVariable,
      currentTabId,
      currentPanelId,
      panelEditorRef,
      dashboardDataForPanelEditor,
    };
  },
  methods: {
    goBackToDashboardList(evt: any, row: any) {
      this.goBack();
    },
  },
});
</script>

<style lang="scss" scoped>
.dynamic-input {
  min-width: 200px;
  max-width: 500px;
  transition: width 0.2s ease;
}

.add-variable-drawer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 6000;
  display: flex;
  justify-content: flex-end;
}

.add-variable-drawer-panel {
  width: 900px;
  height: 100vh;
  background-color: white;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  border-radius: 0 !important;

  :deep(.column.full-height) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  :deep(.scrollable-content) {
    max-height: calc(100vh - 140px);
    overflow-y: auto;
  }

  :deep(.sticky-footer) {
    padding: 6px 6px;
    margin-top: auto;
  }
}

.theme-dark .add-variable-drawer-panel {
  background-color: #1a1a1a;
}
</style>
