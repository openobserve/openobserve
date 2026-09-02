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
      <OButton variant="outline" size="sm-action" @click="$emit('open-members')">
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
      @update:model-value="(v: unknown) => setMembers(rule, v as string[])"
    />

    <!-- The server refuses a rule with nobody in it, so this one would store
         nothing. Said next to the pick that fixes it. -->
    <p v-if="!rule.members.length" class="text-status-warning-text text-xs">
      {{ t("oncall.rotationNeedsPeople") }}
    </p>

    <!-- Catching this while somebody is still looking at the rotation is the
         entire value; catching it at 3am is not. -->
    <p v-for="clash in awayClashesFor(rule)" :key="clash.id" class="text-status-warning-text text-xs">
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
    <div class="grid gap-3 sm:grid-cols-2">
      <OSelect v-model="rule.shift_micros" :label="t('oncall.shiftLength')" :options="shiftOptions" />

      <!-- Without this the anchor was silently "now", so a rotation created
           at 14:32 handed over at 14:32 forever. -->
      <OInput
        :model-value="handoverInput(rule)"
        type="datetime-local"
        :label="t('oncall.firstHandover')"
        :help-text="handoverHint"
        @update:model-value="(v: string | number) => setAnchor(rule, String(v))"
      />
    </div>

    <!-- Restricting the hours, ranking two rules and retiring one are what a
         follow-the-sun setup needs and what an ordinary rotation never
         touches, so they are folded away — and unfolded already when this
         rule is one of the ones using them. -->
    <OCollapsible
      icon="tune"
      :label="t('oncall.rotationSectionApplies')"
      :caption="t('oncall.rotationSectionAppliesCaption')"
      :default-open="usesAdvanced(rule)"
      class="border-border-default rounded-default border"
    >
      <div class="flex flex-col gap-4 px-2 pt-2 pb-1">
        <!-- Hours: the windows and the button that adds one are one idea, so
             they sit together under one hint. -->
        <div class="flex flex-col gap-2">
          <OText variant="meta">{{ t("oncall.rotationRestrictionHint") }}</OText>

          <div
            v-for="(window, index) in rule.restrictions ?? []"
            :key="index"
            class="border-border-default rounded-default grid items-end gap-3 border p-3 sm:grid-cols-[1fr_auto_auto_auto]"
          >
            <OSelect
              :model-value="window.days"
              multiple
              :label="t('oncall.rotationRestrictionDays')"
              :options="dayOptions"
              @update:model-value="(v: unknown) => (window.days = (v as number[]) ?? [])"
            />
            <OSelect
              :model-value="window.start_minute"
              :label="t('oncall.rotationRestrictionFrom')"
              :options="minuteOptions"
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
              @click="removeRestriction(rule, index)"
            />

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
            <OButton variant="outline" size="sm-action" icon-left="add" @click="addRestriction(rule)">
              {{ t("oncall.rotationRestrictionAdd") }}
            </OButton>
          </div>
        </div>

        <!-- Two rules of the SAME rotation that both apply and share a
             priority are "equally in force", and the server refuses the
             WHOLE save. A lone rule has nothing to compete with, so it is not
             asked the question at all. -->
        <template v-if="multiRule">
          <OSeparator />
          <OSelect
            :model-value="rule.priority ?? 0"
            :label="t('oncall.rotationPriority')"
            :help-text="t('oncall.rotationPriorityHint')"
            :options="priorityOptions"
            width="sm"
            @update:model-value="(v: unknown) => (rule.priority = Number(v))"
          />
        </template>

        <OSeparator />

        <!-- Retiring a rule, rather than deleting it. Delete was the only way
             to stop one and it threw away the record of who had been
             covering those hours. -->
        <div class="flex flex-col gap-1.5">
          <OCheckbox
            :model-value="isRetired(rule)"
            :label="t('oncall.rotationRetire')"
            @update:model-value="(on: CheckboxModelValue) => setRetired(rule, !!on)"
          />
          <OText variant="meta">{{ t("oncall.rotationRetireHint") }}</OText>
          <OInput
            v-if="isRetired(rule)"
            type="datetime-local"
            width="md"
            class="pt-1"
            :model-value="retiredAtLocal(rule)"
            :label="t('oncall.rotationRetiredOn')"
            :help-text="t('oncall.rotationRetiredOnHint', { zone: raw(timezone) })"
            @update:model-value="(v: string | number) => setRetiredAt(rule, v)"
          />
        </div>
      </div>
    </OCollapsible>

    <!-- Outside the fold on purpose: this one BLOCKS the save, and a reason
         for a dead Save button hidden behind a disclosure is how somebody
         concludes the form is broken. -->
    <p v-if="priorityClashFor(rule)" class="text-status-warning-text text-xs">
      {{ priorityClashFor(rule) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOptionInput } from "@/lib/forms/Select/OSelect.types";
import OText from "@/lib/core/Typography/OText.vue";
import type { ShiftRule, Unavailability } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  rule: ShiftRule;
  hasTeamMembers: boolean;
  /** Whether this rotation has more than one rule — priority only matters once there's a rival. */
  multiRule: boolean;
  memberOptions: readonly SelectOptionInput[];
  shiftOptions: readonly SelectOptionInput[];
  dayOptions: readonly SelectOptionInput[];
  minuteOptions: readonly SelectOptionInput[];
  priorityOptions: readonly SelectOptionInput[];
  timezone: string;
  handoverHint: I18nText;
  setMembers: (rule: ShiftRule, members: string[]) => void;
  awayClashesFor: (rule: ShiftRule) => Unavailability[];
  shortDate: (micros: number) => string;
  handoverInput: (rule: ShiftRule) => string;
  setAnchor: (rule: ShiftRule, value: string) => void;
  usesAdvanced: (rule: ShiftRule) => boolean;
  addRestriction: (rule: ShiftRule) => void;
  removeRestriction: (rule: ShiftRule, index: number) => void;
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
</script>
