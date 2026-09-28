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
  <div
    v-for="(range, i) in visibleRanges"
    :key="`${range.state}-${range.start}-${i}`"
    class="absolute top-0 h-full"
    :class="stateClass[range.state]"
    :data-test="`replay-load-band-${range.state}`"
    :title="stateTitle(range.state)"
    :style="{
      left: `${toPercent(range.start, timelineMs)}%`,
      width: `${Math.max(toPercent(range.end, timelineMs) - toPercent(range.start, timelineMs), 0)}%`,
    }"
  />
</template>

<script setup lang="ts">
import { computed, type PropType } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { toPercent, type LoadedRange, type RangeState } from "@/utils/rum/sessionReplayTimeline";

const props = defineProps({
  ranges: { type: Array as PropType<LoadedRange[]>, default: () => [] },
  timelineMs: { type: Number, required: true },
});

const { t } = useI18nTyped();

const stateClass: Record<RangeState, string> = {
  inPlayer: "bg-surface-subtle-hover",
  fetched: "bg-surface-subtle-hover/50",
  skipped: "bg-badge-error-solid-bg/60",
  unavailable:
    "bg-[repeating-linear-gradient(45deg,var(--color-surface-subtle-hover)_0_0.1875rem,transparent_0.1875rem_0.4375rem)]",
};

const visibleRanges = computed(() =>
  props.timelineMs > 0 ? props.ranges.filter((r) => r.end >= r.start) : [],
);

function stateTitle(state: RangeState): string | undefined {
  if (state === "skipped") return t("rum.sessionReplayGapTooltip");
  if (state === "unavailable") return t("rum.sessionReplayTruncatedTooltip");
  return undefined;
}
</script>
