<template>
  <div :data-test="`${dataTest}-list-page`" class="flex flex-col flex-1 min-w-0 h-full min-h-0">
    <div v-if="showEmpty" class="flex-1 min-h-0">
      <div class="bg-card-glass-bg h-full flex items-center justify-center">
        <slot name="empty" />
      </div>
    </div>

    <div v-else class="flex-1 min-h-0">
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
