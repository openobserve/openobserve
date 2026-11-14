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
      class="text-text-muted text-2xs flex items-center px-2 pt-1.5 pb-0.5 font-medium select-none"
    >
      <span>{{ props.label }}</span>
      <span v-if="$slots['label-action']" class="ms-auto flex items-center">
        <slot name="label-action" />
      </span>
    </DropdownMenuLabel>
    <slot />
  </DropdownMenuGroup>
</template>
