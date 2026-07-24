<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject, ref } from "vue";
import OCombobox from "./OCombobox.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormComboboxProps } from "./OFormCombobox.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormComboboxProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormCombobox] must be rendered inside <OForm>. No form context found.");
}

// Forward OCombobox's imperative `clear()` (resets reka-ui's internal
// search-term text + the model in the same tick) so form-based chip-builders —
// which add the typed value as a chip and immediately reset the input — can
// clear it deterministically (e.g. CrossLinkDialog). Pure passthrough; no
// behavior change for single-value consumers that never call it.
const comboboxRef = ref<{ clear: () => Promise<void> } | null>(null);
defineExpose({ clear: () => comboboxRef.value?.clear() });
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <OCombobox
        ref="comboboxRef"
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
          field.state.meta.errors.length > 0 ? firstFieldError(field.state.meta.errors) : undefined
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
