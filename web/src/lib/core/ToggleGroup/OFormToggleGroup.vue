<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Form-aware wrapper around OToggleGroup — the OForm* variant for a single/multi
// toggle bar. Binds the active value to a TanStack field by `name` (like the
// other OForm* wrappers): model-value ← field.state.value, change → handleChange
// (+ handleBlur, since a toggle is a discrete control). Errors show whenever
// `errors.length > 0` (empty until the first submit, per the submit-then-change
// timing). The OToggleGroupItem children are passed through the default slot.

import { inject } from "vue";
import OToggleGroup from "./OToggleGroup.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import type { FormToggleGroupProps } from "./OFormToggleGroup.types";
import type { AcceptableValue } from "reka-ui";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormToggleGroupProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormToggleGroup] must be rendered inside <OForm>. No form context found.",
  );
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
        <OToggleGroup
          v-bind="$attrs"
          :type="props.type"
          :disabled="props.disabled"
          :orientation="props.orientation"
          :variant="props.variant"
          :label="props.label"
          :label-position="props.labelPosition"
          :model-value="field.state.value"
          @update:model-value="
            (v: boolean | AcceptableValue | AcceptableValue[]) => {
              field.handleChange(v);
              field.handleBlur();
            }
          "
        >
          <template v-if="$slots.label" #label>
            <slot name="label" />
          </template>
          <slot />
        </OToggleGroup>
        <div
          v-if="field.state.meta.errors.length > 0"
          class="text-xs text-input-error-text"
        >
          {{ firstFieldError(field.state.meta.errors) }}
        </div>
      </div>
    </template>
  </component>
</template>
