<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Form-aware wrapper around OTagInput — the OForm* variant for a `string[]` tag
// input. Modeled on OFormSelect / OFormToggleGroup: inject the OForm context,
// render `form.Field` by `name`, bind model-value ← field.state.value and route
// changes → field.handleChange.
//
// Notes specific to OTagInput:
//  • OTagInput emits no `blur`, and a bound field may carry no required rule, so
//    there is often no blur/error wiring to do. A form-level error div is still
//    included (shows only when errors.length > 0) so the wrapper behaves
//    correctly when a rule is present — it renders nothing otherwise, keeping the
//    DOM identical to a bare OTagInput.
//  • `field.state.value` may be undefined (optional field) — coerce to `[]`
//    because OTagInput requires a non-null `string[]`.

import { inject, useId } from "vue";
import OTagInput from "./OTagInput.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { leaveOnFocusOut, useVisibleFieldError } from "@/lib/forms/Form/fieldError";
import type { FormTagInputProps } from "./OFormTagInput.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormTagInputProps>();
const labelId = useId();
const helpId = useId();

const form = inject(FORM_CONTEXT_KEY, null);
const shown = useVisibleFieldError(form);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormTagInput] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div v-if="props.label || props.helpText" class="flex flex-col gap-1">
        <label
          v-if="props.label"
          :id="labelId"
          data-test="form-tag-input-label"
          class="text-compact text-input-label-text flex items-center gap-1 leading-tight font-medium"
          >{{ props.label
          }}<span v-if="props.required" aria-hidden="true" class="select-none">*</span></label
        >
        <OTagInput
          v-bind="$attrs"
          :placeholder="props.placeholder"
          :aria-labelledby="props.label ? labelId : undefined"
          :aria-describedby="props.helpText ? helpId : undefined"
          :aria-required="props.required || undefined"
          :aria-invalid="shown(field).invalid ? 'true' : undefined"
          :model-value="field.state.value ?? []"
          @update:model-value="field.handleChange"
          @focusout="leaveOnFocusOut(field, $event)"
        />
        <div v-if="shown(field).message !== undefined" class="text-input-error-text text-xs">
          {{ shown(field).message }}
        </div>
        <span
          v-else-if="props.helpText"
          :id="helpId"
          data-test="form-tag-input-help"
          class="text-input-hint text-xs leading-snug"
          >{{ props.helpText }}</span
        >
      </div>
      <template v-else>
        <OTagInput
          v-bind="$attrs"
          :placeholder="props.placeholder"
          :aria-invalid="shown(field).invalid ? 'true' : undefined"
          :model-value="field.state.value ?? []"
          @update:model-value="field.handleChange"
          @focusout="leaveOnFocusOut(field, $event)"
        />
        <div v-if="shown(field).message !== undefined" class="text-input-error-text mt-1 text-xs">
          {{ shown(field).message }}
        </div>
      </template>
    </template>
  </component>
</template>
