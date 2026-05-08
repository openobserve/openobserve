<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OCheckbox from "./OCheckbox.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormCheckboxProps } from "./OFormCheckbox.types";
import type { CheckboxModelValue } from "./OCheckbox.types";

const props = defineProps<FormCheckboxProps>();

const form = inject(FORM_CONTEXT_KEY);
</script>

<template>
  <component
    :is="form.Field"
    :name="props.name"
    :validators="
      props.validators
        ? {
            onChange: (ctx: { value: unknown }) => {
              for (const v of props.validators ?? []) {
                const r = v(ctx.value as CheckboxModelValue);
                if (r !== undefined) return r;
              }
              return undefined;
            },
          }
        : undefined
    "
  >
    <template #default="{ field }">
      <OCheckbox
        v-bind="$attrs"
        :label="props.label"
        :disabled="props.disabled"
        :value="props.value"
        :val="props.val"
        :true-value="props.trueValue"
        :false-value="props.falseValue"
        :indeterminate-value="props.indeterminateValue"
        :id="props.id"
        :name="props.name"
        :model-value="field.state.value"
        @update:model-value="field.handleChange"
      >
        <template v-if="$slots.label" #label>
          <slot name="label" />
        </template>
      </OCheckbox>
    </template>
  </component>
</template>
