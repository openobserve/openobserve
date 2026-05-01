<script setup lang="ts">
import type {
  ToggleGroupProps,
  ToggleGroupEmits,
  ToggleGroupSlots,
} from "./OToggleGroup.types";
import { ToggleGroupRoot } from "reka-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<ToggleGroupProps>(), {
  type: "single",
  disabled: false,
  orientation: "horizontal",
  variant: "default",
});

const emit = defineEmits<ToggleGroupEmits>();

defineSlots<ToggleGroupSlots>();

/**
 * For the 'primary' variant the toggle sits on a primary-100 colored bar.
 * We override the CSS variables inline so OToggleGroupItem picks them up
 * automatically without any changes to that component.
 *
 * Light:  primary-200 track → white active pill (clear contrast)
 * Dark:   primary-900 track → primary-600 active pill
 */
const variantStyle = computed(() => {
  if (props.variant !== "primary") return undefined;
  return {
    "--color-toggle-track-bg":        "var(--color-primary-200)",
    "--color-toggle-border":          "var(--color-primary-300)",
    "--color-toggle-item-hover-bg":   "var(--color-primary-100)",
    "--color-toggle-item-active-bg":  "var(--color-surface-base)",
    "--color-toggle-item-active-text":"var(--color-primary-700)",
  } as Record<string, string>;
});
</script>

<template>
  <ToggleGroupRoot
    :type="type"
    :model-value="modelValue"
    :disabled="disabled"
    :orientation="orientation"
    :style="variantStyle"
    :class="[
      'tw:inline-flex tw:items-stretch',
      orientation === 'vertical' ? 'tw:flex-col' : 'tw:flex-row',
      // Track: use the defined token so it's always opaque regardless of parent
      'tw:bg-[var(--color-toggle-track-bg)] tw:rounded-lg tw:p-0.5',
      'tw:border tw:border-toggle-border',
    ]"
    @update:model-value="(v) => { if (type === 'single' && !v) return; emit('update:modelValue', v) }"
  >
    <slot />
  </ToggleGroupRoot>
</template>
