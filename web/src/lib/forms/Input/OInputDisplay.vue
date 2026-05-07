<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { InputDisplayProps, InputDisplaySlots } from "./OInput.types";
import { computed } from "vue";

const props = withDefaults(defineProps<InputDisplayProps>(), {
  size: "md",
  disabled: false,
});

defineSlots<InputDisplaySlots>();

const heightClasses: Record<NonNullable<InputDisplayProps["size"]>, string> = {
  sm: "tw:min-h-8 tw:text-sm",
  md: "tw:min-h-10 tw:text-sm",
};

const rootStyle = computed(() => ({
  width:
    props.width === undefined
      ? "100%"
      : typeof props.width === "number"
        ? `${props.width}px`
        : props.width,
}));
</script>

<template>
  <div :style="rootStyle" class="tw:flex tw:flex-col tw:gap-1">
    <span
      v-if="label"
      class="tw:text-xs tw:font-medium tw:text-input-label tw:leading-none"
    >
      {{ label }}
    </span>

    <div
      :class="[
        'tw:flex tw:items-center tw:w-full tw:rounded-md tw:border',
        'tw:bg-input-bg tw:border-input-border',
        'tw:px-3',
        heightClasses[size ?? 'md'],
        disabled
          ? 'tw:bg-input-disabled-bg tw:border-input-disabled-border tw:opacity-60 tw:cursor-not-allowed'
          : '',
      ]"
    >
      <span
        v-if="$slots.default"
        class="tw:flex-1 tw:min-w-0 tw:text-input-text"
      >
        <slot />
      </span>
      <span
        v-else-if="placeholder"
        class="tw:flex-1 tw:text-input-placeholder tw:select-none"
      >
        {{ placeholder }}
      </span>
    </div>
  </div>
</template>
