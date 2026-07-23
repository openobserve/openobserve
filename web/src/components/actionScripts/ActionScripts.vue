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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div data-test="action-scripts-list-page" class="h-full">
    <div v-if="!showAddActionScriptDialog" class="h-full">
      <OPageLayout
        bleed
        :title="t('actions.header')"
        icon="code"
        :subtitle="'Custom automation and scripting'"
      >
        <!-- Row 1: standard header — title + actions only. Search moved into the
             table's own toolbar below. -->
        <template #actions>
          <OButton
            data-test="action-list-add-btn"
            variant="primary"
            size="sm"
            @click="showAddUpdateFn({})"
            >{{ t("actions.add") }}</OButton
          >
        </template>
        <OTable
          data-test="action-scripts-table"
          :data="visibleRows"
          :columns="columns"
          row-key="id"
          :frame="false"
          :loading="loading"
          :selected-ids="selectedActionScriptIds"
          selection="multiple"
          pagination="client"
          :page-size="20"
          :page-size-options="[5, 10, 20, 50, 100]"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          show-index
          :show-global-filter="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="actions-action-scripts-list"
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <template #toolbar>
            <OSearchInput
              v-model="filterQuery"
              class="w-64 no-border o2-search-input"
              :placeholder="t('actions.search')"
              data-test="action-list-search-input"
            />
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="action-scripts-list-refresh-btn"
              @click="getActionScripts"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="actionsRefresh" />
            </OButton>
          </template>
          <template #empty>
            <NoData />
          </template>
          <template #cell-created_by="{ row }">
            <OUserCell :value="row.created_by" />
          </template>
          <template #cell-created_at="{ row }">
            <OTimeCell :value="row.created_at_raw" unit="us" :timezone="store.state.timezone" />
          </template>
          <template #cell-execution_details_type="{ row }">
            <OTag :value="row.execution_details_type" />
          </template>
          <template #cell-last_run_at="{ row }">
            <OTimeCell
              :value="row.last_run_at_raw"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
              empty-label="Never"
            />
          </template>
          <template #cell-last_successful_at="{ row }">
            <OTimeCell
              :value="row.last_successful_at_raw"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
              empty-label="Never"
            />
          </template>
          <template #cell-status="{ row }">
            <OTag :value="row.status" />
          </template>
          <template #cell-actions="{ row }">
            <div
              data-test="action-scripts-loading"
              v-if="alertStateLoadingMap[row.uuid]"
              style="display: inline-block; width: 33.14px"
              class="flex justify-center items-center ml-1 h-auto"
              :title="`Turning ${row.enabled ? 'Off' : 'On'}`"
            >
              <OSpinner size="xs" />
            </div>
            <OButton
              :data-test="`alert-list-${row.name}-update-alert`"
              data-row-action="edit"
              variant="ghost"
              size="icon-sm"
              :title="t('alerts.edit')"
              @click="showAddUpdateFn({ row })"
              ><OIcon name="edit" size="sm"
            /></OButton>
            <OButton
              :data-test="`alert-list-${row.name}-delete-alert`"
              data-row-action="delete"
              variant="ghost"
              size="icon-sm"
              :title="t('alerts.delete')"
              @click="showDeleteDialogFn({ row })"
              ><OIcon name="delete" size="sm"
            /></OButton>
          </template>

          <template #bottom>
            <div class="flex items-center justify-between w-full h-12">
              <div class="flex items-center gap-2">
                <div class="text-xs font-normal flex items-center w-20 mr-md">
                  {{ resultTotal }} {{ t("actions.header") }}
                </div>
                <OButton
                  v-if="selectedActionScripts.length > 0"
                  data-test="action-scripts-bulk-delete-btn"
                  variant="secondary"
                  size="sm"
                  :loading="bulkDeleteLoading"
                  @click="openBulkDeleteDialog"
                  ><OIcon name="delete" size="sm" /><span class="ml-1.5">Delete</span></OButton
                >
              </div>
            </div>
          </template>
        </OTable>
      </OPageLayout>
    </div>
    <template v-else>
      <div class="w-full">
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
    <ODialog
      data-test="action-scripts-form-dialog"
      v-model:open="showForm"
      persistent
      size="md"
      :show-close="false"
      :title="t('alerts.cloneTitle')"
      :secondary-button-label="t('alerts.cancel')"
      :primary-button-label="t('alerts.save')"
      :primary-button-disabled="isSubmitting"
      form-id="action-script-clone-form"
      @click:secondary="showForm = false"
    >
      <template #header-left>
        <div
          data-test="add-action-back-btn"
          class="flex justify-center items-center cursor-pointer"
          style="border: 1.5px solid; border-radius: 50%; width: 22px; height: 22px"
          title="Go Back"
          @click="showForm = false"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
      </template>
      <OForm id="action-script-clone-form" :default-values="{}" @submit="submitForm">
        <OInput
          data-test="to-be-clone-action-name"
          v-model="toBeCloneAlertName"
          label="Alert Name"
        />
        <OSelect
          data-test="to-be-clone-stream-type"
          v-model="toBeClonestreamType"
          label="Stream Type"
          :options="streamTypes"
          @update:model-value="updateStreams()"
        />
        <OSelect
          data-test="to-be-clone-stream-name"
          v-model="toBeClonestreamName"
          :loading="isFetchingStreams"
          :disabled="!toBeClonestreamType"
          label="Stream Name"
          :options="streamNames"
          @update:model-value="updateStreamName"
        />
      </OForm>
    </ODialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, defineAsyncComponent, computed } from "vue";
import type { Ref } from "vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";

import { useI18n } from "vue-i18n";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import {
  getImageURL,
  getUUID,
  verifyOrganizationStatus,
  convertUnixToDateFormat,
} from "@/utils/zincutils";
import type { Alert } from "@/ts/interfaces/index";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import actions from "@/services/action_scripts";
import useActions from "@/composables/useActions";
import { useReo } from "@/services/reodotdev_analytics";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { COL } from "@/lib/core/Table/OTable.types";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

interface ActionScriptList {
  id: any;
  name: any;
  uuid: any;
  created_by: any;
  created_at: string;
  last_run_at: string;
  last_successful_at: string;
  status: any;
}

export default defineComponent({
  name: "AlertList",
  components: {
    OPageLayout,
    OIcon,
    EditScript: defineAsyncComponent(() => import("@/components/actionScripts/EditScript.vue")),
    NoData,
    ConfirmDialog,
    OButton,
    ODialog,
    OSpinner,
    OInput,
    OSearchInput,
    OTooltip,
    OSelect,
    OForm,
    OTable,
    OTimeCell,
    OUserCell,
    OTag,
  },
  emits: ["updated:fields", "update:changeRecordPerPage", "update:maxRecordToReturn"],
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const alerts: Ref<Alert[]> = ref([]);
    const actionsScriptRows: Ref<ActionScriptList[]> = ref([]);
    const formData: Ref<Alert | {}> = ref({});
    const showAddActionScriptDialog: any = ref(false);
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmBulkDelete = ref<boolean>(false);
    const bulkDeleteLoading = ref(false);
    const selectedActionScripts = ref<any[]>([]);
    const splitterModel = ref(220);
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const streams: any = ref({});
    const isFetchingStreams = ref(false);
    const loading = ref(false);
    const isSubmitting = ref(false);
    const resultTotal = ref<number>(0);
    const filterQuery = ref("");
    const { getAllActions } = useActions();
    const { track } = useReo();

    const { getStreams } = useStreams();

    // Clone-dialog bindings referenced by the template; nothing opens the dialog yet.
    const showForm = ref(false);
    const submitForm = () => {};
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

    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("alerts.name"),
        accessorKey: "name",
        sortable: true,
        hideable: true,
        size: COL.name,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "created_by",
        header: t("alerts.createdBy"),
        accessorKey: "created_by",
        sortable: true,
        hideable: true,
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "created_at",
        header: t("alerts.createdAt"),
        accessorKey: "created_at",
        sortable: true,
        hideable: true,
        size: COL.createdAt,
        meta: { align: "left" },
      },
      {
        id: "execution_details_type",
        header: t("actions.type"),
        accessorKey: "execution_details_type",
        sortable: true,
        hideable: true,
        size: COL.type,
        meta: { align: "left" },
      },
      {
        id: "last_run_at",
        header: t("alerts.lastRunAt"),
        accessorKey: "last_run_at",
        sortable: true,
        hideable: true,
        size: COL.dateAbsolute,
        meta: { align: "left" },
      },
      {
        id: "last_successful_at",
        header: t("alerts.lastSuccessfulAt"),
        accessorKey: "last_successful_at",
        sortable: true,
        hideable: true,
        size: COL.dateAbsolute,
        meta: { align: "left" },
      },
      {
        id: "status",
        header: t("alerts.status"),
        accessorKey: "status",
        sortable: true,
        hideable: true,
        size: COL.status,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("alerts.actions"),
        isAction: true,
        pinned: "right",
        size: 100,
        meta: { align: "center", actionCount: 2 },
      },
    ];

    const selectedActionScriptIds = computed(() =>
      selectedActionScripts.value.map((s: any) => s.id),
    );

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const map = new Map(actionsScriptRows.value.map((r: any) => [r.id, r]));
      selectedActionScripts.value = ids.map((id: any) => map.get(id)).filter(Boolean);
    };

    const activeTab: any = ref("alerts");
    const destinations = ref([0]);
    const templates = ref([0]);

    const getActionScripts = () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading actions...",
        timeout: 0,
      });

      loading.value = true;
      getAllActions()
        .then(() => {
          resultTotal.value = store.state.organizationData.actions.length;
          alerts.value = store.state.organizationData.actions.map((alert: any) => {
            return {
              ...alert,
              uuid: getUUID(),
            };
          });
          actionsScriptRows.value = alerts.value.map((data: any) => {
            if (data.execution_details_type === "repeat") data.execution_details_type = "Cron Job";
            if (data.execution_details_type === "service")
              data.execution_details_type = "Real Time";
            if (data.execution_details_type === "once") data.execution_details_type = "Once";
            return {
              id: data.id,
              name: data.name,
              uuid: data.uuid,
              created_by: data.created_by,
              created_at_raw: data.created_at || null,
              created_at: data.created_at ? convertUnixToDateFormat(data.created_at) : "-",
              last_run_at_raw: data.last_run_at || null,
              last_run_at: data.last_run_at ? convertUnixToDateFormat(data.last_run_at) : "-",
              last_successful_at_raw: data.last_successful_at || null,
              last_successful_at: data.last_successful_at
                ? convertUnixToDateFormat(data.last_successful_at)
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
          toast({
            variant: "error",
            message: "Error while pulling Actions.",
          });
        })
        .finally(() => {
          loading.value = false;
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

    const maxRecordToReturn = ref<number>(100);

    const addAlert = () => {
      track("Button Click", {
        button: "Add Action Scripts",
        page: "Action Scripts",
      });
      showAddActionScriptDialog.value = true;
    };

    const showAddUpdateFn = (props: any) => {
      formData.value = alerts.value.find((alert: any) => alert.uuid === props.row?.uuid) as Alert;
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
        .delete(store.state.selectedOrganization.identifier, selectedDelete.value.id)
        .then((res: any) => {
          if (res.data.code == 200) {
            toast({
              variant: "success",
              message: res.data.message,
            });
            getActionScripts();
          } else {
            toast({
              variant: "error",
              message: res.data.message,
            });
          }
        })
        .catch((err) => {
          if (err.response?.status == 403) {
            return;
          }
          toast({
            variant: "error",
            message: err?.data?.message || "Error while deleting alert.",
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
      bulkDeleteLoading.value = true;
      try {
        if (selectedActionScripts.value.length === 0) {
          toast({
            variant: "warning",
            message: "No action scripts selected",
          });
          confirmBulkDelete.value = false;
          return;
        }

        const response = await actions.bulkDelete(store.state.selectedOrganization.identifier, {
          ids: selectedActionScripts.value.map((script: any) => script.id),
        });

        const { successful = [], unsuccessful = [], err } = response.data || {};

        if (err) {
          throw new Error(err);
        }

        if (successful.length > 0 && unsuccessful.length === 0) {
          toast({
            variant: "success",
            message: `Successfully deleted ${successful.length} action script(s)`,
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          toast({
            variant: "warning",
            message: `Deleted ${successful.length} action script(s). Failed to delete ${unsuccessful.length} action script(s)`,
          });
        } else if (unsuccessful.length > 0) {
          toast({
            variant: "error",
            message: `Failed to delete ${unsuccessful.length} action script(s)`,
          });
        }

        await getActionScripts();
        selectedActionScripts.value = [];
        confirmBulkDelete.value = false;
      } catch (error: any) {
        if (error.response?.status != 403 || error?.status != 403) {
          toast({
            variant: "error",
            message:
              error.response?.data?.message ||
              error?.message ||
              "Error while deleting action scripts",
          });
        }
        confirmBulkDelete.value = false;
      } finally {
        bulkDeleteLoading.value = false;
      }
    };

    const updateStreamName = (selectedOption: any) => {
      toBeClonestreamName.value = selectedOption;
    };
    const updateStreams = (resetStream = true) => {
      if (resetStream) toBeClonestreamName.value = "";
      if (streams.value[toBeClonestreamType.value]) {
        schemaList.value = streams.value[toBeClonestreamType.value];
        indexOptions.value = streams.value[toBeClonestreamType.value].map((data: any) => {
          return data.name;
        });
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
    const filterData = (rows: any, terms: any) => {
      var filtered = [];
      terms = terms.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        if (
          rows[i]["name"].toLowerCase().includes(terms) ||
          (rows[i]["owner"] != null && rows[i]["owner"].toLowerCase().includes(terms)) ||
          (rows[i]["description"] != null &&
            rows[i]["description"].toString().toLowerCase().includes(terms))
        ) {
          filtered.push(rows[i]);
        }
      }
      return filtered;
    };

    const visibleRows = computed(() => {
      if (!filterQuery.value) return actionsScriptRows.value || [];
      return filterData(actionsScriptRows.value || [], filterQuery.value);
    });

    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    // Watch visibleRows to sync resultTotal with search filter
    watch(
      visibleRows,
      (newVisibleRows) => {
        resultTotal.value = newVisibleRows.length;
      },
      { immediate: true },
    );

    useShortcuts([
      {
        id: "actionsRefresh",
        handler: () => {
          if (!isInputFocused()) getActionScripts();
        },
      },
    ]);

    return {
      t,
      store,
      router,
      alerts,
      columns,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      getActionScripts,
      resultTotal,
      refreshList,
      addAlert,
      deleteAlert,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      maxRecordToReturn,
      showAddActionScriptDialog,
      showForm,
      submitForm,
      updateStreams,
      updateStreamName,
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
      loading,
      isSubmitting,
      filterQuery,
      filterData,
      getImageURL,
      activeTab,
      destinations,
      verifyOrganizationStatus,
      folders,
      splitterModel,
      actionsScriptRows,
      alertStateLoadingMap,
      templates,
      visibleRows,
      hasVisibleRows,
      confirmBulkDelete,
      selectedActionScripts,
      selectedActionScriptIds,
      handleSelectedIdsUpdate,
      openBulkDeleteDialog,
      bulkDeleteActionScripts,
      bulkDeleteLoading,
      getAlertByName,
    };
  },
});
</script>
