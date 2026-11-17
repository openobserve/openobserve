<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// One label/value pair. Wrapped in a <div> rather than emitting a bare
// <dt>+<dd> pair: HTML allows a <div> to group a dt/dd inside a <dl>, and it is
// what lets the parent lay out PAIRS on its grid instead of laying out the dt
// and the dd as two independent cells that can land in different columns.

import { computed, inject } from "vue";
import { raw } from "@/types/i18n";
import {
  DESCRIPTION_LABEL_WIDTH,
  type DescriptionItemProps,
  type DescriptionItemSlots,
} from "./ODescriptionList.types";

const props = withDefaults(defineProps<DescriptionItemProps>(), {
  emptyLabel: () => raw("—"),
  stacked: false,
});

defineSlots<DescriptionItemSlots>();

const labelWidth = inject(DESCRIPTION_LABEL_WIDTH, null);

const rowClass = computed(() => {
  if (props.stacked) return "flex flex-col gap-0.5";
  const columns = labelWidth?.value === "narrow" ? "grid-cols-[7rem_1fr]" : "grid-cols-[10rem_1fr]";
  return `grid ${columns} items-baseline gap-x-3`;
});
</script>

<template>
  <div :class="rowClass" data-test="o2-description-item">
    <dt class="text-text-secondary min-w-0 text-xs">
      <slot name="label">{{ label }}</slot>
    </dt>
    <dd class="text-text-body m-0 min-w-0 text-sm break-words">
      <slot>{{ emptyLabel }}</slot>
    </dd>
  </div>
</template>
