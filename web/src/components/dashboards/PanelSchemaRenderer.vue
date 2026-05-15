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
  <div
    style="width: 100%; height: 100%"
    @mouseleave="hidePopupsAndOverlays"
    @mouseenter="showPopupsAndOverlays"
  >
    <div
      ref="chartPanelRef"
      style="height: 100%; position: relative"
      :class="chartPanelClass"
    >
      <div
        v-if="!errorDetail?.message"
        :style="{ height: chartPanelHeight, width: '100%' }"
      >
        <MapsRenderer
          v-if="panelSchema.type == 'maps'"
          :data="panelData.chartType == 'maps' ? panelData : { options: {} }"
        ></MapsRenderer>
        <GeoMapRenderer
          v-else-if="panelSchema.type == 'geomap'"
          :data="
            panelData.chartType == 'geomap'
              ? panelData
              : { options: { backgroundColor: 'transparent' } }
          "
        />
        <PromQLTableChart
          v-else-if="
            panelSchema.type == 'table' && panelSchema.queryType === 'promql'
          "
          ref="tableRendererRef"
          :data="tableRendererData"
          :config="panelSchema.config"
          @row-click="onChartClick"
        />
        <TableRenderer
          v-else-if="panelSchema.type == 'table'"
          :data="
            panelData.chartType == 'table'
              ? panelData
              : { options: { backgroundColor: 'transparent' } }
          "
          :value-mapping="panelSchema?.config?.mappings ?? []"
          @row-click="onChartClick"
          ref="tableRendererRef"
          :wrap-cells="panelSchema.config?.wrap_table_cells"
          :show-pagination="
            panelSchema.config?.table_pagination && !store.state.printMode
          "
          :rows-per-page="panelSchema.config?.table_pagination_rows_per_page"
        />
        <div
          v-else-if="panelSchema.type == 'html'"
          class="col column"
          style="width: 100%; height: 100%; flex: 1"
        >
          <HTMLRenderer
            :htmlContent="panelSchema.htmlContent"
            style="width: 100%; height: 100%"
            class="col"
            :variablesData="currentVariablesData || variablesData"
            :tabId="tabId"
            :panelId="panelSchema.id"
          />
        </div>
        <div
          v-else-if="panelSchema.type == 'markdown'"
          class="col column"
          style="width: 100%; height: 100%; flex: 1"
        >
          <MarkdownRenderer
            :markdownContent="panelSchema.markdownContent"
            style="width: 100%; height: 100%"
            class="col"
            :variablesData="currentVariablesData || variablesData"
            :tabId="tabId"
            :panelId="panelSchema.id"
          />
        </div>

        <CustomChartRenderer
          v-else-if="panelSchema.type == 'custom_chart'"
          :data="panelData"
          style="width: 100%; height: 100%"
          class="col"
          @error="errorDetail = $event"
        />
        <ChartRenderer
          v-else
          ref="chartRendererRef"
          :data="
            panelSchema.queryType === 'promql' ||
            (panelData.chartType != 'geomap' &&
              panelData.chartType != 'table' &&
              panelData.chartType != 'maps' &&
              loading)
              ? panelData
              : noData == 'No Data'
                ? {
                    options: {
                      backgroundColor: 'transparent',
                    },
                  }
                : panelData
          "
          :height="chartPanelHeight"
          @updated:data-zoom="onDataZoom"
          @error="errorDetail = $event"
          @click="onChartClick"
          @contextmenu="onChartContextMenu"
          @domcontextmenu="onChartDomContextMenu"
        />
      </div>
      <div
        v-if="
          !errorDetail?.message &&
          panelSchema.type != 'geomap' &&
          panelSchema.type != 'maps' &&
          !loading
        "
        class="noData"
        data-test="no-data"
      >
        {{ noData }}
      </div>
      <div
        v-if="
          errorDetail?.message &&
          !panelSchema?.error_config?.custom_error_handeling
        "
        class="errorMessage"
      >
        <q-icon size="md" name="warning" />
        <div style="height: 80%; width: 100%">
          {{
            errorDetail?.code?.toString().startsWith("4")
              ? errorDetail.message
              : "Error Loading Data"
          }}
        </div>
      </div>
      <div
        v-if="
          errorDetail?.message &&
          panelSchema?.error_config?.custom_error_handeling &&
          !panelSchema?.error_config?.default_data_on_error &&
          panelSchema?.error_config?.custom_error_message
        "
        class="customErrorMessage"
      >
        {{ panelSchema?.error_config?.custom_error_message }}
      </div>
      <div
        class="row"
        style="position: absolute; top: 0px; width: 100%; z-index: 999"
      >
        <LoadingProgress
          :loading="loading"
          :loadingProgressPercentage="loadingProgressPercentage"
        />
      </div>
      <div
        v-if="isCursorOverPanel"
        class="flex items-center q-gutter-x-xs"
        style="
          position: absolute;
          top: 0px;
          right: 0px;
          z-index: 9;
          padding-right: 2px;
          padding-top: 2px;
        "
        @click.stop
      >
        <OButton
          v-if="
            showLegendsButton &&
            noData !== 'No Data' &&
            ![
              'table',
              'html',
              'markdown',
              'custom_chart',
              'geomap',
              'maps',
              'heatmap',
              'metric',
              'gauge',
            ].includes(panelSchema.type)
          "
          variant="outline"
          size="icon-circle"
          @click="$emit('show-legends')"
        >
          <template #icon-left><q-icon name="format_list_bulleted" /></template>
          <q-tooltip anchor="top middle" self="bottom right">
            Show Legends
          </q-tooltip>
        </OButton>
        <OButton
          v-if="
            [
              'area',
              'area-stacked',
              'bar',
              'h-bar',
              'line',
              'scatter',
              'stacked',
              'h-stacked',
            ].includes(panelSchema.type) &&
            checkIfPanelIsTimeSeries === true &&
            allowAnnotationsAdd &&
            !viewOnly
          "
          variant="outline"
          size="icon-circle"
          @click="toggleAddAnnotationMode"
        >
          <template #icon-left
            ><q-icon :name="isAddAnnotationMode ? 'cancel' : 'edit'"
          /></template>
          <q-tooltip anchor="top middle" self="bottom right">
            {{
              isAddAnnotationMode ? "Exit Annotations Mode" : "Add Annotations"
            }}
          </q-tooltip>
        </OButton>
      </div>
      <div
        class="crosslink-drilldown-menu"
        :class="{
          'crosslink-drilldown-menu--dark': store.state.theme === 'dark',
        }"
        data-test="drilldown-menu"
        ref="drilldownPopUpRef"
        @mouseleave="hidePopupsAndOverlays"
      >
        <template
          v-for="(drilldown, index) in drilldownArray"
          :key="JSON.stringify(drilldown)"
        >
          <q-separator
            v-if="
              drilldown._isCrossLink &&
              index > 0 &&
              !drilldownArray[index - 1]._isCrossLink
            "
          />
          <div
            class="crosslink-drilldown-menu-item"
            data-test="drilldown-menu-item"
            @click="openDrilldown(index)"
          >
            <q-icon
              size="xs"
              class="q-mr-sm"
              :name="drilldown._isCrossLink ? 'open_in_new' : 'link'"
            />
            <span>{{ drilldown.name }}</span>
          </div>
        </template>
      </div>
      <div
        style="
          border: 1px solid gray;
          border-radius: 4px;
          padding: 3px;
          position: absolute;
          top: 0px;
          left: 0px;
          display: none;
          max-width: 200px;
          white-space: normal;
          word-wrap: break-word;
          overflow-wrap: break-word;
          z-index: 9999999;
        "
        :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
        ref="annotationPopupRef"
      >
        <div
          class="q-px-sm q-py-xs"
          style="
            display: flex;
            flex-direction: row;
            align-items: center;
            position: relative;
            word-break: break-word;
          "
        >
          <span style="word-break: break-word">{{
            selectedAnnotationData.text
          }}</span>
        </div>
      </div>
      <!-- Annotation Dialog -->
      <AddAnnotation
        v-if="isAddAnnotationDialogVisible"
        :dashboardId="dashboardId"
        :annotation="annotationToAddEdit"
        @close="closeAddAnnotation"
        :panelsList="panelsList"
      />
      <!-- Alert Context Menu -->
      <AlertContextMenu
        :visible="contextMenuVisible"
        :x="contextMenuPosition.x"
        :y="contextMenuPosition.y"
        :value="contextMenuValue"
        @select="handleCreateAlert"
        @close="hideContextMenu"
      />
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  watch,
  ref,
  shallowRef,
  toRefs,
  computed,
  inject,
  nextTick,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
} from "vue";
import { useStore } from "vuex";
import { usePanelDataLoader } from "@/composables/dashboard/usePanelDataLoader";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import { getDataValue } from "@/utils/dashboard/aliasUtils";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { useRoute, useRouter } from "vue-router";
import useNotifications from "@/composables/useNotifications";
import { validateSQLPanelFields } from "@/utils/dashboard/panelValidation";
import { useAnnotationsData } from "@/composables/dashboard/useAnnotationsData";
import LoadingProgress from "@/components/common/LoadingProgress.vue";
import {
  usePanelAlertCreation,
  usePanelDownload,
} from "@/composables/dashboard/usePanelActions";
import { usePanelDrilldown } from "@/composables/dashboard/usePanelDrilldown";
import {
  overlayNewDataOnOldOptions,
  isOverlayEligible,
} from "@/utils/dashboard/streaming";
import { detectChunkingDirection } from "@/utils/dashboard/chunkingDirection";

const ChartRenderer = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/ChartRenderer.vue");
});

const TableRenderer = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/TableRenderer.vue");
});

const PromQLTableChart = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/PromQLTableChart.vue");
});

const GeoMapRenderer = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/GeoMapRenderer.vue");
});

const MapsRenderer = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/MapsRenderer.vue");
});

const HTMLRenderer = defineAsyncComponent(() => {
  return import("./panels/HTMLRenderer.vue");
});

const MarkdownRenderer = defineAsyncComponent(() => {
  return import("./panels/MarkdownRenderer.vue");
});

const AddAnnotation = defineAsyncComponent(() => {
  return import("./addPanel/AddAnnotation.vue");
});
const CustomChartRenderer = defineAsyncComponent(() => {
  return import("./panels/CustomChartRenderer.vue");
});

const AlertContextMenu = defineAsyncComponent(() => {
  return import("./AlertContextMenu.vue");
});
import OButton from "@/lib/core/Button/OButton.vue";

export default defineComponent({
  name: "PanelSchemaRenderer",
  components: {
    ChartRenderer,
    AlertContextMenu,
    TableRenderer,
    PromQLTableChart,
    GeoMapRenderer,
    MapsRenderer,
    HTMLRenderer,
    MarkdownRenderer,
    AddAnnotation,
    CustomChartRenderer,
    LoadingProgress,
    OButton,
  },
  props: {
    selectedTimeObj: {
      required: true,
      type: Object,
    },
    panelSchema: {
      required: true,
      type: Object,
    },
    variablesData: {
      required: true,
      type: Object,
    },
    currentVariablesData: {
      required: false,
      type: Object,
      default: null,
    },
    forceLoad: {
      type: Boolean,
      default: false,
      required: false,
    },
    searchType: {
      default: null,
      type: String || null,
    },
    dashboardId: {
      default: "",
      required: false,
      type: String,
    },
    folderId: {
      default: "",
      required: false,
      type: String,
    },
    reportId: {
      default: "",
      required: false,
      type: String,
    },
    allowAnnotationsAdd: {
      default: false,
      required: false,
      type: Boolean,
    },
    allowAlertCreation: {
      default: false,
      required: false,
      type: Boolean,
    },
    runId: {
      type: String,
      default: null,
    },
    tabId: {
      type: String,
      default: null,
    },
    tabName: {
      type: String,
      default: null,
    },
    dashboardName: {
      type: String,
      default: null,
    },
    folderName: {
      type: String,
      default: null,
    },
    searchResponse: {
      required: false,
      type: Object,
    },
    is_ui_histogram: {
      type: Boolean,
      required: false,
      default: false,
    },
    viewOnly: {
      type: Boolean,
      default: false,
    },
    shouldRefreshWithoutCache: {
      type: Boolean,
      required: false,
      default: false,
    },
    showLegendsButton: {
      type: Boolean,
      required: false,
      default: false,
    },
    regionClusterParams: {
      type: Object,
      required: false,
      default: undefined,
    },
  },
  emits: [
    "updated:data-zoom",
    "error",
    "metadata-update",
    "result-metadata-update",
    "last-triggered-at-update",
    "is-cached-data-differ-with-current-time-range-update",
    "update:initialVariableValues",
    "updated:vrlFunctionFieldList",
    "loading-state-change",
    "limit-number-of-series-warning-message-update",
    "is-partial-data-update",
    "series-data-update",
    "contextmenu",
    "show-legends",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();

    // ============================================================================
    // Hidden Queries Feature Setup
    // ============================================================================
    // This feature allows temporarily hiding PromQL query results from charts
    // on the Add Panel and Metrics pages. It's stored in layout (not config)
    // so it's not persisted to the dashboard.
    //
    // IMPORTANT: PanelSchemaRenderer is used in multiple contexts:
    // - AddPanel.vue (provides page key "addpanel") - needs hiding feature ✓
    // - metrics/Index.vue (provides page key "metrics") - needs hiding feature ✓
    // - ViewPanel.vue (provides page key "dashboard") - doesn't need it
    // - VisualizeLogsQuery.vue (provides page key "logs") - doesn't need it
    // - PreviewAlert.vue (no page key) - doesn't need it
    // - PanelContainer.vue (no page key) - doesn't need it
    // - PreviewPromqlQuery.vue (no page key) - doesn't need it
    //
    // To avoid breaking these other contexts, we:
    // 1. Inject with null default to detect if page key was explicitly provided
    // 2. Only call useDashboardPanelData if a page key exists
    // 3. Return empty array [] if no hiddenQueries (no filtering applied)
    // ============================================================================

    const dashboardPanelDataPageKey: any = inject(
      "dashboardPanelDataPageKey",
      null, // null default allows us to detect if key was provided
    );

    // Only access the composable if we're in a context that provides a page key
    // This prevents creating unnecessary composable instances and accessing
    // wrong panel data in contexts that don't need the hiding feature
    let dashboardPanelDataForHiding: any = null;
    if (dashboardPanelDataPageKey) {
      const result = useDashboardPanelData(dashboardPanelDataPageKey);
      dashboardPanelDataForHiding = result.dashboardPanelData;
    }

    // Returns array of hidden query indices (e.g., [0, 2] means queries 0 and 2 are hidden)
    // Returns [] if no page key or no hiddenQueries - which means no filtering
    const hiddenQueries = computed(() => {
      return dashboardPanelDataForHiding?.layout?.hiddenQueries || [];
    });

    // stores the converted data which can be directly used for rendering different types of panels
    const panelData: any = shallowRef({}); // holds the data to render the panel after getting data from the api based on panel config
    const chartPanelRef: any = ref(null); // holds the ref to the whole div
    const chartRendererRef: any = ref(null); // holds the ref to the ChartRenderer component
    const selectedAnnotationData: any = ref([]);
    const drilldownPopUpRef: any = ref(null);

    const annotationPopupRef: any = ref(null);

    const limitNumberOfSeriesWarningMessage: any = ref("");

    const chartPanelStyle = ref({
      height: "100%",
      width: "100%",
    });

    const isCursorOverPanel = ref(false);
    const showPopupsAndOverlays = () => {
      isCursorOverPanel.value = true;
    };

    // get refs from props
    const {
      panelSchema,
      selectedTimeObj,
      variablesData,
      forceLoad,
      searchType,
      dashboardId,
      folderId,
      reportId,
      allowAnnotationsAdd,
      allowAlertCreation,
      runId,
      tabId,
      tabName,
      dashboardName,
      folderName,
      searchResponse,
      is_ui_histogram,
      shouldRefreshWithoutCache,
      showLegendsButton,
      regionClusterParams,
    } = toRefs(props);
    // calls the apis to get the data based on the panel config
    let {
      data,
      loading,
      errorDetail,
      metadata,
      resultMetaData,
      annotations,
      lastTriggeredAt,
      isCachedDataDifferWithCurrentTimeRange,
      searchRequestTraceIds,
      loadingProgressPercentage,
      isPartialData,
    } = usePanelDataLoader(
      panelSchema,
      selectedTimeObj,
      variablesData,
      chartPanelRef,
      forceLoad,
      searchType,
      dashboardId,
      folderId,
      reportId,
      runId,
      tabId,
      tabName,
      searchResponse,
      is_ui_histogram,
      dashboardName,
      folderName,
      shouldRefreshWithoutCache,
      regionClusterParams,
    );

    const {
      isAddAnnotationMode,
      isAddAnnotationDialogVisible,
      annotationToAddEdit,
      editAnnotation,
      toggleAddAnnotationMode,
      handleAddAnnotation,
      closeAddAnnotation,
      disableAddAnnotationMode,
      fetchAllPanels,
      panelsList,
    } = useAnnotationsData(
      store.state.selectedOrganization?.identifier,
      dashboardId.value,
      panelSchema.value.id,
      folderId.value,
    );

    // Filter data based on hiddenQueries for PromQL panels
    const filteredData = computed(() => {
      // If no data, return as is
      if (!data.value) {
        return data.value;
      }

      // Only filter for PromQL queries
      if (panelSchema.value.queryType !== "promql") {
        return data.value;
      }

      // If no hidden queries or empty array, return as is
      if (
        !hiddenQueries.value ||
        hiddenQueries.value.length === 0 ||
        !Array.isArray(data.value)
      ) {
        return data.value;
      }

      // Filter out hidden queries
      const filtered = data.value.filter(
        (_: any, index: number) => !hiddenQueries.value.includes(index),
      );

      // Return filtered data
      return filtered;
    });

    // The latest metadata chunk's time_offset.start_time (┬╡s) marks the left boundary
    // of data received so far. Also pull the full query start so the overlay function
    // can compute the fraction against the complete query range, not just received data.
    // Direction-aware boundary for the streaming overlay.
    //
    //  - RTL (chunks arrive newest-first): fresh data is to the RIGHT of
    //    `boundaryTime`. Overlay covers the stale LEFT portion. boundaryTime
    //    is the LAST entry's time_offset.start_time (earliest received).
    //  - LTR (chunks arrive earliest-first): fresh data is to the LEFT of
    //    `boundaryTime`. Overlay covers the stale RIGHT portion. boundaryTime
    //    is the LAST entry's time_offset.end_time (latest received).
    //
    // Times are in microseconds to match resultMetaData; convert to ms downstream.
    const overlayBoundaryInfo = computed(() => {
      const resultMeta = resultMetaData.value?.[0];
      const queryStart = Number(metadata.value?.queries?.[0]?.startTime ?? 0);
      const queryEnd = Number(metadata.value?.queries?.[0]?.endTime ?? 0);
      // PromQL always streams LTR (oldest timestamps first), no time_offset.
      const isPromQL = panelSchema.value?.queryType === "promql";

      if (isPromQL || !resultMeta?.length) {
        return { boundaryTime: 0, queryStart, queryEnd, isLTR: isPromQL };
      }

      const firstEntry = resultMeta[0];
      const lastEntry = resultMeta[resultMeta.length - 1];

      const isLTR =
        detectChunkingDirection(
          firstEntry?.time_offset?.start_time ?? 0,
          firstEntry?.time_offset?.end_time ?? 0,
          queryStart,
          queryEnd,
        ) ?? false;

      const boundaryTime = isLTR
        ? (lastEntry?.time_offset?.end_time ?? 0)
        : (lastEntry?.time_offset?.start_time ?? 0);

      return { boundaryTime, queryStart, queryEnd, isLTR };
    });

    // need tableRendererRef to access downloadTableAsCSV method
    const tableRendererRef: any = ref(null);

    // Context menu state for alert creation (shared with usePanelAlertCreation)
    const contextMenuData = ref<any>(null);

    const {
      contextMenuVisible,
      contextMenuPosition,
      contextMenuValue,
      onChartContextMenu,
      onChartDomContextMenu,
      hideContextMenu,
      handleCreateAlert,
    } = usePanelAlertCreation({
      panelSchema,
      allowAlertCreation,
      metadata,
      selectedTimeObj,
      contextMenuData,
      store,
      router,
      emit,
    });

    // hovered series state
    // used to show tooltip axis for all charts
    const hoveredSeriesState: any = inject("hoveredSeriesState", null);

    const validatePanelData = computed(() => {
      const errors: any = [];

      // fields validation is not required for promql
      if (panelSchema.value?.queryType == "promql") {
        return errors;
      }

      const currentXLabel =
        panelSchema?.value?.type == "table"
          ? "First Column"
          : panelSchema?.value?.type == "h-bar"
            ? "Y-Axis"
            : "X-Axis";

      const currentYLabel =
        panelSchema?.value?.type == "table"
          ? "Other Columns"
          : panelSchema?.value?.type == "h-bar"
            ? "X-Axis"
            : "Y-Axis";

      validateSQLPanelFields(
        panelSchema.value,
        0,
        currentXLabel,
        currentYLabel,
        errors,
        true,
      );

      return errors;
    });

    // ======= [START] dashboard PrintMode =======

    //inject variablesAndPanelsDataLoadingState from parent
    // default values will be empty object of panels and variablesData
    const variablesAndPanelsDataLoadingState: any = inject(
      "variablesAndPanelsDataLoadingState",
      { panels: {}, variablesData: {}, searchRequestTraceIds: {} },
    );

    // Watch loading state changes and emit them to parent
    watch(loading, (newLoadingState) => {
      emit("loading-state-change", newLoadingState);
      if (newLoadingState) {
        disableAddAnnotationMode();
      }
    });

    // on loading state change, update the loading state of the panels in variablesAndPanelsDataLoadingState
    watch(loading, (updatedLoadingValue) => {
      if (variablesAndPanelsDataLoadingState) {
        // update the loading state of the current panel
        variablesAndPanelsDataLoadingState.panels = {
          ...variablesAndPanelsDataLoadingState?.panels,
          [panelSchema?.value?.id]: updatedLoadingValue,
        };
      }
    });
    //watch trace id and add in the searchRequestTraceIds
    watch(searchRequestTraceIds, (updatedSearchRequestTraceIds) => {
      if (variablesAndPanelsDataLoadingState) {
        variablesAndPanelsDataLoadingState.searchRequestTraceIds = {
          ...variablesAndPanelsDataLoadingState?.searchRequestTraceIds,
          [panelSchema?.value?.id]: updatedSearchRequestTraceIds,
        };
      }
    });
    // ======= [END] dashboard PrintMode =======

    onMounted(async () => {
      // fetch all panels
      await fetchAllPanels();
      panelsList.value = panelsList.value;
    });

    // When switching of tab was done, reset the loading state of the panels in variablesAndPanelsDataLoadingState
    // As some panels were getting true cancel button and datetime picker were not getting updated
    onUnmounted(() => {
      if (variablesAndPanelsDataLoadingState) {
        variablesAndPanelsDataLoadingState.searchRequestTraceIds = {
          ...variablesAndPanelsDataLoadingState?.searchRequestTraceIds,
          [panelSchema?.value?.id]: [],
        };
        variablesAndPanelsDataLoadingState.panels = {
          ...variablesAndPanelsDataLoadingState?.panels,
          [panelSchema?.value?.id]: false,
        };
      }

      // Clear all refs to prevent memory leaks
      chartPanelRef.value = null;
      drilldownPopUpRef.value = null;
      annotationPopupRef.value = null;
      tableRendererRef.value = null;
    });
    const convertPanelDataCommon = async (applyOverlay = false) => {
      if (
        !errorDetail?.value?.message &&
        validatePanelData?.value?.length === 0
      ) {
        try {
          const result = await convertPanelData(
            panelSchema.value,
            filteredData.value,
            store,
            chartPanelRef,
            hoveredSeriesState,
            resultMetaData,
            metadata.value,
            chartPanelStyle.value,
            annotations,
            loading.value,
          );

          // Apply overlay BEFORE assigning to panelData.value.
          // This ensures a single watcher trigger with the overlaid options,
          // avoiding the double-setOption issue (one without graphic, one with).
          // Even without old data, overlay adds phantom anchor points so the
          // first streaming chunk doesn't fill the entire chart width.
          if (applyOverlay) {
            const hasFullOverlay =
              previousOptionsSnapshot &&
              isOverlayEligible(panelSchema.value, previousOptionsSnapshot);

            // Pass container dimensions so the overlay can calculate
            // graphic width/height and barMaxWidth for bar charts.
            const containerEl = chartPanelRef.value;
            const containerSize = containerEl
              ? {
                  width: containerEl.clientWidth,
                  height: containerEl.clientHeight,
                }
              : undefined;
            const boundaryInfo = overlayBoundaryInfo.value;
            // Resolve the primary theme color using the same priority as App.vue:
            // 1. Vuex tempThemeColors (live preview)
            // 2. localStorage saved color
            // 3. Org settings color
            // 4. Default theme color from store
            const _themeMode = store.state.theme === "dark" ? "dark" : "light";
            const primaryColor: string =
              (_themeMode === "dark"
                ? store.state.tempThemeColors?.dark
                : store.state.tempThemeColors?.light) ||
              window.localStorage.getItem(
                _themeMode === "dark" ? "customDarkColor" : "customLightColor",
              ) ||
              (_themeMode === "dark"
                ? store.state?.organizationData?.organizationSettings
                    ?.dark_mode_theme_color
                : store.state?.organizationData?.organizationSettings
                    ?.light_mode_theme_color) ||
              (_themeMode === "dark"
                ? store.state.defaultThemeColors?.dark
                : store.state.defaultThemeColors?.light) ||
              "#3F7994";
            const meta = resultMetaData.value?.[0]?.[0];
            // SQL: histogram_interval in seconds. PromQL: step in µs.
            const histogramIntervalMs = meta?.histogram_interval
              ? meta.histogram_interval * 1000
              : meta?.step
                ? meta.step / 1000
                : 0;

            // For PromQL (no time_offset), derive boundaryTime from the
            // last timestamp in the new series data (LTR: fresh edge).
            // Convert ms → µs to match the boundaryTime convention.
            let { boundaryTime } = boundaryInfo;
            if (!boundaryTime && boundaryInfo.isLTR && result.options?.series) {
              for (const s of result.options.series) {
                if (!s.name || !Array.isArray(s.data) || !s.data.length)
                  continue;
                const lastPt = s.data[s.data.length - 1];
                if (!Array.isArray(lastPt)) continue;
                const t =
                  typeof lastPt[0] === "number"
                    ? lastPt[0]
                    : new Date(lastPt[0]).getTime();
                if (!isNaN(t) && t * 1000 > boundaryTime) {
                  boundaryTime = t * 1000; // ms → µs
                }
              }
            }

            // Refresh _gridRect from the live chart so the overlay tracks
            // the current grid dimensions. The snapshot captured at stream
            // start can be stale if y-axis labels grew wider (larger values)
            // or if bottom spacing changed during streaming.
            if (hasFullOverlay && previousOptionsSnapshot) {
              try {
                const chartInstance = chartRendererRef.value?.chart;
                if (chartInstance) {
                  const gridModel = chartInstance
                    ?.getModel()
                    ?.getComponent("grid");
                  const freshRect = gridModel?.coordinateSystem?.getRect();
                  if (freshRect) {
                    previousOptionsSnapshot._gridRect = {
                      x: freshRect.x,
                      y: freshRect.y,
                      width: freshRect.width,
                      height: freshRect.height,
                    };
                  }
                }
              } catch {
                // Keep existing _gridRect if chart isn't ready
              }
            }

            result.options = overlayNewDataOnOldOptions(
              hasFullOverlay ? previousOptionsSnapshot : null,
              result.options,
              containerSize,
              hasFullOverlay ? boundaryTime : undefined,
              boundaryInfo.queryStart,
              boundaryInfo.queryEnd,
              boundaryInfo.isLTR,
              primaryColor,
              histogramIntervalMs,
            );
          }

          panelData.value = result;

          limitNumberOfSeriesWarningMessage.value =
            panelData.value?.extras?.limitNumberOfSeriesWarningMessage ?? "";

          errorDetail.value = {
            message: "",
            code: "",
          };
        } catch (error: any) {
          errorDetail.value = {
            message: error?.message,
            code: error?.code || "",
          };
        }
      } else {
        // if no data is available, then show the default data
        // if there is an error config in the panel schema, then show the default data on error
        // if no default data on error is set, then show the custom error message
        if (
          panelSchema.value?.error_config?.custom_error_handeling &&
          panelSchema.value?.error_config?.default_data_on_error
        ) {
          data.value = JSON.parse(
            panelSchema.value?.error_config?.default_data_on_error,
          );
          errorDetail.value = {
            message: "",
            code: "",
          };
        }
      }
    };

    // --- Streaming overlay state ---
    // Snapshot of old panelData.options taken when streaming starts (for refresh overlay).
    // Immutable once set — each chunk overlays against the same original.
    let previousOptionsSnapshot: any = null;

    // Guard flag to prevent double final render when the stream ends with a
    // simultaneous data change. Both watch([data,...]) and watch(loading) fire
    // in the same tick — this ensures only the first one executes the render.
    let streamEndRenderPending = false;

    // Watch for panel schema changes to re-convert panel data
    watch(
      panelSchema,
      async () => {
        // Re-convert panel data when schema changes (for non-whitelisted config changes)
        // Skip if queries length changed - let data watcher handle it after reload
        const currentQueriesCount = panelSchema.value?.queries?.length || 0;
        const dataArrayCount = data.value?.length || 0;

        // Skip conversion if query count doesn't match data count - data is stale
        if (currentQueriesCount !== dataArrayCount) {
          return;
        }

        if (
          !errorDetail?.value?.message &&
          validatePanelData?.value?.length === 0 &&
          data.value?.length
        ) {
          await convertPanelDataCommon();
        }
      },
      { deep: true },
    );

    // Watch for hiddenQueries changes to re-render the chart
    watch(
      hiddenQueries,
      async () => {
        // Only re-convert panel data if we're in promql mode
        if (panelSchema.value.queryType === "promql" && data.value) {
          await convertPanelDataCommon();
        }
      },
      { deep: true },
    );

    watch(
      [
        data,
        () => store?.state?.theme,
        () => store?.state?.timezone,
        annotations,
      ],
      async () => {
        // emit vrl function field list
        if (data.value?.length && data.value[0] && data.value[0].length) {
          // Find the index of the record with max attributes
          const maxAttributesIndex = data.value[0].reduce(
            (
              maxIndex: string | number | any,
              obj: {},
              currentIndex: any,
              array: Array<Record<string, unknown>>,
            ) => {
              const numAttributes = Object.keys(obj).length;
              const maxNumAttributes = Object.keys(array[maxIndex]).length;
              return numAttributes > maxNumAttributes ? currentIndex : maxIndex;
            },
            0,
          );

          const recordwithMaxAttribute = data.value[0][maxAttributesIndex];

          const responseFields = Object.keys(recordwithMaxAttribute);

          emit("updated:vrlFunctionFieldList", responseFields);
        }
        if (panelData.value.chartType == "custom_chart")
          errorDetail.value = {
            message: "",
            code: "",
          };

        // Check if this is the first chunk with actual data
        // SQL queries have data.value[0] as an array of hits (not an object with .result)
        // PromQL queries have data.value[0] as an object with .result property
        const hasData =
          data.value?.length > 0 &&
          (data.value[0]?.result?.length > 0 ||
            (Array.isArray(data.value[0]) && data.value[0].length > 0));

        if (loading.value) {
          // ---- STREAMING (chunks arriving) ----
          // Every chunk overlays against previousOptionsSnapshot (captured
          // once in the loading watcher when streaming starts), or falls back
          // to phantom anchors when no snapshot is available.
          if (hasData) {
            await convertPanelDataCommon(true);
          }
          // else: no data yet → skip conversion → loading bar shown
        } else {
          // ---- LOADING COMPLETE ----
          // Skip refresh-reset firings: when the executor sets state.data = []
          // at the start of a new query, this watcher fires with hasData=false
          // while loading hasn't yet been flipped to true. If we converted here
          // we'd assign an empty result to panelData.value, destroying the
          // previous chart before the streaming first-chunk can snapshot it
          // for the overlay. True zero-result completions are handled by the
          // watch(loading, ...) handler below.
          if (!hasData && panelData.value?.options?.series?.length > 0) {
            return;
          }

          // Claim the final render before awaiting so that watch(loading),
          // which fires in the same tick, sees the flag and skips its render.
          streamEndRenderPending = true;

          // Final render with FULL data — no overlay needed (new data is complete)
          await convertPanelDataCommon();

          streamEndRenderPending = false;

          // Clear streaming state — old snapshot no longer needed
          if (previousOptionsSnapshot) {
            previousOptionsSnapshot = null;
          }
        }
      },
      { deep: true },
    );

    // Watch loading to bookend each streaming session.
    // Start (false→true): snapshot the current chart for the overlay.
    //   Every chunk overlays against this same original — the snapshot is
    //   immutable from here until the stream ends.
    // End (true→false): do the final render without overlay (unless the
    //   data watcher already claimed it via streamEndRenderPending) and
    //   clear the snapshot so the next stream captures fresh.
    watch(loading, async (newLoading, oldLoading) => {
      if (oldLoading === false && newLoading === true) {
        const hasOldChart = panelData.value?.options?.series?.length > 0;
        if (hasOldChart) {
          previousOptionsSnapshot = JSON.parse(
            JSON.stringify(panelData.value.options),
          );
          previousOptionsSnapshot._chartType = panelSchema.value?.type;
          previousOptionsSnapshot._queryCount =
            panelSchema.value?.queries?.length;

          // Capture actual grid pixel rect from the ECharts instance.
          // With containLabel: true, the actual plot area differs from raw grid config.
          // WARNING: getModel().getComponent() is an ECharts internal API, not public.
          // Validated against echarts 5.6.0. Revisit if ECharts is upgraded.
          try {
            const chartInstance = chartRendererRef.value?.chart;
            if (chartInstance) {
              const gridModel = chartInstance?.getModel()?.getComponent("grid");
              const gridRect = gridModel?.coordinateSystem?.getRect();
              if (gridRect) {
                previousOptionsSnapshot._gridRect = {
                  x: gridRect.x,
                  y: gridRect.y,
                  width: gridRect.width,
                  height: gridRect.height,
                };
              }
            }
          } catch {
            // Ignore — will fall back to grid config values in overlay
          }
        }
      } else if (oldLoading === true && newLoading === false) {
        // If the data watcher's else-branch already claimed the final render
        // (simultaneous data + loading change in the same tick), skip here.
        if (streamEndRenderPending) return;

        // Final render with complete data — no overlay
        await convertPanelDataCommon();

        // Clear streaming state
        if (previousOptionsSnapshot) {
          previousOptionsSnapshot = null;
        }
      }
    });

    const checkIfPanelIsTimeSeries = computed(() => {
      return panelData.value?.extras?.isTimeSeries;
    });

    // when we get the new metadata from the apis, emit the metadata update
    watch(
      metadata,
      () => {
        emit("metadata-update", metadata.value);
      },
      { deep: true },
    );

    // Listen for layout changes to update chart dimensions
    const handleWindowLayoutChanges = async () => {
      if (chartPanelRef.value) {
        await nextTick();
        await convertPanelDataCommon();
      }
    };

    // ResizeObserver to detect chartPanelRef dimension changes
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    onMounted(() => {
      if (chartPanelRef.value) {
        resizeObserver = new ResizeObserver(() => {
          // Debounce the resize handler to prevent "ResizeObserver loop" errors
          // This error occurs when the callback takes longer than one animation frame
          if (resizeTimeout) {
            clearTimeout(resizeTimeout);
          }

          resizeTimeout = window.setTimeout(() => {
            // Use requestAnimationFrame to ensure DOM updates happen at the right time
            requestAnimationFrame(() => {
              handleWindowLayoutChanges();
            });
          }, 100); // 100ms debounce delay
        });

        resizeObserver.observe(chartPanelRef.value);
      }
    });

    onUnmounted(() => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
        resizeTimeout = null;
      }
    });

    watch(
      panelData,
      () => {
        emit("series-data-update", panelData.value);
      },
      { deep: true },
    );

    // when we get the new limitNumberOfSeriesWarningMessage from the convertPanelData, emit the limitNumberOfSeriesWarningMessage
    watch(
      limitNumberOfSeriesWarningMessage,
      () => {
        emit(
          "limit-number-of-series-warning-message-update",
          limitNumberOfSeriesWarningMessage.value,
        );
      },
      { deep: true },
    );

    watch(lastTriggeredAt, () => {
      emit("last-triggered-at-update", lastTriggeredAt.value);
    });

    watch(isCachedDataDifferWithCurrentTimeRange, () => {
      emit(
        "is-cached-data-differ-with-current-time-range-update",
        isCachedDataDifferWithCurrentTimeRange.value,
      );
    });

    const onDataZoom = (event: any) => {
      if (allowAnnotationsAdd.value && isAddAnnotationMode.value) {
        // looks like zoom not needed
        // handle add annotation
        handleAddAnnotation(event.start, event.end);
      } else {
        // default behavior
        emit("updated:data-zoom", {
          ...event,
          data: { id: panelSchema.value.id, title: panelSchema.value.title },
        });
      }
    };

    const handleNoData = (panelType: any) => {
      const xAlias = panelSchema.value.queries[0].fields.x.map(
        (it: any) => it.alias || [],
      );
      const yAlias = panelSchema.value.queries[0].fields.y.map(
        (it: any) => it.alias || [],
      );
      const zAlias = panelSchema.value.queries[0].fields.z.map(
        (it: any) => it.alias || [],
      );

      const rows = data.value[0];

      // Check if at least one row has all required non-null field values
      // for the given chart type. Uses .some() to short-circuit on the
      // first valid row found.
      switch (panelType) {
        case "area":
        case "area-stacked":
        case "bar":
        case "h-bar":
        case "stacked":
        case "h-stacked":
        case "line":
        case "scatter":
        case "gauge": {
          return rows.some(
            (row: any) =>
              xAlias.every((x: any) => getDataValue(row, x) != null) &&
              yAlias.every((y: any) => getDataValue(row, y) != null),
          );
        }
        case "table": {
          // For tables, check that at least one row has any non-null field
          return rows.some(
            (row: any) =>
              xAlias.some((x: any) => getDataValue(row, x) != null) ||
              yAlias.some((y: any) => getDataValue(row, y) != null),
          );
        }
        case "metric": {
          return rows.some((row: any) =>
            yAlias.every((y: any) => getDataValue(row, y) != null),
          );
        }
        case "heatmap": {
          return rows.some(
            (row: any) =>
              xAlias.every((x: any) => getDataValue(row, x) != null) &&
              yAlias.every((y: any) => getDataValue(row, y) != null) &&
              zAlias.every((z: any) => getDataValue(row, z) != null),
          );
        }
        case "pie":
        case "donut": {
          return rows.some((row: any) =>
            yAlias.every((y: any) => getDataValue(row, y) != null),
          );
        }
        case "maps":
        case "geomap": {
          return true;
        }
        case "sankey": {
          const source = panelSchema.value.queries[0].fields.source.alias;
          const target = panelSchema.value.queries[0].fields.target.alias;
          const value = panelSchema.value.queries[0].fields.value.alias;
          return rows.some(
            (row: any) =>
              source.every((s: any) => getDataValue(row, s) != null) &&
              target.every((t: any) => getDataValue(row, t) != null) &&
              value.every((v: any) => getDataValue(row, v) != null),
          );
        }
        default:
          break;
      }
    };

    // Compute the value of the 'noData' variable
    const noData = computed(() => {
      // if panel type is 'html' or 'markdown', return an empty string
      if (
        panelSchema.value.type == "html" ||
        panelSchema.value.type == "markdown" ||
        panelSchema.value.type == "custom_chart"
      ) {
        return "";
      }
      // Check if the queryType is 'promql'
      if (panelSchema.value?.queryType == "promql") {
        // Check if the 'filteredData' array has elements and every item has a non-empty 'result' array
        return filteredData.value?.length &&
          filteredData.value.some((item: any) => item?.result?.length)
          ? "" // Return an empty string if there is data
          : "No Data"; // Return "No Data" if there is no data
      }

      // A rendered chart is already on screen — suppress "No Data" even if
      // the raw data buffer is momentarily empty. This prevents a flicker on
      // refresh where the executor resets state.data = [] before loading
      // flips to true, transiently firing this computed with empty data.
      if (panelData.value?.options?.series?.length > 0) {
        return "";
      }
      // The queryType is not 'promql'
      return data.value.length &&
        data.value[0]?.length &&
        handleNoData(panelSchema.value.type)
        ? ""
        : "No Data"; // Return "No Data" if the 'data' array is empty, otherwise return an empty string
    });

    // when the error changes, emit the error
    watch(errorDetail, () => {
      //check if there is an error message or not
      // if (!errorDetail.value) return; // emmit is required to reset the error on parent component
      emit("error", errorDetail.value);
    });

    const { showErrorNotification, showPositiveNotification } =
      useNotifications();

    const {
      drilldownArray,
      onChartClick,
      openDrilldown,
      hidePopupsAndOverlays,
    } = usePanelDrilldown({
      panelSchema,
      variablesData,
      selectedTimeObj,
      metadata,
      data,
      panelData,
      filteredData,
      resultMetaData,
      store,
      route,
      router,
      emit,
      allowAnnotationsAdd,
      isAddAnnotationMode,
      editAnnotation,
      handleAddAnnotation,
      chartPanelRef,
      drilldownPopUpRef,
      annotationPopupRef,
      selectedAnnotationData,
      isCursorOverPanel,
      showErrorNotification,
    });

    const { downloadDataAsCSV, downloadDataAsJSON, getPanelCsvString } = usePanelDownload({
      panelSchema,
      data,
      filteredData,
      tableRendererRef,
      showErrorNotification,
      showPositiveNotification,
    });

    const chartPanelHeight = computed(() => {
      if (
        panelSchema.value?.queries?.[0]?.fields?.breakdown?.length > 0 &&
        panelSchema.value.config?.trellis?.layout &&
        !loading.value
      ) {
        return chartPanelStyle.value.height;
      }

      return "100%";
    });

    const chartPanelClass = computed(() => {
      if (
        panelSchema.value?.queries?.[0]?.fields?.breakdown?.length > 0 &&
        panelSchema.value.config?.trellis?.layout &&
        !loading.value
      ) {
        return "overflow-auto";
      }

      return "";
    });

    // Watch isPartialData changes and emit them
    watch(isPartialData, (newValue) => {
      emit("is-partial-data-update", newValue);
    });

    // Computed property for table data with logging
    const tableRendererData = computed(() => {
      if (panelSchema.value.type === "table") {
        let tableData;

        if (panelSchema.value.queryType === "promql") {
          // For PromQL tables, the data is in panelData.options (same as pie/donut)
          // The TableConverter returns {columns, rows, ...} which gets placed in options
          tableData = panelData.value?.options || { rows: [], columns: [] };
        } else if (panelData.value?.chartType == "table") {
          tableData = panelData.value;
        } else {
          tableData = { options: { backgroundColor: "transparent" } };
        }

        return tableData;
      }
      return { options: { backgroundColor: "transparent" } };
    });

    return {
      store,
      chartPanelRef,
      chartRendererRef,
      data,
      loading,
      searchRequestTraceIds,
      errorDetail,
      panelData,
      noData,
      metadata,
      tableRendererRef,
      tableRendererData,
      onChartClick,
      onDataZoom,
      drilldownArray,
      selectedAnnotationData,
      openDrilldown,
      drilldownPopUpRef,
      annotationPopupRef,
      hidePopupsAndOverlays,
      chartPanelClass,
      chartPanelHeight,
      validatePanelData,
      isAddAnnotationDialogVisible,
      closeAddAnnotation,
      isAddAnnotationMode,
      toggleAddAnnotationMode,
      annotationToAddEdit,
      checkIfPanelIsTimeSeries,
      panelsList,
      isCursorOverPanel,
      showPopupsAndOverlays,
      downloadDataAsCSV,
      downloadDataAsJSON,
      getPanelCsvData: (title: string) => {
        const csv = getPanelCsvString();
        if (!csv) return null;
        return {
          title: title ?? panelSchema.value?.title ?? "panel",
          csv,
        };
      },
      logDataAsJSON: (title: string) => {
        const chartData =
          panelSchema.value?.queryType === "promql"
            ? filteredData.value
            : data.value;
        console.group(`[oo] ${title ?? panelSchema.value?.title ?? "panel"}`);
        console.log(chartData);
        console.groupEnd();
      },
      loadingProgressPercentage,
      isPartialData,
      contextMenuVisible,
      contextMenuPosition,
      contextMenuValue,
      contextMenuData,
      onChartContextMenu,
      onChartDomContextMenu,
      hideContextMenu,
      handleCreateAlert,
    };
  },
});
</script>

<style lang="scss" scoped>
// Cross-link drilldown popup — matches AlertContextMenu.vue exactly
.crosslink-drilldown-menu {
  position: absolute;
  z-index: 9999999;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  padding: 4px 0;
  display: none;
  white-space: nowrap;
  top: 0;
  left: 0;
}

.crosslink-drilldown-menu-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  transition: background-color 0.2s;
  font-size: 14px;
  color: #333;

  &:hover {
    background-color: #f5f5f5;
  }

  &:active {
    background-color: #e0e0e0;
  }

  span {
    user-select: none;
  }
}

.crosslink-drilldown-menu--dark {
  background: #2c2c2c;
  border-color: #404040;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.crosslink-drilldown-menu--dark .crosslink-drilldown-menu-item {
  color: #e0e0e0;
}

.crosslink-drilldown-menu--dark .crosslink-drilldown-menu-item:hover {
  background-color: #383838;
}

.crosslink-drilldown-menu--dark .crosslink-drilldown-menu-item:active {
  background-color: #444444;
}

.drilldown-item:hover {
  background-color: rgba(202, 201, 201, 0.908);
}

.errorMessage {
  position: absolute;
  top: 20%;
  width: 100%;
  height: 80%;
  overflow: hidden;
  text-align: center;
  // color: rgba(255, 0, 0, 0.8);
  text-overflow: ellipsis;
}

.customErrorMessage {
  position: absolute;
  top: 20%;
  width: 100%;
  height: 80%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
}

.noData {
  position: absolute;
  top: 20%;
  width: 100%;
  text-align: center;
}
</style>
