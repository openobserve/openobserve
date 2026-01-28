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
    <!-- Metrics Header Section -->
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
                dashboardPanelData.data.type,
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
          <q-btn
            size="md"
            class="no-border o2-secondary-button q-ml-xs"
            no-caps
            dense
            style="padding: 2px 4px"
            color="primary"
            @click="addToDashboard"
            :title="t('search.addToDashboard')"
          >
            {{ t("search.addToDashboard") }}
          </q-btn>
        </div>
      </div>
    </div>

    <!-- Unified AddPanel Component for Metrics Visualization -->
    <AddPanel
      ref="addPanelRef"
      mode="metrics"
      pageKey="metrics"
      :showHeader="false"
      :showQueryEditor="true"
      :showVariablesSelector="false"
      :allowHTMLEditor="false"
      :allowMarkdownEditor="false"
      :allowCustomCharts="false"
      :allowedChartTypes="['area', 'bar', 'h-bar', 'line', 'scatter', 'table']"
      :defaultStreamType="'metrics'"
      :enforceStreamType="true"
      :defaultChartType="'line'"
      :defaultQueryType="'promql'"
      :searchType="'ui'"
      :enableDataZoom="true"
      :metaData="props.metaData"
      @handleChartApiError="handleChartApiError"
      @dataZoom="onDataZoom"
      @lastTriggeredAtUpdate="handleLastTriggeredAtUpdate"
    />

    <!-- Add to Dashboard Dialog -->
    <q-dialog v-model="showAddToDashboardDialog">
      <AddToDashboard
        :dashboardPanelData="dashboardPanelData.data"
        @save="addPanelToDashboard"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  provide,
  onMounted,
  onUnmounted,
  nextTick,
  watch,
  computed,
  defineAsyncComponent,
  reactive,
} from "vue";
import AddPanel from "@/views/Dashboards/addPanel/AddPanel.vue";
import SyntaxGuideMetrics from "./SyntaxGuideMetrics.vue";
import MetricLegends from "./MetricLegends.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "../../composables/useDashboardPanel";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import useNotifications from "@/composables/useNotifications";
import config from "@/aws-exports";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { isEqual, debounce } from "lodash-es";

const AddToDashboard = defineAsyncComponent(() => {
  return import("./../metrics/AddToDashboard.vue");
});

export default defineComponent({
  name: "Metrics",
  props: ["metaData"],

  components: {
    AddPanel,
    SyntaxGuideMetrics,
    MetricLegends,
    DateTimePickerDashboard,
    AutoRefreshInterval,
    AddToDashboard,
  },
  setup(props) {
    provide("dashboardPanelDataPageKey", "metrics");

    const { t } = useI18n();
    const store = useStore();
    const { showErrorNotification } = useNotifications();
    const {
      dashboardPanelData,
      resetDashboardPanelData,
      resetDashboardPanelDataAndAddTimeField,
      validatePanel,
      removeXYFilters,
    } = useDashboardPanelData("metrics");

    const addPanelRef = ref(null);
    const chartData = ref();
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

    // Last triggered timestamp
    const lastTriggeredAt = ref(null);
    const handleLastTriggeredAtUpdate = (data: any) => {
      lastTriggeredAt.value = data;
    };

    const showAddToDashboardDialog = ref(false);

    // Refresh interval v-model
    const refreshInterval = ref(0);

    // Cancel query support
    const { searchRequestTraceIds, cancelAddPanelQuery } = useCancelQuery();
    const disable = computed(() => searchRequestTraceIds.value.length > 0);

    // Panel config watcher state
    let isPanelConfigWatcherActivated = false;
    const isPanelConfigChanged = ref(false);

    onUnmounted(async () => {
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

    const isInitialDashboardPanelData = () => {
      return (
        dashboardPanelData.data.description == "" &&
        !dashboardPanelData.data.config.unit &&
        !dashboardPanelData.data.config.unit_custom &&
        dashboardPanelData.data.queries[0].fields.x.length == 0 &&
        dashboardPanelData.data.queries[0].fields?.breakdown?.length == 0 &&
        dashboardPanelData.data.queries[0].fields.y.length == 0 &&
        dashboardPanelData.data.queries[0].fields.z.length == 0 &&
        dashboardPanelData.data.queries[0].fields.filter.conditions.length == 0 &&
        dashboardPanelData.data.queries.length == 1
      );
    };

    const isOutDated = computed(() => {
      //check that is it addpanel initial call
      if (isInitialDashboardPanelData() && !editMode.value) return false;
      //compare chartdata and dashboardpaneldata and variables data as well
      return !isEqual(chartData.value, dashboardPanelData.data);
    });

    const runQuery = () => {
      if (!isValid(true, false)) {
        return;
      }

      // copy the data object excluding the reactivity
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      // refresh the date time based on current time if relative date is selected
      dateTimePickerRef.value && dateTimePickerRef.value.refresh();
      updateDateTime(selectedDate.value);
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
      { deep: true },
    );

    // Auto-apply config changes that don't require API calls (similar to dashboard)
    const debouncedUpdateChartConfig = debounce((newVal, oldVal) => {
      if (!isEqual(chartData.value, newVal)) {
        const configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          newVal,
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
          "There are some errors, please fix them and try again",
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

    const addToDashboard = () => {
      const errors: any = [];
      // will push errors in errors array
      validatePanel(errors, true);

      if (errors.length) {
        // set errors into errorData
        errorData.errors = errors;
        showErrorNotification(
          "There are some errors, please fix them and try again",
        );
        return;
      } else {
        showAddToDashboardDialog.value = true;
      }
    };

    const addPanelToDashboard = () => {
      showAddToDashboardDialog.value = false;
    };

    return {
      props,
      t,
      store,
      config,
      dashboardPanelData,
      addPanelRef,
      selectedDate,
      dateTimePickerRef,
      errorData,
      lastTriggeredAt,
      handleLastTriggeredAtUpdate,
      showAddToDashboardDialog,
      refreshInterval,
      searchRequestTraceIds,
      disable,
      cancelAddPanelQuery,
      runQuery,
      handleChartApiError,
      onDataZoom,
      addToDashboard,
      addPanelToDashboard,
    };
  },
});
</script>

<style scoped lang="scss">
/* Styles inherited from AddPanel */
</style>
