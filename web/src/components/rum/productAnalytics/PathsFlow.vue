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
    class="h-[28rem] w-full overflow-x-auto"
    role="img"
    :aria-label="flowAria"
    data-test="rum-analytics-paths-flow"
  >
    <div class="h-full min-w-[48rem]">
      <!-- ChartRenderer, not PanelSchemaRenderer: a branch click must reach this view to open its sessions. -->
      <ChartRenderer :data="chartData" class="h-full w-full" @click="onClick" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import { chartColor, invalidateChartTheme } from "@/utils/chartTheme";
import {
  pathKeyLabel,
  sankeyLabel,
  sankeyTooltip,
  type NamedEvent,
  type PathFlow,
  type PathLink,
  type PathNode,
  type PathNodeKind,
} from "@/utils/rum/productAnalyticsModel";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

export interface FlowSelection {
  type: "node" | "link" | "other" | "exit";
  depth: number;
  key: string | null;
  parentKey: string | null;
}

const DIMMED = 0.3;
const LINK_OPACITY = 0.45;

const props = withDefaults(
  defineProps<{
    flow: PathFlow;
    seriesId: string;
    selected: string | null;
    direction: "next" | "prev";
    events?: NamedEvent[];
  }>(),
  { events: () => [] },
);
const emit = defineEmits<{ select: [FlowSelection] }>();
const store = useStore();
const { t } = useI18nTyped();

// The chart is pointer-only, so its name points keyboard and screen-reader users at the Top paths table.
const flowAria = computed(() => {
  const anchor = props.flow.nodes.find((n) => n.depth === 0);
  return t("rum.analytics.pathsView.flowAria", {
    anchor: raw(anchor ? pathKeyLabel(anchor, props.events) : ""),
  });
});

const palette = computed(() => {
  // Reading the theme ties the resolved token colours to it, so a theme switch repaints the chart.
  void store.state.theme;
  invalidateChartTheme();
  const kind: Record<PathNodeKind, string> = {
    p: chartColor("--color-chart-series-1"),
    c: chartColor("--color-chart-series-3"),
    e: chartColor("--color-chart-series-5"),
    other: chartColor("--color-border-strong"),
    exit: chartColor("--color-text-secondary"),
    start: chartColor("--color-text-secondary"),
  };
  return { kind, text: chartColor("--color-text-body"), halo: chartColor("--color-surface-base") };
});

const maxDepth = computed(() => Math.max(0, ...props.flow.nodes.map((n) => n.depth)));

const byName = computed(() => new Map(props.flow.nodes.map((n) => [n.name, n])));

const chartData = computed(() => {
  const colors = palette.value;
  const reverse = props.direction === "prev";
  return {
    options: {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        confine: true,
        formatter: (p: { dataType: "node" | "edge"; data: PathNode | PathLink }) =>
          sankeyTooltip(p, props.events),
      },
      series: [
        {
          id: props.seriesId,
          type: "sankey",
          left: 8,
          right: 180,
          top: 8,
          bottom: 8,
          nodeGap: 10,
          nodeWidth: 10,
          layoutIterations: 0,
          draggable: false,
          emphasis: { focus: "adjacency" },
          label: {
            color: colors.text,
            textBorderColor: colors.halo,
            textBorderWidth: 3,
            fontSize: 11,
          },
          data: props.flow.nodes.map((n) => ({
            ...n,
            depth: reverse ? maxDepth.value - n.depth : n.depth,
            itemStyle: { color: colors.kind[n.kind], borderColor: colors.kind[n.kind] },
            label: { formatter: () => sankeyLabel(n, props.events) },
          })),
          links: props.flow.links.map((l) => ({
            ...l,
            source: reverse ? l.target : l.source,
            target: reverse ? l.source : l.target,
            lineStyle: {
              color: colors.kind[byName.value.get(l.target)?.kind ?? "other"],
              opacity:
                props.selected && props.selected !== `${l.source}->${l.target}`
                  ? DIMMED * LINK_OPACITY
                  : LINK_OPACITY,
            },
          })),
        },
      ],
    },
  };
});

const selectionFor = (targetName: string, sourceName: string | null): FlowSelection | null => {
  const target = byName.value.get(targetName);
  if (!target || target.depth === 0) return null;
  const parent = sourceName ? byName.value.get(sourceName) : null;
  const parentKey = parent && parent.depth > 0 ? parent.key : null;
  if (target.kind === "other") return { type: "other", depth: target.depth, key: null, parentKey };
  if (target.kind === "exit" || target.kind === "start")
    return { type: "exit", depth: target.depth, key: null, parentKey };
  return { type: sourceName ? "link" : "node", depth: target.depth, key: target.key, parentKey };
};

const onClick = (params: {
  dataType?: string;
  data?: { name?: string; source?: string; target?: string };
}) => {
  const reverse = props.direction === "prev";
  if (params.dataType === "node" && params.data?.name) {
    const sel = selectionFor(params.data.name, null);
    if (sel) emit("select", sel);
  } else if (params.dataType === "edge" && params.data?.source && params.data.target) {
    const child = reverse ? params.data.source : params.data.target;
    const parent = reverse ? params.data.target : params.data.source;
    const sel = selectionFor(child, parent);
    if (sel) emit("select", sel);
  }
};
</script>
