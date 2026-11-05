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
  <div class="flex w-full shrink-0 flex-col gap-1.5 px-1 py-2" data-test="workflow-runs-timeline">
    <div class="flex items-center justify-between gap-2 px-1">
      <span
        class="text-2xs text-text-secondary tabular-nums"
        data-test="workflow-runs-timeline-start"
      >
        {{ startLabel }}
      </span>
      <div class="flex items-center gap-3" data-test="workflow-runs-timeline-legend">
        <span
          v-for="slot in legend"
          :key="slot.key"
          class="text-2xs text-text-secondary flex items-center gap-1"
          :data-test="`workflow-runs-timeline-legend-${slot.key}`"
        >
          <span class="rounded-default inline-block size-2" :class="slot.swatch" />
          <span
            class="inline-block min-w-[2ch] text-end tabular-nums"
            :data-test="`workflow-runs-timeline-count-${slot.key}`"
            >{{ slot.count }}</span
          >
          {{ slot.label }}
        </span>
      </div>
      <span
        class="text-2xs text-text-secondary tabular-nums"
        data-test="workflow-runs-timeline-end"
      >
        {{ endLabel }}
      </span>
    </div>

    <div class="flex w-full flex-col gap-0.75 px-1">
      <div
        class="bg-surface-subtle rounded-default relative h-6 w-full overflow-hidden"
        data-test="workflow-runs-timeline-track"
      >
        <div
          v-for="bar in bars"
          :key="bar.id"
          class="rounded-default absolute inset-y-0 w-1.5 -translate-x-1/2"
          :class="[STATUS_BAR[bar.status], bar.matched ? '' : 'opacity-20 dark:opacity-30']"
          :style="{ left: `${bar.left}%` }"
          :data-test="`workflow-runs-timeline-bar-${bar.id}`"
          :data-matched="bar.matched"
        />
      </div>
      <div class="flex w-full justify-between" data-test="workflow-runs-timeline-ticks">
        <span
          v-for="(tick, i) in ticks"
          :key="i"
          class="text-2xs text-text-secondary whitespace-nowrap tabular-nums"
        >
          {{ tick }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatInTimeZone } from "date-fns-tz";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { HookRunStatus } from "@/services/workflows";
import { RUN_TIME_SHORT } from "@/plugins/workflows/runStatus";

export interface TimelineRun {
  id: string;
  at: number;
  status: HookRunStatus;
  matched: boolean;
}

const props = defineProps<{
  runs: TimelineRun[];

  start: number;
  end: number;
  timezone?: string;
}>();

const { t } = useI18nTyped();

const TICK_COUNT = 5;
const MINUTE_US = 60_000_000;
const HOUR_US = 60 * MINUTE_US;
const DAY_US = 24 * HOUR_US;

const LIVE_SLACK_US = 2 * MINUTE_US;

const STATUS_BAR: Record<HookRunStatus, string> = {
  succeeded: "bg-badge-success-solid-bg",
  failed: "bg-badge-error-solid-bg",
  running: "bg-badge-blue-solid-bg",
  queued: "bg-badge-blue-solid-bg",
  expired: "bg-border-strong",
};

const zone = computed(
  () => props.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
);
const formatAt = (us: number) =>
  raw(us > 0 ? formatInTimeZone(new Date(us / 1000), zone.value, RUN_TIME_SHORT) : "");

const startLabel = computed(() => formatAt(props.start));
const endLabel = computed(() => formatAt(props.end));

const span = computed(() => Math.max(props.end - props.start, 1));

const bars = computed(() =>
  props.runs
    .filter((r) => r.at >= props.start && r.at <= props.end)
    .map((r) => ({
      ...r,

      left: Math.min(99.5, Math.max(0.5, ((r.at - props.start) / span.value) * 100)),
    })),
);

const legend = computed(() => {
  const shown = props.runs.filter((r) => r.matched);
  const count = (...statuses: HookRunStatus[]) =>
    shown.filter((r) => statuses.includes(r.status)).length;
  return [
    {
      key: "success",
      swatch: STATUS_BAR.succeeded,
      count: count("succeeded"),
      label: t("workflow.history.success"),
    },
    {
      key: "failed",
      swatch: STATUS_BAR.failed,
      count: count("failed"),
      label: t("workflow.history.failed"),
    },
    {
      key: "running",
      swatch: STATUS_BAR.running,
      count: count("running", "queued"),
      label: t("workflow.history.statusRunning"),
    },
  ];
});

const offsetLabel = (us: number): I18nText => {
  const trim = (n: number) => Number(n.toFixed(1));
  if (us >= 2 * DAY_US) return t("workflow.history.timelineAgoDays", { n: trim(us / DAY_US) });
  if (us >= HOUR_US) return t("workflow.history.timelineAgoHours", { n: trim(us / HOUR_US) });
  return t("workflow.history.timelineAgoMinutes", { n: Math.round(us / MINUTE_US) });
};

const ticks = computed<I18nText[]>(() => {
  const live = Math.abs(Date.now() * 1000 - props.end) <= LIVE_SLACK_US;
  return Array.from({ length: TICK_COUNT }, (_, i) => {
    const before = (span.value * (TICK_COUNT - 1 - i)) / (TICK_COUNT - 1);
    if (before === 0) return live ? t("workflow.history.timelineNow") : endLabel.value;
    return offsetLabel(before);
  });
});
</script>
