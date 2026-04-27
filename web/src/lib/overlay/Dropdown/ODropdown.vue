<script setup lang="ts">
import type {
  DropdownProps,
  DropdownEmits,
  DropdownSlots,
} from "./ODropdown.types";
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
} from "reka-ui";

const props = withDefaults(defineProps<DropdownProps>(), {
  modal: true,
  side: "bottom",
  align: "start",
  sideOffset: 4,
});

const emit = defineEmits<DropdownEmits>();

defineSlots<DropdownSlots>();
</script>

<template>
  <DropdownMenuRoot
    :open="open"
    :modal="modal"
    @update:open="(v) => emit('update:open', v)"
  >
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :class="[
          // Layout
          'tw:min-w-40 tw:p-1',
          // Surface
          'tw:bg-dropdown-bg tw:border tw:border-dropdown-border tw:rounded-lg tw:shadow-md',
          // Typography
          'tw:text-sm tw:text-dropdown-item-text',
          // Animation ΓÇö uses Reka data attributes
          'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0 tw:data-[state=open]:zoom-in-95',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:zoom-out-95',
          'tw:data-[side=bottom]:slide-in-from-top-2 tw:data-[side=top]:slide-in-from-bottom-2',
        ]"
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
