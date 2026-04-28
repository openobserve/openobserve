<script setup lang="ts">
import type { ModalHeaderProps, ModalHeaderEmits, ModalHeaderSlots } from "./OModalHeader.types";
import { DialogTitle, DialogClose } from "reka-ui";

const props = withDefaults(defineProps<ModalHeaderProps>(), {
  showClose: true,
});

const emit = defineEmits<ModalHeaderEmits>();

defineSlots<ModalHeaderSlots>();
</script>

<template>
  <div
    class="tw:flex tw:items-center tw:justify-between tw:gap-4 tw:px-6 tw:py-4 tw:border-b tw:border-modal-header-border tw:shrink-0"
  >
    <DialogTitle
      class="tw:text-lg tw:font-semibold tw:leading-tight tw:text-modal-title"
    >
      <slot />
    </DialogTitle>

    <DialogClose
      v-if="showClose"
      :class="[
        'tw:flex tw:items-center tw:justify-center tw:size-8 tw:shrink-0',
        'tw:rounded-md tw:cursor-pointer tw:outline-none',
        'tw:text-modal-close-text tw:hover:bg-modal-close-hover-bg',
        'tw:focus-visible:ring-2 tw:focus-visible:ring-modal-focus-ring',
        'tw:transition-colors tw:duration-150',
      ]"
      @click="emit('close')"
    >
      <slot name="close">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 4L12 12M12 4L4 12"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </slot>
    </DialogClose>
  </div>
</template>
