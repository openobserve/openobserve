<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  Workflows list page (todo #3).

  Mirrors the Pipelines/Alerts list patterns: OPageLayout chrome (it owns the
  OPageHeader), an OTable body with search toolbar + preset empty state +
  per-row actions.

  Enable/disable is a per-row action (pause/resume); the standalone Status column
  is intentionally NOT shown (state is conveyed by the pause/resume action icon).
  No run-log in the list response yet (Last Run column omitted until B6).
-->
<template>
  <div
    v-if="currentRouteName === 'workflows'"
    data-test="workflows-list-page"
    class="flex h-full min-h-0 flex-col"
  >
    <!-- OPageLayout owns the header now (it renders OPageHeader from these props
         and forwards #title/#actions), so there is no nested header component and
         no header-class: it draws its own bottom border. `bleed` keeps the table
         flush to the page edge, as the old main-panel=false layout did. -->
    <OPageLayout
      :title="t('workflow.header')"
      :subtitle="t('workflow.subtitle')"
      icon="schema"
      bleed
    >
      <!-- Beta tag rides INSIDE the title line. `#title-trail` would place it
           after the whole title+subtitle column — i.e. past the subtitle's
           width — leaving it stranded far from the word "Workflows". -->
      <template #title>
        <span class="inline-flex items-center gap-2">
          {{ t("workflow.header") }}
          <BetaBadge />
        </span>
      </template>
      <template #sidebar>
        <FolderList type="workflows" @update:activeFolderId="onFolderChange" />
      </template>
      <template #actions>
        <!-- v1: only the Alert Fired trigger exists, so New Workflow goes
             straight to the editor (which pre-places the Alert Trigger). -->
        <OButton
          data-test="workflow-list-add-btn"
          variant="primary"
          size="sm"
          @click="openCreateEditor()"
        >
          {{ t("workflow.create") }}
        </OButton>
      </template>

      <div class="h-full min-h-0 overflow-hidden">
        <div class="card-container h-full">
          <OTable
            ref="oTableRef"
            :frame="false"
            data-test="workflow-list-table"
            :data="filteredWorkflows"
            :columns="otableColumns"
            row-key="id"
            :loading="loading"
            :forbidden="forbidden"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            :enable-column-resize="true"
            :persist-columns="true"
            :default-columns="false"
            :footer-title="t('workflow.header')"
            table-id="workflows-workflow-list"
            width="100%"
            class="h-full w-full"
            :current-page="currentPage"
            @update:current-page="onPageChange"
            @row-click="openRuns"
          >
            <template #toolbar>
              <div
                class="@container/workflow-toolbar flex min-w-0 flex-1 flex-wrap items-center gap-2 gap-y-1.5 max-md:contents"
              >
                <OToggleGroup
                  :model-value="activeTab"
                  mobile-dropdown
                  data-test="workflow-list-tabs"
                  @update:model-value="(v) => (activeTab = (v as string) || 'all')"
                >
                  <OToggleGroupItem
                    v-for="tab in workflowTabs"
                    :key="tab.value"
                    :value="tab.value"
                    size="sm"
                    :data-test="`workflow-list-tab-${tab.value}`"
                  >
                    {{ tab.label }}
                  </OToggleGroupItem>
                </OToggleGroup>
                <div class="min-w-0 flex-1 max-md:min-w-40">
                  <OInput
                    data-test="workflow-list-search-input"
                    v-model="filterQuery"
                    class="w-full"
                    :placeholder="t('workflow.search')"
                  >
                    <template #icon-left>
                      <OIcon name="search" size="sm" />
                    </template>
                    <template #icon-right>
                      <OToggleGroup
                        :model-value="searchAcrossFolders ? 'all' : 'this'"
                        type="single"
                        class="me-1 self-center"
                        @update:model-value="(v) => onFolderScopeChange(v as string)"
                      >
                        <OToggleGroupItem
                          value="this"
                          size="xs"
                          icon-left="folder-outline"
                          data-test="workflow-list-search-scope-current"
                          :title="t('workflow.searchThisFolderTooltip')"
                          ><span class="max-md:hidden @max-[34rem]/workflow-toolbar:hidden">{{
                            t("workflow.searchThisFolder")
                          }}</span></OToggleGroupItem
                        >
                        <OToggleGroupItem
                          value="all"
                          size="xs"
                          icon-left="search"
                          data-test="workflow-list-search-across-folders-toggle"
                          :title="t('workflow.searchAllFoldersTooltip')"
                          ><span class="max-md:hidden @max-[34rem]/workflow-toolbar:hidden">{{
                            t("workflow.searchAllFolders")
                          }}</span></OToggleGroupItem
                        >
                      </OToggleGroup>
                    </template>
                  </OInput>
                </div>
              </div>
            </template>

            <template #toolbar-trailing>
              <ORefreshButton
                layout="inline"
                variant="outline"
                :last-run-at="lastUpdatedAt"
                :loading="fetching"
                data-test="workflow-list-refresh"
                @click="refreshWorkflows"
              />
            </template>

            <template #cell-name="{ row }">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate">{{ row.name }}</span>
                <OTag
                  v-if="row.is_draft"
                  :value="t('workflow.draft')"
                  variant="default-soft"
                  data-test="workflow-list-draft-tag"
                />
              </div>
            </template>

            <template #cell-folder_name="{ row }">
              {{ row.folder_name || t("common.defaultLabel") }}
            </template>

            <template #cell-updated_at="{ row }">
              <span>{{ row.updated_at_display }}</span>
            </template>

            <template #cell-trigger="{ row }">
              <OTag
                v-if="row.trigger && row.trigger !== '—'"
                :value="row.trigger"
                variant="amber-soft"
                data-test="workflow-list-trigger-tag"
              />
            </template>

            <template #cell-actions="{ row }">
              <div class="actions-container flex items-center">
                <!-- Drafts aren't runnable, so the pause/resume icon is simply
                     omitted (no placeholder). -->
                <OButton
                  v-if="!row.is_draft"
                  :data-test="`workflow-list-${row.name}-pause-start-action`"
                  :data-row-action="row.enabled ? 'pause' : 'resume'"
                  :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
                  size="icon-sm"
                  :icon-left="row.enabled ? 'pause' : 'play-arrow'"
                  class="max-md:hidden"
                  @click.stop="toggleWorkflow(row)"
                >
                  <OTooltip
                    side="bottom"
                    :content="row.enabled ? t('alerts.pause') : t('alerts.start')"
                  />
                </OButton>
                <OButton
                  :data-test="`workflow-list-${row.name}-view`"
                  variant="ghost"
                  size="icon-sm"
                  icon-left="visibility"
                  :title="t('workflow.view')"
                >
                  <OTooltip max-width="none" side="left">
                    <template #content><WorkflowView :workflow="row" /></template>
                  </OTooltip>
                </OButton>
                <OButton
                  :data-test="`workflow-list-${row.name}-edit`"
                  variant="ghost"
                  size="icon-sm"
                  icon-left="edit"
                  class="max-md:hidden"
                  @click.stop="editWorkflow(row)"
                >
                  <OTooltip side="bottom" :content="t('workflow.edit')" />
                </OButton>
                <OButton
                  v-if="!row.is_draft"
                  :data-test="`workflow-list-${row.name}-move`"
                  variant="ghost"
                  size="icon-sm"
                  icon-left="drive-file-move"
                  :title="t('workflow.moveToFolder')"
                  @click.stop="openMoveDialog(row)"
                >
                  <OTooltip side="bottom" :content="t('workflow.moveToFolder')" />
                </OButton>
                <ODropdown align="end">
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="icon-sm"
                      icon-left="more-vert"
                      :data-test="`workflow-list-${row.name}-more-options`"
                      @click.stop
                    />
                  </template>
                  <ODropdownItem
                    v-if="!row.is_draft"
                    :icon-left="row.enabled ? 'pause' : 'play-arrow'"
                    class="md:hidden"
                    :data-test="`workflow-list-${row.name}-pause-start-action-menu`"
                    @select="toggleWorkflow(row)"
                  >
                    <span>{{ row.enabled ? t("alerts.pause") : t("alerts.start") }}</span>
                  </ODropdownItem>
                  <ODropdownItem
                    icon-left="edit"
                    class="md:hidden"
                    :data-test="`workflow-list-${row.name}-edit-menu`"
                    @select="editWorkflow(row)"
                  >
                    <span>{{ t("workflow.edit") }}</span>
                  </ODropdownItem>
                  <ODropdownItem
                    :data-test="`workflow-list-${row.name}-delete`"
                    variant="destructive"
                    @select="openDeleteDialog(row)"
                  >
                    <template #icon-left><OIcon size="sm" name="delete" /></template>
                    {{ t("workflow.delete") }}
                  </ODropdownItem>
                </ODropdown>
              </div>
            </template>

            <template #empty>
              <OEmptyState
                size="hero"
                preset="no-workflows"
                :filtered="!!filterQuery || activeTab !== 'all'"
                @action="(id) => (id === 'clear-filters' ? clearFilters() : openCreateEditor())"
              />
            </template>

            <template #bottom>
              <!-- h-12 / w-50 are exact rem equivalents of the pixel sizes this
                   footer used to hardcode, so it renders unchanged. The old margin class was
                   dropped — a legacy CSS-framework class this repo does not
                   generate, so it never applied. -->
              <div class="flex h-12 w-full items-center justify-between">
                <div class="o2-table-footer-title flex w-50 items-center max-md:hidden">
                  {{ resultTotal }} {{ t("workflow.header") }}
                </div>
              </div>
            </template>
          </OTable>
        </div>
      </div>
    </OPageLayout>
  </div>

  <!-- Editor (add/edit) renders here as a child route. On a successful save it
       emits `saved`, so this parent refreshes the list — no route watcher. -->
  <router-view v-else v-slot="{ Component }">
    <component :is="Component" @saved="onEditorSaved" />
  </router-view>

  <MoveAcrossFolders
    v-model:open="showMoveDialog"
    :activeFolderId="activeFolderId"
    :moduleId="workflowIdsToMove"
    type="workflows"
    @updated="onMoveUpdated"
    data-test="workflow-move-to-another-folder-dialog"
  />

  <ConfirmDialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    v-model="confirmDialogMeta.show"
  />
</template>

<script setup lang="ts">
import { workflowKeys } from "@/services/workflows.querykeys";
import { workflowFolderQuery, workflowSearchQuery } from "@/services/workflows.queries";
import { queryClient } from "@/composables/query/queryClient";
import { ref, computed, defineAsyncComponent, onMounted, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import { getFoldersListByType } from "@/utils/commons";
const MoveAcrossFolders = defineAsyncComponent(
  () => import("@/components/common/sidebar/MoveAcrossFolders.vue"),
);
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import WorkflowView from "@/components/workflows/WorkflowView.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { TABLE_INDEX_COL_SIZE, COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";

import workflowService from "@/services/workflows";
import { hydrateWorkflow, triggerDef } from "@/plugins/workflows/useWorkflowCanvas";
import { DEFAULT_TRIGGER_KIND, enabledTriggers } from "@/plugins/workflows/triggers";

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();

// The folder lives in the URL so a folder view is linkable and survives a reload.
const activeFolderId = computed(() => (route.query.folder as string) || "default");

// Tabs come from the trigger registry, so enabling another trigger kind adds its
// tab without touching this file.
const activeTab = ref("all");
const workflowTabs = computed(() => [
  { value: "all", label: t("workflow.tabAll") },
  ...enabledTriggers().map((tr) => ({ value: tr.kind, label: t(tr.tabLabelKey ?? tr.labelKey) })),
]);

const searchAcrossFolders = ref(false);

const showMoveDialog = ref(false);
const workflowIdsToMove = ref<string[]>([]);

const openMoveDialog = (row: any) => {
  workflowIdsToMove.value = [row.id];
  showMoveDialog.value = true;
};

const onMoveUpdated = () => {
  showMoveDialog.value = false;
  workflowIdsToMove.value = [];
  invalidateWorkflowsCache();
  getWorkflows();
};

const onFolderChange = (folderId: string) => {
  router.push({
    query: { ...route.query, org_identifier: orgId.value, folder: folderId },
  });
};
const store = useStore();

const currentRouteName = computed(() => router.currentRoute.value.name);
const orgId = computed(() => store.state.selectedOrganization.identifier as string);

const shapeWorkflows = (list: any[]) =>
  list.map((wf: any, index: number) => ({
    ...wf,
    "#": index + 1 <= 9 ? `0${index + 1}` : index + 1,
    trigger: triggerLabel(wf),
    updated_at_display: formatTs(wf.updated_at),
  }));

const loading = ref(true);
// Separate from `loading`, the cold-read skeleton: this spins the refresh button on every read.
const fetching = ref(false);
const lastUpdatedAt = ref<number | null>(null);
const forbidden = ref(false);
const filterQuery = ref("");

// Cross-folder is a search mode, not a browse mode: with an empty box the list
// stays in the selected folder, matching the Alerts and Dashboards lists. That
// also avoids pulling the org's entire set just because the toggle is on.
const crossFolderActive = computed(
  () => searchAcrossFolders.value && filterQuery.value.trim() !== "",
);

// Driven off the URL, so it covers browser back/forward as well as rail clicks.
// A cross-folder search would otherwise keep showing org-wide results under the
// newly selected folder.
watch(activeFolderId, (folderId) => {
  if (searchAcrossFolders.value) {
    searchAcrossFolders.value = false;
    filterQuery.value = "";
  }
  getWorkflows(folderId);
});

// The type tab filters the table too, so it has to clear with the query.
const clearFilters = () => {
  filterQuery.value = "";
  activeTab.value = "all";
  // The toggle would otherwise stay lit on "All folders" while the list drops back
  // to the current one. Refetched here because the query watcher then no-ops.
  if (searchAcrossFolders.value) {
    searchAcrossFolders.value = false;
    getWorkflows();
  }
};

const onFolderScopeChange = (v: string) => {
  const across = v === "all";
  if (across === searchAcrossFolders.value) return;
  searchAcrossFolders.value = across;
  getWorkflows();
};

// The cross-folder term is matched by the backend, so re-fetch as it changes
// rather than on every keystroke.
let searchDebounce: ReturnType<typeof setTimeout> | undefined;
watch(filterQuery, () => {
  if (!searchAcrossFolders.value) return;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => getWorkflows(), 300);
});

const workflows = ref<any[]>([]);
const oTableRef: any = ref(null);
// Plain ref, not URL/store-backed: WorkflowsList stays mounted across create/edit/runs child-route navigation, so this alone survives the round trip.
const currentPage = ref(1);
const onPageChange = (page: number) => {
  currentPage.value = page;
};

// setTimeout(0) is a macrotask, so it runs after TanStack's own deferred auto-reset-on-data-change (its own microtask queue), letting the restored page win.
const restorePageIndex = () => {
  setTimeout(() => {
    oTableRef.value?.restorePage?.(currentPage.value);
  }, 0);
};

const filteredWorkflows = computed(() => {
  const q = filterQuery.value.trim().toLowerCase();
  const tab = activeTab.value;
  return workflows.value.filter((w) => {
    if (tab !== "all" && triggerKind(w) !== tab) return false;
    // In cross-folder mode the backend already applied the same filter.
    if (!q || crossFolderActive.value) return true;
    return w.name?.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q);
  });
});

const resultTotal = computed(() => filteredWorkflows.value.length);

// The list API has no `trigger` field — it returns each workflow's full `nodes`
// array, so we derive the Trigger label from the trigger node in the graph.
// The trigger node serializes as { node_type: "workflow_trigger" }
// (NodeData::WorkflowTrigger, serde tag = "node_type", snake_case).
// v1 has one kind (alert-fired); once B1 adds WorkflowTriggerParams.kind we can
// map data.kind -> a per-kind label here.
// The kind drives the type tabs; the label is only for display.
const triggerKind = (wf: any): string => {
  const triggerNode = (wf.nodes || []).find((n: any) => n.data?.node_type === "workflow_trigger");
  return triggerNode?.data?.trigger_kind || triggerNode?.meta?.trigger_kind || DEFAULT_TRIGGER_KIND;
};

const triggerLabel = (wf: any): string => {
  const triggerNode = (wf.nodes || []).find((n: any) => n.data?.node_type === "workflow_trigger");
  if (!triggerNode) return "—";
  // Kind lives in data.trigger_kind (fresh) or meta.trigger_kind (from the API);
  // the registry resolves it to a label (and defaults for legacy/unset kinds).
  const kind = triggerNode.data?.trigger_kind || triggerNode.meta?.trigger_kind;
  return t(triggerDef(kind).labelKey);
};

const formatTs = (ts?: number): string => {
  if (!ts) return "—";
  // O2 timestamps are microseconds; fall back gracefully for ms/seconds.
  const ms = ts > 1e14 ? ts / 1000 : ts;
  return new Date(ms).toLocaleString();
};

const columns = computed<OTableColumnDef<any>[]>(() => [
  {
    id: "#",
    header: raw("#"),
    accessorKey: "#",
    sortable: false,
    size: TABLE_INDEX_COL_SIZE,
    meta: { align: "left" },
  },
  {
    id: "name",
    header: t("common.name"),
    accessorKey: "name",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.name,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "description",
    header: t("common.description"),
    accessorKey: "description",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.description,
    meta: { align: "left" },
  },
  {
    id: "trigger",
    header: t("workflow.trigger"),
    accessorKey: "trigger",
    sortable: true,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "updated_at",
    header: t("workflow.updated"),
    // Sort the raw microseconds; the formatted string sorts lexicographically,
    // which puts every PM row ahead of every AM one.
    accessorKey: "updated_at",
    meta: { align: "left" },
    sortable: true,
    resizable: true,
    hideable: true,
  },
  {
    id: "actions",
    header: t("workflow.actions"),
    sortable: false,
    isAction: true,
    meta: { align: "center", cellClass: "actions-column", actionCount: 5 },
  },
]);
const otableColumns = computed(() => {
  // The rail already names the folder when scoped to one, so the column only
  // earns its width when rows can come from several.
  if (!crossFolderActive.value) return columns.value;
  const cols = [...columns.value];
  cols.splice(2, 0, {
    id: "folder_name",
    header: t("workflow.folder"),
    accessorKey: "folder_name",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.folder,
    meta: { align: "left" },
  });
  return cols;
});

// The list on screen, and the newest read: a slower earlier read must not overwrite a later folder or search.
let shownListKey = "";
let latestRead = 0;

const getWorkflows = async (folderId?: string, force = false) => {
  const options = crossFolderActive.value
    ? workflowSearchQuery(orgId.value, filterQuery.value.trim())
    : workflowFolderQuery(orgId.value, folderId ?? activeFolderId.value);
  const read = ++latestRead;
  const listKey = JSON.stringify(options.queryKey);
  // Only a switch to another list repaints up front: a reload of the same list keeps its rows, including an in-place toggle.
  if (listKey !== shownListKey) {
    shownListKey = listKey;
    const cached = queryClient.getQueryData<any[]>(options.queryKey);
    workflows.value = cached ? shapeWorkflows(cached) : [];
    lastUpdatedAt.value = cached
      ? (queryClient.getQueryState(options.queryKey)?.dataUpdatedAt ?? null)
      : null;
    loading.value = !cached;
  }
  fetching.value = true;
  forbidden.value = false;
  try {
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const list = await queryClient.fetchQuery(options);
    if (read !== latestRead) return;
    workflows.value = shapeWorkflows(list);
    // The cache records the fetch time; fetchQuery does not hand it back.
    lastUpdatedAt.value = queryClient.getQueryState(options.queryKey)?.dataUpdatedAt ?? Date.now();
  } catch (error: any) {
    if (read !== latestRead) return;
    console.error(error);
    forbidden.value = error?.response?.status === 403;
  } finally {
    if (read === latestRead) {
      loading.value = false;
      fetching.value = false;
    }
  }
};

// Named handler: binding getWorkflows straight to @click would put the MouseEvent in `folderId`.
const refreshWorkflows = () => getWorkflows(undefined, true);

// Every workflow read shares this scope, so a write here expires the folder lists, searches and the alert form's picker.
const invalidateWorkflowsCache = () =>
  queryClient.invalidateQueries({ queryKey: workflowKeys.all(orgId.value) });

// --- navigation --------------------------------------------------------------
// Every child route carries the folder. The list is the PARENT route, so pushing
// a child replaces the whole query: drop `folder` and the list behind the editor
// silently snaps back to the default folder, and so does the return trip.
// A row's own folder wins over the one being browsed, which is what a
// cross-folder search result needs.
const folderFor = (row?: any) => row?.folder_id || activeFolderId.value;

// New Workflow -> editor on an EMPTY canvas; the trigger is chosen there (the
// canvas start node opens the trigger picker), so create carries no trigger
// kind. The workflow is created on Save, into the folder in the URL.
const openCreateEditor = () => {
  router.push({
    name: "createWorkflow",
    query: { org_identifier: orgId.value, folder: activeFolderId.value },
  });
};

// Hydrate the shared editor state from the row synchronously (pipeline pattern)
// so the editor has the name + full graph immediately — no async re-fetch.
const editWorkflow = (row: any) => {
  hydrateWorkflow(row);
  router.push({
    name: "workflowEditor",
    query: {
      id: row.id,
      name: row.name,
      org_identifier: orgId.value,
      folder: folderFor(row),
    },
  });
};

// Row click → the dedicated read-only Runs view (viewing runs is the common
// case; editing is the explicit pencil action). Hydrate from the row so the
// canvas renders immediately — no async re-fetch. DRAFTS have no run history by
// design, so a draft row opens straight in the editor instead.
const openRuns = (row: any) => {
  if (!row?.id) return;
  if (row.is_draft) {
    editWorkflow(row);
    return;
  }
  hydrateWorkflow(row);
  router.push({
    name: "workflowRuns",
    query: {
      id: row.id,
      name: row.name,
      org_identifier: orgId.value,
      folder: folderFor(row),
    },
  });
};

// --- enable / disable (pause / resume) --------------------------------------
// Simpler than pipelines (no realtime/from-now resume dialog): just flip state.
const toggleWorkflow = (row: any) => {
  const newState = !row.enabled;
  workflowService
    .enableWorkflow({
      org_identifier: orgId.value,
      id: row.id,
      value: newState,
    })
    .then(() => {
      row.enabled = newState;
      toast({
        message: newState
          ? t("workflow.resumeSuccess", { name: row.name })
          : t("workflow.pauseSuccess", { name: row.name }),
        variant: "success",
      });
      invalidateWorkflowsCache();
      getWorkflows();
    })
    .catch((error: any) => {
      if (error?.response?.status !== 403) {
        toast({
          message: error?.response?.data?.message || t("workflow.toggleError"),
          variant: "error",
        });
      }
    });
};

// --- delete ------------------------------------------------------------------
const confirmDialogMeta: any = ref({
  show: false,
  title: "",
  message: "",
  data: null,
  onConfirm: () => {},
});

const resetConfirmDialog = () => {
  confirmDialogMeta.value.show = false;
  confirmDialogMeta.value.data = null;
  confirmDialogMeta.value.onConfirm = () => {};
};

const openDeleteDialog = (row: any) => {
  confirmDialogMeta.value.show = true;
  confirmDialogMeta.value.title = t("workflow.deleteTitle");
  confirmDialogMeta.value.message = t("workflow.deleteMessage");
  confirmDialogMeta.value.data = row;
  confirmDialogMeta.value.onConfirm = deleteWorkflow;
};

const deleteWorkflow = async () => {
  const row = confirmDialogMeta.value.data;
  if (!row) return;
  try {
    await workflowService.deleteWorkflow({
      org_identifier: orgId.value,
      id: row.id,
      draft: !!row.is_draft,
    });
    toast({ message: t("workflow.deleteSuccess"), variant: "success" });
    invalidateWorkflowsCache();
    await getWorkflows();
  } catch (error: any) {
    if (error?.response?.status !== 403) {
      toast({
        message: error?.response?.data?.message || t("workflow.deleteError"),
        variant: "error",
      });
    }
  } finally {
    resetConfirmDialog();
  }
};

// Chained (not fire-and-forget) so restorePageIndex schedules its macrotask after the fetch's data update, not before.
const onEditorSaved = async () => {
  invalidateWorkflowsCache();
  await refreshWorkflows();
  restorePageIndex();
};

onMounted(async () => {
  // Started first: the list does not need the folders, and a cached one should paint without waiting on them.
  const listRead = getWorkflows();
  // FolderList reads the store, so the folders must be there before it renders.
  await getFoldersListByType(store, "workflows").catch((err: unknown) =>
    console.error("failed to load workflow folders", err),
  );
  await listRead;
  restorePageIndex();
});
</script>
