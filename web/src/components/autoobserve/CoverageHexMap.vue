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
    ref="rootRef"
    class="relative flex h-full w-full flex-col"
    data-test="autoobserve-coverage-hexmap"
  >
    <svg
      v-if="size.width > 0"
      :width="layout.width"
      :height="layout.height"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      class="m-auto shrink-0 overflow-visible"
      role="group"
      :aria-label="label"
    >
      <g
        v-for="hex in layout.hexes"
        :key="hex.item.key"
        :class="dimmed(hex.item) ? 'opacity-20' : ''"
      >
        <polygon
          :points="hex.points"
          :tabindex="hex.item.key === tabStop ? 0 : -1"
          role="button"
          :aria-label="hex.item.name"
          :aria-pressed="hex.item.key === selected"
          stroke-width="2"
          class="focus-visible:stroke-text-heading cursor-pointer stroke-transparent outline-none"
          :class="FILL[hex.item.cls]"
          :data-test="`autoobserve-coverage-hex-${hex.item.key}`"
          @click="emit('select', hex.item.key)"
          @keydown="onKey($event, hex.item.key)"
          @pointerenter="show($event, hex.item)"
          @pointerleave="hide"
          @focus="show($event, hex.item)"
          @blur="hide"
        />
        <polygon
          v-if="hex.item.key === selected"
          :points="hex.ring"
          fill="none"
          stroke-width="1.5"
          class="stroke-accent pointer-events-none"
        />
        <text
          v-if="hex.label"
          :font-size="hex.label.font"
          text-anchor="middle"
          dominant-baseline="central"
          aria-hidden="true"
          class="pointer-events-none font-medium select-none"
          :class="LABEL[hex.item.cls]"
        >
          <tspan
            v-for="(line, k) in hex.label.lines"
            :key="k"
            :x="hex.cx"
            :y="hex.cy + (k - (hex.label.lines.length - 1) / 2) * hex.label.font * LINE_HEIGHT"
            dominant-baseline="central"
          >
            {{ line }}
          </tspan>
        </text>
      </g>
    </svg>
    <div
      v-if="hover"
      class="bg-surface-overlay border-border-subtle rounded-surface pointer-events-none absolute z-10 flex w-60 flex-col gap-1 border p-2.5 text-xs shadow-md"
      :style="hoverStyle"
      aria-hidden="true"
      data-test="autoobserve-coverage-hover"
    >
      <span class="text-text-heading text-sm font-semibold">{{ hover.item.key }}</span>
      <span class="text-text-body flex items-center gap-1.5">
        <span class="size-2.5 shrink-0 rounded-full" :class="SWATCH[hover.item.stateCls]" />{{
          hover.item.state
        }}
      </span>
      <OText variant="mono" class="text-text-secondary">{{ hover.item.stream }}</OText>
      <span class="text-text-secondary">{{ hover.item.detectors }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { I18nText } from "@/types/i18n";
import OText from "@/lib/core/Typography/OText.vue";
import { canLabel, fitLabel, type MeasureText } from "./hexLabel";

export type HexClass = "watched" | "learning" | "gap" | "none" | "s1" | "s2" | "s3" | "s4" | "s5";

export interface HexItem {
  key: string;
  cls: HexClass;
  stateCls: HexClass;
  name: I18nText;
  state: I18nText;
  stream: string;
  detectors: I18nText;
}

const props = defineProps<{
  items: HexItem[];
  label: I18nText;
  selected: string | null;
  highlight: HexClass[];
  matches: Set<string> | null;
}>();

const emit = defineEmits<{ select: [key: string] }>();

const FILL: Record<HexClass, string> = {
  watched: "fill-badge-success-soft-text dark:fill-status-positive",
  learning: "fill-status-info-text",
  gap: "fill-status-warning-text",
  none: "fill-status-neutral-text",
  s1: "fill-map-seq-1",
  s2: "fill-map-seq-2",
  s3: "fill-map-seq-3",
  s4: "fill-map-seq-4",
  s5: "fill-map-seq-5",
};

const SWATCH: Record<HexClass, string> = {
  watched: "bg-badge-success-soft-text dark:bg-status-positive",
  learning: "bg-status-info-text",
  gap: "bg-status-warning-text",
  none: "bg-status-neutral-text",
  s1: "bg-map-seq-1",
  s2: "bg-map-seq-2",
  s3: "bg-map-seq-3",
  s4: "bg-map-seq-4",
  s5: "bg-map-seq-5",
};

const LABEL: Record<HexClass, string> = {
  watched: "fill-text-inverse",
  learning: "fill-text-inverse",
  gap: "fill-text-inverse",
  none: "fill-text-inverse",
  s1: "fill-text-heading dark:fill-text-inverse",
  s2: "fill-text-heading dark:fill-text-inverse",
  s3: "fill-text-heading dark:fill-text-inverse",
  s4: "fill-text-heading dark:fill-text-inverse",
  s5: "fill-text-heading dark:fill-text-inverse",
};

const SQRT3 = Math.sqrt(3);
const PAD = 4;
const MAX_R = 56;
const MIN_R = 7;
const LINE_HEIGHT = 1.15;
const R_STEP = 0.5;
const CARD_REM = 15;

const rootRef = ref<HTMLElement | null>(null);
const size = ref({ width: 0, height: 0 });
const hover = ref<{ item: HexItem; x: number; y: number } | null>(null);
const current = ref<string | null>(null);
let observer: ResizeObserver | null = null;

const measure = () => {
  const el = rootRef.value;
  if (el) size.value = { width: el.clientWidth, height: el.clientHeight };
};

onMounted(() => {
  measure();
  observer = new ResizeObserver(measure);
  if (rootRef.value) observer.observe(rootRef.value);
});

onBeforeUnmount(() => observer?.disconnect());

const hoverStyle = computed(() => ({
  left: `${hover.value?.x ?? 0}px`,
  top: `${hover.value?.y ?? 0}px`,
}));

const corners = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

const gridFor = (r: number, n: number, width: number) => {
  const hexW = SQRT3 * r;
  const cols = Math.max(1, Math.min(n, Math.floor((width - 2 * PAD - hexW / 2) / hexW)));
  const rows = Math.ceil(n / cols);
  return { cols, rows, height: 2 * PAD + 2 * r + (rows - 1) * 1.5 * r };
};

// Largest radius whose packed field fits the box; below the minimum the field scrolls instead.
const radius = computed(() => {
  const n = Math.max(1, props.items.length);
  const { width, height } = size.value;
  for (let r = MAX_R; r > MIN_R; r -= R_STEP) {
    if (gridFor(r, n, width).height <= height) return r;
  }
  return MIN_R;
});

let canvas: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

const measureText: MeasureText = (text, font) => {
  const key = `${font}|${text}`;
  const known = widths.get(key);
  if (known != null) return known;
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas || !rootRef.value) return text.length * font * 0.6;
  canvas.font = `500 ${font}px ${getComputedStyle(rootRef.value).fontFamily}`;
  const width = canvas.measureText(text).width;
  widths.set(key, width);
  return width;
};

const labelFor = (item: HexItem, r: number) => {
  // The straight sides of a pointy hex span its middle radius, so text stays inside that band.
  const room = 0.8 * SQRT3 * 0.92 * r;
  if (!canLabel(room, measureText)) return null;
  const problem = item.stateCls === "gap" || item.stateCls === "learning";
  return fitLabel(item.key, room, 0.92 * r, measureText, problem);
};

const layout = computed(() => {
  const r = radius.value;
  const hexW = SQRT3 * r;
  const { cols, rows, height } = gridFor(r, Math.max(1, props.items.length), size.value.width);
  const hexes = props.items.map((item, i) => {
    const row = Math.floor(i / cols);
    const cx = PAD + hexW / 2 + (i % cols) * hexW + (row % 2 ? hexW / 2 : 0);
    const cy = PAD + r + row * 1.5 * r;
    return {
      item,
      cx,
      cy,
      points: corners(cx, cy, r * 0.92),
      ring: corners(cx, cy, r * 1.04),
      label: labelFor(item, r),
    };
  });
  return {
    r,
    cols,
    hexes,
    width: 2 * PAD + cols * hexW + (rows > 1 ? hexW / 2 : 0),
    height,
  };
});

const order = computed(() => props.items.map((i) => i.key));

const tabStop = computed(
  () => [current.value, props.selected].find((k) => k && order.value.includes(k)) ?? order.value[0],
);

const dimmed = (item: HexItem) =>
  (props.highlight.length > 0 && !props.highlight.includes(item.cls)) ||
  (props.matches != null && !props.matches.has(item.key));

const show = (e: Event, item: HexItem) => {
  if (e.type === "focus") current.value = item.key;
  const root = rootRef.value?.getBoundingClientRect();
  const hex = (e.target as Element).getBoundingClientRect();
  if (!root) return;
  const x = Math.min(hex.right - root.left + 4, root.width - 16 * CARD_REM);
  hover.value = { item, x: Math.max(0, x), y: hex.bottom - root.top + 4 };
};

const hide = () => {
  hover.value = null;
};

const focusKey = (key: string) => {
  rootRef.value
    ?.querySelector<SVGElement>(`[data-test="autoobserve-coverage-hex-${CSS.escape(key)}"]`)
    ?.focus();
};

const onKey = (e: KeyboardEvent, key: string) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emit("select", key);
    return;
  }
  const step: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: layout.value.cols,
    ArrowUp: -layout.value.cols,
  };
  const keys = order.value;
  const at = keys.indexOf(key);
  let next: number | null = null;
  if (step[e.key]) next = Math.min(keys.length - 1, Math.max(0, at + step[e.key]));
  if (e.key === "Home") next = 0;
  if (e.key === "End") next = keys.length - 1;
  if (next == null) return;
  e.preventDefault();
  focusKey(keys[next]);
};
</script>
