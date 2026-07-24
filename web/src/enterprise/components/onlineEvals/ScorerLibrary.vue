<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <div class="flex h-full min-h-0 flex-col p-4" data-test="scorer-library">
    <div
      v-if="isLoadingCatalog"
      class="flex flex-1 flex-col items-center justify-center p-8"
      data-test="scorer-library-loading"
    >
      <OSpinner size="lg" />
    </div>

    <div
      v-else-if="loadError"
      class="text-text-secondary flex flex-1 flex-col items-center justify-center p-8"
      data-test="scorer-library-error"
    >
      <OIcon name="error-outline" class="mb-2" style="width: 3em; height: 3em" />
      <div class="text-status-error-text">{{ loadError }}</div>
      <OButton variant="primary" size="sm" class="mt-4" @click="loadCatalog">
        {{ t("common.retry") }}
      </OButton>
    </div>

    <div
      v-else-if="providers.length === 0"
      class="text-text-secondary flex flex-1 flex-col items-center justify-center p-8"
      data-test="scorer-library-no-providers"
    >
      {{ t("onlineEvals.scorerLibrary.noProvidersMessage") }}
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="mb-4 flex items-end gap-3">
        <div class="flex w-60 shrink-0 items-center gap-2">
          <label class="text-text-secondary text-xs font-semibold whitespace-nowrap">{{
            t("onlineEvals.scorer.providerLabel")
          }}</label>
          <OSelect
            v-model="selectedProviderId"
            :options="providerOptions"
            :placeholder="t('onlineEvals.scorer.providerPlaceholder')"
            size="md"
            class="w-full"
            data-test="scorer-library-provider-select"
          />
        </div>
        <OSearchInput
          v-model="searchQuery"
          :placeholder="t('onlineEvals.scorerLibrary.searchPlaceholder')"
          clearable
          class="min-w-0 flex-1"
          data-test="scorer-library-search"
        />
      </div>

      <div class="mb-2 flex items-center justify-between gap-3 pr-3 pl-4.25">
        <label
          v-if="filteredEntries.length > 0"
          class="text-text-secondary inline-flex items-center gap-2 px-1 py-0.5 text-xs font-medium select-none"
          data-test="scorer-library-select-all"
        >
          <OCheckbox :model-value="allVisibleSelected" @update:model-value="toggleSelectAll" />
          <span>{{ allVisibleSelected ? "Clear all" : "Select all" }}</span>
        </label>
        <span class="text-text-secondary text-xs">
          {{ filteredEntries.length }} {{ t("onlineEvals.scorerLibrary.scorerCountSuffix") }}
        </span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <section
          v-for="group in groupedEntries"
          :key="group.category"
          class="mt-4 first:mt-0"
          :data-test="`scorer-library-section-${group.category}`"
        >
          <h4
            class="text-text-heading m-0 mb-1.5 flex items-baseline gap-1.5 text-xs font-bold tracking-[0.04em] uppercase"
          >
            <span>{{ group.category }}</span>
            <span class="text-text-secondary font-medium">({{ group.entries.length }})</span>
          </h4>
          <ul class="rounded-default border-border-default flex flex-col border">
            <li
              v-for="entry in group.entries"
              :key="entry.name"
              class="flex cursor-pointer items-center gap-2 border-l-4 px-3 py-2 transition-colors duration-200"
              :class="[
                isSelected(entry.name)
                  ? 'selected-item border-primary bg-[color-mix(in_srgb,var(--color-primary-600)_6%,transparent)]'
                  : 'hover:bg-table-row-hover-bg border-transparent',
              ]"
              :data-test="`scorer-library-item-${entry.name}`"
              @click="toggle(entry)"
            >
              <div class="shrink-0 pr-2">
                <OCheckbox
                  :model-value="isSelected(entry.name)"
                  @update:model-value="toggle(entry)"
                  @click.stop
                />
              </div>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-sm font-medium">{{ entry.displayName }}</span>
                <span v-if="entry.description" class="text-text-secondary block text-xs">
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
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type Provider,
  type ScoreConfig,
} from "@/services/online-evals.service";
import {
  fetchOnlineEvalsCatalog,
  type CatalogScoreConfig,
  type CatalogScorer,
} from "@/services/online-evals-catalog.service";
import { entityId } from "./utils/evalEntity";
import { showError } from "./utils/evalFormat";

const { t } = useI18n();

const props = defineProps<{
  orgId: string;
  scoreConfigs: ScoreConfig[];
  scorers: Array<{ name: string }>;
  providers: Provider[];
}>();

const emit = defineEmits<{
  (e: "update:selected-count", value: number): void;
  (e: "imported"): void;
}>();

const isLoadingCatalog = ref(false);
const loadError = ref("");
const scoreConfigEntries = ref<CatalogScoreConfig[]>([]);
const scorerEntries = ref<CatalogScorer[]>([]);
const selectedNames = ref<Set<string>>(new Set());
const searchQuery = ref("");
const isImporting = ref(false);
const selectedProviderId = ref("");

const providerOptions = computed(() =>
  props.providers.map((p) => ({ label: p.name, value: p.id })),
);

onMounted(loadCatalog);

// Default the provider once the catalog loads (or props change).
watch(
  () => props.providers,
  (rows) => {
    if (!selectedProviderId.value && rows.length > 0) {
      selectedProviderId.value = rows[0].id;
    }
  },
  { immediate: true },
);

async function loadCatalog() {
  isLoadingCatalog.value = true;
  loadError.value = "";
  try {
    const catalog = await fetchOnlineEvalsCatalog();
    scoreConfigEntries.value = catalog.scoreConfigs.filter((e) => e.level === "span");
    scorerEntries.value = catalog.scorers.filter((e) => e.level === "span");
  } catch (err: any) {
    loadError.value = err?.message || "Failed to load catalog";
  } finally {
    isLoadingCatalog.value = false;
  }
}

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return scorerEntries.value;
  return scorerEntries.value.filter(
    (e) =>
      e.displayName.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.description ?? "").toLowerCase().includes(q),
  );
});

const groupedEntries = computed(() => {
  const buckets = new Map<string, CatalogScorer[]>();
  for (const entry of filteredEntries.value) {
    const list = buckets.get(entry.category) ?? [];
    list.push(entry);
    buckets.set(entry.category, list);
  }
  return Array.from(buckets.entries()).map(([category, entries]) => ({ category, entries }));
});

const allVisibleSelected = computed(() => {
  const visible = filteredEntries.value;
  if (visible.length === 0) return false;
  return visible.every((e) => selectedNames.value.has(e.name));
});

function isSelected(name: string) {
  return selectedNames.value.has(name);
}

function toggle(entry: CatalogScorer) {
  const next = new Set(selectedNames.value);
  if (next.has(entry.name)) next.delete(entry.name);
  else next.add(entry.name);
  selectedNames.value = next;
}

function toggleSelectAll() {
  const next = new Set(selectedNames.value);
  if (allVisibleSelected.value) {
    for (const e of filteredEntries.value) next.delete(e.name);
  } else {
    for (const e of filteredEntries.value) next.add(e.name);
  }
  selectedNames.value = next;
}

watch(selectedNames, (val) => emit("update:selected-count", val.size), {
  deep: true,
  immediate: true,
});

async function importSelected() {
  if (isImporting.value || selectedNames.value.size === 0) return;
  if (!selectedProviderId.value) {
    toast({ variant: "warning", message: "Select a provider before importing scorers." });
    return;
  }
  isImporting.value = true;

  const selected = scorerEntries.value.filter((e) => selectedNames.value.has(e.name));
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const entry of selected) {
    try {
      const scoreConfig = await resolveRequiredScoreConfig(entry.requiredScoreConfigName);
      await onlineEvalsService.scorers.create(
        props.orgId,
        scorerPayload(entry, entityId(scoreConfig)),
      );
      successCount++;
    } catch (err: any) {
      if (err?.response?.status === 409) {
        skipCount++;
        continue;
      }
      failCount++;
      if (failCount === 1) showError(err, "Failed to import scorer");
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

// Match the existing OnlineEvalsCatalog logic: if the scorer references a
// score config that doesn't exist locally, create it from the catalog first.
async function resolveRequiredScoreConfig(name: string): Promise<ScoreConfig> {
  const existing = findScoreConfigByName(name);
  if (existing) return existing;

  const catalogEntry = scoreConfigEntries.value.find((e) => e.name === name);
  if (!catalogEntry) throw new Error(`Catalog score config not found: ${name}`);

  try {
    return await onlineEvalsService.scoreConfigs.create(
      props.orgId,
      scoreConfigPayload(catalogEntry),
    );
  } catch (err: any) {
    if (err?.response?.status === 409) {
      const refreshed = await onlineEvalsService.scoreConfigs.list(props.orgId);
      const found = refreshed.find((row) => row.name === name);
      if (found) return found;
    }
    throw err;
  }
}

function findScoreConfigByName(name: string): ScoreConfig | null {
  return props.scoreConfigs.find((row) => row.name === name) ?? null;
}

function scoreConfigPayload(entry: CatalogScoreConfig) {
  const payload: Record<string, any> = { name: entry.name, dataType: entry.dataType };
  if (entry.description) payload.description = entry.description;
  if (entry.numericRange !== undefined) payload.numericRange = entry.numericRange;
  if (entry.categories !== undefined) payload.categories = entry.categories;
  return payload;
}

function scorerPayload(entry: CatalogScorer, scoreConfigId: string) {
  return {
    name: entry.name,
    description: entry.description,
    scorer: {
      type: entry.scorer.type,
      producesScoreConfigId: scoreConfigId,
      template: entry.scorer.template,
      params: {
        ...entry.scorer.params,
        provider_id: selectedProviderId.value,
      },
    },
  };
}

defineExpose({ importSelected });
</script>
