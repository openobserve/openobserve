<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject, ref } from "vue";
import OSegmentedField from "./OSegmentedField.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import { raw, type I18nText } from "@/types/i18n";
import type { FormSegmentedFieldProps } from "./OFormSegmentedField.types";
import type { SegmentedFieldStatus } from "./OSegmentedField.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormSegmentedFieldProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormSegmentedField] must be rendered inside <OForm>. No form context found.");
}

// The field keeps an out-of-range date as its value, so the wrapper is what marks it unusable.
const outOfRange = ref(false);

const errorText = (errors: readonly unknown[] | undefined): I18nText | undefined => {
  const message = firstFieldError(errors);
  if (message) return raw(message);
  return outOfRange.value ? props.outOfRangeMessage : undefined;
};

const onStatus = (status: SegmentedFieldStatus) => {
  outOfRange.value = status === "out-of-range";
};
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <OSegmentedField
        v-bind="$attrs"
        :pattern="props.pattern"
        :offsets="props.offsets"
        :offset="props.offset"
        :aria-label="props.ariaLabel"
        :described-by="props.describedBy"
        :segment-labels="props.segmentLabels"
        :day-periods="props.dayPeriods"
        :min="props.min"
        :max="props.max"
        :disabled="props.disabled"
        :highlighted="props.highlighted"
        :model-value="field.state.value"
        :error="field.state.meta.errors.length > 0 || outOfRange"
        :error-message="errorText(field.state.meta.errors)"
        @update:model-value="field.handleChange"
        @update:status="onStatus"
        @blur="field.handleBlur"
      />
    </template>
  </component>
</template>
