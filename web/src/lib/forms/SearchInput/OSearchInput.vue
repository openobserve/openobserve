<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed } from "vue";
import type { SearchInputProps, SearchInputEmits } from "./OSearchInput.types";
import type { InputSize } from "@/lib/forms/Input/OInput.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<SearchInputProps>(), {
  modelValue: "",
  placeholder: "Search...",
  size: "sm",
  clearable: true,
  debounce: 0,
  disabled: false,
});

const emit = defineEmits<SearchInputEmits>();

// OInput only supports sm | md; xs maps to sm for the wrapper height
const inputSize = computed<InputSize>(() =>
  props.size === "md" ? "md" : "sm",
);

// Icon size follows OSearchInput size 1-to-1
const iconSize = computed(() => (props.size === "xs" ? "xs" : "sm"));
</script>

<template>
  <OInput
    v-bind="$attrs"
    :model-value="modelValue"
    :placeholder="placeholder"
    :size="inputSize"
    :clearable="clearable"
    :debounce="debounce"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event as string)"
    @clear="emit('clear')"
  >
    <template #icon-left>
      <OIcon
        name="search"
        :size="iconSize"
        class="tw:cursor-pointer"
      />
    </template>
  </OInput>
</template>
