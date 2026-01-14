<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page v-if="currentRouteName === 'pipelines'">
    <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
      <div class="card-container tw:mb-[0.625rem]">
        <div class="flex justify-between full-width tw:py-3 tw:px-4 items-center tw:h-[68px]">
          <div class="q-table__title tw:font-[600]" data-test="pipeline-list-title">
                {{ t("pipeline.header") }}
              </div>
              <div class="tw:flex tw:items-center q-ml-auto">
                <div class="app-tabs-container tw:h-[36px] q-mr-sm">
                  <app-tabs
                  data-test="pipeline-list-tabs"
                  class="tabs-selection-container"
                  :tabs="tabs"
                  v-model:active-tab="activeTab"
                  @update:active-tab="updateActiveTab"
                />
                </div>

                <q-input
                  data-test="pipeline-list-search-input"
                  v-model="filterQuery"
                  borderless
                  dense
                  flat
                  class="no-border o2-search-input"
                  :placeholder="t('pipeline.search')"
                >
                  <template #prepend>
                    <q-icon class="o2-search-input-icon" name="search" />
                  </template>
                </q-input>
                <q-btn
                    data-test="pipeline-list-history-btn"
                    class="q-ml-sm o2-secondary-button tw:h-[36px]"
                    :class="
                        store.state.theme === 'dark'
                        ? 'o2-secondary-button-dark'
                        : 'o2-secondary-button-light'
                    "
                    no-caps
                    flat
                    :label="t(`pipeline.history`)"
                    @click="goToPipelineHistory"
                />
                <q-btn
                    data-test="pipeline-list-backfill-btn"
                    class="q-ml-sm o2-secondary-button tw-h-[36px]"
                    :class="
                        store.state.theme === 'dark'
                        ? 'o2-secondary-button-dark'
                        : 'o2-secondary-button-light'
                    "
                    no-caps
                    flat
                    :label="t('pipeline.backfill')"
                    @click="goToBackfillJobs"
                />
                <q-btn
                  data-test="pipeline-list-import-pipeline-btn"
                  class="q-ml-sm o2-secondary-button tw:h-[36px]"
                  no-caps
                  flat
                  :label="t(`pipeline.import`)"
                  @click="routeToImportPipeline"
                />
                <q-btn
                  data-test="pipeline-list-add-pipeline-btn"
                  class="q-ml-sm o2-primary-button tw:h-[36px]"
                  flat
                  no-caps
                  :label="t(`pipeline.addPipeline`)"
                  @click="routeToAddPipeline"
                />
              </div>
        </div>
      </div>

      <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
        <div class="card-container tw:h-[calc(100vh-127px)]">
          <q-table
            data-test="pipeline-list-table"
            ref="qTableRef"
            :rows="visibleRows"
            :columns="columns"
            row-key="name"
            :pagination="pagination"
            :filter="filterQuery"
            style="width: 100%"
            selection="multiple"
            v-model:selected="selectedPipelines"
            :style="hasVisibleRows
                ? 'width: 100%; height: calc(100vh - 127px)'
                : 'width: 100%'"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          >
            <template v-slot:body="props">
              <q-tr
                :data-test="`pipeline-list-table-${props.row.pipeline_id}-row`"
                :props="props"
                style="cursor: pointer"
                @click="triggerExpand(props)"
              >
                <q-td auto-width>
                  <q-checkbox
                    v-model="props.selected"
                    class="o2-table-checkbox"
                    size="sm"
                    @click.stop
                  />
                </q-td>
                <q-td v-if="activeTab == 'scheduled'" auto-width>
                  <q-btn
                    dense
                    flat
                    size="xs"
                    :icon="
                      expandedRow != props.row.pipeline_id
                        ? 'expand_more'
                        : 'expand_less'
                    "
                  />
                </q-td>
                <q-td v-for="col in filterColumns()" :key="col.name" :props="props">
                  <template v-if="col.name !== 'actions'">
                    {{ props.row[col.field] }}
                  </template>
                  <template v-else>
                    <!-- Actions Buttons -->
                    <div class="tw:flex tw:items-center actions-container">
                      <q-btn
                        :data-test="`pipeline-list-${props.row.name}-pause-start-alert`"
                        dense
                        unelevated
                        size="sm"
                        :color="props.row.enabled ? 'negative' : 'positive'"
                        :icon="props.row.enabled ? outlinedPause : outlinedPlayArrow"
                        round
                        flat
                        :title="
                          props.row.enabled ? t('alerts.pause') : t('alerts.start')
                        "
                        @click.stop="togglePipeline(props.row)"
                      >
                      </q-btn>
                      <q-btn
                        :data-test="`pipeline-list-${props.row.name}-update-pipeline`"
                        padding="sm"
                        unelevated
                        size="sm"
                        round
                        flat
                        icon="edit"
                        :title="t('pipeline.edit')"
                        @click.stop="editPipeline(props.row)"
                      >
                      </q-btn>
                      <q-btn
                        :data-test="`pipeline-list-${props.row.name}-view-pipeline`"
                        padding="sm"
                        unelevated
                        size="sm"
                        round
                        flat
                        :icon="outlinedVisibility"
                        :title="t('pipeline.view')"
                      >
                        <q-tooltip position="bottom">
                          <PipelineView :pipeline="props.row" />
                        </q-tooltip>
                      </q-btn>
                      <q-btn
                        :icon="outlinedMoreVert"
                        unelevated
                        size="sm"
                        round
                        flat
                        @click.stop
                        :data-test="`pipeline-list-${props.row.name}-more-options`"
                      >
                        <q-menu>
                          <q-list style="min-width: 100px">
                            <q-item
                              class="flex items-center"
                              clickable
                              v-close-popup
                              @click="exportPipeline(props.row)"
                            >
                              <q-item-section dense avatar>
                                <q-icon size="16px" name="download" />
                              </q-item-section>
                              <q-item-section>{{ t('pipeline.export') }}</q-item-section>
                            </q-item>
                            <q-separator v-if="props.row.source.source_type === 'scheduled'" />
                            <q-item
                              v-if="props.row.source.source_type === 'scheduled'"
                              class="flex items-center"
                              clickable
                              v-close-popup
                              @click="openBackfillDialog(props.row)"
                            >
                              <q-item-section dense avatar>
                                <q-icon size="16px" name="refresh" />
                              </q-item-section>
                              <q-item-section>Create Backfill</q-item-section>
                            </q-item>
                            <q-separator />
                            <q-item
                              class="flex items-center"
                              clickable
                              v-close-popup
                              @click="openDeleteDialog(props.row)"
                            >
                              <q-item-section dense avatar>
                                <q-icon size="16px" :name="outlinedDelete" />
                              </q-item-section>
                              <q-item-section>{{ t('pipeline.delete') }}</q-item-section>
                            </q-item>
                            <q-separator v-if="props.row.last_error" />
                            <q-item
                              v-if="props.row.last_error"
                              class="flex items-center"
                              clickable
                              v-close-popup
                              @click="showErrorDialog(props.row)"
                            >
                              <q-item-section dense avatar>
                                <q-icon size="16px" name="error" color="negative" />
                              </q-item-section>
                              <q-item-section>
                                <div>View Error</div>
                                <div class="text-caption text-grey">
                                  {{ new Date(props.row.last_error.last_error_timestamp / 1000).toLocaleString() }}
                                </div>
                              </q-item-section>
                            </q-item>
                          </q-list>
                        </q-menu>
                      </q-btn>
                    </div>
                  </template>
                </q-td>
              </q-tr>
              <q-tr
                data-test="scheduled-pipeline-row-expand"
                v-show="expandedRow === props.row.pipeline_id"
                :props="props"
              >
                <q-td v-if="props.row?.sql_query" colspan="100%">
                  <div
                    data-test="scheduled-pipeline-expanded-content"
                    class="text-left tw:px-2 q-mb-sm expanded-content"
                  >
                    <div class="tw:flex tw:items-center q-py-sm">
                      <strong>{{ t('pipeline_list.sql_query') }} : <span></span></strong>
                    </div>
                    <div class="tw:flex tw:items-start tw:justify-center">
                      <div
                        data-test="scheduled-pipeline-expanded-sql"
                        class="scrollable-content expanded-sql"
                      >
                        <pre style="text-wrap: wrap"
                          >{{ props.row?.sql_query }} </pre
                        >
                      </div>
                    </div>
                  </div>
                </q-td>
              </q-tr>
            </template>
            <template #no-data>
              <no-data />
            </template>
            <template v-slot:body-selection="scope">
              <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
            </template>

            <template v-slot:body-cell-function="props">
              <q-td :props="props">
                <q-tooltip>
                  <pre data-test="scheduled-pipeline-expanded-tooltip-sql">{{
                    props.row.sql
                  }}</pre>
                </q-tooltip>
                <pre style="white-space: break-spaces">{{ props.row.sql }}</pre>
              </q-td>
            </template>
            <!-- <template #top="scope">
              <q-table-pagination
                :scope="scope"
                :pageTitle="t('pipeline.header')"
                :position="'top'"
                :resultTotal="resultTotal"
                :perPageOptions="perPageOptions"
                @update:changeRecordPerPage="changePagination"
              />
            </template> -->

            <template #bottom="scope">
              <div class="bottom-btn tw:h-[48px]">
                <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-md">
                      {{ resultTotal }} {{ t('pipeline.header') }}
                    </div>
                <q-btn
                  v-if="selectedPipelines.length > 0"
                  data-test="pipeline-list-export-pipelines-btn"
                  class="flex  q-mr-sm items-center no-border o2-secondary-button tw:h-[36px]"
                  no-caps
                  dense
                  :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                  @click="exportBulkPipelines"
                >
                  <q-icon name="download" size="16px" />
                  <span class="tw:ml-2">{{ t('pipeline_list.export') }}</span>
                </q-btn>
                <q-btn
                  v-if="selectedPipelines.length > 0"
                  data-test="pipeline-list-pause-pipelines-btn"
                  class="flex q-mr-sm items-center no-border o2-secondary-button tw:h-[36px]"
                  no-caps
                  dense
                  :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                  @click="bulkTogglePipelines('pause')"
                >
                  <q-icon name="pause" size="16px" />
                  <span class="tw:ml-2">{{ t('pipeline_list.pause') }}</span>
                </q-btn>
                <q-btn
                  v-if="selectedPipelines.length > 0"
                  data-test="pipeline-list-resume-pipelines-btn"
                  class="flex q-mr-sm items-center no-border o2-secondary-button tw:h-[36px] tw:w-[180px]"
                  no-caps
                  dense
                  :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                  @click="bulkTogglePipelines('resume')"
                >
                  <q-icon name="play_arrow" size="16px" />
                  <span class="tw:ml-2">{{ t('pipeline_list.resume') }}</span>
                </q-btn>
                <q-btn
                  v-if="selectedPipelines.length > 0"
                  data-test="pipeline-list-delete-pipelines-btn"
                  class="flex q-mr-sm items-center no-border o2-secondary-button tw:h-[36px]"
                  no-caps
                  dense
                  :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                  @click="openBulkDeleteDialog"
                >
                  <q-icon name="delete" size="16px" />
                  <span class="tw:ml-2">Delete</span>
                </q-btn>
                <QTablePagination
                  :scope="scope"
                  :position="'bottom'"
                  :resultTotal="resultTotal"
                  :perPageOptions="perPageOptions"
                  @update:changeRecordPerPage="changePagination"
                />
              </div>
            </template>

            <template v-slot:header="props">
                <q-tr :props="props">
                  <!-- Adding this block to render the select-all checkbox -->
                  <q-th v-if="columns.length > 0">
                    <q-checkbox
                      v-model="props.selected"
                      size="sm"
                      :class="store.state.theme === 'dark' ? 'o2-table-checkbox-dark' : 'o2-table-checkbox-light'"
                      class="o2-table-checkbox"
                      @update:model-value="props.select"
                    />
                  </q-th>

                  <!-- Rendering the rest of the columns -->
                  <q-th
                    v-for="col in props.cols"
                    :key="col.name"
                    :props="props"
                    :class="col.classes"
                    :style="col.style"
                  >
                    {{ col.label }}
                  </q-th>
                </q-tr>
              </template>
          </q-table>
        </div>
      </div>
    </div>
  </q-page>

  <router-view v-else />

  <q-dialog v-model="showCreatePipeline" position="right" full-height maximized>
    <stream-selection @save="savePipeline" />
  </q-dialog>

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
  <q-dialog v-model="errorDialog.show" @hide="closeErrorDialog">
    <q-card
      class="pipeline-error-dialog"
      :class="store.state.theme === 'dark' ? 'pipeline-error-dialog-dark' : 'pipeline-error-dialog-light'"
    >
      <!-- Header with Pipeline Name and Timestamp -->
      <q-card-section class="pipeline-error-header tw:flex tw:items-center tw:justify-between">
        <div class="tw:flex-1">
          <div class="tw:flex tw:items-center tw:gap-3 tw:mb-1">
            <q-icon name="error" size="24px" class="error-icon" />
            <span class="pipeline-name">{{ errorDialog.data?.name }}</span>
          </div>
          <div class="error-timestamp">
            <span class="tw:mr-2">{{ t('pipeline_list.last_error') }}:</span>
            <q-icon name="schedule" size="14px" class="tw:mr-1" />
            {{ errorDialog.data && new Date(errorDialog.data.last_error.last_error_timestamp / 1000).toLocaleString() }}
          </div>
        </div>
        <q-btn
          icon="close"
          flat
          round
          dense
          @click="closeErrorDialog"
          class="close-btn"
        />
      </q-card-section>

      <q-separator />

      <q-card-section v-if="errorDialog.data" class="pipeline-error-content">
        <!-- Error Summary -->
        <div v-if="errorDialog.data.last_error.error_summary" class="tw:mb-4">
          <div class="section-label tw:mb-2">{{ t('pipeline_list.error_summary') }}</div>
          <div class="error-summary-box">
            {{ errorDialog.data.last_error.error_summary }}
          </div>
        </div>

        <!-- Node Errors -->
        <div v-if="errorDialog.data.last_error.node_errors && Object.keys(errorDialog.data.last_error.node_errors).length > 0">
          <div class="section-label tw:mb-3">{{ t('pipeline_list.node_errors') }}</div>
          <div class="node-errors-container">
            <div
              v-for="(nodeError, nodeId) in errorDialog.data.last_error.node_errors"
              :key="nodeId"
              class="node-error-item"
            >
              <div class="node-error-header">
                <span class="node-name">{{ nodeError.node_name || nodeId }}</span>
                <span class="node-type">{{ nodeError.node_type }}</span>
              </div>
              <div v-if="nodeError.error_messages && nodeError.error_messages.length > 0" class="node-error-messages">
                <div v-for="(msg, idx) in nodeError.error_messages" :key="idx" class="error-message">
                  {{ msg }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </q-card-section>

      <q-card-actions class="pipeline-error-actions">
        <q-btn
          flat
          no-caps
          :label="t('pipeline_list.close')"
          class="o2-secondary-button tw:h-[36px]"
          :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          @click="closeErrorDialog"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
<script setup lang="ts">
import {
  ref,
  onBeforeMount,
  computed,
  watch,
  reactive,
  onActivated,
  onMounted,
} from "vue";
import { MarkerType } from "@vue-flow/core";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import StreamSelection from "./StreamSelection.vue";
import pipelineService from "@/services/pipelines";
import { useStore } from "vuex";
import { useQuasar, type QTableProps } from "quasar";
import type { QTableColumn } from "quasar";

import NoData from "../shared/grid/NoData.vue";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
  outlinedVisibility,
  outlinedMoreVert,
} from "@quasar/extras/material-icons-outlined";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import AppTabs from "@/components/common/AppTabs.vue";
import PipelineView from "./PipelineView.vue";
import ResumePipelineDialog from "../ResumePipelineDialog.vue";
import CreateBackfillJobDialog from "@/components/pipelines/CreateBackfillJobDialog.vue";

import { filter, update } from "lodash-es";

interface Column {
  name: string;
  field: string;
  label: string;
  align: string;
  sortable?: boolean;
}

const { t } = useI18n();
const router = useRouter();

const qTableRef: any = ref({});

const q = useQuasar();

const filterQuery = ref("");

const showCreatePipeline = ref(false);

const expandedRow: any = ref([]); // Array to track expanded rows

const pipelines = ref([]);

const store = useStore();
const isEnabled = ref(false);

const shouldStartfromNow = ref(true);
const resumePipelineDialogMeta: any = ref({
  show: false,
  title: t('pipeline_list.resume_pipeline_title'),
  data: null,
  onConfirm: () =>  handleResumePipeline(),
  onCancel: () => handleCancelResumePipeline(),
});

const { pipelineObj } = useDragAndDrop();

watch(
  () => router.currentRoute.value,
  async () => {
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

const tabs = reactive([
  {
    label: t('pipeline_list.tab_all'),
    value: "all",
  },
  {
    label: t('pipeline_list.tab_scheduled'),
    value: "scheduled",
  },
  {
    label: t('pipeline_list.tab_realtime'),
    value: "realtime",
  },
]);
const perPageOptions: any = [
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "250", value: 250 },
  { label: "500", value: 500 },
];
const resultTotal = ref<number>(0);
const maxRecordToReturn = ref<number>(100);
const selectedPerPage = ref<number>(20);
const pagination: any = ref({
  rowsPerPage: 20,
});
const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  qTableRef.value?.setPagination(pagination.value);
};

const selectedPipelines = ref<any[]>([]);

const errorDialog = ref({
  show: false,
  data: null as any,
});

const backfillDialog = ref({
  show: false,
  pipelineId: "",
  pipelineName: "",
  scheduleFrequency: 60,
});

const currentRouteName = computed(() => {
  return router.currentRoute.value.name;
});

const filterColumns = (): Column[] => {
  if (activeTab.value === "realtime" || activeTab.value === "all") {
    return columns.value;
  }

  return columns.value.slice(1);
};

const updateActiveTab = () => {
  if (activeTab.value === "all") {
    filteredPipelines.value = pipelines.value.map(
      (pipeline: any, index: any) => ({
        ...pipeline,
        "#": index + 1,
      }),
    );
    columns.value = getColumnsForActiveTab(activeTab.value);
    filteredPipelines.value = pipelines.value;
    resultTotal.value = pipelines.value.length;
    return;
  }

  filteredPipelines.value = pipelines.value
    .filter((pipeline: any) => pipeline.source.source_type === activeTab.value)
    .map((pipeline: any, index) => ({
      ...pipeline,
      "#": index + 1,
    }));

  resultTotal.value = filteredPipelines.value.length;
  columns.value = getColumnsForActiveTab(activeTab.value);
};
//this is the function to check whether the pipeline is enabled or not
//becuase if it is not enabled then we need to show the dialog to resume the pipeline from where it paused / start from now
//else we need to toggle the pipeline state
const togglePipeline = (row: any) => {
  //if we are going to pause the pipeline and it is realtime pipeline then we need to toggle the pipeline state and pause the pipeline
  //and the resume at would be false because it is not required to resume the pipeline and for realtime pipelines from where it paused
  if(row.enabled || row.type == "realtime"){
    togglePipelineState(row,true);
  }else{
    //if we are going to resume the pipeline then we need to show the dialog to resume the pipeline from where it paused / start from now as per the user choice
    resumePipelineDialogMeta.value.show = true;
    resumePipelineDialogMeta.value.data = row;
  }
}

const togglePipelineState = (row: any, from_now: boolean) => {
  const newState = !row.enabled;
  pipelineService
    .toggleState(
      store.state.selectedOrganization.identifier,
      row.pipeline_id,
      newState,
      from_now
    )
    .then(async (response) => {
      row.enabled = newState;
      const message = row.enabled
        ? `${row.name} state resumed successfully`
        : `${row.name} state paused successfully`;
      q.notify({
        message: message,
        color: "positive",
        position: "bottom",
        timeout: 3000,
      });
      await getPipelines();
    })
    .catch((error) => {
      if (error.response.status != 403) {
        q.notify({
          message:
            error.response?.data?.message ||
            "Error while updating pipeline state",
          color: "negative",
          position: "bottom",
          timeout: 3000,
        });
      }
    });
};

const triggerExpand = (props: any) => {
  if (
    expandedRow.value === props.row.pipeline_id ||
    props.row.source.source_type === "realtime"
  ) {
    expandedRow.value = null;
  } else {
    // Otherwise, expand the clicked row and collapse any other row
    expandedRow.value = props.row.pipeline_id;
  }
};

const getColumnsForActiveTab = (tab: any) => {
  let realTimeColumns = [
    { name: "#", label: "#", field: "#", align: "left", style: "width: 67px;" },

    {
      name: "name",
      field: "name",
      label: t("common.name"),
      align: "left",
      sortable: true,
    },
    {
      name: "stream_name",
      field: "stream_name",
      label: t("alerts.stream_name"),
      align: "left",
      sortable: true,
    },
    {
      name: "stream_type",
      field: "stream_type",
      label: t("alerts.streamType"),
      align: "left",
      sortable: true,
    },
  ];

  let scheduledColumns = [
    { name: "#", label: "#", field: "#", align: "left", style: "width: 67px;" },

    {
      name: "name",
      field: "name",
      label: t("common.name"),
      align: "left",
      sortable: true,
    },
    {
      name: "stream_type",
      field: "stream_type",
      label: t('pipeline_list.stream_type'),
      align: "left",
      sortable: true,
    },
    {
      name: "frequency",
      field: "frequency",
      label: t('pipeline_list.frequency'),
      align: "left",
      sortable: true,
    },
    {
      name: "period",
      field: "period",
      label: t('pipeline_list.period'),
      align: "left",
      sortable: true,
    },
    {
      name: "cron",
      field: "cron",
      label: t('pipeline_list.cron'),
      align: "left",
      sortable: false,
    },
  ];

  const actionsColumn = {
    name: "actions",
    field: "actions",
    label: t("alerts.actions"),
    align: "center",
    sortable: false,
    classes: "actions-column",
  };
  if (tab === "all") {
    const allColumns = [...scheduledColumns, actionsColumn];
    allColumns.splice(2, 0, {
      name: "type",
      field: "type",
      label: t('pipeline_list.type'),
      align: "left",
      sortable: true,
    });

    allColumns.splice(3, 0, {
      name: "stream_name",
      field: "stream_name",
      label: t("alerts.stream_name"),
      align: "left",
      sortable: true,
    });

    return allColumns;
  }
  return tab === "realtime"
    ? [...realTimeColumns, actionsColumn]
    : [...scheduledColumns, actionsColumn];
};

onMounted(async () => {
  await getPipelines(); // Ensure pipelines are fetched before updating
  updateActiveTab();
});

const createPipeline = () => {
  showCreatePipeline.value = true;
};

const getPipelines = async () => {
  try {
    const response = await pipelineService.getPipelines(
      store.state.selectedOrganization.identifier,
    );
    pipelines.value = [];
    // resultTotal.value = response.data.list.length;
    pipelines.value = response.data.list.map((pipeline: any, index: any) => {
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
        pipeline.frequency = "--"
        pipeline.period = "--"
        pipeline.cron = "--"
        pipeline.sql_query = "--"
      } else {
        pipeline.stream_type = pipeline.source.stream_type;
        pipeline.frequency =
          pipeline.source.trigger_condition.frequency_type == "minutes"
            ? pipeline.source.trigger_condition.frequency + " Mins"
            : pipeline.source.trigger_condition.cron;
        pipeline.period = pipeline.source.trigger_condition.period + " Mins";
        pipeline.cron =
          pipeline.source.trigger_condition.frequency_type == "minutes"
            ? "False"
            : "True";
        pipeline.sql_query = pipeline.source.query_condition.sql;
      }

      pipeline.edges = updatedEdges;
      return {
        ...pipeline,
        "#": index + 1,
      };
    });
  } catch (error) {
    console.error(error);
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
  confirmDialogMeta.value.message =
    "Are you sure you want to delete this pipeline?";
  confirmDialogMeta.value.onConfirm = deletePipeline;
  confirmDialogMeta.value.data = pipeline;
};

const savePipeline = (data: any) => {
  const dismiss = q.notify({
    message: "saving pipeline...",
    position: "bottom",
    spinner: true,
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
      q.notify({
        message: "Pipeline created successfully",
        color: "positive",
        position: "bottom",
        timeout: 3000,
      });
    })
    .catch((error) => {
      dismiss();
      if (error.response.status != 403) {
        q.notify({
          message:
            error.response?.data?.message || "Error while saving pipeline",
          color: "negative",
          position: "bottom",
          timeout: 3000,
        });
      }
    });
};

const deletePipeline = async () => {
  const dismiss = q.notify({
    message: "deleting pipeline...",
    position: "bottom",
    spinner: true,
  });
  const { pipeline_id } = confirmDialogMeta.value.data;
  const org_id = store.state.selectedOrganization.identifier;
  pipelineService
    .deletePipeline({
      pipeline_id,
      org_id,
    })
    .then(async () => {
      q.notify({
        message: "Pipeline deleted successfully",
        color: "positive",
        position: "bottom",
        timeout: 3000,
      });
    })
    .catch((error) => {
      if (error.response.status != 403) {
        q.notify({
          message:
            error.response?.data?.message || "Error while deleting pipeline",
          color: "negative",
          position: "bottom",
          timeout: 3000,
        });
      }
    })
    .finally(async () => {
      selectedPipelines.value = [];
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

const filterData = (rows: any, terms: any) => {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]["name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
    }
  }
  return filtered;
};
const routeToAddPipeline = () => {
  router.push({
    name: "createPipeline",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
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

const routeToImportPipeline = () => {
  router.push({
    name: "importPipeline",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
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

  selectedPipelines.value = [];
  q.notify({
    message: `${pipelinesToExport.length} pipelines exported successfully`,
    color: "positive",
    position: "bottom",
    timeout: 3000,
  });
};
//if user clicks on run pipeline button then we need toggle the pipeline state and resume the pipeline from where it paused / start from now as per the user choice
const handleResumePipeline = () => {
  resumePipelineDialogMeta.value.show = false;
  togglePipelineState(resumePipelineDialogMeta.value.data,shouldStartfromNow.value);
}
//if user clicks on cancel button then we need to just close the dialog and do not toggle the pipeline state
const handleCancelResumePipeline = () => {
  resumePipelineDialogMeta.value.show = false;
  return;
};

const visibleRows = computed(() => {
    if (!filterQuery.value) return filteredPipelines.value || []
    return filterData(filteredPipelines.value || [], filterQuery.value)
  });

const hasVisibleRows = computed(() => visibleRows.value.length > 0);

// Watch visibleRows to sync resultTotal with search filter
watch(visibleRows, (newVisibleRows) => {
  resultTotal.value = newVisibleRows.length;
}, { immediate: true });

const showErrorDialog = (pipeline: any) => {
  errorDialog.value.show = true;
  errorDialog.value.data = pipeline;
};

const closeErrorDialog = () => {
  errorDialog.value.show = false;
  errorDialog.value.data = null;
};

const goToPipelineHistory = () => {
  router.push({
    name: "pipelineHistory",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
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
    const dismiss = q.notify({
      spinner: true,
      message: `${action === "resume" ? "Resuming" : "Pausing"} pipelines...`,
      timeout: 0,
    });
  try {
    const isResuming = action === "resume";
    // Filter pipelines based on action
    const pipelinesToToggle = selectedPipelines.value.filter((pipeline: any) =>
      isResuming ? !pipeline.enabled : pipeline.enabled
    );

    if (pipelinesToToggle.length === 0) {
      q.notify({
        type: "negative",
        message: `No pipelines to ${action}`,
        timeout: 2000,
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
      payload
    );

    if (response) {
      dismiss();
      q.notify({
        type: "positive",
        message: `Pipelines ${action}d successfully`,
        timeout: 2000,
      });
    }

    selectedPipelines.value = [];
    await getPipelines();
    updateActiveTab();
  } catch (error) {
    dismiss();
    console.error(`Error ${action}ing pipelines:`, error);
    q.notify({
      type: "negative",
      message: `Error ${action}ing pipelines. Please try again.`,
      timeout: 2000,
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
  const dismiss = q.notify({
    spinner: true,
    message: "Deleting pipelines...",
    timeout: 0,
  });

  try {
    if (selectedPipelines.value.length === 0) {
      q.notify({
        type: "negative",
        message: "No pipelines selected for deletion",
        timeout: 2000,
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
      payload
    );

    dismiss();

    // Handle response based on successful/unsuccessful arrays
    if (response.data) {
      const { successful = [], unsuccessful = [] } = response.data;
      const successCount = successful.length;
      const failCount = unsuccessful.length;

      if (failCount > 0 && successCount > 0) {
        // Partial success
        q.notify({
          type: "warning",
          message: `${successCount} pipeline(s) deleted successfully, ${failCount} failed`,
          timeout: 5000,
        });
      } else if (failCount > 0) {
        // All failed
        q.notify({
          type: "negative",
          message: `Failed to delete ${failCount} pipeline(s)`,
          timeout: 3000,
        });
      } else {
        // All successful
        q.notify({
          type: "positive",
          message: `${successCount} pipeline(s) deleted successfully`,
          timeout: 2000,
        });
      }
    } else {
      // Fallback success message
      q.notify({
        type: "positive",
        message: `${selectedPipelines.value.length} pipeline(s) deleted successfully`,
        timeout: 2000,
      });
    }

    selectedPipelines.value = [];
    await getPipelines();
    updateActiveTab();
  } catch (error: any) {
    dismiss();
    // Show error message from response if available
    const errorMessage = error.response?.data?.message || error?.message || "Error deleting pipelines. Please try again.";
    if (error.response?.status != 403 || error?.status != 403) {
      q.notify({
        type: "negative",
        message: errorMessage,
        timeout: 3000,
      });
    }
  }

  resetConfirmDialog();
};

const openBackfillDialog = (pipeline: any) => {
  // Extract schedule frequency from pipeline source (for scheduled pipelines)
  // The frequency is stored in trigger_condition.frequency (in minutes for derived streams)
  const scheduleFrequency =
    pipeline.source?.trigger_condition?.frequency || 60;

  backfillDialog.value = {
    show: true,
    pipelineId: pipeline.pipeline_id,
    pipelineName: pipeline.name,
    scheduleFrequency: scheduleFrequency,
  };
};

const onBackfillSuccess = (jobId: string) => {
  // Navigate to backfill jobs page after successful creation
  goToBackfillJobs();
};
</script>
<style lang="scss" scoped>
.dark-mode {
  background-color: $dark-page;

  .report-list-tabs {
    height: fit-content;

    :deep(.rum-tabs) {
      border: 1px solid #464646;
    }

    :deep(.rum-tab) {
      &:hover {
        background: #464646;
      }

      &.active {
        background: #5960b2;
        color: #ffffff !important;
      }
    }
  }
}

.expanded-content {
  padding: 0 3rem;
  max-height: 100vh; /* Set a fixed height for the container */
  overflow: hidden; /* Hide overflow by default */
}

.scrollable-content {
  width: 100%; /* Use the full width of the parent */
  overflow-y: auto; /* Enable vertical scrolling for long content */
  padding: 10px; /* Optional: padding for aesthetics */
  border: 1px solid #ddd; /* Optional: border for visibility */
  height: 100%;
  max-height: 200px;
  /* Use the full height of the parent */
  text-wrap: normal;
  background-color: #e8e8e8;
  color: black;
}
.expanded-sql {
  border-left: #7a54a2 3px solid;
}

.bottom-btn {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
}


// Glassmorphic Error Dialog
.pipeline-error-dialog {
  min-width: 600px;
  max-width: 800px;
  border-radius: 12px;
  overflow: hidden;
}

.pipeline-error-dialog-light {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

.pipeline-error-dialog-dark {
  background: rgba(30, 30, 30, 0.95);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.pipeline-error-header {
  padding: 20px 24px 16px;

  .error-icon {
    color: #ef4444;
  }

  .pipeline-name {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .error-timestamp {
    display: flex;
    align-items: center;
    font-size: 13px;
    opacity: 0.7;
    margin-left: 36px;
  }

  .close-btn {
    opacity: 0.6;
    transition: opacity 0.2s;

    &:hover {
      opacity: 1;
    }
  }
}

.pipeline-error-content {
  padding: 20px 24px;
  max-height: 60vh;
  overflow-y: auto;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  opacity: 0.8;
}

.error-summary-box {
  padding: 16px;
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #dc2626;
}

.node-errors-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.node-error-item {
  padding: 16px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.08);
  transition: all 0.2s;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}

.node-error-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;

  .node-name {
    font-weight: 600;
    font-size: 14px;
  }

  .node-type {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 12px;
    background: rgba(99, 102, 241, 0.1);
    color: #6366f1;
    font-weight: 500;
  }
}

.node-error-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error-message {
  padding: 12px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.06);
  border-left: 3px solid #ef4444;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: #991b1b;
}

.pipeline-error-actions {
  padding: 16px 24px;
  justify-content: flex-end;
}

// Dark mode overrides
.dark-mode {
  .pipeline-error-dialog-dark {
    .error-summary-box {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.3);
      color: #fca5a5;
    }

    .node-error-item {
      background: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.1);

      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }
    }

    .node-type {
      background: rgba(99, 102, 241, 0.15);
      color: #a5b4fc;
    }

    .error-message {
      background: rgba(239, 68, 68, 0.1);
      border-left-color: #fca5a5;
      color: #fecaca;
    }
  }
}
</style>
