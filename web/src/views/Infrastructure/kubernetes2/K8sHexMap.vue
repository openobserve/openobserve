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

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { format } from "echarts/core";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import useTheme from "@/composables/useTheme";
import { chartColor } from "@/utils/chartTheme";
import { LABEL_BAND, hexLayout, middleTruncate, type HexLayout } from "./hexLayout";
import {
  MAX_ZOOM,
  PAD_SHARE,
  WHEEL_FACTOR,
  axisRanges,
  fit,
  isClick,
  pan,
  pinch,
  zoomAt,
  type ViewState,
} from "./hexViewport";
import { nodeCard, podCard, tooltipStyle } from "./hoverCard";
import type { MapEntity, MapGroup } from "./kubernetesQueries";
import { isLabelGroup, type MapFill } from "./kubernetesUrlState";
import {
  fillClass,
  type FillClass,
  type GroupHeader,
  type MapRow,
  type RowGroup,
  type StatusClass,
} from "./mapFill";

const props = defineProps<{
  entity: MapEntity;
  group: MapGroup;
  fill: MapFill;
  groups: RowGroup[];
  headers: GroupHeader[];
  highlight: FillClass[];
  selectedKey: string | null;
  label: I18nText;
}>();

const emit = defineEmits<{ select: [row: MapRow]; header: [index: number] }>();

const CLASSES: readonly FillClass[] = [
  "b1",
  "b2",
  "b3",
  "b4",
  "b5",
  "ok",
  "warning",
  "error",
  "noData",
];

const CLASS_TOKEN: Record<FillClass, `--${string}`> = {
  b1: "--color-map-seq-1",
  b2: "--color-map-seq-2",
  b3: "--color-map-seq-3",
  b4: "--color-map-seq-4",
  b5: "--color-map-seq-5",
  ok: "--color-status-positive",
  warning: "--color-status-warning-text",
  error: "--color-status-negative",
  noData: "--color-surface-subtle",
};

const GLYPH: Record<StatusClass, string> = { error: "✕", warning: "!", ok: "✓" };

const NO_DATA = CLASSES.indexOf("noData");

const HEX_SCALE = 0.9;

const ZOOM_STEP = 1.5;

const DIMMED = 0.2;

// eslint-disable-next-line local/no-hardcoded-px -- canvas geometry
const TITLE_FONT = "600 13px sans-serif";

// eslint-disable-next-line local/no-hardcoded-px -- canvas geometry
const COUNT_FONT = "400 12px sans-serif";

// eslint-disable-next-line local/no-hardcoded-px -- canvas geometry
const SUMMARY_FONT = "400 11px sans-serif";

// Header text is fixed-size while the band scales, so each line needs a minimum band height.
const LINE_ONE_MIN_PX = 16;

const LINE_TWO_MIN_PX = 34;

const HEADER_PAD_PX = 8;

const LINE_OFFSET_PX = 8;

const CARD_RADIUS_PX = 12;

const TITLE_CHARS = 18;

const SAMPLE_TEXT = "abcdefghijklmnopqrstuvwxyz-0123456789";

// Both header lines show at this scale.
const TALL_SCALE = LINE_TWO_MIN_PX / LABEL_BAND;

// Literal classes, so Tailwind emits them; a tall canvas takes the first that fits its content.
const TALL_HEIGHTS = [
  { rem: 24, cls: "h-96" },
  { rem: 32, cls: "h-128" },
  { rem: 48, cls: "h-192" },
  { rem: 64, cls: "h-256" },
  { rem: 80, cls: "h-320" },
  { rem: 96, cls: "h-384" },
  { rem: 112, cls: "h-448" },
  { rem: 128, cls: "h-512" },
  { rem: 144, cls: "h-576" },
  { rem: 160, cls: "h-640" },
  { rem: 176, cls: "h-704" },
  { rem: 192, cls: "h-768" },
  { rem: 208, cls: "h-832" },
  { rem: 224, cls: "h-896" },
  { rem: 240, cls: "h-960" },
  { rem: 256, cls: "h-1024" },
];

// 16px is the CSS default root size when no stylesheet sets one.
const DEFAULT_REM_PX = 16;

const { t } = useI18nTyped();
const { isDark } = useTheme();
const { isMobile } = useBreakpoint();

const canvasRef = ref<HTMLElement | null>(null);
const legendRef = ref<HTMLElement | null>(null);
const zoomRef = ref<HTMLElement | null>(null);
const size = shallowRef({ width: 0, height: 0 });
const bottomInset = ref(0);
const view = shallowRef<ViewState | null>(null);
const options = shallowRef<Record<string, any>>({});

let frame = 0;
let pending = false;
let observer: ResizeObserver | null = null;
const pointers = new Map<number, { x: number; y: number }>();
let press: { x: number; y: number } | null = null;
let dragging = false;
let suppressClick = false;

const rows = computed(() => markRaw(props.groups.flatMap((g) => g.rows)));

const tall = computed(
  () =>
    isMobile.value &&
    (props.group === "workload" || props.group === "namespace" || isLabelGroup(props.group)),
);

const layout = computed<HexLayout | null>(() =>
  size.value.width > 0 && size.value.height > 0
    ? hexLayout({
        entity: props.entity,
        group: props.group,
        groups: props.groups.map((g) => g.rows.map((r) => r.key)),
        width: size.value.width,
        height: size.value.height,
        bottomInset: bottomInset.value,
        minFramePx: tall.value
          ? twoColumnCardPx()
          : props.group === "workload"
            ? workloadCardPx()
            : 0,
        minBandPx: LINE_ONE_MIN_PX,
        fixedScale: tall.value ? TALL_SCALE : undefined,
      })
    : null,
);

const tallHeightClass = computed(() => {
  const l = layout.value;
  if (!tall.value || !l) return null;
  const rem = remPx();
  const needed =
    (l.bounds.maxY - l.bounds.minY) * TALL_SCALE +
    2 * PAD_SHARE * size.value.width +
    bottomInset.value;
  return (
    TALL_HEIGHTS.find((h) => h.rem * rem >= needed)?.cls ??
    TALL_HEIGHTS[TALL_HEIGHTS.length - 1].cls
  );
});

// A height step leaves slack below the content, so a tall map is top-aligned, not centred.
const fitState = computed(() => {
  const l = layout.value;
  if (!l) return null;
  const state = fit(l.bounds, size.value.width, size.value.height, bottomInset.value);
  if (!tallHeightClass.value) return state;
  const pad = PAD_SHARE * size.value.width;
  return { ...state, cy: l.bounds.maxY + (pad - size.value.height / 2) / state.scale };
});

const hexData = computed(() => {
  const l = layout.value;
  if (!l) return markRaw([] as number[][]);
  const lit = new Set(props.highlight);
  return markRaw(
    rows.value.map((row, i) => {
      const cls = fillClass(row, props.fill);
      return [
        l.x[i],
        l.y[i],
        CLASSES.indexOf(cls),
        Number(row.key === props.selectedKey),
        Number(lit.size > 0 && !lit.has(cls)),
      ];
    }),
  );
});

const frameData = computed(() =>
  markRaw(
    (layout.value?.frames ?? []).map((f, i) => [
      f.left,
      f.top,
      f.right,
      f.bottom,
      f.headerBottom,
      i,
    ]),
  ),
);

const atFit = computed(
  () => !!view.value && !!fitState.value && view.value.scale <= fitState.value.scale * (1 + 1e-9),
);

const atMax = computed(
  () =>
    !!view.value &&
    !!fitState.value &&
    view.value.scale >= fitState.value.scale * MAX_ZOOM * (1 - 1e-9),
);

watch(
  [layout, () => size.value.width, () => size.value.height],
  () => {
    view.value = fitState.value;
  },
  { immediate: true },
);

watch([hexData, frameData, view, () => props.headers, isDark], requestRender, { immediate: true });

onMounted(() => {
  measure();
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(measure);
  for (const el of [canvasRef.value, legendRef.value, zoomRef.value]) if (el) observer.observe(el);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (pending) cancelAnimationFrame(frame);
});

function measure() {
  const el = canvasRef.value;
  if (!el) return;
  const next = { width: el.clientWidth, height: el.clientHeight };
  if (next.width !== size.value.width || next.height !== size.value.height) size.value = next;
  const rem = remPx();
  const overlay = Math.max(legendRef.value?.offsetHeight ?? 0, zoomRef.value?.offsetHeight ?? 0);
  bottomInset.value = overlay + rem;
}

function requestRender() {
  if (pending) return;
  pending = true;
  frame = requestAnimationFrame(() => {
    pending = false;
    options.value = buildOptions();
  });
}

function twoColumnCardPx() {
  return (size.value.width * (1 - 2 * PAD_SHARE) - TALL_SCALE) / 2;
}

function remPx() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || DEFAULT_REM_PX;
}

// Line 1 must always show a workload name, so its card fits ~18 average title characters.
function workloadCardPx() {
  const perChar = textWidth(SAMPLE_TEXT, TITLE_FONT) / SAMPLE_TEXT.length;
  return TITLE_CHARS * perChar + textWidth("99", COUNT_FONT) + 3 * HEADER_PAD_PX;
}

// Built on hover, so a search over thousands of pods does not rebuild every card.
function rowTip(row: MapRow | undefined, fill: MapFill) {
  if (!row) return "";
  return row.kind === "pod" ? podCard(row, fill, t, Date.now() * 1000) : nodeCard(row, t);
}

function textWidth(text: string, font: string) {
  return format.getTextRect(text, font).width;
}

function summaryText(header: GroupHeader) {
  const word = header.word ? `{${header.word.tone ?? "neutral"}|${header.word.text}}  ` : "";
  const counts = header.summary.map(
    (s) => `{${s.count === 0 ? "neutral" : s.cls}|${GLYPH[s.cls]} ${s.count}}`,
  );
  return word + counts.join("  ");
}

function headerTexts(
  header: GroupHeader | undefined,
  box: number[],
  colors: Record<string, string>,
) {
  const [x0, x1, y0, band] = box;
  if (!header || band < LINE_ONE_MIN_PX) return [];
  const twoLines = band >= LINE_TWO_MIN_PX;
  const lineOne = twoLines ? y0 + band / 2 - LINE_OFFSET_PX : y0 + band / 2;
  const countWidth = textWidth(header.count, COUNT_FONT);
  const titleWidth = x1 - x0 - 3 * HEADER_PAD_PX - countWidth;
  const base = { type: "text", silent: true };
  const out: Record<string, any>[] = [
    {
      ...base,
      x: x0 + HEADER_PAD_PX,
      y: lineOne,
      style: {
        text: middleTruncate(header.title, titleWidth, (s) => textWidth(s, TITLE_FONT)),
        fill: colors.heading,
        font: TITLE_FONT,
        verticalAlign: "middle",
      },
    },
    {
      ...base,
      x: x1 - HEADER_PAD_PX,
      y: lineOne,
      style: {
        text: header.count,
        fill: colors.secondary,
        font: COUNT_FONT,
        align: "right",
        verticalAlign: "middle",
      },
    },
  ];
  if (twoLines) {
    const rich = Object.fromEntries(
      ["error", "warning", "ok", "neutral"].map((k) => [
        k,
        { fill: colors[k], font: SUMMARY_FONT },
      ]),
    );
    out.push({
      ...base,
      x: x0 + HEADER_PAD_PX,
      y: y0 + band / 2 + LINE_OFFSET_PX,
      style: {
        text: summaryText(header),
        rich,
        fill: colors.secondary,
        font: SUMMARY_FONT,
        verticalAlign: "middle",
        width: Math.max(0, x1 - x0 - 2 * HEADER_PAD_PX),
        overflow: "truncate",
      },
    });
  }
  return out;
}

function buildOptions() {
  const { width, height } = size.value;
  const state = view.value;
  if (!state || !width || !height) return {};
  const palette = CLASSES.map((c) => chartColor(CLASS_TOKEN[c]));
  const accent = chartColor("--color-accent");
  const border = chartColor("--color-border-default");
  const card = {
    fill: chartColor("--color-surface-base"),
    band: chartColor("--color-surface-panel"),
    stroke: chartColor("--color-border-subtle"),
    hover: chartColor("--color-border-strong"),
  };
  const colors: Record<string, string> = {
    heading: chartColor("--color-text-heading"),
    secondary: chartColor("--color-text-secondary"),
    neutral: chartColor("--color-text-secondary"),
    error: chartColor(CLASS_TOKEN.error),
    warning: chartColor(CLASS_TOKEN.warning),
    ok: chartColor(CLASS_TOKEN.ok),
  };
  const headers = props.headers;
  const rowList = rows.value;
  const fill = props.fill;
  const range = axisRanges(state, width, height);
  return {
    animation: false,
    grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: false },
    xAxis: { type: "value", show: false, min: range.x[0], max: range.x[1] },
    yAxis: { type: "value", show: false, min: range.y[0], max: range.y[1] },
    tooltip: {
      trigger: "item",
      confine: true,
      ...tooltipStyle(),
      formatter: (p: { seriesIndex: number; dataIndex: number }) =>
        (p.seriesIndex === 0 ? rowTip(rowList[p.dataIndex], fill) : headers[p.dataIndex]?.tip) ??
        "",
    },
    series: [
      {
        type: "custom",
        progressive: 2000,
        clip: true,
        z: 2,
        data: hexData.value,
        encode: { x: 0, y: 1 },
        renderItem: (_params: unknown, api: any) => {
          const [cx, cy] = api.coord([api.value(0), api.value(1)]);
          const unit = api.size([1, 1])[0] * HEX_SCALE;
          const cls = api.value(2);
          const selected = api.value(3) === 1;
          return {
            type: "polygon",
            shape: { points: hexPoints(cx, cy, unit) },
            z2: selected ? 10 : 0,
            cursor: "pointer",
            style: {
              fill: palette[cls],
              stroke: selected ? accent : cls === NO_DATA ? border : undefined,
              lineWidth: selected ? 2.5 : cls === NO_DATA ? 1 : 0,
              opacity: api.value(4) === 1 ? DIMMED : 1,
            },
            emphasis: { style: { stroke: accent, lineWidth: 2 } },
          };
        },
      },
      {
        type: "custom",
        clip: true,
        z: 1,
        data: frameData.value,
        encode: { x: 0, y: 1 },
        renderItem: (_params: unknown, api: any) => {
          const [x0, y0] = api.coord([api.value(0), api.value(1)]);
          const [x1, y1] = api.coord([api.value(2), api.value(3)]);
          const [, yb] = api.coord([api.value(0), api.value(4)]);
          const header = headers[api.value(5)];
          const r = Math.min(CARD_RADIUS_PX, 0.15 * (y1 - y0));
          return {
            type: "group",
            children: [
              {
                type: "rect",
                silent: true,
                shape: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, r },
                style: { fill: card.fill, stroke: card.stroke, lineWidth: 1 },
                emphasis: { style: { stroke: card.hover } },
              },
              {
                type: "rect",
                cursor: header?.clickable ? "pointer" : "default",
                shape: {
                  x: x0 + 1,
                  y: y0 + 1,
                  width: x1 - x0 - 2,
                  height: yb - y0 - 1,
                  r: [r, r, 0, 0],
                },
                style: { fill: card.band },
                emphasis: { style: { fill: card.band } },
              },
              ...headerTexts(header, [x0, x1, y0, yb - y0], colors),
            ],
          };
        },
      },
    ],
  };
}

function hexPoints(cx: number, cy: number, radius: number) {
  const points: number[][] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 3) * k + Math.PI / 6;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function local(e: { clientX: number; clientY: number }) {
  const rect = canvasRef.value?.getBoundingClientRect();
  return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
}

function zoomBy(px: number, py: number, factor: number) {
  const fitScale = fitState.value?.scale;
  if (!view.value || !fitScale) return;
  view.value = zoomAt(view.value, px, py, factor, { ...size.value, fit: fitScale });
}

function zoomStep(factor: number) {
  zoomBy(size.value.width / 2, size.value.height / 2, factor);
}

function onWheel(e: WheelEvent) {
  const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
  const { x, y } = local(e);
  zoomBy(x, y, Math.pow(WHEEL_FACTOR, -notches));
}

function onPointerDown(e: PointerEvent) {
  pointers.set(e.pointerId, local(e));
  press = local(e);
  dragging = false;
  suppressClick = false;
}

function onPointerMove(e: PointerEvent) {
  const prev = pointers.get(e.pointerId);
  if (!prev || !view.value) return;
  const next = local(e);
  if (pointers.size >= 2) {
    const from = [...pointers.values()].slice(0, 2);
    pointers.set(e.pointerId, next);
    const to = [...pointers.values()].slice(0, 2);
    dragging = true;
    const fitScale = fitState.value?.scale;
    if (fitScale) view.value = pinch(view.value, from, to, { ...size.value, fit: fitScale });
    return;
  }
  pointers.set(e.pointerId, next);
  if (!dragging && press && !isClick(next.x - press.x, next.y - press.y)) dragging = true;
  if (dragging) view.value = pan(view.value, next.x - prev.x, next.y - prev.y);
}

function onPointerEnd(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    suppressClick = dragging;
    dragging = false;
    press = null;
  }
}

function onChartClick(params: { seriesIndex?: number; dataIndex?: number }) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (params.dataIndex == null) return;
  if (params.seriesIndex === 1) {
    if (props.headers[params.dataIndex]?.clickable) emit("header", params.dataIndex);
    return;
  }
  const row = params.seriesIndex === 0 ? rows.value[params.dataIndex] : null;
  if (row) emit("select", row);
}

function resetZoom() {
  view.value = fitState.value;
}
</script>

<template>
  <div
    class="relative"
    :class="tallHeightClass ? ['w-full', 'shrink-0', tallHeightClass] : ['min-h-0', 'flex-1']"
    data-test="k8s2-map"
  >
    <!-- On a tall canvas a vertical swipe has to scroll the page, not pan the map. -->
    <div
      ref="canvasRef"
      class="absolute inset-0"
      :class="tallHeightClass ? 'touch-pan-y' : 'touch-none'"
      role="img"
      :aria-label="label"
      data-test="k8s2-map-canvas"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
      @pointerleave="onPointerEnd"
    >
      <!-- ChartRenderer, not PanelSchemaRenderer: hex clicks must be forwarded to open the drawer. -->
      <ChartRenderer :data="{ options }" @click="onChartClick" />
    </div>
    <div
      v-if="$slots.legend"
      ref="legendRef"
      class="bg-surface-overlay border-border-subtle rounded-surface absolute start-3 bottom-3 flex max-w-[calc(100%-10rem)] items-center gap-2 overflow-x-auto border px-3 py-1.5 whitespace-nowrap shadow-sm max-md:max-w-[calc(100%-4.5rem)]"
      data-test="k8s2-map-legend"
    >
      <slot name="legend" />
    </div>
    <div
      ref="zoomRef"
      class="bg-surface-overlay border-border-subtle rounded-surface absolute end-3 bottom-3 flex items-center border shadow-sm"
      data-test="k8s2-map-zoom"
    >
      <OButton
        class="max-md:hidden"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('infra.k8s2.mapZoomIn')"
        :disabled="atMax"
        data-test="k8s2-map-zoom-in"
        @click="zoomStep(ZOOM_STEP)"
      >
        <OIcon name="add" size="sm" />
      </OButton>
      <OButton
        class="max-md:hidden"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('infra.k8s2.mapZoomOut')"
        :disabled="atFit"
        data-test="k8s2-map-zoom-out"
        @click="zoomStep(1 / ZOOM_STEP)"
      >
        <OIcon name="remove" size="sm" />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-sm"
        :aria-label="t('infra.k8s2.mapFit')"
        data-test="k8s2-map-fit"
        @click="resetZoom"
      >
        <OIcon name="fit-screen" size="sm" />
      </OButton>
    </div>
  </div>
</template>
