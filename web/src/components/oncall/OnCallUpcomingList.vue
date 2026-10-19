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

<!-- Who actually holds the rotation, stretch by stretch: the same winner the engine picks. -->
<template>
  <div>
    <div
      v-if="stretches.length"
      class="border-border-default divide-border-default rounded-default flex flex-col divide-y border"
    >
      <div
        v-for="stretch in stretches"
        :key="stretch.startMicros"
        class="flex flex-wrap items-center gap-3 px-3 py-1.5"
        :class="isCurrent(stretch) ? 'bg-status-success-bg' : ''"
        data-test="oncall-schedule-preview-shift"
      >
        <OText
          v-if="rules.length > 1 && stretch.ruleIndex !== null"
          variant="label"
          class="shrink-0"
        >
          {{ raw(rules[stretch.ruleIndex].name) }}
        </OText>
        <OUserCell v-if="stretch.member" :value="stretch.member" />
        <OText v-else variant="meta" data-test="oncall-schedule-preview-nobody">
          {{ t("oncall.upcomingNobody") }}
        </OText>
        <OText variant="meta" class="ms-auto">{{ stretchRange(stretch) }}</OText>
        <OTag v-if="isCurrent(stretch)" variant="success-soft" size="xs">
          {{ t("oncall.onCallNowTag") }}
        </OTag>
      </div>
    </div>

    <!-- An empty preview is the most common state of a NEW rule, and saying
         why beats showing nothing. -->
    <OText v-else variant="meta" data-test="oncall-schedule-preview-empty">
      {{ t("oncall.rotationPreviewEmpty") }}
    </OText>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import type { ShiftRule } from "@/ts/interfaces/oncall";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import type { Stretch } from "@/utils/oncall";
import { formatInZone, isShiftRuleValid, resolvedStretches } from "@/utils/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const PREVIEW_SHIFTS = 5;
const PREVIEW_ROWS = 10;
// Bounds the scan: window edges are found a quarter hour at a time.
const MAX_HORIZON_MICROS = 4 * MICROS_PER_WEEK;

const props = defineProps<{
  rules: ShiftRule[];
  /** "Now", shared with the caller so every rule's list agrees on when "now" is. */
  nowMicros: number;
  /** The team's zone: windows are read in it and times are shown in it. */
  timezone: string;
}>();

const { t } = useI18nTyped();

const stretches = computed<Stretch[]>(() => {
  if (!props.rules.some(isShiftRuleValid)) return [];
  const longest = Math.max(...props.rules.map((rule) => rule.shift_micros || 0));
  const lookback = Math.min(longest, MICROS_PER_WEEK);
  const horizon = Math.min(PREVIEW_SHIFTS * longest, MAX_HORIZON_MICROS);
  return resolvedStretches(
    props.rules,
    props.nowMicros - lookback,
    props.nowMicros + horizon,
    props.timezone,
  )
    .filter((stretch) => stretch.endMicros > props.nowMicros)
    .slice(0, PREVIEW_ROWS);
});

function isCurrent(stretch: Stretch): boolean {
  return stretch.startMicros <= props.nowMicros && props.nowMicros < stretch.endMicros;
}

function stretchRange(stretch: Stretch): I18nText {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  const start = raw(formatInZone(stretch.startMicros, props.timezone, opts));
  const end = raw(formatInZone(stretch.endMicros, props.timezone, opts));
  if (stretch.openStart && stretch.openEnd) return t("oncall.upcomingNoChange");
  if (stretch.openStart) return t("oncall.upcomingUntil", { end });
  if (stretch.openEnd) return t("oncall.upcomingFrom", { start });
  return raw(`${start} — ${end}`);
}
</script>
