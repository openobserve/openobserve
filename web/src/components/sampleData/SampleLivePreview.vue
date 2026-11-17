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
  <!-- the parent sets the height; the bar strip takes whatever the log lines leave -->
  <div
    aria-hidden="true"
    class="border-border-default bg-surface-subtle rounded-default flex flex-col gap-2 overflow-hidden border p-2"
  >
    <div
      v-if="chart"
      class="flex min-h-0 flex-1 items-end gap-0.5"
      data-test="sample-live-preview-bars"
    >
      <span
        v-for="bar in bars"
        :key="bar.id"
        class="rounded-t-default flex-1 transition-[height] duration-500"
        :class="[bar.height, bar.hot ? 'bg-status-error-text/80' : 'bg-accent/40']"
      />
    </div>
    <TransitionGroup
      tag="div"
      class="text-2xs flex h-[5.5rem] shrink-0 flex-col justify-end gap-0.5 overflow-hidden font-mono"
      enter-from-class="opacity-0 translate-y-2"
      enter-active-class="transition duration-300"
      move-class="transition duration-300"
      data-test="sample-live-preview-lines"
    >
      <!-- fixed line and box heights: the leaving line lingers a frame, which must not resize the dialog -->
      <span v-for="line in logs" :key="line.id" class="flex h-4 min-w-0 shrink-0 gap-2 leading-4">
        <span class="text-text-secondary shrink-0">{{ line.time }}</span>
        <span class="w-8 shrink-0 font-semibold" :class="LEVEL_CLASS[line.level]">{{
          line.label
        }}</span>
        <span class="text-text-body truncate">{{ line.text }}</span>
      </span>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { raw } from "@/types/i18n";
import { prefersReducedMotion } from "@/components/ingestion/setupCard/useStreamDetect";
import type { SampleLogLine } from "@/utils/sampleData/loader";

const props = withDefaults(
  defineProps<{ paused?: boolean; chart?: boolean; feed?: SampleLogLine[] }>(),
  { chart: true, feed: undefined },
);

type PreviewLevel = "info" | "warn" | "error";

const BAR_COUNT = 32;
const LOG_COUNT = 5;
// shares of the strip, so the bars scale with whatever height the parent gives
const BAR_HEIGHTS = ["h-1/6", "h-1/4", "h-1/3", "h-5/12", "h-1/2"];
const HOT_BAR_HEIGHTS = ["h-7/12", "h-2/3", "h-3/4", "h-5/6", "h-11/12", "h-full"];
const TICK_MS = 1200;
const FEED_TICK_MS = 300;
const LEVEL_CLASS: Record<PreviewLevel, string> = {
  info: "text-status-success-text",
  warn: "text-status-warning-text",
  error: "text-status-error-text",
};
const PREVIEW_MESSAGES: [PreviewLevel, string][] = [
  ["info", "cart: added sku=4821 to cart"],
  ["info", "inventory: reserved 2 units sku=4821"],
  ["warn", "payment: gateway latency 2.4s over 1s budget"],
  ["error", "payment: upstream timeout calling gateway"],
  ["error", "checkout: order 88213 failed, payment timeout"],
  ["info", 'search: query "running shoes" 38ms'],
  ["warn", "checkout: retrying payment attempt 2 of 3"],
];

let nextId = 0;
let messageIndex = 0;
const pickHeight = (hot: boolean) => {
  const heights = hot ? HOT_BAR_HEIGHTS : BAR_HEIGHTS;
  return heights[Math.floor(Math.random() * heights.length)];
};
const newBar = (hot: boolean) => ({ id: nextId++, hot, height: pickHeight(hot) });
// the incident sits at the right edge, like the sample data's own error spike
const bars = ref(Array.from({ length: BAR_COUNT }, (_, i) => newBar(i >= BAR_COUNT - 6)));

const toLevel = (level: string): PreviewLevel =>
  level.startsWith("err") ? "error" : level.startsWith("warn") ? "warn" : "info";
const lineOf = (level: PreviewLevel, text: string, time: string) => ({
  id: nextId++,
  level,
  label: raw(level.toUpperCase().slice(0, 4)),
  text: raw(text),
  time: raw(time),
});
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);
const newLog = () => {
  const [level, text] = PREVIEW_MESSAGES[messageIndex++ % PREVIEW_MESSAGES.length];
  return lineOf(level, text, clock(Date.now()));
};

// with a feed it plays the rows actually being sent; without one (before any load) it simulates
const queue: SampleLogLine[] = [];
const fromFeed = () => {
  const row = queue.shift();
  return row && lineOf(toLevel(row.level), row.text, clock(row.ts / 1000));
};
const logs = ref(props.feed ? [] : Array.from({ length: LOG_COUNT }, newLog));
watch(
  () => props.feed,
  (feed) => {
    if (!feed) return;
    queue.splice(0, queue.length, ...feed);
    if (prefersReducedMotion()) {
      logs.value = feed
        .slice(-LOG_COUNT)
        .map((r) => lineOf(toLevel(r.level), r.text, clock(r.ts / 1000)));
    }
  },
  { immediate: true },
);

const tick = () => {
  if (document.hidden) return;
  const log = props.feed ? fromFeed() : newLog();
  if (!log) return;
  logs.value = [...logs.value, log].slice(-LOG_COUNT);
  if (props.chart) bars.value = [...bars.value.slice(1), newBar(log.level !== "info")];
};

let timer: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.paused,
  (paused) => {
    clearInterval(timer);
    timer =
      paused || prefersReducedMotion()
        ? undefined
        : setInterval(tick, props.feed ? FEED_TICK_MS : TICK_MS);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));
</script>
