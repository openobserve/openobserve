<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OOptionGroup from "./OOptionGroup.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormOptionGroupProps } from "./OFormOptionGroup.types";
import type { OptionGroupValue } from "./OOptionGroup.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormOptionGroupProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormOptionGroup] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
        <OOptionGroup
          v-bind="$attrs"
          :options="props.options"
          :type="props.type"
          :orientation="props.orientation"
          :label="props.label"
          :help-text="props.helpText"
          :disabled="props.disabled"
          :required="props.required"
          :size="props.size"
          :name="props.name"
          :model-value="field.state.value"
          :error="field.state.meta.errors.length > 0"
          @update:model-value="
            (v: OptionGroupValue) => {
              field.handleChange(v);
              field.handleBlur();
            }
          "
        >
          <template v-if="$slots.label" #label>
            <slot name="label" />
          </template>
        </OOptionGroup>
        <div v-if="field.state.meta.errors.length > 0" class="text-option-group-error-text text-xs">
          {{ firstFieldError(field.state.meta.errors) }}
        </div>
      </div>
    </template>
  </component>
</template>
