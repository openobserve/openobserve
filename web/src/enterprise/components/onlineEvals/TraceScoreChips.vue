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

<!-- No error text, ever — a transient search failure degrades to the empty
     state below, not a broken widget. A brief skeleton while a real score
     might still land, so the chips popping in doesn't read as a layout jump.
     A metric-chip badge per scorer, styled to match the other header badges
     (Service/Duration/...) on this same toolbar row. A bare number doesn't
     say what it measures or why the judge landed there, so every chip
     carries that on hover.

     A span can carry far more scores than this row has room for — an eval
     job pinning a dozen scorers, not just the two or three a manual
     evaluation adds — so only the first few render as chips; the rest live
     behind one "+N more" chip that opens the full list on click instead of
     scattering the header. -->
<template>
  <template v-if="loading && chips.length === 0">
    <OSkeleton
      v-for="n in 2"
      :key="n"
      type="rect"
      animation="wave"
      class="rounded-default me-[0.325rem] h-5.5 w-16 shrink-0"
      :data-test="`trace-score-chips-skeleton-${n}`"
    />
  </template>

  <OTooltip
    v-for="chip in visibleChips"
    :key="chip.key"
    side="bottom"
    max-width="17.5rem"
    hoverable
    content-class="p-0!"
  >
    <OTag
      type="metricChip"
      class="text-2xs bg-surface-base border-border-default border-s-badge-success-ol-border hover:bg-surface-panel me-[0.325rem] h-5.5 shrink-0 border border-s-[0.1875rem] border-solid px-1.5 transition-all duration-200 hover:-translate-y-px"
      :data-test="`trace-score-chip-${chip.key}`"
    >
      <template #icon><OIcon name="task-alt" size="xs" /></template>
      <span class="text-3xs text-text-secondary me-0.75 max-w-20 truncate font-medium">{{
        chip.label
      }}</span>
      <span class="text-3xs text-text-body font-semibold">{{ chip.value }}</span>
    </OTag>

    <template #content>
      <TraceScoreDetail :chip="chip" class="w-58 px-3 py-2.25" />
    </template>
  </OTooltip>

  <ODropdown v-if="overflowCount > 0" side="bottom" align="start" content-class="p-0!">
    <template #trigger>
      <OTag
        type="metricChip"
        clickable
        class="text-2xs bg-surface-base border-border-default hover:bg-surface-panel me-[0.325rem] h-5.5 shrink-0 cursor-pointer border border-solid px-1.5 transition-all duration-200 hover:-translate-y-px"
        data-test="trace-score-chips-overflow"
      >
        <span class="text-3xs text-text-body font-semibold">{{
          t("onlineEvals.traceScoreChip.moreCount", { count: overflowCount })
        }}</span>
      </OTag>
    </template>

    <div class="flex max-h-96 w-72 flex-col" data-test="trace-score-chips-overflow-panel">
      <div
        class="border-border-default sticky top-0 z-1 flex items-center gap-1.5 border-b px-3 py-2"
      >
        <OIcon name="task-alt" size="xs" class="text-status-success-text" />
        <span
          class="text-text-heading text-xs font-bold"
          data-test="trace-score-chips-overflow-title"
        >
          {{ t("onlineEvals.traceScoreChip.allScores", { count: chips.length }) }}
        </span>
      </div>
      <div class="flex flex-col gap-1.5 overflow-y-auto p-1.5">
        <div
          v-for="chip in chips"
          :key="chip.key"
          class="bg-surface-panel border-border-default rounded-default border p-1.75"
        >
          <TraceScoreDetail :chip="chip" />
        </div>
      </div>
    </div>
  </ODropdown>

  <slot v-if="!loading && chips.length === 0" name="empty" />
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped } from "@/types/i18n";
import TraceScoreDetail from "./TraceScoreDetail.vue";
import { useTraceScoreChips } from "./composables/useTraceScoreChips";
import type { TraceScoreScope } from "./utils/traceScoreSql";

/** Chips shown directly on the header before folding the rest behind
 *  "+N more" — enough to be useful at a glance without crowding the row
 *  every other badge (Service/Duration/...) shares. */
const MAX_VISIBLE_CHIPS = 2;

const { t } = useI18nTyped();

const props = defineProps<{
  scope: TraceScoreScope;
  targetId: string;
  /** Trace/span start time in microseconds — the lower bound of the search
   *  window. Scores are written by an eval job well after the trace lands,
   *  so the upper bound is always "now", not the trace's own end time. */
  startTimeUs: number;
}>();

const { chips, loading, load } = useTraceScoreChips();

const visibleChips = computed(() => chips.value.slice(0, MAX_VISIBLE_CHIPS));
const overflowCount = computed(() => Math.max(0, chips.value.length - MAX_VISIBLE_CHIPS));

watch(
  () => [props.scope, props.targetId, props.startTimeUs] as const,
  ([scope, targetId, startTimeUs]) => {
    void load(scope, targetId, startTimeUs);
  },
  { immediate: true },
);

/** Re-runs the same query — for a caller that just recorded a new score
 *  (e.g. a manual annotation) and wants the chip row to reflect it without
 *  waiting for props to change. */
function refresh() {
  void load(props.scope, props.targetId, props.startTimeUs);
}

defineExpose({ refresh });
</script>
