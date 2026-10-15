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

import { computed, ref, useAttrs } from "vue";
import OInput from "../Input/OInput.vue";
import OTemplateOverlay from "./OTemplateOverlay.vue";
import { useTemplateSuggest } from "./useTemplateSuggest";
import type {
  TemplateInputProps,
  TemplateInputSlots,
  TemplateSuggestEmits,
  TemplateSuggestion,
} from "./OTemplateInput.types";

// `$attrs` lands on the field root only, so the consumer's `data-test` resolves to one element.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<TemplateInputProps<T>>(), { type: "text" });
const emit = defineEmits<TemplateSuggestEmits>();
defineSlots<TemplateInputSlots<T>>();

const $attrs = useAttrs();
const dataTest = computed(() => $attrs["data-test"] as string | undefined);

const rootEl = ref<HTMLElement | null>(null);

const suggest = useTemplateSuggest<T>({
  suggestions: () => props.suggestions,
  values: () => props.values,
  emit,
});

function onUpdate(value: string | number) {
  const text = String(value);
  emit("update:modelValue", text);
  suggest.onInput(text);
}

function onFocus(event: FocusEvent) {
  suggest.onFocus(event);
  emit("focus", event);
}

function onBlur(event: FocusEvent) {
  suggest.onBlur();
  emit("blur", event);
}

function onKeydown(event: KeyboardEvent) {
  suggest.onKeydown(event);
  emit("keydown", event);
}
</script>

<template>
  <div ref="rootEl" class="relative min-w-0">
    <OInput
      v-bind="$attrs"
      :model-value="props.modelValue"
      :type="props.type"
      :label="props.label"
      :placeholder="props.placeholder"
      :help-text="props.helpText"
      :error-message="props.errorMessage"
      :error="props.error"
      :prefix="props.prefix"
      :suffix="props.suffix"
      :clearable="props.clearable"
      :readonly="props.readonly"
      :disabled="props.disabled"
      :required="props.required"
      :autofocus="props.autofocus"
      :autogrow="props.autogrow"
      :maxlength="props.maxlength"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :rows="props.rows"
      :size="props.size"
      :id="props.id"
      :name="props.name"
      :autocomplete="props.autocomplete"
      :width="props.width"
      :label-position="props.labelPosition"
      @update:model-value="onUpdate"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    >
      <template v-if="$slots['icon-left']" #icon-left>
        <slot name="icon-left" />
      </template>
      <template v-if="$slots['icon-right']" #icon-right>
        <slot name="icon-right" />
      </template>
      <template v-if="$slots.prefix" #prefix>
        <slot name="prefix" />
      </template>
      <template v-if="$slots.suffix" #suffix>
        <slot name="suffix" />
      </template>
      <template v-if="$slots.tooltip" #tooltip>
        <slot name="tooltip" />
      </template>
      <template v-if="$slots.append" #append>
        <slot name="append" />
      </template>
    </OInput>

    <OTemplateOverlay :suggest="suggest" :boundary="rootEl" :data-test="dataTest">
      <template v-if="$slots.suggestion" #suggestion="slotProps">
        <slot name="suggestion" v-bind="slotProps" />
      </template>
    </OTemplateOverlay>
  </div>
</template>
