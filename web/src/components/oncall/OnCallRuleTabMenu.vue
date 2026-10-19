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

<!-- A rule tab's rare actions: rename, stop on a date (or undo it), remove. -->
<template>
  <span class="flex items-center">
    <ODropdown side="bottom" align="start" @close-auto-focus="onMenuClosed">
      <template #trigger>
        <OButton
          icon-left="more-vert"
          variant="ghost"
          size="icon-xs-sq"
          :aria-label="t('oncall.ruleMenu', { name: raw(ruleLabel) })"
          :data-test="`oncall-schedule-rule-menu-${ruleIndex}`"
          @click.stop
        />
      </template>
      <ODropdownItem :data-test="`oncall-schedule-rule-rename-${ruleIndex}`" @select="openRename">
        {{ t("oncall.ruleRename") }}
      </ODropdownItem>
      <ODropdownItem
        v-if="rule.ends_at === undefined"
        :data-test="`oncall-schedule-rule-stop-${ruleIndex}`"
        @select="openStop"
      >
        {{ t("oncall.ruleStop") }}
      </ODropdownItem>
      <ODropdownItem
        v-else
        :data-test="`oncall-schedule-rule-unstop-${ruleIndex}`"
        @select="emit('unstop')"
      >
        {{ t("oncall.ruleDontStop") }}
      </ODropdownItem>
      <template v-if="canRemove">
        <ODropdownSeparator />
        <ODropdownItem
          variant="destructive"
          :data-test="`oncall-schedule-rule-remove-${ruleIndex}`"
          @select="emit('remove')"
        >
          {{ t("oncall.removeShiftRule") }}
        </ODropdownItem>
      </template>
    </ODropdown>

    <!-- The menu closes as it selects, so each popover hangs off its own invisible anchor here. -->
    <OPopover v-model:open="renameOpen" :aria-label="t('oncall.ruleRename')">
      <template #trigger>
        <span class="block size-0" aria-hidden="true" />
      </template>
      <div
        class="flex w-72 flex-col gap-4 p-4"
        :data-test="`oncall-schedule-rule-rename-popover-${ruleIndex}`"
      >
        <OInput
          v-model="rule.name"
          :label="t('oncall.shiftRuleName')"
          :data-test="`oncall-schedule-rule-name-${ruleIndex}`"
          @keydown.enter="renameOpen = false"
        />
        <div class="flex justify-end">
          <OButton variant="primary" size="sm-action" @click="renameOpen = false">
            {{ t("oncall.peopleDone") }}
          </OButton>
        </div>
      </div>
    </OPopover>

    <OPopover v-model:open="stopOpen" :aria-label="t('oncall.stopTitle', { name: raw(ruleLabel) })">
      <template #trigger>
        <span class="block size-0" aria-hidden="true" />
      </template>
      <div
        class="flex w-120 flex-col gap-4 p-4"
        :data-test="`oncall-schedule-rule-stop-popover-${ruleIndex}`"
      >
        <div class="flex flex-col gap-1">
          <h3 class="text-base font-semibold">
            {{ t("oncall.stopTitle", { name: raw(ruleLabel) }) }}
          </h3>
          <OText variant="meta">{{ t("oncall.stopAfter") }}</OText>
        </div>

        <ORadioGroup v-model="choice" :label="t('oncall.stopAfter')">
          <ORadio
            v-for="(option, index) in choices"
            :key="option.at"
            :value="`end-${index}`"
            variant="card"
            :data-test="`oncall-schedule-rule-stop-choice-${ruleIndex}-${index}`"
          >
            <template #label>
              <span class="flex w-full flex-wrap justify-between gap-2">
                <span>{{ t("oncall.stopChoice", { name: raw(nameOf(option.email)) }) }}</span>
                <span class="text-text-secondary">{{ raw(stamp(option.at)) }}</span>
              </span>
            </template>
          </ORadio>
          <ORadio
            value="pick"
            variant="card"
            :data-test="`oncall-schedule-rule-stop-pick-${ruleIndex}`"
          >
            <template #label>
              <span class="flex w-full flex-wrap justify-between gap-2">
                <span>{{ t("oncall.stopPickDate") }}</span>
                <span class="text-text-secondary">{{ raw(timezone) }}</span>
              </span>
            </template>
          </ORadio>
        </ORadioGroup>

        <div v-if="choice === 'pick'" class="flex gap-2">
          <ODate
            v-model="pickedDate"
            class="min-w-0 flex-1"
            :label="t('oncall.stopDate')"
            :data-test="`oncall-schedule-rule-stop-date-${ruleIndex}`"
          />
          <OTime
            v-model="pickedTime"
            class="min-w-0 flex-1"
            format24
            :label="t('oncall.stopTime')"
            :data-test="`oncall-schedule-rule-stop-time-${ruleIndex}`"
          />
        </div>
        <p
          v-if="pickedInPast"
          class="text-status-warning-text text-xs"
          :data-test="`oncall-schedule-rule-stop-past-${ruleIndex}`"
        >
          {{ t("oncall.stopInPast") }}
        </p>

        <p
          class="text-xs"
          :class="consequence.gap ? 'text-status-warning-text' : 'text-text-secondary'"
          :data-test="`oncall-schedule-rule-stop-consequence-${ruleIndex}`"
        >
          {{ consequence.text }}
        </p>

        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="stopOpen = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :disabled="stopAt === null"
            :data-test="`oncall-schedule-rule-stop-confirm-${ruleIndex}`"
            @click="confirmStop"
          >
            {{
              stopAt === null
                ? t("oncall.stopConfirm")
                : t("oncall.stopConfirmAt", { date: raw(stamp(stopAt)) })
            }}
          </OButton>
        </div>
      </div>
    </OPopover>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODate from "@/lib/forms/Date/ODate.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { ShiftRule } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone, fromZonedInputValue } from "@/utils/oncall";

const props = defineProps<{
  rule: ShiftRule;
  ruleIndex: number;
  /** The name the tab shows, "Rule N" when the rule has none. */
  ruleLabel: string;
  canRemove: boolean;
  /** Opens straight into renaming, for a rule that was just added. */
  renaming: boolean;
  /** The next ends of this rule's turns in the preview, read from the server's segments. */
  choices: Array<{ email: string; at: number }>;
  consequence: { text: I18nText; gap: boolean };
  timezone: string;
  nowMicros: number;
  nameOf: (email: string) => string;
}>();

const emit = defineEmits<{
  remove: [];
  stop: [at: number];
  unstop: [];
  renamed: [];
}>();

const { t } = useI18nTyped();

const rule = computed(() => props.rule);

const renameOpen = ref(false);
const stopOpen = ref(false);

// The item chosen in the menu; its popover takes the focus the menu would hand back to its trigger.
const chosen = ref<"rename" | "stop" | null>(null);

function onMenuClosed(event: Event) {
  if (!chosen.value) return;
  event.preventDefault();
  if (chosen.value === "rename") renameOpen.value = true;
  if (chosen.value === "stop") stopOpen.value = true;
  chosen.value = null;
}

function openRename() {
  chosen.value = "rename";
}

watch(
  () => props.renaming,
  (on) => {
    if (on) renameOpen.value = true;
  },
  { immediate: true },
);
watch(renameOpen, (open) => {
  if (!open && props.renaming) emit("renamed");
});

// Nothing is chosen until the reader chooses: a stop is not something to fall into by default.
const choice = ref<string | undefined>(undefined);
const pickedDate = ref("");
const pickedTime = ref("");

function openStop() {
  choice.value = undefined;
  pickedDate.value = "";
  pickedTime.value = "";
  chosen.value = "stop";
}

// A stop already in the past would retire the rule the moment it is saved.
const pickedInPast = computed(() => {
  if (choice.value !== "pick" || !pickedDate.value || !pickedTime.value) return false;
  const at = fromZonedInputValue(`${pickedDate.value}T${pickedTime.value}`, props.timezone);
  return at !== null && at <= props.nowMicros;
});

const stopAt = computed<number | null>(() => {
  if (choice.value === "pick") {
    if (!pickedDate.value || !pickedTime.value || pickedInPast.value) return null;
    return fromZonedInputValue(`${pickedDate.value}T${pickedTime.value}`, props.timezone);
  }
  const index = choice.value?.startsWith("end-") ? Number(choice.value.slice(4)) : -1;
  return props.choices[index]?.at ?? null;
});

const stamp = (micros: number) =>
  formatInZone(micros, props.timezone, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

function confirmStop() {
  if (stopAt.value === null) return;
  emit("stop", stopAt.value);
  stopOpen.value = false;
}
</script>
