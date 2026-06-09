<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <div
    class="online-evals"
    :class="{ 'online-evals--embedded': hideTabBar }"
    data-test="online-evals-page"
  >
    <!-- Full-page forms (jobs / scorers) -->
    <ScorerFormPage
      v-if="formPage?.entity === 'scorers'"
      :org-id="orgId"
      :mode="formPage.mode"
      :row="(dialog.row as Scorer | null)"
      :scorer-type="pendingScorerType"
      :providers="providers"
      :score-configs="scoreConfigs"
      :score-config-versions="scoreConfigVersions"
      :is-refreshing-providers="isRefreshingProviders"
      @saved="handleSaved"
      @cancel="closeFormPage"
      @request-versions="(id) => ensureScoreConfigVersions(orgId, id)"
      @refresh-providers="refreshProviders"
    />
    <JobFormPage
      v-else-if="formPage?.entity === 'jobs'"
      :org-id="orgId"
      :mode="formPage.mode"
      :row="(dialog.row as EvalJob | null)"
      :scorers="scorers"
      @saved="handleSaved"
      @cancel="closeFormPage"
    />
    <ImportScoreConfig
      v-else-if="importingEntity === 'scoreConfigs'"
      :org-id="orgId"
      :existing-score-configs="scoreConfigs"
      @cancel="closeImport"
      @saved="handleImportSaved"
    />
    <ImportScorer
      v-else-if="importingEntity === 'scorers'"
      :org-id="orgId"
      :existing-scorers="scorers"
      :score-configs="scoreConfigs"
      :providers="providers"
      @cancel="closeImport"
      @saved="handleImportSaved"
    />

    <template v-else>
      <div v-if="!hideTabBar" class="online-evals__header card-container">
        <div>
          <h1>{{ t("onlineEvals.title") }}</h1>
        </div>
      </div>

      <section class="online-evals__content card-container">
        <div v-if="!hideTabBar" class="online-evals__tabs">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            class="online-evals__tab"
            :class="{ 'is-active': activeTab === tab.value }"
            type="button"
            @click="activeTab = tab.value"
          >
            <span>{{ tab.label }}</span>
          </button>
        </div>

        <div class="online-evals__body">
          <QualityPage
            v-if="activeTab === 'quality'"
            :score-configs="scoreConfigs"
          />
          <ScoreConfigList
            v-else-if="activeTab === 'scoreConfigs'"
            :rows="(filteredRows as ScoreConfig[])"
            :all-score-configs="scoreConfigs"
            :scorers="scorers"
            :search="filterQuery"
            :loading="isLoading"
            @update:search="filterQuery = $event"
            @create="openCreateDialog"
            @view="(row) => openViewDialog(row)"
            @edit="(row) => openEditDialog(row)"
            @delete="(row) => deleteRow(row)"
            @open-library="openScoreConfigLibrary"
            @import-custom="goToImportScoreConfig"
            @export="exportScoreConfigRow"
            @export-bulk="exportScoreConfigBulk"
          />
          <ScorerList
            v-else-if="activeTab === 'scorers'"
            :rows="(filteredRows as Scorer[])"
            :all-scorers="scorers"
            :jobs="jobs"
            :score-configs="scoreConfigs"
            :providers="providers"
            :search="filterQuery"
            :loading="isLoading"
            @update:search="filterQuery = $event"
            @create="openCreateDialog"
            @view="(row: Scorer) => openScorerView(row)"
            @edit="(row: Scorer) => openEditDialog(row)"
            @delete="(row: Scorer) => deleteRow(row)"
            @open-library="openScorerLibrary"
            @import-custom="goToImportScorer"
            @export="exportScorerRow"
            @export-bulk="exportScorerBulk"
            @add-provider="goToAddProvider"
          />
          <EvalJobList
            v-else-if="activeTab === 'jobs'"
            :rows="(filteredRows as EvalJob[])"
            :search="filterQuery"
            :loading="isLoading"
            :pending-status-id="pendingJobStatusId"
            @update:search="filterQuery = $event"
            @create="openCreateDialog"
            @view="(row: EvalJob) => openJobView(row)"
            @edit="(row: EvalJob) => openEditDialog(row)"
            @activate="(row: EvalJob) => activateJob(row)"
            @pause="(row: EvalJob) => pauseJob(row)"
            @delete="(row: EvalJob) => deleteRow(row)"
          />
        </div>
      </section>

      <ScorerTypeDialog
        v-if="scorerTypeDialog"
        @close="closeScorerTypeDialog"
        @select="selectScorerType"
      />

      <ScoreConfigDialog
        v-if="dialog.open && activeTab === 'scoreConfigs'"
        :org-id="orgId"
        :mode="dialog.mode"
        :row="(dialog.row as ScoreConfig | null)"
        @saved="handleSaved"
        @cancel="closeDialog"
      />

      <ODrawer
        v-model:open="showScoreConfigLibrary"
        side="right"
        size="lg"
        :title="t('onlineEvals.scoreConfig.import.libraryDrawerTitle')"
        secondary-button-label="Cancel"
        :primary-button-label="`Import (${scoreConfigLibrarySelectedCount})`"
        :primary-button-disabled="scoreConfigLibrarySelectedCount === 0"
        :primary-button-loading="scoreConfigLibraryImporting"
        data-test="score-config-library-drawer"
        @click:secondary="showScoreConfigLibrary = false"
        @click:primary="triggerScoreConfigLibraryImport"
      >
        <ScoreConfigLibrary
          ref="scoreConfigLibraryRef"
          :org-id="orgId"
          @update:selected-count="(n: number) => (scoreConfigLibrarySelectedCount = n)"
          @imported="handleScoreConfigLibraryImported"
        />
      </ODrawer>

      <ODrawer
        v-model:open="showScorerLibrary"
        side="right"
        size="lg"
        :title="t('onlineEvals.scorer.import.libraryDrawerTitle')"
        secondary-button-label="Cancel"
        :primary-button-label="`Import (${scorerLibrarySelectedCount})`"
        :primary-button-disabled="scorerLibrarySelectedCount === 0"
        :primary-button-loading="scorerLibraryImporting"
        data-test="scorer-library-drawer"
        @click:secondary="showScorerLibrary = false"
        @click:primary="triggerScorerLibraryImport"
      >
        <ScorerLibrary
          ref="scorerLibraryRef"
          :org-id="orgId"
          :score-configs="scoreConfigs"
          :scorers="scorers"
          :providers="providers"
          @update:selected-count="(n: number) => (scorerLibrarySelectedCount = n)"
          @imported="handleScorerLibraryImported"
        />
      </ODrawer>

      <ScoreConfigDetail
        v-if="viewRow"
        :row="viewRow"
        :scorers="scorers"
        @close="closeViewDialog"
        @view-scorer="(row) => crossNavigateToScorer(row)"
      />

      <ScorerDetail
        v-if="scorerViewRow"
        :row="scorerViewRow"
        :providers="providers"
        :score-configs="scoreConfigs"
        :jobs="jobs"
        @close="closeScorerView"
        @view-job="(row) => crossNavigateToJob(row)"
      />

      <EvalJobDetail
        v-if="jobViewRow"
        :row="jobViewRow"
        :scorers="scorers"
        :score-configs="scoreConfigs"
        @close="closeJobView"
        @view-scorer="(row) => crossNavigateToScorer(row)"
      />

      <ConfirmDialog
        v-model="confirmDeleteOpen"
        :title="pendingDeleteLabel"
        :message="t('onlineEvals.deleteConfirmMessage', { name: pendingDeleteRow?.name ?? '' })"
        @update:ok="performDelete"
        @update:cancel="cancelDelete"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type EvalJob,
  type ScoreConfig,
  type Scorer,
  type ScorerType,
} from "@/services/online-evals.service";
import { useOnlineEvalsData } from "./onlineEvals/composables/useOnlineEvalsData";
import {
  entityId,
  statusOf,
} from "./onlineEvals/utils/evalEntity";
import { showError } from "./onlineEvals/utils/evalFormat";
import {
  buildCrossNavigationQuery,
  computeViewState,
  findRowById as findRowByIdPure,
  parseTabFromRoute,
  rowIdOf as rowIdOfPure,
  VALID_TABS,
  type ActiveTab,
  type AnyRow,
  type FullPageEntity,
  type RowTab,
  type RowsByTab,
} from "./onlineEvals/utils/routeSync";
import ScoreConfigList from "./onlineEvals/ScoreConfigList.vue";
import ScorerList from "./onlineEvals/ScorerList.vue";
import EvalJobList from "./onlineEvals/EvalJobList.vue";
import QualityPage from "./onlineEvals/QualityPage.vue";
import ScorerTypeDialog from "./onlineEvals/forms/ScorerTypeDialog.vue";
import ScoreConfigDialog from "./onlineEvals/forms/ScoreConfigDialog.vue";
import ScoreConfigDetail from "./onlineEvals/forms/ScoreConfigDetail.vue";
import ScorerDetail from "./onlineEvals/forms/ScorerDetail.vue";
import EvalJobDetail from "./onlineEvals/forms/EvalJobDetail.vue";
import ScorerFormPage from "./onlineEvals/forms/ScorerFormPage.vue";
import JobFormPage from "./onlineEvals/forms/JobFormPage.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ScoreConfigLibrary from "./onlineEvals/ScoreConfigLibrary.vue";
import ScorerLibrary from "./onlineEvals/ScorerLibrary.vue";
import ImportScoreConfig from "./onlineEvals/ImportScoreConfig.vue";
import ImportScorer from "./onlineEvals/ImportScorer.vue";
import { downloadFile } from "@/utils/dom";
import {
  bulkExportFileName as bulkExportScoreConfigFileName,
  exportScoreConfigFileName,
  stripScoreConfigForExport,
} from "./onlineEvals/utils/exportScoreConfig";
import {
  bulkExportFileName as bulkExportScorerFileName,
  exportScorerFileName,
  stripScorerForExport,
} from "./onlineEvals/utils/exportScorer";

// When embedded inside the AI Observability shell, the new secondary
// sidebar provides tab navigation — the component's own header + tab
// strip become redundant and should be suppressed.
withDefaults(defineProps<{ hideTabBar?: boolean }>(), { hideTabBar: false });

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const activeTab = ref<ActiveTab>(parseTabFromRoute(route.query.tab));
const filterQuery = ref("");
const scorerTypeDialog = ref(false);
const pendingScorerType = ref<ScorerType>("llm_judge");
const formPage = ref<{ entity: FullPageEntity; mode: "create" | "edit" } | null>(null);

const dialog = ref<{ open: boolean; mode: "create" | "edit"; row: AnyRow | null }>({
  open: false,
  mode: "create",
  row: null,
});

const viewRow = ref<ScoreConfig | null>(null);
const scorerViewRow = ref<Scorer | null>(null);
const jobViewRow = ref<EvalJob | null>(null);
const pendingJobStatusId = ref<string | null>(null);

const confirmDeleteOpen = ref(false);
const pendingDeleteRow = ref<AnyRow | null>(null);
const pendingDeleteTab = ref<ActiveTab | null>(null);
const catalogOpenTab = ref<ActiveTab | null>(null);
const showScoreConfigLibrary = ref(false);
const scoreConfigLibrarySelectedCount = ref(0);
const scoreConfigLibraryImporting = ref(false);
const scoreConfigLibraryRef = ref<InstanceType<typeof ScoreConfigLibrary> | null>(null);
const showScorerLibrary = ref(false);
const scorerLibrarySelectedCount = ref(0);
const scorerLibraryImporting = ref(false);
const scorerLibraryRef = ref<InstanceType<typeof ScorerLibrary> | null>(null);
const importingEntity = ref<"scoreConfigs" | "scorers" | null>(null);

const {
  jobs,
  scorers,
  scoreConfigs,
  scoreConfigVersions,
  providers,
  isLoading,
  loadAll,
  loadProviders,
  ensureScoreConfigVersions,
} = useOnlineEvalsData();

const isRefreshingProviders = ref(false);

async function refreshProviders() {
  if (isRefreshingProviders.value) return;
  isRefreshingProviders.value = true;
  try {
    await loadProviders(orgId.value);
  } finally {
    isRefreshingProviders.value = false;
  }
}

const rowsByTab = computed<RowsByTab>(() => ({
  jobs: jobs.value,
  scorers: scorers.value,
  scoreConfigs: scoreConfigs.value,
}));

const filteredRows = computed<AnyRow[]>(() => {
  if (activeTab.value === "quality") return [];
  const query = filterQuery.value.trim().toLowerCase();
  const rows = rowsByTab.value[activeTab.value as RowTab];
  if (!query) return rows;

  return rows.filter((row) =>
    [row.name, (row as any).description || ""]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
});

const tabs = computed<Array<{ value: ActiveTab; label: string; badge?: string }>>(() => [
  { value: "quality", label: t("onlineEvals.tabs.quality") },
  { value: "jobs", label: t("onlineEvals.tabs.jobs") },
  { value: "scorers", label: t("onlineEvals.tabs.scorers") },
  { value: "scoreConfigs", label: t("onlineEvals.tabs.scoreConfigs") },
]);

const currentSingularLabel = computed(() => t(`onlineEvals.singular.${activeTab.value}`));

const pendingDeleteLabel = computed(() => {
  const tab = pendingDeleteTab.value;
  if (!tab || tab === "quality") return t("onlineEvals.actions.delete");
  return t("onlineEvals.deleteTitle", { label: t(`onlineEvals.singular.${tab}`) });
});

watch(activeTab, (next) => {
  filterQuery.value = "";
  if (route.query.tab !== next) {
    router.replace({ query: { ...route.query, tab: next } }).catch(() => {});
  }
});

// React to back/forward navigation that changes ?tab=…
watch(
  () => route.query.tab,
  (next) => {
    const parsed = parseTabFromRoute(next);
    if (parsed !== activeTab.value) activeTab.value = parsed;
  },
);

onBeforeMount(async () => {
  await loadAll(orgId.value);
  syncFromRoute();
});

function rowIdOf(row: AnyRow): string {
  return rowIdOfPure(row, activeTab.value);
}

function findRowById(tab: ActiveTab, id: string): AnyRow | null {
  return findRowByIdPure(tab, id, rowsByTab.value);
}

function pushRouteAction(extra: Record<string, string | undefined>) {
  const query: Record<string, any> = { ...route.query, tab: activeTab.value };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete query[k];
    else query[k] = v;
  }
  router.push({ name: route.name as string, query }).catch(() => {});
}

function clearRouteAction() {
  const query: Record<string, any> = { ...route.query };
  delete query.action;
  delete query.id;
  delete query.scorer_type;
  router.replace({ name: route.name as string, query }).catch(() => {});
}

function openCreateDialog() {
  if (activeTab.value === "scorers") {
    pushRouteAction({ action: "add", id: undefined, scorer_type: undefined });
    return;
  }
  pushRouteAction({ action: "add", id: undefined });
}

function openEditDialog(row: AnyRow) {
  viewRow.value = null;
  pushRouteAction({ action: "update", id: rowIdOf(row) });
}

function closeDialog() {
  dialog.value = { open: false, mode: "create", row: null };
  clearRouteAction();
}

// All three "view" drawers push/clear the same `?action=view&id=<id>`
// URL params so refresh keeps the drawer open and the URL is shareable.
// The active tab in the route picks which entity is targeted.

function openViewDialog(row: ScoreConfig) {
  pushRouteAction({ action: "view", id: rowIdOf(row) });
}

function closeViewDialog() {
  viewRow.value = null;
  clearRouteAction();
}

function openScorerView(row: Scorer) {
  pushRouteAction({ action: "view", id: rowIdOf(row) });
}

function closeScorerView() {
  scorerViewRow.value = null;
  clearRouteAction();
}

function openJobView(row: EvalJob) {
  pushRouteAction({ action: "view", id: rowIdOf(row) });
}

function closeJobView() {
  jobViewRow.value = null;
  clearRouteAction();
}

/** Cross-navigation: from any detail drawer, jump to the detail drawer of a
 * different entity. Pushes `tab`, `action`, and `id` to the URL in one
 * router push so the activeTab watcher doesn't race against our query update
 * and overwrite the `action` / `id` params. The URL → state watcher then
 * syncs activeTab + opens the right drawer. */
function crossNavigateToScorer(row: Scorer) {
  const query = buildCrossNavigationQuery({ ...route.query }, "scorers", entityId(row));
  router.push({ name: route.name as string, query }).catch(() => {});
}

function crossNavigateToJob(row: EvalJob) {
  const query = buildCrossNavigationQuery({ ...route.query }, "jobs", String(row.id));
  router.push({ name: route.name as string, query }).catch(() => {});
}

async function activateJob(row: EvalJob) {
  if (pendingJobStatusId.value !== null) return;
  pendingJobStatusId.value = row.id;
  try {
    await onlineEvalsService.jobs.activate(orgId.value, row.id);
    toast({
      variant: "success",
      message: t("onlineEvals.actions.activated"),
    });
    await loadAll(orgId.value);
  } catch (err: any) {
    showError(err, t("onlineEvals.actions.activateError"));
  } finally {
    pendingJobStatusId.value = null;
  }
}

async function pauseJob(row: EvalJob) {
  if (pendingJobStatusId.value !== null) return;
  pendingJobStatusId.value = row.id;
  try {
    await onlineEvalsService.jobs.pause(orgId.value, row.id);
    toast({
      variant: "success",
      message: t("onlineEvals.actions.paused"),
    });
    await loadAll(orgId.value);
  } catch (err: any) {
    showError(err, t("onlineEvals.actions.pauseError"));
  } finally {
    pendingJobStatusId.value = null;
  }
}

function openFormPage(entity: FullPageEntity, mode: "create" | "edit") {
  activeTab.value = entity;
  formPage.value = { entity, mode };
}

function closeFormPage() {
  formPage.value = null;
  dialog.value = { open: false, mode: "create", row: null };
  scorerTypeDialog.value = false;
  clearRouteAction();
}

function selectScorerType(type: ScorerType) {
  pushRouteAction({ action: "add", scorer_type: type });
}

function closeScorerTypeDialog() {
  scorerTypeDialog.value = false;
  clearRouteAction();
}

async function handleSaved() {
  formPage.value = null;
  dialog.value = { open: false, mode: "create", row: null };
  scorerTypeDialog.value = false;
  clearRouteAction();
  await loadAll(orgId.value);
}

async function handleCatalogImported() {
  await loadAll(orgId.value);
}

function toggleCatalog(tab: ActiveTab) {
  catalogOpenTab.value = catalogOpenTab.value === tab ? null : tab;
}

function goToImportScoreConfig() {
  importingEntity.value = "scoreConfigs";
}

function closeImport() {
  importingEntity.value = null;
}

async function handleImportSaved() {
  importingEntity.value = null;
  await loadAll(orgId.value);
}

function openScoreConfigLibrary() {
  showScoreConfigLibrary.value = true;
}

async function triggerScoreConfigLibraryImport() {
  if (!scoreConfigLibraryRef.value) return;
  scoreConfigLibraryImporting.value = true;
  try {
    await scoreConfigLibraryRef.value.importSelected();
  } finally {
    scoreConfigLibraryImporting.value = false;
  }
}

async function handleScoreConfigLibraryImported() {
  showScoreConfigLibrary.value = false;
  await loadAll(orgId.value);
}

function exportScoreConfigRow(row: ScoreConfig) {
  const payload = stripScoreConfigForExport(row);
  const ok = downloadFile(
    exportScoreConfigFileName(row),
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  if (!ok) {
    toast({ variant: "error", message: "Failed to export score config" });
  }
}

function goToImportScorer() {
  importingEntity.value = "scorers";
}

function goToAddProvider() {
  router.push({
    name: "llmProviders",
    query: { org_identifier: orgId.value, action: "add" },
  });
}

function openScorerLibrary() {
  showScorerLibrary.value = true;
}

async function triggerScorerLibraryImport() {
  if (!scorerLibraryRef.value) return;
  scorerLibraryImporting.value = true;
  try {
    await scorerLibraryRef.value.importSelected();
  } finally {
    scorerLibraryImporting.value = false;
  }
}

async function handleScorerLibraryImported() {
  showScorerLibrary.value = false;
  await loadAll(orgId.value);
}

function exportScorerRow(row: Scorer) {
  const payload = stripScorerForExport(row, {
    scoreConfigs: scoreConfigs.value,
    providers: providers.value,
  });
  const ok = downloadFile(
    exportScorerFileName(row),
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  if (!ok) {
    toast({ variant: "error", message: "Failed to export scorer" });
  }
}

function exportScorerBulk(ids: string[]) {
  const selected = scorers.value.filter((row) =>
    ids.includes(entityId(row)) || ids.includes(row.id),
  );
  if (selected.length === 0) {
    toast({ variant: "warning", message: "No scorers selected" });
    return;
  }
  const payload = selected.map((row) =>
    stripScorerForExport(row, {
      scoreConfigs: scoreConfigs.value,
      providers: providers.value,
    }),
  );
  const ok = downloadFile(
    bulkExportScorerFileName(),
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  if (ok) {
    toast({
      variant: "success",
      message: `Exported ${selected.length} scorer${selected.length > 1 ? "s" : ""}`,
    });
  } else {
    toast({ variant: "error", message: "Failed to export scorers" });
  }
}

function exportScoreConfigBulk(ids: string[]) {
  const selected = scoreConfigs.value.filter((row) =>
    ids.includes(entityId(row)) || ids.includes(row.id),
  );
  if (selected.length === 0) {
    toast({ variant: "warning", message: "No score configs selected" });
    return;
  }
  const payload = selected.map(stripScoreConfigForExport);
  const ok = downloadFile(
    bulkExportScoreConfigFileName(),
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  if (ok) {
    toast({
      variant: "success",
      message: `Exported ${selected.length} score config${selected.length > 1 ? "s" : ""}`,
    });
  } else {
    toast({ variant: "error", message: "Failed to export score configs" });
  }
}

function syncFromRoute() {
  // Route is the source of truth — reset everything first.
  formPage.value = null;
  dialog.value = { open: false, mode: "create", row: null };
  scorerTypeDialog.value = false;
  viewRow.value = null;
  scorerViewRow.value = null;
  jobViewRow.value = null;

  const state = computeViewState(route.query, rowsByTab.value);

  switch (state.kind) {
    case "none":
      return;
    case "viewScoreConfig":
      viewRow.value = state.row;
      return;
    case "viewScorer":
      scorerViewRow.value = state.row;
      return;
    case "viewJob":
      jobViewRow.value = state.row;
      return;
    case "scoreConfigCreate":
      dialog.value = { open: true, mode: "create", row: null };
      return;
    case "scoreConfigEdit":
      dialog.value = { open: true, mode: "edit", row: state.row };
      return;
    case "scorerTypeDialog":
      scorerTypeDialog.value = true;
      return;
    case "scorerFormCreate":
      pendingScorerType.value = state.scorerType;
      formPage.value = { entity: "scorers", mode: "create" };
      return;
    case "scorerFormEdit":
      dialog.value = { open: false, mode: "edit", row: state.row };
      formPage.value = { entity: "scorers", mode: "edit" };
      return;
    case "jobFormCreate":
      formPage.value = { entity: "jobs", mode: "create" };
      return;
    case "jobFormEdit":
      dialog.value = { open: false, mode: "edit", row: state.row };
      formPage.value = { entity: "jobs", mode: "edit" };
      return;
  }
}

watch(
  () => [route.query.action, route.query.id, route.query.scorer_type, route.query.tab],
  () => syncFromRoute(),
);

function deleteRow(row: AnyRow) {
  pendingDeleteRow.value = row;
  pendingDeleteTab.value = activeTab.value;
  confirmDeleteOpen.value = true;
}

function cancelDelete() {
  confirmDeleteOpen.value = false;
  pendingDeleteRow.value = null;
  pendingDeleteTab.value = null;
}

async function performDelete() {
  const row = pendingDeleteRow.value;
  const tab = pendingDeleteTab.value;
  if (!row || !tab) return;
  const singular = t(`onlineEvals.singular.${tab}`);
  try {
    if (tab === "scoreConfigs")
      await onlineEvalsService.scoreConfigs.delete(orgId.value, entityId(row as ScoreConfig));
    else if (tab === "scorers")
      await onlineEvalsService.scorers.delete(orgId.value, entityId(row as Scorer));
    else if (tab === "jobs")
      await onlineEvalsService.jobs.delete(orgId.value, (row as EvalJob).id);

    toast({
      variant: "success",
      message: t("onlineEvals.deleted", { label: singular }),
    });
    await loadAll(orgId.value);
  } catch (err: any) {
    showError(err, t("onlineEvals.deleteError", { label: singular.toLowerCase() }));
  } finally {
    pendingDeleteRow.value = null;
    pendingDeleteTab.value = null;
  }
}
</script>


<style lang="scss">
.online-evals {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: calc(100vh - var(--navbar-height));
  min-height: 0;
  padding: 4px 10px 10px;
  color: var(--o2-text);
}

// When rendered inside the AI Observability shell, the splitter sits to
// the left and already provides spacing; we only need padding on the
// right edge to mirror the PipelinesList layout pattern. Height is also
// owned by the shell's <router-view> wrapper, so drop the viewport calc.
.online-evals--embedded {
  height: 100%;
  padding: 4px 10px 10px 0;
}

.online-evals__header,
.online-evals__content {
  background: var(--o2-card-bg);
}

.online-evals__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.online-evals__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 68px;
  padding: 10px 16px;
  flex-shrink: 0;
}

.online-evals__header h1 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-text-heading);
  letter-spacing: 0;
}

.online-evals__tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 0 14px;
  background: transparent;
  border-bottom: 1px solid var(--o2-border);
}

.online-evals__tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 14px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--o2-text-muted);
  cursor: pointer;
  font: 600 13px var(--o2-font);
}

.online-evals__tab.is-active {
  color: var(--o2-text);
  border-bottom-color: var(--o2-brand);
  margin-bottom: -1px;
}

.online-evals__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.eval-form-page__side {
  min-width: 0;
  overflow: auto;
  padding: 18px;
  border-left: 1px solid var(--o2-border);
  background: var(--o2-bg-secondary);
}

@media (max-width: 960px) {
  .eval-form-page__side {
    border-left: 0;
    border-top: 1px solid var(--o2-border);
  }
}
</style>
