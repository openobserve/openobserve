<!--
Copyright 2026 OpenObserve Inc.

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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import {
  buildMobileTimeline,
  wireframesAt,
  viewportAt,
  wireframeStyle,
  type MobileSegment,
  type Wireframe,
} from "@/composables/rum/useMobileSessionReplay";

const props = defineProps<{
  /** Parsed `_sessionreplay` segments (each the decoded wireframe segment JSON). */
  segments: MobileSegment[];
  /** RUM events (action/view/error) with `relativeTime` — rendered as timeline markers. */
  events?: any[];
}>();

const { t } = useI18n();

// Skip gaps longer than this (ms) when "Skip inactivity" is on.
const SKIP_THRESHOLD_MS = 1500;
const SKIP_SECONDS = 10;
const speedOptions = [
  { label: "0.5x", value: 0.5 },
  { label: "1x", value: 1 },
  { label: "2x", value: 2 },
  { label: "4x", value: 4 },
  { label: "8x", value: 8 },
];

const timeline = computed(() => buildMobileTimeline(props.segments ?? []));

const playhead = ref(0); // ms offset from timeline.startTime
const playing = ref(false);
const speed = ref<number>(1);
const skipInactivity = ref(false);
const stageRef = ref<HTMLElement | null>(null);
const stageWidth = ref(0);
const stageHeight = ref(0);

const currentTime = computed(() => timeline.value.startTime + playhead.value);
const viewport = computed(() => viewportAt(timeline.value.records, currentTime.value));
const currentWireframes = computed<Wireframe[]>(() =>
  wireframesAt(timeline.value.records, currentTime.value),
);
const hasReplay = computed(() => timeline.value.records.length > 0);
const progressPct = computed(() =>
  timeline.value.duration > 0 ? (playhead.value / timeline.value.duration) * 100 : 0,
);

// Fit the dp-based wireframe canvas inside the stage on BOTH axes.
//
// Scaling on width alone crops the recording: a phone is far taller than it is wide, so
// filling a wide stage horizontally makes the canvas several times the stage's height, and
// the stage's `overflow-hidden` silently clips everything below the fold. A 412x915dp screen
// in a 1200px-wide stage scales 2.9x to ~2650px tall inside ~900px of stage — only the top
// third is visible. Take the smaller ratio so the whole screen always fits.
const scale = computed(() => {
  const vw = viewport.value.width;
  const vh = viewport.value.height;
  if (vw <= 0 || vh <= 0 || stageWidth.value <= 0 || stageHeight.value <= 0) return 1;
  return Math.min(stageWidth.value / vw, stageHeight.value / vh);
});

// Centre the scaled canvas in the leftover space. Fitting by height on a wide stage leaves
// horizontal slack (and vice versa); without this the device sits pinned to the top-left.
// Offsets are applied as `left`/`top` rather than folded into the transform so that
// `transform-origin: top left` keeps wireframe child coordinates in dp, unshifted.
const canvasStyle = computed(() => ({
  width: `${viewport.value.width}px`,
  height: `${viewport.value.height}px`,
  left: `${Math.max(0, (stageWidth.value - viewport.value.width * scale.value) / 2)}px`,
  top: `${Math.max(0, (stageHeight.value - viewport.value.height * scale.value) / 2)}px`,
  transform: `scale(${scale.value})`,
  "transform-origin": "top left",
}));

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function imageSrc(w: Wireframe): string | undefined {
  return w.base64 ? `data:image/png;base64,${w.base64}` : undefined;
}

// ---- event timeline markers (error highlight) ----------------------------
function markerLeftPct(event: any): number {
  const rel = Number(event?.relativeTime ?? 0);
  const pct = timeline.value.duration > 0 ? (rel / timeline.value.duration) * 100 : 0;
  return Math.max(0, Math.min(100, pct));
}
// Applied via a :style binding, so the token is reached by var() here (a
// sanctioned raw-var site: JS-generated style values have no utility class).
function markerColor(event: any): string {
  if (event?.frustration_types?.length)
    return "var(--color-badge-orange-solid-bg)"; // frustration
  if (event?.type === "error") return "var(--color-badge-error-solid-bg)"; // error
  return "var(--color-badge-teal-solid-bg)"; // action / view
}
function markerTooltip(event: any): string {
  const name = String(event?.name ?? event?.type ?? "");
  const label = name.length > 100 ? `${name.slice(0, 100)}…` : name;
  if (event?.frustration_types?.length) {
    return `⚠️ FRUSTRATION: ${event.frustration_types.join(", ")}\n${label}`;
  }
  return event?.type === "error" ? `⛔ ERROR: ${label}` : label;
}

// ---- playback loop -------------------------------------------------------
let rafId: number | null = null;
let lastTs = 0;

function nextRecordAfter(absTime: number): number | null {
  for (const r of timeline.value.records) {
    if (r.timestamp > absTime) return r.timestamp;
  }
  return null;
}

function tick(ts: number) {
  if (!playing.value) return;
  const delta = lastTs ? ts - lastTs : 0;
  lastTs = ts;
  playhead.value = Math.min(timeline.value.duration, playhead.value + delta * speed.value);

  if (skipInactivity.value) {
    const abs = timeline.value.startTime + playhead.value;
    const next = nextRecordAfter(abs);
    if (next != null && next - abs > SKIP_THRESHOLD_MS) {
      playhead.value = Math.min(timeline.value.duration, next - timeline.value.startTime);
    }
  }

  if (playhead.value >= timeline.value.duration) {
    playing.value = false;
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function play() {
  if (!hasReplay.value) return;
  if (playhead.value >= timeline.value.duration) playhead.value = 0;
  playing.value = true;
  lastTs = 0;
  rafId = requestAnimationFrame(tick);
}
function pause() {
  playing.value = false;
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
}
function togglePlay() {
  playing.value ? pause() : play();
}
function seekTo(ms: number) {
  playhead.value = Math.max(0, Math.min(timeline.value.duration, ms));
  lastTs = 0;
}
function skip(direction: "forward" | "backward") {
  seekTo(playhead.value + (direction === "forward" ? 1 : -1) * SKIP_SECONDS * 1000);
}
function onBarClick(e: MouseEvent) {
  const bar = e.currentTarget as HTMLElement;
  const rect = bar.getBoundingClientRect();
  const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
  seekTo(ratio * timeline.value.duration);
}

// Measure the stage so we can scale to fit. BOTH axes are needed: the stage is
// `flex-1 min-h-0`, so its height is whatever the flex column leaves over and changes
// independently of its width (side panel toggled, window resized, controls wrapping).
let resizeObserver: ResizeObserver | null = null;
function measureStage(el: HTMLElement) {
  stageWidth.value = el.clientWidth;
  stageHeight.value = el.clientHeight;
}
watch(stageRef, (el) => {
  resizeObserver?.disconnect();
  if (el) {
    resizeObserver = new ResizeObserver(() => measureStage(el));
    resizeObserver.observe(el);
    measureStage(el);
  }
});

// Reset when a different session's segments load.
watch(
  () => props.segments,
  () => {
    pause();
    playhead.value = 0;
  },
);

onBeforeUnmount(() => {
  pause();
  resizeObserver?.disconnect();
});
</script>

<template>
  <section class="flex flex-col h-full" data-test="rum-mobile-replay-player">
    <div
      v-if="!hasReplay"
      class="flex items-center justify-center h-full text-text-secondary"
      data-test="rum-mobile-replay-empty"
    >
      {{ t("rum.noSessionReplay") }}
    </div>

    <template v-else>
      <div
        ref="stageRef"
        class="relative flex-1 min-h-0 overflow-hidden bg-surface-base border-b border-card-glass-border"
      >
        <!-- Canvas is the recorded device screen — deliberately white in both
             themes, since it reproduces the app's own background, not our chrome. -->
        <!-- `left`/`top` come from canvasStyle (centring offsets), not from utility
             classes — a static top-0/left-0 here would read as the source of truth. -->
        <div class="absolute bg-white" :style="canvasStyle">
          <template v-for="wf in currentWireframes" :key="wf.id">
            <img
              v-if="wf.type === 'image' && imageSrc(wf)"
              :style="wireframeStyle(wf)"
              :src="imageSrc(wf)"
              alt=""
            />
            <!-- text/placeholder text is rendered as a text node (never v-html). -->
            <div v-else :style="wireframeStyle(wf)">
              <template v-if="wf.type === 'text'">{{ wf.text }}</template>
              <template v-else-if="wf.type === 'placeholder'">{{ wf.label }}</template>
            </div>
          </template>
        </div>
      </div>

      <!-- Controls, matching the browser session player. -->
      <div class="pt-2 px-3 pb-3">
        <div
          class="relative w-full h-1.25 mt-2 mb-3 bg-card-glass-border cursor-pointer"
          data-test="rum-mobile-replay-playback-bar"
          @click="onBarClick"
        >
          <div
            class="absolute top-0 left-0 h-full bg-accent transition-[width] duration-100 ease-linear"
            :style="{ width: `${progressPct}%` }"
          />
          <div
            class="absolute -bottom-1.25 w-0.5 h-3.75 -ml-px bg-accent transition-[left] duration-100 ease-linear"
            :style="{ left: `${progressPct}%` }"
          />
          <div
            v-for="(event, i) in props.events ?? []"
            :key="event.id ?? i"
            data-test="rum-mobile-replay-event-marker"
            class="absolute -bottom-1.25 -ml-px cursor-pointer"
            :class="
              event.frustration_types?.length
                ? 'w-[0.1875rem] h-4.5 shadow-[0_0_0.25rem_var(--color-badge-orange-solid-bg)]'
                : 'w-0.5 h-3.75'
            "
            :style="{ left: `${markerLeftPct(event)}%`, background: markerColor(event) }"
            :title="markerTooltip(event)"
          />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <OIcon
              name="replay-10"
              size="md"
              class="cursor-pointer text-text-body hover:text-accent"
              :aria-label="t('rum.seek')"
              data-test="rum-mobile-replay-back-btn"
              @click="skip('backward')"
            />
            <OIcon
              :name="playing ? 'pause-circle-filled' : 'play-circle-filled'"
              size="lg"
              class="cursor-pointer text-text-body hover:text-accent"
              :aria-label="playing ? t('common.pause') : t('common.play')"
              data-test="rum-mobile-replay-play-btn"
              @click="togglePlay"
            />
            <OIcon
              name="forward-10"
              size="md"
              class="cursor-pointer text-text-body hover:text-accent"
              :aria-label="t('rum.seek')"
              data-test="rum-mobile-replay-forward-btn"
              @click="skip('forward')"
            />
            <span class="ml-2 text-text-body tabular-nums whitespace-nowrap" data-test="rum-mobile-replay-time">
              {{ fmt(playhead) }} / {{ fmt(timeline.duration) }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <OSwitch
              v-model="skipInactivity"
              :label="t('rum.skipInactivity')"
              data-test="rum-mobile-replay-skip-inactive"
              class="whitespace-nowrap"
            />
            <OSelect
              v-model="speed"
              :options="speedOptions"
              :searchable="false"
              data-test="rum-mobile-replay-speed-select"
            />
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
