<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OOptionGroup from "./OOptionGroup.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormOptionGroupProps } from "./OFormOptionGroup.types";
import type { OptionGroupValue } from "./OOptionGroup.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormOptionGroupProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormOptionGroup] must be rendered inside <OForm>. No form context found.",
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
                const r = v(ctx.value as OptionGroupValue);
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
        <OOptionGroup
          v-bind="$attrs"
          :options="props.options"
          :type="props.type"
          :orientation="props.orientation"
          :label="props.label"
          :help-text="props.helpText"
          :disabled="props.disabled"
          :size="props.size"
          :name="props.name"
          :model-value="field.state.value"
          :error="
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          "
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
        <div
          v-if="
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          "
          class="tw:text-xs tw:text-option-group-error-text"
        >
          {{ field.state.meta.errors[0] }}
        </div>
      </div>
    </template>
  </component>
</template>
