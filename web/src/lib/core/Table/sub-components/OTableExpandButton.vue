<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineProps<{
  expanded: boolean;
  rowId: string;
}>();

defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <button
    type="button"
    :data-test="`o2-table-expand-${rowId}`"
    class="inline-flex items-center justify-center size-6 rounded bg-transparent border-0 cursor-pointer text-secondary hover:bg-button-ghost-hover-bg transition-colors"
    @click.stop="$emit('toggle')"
  >
    <OIcon
      name="chevron-right"
      size="sm"
      class="transition-transform duration-200"
      :class="expanded ? 'rotate-90' : 'rotate-0'"
    />
  </button>
</template>
