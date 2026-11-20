<script setup lang="ts" generic="T extends TemplateSuggestion">
// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { inject } from "vue";
import OTemplateInput from "./OTemplateInput.vue";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { useVisibleFieldError } from "../Form/fieldError";
import { raw } from "@/types/i18n";
import type { TemplateSuggestion } from "./OTemplateInput.types";
import type { FormTemplateInputProps } from "./OFormTemplateInput.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormTemplateInputProps<T>>();

const form = inject(FORM_CONTEXT_KEY, null);
const shown = useVisibleFieldError(form);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormTemplateInput] must be rendered inside <OForm>. No form context found.");
}
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <OTemplateInput
        v-bind="$attrs"
        :label="props.label"
        :icon="props.icon"
        :mono="props.mono"
        :placeholder="props.placeholder"
        :type="props.type"
        :disabled="props.disabled"
        :readonly="props.readonly"
        :required="props.required"
        :help-text="props.helpText"
        :clearable="props.clearable"
        :maxlength="props.maxlength"
        :min="props.min"
        :max="props.max"
        :step="props.step"
        :prefix="props.prefix"
        :suffix="props.suffix"
        :autofocus="props.autofocus"
        :autocomplete="props.autocomplete"
        :name="props.name"
        :id="props.id"
        :size="props.size"
        :width="props.width"
        :suggestions="props.suggestions"
        :values="props.values"
        :delimiter="props.delimiter"
        :model-value="field.state.value"
        :error="shown(field).invalid"
        :error-message="shown(field).message !== undefined ? raw(shown(field).message) : undefined"
        @update:model-value="(val: string) => field.handleChange(val)"
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
        <template v-if="$slots.suggestion" #suggestion="slotProps">
          <slot name="suggestion" v-bind="slotProps" />
        </template>
      </OTemplateInput>
    </template>
  </component>
</template>
