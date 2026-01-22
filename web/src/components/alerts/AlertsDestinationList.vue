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
  <q-page class="q-pa-none" style="height: calc(100vh - 88px); min-height: inherit" >

    <div v-if="!showDestinationEditor && !showImportDestination" >
      <div class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
      >
        <div class="q-table__title tw:font-[600]" data-test="alert-destinations-list-title">
            {{ t("alert_destinations.header") }}
          </div>
          <div class="tw:flex tw:justify-end">
            <q-input
              v-model="filterQuery"
              borderless
              dense
              data-test="destination-list-search-input"
              class="q-ml-auto no-border o2-search-input"
              :placeholder="t('alert_destinations.search')"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
          <q-btn
            class="o2-secondary-button q-ml-sm tw:h-[36px]"
            no-caps
            flat
            :label="t(`dashboard.import`)"
            @click="importDestination"
            data-test="destination-import"
          />
          <q-btn
            data-test="alert-destination-list-add-alert-btn"
            class="o2-primary-button q-ml-sm tw:h-[36px]"
            no-caps
            flat
            :disable="!templates.length"
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
        class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
        :style="hasVisibleRows
            ? 'width: 100%; height: calc(100vh - 112px); overflow-y: auto;'
            : 'width: 100%'"
      >
        <template #no-data>
          <div
            v-if="!templates.length"
            class="full-width flex column justify-center items-center text-center"
          >
            <div style="width: 600px" class="q-mt-xl">
              <template v-if="!templates.length">
                <div class="text-subtitle1">
                  It looks like you haven't created any Templates yet. To create
                  an Alert, you'll need to have at least one Destination and one
                  Template in place
                </div>
                <q-btn
                  class="q-mt-md"
                  label="Create Template"
                  size="md"
                  color="primary"
                  no-caps
                  style="border-radius: 4px"
                  @click="routeTo('alertTemplates')"
                />
              </template>
            </div>
          </div>
          <template v-else>
            <NoData />
          </template>
        </template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
              <q-btn
                data-test="destination-export"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                title="Export Destination"
                icon="download"
                @click.stop="exportDestination(props.row)"
              >
              </q-btn>
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

        <template v-slot:body-cell-type="props">
          <q-td :props="props">
            <div class="tw:flex tw:items-center tw:gap-2">
              <!-- Prebuilt Destination Badge -->
              <template v-if="getPrebuiltTypeName(props.row)">
                <q-badge
                  :data-test="`destination-type-badge-${getPrebuiltTypeName(props.row)?.toLowerCase()}`"
                  :color="'primary'"
                  class="tw:text-xs"
                  :label="getPrebuiltTypeName(props.row)"
                />
                <q-icon
                  name="auto_awesome"
                  size="16px"
                  color="primary"
                  :title="'Prebuilt ' + getPrebuiltTypeName(props.row) + ' destination'"
                />
              </template>
              <!-- Custom Destination -->
              <template v-else>
                <q-badge
                  data-test="destination-type-badge-custom"
                  color="grey-6"
                  class="tw:text-xs"
                  label="Custom"
                />
                <q-icon
                  name="settings"
                  size="16px"
                  color="grey-6"
                  title="Custom destination"
                />
              </template>
            </div>
          </q-td>
        </template>

        <template v-slot:body-selection="scope">
          <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
        </template>

        <template #bottom="scope">
          <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
            <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-sm">
                  {{ resultTotal }} {{ t('alert_destinations.header') }}
                </div>
            <q-btn
              v-if="selectedDestinations.length > 0"
              data-test="destination-list-delete-destinations-btn"
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

              <!-- Render the table headers -->
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
import AddDestination from "./AddDestination.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useRouter } from "vue-router";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import type { DestinationPayload } from "@/ts/interfaces";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import type { Template } from "@/ts/interfaces/index";

import ImportDestination from "./ImportDestination.vue";
import useActions from "@/composables/useActions";
import { useReo } from "@/services/reodotdev_analytics";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";

interface ConformDelete {
  visible: boolean;
  data: any;
}
export default defineComponent({
  name: "PageAlerts",
  components: {
    AddDestination,
    NoData,
    ConfirmDialog,
    QTablePagination,
    ImportDestination,
  },
  setup() {
    const qTable = ref();
    const store = useStore();
    const editingDestination: Ref<DestinationPayload | null> = ref(null);
    const { t } = useI18n();
    const q = useQuasar();
    const { getAllActions } = useActions();
    const { track } = useReo();

    // Prebuilt destinations composable
    const { detectPrebuiltType, availableTypes } = usePrebuiltDestinations();

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
        name: "type",
        field: "type",
        label: "Type",
        align: "left",
        sortable: true,
        style: "width: 120px",
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
        style: "width: 150px",
      },
      {
        name: "actions",
        field: "actions",
        label: t("alert_destinations.actions"),
        align: "center",
        sortable: false,
        classes:'actions-column'
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
    const showImportDestination = ref(false);
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
      const dismiss = q.notify({
        spinner: true,
        message: "Please wait while loading alert destination...",
      });
      if (store.state.organizationData.actions.length == 0) {
        await getAllActions()
          .catch(() => {
            q.notify({
              type: "negative",
              message: "Error while loading actions.",
            });
          })
          .finally(() => dismiss());
      }
    };

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
          name: "alertDestinations",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
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
      // Create an anchor element to trigger the download
      const link = document.createElement("a");
      link.href = url;

      // Set the filename of the download
      link.download = `${destinationByName.name}.json`;

      // Trigger the download by simulating a click
      link.click();

      // Clean up the URL object after download
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

    // Get display name for prebuilt destination type
    const getPrebuiltTypeName = (destination: DestinationPayload): string | null => {
      const prebuiltType = detectPrebuiltType(destination);
      if (!prebuiltType) return null;

      const typeConfig = availableTypes.value.find(t => t.id === prebuiltType);
      return typeConfig ? typeConfig.name : prebuiltType;
    };

    const visibleRows = computed(() => {
      if (!filterQuery.value) return destinations.value || [];
      return filterData(destinations.value || [], filterQuery.value);
    });
    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

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


    // Watch visibleRows to sync resultTotal with search filter
    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });

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
      getDestinations,
      deleteDestination,
      cancelDeleteDestination,
      confirmDelete,
      changePagination,
      perPageOptions,
      resultTotal,
      pagination,
      routeTo,
      exportDestination,
      showImportDestination,
      importDestination,
      store,
      // Expose additional methods for testing
      getActions,
      getTemplates,
      updateRoute,
      getDestinationByName,
      resetEditingDestination,
      selectedPerPage,
      visibleRows,
      hasVisibleRows,
      outlinedDelete,
      openBulkDeleteDialog,
      bulkDeleteDestinations,
      confirmBulkDelete,
      selectedDestinations,
      getPrebuiltTypeName,
    };
  },
});
</script>
