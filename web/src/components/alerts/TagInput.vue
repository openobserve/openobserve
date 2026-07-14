<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div data-test="tag-input-container" class="w-full h-full">
    <div
      data-test="tag-input-wrapper"
      class="tag-input-wrapper relative flex flex-col px-[5px] py-0 border border-(--o2-border-color,rgba(0,0,0,0.12)) rounded bg-(--o2-card-bg) min-h-14 h-full w-full max-w-full cursor-text transition-colors duration-300 overflow-hidden"
      :class="{ 'has-content': hasContent }"
    >
      <label
        v-if="label"
        data-test="tag-input-label"
        class="tag-input-label absolute top-4 left-3 text-base text-[rgba(0,0,0,0.6)] pointer-events-none transition-all duration-300 bg-transparent px-1 -ml-1"
        style="transition-timing-function: cubic-bezier(0.25, 0.8, 0.5, 1); transform-origin: left top;"
      >{{ label }}</label>
      <div data-test="tags-and-input" class="flex flex-wrap items-start gap-1 mt-[5px] w-full overflow-hidden">
        <OTag
          v-for="(tag, index) in modelValue"
          :key="index"
          :data-test="`tag-chip-${index}`"
          type="selectionChip"
          class="tag-chip m-0! shrink-0 grow-0 basis-auto"
          style="background-color: color-mix(in srgb, var(--o2-primary-btn-bg) 20%, white 10%)"
        >
          {{ tag }}
          <template #trailing>
            <button
              type="button"
              :aria-label="`Remove ${tag}`"
              class="inline-flex items-center justify-center cursor-pointer hover:opacity-70"
              @click="removeTag(index)"
            >
              <OIcon name="close" size="xs" />
            </button>
          </template>
        </OTag>
        <input
          data-test="tag-input-field"
          ref="inputRef"
          v-model="inputValue"
          type="text"
          :placeholder="modelValue.length > 0 ? '' : placeholder"
          class="tag-input [flex:1_1_100px] min-w-[100px] border-0 outline-none bg-transparent p-1 text-sm text-(--q-color-text-primary)"
          @keydown.enter.prevent="addTag"
          @input="handleInput"
          @keydown.delete="handleBackspace"
          @blur="addTag"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

interface Props {
  modelValue: string[];
  placeholder?: string;
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: "Type and press Enter or comma",
  label: "",
});

const hasContent = computed(
  () => props.modelValue.length > 0 || inputValue.value.length > 0,
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string[]): void;
}>();

const inputValue = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

const addTag = () => {
  const trimmedValue = inputValue.value.trim();
  if (trimmedValue && !props.modelValue.includes(trimmedValue)) {
    const newTags = [...props.modelValue, trimmedValue];
    emit("update:modelValue", newTags);
    inputValue.value = "";
  }
};

const handleInput = () => {
  // Check if the input contains a comma
  if (inputValue.value.includes(",")) {
    // Split by comma and process each value
    const values = inputValue.value.split(",");

    // Process all complete values (all but the last one)
    for (let i = 0; i < values.length - 1; i++) {
      const trimmedValue = values[i].trim();
      if (trimmedValue && !props.modelValue.includes(trimmedValue)) {
        const newTags = [...props.modelValue, trimmedValue];
        emit("update:modelValue", newTags);
      }
    }

    // Keep the last value (after the last comma) in the input
    inputValue.value = values[values.length - 1];
  }
};

const removeTag = (index: number) => {
  const newTags = props.modelValue.filter((_, i) => i !== index);
  emit("update:modelValue", newTags);
};

const handleBackspace = () => {
  if (inputValue.value === "" && props.modelValue.length > 0) {
    removeTag(props.modelValue.length - 1);
  }
};
</script>

<style>
.tag-input-wrapper:focus-within {
  border-color: var(--q-primary);
}

.tag-input-wrapper:focus-within .tag-input-label {
  color: var(--q-primary);
}

.tag-input-wrapper.has-content .tag-input-label {
  transform: translateY(-8px) scale(0.75);
  color: var(--q-primary);
}

.tag-input::placeholder {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}
</style>
