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
  /Index.vue) mounts in production, run in a constrained in-page configuration:
  editMode, a metrics-appropriate allowedChartTypes set, and the metrics defaults
  (line + promql + query bar on). So the chart the user builds here is exactly the
  one they get on a dashboard, and it inherits right-click → Create Alert for free.

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
      :variables-data="{}"
      :selected-date-time="selectedDateTime"
      :allowed-chart-types="allowedChartTypes"
      @add-to-dashboard="onAddToDashboard"
      @chart-api-error="onChartApiError"
    />

    <AddToDashboard
      v-model:open="showAddToDashboardDialog"
      :dashboard-panel-data="dashboardPanelData"
      @save="showAddToDashboardDialog = false"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, provide, onMounted, type PropType } from "vue";
import { useStore } from "vuex";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import useNotifications from "@/composables/useNotifications";
import { restoreMetricsStream } from "@/utils/streamPersist";
import { PanelEditor } from "@/components/dashboards/PanelEditor";
import AddToDashboard from "../AddToDashboard.vue";

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
  },
  setup() {
    // The PanelEditor family keys its shared state off this provide — "metrics"
    // gives us the metrics defaults and the promql query bar, matching Index.vue.
    provide("dashboardPanelDataPageKey", "metrics");

    const store = useStore();
    const { showErrorNotification } = useNotifications();
    const { dashboardPanelData, resetDashboardPanelData, validatePanel } =
      useDashboardPanelData("metrics");

    const panelEditorRef = ref<any>(null);
    const showAddToDashboardDialog = ref(false);

    // A metrics-appropriate subset — the chart types that make sense for a
    // PromQL time series. Mirrors the logs visualize constraint.
    const allowedChartTypes = [
      "area",
      "bar",
      "h-bar",
      "line",
      "scatter",
      "table",
    ];

    // Same defaults the metrics editor route applies: a line chart driven by a
    // promql query, with the query bar shown so the user can type PromQL.
    const applyMetricsDefaults = () => {
      resetDashboardPanelData();
      dashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      if (store.state.zoConfig?.auto_query_enabled) {
        const persisted = restoreMetricsStream(
          store.state.selectedOrganization?.identifier,
        );
        if (persisted) {
          dashboardPanelData.data.queries[0].fields.stream = persisted;
        }
      }
      dashboardPanelData.data.type = "line";
      dashboardPanelData.data.queryType = "promql";
      dashboardPanelData.data.queries[0].customQuery = false;
      dashboardPanelData.layout.showQueryBar = true;
    };

    onMounted(() => {
      applyMetricsDefaults();
    });

    // Validate before opening the add-to-dashboard dialog — the same handshake
    // the metrics editor uses, so an incomplete panel can't be saved.
    const onAddToDashboard = () => {
      const errors: string[] = [];
      validatePanel(errors, true);
      if (errors.length) {
        showErrorNotification(errors[0]);
        return;
      }
      showAddToDashboardDialog.value = true;
    };

    const onChartApiError = (_error: unknown) => {
      // PanelEditor surfaces its own error UI; nothing extra to do here.
    };

    return {
      panelEditorRef,
      dashboardPanelData,
      showAddToDashboardDialog,
      allowedChartTypes,
      onAddToDashboard,
      onChartApiError,
    };
  },
});
</script>
