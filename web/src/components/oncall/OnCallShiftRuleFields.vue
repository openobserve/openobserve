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

<!-- One shift rule as labelled rows; its name, stop date and removal live in its tab menu. -->
<template>
  <div class="grid grid-cols-[auto_1fr] items-start gap-x-6 gap-y-5">
    <!-- An empty team has nobody to pick, so the reader is sent to the roster instead. -->
    <div
      v-if="!hasTeamMembers"
      class="border-border-default rounded-default col-span-2 flex flex-wrap items-center gap-3 border p-3"
      data-test="oncall-rotation-no-members"
    >
      <span class="text-text-secondary min-w-0 flex-1 text-xs">
        {{ t("oncall.scheduleNeedsMembers") }}
      </span>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="oncall-rotation-open-members"
        @click="$emit('open-members')"
      >
        {{ t("oncall.rotationOpenMembers") }}
      </OButton>
    </div>

    <OText variant="body-strong" class="pt-1">{{ t("oncall.rulePeople") }}</OText>
    <div class="flex min-w-0 flex-col gap-2">
      <OnCallRulePeople
        :rule="rule"
        :rule-index="ruleIndex"
        :holder="holder"
        :name-of="nameOf"
        :team-members="teamMembers"
        :set-members="setMembers"
      />
      <p
        v-if="showNeedsPeople"
        class="text-status-warning-text text-xs"
        :data-test="`oncall-rotation-needs-people-${ruleIndex}`"
      >
        {{ t("oncall.rotationNeedsPeople") }}
      </p>
      <!-- Said while the rotation is on screen, not discovered at 3am. -->
      <p
        v-for="clash in awayClashesFor(rule)"
        :key="clash.id"
        class="text-status-warning-text text-xs"
      >
        {{
          t("oncall.rotationMemberAway", {
            who: raw(clash.user_email),
            from: raw(shortDate(clash.start_at)),
            to: raw(shortDate(clash.end_at)),
          })
        }}
      </p>
    </div>

    <OText variant="body-strong" class="pt-1.5">{{ t("oncall.ruleHandover") }}</OText>
    <div
      class="flex flex-wrap items-center gap-2"
      :data-test="`oncall-schedule-handover-${ruleIndex}`"
    >
      <OText variant="body" as="span">{{ t("oncall.handoverEvery") }}</OText>
      <OSelect
        v-model="rule.shift_micros"
        width="sm"
        :aria-label="t('oncall.shiftLength')"
        :options="shiftOptions"
        :data-test="`oncall-schedule-handover-${ruleIndex}-length`"
      />
      <template v-if="weekly">
        <OText variant="body" as="span">{{ t("oncall.handoverOn") }}</OText>
        <OSelect
          :model-value="handover.weekday"
          width="xs"
          :aria-label="t('oncall.handoverWeekday')"
          :options="dayOptions"
          :data-test="`oncall-schedule-handover-${ruleIndex}-weekday`"
          @update:model-value="(v: unknown) => moveHandover(Number(v), handover.minute)"
        />
      </template>
      <OText variant="body" as="span">{{ t("oncall.handoverAt") }}</OText>
      <OSelect
        :model-value="handover.minute"
        width="xs"
        :aria-label="t('oncall.handoverTime')"
        :options="timeOptions"
        :data-test="`oncall-schedule-handover-${ruleIndex}-time`"
        @update:model-value="(v: unknown) => moveHandover(handover.weekday, Number(v))"
      />
    </div>

    <OText variant="body-strong" class="pt-1.5">{{ t("oncall.ruleCovers") }}</OText>
    <div class="flex min-w-0 flex-col gap-2">
      <OSelect
        :model-value="covers"
        width="md"
        :aria-label="t('oncall.ruleCovers')"
        :options="coversOptions"
        :data-test="`oncall-schedule-covers-${ruleIndex}`"
        @update:model-value="(v: unknown) => setCovers(v as CoversPreset)"
      />

      <template v-if="covers === 'custom'">
        <div
          v-for="(window, index) in rule.restrictions"
          :key="index"
          class="border-border-default rounded-default grid items-end gap-3 border p-3 sm:grid-cols-[1fr_auto_auto_auto]"
          :data-test="`oncall-schedule-restriction-${ruleIndex}-${index}`"
        >
          <OSelect
            :model-value="window.days"
            multiple
            :label="t('oncall.rotationRestrictionDays')"
            :placeholder="t('oncall.ruleHoursEveryDay')"
            :options="dayOptions"
            @update:model-value="(v: unknown) => (window.days = (v as number[]) ?? [])"
          />
          <OSelect
            :model-value="window.start_minute"
            :label="t('oncall.rotationRestrictionFrom')"
            :options="fromMinuteOptions"
            width="xs"
            @update:model-value="(v: unknown) => (window.start_minute = Number(v))"
          />
          <OSelect
            :model-value="window.end_minute"
            :label="t('oncall.rotationRestrictionTo')"
            :options="minuteOptions"
            width="xs"
            @update:model-value="(v: unknown) => (window.end_minute = Number(v))"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="delete-outline"
            :aria-label="t('oncall.rotationRestrictionRemove')"
            :data-test="`oncall-schedule-restriction-remove-${ruleIndex}-${index}`"
            @click="removeRestriction(rule, index)"
          />

          <!-- The engine reads an earlier To as the next morning, not as an empty window. -->
          <p
            v-if="window.end_minute < window.start_minute"
            class="text-text-secondary text-xs sm:col-span-4"
            :data-test="`oncall-schedule-restriction-next-day-${ruleIndex}-${index}`"
          >
            {{ t("oncall.restrictionEndsNextDay") }}
          </p>

          <!-- start === end never matches, and 0/0 is the likely wrong guess for "all day". -->
          <p
            v-if="window.start_minute === window.end_minute"
            class="text-status-warning-text text-xs sm:col-span-4"
          >
            {{ t("oncall.rotationRestrictionZeroLength") }}
          </p>
        </div>

        <div class="flex">
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="add"
            :data-test="`oncall-schedule-restriction-add-${ruleIndex}`"
            @click="addRestriction(rule)"
          >
            {{ t("oncall.rotationRestrictionAdd") }}
          </OButton>
        </div>
      </template>
    </div>

    <template v-if="overlapCount">
      <OText variant="body-strong" class="pt-1.5">
        {{ t("oncall.ruleOverlapQuestion", { names: raw(overlapNames) }) }}
      </OText>
      <div class="flex" :data-test="`oncall-schedule-overlap-${ruleIndex}`">
        <OToggleGroup
          :model-value="overlapChoice"
          @update:model-value="(v: unknown) => setOverlapWinner(v === 'wins')"
        >
          <OToggleGroupItem
            value="wins"
            size="sm"
            :data-test="`oncall-schedule-overlap-${ruleIndex}-wins`"
          >
            {{ t("oncall.ruleOverlapThisWins") }}
          </OToggleGroupItem>
          <OToggleGroupItem
            value="loses"
            size="sm"
            :data-test="`oncall-schedule-overlap-${ruleIndex}-loses`"
          >
            {{ t("oncall.ruleOverlapOthersWin", { names: raw(overlapNames) }, overlapCount) }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
    </template>

    <!-- Never folded away: it is the reason Save is disabled. -->
    <p
      v-if="priorityClashFor(rule)"
      class="text-status-warning-text col-span-2 text-xs"
      :data-test="`oncall-schedule-priority-clash-${ruleIndex}`"
    >
      {{ priorityClashFor(rule) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOptionInput } from "@/lib/forms/Select/OSelect.types";
import OText from "@/lib/core/Typography/OText.vue";
import type { ShiftRule, Unavailability } from "@/ts/interfaces/oncall";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import type { CoversPreset } from "@/utils/oncall";
import {
  anchorAtWeekdayTime,
  anchorWeekdayTime,
  COVERS_PRESETS,
  coversPresetOf,
  formatMinuteOfDay,
} from "@/utils/oncall";
import OnCallRulePeople from "./OnCallRulePeople.vue";

const props = defineProps<{
  rule: ShiftRule;
  /** Which tab this rule occupies — every data-test here is keyed by it so tests can address one rule among several. */
  ruleIndex: number;
  hasTeamMembers: boolean;
  teamMembers: string[];
  /** Who holds this rule's turn now, or next, read from the server's preview. */
  holder: { email: string; now: boolean } | null;
  nameOf: (email: string) => string;
  shiftOptions: readonly SelectOptionInput[];
  dayOptions: readonly SelectOptionInput[];
  /** From stops at 23:30: the server refuses a window that starts at 24:00. */
  fromMinuteOptions: readonly SelectOptionInput[];
  minuteOptions: readonly SelectOptionInput[];
  timezone: string;
  showNeedsPeople: boolean;
  /** Display names of the rules this one overlaps, joined; empty when it overlaps none. */
  overlapNames: string;
  overlapCount: number;
  /** Unset when this rule wins against some overlaps and loses to others. */
  overlapChoice: "wins" | "loses" | undefined;
  setMembers: (rule: ShiftRule, members: string[]) => void;
  awayClashesFor: (rule: ShiftRule) => Unavailability[];
  shortDate: (micros: number) => string;
  addRestriction: (rule: ShiftRule) => void;
  removeRestriction: (rule: ShiftRule, index: number) => void;
  setOverlapWinner: (wins: boolean) => void;
  priorityClashFor: (rule: ShiftRule) => I18nText | "";
}>();

defineEmits<{ "open-members": [] }>();

const { t } = useI18nTyped();

// The parent owns this rule object and edits it in place; the alias satisfies vue/no-mutating-props.
const rule = computed(() => props.rule);

// A weekday only means something when a turn lasts a week or more.
const weekly = computed(() => props.rule.shift_micros >= MICROS_PER_WEEK);

const handover = computed(() => anchorWeekdayTime(props.rule.anchor_micros, props.timezone));

// Half hours, plus the stored minute when it is off that grid, so the field never shows blank.
const timeOptions = computed(() => {
  const minutes = Array.from({ length: 48 }, (_, i) => i * 30);
  if (!minutes.includes(handover.value.minute)) minutes.push(handover.value.minute);
  return minutes
    .sort((a, b) => a - b)
    .map((minute) => ({ label: raw(formatMinuteOfDay(minute)), value: minute }));
});

function moveHandover(weekday: number, minute: number) {
  const at = anchorAtWeekdayTime(
    props.rule.anchor_micros,
    props.timezone,
    weekly.value ? weekday : null,
    minute,
  );
  if (at !== null) rule.value.anchor_micros = at;
}

const coversOptions = computed(() => [
  { label: t("oncall.coversAll"), value: "all" },
  { label: t("oncall.coversBusinessHours"), value: "businessHours" },
  { label: t("oncall.coversWeekdays"), value: "weekdays" },
  { label: t("oncall.coversWeekends"), value: "weekends" },
  { label: t("oncall.coversCustom"), value: "custom" },
]);

// Custom stays open once chosen, even while its windows happen to equal a quick pick.
const customOpen = ref(coversPresetOf(props.rule.restrictions) === "custom");
const covers = computed<CoversPreset>(() =>
  customOpen.value ? "custom" : coversPresetOf(props.rule.restrictions),
);

function setCovers(pick: CoversPreset) {
  customOpen.value = pick === "custom";
  if (pick === "custom") {
    if (!props.rule.restrictions?.length) props.addRestriction(props.rule);
    return;
  }
  rule.value.restrictions = COVERS_PRESETS[pick].map((w) => ({ ...w, days: [...w.days] }));
}
</script>
