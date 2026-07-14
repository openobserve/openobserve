<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <div
    class="flex flex-col h-full p-4 min-h-0"
    data-test="score-config-library"
  >
    <div
      v-if="isLoadingCatalog"
      class="flex flex-col items-center justify-center flex-1 p-8"
      data-test="score-config-library-loading"
    >
      <OSpinner size="lg" />
    </div>

    <div
      v-else-if="loadError"
      class="flex flex-col items-center justify-center flex-1 p-8 text-(--color-text-secondary)"
      data-test="score-config-library-error"
    >
      <OIcon name="error-outline" class="mb-2" style="width: 3em; height: 3em" />
      <div class="text-red-500">{{ loadError }}</div>
      <OButton variant="primary" size="sm" class="mt-4" @click="loadCatalog">
        Retry
      </OButton>
    </div>

    <div v-else class="flex flex-col min-h-0 flex-1">
      <OSearchInput
        v-model="searchQuery"
        placeholder="Search Score Configs..."
        clearable
        class="mb-4"
        data-test="score-config-library-search"
      />

      <div class="flex items-center justify-between gap-3 mb-2 pl-4.25 pr-3">
        <div
          v-if="filteredEntries.length > 0"
          class="inline-flex items-center gap-2 py-0.5 px-1 text-xs font-medium text-(--color-text-secondary) select-none"
          data-test="score-config-library-select-all"
        >
          <OCheckbox
            :model-value="allVisibleSelected"
            @update:model-value="toggleSelectAll"
          />
          <span class="cursor-pointer" @click="toggleSelectAll">{{ allVisibleSelected ? "Clear all" : "Select all" }}</span>
        </div>
        <span class="text-xs text-(--color-text-secondary)">
          {{ filteredEntries.length }} score config(s)
        </span>
      </div>

      <div class="overflow-y-auto flex-1 min-h-0 pb-4">
        <section
          v-for="(group, index) in groupedEntries"
          :key="group.dataType"
          :class="{ 'mt-4': index > 0 }"
          :data-test="`score-config-library-section-${group.dataType}`"
        >
          <div
            class="flex items-baseline gap-1.5 mt-0 mx-0 mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-(--color-text-heading)"
          >
            <span class="text-(--color-text-heading)">{{ group.label }}</span>
            <span class="font-medium text-(--color-text-secondary)">({{ group.entries.length }})</span>
          </div>
          <ul
            class="flex flex-col rounded border border-(--color-border-default)"
          >
            <li
              v-for="entry in group.entries"
              :key="entry.name"
              class="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-200 border-l-4"
              :class="[
                isSelected(entry.name)
                  ? 'bg-primary/5 border-primary'
                  : 'border-transparent',
              ]"
              :data-test="`score-config-library-item-${entry.name}`"
              @click="toggle(entry)"
            >
              <div class="shrink-0 pr-2">
                <OCheckbox
                  :model-value="isSelected(entry.name)"
                  @update:model-value="toggle(entry)"
                  @click.stop
                />
              </div>
              <div class="flex flex-col flex-1 min-w-0">
                <span class="text-sm font-medium">{{ entry.displayName }}</span>
                <span
                  v-if="entry.description"
                  class="block text-xs text-(--color-text-secondary)"
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

