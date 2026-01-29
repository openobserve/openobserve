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
  <VisualizationLayout
    :containerStyle="{ overflowY: 'auto' }"
    containerClass="scroll"
    :dashboardPanelData="dashboardPanelData"
    :chartData="chartData"
    :seriesData="seriesData"
    :errorData="errorData"
    :metaData="metaData"
    showHeader
    showHeaderTitle
    :headerTitle="editMode ? t('panel.editPanel') : t('panel.addPanel')"
    showPanelNameInput
    :inputStyle="inputStyle"
    showTutorialButton
    showQueryInspectorButton
    :showQueryInspectorDialog="showViewPanel"
    showDateTimePicker
    v-model:selectedDate="selectedDate"
    :dateTimePickerDisabled="disable"
    showDiscardButton
    showSaveButton
    :saveLoading="savePanelData.isLoading.value"
    showApplyButton
    :applyLoading="searchRequestTraceIds.length > 0"
    :applyDisabled="searchRequestTraceIds.length > 0"
    :splitterLimits="[0, 20]"
    :editMode="editMode"
    showQueryBuilder
    :dashboardData="currentDashboardData.data"
    showQueryEditor
    showVariablesSelector
    :variablesConfig="currentDashboardData.data?.variables"
    :showDynamicFilters="currentDashboardData.data?.variables?.showDynamicFilters"
    :dateTimeForVariables="dateTimeForVariables"
    :initialVariableValues="initialVariableValues"
    showAddVariableButton
    :showVariablesAllVisible="true"
    :currentTabId="currentTabId"
    :currentPanelId="currentPanelId"
    :updatedVariablesData="updatedVariablesData"
    :liveVariablesData="liveVariablesData"
    :isOutDated="isOutDated"
    :errorMessage="errorMessage"
    :maxQueryRangeWarning="maxQueryRangeWarning"
    :limitNumberOfSeriesWarningMessage="limitNumberOfSeriesWarningMessage"
    showLastRefreshed
    :lastTriggeredAt="lastTriggeredAt"
    :dashboardId="queryParams?.dashboard"
    :folderId="queryParams?.folder"
    :allowAnnotationsAdd="editMode"
    :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
    :showLegendsButton="true"
    searchType="dashboards"
    :panelTitle="panelTitle"
    :customChartSplitterModel="splitterModel"
    showCustomChartExamplesButton
    ref="panelSchemaRendererRef"
    @showTutorial="showTutorial"
    @showQueryInspector="showViewPanel = true"
    @closeQueryInspector="showViewPanel = false"
    @dateTimePickerHide="setTimeForVariables"
    @discard="goBackToDashboardList"
    @save="savePanelData.execute()"
    @apply="runQuery"
    @applyClick="onApplyBtnClick"
    @chartTypeChange="resetAggregationFunction"
    @collapseFieldList="collapseFieldList"
    @metadataUpdate="metaDataValue"
    @resultMetadataUpdate="handleResultMetadataUpdate"
    @limitWarningUpdate="handleLimitNumberOfSeriesWarningMessage"
    @chartError="handleChartApiError"
    @dataZoom="onDataZoom"
    @vrlFunctionFieldListUpdate="updateVrlFunctionFieldList"
    @lastTriggeredAtUpdate="handleLastTriggeredAtUpdate"
    @seriesDataUpdate="seriesDataUpdate"
    @showLegends="showLegendsDialog = true"
    @customChartTemplateSelected="handleCustomChartTemplateSelected"
    @variablesData="variablesDataUpdated"
    @openAddVariable="handleOpenAddVariable"
    @customChartSplitterUpdate="splitterModel = $event"
    @openCustomChartTypeSelector="openCustomChartTypeSelector"
  >
    <template #dialogs>
      <!-- Show Legends Dialog -->
      <q-dialog v-model="showLegendsDialog">
        <ShowLegendsPopup
          :panelData="currentPanelData"
          @close="showLegendsDialog = false"
        />
      </q-dialog>

      <!-- Custom Chart Type Selector Dialog -->
      <q-dialog v-model="showCustomChartTypeSelector">
        <CustomChartTypeSelector
          @select="handleChartTypeSelection"
          @close="showCustomChartTypeSelector = false"
        />
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
    </template>
  </VisualizationLayout>
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
import VisualizationLayout from "../../../components/dashboards/VisualizationLayout.vue";
import CustomChartTypeSelector from "../../../components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue";

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
import { loadCustomChartTemplate } from "@/components/dashboards/addPanel/customChartExamples/customChartTemplates";
import {
  createDashboardsContextProvider,
  contextRegistry,
} from "@/composables/contextProviders";
import {
  outlinedWarning,
  outlinedRunningWithErrors,
} from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";
import { processQueryMetadataErrors } from "@/utils/zincutils";
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";

const ShowLegendsPopup = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/ShowLegendsPopup.vue");
});

export default defineComponent({
  name: "AddPanel",
  props: ["metaData"],

  components: {
    VisualizationLayout,
    ShowLegendsPopup,
    AddSettingVariable,
    CustomChartTypeSelector,
  },
  setup(props) {
    provide("dashboardPanelDataPageKey", "dashboard");

    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref();
    const showLegendsDialog = ref(false);
    const panelSchemaRendererRef: any = ref(null);
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
    const splitterModel = ref(50);
    const errorData: any = reactive({
      errors: [],
    });
    let variablesData: any = reactive({});
    const { registerAiChatHandler, removeAiChatHandler } = useAiChat();
    const { getStream } = useStreams();
    const seriesData = ref([]);
    const shouldRefreshWithoutCache = ref(false);

    // Custom Chart Type Selector
    const selectedCustomChartType = ref(null);
    const showCustomChartTypeSelector = ref(false);

    const openCustomChartTypeSelector = () => {
      showCustomChartTypeSelector.value = true;
    };

    const handleChartTypeSelection = async (selection: any) => {
      // Extract chart and replaceQuery option from the selection
      const chart = selection.chart || selection; // Support both old and new format
      const replaceQuery = selection.replaceQuery ?? false; // Default to false (unchecked)

      selectedCustomChartType.value = chart;

      try {
        // Lazy load the template
        const template = await loadCustomChartTemplate(chart.value);

        if (template) {
          // Keep the default commented instructions and only replace the option code
          const defaultComments = `// To know more about ECharts ,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple
// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from the search result and it is an array.
`;
          dashboardPanelData.data.customChartContent =
            defaultComments + template.code;

          // Handle query replacement based on user selection
          const currentQueryIndex =
            dashboardPanelData.layout.currentQueryIndex || 0;
          if (dashboardPanelData.data.queries[currentQueryIndex]) {
            if (replaceQuery && template.query && template.query.trim()) {
              // Replace with example query if option is selected
              dashboardPanelData.data.queries[currentQueryIndex].query =
                template.query.trim();
              // Enable custom query mode for custom charts
              dashboardPanelData.data.queries[currentQueryIndex].customQuery =
                true;
            }
            // If replaceQuery is false, preserve the existing query (do nothing)
          }
        }
      } catch (error) {
        showErrorNotification(
          "There was an error applying the chart example code. Please try again",
        );
      }
    };

    const seriesDataUpdate = (data: any) => {
      seriesData.value = data;
    };

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
      // console.time("metaDataValue");
      metaData.value = metadata;
      // console.timeEnd("metaDataValue");
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

    // this is used to activate the watcher only after on mounted
    let isPanelConfigWatcherActivated = false;
    const isPanelConfigChanged = ref(false);

    const savePanelData = useLoading(async () => {
      // console.time("savePanelData");
      const dashboardId = route.query.dashboard + "";
      await savePanelChangesToDashboard(dashboardId);
      // console.timeEnd("savePanelData");
    });

    onUnmounted(async () => {
      // console.time("onUnmounted");
      // clear a few things
      resetDashboardPanelData();

      // remove beforeUnloadHandler event listener
      window.removeEventListener("beforeunload", beforeUnloadHandler);

      removeAiContextHandler();

      // Clean up dashboard context provider
      contextRegistry.unregister("dashboards");
      contextRegistry.setActive("");

      // console.timeEnd("onUnmounted");
    });

    onMounted(async () => {
      // assign the route query params
      routeQueryParamsOnMount = JSON.parse(JSON.stringify(route?.query ?? {}));

      errorData.errors = [];

      // console.time("onMounted");
      // todo check for the edit more
      if (route.query.panelId) {
        editMode.value = true;
      }

      await getDashboardData();

      // get panel data and set it to the dashboardPanelData.data
      if (editMode.value) {
        setPanelForEditing();
      } else {
        // get the stream details and show the fields
        resetDashboardPanelDataAndAddTimeField();

        // get time field which is starting with "_timestamp" prefix
        // if the stream is missing a time field, then first field will be selected automatically
        const timeField: any = Object.keys(
          currentDashboardData.data.config.stream_fields?.[
            dashboardPanelData.data.queries[0].fields.stream
          ] || {},
        ).find((key: any) => key.startsWith("_timestamp"));

        // set x-axis value
        if (timeField) {
          dashboardPanelData.data.queries[0].fields.x[0].label = timeField;
          dashboardPanelData.data.queries[0].fields.x[0].alias = "x_axis_1";
          dashboardPanelData.data.queries[0].fields.x[0].column = timeField;
        }
      }

      // Initialize datetime picker value
      // check if route has time related query params
      // if not, take dashboard default time settings
      if (!((route.query.from && route.query.to) || route.query.period)) {
        // if dashboard has relative time settings
        if (
          (currentDashboardData.data?.defaultDatetimeDuration?.type ?? "relative") === "relative"
        ) {
          selectedDate.value = {
            valueType: "relative",
            relativeTimePeriod:
              currentDashboardData.data?.defaultDatetimeDuration?.relativeTimePeriod ?? "15m",
          };
        } else {
          // else, dashboard will have absolute time settings
          selectedDate.value = {
            valueType: "absolute",
            startTime: currentDashboardData.data?.defaultDatetimeDuration?.startTime,
            endTime: currentDashboardData.data?.defaultDatetimeDuration?.endTime,
          };
        }
      } else {
        // take route time related query params
        if (route.query.period) {
          selectedDate.value = {
            valueType: "relative",
            relativeTimePeriod: route.query.period,
          };
        } else if (route.query.from && route.query.to) {
          selectedDate.value = {
            valueType: "absolute",
            startTime: new Date(parseInt(route.query.from as string)),
            endTime: new Date(parseInt(route.query.to as string)),
          };
        }
      }

      // Initialize dashboard context provider
      await setupContextProvider();

      if (!editMode.value && isInitialDashboardPanelData()) {
        // in add mode, do not render the chart initially
      } else {
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      }

      nextTick(() => {
        isPanelConfigWatcherActivated = true;
      });
    });

    // watcher for dashboard panel data
    // this will ensure that whenever user changes any config, the chart will be re-rendered

    watch(
      () => JSON.stringify(dashboardPanelData.data),
      (newValue: any, oldValue: any) => {
        if (!isPanelConfigWatcherActivated) return;
        // console.time("watch:dashboardPanelData.data");
        // parse to see if objects are same or not
        const newValueObj = JSON.parse(newValue);
        const oldValueObj = JSON.parse(oldValue);

        if (
          checkIfConfigChangeRequiredApiCallOrNot(newValueObj, oldValueObj)
        ) {
          isPanelConfigChanged.value = true;
        } else {
          chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        }
        // console.timeEnd("watch:dashboardPanelData.data");
      },
    );

    watch(
      () => dashboardPanelData.data.type,
      async (newValue: any, oldValue: any) => {
        // console.time("watch:dashboardPanelData.data.type");
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        // console.timeEnd("watch:dashboardPanelData.data.type");
      },
    );
    const dateTimeForVariables = ref(null);

    const setTimeForVariables = () => {
      // Access dateTimePickerRef through the exposed VisualizationLayout ref
      const date = panelSchemaRendererRef.value?.dateTimePickerRef?.getConsumableDateTime();
      if (!date) return;

      const startTime = new Date(date.startTime);
      const endTime = new Date(date.endTime);

      // Update only the variables time object
      dateTimeForVariables.value = {
        start_time: startTime,
        end_time: endTime,
      };
    };

    /**
     * get the fresh data of dashboard as we are updating the dashboard data from the config settings
     * So we need to get the fresh data from the store instead of the old state
     */
    const getDashboardData = async () => {
      // console.time("getDashboardData");
      await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default",
      ).then((data: any) => {
        // this is the current dashboard data
        currentDashboardData.data = data;

        // Capture initial variable names for cleanup tracking
        initialVariableNames.value = (data?.variables?.list || []).map((v: any) => v.name);

        // Track variables with "current_panel" dependency
        const panelScopedVars = (data?.variables?.list || []).filter((v: any) =>
          v.query_data?.query?.includes("current_panel"),
        );
        variablesWithCurrentPanel.value = panelScopedVars.map((v: any) => v.name);

        // Initialize variablesManager AFTER we have dashboard data
        if (variablesManager && variablesManager.variablesData.isInitialized === false) {
          variablesManager.initialize(
            data?.variables?.list || [],
            data,
            { [currentPanelId.value]: currentTabId.value },
          );
        }
      });
      // console.timeEnd("getDashboardData");
    };

    /**
     * isInitialDashboardPanelData will check if the dashboardPanelData.data is initial state or not
     */
    const isInitialDashboardPanelData = () => {
      // console.time("isInitialDashboardPanelData");
      // first check if any custom query is there or not
      const customQuery = dashboardPanelData.data.queries.some(
        (it: any) => it.customQuery == true,
      );

      // if custom query is there, then return false
      if (customQuery) return false;

      // check if Y-Axis has any field selected or not
      const isYAxisEmpty = dashboardPanelData.data.queries.every(
        (it: any) => it.fields.y.length == 0,
      );

      // if y-axis is empty, then return true
      return isYAxisEmpty;
      // console.timeEnd("isInitialDashboardPanelData");
    };

    /**
     * This function will set the dashboard for editing
     */
    const setPanelForEditing = () => {
      // console.time("setPanelForEditing");
      try {
        const panelData: any = getPanel(
          store,
          route.query.dashboard,
          route.query.tab,
          route.query.panelId,
          route.query.folder ?? "default",
        );

        if (panelData) {
          Object.assign(dashboardPanelData.data, JSON.parse(JSON.stringify(panelData)));
        }
        // console.timeEnd("setPanelForEditing");
      } catch (e: any) {
        // console.timeEnd("setPanelForEditing");
        showErrorNotification(e.message);
        goBack();
      }
    };

    // Navigation
    const goBack = async () => {
      // Clean up variables created during this session (on discard)
      // Remove variables that were created in this session from the dashboard data
      if (variablesCreatedInSession.value.length > 0 && currentDashboardData.data?.variables?.list) {
        currentDashboardData.data.variables.list = currentDashboardData.data.variables.list.filter(
          (v: any) => !variablesCreatedInSession.value.includes(v.name)
        );

        // Update the dashboard with cleaned variables
        await updateDashboard(
          store,
          store.state.selectedOrganization.identifier,
          route.query.dashboard,
          currentDashboardData.data,
          route.query.folder ?? "default",
        );
      }

      await router.push({
        path: "/dashboards",
        query: {
          ...routeQueryParamsOnMount,
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
        },
      });
    };

    const getConsumableDateTime = () => {
      const dateTime =
        selectedDate.value != null &&
        selectedDate.value.tab != "relative" &&
        selectedDate.value?.start_time
          ? {
              start_time: new Date(selectedDate.value.start_time.toISOString()),
              end_time: new Date(selectedDate.value.end_time.toISOString()),
            }
          : panelSchemaRendererRef.value?.dateTimePickerRef?.getConsumableDateTime();
      return dateTime;
    };

    const updateDateTime = (value: object) => {
      selectedDate.value = value;
    };

    const getQueryParamsForDuration = (dateTime: any) => {
      const queryParams: any = {};

      // add period and refresh interval to query params
      if (dateTime?.period) {
        queryParams.period = dateTime.period;
      }

      if (dateTime?.refresh_interval) {
        queryParams.refresh = dateTime.refresh_interval;
      }

      // add from and to to query params
      if (dateTime?.start_time && dateTime?.end_time) {
        queryParams.from = dateTime.start_time.getTime();
        queryParams.to = dateTime.end_time.getTime();
      }

      return queryParams;
    };

    const runQuery = async (shouldRefresh = false) => {
      shouldRefreshWithoutCache.value = shouldRefresh;
      // console.time("runQuery");
      errorData.errors = [];

      // Validate panel (pass errorData.errors array, not t)
      validatePanel(errorData.errors, true);

      // Check if there are any validation errors
      if (errorData.errors.length > 0) {
        return false;
      }

      // if date is not set then show error notification and return
      const dateTime = getConsumableDateTime();
      if (!dateTime) {
        showErrorNotification("Please select date and time");
        return false;
      }

      // before running the query, mark the panel as out of date
      isPanelConfigChanged.value = false;

      // Commit the current live variables to updatedVariablesData (similar to ViewDashboard's apply behavior)
      updateCommittedVariables();

      const panelDataCopy = JSON.parse(JSON.stringify(dashboardPanelData.data));

      // update the datetime value
      panelDataCopy.queryData = {
        ...getConsumableDateTime(),
        // store the panel datetime period and refresh interval
        period: dateTime?.period,
        refresh_interval: dateTime?.refresh_interval,
      };

      if (
        panelDataCopy.type === "markdown" ||
        panelDataCopy.type === "html" ||
        panelDataCopy.type === "custom_chart"
      ) {
        chartData.value = panelDataCopy;
        return true;
      }

      // add default datetime in meta
      dashboardPanelData.meta.dateTime = dateTime;

      // add period and refresh interval to the metadata
      dashboardPanelData.meta.dateTime.period = dateTime?.period;
      dashboardPanelData.meta.dateTime.refresh_interval =
        dateTime?.refresh_interval;

      //this will enable to update the URL
      router.replace({
        query: {
          ...route.query,
          ...getQueryParamsForDuration(dateTime),
        },
      });

      // if query mode is custom, then get the data automatically
      if (dashboardPanelData.data.queries.some((it: any) => it.customQuery)) {
        chartData.value = JSON.parse(JSON.stringify(panelDataCopy));
        return true;
      }

      // if stream, x-axis and y-axis is not selected, then show error notification and return
      if (
        !dashboardPanelData.data.queries[0].fields.stream ||
        !dashboardPanelData.data.queries[0].fields.x.length ||
        !dashboardPanelData.data.queries[0].fields.y.length
      ) {
        showErrorNotification("Please select stream, x-axis and y-axis");
        return false;
      }

      makeAutoSQLQuery(
        store,
        // commented to allow the datetime to be updated because in auto sql query, we are using the datetime from the meta
        // getConsumableDateTime(),
      );
      await nextTick();
      chartData.value = panelDataCopy;
      // console.timeEnd("runQuery");
      return true;
    };

    /**
     * This function will save the panel changes to the dashboard
     */
    const savePanelChangesToDashboard = async (dashboardId: string) => {
      // console.time("savePanelChangesToDashboard");
      errorData.errors = [];

      // Validate panel (pass errorData.errors array, not t)
      validatePanel(errorData.errors, true);

      // Check if there are any validation errors
      if (errorData.errors.length > 0) {
        return false;
      }

      const currentPanelDataToSave = JSON.parse(
        JSON.stringify(dashboardPanelData.data),
      );

      let promise: any = null;
      let successMessage = "";

      // add the dynamic filters to the currentPanelData's filter
      // Only get panel-specific variables
      const panelScopedVariables = variablesManager
        ? variablesManager
            .getVariablesForPanel(currentPanelId.value, currentTabId.value || "")
            .filter((v: any) => v.scope === "panel" && v.name)
        : [];

      // Add panel-scoped variables to the panel's variables list
      if (panelScopedVariables.length > 0) {
        currentPanelDataToSave.variables = {
          list: panelScopedVariables.map((v: any) => {
            const { label, name, type, query_data, value } = v;
            return { label, name, type, query_data, value };
          }),
        };
      } else {
        // Ensure variables list exists (empty if no panel-specific variables)
        currentPanelDataToSave.variables = { list: [] };
      }

      // if in edit mode then update the panel else create new panel
      if (editMode.value) {
        // update the panel
        promise = updatePanel(
          store,
          dashboardId,
          route.query.tab,
          route.query.panelId,
          currentPanelDataToSave,
          route.query.folder ?? "default",
        );
        successMessage = "Panel updated successfully.";
      } else {
        promise = addPanel(
          store,
          dashboardId,
          route.query.tab,
          currentPanelDataToSave,
          route.query.folder ?? "default",
        );
        successMessage = "Panel added successfully.";
      }

      // Check if any variables were created with "current_panel" scope during this session
      // If yes, and if the panel is new (add mode) or edited, we need to:
      // 1. Get the saved panel ID
      // 2. Update all "current_panel" variables' query_data to use the actual panel ID
      // 3. Update the dashboard variables list
      const hasVariablesWithCurrentPanel =
        variablesWithCurrentPanel.value.length > 0 && !editMode.value;

      await promise
        .then(async (response: any) => {
          // After successful panel creation, update variables that use "current_panel"
          if (hasVariablesWithCurrentPanel) {
            // Get the newly created panel ID from the response
            const newPanelId = response?.data?.panelId || dashboardPanelData.data.id;

            if (newPanelId) {
              // Update all variables in the dashboard that use "current_panel" and were created in this session
              const updatedVariables = (
                currentDashboardData.data?.variables?.list || []
              ).map((v: any) => {
                if (
                  variablesWithCurrentPanel.value.includes(v.name) &&
                  v.query_data?.query?.includes("current_panel")
                ) {
                  return {
                    ...v,
                    query_data: {
                      ...v.query_data,
                      query: v.query_data.query.replace(
                        /current_panel/g,
                        newPanelId,
                      ),
                    },
                  };
                }
                return v;
              });

              // Update dashboard with corrected variable queries
              if (updatedVariables.length > 0) {
                await updateDashboard(
                  store,
                  store.state.selectedOrganization.identifier,
                  dashboardId,
                  {
                    ...currentDashboardData.data,
                    variables: {
                      ...currentDashboardData.data.variables,
                      list: updatedVariables,
                    },
                  },
                  route.query.folder ?? "default",
                );
              }
            }
          }

          showPositiveNotification(successMessage);
          await router.push({
            path: "/dashboards",
            query: {
              ...routeQueryParamsOnMount,
              dashboard: dashboardId,
              folder: route.query.folder ?? "default",
            },
          });
        })
        .catch((error: any) => {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ||
              "Something went wrong. Please try again.",
            () => {
              getDashboardData();
            },
          );
        });
      // console.timeEnd("savePanelChangesToDashboard");
    };

    const layoutSplitterUpdated = (value: any) => {
      // console.time("layoutSplitterUpdated");
      dashboardPanelData.layout.querySplitter = value;
      // console.timeEnd("layoutSplitterUpdated");
    };

    const handleCustomChartTemplateSelected = (template: any) => {
      // console.time("handleCustomChartTemplateSelected");
      // Template should have { code, query } format
      if (template?.code) {
        dashboardPanelData.data.customChartContent = template.code;
      }

      if (template?.query) {
        const currentQueryIndex =
          dashboardPanelData.layout.currentQueryIndex || 0;
        if (dashboardPanelData.data.queries[currentQueryIndex]) {
          dashboardPanelData.data.queries[currentQueryIndex].query =
            template.query;
          dashboardPanelData.data.queries[currentQueryIndex].customQuery = true;
        }
      }
      // console.timeEnd("handleCustomChartTemplateSelected");
    };

    // ======= Splitter Height Management =======
    const expandedSplitterHeight = ref<number>(480);
    const querySplitterUpdated = (value: any) => {
      // console.time("querySplitterUpdated");
      dashboardPanelData.layout.querySplitter = value;
      expandedSplitterHeight.value = value;
      // console.timeEnd("querySplitterUpdated");
    };

    // inject the list of current dashboard
    const currentDashboard: any = inject("currentDashboard");

    const list: any = inject("list");

    // ===== New Error Handling System (2024-01-23) =====

    const handleChartApiError = (data: any) => {
      errorData.errors = processQueryMetadataErrors(data);
    };

    const handleResultMetadataUpdate = (data: any) => {
      // Check if "Max query range exceeded" error exists
      const hasMaxQueryRangeError = data?.errors?.some((error: any) =>
        error.message.includes("Max query range exceeded"),
      );

      if (hasMaxQueryRangeError) {
        // Extract warning message if exists
        const warningError = data?.errors?.find(
          (error: any) =>
            error.message.includes("Max query range exceeded") &&
            error?.warnings?.[0]?.message,
        );

        if (warningError?.warnings?.[0]?.message) {
          maxQueryRangeWarning.value = warningError.warnings[0].message;
        }

        // Remove the error from the errors array, keeping only the warning
        const filteredErrors = data?.errors?.filter(
          (error: any) => !error.message.includes("Max query range exceeded"),
        );

        handleChartApiError({ errors: filteredErrors || [] });
        errorMessage.value = "";
      } else if (data?.errors && data?.errors?.length > 0) {
        // If there are other errors, display them
        handleChartApiError(data);

        if (data?.errors?.[0]?.message) {
          errorMessage.value = data.errors[0].message;
        }

        maxQueryRangeWarning.value = "";
      } else {
        // Clear both error and warning if no errors
        errorData.errors = [];
        errorMessage.value = "";
        maxQueryRangeWarning.value = "";
      }
    };

    const handleLimitNumberOfSeriesWarningMessage = (data: any) => {
      limitNumberOfSeriesWarningMessage.value = data;
    };

    const panelTitle = computed(() => {
      return {
        title: dashboardPanelData.data.title,
        queries: dashboardPanelData.data.queries,
      };
    });

    const onDataZoom = (data: any) => {
      // Update the datetime based on data zoom
      selectedDate.value.start_time = new Date(data.start);
      selectedDate.value.end_time = new Date(data.end);

      // Update the variables time
      dateTimeForVariables.value = {
        start_time: new Date(data.start),
        end_time: new Date(data.end),
      };
    };

    const updateVrlFunctionFieldList = (data: any) => {
      // get current query index and update the vrl function field list
      const currentQueryIndex = dashboardPanelData.layout.currentQueryIndex || 0;
      const currentQuery = dashboardPanelData.data.queries[currentQueryIndex];
      if (!currentQuery) return;

      currentQuery.vrlFunctionFieldList = data;
    };

    // ======= [START] O2 AI Context Handler =======
    const removeAiContextHandler = () => {
      removeAiChatHandler("dashboards");
    };

    const setupContextProvider = async () => {
      // Create and register the context provider
      const provider = await createDashboardsContextProvider(
        store,
        route,
        currentDashboardData,
        dashboardPanelData,
        chartData,
      );

      contextRegistry.register("dashboards", provider);
      contextRegistry.setActive("dashboards");
    };

    // Register the AI context handler for dashboards page
    registerAiChatHandler("dashboards", async (message: string) => {
      // [START] Build context about current state

      // Get current org
      const org = store?.state?.selectedOrganization?.identifier || "N/A";

      // Get dashboard metadata
      const dashboardInfo = {
        name: currentDashboardData.data?.title || "Untitled Dashboard",
        description: currentDashboardData.data?.description || "No description",
        mode: editMode.value ? "edit" : "add",
      };

      // Get panel configuration
      const panelInfo = {
        title: dashboardPanelData.data.title || "Untitled Panel",
        type: dashboardPanelData.data.type || "N/A",
        queries: dashboardPanelData.data.queries || [],
        hasErrors: errorData.errors?.length > 0,
        errors: errorData.errors || [],
      };

      // Get current query details (if any)
      const currentQueryIndex = dashboardPanelData.layout.currentQueryIndex || 0;
      const currentQuery = panelInfo.queries[currentQueryIndex];

      // Build the context string
      let context = `
Organization: ${org}

Dashboard: "${dashboardInfo.name}"
Description: ${dashboardInfo.description}
Mode: ${dashboardInfo.mode}

Panel: "${panelInfo.title}"
Chart Type: ${panelInfo.type}
Number of Queries: ${panelInfo.queries.length}

Current Query:
${currentQuery ? JSON.stringify(currentQuery, null, 2) : "No query selected"}

Stream Fields:
${
  currentQuery?.fields?.stream
    ? JSON.stringify(
        currentDashboardData.data.config?.stream_fields?.[
          currentQuery.fields.stream
        ] || {},
        null,
        2,
      )
    : "No stream selected"
}

${panelInfo.hasErrors ? `Errors:\n${JSON.stringify(panelInfo.errors, null, 2)}` : "No errors"}

Variables:
${JSON.stringify(variablesData.values || [], null, 2)}
      `.trim();

      // [END] Context building

      // Return the context to be used by AI
      return context;
    });

    // ======= [END] O2 AI Context Handler =======

    // ======= [START] beforeunload handler =======

    const beforeUnloadHandler = (event: any) => {
      event.preventDefault();
      event.returnValue = "";
    };

    onBeforeRouteLeave((to, from, next) => {
      // remove beforeUnloadHandler event listener
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      next();
    });

    // ======= [END] beforeunload handler =======

    // ======= [START] cancel running queries =======

    // Keep track of all search request trace IDs across all panels
    const variablesAndPanelsDataLoadingState: any = inject(
      "variablesAndPanelsDataLoadingState",
      reactive({
        variables: {},
        panels: {},
      }),
    );

    const searchRequestTraceIds = computed(() => {
      const searchIds = Object.values(
        variablesAndPanelsDataLoadingState.panels,
      ).map((panel: any) => panel?.traceId || null);

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

    const collapseFieldList = () => {
      if (dashboardPanelData.layout.showFieldList) {
        dashboardPanelData.layout.splitter = 0;
        dashboardPanelData.layout.showFieldList = false;
      } else {
        dashboardPanelData.layout.splitter = 20;
        dashboardPanelData.layout.showFieldList = true;
      }
    };

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

    // This is used to track whether we are OUT OF DATE (config changed but chart not refreshed)
    const isOutDated = computed(() => {
      // console.time("isOutDated");
      const result = isPanelConfigChanged.value;
      // console.timeEnd("isOutDated");
      return result;
    });

    const currentPanelData = computed(() => {
      // panelData is a ref exposed by PanelSchemaRenderer
      const rendererData = panelSchemaRendererRef.value?.panelData || {};
      return {
        ...rendererData,
        config: dashboardPanelData.data.config || {},
      };
    });

    // ============= [START] O2 AI Chat Integration =============

    // Register AI chat handler on mount
    onMounted(() => {
      registerAiChatHandler("dashboard-add-panel", async (message: string) => {
        // Return context for AI to understand current state
        const context = {
          dashboard: currentDashboardData.data?.title || "Untitled",
          panel: {
            title: dashboardPanelData.data.title || "Untitled Panel",
            type: dashboardPanelData.data.type,
            queries: dashboardPanelData.data.queries,
          },
          mode: editMode.value ? "edit" : "add",
        };

        return JSON.stringify(context, null, 2);
      });
    });

    // Cleanup on unmount
    onUnmounted(() => {
      removeAiChatHandler("dashboard-add-panel");
    });

    // ============= [END] O2 AI Chat Integration =============

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
      return "current_panel";
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

      try {
        // Determine the scope (panel, tab, or global)
        const scope = variableData.scope || "panel";
        const panelId = scope === "panel" ? currentPanelId.value : undefined;
        const tabId = scope === "tab" || scope === "panel" ? currentTabId.value : undefined;

        // Track created variables for cleanup on discard
        if (!isEdit && !initialVariableNames.value.includes(variableData.name)) {
          variablesCreatedInSession.value.push(variableData.name);
        }

        // Track if this variable uses "current_panel" dependency
        if (
          scope === "panel" &&
          variableData.query_data?.query?.includes("current_panel")
        ) {
          variablesWithCurrentPanel.value.push(variableData.name);
        }

        // Update variables using variablesManager
        if (variablesManager) {
          if (isEdit && oldVariableName && oldVariableName !== variableData.name) {
            // Rename: delete old, add new
            await variablesManager.deleteVariable(
              oldVariableName,
              currentDashboardData.data,
              tabId,
              panelId,
            );
            await variablesManager.addOrUpdateVariable(
              variableData,
              currentDashboardData.data,
              tabId,
              panelId,
            );
          } else {
            // Add or update
            await variablesManager.addOrUpdateVariable(
              variableData,
              currentDashboardData.data,
              tabId,
              panelId,
            );
          }

          // Initialize default value in manager's live state
          await variablesManager.setVariableValue(
            variableData.name,
            variableData.value,
            tabId,
            panelId,
          );
        } else {
          // Fallback: manually update dashboard variables list
          const variablesList = currentDashboardData.data?.variables?.list || [];

          if (isEdit && oldVariableName) {
            const index = variablesList.findIndex((v: any) => v.name === oldVariableName);
            if (index !== -1) {
              variablesList[index] = variableData;
            }
          } else {
            variablesList.push(variableData);
          }

          if (!currentDashboardData.data.variables) {
            currentDashboardData.data.variables = {};
          }
          currentDashboardData.data.variables.list = variablesList;
        }

        // Save dashboard with updated variables
        await updateDashboard(
          store,
          store.state.selectedOrganization.identifier,
          route.query.dashboard,
          currentDashboardData.data,
          route.query.folder ?? "default",
        );

        showPositiveNotification(
          isEdit ? "Variable updated successfully" : "Variable created successfully",
        );

        // Reload dashboard to get fresh data
        await getDashboardData();
      } catch (error: any) {
        showErrorNotification(
          error?.response?.data?.message ||
            error?.message ||
            "Failed to save variable. Please try again.",
        );
      }
    };

    return {
      t,
      updateDateTime,
      goBack,
      savePanelChangesToDashboard,
      runQuery,
      layoutSplitterUpdated,
      handleCustomChartTemplateSelected,
      selectedCustomChartType,
      showCustomChartTypeSelector,
      openCustomChartTypeSelector,
      handleChartTypeSelection,
      expandedSplitterHeight,
      querySplitterUpdated,
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
      showViewPanel,
      metaDataValue,
      metaData,
      panelTitle,
      onDataZoom,
      showTutorial,
      updateVrlFunctionFieldList,
      queryParams: route.query as any,
      initialVariableValues,
      lastTriggeredAt,
      handleLastTriggeredAtUpdate,
      searchRequestTraceIds,
      cancelAddPanelQuery,
      disable,
      config,
      collapseFieldList,
      splitterModel,
      inputStyle,
      setTimeForVariables,
      dateTimeForVariables,
      seriesDataUpdate,
      seriesData,
      onApplyBtnClick,
      shouldRefreshWithoutCache,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      errorMessage,
      handleLimitNumberOfSeriesWarningMessage,
      handleResultMetadataUpdate,
      outlinedWarning,
      symOutlinedDataInfoAlert,
      outlinedRunningWithErrors,
      showLegendsDialog,
      currentPanelData,
      panelSchemaRendererRef,
      isAddVariableOpen,
      selectedVariableToEdit,
      handleOpenAddVariable,
      handleCloseAddVariable,
      handleSaveVariable,
      currentTabId,
      currentPanelId,
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
@import "@/styles/visualization-layout.scss";

.layout-panel-container {
  display: flex;
  flex-direction: column;
}

.splitter {
  height: 4px;
  width: 100%;
}
.splitter-vertical {
  width: 4px;
  height: 100%;
}
.splitter-enabled {
  background-color: #ffffff00;
  transition: 0.3s;
  transition-delay: 0.2s;
}

.splitter-enabled:hover {
  background-color: orange;
}

:deep(.query-editor-splitter .q-splitter__separator) {
  background-color: transparent !important;
}

.field-list-sidebar-header-collapsed {
  cursor: pointer;
  width: 50px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}

.field-list-collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}

.field-list-collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
}

.dynamic-input {
  min-width: 200px;
  max-width: 500px;
  transition: width 0.2s ease;
}

.warning {
  color: var(--q-warning);
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
