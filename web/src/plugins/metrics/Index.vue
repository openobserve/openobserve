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
  <OPageLayout
    data-test="metrics-page"
    :title="t('search.metrics')"
    icon="bar-chart"
    :back="{
      label: t('search.metrics'),
      onClick: goBackToExplorer,
      dataTest: 'metrics-editor-back-btn',
    }"
    bleed
  >
      <template #actions>
        <syntax-guide-metrics />
        <MetricLegends />
        <DateTimePickerDashboard
          v-if="
            !['html', 'markdown'].includes(dashboardPanelData.data.type) &&
            selectedDate
          "
          v-model="selectedDate"
          ref="dateTimePickerRef"
          :disable="disable"
          class="h-8"
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
          class="h-8"
          data-test="metrics-auto-refresh"
        />
        <ShareButton
          v-if="!['html', 'markdown'].includes(dashboardPanelData.data.type)"
          :url="metricsShareUrl"
          variant="outline"
          size="icon-toolbar"
          data-test="metrics-share-btn"
          shortcut-id="metricsCopyUrl"
          class="h-8"
        />
        <template
          v-if="!['html', 'markdown'].includes(dashboardPanelData.data.type)"
        >
          <OButton
            v-if="config.isEnterprise == 'true' && searchRequestTraceIds.length"
            variant="outline-destructive"
            size="sm-toolbar"
            data-test="metrics-cancel"
            @click="cancelAddPanelQuery"
          >
            <span class="relative flex items-center justify-center">
              <span class="invisible">{{ t("metrics.runQuery") }}</span>
              <span class="absolute">{{ t("panel.cancel") }}</span>
            </span>
          </OButton>
          <OButton
            v-else
            variant="primary"
            size="sm-toolbar"
            data-test="metrics-apply"
            :loading="disable"
            :disabled="disable"
            @click="runQuery"
          >
            {{ t("metrics.runQuery") }}
            <OTooltip
              :content="t('metrics.runQuery')"
              shortcut-id="metricsRunQuery"
            />
          </OButton>
        </template>
      </template>
    <!-- PanelEditor Content Area -->
    <PanelEditor
      ref="panelEditorRef"
      pageType="metrics"
      :editMode="false"
      :dashboardData="currentDashboardData.data"
      :variablesData="({} as unknown as PanelEditorVariablesData)"
      :selectedDateTime="dashboardPanelData.meta.dateTime"
      @addToDashboard="addToDashboard"
      @chartApiError="handleChartApiError"
      @dataZoom="onDataZoom"
    />

    <!-- Add to Dashboard Dialog -->
    <add-to-dashboard
      v-model:open="showAddToDashboardDialog"
      :dashboardPanelData="dashboardPanelData"
      @save="addPanelToDashboard"
    />
  </OPageLayout>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  nextTick,
  watch,
  reactive,
  onMounted,
  onBeforeMount,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "../../composables/dashboard/useDashboardPanel";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import SyntaxGuideMetrics from "./SyntaxGuideMetrics.vue";
import MetricLegends from "./MetricLegends.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { isEqual, debounce } from "lodash-es";
import { provide } from "vue";
import useNotifications from "@/composables/useNotifications";
import config from "@/aws-exports";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import {
  PanelEditor,
  type PanelEditorVariablesData,
} from "@/components/dashboards/PanelEditor";
import { saveMetricsStream, restoreMetricsStream } from "@/utils/streamPersist";
import useDefaultPanelFields from "@/composables/dashboard/useDefaultPanelFields";
import { useRoute, useRouter } from "vue-router";
import ShareButton from "@/components/common/ShareButton.vue";
import {
  getMetricsConfig,
  encodeMetricsConfig,
  applyMetricsBlob,
  applyDeepLinkOverrides,
} from "@/composables/metrics/metricsUrlState";
import {
  queryParamsToSelectedDate,
  selectedDateToQueryParams,
  refreshLabelToInterval,
  refreshIntervalToLabel,
} from "@/utils/dashboard/urlTimeParams";
import { hasAnyDeepLinkParam } from "@/utils/url/deepLinkParams";
import { METRICS_PARAMS } from "@/utils/metrics/metricsParamRegistry";

const AddToDashboard = defineAsyncComponent(() => {
  return import("./../metrics/AddToDashboard.vue");
});
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "Metrics",
  props: ["metaData"],

  components: {
    OPageLayout,
    DateTimePickerDashboard,
    SyntaxGuideMetrics,
    MetricLegends,
    AddToDashboard,
    AutoRefreshInterval,
    PanelEditor,
    OButton,
    OTooltip,
    ShareButton,
  },
  setup() {
    provide("dashboardPanelDataPageKey", "metrics");

    // PanelEditor ref for accessing exposed methods/properties
    const panelEditorRef = ref<InstanceType<typeof PanelEditor> | null>(null);

    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref();
    const { t } = useI18n();
    const store = useStore();
    const route = useRoute();
    const router = useRouter();
    const { showErrorNotification } = useNotifications();
    const {
      dashboardPanelData,
      resetDashboardPanelData,
      resetAggregationFunction,
      validatePanel,
    } = useDashboardPanelData("metrics");
    const { applyDefaultPanelFields } = useDefaultPanelFields("metrics");
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

    // Not kept-alive: re-mounts each navigation, so onMounted is the only restore point.
    let pendingAutoRun = false;

    const applyMetricsDefaults = () => {
      errorData.errors = [];
      editMode.value = false;
      resetDashboardPanelData();

      // for metrics page, use stream type as metric
      dashboardPanelData.data.queries[0].fields.stream_type = "metrics";

      if (store.state.zoConfig?.auto_query_enabled) {
        const persisted = restoreMetricsStream(
          store.state.selectedOrganization.identifier,
        );
        if (persisted) {
          dashboardPanelData.data.queries[0].fields.stream = persisted;
        }
      }

      dashboardPanelData.data.type = "line";
      dashboardPanelData.data.queryType = "promql";
      dashboardPanelData.data.queries[0].customQuery = false;
      dashboardPanelData.layout.showQueryBar = true;
      chartData.value = {};
    };

    // panel -> URL: fresh metrics_data blob + time/refresh, dropping override params (diff-guarded).
    const syncStateToUrl = () => {
      const query: Record<string, any> = {
        org_identifier: store.state.selectedOrganization.identifier,
        refresh: refreshIntervalToLabel(refreshInterval.value),
        ...selectedDateToQueryParams(selectedDate.value),
        metrics_data: encodeMetricsConfig(getMetricsConfig(dashboardPanelData)),
      };
      const changed =
        Object.keys(query).some(
          (k) => String(query[k]) !== String(route.query[k] ?? ""),
        ) || Object.keys(route.query).some((k) => !(k in query));
      if (changed) router.replace({ query }).catch(() => {});
    };

    // URL -> panel (blob -> overrides -> time/refresh); returns the auto-run gate.
    const hydrateFromUrl = (): boolean => {
      const q = route.query as Record<string, any>;

      if (q.metrics_data) applyMetricsBlob(q.metrics_data, dashboardPanelData);
      applyDeepLinkOverrides(q, dashboardPanelData);

      if (q.period || (q.from && q.to)) {
        selectedDate.value = queryParamsToSelectedDate(q);
      }
      if (q.refresh != null) {
        refreshInterval.value = refreshLabelToInterval(
          q.refresh,
          store.state?.zoConfig?.min_auto_refresh_interval || 0,
        );
      }

      return !!q.metrics_data || hasAnyDeepLinkParam(q, METRICS_PARAMS);
    };

    // seed builder-mode slots (a stream but no query) with a starter query before auto-run.
    const seedBuilderSlots = async () => {
      const queries = dashboardPanelData.data.queries;
      for (let i = 0; i < queries.length; i++) {
        const qq = queries[i];
        if (qq?.fields?.stream && !qq.customQuery && !qq.query) {
          dashboardPanelData.layout.currentQueryIndex = i;
          await applyDefaultPanelFields();
        }
      }
      dashboardPanelData.layout.currentQueryIndex = 0;
    };

    // Share URL: fresh /metrics link from current editor state, freezing relative period to absolute.
    const metricsShareUrl = computed(() => {
      void route.fullPath; // reactive dep on URL
      const url = new URL(window.location.origin + window.location.pathname);
      const sp = url.searchParams;
      sp.set("org_identifier", store.state.selectedOrganization.identifier);

      // freeze the window: getConsumableDateTime() is in MICROSECONDS -> ms
      const ct: any = dateTimePickerRef.value?.getConsumableDateTime?.();
      if (ct?.startTime && ct?.endTime) {
        sp.set("from", String(Math.floor(ct.startTime / 1000)));
        sp.set("to", String(Math.floor(ct.endTime / 1000)));
      } else {
        const tp: any = selectedDateToQueryParams(selectedDate.value);
        if (tp.period) sp.set("period", tp.period);
        else if (tp.from != null) {
          sp.set("from", String(tp.from));
          sp.set("to", String(tp.to));
        }
      }

      sp.set("refresh", refreshIntervalToLabel(refreshInterval.value));
      sp.set(
        "metrics_data",
        encodeMetricsConfig(getMetricsConfig(dashboardPanelData)),
      );
      return url.href;
    });

    // this is used to activate the watcher only after on mounted
    let isPanelConfigWatcherActivated = false;
    const isPanelConfigChanged = ref(false);

    // Reset before children mount so FieldList sees stream_type=metrics (avoids a spurious logs stream fetch).
    onBeforeMount(() => {
      applyMetricsDefaults();
      pendingAutoRun = hydrateFromUrl();
    });

    onMounted(async () => {
      // DateTimePicker is now mounted; safe to read its value
      updateDateTime();

      // let it call the watchers and then mark the panel config watcher as activated
      await nextTick();
      isPanelConfigWatcherActivated = true;

      await seedBuilderSlots();

      // auto-run a restored blob / inbound deep-link, then normalize the URL
      if (pendingAutoRun) {
        pendingAutoRun = false;
        updateDateTime();
        runQuery();
      }
    });

    watch(
      () => dashboardPanelData.data.type,
      async () => {
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));

        // chart-type change re-renders outside runQuery(); re-sync only for an established view (metrics_data present).
        if (isPanelConfigWatcherActivated && route.query.metrics_data) {
          syncStateToUrl();
        }
      },
    );

    watch(selectedDate, () => {
      updateDateTime();
    });

    // resize the chart when config panel is opened and closed
    watch(
      () => dashboardPanelData.layout.isConfigPanelOpen,
      () => {
        window.dispatchEvent(new Event("resize"));
      },
    );

    watch(
      () => dashboardPanelData.data.queries[0]?.fields?.stream,
      async (stream: string, oldStream: string) => {
        if (store.state.zoConfig?.auto_query_enabled && stream) {
          saveMetricsStream(
            store.state.selectedOrganization.identifier,
            stream,
          );
        }

        // Seed the default query when a stream becomes available in builder mode
        // with an empty query (the !query guard avoids overwriting an existing one).
        const query = dashboardPanelData.data.queries[0];
        if (
          isPanelConfigWatcherActivated &&
          stream &&
          stream !== oldStream &&
          !query?.customQuery &&
          !query?.query
        ) {
          await applyDefaultPanelFields();
        }
      },
    );

    // NOTE: Field change watcher for auto SQL generation has been moved to PanelEditor.vue
    // This centralizes the logic and ensures consistent behavior across all pages

    // resize the chart when query editor is opened and closed
    watch(
      () => dashboardPanelData.layout.showQueryBar,
      () => {
        window.dispatchEvent(new Event("resize"));
      },
    );

    const runQuery = () => {
      if (!isValid(true, false)) {
        return;
      }

      // copy the data object excluding the reactivity
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      // refresh the date time based on current time if relative date is selected
      dateTimePickerRef.value && dateTimePickerRef.value.refresh();
      updateDateTime();

      // Call PanelEditor's runQuery if available
      if (panelEditorRef.value) {
        panelEditorRef.value.runQuery();
      }

      // panel -> URL (full blob + time/refresh); normalizes any inbound params.
      syncStateToUrl();
    };

    const updateDateTime = () => {
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
    const debouncedUpdateChartConfig = debounce((newVal) => {
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
          errors.push(t("metrics.index.namePanelRequired"));
        }
      }

      // will push errors in errors array
      validatePanel(errors, isFieldsValidationRequired);

      if (errors.length) {
        showErrorNotification(
          t("metrics.index.errorsFixTryAgain"),
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

    const addToDashboard = () => {
      const errors: any = [];
      // will push errors in errors array
      validatePanel(errors, true);

      if (errors.length) {
        // set errors into errorData
        errorData.errors = errors;
        showErrorNotification(
          t("metrics.index.errorsFixTryAgain"),
        );
        return;
      } else {
        showAddToDashboardDialog.value = true;
      }
    };

    const addPanelToDashboard = () => {
      showAddToDashboardDialog.value = false;
    };

    const goBackToExplorer = () => {
      const back = router.options?.history?.state?.back;
      if (
        typeof back === "string" &&
        back.startsWith("/metrics") &&
        !back.startsWith("/metrics/editor")
      ) {
        router.back();
        return;
      }
      router.push({
        name: "metrics",
        query: {
          org_identifier: store.state.selectedOrganization?.identifier,
        },
      });
    };

    // [END] cancel running queries

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "metricsRunQuery",
        handler: () => runQuery(),
      },
      {
        id: "metricsRefresh",
        handler: () => {
          if (isInputFocused()) return;
          runQuery();
        },
      },
      {
        id: "metricsFocusQuery",
        handler: () => {
          // The metrics PromQL editor is Monaco — focus its inner textarea.
          const el = document.querySelector<HTMLElement>(
            '[data-test="dashboard-panel-query-editor"] textarea, [data-test="dashboard-panel-query-editor"] .monaco-editor textarea, [data-test="dashboard-panel-query-editor"] .cm-editor',
          );
          el?.focus();
        },
      },
      {
        id: "metricsAddToDashboard",
        handler: () => {
          if (isInputFocused()) return;
          addToDashboard();
        },
      },
      {
        id: "metricsCopyUrl",
        handler: () => {
          // Reuse ShareButton's short-URL + clipboard + toast flow.
          document
            .querySelector<HTMLElement>('[data-test="metrics-share-btn"]')
            ?.click();
        },
      },
    ]);

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
      goBackToExplorer,
      refreshInterval,
      panelEditorRef,
      metricsShareUrl,
    };
  },
});
</script>


