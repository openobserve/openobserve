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
  <div class="tw:rounded-md tw:flex tw:flex-col tw:h-full tw:p-0">

    <div v-if="!showDestinationEditor && !showImportDestination" class="tw:flex tw:flex-col tw:h-full">
      <div class="tw:flex-shrink-0">
        <div
          class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
          style="position: sticky; top: 0; z-index: 1000;"
        >
          <div class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]" data-test="alert-destinations-list-title">
            {{ t("alert_destinations.header") }}
          </div>
          <div class="tw:flex tw:justify-end tw:gap-2">
            <OInput
              v-model="filterQuery"
              data-test="destination-list-search-input"
              class="tw:h-[36px] tw:w-[200px] no-border o2-search-input"
              :placeholder="t('alert_destinations.search')"
            >
              <template #icon-left>
                <OIcon class="o2-search-input-icon" name="search" size="sm" />
              </template>
            </OInput>
            <OButton
              variant="outline"
              size="sm"
              @click="importDestination"
              data-test="destination-import"
            >{{ t(`dashboard.import`) }}</OButton>
            <OButton
              data-test="alert-destination-list-add-alert-btn"
              variant="primary"
              size="sm"
              :disabled="!templates.length"
              @click="editDestination(null)"
            >{{ t(`alert_destinations.add`) }}</OButton>
          </div>
        </div>
      </div>
      <div class="tw:flex-1 tw:min-h-0">
        <OTable
          data-test="alert-destinations-list-table"
          :data="visibleRows"
          :columns="columns"
          row-key="name"
          :loading="loading"
          :selected-ids="selectedDestinationIds"
          selection="multiple"
          pagination="client"
          :page-size="20"
          :page-size-options="[5, 10, 20, 50, 100]"
          :footer-title="t('alert_destinations.header')"
          sorting="client"
          :default-columns="false"
          :show-global-filter="false"
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <template #bottom="{ totalRows }">
            <span class="o2-table-footer-title tw:text-primary">
              {{ totalRows.toLocaleString() }} {{ t('alert_destinations.header') }}
            </span>
            <OButton
              v-if="selectedDestinations.length > 0"
              data-test="destination-list-delete-destinations-btn"
              variant="outline-destructive"
              size="sm"
              @click="openBulkDeleteDialog"
            >
              <template #icon-left>
                <OIcon name="delete" size="sm" />
              </template>
              {{ t('common.delete') }}
            </OButton>
          </template>

          <template #empty>
            <div
              v-if="!templates.length"
              class="tw:w-full tw:flex tw:flex-col tw:justify-center tw:items-center tw:text-center"
            >
              <div style="width: 600px" class="tw:mt-6">
                <div class="tw:text-base tw:font-medium">
                  It looks like you haven't created any Templates yet. To create
                  an Alert, you'll need to have at least one Destination and one
                  Template in place
                </div>
                <OButton
                  variant="primary"
                  size="sm"
                  class="tw:mt-3"
                  @click="routeTo('alertTemplates')"
                >Create Template</OButton>
              </div>
            </div>
            <template v-else>
              <NoData />
            </template>
          </template>

          <template #cell-type="{ row }">
            <div class="tw:flex tw:items-center tw:gap-2">
              <template v-if="getPrebuiltTypeName(row)">
                <OBadge
                  :data-test="`destination-type-badge-${getPrebuiltTypeName(row)?.toLowerCase()}`"
                  variant="primary"
                  class="tw:text-xs"
                >{{ getPrebuiltTypeName(row) }}</OBadge>
                <OIcon
                  name="auto-awesome"
                  size="sm"
                  :title="'Prebuilt ' + getPrebuiltTypeName(row) + ' destination'"
                />
              </template>
              <template v-else>
                <OBadge
                  data-test="destination-type-badge-custom"
                  variant="default"
                  class="tw:text-xs"
                >{{ getCustomDestinationLabel(row) }}</OBadge>
                <OIcon
                  name="settings"
                  size="sm"
                  :title="getCustomDestinationLabel(row)"
                />
              </template>
            </div>
          </template>

          <template #cell-actions="{ row }">
            <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
              <OButton
                data-test="destination-export"
                variant="ghost"
                size="icon-sm"
                title="Export Destination"
                @click.stop="exportDestination(row)"
              >
                <OIcon name="download" size="sm" />
              </OButton>
              <OButton
                :data-test="`alert-destination-list-${row.name}-update-destination`"
                variant="ghost"
                size="icon-sm"
                :title="t('alert_destinations.edit')"
                @click="editDestination(row)"
              >
                <OIcon name="edit" size="sm" />
              </OButton>
              <OButton
                :data-test="`alert-destination-list-${row.name}-delete-destination`"
                variant="ghost"
                size="icon-sm"
                :title="t('alert_destinations.delete')"
                @click="conformDeleteDestination(row)"
              >
                <OIcon name="delete" size="sm" />
              </OButton>
            </div>
          </template>
        </OTable>
      </div>
    </div>
    <div v-else-if="showDestinationEditor && !showImportDestination">
      <AddDestination
        :is-alerts="true"
        :destination="editingDestination"
        :templates="templates"
        @cancel:hideform="toggleDestinationEditor"
        @get:destinations="getDestinations"
      />
    </div>
    <div v-else>
      <ImportDestination
        :destinations="destinations"
        :templates="templates"
        @update:destinations="getDestinations"
      />
    </div>

    <ConfirmDialog
      title="Delete Destination"
      message="Are you sure you want to delete destination?"
      @update:ok="deleteDestination"
      @update:cancel="cancelDeleteDestination"
      v-model="confirmDelete.visible"
    />

    <ConfirmDialog
      title="Delete Destinations"
      :message="`Are you sure you want to delete ${selectedDestinations.length} destination(s)?`"
      @update:ok="bulkDeleteDestinations"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
  </div>
</template>
<script lang="ts">

import {
  ref,
  onBeforeMount,
  onActivated,
  watch,
  defineComponent,
  onMounted,
  computed,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import NoData from "../shared/grid/NoData.vue";
import { getImageURL } from "@/utils/zincutils";
import AddDestination from "./AddDestination.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useRouter } from "vue-router";
import type { DestinationPayload } from "@/ts/interfaces";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import type { Template } from "@/ts/interfaces/index";

import ImportDestination from "./ImportDestination.vue";
import useActions from "@/composables/useActions";
import { useReo } from "@/services/reodotdev_analytics";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue';
import OBadge from '@/lib/core/Badge/OBadge.vue';
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

interface ConformDelete {
  visible: boolean;
  data: any;
}
export default defineComponent({
  name: "PageAlerts",
  components: {
    OIcon,
    AddDestination,
    NoData,
    ConfirmDialog,
    ImportDestination,
    OButton,
    OInput,
    OCheckbox,
    OBadge,
    OTable,
  },
  setup() {
    const store = useStore();
    const editingDestination: Ref<DestinationPayload | null> = ref(null);
    const { t } = useI18n();
    const { getAllActions } = useActions();
    const { track } = useReo();

    const { detectPrebuiltType, availableTypes } = usePrebuiltDestinations();

    const columns: OTableColumnDef[] = [
      {
        id: "#",
        header: "#",
        accessorKey: "#",
        size: 67,
        meta: { align: "left" },
      },
      {
        id: "name",
        header: t("alert_destinations.name"),
        accessorKey: "name",
        sortable: true,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "type",
        header: "Type",
        accessorKey: "type",
        sortable: true,
        size: 180,
        meta: { align: "left" },
      },
      {
        id: "url",
        header: t("alert_destinations.url"),
        accessorKey: "url",
        size: 200,
        meta: { align: "left" },
      },
      {
        id: "method",
        header: t("alert_destinations.method"),
        accessorKey: "method",
        sortable: true,
        size: 150,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("alert_destinations.actions"),
        isAction: true,
        pinned: "right",
        size: 120,
        meta: { align: "center", actionCount: 3 },
      },
    ];
    const destinations: Ref<DestinationPayload[]> = ref([]);
    const templates: Ref<Template[]> = ref([
      { name: "test", body: "", type: "http" },
    ]);
    const confirmDelete: Ref<ConformDelete> = ref({
      visible: false,
      data: null,
    });
    const confirmBulkDelete = ref<boolean>(false);
    const selectedDestinations = ref<any[]>([]);
    const showDestinationEditor = ref(false);
    const showImportDestination = ref(false);
    const router = useRouter();
    const filterQuery = ref("");
    const resultTotal = ref(0);

    const selectedDestinationIds = computed(() =>
      selectedDestinations.value.map((d: any) => d.name),
    );

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const map = new Map(destinations.value.map((r: any) => [r.name, r]));
      selectedDestinations.value = ids
        .map((id: any) => map.get(id))
        .filter(Boolean);
    };

    onActivated(() => {
      getTemplates();
      if (!destinations.value.length) getDestinations();
    });
    onBeforeMount(() => {
      getDestinations();
      getTemplates();
      getActions();
    });

    watch(
      () => router.currentRoute.value.query.action,
      (action) => {
        if (!action) {
          showDestinationEditor.value = false;
          showImportDestination.value = false;
        }
      },
    );

    onMounted(() => {
      updateRoute();
    });

    const getActions = async () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading alert destination...",
      });
      if (store.state.organizationData.actions.length == 0) {
        await getAllActions()
          .catch(() => {
            toast({
              variant: "error",
              message: "Error while loading actions.",
            });
          })
          .finally(() => dismiss());
      }
    };

    const loading = ref(false);
    const getDestinations = () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading destinations...",
      });
      loading.value = true;
      destinationService
        .list({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        })
        .then((res) => {
          res.data = res.data.filter(
            (destination: any) =>
              destination.type == "http" ||
              destination.type == "email" ||
              destination.type === "action",
          );
          resultTotal.value = res.data.length;
          destinations.value = res.data.map((data: any, index: number) => ({
            ...data,
            "#": index + 1 <= 9 ? `0${index + 1}` : index + 1,
          }));
          updateRoute();
        })
        .catch((err) => {
          if (err.response.status != 403) {
            toast({
              variant: "error",
              message: "Error while pulling destinations.",
              timeout: 2000,
            });
          }
          dismiss();
        })
        .finally(() => {
          dismiss();
          loading.value = false;
        });
    };
    const getTemplates = () => {
      templateService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
        })
        .then((res) => (templates.value = res.data));
    };
    const updateRoute = () => {
      if (router.currentRoute.value.query.action === "add")
        editDestination(null);
      if (router.currentRoute.value.query.action === "update")
        editDestination(
          getDestinationByName(router.currentRoute.value.query.name as string),
        );
      if (router.currentRoute.value.query.action === "import")
        showImportDestination.value = true;
    };
    const getDestinationByName = (name: string) => {
      return destinations.value.find(
        (destination) => destination.name === name,
      );
    };
    const editDestination = (destination: any) => {
      if (!destination) {
        track("Button Click", {
          button: "Add Destination",
          page: "Alert Destinations"
        });
      }
      toggleDestinationEditor();
      resetEditingDestination();
      if (!destination) {
        router.push({
          name: "alertDestinations",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      } else {
        editingDestination.value = { ...destination };
        router.push({
          name: "alertDestinations",
          query: {
            action: "update",
            name: destination.name,
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    };
    const resetEditingDestination = () => {
      editingDestination.value = null;
    };
    const deleteDestination = () => {
      if (confirmDelete.value?.data?.name) {
        destinationService
          .delete({
            org_identifier: store.state.selectedOrganization.identifier,
            destination_name: confirmDelete.value.data.name,
          })
          .then(() => {
            toast({
              variant: "success",
              message: `Destination ${confirmDelete.value.data.name} deleted successfully`,
              timeout: 2000,
            });
            getDestinations();
          })
          .catch((err) => {
            if (err.response.data.code === 409) {
              const message =
                err.response.data?.message ||
                err.response.data?.error ||
                "Error while deleting destination";
              toast({
                variant: "error",
                message,
                timeout: 2000,
              });
            }
          });
      }
    };
    const conformDeleteDestination = (destination: any) => {
      confirmDelete.value.visible = true;
      confirmDelete.value.data = destination;
    };
    const cancelDeleteDestination = () => {
      confirmDelete.value.visible = false;
      confirmDelete.value.data = null;
    };
    const toggleDestinationEditor = () => {
      showDestinationEditor.value = !showDestinationEditor.value;
      if (!showDestinationEditor.value)
        router.push({
          name: "alertDestinations",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
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

    const routeTo = (name: string) => {
      router.push({
        name: name,
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const exportDestination = (row: any) => {
      const findDestination: any = getDestinationByName(row.name);
      const destinationByName = { ...findDestination };
      if (destinationByName.hasOwnProperty("#")) delete destinationByName["#"];
      const destinationJson = JSON.stringify(destinationByName, null, 2);
      const blob = new Blob([destinationJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${destinationByName.name}.json`;
      link.click();
      URL.revokeObjectURL(url);
    };
    const importDestination = () => {
      showImportDestination.value = true;
      router.push({
        name: "alertDestinations",
        query: {
          action: "import",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const getPrebuiltTypeName = (destination: DestinationPayload): string | null => {
      const prebuiltType = detectPrebuiltType(destination);
      if (!prebuiltType) return null;

      const typeConfig = availableTypes.value.find(t => t.id === prebuiltType);
      return typeConfig ? typeConfig.name : prebuiltType;
    };

    const getCustomDestinationLabel = (destination: DestinationPayload): string => {
      if (destination.type === "http") {
        return t("alert_destinations.customWebhook");
      } else if (destination.type === "email") {
        return t("alert_destinations.customEmail");
      } else if (destination.type === "action") {
        return t("alert_destinations.customAction");
      }
      return t("alert_destinations.custom");
    };

    const visibleRows = computed(() => {
      if (!filterQuery.value) return destinations.value || [];
      return filterData(destinations.value || [], filterQuery.value);
    });

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteDestinations = async () => {
      const dismiss = toast({
        variant: "loading",
        message: "Deleting destinations...",
        timeout: 0,
      });

      try {
        if (selectedDestinations.value.length === 0) {
          toast({
            variant: "error",
            message: "No destinations selected for deletion",
            timeout: 2000,
          });
          dismiss();
          return;
        }

        const payload = {
          ids: selectedDestinations.value.map((d: any) => d.name),
        };

        const response = await destinationService.bulkDelete(
          store.state.selectedOrganization.identifier,
          payload
        );

        dismiss();

        if (response.data) {
          const { successful = [], unsuccessful = [] } = response.data;
          const successCount = successful.length;
          const failCount = unsuccessful.length;

          if (failCount > 0 && successCount > 0) {
            toast({
              variant: "warning",
              message: `${successCount} destination(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            toast({
              variant: "error",
              message: `Failed to delete ${failCount} destination(s)`,
              timeout: 3000,
            });
          } else {
            toast({
              variant: "success",
              message: `${successCount} destination(s) deleted successfully`,
              timeout: 2000,
            });
          }
        } else {
          toast({
            variant: "success",
            message: `${selectedDestinations.value.length} destination(s) deleted successfully`,
            timeout: 2000,
          });
        }

        selectedDestinations.value = [];
        getDestinations();
      } catch (error: any) {
        dismiss();
        const errorMessage = error.response?.data?.message || error?.message || "Error deleting destinations. Please try again.";
        if (error.response?.status != 403 || error?.status != 403) {
          toast({
            variant: "error",
            message: errorMessage,
            timeout: 3000,
          });
        }
      }

      confirmBulkDelete.value = false;
    };

    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });

    return {
      t,
      showDestinationEditor,
      destinations,
      columns,
      editDestination,
      getImageURL,
      loading,
      conformDeleteDestination,
      filterQuery,
      filterData,
      editingDestination,
      templates,
      toggleDestinationEditor,
      getDestinations,
      deleteDestination,
      cancelDeleteDestination,
      confirmDelete,
      resultTotal,
      routeTo,
      exportDestination,
      showImportDestination,
      importDestination,
      store,
      getActions,
      getTemplates,
      updateRoute,
      getDestinationByName,
      resetEditingDestination,
      visibleRows,
      selectedDestinationIds,
      handleSelectedIdsUpdate,
      openBulkDeleteDialog,
      bulkDeleteDestinations,
      confirmBulkDelete,
      selectedDestinations,
      getPrebuiltTypeName,
      getCustomDestinationLabel,
    };
  },
});
</script>
