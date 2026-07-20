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

import { inject } from "vue";
import OTagInput from "./OTagInput.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import type { FormTagInputProps } from "./OFormTagInput.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormTagInputProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormTagInput] must be rendered inside <OForm>. No form context found.",
  );
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <OTagInput
        v-bind="$attrs"
        :placeholder="props.placeholder"
        :label="props.label"
        :model-value="field.state.value ?? []"
        @update:model-value="field.handleChange"
      />
      <div
        v-if="field.state.meta.errors.length > 0"
        class="text-xs text-input-error-text mt-1"
      >
        {{ firstFieldError(field.state.meta.errors) }}
      </div>
    </template>
  </component>
</template>
