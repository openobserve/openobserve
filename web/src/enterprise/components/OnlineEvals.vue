<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <div
    class="text-text-body flex h-[calc(100vh-var(--navbar-height))] min-h-0 flex-col gap-2.5 px-2.5 pt-1 pb-2.5"
    :class="{ 'h-full! gap-0! p-0!': hideTabBar }"
    data-test="online-evals-page"
  >
    <!-- Full-page forms (jobs / scorers) -->
    <ScorerFormPage
      v-if="formPage?.entity === 'scorers'"
      :org-id="orgId"
      :mode="formPage.mode"
      :row="scorerFormRow"
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
      :row="jobFormRow"
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
      <div
        v-if="!hideTabBar"
        class="online-evals__header bg-card-glass-bg flex min-h-17 shrink-0 items-center justify-between gap-4 px-4 py-2.5"
      >
        <div>
          <h1 class="text-text-heading m-0 font-semibold [letter-spacing:0] text-[var(--text-lg)]">
            {{ t("onlineEvals.title") }}
          </h1>
        </div>
      </div>

      <OPageHeader
        v-if="hideTabBar && embeddedHeader"
        :title="embeddedHeader.title"
        :subtitle="embeddedHeader.subtitle"
        :icon="embeddedHeader.icon"
        class="border-border-default shrink-0 border-b"
      >
        <template v-if="activeTab === 'scorers' || activeTab === 'scoreConfigs'" #actions>
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                variant="outline"
                size="sm"
                :data-test="`${activeTab}-import`"
                icon-right="expand-more"
              >
                {{ t(`onlineEvals.${importI18nKey}.import.button`) }}
              </OButton>
            </template>
            <ODropdownItem
              :data-test="`${activeTab}-import-custom`"
              @select="activeTab === 'scorers' ? goToImportScorer() : goToImportScoreConfig()"
            >
              <div class="flex flex-col">
                <span>
                  {{ t(`onlineEvals.${importI18nKey}.import.customLabel`) }}
                </span>
                <span class="text-dropdown-item-text text-xs opacity-60">
                  {{ t(`onlineEvals.${importI18nKey}.import.customSubtitle`) }}
                </span>
              </div>
            </ODropdownItem>
            <ODropdownItem
              :data-test="`${activeTab}-import-library`"
              @select="activeTab === 'scorers' ? openScorerLibrary() : openScoreConfigLibrary()"
            >
              <div class="flex flex-col">
                <span>
                  {{ t(`onlineEvals.${importI18nKey}.import.libraryLabel`) }}
                </span>
                <span class="text-dropdown-item-text text-xs opacity-60">
                  {{ t(`onlineEvals.${importI18nKey}.import.librarySubtitle`) }}
                </span>
              </div>
            </ODropdownItem>
          </ODropdown>
          <OButton
            v-if="addButtonLabel"
            :data-test="`${activeTab}-list-add-btn`"
            variant="primary"
            size="sm"
            @click="openCreateDialog"
          >
            {{ addButtonLabel }}
          </OButton>
        </template>
        <template v-else-if="activeTab === 'jobs'" #actions>
          <OButton
            v-if="addButtonLabel"
            data-test="eval-job-list-add-btn"
            variant="primary"
            size="sm"
            @click="openCreateDialog"
          >
            {{ addButtonLabel }}
          </OButton>
        </template>
        <template v-else-if="activeTab === 'quality'" #actions>
          <!-- Agent filter is rendered inside QualityPage (right-aligned, above
               the KPIs) so it sits within the content container alongside the
               data it filters — only the date picker + refresh stay here. -->
          <DateTimePickerDashboard
            ref="qualityDatePickerRef"
            v-model="qualitySelectedDate"
            :auto-apply-dashboard="true"
            data-test="quality-time-range-picker"
          />
          <!-- Bordered wrapper matches the Sessions / LLM Insights headers —
               ORefreshButton renders no border of its own. -->
          <div
            class="border-border-default rounded-default inline-flex h-8 items-center overflow-hidden border px-1"
          >
            <ORefreshButton
              :last-run-at="qualityLastRunAt"
              :loading="qualityRefreshing"
              :disabled="qualityRefreshing"
              data-test="quality-refresh-btn"
              @click="onQualityRefresh"
            />
          </div>
        </template>
      </OPageHeader>

      <section
        class="online-evals__content bg-card-glass-bg flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div
          v-if="!hideTabBar"
          class="online-evals__tabs border-border-default flex shrink-0 items-center gap-2 border-b bg-transparent px-3.5 py-0"
        >
          <button
            v-for="tab in tabs"
            :key="tab.value"
            class="online-evals__tab text-text-muted text-compact inline-flex h-9.5 cursor-pointer items-center gap-1.75 border-0 border-b-2 border-b-transparent bg-transparent px-3.5 py-0 font-semibold"
            :class="
              activeTab === tab.value ? 'is-active text-text-body border-b-accent -mb-px' : ''
            "
            type="button"
            @click="activeTab = tab.value"
          >
            <span>{{ tab.label }}</span>
          </button>
        </div>

        <div class="online-evals__body flex min-h-0 flex-1">
          <QualityPage
            v-if="activeTab === 'quality'"
            ref="qualityPageRef"
            :agent-key="qualityAgentKey"
            :agent-options="qualityAgentOptions"
            :agents-loading="qualityAgentsLoading"
            :date-window="qualityDateWindow"
            :agent-filter="selectedQualityAgent"
            :score-configs="scoreConfigs"
            :configs-loading="isLoading"
            @update:agent-key="onQualityAgentChange"
            @ready="reloadQuality"
          />
          <ScoreConfigList
            v-else-if="activeTab === 'scoreConfigs'"
            :rows="filteredRows as ScoreConfig[]"
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
            @refresh="loadAll(orgId)"
          />
          <ScorerList
            v-else-if="activeTab === 'scorers'"
            :rows="filteredRows as Scorer[]"
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
            @refresh="loadAll(orgId)"
          />
          <EvalJobList
            v-else-if="activeTab === 'jobs'"
            :rows="filteredRows as EvalJob[]"
            :search="filterQuery"
            :loading="isLoading"
            :action-loading="jobsBulkDeleting"
            :pending-status-id="pendingJobStatusId"
            @update:search="filterQuery = $event"
            @create="openCreateDialog"
            @view="(row: EvalJob) => openJobView(row)"
            @edit="(row: EvalJob) => openEditDialog(row)"
            @activate="(row: EvalJob) => activateJob(row)"
            @pause="(row: EvalJob) => pauseJob(row)"
            @delete="(row: EvalJob) => deleteRow(row)"
            @delete-bulk="(ids: string[]) => deleteJobsBulk(ids)"
            @refresh="loadAll(orgId)"
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
        :row="scoreConfigDialogRow"
        @saved="handleSaved"
        @cancel="closeDialog"
      />

      <ODrawer
        bleed
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
        bleed
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
        :title="deleteDialogTitle"
        :message="deleteDialogMessage"
        @update:ok="performDelete"
        @update:cancel="cancelDelete"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeMount, ref, watch } from "vue";
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
import { entityId, statusOf } from "./onlineEvals/utils/evalEntity";
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
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import type { DateWindow } from "./onlineEvals/composables/useQualityData";
import { useAiDateRange, resolveAiDateWindow } from "@/enterprise/composables/useAiDateRange";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import genAiAgentMappingService from "@/services/gen-ai-agent-mapping.service";
import { downloadFile } from "@/utils/dom";
import {
  ALL_AGENTS_VALUE,
  agentFilterKey,
  agentFilterLabel,
  type AgentFilterSelection,
} from "./onlineEvals/utils/agentFilterSql";
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
const formPage = ref<{
  entity: FullPageEntity;
  mode: "create" | "edit";
} | null>(null);

const dialog = ref<{
  open: boolean;
  mode: "create" | "edit";
  row: AnyRow | null;
}>({
  open: false,
  mode: "create",
  row: null,
});

const scorerFormRow = computed(() => dialog.value.row as Scorer | null);
const jobFormRow = computed(() => dialog.value.row as EvalJob | null);
const scoreConfigDialogRow = computed(() => dialog.value.row as ScoreConfig | null);

const viewRow = ref<ScoreConfig | null>(null);
const scorerViewRow = ref<Scorer | null>(null);
const jobViewRow = ref<EvalJob | null>(null);
const pendingJobStatusId = ref<string | null>(null);

const confirmDeleteOpen = ref(false);
const pendingDeleteRow = ref<AnyRow | null>(null);
const pendingDeleteTab = ref<ActiveTab | null>(null);
// Ids for a pending bulk delete (jobs tab). Non-empty => the confirm dialog and
// performDelete operate on the whole batch instead of a single `pendingDeleteRow`.
const pendingBulkDeleteIds = ref<string[]>([]);
const jobsBulkDeleting = ref(false);
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

// Header chrome shown only when embedded in the AI Observability shell —
// mirrors the LLM Insights / Sessions pages so every section in the rail
// shares the same title strip. Title + icon track the active rail item.
const EMBEDDED_HEADER_META: Record<
  ActiveTab,
  { i18nKey: string; subtitleKey: string; icon: IconName }
> = {
  quality: {
    i18nKey: "aiObservability.nav.quality",
    subtitleKey: "aiObservability.subtitle.quality",
    icon: "star-rate",
  },
  jobs: {
    i18nKey: "aiObservability.nav.evalJobs",
    subtitleKey: "aiObservability.subtitle.evalJobs",
    icon: "event",
  },
  scorers: {
    i18nKey: "aiObservability.nav.scorers",
    subtitleKey: "aiObservability.subtitle.scorers",
    icon: "rule",
  },
  scoreConfigs: {
    i18nKey: "aiObservability.nav.scoreConfigs",
    subtitleKey: "aiObservability.subtitle.scoreConfigs",
    icon: "tune",
  },
};

const embeddedHeader = computed<{ title: string; subtitle: string; icon: IconName } | null>(() => {
  const meta = EMBEDDED_HEADER_META[activeTab.value];
  if (!meta) return null;
  return { title: t(meta.i18nKey), subtitle: t(meta.subtitleKey), icon: meta.icon };
});

// Per-tab "create" button label for the embedded OPageHeader. Quality has
// no list-style create, so it returns an empty string and the button is
// suppressed via v-if.
const addButtonLabel = computed<string>(() => {
  switch (activeTab.value) {
    case "jobs":
      return t("onlineEvals.job.newButton");
    case "scorers":
      return t("onlineEvals.scorer.newButton");
    case "scoreConfigs":
      return t("onlineEvals.scoreConfig.newButton");
    default:
      return "";
  }
});

// Maps the active tab to the i18n namespace used by the import dropdown's
// label/subtitle keys — scorers + scoreConfigs share the same shape.
const importI18nKey = computed<"scorer" | "scoreConfig">(() =>
  activeTab.value === "scorers" ? "scorer" : "scoreConfig",
);

// ── Quality tab: date picker + refresh state ─────────────────────────────
// The picker + refresh button live in the embedded OPageHeader's #actions
// slot (matching LLM Insights / Sessions). QualityPage consumes
// `qualityDateWindow` as a prop and exposes `refreshAll` + `isAnyLoading` for
// the Refresh button below.
//
// Date state is the shared `useAiDateRange()` ref — the same singleton
// driving LLM Insights and Sessions — so picking a window on one page
// lands on the other two (incl. across reloads via localStorage).
const { state: qualitySelectedDate } = useAiDateRange();

// Seed the window from the *persisted* AI date range (relative or absolute),
// resolved synchronously, so QualityPage's initial onMounted refresh queries
// the correct window from the very first paint. Fall back to the 15m default
// only if the persisted state can't be resolved.
const initialQualityWindow = resolveAiDateWindow(qualitySelectedDate.value);
const qualityDateWindow = ref<DateWindow>(
  initialQualityWindow
    ? {
        startUs: initialQualityWindow.startTime,
        endUs: initialQualityWindow.endTime,
      }
    : {
        startUs: (Date.now() - 15 * 60 * 1000) * 1000,
        endUs: Date.now() * 1000,
      },
);
const qualityAgents = ref<AgentFilterSelection[]>([]);
const qualityAgentKey = ref(ALL_AGENTS_VALUE);
const qualityDatePickerRef = ref<{
  getConsumableDateTime: () => { startTime: number; endTime: number };
} | null>(null);
const qualityPageRef = ref<{
  refreshAll: () => Promise<void>;
  isAnyLoading: boolean;
} | null>(null);

const qualityAgentOptions = computed(() => [
  { label: "All Agents", value: ALL_AGENTS_VALUE },
  ...qualityAgents.value.map((agent) => ({
    label: agentFilterLabel(agent),
    value: agentFilterKey(agent),
  })),
]);

const selectedQualityAgent = computed<AgentFilterSelection | null>(() => {
  if (qualityAgentKey.value === ALL_AGENTS_VALUE) return null;
  return (
    qualityAgents.value.find((agent) => agentFilterKey(agent) === qualityAgentKey.value) ?? null
  );
});

// True while the agent list is being fetched (the FIRST phase of reloadQuality,
// before any quality data loader runs). QualityPage uses this to skeleton the
// agent dropdown + the KPI/table so the page reads as "loading" from the very
// start of a reload instead of looking idle until the data queries kick in.
const qualityAgentsLoading = ref(false);

async function loadQualityAgents() {
  const { startUs, endUs } = qualityDateWindow.value;
  if (!orgId.value || !startUs || !endUs) return;
  qualityAgentsLoading.value = true;
  try {
    const response = await genAiAgentMappingService.listAgents(orgId.value, startUs, endUs);
    qualityAgents.value = response.agents;
    if (
      qualityAgentKey.value !== ALL_AGENTS_VALUE &&
      !qualityAgents.value.some((agent) => agentFilterKey(agent) === qualityAgentKey.value)
    ) {
      qualityAgentKey.value = ALL_AGENTS_VALUE;
    }
  } catch (err) {
    console.warn("Failed to load GenAI agents", err);
    qualityAgents.value = [];
    qualityAgentKey.value = ALL_AGENTS_VALUE;
  } finally {
    qualityAgentsLoading.value = false;
  }
}

function syncQualityDateWindow() {
  const picker = qualityDatePickerRef.value;
  if (!picker) return;
  const dt = picker.getConsumableDateTime();
  if (dt && typeof dt.startTime === "number" && typeof dt.endTime === "number") {
    qualityDateWindow.value = { startUs: dt.startTime, endUs: dt.endTime };
  }
}

// ── Quality reload orchestration ─────────────────────────────────────────
// ONE path drives every quality fetch. Exactly three triggers reload
// everything (agent list + KPIs + table + charts):
//   1. The Quality page mounts            → @ready
//   2. The user clicks Refresh            → onQualityRefresh
//   3. The date-time window changes       → watch(qualitySelectedDate)
// All three run the SAME sequence: re-anchor the window from the picker, load
// the agent list FIRST, then load the quality data — so the agent filter is
// always populated before the data it scopes is fetched.
//
// Changing the agent filter is a data-only reload (the agent list itself is
// unchanged) and is handled separately by onQualityAgentChange below.
const qualityReloading = ref(false);

async function reloadQuality() {
  qualityReloading.value = true;
  try {
    // On the @ready trigger this runs from QualityPage's onMounted; wait a
    // tick so the parent's `qualityPageRef` is guaranteed assigned before we
    // call into it.
    await nextTick();
    syncQualityDateWindow();
    await loadQualityAgents();
    await qualityPageRef.value?.refreshAll?.();
  } finally {
    qualityReloading.value = false;
  }
}

// Trigger 2 — Refresh button. Re-anchors relative ranges ("Past 15 minutes")
// to "now" via the shared reload path.
function onQualityRefresh() {
  void reloadQuality();
}

// Trigger 3 — date-time change. DateTimePickerDashboard's inner DateTime emits
// `update:modelValue` ONCE on mount (its onMounted calls saveDate → on:date-change),
// re-anchoring qualitySelectedDate to the same window it already holds. That echo
// would fire a second full reloadQuality on top of the @ready one, double-hitting
// every quality API. The picker remounts every time the quality tab is (re-)entered
// (it lives in the tab-scoped header slot), so this echo recurs on each entry — not
// just first load. `qualityDateEchoPending` is armed on entry (see watch(activeTab))
// and here swallows exactly the next (mount) change; genuine user date changes reload.
let qualityDateEchoPending = true;
watch(qualitySelectedDate, () => {
  if (qualityDateEchoPending) {
    qualityDateEchoPending = false;
    return;
  }
  void reloadQuality();
});

// Org switch — reset the agent filter and reload from scratch.
watch(orgId, () => {
  qualityAgentKey.value = ALL_AGENTS_VALUE;
  void reloadQuality();
});

// User picked a different agent — only the data needs refetching; the agent
// list is unchanged. Driven explicitly from the dropdown's update event (not a
// watch on the key) so the programmatic reset inside loadQualityAgents()
// during reloadQuality() never double-fires a data reload.
async function onQualityAgentChange(key: string) {
  qualityAgentKey.value = key;
  // `selectedQualityAgent` → the `agent-filter` prop → the child's
  // `agentFilterRef` only update on the next render tick. Wait for it so
  // `refreshAll()` queries the newly selected agent, not the previous one.
  await nextTick();
  await qualityPageRef.value?.refreshAll?.();
}

// Aggregated "is a quality reload in flight" — covers the agent-load phase
// plus every in-flight QualityPage loader, so the Refresh button spins from
// click to settle.
const qualityRefreshing = computed(
  () => qualityReloading.value || (qualityPageRef.value?.isAnyLoading ?? false),
);

// Last-refresh timestamp for the header's ORefreshButton — stamped when a
// reload settles (true → false), mirroring the Sessions / LLM Insights pages.
const qualityLastRunAt = ref<number | null>(null);
watch(qualityRefreshing, (isLoading, wasLoading) => {
  if (wasLoading && !isLoading) qualityLastRunAt.value = Date.now();
});

const currentSingularLabel = computed(() => t(`onlineEvals.singular.${activeTab.value}`));

const pendingDeleteLabel = computed(() => {
  const tab = pendingDeleteTab.value;
  if (!tab || tab === "quality") return t("onlineEvals.actions.delete");
  return t("onlineEvals.deleteTitle", {
    label: t(`onlineEvals.singular.${tab}`),
  });
});

const isBulkDelete = computed(() => pendingBulkDeleteIds.value.length > 0);

const deleteDialogTitle = computed(() =>
  isBulkDelete.value ? t("onlineEvals.job.deleteBulkTitle") : pendingDeleteLabel.value,
);

const deleteDialogMessage = computed(() =>
  isBulkDelete.value
    ? t("onlineEvals.job.deleteBulkConfirm", {
        count: pendingBulkDeleteIds.value.length,
      })
    : t("onlineEvals.deleteConfirmMessage", {
        name: pendingDeleteRow.value?.name ?? "",
      }),
);

watch(activeTab, (next) => {
  filterQuery.value = "";
  // Re-arm the date-picker mount-echo guard: entering quality remounts the
  // picker, which emits `update:modelValue` once on mount. @ready already owns
  // the entry reload, so that echo must be swallowed to avoid a double fetch.
  if (next === "quality") qualityDateEchoPending = true;
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
  const selected = scorers.value.filter(
    (row) => ids.includes(entityId(row)) || ids.includes(row.id),
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
  const selected = scoreConfigs.value.filter(
    (row) => ids.includes(entityId(row)) || ids.includes(row.id),
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
  // The import wizard renders off local `importingEntity` (it isn't route-
  // driven), so it must be torn down here too — otherwise it stays stranded on
  // screen when the user navigates to another AI section.
  importingEntity.value = null;
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

function deleteJobsBulk(ids: string[]) {
  if (ids.length === 0) return;
  pendingBulkDeleteIds.value = [...ids];
  pendingDeleteTab.value = "jobs";
  confirmDeleteOpen.value = true;
}

function cancelDelete() {
  confirmDeleteOpen.value = false;
  pendingDeleteRow.value = null;
  pendingDeleteTab.value = null;
  pendingBulkDeleteIds.value = [];
}

async function performDelete() {
  if (pendingBulkDeleteIds.value.length > 0) {
    await performBulkJobsDelete();
    return;
  }
  const row = pendingDeleteRow.value;
  const tab = pendingDeleteTab.value;
  if (!row || !tab) return;
  const singular = t(`onlineEvals.singular.${tab}`);
  try {
    if (tab === "scoreConfigs")
      await onlineEvalsService.scoreConfigs.delete(orgId.value, entityId(row as ScoreConfig));
    else if (tab === "scorers")
      await onlineEvalsService.scorers.delete(orgId.value, entityId(row as Scorer));
    else if (tab === "jobs") await onlineEvalsService.jobs.delete(orgId.value, (row as EvalJob).id);

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

// Bulk-delete the selected eval jobs. Deletions run in parallel; if any fail we
// surface an error but still reload so the successfully deleted rows disappear.
async function performBulkJobsDelete() {
  const ids = [...pendingBulkDeleteIds.value];
  if (ids.length === 0) return;
  jobsBulkDeleting.value = true;
  try {
    const results = await Promise.allSettled(
      ids.map((id) => onlineEvalsService.jobs.delete(orgId.value, id)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      showError(
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult)?.reason,
        t("onlineEvals.deleteError", {
          label: t("onlineEvals.singular.jobs").toLowerCase(),
        }),
      );
    } else {
      toast({
        variant: "success",
        message: t("onlineEvals.job.deletedBulk", { count: ids.length }),
      });
    }
    await loadAll(orgId.value);
  } finally {
    pendingBulkDeleteIds.value = [];
    pendingDeleteTab.value = null;
    jobsBulkDeleting.value = false;
  }
}
</script>
