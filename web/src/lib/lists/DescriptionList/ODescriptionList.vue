<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// ODescriptionList — the house label/value detail block. See the .types.ts for
// why this is a real <dl> and how it differs from OFieldList.

import { computed } from "vue";
import type { DescriptionListProps, DescriptionListSlots } from "./ODescriptionList.types";

const props = withDefaults(defineProps<DescriptionListProps>(), {
  columns: 1,
  dense: false,
});

defineSlots<DescriptionListSlots>();

// One column below md regardless of `columns`: a two-column label/value block on
// a narrow viewport wraps into a pile where no value is next to its own label.
const classes = computed(() => [
  "m-0 grid grid-cols-1",
  props.columns === 2 ? "md:grid-cols-2" : "",
  props.dense ? "gap-x-6 gap-y-1.5" : "gap-x-8 gap-y-3",
]);
</script>

<template>
  <dl :class="classes" data-test="o2-description-list">
    <slot />
  </dl>
</template>
