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
    ref="rootEl"
    class="bg-surface-panel rounded-default border-border-default relative border p-2"
  >
    <div v-if="!hasData" class="text-text-secondary flex h-40 items-center justify-center text-sm">
      {{ emptyLabel }}
    </div>

    <div
      v-else
      class="bg-theme-body-bg-secondary rounded-default border-border-default border p-1.5"
    >
      <div class="mb-1.5 flex min-w-0 flex-nowrap items-center gap-2">
        <span
          class="border-border-default bg-surface-page text-text-secondary rounded-default inline-flex shrink-0 items-center px-2 py-1 text-xs whitespace-nowrap"
        >
          {{ summaryLabel }}: {{ summaryValue }} ({{ unitLabel }})
        </span>

        <div
          v-if="focusPath"
          class="border-border-default bg-surface-page rounded-default flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-2 py-1 text-xs"
          data-test="flame-graph-focus-bar"
          :title="focusedNode?.name"
        >
          <span class="text-text-body min-w-0 truncate font-medium">{{ focusedNode?.name }}</span>
          <span class="text-text-secondary shrink-0 whitespace-nowrap">{{
            focusPercentLabel
          }}</span>
          <OButton
            class="shrink-0"
            variant="ghost"
            size="xs"
            icon-left="close"
            :aria-label="t('profiles.resetFocus')"
            data-test="flame-graph-focus-reset"
            @click="resetFocus"
          />
        </div>

        <div class="ms-auto flex shrink-0 items-center gap-2">
          <div
            class="border-border-default rounded-default inline-flex overflow-hidden border"
            role="group"
            :aria-label="t('profiles.labelAlign')"
          >
            <OButton
              :variant="labelAlign === 'left' ? 'primary' : 'ghost'"
              size="xs"
              icon-left="align-left"
              :aria-label="t('profiles.alignLeft')"
              data-test="flame-graph-align-left"
              @click="labelAlign = 'left'"
            />
            <OButton
              :variant="labelAlign === 'right' ? 'primary' : 'ghost'"
              size="xs"
              icon-left="align-right"
              :aria-label="t('profiles.alignRight')"
              data-test="flame-graph-align-right"
              @click="labelAlign = 'right'"
            />
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <span class="text-text-secondary text-xs whitespace-nowrap">{{
              t("profiles.inverted")
            }}</span>
            <OSwitch
              v-model="inverted"
              size="sm"
              :aria-label="t('profiles.inverted')"
              data-test="flame-graph-inverted"
            />
          </div>
        </div>
      </div>

      <div class="overflow-auto">
        <!-- eslint-disable-next-line local/no-hardcoded-px -- echarts custom series lays out in canvas device pixels -->
        <div :style="{ height: `${chartHeight}px`, minWidth: '100%' }">
          <ChartRenderer
            v-if="hasData"
            :data="chartData"
            class="h-full w-full"
            @click="onChartClick"
          />
        </div>
      </div>
    </div>

    <div
      v-if="menu"
      class="border-border-default bg-surface-panel rounded-default absolute z-20 min-w-40 border p-1 shadow-none"
      data-test="flame-graph-frame-menu"
      :style="menuStyle"
    >
      <OButton
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        data-test="flame-graph-copy-name"
        @click="copyFunctionName"
      >
        {{ t("profiles.copyFunctionName") }}
      </OButton>
      <OButton
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        data-test="flame-graph-focus-block"
        @click="focusBlock"
      >
        {{ t("profiles.focusBlock") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  CustomSeriesOption,
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemParams,
  EChartsOption,
} from "echarts";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { escapeHtml } from "@/utils/html";
import { cssToken } from "@/utils/theme";
import { useI18nTyped } from "@/types/i18n";

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
  matched: boolean;
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
type FrameMenu = {
  x: number;
  y: number;
  block: FlameBlock;
};
type LabelAlign = "left" | "right";

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
    searchQuery?: string;
  }>(),
  {
    root: null,
    emptyLabel: "No flame graph data",
    valueFormatter: (value: number) => value.toLocaleString(),
    searchQuery: "",
  },
);

const { t } = useI18nTyped();

const rootEl = ref<HTMLElement | null>(null);
const focusPath = ref<string | null>(null);
const labelAlign = ref<LabelAlign>("left");
const inverted = ref(false);
const menu = ref<FrameMenu | null>(null);

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
const matchTextBg = tokenColor("--color-status-warning-bg", "--color-warning-500");
const matchBorder = tokenColor("--color-warning-600", "--color-warning-500");

const escapeRichSegment = (value: string) =>
  value.replace(/\{/g, "﹛").replace(/\}/g, "﹜").replace(/\|/g, "｜");

const buildHighlightedLabel = (name: string, query: string) => {
  const needle = query.trim();
  if (!needle) return escapeRichSegment(name);
  const lowerName = name.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let label = "";
  let cursor = 0;
  while (cursor < name.length) {
    const matchAt = lowerName.indexOf(lowerNeedle, cursor);
    if (matchAt === -1) {
      label += escapeRichSegment(name.slice(cursor));
      break;
    }
    label += escapeRichSegment(name.slice(cursor, matchAt));
    label += `{hit|${escapeRichSegment(name.slice(matchAt, matchAt + needle.length))}}`;
    cursor = matchAt + needle.length;
  }
  return label;
};

const findNodeByPath = (
  root: FlameGraphNode | null,
  path: string | null,
): FlameGraphNode | null => {
  if (!root) return null;
  if (!path || path === "root") return root;
  const parts = path.split("/").slice(1);
  let current: FlameGraphNode = root;
  for (const part of parts) {
    const index = Number(part);
    const children = [...(current.children ?? [])].sort((a, b) => b.total - a.total);
    const next = children[index];
    if (!next) return null;
    current = next;
  }
  return current;
};

const hasData = computed(() => !!props.root && (props.root.total || 0) > 0);
const focusedNode = computed(() => findNodeByPath(props.root ?? null, focusPath.value));
const displayRoot = computed(() => focusedNode.value ?? props.root ?? null);
const grandTotal = computed(() => props.root?.total || 0);
const focusPercentLabel = computed(() => {
  const total = grandTotal.value;
  const focused = focusedNode.value?.total ?? 0;
  if (total <= 0) return t("profiles.focusOfTotal", { percent: "0.00" });
  return t("profiles.focusOfTotal", { percent: ((focused / total) * 100).toFixed(2) });
});

const searchNeedle = computed(() => props.searchQuery.trim().toLowerCase());

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
    const matched =
      searchNeedle.value.length > 0 && node.name.toLowerCase().includes(searchNeedle.value);
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
      matched,
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

  walk(root, 0, 0, 100, root.total, focusPath.value || "root");
  return blocks;
};

const blocks = computed(() => {
  const collected = collectBlocks(displayRoot.value);
  if (!inverted.value) return collected;
  const maxDepth = collected.reduce((max, block) => Math.max(max, block.depth), 0);
  return collected.map((block) => ({ ...block, depth: maxDepth - block.depth }));
});
const maxDepth = computed(() => blocks.value.reduce((max, block) => Math.max(max, block.depth), 0));
const chartHeight = computed(() => (maxDepth.value + 1) * (BLOCK_HEIGHT + BLOCK_PADDING) + 20);

const menuStyle = computed(() => {
  if (!menu.value) return undefined;
  return { left: `${menu.value.x}px`, top: `${menu.value.y}px` };
});

const closeMenu = () => {
  menu.value = null;
};

const resetFocus = () => {
  focusPath.value = null;
  closeMenu();
};

const onChartClick = (params: {
  data?: { block?: FlameBlock };
  event?: { offsetX?: number; offsetY?: number; event?: MouseEvent };
}) => {
  const block = params.data?.block;
  if (!block) return;
  const offsetX = params.event?.offsetX ?? 0;
  const offsetY = params.event?.offsetY ?? 0;
  menu.value = { x: offsetX, y: offsetY + 28, block };
};

const copyFunctionName = async () => {
  const name = menu.value?.block.name;
  if (!name) return;
  try {
    await navigator.clipboard.writeText(name);
  } catch {
    // Clipboard may be unavailable in non-secure contexts; ignore.
  }
  closeMenu();
};

const focusBlock = () => {
  const id = menu.value?.block.id;
  if (!id) return;
  focusPath.value = id;
  closeMenu();
};

const onDocumentClick = (event: MouseEvent) => {
  if (!menu.value || !rootEl.value) return;
  if (!rootEl.value.contains(event.target as Node)) {
    closeMenu();
  }
};

onMounted(() => {
  document.addEventListener("click", onDocumentClick, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick, true);
});

watch(
  () => props.root,
  () => {
    focusPath.value = null;
    closeMenu();
  },
);

const chartData = computed(() => {
  const needle = props.searchQuery.trim();
  const data: FlameSeriesDatum[] = blocks.value.map((block) => ({
    value: [block.left, block.depth, block.width, block.total],
    itemStyle: {
      color: block.fill,
      borderColor: block.matched && needle ? matchBorder : borderColor,
      borderWidth: block.matched && needle ? 2 : 1,
    },
    emphasis: {
      itemStyle: {
        borderColor: tokenColor("--color-primary-500", "--color-accent"),
        borderWidth: 2,
      },
    },
    block,
  }));
  const textPosition = labelAlign.value === "right" ? "insideRight" : "insideLeft";
  const shareBase = displayRoot.value?.total || 1;

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
                  <span>${escapeHtml(t("profiles.total"))}</span>
                  <span>${props.valueFormatter(block.total)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:1rem;">
                  <span>${escapeHtml(t("profiles.self"))}</span>
                  <span>${props.valueFormatter(block.self)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:1rem;">
                  <span>${escapeHtml(t("profiles.share"))}</span>
                  <span>${((block.total / shareBase) * 100).toFixed(2)}%</span>
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
            const fill = data[params.dataIndex].itemStyle.color;
            const label =
              block.matched && needle ? buildHighlightedLabel(block.name, needle) : block.name;
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
                stroke: data[params.dataIndex].itemStyle.borderColor,
                lineWidth: data[params.dataIndex].itemStyle.borderWidth,
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
                        text: label,
                        fill: block.textColor,
                        font: "0.75rem Inter, sans-serif",
                        overflow: "truncate",
                        width: rectWidth - 8,
                        align: labelAlign.value === "right" ? "right" : "left",
                        rich: {
                          hit: {
                            fill: block.textColor,
                            backgroundColor: matchTextBg,
                            borderRadius: 2,
                            padding: [1, 2],
                          },
                        },
                      },
                    }
                  : false,
              textConfig: {
                position: textPosition,
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
