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
    class="flex flex-col h-full min-h-0"
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

      <div class="flex-1 min-h-0 overflow-hidden">
        <div class="card-container h-full">
          <OTable
            :frame="false"
            data-test="workflow-list-table"
            :data="filteredWorkflows"
            :columns="otableColumns"
            row-key="id"
            :loading="loading"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            :enable-column-resize="true"
            :persist-columns="true"
            :default-columns="false"
            :footer-title="t('workflow.header')"
            table-id="workflows-workflow-list"
            width="100%"
            class="w-full h-full"
            @row-click="openRuns"
          >
            <template #toolbar>
              <div class="flex items-center gap-2 w-full">
                <div class="flex-1 min-w-0">
                  <OInput
                    data-test="workflow-list-search-input"
                    v-model="filterQuery"
                    class="w-full"
                    :placeholder="t('workflow.search')"
                  >
                    <template #icon-left>
                      <OIcon name="search" size="sm" />
                    </template>
                  </OInput>
                </div>
              </div>
            </template>

            <template #toolbar-trailing>
              <OButton
                variant="outline"
                size="icon-sm"
                icon-left="refresh"
                :loading="loading"
                data-test="workflow-list-refresh"
                @click="getWorkflows"
              >
                <OTooltip side="bottom" :content="t('workflow.refresh')" />
              </OButton>
            </template>

            <template #cell-trigger="{ row }">
              <OTag
                :value="row.trigger"
                variant="amber-soft"
                data-test="workflow-list-trigger-tag"
              />
            </template>

            <template #cell-actions="{ row }">
              <div class="flex items-center actions-container">
                <OButton
                  :data-test="`workflow-list-${row.name}-pause-start-action`"
                  :data-row-action="row.enabled ? 'pause' : 'resume'"
                  :variant="row.enabled ? 'ghost-destructive' : 'ghost'"
                  size="icon-sm"
                  :icon-left="row.enabled ? 'pause' : 'play-arrow'"
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
                  @click.stop="editWorkflow(row)"
                >
                  <OTooltip side="bottom" :content="t('workflow.edit')" />
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
                :filtered="!!filterQuery"
                @action="
                  (id) =>
                    id === 'clear-filters' ? (filterQuery = '') : openCreateEditor()
                "
              />
            </template>

            <template #bottom>
              <!-- h-12 / w-50 are exact rem equivalents of the pixel sizes this
                   footer used to hardcode, so it renders unchanged. `mr-md` was
                   dropped — a Quasar-style class this repo does not generate, so
                   it never applied. -->
              <div class="flex w-full justify-between items-center h-12">
                <div class="o2-table-footer-title flex items-center w-50">
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
    <component :is="Component" @saved="getWorkflows" />
  </router-view>

  <ConfirmDialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    v-model="confirmDialogMeta.show"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import WorkflowView from "@/components/workflows/WorkflowView.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

import workflowService from "@/services/workflows";
import { hydrateWorkflow } from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const currentRouteName = computed(() => router.currentRoute.value.name);
const orgId = computed(
  () => store.state.selectedOrganization.identifier as string,
);

const loading = ref(true);
const filterQuery = ref("");
const workflows = ref<any[]>([]);

const filteredWorkflows = computed(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return workflows.value;
  return workflows.value.filter(
    (w) =>
      w.name?.toLowerCase().includes(q) ||
      w.description?.toLowerCase().includes(q),
  );
});

const resultTotal = computed(() => filteredWorkflows.value.length);

// The list API has no `trigger` field — it returns each workflow's full `nodes`
// array, so we derive the Trigger label from the trigger node in the graph.
// The trigger node serializes as { node_type: "workflow_trigger" }
// (NodeData::WorkflowTrigger, serde tag = "node_type", snake_case).
// v1 has one kind (alert-fired); once B1 adds WorkflowTriggerParams.kind we can
// map data.kind -> a per-kind label here.
const triggerLabel = (wf: any): string => {
  const triggerNode = (wf.nodes || []).find(
    (n: any) => n.data?.node_type === "workflow_trigger",
  );
  if (!triggerNode) return "—";
  return t("workflow.triggerAlertFired");
};

const formatTs = (ts?: number): string => {
  if (!ts) return "—";
  // O2 timestamps are microseconds; fall back gracefully for ms/seconds.
  const ms = ts > 1e14 ? ts / 1000 : ts;
  return new Date(ms).toLocaleString();
};

const columns = computed(() => [
  {
    id: "#",
    header: "#",
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
    accessorKey: "updated_at_display",
    sortable: true,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("workflow.actions"),
    sortable: false,
    isAction: true,
    meta: { align: "center", cellClass: "actions-column", actionCount: 4 },
  },
]);
const otableColumns = computed(() => columns.value);

const getWorkflows = async () => {
  loading.value = true;
  try {
    const response = await workflowService.listWorkflows(orgId.value);
    // list handler returns a bare array of Workflow.
    const list = Array.isArray(response.data)
      ? response.data
      : (response.data?.list ?? []);
    workflows.value = list.map((wf: any, index: number) => ({
      ...wf,
      "#": index + 1 <= 9 ? `0${index + 1}` : index + 1,
      trigger: triggerLabel(wf),
      updated_at_display: formatTs(wf.updated_at),
    }));
  } catch (error) {
    console.error(error);
  } finally {
    loading.value = false;
  }
};

// --- navigation --------------------------------------------------------------
// New Workflow -> editor on an EMPTY canvas; the trigger is chosen there (the
// canvas start node opens the trigger picker), so create carries no trigger
// kind. The workflow is created on Save.
const openCreateEditor = () => {
  router.push({
    name: "createWorkflow",
    query: { org_identifier: orgId.value },
  });
};


// Hydrate the shared editor state from the row synchronously (pipeline pattern)
// so the editor has the name + full graph immediately — no async re-fetch.
const editWorkflow = (row: any) => {
  hydrateWorkflow(row);
  router.push({
    name: "workflowEditor",
    query: { id: row.id, name: row.name, org_identifier: orgId.value },
  });
};

// Row click → the dedicated read-only Runs view (viewing runs is the common
// case; editing is the explicit pencil action). Hydrate from the row so the
// canvas renders immediately — no async re-fetch.
const openRuns = (row: any) => {
  if (!row?.id) return;
  hydrateWorkflow(row);
  router.push({
    name: "workflowRuns",
    query: { id: row.id, name: row.name, org_identifier: orgId.value },
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
    await workflowService.deleteWorkflow({ org_identifier: orgId.value, id: row.id });
    toast({ message: t("workflow.deleteSuccess"), variant: "success" });
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

onMounted(getWorkflows);
</script>
