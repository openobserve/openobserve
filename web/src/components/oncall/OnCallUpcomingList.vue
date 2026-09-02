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
  The answer one shift rule produces. A cadence and an anchor are not readable
  as a rota until you see the dates they generate. Split out of
  OnCallScheduleEditor so a rotation with several rules can show every rule's
  upcoming shifts together (comparable at a glance) even when the rest of each
  rule's configuration is tabbed and only one is visible at a time.
-->
<template>
  <div>
    <div
      v-if="rule.members.length"
      class="border-border-default divide-border-default rounded-default flex flex-col divide-y border"
    >
      <div
        v-for="shift in preview"
        :key="shift.startMicros"
        class="flex flex-wrap items-center gap-2 px-3 py-1.5"
        :class="isCurrent(shift) ? 'bg-status-success-bg' : ''"
        data-test="oncall-schedule-preview-shift"
      >
        <OUserCell :value="shift.member" />
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
import type { Shift } from "@/utils/oncall";
import { upcomingShifts } from "@/utils/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const PREVIEW_SHIFTS = 5;

const props = defineProps<{
  rule: ShiftRule;
  /** "Now", shared with the caller so every rule's list agrees on when "now" is. */
  nowMicros: number;
}>();

const { t } = useI18nTyped();

const preview = computed<Shift[]>(() => upcomingShifts(props.rule, props.nowMicros, PREVIEW_SHIFTS));

function isCurrent(shift: Shift): boolean {
  return shift.startMicros <= props.nowMicros && props.nowMicros < shift.endMicros;
}

function shiftRange(shift: Shift): string {
  const start = new Date(shift.startMicros / 1000);
  const end = new Date(shift.endMicros / 1000);
  return `${start.toLocaleString()} — ${end.toLocaleString()}`;
}
</script>
