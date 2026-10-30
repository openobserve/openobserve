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
  <div ref="rootEl" class="relative" :class="{ 'h-full': fillHeight }">
    <div v-if="!hasData" class="text-text-secondary flex h-40 items-center justify-center text-sm">
      {{ emptyLabel }}
    </div>

    <div v-else>
      <div
        v-if="!hideViewOptions"
        class="mb-1.5 flex min-w-0 flex-nowrap items-center gap-2"
        data-test="flame-graph-view-options"
      >
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
        <div
          ref="plotEl"
          :style="{ height: `${chartHeight}px`, minWidth: '100%' }"
          class="relative"
          :class="{ 'cursor-grab': zoomed }"
          data-test="flame-graph-plot"
          @contextmenu="onPlotContextMenu"
          @wheel.capture="onWheel"
          @pointerdown.capture="onPointerDown"
          @pointermove.capture="onPointerMove"
          @pointerup.capture="onPointerUp"
          @pointerleave="onPointerLeave"
        >
          <ChartRenderer
            v-if="hasData"
            ref="chartRendererRef"
            :data="chartData"
            :label="chartLabel"
            class="h-full w-full"
            @click="onChartClick"
          />
          <div v-if="moreButton" class="absolute z-10" :style="moreButton.style">
            <OButton
              class="bg-surface-panel/90"
              variant="ghost"
              size="icon-chip"
              icon-left="more-vert"
              :aria-label="t('profiles.frameActions', { name: moreButton.block.name })"
              data-test="flame-graph-frame-more"
              @pointerdown.stop
              @click.stop="openMenuFromButton"
            />
          </div>
        </div>
      </div>
      <div
        v-if="showZoomHint && !noZoomHint"
        class="border-border-default bg-surface-panel rounded-default absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 border px-3 py-1.5 text-xs whitespace-nowrap"
        data-test="flame-graph-zoom-hint"
      >
        <span class="text-text-body">{{ t("profiles.zoomHint", { key: zoomKey }) }}</span>
        <OButton
          variant="ghost"
          size="xs"
          data-test="flame-graph-zoom-hint-never"
          @click="hideZoomHint(true)"
        >
          {{ t("profiles.dontShowAgain") }}
        </OButton>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="close"
          :aria-label="t('common.close')"
          data-test="flame-graph-zoom-hint-close"
          @click="hideZoomHint(false)"
        />
      </div>
    </div>

    <div
      v-if="menu"
      ref="menuEl"
      class="border-border-default bg-surface-panel rounded-default absolute z-20 flex min-w-40 flex-col border p-1 shadow-none"
      data-test="flame-graph-frame-menu"
      :style="menuStyle"
    >
      <div class="flex min-w-0 items-start gap-1 px-2 pt-1 pb-1.5">
        <div class="min-w-0 flex-1">
          <div class="text-text-secondary text-2xs">{{ t("profiles.function") }}</div>
          <OTruncatedText class="text-text-body max-w-64 font-mono text-xs font-medium">{{
            menu.block.name
          }}</OTruncatedText>
        </div>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="content-copy"
          :aria-label="t('profiles.copyFunctionName')"
          data-test="flame-graph-copy-name"
          @click="copyFunctionName"
        >
          <OTooltip :content="t('profiles.copyFunctionName')" />
        </OButton>
      </div>
      <!-- The zoom item follows where the frame sits: below the zoomed frame, on it, or above it. -->
      <OButton
        v-if="menu.block.id === focusPath"
        variant="ghost"
        size="sm"
        icon-left="zoom-out"
        class="w-full justify-start"
        data-test="flame-graph-zoom-out"
        @click="zoomTo(parentPath(menu.block.id))"
      >
        {{ t("profiles.zoomOut") }}
      </OButton>
      <OButton
        v-else-if="menu.block.ancestor && menu.block.id !== 'root'"
        variant="ghost"
        size="sm"
        icon-left="zoom-out"
        class="w-full justify-start"
        data-test="flame-graph-zoom-out-here"
        @click="zoomTo(menu.block.id)"
      >
        {{ t("profiles.zoomOutHere") }}
      </OButton>
      <OButton
        v-else-if="menu.block.id !== 'root'"
        variant="ghost"
        size="sm"
        icon-left="zoom-in"
        class="w-full justify-start"
        data-test="flame-graph-zoom-in"
        @click="zoomTo(menu.block.id)"
      >
        {{ t("profiles.zoomIn") }}
      </OButton>
      <OButton
        v-if="focusPath"
        variant="ghost"
        size="sm"
        icon-left="fit-screen"
        class="w-full justify-start"
        data-test="flame-graph-zoom-reset"
        @click="zoomTo(null)"
      >
        {{ t("profiles.resetZoom") }}
      </OButton>
      <OButton
        variant="ghost"
        size="sm"
        icon-left="search"
        class="w-full justify-start"
        data-test="flame-graph-search-function"
        @click="searchFunction"
      >
        {{ t("profiles.highlight") }}
      </OButton>
      <OButton
        v-if="!hideProfileActions"
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        icon-left="swap-vert"
        data-test="flame-graph-sandwich"
        @click="showSandwich"
      >
        {{ t("profiles.showCallersAndCallees") }}
      </OButton>
      <OButton
        v-if="!hideProfileActions"
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        icon-left="info-outline"
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
import { parseColor } from "@/lib/styles/tokens/colorMath";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useThemeRevision } from "@/composables/useTheme";
import useBreakpoint from "@/composables/useBreakpoint";

export interface FlameGraphNode {
  name: string;
  total: number;
  self?: number;
  /** Baseline side of a diff tree; total and self are then the comparison side. */
  before_total?: number;
  /** Comparison side, set when the drawn tree is the baseline side (Side by side). */
  after_total?: number;
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
  /** Drawn text: the name, or the total on the root bar. */
  label: string;
  /** A caller of the zoomed frame, drawn dimmed above it; a click zooms out to it. */
  ancestor?: boolean;
  /** Diff graphs: the frame's share of each side's total, 0 to 1. */
  beforeShare?: number;
  afterShare?: number;
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
    /** Draw a diff tree: width is the comparison, colour the change in each frame's share. */
    diffBaselineTotal?: number | null;
    /** The comparison side's total, when the drawn tree is not the comparison side. */
    diffComparisonTotal?: number | null;
    /** What each side of a diff is called, as in "v1.4.0", for the tooltip's rows. */
    diffLabels?: { baseline: string; comparison: string };
    /** Hide the callers/callees and function details actions, which only the profiles page can open. */
    hideProfileActions?: boolean;
    /** Hide the label-align and root-at-bottom controls, for hosts that cannot keep their state. */
    hideViewOptions?: boolean;
    /** Grow the rows so the graph fills its container's height, for a host of fixed size such as a dashboard panel. */
    fillHeight?: boolean;
    /** Leave out the wheel-zoom hint, for a host too small to keep a toast over the graph. */
    noZoomHint?: boolean;
    /** Accessible name for the graph; without one ECharts describes it by its series type. */
    chartLabel?: I18nText;
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
  chart?: {
    setOption: (option: object) => void;
    dispatchAction: (action: object) => void;
    getDom: () => HTMLElement;
    getWidth?: () => number;
    getHeight?: () => number;
    resize: () => void;
  };
} | null>(null);

const BLOCK_HEIGHT = 24;
const BLOCK_PADDING = 2;
const tokenColor = (token: string, fallbackToken: string) =>
  cssToken(token, cssToken(fallbackToken, ""));

// Synthetic frame names from the merge API (src/core/src/profiles/query.rs).
const OTHER_FRAME = "other";
const TRUNCATED_FRAME = "[truncated]";
// Changes under a tenth of a point draw grey.
const DIFF_FLOOR = 0.001;

/** Mixes two token colours in sRGB; `amount` 0 gives `from`, 1 gives `to`. */
const mixColor = (from: string, to: string, amount: number) => {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return to;
  const channel = (x: number, y: number) => Math.round(x + (y - x) * amount);
  // eslint-disable-next-line local/no-hardcoded-color -- canvas fill mixed at runtime from two token colours
  return `rgb(${channel(a.r, b.r)}, ${channel(a.g, b.g)}, ${channel(a.b, b.b)})`;
};

const themeRevision = useThemeRevision();
// Token values change with the theme, so they are re-read whenever it switches.
const colors = computed(() => {
  void themeRevision.value;
  return {
    // Cool hues of the dashboard series palette only: no red, pink, amber or green (mint included), which read as status.
    palette: [1, 5, 7, 9].map((step) =>
      tokenColor(`--color-chart-series-${step}`, "--color-chart-series-1"),
    ),
    // Dark in both themes, because the frame fills are light in both.
    textColor: tokenColor("--color-flame-frame-text", "--color-text-heading"),
    groupedFill: tokenColor("--color-flame-grouped-fill", "--color-border-default"),
    borderColor: tokenColor("--color-border-default", "--color-border-strong"),
    matchTextBg: tokenColor("--color-status-warning-bg", "--color-warning-500"),
    // Diff colours: a bigger share reads as more cost, a smaller share as less, grey for no change.
    diffMore: tokenColor("--color-status-negative", "--color-chart-series-3"),
    diffLess: tokenColor("--color-chart-series-1", "--color-chart-series-5"),
    matchBorder: tokenColor("--color-warning-600", "--color-warning-500"),
  };
});

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

/** The frames from the root down to the zoomed one, each with its path. */
const focusLine = computed(() => {
  const root = props.root;
  const path = focusPath.value;
  if (!root || !path) return [];
  const line = [{ node: root, path: "root" }];
  let current = root;
  let currentPath = "root";
  for (const part of path.split("/").slice(1)) {
    const next = [...(current.children ?? [])].sort((a, b) => b.total - a.total)[Number(part)];
    if (!next) break;
    currentPath = `${currentPath}/${part}`;
    current = next;
    line.push({ node: next, path: currentPath });
  }
  return line;
});

const grandTotal = computed(() => props.root?.total || 0);

const searchNeedle = computed(() => props.searchQuery.trim().toLowerCase());

const diffComparisonTotal = computed(() => props.diffComparisonTotal ?? grandTotal.value);
/** A frame's share of each side's total, 0 to 1, whichever side the tree draws. */
const diffSharesOf = (node: FlameGraphNode) => {
  const base = props.diffBaselineTotal ?? 0;
  const comparison = diffComparisonTotal.value;
  return {
    beforeShare: base > 0 ? (node.before_total ?? 0) / base : 0,
    afterShare: comparison > 0 ? (node.after_total ?? node.total) / comparison : 0,
  };
};

/** The largest share change in the diff tree, so the strongest colour marks the biggest change. */
const maxDiffChange = computed(() => {
  if (!props.root || !props.diffBaselineTotal || diffComparisonTotal.value <= 0) return 0;
  let max = 0;
  const visit = (node: FlameGraphNode) => {
    const { beforeShare, afterShare } = diffSharesOf(node);
    max = Math.max(max, Math.abs(afterShare - beforeShare));
    node.children?.forEach(visit);
  };
  props.root.children?.forEach(visit);
  return max;
});

const collectBlocks = (root: FlameGraphNode | null): FlameBlock[] => {
  if (!root || (root.total || 0) <= 0) return [];
  const blocks: FlameBlock[] = [];
  // Zoomed in, the callers stay on screen above the zoomed frame, full width and dimmed.
  const ancestors = focusLine.value.slice(0, -1);
  const rootDepth = ancestors.length;
  const { palette, textColor, groupedFill, diffMore, diffLess } = colors.value;

  const colorFor = (name: string) => palette[paletteIndexFor(name, palette.length)];
  const diffFill = (node: FlameGraphNode) => {
    const { beforeShare, afterShare } = diffSharesOf(node);
    const change = afterShare - beforeShare;
    if (Math.abs(change) < DIFF_FLOOR || maxDiffChange.value <= 0) return groupedFill;
    const strength = 0.25 + 0.75 * Math.min(1, Math.abs(change) / maxDiffChange.value);
    return mixColor(groupedFill, change > 0 ? diffMore : diffLess, strength);
  };

  const ancestorBlocks: FlameBlock[] = ancestors.map(({ node, path }, depth) => ({
    id: path,
    name: node.name,
    label: node.name,
    depth,
    left: 0,
    width: 100,
    total: node.total,
    self: node.self ?? 0,
    callerTotal: depth > 0 ? ancestors[depth - 1].node.total : 0,
    fill: depth === 0 ? groupedFill : colorFor(node.name),
    textColor,
    matched: false,
    grouped: false,
    hint: depth === 0 ? "" : t("profiles.ancestorHint"),
    ancestor: true,
  }));

  const hintFor = (name: string) => {
    if (name === OTHER_FRAME) return t("profiles.otherFrameHint");
    if (name === TRUNCATED_FRAME) return t("profiles.truncatedFrameHint");
    return "";
  };

  const sortedChildren = (node: FlameGraphNode) =>
    [...(node.children ?? [])].sort((a, b) => b.total - a.total);
  const selfOf = (node: FlameGraphNode) =>
    node.self ??
    Math.max(0, node.total - (node.children ?? []).reduce((sum, child) => sum + child.total, 0));

  const walk = (
    node: FlameGraphNode,
    depth: number,
    left: number,
    width: number,
    path: string,
    callerTotal: number,
  ) => {
    const isDiff = props.diffBaselineTotal != null;
    const hint = depth === rootDepth ? "" : hintFor(node.name);
    const matched =
      !hint &&
      searchNeedle.value.length > 0 &&
      node.name.toLowerCase().includes(searchNeedle.value);
    blocks.push({
      id: path,
      name: node.name,
      label: node.name,
      depth,
      left,
      width,
      total: node.total,
      self: selfOf(node),
      callerTotal,
      fill: hint ? groupedFill : isDiff ? diffFill(node) : colorFor(node.name),
      ...(isDiff ? diffSharesOf(node) : {}),
      textColor,
      matched,
      grouped: !!hint,
      hint,
    });
    if (node.total <= 0) return;
    let offset = left;
    // Children are sorted by total, so the ones too thin to draw sit together at the end.
    const small = { count: 0, total: 0, left: 0 };
    for (const [index, child] of sortedChildren(node).entries()) {
      const childWidth = width * (child.total / node.total);
      if (childWidth <= 0.1) {
        if (!small.count) small.left = offset;
        small.count += 1;
        small.total += child.total;
        offset += childWidth;
        continue;
      }
      walk(child, depth + 1, offset, childWidth, `${path}/${index}`, node.total);
      offset += childWidth;
    }
    if (small.count) {
      blocks.push({
        id: `${path}/small`,
        name: t("profiles.smallFrames", { count: small.count }, small.count),
        label: t("profiles.smallFrames", { count: small.count }, small.count),
        depth: depth + 1,
        left: small.left,
        width: width * (small.total / node.total),
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

  walk(root, rootDepth, 0, 100, focusPath.value || "root", ancestors.at(-1)?.node.total ?? 0);
  // The root is a neutral bar with the total, and once zoomed in a click on it zooms out.
  const summary = `${props.summaryLabel}: ${props.summaryValue} (${props.unitLabel})`;
  return [...ancestorBlocks, ...blocks].map((block) =>
    block.id === "root"
      ? {
          ...block,
          label: focusPath.value ? `${summary} · ${t("profiles.clickToZoomOut")}` : summary,
          fill: groupedFill,
          hint: focusPath.value ? t("profiles.clickToZoomOut") : "",
        }
      : block,
  );
};

const blocks = computed(() => {
  const collected = collectBlocks(displayRoot.value);
  if (!rootAtBottom.value) return collected;
  const maxDepth = collected.reduce((max, block) => Math.max(max, block.depth), 0);
  return collected.map((block) => ({ ...block, depth: maxDepth - block.depth }));
});
const maxDepth = computed(() => blocks.value.reduce((max, block) => Math.max(max, block.depth), 0));
// The container height the rows may grow into; 0 keeps the fixed row height.
const fillableHeight = ref(0);
const rowStep = computed(() => {
  const fixed = BLOCK_HEIGHT + BLOCK_PADDING;
  if (!props.fillHeight || !fillableHeight.value) return fixed;
  return Math.max(fixed, Math.floor((fillableHeight.value - 20) / (maxDepth.value + 1)));
});
const blockHeight = computed(() => rowStep.value - BLOCK_PADDING);
const chartHeight = computed(() => (maxDepth.value + 1) * rowStep.value + 20);
const measureFillable = () => {
  const root = rootEl.value;
  if (!root) return;
  const options = root.querySelector<HTMLElement>('[data-test="flame-graph-view-options"]');
  fillableHeight.value = Math.max(0, root.clientHeight - (options?.offsetHeight ?? 0));
};

const menuStyle = computed(() => {
  if (!menu.value) return undefined;
  return { left: `${menu.value.x}px`, top: `${menu.value.y}px` };
});

const closeMenu = () => {
  menu.value = null;
};

/** The path one level up: "root/0/2" gives "root/0". */
const parentPath = (path: string) => path.slice(0, path.lastIndexOf("/")) || "root";

/** Zooms to a frame: it fills the width and its callers stay above it. The root zooms all the way out. */
const zoomTo = (path: string | null) => {
  focusPath.value = path && path !== "root" ? path : null;
  closeMenu();
};

// As in most profilers: a click zooms into a frame, and a click on a dimmed caller zooms back out to it.
const onChartClick = (params: { data?: { block?: FlameBlock } }) => {
  // The release of a drag is not a click.
  if (dragged) {
    dragged = false;
    return;
  }
  const block = params.data?.block;
  // Grouped frames stand for many functions, so there is nothing to zoom into.
  if (!block || block.grouped) return;
  chartRendererRef.value?.chart?.dispatchAction({ type: "hideTip" });
  zoomTo(block.id);
};

const plotEl = ref<HTMLElement | null>(null);
// The plot's inset inside the chart (grid left, right and top) in CSS pixels.
const PLOT_INSET = 10;

/** The drawn frame under a pointer, from the row height and the plot's width. */
const blockAt = (clientX: number, clientY: number) => {
  const box = plotEl.value?.getBoundingClientRect();
  if (!box) return null;
  const share = (clientX - box.left - PLOT_INSET) / Math.max(1, box.width - 2 * PLOT_INSET);
  const left = zoomWindow.start + share * (zoomWindow.end - zoomWindow.start);
  const depth = Math.floor((clientY - box.top - 1) / rowStep.value);
  return (
    blocks.value.find(
      (block) => block.depth === depth && left >= block.left && left < block.left + block.width,
    ) ?? null
  );
};

// The horizontal zoom inside the view, in percent of its width. Plain, so a zoom step does not rebuild the
// frames; the chart options read it whenever they rebuild for other reasons.
let zoomWindow = { start: 0, end: 100 };
const zoomed = ref(false);
// Bumped on every zoom step, so what is placed over the plot (the ⋮ button) follows the window.
const zoomStep = ref(0);
// The narrowest window, in percent of the view's width.
const ZOOM_MIN_SPAN = 0.5;

const setZoom = (start: number, end: number) => {
  const span = Math.min(100, Math.max(ZOOM_MIN_SPAN, end - start));
  const from = Math.min(100 - span, Math.max(0, start));
  zoomWindow = { start: from, end: from + span };
  zoomed.value = span < 100;
  zoomStep.value += 1;
  chartRendererRef.value?.chart?.dispatchAction({ type: "dataZoom", ...zoomWindow });
};
const plotWidth = () => Math.max(1, (plotEl.value?.clientWidth ?? 0) - 2 * PLOT_INSET);
/** The pointer's place across the plot, 0 at the left edge and 1 at the right. */
const pointerShare = (clientX: number) => {
  const box = plotEl.value?.getBoundingClientRect();
  const share = box ? (clientX - box.left - PLOT_INSET) / plotWidth() : 0.5;
  return Math.min(1, Math.max(0, share));
};

// Cmd or Ctrl + scroll (a trackpad pinch reports ctrlKey) zooms at the pointer, Shift + scroll or a
// sideways swipe pans, and a plain scroll scrolls the page. Captured, because the chart canvas stops wheel events.
const onWheel = (event: WheelEvent) => {
  const zoom = event.ctrlKey || event.metaKey;
  const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  if (!zoom && !event.shiftKey && !sideways) return;
  event.preventDefault();
  event.stopPropagation();
  const { start, end } = zoomWindow;
  const span = end - start;
  if (zoom) {
    const at = pointerShare(event.clientX);
    // About 1.35 times per mouse-wheel notch (deltaY 100); a pinch sends small steps and zooms smoothly.
    const next = Math.min(100, Math.max(ZOOM_MIN_SPAN, span * Math.exp(event.deltaY * 0.003)));
    hideZoomHint(false);
    const anchor = start + at * span;
    setZoom(anchor - at * next, anchor - at * next + next);
  } else {
    const shift = ((sideways ? event.deltaX : event.deltaY) / plotWidth()) * span;
    setZoom(start + shift, end + shift);
  }
  // A different frame can now sit under the pointer.
  const block = blockAt(event.clientX, event.clientY);
  hoverBlock.value = block && !block.grouped ? block : null;
};

// A drag pans the zoomed view; a release after a real move does not count as a click.
let dragStart: { x: number; start: number; end: number } | null = null;
let dragged = false;
const onPointerDown = (event: PointerEvent) => {
  dragged = false;
  if (event.button !== 0 || !zoomed.value) return;
  dragStart = { x: event.clientX, ...zoomWindow };
};
const onPointerMove = (event: PointerEvent) => {
  if (!dragStart) {
    const block = blockAt(event.clientX, event.clientY);
    hoverBlock.value = block && !block.grouped ? block : null;
    return;
  }
  const dx = event.clientX - dragStart.x;
  if (!dragged && Math.abs(dx) < 4) return;
  dragged = true;
  const shift = (-dx / plotWidth()) * (dragStart.end - dragStart.start);
  setZoom(dragStart.start + shift, dragStart.end + shift);
};
const onPointerUp = () => {
  dragStart = null;
};
const onPointerLeave = () => {
  dragStart = null;
  hoverBlock.value = null;
};

// The frame under the pointer, for its ⋮ button.
const hoverBlock = ref<FlameBlock | null>(null);
// The ⋮ button's size in CSS pixels.
const MORE_BUTTON = 20;
const moreButton = computed(() => {
  void zoomStep.value;
  const block = hoverBlock.value;
  if (!block || menu.value) return null;
  const span = Math.max(ZOOM_MIN_SPAN, zoomWindow.end - zoomWindow.start);
  const toPx = (value: number) => PLOT_INSET + ((value - zoomWindow.start) / span) * plotWidth();
  const left = Math.max(toPx(block.left), PLOT_INSET);
  const right = Math.min(toPx(block.left + block.width), PLOT_INSET + plotWidth());
  if (right - left < MORE_BUTTON * 2) return null;
  return {
    block,
    style: {
      left: `${right - MORE_BUTTON - 2}px`,
      top: `${block.depth * rowStep.value + 1 + (blockHeight.value - MORE_BUTTON) / 2}px`,
    },
  };
});

/** Opens the frame's actions under its ⋮ button. */
const openMenuFromButton = (event: MouseEvent) => {
  const block = moreButton.value?.block;
  const root = rootEl.value;
  const button = event.currentTarget as HTMLElement | null;
  if (!block || !root || !button) return;
  chartRendererRef.value?.chart?.dispatchAction({ type: "hideTip" });
  const rect = root.getBoundingClientRect();
  const box = button.getBoundingClientRect();
  menu.value = { x: box.left - rect.left, y: box.bottom - rect.top + 2, block };
  nextTick(fitMenu);
};

// A one-time hint for the wheel zoom; "Don't show again" keeps it closed.
const ZOOM_HINT_KEY = "o2_flame_zoom_hint_hidden";
const zoomKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const readHintHidden = () => {
  try {
    return localStorage.getItem(ZOOM_HINT_KEY) === "1";
  } catch {
    return false;
  }
};
const zoomHintHidden = ref(readHintHidden());
const showZoomHint = computed(() => hasData.value && !zoomHintHidden.value);
const hideZoomHint = (forever: boolean) => {
  zoomHintHidden.value = true;
  if (!forever) return;
  try {
    localStorage.setItem(ZOOM_HINT_KEY, "1");
  } catch {
    // Without storage the hint only stays closed until the page reloads.
  }
};

// A new frame to zoom to, or new data, starts at the full width of the view.
watch([focusPath, () => props.root], () => {
  zoomWindow = { start: 0, end: 100 };
  zoomed.value = false;
});

// A right-click opens the frame's actions; anywhere else the browser's own menu stays.
const onPlotContextMenu = (event: MouseEvent) => {
  const block = blockAt(event.clientX, event.clientY);
  const root = rootEl.value;
  if (!block || block.grouped || !root) return;
  event.preventDefault();
  chartRendererRef.value?.chart?.dispatchAction({ type: "hideTip" });
  const rect = root.getBoundingClientRect();
  menu.value = {
    x: event.clientX - rect.left - root.clientLeft,
    y: event.clientY - rect.top - root.clientTop,
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
  focus: [path: string | null];
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
  // A shared link can name a frame that the data no longer has.
  if (!findNodeByPath(props.root ?? null, path)) return;
  focusPath.value = path;
  closeMenu();
};
defineExpose({ focus });
watch(focusPath, (path) => emit("focus", path));

// Any click outside the menu closes it, the graph included; a click on a frame then opens the menu there.
const onDocumentClick = (event: MouseEvent) => {
  if (!menu.value || menuEl.value?.contains(event.target as Node)) return;
  closeMenu();
};
const onDocumentKeydown = (event: KeyboardEvent) => {
  if (menu.value && event.key === "Escape") closeMenu();
};

// At lg+ ChartRenderer only follows window resizes, so a side panel opening would leave the graph stale; below lg it observes its own box.
const { lgUp } = useBreakpoint();
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
const resizeChart = () => {
  resizeFrame = 0;
  const chart = chartRendererRef.value?.chart;
  const dom = chart?.getDom?.();
  if (!chart || !dom) return;
  const width = dom.clientWidth;
  const height = dom.clientHeight;
  // ChartRenderer may already have resized for the same change; a second resize redraws for nothing.
  if (width <= 0 || height <= 0) return;
  if (width === chart.getWidth?.() && height === chart.getHeight?.()) return;
  chart.resize?.();
};

onMounted(() => {
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onDocumentKeydown);
  if (props.fillHeight) measureFillable();
  if (!rootEl.value || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => {
    if (props.fillHeight) measureFillable();
    if (!lgUp.value) return;
    if (!resizeFrame) resizeFrame = requestAnimationFrame(resizeChart);
  });
  resizeObserver.observe(rootEl.value);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick, true);
  document.removeEventListener("keydown", onDocumentKeydown);
  resizeObserver?.disconnect();
  resizeObserver = null;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = 0;
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

const formatPoints = (change: number) =>
  t("profiles.diffPoints", {
    value: `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change * 100).toFixed(2)}`,
  });

const TOOLTIP_GAP = 12;
/**
 * Below and right of the pointer, flipped to the other side where the window has no room. The
 * chart's own flip only knows the chart's height, so on a tall graph a tooltip on the rows near
 * the bottom of the screen would open off screen.
 */
const tooltipPosition = (
  point: number[],
  _params: unknown,
  _el: unknown,
  _rect: unknown,
  size: { contentSize: number[] },
) => {
  const [x, y] = point;
  const [width, height] = size.contentSize;
  const box = chartRendererRef.value?.chart?.getDom().getBoundingClientRect();
  if (!box) return [x + TOOLTIP_GAP, y + TOOLTIP_GAP];
  const fitsRight = box.left + x + TOOLTIP_GAP + width <= window.innerWidth;
  const fitsBelow = box.top + y + TOOLTIP_GAP + height <= window.innerHeight;
  return [
    fitsRight ? x + TOOLTIP_GAP : Math.max(x - TOOLTIP_GAP - width, -box.left),
    fitsBelow ? y + TOOLTIP_GAP : Math.max(y - TOOLTIP_GAP - height, -box.top),
  ];
};

const chartData = computed(() => {
  // Rebuilds when the zoom turns on or off, so the options carry the current window.
  void zoomed.value;
  const needle = props.searchQuery.trim();
  const { borderColor, matchBorder, matchTextBg } = colors.value;
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
      // In dark mode the ECharts theme draws its own background, which would box the graph in.
      backgroundColor: "transparent",
      tooltip: {
        // On the body, as dashboard charts do: the graph's scroll box would cut off a tooltip above the top row.
        appendToBody: true,
        // Gone at once (no 100 ms delay, no 0.4 s fade), so it never sits on top of the frame menu.
        hideDelay: 0,
        transitionDuration: 0,
        trigger: "item",
        position: tooltipPosition,
        backgroundColor: tokenColor("--color-surface-base", "--color-surface-panel"),
        borderColor: tokenColor("--color-border-default", "--color-border-strong"),
        textStyle: { color: tokenColor("--color-text-body", "--color-text-inverse") },
        extraCssText: "max-width: 28rem; white-space: normal; word-break: break-word;",
        formatter: (params) => {
          const block = (params as unknown as { data: { block: FlameBlock } }).data.block;
          const base = block.ancestor ? grandTotal.value : shareBase;
          const percentOf = (value: number, base: number) =>
            base > 0 ? `${((value / base) * 100).toFixed(2)}%` : "—";
          const sharePercent = (share: number) => `${(share * 100).toFixed(2)}%`;
          const row = (label: string, value: string, percent: string) => `
            <span>${escapeHtml(label)}</span>
            <span style="text-align: right;">${escapeHtml(value)}</span>
            <span style="text-align: right; opacity: 0.75;">${escapeHtml(percent)}</span>`;
          // A diff frame shows each side's time and share of its own total, then the change.
          const rows =
            block.beforeShare != null && block.afterShare != null
              ? row(
                  props.diffLabels?.baseline ?? "",
                  props.valueFormatter(block.beforeShare * (props.diffBaselineTotal ?? 0)),
                  sharePercent(block.beforeShare),
                ) +
                row(
                  props.diffLabels?.comparison ?? "",
                  props.valueFormatter(block.afterShare * diffComparisonTotal.value),
                  sharePercent(block.afterShare),
                ) +
                row(
                  t("profiles.diffChange"),
                  "",
                  formatPoints(block.afterShare - block.beforeShare),
                )
              : row(
                  t("profiles.total"),
                  props.valueFormatter(block.total),
                  percentOf(block.total, base),
                ) +
                row(
                  t("profiles.self"),
                  props.valueFormatter(block.self),
                  percentOf(block.self, base),
                ) +
                (block.callerTotal
                  ? row(t("profiles.shareOfCaller"), "", percentOf(block.total, block.callerTotal))
                  : "");
          return `
            <div style="padding: 0.25rem 0;">
              <div style="font-weight: 600; margin-bottom: 0.25rem;">${escapeHtml(block.label)}</div>
              <div style="display: grid; grid-template-columns: auto auto auto; column-gap: 1rem; font-size: 0.75rem; line-height: 1.5;">
                ${rows}
              </div>
              ${block.hint ? `<div style="font-size: 0.75rem; margin-top: 0.375rem; opacity: 0.8;">${escapeHtml(block.hint)}</div>` : ""}
              ${block.grouped || block.ancestor ? "" : `<div style="font-size: 0.75rem; margin-top: 0.375rem; opacity: 0.6;">${escapeHtml(t("profiles.frameClickHint"))}</div>`}
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
      // The window the wheel and drag handlers set; the chart's own wheel and drag stay off.
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "none",
          ...zoomWindow,
          zoomOnMouseWheel: false,
          moveOnMouseWheel: false,
          moveOnMouseMove: false,
          minSpan: ZOOM_MIN_SPAN,
        },
      ],
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
            // Zoomed in, draw only the part inside the plot, so a frame's label stays in view.
            const plot = params.coordSys as unknown as { x: number; width: number };
            const x = Math.max(point1[0], plot.x);
            const right = Math.min(point2[0], plot.x + plot.width);
            if (right <= x) return null;
            const y = depth * rowStep.value + 1;
            const rectWidth = Math.max(right - x, 1);
            const block = data[params.dataIndex].block as FlameBlock;
            const fill = data[params.dataIndex].itemStyle.color;
            const label =
              block.matched && needle ? buildHighlightedLabel(block.label, needle) : block.label;
            return {
              type: "rect",
              shape: {
                x,
                y,
                width: rectWidth,
                height: blockHeight.value,
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
