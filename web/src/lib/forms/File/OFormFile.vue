<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OFile from "./OFile.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { firstFieldError } from "../Form/fieldError";
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
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
        <!-- OFile owns the error rendering: passing BOTH :error and
             :error-message makes it surface the canonical error span carrying
             the `<data-test>-error` id (mirrors OFormInput → OInput). Rendering
             a second error node here would duplicate the message AND leave the
             one E2E selectors target (`-error`) unrendered. -->
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
          :required="props.required"
          :size="props.size"
          :id="props.id"
          :name="props.name"
          :model-value="field.state.value"
          :error="field.state.meta.errors.length > 0"
          :error-message="
            field.state.meta.errors.length > 0
              ? firstFieldError(field.state.meta.errors)
              : undefined
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
      </div>
    </template>
  </component>
</template>
