<script setup lang="ts">
import type { DropdownGroupProps, DropdownGroupSlots } from "./ODropdown.types";
import { DropdownMenuGroup, DropdownMenuLabel } from "reka-ui";

const props = defineProps<DropdownGroupProps>();

defineSlots<DropdownGroupSlots>();
</script>

<template>
  <DropdownMenuGroup>
    <DropdownMenuLabel
      v-if="props.label"
      :class="[
        'tw:px-3 tw:py-1 tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide',
        'tw:text-dropdown-label tw:select-none',
      ]"
    >
      {{ props.label }}
    </DropdownMenuLabel>
    <slot />
  </DropdownMenuGroup>
</template>
