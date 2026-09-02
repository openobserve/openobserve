<!--
  PROTOTYPE — throwaway. Answers: "what should the shift-rule editor look
  like with tabs instead of stacked cards?" See OnCallScheduleEditor.vue's
  `?variant=` switch and PrototypeVariantSwitcher.vue. Delete this whole
  `oncall/prototype/` folder (and the switch in OnCallScheduleEditor.vue) once
  a layout is chosen — fold the winner in properly, don't ship this file.

  One rule's fields, lifted verbatim out of the "stacked cards" markup so the
  tab-based variants aren't retyping member-picker/cadence/when-it-applies by
  hand. Deliberately does NOT include a rule-name field or a delete button —
  in the tab variants those live on the tab itself (double-click to rename,
  × to close) instead of being duplicated inside the panel too.
-->
<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="!hasTeamMembers"
      class="border-border-default rounded-default flex flex-wrap items-center gap-3 border p-3"
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

    <p v-if="!rule.members.length" class="text-status-warning-text text-xs">
      {{ t("oncall.rotationNeedsPeople") }}
    </p>

    <p v-for="clash in awayClashesFor(rule)" :key="clash.id" class="text-status-warning-text text-xs">
      {{
        t("oncall.rotationMemberAway", {
          who: raw(clash.user_email),
          from: raw(shortDate(clash.start_at)),
          to: raw(shortDate(clash.end_at)),
        })
      }}
    </p>

    <div class="grid gap-3 sm:grid-cols-2">
      <OSelect
        v-model="rule.shift_micros"
        :label="t('oncall.shiftLength')"
        :options="shiftOptions"
      />
      <OInput
        :model-value="handoverInput(rule)"
        type="datetime-local"
        :label="t('oncall.firstHandover')"
        :help-text="handoverHint"
        @update:model-value="(v: string | number) => setAnchor(rule, String(v))"
      />
    </div>

    <OCollapsible
      icon="tune"
      :label="t('oncall.rotationSectionApplies')"
      :caption="t('oncall.rotationSectionAppliesCaption')"
      :default-open="usesAdvanced(rule)"
      class="border-border-default rounded-default border"
    >
      <div class="flex flex-col gap-4 px-2 pt-2 pb-1">
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
              @click="addRestriction(rule)"
            >
              {{ t("oncall.rotationRestrictionAdd") }}
            </OButton>
          </div>
        </div>

        <OSeparator />
        <OSelect
          :model-value="rule.priority ?? 0"
          :label="t('oncall.rotationPriority')"
          :help-text="t('oncall.rotationPriorityHint')"
          :options="priorityOptions"
          width="sm"
          @update:model-value="(v: unknown) => (rule.priority = Number(v))"
        />

        <OSeparator />

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

    <p v-if="priorityClashFor(rule)" class="text-status-warning-text text-xs">
      {{ priorityClashFor(rule) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { ShiftRule, Unavailability } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

// PROTOTYPE: option/helper types loosened to `any` — this file is throwaway,
// not worth re-deriving OSelect's exact SelectOption/I18nText generics here.
defineProps<{
  rule: ShiftRule;
  hasTeamMembers: boolean;
  memberOptions: any[];
  shiftOptions: any[];
  dayOptions: any[];
  minuteOptions: any[];
  priorityOptions: any[];
  timezone: string;
  handoverHint: string;
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
</script>
