<template>
  <div :data-test="`${dataTest}-list-page`" class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
    <div v-if="showEmpty" class="min-h-0 flex-1">
      <div class="bg-card-glass-bg flex h-full items-center justify-center">
        <slot name="empty" />
      </div>
    </div>

    <div v-else class="min-h-0 flex-1">
      <div class="bg-card-glass-bg h-full">
        <slot name="table" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  dataTest: string;
  showEmpty: boolean;
}>();
</script>
