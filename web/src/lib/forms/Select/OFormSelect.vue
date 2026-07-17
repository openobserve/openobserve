<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OSelect from "./OSelect.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
import type { FormSelectProps } from "./OFormSelect.types";

defineOptions({ inheritAttrs: false });

// OSelect defaults `searchable` to true. Because OFormSelect re-declares it as a
// boolean prop, an OMITTED `searchable` would be cast to `false` (Vue's
// absent-boolean rule) and then forwarded, clobbering OSelect's default and
// making every form select non-searchable. Mirror OSelect's default so the
// wrapper is transparent (consumers can still pass `:searchable="false"`).
const props = withDefaults(defineProps<FormSelectProps>(), {
  searchable: true,
});

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
      <!--
        Forward the whole typed props object rather than a hand-written prop
        list. FormSelectProps re-declares every OSelect prop (except
        modelValue/error/errorMessage), so a declared-but-unforwarded prop like
        `loading`, `optionTooltip`, `labelPosition`, etc. would be stripped from
        `$attrs` AND missing from the manual list — silently dropped. Binding
        `props` keeps the wrapper transparent as new OSelect props are added.
        The field-driven bindings (model-value/error/error-message) come last so
        they win, and are the exact three keys FormSelectProps omits.
      -->
      <OSelect
        v-bind="{ ...$attrs, ...props }"
        :model-value="field.state.value"
        :error="field.state.meta.errors.length > 0"
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
        <template v-if="$slots.tooltip" #tooltip>
          <slot name="tooltip" />
        </template>
      </OSelect>
    </template>
  </component>
</template>
