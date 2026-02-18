<template>
  <q-card flat class="tw:h-full">
    <q-card-section class="tw:p-[0.375rem] tw:h-full card-container service-graph-container">
      <!-- Top row with search and control buttons -->
      <div class="row items-center q-col-gutter-sm q-mb-md">
        <div class="col-12 col-md-5 tw:flex tw:gap-[0.5rem]">
          <!-- Stream selector - synced from traces page, no "All Streams" -->
          <q-select
            v-model="streamFilter"
            :options="
              availableStreams.length > 0
                ? availableStreams.map((s) => ({ label: s, value: s }))
                : []
            "
            dense
            borderless
            emit-value
            map-options
            class="tw:w-[180px] tw:flex-shrink-0"
            @update:model-value="onStreamFilterChange"
            :disable="availableStreams.length === 0"
          >
            <template #prepend>
              <q-icon name="storage" size="xs" />
            </template>
            <q-tooltip v-if="availableStreams.length === 0">
              No streams detected. Ensure service graph metrics include
              stream_name labels.
            </q-tooltip>
          </q-select>

          <!-- Search input -->
          <q-input
            v-model="searchFilter"
            borderless
            dense
            class="no-border tw:h-[36px]"
            placeholder="Search services..."
            debounce="300"
            @update:model-value="applyFilters"
            clearable
          >
            <template #prepend>
              <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </q-input>
        </div>
        <div
          class="col-12 col-md-7 tw:flex tw:justify-end tw:items-center tw:gap-[0.75rem]"
        >
          <!-- 1. Time range selector -->
          <date-time
            ref="dateTimeRef"
            auto-apply
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            data-test="service-graph-date-time-picker"
            class="tw:h-[2rem]"
            @on:date-change="updateTimeRange"
          />

          <!-- 2. Refresh button -->
          <q-btn
            data-test="service-graph-refresh-btn"
            no-caps
            flat
            class="o2-secondary-button"
            @click="loadServiceGraph"
            :loading="loading"
          >
          Refresh
          </q-btn>

          <!-- 3. Graph/Tree view toggle -->
          <div class="app-tabs-container tw:h-[36px]">
            <app-tabs
              data-test="service-graph-view-tabs"
              class="tabs-selection-container"
              :tabs="visualizationTabs"
              v-model:active-tab="visualizationType"
              @update:active-tab="setVisualizationType"
            />
          </div>

          <!-- 4. Layout dropdown (only meaningful for tree view) -->
          <q-select
            v-model="layoutType"
            :options="layoutOptions"
            dense
            borderless
            class="tw:w-[160px]"
            emit-value
            map-options
            @update:model-value="setLayout"
            :disable="visualizationType === 'graph'"
          />
        </div>
      </div>

      <!-- Graph Visualization -->
      <q-card flat bordered class="graph-card tw:h-[calc(100%-4rem)]">
        <q-card-section class="q-pa-none tw:h-full" style="height: 100%">
          <div class="graph-container tw:h-full tw:bg-[var(--o2-bg)]">
            <div v-if="loading" class="flex flex-center tw:h-full">
              <div class="text-center tw:flex tw:flex-col tw:items-center">
                <q-spinner-hourglass color="primary" size="4em" />
                <div class="text-subtitle1 q-mt-md text-grey-7">
                  Loading service graph...
                </div>
              </div>
            </div>
            <div
              v-else-if="error"
              class="flex flex-center tw:h-full text-center tw:p-[0.675rem]"
            >
              <div>
                <q-icon name="error_outline" size="4em" color="negative" />
                <div class="text-h6 q-mt-md tw:text-[var(--o2-text-primary)]">
                  {{ error }}
                </div>
                <q-btn
                  outline
                  color="primary"
                  label="Retry"
                  @click="loadServiceGraph"
                  class="q-mt-md"
                />
              </div>
            </div>
            <div
              v-else-if="!graphData.nodes.length"
              class="flex flex-center tw:h-full text-center tw:p-[0.675rem]"
            >
              <div>
                <q-icon name="hub" size="5em" color="grey-4" />
                <div class="text-h6 q-mt-md text-grey-7">
                  No Service Graph Data
                </div>
                <div class="text-body2 text-grey-6 q-mt-sm">
                  Try querying a longer duration
                </div>
              </div>
            </div>
            <div v-else class="tw:h-full graph-with-panel-container">
              <ChartRenderer
                ref="chartRendererRef"
                data-test="service-graph-chart"
                :data="chartData"
                :key="chartKey"
                class="tw:h-full"
                @click="handleNodeClick"
              />

              <!-- Service Graph Side Panel -->
              <ServiceGraphSidePanel
                v-if="selectedNode"
                :selected-node="selectedNode"
                :graph-data="graphData"
                :time-range="searchObj.data.datetime"
                :visible="showSidePanel"
                :stream-filter="streamFilter"
                @close="handleCloseSidePanel"
              />

              <!-- Service Graph Edge Panel -->
              <ServiceGraphEdgePanel
                v-if="selectedEdge"
                :selected-edge="selectedEdge"
                :graph-data="graphData"
                :time-range="searchObj.data.datetime"
                :visible="showEdgePanel"
                @close="handleCloseEdgePanel"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-card-section>
  </q-card>

  <!-- Enhanced Settings Dialog -->
  <q-dialog v-model="showSettings">
    <q-card style="min-width: 450px">
      <q-card-section>
        <div class="text-h6">Service Graph Settings</div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <div class="q-gutter-md">
          <div class="text-caption text-grey-7">
            Stream-based topology - all data persisted to storage
            <q-tooltip
              >Service graph uses stream-only architecture with zero in-memory
              state</q-tooltip
            >
          </div>
        </div>
      </q-card-section>
      <q-separator />
      <q-card-actions align="right">
        <q-btn
          flat
          dense
          no-caps
          label="Close"
          color="primary"
          v-close-popup
          class="o2-secondary-button tw:h-[2rem]"
        />
        <q-btn
          label="Reset"
          @click="resetSettings"
          class="o2-primary-button tw:h-[2rem]"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import serviceGraphService from "@/services/service_graph";
import AppTabs from "@/components/common/AppTabs.vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import DateTime from "@/components/DateTime.vue";
import ServiceGraphSidePanel from "./ServiceGraphSidePanel.vue";
import ServiceGraphEdgePanel from "./ServiceGraphEdgePanel.vue";
import {
  convertServiceGraphToTree,
  convertServiceGraphToNetwork,
} from "@/utils/traces/convertTraceData";
import useStreams from "@/composables/useStreams";
import useTraces from "@/composables/useTraces";


export default defineComponent({
  name: "ServiceGraph",
  components: {
    AppTabs,
    ChartRenderer,
    DateTime,
    ServiceGraphSidePanel,
    ServiceGraphEdgePanel,
  },
  emits: [],
  setup(props, { emit }) {
    const store = useStore();
    const $q = useQuasar();
    const router = useRouter();
    const { getStreams } = useStreams();
    const { searchObj } = useTraces();

    const loading = ref(false);
    const error = ref<string | null>(null);
    const showSettings = ref(false);
    const lastUpdated = ref("");

    // Side panel state
    const selectedNode = ref<any>(null);
    const showSidePanel = ref(false);

    // Edge panel state
    const selectedEdge = ref<any>(null);
    const showEdgePanel = ref(false);

    // Persist visualization type in localStorage
    const storedVisualizationType = localStorage.getItem(
      "serviceGraph_visualizationType",
    );
    const visualizationType = ref<"tree" | "graph">(
      (storedVisualizationType as "tree" | "graph") || "tree",
    );

    // Visualization tabs configuration
    const visualizationTabs = [
      { label: "Tree View", value: "tree" },
      { label: "Graph View", value: "graph" },
    ];

    // Initialize layout type based on visualization type
    const storedLayoutType = localStorage.getItem("serviceGraph_layoutType");
    let defaultLayoutType = "force";
    if (visualizationType.value === "tree") {
      defaultLayoutType = "horizontal";
    }
    const layoutType = ref(storedLayoutType || defaultLayoutType);
    const chartRendererRef = ref<any>(null);

    const searchFilter = ref("");

    // Stream filter — synced from traces page selected stream
    const tracesStream = searchObj.data.stream?.selectedStream?.value || '';
    const storedStreamFilter = localStorage.getItem(
      "serviceGraph_streamFilter",
    );
    const streamFilter = ref(tracesStream || storedStreamFilter || "default");
    const availableStreams = ref<string[]>([]);

    const graphData = ref<any>({
      nodes: [],
      edges: [],
    });

    const filteredGraphData = ref<any>({
      nodes: [],
      edges: [],
    });

    const stats = ref<any>(null);

    // Use shared datetime from searchObj instead of local timeRange
    // searchObj.data.datetime is managed by useTraces composable and shared across tabs

    const dateTimeRef = ref<any>(null);


    // Key to control chart recreation - only change when layout/visualization type changes
    const chartKey = ref(0);

    // Track last chart options to prevent unnecessary recreation for graph view
    const lastChartOptions = ref<any>(null);

    // Layout options based on visualization type
    const layoutOptions = computed(() => {
      if (visualizationType.value === "tree") {
        return [
          { label: "Horizontal", value: "horizontal" },
          { label: "Vertical", value: "vertical" },
        ];
      } else {
        return [
          { label: "Force Directed", value: "force" },
        ];
      }
    });

    const chartData = computed(() => {
      if (!filteredGraphData.value.nodes.length) {
        return { options: {}, notMerge: true };
      }

      // Don't use cache if filters are active (search filter)
      const hasActiveFilters = searchFilter.value?.trim();

      // Use cached options if chartKey hasn't changed (prevents double rendering)
      // BUT only if no filters are active
      if (visualizationType.value === "graph" &&
          lastChartOptions.value &&
          chartKey.value === lastChartOptions.value.key &&
          !hasActiveFilters) {
        return {
          options: lastChartOptions.value.data.options,
          notMerge: false,
          lazyUpdate: true,
          silent: true,
        };
      }

      const newOptions =
        visualizationType.value === "tree"
          ? convertServiceGraphToTree(
              filteredGraphData.value,
              layoutType.value,
              $q.dark.isActive // Pass dark mode state
            )
          : convertServiceGraphToNetwork(
              filteredGraphData.value,
              layoutType.value,
              new Map(), // Empty position cache to allow free movement
              $q.dark.isActive, // Pass dark mode state
              undefined, // Don't pass selected node - we'll use dispatchAction instead
            );

      // Cache the options for graph view
      // BUT only if no filters are active (to avoid caching filtered states)
      if (visualizationType.value === "graph" && !hasActiveFilters) {
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
        notMerge: visualizationType.value === "graph" ? false : true, // Merge for graph, replace for tree
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
            type: 'unselect',
            seriesIndex: 0,
            name: oldId,
          });
        }

        // Select the new node (if any)
        if (newId) {
          chart.dispatchAction({
            type: 'select',
            seriesIndex: 0,
            name: newId,
          });
        }
      },
      { flush: 'post' }
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
            type: 'select',
            seriesIndex: 0,
            name: nodeIdToReselect,
          });
        }, 500); // 500ms delay to ensure chart has fully regenerated
      }
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
            type: 'restore',
          });
        }, 500); // Longer delay to ensure chart has recalculated positions
      }
    );

    // --- Tree edge tooltip: show node tooltip when hovering edge lines ---
    let edgeTooltipCleanup: (() => void) | null = null;

    const setupTreeEdgeTooltips = (chart: any) => {
      const zr = chart.getZr();
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      // Custom tooltip element (matches ECharts default tooltip style)
      const tooltipEl = document.createElement('div');
      tooltipEl.style.cssText = `
        position: absolute; pointer-events: none; z-index: 9999;
        background: rgba(50, 50, 50, 0.95); color: #fff;
        border: 1px solid #777; border-radius: 4px;
        padding: 8px 12px; font-size: 13px; line-height: 1.6;
        display: none; white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      `;
      const chartDom = chart.getDom();
      if (!chartDom.style.position || chartDom.style.position === 'static') {
        chartDom.style.position = 'relative';
      }
      chartDom.appendChild(tooltipEl);

      // Cached edge data: bezier shapes + parent/child names
      let edgesGroupEl: any = null;
      let bezierEdges: Array<{
        shape: any;
        childName: string;
        parentName: string;
      }> = [];
      let nodePositions: Array<{ idx: number; x: number; y: number; name: string }> = [];

      // Robust child access — handles children(), _children, or childAt/childCount
      const getChildren = (group: any): any[] => {
        if (typeof group.children === 'function') return group.children();
        if (Array.isArray(group._children)) return group._children;
        const count = typeof group.childCount === 'function' ? group.childCount() : 0;
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
        return kids.some((c: any) => c.type === 'bezier-curve');
      };

      // Recursively search for a group containing bezier-curve elements
      const findBezierGroup = (el: any, depth = 0): any => {
        if (!el || depth > 6) return null;
        if (el.type === 'group' && hasBezierChildren(el)) return el;
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

          // Collect node layout positions + names
          for (let i = 0; i < count; i++) {
            const layout = data.getItemLayout(i);
            if (layout) {
              newNodePositions.push({ idx: i, x: layout.x, y: layout.y, name: data.getName(i) });
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
              if (sibling.type === 'group' && hasBezierChildren(sibling)) {
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
            if (bezier.type !== 'bezier-curve' || !bezier.shape) continue;
            const { x1, y1, x2, y2 } = bezier.shape;

            let parentName = '';
            let pDist = Infinity;
            let childName = '';
            let cDist = Infinity;
            for (const np of newNodePositions) {
              const dp = Math.hypot(np.x - x1, np.y - y1);
              if (dp < pDist) { pDist = dp; parentName = np.name; }
              const dc = Math.hypot(np.x - x2, np.y - y2);
              if (dc < cDist) { cDist = dc; childName = np.name; }
            }
            newBezierEdges.push({ shape: { ...bezier.shape }, childName, parentName });
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
      chart.on('finished', debouncedBuild);
      // Also try immediately (works if chart already rendered)
      buildEdgeData();

      // Point-to-cubic-bezier distance (20-sample approximation)
      const pointToBezierDist = (px: number, py: number, s: any): number => {
        let min = Infinity;
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          const u = 1 - t;
          const bx = u*u*u*s.x1 + 3*u*u*t*s.cpx1 + 3*u*t*t*s.cpx2 + t*t*t*s.x2;
          const by = u*u*u*s.y1 + 3*u*u*t*s.cpy1 + 3*u*t*t*s.cpy2 + t*t*t*s.y2;
          const d = Math.hypot(px - bx, py - by);
          if (d < min) min = d;
        }
        return min;
      };

      // Format helpers (match existing node tooltip style)
      const fmtNum = (n: number) =>
        n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
      const fmtLat = (ns: number) => {
        if (!ns) return 'N/A';
        const ms = ns / 1e6;
        return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms.toFixed(2) + 'ms';
      };

      // Position and show the tooltip at mouse coords
      const positionTooltip = (mouseX: number, mouseY: number) => {
        const cw = chartDom.clientWidth;
        const ch = chartDom.clientHeight;
        let left = mouseX + 15;
        let top = mouseY + 15;
        tooltipEl.style.display = 'block';
        if (left + tooltipEl.offsetWidth > cw) left = mouseX - tooltipEl.offsetWidth - 10;
        if (top + tooltipEl.offsetHeight > ch) top = mouseY - tooltipEl.offsetHeight - 10;
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
      };

      const showNodeTooltip = (mouseX: number, mouseY: number, nodeName: string) => {
        const edges = graphData.value?.edges || [];

        // Find incoming edge for this node (direction-aware, matches tree label)
        const incomingBezier = bezierEdges.find(b => b.childName === nodeName);
        if (incomingBezier) {
          // Non-root: show incoming edge metrics (matches the tree label's request count)
          const edge = edges.find((e: any) =>
            (e.from === incomingBezier.parentName || (e.from == null && !incomingBezier.parentName))
            && e.to === nodeName
          ) || edges.find((e: any) => e.to === nodeName);

          if (edge) {
            const total = edge.total_requests || 0;
            const failed = edge.failed_requests || 0;
            const errRate = edge.error_rate ?? (total > 0 ? (failed / total) * 100 : 0);
            tooltipEl.innerHTML = `
              <strong>${nodeName}</strong><br/>
              Requests: ${fmtNum(total)}<br/>
              Errors: ${fmtNum(failed)}<br/>
              Error Rate: ${errRate.toFixed(2)}%
            `;
            positionTooltip(mouseX, mouseY);
            return;
          }
        }

        // Root node or no incoming edge: sum outgoing edges
        const outgoing = edges.filter((e: any) => e.from === nodeName);
        if (outgoing.length > 0) {
          const total = outgoing.reduce((s: number, e: any) => s + (e.total_requests || 0), 0);
          const failed = outgoing.reduce((s: number, e: any) => s + (e.failed_requests || 0), 0);
          const errRate = total > 0 ? (failed / total) * 100 : 0;
          tooltipEl.innerHTML = `
            <strong>${nodeName}</strong><br/>
            Requests: ${fmtNum(total)}<br/>
            Errors: ${fmtNum(failed)}<br/>
            Error Rate: ${errRate.toFixed(2)}%
          `;
          positionTooltip(mouseX, mouseY);
          return;
        }

        // Fallback: use node aggregate
        const nodes = graphData.value?.nodes || [];
        const node = nodes.find((n: any) => (n.label || n.id) === nodeName);
        if (!node) { tooltipEl.style.display = 'none'; return; }
        const requests = node.requests || 0;
        const errors = node.errors || 0;
        const errRate = node.error_rate ?? (requests > 0 ? (errors / requests) * 100 : 0);
        tooltipEl.innerHTML = `
          <strong>${nodeName}</strong><br/>
          Requests: ${fmtNum(requests)}<br/>
          Errors: ${fmtNum(errors)}<br/>
          Error Rate: ${errRate.toFixed(2)}%
        `;
        positionTooltip(mouseX, mouseY);
      };

      const showEdgeTooltip = (mouseX: number, mouseY: number, parentName: string, childName: string) => {
        const edges = graphData.value?.edges || [];
        const edge = edges.find((e: any) =>
          (e.from === parentName || (e.from == null && !parentName)) && e.to === childName
        ) || edges.find((e: any) => e.to === childName);

        if (!edge) { tooltipEl.style.display = 'none'; return; }

        const total = edge.total_requests || 0;
        const failed = edge.failed_requests || 0;
        const errRate = edge.error_rate ?? (total > 0 ? (failed / total) * 100 : 0);

        tooltipEl.innerHTML = `
          <strong>Requests:</strong> ${fmtNum(total)}<br/>
          <strong>Errors:</strong> ${failed} (${errRate.toFixed(2)}%)<br/>
          <strong>P50:</strong> ${fmtLat(edge.p50_latency_ns)}<br/>
          <strong>P95:</strong> ${fmtLat(edge.p95_latency_ns)}<br/>
          <strong>P99:</strong> ${fmtLat(edge.p99_latency_ns)}
        `;
        positionTooltip(mouseX, mouseY);
      };

      const hideTooltip = () => {
        tooltipEl.style.display = 'none';
      };

      let activeKey: string | null = null; // tracks current tooltip target
      const HIT_PIXELS = 12; // edge hit area in screen pixels

      const onMouseMove = (e: any) => {
        if (!edgesGroupEl || bezierEdges.length === 0) return;
        if (!edgesGroupEl.transformCoordToLocal) return;

        // Convert mouse pixel coords → edges group local coords
        const [mx, my] = edgesGroupEl.transformCoordToLocal(e.offsetX, e.offsetY);

        // Compute pixel-to-layout scale so hit area is consistent across zoom levels
        const [ox] = edgesGroupEl.transformCoordToLocal(0, 0);
        const [ox1] = edgesGroupEl.transformCoordToLocal(1, 0);
        const pxToLayout = Math.abs(ox1 - ox) || 1;
        const hitThreshold = HIT_PIXELS * pxToLayout;
        const nodeRadius = 42 * pxToLayout; // half of max symbolSize=80 + small margin

        // Check if mouse is near a node center
        let nearestNode: typeof nodePositions[0] | null = null;
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
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          const key = `node:${nearestNode.name}`;
          activeKey = key;
          showNodeTooltip(e.offsetX, e.offsetY, nearestNode.name);
          return;
        }

        // Find nearest bezier edge
        let bestDist = Infinity;
        let bestIdx = -1;
        for (let i = 0; i < bezierEdges.length; i++) {
          const d = pointToBezierDist(mx, my, bezierEdges[i].shape);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }

        if (bestIdx >= 0 && bestDist < hitThreshold) {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          const edge = bezierEdges[bestIdx];
          const key = `edge:${edge.parentName}->${edge.childName}`;
          activeKey = key;
          showEdgeTooltip(e.offsetX, e.offsetY, edge.parentName, edge.childName);
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
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        activeKey = null;
        hideTooltip();
      };

      zr.on('mousemove', onMouseMove);
      zr.on('globalout', onGlobalOut);

      return () => {
        zr.off('mousemove', onMouseMove);
        zr.off('globalout', onGlobalOut);
        chart.off('finished', debouncedBuild);
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
        if (visualizationType.value !== 'tree') return;

        await nextTick();
        setTimeout(() => {
          const chart = chartRendererRef.value?.chart;
          if (chart) {
            edgeTooltipCleanup = setupTreeEdgeTooltips(chart);
          }
        }, 300);
      },
      { flush: 'post' }
    );

    onBeforeUnmount(() => {
      if (edgeTooltipCleanup) {
        edgeTooltipCleanup();
        edgeTooltipCleanup = null;
      }
    });

    const loadServiceGraph = async () => {
      loading.value = true;
      error.value = null;

      // Clear cache to force chart regeneration with fresh data
      lastChartOptions.value = null;
      chartKey.value++;

      try {
        const orgId = store.state.selectedOrganization.identifier;

        if (!orgId) {
          throw new Error("No organization selected");
        }

        // If a specific stream is selected but we don't have available streams yet,
        // first fetch all streams to populate the dropdown
        if (
          availableStreams.value.length === 0 &&
          streamFilter.value !== "all"
        ) {
          const allStreamsResponse =
            await serviceGraphService.getCurrentTopology(orgId, {
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            });
          if (
            allStreamsResponse.data.availableStreams &&
            allStreamsResponse.data.availableStreams.length > 0
          ) {
            availableStreams.value = allStreamsResponse.data.availableStreams;
          }
        }

        // Stream-only implementation - no store stats needed
        // Use JSON topology endpoint with time range
        const response = await serviceGraphService.getCurrentTopology(orgId, {
          streamName:
            streamFilter.value && streamFilter.value !== "all"
              ? streamFilter.value
              : undefined,
          startTime: searchObj.data.datetime.startTime,
          endTime: searchObj.data.datetime.endTime,
        });

        // Convert API response to expected format
        const rawData = response.data;

        // Ensure nodes have all required fields
        const nodes = (rawData.nodes || []).map((node: any) => ({
          id: node.id,
          label: node.label || node.id,
          requests: node.requests || 0,
          errors: node.errors || 0,
          error_rate: node.error_rate || 0,
          is_virtual: node.is_virtual || false,
        }));

        // Ensure edges have all required fields and valid node references
        const nodeIds = new Set(nodes.map((n: any) => n.id));
        const edges = (rawData.edges || [])
          .filter((edge: any) => {
            // Filter out edges with missing endpoints
            const hasValidEndpoints =
              edge.from &&
              edge.to &&
              nodeIds.has(edge.from) &&
              nodeIds.has(edge.to);
            if (!hasValidEndpoints) {
              console.warn(
                "[ServiceGraph] Skipping edge with invalid endpoints:",
                edge,
              );
            }
            return hasValidEndpoints;
          })
          .map((edge: any) => ({
            id: `${edge.from}->${edge.to}`,
            from: edge.from,
            to: edge.to,
            total_requests: edge.total_requests || 0,
            failed_requests: edge.failed_requests || 0,
            error_rate: edge.error_rate || 0,
            p50_latency_ns: edge.p50_latency_ns || 0,
            p95_latency_ns: edge.p95_latency_ns || 0,
            p99_latency_ns: edge.p99_latency_ns || 0,
          }));

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
          error.value =
            "Request timed out. The service graph may be processing large amounts of data. Please try again.";
        } else if (err.response?.status === 404) {
          error.value =
            "Service Graph API endpoint not found. Ensure you're running enterprise version of OpenObserve.";
        } else if (err.response?.status === 403) {
          error.value =
            "Access denied. You may not have permission to view the service graph for this organization.";
        } else if (err.response?.status === 500) {
          error.value = "Server error occurred. Check server logs for details.";
        } else if (err.message === "Network Error" || !navigator.onLine) {
          error.value = "Network error. Please check your internet connection.";
        } else {
          error.value =
            err.response?.data?.message ||
            err.message ||
            "Failed to load service graph data. Please check server logs.";
        }
      } finally {
        loading.value = false;
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
      streamFilter.value = stream;
      localStorage.setItem("serviceGraph_streamFilter", stream);

      // Reload service graph with new stream filter
      loadServiceGraph();
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

      filteredGraphData.value = { nodes, edges };
    };

    const setLayout = (type: string) => {
      layoutType.value = type;
      // Persist layout type to localStorage
      localStorage.setItem("serviceGraph_layoutType", type);
      // Force chart recreation when layout changes
      chartKey.value++;
    };

    const setVisualizationType = (type: "tree" | "graph") => {
      visualizationType.value = type;
      // Persist visualization type to localStorage
      localStorage.setItem("serviceGraph_visualizationType", type);
      // Set default layout for each visualization type
      if (type === "tree") {
        layoutType.value = "horizontal";
      } else {
        layoutType.value = "force";
      }
      // Force chart recreation when visualization type changes
      chartKey.value++;
    };

    const formatNumber = (num: number) => {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
      if (num >= 1000) return (num / 1000).toFixed(1) + "K";
      return num.toString();
    };

    const updateTimeRange = (value: any) => {
      searchObj.data.datetime = {
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod:
          value.relativeTimePeriod || searchObj.data.datetime.relativeTimePeriod,
        type: value.relativeTimePeriod ? "relative" : "absolute",
      };
      // Reload service graph with new time range
      loadServiceGraph();
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
      // Check if it's an edge click (for graph visualization)
      if (params.dataType === 'edge' && params.data) {
        // Close node panel when opening edge panel
        showSidePanel.value = false;
        selectedNode.value = null;

        // Find the full edge data from graphData
        const edgeData = graphData.value.edges.find(
          (e: any) => e.from === params.data.source && e.to === params.data.target
        );
        if (edgeData) {
          selectedEdge.value = edgeData;
          showEdgePanel.value = true;
        } else {
          console.warn('[ServiceGraph] Could not find edge data for:', params.data.source, '->', params.data.target);
        }
      }
      // Check if it's a node click (for graph visualization)
      else if (params.dataType === 'node' && params.data) {
        // Check if clicking the same node - if so, close the panel
        if (selectedNode.value && selectedNode.value.id === params.data.id) {
          showSidePanel.value = false;
          selectedNode.value = null;
        } else {
          // Close edge panel when opening node panel
          showEdgePanel.value = false;
          selectedEdge.value = null;

          selectedNode.value = params.data;
          showSidePanel.value = true;
        }
      }
      // For tree visualization, check if it's a tree node
      else if (params.componentType === 'series' && params.data && params.data.name) {
        // Find the actual node data from graphData
        const nodeData = graphData.value.nodes.find(
          (n: any) => n.label === params.data.name || n.id === params.data.name
        );

        if (nodeData) {
          // Check if clicking the same node - if so, close the panel
          if (selectedNode.value && selectedNode.value.id === nodeData.id) {
            showSidePanel.value = false;
            selectedNode.value = null;
          } else {
            // Close edge panel when opening node panel
            showEdgePanel.value = false;
            selectedEdge.value = null;

            selectedNode.value = nodeData;
            showSidePanel.value = true;
          }
        } else {
          console.warn('[ServiceGraph] Could not find node data for:', params.data.name);
        }
      } else {
        console.log('[ServiceGraph] Click not on a node or edge, ignoring');
      }
    };

    const handleCloseSidePanel = () => {
      showSidePanel.value = false;
      // Don't clear selectedNode immediately to allow smooth close animation
      setTimeout(() => {
        selectedNode.value = null;
      }, 300);
    };

    // Edge Panel Handlers
    const handleCloseEdgePanel = () => {
      showEdgePanel.value = false;
      // Don't clear selectedEdge immediately to allow smooth close animation
      setTimeout(() => {
        selectedEdge.value = null;
      }, 300);
    };

    onMounted(async () => {
      await loadTraceStreams();
      loadServiceGraph();
    });

    return {
      loading,
      error,
      graphData,
      filteredGraphData,
      stats,
      showSettings,
      lastUpdated,
      searchFilter,
      streamFilter,
      availableStreams,
      visualizationType,
      visualizationTabs,
      layoutType,
      layoutOptions,
      chartData,
      chartKey,
      chartRendererRef,
      searchObj,
      dateTimeRef,
      loadServiceGraph,
      formatNumber,
      applyFilters,
      onStreamFilterChange,
      setLayout,
      setVisualizationType,
      updateTimeRange,
      resetSettings,
      // Side panel
      selectedNode,
      showSidePanel,
      handleNodeClick,
      handleCloseSidePanel,
      // Edge panel
      selectedEdge,
      showEdgePanel,
      handleCloseEdgePanel,
    };
  },
});
</script>

<style scoped lang="scss">
.stat-card {
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

.graph-card {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.graph-container {
  position: relative;
  width: 100%;
  border-radius: 4px;
  overflow: hidden;
}

.service-graph-container {
  position: relative;
  overflow: hidden;
  background: #0f1419 !important;
}

.body--light .service-graph-container {
  background: #ffffff !important; // White background for light mode
}

.graph-with-panel-container {
  position: relative;
  overflow: visible;
}

code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: "Courier New", monospace;
  font-size: 0.9em;
}
</style>
