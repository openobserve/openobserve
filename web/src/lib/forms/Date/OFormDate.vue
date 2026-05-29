<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import ODate from "./ODate.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormDateProps } from "./OFormDate.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormDateProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormDate] must be rendered inside <OForm>. No form context found.",
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
                const r = v(ctx.value as string);
                if (r !== undefined) return r;
              }
              return undefined;
            },
          }
        : undefined
    "
  >
    <template #default="{ field }">
      <ODate
        v-bind="$attrs"
        :label="props.label"
        :placeholder="props.placeholder"
        :min="props.min"
        :max="props.max"
        :help-text="props.helpText"
        :clearable="props.clearable"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :size="props.size"
        :id="props.id"
        :name="props.name"
        :model-value="field.state.value"
        :error="
          field.state.meta.isTouched && field.state.meta.errors.length > 0
        "
        :error-message="
          field.state.meta.isTouched && field.state.meta.errors.length > 0
            ? String(field.state.meta.errors[0])
            : undefined
        "
        @update:model-value="field.handleChange"
        @blur="field.handleBlur"
      >
        <template v-if="$slots.label" #label>
          <slot name="label" />
        </template>
      </ODate>
    </template>
  </component>
</template>
