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
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { SwitchValue } from "@/lib/forms/Switch/OSwitch.types";
import ReplayLoadBand from "@/components/rum/ReplayLoadBand.vue";
import ReplayPlaybackOverlay from "@/components/rum/ReplayPlaybackOverlay.vue";
import ReplayStatusChip from "@/components/rum/ReplayStatusChip.vue";
import {
  wireframesAt,
  viewportAt,
  wireframeStyle,
  type MobileTimeline,
  type Wireframe,
} from "@/composables/rum/useMobileSessionReplay";
import { MAX_ATTEMPTS } from "@/utils/rum/sessionReplayLoader";
import {
  canResume,
  expectsMoreData,
  formatReplayTime,
  shouldBuffer,
  skippedCount,
  timelineLength,
  toPercent,
  type LoadState,
  type LoadedRange,
  type PlaybackState,
  type ReplayIntent,
} from "@/utils/rum/sessionReplayTimeline";

type Mode = "paused" | "playing" | "buffering" | "waiting" | "failed" | "ended";

const props = withDefaults(
  defineProps<{
    /** Timestamp-ordered wireframe records, built once by the parent from the loaded segments. */
    timeline: MobileTimeline;
    /** RUM events (action/view/error) with `relativeTime` — rendered as timeline markers. */
    events?: any[];
    /** True until the first window has loaded, so "not loaded yet" is not shown as "no replay". */
    isLoading?: boolean;
    sessionStartMs?: number;
    sessionEndMs?: number;
    loadedRanges?: LoadedRange[];
    loadState?: LoadState;
    runComplete?: boolean;
    loadPercent?: number;
    failedFromMs?: number | null;
    pendingSeekMs?: number | null;
    retryAttempt?: number;
    speed?: number;
    skipInactivity?: boolean;
    intent?: ReplayIntent;
  }>(),
  {
    events: () => [],
    isLoading: false,
    sessionStartMs: 0,
    sessionEndMs: 0,
    loadedRanges: () => [],
    loadState: "complete",
    runComplete: false,
    loadPercent: 0,
    failedFromMs: null,
    pendingSeekMs: null,
    retryAttempt: 0,
    speed: undefined,
    skipInactivity: undefined,
    intent: "pause",
  },
);

const emit = defineEmits<{
  ready: [];
  "time-update": [sessionMs: number];
  "seek-request": [sessionMs: number];
  retry: [];
  "update:speed": [speed: number];
  "update:skipInactivity": [skip: boolean];
  "update:intent": [intent: ReplayIntent];
  "playback-state": [state: PlaybackState];
  "loaded-end-change": [sessionMs: number];
}>();

const { t } = useI18nTyped();

// Skip gaps longer than this (ms) when "Skip inactivity" is on.
const SKIP_THRESHOLD_MS = 1500;
const SKIP_SECONDS = 10;
const speedOptions = [
  { label: raw("0.5x"), value: 0.5 },
  { label: raw("1x"), value: 1 },
  { label: raw("2x"), value: 2 },
  { label: raw("4x"), value: 4 },
  { label: raw("8x"), value: 8 },
];

const timeline = computed(() => props.timeline);

const playhead = ref(0); // ms offset from timeline.startTime
const mode = ref<Mode>("paused");
const localSpeed = ref<number>(1);
const localSkipInactivity = ref(false);
// Never shrinks: a batch whose records end before the metadata end must not pull the bar back.
const timelineMs = ref(0);
const stageRef = ref<HTMLElement | null>(null);
const stageWidth = ref(0);
const stageHeight = ref(0);
let failedWasPlaying = false;
let announcedReady = false;
// Ended at the loaded end of a live session; new activity resumes it unless the user moved the playhead since.
let liveEnded = false;

const speed = computed(() => props.speed ?? localSpeed.value);
const skipInactivity = computed(() => props.skipInactivity ?? localSkipInactivity.value);
// Once the run holds the last segment, nothing still loading can extend this player.
const awaitingData = computed(() => expectsMoreData(props.loadState) && !props.runComplete);
const playing = computed(() => mode.value === "playing" || mode.value === "buffering");
const currentTime = computed(() => timeline.value.startTime + playhead.value);
const viewport = computed(() => viewportAt(timeline.value.records, currentTime.value));
const currentWireframes = computed<Wireframe[]>(() =>
  wireframesAt(timeline.value.records, currentTime.value),
);
const hasReplay = computed(() => timeline.value.records.length > 0);
const sessionStart = computed(() => props.sessionStartMs || timeline.value.startTime);
const originOffsetMs = computed(() =>
  hasReplay.value ? timeline.value.startTime - sessionStart.value : 0,
);
const sessionTimeMs = computed(() => originOffsetMs.value + playhead.value);
const displayMs = computed(() => props.pendingSeekMs ?? sessionTimeMs.value);
const progressPct = computed(() => toPercent(displayMs.value, timelineMs.value));
const loadedEndSessionMs = computed(() =>
  hasReplay.value ? timeline.value.endTime - sessionStart.value : 0,
);

const playbackState = computed<PlaybackState>(() => {
  if (props.loadState === "error") return "error";
  if (props.loadState === "empty") return "empty";
  if (!hasReplay.value) return "loading";
  return mode.value;
});

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

function imageSrc(w: Wireframe): string | undefined {
  return w.base64 ? `data:image/png;base64,${w.base64}` : undefined;
}

// ---- event timeline markers (error highlight) ----------------------------
function markerLeftPct(event: any): number {
  return toPercent(Number(event?.relativeTime ?? 0), timelineMs.value);
}
// Applied via a :style binding, so the token is reached by var() here (a
// sanctioned raw-var site: JS-generated style values have no utility class).
function markerColor(event: any): string {
  if (event?.frustration_types?.length) return "var(--color-badge-orange-solid-bg)"; // frustration
  if (event?.type === "error") return "var(--color-badge-error-solid-bg)"; // error
  return "var(--color-badge-teal-solid-bg)"; // action / view
}
function markerTooltip(event: any): string {
  const name = String(event?.name ?? event?.type ?? "");
  const label = name.length > 100 ? `${name.slice(0, 100)}…` : name;
  if (event?.frustration_types?.length) {
    return t("rum.frustrationEventTooltip", {
      types: event.frustration_types.join(", "),
      name: label,
    });
  }
  return event?.type === "error" ? t("rum.errorEventTooltip", { name: label }) : label;
}

function refreshTimeline() {
  if (!hasReplay.value) return;
  const end = props.sessionEndMs || timeline.value.endTime;
  timelineMs.value = Math.max(
    timelineMs.value,
    timelineLength(sessionStart.value, end, timeline.value.endTime),
  );
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

// Reaching the end of what is loaded means different things depending on whether more is coming.
function handleLoadedEdge() {
  stopTick();
  if (awaitingData.value) {
    mode.value = "buffering";
  } else if (props.loadState === "failed") {
    mode.value = "failed";
    failedWasPlaying = true;
  } else if (props.loadState === "live") {
    mode.value = "ended";
    liveEnded = true;
  } else {
    mode.value = "ended";
    emit("update:intent", "pause");
  }
}

function tick(ts: number) {
  if (mode.value !== "playing") return;
  const duration = timeline.value.duration;
  const delta = lastTs ? ts - lastTs : 0;
  lastTs = ts;
  playhead.value = Math.min(duration, playhead.value + delta * speed.value);

  if (skipInactivity.value) {
    const abs = timeline.value.startTime + playhead.value;
    const next = nextRecordAfter(abs);
    if (next != null && next - abs > SKIP_THRESHOLD_MS) {
      playhead.value = Math.min(duration, next - timeline.value.startTime);
    }
  }
  emit("time-update", sessionTimeMs.value);

  if (awaitingData.value && shouldBuffer(playhead.value, duration, speed.value)) {
    stopTick();
    mode.value = "buffering";
    return;
  }
  if (playhead.value >= duration) {
    handleLoadedEdge();
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function startTick() {
  mode.value = "playing";
  liveEnded = false;
  lastTs = 0;
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function stopTick() {
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
}

// Resumes where the clock held once enough has loaded past it, or unconditionally once nothing more is coming.
function tryResume() {
  if (mode.value !== "buffering" || props.pendingSeekMs !== null) return;
  const final =
    props.loadState === "complete" || (expectsMoreData(props.loadState) && !awaitingData.value);
  if (final || canResume(playhead.value, timeline.value.duration, speed.value)) {
    startTick();
  }
}

// The playhead is where the live edge stopped it, so ticking on from there is the resume.
function resumeLiveEnded() {
  if (mode.value !== "ended" || !liveEnded || props.pendingSeekMs !== null) return;
  if (playhead.value < timeline.value.duration) startTick();
}

function beginPlayback() {
  if (!hasReplay.value) return;
  if (awaitingData.value && shouldBuffer(playhead.value, timeline.value.duration, speed.value)) {
    mode.value = "buffering";
    return;
  }
  startTick();
}

// A pending seek is display-only, so the playhead must not start moving until the parent seeks.
function startPlayback() {
  if (props.pendingSeekMs !== null) {
    mode.value = "buffering";
    return;
  }
  beginPlayback();
}

function play() {
  emit("update:intent", "play");
  if (mode.value === "ended") {
    emit("seek-request", 0);
    return;
  }
  if (mode.value === "failed") {
    mode.value = "buffering";
    emit("retry");
    return;
  }
  if (mode.value === "waiting") {
    mode.value = "buffering";
    return;
  }
  startPlayback();
}

// Pausing while buffering cancels the auto-resume; a seek still waiting on data keeps waiting, paused.
function pause() {
  emit("update:intent", "pause");
  failedWasPlaying = false;
  stopTick();
  if (mode.value !== "playing" && mode.value !== "buffering") return;
  mode.value = props.pendingSeekMs !== null ? "waiting" : "paused";
}

function togglePlay() {
  if (playing.value) pause();
  else play();
}

/** The only seek entry point: session ms in, converted to this player's own playhead. */
function seekTo(sessionMs: number, shouldPlay = false) {
  const offset = sessionStart.value + sessionMs - timeline.value.startTime;
  playhead.value = Math.max(0, Math.min(timeline.value.duration, offset));
  lastTs = 0;
  liveEnded = false;
  // The parent clears pendingSeekMs in this same tick, so the prop still holds the stale target here.
  if (shouldPlay) {
    beginPlayback();
  } else {
    stopTick();
    mode.value = "paused";
  }
}

// Seeks go to the parent, which knows what is loaded; the player never jumps into unloaded time itself.
function skip(direction: "forward" | "backward") {
  if (!(timelineMs.value > 0)) return;
  const delta = (direction === "forward" ? 1 : -1) * SKIP_SECONDS * 1000;
  emit("seek-request", Math.max(0, Math.min(timelineMs.value, displayMs.value + delta)));
}

function onBarClick(e: MouseEvent) {
  if (!(timelineMs.value > 0)) return;
  const bar = e.currentTarget as HTMLElement;
  const rect = bar.getBoundingClientRect();
  const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
  emit("seek-request", Math.max(0, Math.min(1, ratio)) * timelineMs.value);
}

function setSpeed(value: unknown) {
  if (typeof value !== "number") return;
  localSpeed.value = value;
  emit("update:speed", value);
}

function setSkipInactivity(value: SwitchValue) {
  localSkipInactivity.value = !!value;
  emit("update:skipInactivity", !!value);
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

// A later batch only adds later records, so the playhead is left where it is and a held clock may resume.
watch(
  () => [timeline.value.endTime, props.sessionStartMs, props.sessionEndMs],
  () => {
    refreshTimeline();
    if (hasReplay.value) emit("loaded-end-change", loadedEndSessionMs.value);
    tryResume();
    resumeLiveEnded();
  },
  { immediate: true },
);

watch(
  hasReplay,
  (has) => {
    if (!has || announcedReady) return;
    announcedReady = true;
    emit("ready");
  },
  { immediate: true },
);

// The parent holds the target; the playhead stays put until the parent calls seekTo.
watch(
  () => props.pendingSeekMs,
  (target, previous) => {
    if (target !== null && (previous ?? null) === null) {
      const wasPlaying = playing.value;
      stopTick();
      mode.value = wasPlaying ? "buffering" : "waiting";
      return;
    }
    if (target !== null || (mode.value !== "buffering" && mode.value !== "waiting")) return;
    if (props.loadState === "failed") {
      failedWasPlaying = mode.value === "buffering";
      mode.value = "failed";
    } else if (mode.value === "waiting") {
      mode.value = "paused";
    } else {
      tryResume();
    }
  },
  { immediate: true },
);

watch(
  () => props.loadState,
  (state, previous) => {
    if (state === "complete") {
      tryResume();
      return;
    }
    if (state === "failed" && props.pendingSeekMs === null) {
      if (mode.value === "buffering" || mode.value === "waiting") {
        failedWasPlaying = mode.value === "buffering";
        mode.value = "failed";
      }
      return;
    }
    if (expectsMoreData(state) && previous === "failed" && mode.value === "failed") {
      mode.value = failedWasPlaying ? "buffering" : "paused";
    }
  },
);

watch(awaitingData, (awaiting) => {
  if (!awaiting && expectsMoreData(props.loadState)) tryResume();
});

watch(playbackState, (state) => emit("playback-state", state));

onBeforeUnmount(() => {
  stopTick();
  resizeObserver?.disconnect();
});

defineExpose({ seekTo, play, pause, togglePlay, playbackState });
</script>

<template>
  <section class="flex h-full flex-col" data-test="rum-mobile-replay-player">
    <!-- Loading takes precedence over the empty state: until the segment fetch settles we
         cannot know whether this session has a replay, so show a spinner rather than a
         premature "no replay" message. -->
    <div
      v-if="isLoading"
      class="text-text-secondary flex h-full flex-col items-center justify-center gap-2"
      data-test="rum-mobile-replay-loading"
    >
      <OSpinner size="md" />
      <span>{{ t("rum.loadingSessionReplay") }}</span>
      <span v-if="retryAttempt > 1" class="text-xs" data-test="rum-mobile-replay-retrying">
        {{ t("rum.sessionReplayRetrying", { attempt: retryAttempt, total: MAX_ATTEMPTS }) }}
      </span>
    </div>

    <div
      v-else-if="loadState === 'error'"
      class="text-text-secondary relative flex h-full items-center justify-center"
      data-test="rum-mobile-replay-error"
    >
      <ReplayPlaybackOverlay state="error" @retry="emit('retry')" />
    </div>

    <div
      v-else-if="!hasReplay"
      class="text-text-secondary flex h-full items-center justify-center"
      data-test="rum-mobile-replay-empty"
    >
      {{ t("rum.noSessionReplay") }}
    </div>

    <template v-else>
      <div
        ref="stageRef"
        class="bg-surface-base border-card-glass-border relative min-h-0 flex-1 overflow-hidden border-b"
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
        <ReplayPlaybackOverlay
          :state="playbackState"
          :pending-seek-ms="pendingSeekMs"
          :loaded-end-ms="loadedEndSessionMs"
          :failed-from-ms="failedFromMs"
          :timeline-ms="timelineMs"
          :retry-attempt="retryAttempt"
          @retry="emit('retry')"
        />
      </div>

      <!-- Controls, matching the browser session player. -->
      <div class="px-3 pt-2 pb-3">
        <div
          class="bg-card-glass-border relative mt-2 mb-3 h-1.25 w-full cursor-pointer"
          data-test="rum-mobile-replay-playback-bar"
          @click="onBarClick"
        >
          <ReplayLoadBand :ranges="loadedRanges" :timeline-ms="timelineMs" />
          <div
            class="bg-accent absolute top-0 left-0 h-full transition-[width] duration-100 ease-linear"
            :class="{ 'opacity-50': pendingSeekMs !== null }"
            data-test="rum-mobile-replay-progress"
            :style="{ width: `${progressPct}%` }"
          />
          <div
            class="bg-accent absolute -bottom-1.25 -ms-px h-3.75 w-0.5 transition-[left] duration-100 ease-linear"
            :style="{ left: `${progressPct}%` }"
          />
          <div
            v-for="(event, i) in props.events ?? []"
            :key="event.id ?? i"
            data-test="rum-mobile-replay-event-marker"
            class="absolute -bottom-1.25 -ms-px cursor-pointer"
            :class="
              event.frustration_types?.length
                ? 'ring-badge-orange-solid-bg h-4.5 w-[0.1875rem] ring-2'
                : 'h-3.75 w-0.5'
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
              class="text-text-body hover:text-accent cursor-pointer"
              :aria-label="t('rum.seek')"
              data-test="rum-mobile-replay-back-btn"
              @click="skip('backward')"
            />
            <OIcon
              :name="playing ? 'pause-circle-filled' : 'play-circle-filled'"
              size="lg"
              class="text-text-body hover:text-accent cursor-pointer"
              :aria-label="playing ? t('common.pause') : t('common.play')"
              data-test="rum-mobile-replay-play-btn"
              @click="togglePlay"
            />
            <OIcon
              name="forward-10"
              size="md"
              class="text-text-body hover:text-accent cursor-pointer"
              :aria-label="t('rum.seek')"
              data-test="rum-mobile-replay-forward-btn"
              @click="skip('forward')"
            />
            <span
              class="text-text-body ms-2 whitespace-nowrap tabular-nums"
              data-test="rum-mobile-replay-time"
            >
              {{ formatReplayTime(displayMs) }} / {{ formatReplayTime(timelineMs) }}
            </span>
            <ReplayStatusChip
              :load-state="loadState"
              :load-percent="loadPercent"
              :skipped-parts="skippedCount(loadedRanges)"
              @retry="emit('retry')"
            />
          </div>

          <div class="flex items-center gap-2">
            <OSwitch
              :model-value="skipInactivity"
              :label="t('rum.skipInactivity')"
              data-test="rum-mobile-replay-skip-inactive"
              class="whitespace-nowrap"
              @update:model-value="setSkipInactivity"
            />
            <OSelect
              :model-value="speed"
              :options="speedOptions"
              :searchable="false"
              data-test="rum-mobile-replay-speed-select"
              @update:model-value="setSpeed"
            />
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
