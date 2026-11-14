<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { inject } from "vue";
import OInput from "./OInput.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { useVisibleFieldError } from "../Form/fieldError";
import { raw } from "@/types/i18n";
import type { FormInputProps } from "./OFormInput.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormInputProps>();

const form = inject(FORM_CONTEXT_KEY, null);
const shown = useVisibleFieldError(form);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormInput] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <OInput
        v-bind="$attrs"
        :label="props.label"
        :placeholder="props.placeholder"
        :type="props.type"
        :model-modifiers="props.modelModifiers"
        :disabled="props.disabled"
        :readonly="props.readonly"
        :required="props.required"
        :help-text="props.helpText"
        :clearable="props.clearable"
        :maxlength="props.maxlength"
        :debounce="props.debounce"
        :mask="props.mask"
        :prefix="props.prefix"
        :suffix="props.suffix"
        :icon="props.icon"
        :copyable="props.copyable"
        :mono="props.mono"
        :autofocus="props.autofocus"
        :autocomplete="props.autocomplete"
        :name="props.name"
        :id="props.id"
        :size="props.size"
        :width="props.width"
        :model-value="field.state.value"
        :error="shown(field).invalid"
        :error-message="
          !$slots.error && shown(field).message !== undefined
            ? raw(shown(field).message)
            : undefined
        "
        @update:model-value="(val: unknown) => field.handleChange(val)"
        @blur="field.handleBlur"
      >
        <template v-if="$slots.icon" #icon>
          <slot name="icon" />
        </template>
        <template v-if="$slots['icon-end']" #icon-end>
          <slot name="icon-end" />
        </template>
        <template v-if="$slots.tooltip" #tooltip>
          <slot name="tooltip" />
        </template>
      </OInput>
      <!-- #error slot: when provided the consumer OWNS the message — only the
           inline TEXT is suppressed above (error-message is left undefined). The
           invalid STATE still reaches OInput, so the field keeps its red border:
           a narrow field that re-homes its message must still look invalid.
           Rendered after OInput so it can escape a composite border; may be left
           empty purely to suppress the text. -->
      <template v-if="$slots.error">
        <slot name="error" />
      </template>
    </template>
  </component>
</template>
