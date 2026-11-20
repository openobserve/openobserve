<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OFile from "./OFile.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { useVisibleFieldError } from "../Form/fieldError";
import { raw } from "@/types/i18n";
import type { FormFileProps } from "./OFormFile.types";
import type { FileValue } from "./OFile.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormFileProps>();

const form = inject(FORM_CONTEXT_KEY, null);
const shown = useVisibleFieldError(form);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormFile] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div class="flex flex-col gap-1">
        <!-- OFile owns the error node: passing :error and :error-message surfaces the canonical
             `<data-test>-error` span E2E selectors target, so no second node is rendered here. -->
        <OFile
          v-bind="$attrs"
          :label="props.label"
          :placeholder="props.placeholder"
          :multiple="props.multiple"
          :accept="props.accept"
          :max-size="props.maxSize"
          :max-files="props.maxFiles"
          :variant="props.variant"
          :validate="props.validate"
          :upload="props.upload"
          :help-text="props.helpText"
          :disabled="props.disabled"
          :disabled-reason="props.disabledReason"
          :required="props.required"
          :id="props.id"
          :name="props.name"
          :model-value="field.state.value"
          :error="shown(field).invalid"
          :error-message="
            shown(field).message !== undefined ? raw(shown(field).message) : undefined
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
