<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OFile from "./OFile.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import type { FormFileProps } from "./OFormFile.types";
import type { FileValue } from "./OFile.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormFileProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn(
    "[OFormFile] must be rendered inside <OForm>. No form context found.",
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
                const r = v(ctx.value as FileValue);
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
        <OFile
          v-bind="$attrs"
          :label="props.label"
          :placeholder="props.placeholder"
          :multiple="props.multiple"
          :accept="props.accept"
          :max-file-size="props.maxFileSize"
          :drop-zone="props.dropZone"
          :help-text="props.helpText"
          :disabled="props.disabled"
          :size="props.size"
          :id="props.id"
          :name="props.name"
          :model-value="field.state.value"
          :error="
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          "
          @update:model-value="
            (v: FileValue) => {
              field.handleChange(v);
              field.handleBlur();
            }
          "
        >
          <template v-if="$slots.label" #label>
            <slot name="label" />
          </template>
          <template v-if="$slots.hint" #hint>
            <slot name="hint" />
          </template>
        </OFile>
        <div
          v-if="
            field.state.meta.isTouched && field.state.meta.errors.length > 0
          "
          class="tw:text-xs tw:text-file-error-text"
        >
          {{ field.state.meta.errors[0] }}
        </div>
      </div>
    </template>
  </component>
</template>
