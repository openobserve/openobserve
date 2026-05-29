<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import ORange from "./ORange.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormRangeProps } from "./OFormRange.types";
import type { RangeValue } from "./ORange.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormRangeProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormRange] must be rendered inside <OForm>. No form context found.",
  );
}
</script>

<template>
  <component
    v-if="form"
    :is="form.Field"
    :name="props.name"
    :validators="
      props.validators
        ? {
            onChange: (ctx: { value: unknown }) => {
              for (const v of props.validators ?? []) {
                const r = v(ctx.value as RangeValue);
                if (r !== undefined) return r;
              }
              return undefined;
            },
          }
        : undefined
    "
  >
    <template #default="{ field }">
      <div class="tw:flex tw:flex-col tw:gap-1">
        <ORange
          v-bind="$attrs"
          :label="props.label"
          :min="props.min"
          :max="props.max"
          :step="props.step"
          :show-value="props.showValue"
          :format-value="props.formatValue"
          :help-text="props.helpText"
          :disabled="props.disabled"
          :size="props.size"
          :id="props.id"
          :name="props.name"
          :model-value="field.state.value"
          :error="
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          "
          @update:model-value="
            (v: RangeValue) => {
              field.handleChange(v);
              field.handleBlur();
            }
          "
          @blur="field.handleBlur"
        >
          <template v-if="$slots.label" #label>
            <slot name="label" />
          </template>
        </ORange>
        <div
          v-if="
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          "
          class="tw:text-xs tw:text-slider-error-text"
        >
          {{ field.state.meta.errors[0] }}
        </div>
      </div>
    </template>
  </component>
</template>
