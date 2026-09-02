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
  The answer a rotation's shift rules produce, merged into one chronological
  timeline. A cadence and an anchor are not readable as a rota until you see
  the dates they generate. Split out of OnCallScheduleEditor so a rotation
  with several rules can show every rule's upcoming shifts together
  (comparable at a glance) even when the rest of each rule's configuration is
  tabbed and only one is visible at a time.

  Rules sharing an anchor and cadence (e.g. a primary and secondary covering
  the same weeks) land on identical windows, so those collapse into a single
  row instead of repeating the same date range once per rule.
-->
<template>
  <div>
    <div
      v-if="combined.length"
      class="border-border-default divide-border-default rounded-default flex flex-col divide-y border"
    >
      <div
        v-for="shift in combined"
        :key="`${shift.startMicros}-${shift.endMicros}`"
        class="flex flex-wrap items-center gap-3 px-3 py-1.5"
        :class="isCurrent(shift) ? 'bg-status-success-bg' : ''"
        data-test="oncall-schedule-preview-shift"
      >
        <template v-for="(entry, entryIndex) in shift.entries" :key="entry.ruleName + entry.member">
          <span v-if="entryIndex" class="text-text-secondary text-xs">{{ raw("·") }}</span>
          <OText v-if="rules.length > 1" variant="label" class="shrink-0">{{ raw(entry.ruleName) }}</OText>
          <OUserCell :value="entry.member" />
        </template>
        <OText variant="meta" class="ms-auto">{{ raw(shiftRange(shift)) }}</OText>
        <OTag v-if="isCurrent(shift)" variant="success-soft" size="xs">
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
import type { CombinedShift } from "@/utils/oncall";
import { combinedUpcomingShifts } from "@/utils/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const PREVIEW_SHIFTS = 5;

const props = defineProps<{
  rules: ShiftRule[];
  /** "Now", shared with the caller so every rule's list agrees on when "now" is. */
  nowMicros: number;
}>();

const { t } = useI18nTyped();

const combined = computed<CombinedShift[]>(() =>
  combinedUpcomingShifts(props.rules, props.nowMicros, PREVIEW_SHIFTS),
);

function isCurrent(shift: CombinedShift): boolean {
  return shift.startMicros <= props.nowMicros && props.nowMicros < shift.endMicros;
}

function shiftRange(shift: CombinedShift): string {
  const start = new Date(shift.startMicros / 1000);
  const end = new Date(shift.endMicros / 1000);
  return `${start.toLocaleString()} — ${end.toLocaleString()}`;
}
</script>
