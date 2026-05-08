<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OTextarea from "./OTextarea.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormTextareaProps } from "./OFormTextarea.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormTextareaProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormTextarea] must be rendered inside <OForm>. No form context found.");
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
                const r = v(ctx.value as string | undefined);
                if (r !== undefined) return r;
              }
              return undefined;
            },
          }
        : undefined
    "
  >
    <template #default="{ field }">
      <OTextarea
        v-bind="$attrs"
        :label="props.label"
        :placeholder="props.placeholder"
        :disabled="props.disabled"
        :readonly="props.readonly"
        :help-text="props.helpText"
        :rows="props.rows"
        :autogrow="props.autogrow"
        :maxlength="props.maxlength"
        :autocomplete="props.autocomplete"
        :name="props.name"
        :id="props.id"
        :size="props.size"
        :width="props.width"
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
      />
    </template>
  </component>
</template>
