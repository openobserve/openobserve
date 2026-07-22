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
      class="group relative flex flex-col px-1.25 py-0 border border-card-glass-border rounded-default bg-card-glass-bg min-h-14 h-full w-full max-w-full cursor-text transition-colors duration-300 overflow-hidden focus-within:border-theme-accent"
    >
      <label
        v-if="label"
        data-test="tag-input-label"
        class="absolute top-4 left-3 text-base pointer-events-none transition-all duration-300 bg-transparent px-1 -ml-1 group-focus-within:text-theme-accent ease-[cubic-bezier(0.25,0.8,0.5,1)] origin-top-left"
        :class="hasContent ? '-translate-y-2 scale-75 text-theme-accent' : 'text-text-secondary'"
        >{{ label }}</label
      >
      <div
        data-test="tags-and-input"
        class="flex flex-wrap items-start gap-1 mt-1.25 w-full overflow-hidden"
      >
        <OTag
          v-for="(tag, index) in modelValue"
          :key="index"
          :data-test="`tag-chip-${index}`"
          type="selectionChip"
          class="tag-chip m-0! shrink-0 grow-0 basis-auto bg-[color-mix(in_srgb,var(--color-button-primary)_20%,white_10%)]"
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
          class="[flex:1_1_100px] min-w-25 border-0 outline-none bg-transparent p-1 text-sm text-text-body placeholder:text-text-secondary"
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

const hasContent = computed(() => props.modelValue.length > 0 || inputValue.value.length > 0);

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
