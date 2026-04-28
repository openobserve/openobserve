<script setup lang="ts">
import type { MenuProps, MenuEmits, MenuSlots } from "./OMenu.types";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "reka-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<MenuProps>(), {
  side: "bottom",
  align: "start",
  sideOffset: 4,
  alignOffset: 0,
  fit: false,
  modal: false,
});

const emit = defineEmits<MenuEmits>();

defineSlots<MenuSlots>();

const contentStyle = computed(() =>
  props.fit ? { width: "var(--reka-popper-anchor-width)" } : undefined
);
</script>

<template>
  <PopoverRoot
    :open="open"
    :modal="modal"
    @update:open="(v) => emit('update:open', v)"
  >
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :align-offset="alignOffset"
        :style="contentStyle"
        :class="[
          'tw:bg-menu-bg tw:border tw:border-menu-border',
          'tw:rounded-lg tw:shadow-md',
          'tw:z-[9999]',
          'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0 tw:data-[state=open]:zoom-in-95',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:zoom-out-95',
          'tw:data-[side=bottom]:slide-in-from-top-2 tw:data-[side=top]:slide-in-from-bottom-2',
          'tw:data-[side=left]:slide-in-from-right-2 tw:data-[side=right]:slide-in-from-left-2',
        ]"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
