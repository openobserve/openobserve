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
  <div class="w-full h-full"
    @mouseleave="hidePopupsAndOverlays"
    @mouseenter="showPopupsAndOverlays"
  >
    <div class="h-full relative"
      ref="chartPanelRef"
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
          :enable-filtering="!!panelSchema.config?.table_filtering && !store.state.printMode"
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
          :enable-filtering="!!panelSchema.config?.table_filtering && !store.state.printMode"
        />
        <div
          v-else-if="panelSchema.type == 'html'"
          class="flex flex-col column w-full h-full flex-1"
        >
          <HTMLRenderer
            :htmlContent="panelSchema.htmlContent"
            class="flex flex-col w-full h-full"
            :variablesData="currentVariablesData || variablesData"
            :tabId="tabId"
            :panelId="panelSchema.id"
          />
        </div>
        <div
          v-else-if="panelSchema.type == 'markdown'"
          class="flex flex-col column w-full h-full flex-1"
        >
          <MarkdownRenderer
            :markdownContent="panelSchema.markdownContent"
            class="flex flex-col w-full h-full"
            :variablesData="currentVariablesData || variablesData"
            :tabId="tabId"
            :panelId="panelSchema.id"
          />
        </div>

        <CustomChartRenderer
          v-else-if="panelSchema.type == 'custom_chart'"
          :data="panelData"
          class="flex flex-col w-full h-full"
          @error="errorDetail = $event"
        />
        <ChartRenderer
          v-else
          ref="chartRendererRef"
          :data="chartRendererData"
          :height="chartPanelHeight"
          :render-type="panelSchema?.type === 'metric' ? 'svg' : 'canvas'"
          @updated:data-zoom="onDataZoom"
          @error="errorDetail = $event"
          @click="onChartClick"
          @contextmenu="onChartContextMenu"
          @domcontextmenu="onChartDomContextMenu"
        />
      </div>
      <div
        v-if="metricItems.length && !noData && !loading"
        class="absolute inset-0 pointer-events-none z-8"
        data-test="dashboard-metric-copy-overlay"
      >
        <div class="absolute pointer-events-auto"
          v-for="m in metricItems"
          :key="m.idx"
          :style="metricZoneStyle(m)"
          @mouseenter="hoveredMetricIdx = m.idx"
          @mouseleave="hoveredMetricIdx = null"
        >
          <OButton class="absolute"
            v-show="hoveredMetricIdx === m.idx || metricCopiedIdx === m.idx"
            variant="ghost"
            size="icon-xs-sq"
            :style="m.iconStyle"
            @click="copyMetricItem(m)"
            data-test="dashboard-metric-copy-btn"
            :data-copied="metricCopiedIdx === m.idx ? 'true' : undefined"
          >
            <OIcon
              :name="metricCopiedIdx === m.idx ? 'check' : 'content-copy'"
              size="sm"
            />
          </OButton>
        </div>
      </div>
      <OEmptyState
        v-if="
          noData &&
          !errorDetail?.message &&
          panelSchema.type != 'geomap' &&
          panelSchema.type != 'maps' &&
          !loading
        "
        size="inline"
        icon="bar-chart"
        :title="t('panel.noData')"
        :backdrop="false"
        data-test="no-data"
        class="noData absolute! inset-0 w-full h-full !min-h-0 !p-2 [container-type:size]"
      />
      <div
        v-if="
          errorDetail?.message &&
          !panelSchema?.error_config?.custom_error_handeling
        "
        class="absolute top-[20%] w-full h-[80%] overflow-hidden text-center text-ellipsis"
        data-test="panel-schema-renderer-error-message"
      >
        <OIcon size="md" name="warning" />
        <div class="h-4/5 w-full">
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
        class="absolute top-[20%] w-full h-[80%] overflow-hidden text-center text-ellipsis"
        data-test="panel-schema-renderer-custom-error-message"
      >
        {{ panelSchema?.error_config?.custom_error_message }}
      </div>
      <div
        class="flex absolute top-0 w-full z-999"
       
      >
        <LoadingProgress
          :loading="loading"
          :loadingProgressPercentage="loadingProgressPercentage"
        />
      </div>

      <div
        class="absolute z-9999999 min-w-50 py-1 px-0 hidden whitespace-nowrap top-0 left-0 rounded-default border border-dropdown-border bg-dropdown-bg shadow-[0_2px_8px_color-mix(in_srgb,var(--color-black)_15%,transparent)] dark:shadow-[0_2px_8px_color-mix(in_srgb,var(--color-black)_40%,transparent)]"
        data-test="drilldown-menu"
        ref="drilldownPopUpRef"
        @mouseleave="hidePopupsAndOverlays"
      >
        <template
          v-for="(drilldown, index) in drilldownArray"
          :key="JSON.stringify(drilldown)"
        >
          <OSeparator
            v-if="
              drilldown._isCrossLink &&
              index > 0 &&
              !drilldownArray[index - 1]._isCrossLink
            "
          />
          <div
            class="flex items-center py-2 px-4 cursor-pointer transition-colors duration-200 text-sm text-dropdown-item-text hover:bg-dropdown-item-hover-bg active:bg-dropdown-item-active-bg"
            :data-test="`drilldown-menu-item-${drilldown.name}`"
            @click="openDrilldown(index)"
          >
            <OIcon
              size="xs"
              class="mr-2"
              :name="drilldown._isCrossLink ? 'open-in-new' : 'link'"
            />
            <span class="select-none">{{ drilldown.name }}</span>
          </div>
        </template>
      </div>
      <div
        class="border border-border-default rounded-default p-0.75 absolute top-0 left-0 hidden max-w-50 whitespace-normal [word-wrap:break-word] [overflow-wrap:break-word] z-9999999 bg-surface-base"
        ref="annotationPopupRef"
      >
        <div
          class="px-2 py-1 flex flex-row items-center relative break-words"
        >
          <span class="break-words">{{
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
import { useTheme } from "@/composables/useTheme";
import { chartColor } from "@/utils/chartTheme";
import { useI18n } from "vue-i18n";
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
// Statically imported by several route-level components, so it cannot be
// code-split into its own chunk — import it statically to avoid the mixed
// dynamic/static import build warning.
import CustomChartRenderer from "./panels/CustomChartRenderer.vue";

const AlertContextMenu = defineAsyncComponent(() => {
  return import("./AlertContextMenu.vue");
});
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { copyToClipboard } from "@/utils/clipboard";
import { calculateWidthText } from "@/utils/dashboard/chartDimensionUtils";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

export default defineComponent({
  name: "PanelSchemaRenderer",
  components: {
    OSeparator,
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
    OIcon,
    OTooltip,
    OEmptyState,
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
    allowAnnotationsAPI: {
      default: true,
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
    const { isDark } = useTheme();
    const { t } = useI18n();
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

    // Metric chart: one copy icon per rendered value (multi-SQL renders many).
    // Values are already unit/decimal/timestamp formatted at the metric level;
    // _metricLayout gives the canvas pixel position so the icon sits beside it.
    // Values whose cell has no overlap-free spot for the icon are dropped —
    // no copy affordance beats covering the digits.
    const metricItems = computed(() => {
      if (props.panelSchema?.type !== "metric") return [];
      const series = panelData.value?.options?.series ?? [];
      return series
        .map((s: any, idx: number) => ({
          idx,
          text: s?._metricText,
          layout: s?._metricLayout,
        }))
        .filter((m: any) => {
          if (!m.layout || m.text == null || String(m.text).trim() === "")
            return false;
          const num = parseFloat(
            String(m.text).replace(/,/g, "").replace(/[^0-9.eE+-]/g, ""),
          );
          return Number.isNaN(num) || num !== 0;
        })
        .map((m: any) => ({ ...m, iconStyle: metricIconStyle(m) }))
        .filter((m: any) => m?.iconStyle !== null);
    });
    // Hover zone = each value's grid cell.
    const metricZoneStyle = (m: any) => ({
      left: `${m?.layout?.left ?? 0}px`,
      top: `${m?.layout?.top ?? 0}px`,
      width: `${m?.layout?.width ?? 0}px`,
      height: `${m?.layout?.height ?? 0}px`,
    });
    // Fixed copy-button size (icon-xs-sq), matching the table chart.
    const COPY_BTN_PX = 28;
    // Icon placement: beside the value (the font fit reserves the slot),
    // else wrapped below/above it, else docked at the right edge (tiny cells).
    const metricIconStyle = (m: any) => {
      const layout = m?.layout;
      if (!layout) return null;
      const fs = layout?.fontSize || 24;
      const width = layout?.width ?? 0;
      const height = layout?.height ?? 0;
      const cxLocal = (layout?.cx ?? 0) - (layout?.left ?? 0);
      const cyLocal = (layout?.cy ?? 0) - (layout?.top ?? 0);
      const textWidth = calculateWidthText(String(m?.text ?? ""), `${fs}px`);

      const besideLeft = cxLocal + textWidth / 2 + 2;
      if (
        besideLeft + COPY_BTN_PX + 2 <= width &&
        height >= COPY_BTN_PX
      ) {
        return {
          left: `${besideLeft}px`,
          top: `${Math.min(
            Math.max(cyLocal, COPY_BTN_PX / 2),
            height - COPY_BTN_PX / 2,
          )}px`,
          transform: "translateY(-50%)",
        };
      }

      const centeredLeft = Math.max(
        0,
        Math.min(cxLocal - COPY_BTN_PX / 2, width - COPY_BTN_PX),
      );
      // rendered line is ~1.2em tall around the vertical center
      const halfTextHeight = (fs * 1.2) / 2;
      const belowTop =
        cyLocal + halfTextHeight + (layout?.labelClearance ?? 0) + 2;
      if (belowTop + COPY_BTN_PX <= height) {
        return { left: `${centeredLeft}px`, top: `${belowTop}px` };
      }
      const aboveTop = cyLocal - halfTextHeight - 2 - COPY_BTN_PX;
      if (aboveTop >= 0) {
        return { left: `${centeredLeft}px`, top: `${aboveTop}px` };
      }

      // cell too small for any clean spot — dock at the right edge with a
      // solid background so the icon stays legible over the value's edge
      return {
        left: `${Math.max(0, width - COPY_BTN_PX - 2)}px`,
        top: `${Math.max(cyLocal, COPY_BTN_PX / 2)}px`,
        transform: "translateY(-50%)",
        backgroundColor: (void isDark.value, chartColor("--color-surface-base")),
        boxShadow: "0 0 3px rgba(0, 0, 0, 0.35)",
      };
    };
    const hoveredMetricIdx = ref<number | null>(null);
    const metricCopiedIdx = ref<number | null>(null);
    const copyMetricItem = (m: any) => {
      if (m?.text == null) return;
      copyToClipboard(String(m.text), { silent: true }).then(() => {
        metricCopiedIdx.value = m?.idx;
        setTimeout(() => {
          if (metricCopiedIdx.value === m.idx) metricCopiedIdx.value = null;
        }, 3000);
      });
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
      allowAnnotationsAPI,
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
      allowAnnotationsAPI,
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

      // If no hidden queries or empty array, return as is
      if (
        !hiddenQueries.value ||
        hiddenQueries.value.length === 0 ||
        !Array.isArray(data.value)
      ) {
        return data.value;
      }

      // Filter out hidden queries by index (works for both SQL and PromQL)
      const filtered = data.value.filter(
        (_: any, index: number) => !hiddenQueries.value.includes(index),
      );

      return filtered;
    });

    // Also filter panelSchema.queries in sync with filteredData
    // to keep data[i] aligned with queries[i] in convertMultiSQLData
    const filteredPanelSchema = computed(() => {
      if (
        panelSchema.value.queryType === "promql" ||
        !hiddenQueries.value?.length ||
        !Array.isArray(panelSchema.value.queries)
      ) {
        return panelSchema.value;
      }

      return {
        ...panelSchema.value,
        queries: panelSchema.value.queries.filter(
          (_: any, i: number) => !hiddenQueries.value.includes(i),
        ),
      };
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
      // Preserve the previously rendered chart during a reload. While loading,
      // if the new data buffer has no rows yet but a chart is already rendered,
      // skip conversion so non-streaming callers (the panelSchema deep watcher,
      // resize observer, etc.) can't replace it with an empty 0-series result
      // before the first streaming chunk arrives. The streaming overlay path
      // (applyOverlay=true) and loading=false final renders are unaffected.
      const hasRows =
        data.value?.length > 0 &&
        (data.value[0]?.result?.length > 0 ||
          (Array.isArray(data.value[0]) && data.value[0].length > 0));
      const hasOldChart = panelData.value?.options?.series?.length > 0;
      if (!applyOverlay && loading.value && !hasRows && hasOldChart) {
        return;
      }

      if (
        !errorDetail?.value?.message &&
        validatePanelData?.value?.length === 0
      ) {
        try {
          const result = await convertPanelData(
            filteredPanelSchema.value,
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
            const _themeMode = isDark.value ? "dark" : "light";
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
        // emit vrl function field list per query index
        if (data.value?.length) {
          // data.value is in compacted/executor order (empty queries are
          // skipped, time-shift queries expand into multiple entries), which
          // does NOT line up with the panel query (tab) index. Re-key the
          // detected fields by panelQueryIndex so downstream per-query field
          // storage maps to the correct query tab. Build a DENSE array (one
          // slot per panel query, default []) so the consumer's
          // Array.isArray(fieldList[0]) format check and forEach both see every
          // index even when a query returned no rows.
          // Size the array to cover BOTH the panel's queries and the actual
          // data results (data.value can have more entries than panel queries,
          // e.g. time-shift expansion), so no query's fields are dropped.
          const totalQueries = Math.max(
            panelSchema.value?.queries?.length ?? 0,
            data.value.length,
          );
          const perQueryFields: string[][] = Array.from(
            { length: totalQueries },
            () => [],
          );
          for (let qi = 0; qi < data.value.length; qi++) {
            const panelIdx =
              metadata.value?.queries?.[qi]?.panelQueryIndex ?? qi;
            const queryData = data.value[qi];
            if (
              queryData &&
              queryData.length &&
              panelIdx >= 0 &&
              panelIdx < perQueryFields.length
            ) {
              const maxAttributesIndex = queryData.reduce(
                (
                  maxIndex: string | number | any,
                  obj: {},
                  currentIndex: any,
                  array: Array<Record<string, unknown>>,
                ) => {
                  const numAttributes = Object.keys(obj).length;
                  const maxNumAttributes = Object.keys(array[maxIndex]).length;
                  return numAttributes > maxNumAttributes
                    ? currentIndex
                    : maxIndex;
                },
                0,
              );
              perQueryFields[panelIdx] = Object.keys(
                queryData[maxAttributesIndex],
              );
            }
          }
          emit("updated:vrlFunctionFieldList", perQueryFields);
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

    // Compute the value of the 'noData' variable.
    // Instead of re-scanning raw rows, this checks the conversion output
    // (panelData) which the pipeline already computed — O(1) property access.
    // Multi-SQL note: panelData is built from filteredData (visible queries only)
    // by convertSQLData and friends, so the type-specific checks below
    // already reflect the multi-query aggregate.
    const noData = computed(() => {
      const type = panelSchema.value.type;

      if (type === "html" || type === "markdown" || type === "custom_chart") {
        return "";
      }

      if (panelSchema.value?.queryType === "promql") {
        const hasResults =
          filteredData.value?.length &&
          filteredData.value.some((item: any) => item?.result?.length);
        if (hasResults) return "";
        // During a reload the executor clears state.data before the new results
        // stream in. Keep showing the previously rendered chart while loading
        // (matching the SQL branch below); only show "No Data" once the load
        // completes with no results.
        return loading.value && panelData.value?.options?.series?.length > 0
          ? ""
          : "No Data";
      }

      const hasRawData = data.value?.length && data.value[0]?.length;

      // During data buffer reset (executor clears state.data before reload),
      // suppress "No Data" only while still loading to avoid flicker.
      // Once loading completes with empty data, show "No Data".
      if (!hasRawData) {
        return loading.value && panelData.value?.chartType ? "" : "No Data";
      }

      // Raw data exists but conversion hasn't produced output yet — wait.
      if (!panelData.value?.chartType) {
        return "";
      }

      // Table renders raw rows; the conversion returns { rows, columns }.
      if (type === "table") {
        return panelData.value?.rows?.length > 0 ? "" : "No Data";
      }

      // Maps/geomap handle their own empty state.
      if (type === "geomap" || type === "maps") {
        return "";
      }

      // Sankey returns { options: null } when data is invalid.
      if (type === "sankey") {
        return panelData.value?.options != null ? "" : "No Data";
      }

      // Metric/gauge series are always created by the converter
      // (they use renderItem, not data arrays), so check the raw Y value.
      if (type === "metric" || type === "gauge") {
        const firstRow = data.value[0]?.[0];
        const yAlias = panelSchema.value.queries[0].fields.y.map(
          (it: any) => it.alias || [],
        );
        return yAlias.every((y: any) => getDataValue(firstRow, y) != null)
          ? ""
          : "No Data";
      }

      // For all other chart types (line, area, bar, scatter, heatmap, etc.),
      // the series filter in the conversion pipeline already excluded series
      // whose data is entirely null. Just check what survived.
      return panelData.value?.options?.series?.length > 0 ? "" : "No Data";
    });

    // Determines what data to pass to ChartRenderer.
    // noData check is evaluated first so promql panels with no results
    // also get the transparent background instead of showing a skeleton.
    const chartRendererData = computed(() => {
      if (noData.value === "No Data") {
        return { options: { backgroundColor: "transparent" } };
      }
      if (
        panelSchema.value.queryType === "promql" ||
        (panelData.value.chartType !== "geomap" &&
          panelData.value.chartType !== "table" &&
          panelData.value.chartType !== "maps" &&
          loading.value)
      ) {
        return panelData.value;
      }
      return panelData.value;
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

    // Trellis only applies when EVERY query has a breakdown field (each
    // breakdown value becomes a subplot). Mirrors the converter's isTrellis.
    const allQueriesHaveBreakdown = computed(
      () =>
        (panelSchema.value?.queries?.length ?? 0) > 0 &&
        panelSchema.value.queries.every(
          (q: any) => (q?.fields?.breakdown?.length ?? 0) > 0,
        ),
    );

    const chartPanelHeight = computed(() => {
      if (
        allQueriesHaveBreakdown.value &&
        panelSchema.value.config?.trellis?.layout &&
        !loading.value
      ) {
        return chartPanelStyle.value.height;
      }

      return "100%";
    });

    const chartPanelClass = computed(() => {
      if (
        allQueriesHaveBreakdown.value &&
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

    const tableRendererData = computed(() => {
      if (panelSchema.value.type === "table") {
        if (panelSchema.value.queryType === "promql") {
          // For PromQL tables, the data is in panelData.options (same as pie/donut)
          // The TableConverter returns {columns, rows, ...} which gets placed in options
          return panelData.value?.options || { rows: [], columns: [] };
        } else if (panelData.value?.chartType == "table") {
          return panelData.value;
        }
        return { options: { backgroundColor: "transparent" } };
      }
      return { options: { backgroundColor: "transparent" } };
    });

    return {
      t,
      store,
      chartPanelRef,
      chartRendererRef,
      data,
      loading,
      searchRequestTraceIds,
      errorDetail,
      panelData,
      noData,
      chartRendererData,
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
      metricItems,
      metricZoneStyle,
      metricIconStyle,
      hoveredMetricIdx,
      metricCopiedIdx,
      copyMetricItem,
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
<style scoped>
/* keep(lib-override:o2-empty-state): container query hides OEmptyState's internally-rendered icon when the panel is too short — targets a deep descendant of the lib component, not expressible as a utility on this template */
@container (max-height: 5rem) {
  .noData :deep(.o2-empty-state__inline-icon) {
    display: none;
  }
}
</style>
