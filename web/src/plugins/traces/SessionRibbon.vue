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

<!--
  SessionRibbon — one bar per turn, toggled between Cost / Latency / Tokens.
  Custom CSS bars (no charting lib) because the data is already in memory
  (traces[]) and each bar needs the rich TurnPreviewCard hover — Panel chrome + bar colours match the
-->
<template>
  <div
    class="bg-card-glass-bg rounded-default border-border-default flex flex-col border px-4 pt-4 pb-2.5"
    data-test="session-ribbon"
  >
    <!-- Header: title + subtitle (left) · metric toggle (right) -->
    <div class="mb-3 flex items-baseline justify-between gap-2">
      <div>
        <div class="text-text-heading text-sm font-semibold">
          {{ t("traces.sessionDetail.ribbon.title") }}
        </div>
        <div class="text-2xs text-text-secondary mt-[0.1rem] leading-normal">
          {{ t("traces.sessionDetail.ribbon.subtitle") }}
        </div>
      </div>
      <OToggleGroup v-model="metric" class="flex-shrink-0">
        <OToggleGroupItem value="cost" size="sm">
          {{ t("traces.sessionDetail.kpi.cost") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="latency" size="sm">
          {{ t("traces.sessionDetail.kpi.duration") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="tokens" size="sm">
          {{ t("traces.sessionDetail.kpi.tokens") }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Detail ribbon fills the remaining panel height. The chart region
         (y-axis + bars) grows; the x-axis row sits beneath it, offset by the
         y-axis width so the turn numbers stay aligned under their bars. Shows the
         whole session when it fits, otherwise just the selected window. -->
    <div class="flex min-h-0 flex-1 flex-col">
      <!-- chart region: y-axis labels + bars, sharing the grown height -->
      <div class="flex min-h-0 flex-1 gap-2">
        <div
          class="text-3xs text-text-muted flex h-full w-11 flex-shrink-0 flex-col items-end justify-between tabular-nums"
        >
          <span>{{ maxLabel }}</span>
          <span>{{ midLabel }}</span>
          <span>{{ t('traces.sessionDetail.axisZeroLabel') }}</span>
        </div>

        <div
          class="border-border-default relative flex min-h-0 min-w-0 flex-1 items-end gap-0.75 border-b border-l"
        >
          <!-- gridlines (top + mid) to echo the dashboard chart grid -->
          <div class="border-border-default absolute inset-x-0 top-0 border-t opacity-60" />
          <div class="border-border-default absolute inset-x-0 top-1/2 border-t opacity-40" />

          <TurnPreviewCard
            v-for="bar in detailBars"
            :key="bar.index"
            :turn="bar.turn"
            :index="bar.index"
            :cache-pct="cachePct"
            :delay="40"
          >
            <div
              class="rounded-t-default relative min-w-0 flex-1 cursor-pointer transition-[height] duration-300 ease-out hover:brightness-110"
              :style="{ height: bar.pct + '%', background: bar.color }"
              @click="emit('jump', bar.index + 1)"
            />
          </TurnPreviewCard>
        </div>
      </div>

      <!-- x-axis + title, offset by the y-axis column width so the numbers stay
           aligned under their bars. With the window capped at WINDOW turns, every
           visible bar is wide enough to print its turn number. -->
      <div class="flex flex-shrink-0 gap-2">
        <div class="w-11 flex-shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="mt-1 flex gap-0.75">
            <span
              v-for="bar in detailBars"
              :key="bar.index"
              class="text-3xs text-text-muted min-w-0 flex-1 text-center tabular-nums"
            >
              {{ detailLabeled.has(bar.index + 1) ? bar.index + 1 : "" }}
            </span>
          </div>

          <!-- x-axis title — matches the dashboard axis name (nameLocation
               "middle" + nameTextStyle bold/14px). -->
          <div class="text-text-heading mt-1 text-center text-sm font-bold">
            {{ t("traces.sessionDetail.turnLabel") }}
          </div>
        </div>
      </div>
    </div>

    <!-- Overview (focus + context): the whole session as a thin minimap, sitting
         below the chart's Turn axis. Drag the highlighted window to pan, click
         anywhere to jump it there, or drag an edge to resize. The detailed,
         labelled ribbon above shows just that window. Only rendered when there
         are more turns than fit. Offset by the y-axis width so the minimap lines
         up with the bars above. -->
    <div v-if="windowed" class="mt-2.5 flex flex-shrink-0 gap-2">
      <div class="w-11 flex-shrink-0" />
      <div
        ref="overviewTrackRef"
        class="relative flex h-6.5 min-w-0 flex-1 touch-none items-end gap-px select-none"
        :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
        @pointerdown="onTrackPointerDown"
        data-test="session-ribbon-overview"
      >
        <div
          v-for="bar in bars"
          :key="bar.index"
          class="rounded-t-default min-w-0 flex-1 transition-opacity"
          :style="{
            height: Math.max(2, bar.pct) + '%',
            background: bar.color,
            opacity: bar.index >= windowStart && bar.index < windowEnd ? 1 : 0.3,
          }"
        />
        <!-- selected window: drag the body to pan, or either edge to resize -->
        <div
          class="rounded-default absolute top-0 bottom-0 border border-[color-mix(in_srgb,var(--color-text-heading)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-text-heading)_8%,transparent)]"
          :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
          :style="{ left: brushLeftPct + '%', width: brushWidthPct + '%' }"
          @pointerdown.stop="(e) => beginDrag('pan', e)"
        >
          <!-- left resize handle (overhangs the edge so it's easy to grab) -->
          <div
            class="absolute top-0 bottom-0 -left-1 flex w-2.25 cursor-ew-resize items-center justify-center"
            @pointerdown.stop="(e) => beginDrag('resize-left', e)"
          >
            <div
              class="rounded-default h-[55%] w-0.5 bg-[color-mix(in_srgb,var(--color-text-heading)_60%,transparent)]"
            />
          </div>
          <!-- right resize handle -->
          <div
            class="absolute top-0 -right-1 bottom-0 flex w-2.25 cursor-ew-resize items-center justify-center"
            @pointerdown.stop="(e) => beginDrag('resize-right', e)"
          >
            <div
              class="rounded-default h-[55%] w-0.5 bg-[color-mix(in_srgb,var(--color-text-heading)_60%,transparent)]"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import TurnPreviewCard from "./TurnPreviewCard.vue";
import type { SessionTraceRow } from "./composables/useSessions";
import { splitCost, splitDuration, splitNumberWithUnit } from "./llmInsightsDashboard.utils";

const props = defineProps<{
  traces: SessionTraceRow[];
  /** Session-level cache reuse percentage forwarded to hover cards. */
  cachePct: number;
}>();

// Emitted when a bar is clicked — the parent scrolls/expands that turn (S5).
const emit = defineEmits<{ (e: "jump", turn: number): void }>();

const { t } = useI18n();

type Metric = "cost" | "latency" | "tokens";
const metric = ref<Metric>("cost");

// Bar colours match the LLM Insights dashboard chart palette (hex, as the panel
// defs use). Error turns are always red regardless of the selected metric.
const COLORS: Record<Metric | "error", string> = {
  cost: "#3b82f6",
  latency: "#f97316",
  tokens: "#a855f7",
  error: "#ef4444",
};

function metricValue(row: SessionTraceRow): number {
  if (metric.value === "cost") return row.cost;
  if (metric.value === "latency") return row.durationNanos;
  return row.tokens;
}

function formatMetric(v: number): string {
  if (metric.value === "cost") {
    const c = splitCost(v);
    return `${c.value}${c.unit}`;
  }
  if (metric.value === "latency") {
    if (!v) return "0";
    const d = splitDuration(v / 1000);
    return `${d.value}${d.unit}`;
  }
  const tk = splitNumberWithUnit(v);
  return `${tk.value}${tk.unit}`;
}

const maxValue = computed(() => {
  const vals = props.traces.map(metricValue);
  return vals.length ? Math.max(...vals) : 0;
});

const maxLabel = computed(() => formatMetric(maxValue.value));
const midLabel = computed(() => formatMetric(maxValue.value / 2));

const bars = computed(() =>
  props.traces.map((turn, index) => {
    const v = metricValue(turn);
    const pct = maxValue.value > 0 ? Math.max(2, (v / maxValue.value) * 100) : 2;
    return {
      turn,
      index,
      pct,
      color: turn.status === "error" ? COLORS.error : COLORS[metric.value],
    };
  }),
);

// ── Focus + context (brush-to-zoom) ─────────────────────────────────────────
// A many-turn session won't fit as readable, labelled bars in one strip. Rather
// than page through it, we keep a thin OVERVIEW of the whole session on top with
// a draggable, RESIZABLE window, and render just that window as the detailed
// ribbon below — so you get the whole-session shape AND legible turns at once.
const DEFAULT_WINDOW = 20;
const MIN_WINDOW = 5;
// Hard cap on how wide the window can be resized — past this the detail bars get
// too thin to read, which is the very thing the window is meant to avoid.
const MAX_WINDOW = 40;
const total = computed(() => bars.value.length);
// Overview + window mode kicks in only when there are more turns than the
// default window; at or below it the detail ribbon just shows them all.
const windowed = computed(() => total.value > DEFAULT_WINDOW);

// How many turns the window spans (user-resizable, MIN_WINDOW..MAX_WINDOW) and
// where it starts.
const windowSize = ref(DEFAULT_WINDOW);
const windowStart = ref(0);
// Largest window this session allows: never more than MAX_WINDOW, nor more turns
// than exist.
const sizeCap = computed(() =>
  Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, total.value || MIN_WINDOW)),
);
// Clamp the desired size to [MIN_WINDOW, sizeCap].
const effectiveWindow = computed(() =>
  Math.min(Math.max(windowSize.value, MIN_WINDOW), sizeCap.value),
);
const maxStart = computed(() => Math.max(0, total.value - effectiveWindow.value));
const windowEnd = computed(() => windowStart.value + effectiveWindow.value); // exclusive

// Reset to the default window at the start whenever the session changes.
watch(total, () => {
  windowStart.value = 0;
  windowSize.value = DEFAULT_WINDOW;
});

// Turns rendered in the detailed ribbon: the whole session when it fits,
// otherwise just the selected window.
const detailBars = computed(() => bars.value.slice(windowStart.value, windowEnd.value));

// Brush rectangle geometry, as percentages of the overview width.
const brushLeftPct = computed(() => (total.value ? (windowStart.value / total.value) * 100 : 0));
const brushWidthPct = computed(() =>
  total.value ? (effectiveWindow.value / total.value) * 100 : 100,
);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ── Drag the window: pan the body, or resize from either edge ───────────────
const overviewTrackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
type DragMode = "pan" | "resize-left" | "resize-right";
let dragState: {
  mode: DragMode;
  startX: number;
  startStart: number;
  startSize: number;
  trackLeft: number;
  trackWidth: number;
} | null = null;

// Turn index under the given client X (fractional), using the geometry captured
// at drag start.
function turnAtClientX(clientX: number): number {
  if (!dragState) return 0;
  return ((clientX - dragState.trackLeft) / dragState.trackWidth) * total.value;
}

function beginDrag(mode: DragMode, e: PointerEvent) {
  const el = overviewTrackRef.value;
  if (!el || total.value === 0) return;
  e.preventDefault();
  const rect = el.getBoundingClientRect();
  dragState = {
    mode,
    startX: e.clientX,
    startStart: windowStart.value,
    startSize: effectiveWindow.value,
    trackLeft: rect.left,
    trackWidth: rect.width,
  };
  dragging.value = true;
  document.body.style.cursor = mode === "pan" ? "grabbing" : "ew-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

// Click on the bare track recenters the window there, then pans from the grab.
function onTrackPointerDown(e: PointerEvent) {
  const el = overviewTrackRef.value;
  if (!el || total.value === 0) return;
  const rect = el.getBoundingClientRect();
  const center = ((e.clientX - rect.left) / rect.width) * total.value;
  windowStart.value = clamp(Math.round(center - effectiveWindow.value / 2), 0, maxStart.value);
  beginDrag("pan", e);
}

function onPointerMove(e: PointerEvent) {
  if (!dragState) return;
  const { mode, startX, startStart, startSize, trackWidth } = dragState;
  if (mode === "pan") {
    const deltaTurns = Math.round(((e.clientX - startX) / trackWidth) * total.value);
    windowStart.value = clamp(startStart + deltaTurns, 0, total.value - effectiveWindow.value);
  } else if (mode === "resize-right") {
    // Left edge fixed; the right edge follows the pointer → grows/shrinks size,
    // bounded by MIN_WINDOW and MAX_WINDOW (and the end of the session).
    const newEnd = clamp(
      Math.round(turnAtClientX(e.clientX)),
      startStart + MIN_WINDOW,
      Math.min(total.value, startStart + MAX_WINDOW),
    );
    windowSize.value = newEnd - startStart;
  } else {
    // resize-left: right edge fixed; the left edge follows the pointer, bounded
    // so the window stays within MIN_WINDOW..MAX_WINDOW.
    const fixedEnd = startStart + startSize;
    const newStart = clamp(
      Math.round(turnAtClientX(e.clientX)),
      Math.max(0, fixedEnd - MAX_WINDOW),
      fixedEnd - MIN_WINDOW,
    );
    windowStart.value = newStart;
    windowSize.value = fixedEnd - newStart;
  }
}

function onPointerUp() {
  dragState = null;
  dragging.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

onUnmounted(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
});

// ── Detail x-axis labels ────────────────────────────────────────────────────
// Up to the default window every visible bar is labelled; if the window is
// resized larger, thin to evenly-spaced milestones so numbers don't cram.
function niceStep(n: number, target: number): number {
  const raw = n / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return Math.max(1, nice * pow);
}
const detailLabeled = computed<Set<number>>(() => {
  const vis = detailBars.value;
  const set = new Set<number>();
  if (vis.length <= DEFAULT_WINDOW) {
    for (const b of vis) set.add(b.index + 1);
    return set;
  }
  const step = niceStep(vis.length, 10);
  set.add(vis[0].index + 1);
  for (let i = step; i < vis.length; i += step) set.add(vis[i].index + 1);
  return set;
});
</script>
