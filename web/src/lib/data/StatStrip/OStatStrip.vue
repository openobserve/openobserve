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
// Set `selectable` to turn the items into filter chips: the one whose key ===
// `selectedKey` shows as active, clicking emits `select` with the item key, and
// Esc emits `select(defaultKey)`, or the active key when there is no default.
// Items with `selectable: false` read as flat KPIs ahead of the chips.
// With `multiple`, chips toggle in and out of `v-model:selected-keys`; the default
// chip and Esc empty it, and an empty selection means unfiltered.
// `inline` renders a read-only strip as one flat KPI line for a toolbar; `row`
// gives it its own row above a table. Otherwise a read-only strip is cards.
//
// It always occupies its space (fixed height + skeleton while `loading`) so data
// arriving never shifts the layout below it.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import OStatCard from "./OStatCard.vue";
import type { StatItem } from "./OStatStrip.types";
import { useInlineFit } from "./useInlineFit";

const props = withDefaults(
  defineProps<{
    items?: StatItem[];
    loading?: boolean;
    /** Make the items clickable filter chips. */
    selectable?: boolean;
    /** `false` on a selectable strip renders clickable cards, for tiles that navigate rather than filter. */
    tray?: boolean;
    /** Render a read-only strip as one flat KPI line, for a toolbar row. */
    inline?: boolean;
    /** Own full-width row above a table: page-edge padding and the hairline on top of its header. On by default for filter chips. */
    row?: boolean;
    /** Key of the currently-selected tile. */
    selectedKey?: string | null;
    /** Chips toggle independently; the selection is `selectedKeys`, and none selected means unfiltered. */
    multiple?: boolean;
    /** The selected chips in `multiple` mode. */
    selectedKeys?: string[];
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
    /** What the numbers describe; a change shows the skeleton again on the next load instead of the old numbers. */
    resetKey?: string | number | null;
    /** Default for every item's `compactValue` (an item's own setting wins). */
    compactValues?: boolean;
    /** Puts each label under its value, for strips too narrow to fit them side by side. */
    stacked?: boolean;
  }>(),
  {
    items: () => [],
    loading: false,
    selectable: false,
    tray: undefined,
    inline: false,
    row: undefined,
    selectedKey: null,
    multiple: false,
    selectedKeys: () => [],
    defaultKey: null,
    compact: false,
    resetKey: undefined,
    compactValues: false,
  },
);

const emit = defineEmits<{ select: [key: string]; "update:selectedKeys": [keys: string[]] }>();

const { t } = useI18nTyped();

// Only the FIRST load blanks the values: a refresh keeps the last numbers rather than flickering every tile.
const settled = ref(false);
watch(
  () => props.loading,
  (loading, wasLoading) => {
    if (wasLoading && !loading) settled.value = true;
  },
);
// Opt-in: without a resetKey this never fires, so the latch behaves as before.
watch(
  () => props.resetKey,
  () => {
    settled.value = false;
  },
);
const showSkeleton = computed(() => props.loading && !settled.value);

// Callers spell "no filter" as null, "all", or a key they never render — all three mean the default tile.
const activeKey = computed(() => {
  if (!props.selectable) return null;
  const named = props.items.some((item) => item.key === props.selectedKey);
  return named ? props.selectedKey : props.defaultKey;
});

const chipStrip = computed(() => props.selectable && props.tray !== false);
// A reset chip with nothing to reset to is a button that does nothing, so such a strip reads as KPIs.
const hasRealFilter = computed(() =>
  props.items.some((item) => item.selectable !== false && item.key !== props.defaultKey),
);
const chipMode = computed(() => chipStrip.value && hasRealFilter.value);
const isRow = computed(() => props.row ?? chipStrip.value);

const kpiItems = computed(() =>
  chipMode.value ? props.items.filter((item) => item.selectable === false) : props.items,
);

// The reset chip leads; the rest keep the caller's order.
const chipItems = computed(() => {
  if (!chipMode.value) return [];
  const chips = props.items.filter((item) => item.selectable !== false);
  const total = chips.find((item) => item.key === props.defaultKey);
  return total ? [total, ...chips.filter((item) => item !== total)] : chips;
});

const flat = computed(
  () => chipStrip.value || (!props.selectable && (props.inline || isRow.value)),
);

const rootRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);

// What the strip needs to show every chip: the scroll box's padding only makes room for focus rings.
const naturalWidth = () => {
  const root = rootRef.value;
  if (!root) return 0;
  const kpis = root.querySelector<HTMLElement>('[data-test="o-stat-strip-kpis"]');
  const divider = root.querySelector<HTMLElement>('[data-test="o-stat-strip-group-divider"]');
  const dividerWidth = divider
    ? divider.getBoundingClientRect().width +
      (parseFloat(getComputedStyle(divider).marginInlineEnd) || 0)
    : 0;
  const chips = scrollRef.value ? scrollRef.value.scrollWidth - 8 : 0;
  return (kpis?.scrollWidth ?? 0) + dividerWidth + Math.max(chips, 0);
};

const inlineChips = computed(() => !isRow.value && chipStrip.value);
const fit = useInlineFit(rootRef, naturalWidth, () => inlineChips.value);

const rootClass = computed(() => {
  // In a toolbar the chips share the search row only while all of them fit; otherwise they take a full line below.
  if (!isRow.value) {
    if (!chipStrip.value) return "max-md:flex-wrap max-md:gap-y-1";
    const place = fit.ownLine.value
      ? "order-last basis-full"
      : "basis-auto max-md:order-last max-md:basis-full";
    return `shrink grow-0 gap-y-1.5 max-md:flex-wrap ${place}`;
  }
  // Filter rows keep the chip height whether or not chips show, so one appearing never shifts the table.
  const height = chipStrip.value ? "min-h-12 py-2" : "py-1.5";
  return `px-page-edge border-border-default gap-y-1.5 border-b max-md:flex-wrap ${height}`;
});

const pickedKeys = computed(() => props.selectedKeys.filter((key) => key !== props.defaultKey));

const isPressed = (item: StatItem) => {
  if (!props.multiple) return activeKey.value === item.key;
  return item.key === props.defaultKey
    ? pickedKeys.value.length === 0
    : pickedKeys.value.includes(item.key);
};

const canClear = computed(() => {
  if (!chipMode.value) return false;
  if (props.multiple) return pickedKeys.value.length > 0;
  return activeKey.value != null && activeKey.value !== props.defaultKey;
});

// The chips stay on one line: overflow scrolls under edge fades, like a tab strip, instead of wrapping.
const hasOverflow = ref(false);
const canScrollBack = ref(false);
const canScrollForward = ref(false);

const updateScrollState = () => {
  const el = scrollRef.value;
  if (!el) {
    hasOverflow.value = false;
    return;
  }
  // Writing direction makes scrollLeft negative in RTL, so compare magnitudes.
  const offset = Math.abs(el.scrollLeft);
  hasOverflow.value = el.scrollWidth > el.clientWidth + 1;
  canScrollBack.value = offset > 1;
  canScrollForward.value = offset + el.clientWidth < el.scrollWidth - 1;
};

const scrollChips = (direction: 1 | -1) => {
  const el = scrollRef.value;
  if (!el) return;
  const rtl = getComputedStyle(el).direction === "rtl" ? -1 : 1;
  el.scrollBy({ left: direction * rtl * el.clientWidth * 0.75, behavior: "smooth" });
};

const revealActiveChip = () => {
  const el = scrollRef.value;
  const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!el || !chip) return;
  const box = el.getBoundingClientRect();
  const rect = chip.getBoundingClientRect();
  if (rect.left < box.left) el.scrollBy({ left: rect.left - box.left - 8 });
  else if (rect.right > box.right) el.scrollBy({ left: rect.right - box.right + 8 });
};

// A vertical wheel over overflowing chips scrolls them, but only while they can still move that way.
const onWheel = (event: WheelEvent) => {
  const el = scrollRef.value;
  if (!el || !hasOverflow.value || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  if (event.deltaY < 0 ? !canScrollBack.value : !canScrollForward.value) return;
  event.preventDefault();
  const rtl = getComputedStyle(el).direction === "rtl" ? -1 : 1;
  el.scrollLeft += event.deltaY * rtl;
};

let resizeObserver: ResizeObserver | null = null;
const observe = (el: HTMLElement | null) => {
  resizeObserver?.disconnect();
  const kpis = rootRef.value?.querySelector('[data-test="o-stat-strip-kpis"]');
  fit.observe([el, kpis, ...(el ? Array.from(el.children) : [])]);
  if (!el) return;
  resizeObserver ??= new ResizeObserver(updateScrollState);
  resizeObserver.observe(el);
  for (const child of el.children) resizeObserver.observe(child);
};

onMounted(() => {
  if (typeof ResizeObserver === "undefined") return;
  observe(scrollRef.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

watch(
  () => [chipItems.value.length, kpiItems.value.length, scrollRef.value] as const,
  () =>
    nextTick(() => {
      if (typeof ResizeObserver !== "undefined") observe(scrollRef.value);
      updateScrollState();
      fit.schedule();
      revealActiveChip();
    }),
);
watch([activeKey, pickedKeys], () => nextTick(revealActiveChip));

const chipIcon = (item: StatItem) =>
  item.icon ?? (item.key === props.defaultKey ? ("apps" as const) : undefined);

// Only a multi-select strip needs to say "add" or "remove"; a single one keeps the card's "show only".
const chipHint = (item: StatItem) => {
  if (!props.multiple || item.key === props.defaultKey) return undefined;
  if (pickedKeys.value.includes(item.key))
    return t("components.statStrip.stopShowing", { label: item.label });
  return pickedKeys.value.length
    ? t("components.statStrip.alsoShow", { label: item.label })
    : undefined;
};

const onChipClick = (item: StatItem) => {
  emit("select", item.key);
  if (!props.multiple) return;
  if (item.key === props.defaultKey) emit("update:selectedKeys", []);
  else if (pickedKeys.value.includes(item.key))
    emit(
      "update:selectedKeys",
      pickedKeys.value.filter((key) => key !== item.key),
    );
  else emit("update:selectedKeys", [...pickedKeys.value, item.key]);
};

const onCardClick = (item: StatItem) => {
  if (props.selectable && item.selectable !== false) emit("select", item.key);
};

const clear = () => {
  if (!canClear.value) return;
  if (props.multiple) emit("update:selectedKeys", []);
  // Without a default, re-selecting the active chip is how every caller toggles its filter off.
  else emit("select", props.defaultKey ?? (activeKey.value as string));
};
</script>

<template>
  <div
    v-if="flat"
    ref="rootRef"
    class="flex min-w-0 items-center"
    :class="rootClass"
    data-test="o-stat-strip"
  >
    <div
      v-if="kpiItems.length"
      class="flex min-w-0 items-center max-md:flex-wrap max-md:gap-y-1"
      :class="chipItems.length ? 'max-md:w-full' : ''"
      data-test="o-stat-strip-kpis"
    >
      <template v-for="(item, index) in kpiItems" :key="item.key">
        <span
          v-if="index > 0"
          class="bg-border-default h-4 w-px shrink-0"
          aria-hidden="true"
          data-test="o-stat-strip-divider"
        />
        <OStatCard
          variant="kpi"
          :class="index === 0 ? 'pe-3.5' : 'px-3.5 max-md:px-2.5'"
          :label="item.label"
          :value="item.value"
          :sub="item.sub"
          :sub-icon="item.subIcon"
          :sub-tooltip="item.subTooltip"
          :icon="item.icon"
          :tone="item.tone"
          :trend="item.trend"
          :loading="showSkeleton"
          :compact-value="item.compactValue ?? compactValues"
          :data-test="item.dataTest"
        />
      </template>
    </div>
    <span
      v-if="kpiItems.length && chipItems.length"
      class="bg-border-default me-3.5 h-4 w-px shrink-0 max-md:hidden"
      aria-hidden="true"
      data-test="o-stat-strip-group-divider"
    />
    <div
      v-if="chipItems.length"
      class="relative flex min-w-0 flex-1 items-center"
      data-test="o-stat-strip-chip-row"
    >
      <!-- The padding keeps the chips' focus outline inside the scroll box, which clips both axes. -->
      <div
        ref="scrollRef"
        role="group"
        :aria-label="t('components.statStrip.filters')"
        class="-m-1 flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto overscroll-x-contain p-1 [&::-webkit-scrollbar]:hidden"
        data-test="o-stat-strip-chips"
        @scroll.passive="updateScrollState"
        @wheel="onWheel"
        @keydown.esc="clear"
      >
        <OStatCard
          v-for="item in chipItems"
          :key="item.key"
          variant="chip"
          clickable
          :label="item.label"
          :value="item.value"
          :icon="chipIcon(item)"
          :tone="item.tone"
          :loading="showSkeleton"
          :compact-value="item.compactValue ?? compactValues"
          :selected="isPressed(item)"
          :quiet="item.key === defaultKey"
          :hint="chipHint(item)"
          :data-test="item.dataTest"
          @click="onChipClick(item)"
        />
      </div>
      <!-- Overlays, so no chip moves; they reach past the row as far as the scroll box's
           focus-ring padding does, or a chip sliver shows beyond them. -->
      <div
        v-show="canScrollBack"
        class="bg-surface-base absolute inset-y-0 -start-1 flex items-center ps-1"
        data-test="o-stat-strip-fade-back"
      >
        <span
          class="bg-fade-surface-to-right rtl:bg-fade-surface-to-left pointer-events-none absolute inset-y-0 start-full w-8"
          aria-hidden="true"
        />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="chevron-left"
          class="enabled:hover:text-text-heading enabled:hover:bg-transparent! enabled:active:bg-transparent! rtl:rotate-180"
          tabindex="-1"
          :aria-label="t('components.statStrip.scrollBack')"
          data-test="o-stat-strip-scroll-back"
          @click="scrollChips(-1)"
        />
      </div>
      <div
        v-show="canScrollForward"
        class="bg-surface-base absolute inset-y-0 -end-1 flex items-center pe-1"
        data-test="o-stat-strip-fade-forward"
      >
        <span
          class="bg-fade-surface-to-left rtl:bg-fade-surface-to-right pointer-events-none absolute inset-y-0 end-full w-8"
          aria-hidden="true"
        />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="chevron-right"
          class="enabled:hover:text-text-heading enabled:hover:bg-transparent! enabled:active:bg-transparent! rtl:rotate-180"
          tabindex="-1"
          :aria-label="t('components.statStrip.scrollForward')"
          data-test="o-stat-strip-scroll-forward"
          @click="scrollChips(1)"
        />
      </div>
    </div>
    <slot />
  </div>
  <div v-else class="flex flex-wrap gap-2 max-lg:gap-1.5" data-test="o-stat-strip">
    <!-- The basis is the wrap threshold and tiles grow to fill the strip. -->
    <OStatCard
      v-for="item in items"
      :key="item.key"
      :class="['grow max-lg:shrink-0 max-lg:basis-auto', compact ? 'basis-36' : 'basis-52']"
      :stacked="stacked"
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
      :selected="item.selectable !== false && activeKey === item.key"
      :data-test="item.dataTest"
      @click="onCardClick(item)"
    />
    <slot />
  </div>
</template>
