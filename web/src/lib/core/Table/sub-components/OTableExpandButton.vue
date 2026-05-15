<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
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
    class="tw:inline-flex tw:items-center tw:justify-center tw:size-6 tw:rounded tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-text-secondary tw:hover:bg-button-ghost-hover-bg tw:transition-colors"
    @click.stop="$emit('toggle')"
  >
    <q-icon
      :name="expanded ? 'expand_less' : 'expand_more'"
      size="1rem"
    />
  </button>
</template>
