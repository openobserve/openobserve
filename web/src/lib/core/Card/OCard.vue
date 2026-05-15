<script setup lang="ts">
import type { OCardProps, OCardSlots } from "./OCard.types";

defineProps<OCardProps>();
defineSlots<OCardSlots>();
</script>

<template>
  <div
    class="tw:bg-card-bg tw:text-card-text tw:rounded-lg tw:flex tw:flex-col"
    v-bind="$attrs"
  >
    <slot />
  </div>
</template>
