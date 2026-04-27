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
      // Outer border
      'tw:border tw:border-toggle-border tw:rounded-lg tw:overflow-hidden',
    ]"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <slot />
  </ToggleGroupRoot>
</template>
