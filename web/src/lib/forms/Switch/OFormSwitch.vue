<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OSwitch from "./OSwitch.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormSwitchProps } from "./OFormSwitch.types";
import type { SwitchValue } from "./OSwitch.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormSwitchProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormSwitch] must be rendered inside <OForm>. No form context found.");
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
                const r = v(ctx.value as SwitchValue);
                if (r !== undefined) return r;
              }
              return undefined;
            },
          }
        : undefined
    "
  >
    <template #default="{ field }">
      <OSwitch
        v-bind="$attrs"
        :label="props.label"
        :label-position="props.labelPosition"
        :size="props.size"
        :checked-value="props.checkedValue"
        :unchecked-value="props.uncheckedValue"
        :disabled="props.disabled"
        :id="props.id"
        :name="props.name"
        :model-value="field.state.value"
        @update:model-value="field.handleChange"
      >
        <template v-if="$slots.label" #label>
          <slot name="label" />
        </template>
      </OSwitch>
    </template>
  </component>
</template>
