<script setup lang="ts">
import type { ModalBodyProps, ModalBodySlots } from "./OModalBody.types";

const props = withDefaults(defineProps<ModalBodyProps>(), {
  scrollable: true,
});

defineSlots<ModalBodySlots>();
</script>

<template>
  <div
    :class="[
      'tw:flex-1 tw:px-6 tw:py-4',
      props.scrollable ? 'tw:overflow-y-auto' : 'tw:overflow-hidden',
    ]"
  >
    <slot />
  </div>
</template>
