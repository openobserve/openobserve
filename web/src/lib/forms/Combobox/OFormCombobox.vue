<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OCombobox from "./OCombobox.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormComboboxProps } from "./OFormCombobox.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormComboboxProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormCombobox] must be rendered inside <OForm>. No form context found.",
  );
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <OCombobox
        v-bind="$attrs"
        :label="props.label"
        :placeholder="props.placeholder"
        :items="props.items"
        :search-regex="props.searchRegex"
        :value-replace-fn="props.valueReplaceFn"
        :disabled="props.disabled"
        :required="props.required"
        :size="props.size"
        :help-text="props.helpText"
        :debounce="props.debounce"
        :id="props.id"
        :name="props.name"
        :label-position="props.labelPosition"
        :model-value="field.state.value"
        :error="field.state.meta.errors.length > 0"
        :error-message="
          field.state.meta.errors.length > 0
            ? firstFieldError(field.state.meta.errors)
            : undefined
        "
        @update:model-value="(val: string) => field.handleChange(val)"
      >
        <template v-if="$slots.label" #label>
          <slot name="label" />
        </template>
        <template v-if="$slots.tooltip" #tooltip>
          <slot name="tooltip" />
        </template>
      </OCombobox>
    </template>
  </component>
</template>
