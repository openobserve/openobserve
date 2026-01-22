<!-- Copyright 2023 OpenObserve Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div style="height: calc(100vh - 57px)">
    <div class="flex justify-between items-center q-pa-md">
      <div class="flex items-center q-table__title q-mr-md">
        <span data-test="dashboard-viewpanel-title">
          {{ dashboardPanelData.data.title }}
        </span>
      </div>
      <div class="flex items-center" style="gap: 0.5rem">
        <!-- histogram interval for sql queries -->
        <HistogramIntervalDropDown
          v-if="!promqlMode && histogramFields.length"
          v-model="histogramInterval"
          @update:modelValue="
            (newValue: any) => {
              histogramInterval = newValue.value;
            }
          "
          class="viewpanel-icons"
          style="width: 150px"
          data-test="dashboard-viewpanel-histogram-interval-dropdown"
        />

        <DateTimePickerDashboard
          v-model="selectedDate"
          ref="dateTimePickerRef"
          class="viewpanel-icons"
          data-test="dashboard-viewpanel-date-time-picker"
          :disable="disable"
          @hide="setTimeForVariables()"
        />
        <AutoRefreshInterval
          v-model="refreshInterval"
          trigger
          :min-refresh-interval="
            store.state?.zoConfig?.min_auto_refresh_interval || 5
          "
          style="padding-left: 0px; padding-right: 0px"
          @trigger="refreshData"
          class="viewpanel-icons"
          data-test="dashboard-viewpanel-refresh-interval"
        />
        <q-btn
          v-if="
            config.isEnterprise == 'true' &&
            searchRequestTraceIds.length &&
            disable
          "
          class="viewpanel-icons el-border"
          outline
          padding="xs"
          no-caps
          icon="cancel"
          @click="cancelViewPanelQuery"
          data-test="dashboard-viewpanel-cancel-btn"
          color="negative"
        >
          <q-tooltip>
            {{ t("panel.cancel") }}
          </q-tooltip>
        </q-btn>
        <q-btn
          v-else
          class="viewpanel-icons el-border"
          :outline="isVariablesChanged ? true : false"
          padding="xs"
          no-caps
          icon="refresh"
          @click="refreshData"
          data-test="dashboard-viewpanel-refresh-data-btn"
          :disable="disable"
          :color="isVariablesChanged ? '' : 'warning'"
          :text-color="store.state.theme == 'dark' ? 'white' : 'black'"
        >
          <q-tooltip>
            {{
              isVariablesChanged
                ? "Refresh"
                : "Refresh to apply latest variable changes"
            }}
          </q-tooltip>
        </q-btn>
        <q-btn
          no-caps
          @click="goBack"
          padding="xs"
          class="viewpanel-icons el-border"
          flat
          icon="close"
          data-test="dashboard-viewpanel-close-btn"
        />
      </div>
    </div>
    <q-separator></q-separator>
    <div class="row" style="height: calc(100vh - 130px); overflow: hidden">
      <div class="col" style="width: 100%; height: 100%">
        <div class="row" style="height: 100%">
          <div class="col" style="height: 100%">
            <div class="layout-panel-container col" style="height: 100%">
              <VariablesValueSelector
                :variablesConfig="currentDashboardData.data?.variables"
                :showDynamicFilters="
                  currentDashboardData.data?.variables?.showDynamicFilters
                "
                :selectedTimeDate="
                  dateTimeForVariables || dashboardPanelData.meta.dateTime
                "
                :initialVariableValues="getInitialVariablesData()"
                @variablesData="variablesDataUpdated"
                data-test="dashboard-viewpanel-variables-value-selector"
                :showAllVisible="true"
                :tabId="currentTabId"
                :panelId="currentPanelId"
              />
              <div style="flex: 1; overflow: hidden">
                <div
                  class="tw:flex tw:justify-end tw:mr-2 tw:items-center"
                  data-test="view-panel-last-refreshed-at"
                >
                  <!-- Error/Warning tooltips -->
                  <q-btn
                    v-if="errorMessage"
                    :icon="outlinedWarning"
                    flat
                    size="xs"
                    padding="2px"
                    data-test="viewpanel-error-data"
                    class="warning q-mr-xs"
                  >
                    <q-tooltip
                      anchor="bottom right"
                      self="top right"
                      max-width="220px"
                    >
                      <div style="white-space: pre-wrap">
                        {{ errorMessage }}
                      </div>
                    </q-tooltip>
                  </q-btn>
                  <q-btn
                    v-if="maxQueryRangeWarning"
                    :icon="outlinedWarning"
                    flat
                    size="xs"
                    padding="2px"
                    data-test="viewpanel-max-duration-warning"
                    class="warning q-mr-xs"
                  >
                    <q-tooltip
                      anchor="bottom right"
                      self="top right"
                      max-width="220px"
                    >
                      <div style="white-space: pre-wrap">
                        {{ maxQueryRangeWarning }}
                      </div>
                    </q-tooltip>
                  </q-btn>
                  <q-btn
                    v-if="limitNumberOfSeriesWarningMessage"
                    :icon="symOutlinedDataInfoAlert"
                    flat
                    size="xs"
                    padding="2px"
                    data-test="viewpanel-series-limit-warning"
                    class="warning q-mr-xs"
                  >
                    <q-tooltip
                      anchor="bottom right"
                      self="top right"
                      max-width="220px"
                    >
                      <div style="white-space: pre-wrap">
                        {{ limitNumberOfSeriesWarningMessage }}
                      </div>
                    </q-tooltip>
                  </q-btn>
                  <span v-if="lastTriggeredAt" class="lastRefreshedAt">
                    <span class="lastRefreshedAtIcon">🕑</span
                    ><RelativeTime
                      :timestamp="lastTriggeredAt"
                      fullTimePrefix="Last Refreshed At: "
                    />
                  </span>
                </div>
                <PanelSchemaRenderer
                  v-if="chartData"
                  :key="dashboardPanelData.data.type"
                  :panelSchema="chartData"
                  :dashboard-id="dashboardId"
                  :folder-id="folderId"
                  :selectedTimeObj="dashboardPanelData.meta.dateTime"
                  :variablesData="currentVariablesDataRef"
                  :currentVariablesData="liveVariablesData"
                  :tabId="currentTabId"
                  :panelId="currentPanelId"
                  :width="6"
                  :searchType="searchType"
                  :showLegendsButton="true"
                  @error="handleChartApiError"
                  @updated:data-zoom="onDataZoom"
                  @update:initialVariableValues="onUpdateInitialVariableValues"
                  @last-triggered-at-update="handleLastTriggeredAtUpdate"
                  @result-metadata-update="handleResultMetadataUpdate"
                  @limit-number-of-series-warning-message-update="
                    handleLimitNumberOfSeriesWarningMessage
                  "
                  @show-legends="showLegendsDialog = true"
                  data-test="dashboard-viewpanel-panel-schema-renderer"
                  style="height: calc(100% - 21px)"
                  ref="panelSchemaRendererRef"
                />
              </div>
              <DashboardErrorsComponent
                :errors="errorData"
                data-test="dashboard-viewpanel-dashboard-errors"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <q-dialog v-model="showLegendsDialog">
      <ShowLegendsPopup
        :panelData="currentPanelData"
        @close="showLegendsDialog = false"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  toRaw,
  nextTick,
  watch,
  reactive,
  onUnmounted,
  onMounted,
  onBeforeMount,
} from "vue";

import { useI18n } from "vue-i18n";
import {
  getDashboard,
  getPanel,
  checkIfVariablesAreLoaded,
} from "../../../utils/commons";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import DateTimePickerDashboard from "../../../components/DateTimePickerDashboard.vue";
import DashboardErrorsComponent from "../../../components/dashboards/addPanel/DashboardErrors.vue";
import VariablesValueSelector from "../../../components/dashboards/VariablesValueSelector.vue";
import PanelSchemaRenderer from "../../../components/dashboards/PanelSchemaRenderer.vue";
import RelativeTime from "@/components/common/RelativeTime.vue";
// import _ from "lodash-es";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { onActivated } from "vue";
import { parseDuration } from "@/utils/date";
import HistogramIntervalDropDown from "@/components/dashboards/addPanel/HistogramIntervalDropDown.vue";
import { inject, provide, computed } from "vue";
import { replaceHistogramInterval } from "@/utils/dashboard/histogramIntervalReplacer";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import config from "@/aws-exports";
import { isEqual } from "lodash-es";
import { processQueryMetadataErrors } from "@/utils/zincutils";
import { outlinedWarning } from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import { defineAsyncComponent } from "vue";

const ShowLegendsPopup = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/ShowLegendsPopup.vue");
});

export default defineComponent({
  name: "ViewPanel",
  components: {
    DateTimePickerDashboard,
    DashboardErrorsComponent,
    VariablesValueSelector,
    PanelSchemaRenderer,
    AutoRefreshInterval,
    HistogramIntervalDropDown,
    RelativeTime,
    ShowLegendsPopup,
  },
  props: {
    panelId: {
      type: String,
      required: true,
    },
    dashboardId: {
      type: String,
      required: false,
    },
    folderId: {
      type: String,
      required: false,
    },
    selectedDateForViewPanel: {
      type: Object,
    },
    initialVariableValues: {
      type: Object,
    },
    searchType: {
      default: null,
      type: String || null,
    },
  },
  emits: ["closePanel", "update:initialVariableValues"],
  setup(props, { emit }) {
    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref();
    const showLegendsDialog = ref(false);
    const panelSchemaRendererRef: any = ref(null);
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();
    const store = useStore();

    // IMPORTANT: Always create a NEW isolated instance for ViewPanel
    // ViewPanel should NEVER share the variables manager with the parent dashboard
    // This ensures that variable changes in ViewPanel don't affect the parent dashboard
    const variablesManager = useVariablesManager();

    // Provide to child components (ViewPanel's own isolated instance)
    provide("variablesManager", variablesManager);

    const currentVariablesDataRef: any = reactive({});

    let parser: any;
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData, promqlMode, resetDashboardPanelData } =
      useDashboardPanelData(dashboardPanelDataPageKey);
    // default selected date will be absolute time
    const selectedDate: any = ref(props.selectedDateForViewPanel);
    const dateTimePickerRef: any = ref(null);
    const errorData: any = reactive({
      errors: [],
    });
    let variablesData: any = reactive({});
    const initialVariableValues = ref<any>({}); // Store the initial variable values
    const isVariablesChanged = ref(false); // Flag to track if variables have changed
    let needsVariablesAutoUpdate = true;

    const variablesDataUpdated = (data: any) => {
      try {
        // update the variables data
        Object.assign(variablesData, data);

        if (needsVariablesAutoUpdate) {
          // check if the length is > 0
          if (checkIfVariablesAreLoaded(variablesData)) {
            needsVariablesAutoUpdate = false;
          }

          Object.assign(currentVariablesDataRef, variablesData);
        }

        return;
      } catch (error) {
      }

      // resize the chart when variables data is updated
      // because if variable requires some more space then need to resize chart
      // NOTE: need to improve this logic it should only called if the variable requires more space
      window.dispatchEvent(new Event("resize"));
    };
    const currentDashboardData: any = reactive({
      data: {},
    });

    // refresh interval v-model
    const refreshInterval = ref(0);

    // histogram interval
    const histogramInterval: any = ref(null);

    // array of histogram fields
    let histogramFields: any = ref([]);

    // to store and show when the panel was last loaded
    const lastTriggeredAt = ref(null);
    const handleLastTriggeredAtUpdate = (data: any) => {
      lastTriggeredAt.value = data;
    };

    // Warning messages
    const maxQueryRangeWarning = ref("");
    const limitNumberOfSeriesWarningMessage = ref("");
    const errorMessage = ref("");

    onBeforeMount(async () => {
      await importSqlParser();
    });

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    watch(
      () => histogramInterval.value,
      async () => {
        // import sql parser if not imported
        if (!parser) {
          await importSqlParser();
        }
        // replace the histogram interval in the query by finding histogram aggregation
        dashboardPanelData?.data?.queries?.forEach((query: any) => {
          const originalQuery = query.query;
          const updatedQuery = replaceHistogramInterval(originalQuery, histogramInterval.value);

          // Only update if the query actually changed
          if (updatedQuery !== originalQuery) {
            query.query = updatedQuery;
          }
        });
        // copy the data object excluding the reactivity
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        // refresh the date time based on current time if relative date is selected
        dateTimePickerRef.value && dateTimePickerRef.value.refresh();
      },
    );

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

    onUnmounted(async () => {
      // clear a few things
      resetDashboardPanelData();
      parser = null;
    });

    onMounted(async () => {
      errorData.errors = [];

      // todo check for the edit more
      if (props.panelId) {
        const panelData = await getPanel(
          store,
          route.query.dashboard,
          props.panelId,
          route.query.folder,
          route.query.tab ?? dashboardPanelData.data.panels?.[0]?.tabId,
        );
        Object.assign(
          dashboardPanelData.data,
          JSON.parse(JSON.stringify(panelData)),
        );
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      }

      //if sql, get histogram fields from all queries
      histogramFields.value =
        dashboardPanelData.data.queryType != "sql"
          ? []
          : dashboardPanelData.data.queries
              .map((q: any) =>
                [...q.fields.x, ...q.fields.y, ...q.fields.z].find(
                  (f: any) => f.functionName == "histogram",
                ),
              )
              .filter((field: any) => field != undefined);

      // if there is at least 1 histogram field
      // then set the default histogram interval
      if (histogramFields.value.length > 0) {
        for (let i = 0; i < histogramFields.value.length; i++) {
          if (
            histogramFields.value[i]?.args &&
            histogramFields.value[i]?.args.length > 0
          ) {
            // Histogram function signature: histogram(field, interval)
            // args[0] = timestamp field (object)
            // args[1] = interval (string like '5m', '1h', etc.)

            // Check if there's a second argument (the interval)
            if (histogramFields.value[i].args.length > 1 && histogramFields.value[i].args[1]) {
              const intervalArg = histogramFields.value[i].args[1];

              // Extract interval value with explicit type checking
              let intervalValue: string | null = null;

              if (typeof intervalArg === 'string') {
                // Direct string value
                intervalValue = intervalArg;
              } else if (typeof intervalArg === 'object' && intervalArg !== null) {
                // Object with value property
                if ('value' in intervalArg && typeof intervalArg.value === 'string') {
                  intervalValue = intervalArg.value;
                }
              }

              // Set the histogram interval only if we have a valid non-empty string
              if (intervalValue && intervalValue.trim() !== '') {
                histogramInterval.value = intervalValue;
              } else {
                // No valid interval - use Auto mode
                histogramInterval.value = null;
              }
              break;
            } else {
              // No interval specified - this is "Auto" mode
              histogramInterval.value = null;
              break;
            }
          }
        }
      }
      await nextTick();
      loadDashboard();
    });

    onActivated(() => {
      const params: any = route.query;

      if (params.refresh) {
        refreshInterval.value = parseDuration(params.refresh);
      }
    });
    watch(
      () => variablesData,
      (newVal) => {
        const isValueChanged =
          currentVariablesDataRef?.values?.length > 0 &&
          variablesData.values.every((variable: any, index: number) => {
            const prevValue = currentVariablesDataRef.values[index]?.value;
            const newValue = variable.value;
            // Compare current and previous values; handle both string and array cases
            return Array.isArray(newValue)
              ? isEqual(prevValue, newValue)
              : prevValue === newValue;
          });
        // Set the `isChanged` flag if values are different
        isVariablesChanged.value = isValueChanged;
      },
      { deep: true },
    );
    const refreshData = () => {
      if (!disable.value) {
        dateTimePickerRef.value.refresh();
        Object.assign(
          currentVariablesDataRef,
          JSON.parse(JSON.stringify(variablesData)),
        );
        isVariablesChanged.value = false;
      }
    };

    const currentDashboard = toRaw(store.state.currentSelectedDashboard);

    const loadDashboard = async () => {
      let data = JSON.parse(
        JSON.stringify(
          await getDashboard(
            store,
            route.query.dashboard,
            route.query.folder ?? "default",
          ),
        ),
      );
      currentDashboardData.data = data;

      // Initialize variables manager with dashboard variables
      try {
        // Get current tab and panel IDs for initialization
        const tabId =
          (route.query.tab as string) ??
          currentDashboardData.data?.tabs?.[0]?.tabId;

        // Initialize with panel-to-tab mapping (3rd parameter is critical for panel variables!)
        await variablesManager.initialize(
          currentDashboardData.data?.variables?.list || [],
          currentDashboardData.data,
          props.panelId ? { [props.panelId]: tabId || "" } : {},
        );

        // Mark current tab and panel as visible so their variables can load
        if (tabId) {
          variablesManager.setTabVisibility(tabId, true);
        }

        // Mark the panel as visible
        if (props.panelId) {
          variablesManager.setPanelVisibility(props.panelId, true);
        }
      } catch (error) {
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
    };

    watch(selectedDate, () => {
      updateDateTime(selectedDate.value);
    });

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

    const updateDateTime = (value: object) => {
      dashboardPanelData.meta.dateTime = {
        start_time: new Date(selectedDate.value.startTime),
        end_time: new Date(selectedDate.value.endTime),
      };

      dateTimeForVariables.value = {
        start_time: new Date(selectedDate.value.startTime),
        end_time: new Date(selectedDate.value.endTime),
      };
    };
    const goBack = () => {
      emit("closePanel");
    };

    const handleChartApiError = (errorMsg: {
      message: string;
      code: string;
    }) => {
      if (errorMsg?.message) {
        errorMessage.value = errorMsg.message;
        const errorList = errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg.message);
      }
    };

    // Handle limit number of series warning from PanelSchemaRenderer
    const handleLimitNumberOfSeriesWarningMessage = (message: string) => {
      limitNumberOfSeriesWarningMessage.value = message;
    };

    const handleResultMetadataUpdate = (metadata: any) => {
      maxQueryRangeWarning.value = processQueryMetadataErrors(
        metadata,
        store.state.timezone,
      );
    };

    const getInitialVariablesData = () => {
      const variableObj: any = {};
      props?.initialVariableValues?.values?.forEach((variable: any) => {
        if (variable.type === "dynamic_filters") {
          const filters = (variable.value || []).filter(
            (item: any) => item.name && item.operator && item.value,
          );
          const encodedFilters = filters.map((item: any) => ({
            name: item.name,
            operator: item.operator,
            value: item.value,
          }));
          variableObj[`${variable.name}`] = encodeURIComponent(
            JSON.stringify(encodedFilters),
          );
        } else {
          variableObj[`${variable.name}`] = variable.value;
        }
      });
      // pass initial variable values in value property
      return { value: variableObj };
    };

    const onUpdateInitialVariableValues = (...args: any[]) => {
      emit("update:initialVariableValues", ...args);
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

    const cancelViewPanelQuery = () => {
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

    // [END] cancel running queries

    // Computed properties for current tab and panel IDs
    const currentTabId = computed(() => {
      return (
        (route.query.tab as string) ??
        currentDashboardData.data?.tabs?.[0]?.tabId
      );
    });

    const currentPanelId = computed(() => {
      return props.panelId;
    });

    // Computed property for LIVE merged variables (for HTML/Markdown panels and drilldown)
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

    const currentPanelData = computed(() => {
      const rendererData = panelSchemaRendererRef.value?.panelData || {};
      return {
        ...rendererData,
        config: dashboardPanelData.data.config || {},
      };
    });

    return {
      t,
      setTimeForVariables,
      dateTimeForVariables,
      updateDateTime,
      goBack,
      currentDashboard,
      dashboardPanelData,
      chartData,
      selectedDate,
      errorData,
      handleChartApiError,
      handleResultMetadataUpdate,
      handleLimitNumberOfSeriesWarningMessage,
      variablesDataUpdated,
      currentDashboardData,
      variablesData,
      liveVariablesData,
      dateTimePickerRef,
      refreshInterval,
      refreshData,
      promqlMode,
      histogramInterval,
      histogramFields,
      onDataZoom,
      getInitialVariablesData,
      onUpdateInitialVariableValues,
      lastTriggeredAt,
      handleLastTriggeredAtUpdate,
      searchRequestTraceIds,
      cancelViewPanelQuery,
      disable,
      config,
      currentVariablesDataRef,
      isVariablesChanged,
      store,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      errorMessage,
      outlinedWarning,
      symOutlinedDataInfoAlert,
      currentTabId,
      currentPanelId,
      showLegendsDialog,
      currentPanelData,
      panelSchemaRendererRef,
    };
  },
});
</script>

<style lang="scss" scoped>
.layout-panel-container {
  display: flex;
  flex-direction: column;
}

.warning {
  color: var(--q-warning);
}

.viewpanel-icons {
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

.el-border {
  transition: background-color 0.2s ease;

  &:hover {
    background-color: var(--o2-hover-accent) !important;
  }
}
</style>
