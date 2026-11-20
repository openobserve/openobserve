<script setup lang="ts">
import { provide, toRef } from "vue";
import type { ButtonGroupProps, ButtonGroupSlots } from "./OButtonGroup.types";
import { BUTTON_GROUP_SIZE } from "./OButton.types";

const props = defineProps<ButtonGroupProps>();

defineSlots<ButtonGroupSlots>();

provide(BUTTON_GROUP_SIZE, toRef(props, "size"));
</script>

<template>
  <div
    :class="[
      // Never clip overflow here: it hides a child's offset focus outline; z-1 lifts it over the neighbour.
      'inline-flex flex-row items-stretch [&_:focus-visible]:z-1',
      'divide-button-group-divider divide-x',
      '[&>*:first-child:not(:only-child)]:rounded-e-none [&>*:last-child:not(:only-child)]:rounded-s-none',
      '[&>*:not(:first-child):not(:last-child)]:rounded-none',
      // Bordered children would otherwise stack two 1px edges at every join.
      '[&>*:not(:first-child)]:border-s-0',
    ]"
    role="group"
  >
    <slot />
  </div>
</template>
