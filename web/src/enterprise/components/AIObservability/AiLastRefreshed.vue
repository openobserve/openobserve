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
  AiLastRefreshed — the "· N ago" staleness indicator shown left of the date
  picker on every AI Observability page. Same formatting and thresholds as
  ORefreshButton (green <30s / amber <5m / red), but detached from the icon
  button so pages using a labeled primary Refresh button can still surface the
  timestamp. Ticks every 10s so it stays current between refreshes.
-->
<template>
  <span
    v-if="lastRunAt"
    class="inline-flex items-center gap-1.5"
    :title="title"
    :data-test="dataTest"
  >
    <span :class="['size-2 shrink-0 rounded-full transition-colors duration-700', dotClass]" />
    <span class="text-text-secondary text-xs whitespace-nowrap tabular-nums select-none">
      {{ relativeTime }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Epoch-ms of the last refresh, or null before the first one. */
    lastRunAt: number | null;
    /** Whether a refresh is in flight — greys the staleness dot. */
    loading?: boolean;
    dataTest?: string;
  }>(),
  { loading: false, dataTest: undefined },
);

const { t } = useI18nTyped();

const now = ref(Date.now());
let tickId: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  tickId = setInterval(() => (now.value = Date.now()), 10_000);
});
onBeforeUnmount(() => {
  if (tickId) clearInterval(tickId);
});
// A fresh refresh should reset to "just now" immediately, not wait for the tick.
watch(
  () => props.lastRunAt,
  () => (now.value = Date.now()),
);

const staleSeconds = computed(() =>
  props.lastRunAt ? Math.floor((now.value - props.lastRunAt) / 1000) : Infinity,
);
const relativeTime = computed<I18nText>(() => {
  const sec = staleSeconds.value;
  if (sec === Infinity) return raw("");
  if (sec < 5) return t("refreshButton.justNow");
  if (sec < 60) return t("refreshButton.secondsAgo", { sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("refreshButton.minutesAgo", { min });
  return t("refreshButton.hoursAgo", { h: Math.floor(min / 60) });
});
const dotClass = computed(() => {
  if (props.loading) return "bg-refresh-dot-idle";
  const s = staleSeconds.value;
  if (s === Infinity) return "bg-refresh-dot-idle";
  if (s < 30) return "bg-refresh-dot-fresh";
  if (s < 300) return "bg-refresh-dot-stale";
  return "bg-refresh-dot-critical";
});
const title = computed<I18nText>(() =>
  props.lastRunAt
    ? t("refreshButton.lastRefreshed", {
        time: new Date(props.lastRunAt).toLocaleTimeString(),
      })
    : t("refreshButton.notYetRefreshed"),
);
</script>
