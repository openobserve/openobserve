<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OSelect from "./OSelect.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormSelectProps } from "./OFormSelect.types";
import type { SelectModelValue } from "./OSelect.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormSelectProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormSelect] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component
    v-if="form"
    :is="form.Field"
    :name="props.name"
  >
    <template #default="{ field }">
      <OSelect
        v-bind="$attrs"
        :label="props.label"
        :placeholder="props.placeholder"
        :options="props.options"
        :multiple="props.multiple"
        :searchable="props.searchable"
        :search-debounce="props.searchDebounce"
        :hide-selected="props.hideSelected"
        :select-all="props.selectAll"
        :creatable="props.creatable"
        :label-key="props.labelKey"
        :value-key="props.valueKey"
        :clearable="props.clearable"
        :disabled="props.disabled"
        :required="props.required"
        :size="props.size"
        :width="props.width"
        :name="props.name"
        :id="props.id"
        :model-value="field.state.value"
        :error="
          field.state.meta.errors.length > 0
        "
        :error-message="
          field.state.meta.errors.length > 0
            ? firstFieldError(field.state.meta.errors)
            : undefined
        "
        @update:model-value="field.handleChange"
        @blur="field.handleBlur"
      >
        <template v-if="$slots.default" #default>
          <slot />
        </template>
        <template v-if="$slots.empty" #empty>
          <slot name="empty" />
        </template>
      </OSelect>
    </template>
  </component>
</template>
