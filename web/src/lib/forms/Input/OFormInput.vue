<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OInput from "./OInput.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormInputProps } from "./OFormInput.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormInputProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormInput] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component
    v-if="form"
    :is="form.Field"
    :name="props.name"
  >
    <template #default="{ field }">
      <OInput
        v-bind="$attrs"
        :label="props.label"
        :placeholder="props.placeholder"
        :type="props.type"
        :disabled="props.disabled"
        :readonly="props.readonly"
        :required="props.required"
        :help-text="props.helpText"
        :clearable="props.clearable"
        :autogrow="props.autogrow"
        :rows="props.rows"
        :maxlength="props.maxlength"
        :debounce="props.debounce"
        :mask="props.mask"
        :autocomplete="props.autocomplete"
        :name="props.name"
        :id="props.id"
        :size="props.size"
        :width="props.width"
        :model-value="field.state.value"
        :error="
          field.state.meta.errors.length > 0
        "
        :error-message="
          field.state.meta.errors.length > 0
            ? firstFieldError(field.state.meta.errors)
            : undefined
        "
        @update:model-value="(val: unknown) => field.handleChange(val)"
        @blur="field.handleBlur"
      />
    </template>
  </component>
</template>
