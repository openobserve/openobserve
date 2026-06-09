<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <div class="sc-library" data-test="score-config-library">
    <div
      v-if="isLoadingCatalog"
      class="sc-library__center"
      data-test="score-config-library-loading"
    >
      <OSpinner size="lg" />
    </div>

    <div
      v-else-if="loadError"
      class="sc-library__center sc-library__error"
      data-test="score-config-library-error"
    >
      <OIcon name="error-outline" class="tw:mb-2" style="width: 3em; height: 3em" />
      <div class="tw:text-red-500">{{ loadError }}</div>
      <OButton variant="primary" size="sm" class="tw:mt-4" @click="loadCatalog">
        Retry
      </OButton>
    </div>

    <div v-else class="sc-library__content">
      <OSearchInput
        v-model="searchQuery"
        placeholder="Search Score Configs..."
        clearable
        class="tw:mb-4"
        data-test="score-config-library-search"
      />

      <div class="sc-library__toolbar tw:mb-2 tw:pl-[17px] tw:pr-3">
        <label
          v-if="filteredEntries.length > 0"
          class="sc-library__select-all"
          data-test="score-config-library-select-all"
        >
          <OCheckbox
            :model-value="allVisibleSelected"
            @update:model-value="toggleSelectAll"
          />
          <span>{{ allVisibleSelected ? "Clear all" : "Select all" }}</span>
        </label>
        <span class="tw:text-xs tw:text-gray-500">
          {{ filteredEntries.length }} score config(s)
        </span>
      </div>

      <div class="sc-library__list">
        <section
          v-for="group in groupedEntries"
          :key="group.dataType"
          class="sc-library__section"
          :data-test="`score-config-library-section-${group.dataType}`"
        >
          <h4 class="sc-library__section-title">
            <span class="sc-library__section-name">{{ group.label }}</span>
            <span class="sc-library__section-count">({{ group.entries.length }})</span>
          </h4>
          <ul
            class="sc-library__group-list tw:flex tw:flex-col tw:rounded tw:border tw:border-border"
          >
            <li
              v-for="entry in group.entries"
              :key="entry.name"
              class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:cursor-pointer tw:transition-colors tw:duration-200 tw:border-l-4"
              :class="[
                isSelected(entry.name)
                  ? 'selected-item tw:bg-primary/5 tw:border-primary'
                  : 'tw:border-transparent hover:tw:bg-gray-50',
              ]"
              :data-test="`score-config-library-item-${entry.name}`"
              @click="toggle(entry)"
            >
              <div class="tw:shrink-0 tw:pr-2">
                <OCheckbox
                  :model-value="isSelected(entry.name)"
                  @update:model-value="toggle(entry)"
                  @click.stop
                />
              </div>
              <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                <span class="tw:text-sm tw:font-medium">{{ entry.displayName }}</span>
                <span
                  v-if="entry.description"
                  class="tw:block tw:text-xs tw:text-muted-foreground"
                >
                  {{ entry.description }}
                </span>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService from "@/services/online-evals.service";
import {
  fetchOnlineEvalsCatalog,
  type CatalogScoreConfig,
} from "@/services/online-evals-catalog.service";
import { showError } from "./utils/evalFormat";

const props = defineProps<{
  orgId: string;
}>();

const emit = defineEmits<{
  (e: "update:selected-count", value: number): void;
  (e: "imported"): void;
}>();

const isLoadingCatalog = ref(false);
const loadError = ref("");
const entries = ref<CatalogScoreConfig[]>([]);
const selectedNames = ref<Set<string>>(new Set());
const searchQuery = ref("");
const isImporting = ref(false);

onMounted(loadCatalog);

async function loadCatalog() {
  isLoadingCatalog.value = true;
  loadError.value = "";
  try {
    const catalog = await fetchOnlineEvalsCatalog();
    entries.value = catalog.scoreConfigs.filter((entry) => entry.level === "span");
  } catch (err: any) {
    loadError.value = err?.message || "Failed to load catalog";
  } finally {
    isLoadingCatalog.value = false;
  }
}

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return entries.value;
  return entries.value.filter(
    (e) =>
      e.displayName.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.description ?? "").toLowerCase().includes(q),
  );
});

const DATA_TYPE_ORDER = ["numeric", "categorical", "boolean"] as const;
const DATA_TYPE_LABELS: Record<string, string> = {
  numeric: "Numeric",
  categorical: "Categorical",
  boolean: "Boolean",
};

const groupedEntries = computed(() => {
  const buckets = new Map<string, CatalogScoreConfig[]>();
  for (const entry of filteredEntries.value) {
    const key = String(entry.dataType);
    const list = buckets.get(key) ?? [];
    list.push(entry);
    buckets.set(key, list);
  }
  // Preserve canonical ordering; append any unknown dataTypes at the end.
  const ordered: string[] = [];
  for (const k of DATA_TYPE_ORDER) if (buckets.has(k)) ordered.push(k);
  for (const k of buckets.keys()) if (!ordered.includes(k)) ordered.push(k);
  return ordered.map((dataType) => ({
    dataType,
    label: DATA_TYPE_LABELS[dataType] ?? dataType,
    entries: buckets.get(dataType) ?? [],
  }));
});

const allVisibleSelected = computed(() => {
  const visible = filteredEntries.value;
  if (visible.length === 0) return false;
  return visible.every((e) => selectedNames.value.has(e.name));
});

function toggleSelectAll() {
  const next = new Set(selectedNames.value);
  if (allVisibleSelected.value) {
    for (const e of filteredEntries.value) next.delete(e.name);
  } else {
    for (const e of filteredEntries.value) next.add(e.name);
  }
  selectedNames.value = next;
}

function isSelected(name: string) {
  return selectedNames.value.has(name);
}

function toggle(entry: CatalogScoreConfig) {
  const next = new Set(selectedNames.value);
  if (next.has(entry.name)) next.delete(entry.name);
  else next.add(entry.name);
  selectedNames.value = next;
}

watch(
  selectedNames,
  (val) => emit("update:selected-count", val.size),
  { deep: true, immediate: true },
);

async function importSelected() {
  if (isImporting.value || selectedNames.value.size === 0) return;
  isImporting.value = true;

  const selected = entries.value.filter((e) => selectedNames.value.has(e.name));
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const entry of selected) {
    try {
      await onlineEvalsService.scoreConfigs.create(props.orgId, payloadFor(entry));
      successCount++;
    } catch (err: any) {
      // Duplicates are not a hard failure — user explicitly asked for the
      // library to allow re-clicking already-imported items.
      if (err?.response?.status === 409) {
        skipCount++;
        continue;
      }
      failCount++;
      // Surface only the first hard error; subsequent failures keep counting.
      if (failCount === 1) showError(err, "Failed to import score config");
    }
  }

  isImporting.value = false;
  selectedNames.value = new Set();
  emit("imported");

  if (successCount > 0 || skipCount > 0) {
    const parts: string[] = [];
    if (successCount) parts.push(`${successCount} imported`);
    if (skipCount) parts.push(`${skipCount} skipped (already exists)`);
    if (failCount) parts.push(`${failCount} failed`);
    toast({
      variant: failCount > 0 && successCount === 0 ? "error" : "success",
      message: parts.join(" · "),
    });
  }
}

function payloadFor(entry: CatalogScoreConfig) {
  const payload: Record<string, any> = {
    name: entry.name,
    dataType: entry.dataType,
  };
  if (entry.description) payload.description = entry.description;
  if (entry.numericRange !== undefined) payload.numericRange = entry.numericRange;
  if (entry.categories !== undefined) payload.categories = entry.categories;
  return payload;
}

defineExpose({ importSelected });
</script>

<style lang="scss" scoped>
.sc-library {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  min-height: 0;
}

.sc-library__content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.sc-library__list {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.sc-library__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 32px;
}

.sc-library__error {
  color: var(--o2-text-muted);
}

.sc-library__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sc-library__select-all {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--o2-text);
  user-select: none;
}

.sc-library__section + .sc-library__section {
  margin-top: 16px;
}

.sc-library__section-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--o2-text);
}

.sc-library__section-name {
  color: var(--o2-text);
}

.sc-library__section-count {
  font-weight: 500;
  color: var(--o2-text-muted);
}

.selected-item {
  background: color-mix(in srgb, var(--o2-brand) 6%, transparent);
}
</style>
