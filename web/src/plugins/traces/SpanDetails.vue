<template>
  <div class="full-width">
    <div
      class="flex justify-between items-center full-width q-px-md"
      style="border-bottom: 1px solid #e9e9e9"
    >
      <div style="font-size: 18px">
        {{ span.operationName }}
      </div>
      <div class="flex items-center">
        <div
          class="q-px-sm"
          style="border-right: 1px solid #cccccc; font-size: 14px"
        >
          <span>Service: </span>
          <span>{{ span.serviceName }}</span>
        </div>
        <div
          class="q-px-sm"
          style="border-right: 1px solid #cccccc; font-size: 14px"
        >
          <span>Duration: </span>
          <span>{{ span.durationMs }}ms</span>
        </div>
        <div class="q-pl-sm" style="font-size: 14px">
          <span>Start Time: </span>
          <span>{{ span.startTime }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  span: {
    type: Object,
    default: () => ({}),
  },
});
</script>

<style scoped></style>
