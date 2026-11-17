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

<script setup lang="ts">
import { computed } from "vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import { scheduleOverlap, type ScheduleOverlapKind } from "@/utils/alerts/scheduleOverlap";

const props = defineProps<{
  /** Minutes between checks. */
  frequency: number;
  /** Minutes of data each check reads. */
  period: number;
}>();

const WIDTH = 600;
const HEIGHT = 32;
const MID = HEIGHT / 2;
const TICKS = 5;
const STEP = WIDTH / TICKS;
const NOW_X = WIDTH - STEP / 2;
const CAPTION: Record<ScheduleOverlapKind, I18nKey> = {
  overlap: "alerts.form.schedule.overlap",
  equal: "alerts.form.schedule.equal",
  gaps: "alerts.form.schedule.gaps",
};

const { t } = useI18nTyped();

const ticks = computed(() =>
  Array.from({ length: TICKS }, (_, index) => {
    const stepsAgo = TICKS - 1 - index;
    return {
      x: NOW_X - stepsAgo * STEP,
      label:
        stepsAgo === 0
          ? t("alerts.sections.timeline.now")
          : t("alerts.sections.timeline.minutesAgo", { count: stepsAgo * props.frequency }),
    };
  }),
);

const bandStart = computed(() =>
  Math.max(0, NOW_X - (props.period / Math.max(props.frequency, 1)) * STEP),
);
const overlap = computed(() => scheduleOverlap(props.period, props.frequency));
</script>

<template>
  <OSettingRow
    :label="t('alerts.sections.timeline.label')"
    fill
    data-test="add-alert-check-timeline"
  >
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="w-full" aria-hidden="true">
      <line x1="0" :y1="MID" :x2="WIDTH" :y2="MID" class="stroke-border-strong" />
      <rect
        :x="bandStart"
        :y="MID - 8"
        :width="NOW_X - bandStart"
        height="16"
        rx="4"
        class="fill-accent/25"
        data-test="add-alert-check-timeline-band"
      />
      <circle
        v-for="tick in ticks"
        :key="tick.x"
        :cx="tick.x"
        :cy="MID"
        r="5"
        class="fill-accent"
      />
    </svg>
    <div class="text-text-secondary grid grid-cols-5 text-center text-xs">
      <span v-for="tick in ticks" :key="tick.x">{{ tick.label }}</span>
    </div>
    <p class="text-text-body m-0 mt-2 text-sm" data-test="add-alert-check-timeline-caption">
      {{ t(CAPTION[overlap.kind], { period, minutes: overlap.minutes }) }}
    </p>
  </OSettingRow>
</template>
