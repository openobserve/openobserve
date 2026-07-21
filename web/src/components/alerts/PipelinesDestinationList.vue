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
  <div class="flex flex-col h-full p-0">
    <OPageLayout bleed
      v-if="!showDestinationEditor"
      :title="t('pipeline_destinations.header')"
      icon="person-pin-circle"
      :subtitle="'External targets for pipeline output'"
    >
        <template #actions>
          <OButton
            data-test="pipeline-destination-list-add-btn"
            variant="primary"
            size="sm"
            @click="editDestination(null)"
            >{{ t(`alert_destinations.add`) }}</OButton
          >
        </template>
      <div class="bg-card-glass-bg flex-1 min-h-0 overflow-hidden">
      <OTable
        :frame="false"
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
        :footer-title="t('pipeline_destinations.header')"
        sorting="client"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="settings-pipeline-destinations"
        show-index
        :show-global-filter="false"
        @update:selected-ids="handleSelectedIdsUpdate"
      >
        <template #toolbar>
          <OSearchInput
            v-model="filterQuery"
            class="flex-1"
            :placeholder="t('pipeline_destinations.search')"
          />
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="pipeline-destination-list-refresh-btn"
            @click="getDestinations"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="pipelineDestinationsRefresh" />
          </OButton>
        </template>
        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-pipeline-destinations"
            :filtered="!!filterQuery"
            @action="(id) => id === 'clear-filters' ? (filterQuery = '') : editDestination(null)"
          />
        </template>

        <template #cell-destination_type="{ row }">
          <OTag
            v-if="row.destination_type_name"
            type="fieldTag"
            value="soft"
          >{{ row.destination_type_name }}</OTag>
          <span v-else class="text-text-body">—</span>
        </template>

        <template #cell-output_format="{ row }">
          <OTag
            v-if="row.output_format"
            type="fieldTag"
            value="soft"
          >{{ formatOutputFormat(row.output_format) }}</OTag>
          <span v-else class="text-text-body">—</span>
        </template>

        <template #cell-actions="{ row }">
          <OButton
            :data-test="`alert-destination-list-${row.name}-update-destination`"
            data-row-action="edit"
            variant="ghost"
            size="icon-sm"
            :title="t('alert_destinations.edit')"
            @click="editDestination(row)"
          >
            <OIcon name="edit" size="sm" />
          </OButton>
          <OButton
            :data-test="`alert-destination-list-${row.name}-delete-destination`"
            data-row-action="delete"
            variant="ghost"
            size="icon-sm"
            :title="t('alert_destinations.delete')"
            @click="conformDeleteDestination(row)"
          >
            <OIcon name="delete" size="sm" />
          </OButton>
        </template>

        <template
          v-if="selectedDestinations.length > 0"
          #bottom
        >
          <span class="text-xs text-text-secondary font-medium">
            {{ selectedDestinations.length }} selected
          </span>
          <OButton
            data-test="pipeline-destination-list-delete-destinations-btn"
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            @click="openBulkDeleteDialog"
          >
            Delete
          </OButton>
        </template>
      </OTable>
      </div>
    </OPageLayout>
    <div v-else>
      <PipelineDestinationEditor
        :destination="editingDestination"
        @cancel="toggleDestinationEditor"
        @created="handleDestinationCreated"
        @updated="handleDestinationUpdated"
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
import { getImageURL } from "@/utils/zincutils";
import PipelineDestinationEditor from "../pipeline/PipelineDestinationEditor.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useRouter } from "vue-router";
import type { DestinationPayload } from "@/ts/interfaces";
import type { Template } from "@/ts/interfaces/index";

import { useReo } from "@/services/reodotdev_analytics";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { COL } from "@/lib/core/Table/OTable.types";

interface ConformDelete {
  visible: boolean;
  data: any;
}

const formatOutputFormat = (val: any): string => {
  if (!val) return "N/A";
  if (typeof val === "string") return val.toUpperCase();
  if (typeof val === "object" && val.esbulk) return "ESBULK";
  return "N/A";
};

export default defineComponent({
  name: "PageAlerts",
  components: {
    OPageLayout,
    PipelineDestinationEditor,
    OEmptyState,
    ConfirmDialog,
    OButton,
    OTooltip,
    OIcon,
    OTag,
    OSearchInput,
    OTable,
  },
  setup() {
    const store = useStore();
    const editingDestination: Ref<DestinationPayload | null> = ref(null);
    const { t } = useI18n();
    const { track } = useReo();
    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("alert_destinations.name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "destination_type",
        header: "Destination Type",
        accessorKey: "destination_type_name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 150,
        meta: { align: "left" },
      },
      {
        id: "url",
        header: t("alert_destinations.url"),
        accessorKey: "url",
        resizable: true,
        hideable: true,
        size: COL.url,
        meta: { align: "left" },
      },
      {
        id: "method",
        header: t("alert_destinations.method"),
        accessorKey: "method",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 120,
        meta: { align: "left" },
      },
      {
        id: "output_format",
        header: "Output Format",
        accessorKey: "output_format",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 140,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("alert_destinations.actions"),
        isAction: true,
        pinned: "right",
        size: 100,
        meta: { align: "center", actionCount: 2 },
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
    });

    watch(
      () => router.currentRoute.value.query.action,
      (action) => {
        if (!action) showDestinationEditor.value = false;
      },
    );

    onMounted(() => {
      updateRoute();
    });

    const loading = ref(false);
    const getDestinations = () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading destinations...",
              timeout: 0,
});
      loading.value = true;
      destinationService
        .list({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          org_identifier: store.state.selectedOrganization.identifier,
          module: "pipeline",
        })
        .then((res) => {
          resultTotal.value = res.data.length;
          destinations.value = res.data;
          updateRoute();
        })
        .catch((err) => {
          if (err.response.status != 403) {
            toast({
              variant: "error",
              message: "Error while pulling destinations.",
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
    };
    const getDestinationByName = (name: string) => {
      return destinations.value.find(
        (destination) => destination.name === name,
      );
    };
    const editDestination = (destination: any) => {
      if (!destination) {
        track("Button Click", {
          button: "Add Pipeline Destination",
          page: "Pipeline Destinations",
        });
      }
      toggleDestinationEditor();
      resetEditingDestination();
      if (!destination) {
        router.push({
          name: "pipelineDestinations",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      } else {
        editingDestination.value = { ...destination };
        router.push({
          name: "pipelineDestinations",
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
          name: "pipelineDestinations",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
    };

    const handleDestinationCreated = (destinationName: string) => {
      toggleDestinationEditor();
      getDestinations();

      toast({
        variant: "success",
        message: `Destination "${destinationName}" created successfully.`,
      });
    };

    const handleDestinationUpdated = (destinationName: string) => {
      toggleDestinationEditor();
      getDestinations();

      toast({
        variant: "success",
        message: `Destination "${destinationName}" updated successfully.`,
      });
    };

    const filterData = (rows: any, terms: any) => {
      var filtered = [];
      terms = terms.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        let outputFormatStr = "";
        if (rows[i]["output_format"]) {
          if (typeof rows[i]["output_format"] === "string") {
            outputFormatStr = rows[i]["output_format"].toLowerCase();
          } else if (
            typeof rows[i]["output_format"] === "object" &&
            rows[i]["output_format"].esbulk
          ) {
            outputFormatStr = "esbulk";
          }
        }

        if (
          rows[i]["name"].toLowerCase().includes(terms) ||
          rows[i]["destination_type_name"].toLowerCase().includes(terms) ||
          rows[i]["url"].toLowerCase().includes(terms) ||
          rows[i]["method"].toLowerCase().includes(terms) ||
          outputFormatStr.includes(terms)
        ) {
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

    const visibleRows = computed(() => {
      if (!filterQuery.value) return destinations.value || [];
      return filterData(destinations.value || [], filterQuery.value);
    });

    watch(
      visibleRows,
      (newVisibleRows) => {
        resultTotal.value = newVisibleRows.length;
      },
      { immediate: true },
    );

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
          });
          dismiss();
          return;
        }

        const payload = {
          ids: selectedDestinations.value.map((d: any) => d.name),
        };

        const response = await destinationService.bulkDelete(
          store.state.selectedOrganization.identifier,
          payload,
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
            });
          } else {
            toast({
              variant: "success",
              message: `${successCount} destination(s) deleted successfully`,
            });
          }
        } else {
          toast({
            variant: "success",
            message: `${selectedDestinations.value.length} destination(s) deleted successfully`,
          });
        }

        selectedDestinations.value = [];
        getDestinations();
      } catch (error: any) {
        dismiss();
        console.error("Error deleting destinations:", error);

        const errorMessage =
          error.response?.data?.message ||
          error?.message ||
          "Error deleting destinations. Please try again.";
        if (error.response?.status != 403 || error?.status != 403) {
          toast({
            variant: "error",
            message: errorMessage,
          });
        }
      }

      confirmBulkDelete.value = false;
    };

    useShortcuts([
      { id: "pipelineDestinationsRefresh", handler: () => { if (!isInputFocused()) getDestinations(); } },
    ]);

    return {
      t,
      showDestinationEditor,
      destinations,
      columns,
      editDestination,
      getImageURL,
      conformDeleteDestination,
      loading,
      filterQuery,
      filterData,
      editingDestination,
      templates,
      toggleDestinationEditor,
      handleDestinationCreated,
      handleDestinationUpdated,
      getDestinations,
      deleteDestination,
      cancelDeleteDestination,
      confirmDelete,
      resultTotal,
      routeTo,
      store,
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
      formatOutputFormat,
    };
  },
});
</script>
