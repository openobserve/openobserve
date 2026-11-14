<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OSlider from "./OSlider.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { useVisibleFieldError } from "../Form/fieldError";
import type { FormSliderProps } from "./OFormSlider.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormSliderProps>();

const form = inject(FORM_CONTEXT_KEY, null);
const shown = useVisibleFieldError(form);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormSlider] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
        <OSlider
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
          :model-value="field.state.value"
          :error="shown(field).invalid"
          @update:model-value="
            (v: number) => {
              field.handleChange(v);
              field.handleBlur();
            }
          "
          @blur="field.handleBlur"
        >
          <template v-if="$slots.label" #label>
            <slot name="label" />
          </template>
        </OSlider>
        <div v-if="shown(field).message !== undefined" class="text-slider-error-text text-xs">
          {{ shown(field).message }}
        </div>
      </div>
    </template>
  </component>
</template>
