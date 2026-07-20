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
  labelPosition: "left",
});

const emit = defineEmits<ToggleGroupEmits>();

const slots = defineSlots<ToggleGroupSlots>();

const hasLabel = computed(
  () => Boolean(slots.label) || props.label !== undefined,
);

// Wrapper layout depends on label position: top stacks vertically, left/right
// sits inline. When there is no label, render only the ToggleGroupRoot.
const wrapperClasses = computed(() => {
  if (!hasLabel.value) return "";
  return [
    "inline-flex gap-2",
    props.labelPosition === "top"
      ? "flex-col items-start"
      : props.labelPosition === "right"
        ? "flex-row-reverse items-center"
        : "flex-row items-center",
  ].join(" ");
});
</script>

<template>
  <!-- With label: wrap in a flex container so the label and toggle bar sit
       together. Without label: render the ToggleGroupRoot directly to keep
       the existing inline-flex/sizing contract. -->
  <div v-if="hasLabel" :class="wrapperClasses">
    <span
      :class="[
        'o-input-label text-sm font-medium select-none leading-tight',
        disabled && 'o-input-label--disabled',
      ]"
    >
      <slot name="label">{{ label }}</slot>
    </span>

    <ToggleGroupRoot
      :type="type"
      :model-value="modelValue"
      :disabled="disabled"
      :orientation="orientation"
      :data-variant="variant"
      :class="[
        'inline-flex items-stretch',
        orientation === 'vertical' ? 'flex-col' : 'flex-row',
        'bg-[var(--color-toggle-track-bg)] rounded-lg p-0.5',
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
  </div>

  <ToggleGroupRoot
    v-else
    :type="type"
    :model-value="modelValue"
    :disabled="disabled"
    :orientation="orientation"
    :data-variant="variant"
    :class="[
      'inline-flex items-stretch',
      orientation === 'vertical' ? 'flex-col' : 'flex-row',
      'bg-[var(--color-toggle-track-bg)] rounded-lg p-0.5',
      'border border-toggle-border',
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
