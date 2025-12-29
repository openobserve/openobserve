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
  <q-page
    class="q-pa-none"
    style="height: calc(100vh - 88px); min-height: inherit"
  >
    <div v-if="!showDestinationEditor">
      <div
        class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
      >
        <div
          class="q-table__title tw:font-[600]"
          data-test="alert-destinations-list-title"
        >
          {{ t("pipeline_destinations.header") }}
        </div>
        <div class="tw:flex tw:justify-end">
          <q-input
            v-model="filterQuery"
            borderless
            dense
            class="q-ml-auto no-border o2-search-input"
            :placeholder="t('pipeline_destinations.search')"
          >
            <template #prepend>
              <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </q-input>
          <q-btn
            data-test="pipeline-destination-list-add-btn"
            class="o2-primary-button q-ml-sm tw:h-[36px]"
            no-caps
            flat
            :label="t(`alert_destinations.add`)"
            @click="editDestination(null)"
          />
        </div>
      </div>
      <q-table
        data-test="alert-destinations-list-table"
        ref="qTable"
        :rows="visibleRows"
        :columns="columns"
        row-key="name"
        :pagination="pagination"
        selection="multiple"
        v-model:selected="selectedDestinations"
        class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky o2-last-row-border"
        :style="
          hasVisibleRows
            ? 'width: 100%; height: calc(100vh - 112px); overflow-y: auto;'
            : 'width: 100%'
        "
      >
        <template #no-data>
          <template>
            <NoData />
          </template>
        </template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <div class="tw:flex tw:justify-center tw:items-center">
              <q-btn
                :data-test="`alert-destination-list-${props.row.name}-update-destination`"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                icon="edit"
                :title="t('alert_destinations.edit')"
                @click="editDestination(props.row)"
              >
              </q-btn>
              <q-btn
                :data-test="`alert-destination-list-${props.row.name}-delete-destination`"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                :icon="outlinedDelete"
                :title="t('alert_destinations.delete')"
                @click="conformDeleteDestination(props.row)"
              >
              </q-btn>
            </div>
          </q-td>
        </template>

        <template v-slot:body-selection="scope">
          <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
        </template>

        <template #bottom="scope">
          <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
            <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[230px] tw:mr-md">
                  {{ resultTotal }} {{ t('pipeline_destinations.header') }}
                </div>
            <q-btn
              v-if="selectedDestinations.length > 0"
              data-test="pipeline-destination-list-delete-destinations-btn"
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

              <!-- render the table headers -->
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
  </q-page>
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
import { useQuasar, type QTableProps } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import { getImageURL } from "@/utils/zincutils";
import PipelineDestinationEditor from "../pipeline/PipelineDestinationEditor.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useRouter } from "vue-router";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import type { DestinationPayload } from "@/ts/interfaces";
import type { Template } from "@/ts/interfaces/index";

import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { useReo } from "@/services/reodotdev_analytics";

interface ConformDelete {
  visible: boolean;
  data: any;
}
export default defineComponent({
  name: "PageAlerts",
  components: {
    PipelineDestinationEditor,
    NoData,
    ConfirmDialog,
    QTablePagination,
  },
  setup() {
    const qTable = ref();
    const store = useStore();
    const editingDestination: Ref<DestinationPayload | null> = ref(null);
    const { t } = useI18n();
    const q = useQuasar();
    const { track } = useReo();
    const columns: any = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
        style: "width: 67px",
      },
      {
        name: "name",
        field: "name",
        label: t("alert_destinations.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "destination_type",
        field: "destination_type_name",
        label: "Destination Type",
        align: "left",
        sortable: true,
        style: "width: 150px",
        format: (val: string) => val || "N/A",
      },
      {
        name: "url",
        field: "url",
        label: t("alert_destinations.url"),
        align: "left",
        sortable: false,
      },
      {
        name: "method",
        field: "method",
        label: t("alert_destinations.method"),
        align: "left",
        sortable: true,
        style: "width: 120px",
      },
      {
        name: "output_format",
        field: "output_format",
        label: "Output Format",
        align: "left",
        sortable: true,
        style: "width: 140px",
        format: (val: any) => {
          if (!val) return "N/A";
          if (typeof val === "string") return val.toUpperCase();
          if (typeof val === "object" && val.esbulk) return "ESBULK";
          return "N/A";
        },
      },
      {
        name: "actions",
        field: "actions",
        label: t("alert_destinations.actions"),
        align: "center",
        sortable: false,
        classes: "actions-column",
      },
    ]);
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
    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "All", value: 0 },
    ];
    const resultTotal = ref(0);
    const selectedPerPage = ref(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });
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

    const getDestinations = () => {
      const dismiss = q.notify({
        spinner: true,
        message: "Please wait while loading destinations...",
      });
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
          // res.data = res.data.filter(
          //   (destination: any) => destination.type == "external_destination",
          // );
          resultTotal.value = res.data.length;
          destinations.value = res.data.map((data: any, index: number) => ({
            ...data,
            "#": index + 1 <= 9 ? `0${index + 1}` : index + 1,
          }));
          updateRoute();
        })
        .catch((err) => {
          if (err.response.status != 403) {
            q.notify({
              type: "negative",
              message: "Error while pulling destinations.",
              timeout: 2000,
            });
          }
          dismiss();
        })
        .finally(() => dismiss());
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
            q.notify({
              type: "positive",
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
              q.notify({
                type: "negative",
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
          name: "pipelineDestinations",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
    };

    const handleDestinationCreated = (destinationName: string) => {
      // Close the editor and refresh the list
      toggleDestinationEditor();
      getDestinations();

      q.notify({
        type: "positive",
        message: `Destination "${destinationName}" created successfully.`,
      });
    };

    const handleDestinationUpdated = (destinationName: string) => {
      // Close the editor and refresh the list
      toggleDestinationEditor();
      getDestinations();

      q.notify({
        type: "positive",
        message: `Destination "${destinationName}" updated successfully.`,
      });
    };

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };
    const filterData = (rows: any, terms: any) => {
      var filtered = [];
      terms = terms.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        // Convert output_format to string for filtering
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
    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    // Watch visibleRows to sync resultTotal with search filter
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
      const dismiss = q.notify({
        spinner: true,
        message: "Deleting destinations...",
        timeout: 0,
      });

      try {
        if (selectedDestinations.value.length === 0) {
          q.notify({
            type: "negative",
            message: "No destinations selected for deletion",
            timeout: 2000,
          });
          dismiss();
          return;
        }

        // Extract destination names for the API call (BE supports names)
        const payload = {
          ids: selectedDestinations.value.map((d: any) => d.name),
        };

        const response = await destinationService.bulkDelete(
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
              message: `${successCount} destination(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            // All failed
            q.notify({
              type: "negative",
              message: `Failed to delete ${failCount} destination(s)`,
              timeout: 3000,
            });
          } else {
            // All successful
            q.notify({
              type: "positive",
              message: `${successCount} destination(s) deleted successfully`,
              timeout: 2000,
            });
          }
        } else {
          // Fallback success message
          q.notify({
            type: "positive",
            message: `${selectedDestinations.value.length} destination(s) deleted successfully`,
            timeout: 2000,
          });
        }

        selectedDestinations.value = [];
        // Refresh destinations list
        getDestinations();
      } catch (error: any) {
        dismiss();
        console.error("Error deleting destinations:", error);

        // Show error message from response if available
        const errorMessage = error.response?.data?.message || error?.message || "Error deleting destinations. Please try again.";
        if (error.response?.status != 403 || error?.status != 403) {
          q.notify({
            type: "negative",
            message: errorMessage,
            timeout: 3000,
          });
        }
      }

      confirmBulkDelete.value = false;
    };

    return {
      t,
      qTable,
      showDestinationEditor,
      destinations,
      columns,
      editDestination,
      getImageURL,
      conformDeleteDestination,
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
      changePagination,
      perPageOptions,
      resultTotal,
      selectedPerPage,
      pagination,
      outlinedDelete,
      routeTo,
      store,
      // Exposed helper functions for testing
      getTemplates,
      updateRoute,
      getDestinationByName,
      resetEditingDestination,
      visibleRows,
      hasVisibleRows,
      openBulkDeleteDialog,
      bulkDeleteDestinations,
      confirmBulkDelete,
      selectedDestinations,
    };
  },
});
</script>
