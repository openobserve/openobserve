<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="bg-surface-panel rounded-default border-border-default border p-2">
    <div v-if="!hasData" class="text-text-secondary flex h-40 items-center justify-center text-sm">
      {{ emptyLabel }}
    </div>

    <div
      v-else
      class="bg-theme-body-bg-secondary rounded-default border-border-default border p-1.5"
    >
      <div class="mb-1 flex items-center">
        <span
          class="border-border-default bg-surface-page text-text-secondary rounded-default inline-flex items-center px-2 py-1 text-xs"
        >
          {{ summaryLabel }}: {{ summaryValue }} ({{ unitLabel }})
        </span>
      </div>

      <div class="overflow-auto">
        <!-- eslint-disable-next-line local/no-hardcoded-px -- echarts custom series lays out in canvas device pixels -->
        <div :style="{ height: `${chartHeight}px`, minWidth: '100%' }">
          <ChartRenderer v-if="hasData" :data="chartData" class="h-full w-full" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type {
  CustomSeriesOption,
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemParams,
  EChartsOption,
} from "echarts";
import { escapeHtml } from "@/utils/html";
import { cssToken } from "@/utils/theme";

export interface FlameGraphNode {
  name: string;
  total: number;
  self?: number;
  children?: FlameGraphNode[];
}

type FlameBlock = {
  id: string;
  name: string;
  depth: number;
  left: number;
  width: number;
  total: number;
  self: number;
  fill: string;
  textColor: string;
};
type FlameSeriesDatum = {
  value: [number, number, number, number];
  itemStyle: {
    color: string;
    borderColor: string;
    borderWidth: number;
  };
  emphasis: {
    itemStyle: {
      borderColor: string;
      borderWidth: number;
    };
  };
  block: FlameBlock;
};

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = withDefaults(
  defineProps<{
    root?: FlameGraphNode | null;
    summaryLabel: string;
    summaryValue: string;
    unitLabel: string;
    emptyLabel?: string;
    valueFormatter?: (value: number) => string;
  }>(),
  {
    root: null,
    emptyLabel: "No flame graph data",
    valueFormatter: (value: number) => value.toLocaleString(),
  },
);

const BLOCK_HEIGHT = 24;
const BLOCK_PADDING = 2;

const tokenColor = (token: string, fallbackToken: string) =>
  cssToken(token, cssToken(fallbackToken, ""));

const palette = [
  tokenColor("--color-primary-400", "--color-accent"),
  tokenColor("--color-accent", "--color-primary-500"),
  tokenColor("--color-series-b", "--color-warning-500"),
  tokenColor("--color-success-500", "--color-primary-400"),
  tokenColor("--color-warning-500", "--color-series-b"),
  tokenColor("--color-indigo-400", "--color-primary-400"),
  tokenColor("--color-emerald-400", "--color-success-500"),
  tokenColor("--color-amber-400", "--color-warning-500"),
];

const textColor = tokenColor("--color-text-body", "--color-text-inverse");
const borderColor = tokenColor("--color-border-default", "--color-border-strong");

const hasData = computed(() => !!props.root && (props.root.total || 0) > 0);

const collectBlocks = (root: FlameGraphNode | null): FlameBlock[] => {
  if (!root || (root.total || 0) <= 0) return [];
  const blocks: FlameBlock[] = [];

  const colorFor = (name: string, depth: number) => {
    if (depth === 0) return tokenColor("--color-accent", "--color-primary-500");
    let hash = 0;
    for (let index = 0; index < name.length; index += 1) {
      hash = (hash << 5) - hash + name.charCodeAt(index);
      hash |= 0;
    }
    return palette[Math.abs(hash) % palette.length];
  };

  const walk = (
    node: FlameGraphNode,
    depth: number,
    left: number,
    width: number,
    parentTotal: number,
    path: string,
  ) => {
    const self =
      node.self ??
      Math.max(0, node.total - (node.children ?? []).reduce((sum, child) => sum + child.total, 0));
    blocks.push({
      id: path,
      name: node.name,
      depth,
      left,
      width,
      total: node.total,
      self,
      fill: colorFor(node.name, depth),
      textColor,
    });
    if (!node.children?.length || parentTotal <= 0) return;
    const children = [...node.children].sort((a, b) => b.total - a.total);
    let offset = left;
    for (const [index, child] of children.entries()) {
      const childWidth = width * (child.total / parentTotal);
      if (childWidth <= 0.1) {
        offset += childWidth;
        continue;
      }
      walk(child, depth + 1, offset, childWidth, child.total, `${path}/${index}`);
      offset += childWidth;
    }
  };

  walk(root, 0, 0, 100, root.total, "root");
  return blocks;
};

const blocks = computed(() => collectBlocks(props.root));
const maxDepth = computed(() => blocks.value.reduce((max, block) => Math.max(max, block.depth), 0));
const chartHeight = computed(() => (maxDepth.value + 1) * (BLOCK_HEIGHT + BLOCK_PADDING) + 20);

const chartData = computed(() => {
  const data: FlameSeriesDatum[] = blocks.value.map((block) => ({
    value: [block.left, block.depth, block.width, block.total],
    itemStyle: {
      color: block.fill,
      borderColor,
      borderWidth: 1,
    },
    emphasis: {
      itemStyle: {
        borderColor: tokenColor("--color-primary-500", "--color-accent"),
        borderWidth: 2,
      },
    },
    block,
  }));

  return {
    options: {
      animation: false,
      tooltip: {
        trigger: "item",
        backgroundColor: tokenColor("--color-surface-base", "--color-surface-panel"),
        borderColor: tokenColor("--color-border-default", "--color-border-strong"),
        textStyle: { color: tokenColor("--color-text-body", "--color-text-inverse") },
        extraCssText: "max-width: 28rem; white-space: normal; word-break: break-word;",
        formatter: (params) => {
          const block = (params as unknown as { data: { block: FlameBlock } }).data.block;
          return `
            <div style="padding: 0.25rem 0;">
              <div style="font-weight: 600; margin-bottom: 0.25rem;">${escapeHtml(block.name)}</div>
              <div style="font-size: 0.75rem; line-height: 1.5;">
                <div style="display:flex; justify-content:space-between; gap:1rem;">
                  <span>Total</span>
                  <span>${props.valueFormatter(block.total)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:1rem;">
                  <span>Self</span>
                  <span>${props.valueFormatter(block.self)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:1rem;">
                  <span>Share</span>
                  <span>${((block.total / (props.root?.total || 1)) * 100).toFixed(2)}%</span>
                </div>
              </div>
            </div>
          `;
        },
      },
      grid: {
        left: 10,
        right: 10,
        top: 10,
        bottom: 10,
        containLabel: false,
        height: chartHeight.value - 20,
      },
      xAxis: {
        type: "value",
        min: 0,
        max: 100,
        show: false,
      },
      yAxis: {
        type: "value",
        min: 0,
        max: maxDepth.value + 1,
        inverse: true,
        show: false,
      },
      series: [
        {
          type: "custom",
          renderItem: (params: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI) => {
            const startX = Number(api.value(0));
            const depth = Number(api.value(1));
            const width = Number(api.value(2));
            const point1 = api.coord([startX, 0]);
            const point2 = api.coord([startX + width, 0]);
            const x = point1[0];
            const y = depth * (BLOCK_HEIGHT + BLOCK_PADDING) + 1;
            const rectWidth = Math.max(point2[0] - point1[0], 1);
            const block = data[params.dataIndex].block as FlameBlock;
            const fill = block.fill;
            return {
              type: "rect",
              shape: {
                x,
                y,
                width: rectWidth,
                height: BLOCK_HEIGHT,
                r: 2,
              },
              style: api.style({
                fill,
                stroke: borderColor,
                lineWidth: 1,
              }),
              emphasis: {
                style: {
                  stroke: tokenColor("--color-primary-500", "--color-accent"),
                  lineWidth: 2,
                },
              },
              textContent:
                rectWidth > 42
                  ? {
                      type: "text",
                      style: {
                        text: block.name,
                        fill: block.textColor,
                        font: "0.75rem Inter, sans-serif",
                        overflow: "truncate",
                        width: rectWidth - 8,
                      },
                    }
                  : false,
              textConfig: {
                position: "inside",
                distance: 4,
              },
            };
          },
          data,
        } as CustomSeriesOption,
      ],
    } satisfies EChartsOption,
  };
});
</script>
