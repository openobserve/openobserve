<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OStatStrip — the responsive row that lays out OStatCards. Two ways to use it:
//
//   1. Data-driven (simple counts): pass `items`.
//        <OStatStrip :items="stats" :loading="loading" />
//   2. Composed (custom tiles, charts, etc.): use the default slot with
//      <OStatCard> children.
//
// Set `selectable` to turn the tiles into filter toggles: each becomes a button,
// the one whose key === `selectedKey` shows the active ring, and clicking emits
// `select` with the item key.
//
// It always occupies its space (fixed tile height + skeleton while `loading`) so
// data arriving never shifts the layout below it.

import OStatCard from "./OStatCard.vue";
import type { StatItem } from "./OStatStrip.types";

const props = withDefaults(
  defineProps<{
    items?: StatItem[];
    loading?: boolean;
    /** Make the tiles clickable filter toggles. */
    selectable?: boolean;
    /** Key of the currently-selected tile (draws the ring). */
    selectedKey?: string | null;
  }>(),
  { items: () => [], loading: false, selectable: false, selectedKey: null },
);

const emit = defineEmits<{ select: [key: string] }>();

const onCardClick = (item: StatItem) => {
  if (props.selectable && item.selectable !== false) emit("select", item.key);
};
</script>

<template>
  <div class="flex flex-wrap gap-2" data-test="o-stat-strip">
    <OStatCard
      v-for="item in items"
      :key="item.key"
      class="grow basis-40"
      :label="item.label"
      :value="item.value"
      :icon="item.icon"
      :tone="item.tone"
      :trend="item.trend"
      :max="item.max"
      :clickable="selectable && item.selectable !== false"
      :selected="selectable && item.selectable !== false && selectedKey === item.key"
      :data-test="item.dataTest"
      @click="onCardClick(item)"
    />
    <slot />
  </div>
</template>
