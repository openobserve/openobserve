<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import ORadioGroup from "./ORadioGroup.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormRadioGroupProps } from "./OFormRadioGroup.types";
import type { RadioValue } from "./ORadio.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormRadioGroupProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormRadioGroup] must be rendered inside <OForm>. No form context found.",
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
            onChange: (ctx: { value: RadioValue | undefined }) => {
              for (const v of props.validators ?? []) {
                const r = v(ctx.value);
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
        <ORadioGroup
          v-bind="$attrs"
          :label="props.label"
          :name="props.name"
          :disabled="props.disabled"
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
        <div
          v-if="
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          "
          class="tw:text-xs tw:text-input-error-text"
        >
          {{ field.state.meta.errors[0] }}
        </div>
      </div>
    </template>
  </component>
</template>
