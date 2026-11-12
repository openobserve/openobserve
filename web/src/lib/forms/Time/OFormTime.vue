<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject, ref } from "vue";
import OTime from "./OTime.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FormTimeProps } from "./OFormTime.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormTimeProps>();

const form = inject(FORM_CONTEXT_KEY, null);
const { t } = useI18nTyped();

if (import.meta.env.DEV && !form) {
  console.warn("[OFormTime] must be rendered inside <OForm>. No form context found.");
}

// While the field shows a refused entry, the form's value is the old time, so the field fails instead.
const typedInvalid = ref(false);
const validators = {
  onChange: () =>
    typedInvalid.value
      ? t("components.time.invalid", { format: raw(props.withSeconds ? "HH:MM:SS" : "HH:MM") })
      : undefined,
};

function onInvalid(field: any, invalid: boolean) {
  typedInvalid.value = invalid;
  if (invalid) field.setMeta((meta: any) => ({ ...meta, isTouched: true }));
  void field.validate("change");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name" :validators="validators">
    <template #default="{ field }">
      <OTime
        v-bind="$attrs"
        :label="props.label"
        :placeholder="props.placeholder"
        :min="props.min"
        :max="props.max"
        :step="props.step"
        :with-seconds="props.withSeconds"
        :format24="props.format24"
        :help-text="props.helpText"
        :clearable="props.clearable"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :required="props.required"
        :size="props.size"
        :id="props.id"
        :name="props.name"
        :model-value="field.state.value"
        :error="field.state.meta.errors.length > 0"
        :error-message="
          field.state.meta.errors.length > 0
            ? raw(firstFieldError(field.state.meta.errors))
            : undefined
        "
        @update:model-value="field.handleChange"
        @blur="field.handleBlur"
        @invalid="onInvalid(field, $event)"
      >
        <template v-if="$slots.label" #label>
          <slot name="label" />
        </template>
      </OTime>
    </template>
  </component>
</template>
