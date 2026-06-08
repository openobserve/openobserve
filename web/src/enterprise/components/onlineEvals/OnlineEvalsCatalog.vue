<template>
  <div class="eval-catalog" :data-test="`${kind}-catalog`">
    <div class="eval-catalog__header">
      <div>
        <p class="eval-catalog__eyebrow">Catalog</p>
        <h3>{{ title }}</h3>
        <p>{{ subtitle }}</p>
      </div>
      <div class="eval-catalog__actions">
        <OSelect
          v-if="kind === 'scorers' && providers.length > 0"
          v-model="selectedProviderId"
          :options="providerOptions"
          placeholder="Select provider"
          size="md"
          class="eval-catalog__provider"
          data-test="scorer-catalog-provider-select"
        />
        <OButton
          variant="secondary"
          size="sm"
          :disabled="isBusy || importableEntries.length === 0 || scorerImportBlocked"
          :data-test="`${kind}-catalog-import-all-btn`"
          @click="importAll"
        >
          Import all
        </OButton>
      </div>
    </div>

    <div v-if="loadError" class="eval-catalog__error">
      {{ loadError }}
      <OButton variant="ghost" size="sm" @click="loadCatalog">Retry</OButton>
    </div>

    <div v-else-if="isLoadingCatalog" class="eval-catalog__loading">Loading catalog...</div>

    <div v-else-if="kind === 'scorers' && providers.length === 0" class="eval-catalog__notice">
      Create a Provider first before importing LLM Judge scorers.
    </div>

    <div v-else class="eval-catalog__groups">
      <section
        v-for="group in groupedEntries"
        :key="group.category"
        class="eval-catalog__group"
      >
        <h4>{{ group.category }}</h4>
        <div class="eval-catalog__grid">
          <article
            v-for="entry in group.entries"
            :key="entry.name"
            class="eval-catalog-card"
            :class="{ 'is-imported': isImported(entry.name) }"
          >
            <div class="eval-catalog-card__top">
              <div>
                <h5>{{ entry.displayName }}</h5>
                <code>{{ entry.name }}</code>
              </div>
              <span v-if="isImported(entry.name)" class="eval-catalog-card__badge">
                Imported
              </span>
            </div>
            <p>{{ entry.description }}</p>
            <div class="eval-catalog-card__meta">
              <span>{{ entry.level }}</span>
              <span v-if="kind === 'scoreConfigs'">{{ (entry as CatalogScoreConfig).dataType }}</span>
              <span v-else>LLM Judge</span>
            </div>
            <OButton
              variant="secondary"
              size="sm"
              :disabled="isBusy || isImported(entry.name) || scorerImportBlocked"
              :data-test="`${kind}-catalog-${entry.name}-import-btn`"
              @click="importEntry(entry)"
            >
              {{ isImported(entry.name) ? "Imported" : "Import" }}
            </OButton>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type Provider,
  type ScoreConfig,
  type Scorer,
} from "@/services/online-evals.service";
import {
  fetchOnlineEvalsCatalog,
  type CatalogScoreConfig,
  type CatalogScorer,
} from "@/services/online-evals-catalog.service";
import { entityId } from "./utils/evalEntity";
import { showError } from "./utils/evalFormat";

type CatalogKind = "scoreConfigs" | "scorers";
type CatalogEntry = CatalogScoreConfig | CatalogScorer;

const props = defineProps<{
  kind: CatalogKind;
  orgId: string;
  scoreConfigs: ScoreConfig[];
  scorers: Scorer[];
  providers: Provider[];
}>();

const emit = defineEmits<{
  (e: "imported"): void;
}>();

const isLoadingCatalog = ref(false);
const isBusy = ref(false);
const loadError = ref("");
const scoreConfigEntries = ref<CatalogScoreConfig[]>([]);
const scorerEntries = ref<CatalogScorer[]>([]);
const selectedProviderId = ref("");

const entries = computed<CatalogEntry[]>(() =>
  props.kind === "scoreConfigs" ? scoreConfigEntries.value : scorerEntries.value,
);

const title = computed(() =>
  props.kind === "scoreConfigs" ? "Import score configs" : "Import LLM Judge scorers",
);

const subtitle = computed(() =>
  props.kind === "scoreConfigs"
    ? "Start with curated span-level quality dimensions."
    : "Create scorer prompts and link them to their required score configs.",
);

const importedNames = computed(() => {
  const rows = props.kind === "scoreConfigs" ? props.scoreConfigs : props.scorers;
  return new Set(rows.map((row) => row.name));
});

const providerOptions = computed(() =>
  props.providers.map((provider) => ({ label: provider.name, value: provider.id })),
);

const scorerImportBlocked = computed(
  () => props.kind === "scorers" && (!props.providers.length || !selectedProviderId.value),
);

const importableEntries = computed(() =>
  entries.value.filter((entry) => !isImported(entry.name)),
);

const groupedEntries = computed(() => {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries.value) {
    const group = groups.get(entry.category) || [];
    group.push(entry);
    groups.set(entry.category, group);
  }
  return Array.from(groups.entries()).map(([category, groupEntries]) => ({
    category,
    entries: groupEntries,
  }));
});

onMounted(loadCatalog);

async function loadCatalog() {
  isLoadingCatalog.value = true;
  loadError.value = "";
  try {
    const catalog = await fetchOnlineEvalsCatalog();
    scoreConfigEntries.value = catalog.scoreConfigs.filter((entry) => entry.level === "span");
    scorerEntries.value = catalog.scorers.filter((entry) => entry.level === "span");
  } catch (err: any) {
    loadError.value = err?.message || "Failed to load catalog";
  } finally {
    isLoadingCatalog.value = false;
  }
}

function isImported(name: string) {
  return importedNames.value.has(name);
}

async function importAll() {
  await runImport(importableEntries.value);
}

async function importEntry(entry: CatalogEntry) {
  await runImport([entry]);
}

async function runImport(selectedEntries: CatalogEntry[]) {
  if (isBusy.value || selectedEntries.length === 0) return;
  if (props.kind === "scorers" && !selectedProviderId.value) {
    toast({ variant: "warning", message: "Select a Provider before importing scorers." });
    return;
  }

  isBusy.value = true;
  try {
    for (const entry of selectedEntries) {
      if (props.kind === "scoreConfigs") {
        await importScoreConfig(entry as CatalogScoreConfig);
      } else {
        await importScorer(entry as CatalogScorer);
      }
      await refreshRows();
    }
    toast({ variant: "success", message: "Catalog import complete" });
    emit("imported");
  } catch (err: any) {
    showError(err, "Failed to import catalog item");
  } finally {
    isBusy.value = false;
  }
}

async function refreshRows() {
  emit("imported");
}

async function importScoreConfig(entry: CatalogScoreConfig) {
  if (findScoreConfigByName(entry.name)) return;
  try {
    await onlineEvalsService.scoreConfigs.create(props.orgId, scoreConfigPayload(entry));
  } catch (err: any) {
    if (err?.response?.status === 409) {
      emit("imported");
      return;
    }
    throw err;
  }
}

async function importScorer(entry: CatalogScorer) {
  if (findScorerByName(entry.name)) return;
  const scoreConfig = await resolveRequiredScoreConfig(entry.requiredScoreConfigName);
  try {
    await onlineEvalsService.scorers.create(props.orgId, scorerPayload(entry, entityId(scoreConfig)));
  } catch (err: any) {
    if (err?.response?.status === 409) {
      emit("imported");
      return;
    }
    throw err;
  }
}

async function resolveRequiredScoreConfig(name: string): Promise<ScoreConfig> {
  const existing = findScoreConfigByName(name);
  if (existing) return existing;

  const catalogEntry = scoreConfigEntries.value.find((entry) => entry.name === name);
  if (!catalogEntry) throw new Error(`Catalog score config not found: ${name}`);

  try {
    return await onlineEvalsService.scoreConfigs.create(props.orgId, scoreConfigPayload(catalogEntry));
  } catch (err: any) {
    if (err?.response?.status === 409) {
      const refreshed = await onlineEvalsService.scoreConfigs.list(props.orgId);
      const found = refreshed.find((row) => row.name === name);
      if (found) return found;
    }
    throw err;
  }
}

function scoreConfigPayload(entry: CatalogScoreConfig) {
  const payload: Record<string, any> = {
    name: entry.name,
    dataType: entry.dataType,
  };
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

function findScoreConfigByName(name: string) {
  return props.scoreConfigs.find((row) => row.name === name) || null;
}

function findScorerByName(name: string) {
  return props.scorers.find((row) => row.name === name) || null;
}
</script>

<style lang="scss">
.eval-catalog {
  width: 100%;
  padding: 18px;
  overflow: auto;
}

.eval-catalog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.eval-catalog__eyebrow {
  margin: 0 0 4px;
  color: var(--o2-brand);
  font: 700 11px/1.4 var(--o2-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.eval-catalog__header h3 {
  margin: 0;
  color: var(--o2-text);
  font-size: 20px;
}

.eval-catalog__header p {
  margin: 4px 0 0;
  color: var(--o2-text-muted);
}

.eval-catalog__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.eval-catalog__provider {
  width: 220px;
}

.eval-catalog__error,
.eval-catalog__notice,
.eval-catalog__loading {
  padding: 14px;
  border: 1px solid var(--o2-border);
  border-radius: 8px;
  color: var(--o2-text-muted);
  background: var(--o2-bg-secondary);
}

.eval-catalog__group + .eval-catalog__group {
  margin-top: 20px;
}

.eval-catalog__group h4 {
  margin: 0 0 10px;
  color: var(--o2-text);
  font-size: 13px;
  font-weight: 700;
}

.eval-catalog__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.eval-catalog-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 190px;
  padding: 14px;
  border: 1px solid var(--o2-border);
  border-radius: 10px;
  background: var(--o2-card-bg);
}

.eval-catalog-card.is-imported {
  opacity: 0.72;
}

.eval-catalog-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.eval-catalog-card h5 {
  margin: 0 0 4px;
  color: var(--o2-text);
  font-size: 14px;
}

.eval-catalog-card code {
  color: var(--o2-text-muted);
  font-size: 12px;
}

.eval-catalog-card p {
  flex: 1;
  margin: 0;
  color: var(--o2-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.eval-catalog-card__badge,
.eval-catalog-card__meta span {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
}

.eval-catalog-card__badge {
  background: color-mix(in srgb, var(--o2-status-success-text) 14%, transparent);
  color: var(--o2-status-success-text);
}

.eval-catalog-card__meta {
  display: flex;
  gap: 6px;
}

.eval-catalog-card__meta span {
  background: var(--o2-bg-secondary);
  color: var(--o2-text-muted);
}
</style>
