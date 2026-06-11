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
  <div style="overflow-y: auto" class="scroll tw:flex tw:flex-col tw:h-full" data-test="metrics-page">
    <!-- Standard page header: title + icon + all query controls on ONE line
         (syntax guide, legends, date range, refresh, Run). No extra toolbar row. -->
    <AppPageHeader
      :title="t('search.metrics')"
      icon="bar-chart"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
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
          class="dashboard-icons"
          data-test="metrics-auto-refresh"
        />
        <ShareButton
          v-if="!['html', 'markdown'].includes(dashboardPanelData.data.type)"
          :url="metricsShareUrl"
          variant="outline"
          size="icon-toolbar"
          data-test="metrics-share-btn"
          class="dashboard-icons"
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
            <span class="tw:relative tw:flex tw:items-center tw:justify-center">
              <span class="tw:invisible">{{ t("metrics.runQuery") }}</span>
              <span class="tw:absolute">{{ t("panel.cancel") }}</span>
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
          </OButton>
        </template>
      </template>
    </AppPageHeader>

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
    <add-to-dashboard
      v-model:open="showAddToDashboardDialog"
      :dashboardPanelData="dashboardPanelData"
      @save="addPanelToDashboard"
    />
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
  onBeforeMount,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "../../composables/dashboard/useDashboardPanel";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import SyntaxGuideMetrics from "./SyntaxGuideMetrics.vue";
import MetricLegends from "./MetricLegends.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { isEqual, debounce } from "lodash-es";
import { provide } from "vue";
import useNotifications from "@/composables/useNotifications";
import config from "@/aws-exports";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { PanelEditor } from "@/components/dashboards/PanelEditor";
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

export default defineComponent({
  name: "Metrics",
  props: ["metaData"],

  components: {
    AppPageHeader,
    DateTimePickerDashboard,
    SyntaxGuideMetrics,
    MetricLegends,
    AddToDashboard,
    AutoRefreshInterval,
    PanelEditor,
    OButton,
    ShareButton,
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

    // ---- Share-URL (Feature 1) + deep-link redirection (Feature 2) wiring ----
    // The metrics route is NOT kept-alive (MainLayout's <router-view> renders the
    // component directly), so it re-mounts on every navigation -> onMounted is the
    // single restore point; no onActivated/keepAlive guard is needed.
    let pendingAutoRun = false;

    // reset the panel to the metrics defaults (factored so it can be reused).
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

    // panel -> URL: invoked at the end of runQuery. Encodes the whole panel into
    // a fresh metrics_data blob + time/refresh, dropping inbound-only override
    // params (normalization). Diff-before-write avoids history spam.
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

    // URL -> panel: base (blob) -> overrides -> time/refresh. Returns whether an
    // inbound state is present (the auto-run gate).
    const hydrateFromUrl = (): boolean => {
      const q = route.query as Record<string, any>;

      // 1) BASE: blob if present, else keep the just-reset defaults
      if (q.metrics_data) applyMetricsBlob(q.metrics_data, dashboardPanelData);

      // 2) OVERRIDES (deep-link redirection)
      applyDeepLinkOverrides(q, dashboardPanelData);

      // 3) time + refresh (shared urlTimeParams helper)
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

    // seed builder-mode slots (a stream but no query) so they get a starter
    // query before auto-run (covers multi-query stream_name-only deep-links).
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

    // share URL: freeze a relative period into absolute from/to (mirrors the
    // dashboardShareURL behaviour) so a shared link reproduces the exact window.
    // Share URL: snapshot the CURRENT editor state (whole panel + time +
    // refresh) into a fresh /metrics link, independent of whether the browser
    // URL has been synced yet — so Share works even before the first Run. A
    // relative period is frozen to absolute from/to so the recipient sees the
    // exact same window. Building fresh (not from window.location) also avoids
    // carrying any not-yet-normalized inbound override params into the link.
    const metricsShareUrl = computed(() => {
      void route.fullPath; // recompute as the URL / state changes
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

    onUnmounted(() => {
      // NOTE: Do NOT call resetDashboardPanelData() here.
      // When org changes, Vue mounts the new component (onBeforeMount) BEFORE
      // unmounting the old one (onUnmounted). Resetting the shared singleton
      // dashboardPanelDataObj["metrics"] here would overwrite the "promql" state
      // that the new instance just set, causing the PromQL query type to
      // disappear after every org switch. The new instance's onBeforeMount
      // already resets and re-initialises the state correctly.
    });

    // Initialize state before any child components mount so FieldList.vue sees
    // stream_type = "metrics" from the start, preventing a spurious
    // streams?type=logs request and the double stream-list fetch that results
    // from stream_type changing logs → metrics after children have mounted.
    onBeforeMount(() => {
      // Reset to metrics defaults, then hydrate any URL state (blob base ->
      // deep-link overrides -> time/refresh). pendingAutoRun is consumed in
      // onMounted once the picker + PanelEditor are available.
      applyMetricsDefaults();
      pendingAutoRun = hydrateFromUrl();
    });

    onMounted(async () => {
      // DateTimePicker is now mounted; safe to read its value
      updateDateTime(selectedDate.value);

      // let it call the watchers and then mark the panel config watcher as activated
      await nextTick();
      isPanelConfigWatcherActivated = true;

      // Seed builder-mode slots (a stream but no query) so the PromQL builder bar
      // is populated — on fresh load (queries[0]) and for deep-link builder slots.
      await seedBuilderSlots();

      // Auto-run a restored blob / inbound deep-link, then normalize the URL.
      if (pendingAutoRun) {
        pendingAutoRun = false;
        updateDateTime(selectedDate.value);
        runQuery();
      }
    });

    watch(
      () => dashboardPanelData.data.type,
      async () => {
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));

        // A chart-type change re-renders without going through runQuery(), so
        // the metrics_data blob on the URL would otherwise go stale. Re-sync —
        // but only for an already-established view (metrics_data already on the
        // URL): we still don't write a URL before the first Run (D1), and this
        // skips the programmatic type changes during load/hydration.
        if (isPanelConfigWatcherActivated && route.query.metrics_data) {
          syncStateToUrl();
        }
      },
    );

    watch(selectedDate, () => {
      updateDateTime(selectedDate.value);
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
      updateDateTime(selectedDate.value);

      // Call PanelEditor's runQuery if available
      if (panelEditorRef.value) {
        panelEditorRef.value.runQuery();
      }

      // panel -> URL (full blob + time/refresh); normalizes any inbound params.
      syncStateToUrl();
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
      metricsShareUrl,
    };
  },
});
</script>

<style lang="scss" scoped>
.dashboard-icons {
  height: 32px;
}
</style>

