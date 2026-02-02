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
  <div data-test="action-scripts-list-page">
    <div v-if="!showAddActionScriptDialog" class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] q-pt-xs">
      <div class="card-container tw:mb-[0.625rem]">
        <div class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:w-full tw:h-[68px]">
          <div class="tw:font-[600] tw:text-[20px]" data-test="alerts-list-title">
                  {{ t("actions.header") }}
                </div>
                <div class="tw:full-width tw:flex tw:items-center tw:justify-end">
                  <q-input
                    v-model="filterQuery"
                    borderless
                    dense
                    class="q-ml-auto no-border o2-search-input"
                    :placeholder="t('actions.search')"
                    data-test="action-list-search-input"
                  >
                    <template #prepend>
                      <q-icon class="o2-search-input-icon" name="search" />
                    </template>
                  </q-input>
                <q-btn
                  data-test="action-list-add-btn"
                  class="q-ml-sm o2-primary-button tw:h-[36px]"
                  flat
                  no-caps
                  :label="t(`actions.add`)"
                  @click="showAddUpdateFn({})"
                />
                </div>
        </div>
      </div>
      <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
        <div class="card-container tw:h-[calc(100vh-124px)]">
          <q-table
            data-test="action-scripts-table"
            ref="qTable"
            :rows="visibleRows"
            :columns="columns"
            row-key="id"
            :pagination="pagination"
            style="width: 100%;"
            :style="{ height: hasVisibleRows ? 'calc(100vh - 124px)' : '' }"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky o2-last-row-border"
            selection="multiple"
            v-model:selected="selectedActionScripts"
            >
            <template #no-data>
              <NoData />
            </template>
            <template v-slot:body-selection="scope">
              <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
            </template>
            <template v-slot:body-cell-actions="props">
              <q-td :props="props">
                <div
                  data-test="action-scripts-loading"
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
                  :data-test="`alert-list-${props.row.name}-update-alert`"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  icon="edit"
                  :title="t('alerts.edit')"
                  @click="showAddUpdateFn(props)"
                >
              </q-btn>
                <q-btn
                  :data-test="`alert-list-${props.row.name}-delete-alert`"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  :icon="outlinedDelete"
                  flat
                  :title="t('alerts.delete')"
                  @click="showDeleteDialogFn(props)"
                >
              </q-btn>
              </q-td>
            </template>

            <template v-slot:body-cell-function="props">
              <q-td :props="props">
                <q-tooltip>
                  <pre>{{ props.row.sql }}</pre>
                </q-tooltip>
                <pre style="white-space: break-spaces">{{ props.row.sql }}</pre>
              </q-td>
            </template>

            <template #bottom="scope">
              <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[80px] tw:mr-md">
                    {{ resultTotal }} {{ t('actions.header') }}
                  </div>
                  <q-btn
                    v-if="selectedActionScripts.length > 0"
                    data-test="action-scripts-bulk-delete-btn"
                    class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                    :class="
                      store.state.theme === 'dark'
                        ? 'o2-secondary-button-dark'
                        : 'o2-secondary-button-light'
                    "
                    no-caps
                    dense
                    @click="openBulkDeleteDialog"
                  >
                    <q-icon name="delete" size="16px" />
                    <span class="tw:ml-2">Delete</span>
                  </q-btn>
                </div>
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
                  <q-th v-if="columns.length > 0" auto-width>
                    <q-checkbox
                      v-model="props.selected"
                      size="sm"
                      :class="store.state.theme === 'dark' ? 'o2-table-checkbox-dark' : 'o2-table-checkbox-light'"
                      class="o2-table-checkbox"
                    />
                  </q-th>

                  <!-- Rendering the rest of the columns -->
                  <!-- here we can add the classes class so that the head will be sticky -->
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
    <template v-else>
      <div class="tw:w-full">
        <EditScript
          :isUpdated="isUpdated"
          @update:list="refreshList"
          @cancel:hideform="hideForm"
          @get-action-scripts="getActionScripts"
        />
      </div>
    </template>
    <ConfirmDialog
      title="Delete Action"
      message="Are you sure you want to delete Action?"
      @update:ok="deleteAlert"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
    <ConfirmDialog
      title="Bulk Delete Action Scripts"
      :message="`Are you sure you want to delete ${selectedActionScripts.length} action script(s)?`"
      @update:ok="bulkDeleteActionScripts"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
    <template>
      <q-dialog class="q-pa-md" v-model="showForm" persistent>
        <q-card class="clone-alert-popup">
          <div class="row items-center no-wrap q-mx-md q-my-sm">
            <div class="flex items-center">
              <div
                data-test="add-action-back-btn"
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
              <q-input
                data-test="to-be-clone-action-name"
                v-model="toBeCloneAlertName"
                label="Alert Name"
              />
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
                  data-test="clone-action-cancel-btn"
                  v-close-popup="true"
                  class="q-mb-md text-bold"
                  :label="t('alerts.cancel')"
                  text-color="light-text"
                  padding="sm md"
                  no-caps
                />
                <q-btn
                  data-test="clone-action-submit-btn"
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
  computed,
} from "vue";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";

import { QTable, date, useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import {
  getImageURL,
  getUUID,
  verifyOrganizationStatus,
  convertUnixToQuasarFormat,
} from "@/utils/zincutils";
import type { Alert, AlertListItem } from "@/ts/interfaces/index";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
} from "@quasar/extras/material-icons-outlined";
import actions from "@/services/action_scripts";
import useActions from "@/composables/useActions";
import { useReo } from "@/services/reodotdev_analytics";

interface ActionScriptList {
  "#": string | number; // If this represents a serial number or row index
  id: any; // The unique identifier, specify the type (e.g., string, number) if known
  name: any; // Name of the action script
  uuid: any; // Unique UUID for the action script
  created_by: any; // The user who created the script
  created_at: string; // Creation timestamp, in ISO format or a specific format
  last_run_at: string; // Timestamp of the last run, in ISO format or a specific format
  last_successful_at: string; // Timestamp of the last successful run
  status: any; // Current status of the action script
}

// import alertList from "./alerts";

// TODO code clean up needs to be done
export default defineComponent({
  name: "AlertList",
  components: {
    QTablePagination,
    EditScript: defineAsyncComponent(
      () => import("@/components/actionScripts/EditScript.vue"),
    ),
    NoData,
    ConfirmDialog,
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
    const actionsScriptRows: Ref<ActionScriptList[]> = ref([]);
    const formData: Ref<Alert | {}> = ref({});
    const toBeClonedAlert: Ref<Alert | {}> = ref({});
    const showAddActionScriptDialog: any = ref(false);
    const qTable: Ref<InstanceType<typeof QTable> | null> = ref(null);
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmBulkDelete = ref<boolean>(false);
    const selectedActionScripts = ref<any[]>([]);
    const splitterModel = ref(220);
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const streams: any = ref({});
    const isFetchingStreams = ref(false);
    const isSubmitting = ref(false);
    const resultTotal = ref<number>(0);
    const filterQuery = ref("");
    const { getAllActions } = useActions();
    const { track } = useReo();

    const { getStreams } = useStreams();

    const toBeCloneAlertName = ref("");
    const toBeCloneUUID = ref("");
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
    const columns: any = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "center",
        style: "width: 67px;",
      },
      {
        name: "name",
        field: "name",
        label: t("alerts.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "created_by",
        field: "created_by",
        label: t("alerts.createdBy"),
        align: "center",
        sortable: true,
      },
      {
        name: "created_at",
        field: "created_at",
        label: t("alerts.createdAt"),
        align: "left",
        sortable: true,
      },
      {
        name: "execution_details_type",
        field: "execution_details_type",
        label: t("actions.type"),
        align: "left",
        sortable: true,
      },
      {
        name: "last_run_at",
        field: "last_run_at",
        label: t("alerts.lastRunAt"),
        align: "left",
        sortable: true,
      },
      {
        name: "last_successful_at",
        field: "last_successful_at",
        label: t("alerts.lastSuccessfulAt"),
        align: "left",
        sortable: true,
      },
      {
        name: "status",
        field: "status",
        label: t("alerts.status"),
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("alerts.actions"),
        align: "center",
        sortable: false,
        classes: "actions-column",
        style: "width: 100px"
      },
    ]);
    const activeTab: any = ref("alerts");
    const destinations = ref([0]);
    const templates = ref([0]);

    const getActionScripts = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading actions...",
      });

      getAllActions()
        .then(() => {
          var counter = 1;
          resultTotal.value = store.state.organizationData.actions.length;
          alerts.value = store.state.organizationData.actions.map(
            (alert: any) => {
              return {
                ...alert,
                uuid: getUUID(),
              };
            },
          );
          actionsScriptRows.value = alerts.value.map((data: any) => {
            if (data.execution_details_type === "repeat")
              data.execution_details_type = "Cron Job";
            if (data.execution_details_type === "service")
              data.execution_details_type = "Real Time";
            if (data.execution_details_type === "once")
              data.execution_details_type = "Once";
            return {
              "#": counter <= 9 ? `0${counter++}` : counter++,
              id: data.id,
              name: data.name,
              uuid: data.uuid,
              created_by: data.created_by,
              created_at: data.created_at
                ? convertUnixToQuasarFormat(data.created_at)
                : "-",
              last_run_at: data.last_run_at
                ? convertUnixToQuasarFormat(data.last_run_at)
                : "-",
              last_successful_at: data.last_successful_at
                ? convertUnixToQuasarFormat(data.last_successful_at)
                : "-",
              status: data.status,
              execution_details_type: data.execution_details_type,
            };
          });
          actionsScriptRows.value.forEach((alert: ActionScriptList) => {
            alertStateLoadingMap.value[alert.uuid as string] = false;
          });
          if (router.currentRoute.value.query.action == "add") {
            showAddUpdateFn({ row: undefined });
          }
          if (router.currentRoute.value.query.action == "update") {
            const alertName = router.currentRoute.value.query.id as string;
            showAddUpdateFn({
              row: getAlertByName(alertName),
            });
          }
          dismiss();
        })
        .catch((e) => {
          console.error(e);
          dismiss();
          $q.notify({
            type: "negative",
            message: "Error while pulling Actions.",
            timeout: 2000,
          });
        });
    };

    const getAlertByName = (id: string) => {
      return alerts.value.find((alert) => alert.id === id);
    };

    if (!alerts.value.length) {
      getActionScripts();
    }

    watch(
      () => router.currentRoute.value.query.action,
      (action) => {
        if (!action) showAddActionScriptDialog.value = false;
      },
    );

    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "All", value: 0 },
    ];
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

    const addAlert = () => {
      track("Button Click", {
        button: "Add Action Scripts",
        page: "Action Scripts"
      });
      showAddActionScriptDialog.value = true;
    };

    const showAddUpdateFn = (props: any) => {
      formData.value = alerts.value.find(
        (alert: any) => alert.uuid === props.row?.uuid,
      ) as Alert;
      //use this comment for testing multi_time_range shifts
      // if( formData.value){
      //   formData.value.query_condition.multi_time_range = [{offSet:"30m"}];
      // }
      let action;
      if (!props.row) {
        isUpdated.value = false;
        action = "Add Alert";
        router.push({
          name: "actionScripts",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      } else {
        isUpdated.value = true;
        action = "Update Alert";
        router.push({
          name: "actionScripts",
          query: {
            action: "update",
            id: props.row.id,
            org_identifier: store.state.selectedOrganization.identifier,
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
      getActionScripts();
      hideForm();
    };
    const hideForm = () => {
      showAddActionScriptDialog.value = false;
      router.push({
        name: "actionScripts",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const deleteAlert = () => {
      actions
        .delete(
          store.state.selectedOrganization.identifier,
          selectedDelete.value.id,
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              type: "positive",
              message: res.data.message,
              timeout: 2000,
            });
            getActionScripts();
          } else {
            $q.notify({
              type: "negative",
              message: res.data.message,
              timeout: 2000,
            });
          }
        })
        .catch((err) => {
          if (err.response?.status == 403) {
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

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteActionScripts = async () => {
      try {
        if (selectedActionScripts.value.length === 0) {
          $q.notify({
            type: "warning",
            message: "No action scripts selected",
            timeout: 2000,
          });
          confirmBulkDelete.value = false;
          return;
        }

        const response = await actions.bulkDelete(
          store.state.selectedOrganization.identifier,
          {
            ids: selectedActionScripts.value.map((script: any) => script.id),
          }
        );

        const { successful = [], unsuccessful = [], err } = response.data || {};

        if (err) {
          throw new Error(err);
        }

        if (successful.length > 0 && unsuccessful.length === 0) {
          $q.notify({
            type: "positive",
            message: `Successfully deleted ${successful.length} action script(s)`,
            timeout: 2000,
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          $q.notify({
            type: "warning",
            message: `Deleted ${successful.length} action script(s). Failed to delete ${unsuccessful.length} action script(s)`,
            timeout: 3000,
          });
        } else if (unsuccessful.length > 0) {
          $q.notify({
            type: "negative",
            message: `Failed to delete ${unsuccessful.length} action script(s)`,
            timeout: 2000,
          });
        }

        await getActionScripts();
        selectedActionScripts.value = [];
        confirmBulkDelete.value = false;
      } catch (error: any) {
        if (error.response?.status != 403 || error?.status != 403) {
          $q.notify({
            type: "negative",
            message: error.response?.data?.message || error?.message || "Error while deleting action scripts",
            timeout: 2000,
          });
        }
        confirmBulkDelete.value = false;
      }
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
          (column: any) => column.toLowerCase().indexOf(value) > -1,
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
          },
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

    // const toggleAlertState = (row: any) => {
    //   alertStateLoadingMap.value[row.uuid] = true;
    //   const alert: Alert = alerts.value.find(
    //     (alert) => alert.uuid === row.uuid,
    //   ) as Alert;
    //   alertsService
    //     .toggleState(
    //       store.state.selectedOrganization.identifier,
    //       alert.stream_name,
    //       alert.name,
    //       !alert?.enabled,
    //       alert.stream_type,
    //     )
    //     .then(() => {
    //       alert.enabled = !alert.enabled;
    //       actionsScriptRows.value.forEach((alert) => {
    //         alert.uuid === row.uuid ? (alert.enabled = !alert.enabled) : null;
    //       });
    //     })
    //     .finally(() => {
    //       alertStateLoadingMap.value[row.uuid] = false;
    //     });
    // };

    const routeTo = (name: string) => {
      router.push({
        name: name,
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    // const refreshDestination = async () => {
    //   await getDestinations();
    // };

    const filterData = (rows: any, terms: any) => {
        var filtered = [];
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (
            rows[i]["name"].toLowerCase().includes(terms) ||
            (rows[i]["owner"] != null &&
              rows[i]["owner"].toLowerCase().includes(terms)) ||
            (rows[i]["description"] != null &&
              rows[i]["description"].toString().toLowerCase().includes(terms))
          ) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      };

      const visibleRows = computed(() => {
      if (!filterQuery.value) return actionsScriptRows.value || []
      return filterData(actionsScriptRows.value || [], filterQuery.value)
    });

    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    // Watch visibleRows to sync resultTotal with search filter
    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });

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
      getActionScripts,
      pagination,
      resultTotal,
      refreshList,
      perPageOptions,
      selectedPerPage,
      addAlert,
      deleteAlert,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      changePagination,
      maxRecordToReturn,
      showAddActionScriptDialog,
      toBeCloneAlertName,
      toBeCloneUUID,
      toBeClonestreamType,
      toBeClonestreamName,
      streamTypes,
      streamNames,
      schemaList,
      indexOptions,
      streams,
      isFetchingStreams,
      isSubmitting,
      outlinedDelete,
      filterQuery,
      filterData,
      getImageURL,
      activeTab,
      destinations,
      verifyOrganizationStatus,
      folders,
      splitterModel,
      outlinedPause,
      outlinedPlayArrow,
      actionsScriptRows,
      alertStateLoadingMap,
      templates,
      visibleRows,
      hasVisibleRows,
      confirmBulkDelete,
      selectedActionScripts,
      openBulkDeleteDialog,
      bulkDeleteActionScripts,
      getAlertByName,
    };
  },
});
</script>

<style lang="scss">
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
</style>
