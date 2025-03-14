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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div
    data-test="alert-list-page"
    class="q-pa-none flex"
    style="height: calc(100vh - 57px)"
    :class="store.state.theme === 'dark' ? 'dark-theme' : 'light-theme'"
  >
  <div v-if="!showAddAlertDialog && !showImportAlertDialog" class="flex justify-between full-width q-px-md q-pt-md">
          <div class="q-table__title" data-test="alerts-list-title">
                {{ t("alerts.header") }}
              </div>
              <div class="flex q-ml-auto  tw-ps-2">
              <q-input
              v-model="dynamicQueryModel"   
              dense
              filled
              borderless
              :placeholder="searchAcrossFolders ? t('dashboard.searchAcross') : t('alerts.search')"
              data-test="dashboard-search"
              :clearable="searchAcrossFolders"
              @clear="clearSearchHistory"
            >
              <template #prepend>
                <q-icon name="search" />
              </template>

            </q-input>
                  <div>
              <q-toggle
                data-test="dashboard-search-across-folders-toggle"
                v-model="searchAcrossFolders"
                label="All Folders"
                class="tw-mr-3"
              >
            </q-toggle>
              <q-tooltip class="q-mt-lg" anchor="top middle" self="bottom middle">
                {{ searchAcrossFolders
                  ? t("dashboard.searchSelf")
                  : t("dashboard.searchAll") }}
              </q-tooltip>
            </div>
              </div>
              <q-btn
                class="q-ml-md text-bold"
                padding="sm lg"
                outline
                no-caps
                :label="t(`dashboard.import`)"
                @click="importAlert"
                data-test="alert-import"
              />
              <q-btn
                data-test="alert-list-add-alert-btn"
                class="q-ml-md q-mb-xs text-bold no-border"
                padding="sm lg"
                color="secondary"
                no-caps
                :disable="!destinations.length"
                :title="!destinations.length ? t('alerts.noDestinations') : ''"
                :label="t(`alerts.add`)"
                @click="showAddUpdateFn({})"
              />
      </div>
      <div v-if="!showAddAlertDialog && !showImportAlertDialog" class="full-width alert-list-table">
          <q-splitter
          v-model="splitterModel"
          unit="px"
          :limits="[200, 500]"
          style="height: calc(100vh - 112px)"
          data-test="alert-list-splitter"
        >
          <template #before>
            <FolderList type="alerts" @update:activeFolderId="updateActiveFolderId" />
          </template>
          <template #after>
            <q-table
              v-model:selected="selected"
              :selected-rows-label="getSelectedString"
              selection="multiple"
              data-test="alert-list-table"
              ref="qTable"
              :rows="alertsList"
              :columns="columns"
              row-key="alert_id"
              :pagination="pagination"
              :filter="filterQuery"
              :filter-method="filterData"
              style="width: 100%"
          >
          <template #header-selection="scope">
            <q-checkbox
            v-model="allSelected"
            size="sm"
            color="secondary"
            @update:model-value="toggleAll"
          />      
        </template>
          <template #body-selection="scope">
            <q-checkbox v-model="scope.selected" size="sm" color="secondary" />
          </template>
          <template v-slot:body="props">
            <q-tr
              :data-test="`stream-association-table-${props.row.trace_id}-row`"
              :props="props"
              style="cursor: pointer"
              @click="triggerExpand(props)"
            >
          <q-td>
            <q-checkbox v-model="props.row.selected" size="sm" color="secondary" @update:model-value="handleRowSelection(props.row, $event)" />
          </q-td>
              
              <q-td v-for="col in columns" :key="col.name" :props="props">
                    <template v-if="col.name === 'name'">
                          {{ computedName(props.row[col.field]) }}
                        </template>
                        <template v-else-if="col.name === 'owner'">
                          {{ computedOwner(props.row[col.field]) }}
                        </template>
                        <template v-else-if="col.name == 'last_triggered_at' || col.name == 'last_satisfied_at'">
                        {{ props.row[col.field] }}
                      </template> 
                      <template v-else-if="col.name === 'period'">
                        {{ props.row[col.field] }} Mins
                      </template>
                      <template v-else-if="col.name === 'frequency'">
                        {{ props.row[col.field] }} {{ props.row?.frequency_type == 'cron' ? '' : 'Mins' }}
                      </template>
                    <template v-else-if="col.name  === 'folder_name'">
                    <div  @click.stop="updateActiveFolderId(props.row[col.field].id)">
                        {{ props.row[col.field].name }}
                    </div>
                      
                    </template>
              <template v-else-if="col.name == 'actions'">
                <div
                  data-test="alert-list-loading-alert"
                  v-if="alertStateLoadingMap[props.row.uuid]"
                  style="display: inline-block; width: 33.14px; height: auto"
                  class="flex justify-center items-center q-ml-xs"
                  :title="`Turning ${props.row.enabled ? 'Off' : 'On'}`"
                >
                  <q-circular-progress
                    indeterminate
                    rounded
                    size="16px"
                    :value="1"
                    color="secondary"
                  />
                </div>
                <q-btn
                  v-else
                  :data-test="`alert-list-${props.row.name}-pause-start-alert`"
                  :icon="props.row.enabled ? outlinedPause : outlinedPlayArrow"
                  class="q-ml-xs material-symbols-outlined"
                  padding="sm"
                  unelevated
                  size="sm"
                  :color="props.row.enabled ? 'negative' : 'positive'"
                  round
                  flat
                  :title="props.row.enabled ? t('alerts.pause') : t('alerts.start')"
                  @click.stop="toggleAlertState(props.row)"
                />
                <q-btn
                  :data-test="`alert-list-${props.row.name}-update-alert`"
                  icon="edit"
                  unelevated
                  size="sm"
                  round
                  flat
                  :title="t('alerts.edit')"
                  @click="editAlert(props.row)"
                ></q-btn>
                <q-btn
                  icon="content_copy"
                  :title="t('alerts.clone')"
                  unelevated
                  size="sm"
                  round
                  flat
                  @click.stop="duplicateAlert(props.row)"
                  :data-test="`alert-list-${props.row.name}-clone-alert`"
                ></q-btn>
                <q-btn
                  :icon="outlinedMoreVert" 
                  unelevated
                  size="sm"
                  round
                  flat
                  @click.stop="openMenu($event, props.row)"
                  :data-test="`alert-list-${props.row.name}-more-options`"
                >
                  <q-menu>
                    <q-list style="min-width: 100px">
                      <q-item class="flex items-center" clickable v-close-popup @click="moveAlertToAnotherFolder(props.row)">
                        <q-item-section dense avatar>
                          <q-icon size="16px" :name="outlinedDriveFileMove" />
                        </q-item-section>
                        <q-item-section>Move</q-item-section>
                      </q-item>
    
                      <q-item class="flex items-center justify-center" clickable v-close-popup @click="showDeleteDialogFn(props)">
                        <q-item-section dense avatar>
                          <q-icon size="16px" :name="outlinedDelete" />
                        </q-item-section>
                        <q-item-section>{{ t('alerts.delete') }}</q-item-section>
                      </q-item>
                      <q-item class="flex items-center justify-center" clickable v-close-popup @click="exportAlert(props.row)">
                        <q-item-section dense avatar>
                          <q-icon size="16px" name="download" />
                        </q-item-section>
                        <q-item-section>Export</q-item-section>
                      </q-item>
                    </q-list>
                  </q-menu>
                </q-btn>
              </template>
              <template v-else>
                {{ props.row[col.field] }}
              </template>
              </q-td>
            </q-tr>
      <q-tr v-show="expandedRow === props.row.alert_id" :props="props" >
    
        <q-td  colspan="100%">
    
          <div class="text-left tw-px-2 q-mb-sm  expand-content">
            <div class="tw-flex tw-items-start  tw-justify-start" >
              <strong >{{ props.row.type == 'sql' ? 'SQL Query' : 'Conditions' }} :  <span v-if="props.row.conditions != '' && props.row.conditions != '--'" >  <q-btn
                @click.stop="copyToClipboard(props.row.conditions, 'Conditions')"
                size="xs"
                dense
                flat
                icon="content_copy"
                class="copy-btn-sql tw-ml-2  tw-py-2 tw-px-2 "
              /></span></strong>
            </div>
    
              <div data-test="scheduled-pipeline-expanded-sql" class="scroll-content  expanded-sql ">
    
                    <pre style="text-wrap: wrap;">{{  (props.row.conditions != '' && props.row.conditions != '--')? props.row?.conditions : 'No condition' }} </pre>
                  </div>
          </div>
          <div class="text-left tw-px-2 q-mb-sm  expand-content">
            <div class="tw-flex tw-items-start  tw-justify-start" >
              <strong >Description : <span></span></strong>
            </div>
    
              <div data-test="scheduled-pipeline-expanded-sql" class="scroll-content  expanded-sql ">
                    <pre style="text-wrap: wrap;">{{ props.row?.description || 'No description' }}  </pre>
                  </div>
          </div>
        </q-td>
      </q-tr>
          </template>
            <template #no-data>
              <div
                v-if="!templates.length || !destinations.length"
                class="full-width flex column justify-center items-center text-center"
              >
                <div style="width: 600px" class="q-mt-xl">
                  <template v-if="!templates.length">
                    <div
                      class="text-subtitle1"
                      data-test="alert-list-create-template-text"
                    >
                      It looks like you haven't created any Templates yet. To create
                      an Alert, you'll need to have at least one Destination and one
                      Template in place
                    </div>
                    <q-btn
                      data-test="alert-list-create-template-btn"
                      class="q-mt-md"
                      label="Create Template"
                      size="md"
                      color="primary"
                      no-caps
                      style="border-radius: 4px"
                      @click="routeTo('alertTemplates')"
                    />
                  </template>
                  <template v-if="!destinations.length && templates.length">
                    <div
                      class="text-subtitle1"
                      data-test="alert-list-create-destination-text"
                    >
                      It looks like you haven't created any Destinations yet. To
                      create an Alert, you'll need to have at least one Destination
                      and one Template in place
                    </div>
                    <q-btn
                      data-test="alert-list-create-destination-btn"
                      class="q-mt-md"
                      label="Create Destination"
                      size="md"
                      color="primary"
                      no-caps
                      style="border-radius: 4px"
                      @click="routeTo('alertDestinations')"
                    />
                  </template>
                </div>
              </div>
              <template v-else>
                <NoData />
              </template>
            </template>
    
            <template v-slot:body-cell-function="props">
              <q-td :props="props">
                <q-tooltip>
                  <pre>{{ props.row.sql }}</pre>
                </q-tooltip>
                <pre style="white-space: break-spaces">{{ props.row.sql }}</pre>
              </q-td>
            </template>
    
            <template #top="scope">
    
    
              <QTablePagination
                :scope="scope"
                :pageTitle="t('alerts.header')"
                :position="'top'"
                :resultTotal="resultTotal"
                :perPageOptions="perPageOptions"
                @update:changeRecordPerPage="changePagination"
              />
            </template>
    
            <template #bottom="scope" >
              <div class="bottom-btn"> 
              <q-btn
                v-if="selected.length > 0"
                data-test="alert-list-move-across-folders-btn"
                class="flex items-center move-btn q-mr-md"
                color="secondary"
                :icon="outlinedDriveFileMove"
                :label="'Move'"
                @click="moveMultipleAlerts"
              />
              <q-btn
                v-if="selected.length > 0"
                data-test="alert-list-export-alerts-btn"
                class="flex items-center export-btn"
                color="secondary"
                icon="download"
                :label="'Export'"
                @click="multipleExportAlert"
              />
              <QTablePagination
                :scope="scope"
                :position="'bottom'"
                :resultTotal="resultTotal"
                :perPageOptions="perPageOptions"
                @update:changeRecordPerPage="changePagination"
              />
              </div>
            </template>
          </q-table>
          </template>
        </q-splitter>
        </div>
    <template v-else-if="showAddAlertDialog && !showImportAlertDialog">
      <AddAlert
        v-model="formData"
        :isUpdated="isUpdated"
        :destinations="destinations"
        @update:list="refreshList"
        @cancel:hideform="hideForm"
        @refresh:destinations="refreshDestination"
      />
    </template>
    <template v-else>
      <ImportAlert
      :destinations="destinations"
      :templates="templates"
      :alerts="alerts"
      @update:alerts="getAlertsFn"
      @update:destinations="refreshDestination"
      @update:templates="getTemplates"
       />
    </template>
    <ConfirmDialog
      title="Delete Alert"
      message="Are you sure you want to delete alert?"
      @update:ok="deleteAlertByAlertId"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
    <template>
      <q-dialog class="q-pa-md" v-model="showForm" persistent>
        <q-card class="clone-alert-popup">
          <div class="row items-center no-wrap q-mx-md q-my-sm">
            <div class="flex items-center">
              <div
                data-test="add-alert-back-btn"
                class="flex justify-center items-center q-mr-md cursor-pointer"
                style="
                  border: 1.5px solid;
                  border-radius: 50%;
                  width: 22px;
                  height: 22px;
                "
                title="Go Back"
                @click="showForm = false"
              >
                <q-icon name="arrow_back_ios_new" size="14px" />
              </div>
              <div class="text-h6" data-test="clone-alert-title">
                {{ t("alerts.cloneTitle") }}
              </div>
            </div>
          </div>
          <q-card-section>
            <q-form @submit="submitForm">
              <q-input  data-test="to-be-clone-alert-name" v-model="toBeCloneAlertName" label="Alert Name" />
              <q-select
              data-test="to-be-clone-stream-type"
                v-model="toBeClonestreamType"
                label="Stream Type"
                :options="streamTypes"
                @update:model-value="updateStreams()"
              />
              <q-select
                data-test="to-be-clone-stream-name"
                v-model="toBeClonestreamName"
                :loading="isFetchingStreams"
                :disable="!toBeClonestreamType"
                label="Stream Name"
                :options="streamNames"
                @change="updateStreamName"
                @filter="filterStreams"
                use-input
                fill-input
                hide-selected
                :input-debounce="400"
              />
              <div class="flex justify-center q-mt-lg">
                <q-btn
                  data-test="clone-alert-cancel-btn"
                  v-close-popup="true"
                  class="q-mb-md text-bold"
                  :label="t('alerts.cancel')"
                  text-color="light-text"
                  padding="sm md"
                  no-caps
                />
                <q-btn
                  data-test="clone-alert-submit-btn"
                  :label="t('alerts.save')"
                  class="q-mb-md text-bold no-border q-ml-md"
                  color="secondary"
                  padding="sm xl"
                  type="submit"
                  :disable="isSubmitting"
                  no-caps
                />
              </div>
            </q-form>
          </q-card-section>
        </q-card>
      </q-dialog>
      <q-dialog
          v-model="showMoveAlertDialog"
          position="right"
          full-height
          maximized
          data-test="dashboard-move-to-another-folder-dialog"
        >
          <MoveAcrossFolders
            :activeFolderId="activeFolderToMove"
            :moduleId="selectedAlertToMove"
            type="alerts"
            @updated="updateAcrossFolders"
          />
        </q-dialog>
    </template>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onBeforeMount,
  onActivated,
  watch,
  defineAsyncComponent,
  onMounted,
  computed,
} from "vue";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";

import { QTable, date, useQuasar, type QTableProps, debounce } from "quasar";
import { useI18n } from "vue-i18n";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import ImportAlert from "@/components/alerts/ImportAlert.vue";
import {
  getImageURL,
  getUUID,
  verifyOrganizationStatus,
} from "@/utils/zincutils";
import { getFoldersListByType } from "@/utils/commons";
import type { Alert, AlertListItem } from "@/ts/interfaces/index";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
  outlinedDriveFileMove,
  outlinedMoreVert,
} from "@quasar/extras/material-icons-outlined";
import FolderList from "../common/sidebar/FolderList.vue";

import MoveAcrossFolders from "../common/sidebar/MoveAcrossFolders.vue";
import { toRaw } from "vue";
import { nextTick } from "vue";
// import alertList from "./alerts";

export default defineComponent({
  name: "AlertList",
  components: {
    QTablePagination,
    AddAlert: defineAsyncComponent(
      () => import("@/components/alerts/AddAlert.vue")
    ),
    NoData,
    ConfirmDialog,
    ImportAlert,
    FolderList,
    MoveAcrossFolders,
  },
  emits: [
    "updated:fields",
    "update:changeRecordPerPage",
    "update:maxRecordToReturn",
  ],
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const router = useRouter();
    const alerts: Ref<Alert[]> = ref([]);
    const alertsRows: Ref<AlertListItem[]> = ref([]);
    const alertRowsToDisplay: Ref<AlertListItem[]> = ref([]);

    const formData: Ref<Alert | {}> = ref({});
    const toBeClonedAlert: Ref<any> = ref({});
    const showAddAlertDialog: any = ref(false);
    const qTable: Ref<InstanceType<typeof QTable> | null> = ref(null);
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const splitterModel = ref(200);
    const showForm = ref(false);
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const streams: any = ref({});
    const isFetchingStreams = ref(false);
    const isSubmitting = ref(false);

    const showImportAlertDialog = ref(false);

    const { getStreams } = useStreams();

    const toBeCloneAlertName = ref("");
    const toBeClonedID = ref("");
    const toBeClonestreamType = ref("");
    const toBeClonestreamName = ref("");
    const streamTypes = ref(["logs", "metrics", "traces"]);
    const streamNames: Ref<string[]> = ref([]);
    const alertStateLoadingMap: Ref<{ [key: string]: boolean }> = ref({});
    const folders = ref([
      {
        name: "folder1",
      },
      {
        name: "folder2",
      },
    ]);
    const activeFolderId = ref("default");
    const showMoveAlertDialog = ref(false);
    const expandedRow: Ref<any> = ref("");
    const triggerExpand = (props: any) => {
      if (expandedRow.value === props.row.alert_id) {
        expandedRow.value = null;
      } else {
        expandedRow.value = props.row.alert_id;
      }
    }
    const activeFolderToMove = ref("default");
    const columns: any = ref<QTableProps["columns"]>([
          {
            name: "#",
            label: "#",
            field: "#",
            align: "left",
          },
          {
            name: "name",
            field: "name",
            label: t("alerts.name"),
            align: "left",
            sortable: true,
          },
          {
            name: "owner",
            field: "owner",
            label: t("alerts.owner"),
            align: "center",
            sortable: true,
            style: "width: 150px",
          },
          {
            name: "period",
            field: "period",
            label: t("alerts.period"),
            align: "center",
            sortable: true,
            style: "width: 150px",
          },
          {
            name: "frequency",
            field: "frequency",
            label: t("alerts.frequency"),
            align: "left",
            sortable: true,
            style: "width: 150px",
          },
          {
            name: "last_triggered_at",
            field: "last_triggered_at",
            label: t("alerts.lastTriggered"),
            align: "left",
            sortable: true,
            style: "width: 150px",
          },
          {
            name: "last_satisfied_at",
            field: "last_satisfied_at",
            label: t("alerts.lastSatisfied"),
            align: "left",
            sortable: true,
            style: "width: 150px",
          },
          {
            name: "actions",
            field: "actions",
            label: t("alerts.actions"),
            align: "center",
            sortable: false,
            style: "width: 150px",
    
          },
        ]);
    const activeTab: any = ref("alerts");
    const destinations = ref([0]);
    const templates = ref([0]);
    const selected: Ref<any> = ref([]);
    const allSelected = ref(false);

    const searchQuery = ref("");
    const filterQuery = ref("");
    const searchAcrossFolders = ref(false);
    const filteredResults: Ref<any[]> = ref([]);
    const selectedAlertToMove: Ref<any> = ref({});
    const getAlertsByFolderId = async (store: any, folderId: any) => {
        try {
          if (!store.state.organizationData.allAlertsListByFolderId[folderId]) {
            await getAlertsFn(store, folderId);
          }
          else{
            alertsRows.value = store.state.organizationData.allAlertsListByFolderId[folderId];
          }
        } catch (error) {
          throw error;
        }
    };
    const getAlertsFn = async (store: any, folderId: string, query = "") => {
          const dismiss = $q.notify({
            spinner: true,
            message: "Please wait while loading alerts...",
          });
          if(query){
            folderId = ""
          }
          alertsService
            .listByFolderId(
              1,
              1000,
              "name",
              false,
              "",
              store.state.selectedOrganization.identifier,
              folderId,
              query
            )
            .then(async (res) => {
              var counter = 1;
              alerts.value = res.data.list.map((alert: any) => {
                return {
                  ...alert,
                  uuid: getUUID(),
                };
              });
              alertsRows.value = alerts.value.map((data: any) => {
                let conditions = "--";
                if (data.condition.conditions?.length) {
                  conditions = data.condition.conditions
                    .map((condition: any) => {
                      return `${condition.column} ${condition.operator} ${condition.value}`;
                    })
                    .join(" AND ");
                } else if (data.condition.sql) {
                  conditions = data.condition.sql;
                } else if (data.condition.promql) {
                  conditions = data.condition.promql;
                }
                let frequency = "";
                if(data.trigger_condition?.frequency_type == 'cron'){
                  frequency = data.trigger_condition.cron;
                }else{
                  frequency = data.trigger_condition.frequency;
                }

                return {
                  "#": counter <= 9 ? `0${counter++}` : counter++,
                  alert_id: data.alert_id,
                  name: data.name,
                  alert_type: data.is_real_time ? "Real Time" : "Scheduled",
                  stream_name: data.stream_name ? data.stream_name : "--",
                  stream_type: data.stream_type,
                  enabled: data.enabled,
                  conditions: conditions,
                  description: data.description,
                  uuid: data.uuid,
                  owner: data.owner,
                  period: data?.trigger_condition?.period,
                  frequency: frequency,
                  frequency_type: data?.trigger_condition?.frequency_type,
                  last_triggered_at: convertUnixToQuasarFormat(
                    data.last_triggered_at
                  ),
                  last_satisfied_at: convertUnixToQuasarFormat(
                    data.last_satisfied_at
                  ),
                  selected: false,
                  type: data.condition.type,
                  folder_name: {
                    name: data.folder_name,
                    id: data.folder_id
                  },
                };
              });
    
              if(searchAcrossFolders.value && columns.value.length < 7){
                columns.value.splice(2,0,{
                  name: "folder_name",
                  field: "folder_name",
                  label: 'Folder',
                  align: "center",
                  sortable: true,
                  style: "width: 150px",
                })
              }
              else if (columns.value.length == 7){
                columns.value.splice(2,1);
              }
              alertsRows.value.forEach((alert: AlertListItem) => {
                alertStateLoadingMap.value[alert.uuid as string] = false;
              });
              if(query == "" && !searchAcrossFolders.value){
                store.dispatch("setAllAlertsListByFolderId", {
                ...store.state.organizationData.allAlertsListByFolderId,
                [folderId]: alertsRows.value
                });
              }else{
                filteredResults.value = alertsRows.value;
              }
              if(router.currentRoute.value.query.action == "import"){
                showImportAlertDialog.value = true;
              }
              if (router.currentRoute.value.query.action == "add") {
                showAddUpdateFn({ row: undefined });
              }
              if (router.currentRoute.value.query.action == "update") {
                const alertId = router.currentRoute.value.query.alert_id as string;
                const alert = await getAlertById(alertId);
    
                showAddUpdateFn( {
                  row: alert,
                });
              }
              dismiss();
            })
            .catch((e) => {
              console.error(e);
              dismiss();
              $q.notify({
                type: "negative",
                message: "Error while pulling alerts.",
                timeout: 2000,
              });
            });
        };
    const getAlertByName = (name: string) => {
      return alerts.value.find((alert) => alert.name === name);
    };
    const getAlertById = async (id: string) => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading alert...",
      });
       try {
        const res = await alertsService.get_by_alert_id(store.state.selectedOrganization.identifier, id);
        dismiss();
        return res.data;
       } catch (error) {
        dismiss();
        throw error;
       }
    };
    onBeforeMount(async () => {
      await getTemplates();
      getDestinations();
    });
    onActivated(() => getDestinations());
    onMounted(async () => {
      if(!store.state.organizationData.foldersByType){
        await getFoldersListByType(store, "alerts");
      }
      if (
        router.currentRoute.value.query.folder &&
        store.state.organizationData.foldersByType.find(
          (it: any) => it.folderId === router.currentRoute.value.query.folder,
        )
      ) {
        console.log(router.currentRoute.value.query.folder,'router.currentRoute.value.query.folder')
        activeFolderId.value = router.currentRoute.value.query.folder as string;
      } else {
        activeFolderId.value = "default";
      }
      getAlertsFn(store, activeFolderId.value);

    });
    watch(()=> activeFolderId.value, async (newVal)=>{
      if(searchAcrossFolders.value) {
        searchAcrossFolders.value = false
        searchQuery.value = "";
        filteredResults.value = [];
      }
      await  getAlertsByFolderId(store,newVal);
      if(router.currentRoute.value.query.folder != newVal){
        router.push({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
        },
      });
      }


    })

    watch(searchQuery, async (newQuery) => {
      await debouncedSearch(newQuery);
      if(searchQuery.value == ""){
        filteredResults.value = [];
      }
    });
    watch(searchAcrossFolders, async (newVal) => {
      if(!newVal && columns.value.length == 7){
        columns.value.splice(2,1);
      }
    })
    watch(
      () => router.currentRoute.value.query.action,
      (action) => {
        if (!action) {
          showAddAlertDialog.value = false;
          showImportAlertDialog.value = false;
        }
      }
    );
    const getDestinations = async () => {
      destinationService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        })
        .then((res) => {
          destinations.value = res.data;
        })
        .catch(() =>
          $q.notify({
            type: "negative",
            message: "Error while fetching destinations.",
            timeout: 3000,
          })
        );
    };

    const getTemplates = () => {
      templateService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
        })
        .then((res) => {
          templates.value = res.data;
        })
        .catch(() =>
          $q.notify({
            type: "negative",
            message: "Error while fetching templates.",
            timeout: 3000,
          })
        );
    };
    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "All", value: 0 },
    ];
    const resultTotal = computed(function () {
      if(!searchAcrossFolders.value || searchQuery.value == ""){
        return store.state.organizationData?.allAlertsListByFolderId[
          activeFolderId.value
        ]?.length;
      }
      else{
        return filteredResults.value.length;
      }

    });    
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value?.setPagination(pagination.value);
    };
    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
    };

    function convertUnixToQuasarFormat(unixMicroseconds: any) {
      if (!unixMicroseconds) return "";
      const unixSeconds = unixMicroseconds / 1e6;
      const dateToFormat = new Date(unixSeconds * 1000);
      const formattedDate = dateToFormat.toISOString();
      return date.formatDate(formattedDate, "YYYY-MM-DDTHH:mm:ssZ");
    }

    const addAlert = () => {
      showAddAlertDialog.value = true;
    };

    const duplicateAlert = async (row: any) => {
      toBeClonedID.value = row.alert_id;
      toBeCloneAlertName.value = row.name;
      toBeClonestreamName.value = "";
      toBeClonestreamType.value = ""
      showForm.value = true;
      toBeClonedAlert.value = await getAlertById(row.alert_id);
    };
    const submitForm = async () => {

      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      if (!toBeClonedAlert.value) {
        $q.notify({
          type: "negative",
          message: "Alert not found",
          timeout: 2000,
        });
        return;
      }
      if (!toBeClonestreamType.value) {
        $q.notify({
          type: "negative",
          message: "Please select stream type ",
          timeout: 2000,
        });
        return;
      }
      if (!toBeClonestreamName.value) {
        $q.notify({
          type: "negative",
          message: "Please select stream name",
          timeout: 2000,
        });
        return;
      }
      isSubmitting.value = true;

      toBeClonedAlert.value.name = toBeCloneAlertName.value;
      toBeClonedAlert.value.stream_name = toBeClonestreamName.value;
      toBeClonedAlert.value.stream_type = toBeClonestreamType.value;
      toBeClonedAlert.value.folder_id = activeFolderId.value;

      try {
        alertsService
          .create_by_alert_id(
            store.state.selectedOrganization.identifier,
            toBeClonedAlert.value
          )
          .then((res) => {
            dismiss();
            if (res.data.code == 200) {
              $q.notify({
                type: "positive",
                message: "Alert Cloned Successfully",
                timeout: 2000,
              });
              showForm.value = false;
              getAlertsFn(store, activeFolderId.value);
            } else {
              $q.notify({
                type: "negative",
                message: res.data.message,
                timeout: 2000,
              });
            }
          })
          .catch((e: any) => {
            if(e.response?.status == 403){
              showForm.value = false;
              isSubmitting.value = false;
              return;
            }
            dismiss();
            $q.notify({
              type: "negative",
              message: e.response.data.message,
              timeout: 2000,
            });
          })
          .finally(() => {
            isSubmitting.value = false;
          });
      } catch (e: any) {
        showForm.value = true;
        isSubmitting.value = false;
        $q.notify({
          type: "negative",
          message: e.data.message,
          timeout: 2000,
        });
      }
    };
    const showAddUpdateFn = (props: any) => {
      formData.value = props.row;
      let action;
      if (!props.row) {
        isUpdated.value = false;
        action = "Add Alert";
        router.push({
          name: "alertList",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
            folder: activeFolderId.value,
          },
        });
      } else {
        isUpdated.value = true;
        action = "Update Alert";
        router.push({
          name: "alertList",
          query: {
            alert_id: props.row.id,
            action: "update",
            name: props.row.name,
            org_identifier: store.state.selectedOrganization.identifier,
            folder: activeFolderId.value,
          },
        });
      }
      addAlert();
      if (config.enableAnalytics == "true") {
        segment.track("Button Click", {
          button: action,
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          page: "Alerts",
        });
      }
    };
    const refreshList = () => {
      getAlertsFn(store, activeFolderId.value);
      hideForm();
    };
    const hideForm = () => {
      showAddAlertDialog.value = false;
      router.push({
        name: "alertList",
        query: {
          folder: activeFolderId.value,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };
    const deleteAlertByAlertId = () => {
          alertsService
            .delete_by_alert_id(
              store.state.selectedOrganization.identifier,
              selectedDelete.value.alert_id
            )
            .then((res: any) => {
              if (res.data.code == 200) {
                $q.notify({
                  type: "positive",
                  message: res.data.message,
                  timeout: 2000,
                });
                getAlertsFn(store, activeFolderId.value);
              } else {
                $q.notify({
                  type: "negative",
                  message: res.data.message,
                  timeout: 2000,
                });
              }
            })
            .catch((err) => {
              if(err.response?.status == 403){
                return;
              }
              $q.notify({
                type: "negative",
                message: err?.data?.message || "Error while deleting alert.",
                timeout: 2000,
              });
            });
          if (config.enableAnalytics == "true") {
            segment.track("Button Click", {
              button: "Delete Alert",
              user_org: store.state.selectedOrganization.identifier,
              user_id: store.state.userInfo.email,
              alert_name: selectedDelete.value.name,
              page: "Alerts",
            });
          }
        };
    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDelete.value = true;
    };
    const filterColumns = (options: any[], val: String, update: Function) => {
      let filteredOptions: any[] = [];
      if (val === "") {
        update(() => {
          filteredOptions = [...options];
        });
        return filteredOptions;
      }
      update(() => {
        const value = val.toLowerCase();
        filteredOptions = options.filter(
          (column: any) => column.toLowerCase().indexOf(value) > -1
        );
      });
      return filteredOptions;
    };
    const updateStreamName = (selectedOption: any) => {
      toBeClonestreamName.value = selectedOption;
    };
    const updateStreams = (resetStream = true) => {
      if (resetStream) toBeClonestreamName.value = "";
      if (streams.value[toBeClonestreamType.value]) {
        schemaList.value = streams.value[toBeClonestreamType.value];
        indexOptions.value = streams.value[toBeClonestreamType.value].map(
          (data: any) => {
            return data.name;
          }
        );
        updateStreamName(toBeClonestreamName.value);

        return;
      }

      if (!toBeClonestreamType.value) return Promise.resolve();

      isFetchingStreams.value = true;
      return getStreams(toBeClonestreamType.value, false)
        .then((res: any) => {
          streams.value[toBeClonestreamType.value] = res.list;
          schemaList.value = res.list;
          indexOptions.value = res.list.map((data: any) => {
            return data.name;
          });

          return Promise.resolve();
        })
        .catch(() => Promise.reject())
        .finally(() => (isFetchingStreams.value = false));
    };
    const filterStreams = (val: string, update: any) => {
      streamNames.value = filterColumns(indexOptions.value, val, update);
    };

    const toggleAlertState = (row: any) => {
          alertStateLoadingMap.value[row.uuid] = true;
          
          alertsService
            .toggle_state_by_alert_id(
              store.state.selectedOrganization.identifier,
              row.alert_id,
              !row?.enabled
            )
            .then((res: any) => {
              const isEnabled = res.data.enabled;
              alertsRows.value.forEach((alert) => {
                alert.uuid === row.uuid ? (alert.enabled = isEnabled) : null;
              });
              $q.notify({
                type: "positive",
                message: isEnabled ? "Alert Resumed Successfully" : "Alert Paused Successfully",
                timeout: 2000,
              });
            })
            .finally(() => {
              alertStateLoadingMap.value[row.uuid] = false;
            });
        };

    const routeTo = (name: string) => {
      router.push({
        name: name,
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
        },
      });
    };

    const refreshDestination = async () =>{

      await getDestinations();

    }

    const importAlert = () =>{
      showImportAlertDialog.value = true;
      router.push({
        name: "alertList",
        query: {
          action: "import",
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
        },
      });
    }
    const exportAlert = async (row: any) => {
      // Find the alert based on uuid
      const alertToBeExported = await getAlertById(row.alert_id)

  // Ensure that the alert exists before proceeding
  if (alertToBeExported) {

    // Convert the alert object to a JSON string
    const alertJson = JSON.stringify(alertToBeExported, null, 2);

    // Create a Blob from the JSON string
    const blob = new Blob([alertJson], { type: 'application/json' });

    // Create an object URL for the Blob
    const url = URL.createObjectURL(blob);

    // Create an anchor element to trigger the download
    const link = document.createElement('a');
    link.href = url;

    // Set the filename of the download
    link.download = `${alertToBeExported.name}.json`;

    // Trigger the download by simulating a click
    link.click();

    // Clean up the URL object after download
    URL.revokeObjectURL(url);
  } else {
    // Alert not found, handle error or show notification
    console.error('Alert not found for UUID:', row.uuid);
  }
};
const updateActiveFolderId = (newVal: any) => {
      searchQuery.value = "";
      activeFolderId.value = newVal;
      selected.value = [];
      allSelected.value = false;
      alertsRows.value.forEach((alert: any) => {
        alert.selected = false;
      }); 
    }

    const editAlert = async (row: any) => {
      const selectedAlert = await getAlertById(row.alert_id);
      showAddUpdateFn({ row: selectedAlert });
    }

    const moveAlertToAnotherFolder = (row: any) => {
      showMoveAlertDialog.value = true;
      selectedAlertToMove.value = [row.alert_id];
      activeFolderToMove.value = activeFolderId.value;
    }

    const updateAcrossFolders = async (activeFolderId: any, selectedFolderId: any) => {
      await getAlertsFn(store, activeFolderId);
      await getAlertsFn(store, selectedFolderId);
      showMoveAlertDialog.value = false;
      selectedAlertToMove.value = [];
      activeFolderToMove.value = "";
      selected.value = [];
      allSelected.value = false;
    }

    const getSelectedString = () => {
      return selected.value.length === 0
        ? ""
        : `${selected.value.length} record${
            selected.value.length > 1 ? "s" : ""
          } selected`;
    };

    const moveMultipleAlerts = () => {
      showMoveAlertDialog.value = true;
      const selectedAlerts = selected.value.map((alert: any) => {
        return  alert.alert_id;
      });
      selectedAlertToMove.value = selectedAlerts;
      activeFolderToMove.value = activeFolderId.value;
    }

    const dynamicQueryModel = computed ({
      get() {
        return searchAcrossFolders.value ? searchQuery.value : filterQuery.value;
      },
      set(value) {
        if (searchAcrossFolders.value) {
          searchQuery.value = value;
        } else {
          filterQuery.value = value;
        }
      },
    });

    const clearSearchHistory = () => {
      searchQuery.value = "";
      filteredResults.value = [];
    }

    const debouncedSearch = debounce (async (query) => {
      if(!query) return;
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait while searching for dashboards...",
        });
        dismiss();
        await getAlertsFn(store, activeFolderId.value, query);
        filteredResults.value = alertsRows.value;
    }, 600);

    const alertsList = computed(() => {
      if(searchAcrossFolders.value && searchQuery.value != ""){
        return filteredResults.value;
      }
      return store.state.organizationData.allAlertsListByFolderId[activeFolderId.value] ?? [];
    });

    const toggleAll = () => {
      if (allSelected.value) {
        // Select all rows
        selected.value = [...alertsList.value];
        alertsRows.value.forEach((alert: any) => {
          alert.selected = true;
        });
      } else {
        // Deselect all rows
        selected.value = [];
        alertsRows.value.forEach((alert: any) => {
          alert.selected = false;
        });
      }
    };

    // Add watcher to update allSelected when selected items change
    watch(selected, (newVal) => {
      allSelected.value = newVal.length === alertsList.value.length && alertsList.value.length > 0;
    });

    const handleRowSelection = (row: any, isSelected: boolean) => {
      row.selected = isSelected;
      if (isSelected) {
        selected.value = [...selected.value, row];
      } else {
        selected.value = selected.value.filter((item: any) => item.alert_id !== row.alert_id);
      }
    };

    const  copyToClipboard = (text: string,type: string) => {
      navigator.clipboard.writeText(text).then(() => {
        $q.notify({
            type: "positive",
            message: `${type} Copied Successfully!`,
            timeout: 5000,
          });
      }).catch(() => {
          $q.notify({
            type: "negative",
            message: "Error while copy content.",
            timeout: 5000,
          });
      });
    }

    const openMenu = (event: Event, row: any) => {
      event.stopPropagation();
    };

    const multipleExportAlert = async () => {
      try {
        const dismiss = $q.notify({
          spinner: true,
          message: "Exporting alerts...",
          timeout: 0 // Set timeout to 0 to keep it showing until dismissed
        });

        const alertToBeExported = [];
        const selectedAlerts = selected.value.map((alert: any) => alert.alert_id);
        
        const alertsData = await Promise.all(
          selectedAlerts.map(async (alertId: string) => {
            const alertData = await getAlertById(alertId);
            return alertData;
          })
        );
        alertToBeExported.push(...alertsData);

        // Create and download the JSON file
        const jsonData = JSON.stringify(alertToBeExported, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `alerts-${new Date().toISOString().split('T')[0]}-${activeFolderId.value}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        
        dismiss();
        $q.notify({
          type: 'positive',
          message: `Successfully exported ${selectedAlerts.length} alert${selectedAlerts.length > 1 ? 's' : ''}`,
          timeout: 2000
        });

      } catch (error) {
        console.error('Error exporting alerts:', error);
        $q.notify({
          type: 'negative',
          message: 'Error exporting alerts. Please try again.',
          timeout: 2000
        });
      }
    };
    const computedName = (name: string) => {
          return name.length >30 ? name.substring(0, 30) + "..." : name;
        };
    const computedOwner = (owner: string) => {
        if (owner.length > 15) {
          const firstTen = owner.substring(0, 7);
          const lastFour = owner.substring(owner.length - 4);
          return firstTen + "****" + lastFour;
        }
        return owner;
      };


    return {
      t,
      qTable,
      store,
      router,
      alerts,
      columns,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      updateStreams,
      updateStreamName,
      pagination,
      resultTotal,
      refreshList,
      perPageOptions,
      selectedPerPage,
      addAlert,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      duplicateAlert,
      changePagination,
      maxRecordToReturn,
      showAddAlertDialog,
      showForm,
      toBeCloneAlertName,
      toBeClonestreamType,
      toBeClonestreamName,
      streamTypes,
      filterColumns,
      filterStreams,
      streamNames,
      submitForm,
      schemaList,
      indexOptions,
      streams,
      isFetchingStreams,
      isSubmitting,
      changeMaxRecordToReturn,
      outlinedDelete,
      filterQuery,
      filterData(rows: any, terms: any) {
        var filtered = [];
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (
            rows[i]["name"].toLowerCase().includes(terms) ||
            (rows[i]["stream_name"] != null &&
              rows[i]["stream_name"].toLowerCase().includes(terms)) ||
            (rows[i]["owner"] != null &&
              rows[i]["owner"].toLowerCase().includes(terms)) ||
            (rows[i]["enabled"] != null &&
              rows[i]["enabled"].toString().toLowerCase().includes(terms)) ||
            (rows[i]["alert_type"] != null &&
              rows[i]["alert_type"].toString().toLowerCase().includes(terms)) ||
            (rows[i]["stream_type"] != null &&
              rows[i]["stream_type"]
                .toString()
                .toLowerCase()
                .includes(terms)) ||
            (rows[i]["description"] != null &&
              rows[i]["description"].toString().toLowerCase().includes(terms))
          ) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      getImageURL,
      activeTab,
      destinations,
      verifyOrganizationStatus,
      folders,
      splitterModel,
      outlinedPause,
      outlinedPlayArrow,
      alertsRows,
      toggleAlertState,
      alertStateLoadingMap,
      templates,
      routeTo,
      refreshDestination,
      showImportAlertDialog,
      importAlert,
      getTemplates,
      exportAlert,
      updateActiveFolderId,
      activeFolderId,
      editAlert,
      deleteAlertByAlertId,
      showMoveAlertDialog,
      outlinedDriveFileMove,
      selectedAlertToMove,
      moveAlertToAnotherFolder,
      activeFolderToMove,
      updateAcrossFolders,
      selected,
      getSelectedString,
      moveMultipleAlerts,
      dynamicQueryModel,
      searchAcrossFolders,
      searchQuery,
      clearSearchHistory,
      filteredResults,
      alertsList,
      expandedRow,
      triggerExpand,
      allSelected,
      toggleAll,
      handleRowSelection,
      copyToClipboard,
      openMenu,
      outlinedMoreVert,
      getAlertsFn,
      multipleExportAlert,
      computedName,
      computedOwner
    };

  },
});
</script>

<style lang="scss">
.bottom-btn {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;

}

.move-btn {
  width: 10vw;
}

.export-btn {
  width: 10vw;
}

.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}

.alert-list-table {
  th:last-child,
  td:last-child {
    //the fixed width as we have moved some actions to the menu so lot of space is occupied by actions section so remvoed that 
    padding: 10px  !important;
    position: sticky;
    right: 0;
    z-index: 1;
    background: #ffffff;
    box-shadow: -4px 0px 4px 0 rgba(0, 0, 0, 0.1);
  }
}

.dark-theme {
  th:last-child,
  td:last-child {
    background: var(--q-dark);
    box-shadow: -4px 0px 4px 0 rgba(144, 144, 144, 0.1);
  }
}

.light-theme {
  th:last-child,
  td:last-child {
    background: #ffffff;
  }
}

.alerts-tabs {
  .q-tabs {
    &--vertical {
      margin: 1.5rem 1rem 0 0;

      .q-tab {
        justify-content: flex-start;
        padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;

        &__content.tab_content {
          .q-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }

        &--active {
          background-color: $accent;
        }
      }
    }
  }
}
.clone-alert-popup {
  width: 400px;
}
.expand-content {
  padding: 0  3rem;
  max-height: 100vh; /* Set a fixed height for the container */
  overflow: hidden; /* Hide overflow by default */
}

.scroll-content {
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
.expanded-sql{
  border-left: #7A54A2 3px solid;
}
</style>
