<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OStatStrip: a row of OStatCards, from `items` or composed in the default slot. With
// `selectable` the tiles filter the list below (F7); selection is a border, never a fill (C6).

import { computed, ref, watch } from "vue";

import { useI18nTyped, type I18nText } from "@/types/i18n";
import OStatCard from "./OStatCard.vue";
import type {
  OStatStripEmits,
  OStatStripProps,
  OStatStripSlots,
  StatItem,
} from "./OStatStrip.types";

const props = withDefaults(defineProps<OStatStripProps>(), {
  items: () => [],
  loading: false,
  selectable: false,
  selectedKey: null,
  multiple: false,
  selectedKeys: () => [],
  size: "md",
  stacked: false,
  resetKey: undefined,
  compactValues: false,
});

const emit = defineEmits<OStatStripEmits>();
defineSlots<OStatStripSlots>();

const { t } = useI18nTyped();

// Only the first load blanks the values; a refresh keeps the last numbers instead of flickering.
const settled = ref(false);
watch(
  () => props.loading,
  (loading, wasLoading) => {
    if (wasLoading && !loading) settled.value = true;
  },
);
watch(
  () => props.resetKey,
  () => {
    settled.value = false;
  },
);

const isAll = (item: StatItem) => item.all === true || item.key === "all";
// An All tile with nothing to reset to would be a button that does nothing, so such a strip stays display-only.
const filters = computed(() =>
  props.selectable ? props.items.filter((item) => item.selectable !== false) : [],
);
const hasRealFilter = computed(() => filters.value.some((item) => !isAll(item)));
const isFilter = (item: StatItem) => hasRealFilter.value && item.selectable !== false;

const pickedKeys = computed(() =>
  props.selectedKeys.filter((key) =>
    filters.value.some((item) => item.key === key && !isAll(item)),
  ),
);

const isSelected = (item: StatItem) => {
  if (!isFilter(item) || isAll(item)) return false;
  return props.multiple ? pickedKeys.value.includes(item.key) : props.selectedKey === item.key;
};

const hasSelection = computed(() =>
  props.multiple ? pickedKeys.value.length > 0 : props.items.some(isSelected),
);

const hint = (item: StatItem): I18nText | undefined => {
  if (!isFilter(item) || isAll(item)) return undefined;
  const label = item.label;
  if (props.multiple && pickedKeys.value.includes(item.key))
    return t("components.statStrip.stopShowing", { label });
  if (props.multiple && pickedKeys.value.length)
    return t("components.statStrip.alsoShow", { label });
  return isSelected(item) ? undefined : t("components.statStrip.showOnly", { label });
};

const select = (key: string | null) => {
  emit("update:selectedKey", key);
  emit("select", key);
};

const onTileClick = (item: StatItem) => {
  if (!isFilter(item)) return;
  if (!props.multiple) {
    select(isAll(item) || props.selectedKey === item.key ? null : item.key);
    return;
  }
  const picked = pickedKeys.value;
  let next: string[] = [];
  if (!isAll(item))
    next = picked.includes(item.key)
      ? picked.filter((key) => key !== item.key)
      : [...picked, item.key];
  emit("update:selectedKeys", next);
  emit("select", isAll(item) ? null : item.key);
};

const clear = () => {
  if (!hasSelection.value) return;
  if (props.multiple) emit("update:selectedKeys", []);
  else select(null);
};
</script>

<template>
  <!-- min-w-max outranks max-w-60, so a tile never cuts its label; past the strip's width tiles wrap. -->
  <div
    class="flex min-w-0 flex-wrap gap-2 overflow-x-auto *:max-w-60 *:min-w-max *:flex-1 *:basis-0 max-sm:overflow-x-visible max-sm:*:max-w-none max-sm:*:min-w-0 max-sm:*:basis-[calc(50%-0.25rem)]"
    :role="hasRealFilter ? 'group' : undefined"
    :aria-label="hasRealFilter ? t('components.statStrip.filters') : undefined"
    data-test="o-stat-strip"
    @keydown.esc="clear"
  >
    <OStatCard
      v-for="item in items"
      :key="item.key"
      :label="item.label"
      :value="item.value"
      :sub="item.sub"
      :sub-icon="item.subIcon"
      :sub-tooltip="item.subTooltip"
      :icon="item.icon"
      :tone="item.tone"
      :delta="item.delta"
      :max="item.max"
      :size="size"
      :stacked="stacked"
      :loading="loading && !settled"
      :compact-value="item.compactValue ?? compactValues"
      :clickable="isFilter(item)"
      :selected="isSelected(item)"
      :hint="hint(item)"
      :data-test="item.dataTest"
      @click="onTileClick(item)"
    />
    <slot />
  </div>
</template>
