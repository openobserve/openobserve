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

<template>
  <div
    data-test="pipeline-list-page"
    class="flex flex-col h-full min-h-0"
    v-if="currentRouteName === 'pipelines'"
  >
    <div class="w-full flex-1 min-h-0 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <OTable
          :frame="false"
          :key="activeTab"
          data-test="pipeline-list-table"
          :data="filteredPipelines"
          :columns="otableColumns"
          row-key="pipeline_id"
          :loading="loading"
          :global-filter="filterQuery"
          :show-global-filter="false"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          selection="multiple"
          :enable-column-resize="true"
          :persist-columns="true"
          :default-columns="false"
          show-index
          table-id="pipelines-pipeline-list"
          v-model:selected-ids="selectedPipelineIds"
          :expansion="activeTab === 'scheduled' ? 'single' : 'none'"
          :expand-on-row-click="(row: any) => row.source?.source_type === 'scheduled'"
          :row-class="
            (row: any) => (row.source?.source_type === 'scheduled' ? 'cursor-pointer' : '')
          "
          v-model:expanded-ids="expandedId"
          width="100%"
          class="w-full h-full"
        >
          <template #toolbar>
            <div class="flex items-center gap-2 w-full">
              <OToggleGroup
                :model-value="activeTab"
                @update:model-value="
                  (v) => {
                    activeTab = v as string;
                    updateActiveTab();
                  }
                "
                data-test="pipeline-list-tabs"
              >
                <OToggleGroupItem value="all" size="sm" data-test="tab-all">
                  <template #icon-left><OIcon name="format-list-bulleted" size="sm" /></template>
                  {{ t("pipeline_list.tab_all") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="scheduled" size="sm" data-test="tab-scheduled">
                  <template #icon-left><OIcon name="schedule" size="sm" /></template>
                  {{ t("pipeline_list.tab_scheduled") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="realtime" size="sm" data-test="tab-realtime">
                  <template #icon-left><OIcon name="bolt" size="sm" /></template>
                  {{ t("pipeline_list.tab_realtime") }}
                </OToggleGroupItem>
              </OToggleGroup>
              <div class="flex-1 min-w-0">
                <OInput
                  data-test="pipeline-list-search-input"
                  v-model="filterQuery"
                  class="w-full"
                  :placeholder="t('pipeline.search')"
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
              data-test="pipeline-list-refresh-btn"
              @click="getPipelines"
            >
              <OTooltip
                side="bottom"
                :content="t('common.refresh')"
                shortcut-id="pipelinesRefresh"
              />
            </OButton>
          </template>

          <template #cell-type="{ row }">
            <OTag type="pipelineType" :value="row.type" />
          </template>

          <template #cell-actions="{ row }">
            <div class="flex items-center actions-container">
              <OButton
                :data-test="`pipeline-list-${row.name}-pause-start-action`"
                :data-row-action="row.enabled ? 'pause' : 'resume'"
                :variant="row.enabled ? 'ghost-destructive' : 'ghost'"
                size="icon-sm"
                :icon-left="row.enabled ? 'pause' : 'play-arrow'"
                @click.stop="togglePipeline(row)"
              >
                <OTooltip
                  side="bottom"
                  :content="row.enabled ? t('alerts.pause') : t('alerts.start')"
                  :shortcut-id="row.enabled ? 'pipelinesRowPause' : undefined"
                />
              </OButton>
              <OButton
                :data-test="`pipeline-list-${row.name}-view-pipeline`"
                variant="ghost"
                size="icon-sm"
                :title="t('pipeline.view')"
                icon-left="visibility"
              >
                <OTooltip max-width="none" side="left">
                  <template #content><PipelineView :pipeline="row" /></template>
                </OTooltip>
              </OButton>
              <OButton
                :data-test="`pipeline-list-${row.name}-update-pipeline`"
                data-row-action="edit"
                variant="ghost"
                size="icon-sm"
                @click.stop="editPipeline(row)"
                icon-left="edit"
              >
                <OTooltip
                  side="bottom"
                  :content="t('alerts.edit')"
                  shortcut-id="pipelinesRowEdit"
                />
              </OButton>
              <!-- Hidden proxies so the row-hover shortcuts reach the more-menu
                 actions (teleported out of the row): x = export, Del = delete. -->
              <button
                type="button"
                data-row-action="export"
                class="hidden"
                tabindex="-1"
                aria-hidden="true"
                @click.stop="exportPipeline(row)"
              />
              <button
                type="button"
                data-row-action="delete"
                class="hidden"
                tabindex="-1"
                aria-hidden="true"
                @click.stop="openDeleteDialog(row)"
              />
              <ODropdown align="end">
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="icon-sm"
                    @click.stop
                    :data-test="`pipeline-list-${row.name}-more-options`"
                    icon-left="more-vert"
                  />
                </template>
                <ODropdownItem
                  :data-test="`pipeline-list-${row.name}-export-action`"
                  shortcut-id="pipelinesRowExport"
                  @select="exportPipeline(row)"
                >
                  <template #icon-left>
                    <OIcon size="sm" name="download" />
                  </template>
                  {{ t("pipeline.export") }}
                </ODropdownItem>
                <ODropdownSeparator />
                <ODropdownItem
                  :data-test="`pipeline-list-${row.name}-delete-pipeline`"
                  shortcut-id="pipelinesRowDelete"
                  @select="openDeleteDialog(row)"
                  variant="destructive"
                >
                  <template #icon-left>
                    <OIcon size="sm" name="delete" />
                  </template>
                  {{ t("pipeline.delete") }}
                </ODropdownItem>
                <ODropdownSeparator
                  v-if="row.source.source_type === 'scheduled' && config.isEnterprise == 'true'"
                />
                <ODropdownItem
                  v-if="row.source.source_type === 'scheduled' && config.isEnterprise == 'true'"
                  :data-test="`pipeline-list-${row.name}-backfill-action`"
                  @select="openBackfillDialog(row)"
                >
                  <template #icon-left>
                    <OIcon size="sm" name="refresh" />
                  </template>
                  Create Backfill
                </ODropdownItem>
                <ODropdownSeparator v-if="row.last_error" />
                <ODropdownItem
                  v-if="row.last_error"
                  :data-test="`pipeline-list-${row.name}-view-error-action`"
                  @select="showErrorDialog(row)"
                >
                  <template #icon-left>
                    <OIcon size="sm" name="error" />
                  </template>
                  <div class="flex flex-col">
                    <div>View Error</div>
                    <div class="text-xs text-text-secondary">
                      {{ new Date(row.last_error.last_error_timestamp / 1000).toLocaleString() }}
                    </div>
                  </div>
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>

          <template #expansion="{ row }: { row: PipelineRow }">
            <div
              v-if="row?.sql_query"
              data-test="scheduled-pipeline-expanded-content"
              class="text-left px-12 py-0 mb-2 max-h-screen overflow-hidden"
            >
              <div class="flex items-center py-2">
                <strong>{{ t("pipeline_list.sql_query") }} : <span></span></strong>
              </div>
              <div class="flex items-start justify-center">
                <div
                  data-test="scheduled-pipeline-expanded-sql"
                  class="w-full overflow-y-auto p-2.5 border border-border-default border-l-[3px] border-l-accent h-full max-h-50 whitespace-normal bg-surface-subtle text-text-body"
                >
                  <pre style="text-wrap: wrap">{{ row?.sql_query }} </pre>
                </div>
              </div>
            </div>
          </template>

          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-pipelines"
              :filtered="!!filterQuery"
              @action="
                (id) =>
                  id === 'clear-filters'
                    ? (filterQuery = '')
                    : id === 'import'
                      ? goToImportPipeline()
                      : goToCreatePipeline()
              "
            />
          </template>

          <template #bottom="bottomProps">
            <div class="flex items-center justify-between w-full py-1">
              <div class="flex items-center text-xs font-normal mr-4">
                {{ bottomProps.totalRows }} {{ t("pipeline.header") }}
              </div>
              <div v-if="selectedPipelineIds.length > 0" class="flex items-center gap-2">
                <OButton
                  data-test="pipeline-list-export-pipelines-btn"
                  variant="outline"
                  size="sm"
                  @click="exportBulkPipelines"
                  icon-left="download"
                >
                  {{ t("pipeline_list.export") }}
                </OButton>
                <OButton
                  data-test="pipeline-list-pause-pipelines-btn"
                  variant="outline"
                  size="sm"
                  @click="bulkTogglePipelines('pause')"
                  icon-left="pause"
                >
                  {{ t("pipeline_list.pause") }}
                </OButton>
                <OButton
                  data-test="pipeline-list-resume-pipelines-btn"
                  variant="outline"
                  size="sm"
                  @click="bulkTogglePipelines('resume')"
                  icon-left="play-arrow"
                >
                  {{ t("pipeline_list.resume") }}
                </OButton>
                <OButton
                  data-test="pipeline-list-delete-pipelines-btn"
                  variant="outline-destructive"
                  size="sm"
                  :loading="bulkDeleteLoading"
                  @click="openBulkDeleteDialog"
                  icon-left="delete"
                >
                  Delete
                </OButton>
              </div>
            </div>
          </template>
        </OTable>
      </div>
    </div>
  </div>

  <router-view v-else />

  <ODrawer
    data-test="pipelines-list-create-pipeline-drawer"
    v-model:open="showCreatePipeline"
    size="lg"
  >
    <stream-selection @save="savePipeline" />
  </ODrawer>

  <confirm-dialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    v-model="confirmDialogMeta.show"
  />
  <resume-pipeline-dialog
    :shouldStartfromNow="shouldStartfromNow"
    :lastPausedAt="resumePipelineDialogMeta.data?.paused_at"
    @update:ok="resumePipelineDialogMeta.onConfirm()"
    @update:cancel="resumePipelineDialogMeta.onCancel()"
    v-model="resumePipelineDialogMeta.show"
    @update:shouldStartfromNow="shouldStartfromNow = $event"
  />

  <!-- Backfill Job Dialog -->
  <create-backfill-job-dialog
    v-model="backfillDialog.show"
    :pipeline-id="backfillDialog.pipelineId"
    :pipeline-name="backfillDialog.pipelineName"
    :schedule-frequency="backfillDialog.scheduleFrequency"
    @success="onBackfillSuccess"
  />

  <!-- Pipeline Error Dialog -->
  <ODialog
    data-test="pipelines-list-error-dialog"
    v-model:open="errorDialog.show"
    @update:open="(v) => !v && closeErrorDialog()"
    size="md"
    :title="errorDialog.data?.name"
    :sub-title="
      errorDialog.data
        ? `${t('pipeline_list.last_error')}: ${new Date(errorDialog.data.last_error.last_error_timestamp / 1000).toLocaleString()}`
        : undefined
    "
    :primary-button-label="t('pipeline_list.close')"
    @click:primary="closeErrorDialog"
  >
    <template #header-left>
      <OIcon name="error" size="md" class="text-status-error-text" />
    </template>

    <div
      v-if="errorDialog.data"
      class="pipeline-error-content px-6 py-5 max-h-[60vh] overflow-y-auto"
    >
      <!-- Error Summary -->
      <div v-if="errorDialog.data.last_error.error_summary" class="mb-4">
        <div class="section-label mb-2 text-compact font-semibold tracking-[0.02em] opacity-80">
          {{ t("pipeline_list.error_summary") }}
        </div>
        <div
          class="error-summary-box p-4 rounded-default font-mono text-compact leading-[1.6] whitespace-pre-wrap wrap-break-word bg-banner-error-soft-bg border border-banner-error-soft-border text-banner-error-soft-text"
        >
          {{ errorDialog.data.last_error.error_summary }}
        </div>
      </div>

      <!-- Node Errors -->
      <div
        v-if="
          errorDialog.data.last_error.node_errors &&
          Object.keys(errorDialog.data.last_error.node_errors).length > 0
        "
      >
        <div class="section-label mb-3 text-compact font-semibold tracking-[0.02em] opacity-80">
          {{ t("pipeline_list.node_errors") }}
        </div>
        <div class="node-errors-container flex flex-col gap-3">
          <div
            v-for="(nodeError, nodeId) in errorDialog.data.last_error.node_errors"
            :key="nodeId"
            class="node-error-item p-4 rounded-default bg-surface-subtle border border-border-default transition-all hover:bg-interactive-hover-bg"
          >
            <div class="node-error-header flex items-center justify-between mb-2.5">
              <span class="node-name font-semibold text-sm">{{
                nodeError.node_name || nodeId
              }}</span>
              <span
                class="node-type text-xs px-2.5 py-1 rounded-default bg-badge-indigo-soft-bg text-badge-indigo-soft-text font-medium"
                >{{ nodeError.node_type }}</span
              >
            </div>
            <!-- The API field is `errors`, not `error_messages` — this block
                 read a key the response never carries, so the dialog listed
                 node names with no messages under them. `errors` also arrives
                 in two shapes (legacy strings / [message, payload] tuples),
                 which normalizeNodeErrorMessages reconciles. -->
            <div
              v-if="nodeErrorMessages(nodeError).length > 0"
              class="node-error-messages flex flex-col gap-2"
            >
              <div
                v-for="(msg, idx) in nodeErrorMessages(nodeError)"
                :key="idx"
                class="error-message p-3 rounded-default bg-banner-error-soft-bg border-l-[3px] border-l-status-negative font-mono text-xs leading-[1.5] whitespace-pre-wrap wrap-break-word text-banner-error-soft-text"
              >
                {{ msg }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ODialog>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { normalizeNodeErrorMessages } from "@/utils/pipelines/nodeErrors";
import { MarkerType } from "@vue-flow/core";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import StreamSelection from "./StreamSelection.vue";
import pipelineService from "@/services/pipelines";
import { useStore } from "vuex";
import config from "@/aws-exports";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import PipelineView from "./PipelineView.vue";
import ResumePipelineDialog from "../ResumePipelineDialog.vue";
import CreateBackfillJobDialog from "@/components/pipelines/CreateBackfillJobDialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import { COL } from "@/lib/core/Table/OTable.types";

const { t } = useI18n();
const router = useRouter();

// Row original data rendered by the pipelines table. Only the fields read in the
// expansion slot are declared here; scheduled rows carry the derived SQL query.
interface PipelineRow {
  sql_query?: string;
}

const filterQuery = ref("");

const showCreatePipeline = ref(false);

const pipelines = ref([]);

const store = useStore();

const shouldStartfromNow = ref(true);
const resumePipelineDialogMeta: any = ref({
  show: false,
  title: t("pipeline_list.resume_pipeline_title"),
  data: null,
  onConfirm: () => handleResumePipeline(),
  onCancel: () => handleCancelResumePipeline(),
});

const { pipelineObj } = useDragAndDrop();

watch(
  () => router.currentRoute.value.name,
  async (newName, oldName) => {
    // Only re-fetch when we land back on the list itself
    if (newName !== "pipelines" || newName === oldName) return;
    await getPipelines();
    updateActiveTab();
  },
);

const confirmDialogMeta: any = ref({
  show: false,
  title: "",
  message: "",
  data: null,
  onConfirm: () => {},
});
const activeTab = ref("all");
const filteredPipelines: any = ref([]);
const columns: any = ref([]);

const selectedPipelineIds = ref<string[]>([]);
const bulkDeleteLoading = ref(false);
const selectedPipelines = computed(() =>
  filteredPipelines.value.filter((p: any) => selectedPipelineIds.value.includes(p.pipeline_id)),
);
const expandedId = ref<string[]>([]);

const errorDialog = ref({
  show: false,
  data: null as any,
});

// Node errors ship as either plain strings (rows written before the NodeErrors
// shape change) or [message, payload] tuples (rows written after). The backend
// read path is untyped passthrough, so both reach the UI as-is.
const nodeErrorMessages = (nodeError: any): string[] =>
  normalizeNodeErrorMessages(nodeError?.errors);

const backfillDialog = ref({
  show: false,
  pipelineId: "",
  pipelineName: "",
  scheduleFrequency: 60,
});

const currentRouteName = computed(() => {
  return router.currentRoute.value.name;
});

const otableColumns = computed(() => columns.value);

const updateActiveTab = () => {
  expandedId.value = [];
  if (activeTab.value === "all") {
    columns.value = getColumnsForActiveTab(activeTab.value);
    filteredPipelines.value = pipelines.value;
    return;
  }

  filteredPipelines.value = pipelines.value.filter(
    (pipeline: any) => pipeline.source.source_type === activeTab.value,
  );

  columns.value = getColumnsForActiveTab(activeTab.value);
};
//this is the function to check whether the pipeline is enabled or not
//becuase if it is not enabled then we need to show the dialog to resume the pipeline from where it paused / start from now
//else we need to toggle the pipeline state
const togglePipeline = (row: any) => {
  //if we are going to pause the pipeline and it is realtime pipeline then we need to toggle the pipeline state and pause the pipeline
  //and the resume at would be false because it is not required to resume the pipeline and for realtime pipelines from where it paused
  if (row.enabled || row.type == "realtime") {
    togglePipelineState(row, true);
  } else {
    //if we are going to resume the pipeline then we need to show the dialog to resume the pipeline from where it paused / start from now as per the user choice
    resumePipelineDialogMeta.value.show = true;
    resumePipelineDialogMeta.value.data = row;
  }
};

const togglePipelineState = (row: any, from_now: boolean) => {
  const newState = !row.enabled;
  pipelineService
    .toggleState(store.state.selectedOrganization.identifier, row.pipeline_id, newState, from_now)
    .then(async () => {
      row.enabled = newState;
      const message = row.enabled
        ? `${row.name} state resumed successfully`
        : `${row.name} state paused successfully`;
      toast({
        message: message,
        variant: "success",
      });
      await getPipelines();
    })
    .catch((error) => {
      if (error.response.status != 403) {
        toast({
          message: error.response?.data?.message || "Error while updating pipeline state",
          variant: "error",
        });
      }
    });
};

const getColumnsForActiveTab = (tab: any) => {
  const nameColumn = {
    id: "name",
    header: t("common.name"),
    accessorKey: "name",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.name,
    minSize: 160,
    meta: { align: "left", flex: true },
  };
  const streamNameColumn = {
    id: "stream_name",
    header: t("alerts.stream_name"),
    accessorKey: "stream_name",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.streamName,
    meta: { align: "left" },
  };
  const streamTypeColumn = {
    id: "stream_type",
    header: t("alerts.streamType"),
    accessorKey: "stream_type",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.streamType,
    meta: { align: "left" },
  };
  const frequencyColumn = {
    id: "frequency",
    header: t("pipeline_list.frequency"),
    accessorKey: "frequency",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.frequency,
    meta: { align: "left" },
  };
  const periodColumn = {
    id: "period",
    header: t("pipeline_list.period"),
    accessorKey: "period",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.frequency,
    meta: { align: "left" },
  };
  const cronColumn = {
    id: "cron",
    header: t("pipeline_list.cron"),
    accessorKey: "cron",
    sortable: false,
    resizable: true,
    hideable: true,
    size: COL.cron,
    meta: { align: "left" },
  };
  const typeColumn = {
    id: "type",
    header: t("pipeline_list.type"),
    accessorKey: "type",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.type,
    meta: { align: "left" },
  };
  const scheduledStreamTypeColumn = {
    id: "stream_type",
    header: t("pipeline_list.stream_type"),
    accessorKey: "stream_type",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.streamType,
    meta: { align: "left" },
  };
  const actionsColumn = {
    id: "actions",
    header: t("alerts.actions"),
    sortable: false,
    isAction: true,
    meta: { align: "center", cellClass: "actions-column", actionCount: 4 },
  };

  if (tab === "all") {
    return [
      nameColumn,
      typeColumn,
      streamNameColumn,
      scheduledStreamTypeColumn,
      frequencyColumn,
      periodColumn,
      cronColumn,
      actionsColumn,
    ];
  }
  if (tab === "realtime") {
    return [nameColumn, streamNameColumn, streamTypeColumn, actionsColumn];
  }
  return [
    nameColumn,
    scheduledStreamTypeColumn,
    frequencyColumn,
    periodColumn,
    cronColumn,
    actionsColumn,
  ];
};

columns.value = getColumnsForActiveTab(activeTab.value);

onMounted(async () => {
  await getPipelines(); // Ensure pipelines are fetched before updating
  updateActiveTab();
});

// Empty-state "New pipeline" → the dedicated pipeline-builder page (not the
// stream-selection side panel).
const goToCreatePipeline = () => {
  router.push({
    name: "createPipeline",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
};

// Empty-state "Import pipeline" → the dedicated import page.
const goToImportPipeline = () => {
  router.push({
    name: "importPipeline",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
};

const loading = ref(true);
const getPipelines = async () => {
  loading.value = true;
  try {
    const response = await pipelineService.getPipelines(
      store.state.selectedOrganization.identifier,
    );
    pipelines.value = [];
    // resultTotal.value = response.data.list.length;
    pipelines.value = response.data.list.map((pipeline: any) => {
      const updatedEdges = pipeline.edges.map((edge: any) => ({
        ...edge,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20, // Increase arrow width
          height: 20, // Increase arrow height
        },
        type: "custom",

        style: {
          strokeWidth: 2,
        },
        animated: true,
        updatable: true,
      }));
      pipeline.type = pipeline.source.source_type;
      if (pipeline.source.source_type === "realtime") {
        pipeline.stream_name = pipeline.source.stream_name;
        pipeline.stream_type = pipeline.source.stream_type;
        pipeline.frequency = "--";
        pipeline.period = "--";
        pipeline.cron = "--";
        pipeline.sql_query = "--";
      } else {
        pipeline.stream_type = pipeline.source.stream_type;
        pipeline.frequency =
          pipeline.source.trigger_condition.frequency_type == "minutes"
            ? pipeline.source.trigger_condition.frequency + " Mins"
            : pipeline.source.trigger_condition.cron;
        pipeline.period = pipeline.source.trigger_condition.period + " Mins";
        pipeline.cron =
          pipeline.source.trigger_condition.frequency_type == "minutes" ? "False" : "True";
        pipeline.sql_query = pipeline.source.query_condition.sql;
      }

      pipeline.edges = updatedEdges;
      return {
        ...pipeline,
      };
    });
  } catch (error) {
    console.error(error);
  } finally {
    loading.value = false;
  }
};
const editPipeline = (pipeline: any) => {
  pipeline.nodes.forEach((node: any) => {
    node.type = node.io_type;
  });

  pipelineObj.currentSelectedPipeline = pipeline;
  pipelineObj.pipelineWithoutChange = pipeline;
  router.push({
    name: "pipelineEditor",
    query: {
      id: pipeline.pipeline_id,
      name: pipeline.name,
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const openDeleteDialog = (pipeline: any) => {
  confirmDialogMeta.value.show = true;
  confirmDialogMeta.value.title = t("pipeline.deletePipeline");
  confirmDialogMeta.value.message = "Are you sure you want to delete this pipeline?";
  confirmDialogMeta.value.onConfirm = deletePipeline;
  confirmDialogMeta.value.data = pipeline;
};

const savePipeline = (data: any) => {
  const dismiss = toast({
    message: "saving pipeline...",
    variant: "loading",
    timeout: 0,
  });

  pipelineService
    .createPipeline({
      ...data,
      org_identifier: store.state.selectedOrganization.identifier,
    })
    .then(() => {
      getPipelines();
      dismiss();
      showCreatePipeline.value = false;
      toast({
        message: "Pipeline created successfully",
        variant: "success",
      });
    })
    .catch((error) => {
      dismiss();
      if (error.response.status != 403) {
        toast({
          message: error.response?.data?.message || "Error while saving pipeline",
          variant: "error",
        });
      }
    });
};

const deletePipeline = async () => {
  const dismiss = toast({
    message: "deleting pipeline...",
    variant: "loading",
    timeout: 0,
  });
  const { pipeline_id } = confirmDialogMeta.value.data;
  const org_id = store.state.selectedOrganization.identifier;
  pipelineService
    .deletePipeline({
      pipeline_id,
      org_id,
    })
    .then(async () => {
      toast({
        message: "Pipeline deleted successfully",
        variant: "success",
      });
    })
    .catch((error) => {
      if (error.response.status != 403) {
        toast({
          message: error.response?.data?.message || "Error while deleting pipeline",
          variant: "error",
        });
      }
    })
    .finally(async () => {
      selectedPipelineIds.value = [];
      await getPipelines();
      updateActiveTab();
      dismiss();
    });

  resetConfirmDialog();
};

const resetConfirmDialog = () => {
  confirmDialogMeta.value.show = false;
  confirmDialogMeta.value.title = "";
  confirmDialogMeta.value.message = "";
  confirmDialogMeta.value.onConfirm = () => {};
  confirmDialogMeta.value.data = null;
};

const exportPipeline = (row: any) => {
  const pipelineToBeExported = row.name;

  const pipelineJson = JSON.stringify(row, null, 2);
  // Create a Blob from the JSON string
  const blob = new Blob([pipelineJson], { type: "application/json" });

  // Create an object URL for the Blob
  const url = URL.createObjectURL(blob);

  // Create an anchor element to trigger the download
  const link = document.createElement("a");
  link.href = url;

  // Set the filename of the download
  link.download = `${pipelineToBeExported}.json`;

  // Trigger the download by simulating a click
  link.click();

  // Clean up the URL object after download
  URL.revokeObjectURL(url);
};

const exportBulkPipelines = () => {
  // Create an array of selected pipelines without modifying their structure
  const pipelinesToExport = selectedPipelines.value;

  const exportJson = JSON.stringify(pipelinesToExport, null, 2);
  const blob = new Blob([exportJson], { type: "application/json" });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const date = new Date().toISOString().split("T")[0];
  link.download = `pipelines_export_${date}.json`;

  link.click();

  URL.revokeObjectURL(url);

  selectedPipelineIds.value = [];
  toast({
    message: `${pipelinesToExport.length} pipelines exported successfully`,
    variant: "success",
  });
};
//if user clicks on run pipeline button then we need toggle the pipeline state and resume the pipeline from where it paused / start from now as per the user choice
const handleResumePipeline = () => {
  resumePipelineDialogMeta.value.show = false;
  togglePipelineState(resumePipelineDialogMeta.value.data, shouldStartfromNow.value);
};
//if user clicks on cancel button then we need to just close the dialog and do not toggle the pipeline state
const handleCancelResumePipeline = () => {
  resumePipelineDialogMeta.value.show = false;
  return;
};

const showErrorDialog = (pipeline: any) => {
  errorDialog.value.show = true;
  errorDialog.value.data = pipeline;
};

const closeErrorDialog = () => {
  errorDialog.value.show = false;
  errorDialog.value.data = null;
};

const goToBackfillJobs = () => {
  router.push({
    name: "pipelineBackfill",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const bulkTogglePipelines = async (action: "pause" | "resume") => {
  const dismiss = toast({
    variant: "loading",
    message: `${action === "resume" ? "Resuming" : "Pausing"} pipelines...`,
    timeout: 0,
  });
  try {
    const isResuming = action === "resume";
    // Filter pipelines based on action
    const pipelinesToToggle = selectedPipelines.value.filter((pipeline: any) =>
      isResuming ? !pipeline.enabled : pipeline.enabled,
    );

    if (pipelinesToToggle.length === 0) {
      toast({
        variant: "error",
        message: `No pipelines to ${action}`,
      });
      dismiss();
      return;
    }
    // Extract ids & names
    const payload = {
      ids: pipelinesToToggle.map((p: any) => p.pipeline_id),
      names: pipelinesToToggle.map((p: any) => p.name),
    };

    // Toggle state (true = resume, false = pause)
    const response = await pipelineService.bulkToggleState(
      store.state.selectedOrganization.identifier,
      isResuming,
      payload,
    );

    if (response) {
      dismiss();
      toast({
        variant: "success",
        message: `Pipelines ${action}d successfully`,
      });
    }

    selectedPipelineIds.value = [];
    await getPipelines();
    updateActiveTab();
  } catch (error) {
    dismiss();
    console.error(`Error ${action}ing pipelines:`, error);
    toast({
      variant: "error",
      message: `Error ${action}ing pipelines. Please try again.`,
    });
  }
};

const openBulkDeleteDialog = () => {
  confirmDialogMeta.value.show = true;
  confirmDialogMeta.value.title = t("pipeline.deletePipeline");
  confirmDialogMeta.value.message = `Are you sure you want to delete ${selectedPipelines.value.length} pipeline(s)?`;
  confirmDialogMeta.value.onConfirm = bulkDeletePipelines;
  confirmDialogMeta.value.data = null;
};

const bulkDeletePipelines = async () => {
  bulkDeleteLoading.value = true;
  const dismiss = toast({
    variant: "loading",
    message: "Deleting pipelines...",
    timeout: 0,
  });

  try {
    if (selectedPipelines.value.length === 0) {
      toast({
        variant: "error",
        message: "No pipelines selected for deletion",
      });
      dismiss();
      return;
    }

    // Extract pipeline ids
    const payload = {
      ids: selectedPipelines.value.map((p: any) => p.pipeline_id),
    };

    const response = await pipelineService.bulkDelete(
      store.state.selectedOrganization.identifier,
      payload,
    );

    dismiss();

    // Handle response based on successful/unsuccessful arrays
    if (response.data) {
      const { successful = [], unsuccessful = [] } = response.data;
      const successCount = successful.length;
      const failCount = unsuccessful.length;

      if (failCount > 0 && successCount > 0) {
        // Partial success
        toast({
          variant: "warning",
          message: `${successCount} pipeline(s) deleted successfully, ${failCount} failed`,
          timeout: 5000,
        });
      } else if (failCount > 0) {
        // All failed
        toast({
          variant: "error",
          message: `Failed to delete ${failCount} pipeline(s)`,
        });
      } else {
        // All successful
        toast({
          variant: "success",
          message: `${successCount} pipeline(s) deleted successfully`,
        });
      }
    } else {
      // Fallback success message
      toast({
        variant: "success",
        message: `${selectedPipelines.value.length} pipeline(s) deleted successfully`,
      });
    }

    selectedPipelineIds.value = [];
    await getPipelines();
    updateActiveTab();
  } catch (error: any) {
    dismiss();
    // Show error message from response if available
    const errorMessage =
      error.response?.data?.message ||
      error?.message ||
      "Error deleting pipelines. Please try again.";
    if (error.response?.status != 403 || error?.status != 403) {
      toast({
        variant: "error",
        message: errorMessage,
      });
    }
  } finally {
    bulkDeleteLoading.value = false;
  }

  resetConfirmDialog();
};

const openBackfillDialog = (pipeline: any) => {
  // Extract schedule frequency from pipeline source (for scheduled pipelines)
  // The frequency is stored in trigger_condition.frequency (in minutes for derived streams)
  const scheduleFrequency = pipeline.source?.trigger_condition?.frequency || 60;

  backfillDialog.value = {
    show: true,
    pipelineId: pipeline.pipeline_id,
    pipelineName: pipeline.name,
    scheduleFrequency: scheduleFrequency,
  };
};

const onBackfillSuccess = () => {
  // Navigate to backfill jobs page after successful creation
  goToBackfillJobs();
};

// ── Keyboard shortcuts ────────────────────────────────────────────────────
useShortcuts([
  {
    id: "pipelinesAdd",
    handler: () => {
      if (!isInputFocused()) goToCreatePipeline();
    },
  },
  {
    id: "pipelinesImport",
    handler: () => {
      if (!isInputFocused()) goToImportPipeline();
    },
  },
  {
    id: "pipelinesRefresh",
    handler: () => {
      if (!isInputFocused()) getPipelines();
    },
  },
  {
    id: "pipelinesFocusSearch",
    handler: () => {
      focusSearchInput("pipeline-list-search-input");
    },
  },
]);
</script>
