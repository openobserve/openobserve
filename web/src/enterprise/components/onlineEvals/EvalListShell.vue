<template>
  <div
    :data-test="`${dataTest}-list-page`"
    class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:h-full tw:min-h-0"
  >
    <div v-if="showEmpty" class="tw:flex-1 tw:min-h-0">
      <div class="card-container tw:h-full tw:flex tw:items-center tw:justify-center">
        <slot name="empty" />
      </div>
    </div>

    <div v-else class="tw:flex-1 tw:min-h-0">
      <div class="card-container tw:h-full">
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
