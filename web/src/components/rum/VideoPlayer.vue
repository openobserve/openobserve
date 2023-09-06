<template>
  <div ref="playerContainerRef" class="player-container full-height q-ma-sm">
    <div ref="playerRef" id="player" class="player flex items-center"></div>
    <div class="full-width q-pa-sm q-pt-md controls-container">
      <div
        ref="playbackBarRef"
        class="playback_bar q-mt-sm q-mb-md relative-position cursor-pointer"
        @click="handlePlaybackBarClick"
      >
        <div
          class="progressTime bg-primary absolute"
          :style="{
            width: playerState.progressWidth + 'px',
            left: 0,
            top: 0,
            height: '100%',
            transition: 'all 0.1s linear',
          }"
        />
        <div
          class="progressTime bg-primary absolute"
          :style="{
            width: '2px',
            left: playerState.progressWidth - 2 + 'px',
            bottom: '-5px',
            height: '15px',
            transition: 'all 0.1s linear',
          }"
        />

        <div
          v-for="event in events"
          :key="event.id"
          class="progressTime bg-secondary absolute cursor-pointer"
          :style="{
            width: '2px',
            left:
              (event.relativeTime / playerState.totalTime) * playerState.width +
              'px',
            bottom: '-5px',
            height: '15px',
          }"
          title="This is event"
        ></div>
      </div>
      <div class="controls flex justify-between items-center">
        <div class="flex items-center">
          <div>
            <q-icon
              name="replay_10"
              size="24px"
              class="q-mr-sm cursor-pointer"
            />
            <q-icon
              :name="
                playerState.isPlaying
                  ? 'pause_circle_filled'
                  : 'play_circle_filled'
              "
              size="32px"
              class="cursor-pointer"
              @click="togglePlay"
            />
            <q-icon
              name="forward_10"
              size="24px"
              class="q-ml-sm cursor-pointer"
            />
          </div>
          <div class="flex q-ml-lg items-center">
            <div>{{ playerState.time }}</div>
            <div class="q-px-xs">/</div>
            <div>{{ playerState.duration }}</div>
          </div>
        </div>
        <div class="flex items-center">
          <q-toggle
            class="q-mr-md"
            v-model="playerState.skipInactivity"
            label="Skip Inactivity"
            size="xs"
            @update:model-value="toggleSkipInactive"
          />
          <q-select
            class="speed-selector"
            v-model="playerState.speed"
            :options="speedOptions"
            color="input-border"
            bg-color="input-bg"
            stack-label
            outlined
            filled
            dense
            size="xs"
            @update:model-value="setSpeed"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import { segments } from "./segments.js";
import { nextTick, ref, onMounted } from "vue";

defineProps({
  events: {
    type: Array,
    required: true,
  },
});

const player = ref<rrwebPlayer>();

const playerRef = ref<HTMLElement | null>(null);

const playbackBarRef = ref<HTMLElement | null>(null);

const session = ref<any>([]);

const playerContainerRef = ref<HTMLElement | null>(null);

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
  speed: {
    label: "1x",
    value: 1,
  },
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
});

onMounted(async () => {
  setupSession();
  const playerWidth = playerContainerRef.value?.clientWidth || 0;
  console.log(session);
  const playerHeight =
    (session.value[0].data.height / session.value[0].data.width) * playerWidth;
  if (playerRef.value) {
    playerRef.value.style.width = `${playerWidth}px`;
  }
  await nextTick();
  console.log("playerRef", playerRef.value);
  if (!playerRef.value) return;
  player.value = new rrwebPlayer({
    target: playerRef.value as HTMLElement,
    props: {
      events: session.value,
      autoPlay: false,
      showController: false,
      UNSAFE_replayCanvas: true,
      width: playerWidth,
      height: playerHeight,
    },
  });

  player.value.addEventListener("ui-update-current-time", updateProgressBar);
  player.value.addEventListener("finish", () => {
    playerState.value.isPlaying = false;
  });
  const playerMeta = player.value.getMetaData();
  playerState.value.startTime = playerMeta.startTime;
  playerState.value.endTime = playerMeta.endTime;
  playerState.value.totalTime = playerMeta.totalTime;
  console.log("playerMeta", playerMeta);
  playerState.value.duration = formatTimeDifference(
    playerState.value.totalTime
  );

  const playbackBarWidth = playbackBarRef.value?.clientWidth || 0;
  // calculate width of progress bar
  playerState.value.width = playbackBarWidth;

  // const replayer = new Replayer(session.value, {
  //   root: document.getElementById("player") as HTMLElement,
  // });

  // replayer.on("start", (payload) => {
  //   console.log("ui-update-current-time", payload);
  // });
});

const setupSession = () => {
  segments.forEach((segment: any) => {
    session.value.push(...segment.records);
    session.value = [
      ...session.value.sort((a: any, b: any) => a.timestamp - b.timestamp),
    ];
  });

  let lastEventTime = 1692884586897;
  const inactivityThreshold = 5000; // 5 seconds

  session.value.forEach((event) => {
    const currentTime = event.timestamp;
    if (currentTime - lastEventTime > inactivityThreshold) {
      console.log(
        `Inactivity detected between timestamps ${lastEventTime} and ${currentTime} is of ${formatTimeDifference(
          currentTime - lastEventTime
        )} ms.`
      );
    }
    lastEventTime = currentTime;
  });
};

function formatTimeDifference(milliSeconds: number) {
  // Calculate hours, minutes, and seconds
  let hours: string | number = Math.floor(milliSeconds / (1000 * 60 * 60));
  let minutes: string | number = Math.floor(
    (milliSeconds % (1000 * 60 * 60)) / (1000 * 60)
  );
  let seconds: string | number = Math.floor(
    (milliSeconds % (1000 * 60)) / 1000
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

  playerState.value.time = formatTimeDifference(time.payload);
};

const handlePlaybackBarClick = (event) => {
  let time =
    (event.offsetX / playerState.value.width) * playerState.value.totalTime;
  goto(time, false);
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

const setSpeed = (speed: { label: string; value: number }) => {
  player.value?.setSpeed(speed.value);
};
const toggleSkipInactive = () => {
  player.value?.toggleSkipInactive();
};

const goto = (timeOffset: number, play: boolean = false) => {
  playerState.value.isPlaying = play;
  player.value?.goto(timeOffset, play);
};
</script>

<style scoped>
.player {
  height: calc(100% - 100px);
}
.player-container {
  background: rgb(198, 198, 198);
}

.controls-container {
  background: rgb(169, 168, 168);
}

.playback_bar {
  width: 100%;
  height: 5px;
  background-color: #fff;
}
</style>

<style>
.speed-selector {
  .q-field__control {
    padding: 0 8px !important;
  }
  .q-field__marginal,
  .q-field__native,
  .q-field__control {
    min-height: 30px !important;
    height: 30px !important;
  }
}
</style>
