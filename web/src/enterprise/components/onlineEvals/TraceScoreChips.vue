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

<!-- A failed search degrades to the empty state, and only the first few scores render; the rest fold behind "+N more". -->
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

/** Chips shown before folding the rest behind "+N more", so the row shared with other badges stays readable. */
const MAX_VISIBLE_CHIPS = 2;

const { t } = useI18nTyped();

const props = defineProps<{
  scope: TraceScoreScope;
  targetId: string;
  /** Lower bound of the search window; the upper bound is "now", since scores land well after the trace. */
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

/** Lets a caller that just recorded a score refresh the chips without waiting for props to change. */
function refresh() {
  void load(props.scope, props.targetId, props.startTimeUs);
}

defineExpose({ refresh });
</script>
