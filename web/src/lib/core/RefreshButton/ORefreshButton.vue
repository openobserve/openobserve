<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import OButton from "../Button/OButton.vue";
import type {
  RefreshButtonProps,
  RefreshButtonEmits,
} from "./ORefreshButton.types";

const props = withDefaults(defineProps<RefreshButtonProps>(), {
  lastRunAt: null,
  loading: false,
  disabled: false,
});

const emit = defineEmits<RefreshButtonEmits>();

const relativeTime = ref("");
let intervalId: ReturnType<typeof setInterval> | null = null;

const diffSeconds = (): number => {
  if (!props.lastRunAt) return Infinity;
  return Math.floor((Date.now() - props.lastRunAt) / 1000);
};

const getRelativeTime = (ts: number): string => {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
};

const updateRelativeTime = () => {
  if (!props.lastRunAt) {
    relativeTime.value = "";
    return;
  }
  relativeTime.value = getRelativeTime(props.lastRunAt);
};

// green < 30s, amber 30s–5min, red > 5min
const dotColor = computed(() => {
  if (props.loading) return "tw:bg-refresh-dot-idle";
  const s = diffSeconds();
  if (s === Infinity) return "tw:bg-refresh-dot-idle";
  if (s < 30) return "tw:bg-refresh-dot-fresh";
  if (s < 300) return "tw:bg-refresh-dot-stale";
  return "tw:bg-refresh-dot-critical";
});

const dotTitle = computed(() => {
  const s = diffSeconds();
  if (s === Infinity) return "Not yet refreshed";
  if (s < 30) return "Data is fresh";
  if (s < 300) return "Data is getting stale";
  return "Data is stale";
});

const exactTime = computed(() => {
  if (!props.lastRunAt) return "Not yet refreshed";
  return `Last refreshed: ${new Date(props.lastRunAt).toLocaleTimeString()}`;
});

onMounted(() => {
  updateRelativeTime();
  intervalId = setInterval(updateRelativeTime, 10_000);
});

onBeforeUnmount(() => {
  if (intervalId) clearInterval(intervalId);
});

watch(() => props.lastRunAt, updateRelativeTime, { immediate: true });

function handleClick(e: MouseEvent) {
  if (props.loading || props.disabled) return;
  emit("click", e);
}
</script>

<template>
  <div class="tw:inline-flex tw:items-center tw:gap-1.5">
    <!-- staleness dot -->
    <span
      :class="[
        'tw:size-2 tw:rounded-full tw:shrink-0 tw:transition-colors tw:duration-700',
        dotColor,
      ]"
      :title="dotTitle"
    />
    <!-- relative timestamp -->
    <span
      v-if="lastRunAt"
      class="tw:text-xs tw:text-text-secondary tw:tabular-nums tw:whitespace-nowrap tw:select-none"
      :title="exactTime"
    >
      {{ relativeTime || "just now" }}
    </span>
    <!-- refresh icon button -->
    <OButton
      variant="ghost"
      size="icon"
      :loading="loading"
      :disabled="disabled"
      :title="exactTime"
      data-test="refresh-button"
      class="tw:size-7"
      @click="handleClick"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        :class="{ 'tw:animate-spin': loading }"
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </svg>
    </OButton>
  </div>
</template>
