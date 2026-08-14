<!--
  Rendered only when the window ahead actually has a hole in it.

  The strip this replaces answered "handover in" — which the team pulse's
  Backing-them-up cell already says — and reported "No gaps" permanently, a row
  spent confirming that nothing is wrong. A gap is the attention-banner kind of
  fact: absent when healthy, loud and actionable when real.
-->
<template>
  <div
    v-if="gaps.count"
    class="border-status-error-border bg-status-error-bg rounded-surface flex flex-wrap items-center gap-x-3 gap-y-2 border px-4 py-3"
    data-test="oncall-gap-banner"
  >
    <OIcon name="warning" size="sm" class="text-status-error-text shrink-0" />
    <span class="text-status-error-text text-sm font-medium">
      {{ t("oncall.gapBannerCount", { count: gaps.count, duration: gaps.total }, gaps.count) }}
    </span>
    <span class="text-text-secondary text-xs">{{ raw(gaps.firstWindow) }}</span>
    <!-- Straight into a pre-filled cover for the first hole — the whole reason
         to interrupt the reader is that they can fix it from here. -->
    <OButton
      variant="outline"
      size="xs"
      class="ms-auto"
      data-test="oncall-gap-banner-fill"
      @click="emit('fill-gap', gaps.first as ResolvedSegment)"
    >
      {{ t("oncall.timelineFillGap") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ResolvedSegment } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    /** `resolved-schedule` for the window the chart is showing. */
    segments?: ResolvedSegment[];
    /** The team's zone — a gap window read in the browser's zone is a lie. */
    timezone?: string;
    /** Micros. Defaults to now; injectable so the spec is not clock-dependent. */
    now?: number;
  }>(),
  { segments: () => [], timezone: "UTC", now: 0 },
);

const emit = defineEmits<{ "fill-gap": [gap: ResolvedSegment] }>();

const { t } = useI18nTyped();

const nowMicros = computed(() => props.now || Date.now() * 1000);

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

/// A gap is a segment with nobody in it — never a hole between segments, which
/// is what makes it countable at all. Only spans still ahead of now matter:
/// last night's gap is a postmortem, not a warning.
const gaps = computed(() => {
  const found = props.segments.filter((s) => !s.user_email && s.to > nowMicros.value);
  const total = found.reduce((sum, s) => sum + (s.to - Math.max(s.from, nowMicros.value)), 0);
  const first = found[0] ?? null;
  return {
    count: found.length,
    first,
    total: formatMicrosDuration(total),
    firstWindow: first ? `${formatAt(first.from)} → ${formatAt(first.to)}` : "",
  };
});
</script>
