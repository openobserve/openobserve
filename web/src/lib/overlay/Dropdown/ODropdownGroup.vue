<script setup lang="ts">
import type { DropdownGroupProps, DropdownGroupSlots } from "./ODropdown.types";
import { DropdownMenuGroup, DropdownMenuLabel } from "reka-ui";
import { MENU_LABEL_CLASS } from "../menuClasses";

const props = defineProps<DropdownGroupProps>();

defineSlots<DropdownGroupSlots>();
</script>

<template>
  <DropdownMenuGroup>
    <DropdownMenuLabel
      v-if="props.label || $slots['label-action']"
      :class="['flex items-center', MENU_LABEL_CLASS]"
    >
      <span>{{ props.label }}</span>
      <span v-if="$slots['label-action']" class="ms-auto flex items-center">
        <slot name="label-action" />
      </span>
    </DropdownMenuLabel>
    <slot />
  </DropdownMenuGroup>
</template>
