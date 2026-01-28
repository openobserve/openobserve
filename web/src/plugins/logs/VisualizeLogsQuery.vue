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
  <div style="height: 100%; width: 100%; display: flex; flex-direction: column">
    <!-- Action Bar with Add to Dashboard Button -->
    <div class="tw:flex tw:justify-end tw:p-2 tw:items-center" style="flex-shrink: 0">
      <q-btn
        size="md"
        class="no-border o2-secondary-button"
        no-caps
        dense
        style="padding: 2px 4px; z-index: 1"
        color="primary"
        @click="addToDashboard"
        :title="$t('search.addToDashboard')"
        :disabled="props.errorData?.errors?.length > 0"
      >
        {{ $t("search.addToDashboard") }}
      </q-btn>
    </div>

    <!-- Unified AddPanel Component for Logs Visualization -->
    <AddPanel
      ref="addPanelRef"
      mode="logs"
      pageKey="logs"
      :showHeader="false"
      :showQueryEditor="false"
      :showVariablesSelector="false"
      :allowHTMLEditor="false"
      :allowMarkdownEditor="false"
      :allowCustomCharts="false"
      :allowedChartTypes="['area', 'bar', 'h-bar', 'line', 'scatter', 'table']"
      :defaultStreamType="'logs'"
      :enforceStreamType="true"
      :visualizeChartData="props.visualizeChartData"
      :errorData="props.errorData"
      :searchResponse="props.searchResponse"
      :is_ui_histogram="props.is_ui_histogram"
      :shouldRefreshWithoutCache="props.shouldRefreshWithoutCache"
      :searchType="undefined"
      @handleChartApiError="handleChartApiError"
      style="flex: 1; min-height: 0"
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
import { defineComponent, ref, provide, inject, defineAsyncComponent } from "vue";
import AddPanel from "@/views/Dashboards/addPanel/AddPanel.vue";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import useNotifications from "@/composables/useNotifications";

const AddToDashboard = defineAsyncComponent(() => {
  return import("./../metrics/AddToDashboard.vue");
});

export default defineComponent({
  name: "VisualizeLogsQuery",
  props: {
    visualizeChartData: {
      type: Object,
      required: true,
    },
    errorData: {
      type: Object,
      required: true,
    },
    searchResponse: {
      type: Object,
      required: false,
    },
    is_ui_histogram: {
      type: Boolean,
      required: false,
      default: false,
    },
    shouldRefreshWithoutCache: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  components: {
    AddPanel,
    AddToDashboard,
  },
  emits: ["handleChartApiError"],
  setup(props, { emit }) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "logs",
    );
    const { showErrorNotification } = useNotifications();
    const { dashboardPanelData, validatePanel } =
      useDashboardPanelData(dashboardPanelDataPageKey);

    const addPanelRef = ref(null);
    const showAddToDashboardDialog = ref(false);
    const resultMetaData = ref<any>([]);
    const is_ui_histogram = ref(props.is_ui_histogram);

    // Provide the dashboard panel data page key to child components
    provide("dashboardPanelDataPageKey", dashboardPanelDataPageKey);

    const handleChartApiError = (errorMsg: any) => {
      emit("handleChartApiError", errorMsg);
    };

    // Add to Dashboard functionality
    const addToDashboard = () => {
      if (
        resultMetaData.value?.[0]?.[0]?.converted_histogram_query &&
        is_ui_histogram.value === true
      ) {
        dashboardPanelData.data.queries[0].query =
          resultMetaData.value?.[0]?.[0]?.converted_histogram_query;
      } else if (
        // Backward compatibility - check if it's old format
        resultMetaData.value?.[0]?.converted_histogram_query &&
        is_ui_histogram.value === true &&
        !Array.isArray(resultMetaData.value?.[0])
      ) {
        dashboardPanelData.data.queries[0].query =
          resultMetaData.value?.[0]?.converted_histogram_query;
      }

      const errors: any = [];
      // will push errors in errors array
      validatePanel(errors, true);

      if (errors.length) {
        // set errors into errorData
        props.errorData.errors = errors;
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
      dashboardPanelData,
      addPanelRef,
      showAddToDashboardDialog,
      handleChartApiError,
      addToDashboard,
      addPanelToDashboard,
    };
  },
});
</script>

<style scoped lang="scss">
/* Styles inherited from AddPanel */
</style>
