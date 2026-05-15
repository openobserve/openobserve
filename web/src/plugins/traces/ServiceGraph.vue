<template>
  <q-card flat class="tw:h-full tw:flex tw:flex-col">
    <!-- Top toolbar: [stream-selector] [search-input]  ···spacer···  [legends] -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:p-[0.375rem] tw:pb-0">
      <!-- Stream selector -->
      <div
        data-test="service-graph-stream-selector"
        class="tw:w-[11rem] tw:flex-shrink-0"
      >
        <OSelect
          v-model="streamFilter"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="tw:w-[auto] tw:flex-shrink-0 tw:rounded"
          :disabled="availableStreams.length === 0"
          @update:model-value="onStreamFilterChange"
        />
        <OTooltip v-if="availableStreams.length === 0" content="No streams detected. Ensure service graph metrics include stream_name labels." />
      </div>
      <!-- Search input -->
      <div data-test="service-graph-search-input">
        <OInput
          v-model="searchFilter"
          class="tw:w-[14rem]!"
          placeholder="Search Services"
          :debounce="300"
          @update:model-value="applyFilters"
          clearable
        >
          <template #prepend>
            <q-icon class="o2-search-input-icon" size="1rem" name="search" />
          </template>
        </OInput>
      </div>
      <!-- Spacer -->
      <div class="tw:flex-1" />
      <!-- Legends (horizontal) -->
      <div
        data-test="service-graph-legends"
        class="tw:flex tw:flex-row tw:items-center tw:gap-3 tw:p-[0.325rem] tw:rounded tw:border tw:border-[var(--o2-border-color)]!"
      >
        <div
          data-test="sg-legend"
          class="tw:flex tw:flex-row tw:items-center tw:gap-3 tw:min-w-0"
        >
          <!-- Border Color -->
          <div
            class="sg-legend-title tw:mb-0! tw:whitespace-nowrap tw:text-[var(--o2-text-4)]!"
          >
            Border Color
            <span class="sg-legend-subtitle">| Errors</span>
          </div>
          <div class="tw:flex! tw:flex-row tw:gap-2">
            <div
              class="sg-legend-color-item tw:flex-row tw:items-center tw:gap-1.5 tw:flex-none"
            >
              <div class="sg-legend-dot" style="border-color: #52c41a"></div>
              <div class="tw:flex tw:flex-row tw:items-baseline tw:gap-1">
                <div
                  class="sg-legend-color-label tw:text-left tw:text-[var(--o2-text-2)]!"
                >
                  Healthy
                </div>
                <div class="sg-legend-color-value tw:text-left">&lt; 1%</div>
              </div>
            </div>
            <div
              class="sg-legend-color-item tw:flex-row tw:items-center tw:gap-1.5 tw:flex-none"
            >
              <div class="sg-legend-dot" style="border-color: #faad14"></div>
              <div class="tw:flex tw:flex-row tw:items-baseline tw:gap-1">
                <div
                  class="sg-legend-color-label tw:text-left tw:text-[var(--o2-text-2)]!"
                >
                  Degraded
                </div>
                <div class="sg-legend-color-value tw:text-left">1 – 5%</div>
              </div>
            </div>
            <div
              class="sg-legend-color-item tw:flex-row tw:items-center tw:gap-1.5 tw:flex-none"
            >
              <div class="sg-legend-dot" style="border-color: #fa8c16"></div>
              <div class="tw:flex tw:flex-row tw:items-baseline tw:gap-1">
                <div
                  class="sg-legend-color-label tw:text-left tw:text-[var(--o2-text-2)]!"
                >
                  Warning
                </div>
                <div class="sg-legend-color-value tw:text-left">5 – 10%</div>
              </div>
            </div>
            <div
              class="sg-legend-color-item tw:flex-row tw:items-center tw:gap-1.5 tw:flex-none"
            >
              <div class="sg-legend-dot" style="border-color: #f5222d"></div>
              <div class="tw:flex tw:flex-row tw:items-baseline tw:gap-1">
                <div
                  class="sg-legend-color-label tw:text-left tw:text-[var(--o2-text-2)]!"
                >
                  Critical
                </div>
                <div class="sg-legend-color-value tw:text-left">&gt; 10%</div>
              </div>
            </div>
          </div>
        </div>
        <q-separator
          vertical
          v-if="searchObj.meta.serviceGraphVisualizationType === 'graph'"
          class="tw:self-stretch tw:mx-1"
        />
        <div
          v-if="searchObj.meta.serviceGraphVisualizationType === 'graph'"
          data-test="sg-node-size-info"
          class="tw:flex tw:flex-row tw:items-center tw:gap-2 tw:min-w-0"
        >
          <!-- Node Size — Graph View only (Tree View uses fixed sizes) -->
          <div
            class="sg-legend-title tw:mb-0! tw:whitespace-nowrap tw:text-[var(--o2-text-4)]!"
          >
            Node Size
            <span class="sg-legend-subtitle">| Requests</span>
          </div>
          <div class="sg-legend-row sg-legend-sizes tw:py-0!">
            <div
              class="sg-legend-size-item tw:flex-row tw:items-center tw:gap-1.5"
            >
              <div
                class="sg-legend-circle"
                style="width: 16px; height: 16px; border-color: #52c41a"
              ></div>
              <span class="sg-legend-label tw:text-[var(--o2-text-2)]!"
                >Low</span
              >
            </div>
            <div class="sg-legend-size-dots tw:mb-0">···</div>
            <div
              class="sg-legend-size-item tw:flex-row tw:items-center tw:gap-1.5"
            >
              <div
                class="sg-legend-circle"
                style="width: 28px; height: 28px; border-color: #52c41a"
              ></div>
              <span class="sg-legend-label tw:text-[var(--o2-text-2)]!"
                >High</span
              >
            </div>
          </div>
        </div>
      </div>
    </div>
    <q-card-section
      class="tw:p-[0.375rem]! tw:flex-1 tw:min-h-0 card-container service-graph-container"
    >
      <!-- Graph Visualization -->
      <q-card flat bordered class="graph-card tw:h-full">
        <q-card-section class="q-pa-none tw:h-full" style="height: 100%">
          <div
            data-test="service-graph-container"
            class="graph-container tw:h-full tw:bg-[var(--o2-bg)]"
            style="position: relative"
          >
            <div v-if="loading" class="flex flex-center tw:h-full">
              <div class="text-center tw:flex tw:flex-col tw:items-center">
                <OSpinner size="xl" />
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
                <OButton
                  variant="outline"
                  size="sm-action"
                  @click="loadServiceGraph"
                  class="tw:mt-4"
                >
                  <template #icon-left><q-icon name="refresh" size="14px" /></template>
                  Retry
                </OButton>
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
            <div
              v-else
              ref="graphContainerRef"
              class="tw:h-full graph-with-panel-container"
            >
              <ChartRenderer
                ref="chartRendererRef"
                data-test="service-graph-chart"
                :data="chartData"
                :key="chartKey"
                render-type="svg"
                class="tw:h-full"
                @click="handleNodeClick"
              />

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
        </q-card-section>
      </q-card>
    </q-card-section>
  </q-card>

  <!-- Enhanced Settings Dialog -->
  <ODialog data-test="service-graph-settings-dialog"
    v-model:open="showSettings"
    size="sm"
    title="Service Graph Settings"
    secondary-button-label="Close"
    primary-button-label="Reset"
    @click:secondary="showSettings = false"
    @click:primary="resetSettings"
  >
    <div class="q-gutter-md">
      <div class="text-caption text-grey-7">
        Stream-based topology - all data persisted to storage
        <OTooltip content="Service graph uses stream-only architecture with zero in-memory state" />
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
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import serviceGraphService from "@/services/service_graph";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import ServiceGraphSidePanel from "./ServiceGraphNodeSidePanel.vue";
import {
  convertServiceGraphToTree,
  convertServiceGraphToNetwork,
} from "@/utils/traces/convertTraceData";
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
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

export default defineComponent({
  name: "ServiceGraph",
  components: {
    ChartRenderer,
    ServiceGraphSidePanel,
    OButton,
    ODialog,
    OSpinner,
    OTooltip,
    OSelect,
    OInput,
  },
  emits: ["view-traces"],
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

    // Node side panel state
    const selectedNode = ref<any>(null);
    const showSidePanel = ref(false);

    const chartRendererRef = ref<any>(null);
    const graphContainerRef = ref<HTMLElement | null>(null);

    const searchFilter = ref("");

    // Stream filter — synced from traces page selected stream
    const tracesStream = searchObj.data.stream?.selectedStream?.value || "";
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

    // Key to control chart recreation - only change when layout/visualization type changes
    const chartKey = ref(0);

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
          notMerge: false,
          lazyUpdate: true,
          silent: true,
        };
      }

      const newOptions =
        vizType === "tree"
          ? convertServiceGraphToTree(
              filteredGraphData.value,
              layoutType,
              $q.dark.isActive,
            )
          : convertServiceGraphToNetwork(
              filteredGraphData.value,
              layoutType,
              new Map(),
              $q.dark.isActive,
              undefined,
              graphContainerRef.value?.clientWidth || 1200,
              graphContainerRef.value?.clientHeight || 700,
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
        notMerge: vizType === "graph" ? false : true, // Merge for graph, replace for tree
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
      const isDarkInit = $q.dark.isActive;
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

          // Collect node layout positions + names
          for (let i = 0; i < count; i++) {
            const layout = data.getItemLayout(i);
            if (layout) {
              newNodePositions.push({
                idx: i,
                x: layout.x,
                y: layout.y,
                name: data.getName(i),
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
        tooltipEl.style.color = $q.dark.isActive
          ? "rgba(255,255,255,0.88)"
          : "rgba(0,0,0,0.82)";
      };

      const showNodeTooltip = (
        mouseX: number,
        mouseY: number,
        nodeName: string,
      ) => {
        resetToTextTooltip();

        // Always use node-level data for the tooltip — same source as border color
        const nodes = graphData.value?.nodes || [];
        const node = nodes.find((n: any) => (n.label || n.id) === nodeName);
        if (!node) {
          tooltipEl.style.display = "none";
          return;
        }

        const requests = node.requests || 0;
        const errors = node.errors || 0;
        const errRate =
          node.error_rate ?? (requests > 0 ? (errors / requests) * 100 : 0);
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
          showNodeTooltip(e.offsetX, e.offsetY, nearestNode.name);
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
          throw new Error("No organization selected");
        }

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
            baseline_p50_latency_ns: edge.baseline_p50_latency_ns ?? null,
            baseline_p95_latency_ns: edge.baseline_p95_latency_ns ?? null,
            baseline_p99_latency_ns: edge.baseline_p99_latency_ns ?? null,
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

    // Watch composable viz/layout state changes from SearchBar toolbar
    watch(
      () => searchObj.meta.serviceGraphVisualizationType,
      () => {
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
      } else {
        console.log("[ServiceGraph] Click not on a node or edge, ignoring");
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
      // Node side panel
      selectedNode,
      showSidePanel,
      handleNodeClick,
      handleCloseSidePanel,
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

.sg-info-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  transition: transform 0.2s ease;
}

.sg-info-btn:hover {
  transform: scale(1.1);
}

:global(.sg-legend-tooltip),
:global(.sg-legend-tooltip.q-tooltip) {
  padding: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  color: inherit !important;
}

:global(.sg-legend) {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px 16px;
  min-width: 260px;
  color: #374151;
  font-size: 12px;
}

:global(.body--dark .sg-legend) {
  background: #1f2937;
  border-color: #374151;
  color: #e5e7eb;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

:global(.sg-legend-title) {
  font-weight: 700;
  font-size: 12px;
  margin-bottom: 10px;
  color: inherit;
}

:global(.sg-legend-subtitle) {
  font-weight: 400;
  opacity: 0.55;
}

:global(.sg-legend-divider) {
  border-top: 1px solid #e5e7eb;
  margin: 12px 0;
}

:global(.body--dark .sg-legend-divider) {
  border-color: #374151;
}

:global(.sg-legend-sizes) {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0 6px;
}

:global(.sg-legend-size-item) {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

:global(.sg-legend-circle) {
  border-radius: 50%;
  border-width: 2px;
  border-style: solid;
  background: transparent;
  flex-shrink: 0;
}

:global(.sg-legend-size-dots) {
  opacity: 0.35;
  font-size: 16px;
  letter-spacing: 2px;
}

:global(.sg-legend-label) {
  font-size: 11px;
}

:global(.sg-legend-color-row) {
  display: flex;
  gap: 12px;
}

:global(.sg-legend-color-item) {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex: none;
}

:global(.sg-legend-dot) {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border-width: 2px;
  border-style: solid;
  background: transparent;
}

:global(.sg-legend-color-label) {
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  color: inherit;
}

:global(.sg-legend-color-value) {
  font-size: 10px;
  opacity: 0.55;
  text-align: center;
}

:global(.sg-legend--floating) {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  min-width: unset;
  padding: 10px 16px;
}

:global(.sg-legend--floating .sg-legend-title) {
  margin-bottom: 0;
  white-space: nowrap;
}

:global(.sg-legend--floating .sg-legend-color-row) {
  gap: 16px;
}

:global(.sg-legend--floating .sg-legend-color-item) {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex: unset;
}

:global(.sg-legend--floating .sg-legend-color-item > div) {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 4px;
}

:global(.sg-legend--floating .sg-legend-color-label),
:global(.sg-legend--floating .sg-legend-color-value) {
  text-align: left;
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
  overflow: hidden;
}

code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: "Courier New", monospace;
  font-size: 0.9em;
}
</style>

<!-- Flowing edge animation — non-scoped so it reaches inside ECharts SVG output -->
<style lang="scss">
@keyframes sg-edge-flow {
  from {
    stroke-dashoffset: 14;
  }
  to {
    stroke-dashoffset: 0;
  }
}

/*
 * Target dashed edge paths rendered by ECharts graph series.
 * ECharts SVG mode may set stroke-dasharray as an HTML attribute OR inside
 * an inline style depending on the version — we cover both.
 */
.graph-container svg path[stroke-dasharray],
.graph-container svg path[style*="stroke-dasharray"] {
  animation: sg-edge-flow 0.5s linear infinite;
  animation-fill-mode: both;
}

.body--dark [data-test="service-graph-stream-selector"] .q-field,
.body--dark [data-test="service-graph-search-input"] .q-field {
  background: var(--o2-primary-background);
}
</style>
