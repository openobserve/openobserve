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

<!--
  Visualize mode for the Metrics explorer — a query-driven workspace.

  This is the SAME dashboard PanelEditor the metrics editor route (plugins/metrics
  /Index.vue) mounts in production, run in-page with editMode and the metrics
  defaults (line + promql + query bar on). Chart types are NOT restricted — the
  same full set AddPanel offers, gated only by ChartSelection's own PromQL rules.
  So the chart the user builds here is exactly the one they get on a dashboard,
  and it inherits right-click → Create Alert for free.

  The Explore label-filter bar is hidden in this mode (the parent gates it): in
  Visualize the PromQL query carries its own matchers, so a separate filter bar is
  redundant — the same split Logs' visualize uses.
-->
<template>
  <div class="h-full w-full" data-test="metrics-explorer-visualize">
    <PanelEditor
      ref="panelEditorRef"
      page-type="metrics"
      :edit-mode="true"
      :dashboard-data="{}"
      :variables-data="emptyVariablesData"
      :selected-date-time="dashboardPanelData.meta.dateTime"
      @add-to-dashboard="onAddToDashboard"
      @chart-api-error="onChartApiError"
      @renderer-error="onRendererError"
    />

    <AddToDashboard
      v-model:open="showAddToDashboardDialog"
      :dashboard-panel-data="dashboardPanelData"
      @save="showAddToDashboardDialog = false"
    />
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  provide,
  onBeforeMount,
  onMounted,
  onBeforeUnmount,
  nextTick,
  watch,
  type PropType,
} from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import useNotifications from "@/composables/useNotifications";
import { restoreMetricsStream } from "@/utils/streamPersist";
import { applyMetricsBlob, normaliseMetricsBlobData } from "@/composables/metrics/metricsUrlState";
import { useQueryHistoryRecorder } from "@/composables/metrics/useQueryHistoryRecorder";
import type { PanelErrorDetail } from "@/utils/queryHistory/metrics";
import type { SelectedDate } from "@/utils/dashboard/urlTimeParams";
import { PanelEditor } from "@/components/dashboards/PanelEditor";
import type { PanelEditorVariablesData } from "@/components/dashboards/PanelEditor";
import AddToDashboard from "../AddToDashboard.vue";
import { usePanelLivePreview } from "@/composables/dashboard/usePanelLivePreview";
import { useAutoRunToggle } from "@/composables/dashboard/useAutoRunToggle";

export default defineComponent({
  name: "MetricsVisualize",
  components: {
    PanelEditor,
    AddToDashboard,
  },
  props: {
    /** The explorer's current time window, so the chart shares the toolbar's
     *  range (the same object the DateTimePicker drives). */
    selectedDateTime: {
      type: Object as PropType<Record<string, any>>,
      default: () => ({
        valueType: "relative",
        relativeTimePeriod: "15m",
        startTime: null,
        endTime: null,
      }),
    },
    /** A panel-schema `data` object handed in from a card's "Open" — carries the
     *  metric's TYPE-BASED operation (sum(rate()), quantile, …). When present,
     *  Visualize opens on this query instead of the blank metrics defaults. */
    seed: {
      type: Object as PropType<Record<string, any> | null>,
      default: null,
    },
  },
  emits: ["seed-consumed", "update:time-range", "run"],
  setup(props, { emit }) {
    // The PanelEditor family keys its shared state off this provide — "metrics"
    // gives us the metrics defaults and the promql query bar, matching Index.vue.
    provide("dashboardPanelDataPageKey", "metrics");
    // The editor's ⌘/Ctrl+Enter calls this; the parent's Run owns the range and the history write.
    provide("runQuery", () => emit("run"));

    const store = useStore();
    const { showErrorNotification } = useNotifications();
    const { t } = useI18nTyped();
    const { dashboardPanelData, resetDashboardPanelData, validatePanel } = useDashboardPanelData(
      "metrics",
      t,
    );

    const panelEditorRef = ref<any>(null);
    const showAddToDashboardDialog = ref(false);

    // Visualize has no dashboard variables; PanelEditor still requires the shape.
    const emptyVariablesData: PanelEditorVariablesData = {
      isVariablesLoading: false,
      values: [],
    };

    // Same defaults the metrics editor route applies: a line chart driven by a
    // promql query, with the query bar shown so the user can type PromQL.
    const applyMetricsDefaults = () => {
      resetDashboardPanelData();
      dashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      if (store.state.zoConfig?.auto_query_enabled) {
        const persisted = restoreMetricsStream(store.state.selectedOrganization?.identifier);
        if (persisted) {
          dashboardPanelData.data.queries[0].fields.stream = persisted;
        }
      }
      dashboardPanelData.data.type = "line";
      dashboardPanelData.data.queryType = "promql";
      dashboardPanelData.data.queries[0].customQuery = false;
      dashboardPanelData.layout.showQueryBar = true;
    };

    // Open on a card's type-based query: reset to a clean metrics panel, then lay
    // the seed's panel-schema `data` on top (the same shape the metrics editor
    // receives from the card drill-in). Every query is forced to the metrics
    // stream type. Mirrors `applyMetricsBlob`, but from a raw data object.
    const applySeed = (seed: Record<string, any>) => {
      resetDashboardPanelData();
      dashboardPanelData.layout.showQueryBar = true;
      Object.assign(dashboardPanelData.data, normaliseMetricsBlobData({ ...seed }));
      dashboardPanelData.layout.currentQueryIndex = 0;
    };

    /**
     * Whether THIS mount was seeded — captured here, not re-read from the prop.
     *
     * `seed-consumed` makes the parent null `visualizeSeed` immediately, so by
     * `onMounted` the prop is already gone. Asking `props.seed` there always said
     * "no seed", and the auto-run silently never fired: the user landed on a
     * fully-populated query bar with a blank chart, having to press Refresh to
     * see the very metric they just clicked.
     */
    let seededOnMount = false;

    // BEFORE the PanelEditor child mounts (matches the metrics editor route): if
    // it mounts first, it initialises an empty query area and a later assign does
    // not reflect into the already-built query bar.
    onBeforeMount(() => {
      if (props.seed) {
        applySeed(props.seed);
        seededOnMount = true;
        emit("seed-consumed");
      } else {
        applyMetricsDefaults();
      }
    });

    // Validate before opening the add-to-dashboard dialog — the same handshake
    // the metrics editor uses, so an incomplete panel can't be saved.
    const onAddToDashboard = () => {
      const errors: string[] = [];
      validatePanel(errors, true);
      if (errors.length) {
        showErrorNotification(raw(errors[0]));
        return;
      }
      showAddToDashboardDialog.value = true;
    };

    const onChartApiError = (_error: unknown) => {
      // PanelEditor surfaces its own error UI; nothing extra to do here.
    };

    // History reads the renderer's error to classify the run; PanelEditor shows it itself.
    const onRendererError = (error: PanelErrorDetail | string | null) => {
      historyRecorder.onPanelError(error);
    };

    const timeKey = () => `${props.selectedDateTime?.startTime}:${props.selectedDateTime?.endTime}`;
    // The window the chart last ran with; null until the first one is applied, which always applies.
    const appliedTimeKey = ref<string | null>(null);
    const isTimeChangePending = computed(
      () => appliedTimeKey.value !== null && timeKey() !== appliedTimeKey.value,
    );

    /**
     * Push the toolbar's window into the panel's `meta.dateTime` — the shape the
     * PanelEditor/chart reads (absolute start/end Dates).
     *
     * PanelEditor's own runQuery only refreshes ITS dateTimePickerRef, which does
     * not exist in this embedded usage (our picker lives in the parent toolbar).
     * So without this the panel has no window at all and the chart never queries.
     */
    const applyDateTime = () => {
      const dt = props.selectedDateTime;
      if (dt?.startTime != null && dt?.endTime != null) {
        appliedTimeKey.value = timeKey();
        dashboardPanelData.meta.dateTime = {
          start_time: new Date(dt.startTime),
          end_time: new Date(dt.endTime),
        };
      }
    };

    /**
     * Re-run the CURRENT query and repaint the chart — exactly one query. Exposed
     * so the toolbar's refresh can drive Visualize (in this mode refresh must
     * re-run this query, NOT sweep the Explore grid).
     */
    const runQuery = (withoutCache = false) => {
      livePreview.markRunStarted();
      applyDateTime();
      panelEditorRef.value?.runQuery?.(withoutCache);
    };

    const { isAutoRunOn } = useAutoRunToggle();

    const isBuilderValid = () => {
      const errors: string[] = [];
      validatePanel(errors, true);
      return errors.length === 0;
    };

    // Auto Run's live runs go through runQuery, never onUserRun, so they write no history.
    const livePreview = usePanelLivePreview({
      panel: () => dashboardPanelData.data,
      applied: () => panelEditorRef.value?.chartData,
      liveVariables: () => [],
      committedVariables: () => [],
      isBuilderValid,
      isLoading: computed(() => panelEditorRef.value?.isLoading ?? false),
      run: () => runQuery(),
      pendingApply: () => isTimeChangePending.value,
      autoRun: () => isAutoRunOn.value,
    });
    const isRunQueryPending = computed(() => livePreview.isPending.value);

    // A seeded panel's load-time normalisation is not an edit, so live preview starts with the user's first input.
    const armOnFirstInput = () => livePreview.arm();
    onMounted(() => {
      window.addEventListener("pointerdown", armOnFirstInput, true);
      window.addEventListener("keydown", armOnFirstInput, true);
    });
    onBeforeUnmount(() => {
      window.removeEventListener("pointerdown", armOnFirstInput, true);
      window.removeEventListener("keydown", armOnFirstInput, true);
    });

    // Turning Auto Run back on applies a range picked while it was off.
    watch(isAutoRunOn, (on) => {
      if (on && isTimeChangePending.value) runQuery();
    });

    const historyRecorder = useQueryHistoryRecorder(() => !!panelEditorRef.value?.isLoading);

    /** An explicit Run (button, shortcut or Refresh Cache & Run): the only run that writes history. */
    const onUserRun = (selectedDate: SelectedDate, withoutCache = false) => {
      runQuery(withoutCache);
      const errors: string[] = [];
      validatePanel(errors, false);
      if (!errors.length) historyRecorder.record(dashboardPanelData, selectedDate);
    };

    // Set while applying an entry, so its range change does not also run the old query.
    let applyingEntry = false;

    /** Loads a history entry live: its panel in place, its range on the parent's picker; a re-run is a user Run. */
    const applyPanelData = async (metricsData: string, timeRange: SelectedDate, run = true) => {
      if (!applyMetricsBlob(metricsData, dashboardPanelData)) return;
      applyingEntry = true;
      emit("update:time-range", timeRange);
      await nextTick();
      applyingEntry = false;
      if (run) onUserRun(timeRange);
    };

    // Declared AFTER applyDateTime/runQuery: the hooks call them, and a const
    // arrow function is in its temporal dead zone until defined.
    //
    // A card's "Open" arrives with a real query — paint it straight away rather
    // than making the user hit refresh. A blank Visualize (no seed) just sets the
    // window and waits for the user to build a query. `nextTick` lets PanelEditor
    // mount so its exposed runQuery is available.
    onMounted(async () => {
      applyDateTime();
      // `seededOnMount`, NOT `props.seed` — the prop is already null by now; see
      // its declaration.
      if (!seededOnMount) return;
      // Two ticks: the first lets PanelEditor mount, the second lets ITS own
      // watchers settle so `panelEditorRef.runQuery` is exposed and the panel
      // state it reads is committed. One tick fires before the ref is populated
      // and the auto-run silently does nothing.
      await nextTick();
      await nextTick();
      runQuery();
    });

    // With Auto Run off a picked range waits for Run like any other edit, as in Add Panel.
    watch(
      () => props.selectedDateTime,
      () => {
        if (applyingEntry) return;
        if (!dashboardPanelData.data?.queries?.[0]?.query) applyDateTime();
        else if (isAutoRunOn.value) runQuery();
      },
      { deep: true },
    );

    return {
      panelEditorRef,
      dashboardPanelData,
      emptyVariablesData,
      showAddToDashboardDialog,
      onAddToDashboard,
      onChartApiError,
      onRendererError,
      runQuery,
      onUserRun,
      applyPanelData,
      isRunQueryPending,
    };
  },
});
</script>
