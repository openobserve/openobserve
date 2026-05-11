<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, inject } from "vue";
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

// Forward only props the consumer actually set. Spreading `props` directly
// would pass Vue-coerced defaults (e.g. `false` for optional Boolean-typed
// props), tripping the child's type validators.
const passthroughProps = computed(() => {
  const out: Record<string, unknown> = {};
  if (props.label !== undefined) out.label = props.label;
  if (props.labelPosition !== undefined) out.labelPosition = props.labelPosition;
  if (props.size !== undefined) out.size = props.size;
  if (props.disabled !== undefined) out.disabled = props.disabled;
  if (props.checkedValue !== undefined) out.checkedValue = props.checkedValue;
  if (props.uncheckedValue !== undefined) {
    out.uncheckedValue = props.uncheckedValue;
  }
  if (props.id !== undefined) out.id = props.id;
  if (props.name !== undefined) out.name = props.name;
  return out;
});
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
      <div class="tw:flex tw:flex-col tw:gap-1">
        <OSwitch
          v-bind="{ ...$attrs, ...passthroughProps }"
          :model-value="field.state.value"
          @update:model-value="field.handleChange"
        >
          <template v-if="$slots.label" #label>
            <slot name="label" />
          </template>
        </OSwitch>
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
