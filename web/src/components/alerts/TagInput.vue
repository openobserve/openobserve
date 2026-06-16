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
  <div data-test="tag-input-container" class="tw:w-full tw:h-full">
    <div
      data-test="tag-input-wrapper"
      class="tag-input-wrapper tw:relative tw:flex tw:flex-col tw:px-[5px] tw:py-0 tw:border tw:border-(--o2-border-color,rgba(0,0,0,0.12)) tw:rounded tw:bg-(--o2-card-bg) tw:min-h-14 tw:h-full tw:w-full tw:max-w-full tw:cursor-text tw:transition-colors tw:duration-300 tw:overflow-hidden"
      :class="{ 'has-content': hasContent }"
    >
      <label
        v-if="label"
        data-test="tag-input-label"
        class="tag-input-label tw:absolute tw:top-4 tw:left-3 tw:text-base tw:text-[rgba(0,0,0,0.6)] tw:pointer-events-none tw:transition-all tw:duration-300 tw:bg-transparent tw:px-1 tw:-ml-1"
        style="transition-timing-function: cubic-bezier(0.25, 0.8, 0.5, 1); transform-origin: left top;"
      >{{ label }}</label>
      <div data-test="tags-and-input" class="tw:flex tw:flex-wrap tw:items-start tw:gap-1 tw:mt-[5px] tw:w-full tw:overflow-hidden">
        <OBadge
          v-for="(tag, index) in modelValue"
          :key="index"
          :data-test="`tag-chip-${index}`"
          variant="default"
          size="sm"
          class="tag-chip tw:m-0! tw:shrink-0 tw:grow-0 tw:basis-auto tw:bg-[color-mix(in_srgb,var(--o2-primary-btn-bg)_20%,white_10%)]"
        >
          {{ tag }}
          <template #trailing>
            <button
              type="button"
              :aria-label="`Remove ${tag}`"
              class="tw:inline-flex tw:items-center tw:justify-center tw:cursor-pointer tw:hover:opacity-70"
              @click="removeTag(index)"
            >
              <OIcon name="close" size="xs" />
            </button>
          </template>
        </OBadge>
        <input
          data-test="tag-input-field"
          ref="inputRef"
          v-model="inputValue"
          type="text"
          :placeholder="modelValue.length > 0 ? '' : placeholder"
          class="tag-input tw:[flex:1_1_100px] tw:min-w-[100px] tw:border-0 tw:outline-none tw:bg-transparent tw:p-1 tw:text-sm tw:text-(--q-color-text-primary)"
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
import OBadge from "@/lib/core/Badge/OBadge.vue";
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
  color: var(--q-color-text-hint);
}
</style>
