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
        'tw:flex tw:items-center tw:px-3 tw:py-1 tw:text-xs tw:font-semibold',
        'tw:text-dropdown-label tw:select-none',
      ]"
    >
      <span>{{ props.label }}</span>
      <span v-if="$slots['label-action']" class="tw:ml-auto tw:flex tw:items-center">
        <slot name="label-action" />
      </span>
    </DropdownMenuLabel>
    <slot />
  </DropdownMenuGroup>
</template>
