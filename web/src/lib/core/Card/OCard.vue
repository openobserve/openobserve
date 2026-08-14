<script setup lang="ts">
import type { OCardProps, OCardSlots } from "./OCard.types";

defineProps<OCardProps>();
defineSlots<OCardSlots>();
</script>

<template>
  <div class="bg-card-bg text-card-text rounded-default flex flex-col" v-bind="$attrs">
    <slot />
  </div>
</template>
