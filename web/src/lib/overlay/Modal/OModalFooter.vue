<script setup lang="ts">
import type { ModalFooterSlots } from "./OModalFooter.types";

defineSlots<ModalFooterSlots>();
</script>

<template>
  <div
    class="tw:flex tw:items-center tw:justify-end tw:gap-2 tw:px-6 tw:py-4 tw:border-t tw:border-modal-footer-border tw:shrink-0"
  >
    <slot />
  </div>
</template>
