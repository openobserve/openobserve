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
  <div class="player-container h-full p-2 flex flex-col">
    <div
      v-if="isLoading"
      class="pb-4 flex items-center justify-center text-center w-full flex-1 min-h-0"
    >
      <div>
        <OSpinner
          size="md"
          class="mx-auto block"
          data-test="video-player-loading-indicator"
        />
        <div class="text-center w-full">
          {{ t("rum.loadingSessions") }}
        </div>
      </div>
    </div>
    <div
      ref="playerContainerRef"
      class="flex items-center justify-center flex-1 min-h-0"
    >
      <div
        ref="playerRef"
        id="player"
        class="player h-full flex items-center cursor-pointer"
        @click="togglePlay"
      />
    </div>
    <div class="w-full p-2 pt-3 controls-container">
      <div
        ref="playbackBarRef"
        data-test="video-player-playback-bar"
        class="w-full h-[0.3125rem] bg-surface-subtle mt-2 mb-3 relative cursor-pointer"
        @click="handlePlaybackBarClick"
      >
        <div
          class="bg-button-primary! absolute"
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
            width: '2px',
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
                ? '3px'
                : '2px',
            left:
              (event.relativeTime / playerState.totalTime) * playerState.width +
              'px',
            bottom: '-0.3125rem',
            height:
              event.frustration_types && event.frustration_types.length > 0
                ? '1.125rem'
                : '0.9375rem',
          }"
          :title="getEventTooltip(event)"
        />
      </div>
      <div class="controls flex justify-between items-center">
        <div class="flex items-center">
          <div>
            <OIcon
              name="replay-10"
              size="md"
              class="mr-2 cursor-pointer text-icon-color hover:text-button-primary"
              @click="skipTo('backward')"
            />
            <OIcon
              :name="
                playerState.isPlaying
                  ? 'pause-circle-filled'
                  : 'play-circle-filled'
              "
              size="lg"
              class="cursor-pointer text-icon-color hover:text-button-primary"
              @click="togglePlay"
            />
            <OIcon
              name="forward-10"
              size="md"
              class="ml-2 cursor-pointer text-icon-color hover:text-button-primary"
              @click="skipTo('forward')"
            />
          </div>
          <div class="flex ml-4 items-center">
            <div>{{ playerState.time }}</div>
            <div class="px-1">/</div>
            <div>{{ playerState.duration }}</div>
          </div>
        </div>
        <div class="flex items-center">
          <OSwitch
            class="mr-3 whitespace-nowrap"
            v-model="playerState.skipInactivity"
            :label="t('rum.skipInactivity')"
            @update:model-value="toggleSkipInactive"
          />
          <OSelect
            v-model="playerState.speed"
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
import { cloneDeep } from "lodash-es";
import {
  nextTick,
  ref,
  watch,
  type Ref,
  onBeforeUnmount,
  onMounted,
  onBeforeMount,
  onActivated,
  onDeactivated,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import { createRecordConverter } from "@/utils/rum/sessionReplayChangeFormat";
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
});

const { t } = useI18n();

const store = useStore();

let rrwebPlayer: any;

const player = ref<any>();

const playerRef = ref<HTMLElement | null>(null);

const playbackBarRef = ref<HTMLElement | null>(null);

const session = ref<any>([]);

const playerContainerRef = ref<HTMLElement | null>(null);

const worker: Ref<Worker | null> = ref(null);

const workerProcessId = ref(0);

const sessionWidth = ref(0);
const sessionHeight = ref(0);
const resizeObserver = ref<ResizeObserver | null>(null);

const speedOptions = [
  {
    label: "0.5x",
    value: 0.5,
  },
  {
    label: "1x",
    value: 1,
  },
  {
    label: "1.5x",
    value: 1.5,
  },
  {
    label: "2x",
    value: 2,
  },
  {
    label: "3x",
    value: 3,
  },
  {
    label: "4x",
    value: 4,
  },
];

const playerState = ref({
  isPlaying: false,
  time: "00.00",
  duration: "00.00", // in ms
  speed: 4,
  progressWidth: 0,
  playBackEvents: {
    views: true,
    actions: true,
    errors: true,
  },
  skipInactivity: true,
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

const setupSession = async () => {
  session.value = [];
  if (!props.segments.length) return;

  // The SDK v7 serialization emits session-replay snapshots in the compact "Change"
  // format (FullSnapshot type 2 with format:1 and data:Change[], plus Change records of
  // type 12). @openobserve/rrweb-player only understands the classic rrweb format, so we
  // convert here. A single converter instance threads node-id / string-table state across
  // all records in order (it resets itself on each full snapshot, mirroring the SDK).
  const recordConverter = createRecordConverter();

  props.segments.forEach((segment: any) => {
    const convertedRecords: any[] = [];
    segment.records.forEach((record: any) => {
      convertedRecords.push(...recordConverter.convert(cloneDeep(record)));
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
      try {
        if (segCopy.type === 2 && segCopy.data.node.type === 0) {
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
                      processCss(
                        __child.attributes._cssText,
                        workerProcessId.value,
                      ).then((res: any) => {
                        __child.attributes._cssText = res.updatedCssString;
                      });
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
      session.value.push(segCopy);
    });
  });

  // let lastEventTime = 1692884586897;
  // const inactivityThreshold = 5000; // 5 seconds

  // session.value.forEach((event) => {
  //   const currentTime = event.timestamp;
  //   if (currentTime - lastEventTime > inactivityThreshold) {
  //     console.log(
  //       `Inactivity detected between timestamps ${lastEventTime} and ${currentTime} is of ${formatTimeDifference(
  //         currentTime - lastEventTime
  //       )} ms.`
  //     );
  //   }
  //   lastEventTime = currentTime;
  // });

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
  player.value = new rrwebPlayer({
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
      speed: playerState.value.speed,
      skipInactive: playerState.value.skipInactivity,
    },
  });

  // events.forEach((event) => {
  //   if (event.type === 2 || event.type === 4) {
  //     player.value?.addEvent(event);
  //   }
  // });

  player.value.addEventListener("ui-update-current-time", updateProgressBar);

  player.value.addEventListener("finish", () => {
    playerState.value.isPlaying = false;
  });

  player.value.addEventListener("error", () => {
    console.error("Playback error:");
  });

  // player.value.addEventListener("event-cast", (e) => {
  //   // console.log("event casted:", e);
  // });

  if (!player.value) return;
  updatePlayerState();
};

const updatePlayerState = () => {
  if (!player?.value) return;
  const playerMeta = player.value?.getMetaData();

  if (!playerMeta) return;
  playerState.value.startTime = playerMeta?.startTime;
  playerState.value.endTime = playerMeta?.endTime;
  playerState.value.totalTime = playerMeta?.totalTime;
  playerState.value.duration = formatTimeDifference(
    playerState.value.totalTime,
  );

  const playbackBarWidth = playbackBarRef.value?.clientWidth || 0;
  // calculate width of progress bar
  playerState.value.width = playbackBarWidth;
  player.value.triggerResize();
};

const getEventMarkerClass = (event: any) => {
  if (event.frustration_types && event.frustration_types.length > 0) {
    return "bg-badge-orange-solid-bg! shadow-[0_0_4px_rgba(251,146,60,0.6)]";
  }
  if (event.type === "error") {
    return "bg-badge-error-solid-bg!";
  }
  return "bg-badge-teal-solid-bg!";
};

const getEventTooltip = (event: any) => {
  const eventName =
    event.name.length > 100 ? event.name.slice(0, 100) + "..." : event.name;

  if (event.frustration_types && event.frustration_types.length > 0) {
    const frustrationLabels = event.frustration_types
      .map((type: string) => {
        return type
          .replace(/_/g, " ")
          .replace(/\b\w/g, (l: string) => l.toUpperCase());
      })
      .join(", ");
    return `⚠️ FRUSTRATION: ${frustrationLabels}\n${eventName}`;
  }

  return eventName;
};

function formatTimeDifference(milliSeconds: number) {
  // Calculate hours, minutes, and seconds
  let hours: string | number = Math.floor(milliSeconds / (1000 * 60 * 60));
  let minutes: string | number = Math.floor(
    (milliSeconds % (1000 * 60 * 60)) / (1000 * 60),
  );
  let seconds: string | number = Math.floor(
    (milliSeconds % (1000 * 60)) / 1000,
  );

  // Add leading zeros if needed
  hours = hours < 10 ? "0" + hours : hours;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  seconds = seconds < 10 ? "0" + seconds : seconds;

  if (hours === "00") {
    return `${minutes}:${seconds}`;
  }

  if (hours === "00" && minutes === "00") {
    return `${seconds}`;
  }

  return `${hours}:${minutes}:${seconds}`;
}

const updateProgressBar = (time: { payload: number }) => {
  playerState.value.progressWidth =
    (time.payload / playerState.value.totalTime) * playerState.value.width;
  playerState.value.actualTime = time.payload;
  playerState.value.time = formatTimeDifference(time.payload);
};

const handlePlaybackBarClick = (event: any) => {
  if (!playbackBarRef.value) return;
  const playbackBarEl = playbackBarRef.value.getBoundingClientRect();

  let time =
    ((event.clientX - playbackBarEl.left) / playerState.value.width) *
    playerState.value.totalTime;

  goto(time, playerState.value.isPlaying);
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
  playerState.value.isPlaying = true;
  player.value?.play();
};

const pause = () => {
  playerState.value.isPlaying = false;
  player.value?.pause();
};

const setSpeed = (speed: SelectModelValue) => {
  // speedOptions are numeric; ignore any non-numeric emission.
  if (typeof speed === "number") player.value?.setSpeed(speed);
};
const toggleSkipInactive = () => {
  player.value?.toggleSkipInactive();
};

const goto = (timeOffset: number, play: boolean = false) => {
  playerState.value.isPlaying = play;
  player.value?.goto(timeOffset, play);
};

const skipTo = (skipTo: string) => {
  const seconds = 10;
  if (skipTo === "forward") {
    const newTime = Math.min(
      playerState.value.actualTime + seconds * 1000,
      playerState.value.totalTime,
    );
    goto(newTime, false);
  } else {
    const newTime = Math.max(playerState.value.actualTime - seconds * 1000, 0);
    goto(newTime, false);
  }
};

const initializeWorker = () => {
  if (window.Worker) {
    // Creating the Web Worker
    worker.value = new Worker(
      new URL("../../workers/rumcssworker.js", import.meta.url),
      { type: "module" },
    );
  } else {
    console.error("Web Workers are not supported in this browser.");
  }
};

const processCss = (cssString: string, id: string | number) => {
  return new Promise((resolve, reject) => {
    if (worker.value) {
      const handleWorkerMessage = (event: any) => {
        if (event.data.id === id) {
          if (worker.value)
            worker.value.removeEventListener("message", handleWorkerMessage);
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
  () => props.segments,
  (value) => {
    if (value.length) setupSession();
  },
  { deep: true, immediate: true },
);

defineExpose({
  goto,
  play,
  pause,
  togglePlay,
  setSpeed,
  toggleSkipInactive,
  playerState,
  updatePlayerState,
});
</script>

