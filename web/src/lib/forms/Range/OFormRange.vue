<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import ORange from "./ORange.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormRangeProps } from "./OFormRange.types";
import type { RangeValue } from "./ORange.types";

defineOptions({ inheritAttrs: false });

// FormRangeProps extends RangeProps, so EVERY ORange prop is declared here and is
// therefore absent from $attrs — `v-bind="$attrs"` cannot carry it through. Each
// one must be forwarded explicitly below or it is silently dropped and ORange
// falls back to its own default (this is how `vertical`/`markers` once collapsed
// a vertical slider into a bare 16px horizontal one). Add a binding below when
// adding a prop to RangeProps.
const props = defineProps<FormRangeProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormRange] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
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
          :required="props.required"
          :size="props.size"
          :id="props.id"
          :name="props.name"
          :vertical="props.vertical"
          :reverse="props.reverse"
          :label-always="props.labelAlways"
          :markers="props.markers"
          :marker-labels="props.markerLabels"
          :model-value="field.state.value"
          :error="field.state.meta.errors.length > 0"
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
        <div v-if="field.state.meta.errors.length > 0" class="text-xs text-slider-error-text">
          {{ firstFieldError(field.state.meta.errors) }}
        </div>
      </div>
    </template>
  </component>
</template>
