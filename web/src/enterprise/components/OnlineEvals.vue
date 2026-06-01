<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <div class="online-evals" data-test="online-evals-page">
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
      @saved="handleSaved"
      @cancel="closeFormPage"
      @request-versions="(id) => ensureScoreConfigVersions(orgId, id)"
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

    <template v-else>
      <div class="online-evals__header card-container">
        <div>
          <h1>{{ t("onlineEvals.title") }}</h1>
          <p>{{ t("onlineEvals.description") }}</p>
        </div>
      </div>

      <section class="online-evals__content card-container">
        <div class="online-evals__tabs">
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
          <ScoreConfigList
            v-if="activeTab === 'scoreConfigs'"
            :rows="(filteredRows as ScoreConfig[])"
            :scorers="scorers"
            :search="filterQuery"
            :loading="isLoading"
            @update:search="filterQuery = $event"
            @create="openCreateDialog"
            @edit="(row) => openEditDialog(row)"
            @delete="(row) => deleteRow(row)"
          />
          <ScorerList
            v-else-if="activeTab === 'scorers'"
            :rows="(filteredRows as Scorer[])"
            :jobs="jobs"
            :score-configs="scoreConfigs"
            :search="filterQuery"
            :loading="isLoading"
            @update:search="filterQuery = $event"
            @create="openCreateDialog"
            @edit="(row: Scorer) => openEditDialog(row)"
            @delete="(row: Scorer) => deleteRow(row)"
          />
          <EvalJobList
            v-else-if="activeTab === 'jobs'"
            :rows="(filteredRows as EvalJob[])"
            :search="filterQuery"
            :loading="isLoading"
            @update:search="filterQuery = $event"
            @create="openCreateDialog"
            @edit="(row: EvalJob) => openEditDialog(row)"
            @delete="(row: EvalJob) => deleteRow(row)"
          />
        </div>
      </section>

      <ScorerTypeDialog
        v-if="scorerTypeDialog"
        @close="scorerTypeDialog = false"
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
import ScoreConfigList from "./onlineEvals/ScoreConfigList.vue";
import ScorerList from "./onlineEvals/ScorerList.vue";
import EvalJobList from "./onlineEvals/EvalJobList.vue";
import ScorerTypeDialog from "./onlineEvals/forms/ScorerTypeDialog.vue";
import ScoreConfigDialog from "./onlineEvals/forms/ScoreConfigDialog.vue";
import ScorerFormPage from "./onlineEvals/forms/ScorerFormPage.vue";
import JobFormPage from "./onlineEvals/forms/JobFormPage.vue";

type ActiveTab = "jobs" | "scorers" | "scoreConfigs";
type FullPageEntity = Exclude<ActiveTab, "scoreConfigs">;
type AnyRow = EvalJob | Scorer | ScoreConfig;

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const VALID_TABS: ActiveTab[] = ["jobs", "scorers", "scoreConfigs"];

function parseTabFromRoute(value: unknown): ActiveTab {
  if (typeof value === "string" && (VALID_TABS as string[]).includes(value)) {
    return value as ActiveTab;
  }
  return "jobs";
}

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

const {
  jobs,
  scorers,
  scoreConfigs,
  scoreConfigVersions,
  providers,
  isLoading,
  loadAll,
  ensureScoreConfigVersions,
} = useOnlineEvalsData();

const rowsByTab = computed<Record<ActiveTab, AnyRow[]>>(() => ({
  jobs: jobs.value,
  scorers: scorers.value,
  scoreConfigs: scoreConfigs.value,
}));

const filteredRows = computed(() => {
  const query = filterQuery.value.trim().toLowerCase();
  const rows = rowsByTab.value[activeTab.value];
  if (!query) return rows;

  return rows.filter((row) =>
    [row.name, (row as any).description || ""]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
});

const tabs = computed(() => [
  { value: "jobs" as ActiveTab, label: t("onlineEvals.tabs.jobs") },
  { value: "scorers" as ActiveTab, label: t("onlineEvals.tabs.scorers") },
  { value: "scoreConfigs" as ActiveTab, label: t("onlineEvals.tabs.scoreConfigs") },
]);

const currentSingularLabel = computed(() => t(`onlineEvals.singular.${activeTab.value}`));

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

onBeforeMount(() => loadAll(orgId.value));

function openCreateDialog() {
  dialog.value = { open: activeTab.value === "scoreConfigs", mode: "create", row: null };
  if (activeTab.value === "scoreConfigs") return;
  if (activeTab.value === "scorers") {
    scorerTypeDialog.value = true;
    return;
  }
  openFormPage(activeTab.value as FullPageEntity, "create");
}

function openEditDialog(row: AnyRow) {
  dialog.value = { open: activeTab.value === "scoreConfigs", mode: "edit", row };
  if (activeTab.value !== "scoreConfigs") openFormPage(activeTab.value as FullPageEntity, "edit");
}

function closeDialog() {
  dialog.value = { open: false, mode: "create", row: null };
}

function openFormPage(entity: FullPageEntity, mode: "create" | "edit") {
  activeTab.value = entity;
  formPage.value = { entity, mode };
}

function closeFormPage() {
  formPage.value = null;
  dialog.value = { open: false, mode: "create", row: null };
}

function selectScorerType(type: ScorerType) {
  scorerTypeDialog.value = false;
  activeTab.value = "scorers";
  pendingScorerType.value = type;
  dialog.value = { open: false, mode: "create", row: null };
  openFormPage("scorers", "create");
}

async function handleSaved() {
  closeFormPage();
  closeDialog();
  await loadAll(orgId.value);
}

async function deleteRow(row: AnyRow) {
  if (!window.confirm(t("onlineEvals.deletePrompt", { name: row.name }))) return;
  try {
    if (activeTab.value === "scoreConfigs")
      await onlineEvalsService.scoreConfigs.delete(orgId.value, entityId(row as ScoreConfig));
    else if (activeTab.value === "scorers")
      await onlineEvalsService.scorers.delete(orgId.value, entityId(row as Scorer));
    else await onlineEvalsService.jobs.delete(orgId.value, (row as EvalJob).id);

    toast({
      variant: "success",
      message: t("onlineEvals.deleted", { label: currentSingularLabel.value }),
    });
    await loadAll(orgId.value);
  } catch (err: any) {
    showError(err, t("onlineEvals.deleteError", { label: currentSingularLabel.value.toLowerCase() }));
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

.online-evals__header h1,
.eval-dialog h2 {
  margin: 0;
  font-weight: 700;
  color: var(--o2-text);
  letter-spacing: 0;
}

.online-evals__header h1 {
  font-size: 18px;
}

.online-evals__header p,
.eval-dialog p {
  margin: 2px 0 0;
  color: var(--o2-text-muted);
  font-size: 12px;
}

.online-evals__tabs,
.online-evals__toolbar,
.online-evals__toolbar-actions,
.online-evals__row-actions,
.eval-dialog__foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.online-evals__tabs {
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

.online-evals__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 260px;
  color: var(--o2-text-muted);
}

.online-evals__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.online-evals__list {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.online-evals__toolbar {
  justify-content: space-between;
  min-height: 52px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--o2-border);
}

.online-evals__toolbar-actions {
  margin-left: auto;
}

.online-evals__search {
  display: flex;
  align-items: center;
  gap: 7px;
  width: min(320px, 100%);
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
}

.online-evals__search input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--o2-text);
  font-size: 12px;
}

.online-evals__select,
.eval-dialog input,
.eval-dialog select,
.eval-dialog textarea {
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font);
}

.online-evals__select {
  height: 30px;
  padding: 0 9px;
}

.online-evals__table {
  height: calc(100% - 52px);
  overflow: auto;
  background: var(--o2-card-bg-solid);
}

.online-evals__thead,
.online-evals__row {
  display: grid;
  grid-template-columns: minmax(210px, 1.5fr) minmax(120px, 1fr) 98px 118px 170px;
  align-items: center;
  gap: 12px;
}

.online-evals__thead {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 14px;
  background: var(--o2-table-header-bg, var(--o2-bg-secondary));
  color: var(--o2-text);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.online-evals__row {
  width: 100%;
  min-height: 54px;
  padding: 8px 14px;
  border: 0;
  border-bottom: 1px solid var(--o2-border);
  background: transparent;
  color: var(--o2-text);
  text-align: left;
}

.online-evals__row:hover {
  background: var(--o2-hover-gray);
}

.online-evals__row span {
  min-width: 0;
}

.online-evals__row strong,
.online-evals__row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.online-evals__row strong {
  color: var(--o2-text);
  font-size: 13px;
}

.online-evals__row small,
.online-evals__row > span {
  color: var(--o2-text-secondary);
  font-size: 12px;
}

.eval-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 2px 8px;
  border-radius: 999px;
  font: 700 10px var(--o2-font);
  text-transform: uppercase;
}

.eval-pill.is-good {
  background: var(--o2-status-success-bg);
  color: var(--o2-status-success-text);
}

.eval-pill.is-warn {
  background: var(--o2-status-warning-bg);
  color: var(--o2-status-warning-text);
}

.eval-pill.is-muted {
  background: var(--o2-status-neutral-bg);
  color: var(--o2-status-neutral-text);
}

.online-evals__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 260px;
  padding: 24px;
  color: var(--o2-text-muted);
  text-align: center;
}

.online-evals__empty strong {
  color: var(--o2-text);
  font-size: 14px;
}

.eval-form-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--o2-card-bg-solid);
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  box-shadow: var(--o2-shadow-sm);
}

.eval-form-page__top,
.eval-form-page__head,
.eval-form-page__foot {
  flex-shrink: 0;
  border-bottom: 1px solid var(--o2-border);
}

.eval-form-page__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 18px;
}

.eval-form-page__top-actions,
.eval-form-page__back,
.eval-stepper,
.eval-type-dialog__cards {
  display: flex;
  align-items: center;
  gap: 8px;
}

.eval-form-page__back {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--o2-text-secondary);
  cursor: pointer;
  font: 600 12px var(--o2-font);
}

.eval-form-page__back:hover {
  color: var(--o2-text);
}

.eval-form-page__badge {
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--o2-bg-muted);
  color: var(--o2-text);
  font: 700 11px var(--o2-font);
}

.eval-form-page__head {
  padding: 18px 24px;
}

.eval-form-page__head h1 {
  margin: 0;
  color: var(--o2-text);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0;
}

.eval-form-page__head p {
  margin: 3px 0 0;
  color: var(--o2-text-muted);
  font-size: 13px;
}

.eval-form-page__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.eval-form-page__body--split {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  overflow: hidden;
}

.eval-form-page__main {
  min-width: 0;
  overflow: auto;
}

.eval-form-page__side {
  min-width: 0;
  overflow: auto;
  padding: 18px;
  border-left: 1px solid var(--o2-border);
  background: var(--o2-bg-secondary);
}

.eval-form-page__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--o2-border);
  border-bottom: 0;
}

.eval-stepper {
  height: 48px;
  padding: 0 24px;
  border-bottom: 1px solid var(--o2-border);
  color: var(--o2-text-muted);
  font: 600 12px var(--o2-font);
}

.eval-stepper span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.eval-stepper i,
.eval-form-section__title span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--o2-bg-muted);
  color: var(--o2-text-muted);
  font: 700 11px var(--o2-font-mono);
  font-style: normal;
}

.eval-stepper .is-active {
  color: var(--o2-text);
}

.eval-stepper .is-active i {
  background: var(--o2-brand);
  color: white;
}

.eval-form-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  max-width: 1040px;
  padding: 24px;
  border-bottom: 1px solid var(--o2-border);
}

.eval-form-section__title,
.eval-form-section__wide {
  grid-column: 1 / -1;
}

.eval-form-section__title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--o2-text);
  font-size: 16px;
  font-weight: 700;
}

.eval-form-section label,
.eval-dialog label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--o2-text);
  font-size: 12px;
  font-weight: 700;
}

.eval-form-section input,
.eval-form-section select,
.eval-form-section textarea,
.eval-dialog input,
.eval-dialog select,
.eval-dialog textarea {
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font);
}

.eval-form-section input,
.eval-form-section select,
.eval-dialog input,
.eval-dialog select {
  height: 32px;
  padding: 0 9px;
}

.eval-form-section textarea,
.eval-dialog textarea {
  min-height: 90px;
  padding: 8px 9px;
  resize: vertical;
  font-family: var(--o2-font-mono);
}

.eval-form-check {
  flex-direction: row !important;
  align-items: center;
  align-self: end;
  min-height: 32px;
}

.eval-form-check input {
  width: auto;
  height: auto;
}

.eval-form-field-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
  color: var(--o2-text);
  font-size: 12px;
  font-weight: 700;
}

.eval-form-field-head small {
  color: var(--o2-text-muted);
  font-size: 12px;
  font-weight: 400;
}

.eval-scorer-picker__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.eval-scorer-option {
  flex-direction: row !important;
  align-items: center;
  gap: 10px !important;
  min-height: 54px;
  padding: 10px 12px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
  cursor: pointer;
}

.eval-scorer-option.is-selected {
  border-color: var(--o2-brand);
  background: color-mix(in srgb, var(--o2-brand) 8%, var(--o2-card-bg-solid));
}

.eval-scorer-option input {
  width: auto;
  height: auto;
}

.eval-scorer-option span,
.eval-mapping-card__head div {
  min-width: 0;
}

.eval-scorer-option strong,
.eval-scorer-option small,
.eval-mapping-card__head strong,
.eval-mapping-card__head small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eval-scorer-option small,
.eval-mapping-card__head small {
  color: var(--o2-text-secondary);
  font-size: 11px;
  font-weight: 400;
}

.eval-condition-builder {
  min-width: 0;
  padding: 10px 0 2px;
}

.eval-condition-builder :deep(.el-border) {
  width: 100%;
  max-width: 100%;
  margin-top: 0 !important;
  margin-left: 0 !important;
  border-color: var(--o2-border);
}

.eval-condition-builder :deep(.group-container) {
  width: 100%;
}

.eval-input-mapping {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.eval-input-mapping__empty {
  padding: 10px 12px;
  border: 1px dashed var(--o2-border);
  border-radius: 6px;
  color: var(--o2-text-muted);
  font-size: 12px;
  font-weight: 400;
}

.eval-mapping-card {
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-mapping-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--o2-border);
}

.eval-mapping-card__head i {
  flex-shrink: 0;
  color: var(--o2-text-muted);
  font: 700 11px var(--o2-font);
  font-style: normal;
}

.eval-mapping-card__rows {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.eval-mapping-row {
  display: grid !important;
  grid-template-columns: minmax(130px, 0.35fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px !important;
}

.eval-mapping-row code {
  overflow: hidden;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--o2-bg-muted);
  color: var(--o2-text);
  font: 700 11px var(--o2-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eval-preview-card {
  padding: 16px;
  margin-bottom: 14px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-preview-card h3 {
  margin: 0 0 6px;
  color: var(--o2-text);
  font-size: 14px;
  font-weight: 700;
}

.eval-preview-card p {
  margin: 0 0 12px;
  color: var(--o2-text-muted);
  font-size: 12px;
}

.eval-preview-card textarea {
  width: 100%;
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font-mono);
  padding: 8px;
  resize: none;
}

.eval-preview-card dl {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px;
  margin: 0;
  font-size: 12px;
}

.eval-preview-card dt {
  color: var(--o2-text-muted);
}

.eval-preview-card dd {
  margin: 0;
  color: var(--o2-text);
}

.eval-form-page__side--test {
  padding: 0;
}

.eval-test-panel {
  min-height: 100%;
  padding: 20px;
  background: var(--o2-bg-secondary);
}

.eval-test-panel h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  color: var(--o2-text);
  font-size: 14px;
  font-weight: 700;
}

.eval-test-panel p,
.eval-test-panel__empty,
.eval-test-panel__result {
  color: var(--o2-text-muted);
  font-size: 12px;
}

.eval-test-panel p {
  margin: 0 0 16px;
}

.eval-test-panel__fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.eval-test-panel label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.eval-test-panel code {
  color: var(--o2-text);
  font: 700 12px var(--o2-font-mono);
}

.eval-test-panel textarea,
.eval-test-panel select {
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font);
}

.eval-test-panel textarea {
  padding: 8px 9px;
  resize: vertical;
  max-height: 160px;
  overflow-y: auto;
}

.eval-test-panel select {
  height: 32px;
  padding: 0 9px;
}

.eval-test-panel__empty {
  padding: 10px 12px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-test-panel__actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 8px;
  margin-top: 14px;
}

.eval-test-panel__result {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 84px;
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-test-panel__result.is-success {
  border-color: color-mix(in srgb, var(--o2-status-success-text) 35%, var(--o2-border));
  color: var(--o2-status-success-text);
}

.eval-test-panel__result.is-error {
  border-color: color-mix(in srgb, var(--o2-status-error-text) 35%, var(--o2-border));
  color: var(--o2-status-error-text);
}

.eval-test-panel__result span,
.eval-test-panel__result small {
  color: var(--o2-text-secondary);
}

.eval-type-dialog,
.eval-dialog {
  position: fixed;
  inset: 0;
  z-index: 6000;
  padding: 0;
  background: rgba(0, 0, 0, 0.36);
  animation: eval-scrim-in 0.15s ease-out;
}

.eval-type-dialog {
  display: flex;
  align-items: center;
  justify-content: center;
}

.eval-type-dialog__panel {
  width: min(760px, calc(100vw - 48px));
  padding: 20px;
  border-radius: 8px;
  background: var(--o2-card-bg-solid);
  box-shadow: var(--o2-shadow-lg);
}

.eval-type-dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--o2-border);
}

.eval-type-dialog__head h2 {
  margin: 0;
  color: var(--o2-text);
  font-size: 18px;
  font-weight: 700;
}

.eval-type-dialog__panel > p {
  margin: 16px 0;
  color: var(--o2-text-muted);
  font-size: 13px;
}

.eval-type-dialog__cards {
  align-items: stretch;
}

.eval-type-dialog__cards button {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-height: 150px;
  padding: 18px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  text-align: left;
  cursor: pointer;
}

.eval-type-dialog__cards button:hover:not(:disabled) {
  border-color: var(--o2-brand);
  box-shadow: inset 0 0 0 1px var(--o2-brand);
}

.eval-type-dialog__cards button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.eval-type-dialog__cards strong {
  font-size: 14px;
}

.eval-type-dialog__cards span {
  color: var(--o2-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.eval-dialog {
  display: block;
}

.eval-dialog__panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: 52vw;
  min-width: 600px;
  max-width: 920px;
  max-height: none;
  overflow: hidden;
  border: 1px solid var(--o2-border);
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  border-radius: 0;
  background: var(--o2-card-bg-solid);
  box-shadow: var(--o2-shadow-lg);
  animation: eval-drawer-in 0.2s ease-out;
}

.eval-dialog__panel--small {
  width: 50vw;
  min-width: 560px;
  max-width: 760px;
}

.eval-dialog__head,
.eval-dialog__foot {
  flex-shrink: 0;
  padding: 14px 20px;
  border-bottom: 1px solid var(--o2-border);
}

.eval-dialog__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.eval-dialog__head h2 {
  font-size: 16px;
}

.eval-dialog__content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  flex: 1;
  padding: 20px;
  overflow: auto;
}

.eval-dialog__content--single {
  grid-template-columns: 1fr;
}

.eval-dialog label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--o2-text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.eval-dialog input,
.eval-dialog select {
  height: 32px;
  padding: 0 9px;
}

.eval-dialog textarea {
  min-height: 90px;
  padding: 8px 9px;
  resize: vertical;
  font-family: var(--o2-font-mono);
}

.eval-dialog__wide {
  grid-column: 1 / -1;
}

.eval-dialog__check {
  flex-direction: row !important;
  align-items: center;
  align-self: end;
  height: 32px;
}

.eval-dialog__check input {
  width: auto;
  height: auto;
}

.eval-dialog__foot {
  justify-content: flex-end;
  border-top: 1px solid var(--o2-border);
  border-bottom: 0;
  background: var(--o2-card-bg-solid);
}

@keyframes eval-scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes eval-drawer-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

@media (max-width: 900px) {
  .eval-dialog__panel,
  .eval-dialog__panel--small {
    width: 100vw;
    min-width: 0;
    max-width: none;
  }

  .eval-dialog__content {
    grid-template-columns: 1fr;
  }

  .eval-form-page__body--split {
    display: block;
    overflow: auto;
  }

  .eval-form-page__side {
    border-left: 0;
    border-top: 1px solid var(--o2-border);
  }

  .eval-form-section {
    grid-template-columns: 1fr;
  }
}
</style>
