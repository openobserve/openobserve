<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, inject } from "vue";
import OCheckbox from "./OCheckbox.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormCheckboxProps } from "./OFormCheckbox.types";
import type { CheckboxModelValue } from "./OCheckbox.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormCheckboxProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormCheckbox] must be rendered inside <OForm>. No form context found.");
}

// Forward only props the consumer actually set. Spreading `props` directly
// would pass Vue-coerced defaults (e.g. `false` for optional Boolean-typed
// props), tripping the child's type validators.
const passthroughProps = computed(() => {
  const out: Record<string, unknown> = {};
  if (props.label !== undefined) out.label = props.label;
  if (props.disabled !== undefined) out.disabled = props.disabled;
  if (props.required !== undefined) out.required = props.required;
  if (props.size !== undefined) out.size = props.size;
  if (props.value !== undefined) out.value = props.value;
  if (props.val !== undefined) out.val = props.val;
  if (props.trueValue !== undefined) out.trueValue = props.trueValue;
  if (props.falseValue !== undefined) out.falseValue = props.falseValue;
  if (props.indeterminateValue !== undefined) {
    out.indeterminateValue = props.indeterminateValue;
  }
  if (props.id !== undefined) out.id = props.id;
  if (props.name !== undefined) out.name = props.name;
  return out;
});
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
        <OCheckbox
          v-bind="{ ...$attrs, ...passthroughProps }"
          :model-value="field.state.value"
          @update:model-value="
            (v: CheckboxModelValue) => {
              field.handleChange(v);
              field.handleBlur();
            }
          "
        >
          <template v-if="$slots.label" #label>
            <slot name="label" />
          </template>
        </OCheckbox>
        <div v-if="field.state.meta.errors.length > 0" class="text-input-error-text text-xs">
          {{ firstFieldError(field.state.meta.errors) }}
        </div>
      </div>
    </template>
  </component>
</template>
