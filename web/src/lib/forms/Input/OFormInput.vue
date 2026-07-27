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
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <OInput
        v-bind="$attrs"
        :label="props.label"
        :label-position="props.labelPosition"
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
        :error="field.state.meta.errors.length > 0"
        :error-message="
          !$slots.error && field.state.meta.errors.length > 0
            ? firstFieldError(field.state.meta.errors)
            : undefined
        "
        @update:model-value="(val: unknown) => field.handleChange(val)"
        @blur="field.handleBlur"
      >
        <!-- Forward OInput's presentational slots (e.g. a password visibility
             toggle in #icon-right) so form fields keep full OInput affordances. -->
        <template v-if="$slots['icon-left']" #icon-left>
          <slot name="icon-left" />
        </template>
        <template v-if="$slots['icon-right']" #icon-right>
          <slot name="icon-right" />
        </template>
        <template v-if="$slots.prefix" #prefix>
          <slot name="prefix" />
        </template>
        <template v-if="$slots.suffix" #suffix>
          <slot name="suffix" />
        </template>
        <template v-if="$slots.tooltip" #tooltip>
          <slot name="tooltip" />
        </template>
        <template v-if="$slots.append" #append>
          <slot name="append" />
        </template>
      </OInput>
      <!-- #error slot: when provided the consumer OWNS the message — only the
           inline TEXT is suppressed above (error-message is left undefined). The
           invalid STATE still reaches OInput, so the field keeps its red border:
           a narrow field that re-homes its message must still look invalid.
           Rendered after OInput so it can escape a composite border; may be left
           empty purely to suppress the text. -->
      <template v-if="$slots.error">
        <slot name="error" />
      </template>
    </template>
  </component>
</template>
