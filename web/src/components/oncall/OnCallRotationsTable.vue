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
  What each rotation is, in one row: its cadence, the order it cycles, who holds
  it now, and whether the share of time is even.

  The fairness verdict is the SERVER's — an uneven split may be deliberate, and
  nothing on this side can tell the difference between a weighted rotation and
  an unfair one.
-->
<template>
  <div class="flex flex-col gap-2" data-test="oncall-rotations-table">
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="panel-title">{{ t("oncall.rotationsTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.rotationsHint") }}</OText>
      <OButton
        variant="outline"
        size="xs"
        class="ms-auto"
        data-test="oncall-rotations-add"
        @click="emit('add')"
      >
        {{ t("oncall.addRotation") }}
      </OButton>
    </span>

    <OTable
      :frame="false"
      :data="rows"
      :columns="columns"
      row-key="name"
      pagination="none"
      :show-global-filter="false"
      table-id="oncall-rotations"
      data-test="oncall-rotations-list"
    >
      <template #cell-name="{ row }">
        <span class="flex min-w-0 flex-col">
          <span class="text-text-heading truncate text-sm font-medium">{{ raw(row.name) }}</span>
          <!-- What the rotation is restricted to, not which rung it feeds: a
               rung targets `on_call_now`, never a rotation by name, so any
               "feeds rung 1" label here would be invented. -->
          <span class="text-text-secondary truncate text-xs">{{ row.restriction }}</span>
        </span>
      </template>

      <template #cell-handover="{ row }">
        <span class="text-text-body text-sm">{{ row.handover }}</span>
      </template>

      <template #cell-people="{ row }">
        <span class="text-text-body truncate text-sm">{{ row.people }}</span>
      </template>

      <template #cell-onNow="{ row }">
        <span class="text-text-body truncate text-sm">{{ row.onNow }}</span>
      </template>

      <template #cell-fairness="{ row }">
        <OTag v-if="row.fairness" :variant="row.fairnessTone" size="sm">
          {{ raw(row.fairness) }}
        </OTag>
        <span v-else class="text-text-muted text-sm">{{ ABSENT }}</span>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="edit"
          :data-test="`oncall-rotation-edit-${row.name}`"
          @click.stop="emit('edit', row.name)"
        >
          <OTooltip side="bottom" :content="t('oncall.edit')" />
        </OButton>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { Rotation, TeamLoad } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import {
  describeRestrictions,
  formatInZone,
  memberAt,
  nextHandover,
  resolveNextHolder,
} from "@/utils/oncall";

const props = withDefaults(
  defineProps<{ rotations?: Rotation[]; timezone?: string; load?: TeamLoad | null }>(),
  { rotations: () => [], timezone: "UTC", load: null },
);

const emit = defineEmits<{ (e: "edit", rotation: string): void; (e: "add"): void }>();

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

const ABSENT = raw("—");

interface RotationRow {
  name: string;
  restriction: I18nText;
  handover: I18nText;
  people: I18nText;
  onNow: I18nText;
  fairness: string;
  fairnessTone: BadgeVariant;
}

/// "Weekly", "Daily", or the raw span when it is neither — a rotation may use
/// any shift length, and rounding an 8-hour cycle to "Daily" would be wrong.
function cadence(shiftMicros: number): I18nText {
  if (shiftMicros === MICROS_PER_WEEK) return t("oncall.shiftWeekly");
  if (shiftMicros === MICROS_PER_DAY) return t("oncall.shiftDaily");
  return raw(formatMicrosDuration(shiftMicros));
}

const rows = computed<RotationRow[]>(() =>
  props.rotations.map((rotation) => {
    const holder = memberAt(rotation, nowMicros.value);
    const next = resolveNextHolder([rotation], nowMicros.value, props.timezone);
    const handsOverAt = nextHandover(rotation, nowMicros.value);
    const fairness = props.load?.rotations.find((entry) => entry.rotation === rotation.name);

    let onNow: I18nText;
    if (!holder) onNow = t("oncall.rotationNobody");
    else if (next && handsOverAt) {
      onNow = t("oncall.rotationHandsTo", {
        current: raw(holder),
        next: raw(next),
        duration: formatMicrosDuration(Math.max(0, handsOverAt - nowMicros.value)),
      });
    } else onNow = t("oncall.rotationNobodyNext", { current: raw(holder) });

    return {
      name: rotation.name,
      restriction: describeRestrictions(rotation.restrictions, t),
      handover: raw(
        `${cadence(rotation.shift_micros)} · ${formatInZone(rotation.anchor_micros, props.timezone, {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        })}`,
      ),
      people: t(
        "oncall.rotationCycle",
        {
          count: rotation.members.length,
          weeks: t("oncall.rotationCycleLength", { count: rotation.members.length }),
        },
        rotation.members.length,
      ),
      onNow,
      fairness: fairness?.summary ?? "",
      // Only an uneven verdict is coloured. A row of green "Even" badges is a
      // rail people stop reading, and the one that matters is the other one.
      fairnessTone: (fairness?.verdict === "even" ? "default-soft" : "amber-soft") as BadgeVariant,
    };
  }),
);

const columns = computed<OTableColumnDef<RotationRow>[]>(() => [
  { id: "name", header: t("oncall.rotationName"), accessorKey: "name", meta: { isName: true } },
  { id: "handover", header: t("oncall.rotationHandover"), size: 200, accessorKey: "handover" },
  { id: "people", header: t("oncall.rotationPeople"), size: 180, accessorKey: "people" },
  { id: "onNow", header: t("oncall.rotationOnNow"), size: 240, accessorKey: "onNow" },
  { id: "fairness", header: t("oncall.rotationFairness"), size: 140, accessorKey: "fairness" },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 80,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
  },
]);
</script>
