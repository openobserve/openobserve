<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, useAttrs } from "vue";
import type { SearchInputProps, SearchInputEmits } from "./OSearchInput.types";
import type { InputSize } from "@/lib/forms/Input/OInput.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();

// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex: _tabindex, ...rest } = $attrs;
  return rest;
});

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
    v-bind="wrapperAttrs"
    :model-value="modelValue"
    :placeholder="placeholder"
    :size="inputSize"
    :clearable="clearable"
    :debounce="debounce"
    :disabled="disabled"
    :tabindex="inputTabindex"
    @update:model-value="emit('update:modelValue', $event as string)"
    @clear="emit('clear')"
  >
    <template #icon-left>
      <OIcon
        name="search"
        :size="iconSize"
        class="cursor-pointer"
      />
    </template>

    <!-- Forwarded so a search field can carry a control INSIDE its border — the
         scope toggle the dashboard list puts in its search box, for one. Guarded
         by `v-if`: OInput renders the right-hand span only when the slot exists,
         and passing an always-present-but-empty template would give every plain
         search input a padded, invisible box on its right. -->
    <template v-if="$slots['icon-right']" #icon-right>
      <slot name="icon-right" />
    </template>
  </OInput>
</template>
