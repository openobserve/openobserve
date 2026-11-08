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
// the one whose key === `selectedKey` shows as active, and clicking emits
// `select` with the item key.
//
// It always occupies its space (fixed tile height + skeleton while `loading`) so
// data arriving never shifts the layout below it.

import { computed, ref, watch } from "vue";

import OStatCard from "./OStatCard.vue";
import type { StatItem } from "./OStatStrip.types";

const props = withDefaults(
  defineProps<{
    items?: StatItem[];
    loading?: boolean;
    /** Make the tiles clickable filter toggles. */
    selectable?: boolean;
    /** Tray look, on by default for `selectable`; opt out when nothing below the strip joins it. */
    tray?: boolean;
    /** Key of the currently-selected tile. */
    selectedKey?: string | null;
    /**
     * Tile that reads as active when nothing is filtered — the "All"/"Total"
     * one. Without it the strip shows no tile selected while the list behind it
     * shows everything, which is a state the control cannot express, and the
     * reset tile is a button that never looks pressed.
     */
    defaultKey?: string | null;
    /**
     * Narrows the tile width for strips of short-labelled tiles (filter counts,
     * buckets), so five to seven fit one row. Leave off for long labels.
     */
    compact?: boolean;
    /** Default for every item's `compactValue` (an item's own setting wins). */
    compactValues?: boolean;
  }>(),
  {
    items: () => [],
    loading: false,
    selectable: false,
    tray: undefined,
    selectedKey: null,
    defaultKey: null,
    compact: false,
    compactValues: false,
  },
);

const trayed = computed(() => props.tray ?? props.selectable);

const emit = defineEmits<{ select: [key: string] }>();

// Only the FIRST load blanks the values: a refresh keeps the last numbers rather than flickering every tile.
const settled = ref(false);
watch(
  () => props.loading,
  (loading, wasLoading) => {
    if (wasLoading && !loading) settled.value = true;
  },
);
const showSkeleton = computed(() => props.loading && !settled.value);

// Callers spell "no filter" as null, "all", or a key they never render — all three mean the default tile.
const activeKey = computed(() => {
  if (!props.selectable) return null;
  const named = props.items.some((item) => item.key === props.selectedKey);
  return named ? props.selectedKey : props.defaultKey;
});

const onCardClick = (item: StatItem) => {
  if (props.selectable && item.selectable !== false) emit("select", item.key);
};
</script>

<template>
  <div
    class="flex"
    :class="
      trayed
        ? 'bg-surface-subtle px-page-edge relative gap-1 overflow-x-auto overflow-y-hidden pt-2'
        : 'flex-wrap gap-2 max-lg:gap-1.5'
    "
    data-test="o-stat-strip"
  >
    <!-- Drawn here, not as a border, so the lifted tile can paint over it and join the table. -->
    <div
      v-if="trayed"
      class="bg-border-default pointer-events-none absolute inset-x-0 bottom-0 h-px"
      aria-hidden="true"
    />
    <!-- Non-tray: the basis is the wrap threshold and tiles grow to fill the strip. Tray: tiles keep content width. -->
    <OStatCard
      v-for="item in items"
      :key="item.key"
      :class="
        trayed
          ? ['max-w-56 shrink grow-0 basis-auto', compact ? 'min-w-32' : 'min-w-40']
          : ['grow max-lg:shrink-0 max-lg:basis-auto', compact ? 'basis-36' : 'basis-52']
      "
      :label="item.label"
      :value="item.value"
      :sub="item.sub"
      :sub-icon="item.subIcon"
      :sub-tooltip="item.subTooltip"
      :icon="item.icon"
      :tone="item.tone"
      :trend="item.trend"
      :max="item.max"
      :loading="showSkeleton"
      :compact-value="item.compactValue ?? compactValues"
      :clickable="selectable && item.selectable !== false"
      :tray="trayed"
      :selected="item.selectable !== false && activeKey === item.key"
      :data-test="item.dataTest"
      @click="onCardClick(item)"
    />
    <slot />
  </div>
</template>
