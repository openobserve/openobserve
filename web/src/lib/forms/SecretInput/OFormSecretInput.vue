<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";

import { raw } from "@/types/i18n";

import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import OSecretInput from "./OSecretInput.vue";
import type { FormSecretInputEmits, FormSecretInputProps } from "./OFormSecretInput.types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<FormSecretInputProps>(), {
  required: false,
  disabled: false,
});
const emit = defineEmits<FormSecretInputEmits>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormSecretInput] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component :is="form.Field" v-if="form" :name="props.name">
    <template #default="{ field }">
      <OSecretInput
        v-bind="$attrs"
        :model-value="field.state.value ?? null"
        :state="props.state"
        :label="props.label"
        :unchanged-label="props.unchangedLabel"
        :replace-label="props.replaceLabel"
        :keep-label="props.keepLabel"
        :will-replace-label="props.willReplaceLabel"
        :show-label="props.showLabel"
        :hide-label="props.hideLabel"
        :required="props.required"
        :disabled="props.disabled"
        :data-test="props.dataTest"
        :error="field.state.meta.errors.length > 0"
        :error-message="
          field.state.meta.errors.length > 0
            ? raw(firstFieldError(field.state.meta.errors))
            : undefined
        "
        @update:model-value="(value: string | null) => field.handleChange(value)"
        @update:state="(value) => emit('update:state', value)"
        @blur="field.handleBlur"
      />
    </template>
  </component>
</template>
