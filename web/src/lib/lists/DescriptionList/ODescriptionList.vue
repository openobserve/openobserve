<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, provide } from "vue";
import { raw } from "@/types/i18n";
import ODescriptionItem from "./ODescriptionItem.vue";
import {
  DESCRIPTION_CONTEXT,
  type DescriptionListProps,
  type DescriptionListSlots,
} from "./ODescriptionList.types";

const props = withDefaults(defineProps<DescriptionListProps>(), {
  items: undefined,
  labels: "text",
  layout: "auto",
  emptyLabel: () => raw("—"),
});

defineSlots<DescriptionListSlots>();

provide(
  DESCRIPTION_CONTEXT,
  computed(() => ({ labels: props.labels, emptyLabel: props.emptyLabel })),
);

const LAYOUT_CLASSES: Record<NonNullable<DescriptionListProps["layout"]>, string> = {
  columns: "grid-cols-[10rem_minmax(0,1fr)] gap-y-1.5",
  stacked: "grid-cols-1 gap-y-2",
  auto: "grid-cols-[10rem_minmax(0,1fr)] gap-y-1.5 @max-[30rem]/dl:grid-cols-1 @max-[30rem]/dl:gap-y-2",
};
</script>

<template>
  <div class="@container/dl min-w-0">
    <dl
      :class="['m-0 grid gap-x-4', LAYOUT_CLASSES[layout]]"
      :data-layout="layout"
      data-test="o2-description-list"
    >
      <template v-if="items">
        <ODescriptionItem
          v-for="(item, i) in items"
          :key="i"
          :label="item.label"
          :value="item.value"
          :mono="item.mono"
          :copy="item.copy"
        />
      </template>
      <slot v-else />
    </dl>
  </div>
</template>
