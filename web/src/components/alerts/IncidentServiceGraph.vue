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
    class="incident-service-graph relative h-[calc(100vh-12.625rem)] min-h-100 flex flex-col m-3 p-5 rounded-default overflow-hidden transition-all duration-200 bg-[linear-gradient(135deg,#f9fafb_0%,#ffffff_100%)] border border-border-default shadow-[0_1px_3px_0_rgba(0,0,0,0.08),0_1px_2px_0_rgba(0,0,0,0.04),inset_0_0_0_1px_rgba(255,255,255,0.5)] hover:shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06),inset_0_0_0_1px_rgba(255,255,255,0.5)] dark:bg-[linear-gradient(135deg,var(--color-grey-800)_0%,var(--color-grey-900)_100%)] dark:border-grey-700 dark:shadow-[0_1px_3px_0_color-mix(in_srgb,var(--color-black)_30%,transparent),0_1px_2px_0_color-mix(in_srgb,var(--color-black)_20%,transparent),inset_0_0_0_1px_color-mix(in_srgb,var(--color-grey-700)_30%,transparent)] dark:hover:shadow-[0_4px_6px_-1px_color-mix(in_srgb,var(--color-black)_40%,transparent),0_2px_4px_-1px_color-mix(in_srgb,var(--color-black)_30%,transparent),inset_0_0_0_1px_color-mix(in_srgb,var(--color-grey-700)_30%,transparent)]"
  >
    <!-- Info Icon → Graph Legend popover (hover to show) -->
    <span
      v-if="!loading && graphData && graphData.nodes && graphData.nodes.length > 0"
      class="info-icon-btn group absolute top-4 right-4 z-10"
    >
      <OButton variant="ghost" size="icon-circle-sm">
        <OIcon name="info-outline" size="sm" />
      </OButton>
      <div
        class="graph-legend absolute top-[calc(100%+8px)] right-0 min-w-60 py-3.5 px-4 text-compact leading-normal text-text-body bg-surface-overlay border border-border-default rounded-default shadow-[0_10px_20px_rgba(0,0,0,0.12),0_3px_6px_rgba(0,0,0,0.06)] opacity-0 invisible -translate-y-1 transition-all duration-150 pointer-events-none whitespace-nowrap group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:pointer-events-auto dark:text-grey-200 dark:bg-grey-800 dark:border-[color-mix(in_srgb,var(--color-white)_12%,transparent)] dark:shadow-[0_10px_20px_color-mix(in_srgb,var(--color-black)_60%,transparent),0_3px_6px_color-mix(in_srgb,var(--color-black)_40%,transparent)]"
        role="tooltip"
      >
        <div class="font-semibold text-sm mb-2.5">Graph Legend</div>
        <div class="graph-legend__row flex items-center gap-2 py-1">
          <span class="graph-legend__dot text-sm leading-none w-3.5 text-center shrink-0 text-status-negative">●</span>
          Red = Potential Root Cause
        </div>
        <div class="graph-legend__row flex items-center gap-2 py-1">
          <span class="graph-legend__dot text-sm leading-none w-3.5 text-center shrink-0 text-status-warning-text">●</span>
          Orange = High Frequency
        </div>
        <div class="graph-legend__row flex items-center gap-2 py-1">
          <span class="graph-legend__dot text-sm leading-none w-3.5 text-center shrink-0 text-text-link">●</span>
          Blue = Normal
        </div>
        <div class="graph-legend__divider h-px bg-border-default my-2 dark:bg-[color-mix(in_srgb,var(--color-white)_15%,transparent)]" />
        <div class="graph-legend__row flex items-center gap-2 py-1">
          <span class="graph-legend__dot text-sm leading-none w-3.5 text-center shrink-0 text-badge-purple-ol-text">→</span>
          Purple arrows show temporal flow
        </div>
      </div>
    </span>

    <!-- Loading State -->
    <div
      v-if="loading"
      class="flex items-center justify-center h-full bg-surface-base/50"
    >
      <OSpinner size="md" />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!graphData || !graphData.nodes || graphData.nodes.length === 0"
      class="flex flex-col items-center justify-center gap-3 h-full"
    >
      <!-- size-12! (48px) exceeds OIcon's largest `size` prop (xl = 40px); the `!`
           is required because OIcon's own `size-6` default sits in the same layer. -->
      <OIcon name="hub" class="text-text-muted size-12!" />
      <div class="text-center">
        <div class="text-sm font-medium text-text-secondary">
          Service Graph Unavailable
        </div>
        <div class="text-xs mt-1 text-text-secondary">
          No topology data available for this incident.
        </div>
      </div>
    </div>

    <!-- Graph Canvas using ECharts -->
    <div
      v-if="!loading && graphData && graphData.nodes && graphData.nodes.length > 0"
      class="w-full h-full"
    >
      <ChartRenderer
        ref="chartRendererRef"
        :data="chartData"
        :key="chartKey"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY } from "d3-force";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { AlertNode } from "@/services/incidents";
import DropzoneBackground from "@/plugins/pipelines/DropzoneBackground.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "IncidentServiceGraph",
  components: {
    ChartRenderer,
    DropzoneBackground,
    OButton,
    OSpinner,
    OIcon,
},
  props: {
    topologyContext: {
      type: Object as () => { nodes: AlertNode[]; edges: any[] } | null,
      required: false,
      default: null,
    },
  },
  setup(props) {
    const store = useStore();

    const loading = ref(false);
    const chartRendererRef = ref<any>(null);
    const chartKey = ref(0);
    const nodePositions = ref<Map<string, { x: number; y: number }>>(new Map());

    const { isDark: isDarkMode } = useTheme();

    // Use topology_context directly from props
    const graphData = computed(() => props.topologyContext);

    // D3-Force simulation to compute stable node positions with left-to-right layout
    const computeForceLayout = (nodes: any[], edges: any[], width = 800, height = 600) => {
      const nodesCopy = nodes.map(n => ({ ...n }));
      const edgesCopy = edges.map(e => ({
        source: e.source,
        target: e.target,
        ...e,
      }));

      // Calculate depth/level for each node (for left-to-right positioning)
      const nodeDepth = new Map<string, number>();
      nodesCopy.forEach(n => nodeDepth.set(n.id, 0));

      // Build adjacency list from temporal edges to determine hierarchy
      const temporalEdges = edgesCopy.filter(e => e.originalEdge?.edge_type === 'temporal');
      const visited = new Set<string>();

      // BFS to calculate depth
      const queue: Array<{ id: string; depth: number }> = [];

      // Find root nodes (nodes with no incoming temporal edges)
      const hasIncoming = new Set(temporalEdges.map(e => typeof e.target === 'string' ? e.target : e.target.id));
      nodesCopy.forEach(n => {
        if (!hasIncoming.has(n.id)) {
          queue.push({ id: n.id, depth: 0 });
        }
      });

      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        nodeDepth.set(id, depth);

        // Find outgoing temporal edges
        temporalEdges.forEach(edge => {
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          if (sourceId === id) {
            queue.push({ id: targetId, depth: depth + 1 });
          }
        });
      }

      const simulation = forceSimulation(nodesCopy)
        .force('charge', forceManyBody().strength(-400).distanceMax(1200))
        .force('link', forceLink(edgesCopy)
          .id((d: any) => d.id)
          .distance(180)
          .strength(0.5)
          .iterations(2)
        )
        .force('x', forceX((d: any) => {
          // Position nodes left-to-right based on their temporal-edge depth.
          const depth = nodeDepth.get(d.id) || 0;
          const maxDepth = Math.max(...Array.from(nodeDepth.values()));
          const leftMargin = 80; // Left margin to prevent nodes from touching the edge
          const rightMargin = 80; // Right margin
          const availableWidth = width - leftMargin - rightMargin;
          const spacing = maxDepth > 0 ? availableWidth / maxDepth : 0;
          return leftMargin + spacing * depth;
        }).strength(1.5)) // Strong horizontal positioning
        .force('y', forceY(() => {
          return height / 2;
        }).strength((d: any) => {
          // Stronger centering for root nodes (depth 0).
          const depth = nodeDepth.get(d.id) || 0;
          return depth === 0 ? 0.8 : 0.1;
        }))
        .force('collision', forceCollide()
          .radius((d: any) => (d.symbolSize || 60) / 2 + 50)
          .strength(1.0)
          .iterations(3)
        )
        .velocityDecay(0.4)
        .stop();

      // Run simulation for 5000 iterations to stabilize
      for (let i = 0; i < 5000; i++) {
        simulation.tick();
      }

      return simulation.nodes().map(n => ({ ...n }));
    };

    // Data comes from props.
    const loadGraph = () => {
      // Increment chartKey to force re-render if topology_context changes
      chartKey.value++;
    };

    const getNodeColor = (node: AlertNode, index: number): string => {
      // First node (chronologically first alert) is highlighted as potential root cause
      if (index === 0) {
        return "#ef4444"; // red-500 - first alert
      }
      if (node.alert_count > 5) {
        return "#f97316"; // orange-500 - high frequency
      }
      return "#3b82f6"; // blue-500 - normal
    };

    const getNodeSize = (node: AlertNode, nodes: AlertNode[], maxSize = 120): number => {
      // Scale node size based on alert_count relative to the max count in the dataset
      const minSize = 30;
      const maxCount = Math.max(...nodes.map(n => n.alert_count || 0), 1);
      if (maxCount === 0) return minSize;
      const ratio = (node.alert_count || 0) / maxCount;
      return Math.round(minSize + ratio * (maxSize - minSize));
    };

    // Above this raw-node count the graph is bucketed by time to stay legible;
    // at or below it every firing is shown 1:1. The force layout blobs past ~15 nodes.
    const NODE_CAP = 15;
    // Pick the smallest time unit that yields no more than this many windows.
    const BUCKET_TARGET_MAX = 24;
    // Bucket-unit ladder in microseconds (backend timestamps are microseconds).
    const US = 1000; // microseconds per millisecond
    const BUCKET_UNITS_US = [
      60 * US * 1000,            // 1 minute
      5 * 60 * US * 1000,        // 5 minutes
      15 * 60 * US * 1000,       // 15 minutes
      60 * 60 * US * 1000,       // 1 hour
      6 * 60 * 60 * US * 1000,   // 6 hours
      24 * 60 * 60 * US * 1000,  // 1 day
      7 * 24 * 60 * 60 * US * 1000, // 7 days
    ];

    // Format a bucket window start (microseconds) for the node label, using a
    // time-of-day form for sub-day units and a date for day+ units.
    const formatWindow = (startUs: number, unitUs: number): string => {
      const d = new Date(startUs / 1000);
      if (unitUs >= 24 * 60 * 60 * US * 1000) {
        return d.toLocaleDateString();
      }
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };

    /**
     * Collapse many alert firings into time-window buckets, keyed by
     * (window x alert_name) so distinct alerts never merge. With a single alert
     * name (the common case) this degrades to one node per non-empty window —
     * a pure left-to-right timeline. Edges are rebuilt by collapsing the
     * backend's raw edges onto the buckets, so both within-alert sequences AND
     * cross-alert temporal correlations are preserved.
     */
    const bucketFiringsByTime = (
      rawNodes: any[],
      rawEdges: any[],
    ): { nodes: any[]; edges: any[] } => {
      const times = rawNodes.map((n) => n.first_fired_at);
      const minTime = Math.min(...times);
      const maxTime = Math.max(...rawNodes.map((n) => n.last_fired_at));
      const span = Math.max(maxTime - minTime, 1);

      // Choose the smallest ladder unit whose window count fits the target. For
      // spans so long even the largest ladder unit exceeds the target, derive a
      // custom unit so the window count is ALWAYS capped at BUCKET_TARGET_MAX.
      const unitUs =
        BUCKET_UNITS_US.find((u) => Math.ceil(span / u) <= BUCKET_TARGET_MAX) ??
        Math.ceil(span / BUCKET_TARGET_MAX);

      const buckets = new Map<string, {
        alert_id: string;
        alert_name: string;
        service_name: string;
        alert_count: number;
        first_fired_at: number;
        last_fired_at: number;
        windowStart: number;
        serviceCounts: Map<string, number>;
      }>();

      // Track which bucket key each raw node index falls into, for edge rebuild.
      const rawIdxToKey = new Map<number, string>();

      rawNodes.forEach((node, rawIdx) => {
        const windowIdx = Math.floor((node.first_fired_at - minTime) / unitUs);
        const name = node.alert_name || "unknown";
        const key = `${windowIdx}|${name}`;
        rawIdxToKey.set(rawIdx, key);
        if (!buckets.has(key)) {
          buckets.set(key, {
            alert_id: node.alert_id,
            alert_name: name,
            service_name: node.service_name,
            alert_count: 0,
            first_fired_at: node.first_fired_at,
            last_fired_at: node.last_fired_at,
            windowStart: minTime + windowIdx * unitUs,
            serviceCounts: new Map(),
          });
        }
        const b = buckets.get(key)!;
        b.alert_count += node.alert_count;
        if (node.first_fired_at < b.first_fired_at) b.first_fired_at = node.first_fired_at;
        if (node.last_fired_at > b.last_fired_at) b.last_fired_at = node.last_fired_at;
        const svc = node.service_name || "";
        b.serviceCounts.set(svc, (b.serviceCounts.get(svc) || 0) + 1);
      });

      // Materialize bucket nodes, sorted chronologically. Each node keeps its
      // bucket `key` so the raw edges can be remapped onto buckets below. The
      // force layout positions them by temporal depth, so no explicit
      // coordinates are needed here.
      const nodes = Array.from(buckets.entries())
        .map(([key, b]) => {
          let bestSvc = b.service_name;
          let bestCount = 0;
          b.serviceCounts.forEach((count, svc) => {
            if (count > bestCount) {
              bestCount = count;
              bestSvc = svc;
            }
          });
          return {
            key,
            alert_id: b.alert_id,
            alert_name: b.alert_name,
            service_name: bestSvc,
            alert_count: b.alert_count,
            first_fired_at: b.first_fired_at,
            last_fired_at: b.last_fired_at,
            // Label shows name + count + window, e.g. "go_gc_rate_high x42 14:05"
            display_label: `${b.alert_name} x${b.alert_count} ${formatWindow(b.windowStart, unitUs)}`,
          };
        })
        .sort((a, b) => a.first_fired_at - b.first_fired_at);

      // Map each bucket key to its final (post-sort) node index.
      const keyToIdx = new Map<string, number>();
      nodes.forEach((n, idx) => keyToIdx.set(n.key, idx));

      // Rebuild edges by collapsing the backend's raw edges onto buckets. This
      // preserves both within-alert sequences and cross-alert correlations.
      // Drop self-loops (both endpoints in the same bucket) and de-duplicate.
      const seen = new Set<string>();
      const edges: any[] = [];
      for (const e of rawEdges) {
        const srcKey = rawIdxToKey.get(e.from_node_index);
        const tgtKey = rawIdxToKey.get(e.to_node_index);
        if (srcKey === undefined || tgtKey === undefined) continue;
        const srcIdx = keyToIdx.get(srcKey);
        const tgtIdx = keyToIdx.get(tgtKey);
        if (srcIdx === undefined || tgtIdx === undefined) continue;
        if (srcIdx === tgtIdx) continue; // self-loop within one bucket
        const dedupe = `${srcIdx}->${tgtIdx}|${e.edge_type}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        edges.push({ from_node_index: srcIdx, to_node_index: tgtIdx, edge_type: e.edge_type });
      }

      return { nodes, edges };
    };

    const chartData = computed(() => {
      if (!graphData.value || !graphData.value.nodes || graphData.value.nodes.length === 0) {
        return { options: {}, notMerge: true };
      }

      const { nodes: rawNodes, edges: rawEdges } = graphData.value;

      // Adaptive node construction:
      //  - Detail mode (<= NODE_CAP firings): render each firing 1:1 with the
      //    backend's edges, preserving the clean left-to-right timeline.
      //  - Bucketed mode (> NODE_CAP): collapse firings into time-window x name
      //    buckets so the graph stays legible at high alert counts.
      let nodes: any[];
      let edges: any[];
      if (rawNodes.length > NODE_CAP) {
        const bucketed = bucketFiringsByTime(rawNodes, rawEdges);
        nodes = bucketed.nodes;
        edges = bucketed.edges;
      } else {
        nodes = rawNodes;
        // Backend edges are index-based into the raw node array; in detail mode
        // the node array IS the raw array, so indices are used directly.
        edges = rawEdges;
      }

      // Prepare nodes for D3-force simulation. Bucketed nodes carry a
      // display_label (name + count + window); detail nodes show the alert name.
      // Bucketed nodes use a uniform size so the timeline reads as evenly-spaced
      // circles (like the detail/main layout) rather than lumpy count-scaled blobs.
      const bucketed = rawNodes.length > NODE_CAP;
      const preparedNodes = nodes.map((node, index) => ({
        name: node.display_label || node.alert_name,
        id: index.toString(),
        symbolSize: bucketed ? 60 : getNodeSize(node, nodes),
        originalNode: node,
        originalIndex: index,
      }));

      // Prepare edges for D3-force simulation
      const preparedEdges = edges.map((edge) => ({
        source: edge.from_node_index.toString(),
        target: edge.to_node_index.toString(),
        originalEdge: edge,
      }));

      // Compute force-directed layout positions using D3 with left-to-right layout
      // Only compute if we don't have cached positions for these nodes
      let positionedNodes;
      const hasAllPositions = preparedNodes.every(n => nodePositions.value.has(n.id));

      if (hasAllPositions) {
        // Use cached positions
        positionedNodes = preparedNodes.map(n => ({
          ...n,
          x: nodePositions.value.get(n.id)!.x,
          y: nodePositions.value.get(n.id)!.y,
        }));
      } else {
        // Both modes use the same force-directed layout (main's algorithm),
        // which positions nodes left-to-right by temporal depth and lets the
        // charge/collision forces fan them into an organic vertical wave that
        // fills the canvas. Bucketing already caps the node count (~24), so the
        // simulation stays in the regime where it reads cleanly.
        positionedNodes = computeForceLayout(preparedNodes, preparedEdges, 1200, 400);
        positionedNodes.forEach((node: any) => {
          nodePositions.value.set(node.id, { x: node.x, y: node.y });
        });
      }

      // Convert to ECharts graph format with computed fixed positions
      const echartsNodes = positionedNodes.map((node: any) => {
        const originalNode = node.originalNode;
        const index = node.originalIndex;

        return {
          name: node.name,
          id: node.id,
          x: node.x,
          y: node.y,
          fixed: true, // Lock position so ECharts doesn't re-layout
          symbolSize: node.symbolSize,
          originalNode: node.originalNode,
          itemStyle: {
            color: getNodeColor(originalNode, index),
            borderColor: index === 0 ? "#dc2626" : getNodeColor(originalNode, index),
            borderWidth: index === 0 ? 4 : 2,
          },
          label: {
            show: true,
            position: "bottom",
            distance: 5,
            fontSize: 11,
            fontWeight: 500,
            color: isDarkMode.value ? "#e5e7eb" : "#374151",
            formatter: `{b}`,
            backgroundColor: isDarkMode.value ? "rgba(31, 41, 55, 0.85)" : "rgba(255, 255, 255, 0.9)",
            borderRadius: 4,
            padding: [3, 7],
            borderColor: isDarkMode.value ? "#4b5563" : "#e5e7eb",
            borderWidth: 1,
          },
          emphasis: {
            label: {
              show: true,
              position: "bottom",
              distance: 5,
              fontSize: 11,
              fontWeight: 600,
              color: isDarkMode.value ? "#e5e7eb" : "#374151",
              formatter: `{b}`,
              backgroundColor: isDarkMode.value ? "rgba(31, 41, 55, 0.95)" : "rgba(255, 255, 255, 1)",
              borderRadius: 4,
              padding: [3, 7],
              borderColor: isDarkMode.value ? "#6b7280" : "#d1d5db",
              borderWidth: 1,
            },
          },
          tooltip: {
            formatter: () => {
              const firstTime = new Date(originalNode.first_fired_at / 1000).toLocaleString();
              const lastTime = originalNode.alert_count > 1 ? new Date(originalNode.last_fired_at / 1000).toLocaleString() : null;

              let html = `<div style="padding: 0.5rem; font-size: var(--text-xs);">`;
              html += `<strong style="font-size: var(--text-sm);">${originalNode.alert_name}</strong><br/>`;
              html += `Service: <strong>${originalNode.service_name}</strong><br/><br/>`;
              html += `Alert Count: <strong>${originalNode.alert_count}</strong><br/>`;
              html += `First Fired: ${firstTime}<br/>`;
              if (lastTime) {
                html += `Last Fired: ${lastTime}<br/>`;
              }
              if (index === 0) {
                html += `<br/><span style="color: var(--color-status-negative);">⚠ First Alert (Potential Root Cause)</span>`;
              }
              html += `</div>`;
              return html;
            },
          },
        };
      });

      const echartsEdges = edges.map((edge) => {
        const sourceNode = nodes[edge.from_node_index];
        const targetNode = nodes[edge.to_node_index];

        return {
          source: edge.from_node_index.toString(),
          target: edge.to_node_index.toString(),
          lineStyle: {
            color: edge.edge_type === "temporal"
              ? (isDarkMode.value ? "#a78bfa" : "#8b5cf6") // purple for temporal
              : (isDarkMode.value ? "#6b7280" : "#9ca3af"), // gray for service dependency
            width: edge.edge_type === "temporal" ? 3 : 2,
            curveness: 0.2,
            type: "solid",
          },
          symbol: ["none", "arrow"],
          symbolSize: [0, 10],
          label: {
            show: false, // Hide edge labels for cleaner visualization
          },
          tooltip: {
            formatter: () => {
              let html = `<div style="padding: 0.5rem; font-size: var(--text-xs); text-align: center;">`;
              html += `<strong>${sourceNode.alert_name}</strong> <span style="color: var(--color-badge-purple-ol-text);">→</span> <strong>${targetNode.alert_name}</strong><br/><br/>`;

              if (edge.edge_type === "temporal") {
                const sourceTime = new Date(sourceNode.first_fired_at / 1000);
                const targetTime = new Date(targetNode.first_fired_at / 1000);
                const timeDiff = Math.abs(targetTime.getTime() - sourceTime.getTime());

                // Format time difference
                const seconds = Math.floor(timeDiff / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);

                let timeStr = "";
                if (days > 0) timeStr = `${days}d ${hours % 24}h`;
                else if (hours > 0) timeStr = `${hours}h ${minutes % 60}m`;
                else if (minutes > 0) timeStr = `${minutes}m ${seconds % 60}s`;
                else timeStr = `${seconds}s`;

                html += `<span style="color: var(--color-badge-purple-ol-text);">⏱ Time difference: <strong>${timeStr}</strong></span><br/>`;
                html += `From: ${sourceTime.toLocaleString()}<br/>`;
                html += `To: ${targetTime.toLocaleString()}<br/>`;
                html += `<br/><span style="color: var(--color-badge-purple-ol-text);">Temporal correlation</span>`;
              } else {
                html += `<span style="color: var(--color-text-muted);">Service dependency</span>`;
              }

              html += `</div>`;
              return html;
            },
          },
        };
      });

      const options = {
        tooltip: {
          trigger: "item",
          backgroundColor: isDarkMode.value ? "#1f2937" : "#ffffff",
          borderColor: isDarkMode.value ? "#374151" : "#e5e7eb",
          textStyle: {
            color: isDarkMode.value ? "#e5e7eb" : "#374151",
          },
        },
        animation: false, // Disable animation since we have pre-computed positions
        series: [
          {
            type: "graph",
            layout: "none", // Use none since we pre-computed positions with D3
            roam: true,
            draggable: true,
            focusNodeAdjacency: true,
            scaleLimit: {
              min: 0.4,
              max: 3,
            },
            data: echartsNodes,
            links: echartsEdges,
            emphasis: {
              focus: "adjacency",
              lineStyle: {
                width: 4,
              },
            },
            lineStyle: {
              opacity: 0.7,
            },
          },
        ],
      };

      return { options, notMerge: !hasAllPositions }; // Merge when using cached positions
    });

    // Watch for topology_context changes
    watch(
      () => props.topologyContext,
      () => {
        // Clear cached positions when topology changes
        nodePositions.value.clear();
        loadGraph();
      },
      { deep: true }
    );

    return {
      loading,
      graphData,
      chartRendererRef,
      chartData,
      chartKey,
      isDarkMode,
      loadGraph,
    };
  },
});
</script>
