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

<!-- The one control that changes how New opens; browsing panes never does. -->
<template>
  <div
    class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
    data-test="create-starter-start-with"
  >
    <span class="text-text-secondary text-sm">{{ label }}</span>
    <OSelect
      :model-value="modelValue"
      appearance="inline"
      size="sm"
      :aria-label="label"
      data-test="create-starter-start-with-select"
      @update:model-value="pick"
    >
      <template #trigger>
        <s v-if="paused" class="text-text-secondary" data-test="create-starter-start-with-value">{{
          currentLabel
        }}</s>
        <span v-else data-test="create-starter-start-with-value">{{ currentLabel }}</span>
      </template>
      <OSelectItem
        v-for="choice in listed"
        :key="choice.value"
        :value="choice.value"
        :label="choice.label"
        :disabled="choice.state === 'locked'"
        :icon="choice.state === 'locked' ? 'lock' : undefined"
        reserve-icon-space
      />
      <OSelectItem value="last" reserve-icon-space>
        <span class="flex min-w-0 items-baseline gap-2">
          <span>{{ t("createStarter.whateverLast") }}</span>
          <span
            class="text-text-secondary text-xs"
            data-test="create-starter-start-with-last-now"
            >{{ t("createStarter.lastNow", { choice: lastNowLabel }) }}</span
          >
        </span>
      </OSelectItem>
      <template #after-options>
        <p class="text-text-secondary border-border-default m-0 border-t px-3 py-2 text-xs">
          {{ t("createStarter.personalNote") }}
        </p>
      </template>
    </OSelect>
    <span
      v-if="paused"
      class="text-text-secondary text-xs"
      data-test="create-starter-start-with-paused"
      >{{ pausedReason }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { ChoiceAvailability, StartChoice, StartDefault } from "./createStarter.types";

export interface StartWithChoice {
  value: StartChoice;
  label: I18nText;
  /** "on" and openable; "locked" stays listed but cannot be picked; "hidden" leaves the menu. */
  state: ChoiceAvailability;
}

const props = defineProps<{
  modelValue: StartDefault;
  /** "New alert opens with" */
  label: I18nText;
  choices: readonly StartWithChoice[];
  /** What "Whatever I used last" opens right now. */
  lastNow: StartChoice;
  /** What New actually opens right now, named when the stored choice is paused. */
  opensNow: StartChoice;
}>();

const emit = defineEmits<{ "update:modelValue": [StartDefault] }>();

const { t } = useI18nTyped();

const listed = computed(() => props.choices.filter((c) => c.state !== "hidden"));
const labelOf = (v: StartChoice): I18nText =>
  props.choices.find((c) => c.value === v)?.label ?? raw(v);
const stored = computed(() => props.choices.find((c) => c.value === props.modelValue));
const paused = computed(() => !!stored.value && stored.value.state !== "on");
const currentLabel = computed(() =>
  props.modelValue === "last" ? t("createStarter.whateverLast") : labelOf(props.modelValue),
);
const lastNowLabel = computed(() => labelOf(props.lastNow));
const pausedReason = computed(() =>
  props.modelValue === "ai"
    ? t("createStarter.pausedAiOff", { choice: labelOf(props.opensNow) })
    : t("createStarter.pausedUnavailable", {
        stored: currentLabel.value,
        choice: labelOf(props.opensNow),
      }),
);

const pick = (v: SelectModelValue) => {
  if (v === "last" || v === "ai" || v === "library" || v === "form") emit("update:modelValue", v);
};
</script>
