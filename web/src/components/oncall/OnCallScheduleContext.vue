<!--
  The two facts that belong to the SCHEDULE rather than to the team: when the
  pager moves and to whom, and whether the window ahead has a hole in it.

  Who is on call and who is backing them live in the team strip above the tabs,
  where they are visible on every tab. Repeating them here would make a reader
  stop and check whether the two agree.

  Both are read off segments the chart is already drawing, so the strip costs no
  request and cannot drift from the chart underneath it.
-->
<template>
  <div
    class="border-border-default bg-surface-base grid grid-cols-1 gap-px border-y sm:grid-cols-2"
    data-test="oncall-schedule-context"
  >
    <!-- The countdown, and the name it hands to. A time with no successor is
         half the answer: "who do I brief" is the reason anybody reads this. -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <OText variant="meta">{{ t("oncall.ctxHandoverIn") }}</OText>
      <template v-if="handover">
        <span
          class="text-text-heading text-lg font-medium tabular-nums"
          data-test="oncall-schedule-context-countdown"
        >
          {{ raw(handover.countdown) }}
        </span>
        <span class="text-text-secondary flex flex-wrap items-center gap-1 text-xs">
          {{ raw(handover.at) }}
          <OIcon name="arrow-forward" size="xs" />
          <OUserCell v-if="handover.to" :value="handover.to" />
          <span v-else class="text-status-error-text">{{ t("oncall.ctxHandsToNobody") }}</span>
        </span>
      </template>
      <p v-else class="text-text-muted text-sm">{{ ABSENT }}</p>
    </section>

    <!-- The only cell that is ever alarming, and only when it should be. -->
    <section class="bg-surface-base flex flex-col gap-1.5 px-4 py-3">
      <OText variant="meta">{{ t("oncall.ctxGapsIn", { days: windowDays }) }}</OText>
      <template v-if="gaps.count">
        <span
          class="text-status-error-text text-lg font-medium"
          data-test="oncall-schedule-context-gaps"
        >
          {{ t("oncall.ctxGapCount", { count: gaps.count, duration: gaps.total }, gaps.count) }}
        </span>
        <span class="text-text-secondary text-xs">{{ raw(gaps.firstWindow) }}</span>
      </template>
      <template v-else>
        <span class="text-status-success-text text-lg font-medium">
          {{ t("oncall.ctxNoGaps") }}
        </span>
        <OText variant="meta">{{ t("oncall.ctxNoGapsHint") }}</OText>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { ResolvedSegment } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { ABSENT } from "@/composables/useSloFormat";
import { formatMicrosDuration } from "@/utils/formatters";

const MICROS_PER_DAY = 86_400_000_000;

const props = withDefaults(
  defineProps<{
    /** `resolved-schedule` for the window the chart is showing. */
    segments?: ResolvedSegment[];
    /** The team's zone. Every instant here is rendered in it, never the browser's. */
    timezone?: string;
    /** Micros. Defaults to now; injectable so the spec is not clock-dependent. */
    now?: number;
  }>(),
  { segments: () => [], timezone: "UTC", now: 0 },
);

const { t } = useI18nTyped();

const nowMicros = computed(() => props.now || Date.now() * 1000);

/// The team's zone, never the browser's — the schedule is written in one zone
/// and every handover on this strip has to be read in it.
function formatAt(micros: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: props.timezone,
  }).format(new Date(micros / 1000));
}

/// When the segment covering `now` ends, and who the next one names. Read off
/// the server's segments rather than the rotation's cadence, so a cover or an
/// absence moves the countdown exactly as it moves the page.
const handover = computed(() => {
  const ordered = [...props.segments].sort((a, b) => a.from - b.from);
  const index = ordered.findIndex((s) => s.from <= nowMicros.value && s.to > nowMicros.value);
  const current = index >= 0 ? ordered[index] : null;
  if (!current) return null;
  const next = ordered[index + 1];
  return {
    countdown: formatMicrosDuration(current.to - nowMicros.value),
    at: formatAt(current.to),
    to: next?.user_email ?? "",
  };
});

const windowDays = computed(() => {
  const spans = props.segments;
  if (!spans.length) return 0;
  const from = Math.min(...spans.map((s) => s.from));
  const to = Math.max(...spans.map((s) => s.to));
  return Math.max(1, Math.round((to - from) / MICROS_PER_DAY));
});

/// A gap is a segment with nobody in it — never a hole between segments, which
/// is what makes it countable at all.
const gaps = computed(() => {
  const found = props.segments.filter((s) => !s.user_email && s.to > nowMicros.value);
  const total = found.reduce((sum, s) => sum + (s.to - Math.max(s.from, nowMicros.value)), 0);
  const first = found[0];
  return {
    count: found.length,
    total: formatMicrosDuration(total),
    firstWindow: first ? `${formatAt(first.from)} → ${formatAt(first.to)}` : "",
  };
});
</script>
