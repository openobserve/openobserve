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

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import type { SelectModelValue, SelectOptionInput } from "@/lib/forms/Select/OSelect.types";
import AlertMessageLine from "@/components/alerts/AlertMessageLine.vue";
import type { AlertLineNote } from "@/components/alerts/alertFormContext";

const props = withDefaults(
  defineProps<{
    operatorName: string;
    valueName: string;
    operators: SelectOptionInput[];
    /** Critical and Warning chips; without them the threshold reads alone. */
    levels: boolean;
    warningName: string;
    warningShown: boolean;
    /** The alert's own comparison, which the warning shares. */
    warningOperator: I18nText;
    /** What the #subject slot compares, echoed on the warning line. */
    warningSubject?: I18nText | null;
    unit?: I18nText | null;
    /** Words after the value, such as "rows". */
    tail?: I18nText | null;
    valueMin?: string;
    valuePlaceholder?: I18nText;
    valueDebounce?: number;
    operatorDataTest?: string;
    valueDataTest?: string;
    warningInputDataTest: string;
    error?: string | null;
    errorDataTest: string;
    warningError?: string | null;
    warningErrorDataTest: string;
    /** The look back shares this line's message, since its field sits on the line above. */
    windowError?: string | null;
    note?: AlertLineNote | null;
    help?: I18nText | null;
    messageDataTest: string;
  }>(),
  {
    warningSubject: null,
    unit: null,
    tail: null,
    valueMin: undefined,
    valuePlaceholder: undefined,
    valueDebounce: undefined,
    operatorDataTest: undefined,
    valueDataTest: undefined,
    error: null,
    warningError: null,
    windowError: null,
    note: null,
    help: null,
  },
);

const emit = defineEmits<{
  (e: "operator", value: string): void;
  (e: "value", value: unknown): void;
  (e: "value-blur"): void;
  (e: "add-warning"): void;
  (e: "remove-warning"): void;
}>();

const slots = defineSlots<{ value?(): unknown; subject?(): unknown }>();

const { t } = useI18nTyped();
const warningRef = ref<HTMLElement | null>(null);

// Literal class strings, so the build sees every grid it may need.
const columns = computed(() => {
  if (props.levels)
    return slots.subject
      ? "grid-cols-[max-content_max-content_minmax(0,max-content)_max-content_auto]"
      : "grid-cols-[max-content_max-content_max-content_auto]";
  return slots.subject
    ? "grid-cols-[max-content_minmax(0,max-content)_max-content_auto]"
    : "grid-cols-[max-content_max-content_auto]";
});

const message = computed(() => {
  if (props.error) return { text: props.error, dataTest: props.errorDataTest };
  if (props.warningError) return { text: props.warningError, dataTest: props.warningErrorDataTest };
  if (props.windowError)
    return { text: props.windowError, dataTest: "alert-settings-period-error" };
  return null;
});

// A comparison picker is single-select, so its value is always one operator string.
const onOperator = (value: SelectModelValue) => emit("operator", String(value ?? ""));

const addWarning = async () => {
  emit("add-warning");
  await nextTick();
  warningRef.value?.querySelector("input")?.focus();
};
</script>

<!-- Remove skips Tab like an input's clear button: emptying the field does the same, and Enter on it would drop the warning. -->
<template>
  <div class="flex min-w-0 flex-col gap-1.5" data-test="alert-threshold-levels">
    <div class="grid w-fit max-w-full items-center gap-x-2 gap-y-1.5" :class="columns">
      <OTag
        v-if="levels"
        type="alertLevel"
        value="critical"
        size="sm"
        class="justify-self-start"
        data-test="alert-threshold-level"
      />
      <span class="text-text-secondary text-compact">{{ t("alerts.form.group.when") }}</span>
      <div v-if="slots.subject" class="min-w-0">
        <slot name="subject" />
      </div>
      <OFormSelect
        :aria-label="t('alerts.form.names.comparison')"
        :name="operatorName"
        :options="operators"
        :searchable="false"
        class="w-32!"
        :data-test="operatorDataTest"
        @update:model-value="onOperator"
      />
      <div class="flex min-w-0 items-center gap-2">
        <slot name="value">
          <OFormInput
            :aria-label="t('alerts.alertIfNoOfEvents')"
            :name="valueName"
            type="number"
            fit-content
            :min="valueMin"
            :placeholder="valuePlaceholder ?? t('alerts.placeholders.value')"
            :debounce="valueDebounce"
            :data-test="valueDataTest"
            @update:model-value="emit('value', $event)"
            @blur="emit('value-blur')"
          >
            <template #error />
          </OFormInput>
        </slot>
        <span v-if="unit" class="text-text-secondary text-compact" data-test="alert-threshold-unit">
          {{ unit }}
        </span>
        <span v-if="tail" class="text-text-body text-sm">{{ tail }}</span>
      </div>

      <template v-if="levels && warningShown">
        <OTag
          type="alertLevel"
          value="warning"
          size="sm"
          class="justify-self-start"
          data-test="alert-warning-level"
        />
        <span class="text-text-secondary text-compact">{{ t("alerts.form.group.when") }}</span>
        <span v-if="slots.subject" class="text-text-body min-w-0 ps-3 text-sm">
          {{ warningSubject ?? raw("") }}
        </span>
        <span class="text-text-body ps-3 text-sm" data-test="alert-warning-operator">
          {{ warningOperator }}
        </span>
        <div ref="warningRef" class="flex min-w-0 items-center gap-2" data-test="alert-warning-row">
          <OFormInput
            :aria-label="t('alerts.warningIf')"
            :name="warningName"
            type="number"
            fit-content
            :data-test="warningInputDataTest"
            :placeholder="t('alerts.form.warning.placeholder')"
          >
            <template #error />
          </OFormInput>
          <span
            v-if="unit"
            class="text-text-secondary text-compact"
            data-test="alert-threshold-unit"
          >
            {{ unit }}
          </span>
          <span v-if="tail" class="text-text-body text-sm">{{ tail }}</span>
          <OButton
            variant="ghost"
            size="icon-circle-sm"
            :aria-label="t('alerts.removeWarning')"
            tabindex="-1"
            class="text-icon-color hover:text-status-error-text"
            data-test="alert-remove-warning-button"
            @click="emit('remove-warning')"
          >
            <OIcon name="close" size="sm" />
          </OButton>
        </div>
      </template>
    </div>
    <OButton
      v-if="levels && !warningShown"
      variant="link"
      size="sm"
      icon-left="add"
      class="self-start"
      data-test="alert-add-warning-button"
      @click="addWarning"
    >
      {{ t("alerts.form.warning.add") }}
    </OButton>
    <AlertMessageLine
      :error="message?.text"
      :error-data-test="message?.dataTest"
      :note="note"
      :help="help"
      :data-test="messageDataTest"
    />
  </div>
</template>
