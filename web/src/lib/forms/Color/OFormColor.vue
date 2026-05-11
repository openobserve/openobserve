<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OColor from "./OColor.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormColorProps } from "./OFormColor.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormColorProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormColor] must be rendered inside <OForm>. No form context found.",
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
      <OColor
        v-bind="$attrs"
        :label="props.label"
        :placeholder="props.placeholder"
        :help-text="props.helpText"
        :readonly="props.readonly"
        :clearable="props.clearable"
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
      </OColor>
    </template>
  </component>
</template>
