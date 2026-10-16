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
  <div ref="rootEl" class="relative">
    <div v-if="!hasData" class="text-text-secondary flex h-40 items-center justify-center text-sm">
      {{ emptyLabel }}
    </div>

    <div v-else>
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
        >
          <OTruncatedText class="text-text-body font-medium">{{
            focusedNode?.name
          }}</OTruncatedText>
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
            >
              <OTooltip :content="t('profiles.alignLeft')" />
            </OButton>
            <OButton
              :variant="labelAlign === 'right' ? 'primary' : 'ghost'"
              size="xs"
              icon-left="align-right"
              :aria-label="t('profiles.alignRight')"
              data-test="flame-graph-align-right"
              @click="labelAlign = 'right'"
            >
              <OTooltip :content="t('profiles.alignRight')" />
            </OButton>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <span class="text-text-secondary text-xs whitespace-nowrap">{{
              t("profiles.rootAtBottom")
            }}</span>
            <OSwitch
              v-model="rootAtBottom"
              size="sm"
              :aria-label="t('profiles.rootAtBottom')"
              data-test="flame-graph-root-at-bottom"
            />
          </div>
        </div>
      </div>

      <div class="overflow-auto">
        <!-- eslint-disable-next-line local/no-hardcoded-px -- echarts custom series lays out in canvas device pixels -->
        <div :style="{ height: `${chartHeight}px`, minWidth: '100%' }">
          <ChartRenderer
            v-if="hasData"
            ref="chartRendererRef"
            :data="chartData"
            class="h-full w-full"
            @click="onChartClick"
          />
        </div>
      </div>
    </div>

    <div
      v-if="menu"
      ref="menuEl"
      class="border-border-default bg-surface-panel rounded-default absolute z-20 flex min-w-40 flex-col border p-1 shadow-none"
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
      <OButton
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        data-test="flame-graph-search-function"
        @click="searchFunction"
      >
        {{ t("profiles.searchForFunction") }}
      </OButton>
      <OButton
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        data-test="flame-graph-sandwich"
        @click="showSandwich"
      >
        {{ t("profiles.showCallersAndCallees") }}
      </OButton>
      <OButton
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        data-test="flame-graph-details"
        @click="showDetails"
      >
        {{ t("profiles.functionDetails") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type {
  CustomSeriesOption,
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemParams,
  EChartsOption,
} from "echarts";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { copyToClipboard } from "@/utils/clipboard";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { escapeHtml } from "@/utils/html";
import { cssToken } from "@/utils/theme";
import { paletteIndexFor } from "./flameGraphPackage";
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
  /** Total of the calling frame; 0 for the root. */
  callerTotal: number;
  fill: string;
  textColor: string;
  matched: boolean;
  /** A stand-in for frames the graph does not show one by one ("other", "[truncated]", small frames). */
  grouped: boolean;
  hint: string;
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
    /** Start with the root at the bottom, as the Sandwich view's callers graph does. */
    initialRootAtBottom?: boolean;
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
// Only flips the drawing; it does not regroup stacks by leaf function (a bottom-up view).
const rootAtBottom = ref(props.initialRootAtBottom ?? false);
const menu = ref<FrameMenu | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const chartRendererRef = ref<{
  chart?: { setOption: (option: object) => void; dispatchAction: (action: object) => void };
} | null>(null);

const BLOCK_HEIGHT = 24;
const BLOCK_PADDING = 2;

const tokenColor = (token: string, fallbackToken: string) =>
  cssToken(token, cssToken(fallbackToken, ""));

// Cool hues of the dashboard series palette only: no red, pink, amber or green (mint included), which read as status.
const palette = [1, 5, 7, 9].map((step) =>
  tokenColor(`--color-chart-series-${step}`, "--color-chart-series-1"),
);

// Dark in both themes, because the frame fills are light in both.
const textColor = tokenColor("--color-flame-frame-text", "--color-text-heading");
const groupedFill = tokenColor("--color-border-strong", "--color-border-default");
// Synthetic frame names from the merge API (src/core/src/profiles/query.rs).
const OTHER_FRAME = "other";
const TRUNCATED_FRAME = "[truncated]";
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

  const colorFor = (name: string) => palette[paletteIndexFor(name, palette.length)];

  const hintFor = (name: string) => {
    if (name === OTHER_FRAME) return t("profiles.otherFrameHint");
    if (name === TRUNCATED_FRAME) return t("profiles.truncatedFrameHint");
    return "";
  };

  const walk = (
    node: FlameGraphNode,
    depth: number,
    left: number,
    width: number,
    parentTotal: number,
    path: string,
    callerTotal: number,
  ) => {
    const self =
      node.self ??
      Math.max(0, node.total - (node.children ?? []).reduce((sum, child) => sum + child.total, 0));
    const hint = depth === 0 ? "" : hintFor(node.name);
    const matched =
      !hint &&
      searchNeedle.value.length > 0 &&
      node.name.toLowerCase().includes(searchNeedle.value);
    blocks.push({
      id: path,
      name: node.name,
      depth,
      left,
      width,
      total: node.total,
      self,
      callerTotal,
      fill: hint ? groupedFill : colorFor(node.name),
      textColor,
      matched,
      grouped: !!hint,
      hint,
    });
    if (!node.children?.length || parentTotal <= 0) return;
    const children = [...node.children].sort((a, b) => b.total - a.total);
    let offset = left;
    // Children are sorted by total, so the ones too thin to draw sit together at the end.
    const small = { count: 0, total: 0, left: 0 };
    for (const [index, child] of children.entries()) {
      const childWidth = width * (child.total / parentTotal);
      if (childWidth <= 0.1) {
        if (!small.count) small.left = offset;
        small.count += 1;
        small.total += child.total;
        offset += childWidth;
        continue;
      }
      walk(child, depth + 1, offset, childWidth, child.total, `${path}/${index}`, node.total);
      offset += childWidth;
    }
    if (small.count) {
      blocks.push({
        id: `${path}/small`,
        name: t("profiles.smallFrames", { count: small.count }, small.count),
        depth: depth + 1,
        left: small.left,
        width: width * (small.total / parentTotal),
        total: small.total,
        self: 0,
        callerTotal: node.total,
        fill: groupedFill,
        textColor,
        matched: false,
        grouped: true,
        hint: t("profiles.smallFramesHint"),
      });
    }
  };

  walk(root, 0, 0, 100, root.total, focusPath.value || "root", 0);
  return blocks;
};

const blocks = computed(() => {
  const collected = collectBlocks(displayRoot.value);
  if (!rootAtBottom.value) return collected;
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
  event?: { event?: Pick<MouseEvent, "clientX" | "clientY"> };
}) => {
  const block = params.data?.block;
  const root = rootEl.value;
  const native = params.event?.event;
  // Grouped frames stand for many functions, so there is nothing to copy or focus.
  if (!block || block.grouped || !root || !native) return;
  chartRendererRef.value?.chart?.dispatchAction({ type: "hideTip" });
  // offsetX/offsetY are canvas-local; the menu is positioned against rootEl.
  const rect = root.getBoundingClientRect();
  menu.value = {
    x: native.clientX - rect.left - root.clientLeft,
    y: native.clientY - rect.top - root.clientTop,
    block,
  };
  nextTick(fitMenu);
};

/** The box the menu must stay inside: the nearest ancestor that clips it, else the window. */
const clipBox = (el: HTMLElement) => {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (/auto|scroll|hidden/.test(`${overflowX} ${overflowY}`)) return node.getBoundingClientRect();
  }
  return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
};

/** Opens the menu above or to the left of the pointer when it would be cut off below or on the right. */
const fitMenu = () => {
  const current = menu.value;
  const el = menuEl.value;
  if (!current || !el) return;
  const box = el.getBoundingClientRect();
  const clip = clipBox(el);
  let { x, y } = current;
  if (box.bottom > clip.bottom) y = Math.max(y - box.height, y - (box.top - clip.top));
  if (box.right > clip.right) x = Math.max(x - box.width, x - (box.left - clip.left));
  if (x !== current.x || y !== current.y) menu.value = { ...current, x, y };
};

const copyFunctionName = async () => {
  const name = menu.value?.block.name;
  if (!name) return;
  await copyToClipboard(name, t, { successMessage: t("common.copiedToClipboard") });
  closeMenu();
};

const emit = defineEmits<{
  search: [name: string];
  sandwich: [name: string];
  details: [name: string];
}>();

const searchFunction = () => {
  const name = menu.value?.block.name;
  if (name) emit("search", name);
  closeMenu();
};

const showSandwich = () => {
  const name = menu.value?.block.name;
  if (name) emit("sandwich", name);
  closeMenu();
};

const showDetails = () => {
  const name = menu.value?.block.name;
  if (name) emit("details", name);
  closeMenu();
};

/** Focus a frame by its path ("root/0/2"); the Call Tree uses the same ids. */
const focus = (path: string) => {
  focusPath.value = path;
  closeMenu();
};
defineExpose({ focus });

const focusBlock = () => {
  const id = menu.value?.block.id;
  if (!id) return;
  focusPath.value = id;
  closeMenu();
};

// Any click outside the menu closes it, the graph included; a click on a frame then opens the menu there.
const onDocumentClick = (event: MouseEvent) => {
  if (!menu.value || menuEl.value?.contains(event.target as Node)) return;
  closeMenu();
};
const onDocumentKeydown = (event: KeyboardEvent) => {
  if (menu.value && event.key === "Escape") closeMenu();
};

onMounted(() => {
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onDocumentKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick, true);
  document.removeEventListener("keydown", onDocumentKeydown);
});

// No hover card over an open frame menu. Set on the chart itself, so the frame blocks are not rebuilt.
watch(menu, (open) => {
  chartRendererRef.value?.chart?.setOption({ tooltip: { show: !open } });
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
        // On the body, as dashboard charts do: the graph's scroll box would cut off a tooltip above the top row.
        appendToBody: true,
        // Gone at once (no 100 ms delay, no 0.4 s fade), so it never sits on top of the frame menu.
        hideDelay: 0,
        transitionDuration: 0,
        trigger: "item",
        backgroundColor: tokenColor("--color-surface-base", "--color-surface-panel"),
        borderColor: tokenColor("--color-border-default", "--color-border-strong"),
        textStyle: { color: tokenColor("--color-text-body", "--color-text-inverse") },
        extraCssText: "max-width: 28rem; white-space: normal; word-break: break-word;",
        formatter: (params) => {
          const block = (params as unknown as { data: { block: FlameBlock } }).data.block;
          const percentOf = (value: number, base: number) =>
            base > 0 ? `${((value / base) * 100).toFixed(2)}%` : "—";
          const row = (label: string, value: string, percent: string) => `
            <span>${escapeHtml(label)}</span>
            <span style="text-align: right;">${value}</span>
            <span style="text-align: right; opacity: 0.75;">${percent}</span>`;
          return `
            <div style="padding: 0.25rem 0;">
              <div style="font-weight: 600; margin-bottom: 0.25rem;">${escapeHtml(block.name)}</div>
              <div style="display: grid; grid-template-columns: auto auto auto; column-gap: 1rem; font-size: 0.75rem; line-height: 1.5;">
                ${row(t("profiles.total"), props.valueFormatter(block.total), percentOf(block.total, shareBase))}
                ${row(t("profiles.self"), props.valueFormatter(block.self), percentOf(block.self, shareBase))}
                ${block.callerTotal ? row(t("profiles.shareOfCaller"), "", percentOf(block.total, block.callerTotal)) : ""}
              </div>
              ${block.hint ? `<div style="font-size: 0.75rem; margin-top: 0.375rem; opacity: 0.8;">${escapeHtml(block.hint)}</div>` : ""}
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
