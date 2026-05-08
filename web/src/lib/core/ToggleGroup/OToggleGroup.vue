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
  variant: "default",
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
    :data-variant="variant"
    :class="[
      'tw:inline-flex tw:items-stretch',
      orientation === 'vertical' ? 'tw:flex-col' : 'tw:flex-row',
      // Track: use the defined token so it's always opaque regardless of parent
      'tw:bg-[var(--color-toggle-track-bg)] tw:rounded-lg tw:p-0.5',
      'tw:border tw:border-toggle-border',
    ]"
    @update:model-value="
      (v) => {
        if (type === 'single' && (v === null || v === undefined || v === '')) return;
        emit('update:modelValue', v);
      }
    "
  >
    <slot />
  </ToggleGroupRoot>
</template>
