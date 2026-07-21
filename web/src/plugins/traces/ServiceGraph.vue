<template>
  <OCard class="h-full flex flex-col">
    <!-- Top toolbar: [stream-selector] [search-input]  ···spacer···  [legends] -->
    <div class="flex items-center gap-2 p-1.5 pb-0">
      <!-- Stream selector (hidden when a parent drives selection, e.g. the
           Agent Graph page which selects by agent). -->
      <div
        v-if="!hideStreamSelector"
        data-test="service-graph-stream-selector"
        class="w-44 flex-shrink-0"
      >
        <OSelect
          :model-value="streamFilter"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="w-auto flex-shrink-0 rounded-default"
          :disabled="availableStreams.length === 0"
          @update:model-value="onStreamFilterChange"
        />
        <OTooltip v-if="availableStreams.length === 0" :content="t('traces.serviceGraph.noStreamsDetected')" />
      </div>
      <!-- Search input -->
      <div data-test="service-graph-search-input">
        <OSearchInput
          v-model="searchFilter"
          class="w-56!"
          :placeholder="t('traces.serviceGraph.searchPlaceholder')"
          :debounce="300"
          @update:model-value="applyFilters"
          clearable
        />
      </div>
      <!-- Spacer -->
      <div class="flex-1" />
      <!-- Legends (horizontal) -->
      <div
        data-test="service-graph-legends"
        class="flex flex-row items-center gap-3 p-[0.325rem] rounded-default border border-card-glass-border!"
      >
        <div
          data-test="sg-legend"
          class="flex flex-row items-center gap-3 min-w-0"
        >
          <!-- Border Color -->
          <div
            class="mb-0! whitespace-nowrap text-text-label! font-bold text-xs"
          >
            {{ t("traces.serviceGraph.borderColor") }}
            <span class="font-normal opacity-55">| {{ t("traces.serviceGraph.borderColorMetric") }}</span>
          </div>
          <div class="flex! flex-row gap-2">
            <div
              v-for="level in healthLevels"
              :key="level.key"
              class="flex flex-row items-center gap-1.5 flex-none"
              :data-test="`sg-legend-${level.key}`"
            >
              <span
                class="w-3 h-3 rounded-full border-2 bg-transparent flex-none"
                :class="{
                  'border-service-health-healthy': level.key === 'healthy',
                  'border-service-health-degraded': level.key === 'degraded',
                  'border-service-health-warning': level.key === 'warning',
                  'border-service-health-critical': level.key === 'critical',
                }"
              />
              <div class="flex flex-row items-baseline gap-1">
                <div class="text-left text-text-secondary! text-xs font-semibold">
                  {{ level.label }}
                </div>
                <div class="text-left text-3xs opacity-55">{{ level.range }}</div>
              </div>
            </div>
          </div>
        </div>
        <OSeparator vertical class="self-stretch mx-1" />
        <!-- Inventory chip: total entity count. Click to expand the per-kind
             distribution (read-only; the show/hide toggles live in "Show types"). -->
        <ODropdown side="bottom" align="start">
          <template #trigger>
            <OButton
              data-test="service-graph-entity-count"
              variant="ghost"
              size="xs"
              icon-right="expand-more"
            >
              <span class="font-bold text-text-secondary">{{ totalEntities }}</span>
              <span class="ml-1 text-text-body">{{ t("traces.serviceGraph.entities") }}</span>
            </OButton>
          </template>
          <div class="min-w-48" data-test="service-graph-entity-distribution">
            <ODropdownGroup :label="t('traces.serviceGraph.distribution')">
              <ODropdownItem
                v-for="row in kindRows"
                :key="row.key"
                :data-test="`service-graph-distribution-${row.key}`"
              >
                {{ row.label }}
                <span class="ms-auto ps-4 tabular-nums opacity-70">{{
                  row.count
                }}</span>
              </ODropdownItem>
            </ODropdownGroup>
            <ODropdownSeparator />
            <ODropdownItem data-test="service-graph-distribution-total">
              <span class="font-semibold">{{ t("traces.serviceGraph.total") }}</span>
              <span class="ms-auto ps-4 tabular-nums font-semibold">{{
                totalEntities
              }}</span>
            </ODropdownItem>
          </div>
        </ODropdown>
        <OSeparator vertical class="self-stretch mx-1" />
        <!-- "Show types": unifies the kind inventory (each kind's count) with
             the kind filter (show/hide) and the layout mode. -->
        <ODropdown side="bottom" align="end">
          <template #trigger>
            <OButton
              data-test="service-graph-density-btn"
              variant="outline"
              size="xs"
              icon-left="filter-list"
              :active="activeFilterCount > 0"
            >
              {{ t("traces.serviceGraph.showTypes") }}
              <!-- Filter-active dot: signals the graph is filtered (some types
                   hidden), not simply empty. Per-type detail lives in the
                   dropdown below. -->
              <span
                v-if="activeFilterCount > 0"
                class="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-white"
                data-test="service-graph-active-filter-indicator"
              />
              <OTooltip
                v-if="activeFilterCount > 0"
                :content="t('traces.serviceGraph.typesFiltered')"
              />
            </OButton>
          </template>
          <div
            class="p-2 flex flex-col gap-2 min-w-52"
            data-test="service-graph-collapse-mode"
          >
            <div class="text-3xs font-bold uppercase opacity-60">
              {{ t("traces.serviceGraph.layout") }}
            </div>
            <OToggleGroup
              :model-value="collapseMode"
              class="w-full"
              @update:model-value="(v) => setCollapseMode(v as string)"
            >
              <OToggleGroupItem
                v-for="m in (['auto', 'expanded', 'collapsed'] as const)"
                :key="m"
                :value="m"
                size="xs"
                class="flex-1"
                :data-test="`service-graph-collapse-${m}`"
              >
                {{ t(`traces.serviceGraph.mode.${m}`) }}
              </OToggleGroupItem>
            </OToggleGroup>
            <div class="text-3xs font-bold uppercase opacity-60 mt-1">
              {{ t("traces.serviceGraph.types") }}
            </div>
            <!-- Each row: type name + live count, with a checkbox to show/hide.
                 Services are always shown, so their row is count-only
                 (non-toggleable). -->
            <div
              v-for="row in kindRows"
              :key="row.key"
              :data-test="row.toggleable ? `service-graph-kind-toggle-${row.key}` : `service-graph-kind-count-${row.key}`"
              class="flex items-center gap-2 text-xs"
            >
              <OCheckbox
                v-if="row.toggleable"
                size="xs"
                :model-value="!hiddenKinds.has(row.key)"
                @update:model-value="toggleKindVisibility(row.key)"
              />
              <!-- Spacer aligning the always-on Services row with the checkboxes -->
              <span v-else class="inline-block w-3.5 shrink-0" />
              <span class="flex-1">{{ row.label }}</span>
              <span class="tabular-nums opacity-70">{{ row.count }}</span>
            </div>
          </div>
        </ODropdown>
        <OSeparator
          vertical
          v-if="searchObj.meta.serviceGraphVisualizationType === 'graph'"
          class="self-stretch mx-1"
        />
        <div
          v-if="searchObj.meta.serviceGraphVisualizationType === 'graph'"
          data-test="sg-node-size-info"
          class="flex flex-row items-center gap-2 min-w-0"
        >
          <!-- Node Size — Graph View only (Tree View uses fixed sizes) -->
          <div
            class="mb-0! whitespace-nowrap text-text-label! font-bold text-xs"
          >
            {{ t("traces.serviceGraph.nodeSize") }}
            <span class="font-normal opacity-55">| {{ t("traces.serviceGraph.nodeSizeMetric") }}</span>
          </div>
          <div class="flex items-center gap-1 py-0!">
            <div class="flex flex-row items-center gap-1.5">
              <span class="w-4 h-4 rounded-full border-2 border-service-health-healthy bg-transparent shrink-0" />
              <span class="text-xs text-text-secondary!">{{ t("traces.serviceGraph.sizeLow") }}</span>
            </div>
            <div class="opacity-35 text-base tracking-[0.125rem] mb-0">···</div>
            <div class="flex flex-row items-center gap-1.5">
              <span class="w-7 h-7 rounded-full border-2 border-service-health-healthy bg-transparent shrink-0" />
              <span class="text-xs text-text-secondary!">{{ t("traces.serviceGraph.sizeHigh") }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <OCardSection
      class="flex-1 min-h-0 relative overflow-hidden service-graph-container bg-surface-subtle!"
    >
      <!-- Graph Visualization -->
      <OCard class="rounded-default h-full">
        <OCardSection class="p-0 h-full">
          <div
            data-test="service-graph-container"
            class="graph-container h-full w-full rounded-default overflow-hidden bg-surface-subtle relative"
          >
            <div v-if="loading" class="flex items-center justify-center h-full">
              <div class="text-center flex flex-col items-center">
                <OSpinner size="lg" />
                <div class="text-sm mt-3 text-text-secondary">
                  {{ t("traces.serviceGraph.loading") }}
                </div>
              </div>
            </div>
            <div
              v-else-if="error"
              class="flex h-full items-center justify-center p-[0.675rem]"
            >
              <div>
                <OIcon name="error-outline" style="width: 4em; height: 4em;" />
                <div class="text-xl font-semibold mt-3 text-text-heading">
                  {{ error }}
                </div>
                <OButton
                  variant="outline"
                  size="sm-action"
                  @click="loadServiceGraph"
                  class="mt-4"
                  icon-left="refresh"
                >
                  {{ t("traces.serviceGraph.retry") }}
                </OButton>
              </div>
            </div>
            <div
              v-else-if="!graphData.nodes.length"
              class="flex h-full items-center justify-center"
            >
              <ServiceGraphNoDataState
                @jump-to-stream-data="
                  (from, to) => $emit('jump-to-stream-data', from, to)
                "
              />
            </div>
            <div
              v-else
              ref="graphContainerRef"
              class="h-full relative overflow-hidden"
            >
              <ChartRenderer
                ref="chartRendererRef"
                data-test="service-graph-chart"
                :data="chartData"
                :key="chartKey"
                render-type="svg"
                class="h-full"
                @click="handleNodeClick"
              />

              <!-- Zoom controls: explicit buttons drive zoom + fit-to-screen,
                   floated bottom-right like a map control. -->
              <div
                class="absolute bottom-3 right-3 z-10 flex flex-col rounded-default border border-border-default bg-surface-panel overflow-hidden"
                data-test="service-graph-zoom-controls"
              >
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="add"
                  class="rounded-none"
                  data-test="service-graph-zoom-in"
                  @click="zoomIn"
                >
                  <OTooltip side="left" :content="t('traces.serviceGraph.zoomIn')" />
                </OButton>
                <OSeparator />
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="remove"
                  class="rounded-none"
                  data-test="service-graph-zoom-out"
                  @click="zoomOut"
                >
                  <OTooltip side="left" :content="t('traces.serviceGraph.zoomOut')" />
                </OButton>
                <OSeparator />
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="fullscreen"
                  class="rounded-none"
                  data-test="service-graph-fit-screen"
                  @click="fitToScreen"
                >
                  <OTooltip side="left" :content="t('traces.serviceGraph.fitToScreen')" />
                </OButton>
              </div>

              <!-- Service Graph Side Panel (node) -->
              <ServiceGraphSidePanel
                v-if="selectedNode"
                :selected-node="selectedNode"
                :graph-data="graphData"
                :time-range="searchObj.data.datetime"
                :visible="showSidePanel"
                :stream-filter="streamFilter"
                :container-el="graphContainerRef"
                @close="handleCloseSidePanel"
                @view-traces="$emit('view-traces', $event)"
              />
            </div>
          </div>
        </OCardSection>
      </OCard>
    </OCardSection>
  </OCard>

  <!-- Settings Dialog -->
  <ODialog data-test="service-graph-settings-dialog"
    v-model:open="showSettings"
    size="sm"
    :title="t('traces.serviceGraph.settingsTitle')"
    :secondary-button-label="t('traces.serviceGraph.close')"
    :primary-button-label="t('traces.serviceGraph.reset')"
    @click:secondary="showSettings = false"
    @click:primary="resetSettings"
  >
    <div class="gap-3">
      <div class="text-xs text-text-muted">
        {{ t("traces.serviceGraph.settingsDescription") }}
        <OTooltip :content="t('traces.serviceGraph.settingsTooltip')" />
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  onBeforeUnmount,
  computed,
  watch,
  nextTick,
} from "vue";
import * as echarts from "echarts";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import serviceGraphService from "@/services/service_graph";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import ServiceGraphSidePanel from "./ServiceGraphNodeSidePanel.vue";
import {
  convertServiceGraphToTree,
  convertServiceGraphToNetwork,
} from "@/utils/traces/convertTraceData";
import {
  applyGraphCollapse,
  GROUP_PREFIX,
} from "@/utils/traces/applyGraphCollapse";
import {
  formatNumber,
  formatLatency,
  pointToBezierDistance,
  generateNodeTooltipContent,
  generateEdgeTooltipContent,
  findIncomingEdgeForNode,
  calculateRootNodeMetrics,
} from "@/utils/traces/treeTooltipHelpers";
import useStreams from "@/composables/useStreams";
import useTraces from "@/composables/useTraces";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ServiceGraphNoDataState from "./ServiceGraphNoDataState.vue";
import { getEffectiveTimeRange } from "@/utils/date";

export default defineComponent({
  name: "ServiceGraph",
  components: {
    OSeparator,
    ChartRenderer,
    ServiceGraphSidePanel,
    OButton,
    ODialog,
    OSpinner,
    OTooltip,
    OSelect,
    OSearchInput,
    OIcon,
    OCard,
    OCardSection,
    ODropdown,
    ODropdownItem,
    ODropdownGroup,
    ODropdownSeparator,
    OCheckbox,
    OToggleGroup,
    OToggleGroupItem,
    ServiceGraphNoDataState,
  },
  props: {
    // Optional external stream override. When set (e.g. by the standalone
    // Agent Graph page, which selects by agent → its source_stream), it seeds
    // the internal streamFilter and keeps it in sync, instead of the component
    // sourcing the stream from the shared traces store.
    streamFilter: {
      type: String,
      default: undefined,
    },
    // Hide the built-in stream dropdown when the parent owns selection.
    hideStreamSelector: {
      type: Boolean,
      default: false,
    },
    // Agent-node highlighting (indigo tint, larger size, radar-ping halo) is a
    // treatment for the dedicated Agent Graph page ONLY. On the regular Service
    // Graph tab agents are rendered like any other node. The Agent Graph page
    // sets this true; every other mount leaves it false.
    agentHighlight: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["view-traces", "request:stream-change", "jump-to-stream-data"],
  setup(props, { emit, expose }) {
    const store = useStore();
    const { isDark } = useTheme();
    const router = useRouter();
    const { t } = useI18n();
    const { getStreams } = useStreams();
    const { searchObj } = useTraces();

    const loading = ref(false);
    // Stamped when a graph load settles — lets a parent page show a
    // "last refreshed" time next to its refresh control.
    const lastRunAt = ref<number | null>(null);
    const error = ref<string | null>(null);
    const showSettings = ref(false);
    const lastUpdated = ref("");

    // Node side panel state
    const selectedNode = ref<any>(null);
    const showSidePanel = ref(false);

    const chartRendererRef = ref<any>(null);
    const graphContainerRef = ref<HTMLElement | null>(null);

    const searchFilter = ref("");

    // Stream filter — an external `streamFilter` prop (Agent Graph page) wins;
    // otherwise sync from the traces page selected stream / localStorage.
    const tracesStream = searchObj.data.stream?.selectedStream?.value || "";
    const storedStreamFilter = localStorage.getItem(
      "serviceGraph_streamFilter",
    );
    const streamFilter = ref(
      props.streamFilter || tracesStream || storedStreamFilter || "default",
    );
    // Keep the internal ref in sync when the parent drives the stream (e.g. the
    // Agent Graph page selecting by agent → its source_stream) AND reload the
    // graph. The built-in dropdown delegates reload to its parent via
    // `request:stream-change`; a parent-driven stream has no such round-trip, so
    // we refetch here directly. `loadServiceGraph` is hoisted (defined later in
    // setup) — safe because the watcher callback only runs on later changes.
    watch(
      () => props.streamFilter,
      (next) => {
        if (next && next !== streamFilter.value) {
          streamFilter.value = next;
          loadServiceGraph();
        }
      },
    );
    const availableStreams = ref<string[]>([]);

    const graphData = ref<any>({
      nodes: [],
      edges: [],
    });

    const filteredGraphData = ref<any>({
      nodes: [],
      edges: [],
    });

    // Adaptive-collapse state: when the graph is large, inferred dependency kinds
    // (database/queue/external/rpc) collapse into per-kind boundary nodes so the
    // overview stays readable. Users can drill into a kind, hide a kind, or
    // override the mode. Services are never collapsed.
    const collapseMode = ref<"auto" | "expanded" | "collapsed">("auto");
    const collapseThreshold = ref(40);
    // Per-KIND expand (whole-kind drill-in, e.g. from a future "expand all
    // externals" control) and per-GROUP expand (one caller's boundary, by its
    // full `__group_<kind>__<caller>` id). Clicking a single group toggles only
    // that group so one caller's externals expand without touching another's.
    const expandedKinds = ref<Set<string>>(new Set());
    const expandedGroups = ref<Set<string>>(new Set());
    const hiddenKinds = ref<Set<string>>(new Set());

    /** Toggle a single boundary group by its id (`__group_<kind>__<caller>`). */
    const toggleGroupExpansion = (groupId: string) => {
      const s = new Set(expandedGroups.value);
      s.has(groupId) ? s.delete(groupId) : s.add(groupId);
      expandedGroups.value = s;
      lastChartOptions.value = null;
      applyFilters();
    };
    const setCollapseMode = (m: "auto" | "expanded" | "collapsed") => {
      collapseMode.value = m;
      lastChartOptions.value = null;
      applyFilters();
    };

    // ── Zoom controls ─────────────────────────────────────────────────────────
    // The mouse still zooms (roam:true) so you can focus an area with the wheel;
    // scaleLimit on the series bounds it so it can't run away (the old "erratic"
    // feel). The +/- buttons drive the SAME series `zoom` option via setOption,
    // reading the chart's CURRENT zoom first so button + wheel stay in sync.
    // Match the series `scaleLimit` (convertTraceData.ts) so the +/- buttons and
    // box-zoom never compute a factor the chart will silently clamp away.
    const ZOOM_MIN = 0.4;
    const ZOOM_MAX = 3;

    // The live zoom level from the chart (kept in sync with wheel zoom), so a
    // button press adjusts from where the user actually is, not a stale ref.
    const currentZoom = (chart: any): number => {
      const opt = chart.getOption?.();
      const z = opt?.series?.[0]?.zoom;
      return typeof z === "number" && z > 0 ? z : 1;
    };

    const zoomBy = (factor: number) => {
      const chart = chartRendererRef.value?.chart;
      if (!chart) return;
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, currentZoom(chart) * factor),
      );
      // Merge only the zoom so positions/data stay put.
      chart.setOption({ series: [{ zoom: next }] }, { lazyUpdate: true });
    };

    const zoomIn = () => zoomBy(1.25);
    const zoomOut = () => zoomBy(1 / 1.25);


    // Fit-to-screen: recreate the chart (keyed on chartKey) so ECharts re-fits
    // the full graph bounding box into the panel at zoom 1, re-centered — the
    // reliable reset for both tree (layout:none) and graph series (also clears
    // any wheel pan/zoom the user applied).
    const fitToScreen = () => {
      lastChartOptions.value = null;
      chartKey.value++;
    };

    const toggleKindVisibility = (kind: string) => {
      const s = new Set(hiddenKinds.value);
      s.has(kind) ? s.delete(kind) : s.add(kind);
      hiddenKinds.value = s;
      lastChartOptions.value = null;
      applyFilters();
    };

    const stats = ref<any>(null);

    // Count nodes by kind (from backend service_type) for the legend. Nodes with
    // no inferred type are instrumented services; the rest are inferred deps.
    const kindCounts = computed(() => {
      const counts = {
        service: 0,
        database: 0,
        queue: 0,
        external: 0,
        rpc: 0,
        agent: 0,
        tool: 0,
        model: 0,
      };
      // Count the RAW backend topology, not the collapsed view — the legend must
      // report the true entity counts regardless of collapse/expand state, and
      // must never count a boundary node (which represents N members) as one.
      for (const n of graphData.value.nodes || []) {
        if ((n as any).is_group) continue;
        const t = (n as any).service_type;
        if (t === "database") counts.database++;
        else if (t === "queue") counts.queue++;
        else if (t === "external") counts.external++;
        else if (t === "rpc") counts.rpc++;
        else if (t === "agent") counts.agent++;
        else if (t === "tool") counts.tool++;
        else if (t === "model") counts.model++;
        else counts.service++;
      }
      return counts;
    });

    // Total entity count for the header inventory chip. Sums every kind.
    const totalEntities = computed(() => {
      const c = kindCounts.value;
      return c.service + c.database + c.queue + c.external + c.rpc;
    });

    // The kind rows for the "Show types" control: label + count + whether the
    // user can hide it. Services are always shown, so only the dependency kinds
    // are toggleable. Order matches the graph's reading order.
    // Health levels for the "Border Color | Errors" legend: label + error-rate
    // range + the CSS class carrying its color token. Data-driven so the legend
    // markup is one v-for.
    const healthLevels = computed(() => [
      { key: "healthy", label: t("traces.serviceGraph.status.healthy"), range: t("traces.serviceGraph.range.healthy") },
      { key: "degraded", label: t("traces.serviceGraph.status.degraded"), range: t("traces.serviceGraph.range.degraded") },
      { key: "warning", label: t("traces.serviceGraph.status.warning"), range: t("traces.serviceGraph.range.warning") },
      { key: "critical", label: t("traces.serviceGraph.status.critical"), range: t("traces.serviceGraph.range.critical") },
    ]);

    const kindRows = computed(() => [
      { key: "service", label: t("traces.serviceGraph.kind.service"), count: kindCounts.value.service, toggleable: false },
      { key: "database", label: t("traces.serviceGraph.kind.database"), count: kindCounts.value.database, toggleable: true },
      { key: "queue", label: t("traces.serviceGraph.kind.queue"), count: kindCounts.value.queue, toggleable: true },
      { key: "external", label: t("traces.serviceGraph.kind.external"), count: kindCounts.value.external, toggleable: true },
      { key: "rpc", label: t("traces.serviceGraph.kind.rpc"), count: kindCounts.value.rpc, toggleable: true },
      { key: "agent", label: t("traces.serviceGraph.kind.agent"), count: kindCounts.value.agent, toggleable: true },
      { key: "tool", label: t("traces.serviceGraph.kind.tool"), count: kindCounts.value.tool, toggleable: true },
      { key: "model", label: t("traces.serviceGraph.kind.model"), count: kindCounts.value.model, toggleable: true },
    ]);

    // How many entity types the user has hidden. Non-zero means the graph is
    // filtered — the "Show types" button reflects this (active state + count).
    const activeFilterCount = computed(() => hiddenKinds.value.size);

    // Key to control chart recreation - only change when layout/visualization type changes
    const chartKey = ref(0);

    // Restore drag-to-pan (map-style). The shared ChartRenderer arms the
    // `dataZoomSelect` global cursor on every render, which turns a drag into a
    // rectangle-select and HIJACKS it away from the graph's `roam` pan — the
    // reason you couldn't move the graph left/right/up/down. This graph has no
    // dataZoom, so we turn that cursor mode OFF: once the chart exists, and again
    // after each `finished` render (ChartRenderer re-arms it on every setOption).
    const disablePanBlockingCursor = (chart: any) => {
      chart?.dispatchAction?.({
        type: "takeGlobalCursor",
        key: "dataZoomSelect",
        dataZoomSelectActive: false,
      });
    };
    const boundCursorClear = () =>
      disablePanBlockingCursor(chartRendererRef.value?.chart);
    watch(
      [chartKey, () => chartRendererRef.value?.chart],
      () => {
        const chart = chartRendererRef.value?.chart;
        if (!chart) return;
        disablePanBlockingCursor(chart);
        chart.off?.("finished", boundCursorClear);
        chart.on?.("finished", boundCursorClear);
      },
      { immediate: true, flush: "post" },
    );

    // Track last chart options to prevent unnecessary recreation for graph view
    const lastChartOptions = ref<any>(null);

    const chartData = computed(() => {
      if (!filteredGraphData.value.nodes.length) {
        return { options: {}, notMerge: true };
      }

      const vizType = searchObj.meta.serviceGraphVisualizationType;
      const layoutType = searchObj.meta.serviceGraphLayoutType;

      // Don't use cache if filters are active (search filter)
      const hasActiveFilters = searchFilter.value?.trim();

      // Use cached options if chartKey hasn't changed (prevents double rendering)
      // BUT only if no filters are active and no new baselines have arrived
      if (
        vizType === "graph" &&
        lastChartOptions.value &&
        chartKey.value === lastChartOptions.value.key &&
        !hasActiveFilters
      ) {
        return {
          options: lastChartOptions.value.data.options,
          // Full-replace even on a cache hit: graph uses fixed node positions,
          // so replacing re-renders at the same coordinates (no jump) while
          // never leaving a stale wrong-type series behind. Consistent with the
          // fresh-compute path below.
          notMerge: true,
          lazyUpdate: true,
          silent: true,
        };
      }

      const newOptions =
        vizType === "tree"
          ? convertServiceGraphToTree(
              filteredGraphData.value,
              layoutType,
              isDark.value,
              // Pass the live panel height so the tree can auto-shrink its
              // label font + node size to the fit-to-view compression, keeping
              // labels from overlapping on tall (many-leaf) graphs.
              graphContainerRef.value?.clientHeight || 700,
              // Agent highlighting (tint/size/ping) only on the Agent Graph page.
              props.agentHighlight,
            )
          : convertServiceGraphToNetwork(
              filteredGraphData.value,
              // Graph view defaults to the layered directional layout (deps as
              // terminal leaves); honor an explicit 'force' choice from the user.
              layoutType === "force" ? "force" : "layered",
              new Map(),
              isDark.value,
              undefined,
              graphContainerRef.value?.clientWidth || 1200,
              graphContainerRef.value?.clientHeight || 700,
              // Agent highlighting (tint/size/ping) only on the Agent Graph page.
              props.agentHighlight,
            );

      // Cache the options for graph view
      // BUT only if no filters are active (to avoid caching filtered states)
      if (vizType === "graph" && !hasActiveFilters) {
        lastChartOptions.value = {
          key: chartKey.value,
          data: newOptions,
        };
      } else if (hasActiveFilters) {
        // Clear cache when filtering to ensure fresh render on filter removal
        lastChartOptions.value = null;
      }

      return {
        ...newOptions,
        // Always full-replace. ECharts cannot swap a series TYPE via a merge, so
        // a merge leaves the previous `tree` series in place and Graph View
        // renders blank after a tree→graph switch. Both views use fixed node
        // positions (tree: computeTreeLayout; graph: layered layout with explicit
        // x/y), so a replace re-renders at the same coordinates — no zoom/pan
        // jump — while guaranteeing the series swaps.
        notMerge: true,
        lazyUpdate: true, // Prevent viewport reset when only styles change
        silent: true, // Disable animations during update to prevent position jumps
      };
    });

    // Use ECharts select action to persistently highlight selected node
    watch(
      () => selectedNode.value?.id,
      async (newId, oldId) => {
        await nextTick();

        if (!chartRendererRef.value?.chart) {
          return;
        }

        const chart = chartRendererRef.value.chart;

        // Unselect the old node (if any)
        if (oldId) {
          chart.dispatchAction({
            type: "unselect",
            seriesIndex: 0,
            name: oldId,
          });
        }

        // Select the new node (if any)
        if (newId) {
          chart.dispatchAction({
            type: "select",
            seriesIndex: 0,
            name: newId,
          });
        }
      },
      { flush: "post" },
    );

    // Watch for theme changes and re-apply selection
    watch(
      () => store.state.theme,
      async () => {
        // Increment chartKey to force regeneration with new theme colors
        chartKey.value++;

        // Save the current selected node ID (in case it changes during the delay)
        const nodeIdToReselect = selectedNode.value?.id;

        // Use setTimeout to wait for chart to be fully regenerated after theme change
        setTimeout(() => {
          if (!chartRendererRef.value?.chart || !nodeIdToReselect) {
            return;
          }

          const chart = chartRendererRef.value.chart;

          // Re-apply node selection
          chart.dispatchAction({
            type: "select",
            seriesIndex: 0,
            name: nodeIdToReselect,
          });
        }, 500); // 500ms delay to ensure chart has fully regenerated
      },
    );

    // Watch for stream filter changes and restore chart viewport
    watch(
      () => streamFilter.value,
      async () => {
        // Wait for chart to update with new data
        await nextTick();
        setTimeout(() => {
          if (!chartRendererRef.value?.chart) {
            return;
          }

          const chart = chartRendererRef.value.chart;

          // Restore chart to default zoom/pan to fit all content
          chart.dispatchAction({
            type: "restore",
          });
        }, 500); // Longer delay to ensure chart has recalculated positions
      },
    );

    // --- Graph view: flowing edge animation on node hover ---
    //
    // ECharts' emphasis.lineStyle only fires on direct edge hover, NOT when a
    // connected node is hovered. We handle it explicitly: on node mouseover we
    // call setOption to switch adjacent edges to dashed (→ CSS animation fires),
    // on mouseout we restore them to solid.
    //
    // We replicate the same edge deduplication used in convertServiceGraphToNetwork
    // so the links array index order matches ECharts' internal data array.
    const updateEdgeStylesForHover = (hoveredNodeId: string | null) => {
      const chart = chartRendererRef.value?.chart;
      if (!chart) return;

      // Tree view: emphasis.focus:'relative' in the series config handles dimming natively.
      // No manual dispatch needed — ECharts triggers it on mouseover automatically.
      if (searchObj.meta.serviceGraphVisualizationType !== "graph") return;

      const rawEdges: any[] = filteredGraphData.value.edges || [];

      // Deduplicate exactly as convertServiceGraphToNetwork does
      const edgeMap = new Map<string, any>();
      rawEdges.forEach((edge: any) => {
        const key = `${edge.from}|||${edge.to}`;
        if (
          !edgeMap.has(key) ||
          (edge.total_requests || 0) > (edgeMap.get(key).total_requests || 0)
        ) {
          edgeMap.set(key, edge);
        }
      });

      const updatedLinks = Array.from(edgeMap.values()).map((edge: any) => {
        const isAdj =
          hoveredNodeId !== null &&
          (edge.from === hoveredNodeId || edge.to === hoveredNodeId);
        return {
          source: edge.from,
          target: edge.to,
          // Preserve tooltip suppression so ECharts merge doesn't re-enable native edge tooltip
          tooltip: { show: false },
          lineStyle: {
            width: 4,
            type: isAdj ? "dashed" : "solid",
            opacity: hoveredNodeId !== null ? (isAdj ? 1 : 0.15) : 0.6,
          },
        };
      });

      chart.setOption(
        { series: [{ links: updatedLinks }] },
        { notMerge: false, lazyUpdate: false },
      );
    };

    // --- Tree edge tooltip: show node tooltip when hovering edge lines ---
    let edgeTooltipCleanup: (() => void) | null = null;
    let pendingTooltipSetup: ReturnType<typeof setTimeout> | null = null;

    const setupTreeEdgeTooltips = (chart: any) => {
      const zr = chart.getZr();
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      // Custom tooltip element — node tooltips use innerHTML, edge tooltips use an ECharts mini chart
      const tooltipEl = document.createElement("div");
      const isDarkInit = isDark.value;
      tooltipEl.style.cssText = `
        position: absolute; pointer-events: none; z-index: 9999;
        background: ${isDarkInit ? "rgba(22, 22, 26, 0.90)" : "rgba(255, 255, 255, 0.88)"};
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid ${isDarkInit ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"};
        border-radius: 14px;
        display: none;
        box-shadow: 0 12px 40px rgba(0,0,0,${isDarkInit ? "0.5" : "0.14"}), 0 1px 0 rgba(255,255,255,${isDarkInit ? "0.04" : "0"}) inset;
        overflow: hidden;
      `;
      const chartDom = chart.getDom();
      if (!chartDom.style.position || chartDom.style.position === "static") {
        chartDom.style.position = "relative";
      }
      chartDom.appendChild(tooltipEl);

      // Keep tooltip open when user hovers over it (for button interaction)
      tooltipEl.addEventListener("mouseenter", () => {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      });
      tooltipEl.addEventListener("mouseleave", () => {
        if (!hideTimer) {
          hideTimer = setTimeout(() => {
            hideTimer = null;
            activeKey = null;
            hideTooltip();
          }, 150);
        }
      });

      // Cached edge data: bezier shapes + parent/child names
      let edgesGroupEl: any = null;
      let bezierEdges: Array<{
        shape: any;
        childName: string;
        parentName: string;
      }> = [];
      let nodePositions: Array<{
        idx: number;
        x: number;
        y: number;
        name: string;
      }> = [];

      // Robust child access — handles children(), _children, or childAt/childCount
      const getChildren = (group: any): any[] => {
        if (typeof group.children === "function") return group.children();
        if (Array.isArray(group._children)) return group._children;
        const count =
          typeof group.childCount === "function" ? group.childCount() : 0;
        const result: any[] = [];
        for (let i = 0; i < count; i++) {
          const c = group.childAt?.(i);
          if (c) result.push(c);
        }
        return result;
      };

      // Check if a group contains bezier-curve children
      const hasBezierChildren = (group: any): boolean => {
        const kids = getChildren(group);
        return kids.some((c: any) => c.type === "bezier-curve");
      };

      // Recursively search for a group containing bezier-curve elements
      const findBezierGroup = (el: any, depth = 0): any => {
        if (!el || depth > 6) return null;
        if (el.type === "group" && hasBezierChildren(el)) return el;
        for (const child of getChildren(el)) {
          const found = findBezierGroup(child, depth + 1);
          if (found) return found;
        }
        return null;
      };

      // Build into local vars, then atomic-swap so onMouseMove never sees partial state
      const buildEdgeData = () => {
        const newBezierEdges: typeof bezierEdges = [];
        const newNodePositions: typeof nodePositions = [];
        let newEdgesGroupEl: any = null;

        try {
          const series = chart.getModel()?.getSeriesByIndex(0);
          if (!series) return;
          const data = series.getData();
          const count = data.count();

          // Collect node layout positions + names + direction-aware value
          for (let i = 0; i < count; i++) {
            const layout = data.getItemLayout(i);
            if (layout) {
              newNodePositions.push({
                idx: i,
                x: layout.x,
                y: layout.y,
                name: data.getName(i),
                value: data.get("value", i) as number,
              });
            }
          }

          // Find first node with a graphic element (node 0 may be invisible virtual root)
          let firstNodeEl = null;
          for (let i = 0; i < count; i++) {
            firstNodeEl = data.getItemGraphicEl(i);
            if (firstNodeEl) break;
          }
          if (!firstNodeEl) return;

          // Walk up from node, search siblings at each level for bezier-curve group
          let current = firstNodeEl;
          while (current?.parent && !newEdgesGroupEl) {
            const parent = current.parent;
            for (const sibling of getChildren(parent)) {
              if (sibling === current) continue;
              if (sibling.type === "group" && hasBezierChildren(sibling)) {
                newEdgesGroupEl = sibling;
                break;
              }
            }
            current = parent;
          }

          // Fallback: recursive search from ZRender root
          if (!newEdgesGroupEl) {
            const zrStorage = zr.storage;
            const roots = zrStorage?.getRoots?.() || zrStorage?._roots || [];
            for (const root of roots) {
              newEdgesGroupEl = findBezierGroup(root);
              if (newEdgesGroupEl) break;
            }
          }

          if (!newEdgesGroupEl) return;

          // Collect bezier shapes + match endpoints to node names
          for (const bezier of getChildren(newEdgesGroupEl)) {
            if (bezier.type !== "bezier-curve" || !bezier.shape) continue;
            const { x1, y1, x2, y2 } = bezier.shape;

            let parentName = "";
            let pDist = Infinity;
            let childName = "";
            let cDist = Infinity;
            for (const np of newNodePositions) {
              const dp = Math.hypot(np.x - x1, np.y - y1);
              if (dp < pDist) {
                pDist = dp;
                parentName = np.name;
              }
              const dc = Math.hypot(np.x - x2, np.y - y2);
              if (dc < cDist) {
                cDist = dc;
                childName = np.name;
              }
            }
            newBezierEdges.push({
              shape: { ...bezier.shape },
              childName,
              parentName,
            });
          }
        } catch {
          return; // Keep previous good data on error
        }

        // Only swap if we got valid data — never clear good data with empty
        if (newEdgesGroupEl && newBezierEdges.length > 0) {
          edgesGroupEl = newEdgesGroupEl;
          bezierEdges = newBezierEdges;
          nodePositions = newNodePositions;
        }
      };

      // Debounce: only rebuild 200ms after the last `finished` event
      // (avoids rebuilding during animation frames where shapes are intermediate)
      let buildTimer: ReturnType<typeof setTimeout> | null = null;
      const debouncedBuild = () => {
        if (buildTimer) clearTimeout(buildTimer);
        buildTimer = setTimeout(buildEdgeData, 200);
      };
      chart.on("finished", debouncedBuild);
      // Also try immediately (works if chart already rendered)
      buildEdgeData();

      // NOTE: the agent "radar ping" halo is NOT drawn here. It is baked into
      // each agent node's own symbol SVG (see getServiceIconDataUrl) as native
      // SMIL <animate> rings — the graph renders in SVG mode, so they animate.
      // Doing it in the symbol (rather than an ECharts `graphic` overlay) keeps
      // the halo perfectly centred on the node and moving/zooming with it; the
      // overlay approach drifted because `graphic` lives outside the roam
      // (pan/zoom) transform applied to the series group.

      // Use imported helper functions for testability

      // Position and show the tooltip at mouse coords
      const positionTooltip = (mouseX: number, mouseY: number) => {
        const cw = chartDom.clientWidth;
        const ch = chartDom.clientHeight;
        let left = mouseX + 15;
        let top = mouseY + 15;
        tooltipEl.style.display = "block";
        if (left + tooltipEl.offsetWidth > cw)
          left = mouseX - tooltipEl.offsetWidth - 10;
        if (top + tooltipEl.offsetHeight > ch)
          top = mouseY - tooltipEl.offsetHeight - 10;
        tooltipEl.style.left = left + "px";
        tooltipEl.style.top = top + "px";
      };

      const resetToTextTooltip = () => {
        tooltipEl.style.pointerEvents = "none";
        tooltipEl.style.width = "";
        tooltipEl.style.height = "";
        tooltipEl.style.padding = "9px 13px";
        tooltipEl.style.fontSize = "12px";
        tooltipEl.style.lineHeight = "1.5";
        tooltipEl.style.fontFamily =
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
        tooltipEl.style.letterSpacing = "0.01em";
        tooltipEl.style.whiteSpace = "nowrap";
        tooltipEl.style.color = isDark.value
          ? "rgba(255,255,255,0.88)"
          : "rgba(0,0,0,0.82)";
      };

      const showNodeTooltip = (
        mouseX: number,
        mouseY: number,
        nodeName: string,
        requestsOverride?: number,
      ) => {
        resetToTextTooltip();

        // Always use node-level data for the tooltip — same source as border color
        const nodes = graphData.value?.nodes || [];
        const node = nodes.find((n: any) => (n.label || n.id) === nodeName);
        if (!node) {
          tooltipEl.style.display = "none";
          return;
        }

        // Use direction-aware value from tree node when available (matches the
        // label), else fall back to the backend's node-level aggregate.
        const requests =
          requestsOverride !== undefined
            ? requestsOverride
            : (node.requests || 0);
        const errors = node.errors || 0;
        const errRate =
          node.error_rate ?? (node.requests > 0 ? (node.errors / node.requests) * 100 : 0);
        tooltipEl.innerHTML = generateNodeTooltipContent(
          nodeName,
          requests,
          errors,
          errRate,
        );
        positionTooltip(mouseX, mouseY);
      };

      const showStatsTooltip = (
        mouseX: number,
        mouseY: number,
        parentName: string,
        childName: string,
      ) => {
        const edges = graphData.value?.edges || [];
        const edge = findIncomingEdgeForNode(childName, parentName, edges);
        if (!edge) {
          tooltipEl.style.display = "none";
          return;
        }

        resetToTextTooltip();

        const total = edge.total_requests || 0;
        const failed = edge.failed_requests || 0;
        const errRate =
          edge.error_rate ?? (total > 0 ? (failed / total) * 100 : 0);
        tooltipEl.innerHTML = generateEdgeTooltipContent(
          total,
          failed,
          errRate,
          edge.p50_latency_ns,
          edge.p95_latency_ns,
          edge.p99_latency_ns,
        );
        positionTooltip(mouseX, mouseY);
      };

      const showEdgeTooltip = (
        mouseX: number,
        mouseY: number,
        parentName: string,
        childName: string,
      ) => {
        showStatsTooltip(mouseX, mouseY, parentName, childName);
      };

      const hideTooltip = () => {
        tooltipEl.style.display = "none";
        tooltipEl.style.pointerEvents = "none";
      };

      let activeKey: string | null = null; // tracks current tooltip target
      const HIT_PIXELS = 12; // edge hit area in screen pixels

      const onMouseMove = (e: any) => {
        if (!edgesGroupEl || bezierEdges.length === 0) return;
        if (!edgesGroupEl.transformCoordToLocal) return;

        // Convert mouse pixel coords → edges group local coords
        const [mx, my] = edgesGroupEl.transformCoordToLocal(
          e.offsetX,
          e.offsetY,
        );

        // Compute pixel-to-layout scale so hit area is consistent across zoom levels
        const [ox] = edgesGroupEl.transformCoordToLocal(0, 0);
        const [ox1] = edgesGroupEl.transformCoordToLocal(1, 0);
        const pxToLayout = Math.abs(ox1 - ox) || 1;
        const hitThreshold = HIT_PIXELS * pxToLayout;
        const nodeRadius = 42 * pxToLayout; // half of max symbolSize=80 + small margin

        // Check if mouse is near a node center
        let nearestNode: (typeof nodePositions)[0] | null = null;
        let nearestNodeDist = Infinity;
        for (const np of nodePositions) {
          const d = Math.hypot(np.x - mx, np.y - my);
          if (d < nodeRadius && d < nearestNodeDist) {
            nearestNodeDist = d;
            nearestNode = np;
          }
        }

        if (nearestNode) {
          // Show node tooltip
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          const key = `node:${nearestNode.name}`;
          activeKey = key;
          showNodeTooltip(e.offsetX, e.offsetY, nearestNode.name, nearestNode.value);
          return;
        }

        // Find nearest bezier edge
        let bestDist = Infinity;
        let bestIdx = -1;
        for (let i = 0; i < bezierEdges.length; i++) {
          const d = pointToBezierDistance(mx, my, bezierEdges[i].shape);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }

        if (bestIdx >= 0 && bestDist < hitThreshold) {
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          const edge = bezierEdges[bestIdx];
          const key = `edge:${edge.parentName}->${edge.childName}`;
          activeKey = key;
          showEdgeTooltip(
            e.offsetX,
            e.offsetY,
            edge.parentName,
            edge.childName,
          );
        } else if (activeKey) {
          if (!hideTimer) {
            hideTimer = setTimeout(() => {
              activeKey = null;
              hideTooltip();
              hideTimer = null;
            }, 100);
          }
        }
      };

      const onGlobalOut = () => {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        activeKey = null;
        hideTooltip();
      };

      zr.on("mousemove", onMouseMove);
      zr.on("globalout", onGlobalOut);

      // Graph mode: ECharts fires mouseover/mouseout for graph series edges.
      // These share the same showEdgeTooltip/hideTooltip as tree mode.
      const onEChartsEdgeMouseover = (params: any) => {
        if (params.dataType !== "edge") return;
        const parentName = params.data?.source ?? "";
        const childName = params.data?.target ?? "";
        if (!parentName || !childName) return;
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        const mouseX = params.event?.offsetX ?? params.event?.zrX ?? 0;
        const mouseY = params.event?.offsetY ?? params.event?.zrY ?? 0;
        const key = `edge:${parentName}->${childName}`;
        activeKey = key;
        showEdgeTooltip(mouseX, mouseY, parentName, childName);
      };

      const onEChartsEdgeMouseout = (params: any) => {
        if (params.dataType !== "edge") return;
        if (!hideTimer) {
          hideTimer = setTimeout(() => {
            hideTimer = null;
            activeKey = null;
            hideTooltip();
          }, 100);
        }
      };

      // Node hover → animate adjacent edges
      const onNodeMouseover = (params: any) => {
        if (params.dataType !== "node") return;
        updateEdgeStylesForHover(params.data?.id ?? params.name ?? null);
      };
      const onNodeMouseout = (params: any) => {
        if (params.dataType !== "node") return;
        updateEdgeStylesForHover(null);
      };

      chart.on("mouseover", onEChartsEdgeMouseover);
      chart.on("mouseout", onEChartsEdgeMouseout);
      chart.on("mouseover", onNodeMouseover);
      chart.on("mouseout", onNodeMouseout);

      return () => {
        zr.off("mousemove", onMouseMove);
        zr.off("globalout", onGlobalOut);
        chart.off("mouseover", onEChartsEdgeMouseover);
        chart.off("mouseout", onEChartsEdgeMouseout);
        chart.off("mouseover", onNodeMouseover);
        chart.off("mouseout", onNodeMouseout);
        chart.off("finished", debouncedBuild);
        if (buildTimer) clearTimeout(buildTimer);
        if (hideTimer) clearTimeout(hideTimer);
        tooltipEl.remove();
      };
    };

    // Set up edge tooltips whenever chart is (re)created for tree view
    watch(
      chartKey,
      async () => {
        // Clean up previous handlers
        if (edgeTooltipCleanup) {
          edgeTooltipCleanup();
          edgeTooltipCleanup = null;
        }
        // Cancel any pending setup to avoid duplicates
        if (pendingTooltipSetup) {
          clearTimeout(pendingTooltipSetup);
          pendingTooltipSetup = null;
        }
        await nextTick();
        pendingTooltipSetup = setTimeout(() => {
          pendingTooltipSetup = null;
          const chart = chartRendererRef.value?.chart;
          if (chart) {
            edgeTooltipCleanup = setupTreeEdgeTooltips(chart);
          }
        }, 300);
      },
      { flush: "post" },
    );

    // Watch for data loading completion to set up tooltips on initial load
    // This handles the case where chartKey changes before the chart is rendered
    watch(
      () => loading.value,
      async (isLoading, wasLoading) => {
        // Only trigger when loading changes from true to false (data just loaded)
        if (wasLoading && !isLoading) {
          // Clean up previous handlers first
          if (edgeTooltipCleanup) {
            edgeTooltipCleanup();
            edgeTooltipCleanup = null;
          }
          // Cancel any pending setup to avoid duplicates
          if (pendingTooltipSetup) {
            clearTimeout(pendingTooltipSetup);
            pendingTooltipSetup = null;
          }

          await nextTick();
          // Longer delay to ensure chart is fully rendered with new data
          pendingTooltipSetup = setTimeout(() => {
            pendingTooltipSetup = null;
            const chart = chartRendererRef.value?.chart;
            if (chart) {
              edgeTooltipCleanup = setupTreeEdgeTooltips(chart);
            }
          }, 500);
        }
      },
    );

    // When visualization type changes (tree↔graph), the chart component is reused
    // but the series type swaps via setOption. Re-register tooltip handlers so both
    // ZRender (tree) and ECharts edge events (graph) work correctly after the swap.
    watch(
      () => searchObj.meta.serviceGraphVisualizationType,
      async () => {
        if (edgeTooltipCleanup) {
          edgeTooltipCleanup();
          edgeTooltipCleanup = null;
        }
        // Cancel any pending setup to avoid duplicates
        if (pendingTooltipSetup) {
          clearTimeout(pendingTooltipSetup);
          pendingTooltipSetup = null;
        }
        await nextTick();
        pendingTooltipSetup = setTimeout(() => {
          pendingTooltipSetup = null;
          const chart = chartRendererRef.value?.chart;
          if (chart) {
            edgeTooltipCleanup = setupTreeEdgeTooltips(chart);
          }
        }, 300);
      },
    );

    onBeforeUnmount(() => {
      // Clear any pending tooltip setup
      if (pendingTooltipSetup) {
        clearTimeout(pendingTooltipSetup);
        pendingTooltipSetup = null;
      }
      if (edgeTooltipCleanup) {
        edgeTooltipCleanup();
        edgeTooltipCleanup = null;
      }
    });

    const loadServiceGraph = async () => {
      // Prevent concurrent loads — if already loading, skip
      if (loading.value) return;

      loading.value = true;
      error.value = null;

      // Clear cache to force chart regeneration with fresh data
      lastChartOptions.value = null;
      chartKey.value++;
      try {
        const orgId = store.state.selectedOrganization.identifier;

        if (!orgId) {
          throw new Error(t("traces.serviceGraph.noOrganizationSelected"));
        }

        const { startTime, endTime } = getEffectiveTimeRange(
          searchObj.data.datetime,
        );

        // Topology, node kinds, edges and latency all come from the
        // pre-aggregated _o2_service_graph stream via /topology/current. The
        // backend hourly job (processor + build_topology) computes the complete,
        // classified topology — queue consumers, collision handling, GenAI
        // agent/tool/model edges — incrementally per window, so reading it here
        // is a cheap small-stream read that scales to TB-level trace volumes
        // (we do NOT re-scan raw traces per load). The UI is a thin renderer.
        const streamName =
          streamFilter.value && streamFilter.value !== "all"
            ? streamFilter.value
            : undefined;
        const response = await serviceGraphService.getCurrentTopology(orgId, {
          streamName,
          startTime,
          endTime,
        });
        const raw = response?.data ?? { nodes: [], edges: [] };
        const nodeIds = new Set((raw.nodes ?? []).map((n: any) => n.id));
        const nodes = (raw.nodes ?? []).map((n: any) => ({
          id: n.id,
          label: n.label ?? n.id,
          requests: n.requests ?? 0,
          errors: n.errors ?? 0,
          error_rate: n.error_rate ?? 0,
          service_type: n.service_type ?? undefined,
        }));
        const edges = (raw.edges ?? [])
          .filter(
            (e: any) =>
              e.to && nodeIds.has(e.to) && (e.from == null || nodeIds.has(e.from)),
          )
          .map((e: any) => ({
            from: e.from ?? null,
            to: e.to,
            total_requests: e.total_requests ?? 0,
            failed_requests: e.failed_requests ?? 0,
            error_rate: e.error_rate ?? 0,
            p50_latency_ns: e.p50_latency_ns ?? 0,
            p95_latency_ns: e.p95_latency_ns ?? 0,
            p99_latency_ns: e.p99_latency_ns ?? 0,
            connection_type: e.connection_type ?? undefined,
          }));

        // Deterministic order. The backend does not guarantee node/edge order,
        // and the layouts (computeTreeLayout Y-slots, computeForceLayout seed)
        // are order-sensitive — so without this, the SAME topology renders a
        // DIFFERENT graph each fetch. Sort nodes by id and edges by (from,to) so
        // an identical topology always produces an identical graph.
        nodes.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
        edges.sort((a: any, b: any) => {
          const f = String(a.from ?? "").localeCompare(String(b.from ?? ""));
          return f !== 0 ? f : String(a.to).localeCompare(String(b.to));
        });

        graphData.value = {
          nodes,
          edges,
        };

        // Calculate stats
        const totalRequests = graphData.value.edges.reduce(
          (sum: number, e: any) => sum + e.total_requests,
          0,
        );
        const totalErrors = graphData.value.edges.reduce(
          (sum: number, e: any) => sum + e.failed_requests,
          0,
        );

        stats.value = {
          services: graphData.value.nodes.length,
          connections: graphData.value.edges.length,
          totalRequests,
          totalErrors,
          errorRate:
            totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
        };

        lastUpdated.value = new Date().toLocaleTimeString();

        // Apply filters and render
        applyFilters();
      } catch (err: any) {
        console.error("Failed to load service graph:", err);

        // Provide detailed error messages based on error type
        if (err.message === "Request timeout") {
          error.value = t("traces.serviceGraph.errorRequestTimeout");
        } else if (err.response?.status === 404) {
          error.value = t("traces.serviceGraph.errorApiNotFound");
        } else if (err.response?.status === 403) {
          error.value = t("traces.serviceGraph.errorAccessDenied");
        } else if (err.response?.status === 500) {
          error.value = t("traces.serviceGraph.errorServerError");
        } else if (err.message === "Network Error" || !navigator.onLine) {
          error.value = t("traces.serviceGraph.errorNetwork");
        } else {
          error.value =
            err.response?.data?.message ||
            err.message ||
            t("traces.serviceGraph.errorLoadFailed");
        }
      } finally {
        loading.value = false;
        lastRunAt.value = Date.now();
      }
    };

    const parsePrometheusMetrics = (metricsText: string) => {
      const nodes = new Map<string, any>();
      const edges: any[] = [];

      const lines = metricsText.split("\n");

      for (const line of lines) {
        if (line.startsWith("#") || !line.trim()) continue;

        // Parse metric line: metric_name{labels} value
        const match = line.match(/^(\w+)\{([^}]+)\}\s+([\d.eE+-]+)/);
        if (!match) continue;

        const [, metricName, labelsStr, value] = match;
        const labels: any = {};

        // Parse labels
        const labelMatches = Array.from(labelsStr.matchAll(/(\w+)="([^"]+)"/g));
        for (const [, key, val] of labelMatches) {
          labels[key] = val;
        }

        if (!labels.client || !labels.server) continue;

        // Add nodes
        if (!nodes.has(labels.client)) {
          nodes.set(labels.client, {
            id: labels.client,
            label: labels.client,
            is_virtual: labels.client === "unknown",
          });
        }
        if (!nodes.has(labels.server)) {
          nodes.set(labels.server, {
            id: labels.server,
            label: labels.server,
            is_virtual: labels.server.includes("unknown"),
          });
        }

        // Add edge data
        if (metricName === "traces_service_graph_request_total") {
          const edgeId = `${labels.client}->${labels.server}`;
          let edge = edges.find((e) => e.id === edgeId);

          if (!edge) {
            edge = {
              id: edgeId,
              from: labels.client,
              to: labels.server,
              total_requests: 0,
              failed_requests: 0,
            };
            edges.push(edge);
          }

          edge.total_requests = parseFloat(value);
        }

        if (metricName === "traces_service_graph_request_failed_total") {
          const edgeId = `${labels.client}->${labels.server}`;
          let edge = edges.find((e) => e.id === edgeId);

          // Create edge if it doesn't exist yet (failed_total may come before request_total)
          if (!edge) {
            edge = {
              id: edgeId,
              from: labels.client,
              to: labels.server,
              total_requests: 0,
              failed_requests: 0,
            };
            edges.push(edge);
          }

          edge.failed_requests = parseFloat(value);
        }
      }

      return {
        nodes: Array.from(nodes.values()),
        edges,
      };
    };

    const onStreamFilterChange = (stream: string) => {
      emit("request:stream-change", stream);
    };

    const applyFilters = () => {
      let nodes = [...graphData.value.nodes];
      let edges = [...graphData.value.edges];

      // Filter by search
      const trimmedSearch = searchFilter.value?.trim();
      if (trimmedSearch) {
        const search = trimmedSearch.toLowerCase();
        const matchingNodeIds = new Set(
          nodes
            .filter((n) => n.label.toLowerCase().includes(search))
            .map((n) => n.id),
        );

        edges = edges.filter(
          (e) => matchingNodeIds.has(e.from) || matchingNodeIds.has(e.to),
        );

        const usedNodeIds = new Set([
          ...edges.map((e) => e.from),
          ...edges.map((e) => e.to),
        ]);
        nodes = nodes.filter((n) => usedNodeIds.has(n.id));
      }

      // Adaptive collapse: fold large dependency fan-outs into boundary nodes,
      // drop hidden kinds, honoring the current mode/expand/hide state.
      filteredGraphData.value = applyGraphCollapse(
        { nodes, edges },
        {
          mode: collapseMode.value,
          expandedKinds: expandedKinds.value,
          expandedGroups: expandedGroups.value,
          hiddenKinds: hiddenKinds.value,
          threshold: collapseThreshold.value,
        },
      );
    };

    // Watch composable viz/layout state changes from SearchBar toolbar
    watch(
      () => searchObj.meta.serviceGraphVisualizationType,
      () => {
        // Only clear the cache — do NOT bump chartKey (that would recreate the
        // ChartRenderer and replay the tree expand animation). The clean series
        // swap comes from chartData rendering with notMerge:true (full replace),
        // which lets a `type:"tree"` series be replaced by a `type:"graph"` one
        // (and vice-versa) — a merge cannot swap series types.
        lastChartOptions.value = null;
      },
    );

    watch(
      () => searchObj.meta.serviceGraphLayoutType,
      () => {
        chartKey.value++;
      },
    );

    // Watch shared datetime — reload when SearchBar changes time range
    watch(
      () => searchObj.data.datetime,
      () => {
        loadServiceGraph();
      },
      { deep: true },
    );

    // Keep streamFilter in sync when Traces/Spans tab changes the global stream
    watch(
      () => searchObj.data.stream.selectedStream.value,
      (newStream) => {
        if (newStream && newStream !== streamFilter.value) {
          streamFilter.value = newStream;
          localStorage.setItem("serviceGraph_streamFilter", newStream);
          loadServiceGraph();
        }
      },
    );

    const formatNumber = (num: number) => {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
      if (num >= 1000) return (num / 1000).toFixed(1) + "K";
      return num.toString();
    };

    // Load trace streams using the same method as the Traces search page
    const loadTraceStreams = async () => {
      try {
        const res = await getStreams("traces", false, false);
        if (res?.list?.length > 0) {
          availableStreams.value = res.list.map((stream: any) => stream.name);
        }
      } catch (e) {
        console.error("Error loading trace streams:", e);
      }
    };

    // Settings handler
    const resetSettings = () => {
      // Reset to default settings if needed
      showSettings.value = false;
    };

    // Side Panel Handlers
    const handleNodeClick = (params: any) => {
      // A collapsed boundary node: clicking it expands/collapses that kind
      // instead of opening the side panel.
      const d = params?.data;
      const clickedId: string | undefined = d?.id ?? d?.name;
      if (d?.is_group || clickedId?.startsWith?.(GROUP_PREFIX)) {
        // Boundary id is `__group_<kind>__<caller>`. Toggle THIS specific group
        // (one caller's dependencies) — not the whole kind — so expanding
        // payment's externals leaves product's externals collapsed.
        if (clickedId) toggleGroupExpansion(clickedId);
        return;
      }
      // Check if it's a node click (for graph visualization)
      if (params.dataType === "node" && params.data) {
        // Check if clicking the same node - if so, close the panel
        if (selectedNode.value && selectedNode.value.id === params.data.id) {
          showSidePanel.value = false;
          selectedNode.value = null;
        } else {
          selectedNode.value = params.data;
          showSidePanel.value = true;
        }
      }
      // For tree visualization, check if it's a tree node
      else if (
        params.componentType === "series" &&
        params.data &&
        params.data.name
      ) {
        // Find the actual node data from graphData
        const nodeData = graphData.value.nodes.find(
          (n: any) => n.label === params.data.name || n.id === params.data.name,
        );

        if (nodeData) {
          // Check if clicking the same node - if so, close the panel
          if (selectedNode.value && selectedNode.value.id === nodeData.id) {
            showSidePanel.value = false;
            selectedNode.value = null;
          } else {
            selectedNode.value = nodeData;
            showSidePanel.value = true;
          }
        } else {
          console.warn(
            "[ServiceGraph] Could not find node data for:",
            params.data.name,
          );
        }
      }
    };

    const handleCloseSidePanel = () => {
      showSidePanel.value = false;
      // Don't clear selectedNode immediately to allow smooth close animation
      setTimeout(() => {
        selectedNode.value = null;
      }, 300);
    };

    onMounted(async () => {
      await loadTraceStreams();
      loadServiceGraph();
    });

    // Public API for parent pages (e.g. Agent Graph page's header refresh).
    expose({ refresh: loadServiceGraph, loading, lastRunAt });

    return {
      t,
      loading,
      error,
      graphData,
      filteredGraphData,
      kindCounts,
      totalEntities,
      kindRows,
      activeFilterCount,
      healthLevels,
      stats,
      showSettings,
      lastUpdated,
      searchFilter,
      streamFilter,
      availableStreams,
      chartData,
      chartKey,
      chartRendererRef,
      graphContainerRef,
      searchObj,
      loadServiceGraph,
      formatNumber,
      applyFilters,
      onStreamFilterChange,
      resetSettings,
      // Adaptive collapse
      collapseMode,
      collapseThreshold,
      expandedKinds,
      expandedGroups,
      hiddenKinds,
      toggleGroupExpansion,
      setCollapseMode,
      toggleKindVisibility,
      zoomIn,
      zoomOut,
      fitToScreen,
      // Node side panel
      selectedNode,
      showSidePanel,
      handleNodeClick,
      handleCloseSidePanel,
    };
  },
});
</script>

<!-- Flowing edge animation — non-scoped so it reaches inside ECharts SVG output -->
<style scoped>
/* keep(lib-override:echarts): dashed edge paths are rendered inside ECharts'
   SVG DOM (no scope id, reached via :deep), animated by a keyframe that must
   travel with the rule. ECharts may expose stroke-dasharray as an attribute or
   an inline style depending on version — both are covered. */
@keyframes sg-edge-flow {
  from {
    stroke-dashoffset: 14;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.graph-container :deep(svg path[stroke-dasharray]),
.graph-container :deep(svg path[style*="stroke-dasharray"]) {
  animation: sg-edge-flow 0.5s linear infinite;
  animation-fill-mode: both;
}
</style>
