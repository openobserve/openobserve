<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="tag-input-container">
    <div class="tag-input-wrapper" :class="{ 'has-content': hasContent }">
      <label v-if="label" class="tag-input-label">{{ label }}</label>
      <div class="tags-and-input">
        <q-chip
          v-for="(tag, index) in modelValue"
          :key="index"
          removable
          @remove="removeTag(index)"
          size="12px"
          class="tag-chip"
        >
          {{ tag }}
        </q-chip>
        <input
          ref="inputRef"
          v-model="inputValue"
          type="text"
          :placeholder="modelValue.length > 0 ? '' : placeholder"
          class="tag-input"
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

<style lang="scss" scoped>
.tag-input-container {
  width: 100%;
  height: 100%;
}

.tag-input-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0px 5px;
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.12));
  border-radius: 4px;
  background-color: var(--o2-card-bg);
  min-height: 56px;
  height: 100%;
  width: 100%;
  max-width: 100%;
  cursor: text;
  transition: border-color 0.3s;
  overflow: hidden;

  &:focus-within {
    border-color: var(--q-primary);

    .tag-input-label {
      color: var(--q-primary);
    }
  }

  &.has-content .tag-input-label {
    transform: translateY(-8px) scale(0.75);
    color: var(--q-primary);
  }
}

.tag-input-label {
  position: absolute;
  top: 16px;
  left: 12px;
  font-size: 16px;
  color: rgba(0, 0, 0, 0.6);
  pointer-events: none;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
  transform-origin: left top;
  background-color: transparent;
  padding: 0 4px;
  margin-left: -4px;
}

.tags-and-input {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px;
  margin-top: 5px;
  width: 100%;
  overflow: hidden;
}

.tag-chip {
  margin: 0 !important;
  flex: 0 0 auto;
  background-color: color-mix(in srgb, var(--o2-primary-btn-bg) 20%, white 10%);
}

.tag-input {
  flex: 1 1 100px;
  min-width: 100px;
  border: none;
  outline: none;
  background: transparent;
  padding: 4px;
  font-size: 14px;
  color: var(--q-color-text-primary);

  &::placeholder {
    color: var(--q-color-text-hint);
  }
}
</style>
