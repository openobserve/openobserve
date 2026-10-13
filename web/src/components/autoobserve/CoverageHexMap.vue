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
  <div ref="rootRef" class="relative h-full w-full" data-test="autoobserve-coverage-hexmap">
    <svg
      v-if="size > 0"
      :width="layout.width"
      :height="layout.height"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      class="block overflow-visible"
      role="group"
      :aria-label="label"
    >
      <defs>
        <pattern
          :id="hatchId"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" class="fill-badge-default-soft-bg" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke-width="2"
            class="stroke-status-neutral-text/25"
          />
        </pattern>
      </defs>
      <g
        v-for="hex in layout.hexes"
        :key="hex.item.key"
        class="transition duration-150 hover:brightness-105 motion-safe:hover:-translate-y-0.5"
        :class="dimmed(hex.item) ? 'opacity-25' : ''"
      >
        <path
          :d="hex.path"
          :fill="hex.item.cls === 'learning' ? `url(#${hatchId})` : undefined"
          :tabindex="hex.item.key === tabStop ? 0 : -1"
          role="button"
          :aria-label="hex.item.name"
          :aria-pressed="hex.item.key === selected"
          class="focus-visible:stroke-text-heading cursor-pointer stroke-1 outline-none focus-visible:stroke-2"
          :class="FILL[hex.item.cls]"
          :data-test="`autoobserve-coverage-hex-${hex.item.key}`"
          @click="emit('select', hex.item.key)"
          @keydown="onKey($event, hex.item.key)"
          @pointerenter="show($event, hex.item)"
          @pointerleave="hide"
          @focus="show($event, hex.item)"
          @blur="hide"
        />
        <path
          v-if="hex.item.key === selected"
          :d="hex.ring"
          fill="none"
          stroke-width="2.5"
          class="stroke-accent pointer-events-none"
          data-test="autoobserve-coverage-hex-ring"
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
      <span class="text-text-heading text-sm font-semibold break-all">{{ hover.item.key }}</span>
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
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import type { I18nText } from "@/types/i18n";
import OText from "@/lib/core/Typography/OText.vue";
import { LINE_HEIGHT, canLabel, fitLabel, type MeasureText } from "./hexLabel";

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
  watched: "fill-badge-success-soft-text/15 stroke-badge-success-soft-text/30",
  learning: "stroke-status-neutral-text/60",
  gap: "fill-status-warning-text stroke-status-warning-text",
  none: "fill-status-neutral-text stroke-transparent",
  s1: "fill-map-seq-1 stroke-transparent",
  s2: "fill-map-seq-2 stroke-transparent",
  s3: "fill-map-seq-3 stroke-transparent",
  s4: "fill-map-seq-4 stroke-transparent",
  s5: "fill-map-seq-5 stroke-transparent",
};

const SWATCH: Record<HexClass, string> = {
  watched: "bg-badge-success-soft-text/15 border border-badge-success-soft-text/60",
  learning: "bg-badge-default-soft-bg border border-dashed border-status-neutral-text",
  gap: "bg-status-warning-text",
  none: "bg-status-neutral-text",
  s1: "bg-map-seq-1",
  s2: "bg-map-seq-2",
  s3: "bg-map-seq-3",
  s4: "bg-map-seq-4",
  s5: "bg-map-seq-5",
};

const LABEL: Record<HexClass, string> = {
  watched: "fill-banner-success-text",
  learning: "fill-text-heading",
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
const GAP = 4;
const MAX_W = 96;
const MIN_W = 32;
const BASE_COUNT = 50;
const CORNER = 0.14;
const MAX_FONT = 12;
const CARD_REM = 15;

const rootRef = ref<HTMLElement | null>(null);
const size = ref(0);
const hover = ref<{ item: HexItem; x: number; y: number } | null>(null);
const current = ref<string | null>(null);
const hatchId = `hex-hatch-${useId()}`;
let observer: ResizeObserver | null = null;

const measure = () => {
  if (rootRef.value) size.value = rootRef.value.clientWidth;
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

const hexPath = (cx: number, cy: number, r: number) => {
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  const at = (p: number[], q: number[]) =>
    `${(p[0] + (q[0] - p[0]) * CORNER).toFixed(2)},${(p[1] + (q[1] - p[1]) * CORNER).toFixed(2)}`;
  const corner = (p: number[], k: number) =>
    `${k ? "L" : "M"}${at(p, pts[(k + 5) % 6])}Q${p[0].toFixed(2)},${p[1].toFixed(2)} ${at(p, pts[(k + 1) % 6])}`;
  return `${pts.map(corner).join("")}Z`;
};

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
  const room = 0.74 * SQRT3 * r;
  if (!canLabel(room, measureText)) return null;
  return fitLabel(item.key, room, r, Math.min(MAX_FONT, 0.24 * r), measureText);
};

// Hexes shrink as the service count grows, then stretch so whole columns fill the width.
const grid = computed(() => {
  const n = Math.max(1, props.items.length);
  const width = Math.max(MIN_W, size.value - 2 * PAD);
  const target = Math.min(MAX_W, Math.max(MIN_W, MAX_W * Math.sqrt(BASE_COUNT / n)));
  const cols = Math.max(1, Math.min(n, Math.floor(width / target)));
  return { cols, hexW: Math.min(MAX_W, width / cols) };
});

// Odd rows hold one hex fewer and sit half a hex in, so neither edge overhangs.
const layout = computed(() => {
  const { cols, hexW } = grid.value;
  const R = hexW / SQRT3;
  const r = R - GAP / SQRT3;
  let row = 0;
  let col = 0;
  const hexes = props.items.map((item) => {
    if (col >= (row % 2 && cols > 1 ? cols - 1 : cols)) {
      row++;
      col = 0;
    }
    const cx = PAD + hexW / 2 + col * hexW + (row % 2 && cols > 1 ? hexW / 2 : 0);
    const cy = PAD + R + row * 1.5 * R;
    col++;
    return {
      item,
      row,
      cx,
      cy,
      path: hexPath(cx, cy, r),
      ring: hexPath(cx, cy, r + 2.5),
      label: labelFor(item, r),
    };
  });
  return {
    hexes,
    width: 2 * PAD + cols * hexW,
    height: 2 * PAD + 2 * R + row * 1.5 * R,
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

// Up and down land on the nearest hex in the neighbouring row, since rows alternate in length.
const verticalStep = (at: number, dir: number) => {
  const hexes = layout.value.hexes;
  const from = hexes[at];
  const row = hexes.filter((h) => h.row === from.row + dir);
  if (!row.length) return at;
  const near = row.reduce((a, b) => (Math.abs(b.cx - from.cx) < Math.abs(a.cx - from.cx) ? b : a));
  return hexes.indexOf(near);
};

const onKey = (e: KeyboardEvent, key: string) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emit("select", key);
    return;
  }
  const keys = order.value;
  const at = keys.indexOf(key);
  const last = keys.length - 1;
  const next: Record<string, () => number> = {
    ArrowRight: () => Math.min(last, at + 1),
    ArrowLeft: () => Math.max(0, at - 1),
    ArrowDown: () => verticalStep(at, 1),
    ArrowUp: () => verticalStep(at, -1),
    Home: () => 0,
    End: () => last,
  };
  if (!next[e.key]) return;
  e.preventDefault();
  focusKey(keys[next[e.key]()]);
};
</script>
