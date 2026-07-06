<script setup lang="ts">
import type { DropdownGroupProps, DropdownGroupSlots } from "./ODropdown.types";
import { DropdownMenuGroup, DropdownMenuLabel } from "reka-ui";

const props = defineProps<DropdownGroupProps>();

defineSlots<DropdownGroupSlots>();
</script>

<template>
  <DropdownMenuGroup>
    <DropdownMenuLabel
      v-if="props.label || $slots['label-action']"
      :class="[
        'flex items-center px-3 py-1 text-xs font-semibold',
        'text-dropdown-label select-none',
      ]"
    >
      <span>{{ props.label }}</span>
      <span v-if="$slots['label-action']" class="ml-auto flex items-center">
        <slot name="label-action" />
      </span>
    </DropdownMenuLabel>
    <slot />
  </DropdownMenuGroup>
</template>
