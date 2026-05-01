<script setup lang="ts">
import type {
  ToggleGroupProps,
  ToggleGroupEmits,
  ToggleGroupSlots,
} from "./OToggleGroup.types";
import { ToggleGroupRoot } from "reka-ui";

const props = withDefaults(defineProps<ToggleGroupProps>(), {
  type: "single",
  disabled: false,
  orientation: "horizontal",
});

const emit = defineEmits<ToggleGroupEmits>();

defineSlots<ToggleGroupSlots>();
</script>

<template>
  <ToggleGroupRoot
    :type="type"
    :model-value="modelValue"
    :disabled="disabled"
    :orientation="orientation"
    :class="[
      'tw:inline-flex tw:items-stretch',
      orientation === 'vertical' ? 'tw:flex-col' : 'tw:flex-row',
      // Track: transparent with border
      'tw:bg-transparent tw:rounded-lg tw:p-0.5',
      'tw:border tw:border-toggle-border',
    ]"
    @update:model-value="(v) => { if (type === 'single' && !v) return; emit('update:modelValue', v) }"
  >
    <slot />
  </ToggleGroupRoot>
</template>
