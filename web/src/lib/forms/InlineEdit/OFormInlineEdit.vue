<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OFormInlineEdit — OInlineEdit bound to a field of the surrounding <OForm> by
// `name=`, exactly like OFormInput. Use it when the header title IS a validated
// form field (a panel title, an alert name) so the schema still owns the rule
// and the error still surfaces, without a second source of truth.

import { inject, ref } from "vue";
import OInlineEdit from "./OInlineEdit.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormInlineEditProps, FormInlineEditEmits } from "./OFormInlineEdit.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormInlineEditProps>();
const emit = defineEmits<FormInlineEditEmits>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormInlineEdit] must be rendered inside <OForm>. No form context found.");
}

// Forward OInlineEdit's imperative focus so a `ref` on the FORM wrapper behaves
// like a `ref` on the control itself (what focus-the-first-error code expects).
const inlineEditRef = ref<InstanceType<typeof OInlineEdit> | null>(null);
defineExpose({ focus: () => inlineEditRef.value?.focus() });
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <OInlineEdit
        ref="inlineEditRef"
        v-bind="$attrs"
        :model-value="String(field.state.value ?? '')"
        :placeholder="props.placeholder"
        :aria-label="props.ariaLabel"
        :edit-hint="props.editHint"
        :size="props.size"
        :maxlength="props.maxlength"
        :disabled="props.disabled"
        :readonly="props.readonly"
        :error="field.state.meta.errors.length > 0"
        :error-message="
          field.state.meta.errors.length > 0 ? firstFieldError(field.state.meta.errors) : undefined
        "
        @update:model-value="
          (val: string) => {
            field.handleChange(val);
            emit('update:modelValue', val);
          }
        "
        @commit="
          (val: string) => {
            field.handleBlur();
            emit('commit', val);
          }
        "
        @cancel="(val: string) => emit('cancel', val)"
        @edit-start="emit('edit-start')"
      >
        <template v-if="$slots.trail" #trail>
          <slot name="trail" />
        </template>
      </OInlineEdit>
    </template>
  </component>
</template>
