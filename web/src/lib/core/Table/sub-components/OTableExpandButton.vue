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
    class="tw:inline-flex tw:items-center tw:justify-center tw:size-6 tw:rounded tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-secondary tw:hover:bg-button-ghost-hover-bg tw:transition-colors"
    @click.stop="$emit('toggle')"
  >
    <OIcon
      name="chevron-right"
      size="sm"
      class="tw:transition-transform tw:duration-200"
      :class="expanded ? 'tw:rotate-90' : 'tw:rotate-0'"
    />
  </button>
</template>
