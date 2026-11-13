<template>
  <div
    role="status"
    class="border-border-default bg-surface-panel rounded-surface text-text-body flex items-center gap-2 border px-3 py-1.5 text-xs"
    data-test="info-notice"
  >
    <OIcon :name="icon" size="sm" class="text-text-secondary shrink-0" />
    <div class="min-w-0 flex-1"><slot /></div>
    <slot name="actions" />
  </div>
</template>
<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
withDefaults(defineProps<{ icon?: string }>(), { icon: "info" });
</script>
