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
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { chartColor } from "@/utils/chartTheme";
import { hexLayout, type HexLayout } from "./hexLayout";
import { WHEEL_FACTOR, axisRanges, fit, isClick, pan, zoomAt, type ViewState } from "./hexViewport";
import { chipLabel, formatPct } from "./kubernetesModel";
import type { MapEntity, MapGroup } from "./kubernetesQueries";
import type { MapFill } from "./kubernetesUrlState";
import {
  FILL_LABEL,
  fillClass,
  fillValue,
  type FillClass,
  type MapRow,
  type RowGroup,
} from "./mapFill";

const props = defineProps<{
  entity: MapEntity;
  group: MapGroup;
  fill: MapFill;
  groups: RowGroup[];
  // One per group, drawn above its frame.
  frameLabels: string[];
  label: I18nText;
}>();

const emit = defineEmits<{ select: [row: MapRow] }>();

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

const NO_DATA = CLASSES.indexOf("noData");

// Pointy-top, matching hexLayout; the gap keeps neighbours apart.
const HEX_SCALE = 0.9;

const { t } = useI18nTyped();

const canvasRef = ref<HTMLElement | null>(null);
const size = shallowRef({ width: 0, height: 0 });
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

const layout = computed<HexLayout | null>(() =>
  size.value.width > 0 && size.value.height > 0
    ? hexLayout({
        entity: props.entity,
        group: props.group,
        groups: props.groups.map((g) => g.rows.map((r) => r.key)),
        width: size.value.width,
        height: size.value.height,
      })
    : null,
);

const fitState = computed(() =>
  layout.value ? fit(layout.value.bounds, size.value.width, size.value.height) : null,
);

const hexData = computed(() => {
  const l = layout.value;
  if (!l) return markRaw([] as number[][]);
  return markRaw(
    rows.value.map((row, i) => [l.x[i], l.y[i], CLASSES.indexOf(fillClass(row, props.fill))]),
  );
});

const frameData = computed(() =>
  markRaw(
    (layout.value?.frames ?? []).map((f, i) => [
      f.left,
      f.top,
      f.right,
      f.bottom,
      f.labelX,
      f.labelY,
      i,
    ]),
  ),
);

const tips = computed(() => markRaw(rows.value.map(tooltipOf)));

watch(
  [layout, () => size.value.width, () => size.value.height],
  () => {
    view.value = fitState.value;
  },
  { immediate: true },
);

watch([hexData, frameData, view], requestRender, { immediate: true });

onMounted(() => {
  const el = canvasRef.value;
  if (!el) return;
  measure();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(measure);
    observer.observe(el);
  }
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
}

function requestRender() {
  if (pending) return;
  pending = true;
  frame = requestAnimationFrame(() => {
    pending = false;
    options.value = buildOptions();
  });
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function fillText(row: MapRow): string {
  if (props.fill === "status") return "";
  const value = fillValue(row, props.fill);
  const cls = fillClass(row, props.fill);
  if (cls === "noData") return t("infra.k8s2.mapNoData");
  return props.fill === "restarts" ? String(value) : formatPct(value);
}

function tooltipOf(row: MapRow): string {
  const lines = [`<b>${escapeHtml(row.name)}</b>`];
  if (row.kind === "pod") {
    lines.push(escapeHtml(t("infra.k8s2.mapTipNamespace", { name: row.namespace })));
    const node = row.node || t("infra.k8s2.mapUnscheduled");
    lines.push(escapeHtml(t("infra.k8s2.mapTipNode", { name: node })));
  }
  if (props.fill !== "status") {
    const label = t(FILL_LABEL[props.fill]);
    lines.push(escapeHtml(t("infra.k8s2.mapTipValue", { label, value: fillText(row) })));
  }
  const status = row.status ? chipLabel(row.status, t) : t("infra.k8s2.mapNoData");
  lines.push(escapeHtml(t("infra.k8s2.mapTipStatus", { status })));
  return lines.join("<br/>");
}

function buildOptions() {
  const { width, height } = size.value;
  const state = view.value;
  if (!state || !width || !height) return {};
  const palette = CLASSES.map((c) => chartColor(CLASS_TOKEN[c]));
  const border = chartColor("--color-border-default");
  const labelColor = chartColor("--color-text-secondary");
  const labels = props.frameLabels;
  const tipList = tips.value;
  const range = axisRanges(state, width, height);
  return {
    animation: false,
    grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: false },
    xAxis: { type: "value", show: false, min: range.x[0], max: range.x[1] },
    yAxis: { type: "value", show: false, min: range.y[0], max: range.y[1] },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { seriesIndex: number; dataIndex: number }) =>
        p.seriesIndex === 0 ? (tipList[p.dataIndex] ?? "") : "",
    },
    series: [
      {
        type: "custom",
        progressive: 2000,
        clip: true,
        data: hexData.value,
        encode: { x: 0, y: 1 },
        renderItem: (_params: unknown, api: any) => {
          const [cx, cy] = api.coord([api.value(0), api.value(1)]);
          const unit = api.size([1, 1])[0] * HEX_SCALE;
          const cls = api.value(2);
          return {
            type: "polygon",
            shape: { points: hexPoints(cx, cy, unit) },
            style: {
              fill: palette[cls],
              stroke: cls === NO_DATA ? border : undefined,
              lineWidth: cls === NO_DATA ? 1 : 0,
            },
          };
        },
      },
      {
        type: "custom",
        silent: true,
        clip: true,
        z: 1,
        data: frameData.value,
        encode: { x: 0, y: 1 },
        renderItem: (_params: unknown, api: any) => {
          const [x0, y0] = api.coord([api.value(0), api.value(1)]);
          const [x1, y1] = api.coord([api.value(2), api.value(3)]);
          const [lx, ly] = api.coord([api.value(4), api.value(5)]);
          return {
            type: "group",
            children: [
              {
                type: "rect",
                shape: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, r: 4 },
                style: { fill: "transparent", stroke: border, lineWidth: 1 },
              },
              {
                type: "text",
                x: lx,
                y: ly,
                style: {
                  text: labels[api.value(6)] ?? "",
                  fill: labelColor,
                  // eslint-disable-next-line local/no-hardcoded-px -- canvas geometry
                  font: "12px sans-serif",
                  verticalAlign: "middle",
                  width: Math.max(0, x1 - lx),
                  overflow: "truncate",
                },
              },
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
    const [a, b] = [...pointers.values()];
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    pointers.set(e.pointerId, next);
    const [c, d] = [...pointers.values()];
    const after = Math.hypot(c.x - d.x, c.y - d.y);
    dragging = true;
    if (before > 0) zoomBy((c.x + d.x) / 2, (c.y + d.y) / 2, after / before);
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
  if (params.seriesIndex !== 0 || params.dataIndex == null) return;
  const row = rows.value[params.dataIndex];
  if (row) emit("select", row);
}

function resetZoom() {
  view.value = fitState.value;
}
</script>

<template>
  <div class="relative min-h-0 flex-1" data-test="k8s2-map">
    <div
      ref="canvasRef"
      class="absolute inset-0 touch-none"
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
    <OButton
      class="absolute end-2 top-2"
      variant="outline"
      size="xs"
      data-test="k8s2-map-reset"
      @click="resetZoom"
    >
      {{ t("infra.k8s2.mapResetZoom") }}
    </OButton>
  </div>
</template>
