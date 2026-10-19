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
  One shift rule's configuration — who's on it, how often it hands over, and
  when it applies. Split out of OnCallScheduleEditor so a rotation with several
  rules (follow-the-sun) can put each rule behind its own tab without retyping
  this block per tab. The rule's name and its remove control stay with the
  caller: a lone rule has neither (it needs no name to be told apart from
  nothing), and a tabbed rule renames/closes through the tab itself.
-->
<template>
  <div class="flex flex-col gap-4">
    <!-- The picker draws from the team roster, so on an empty team it has
         nothing to offer. Saying so beats a select that opens on nothing. -->
    <div
      v-if="!hasTeamMembers"
      class="border-border-default rounded-default flex flex-wrap items-center gap-3 border p-3"
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

    <OSelect
      :model-value="rule.members"
      multiple
      searchable
      :label="t('oncall.rotationOrder')"
      :help-text="t('oncall.rotationOrderHint')"
      :placeholder="t('oncall.rotationPickPlaceholder')"
      :options="memberOptions"
      :disabled="!hasTeamMembers"
      :data-test="`oncall-schedule-members-${ruleIndex}`"
      @update:model-value="(v: unknown) => setMembers(rule, v as string[])"
    />

    <p
      v-if="showNeedsPeople"
      class="text-status-warning-text text-xs"
      :data-test="`oncall-rotation-needs-people-${ruleIndex}`"
    >
      {{ t("oncall.rotationNeedsPeople") }}
    </p>

    <VueDraggableNext
      v-if="rule.members.length > 1"
      :model-value="rule.members"
      handle=".drag-handle"
      class="flex flex-col gap-1"
      :data-test="`oncall-schedule-member-order-${ruleIndex}`"
      @update:model-value="(v: string[]) => setMembers(rule, v)"
    >
      <div
        v-for="(member, position) in rule.members"
        :key="member"
        class="border-border-default rounded-default flex items-center gap-2 border px-2 py-1"
        :data-test="`oncall-schedule-member-order-${ruleIndex}-${position}`"
      >
        <OIcon
          name="drag-indicator"
          size="sm"
          class="drag-handle text-text-secondary cursor-move"
          :label="t('oncall.memberOrderDrag')"
        />
        <span class="text-text-secondary min-w-4 text-xs">{{ raw(`${position + 1}.`) }}</span>
        <OUserCell :value="member" />
      </div>
    </VueDraggableNext>

    <!-- Catching this while somebody is still looking at the rotation is the
         entire value; catching it at 3am is not. -->
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

    <!-- Cadence and anchor are one decision — "every week, starting then" —
         so they sit on one row rather than reading as two unrelated
         questions. -->
    <!-- Two columns only from lg: below it the drawer is too narrow for three fields to share half of it. -->
    <div class="flex flex-col gap-1.5">
      <div class="grid gap-3 max-lg:grid-cols-1 lg:grid-cols-2">
        <OSelect
          v-model="rule.shift_micros"
          :label="t('oncall.shiftLength')"
          :options="shiftOptions"
        />

        <!-- Timezone rides along disabled: there is one zone per schedule, set on the team. -->
        <div class="flex gap-2 max-md:flex-wrap">
          <ODate
            class="min-w-0 flex-1"
            :model-value="handoverDate"
            :label="t('oncall.firstShiftStarts')"
            :data-test="`oncall-schedule-handover-${ruleIndex}-date`"
            @update:model-value="setHandoverDate"
          />
          <OTime
            class="min-w-0 flex-1"
            :model-value="handoverTime"
            format24
            :label="raw('\u00A0')"
            :data-test="`oncall-schedule-handover-${ruleIndex}-time`"
            @update:model-value="setHandoverTime"
          />
          <OSelect
            class="min-w-0 flex-1 max-md:basis-full"
            :model-value="timezone"
            disabled
            :label="t('oncall.timezone')"
            :options="[{ label: raw(timezone), value: timezone }]"
            :data-test="`oncall-schedule-handover-${ruleIndex}-timezone`"
          />
        </div>
      </div>
      <OText
        v-if="firstShiftSentence"
        variant="meta"
        :data-test="`oncall-schedule-first-shift-${ruleIndex}`"
      >
        {{ firstShiftSentence }}
      </OText>
    </div>

    <div class="flex flex-col gap-2">
      <OToggleGroup
        :model-value="rule.restrictions?.length ? 'only' : 'all'"
        :label="t('oncall.rotationSectionApplies')"
        label-position="top"
        :data-test="`oncall-schedule-hours-${ruleIndex}`"
        @update:model-value="(v: unknown) => setHoursMode(rule, v === 'only')"
      >
        <OToggleGroupItem
          value="all"
          size="sm"
          :data-test="`oncall-schedule-hours-${ruleIndex}-all`"
        >
          {{ t("oncall.ruleHoursAll") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="only"
          size="sm"
          :data-test="`oncall-schedule-hours-${ruleIndex}-only`"
        >
          {{ t("oncall.ruleHoursOnlyDuring") }}
        </OToggleGroupItem>
      </OToggleGroup>

      <template v-if="rule.restrictions?.length">
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

          <!-- start === end is zero length regardless of which minute it
               is — the engine never matches it, and the layer beneath
               silently wins instead. Flagged here because 0/0 looks like a
               reasonable "all day" guess when 1440 is the value that
               actually means that. -->
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

    <div
      v-if="overlapCount"
      class="flex flex-wrap items-center gap-2"
      :data-test="`oncall-schedule-overlap-${ruleIndex}`"
    >
      <OText variant="label">
        {{ t("oncall.ruleOverlapQuestion", { names: raw(overlapNames) }) }}
      </OText>
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

    <!-- Outside the fold on purpose: this one BLOCKS the save, and a reason
         for a dead Save button hidden behind a disclosure is how somebody
         concludes the form is broken. -->
    <p
      v-if="priorityClashFor(rule)"
      class="text-status-warning-text text-xs"
      :data-test="`oncall-schedule-priority-clash-${ruleIndex}`"
    >
      {{ priorityClashFor(rule) }}
    </p>

    <!-- Retiring a rule, rather than deleting it. Delete was the only way
         to stop one and it threw away the record of who had been
         covering those hours. -->
    <OCollapsible
      :label="t('oncall.rotationRetireSection')"
      :default-open="isRetired(rule)"
      class="border-border-default rounded-default border"
      :data-test="`oncall-schedule-retire-section-${ruleIndex}`"
    >
      <div class="flex flex-col gap-1.5 px-2 pt-2 pb-1">
        <OCheckbox
          :model-value="isRetired(rule)"
          :label="t('oncall.rotationRetire')"
          :data-test="`oncall-schedule-retire-${ruleIndex}`"
          @update:model-value="(on: CheckboxModelValue) => setRetired(rule, !!on)"
        />
        <div
          v-if="isRetired(rule)"
          class="flex flex-col gap-1 pt-1"
          :data-test="`oncall-schedule-retire-at-${ruleIndex}`"
        >
          <span class="o-input-label text-sm leading-tight font-semibold">
            {{ t("oncall.rotationRetiredOn") }}
          </span>
          <div class="flex gap-2">
            <ODate
              class="min-w-0 flex-1"
              :model-value="retiredAtDate"
              :help-text="t('oncall.rotationRetiredOnHint', { zone: raw(timezone) })"
              :data-test="`oncall-schedule-retire-at-${ruleIndex}-date`"
              @update:model-value="setRetiredAtDate"
            />
            <OTime
              class="min-w-0 flex-1"
              :model-value="retiredAtTime"
              format24
              :data-test="`oncall-schedule-retire-at-${ruleIndex}-time`"
              @update:model-value="setRetiredAtTime"
            />
          </div>
        </div>
      </div>
    </OCollapsible>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import ODate from "@/lib/forms/Date/ODate.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import type { SelectOptionInput } from "@/lib/forms/Select/OSelect.types";
import OText from "@/lib/core/Typography/OText.vue";
import type { ShiftRule, Unavailability } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  rule: ShiftRule;
  /** Which tab this rule occupies — every data-test here is keyed by it so tests can address one rule among several. */
  ruleIndex: number;
  hasTeamMembers: boolean;
  memberOptions: readonly SelectOptionInput[];
  shiftOptions: readonly SelectOptionInput[];
  dayOptions: readonly SelectOptionInput[];
  /** From stops at 23:30: the server refuses a window that starts at 24:00. */
  fromMinuteOptions: readonly SelectOptionInput[];
  minuteOptions: readonly SelectOptionInput[];
  timezone: string;
  firstShiftSentence: I18nText | "";
  showNeedsPeople: boolean;
  /** Display names of the rules this one overlaps, joined; empty when it overlaps none. */
  overlapNames: string;
  overlapCount: number;
  /** Unset when this rule wins against some overlaps and loses to others. */
  overlapChoice: "wins" | "loses" | undefined;
  setMembers: (rule: ShiftRule, members: string[]) => void;
  awayClashesFor: (rule: ShiftRule) => Unavailability[];
  shortDate: (micros: number) => string;
  handoverInput: (rule: ShiftRule) => string;
  setAnchor: (rule: ShiftRule, value: string) => void;
  setHoursMode: (rule: ShiftRule, onlyDuring: boolean) => void;
  addRestriction: (rule: ShiftRule) => void;
  removeRestriction: (rule: ShiftRule, index: number) => void;
  setOverlapWinner: (wins: boolean) => void;
  isRetired: (rule: ShiftRule) => boolean;
  setRetired: (rule: ShiftRule, on: boolean) => void;
  retiredAtLocal: (rule: ShiftRule) => string;
  setRetiredAt: (rule: ShiftRule, value: string | number) => void;
  priorityClashFor: (rule: ShiftRule) => I18nText | "";
}>();

defineEmits<{ "open-members": [] }>();

const { t } = useI18nTyped();

// The parent owns this rule (same object reference it holds in its shift_rules
// array) and writes to it in place, same as every other field on this form —
// aliasing through a computed satisfies vue/no-mutating-props without adding
// v-model/emit boilerplate for a value that was never meant to round-trip.
const rule = computed(() => props.rule);

// `handoverInput`/`retiredAtLocal` hand back one `YYYY-MM-DDTHH:mm` string (the
// team-zone instant, already resolved by the parent). ODate and OTime want it
// split; recombining on either half's change is what keeps the other half's
// value in place.
const handoverDate = computed(() => props.handoverInput(props.rule).slice(0, 10));
const handoverTime = computed(() => props.handoverInput(props.rule).slice(11));
const retiredAtDate = computed(() => props.retiredAtLocal(props.rule).slice(0, 10));
const retiredAtTime = computed(() => props.retiredAtLocal(props.rule).slice(11));

function setHandoverDate(date: string) {
  props.setAnchor(props.rule, `${date}T${handoverTime.value}`);
}
function setHandoverTime(time: string) {
  props.setAnchor(props.rule, `${handoverDate.value}T${time}`);
}
function setRetiredAtDate(date: string) {
  props.setRetiredAt(props.rule, `${date}T${retiredAtTime.value}`);
}
function setRetiredAtTime(time: string) {
  props.setRetiredAt(props.rule, `${retiredAtDate.value}T${time}`);
}
</script>
