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

<template>
  <div style="overflow-y: auto" class="scroll">
    <!-- Header Section -->
    <div
      class="row tw:px-[0.625rem] tw:mb-[0.625rem] q-pt-xs"
      style="height: 48px; overflow-y: auto"
    >
      <div class="card-container tw:w-full tw:h-full tw:flex">
        <div class="flex items-center col">
          <div
            class="flex items-center q-table__title q-mx-md tw:font-semibold tw:text-xl"
          >
            <span>
              {{ t("search.metrics") }}
            </span>
          </div>
          <syntax-guide-metrics class="q-mr-sm" />
          <MetricLegends class="q-mr-sm" />
        </div>
        <div class="text-right col flex justify-end items-center">
          <DateTimePickerDashboard
            v-if="
              !['html', 'markdown'].includes(dashboardPanelData.data.type) &&
              selectedDate
            "
            v-model="selectedDate"
            ref="dateTimePickerRef"
            :disable="disable"
            class="dashboard-icons"
            data-test="metrics-date-picker"
          />
          <AutoRefreshInterval
            v-if="
              !['html', 'markdown', 'custom_chart'].includes(
                dashboardPanelData.data.type
              )
            "
            v-model="refreshInterval"
            trigger
            :min-refresh-interval="
              store.state?.zoConfig?.min_auto_refresh_interval || 5
            "
            @trigger="runQuery"
            class="q-mr-xs q-px-none dashboards-icon dashboards-auto-refresh-interval"
            data-test="metrics-auto-refresh"
          />
          <div
            v-if="!['html', 'markdown'].includes(dashboardPanelData.data.type)"
            class="dashboard-icons tw:mx-2"
          >
            <q-btn
              v-if="config.isEnterprise == 'true' && searchRequestTraceIds.length"
              class="tw:text-xs tw:font-bold no-border"
              data-test="metrics-cancel"
              padding="xs lg"
              color="negative"
              no-caps
              :label="t('panel.cancel')"
              @click="cancelAddPanelQuery"
            />
            <q-btn
              v-else
              class="q-pa-none o2-primary-button tw:h-[30px] element-box-shadow"
              data-test="metrics-apply"
              :loading="disable"
              :disable="disable"
              no-caps
              :label="t('metrics.runQuery')"
              @click="runQuery"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- PanelEditor Content Area -->
    <PanelEditor
      ref="panelEditorRef"
      pageType="metrics"
      :editMode="false"
      :dashboardData="currentDashboardData.data"
      :variablesData="{}"
      :selectedDateTime="dashboardPanelData.meta.dateTime"
      @addToDashboard="addToDashboard"
      @chartApiError="handleChartApiError"
      @dataZoom="onDataZoom"
    />

    <!-- Add to Dashboard Dialog -->
    <q-dialog
      v-model="showAddToDashboardDialog"
      position="right"
      full-height
      maximized
    >
      <add-to-dashboard
        @save="addPanelToDashboard"
        :dashboardPanelData="dashboardPanelData"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  nextTick,
  watch,
  reactive,
  onUnmounted,
  onMounted,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "../../composables/useDashboardPanel";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import SyntaxGuideMetrics from "./SyntaxGuideMetrics.vue";
import MetricLegends from "./MetricLegends.vue";
import { isEqual, debounce } from "lodash-es";
import { provide } from "vue";
import useNotifications from "@/composables/useNotifications";
import config from "@/aws-exports";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { PanelEditor } from "@/components/dashboards/PanelEditor";

const AddToDashboard = defineAsyncComponent(() => {
  return import("./../metrics/AddToDashboard.vue");
});

export default defineComponent({
  name: "Metrics",
  props: ["metaData"],

  components: {
    DateTimePickerDashboard,
    SyntaxGuideMetrics,
    MetricLegends,
    AddToDashboard,
    AutoRefreshInterval,
    PanelEditor,
  },
  setup(props) {
    provide("dashboardPanelDataPageKey", "metrics");

    // PanelEditor ref for accessing exposed methods/properties
    const panelEditorRef = ref<InstanceType<typeof PanelEditor> | null>(null);

    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref();
    const { t } = useI18n();
    const store = useStore();
    const { showErrorNotification } = useNotifications();
    const {
      dashboardPanelData,
      resetDashboardPanelData,
      resetDashboardPanelDataAndAddTimeField,
      resetAggregationFunction,
      validatePanel,
      removeXYFilters,
      makeAutoSQLQuery,
    } = useDashboardPanelData("metrics");
    const editMode = ref(false);
    const selectedDate: any = ref({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "15m",
    });
    const dateTimePickerRef: any = ref(null);
    const errorData: any = reactive({
      errors: [],
    });

    const showAddToDashboardDialog = ref(false);

    // refresh interval v-model
    const refreshInterval = ref(0);

    const currentDashboardData: any = reactive({
      data: {},
    });

    // this is used to activate the watcher only after on mounted
    let isPanelConfigWatcherActivated = false;
    const isPanelConfigChanged = ref(false);

    onUnmounted(async () => {
      // clear a few things
      resetDashboardPanelData();
    });

    onMounted(async () => {
      errorData.errors = [];

      editMode.value = false;
      resetDashboardPanelDataAndAddTimeField();

      // for metrics page, use stream type as metric
      dashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      // need to remove the xy filters
      removeXYFilters();

      // set default chart type as line
      dashboardPanelData.data.type = "line";
      // set the default query type as promql for metrics
      dashboardPanelData.data.queryType = "promql";
      dashboardPanelData.data.queries[0].customQuery = false;

      // set the show query bar by default for metrics page
      dashboardPanelData.layout.showQueryBar = true;

      chartData.value = {};
      // set the value of the date time after the reset
      updateDateTime(selectedDate.value);

      // let it call the watchers and then mark the panel config watcher as activated
      await nextTick();
      isPanelConfigWatcherActivated = true;
    });

    watch(
      () => dashboardPanelData.data.type,
      async () => {
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      }
    );

    watch(selectedDate, () => {
      updateDateTime(selectedDate.value);
    });

    // resize the chart when config panel is opened and closed
    watch(
      () => dashboardPanelData.layout.isConfigPanelOpen,
      () => {
        window.dispatchEvent(new Event("resize"));
      }
    );

    // Generate the query when the fields are updated
    watch(
      () => [
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.filter,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.latitude,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.longitude,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.weight,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.source,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.target,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.value,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.name,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.value_for_maps,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.limit,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].joins,
      ],
      () => {
        // only continue if current mode is auto query generation
        if (
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery
        ) {
          // makeAutoSQLQuery is async function
          makeAutoSQLQuery();
        }
      },
      { deep: true }
    );

    // resize the chart when query editor is opened and closed
    watch(
      () => dashboardPanelData.layout.showQueryBar,
      () => {
        window.dispatchEvent(new Event("resize"));
      }
    );

    const runQuery = () => {
      if (!isValid(true, false)) {
        return;
      }

      // copy the data object excluding the reactivity
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      // refresh the date time based on current time if relative date is selected
      dateTimePickerRef.value && dateTimePickerRef.value.refresh();
      updateDateTime(selectedDate.value);

      // Call PanelEditor's runQuery if available
      if (panelEditorRef.value) {
        panelEditorRef.value.runQuery();
      }
    };

    const updateDateTime = (value: object) => {
      if (selectedDate.value && dateTimePickerRef?.value) {
        const date = dateTimePickerRef.value?.getConsumableDateTime();

        dashboardPanelData.meta.dateTime = {
          start_time: new Date(date.startTime),
          end_time: new Date(date.endTime),
        };
      }
    };

    //watch dashboardpaneldata when changes, isUpdated will be true
    watch(
      () => dashboardPanelData.data,
      () => {
        if (isPanelConfigWatcherActivated) {
          isPanelConfigChanged.value = true;
        }
      },
      { deep: true }
    );

    // Auto-apply config changes that don't require API calls (similar to dashboard)
    const debouncedUpdateChartConfig = debounce((newVal, oldVal) => {
      if (!isEqual(chartData.value, newVal)) {
        const configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          newVal
        );

        if (!configNeedsApiCall) {
          chartData.value = JSON.parse(JSON.stringify(newVal));
          window.dispatchEvent(new Event("resize"));
        }
      }
    }, 1000);

    watch(() => dashboardPanelData.data, debouncedUpdateChartConfig, {
      deep: true,
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
          "There are some errors, please fix them and try again"
        );
      }

      if (errors.length) {
        return false;
      } else {
        return true;
      }
    };

    const handleChartApiError = (errorMessage: {
      message: string;
      code: string;
    }) => {
      if (errorMessage?.message) {
        const errorList = errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMessage.message);
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
      variablesAndPanelsDataLoadingState
    );

    const searchRequestTraceIds = computed(() => {
      const searchIds = Object.values(
        variablesAndPanelsDataLoadingState.searchRequestTraceIds
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
        variablesAndPanelsDataLoadingState.panels
      );
      disable.value = panelsValues.some((item: any) => item === true);
    });

    const addToDashboard = () => {
      const errors: any = [];
      // will push errors in errors array
      validatePanel(errors, true);

      if (errors.length) {
        // set errors into errorData
        errorData.errors = errors;
        showErrorNotification(
          "There are some errors, please fix them and try again"
        );
        return;
      } else {
        showAddToDashboardDialog.value = true;
      }
    };

    const addPanelToDashboard = () => {
      showAddToDashboardDialog.value = false;
    };

    // [END] cancel running queries

    return {
      t,
      updateDateTime,
      runQuery,
      dashboardPanelData,
      chartData,
      editMode,
      selectedDate,
      errorData,
      handleChartApiError,
      currentDashboardData,
      resetAggregationFunction,
      store,
      dateTimePickerRef,
      onDataZoom,
      searchRequestTraceIds,
      cancelAddPanelQuery,
      disable,
      config,
      showAddToDashboardDialog,
      addPanelToDashboard,
      addToDashboard,
      refreshInterval,
      panelEditorRef,
    };
  },
});
</script>

<style lang="scss" scoped>
.dashboard-icons {
  height: 32px;
}
</style>

<style lang="scss">
.dashboards-auto-refresh-interval {
  .q-btn {
    min-height: 2rem; // 30px
    max-height: 2rem; // 30px
    padding: 0 0.25rem; // 4px
    border-radius: 0.375rem; // 6px
    transition: all 0.2s ease;

    &:hover {
      background-color: var(--o2-hover-accent);
    }

    .q-icon {
      font-size: 1.125rem; // 18px
    }
  }
}
</style>
