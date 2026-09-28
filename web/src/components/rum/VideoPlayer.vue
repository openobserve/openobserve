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
  <div class="player-container flex h-full flex-col p-2">
    <div
      v-if="isLoading"
      class="flex min-h-0 w-full flex-1 items-center justify-center pb-4 text-center"
    >
      <div>
        <OSpinner size="md" class="mx-auto block" data-test="video-player-loading-indicator" />
        <div class="w-full text-center">
          {{ t("rum.loadingSessions") }}
        </div>
        <div
          v-if="retryAttempt > 1"
          class="text-text-secondary w-full text-center text-xs"
          data-test="video-player-retrying"
        >
          {{ t("rum.sessionReplayRetrying", { attempt: retryAttempt, total: MAX_ATTEMPTS }) }}
        </div>
      </div>
    </div>
    <div ref="playerContainerRef" class="relative flex min-h-0 flex-1 items-center justify-center">
      <div
        ref="playerRef"
        id="player"
        class="player flex h-full cursor-pointer items-center"
        @click="togglePlay"
      />
      <ReplayPlaybackOverlay
        :state="playbackState"
        :pending-seek-ms="pendingSeekMs"
        :loaded-end-ms="loadedEndSessionMs"
        :failed-from-ms="failedFromMs"
        :timeline-ms="timelineMs"
        :single-snapshot="singleSnapshot"
        :retry-attempt="retryAttempt"
        @retry="emit('retry')"
      />
    </div>
    <div class="controls-container w-full p-2 pt-3">
      <div
        ref="playbackBarRef"
        data-test="video-player-playback-bar"
        class="bg-surface-subtle relative mt-2 mb-3 h-[0.3125rem] w-full cursor-pointer"
        @click="handlePlaybackBarClick"
        @mousemove="handleBarHover"
        @mouseleave="hoverMs = null"
      >
        <ReplayLoadBand :ranges="loadedRanges" :timeline-ms="timelineMs" />
        <div
          class="bg-button-primary! absolute"
          :class="{ 'opacity-50': pendingSeekMs !== null }"
          data-test="video-player-progress"
          :style="{
            width: playerState.progressWidth + 'px',
            left: 0,
            top: 0,
            height: '100%',
            transition: 'all 0.1s linear',
          }"
        />
        <div
          class="bg-button-primary! absolute"
          :style="{
            width: '0.125rem',
            left: playerState.progressWidth - 2 + 'px',
            bottom: '-0.3125rem',
            height: '0.9375rem',
            transition: 'all 0.1s linear',
          }"
        />

        <div
          v-for="event in events as any[]"
          :key="event.id"
          data-test="video-player-event-marker"
          class="absolute cursor-pointer"
          :class="getEventMarkerClass(event)"
          :style="{
            width:
              event.frustration_types && event.frustration_types.length > 0
                ? '0.1875rem'
                : '0.125rem',
            left: markerLeft(event) + 'px',
            bottom: '-0.3125rem',
            height:
              event.frustration_types && event.frustration_types.length > 0
                ? '1.125rem'
                : '0.9375rem',
          }"
          :title="getEventTooltip(event)"
          @mouseenter="hoverEvent = event"
          @mouseleave="hoverEvent = null"
        />
        <div
          v-if="hoverLabel"
          class="bg-surface-overlay border-border-default text-text-body rounded-default pointer-events-none absolute bottom-4 z-10 -translate-x-1/2 border px-2 py-1 text-xs whitespace-nowrap shadow-md"
          data-test="video-player-hover-tooltip"
          :style="{ left: `${toPercent(hoverMs ?? 0, timelineMs)}%` }"
        >
          {{ hoverLabel }}
        </div>
      </div>
      <div class="controls flex items-center justify-between">
        <div class="flex items-center">
          <div>
            <OIcon
              name="replay-10"
              size="md"
              class="text-icon-color hover:text-button-primary me-2 cursor-pointer"
              @click="skipTo('backward')"
            />
            <OIcon
              :name="playerState.isPlaying ? 'pause-circle-filled' : 'play-circle-filled'"
              size="lg"
              class="text-icon-color hover:text-button-primary cursor-pointer"
              @click="togglePlay"
            />
            <OIcon
              name="forward-10"
              size="md"
              class="text-icon-color hover:text-button-primary ms-2 cursor-pointer"
              @click="skipTo('forward')"
            />
          </div>
          <div class="ms-4 flex items-center">
            <div data-test="video-player-time">{{ playerState.time }}</div>
            <div class="px-1">/</div>
            <div data-test="video-player-duration">{{ playerState.duration }}</div>
          </div>
          <ReplayStatusChip
            class="ms-3"
            :load-state="loadState"
            :load-percent="loadPercent"
            :skipped-parts="skippedCount(loadedRanges)"
            @retry="emit('retry')"
          />
        </div>
        <div class="flex items-center">
          <OSwitch
            class="me-3 whitespace-nowrap"
            :model-value="skipInactivityValue"
            :label="t('rum.skipInactivity')"
            @update:model-value="handleSkipInactivityChange"
          />
          <OSelect
            :model-value="speedValue"
            :options="speedOptions"
            :searchable="false"
            @update:model-value="setSpeed"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  markRaw,
  nextTick,
  ref,
  shallowRef,
  watch,
  type PropType,
  type Ref,
  onBeforeUnmount,
  onMounted,
  onBeforeMount,
  onActivated,
  onDeactivated,
} from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import type { SwitchValue } from "@/lib/forms/Switch/OSwitch.types";
import ReplayLoadBand from "@/components/rum/ReplayLoadBand.vue";
import ReplayPlaybackOverlay from "@/components/rum/ReplayPlaybackOverlay.vue";
import ReplayStatusChip from "@/components/rum/ReplayStatusChip.vue";
import {
  createRecordConverter,
  dropChangesBeforeFirstSnapshot,
  type RecordConverter,
} from "@/utils/rum/sessionReplayChangeFormat";
import { resolveRelativeLinks } from "@/utils/rum/sessionReplayUrls";
import { MAX_ATTEMPTS } from "@/utils/rum/sessionReplayLoader";
import {
  canResume,
  formatReplayTime,
  isLoadedAt,
  isSkipMarker,
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

const DEFAULT_SPEED = 4;
const SKIP_SECONDS = 10;

const props = defineProps({
  events: {
    type: Array,
    required: true,
  },
  segments: {
    type: Array,
    required: true,
  },
  isLoading: {
    type: Boolean,
    required: true,
  },
  sessionStartMs: { type: Number, default: 0 },
  sessionEndMs: { type: Number, default: 0 },
  loadedRanges: { type: Array as PropType<LoadedRange[]>, default: () => [] },
  loadState: { type: String as PropType<LoadState>, default: "complete" },
  runComplete: { type: Boolean, default: false },
  loadPercent: { type: Number, default: 0 },
  failedFromMs: { type: Number as PropType<number | null>, default: null },
  truncated: { type: Boolean, default: false },
  pendingSeekMs: { type: Number as PropType<number | null>, default: null },
  singleSnapshot: { type: Boolean, default: false },
  retryAttempt: { type: Number, default: 0 },
  speed: { type: Number as PropType<number | undefined>, default: undefined },
  skipInactivity: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  intent: { type: String as PropType<ReplayIntent>, default: "pause" },
});

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
  "segments-taken": [count: number];
}>();

const { t } = useI18nTyped();

const store = useStore();

let rrwebPlayer: any;

const player = ref<any>();

const playerRef = ref<HTMLElement | null>(null);

const playbackBarRef = ref<HTMLElement | null>(null);

// shallowRef: the converted record list is large and nothing reads it reactively.
const session = shallowRef<any[]>([]);

const playerContainerRef = ref<HTMLElement | null>(null);

const worker: Ref<Worker | null> = ref(null);

const workerProcessId = ref(0);

// Appended segments must reuse this same converter, in order, or they decode against lost state.
let runConverter: RecordConverter | null = null;
// A later batch may carry no Meta record, so the page URL for resolving relative links must outlive one batch.
let runPageHref: string | undefined;
let convertedSegmentCount = 0;
let segmentWork: Promise<unknown> = Promise.resolve();
// rrweb's controller restarts at 0 on play() after a finish, so every resume after one must go through goto.
let finished = false;
let failedWasPlaying = false;
let seekCount = 0;

const sessionWidth = ref(0);
const sessionHeight = ref(0);
const resizeObserver = ref<ResizeObserver | null>(null);

const mode = ref<Mode>("paused");
const playerBuilt = ref(false);
// How many of the segments prop the live player holds; the parent's coverage check waits on it.
const takenCount = ref(0);
const localSpeed = ref(DEFAULT_SPEED);
const localSkipInactivity = ref(true);
// Never shrinks: a batch whose records end before the metadata end must not pull the bar back.
const timelineMs = ref(0);
const hoverMs = ref<number | null>(null);
const hoverEvent = ref<any>(null);

const speedOptions = [
  {
    label: raw("0.5x"),
    value: 0.5,
  },
  {
    label: raw("1x"),
    value: 1,
  },
  {
    label: raw("1.5x"),
    value: 1.5,
  },
  {
    label: raw("2x"),
    value: 2,
  },
  {
    label: raw("3x"),
    value: 3,
  },
  {
    label: raw("4x"),
    value: 4,
  },
];

const speedValue = computed(() => props.speed ?? localSpeed.value);
const skipInactivityValue = computed(() => props.skipInactivity ?? localSkipInactivity.value);

const playbackState = computed<PlaybackState>(() => {
  if (props.loadState === "error") return "error";
  if (props.loadState === "empty") return "empty";
  if (!playerBuilt.value) return "loading";
  return mode.value;
});

// Once the run has reached the last segment and the player holds it, a hole still loading can never extend this player.
const awaitingData = computed(
  () =>
    props.loadState === "loading" &&
    !(props.runComplete && takenCount.value >= props.segments.length),
);

const sessionStart = computed(() => props.sessionStartMs || playerState.value.startTime);

// The player's time 0 is its first loaded event, which an event_time window puts after the session start.
const originOffsetMs = computed(() =>
  playerBuilt.value ? playerState.value.startTime - sessionStart.value : 0,
);

const sessionTimeMs = computed(() => originOffsetMs.value + playerState.value.actualTime);

const displayMs = computed(() => props.pendingSeekMs ?? sessionTimeMs.value);

const loadedEndSessionMs = computed(() =>
  playerBuilt.value ? playerState.value.endTime - sessionStart.value : 0,
);

const hoverLabel = computed(() => {
  if (hoverMs.value === null || !(timelineMs.value > 0)) return "";
  const parts: string[] = [formatReplayTime(hoverMs.value)];
  if (hoverEvent.value) {
    parts.push(
      hoverEvent.value.type === "error" ? t("rum.error") : getEventTooltip(hoverEvent.value),
    );
  }
  if (props.loadedRanges.length && !isLoadedAt(hoverMs.value, props.loadedRanges)) {
    parts.push(t("rum.sessionReplayNotLoadedYet"));
  }
  return parts.join(" · ");
});

const playerState = ref({
  get isPlaying() {
    return mode.value === "playing" || mode.value === "buffering";
  },
  get time() {
    return playerBuilt.value || props.pendingSeekMs !== null
      ? formatReplayTime(displayMs.value)
      : "00.00";
  },
  get duration() {
    return timelineMs.value > 0 ? formatReplayTime(timelineMs.value) : "00.00";
  },
  get speed() {
    return speedValue.value;
  },
  get skipInactivity() {
    return skipInactivityValue.value;
  },
  get progressWidth() {
    return (toPercent(displayMs.value, timelineMs.value) / 100) * this.width;
  },
  playBackEvents: {
    views: true,
    actions: true,
    errors: true,
  },
  fullScreen: false,
  startTime: 0,
  endTime: 0,
  totalTime: 0,
  width: 0,
  height: 0,
  actualTime: 0,
});

onBeforeMount(async () => {
  await importVideoPlayer();
  initializeWorker();
});

onMounted(() => {
  attachResizeObserver();
});

onActivated(() => {
  attachResizeObserver();
  if (player.value) {
    const { width, height } = calculatePlayerDimensions();
    if (playerRef.value) playerRef.value.style.width = `${width}px`;
    player.value.$set({ width, height });
    updatePlayerState();
  }
});

onDeactivated(() => {
  detachResizeObserver();
});

const importVideoPlayer = async () => {
  const rrwebPlayerModule: any = await import("@openobserve/rrweb-player");

  await import("@openobserve/rrweb-player/dist/style.css");

  rrwebPlayer = rrwebPlayerModule.default;
};

onBeforeUnmount(() => {
  detachResizeObserver();
  if (worker.value) {
    worker.value.terminate();
  }
  // Replayer.destroy() removes its wrapper from the root, so it has to run before $destroy().
  if (player.value) {
    try {
      player.value.pause?.();
      player.value.getReplayer?.()?.destroy?.();
      player.value.$destroy?.();
    } catch {
      // teardown race — the instance is already gone
    }
    player.value = null;
  }
  runConverter = null;
  runPageHref = undefined;
  convertedSegmentCount = 0;
  rrwebPlayer = null;
});

function attachResizeObserver() {
  if (!playerContainerRef.value) return;
  resizeObserver.value = new ResizeObserver(() => {
    if (!player.value) return;
    const { width, height } = calculatePlayerDimensions();
    if (playerRef.value) playerRef.value.style.width = `${width}px`;
    player.value.$set({ width, height });
    updatePlayerState();
  });
  resizeObserver.value.observe(playerContainerRef.value);
}

function detachResizeObserver() {
  resizeObserver.value?.disconnect();
  resizeObserver.value = null;
}

function calculatePlayerDimensions(): { width: number; height: number } {
  if (!playerContainerRef.value) return { width: 0, height: 0 };

  let playerWidth = playerContainerRef.value.clientWidth || 0;
  let playerHeight = sessionHeight.value
    ? (sessionHeight.value / sessionWidth.value) * playerWidth
    : playerWidth * 0.5625;

  if (
    playerContainerRef.value.clientHeight &&
    playerHeight > playerContainerRef.value.clientHeight - 90
  ) {
    playerHeight = playerContainerRef.value.clientHeight - 90 || 0;
    playerWidth =
      sessionWidth.value && sessionHeight.value
        ? (sessionWidth.value / sessionHeight.value) * playerHeight
        : playerWidth;
  }

  return { width: playerWidth, height: playerHeight };
}

// The converter threads node-id and string-table state across one forward-only run, so the same instance must serve every batch of that run.
const convertSegments = (segments: any[], converter: RecordConverter, cold: boolean) => {
  const out: any[] = [];
  let skippedRecords = 0;

  segments.forEach((segment: any, segmentIndex: number) => {
    // A skipped segment leaves the converter out of step until the next full snapshot.
    if (isSkipMarker(segment)) {
      converter.markStale();
      return;
    }
    const convertedRecords: any[] = [];
    // A cold converter has no string table, so Change records before the run's first snapshot decode to empty strings.
    const records =
      cold && segmentIndex === 0
        ? dropChangesBeforeFirstSnapshot(segment.records ?? [])
        : (segment.records ?? []);
    records.forEach((record: any) => {
      // One unconvertible record must not cost the whole session, so skip it and carry on.
      try {
        convertedRecords.push(...converter.convert(record));
      } catch (e) {
        skippedRecords++;
        console.error("Session replay: skipped an unconvertible record", e);
      }
    });
    convertedRecords.forEach((record: any) => {
      let segCopy = record;
      if (segCopy.type === 8) {
        const seg = {
          ...segCopy,
          data: {
            payload: {
              ...segCopy.data,
            },
            tag: "viewport",
          },
          type: 5,
        };
        segCopy = seg;
      }
      if (segCopy.type === 4) runPageHref = segCopy.data?.href;
      if (segCopy.type === 3 && segCopy.data?.source === 0) {
        segCopy.data.adds?.forEach((add: any) => resolveRelativeLinks(add.node, runPageHref));
      }
      try {
        if (segCopy.type === 2 && segCopy.data.node.type === 0) {
          resolveRelativeLinks(segCopy.data.node, runPageHref);
          segCopy.data.node.childNodes.forEach((child: any) => {
            if (child.type === 2 && child.tagName === "html") {
              child.childNodes.forEach((_child: any) => {
                if (_child.type === 2 && _child.tagName === "head") {
                  _child.childNodes.forEach((__child: any) => {
                    if (
                      __child.type === 2 &&
                      __child.tagName === "link" &&
                      __child.attributes.rel === "stylesheet" &&
                      typeof __child.attributes.href === "string" &&
                      __child.attributes.href.endsWith(".css") &&
                      __child.attributes._cssText
                    ) {
                      workerProcessId.value++;
                      processCss(__child.attributes._cssText, workerProcessId.value).then(
                        (res: any) => {
                          __child.attributes._cssText = res.updatedCssString;
                        },
                      );
                    }
                  });
                }
              });
            }
          });
        }
      } catch (e) {
        console.log(e);
      }
      out.push(segCopy);
    });
  });

  if (skippedRecords) {
    console.warn(`Session replay: ${skippedRecords} record(s) could not be converted`);
  }

  return out;
};

const setupSession = async () => {
  session.value = [];
  if (!props.segments.length) return;

  runConverter = null;
  runPageHref = undefined;
  convertedSegmentCount = 0;

  const converter = createRecordConverter();
  const consumed = props.segments.length;
  session.value = convertSegments(props.segments.slice(0, consumed), converter, true);

  session.value.every((segment: any) => {
    if (segment.data.height && segment.data.width) {
      sessionWidth.value = segment.data.width;
      sessionHeight.value = segment.data.height;
      return false;
    }
    return true;
  });

  const { width: playerWidth, height: playerHeight } = calculatePlayerDimensions();

  if (playerRef.value) {
    playerRef.value.style.width = `${playerWidth}px`;
  }

  await nextTick();
  if (!playerRef.value) return;
  if (player.value) return;
  player.value = markRaw(
    new rrwebPlayer({
      target: playerRef.value as HTMLElement,
      props: {
        events: session.value,
        UNSAFE_replayCanvas: false,
        mouseTail: false,
        autoPlay: false,
        showController: false,
        width: playerWidth,
        height: playerHeight,
        mutateChildNodes: true,
        speed: speedValue.value,
        skipInactive: skipInactivityValue.value,
      },
    }),
  );

  // Adopt the run only once the player exists; a discarded conversion must not be appended to.
  runConverter = converter;
  convertedSegmentCount = consumed;
  takenCount.value = consumed;

  player.value.addEventListener("ui-update-current-time", updateProgressBar);
  player.value.addEventListener("finish", handleFinish);
  player.value.addEventListener("error", () => {
    console.error("Playback error:");
  });

  if (!player.value) return;
  updatePlayerState();
  playerBuilt.value = true;
  emit("segments-taken", consumed);
  const seeksBefore = seekCount;
  emit("ready");
  // The parent may have seeked on ready, which already set the mode; its cleared pendingSeekMs has not reached the props yet.
  if (seekCount !== seeksBefore) return;
  // A Play pressed while the first window was still loading is honoured once there is something to play.
  if (mode.value === "playing" || props.intent === "play") startPlayback();
};

// Re-running setupSession per batch would re-convert the whole session, which is the cost this path exists to avoid.
const appendSegments = async (newSegments: any[], takenAfter: number) => {
  if (!player.value || !runConverter || !newSegments.length) return;

  const records = convertSegments(newSegments, runConverter, false).sort(
    (a: any, b: any) => a.timestamp - b.timestamp,
  );

  // The player applies an event at or before the playhead at once, so this is a conservative proxy for its private baselineTime.
  const meta = player.value.getMetaData?.();
  const replayer = player.value.getReplayer?.();
  const playhead =
    meta && replayer ? (meta.startTime ?? 0) + (replayer.getCurrentTime?.() ?? 0) : -Infinity;

  let skipped = 0;
  for (const record of records) {
    if (record.timestamp <= playhead) {
      skipped++;
      continue;
    }
    try {
      player.value.addEvent(record);
    } catch (e) {
      skipped++;
      console.error("Session replay: failed to append a record", e);
    }
  }

  if (skipped) {
    console.warn(`Session replay: ${skipped} appended record(s) were skipped`);
  }

  // addEvent and the controller's meta refresh both defer through a microtask.
  await nextTick();
  updatePlayerState();
  takenCount.value = takenAfter;
  emit("segments-taken", takenAfter);
  tryResume();
};

const updatePlayerState = () => {
  if (!player?.value) return;
  const playerMeta = player.value?.getMetaData();

  if (!playerMeta) return;
  playerState.value.startTime = playerMeta?.startTime;
  playerState.value.endTime = playerMeta?.endTime;
  playerState.value.totalTime = playerMeta?.totalTime;
  refreshTimeline();

  const playbackBarWidth = playbackBarRef.value?.clientWidth || 0;
  playerState.value.width = playbackBarWidth;
  player.value.triggerResize();
  emit("loaded-end-change", playerState.value.endTime - sessionStart.value);
};

const refreshTimeline = () => {
  const loadedEnd = playerBuilt.value || player.value ? playerState.value.endTime : 0;
  const start = sessionStart.value;
  const end = props.sessionEndMs || loadedEnd;
  if (!start) return;
  timelineMs.value = Math.max(timelineMs.value, timelineLength(start, end, loadedEnd));
};

const getEventMarkerClass = (event: any) => {
  if (event.frustration_types && event.frustration_types.length > 0) {
    return "bg-badge-orange-solid-bg! shadow-glow shadow-badge-orange-solid-bg/60";
  }
  if (event.type === "error") {
    return "bg-badge-error-solid-bg!";
  }
  return "bg-badge-teal-solid-bg!";
};

const getEventTooltip = (event: any) => {
  const eventName = event.name.length > 100 ? event.name.slice(0, 100) + "..." : event.name;

  if (event.frustration_types && event.frustration_types.length > 0) {
    const frustrationLabels = event.frustration_types
      .map((type: string) => {
        return type.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase());
      })
      .join(", ");
    return t("rum.frustrationEventTooltip", { types: frustrationLabels, name: eventName });
  }

  return eventName;
};

const markerLeft = (event: any) =>
  (toPercent(Number(event.relativeTime) || 0, timelineMs.value) / 100) * playerState.value.width;

// A pending seek is drawn by the parent's target, so a late tick from the old position must not overwrite it.
const updateProgressBar = (time: { payload: number }) => {
  if (props.pendingSeekMs !== null) return;
  playerState.value.actualTime = time.payload;
  emit("time-update", sessionTimeMs.value);
  if (
    mode.value === "playing" &&
    awaitingData.value &&
    shouldBuffer(time.payload, playerState.value.totalTime, speedValue.value)
  ) {
    enterBuffering();
  }
};

// Safety net for a skip that overshoots the margin: the load state decides what the end of the loaded data means.
const handleFinish = () => {
  finished = true;
  if (mode.value !== "playing" && mode.value !== "buffering") return;
  if (awaitingData.value) {
    mode.value = "buffering";
  } else if (props.loadState === "failed") {
    mode.value = "failed";
    failedWasPlaying = true;
  } else {
    mode.value = "ended";
    emit("update:intent", "pause");
  }
};

const enterBuffering = () => {
  player.value?.pause();
  mode.value = "buffering";
};

const resumeAt = (offset: number) => {
  player.value?.goto(offset, true);
  finished = false;
  mode.value = "playing";
};

// Resumes where the clock held, never at 0, once enough has loaded past it or nothing more is coming.
const tryResume = () => {
  if (mode.value !== "buffering" || props.pendingSeekMs !== null || !player.value) return;
  const now = playerState.value.actualTime;
  const final =
    props.loadState === "complete" || (props.loadState === "loading" && !awaitingData.value);
  if (final || canResume(now, playerState.value.totalTime, speedValue.value)) {
    resumeAt(now);
  }
};

// A pending seek is display-only, so rrweb must not start from where it sits until the parent seeks.
const startPlayback = () => {
  if (props.pendingSeekMs !== null) {
    mode.value = "buffering";
    return;
  }
  if (!player.value) {
    mode.value = "playing";
    return;
  }
  const now = playerState.value.actualTime;
  if (awaitingData.value && shouldBuffer(now, playerState.value.totalTime, speedValue.value)) {
    mode.value = "buffering";
    return;
  }
  if (finished || props.loadState !== "complete") {
    resumeAt(now);
    return;
  }
  player.value.play();
  mode.value = "playing";
};

const handlePlaybackBarClick = (event: any) => {
  if (!playbackBarRef.value || !(timelineMs.value > 0)) return;
  const rect = playbackBarRef.value.getBoundingClientRect();
  if (!(rect.width > 0)) return;
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  emit("seek-request", ratio * timelineMs.value);
};

const handleBarHover = (event: MouseEvent) => {
  if (!playbackBarRef.value || !(timelineMs.value > 0)) return;
  const rect = playbackBarRef.value.getBoundingClientRect();
  if (!(rect.width > 0)) return;
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  hoverMs.value = ratio * timelineMs.value;
};

// -------------- Player control methods ----------------
const togglePlay = () => {
  if (playerState.value.isPlaying) {
    pause();
  } else {
    play();
  }
};

const play = () => {
  emit("update:intent", "play");
  if (mode.value === "ended") {
    // goto(0) would restart at the run's origin, not the session start.
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
};

// Pausing while buffering cancels the auto-resume; a seek still waiting on data keeps waiting, paused.
const pause = () => {
  emit("update:intent", "pause");
  failedWasPlaying = false;
  if (mode.value !== "playing" && mode.value !== "buffering") return;
  player.value?.pause();
  mode.value = props.pendingSeekMs !== null ? "waiting" : "paused";
};

const setSpeed = (speed: SelectModelValue) => {
  // speedOptions are numeric; ignore any non-numeric emission.
  if (typeof speed !== "number") return;
  localSpeed.value = speed;
  player.value?.setSpeed(speed);
  emit("update:speed", speed);
};

const toggleSkipInactive = () => {
  player.value?.toggleSkipInactive();
  localSkipInactivity.value = !skipInactivityValue.value;
  emit("update:skipInactivity", localSkipInactivity.value);
};

const handleSkipInactivityChange = (value: SwitchValue) => {
  if (!!value !== skipInactivityValue.value) toggleSkipInactive();
};

const goto = (timeOffset: number, play: boolean = false) => {
  player.value?.goto(timeOffset, play);
  finished = false;
  mode.value = play ? "playing" : "paused";
};

/** The only seek entry point: session ms in, converted to this player's own origin. */
const seekTo = (sessionMs: number, play: boolean = false) => {
  seekCount++;
  const offset = Math.max(0, sessionMs - originOffsetMs.value);
  playerState.value.actualTime = offset;
  goto(offset, play);
};

// Seeks go to the parent, which knows what is loaded; the player never jumps into unloaded time itself.
const skipTo = (direction: string) => {
  if (!(timelineMs.value > 0)) return;
  const delta = (direction === "forward" ? 1 : -1) * SKIP_SECONDS * 1000;
  emit("seek-request", Math.max(0, Math.min(timelineMs.value, displayMs.value + delta)));
};

const initializeWorker = () => {
  if (window.Worker) {
    // Creating the Web Worker
    worker.value = new Worker(new URL("../../workers/rumcssworker.js", import.meta.url), {
      type: "module",
    });
  } else {
    console.error("Web Workers are not supported in this browser.");
  }
};

const processCss = (cssString: string, id: string | number) => {
  return new Promise((resolve, reject) => {
    if (worker.value) {
      const handleWorkerMessage = (event: any) => {
        if (event.data.id === id) {
          if (worker.value) worker.value.removeEventListener("message", handleWorkerMessage);
          resolve(event.data);
        }
      };
      worker.value.addEventListener("message", handleWorkerMessage);
      worker.value.postMessage({
        cssString: cssString,
        proxyUrl: `${store.state.API_ENDPOINT}/proxy/${store.state.selectedOrganization.identifier}`,
        id,
      });
    } else {
      reject("Worker not initialized");
    }
  });
};

watch(
  () => props.segments.length,
  (length) => {
    if (!length) return;
    const step = () => {
      if (!player.value) return setupSession();
      const pending = props.segments.slice(convertedSegmentCount);
      convertedSegmentCount = props.segments.length;
      return appendSegments(pending as any[], convertedSegmentCount);
    };
    // Serialised and kept alive on failure: a batch must not convert before the previous one has adopted the run.
    segmentWork = segmentWork.then(step, step).catch((e) => {
      console.error("Session replay: segment processing failed", e);
    });
  },
  { immediate: true },
);

// The metadata length is known before the first frame, so the total shows from the start.
watch(
  () => [props.sessionStartMs, props.sessionEndMs],
  () => refreshTimeline(),
  { immediate: true },
);

// The parent holds the target; the rrweb playhead stays put, because moving it into unloaded time drops every record up to it.
watch(
  () => props.pendingSeekMs,
  (target, previous) => {
    if (target !== null && (previous ?? null) === null) {
      if (mode.value === "playing" || mode.value === "buffering") {
        player.value?.pause();
        mode.value = "buffering";
      } else {
        mode.value = "waiting";
      }
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
      // A last batch that ends inside the margin would otherwise buffer forever; finish then leads to Ended.
      if (mode.value === "buffering" && props.pendingSeekMs === null && player.value) {
        resumeAt(playerState.value.actualTime);
      }
      return;
    }
    if (state === "failed" && props.pendingSeekMs === null) {
      if (mode.value === "buffering" || mode.value === "waiting") {
        failedWasPlaying = mode.value === "buffering";
        mode.value = "failed";
      }
      return;
    }
    if (state === "loading" && previous === "failed" && mode.value === "failed") {
      mode.value = failedWasPlaying ? "buffering" : "paused";
    }
  },
);

// The run reaching its last segment ends the wait just as a complete load does.
watch(awaitingData, (awaiting) => {
  if (!awaiting && props.loadState === "loading") tryResume();
});

watch(playbackState, (state) => emit("playback-state", state));

defineExpose({
  goto,
  seekTo,
  play,
  pause,
  togglePlay,
  setSpeed,
  toggleSkipInactive,
  playerState,
  playbackState,
  updatePlayerState,
});
</script>
