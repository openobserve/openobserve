<template>
  <div
    role="alert"
    class="border-banner-error-soft-border bg-status-error-bg rounded-surface text-text-body text-compact flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border px-3 py-2"
    data-test="error-panel"
  >
    <OIcon name="error" size="sm" class="text-status-error-text shrink-0" />
    <div class="min-w-0 flex-1">
      <slot />
    </div>
    <div
      v-if="$slots.actions"
      class="flex shrink-0 items-center gap-2"
      data-test="error-panel-actions"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
</script>
