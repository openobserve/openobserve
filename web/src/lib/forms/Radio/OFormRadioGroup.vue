<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import ORadioGroup from "./ORadioGroup.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { useVisibleFieldError } from "../Form/fieldError";
import type { FormRadioGroupProps } from "./OFormRadioGroup.types";
import type { RadioValue } from "./ORadio.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormRadioGroupProps>();

const form = inject(FORM_CONTEXT_KEY, null);
const shown = useVisibleFieldError(form);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormRadioGroup] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
        <ORadioGroup
          v-bind="$attrs"
          :label="props.label"
          :name="props.name"
          :disabled="props.disabled"
          :required="props.required"
          :orientation="props.orientation"
          :model-value="field.state.value"
          @update:model-value="
            (v: RadioValue) => {
              field.handleChange(v);
              field.handleBlur();
            }
          "
        >
          <slot />
        </ORadioGroup>
        <div v-if="shown(field).message !== undefined" class="text-input-error-text text-xs">
          {{ shown(field).message }}
        </div>
      </div>
    </template>
  </component>
</template>
