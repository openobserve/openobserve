<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, useAttrs } from "vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { SelectHeaderRowEmits, SelectHeaderRowProps } from "./OSelectHeaderRow.types";

defineProps<SelectHeaderRowProps>();
const emit = defineEmits<SelectHeaderRowEmits>();

const attrs = useAttrs();
const actionDataTest = computed(() =>
  attrs["data-test"] ? `${String(attrs["data-test"])}-action` : undefined,
);
</script>

<template>
  <div
    :class="[
      'text-select-item-text flex h-full min-h-8 w-full items-center justify-between gap-2 ps-3 pe-1.5 text-xs select-none',
      highlighted ? 'bg-select-item-hover-bg' : 'bg-select-header-bg',
    ]"
    :data-highlighted="highlighted ? '' : undefined"
  >
    <span class="flex min-w-0 items-center gap-1">
      <OTruncatedText class="font-bold">{{ label }}</OTruncatedText>
      <span v-if="count" class="text-select-header-count-text shrink-0 whitespace-nowrap">
        <span aria-hidden="true">·</span>
        {{ count }}
      </span>
    </span>
    <!-- mousedown.prevent keeps focus in an open select's search input while the action runs. -->
    <button
      v-if="action"
      type="button"
      :aria-label="actionAriaLabel"
      :data-test="actionDataTest"
      data-select-header-action
      :class="[
        'rounded-default text-select-header-action-text hover:bg-select-header-action-hover-bg focus-visible:ring-select-header-action-focus-ring h-6 shrink-0 cursor-pointer border-0 px-2 text-xs font-medium transition-colors duration-100 outline-none focus-visible:ring-2',
        highlighted ? 'bg-select-header-action-hover-bg' : 'bg-transparent',
      ]"
      @mousedown.prevent
      @click.stop="emit('action', $event)"
    >
      {{ action }}
    </button>
  </div>
</template>
