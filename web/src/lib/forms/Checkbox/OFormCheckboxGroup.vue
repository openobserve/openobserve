<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OCheckboxGroup from "./OCheckboxGroup.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormCheckboxGroupProps } from "./OFormCheckboxGroup.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormCheckboxGroupProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormCheckboxGroup] must be rendered inside <OForm>. No form context found.",
  );
}
</script>

<template>
  <component
    v-if="form"
    :is="form.Field"
    :name="props.name"
  >
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
        <OCheckboxGroup
          v-bind="$attrs"
          :disabled="props.disabled"
          :model-value="field.state.value"
          @update:model-value="field.handleChange"
        >
          <slot />
        </OCheckboxGroup>
        <div
          v-if="
            field.state.meta.errors.length > 0
          "
          class="text-xs text-input-error-text"
        >
          {{ firstFieldError(field.state.meta.errors) }}
        </div>
      </div>
    </template>
  </component>
</template>
