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
import OTextarea from "../Input/OTextarea.vue";
import OTemplateSuggestList from "./OTemplateSuggestList.vue";
import { useTemplateSuggest } from "./useTemplateSuggest";
import { raw } from "@/types/i18n";
import type { TemplateSuggestion } from "./OTemplateInput.types";
import type {
  TemplateTextareaEmits,
  TemplateTextareaProps,
  TemplateTextareaSlots,
} from "./OTemplateTextarea.types";

// `$attrs` lands on the field root only, so the consumer's `data-test` resolves to one element.
defineOptions({ inheritAttrs: false });

const props = defineProps<TemplateTextareaProps<T>>();
const emit = defineEmits<TemplateTextareaEmits>();
defineSlots<TemplateTextareaSlots<T>>();

const $attrs = useAttrs();
const dataTest = computed(() => $attrs["data-test"] as string | undefined);

const rootEl = ref<HTMLElement | null>(null);

const suggest = useTemplateSuggest<T>({
  suggestions: () => props.suggestions,
  values: () => props.values,
  emit,
});

function tokenFor(name: string) {
  return raw(`{{${name}}}`);
}

function onUpdate(value: string) {
  emit("update:modelValue", value);
  suggest.onInput(value);
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
    <OTextarea
      v-bind="$attrs"
      :model-value="props.modelValue"
      :label="props.label"
      :placeholder="props.placeholder"
      :help-text="props.helpText"
      :error-message="props.errorMessage"
      :error="props.error"
      :rows="props.rows"
      :autogrow="props.autogrow"
      :max-rows="props.maxRows"
      :readonly="props.readonly"
      :disabled="props.disabled"
      :required="props.required"
      :autofocus="props.autofocus"
      :maxlength="props.maxlength"
      :id="props.id"
      :name="props.name"
      :autocomplete="props.autocomplete"
      :size="props.size"
      :width="props.width"
      :fill="props.fill"
      @update:model-value="onUpdate"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    >
      <template v-if="$slots.tooltip" #tooltip>
        <slot name="tooltip" />
      </template>
      <template v-if="$slots.append" #append>
        <slot name="append" />
      </template>
    </OTextarea>

    <!-- The list owns the space below the field, so the peek sits above it and yields while the list is open. -->
    <div
      v-if="
        suggest.peekName.value !== null &&
        suggest.peekValue.value !== null &&
        !suggest.listOpen.value
      "
      :data-test="dataTest ? `${dataTest}-peek` : undefined"
      class="bg-select-content-bg border-dropdown-border rounded-default absolute start-0 bottom-full z-10 mb-1 max-w-72 border px-2 py-1.5 shadow-md"
    >
      <span class="text-accent text-2xs font-mono font-semibold">{{
        tokenFor(suggest.peekName.value)
      }}</span>
      <span class="text-text-secondary block text-xs wrap-break-word">{{
        suggest.peekValue.value
      }}</span>
    </div>

    <OTemplateSuggestList
      :open="suggest.listOpen.value"
      :reference="suggest.element.value"
      :boundary="rootEl"
      :matches="suggest.matches.value"
      :highlighted-index="suggest.highlightedIndex.value"
      :data-test="dataTest"
      @select="suggest.accept"
      @highlight="(index: number) => (suggest.highlightedIndex.value = index)"
      @close="suggest.close"
    >
      <template v-if="$slots.suggestion" #suggestion="slotProps">
        <slot name="suggestion" v-bind="slotProps" />
      </template>
    </OTemplateSuggestList>
  </div>
</template>
