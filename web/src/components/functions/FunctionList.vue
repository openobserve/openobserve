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
  <q-page>
    <div v-if="!showAddJSTransformDialog">
      <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
        <div class="card-container tw:mb-[0.625rem]">
          <div class="tw:flex tw:items-center tw:justify-between tw:py-3 tw:px-4 tw:h-[68px]">
            <div class="q-table__title tw:font-[600]">
                {{ t("function.header") }}
              </div>
              <div class="q-ml-auto" data-test="functions-list-search-input">
                <q-input
                  v-model="filterQuery"
                  borderless
                  dense
                  class="q-ml-auto no-border o2-search-input"
                  :placeholder="t('function.search')"
                >
                  <template #prepend>
                    <q-icon class="o2-search-input-icon" name="search" />
                  </template>
                </q-input>
              </div>
              <q-btn
                  class="q-ml-sm o2-primary-button tw:h-[36px]"
                flat
                no-caps
                :label="t(`function.add`)"
                data-test="function-list-add-function-btn"
                @click="showAddUpdateFn({})"
              />
          </div>
        </div>
        <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
          <div class="card-container tw:h-[calc(100vh-127px)]">
            <q-table
              ref="qTable"
              :rows="visibleRows"
              :columns="columns"
              row-key="name"
              :pagination="pagination"
              :filter="filterQuery"
              selection="multiple"
              v-model:selected="selectedFunctions"
              style="width: 100%"
              :style="hasVisibleRows
                  ? 'width: 100%; height: calc(100vh - 130px)'
                  : 'width: 100%'"
              class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
            >
              <template #no-data>
                <NoData />
              </template>
              <template v-slot:body-cell-actions="props">
                <q-td :props="props">
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    icon="edit"
                    round
                    flat
                    :title="t('function.updateTitle')"
                    @click="showAddUpdateFn(props)"
                  >
                </q-btn>
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    :icon="outlinedDelete"
                    round
                    flat
                    :title="t('function.delete')"
                    @click="showDeleteDialogFn(props)"
                  >
                </q-btn>
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    :icon="outlinedAccountTree"
                    round
                    flat
                    :title="'Associated Pipelines'"
                    @click="getAssociatedPipelines(props)"
                  >
                </q-btn>
                </q-td>
              </template>

              <template v-slot:body-cell-function="props">
                <q-td :props="props">
                  <q-tooltip>
                    <pre>{{ props.row.function }}</pre>
                  </q-tooltip>
                  <pre style="white-space: break-spaces">{{
                    props.row.function
                  }}</pre>
                </q-td>
              </template>

              <template v-slot:body-selection="scope">
                <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
              </template>

              <template #bottom="scope">
                <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
                  <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[100px] tw:mr-md">
                        {{ resultTotal }} {{ t('function.header') }}
                      </div>
                  <q-btn
                    v-if="selectedFunctions.length > 0"
                    data-test="function-list-delete-functions-btn"
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
    </div>
    <div v-else>
      <AddFunction
        v-model="formData"
        :isUpdated="isUpdated"
        class="q-pa-sm"
        @update:list="refreshList"
        @cancel:hideform="hideForm"
        @sendToAiChat="sendToAiChat"
      />
    </div>
    <ConfirmDialog
      title="Delete Transform"
      message="Are you sure you want to delete transform?"
      @update:ok="deleteFn"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />

    <ConfirmDialog
      title="Delete Functions"
      :message="`Are you sure you want to delete ${selectedFunctions.length} function(s)?`"
      @update:ok="bulkDeleteFunctions"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />

    <q-dialog v-model="confirmForceDelete" persistent>
      <q-card style="width: 40vw; max-height: 90vh; overflow-y: auto">
        <q-card-section
          class="text-h6 dialog-heading tw:flex tw:justify-between tw:items-center"
        >
          <div>
            Pipelines Associated with
            <strong> {{ selectedDelete.name }}</strong>
          </div>
          <q-icon
            name="close"
            size="18px"
            @click="closeDialog"
            style="cursor: pointer"
          />
        </q-card-section>
        <q-card-section>
          <div
            v-if="transformedPipelineList.length > 0"
            class="pipeline-list-container"
          >
            <q-list class="scrollable-list">
              <q-item
                v-for="(pipeline, index) in transformedPipelineList"
                :key="pipeline.value"
                clickable
                @click="onPipelineSelect(pipeline)"
              >
                <q-item-section>
                  {{ index + 1 }}. {{ pipeline.label }}
                </q-item-section>
              </q-item>
            </q-list>
          </div>
          <div v-else>
            <div class="text-h6 text-center">
              No pipelines associated with this function
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
import {
  defineAsyncComponent,
  defineComponent,
  ref,
  computed,
  watch,
  onMounted,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "../shared/grid/Pagination.vue";
import jsTransformService from "../../services/jstransform";
import NoData from "../shared/grid/NoData.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import segment from "../../services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "../../utils/zincutils";
import {
  outlinedDelete,
  outlinedAccountTree,
} from "@quasar/extras/material-icons-outlined";
import useLogs from "@/composables/useLogs";
import { useReo } from "@/services/reodotdev_analytics";

export default defineComponent({
  name: "functionList",
  components: {
    QTablePagination,
    AddFunction: defineAsyncComponent(() => import("./AddFunction.vue")),
    NoData,
    ConfirmDialog,
  },
  emits: [
    "updated:fields",
    "update:changeRecordPerPage",
    "update:maxRecordToReturn",
    "sendToAiChat"
  ],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const router = useRouter();
    const jsTransforms: any = ref([]);
    const formData: any = ref({});
    const showAddJSTransformDialog: any = ref(false);
    const qTable: any = ref(null);
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmForceDelete = ref<boolean>(false);
    const confirmBulkDelete = ref<boolean>(false);
    const selectedFunctions = ref<any[]>([]);
    const { searchObj } = useLogs();
    const pipelineList = ref([]);
    const selectedPipeline = ref("");
    const filterQuery = ref("");
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
        label: t("function.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("function.actions"),
        align: "center",
        sortable: false,
        classes:'actions-column'
      },
    ]);

    const onPipelineSelect = (pipeline: any) => {
      const routeUrl = router.resolve({
        name: "pipelineEditor",
        query: {
          id: pipeline.value,
          name: pipeline.label,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;

      window.open(routeUrl, "_blank");
    };

    const getJSTransforms = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading functions...",
      });

      jsTransformService
        .list(
          1,
          100000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier,
        )
        .then((res) => {
          var counter = 1;
          resultTotal.value = res.data.list.length;
          if (router.currentRoute.value.query.action == "add") {
            showAddUpdateFn({ row: undefined });
          }
          jsTransforms.value = res.data.list.map((data: any) => {
            if (router.currentRoute.value.query.action == "update") {
              if (router.currentRoute.value.query.name == data.name) {
                showAddUpdateFn({ row: data });
              }
            }

            return {
              "#": counter <= 9 ? `0${counter++}` : counter++,
              name: data.name,
              function: data.function,
              params: data.params,
              // order: data.order ? data.order : 1,
              // stream_name: data.stream_name ? data.stream_name : "--",
              // stream_type: data.stream_type ? data.stream_type : "--",
              transType: data.transType.toString(),
              // ingest: data.stream_name ? true : false,
              actions: "",
            };
          });

          searchObj.data.transforms = jsTransforms.value;

          dismiss();
        })
        .catch((err) => {
          console.error("Error while pulling function", err);

          dismiss();
          if (err.response.status != 403) {
            $q.notify({
              type: "negative",
              message: "Error while pulling function.",
              timeout: 2000,
            });
          }
        });
    };

    if (jsTransforms.value == "" || jsTransforms.value == undefined) {
      getJSTransforms();
    }

    interface OptionType {
      label: String;
      value: number | String;
    }
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
      qTable.value.setPagination(pagination.value);
    };
    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
    };

    const addTransform = () => {
      showAddJSTransformDialog.value = true;
    };

    const transformedPipelineList = computed(() => {
      return pipelineList.value.map((pipeline: any) => ({
        label: pipeline.name,
        value: pipeline.id,
      }));
    });

    const showAddUpdateFn = (props: any) => {
      formData.value = props.row;
      let action;
      if (!props.row) {
        isUpdated.value = false;
        action = "Add Function";
        router.push({
          name: "functionList",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        track("Button Click", {
          button: "Add Function",
          page: "Functions"
        });
      } else {
        isUpdated.value = true;
        action = "Update Function";
        router.push({
          name: "functionList",
          query: {
            action: "update",
            name: props.row.name,
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        track("Button Click", {
          button: "Update Function",
          page: "Functions"
        });
      }
      addTransform();

      segment.track("Button Click", {
        button: action,
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Functions",
      });
    };

    const refreshList = () => {
      router.push({
        name: "functionList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      showAddJSTransformDialog.value = false;
      getJSTransforms();
    };

    const hideForm = () => {
      showAddJSTransformDialog.value = false;
      router.replace({
        name: "functionList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const deleteFn = () => {
      jsTransformService
        .delete(
          store.state.selectedOrganization.identifier,
          selectedDelete.value.name,
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              type: "positive",
              message: res.data.message,
              timeout: 2000,
            });
            getJSTransforms();
          } else {
            $q.notify({
              type: "negative",
              message: res.data.message,
              timeout: 2000,
            });
          }
        })
        .catch((err) => {
          if (err.response.data.code == 409) {
            $q.notify({
              type: "negative",
              message:
                "Function deletion failed as it is associated with pipelines. Click on view button to get associated pipelines.",
              timeout: 10000,
              actions: [
                {
                  label: "View",
                  color: "white",
                  handler: () => {
                    forceRemoveFunction(err.response.data["message"]);
                  },
                },
              ],
            });
            return;
          }
          if (err.response.status != 403) {
            $q.notify({
              type: "negative",
              message:
                JSON.stringify(err.response.data["message"]) ||
                "Function deletion failed.",
            });
          }
        });

      segment.track("Button Click", {
        button: "Delete Function",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        function_name: selectedDelete.value.name,
        is_ingest_func: selectedDelete.value.ingest,
        page: "Functions",
      });
    };

    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDelete.value = true;
    };

    const getAssociatedPipelines = (props: any) => {
      selectedDelete.value = props.row;
      jsTransformService
        .getAssociatedPipelines(
          store.state.selectedOrganization.identifier,
          props.row.name,
        )
        .then((res: any) => {
          pipelineList.value = res.data.list;
          confirmForceDelete.value = true;
        })
        .catch((err) => {
          console.log(err);
        });
    };

    const forceRemoveFunction = (message: any) => {
      const match = message.match(/\[([^\]]+)\]/);
      if (match) {
        // Convert the matched string to an array of pipeline names
        pipelineList.value = JSON.parse(match[0].replace(/'/g, '"'));
      }

      confirmForceDelete.value = true;
    };

    const closeDialog = () => {
      confirmForceDelete.value = false;
    };

    const forceDeleteFn = () => {};

    const sendToAiChat = (value: any) => {
      emit("sendToAiChat", value);
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

    const visibleRows = computed(() => {
      if (!filterQuery.value) return jsTransforms.value || []
      return filterData(jsTransforms.value || [], filterQuery.value)
    });
    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    // Watch visibleRows to sync resultTotal with search filter
    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });

    
    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteFunctions = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Deleting functions...",
        timeout: 0,
      });

      try {
        if (selectedFunctions.value.length === 0) {
          $q.notify({
            type: "negative",
            message: "No functions selected for deletion",
            timeout: 2000,
          });
          dismiss();
          return;
        }

        // Extract function names for the API call (BE supports names)
        const payload = {
          ids: selectedFunctions.value.map((f: any) => f.name),
        };

        const response = await jsTransformService.bulkDelete(
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
            $q.notify({
              type: "warning",
              message: `${successCount} function(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            // All failed
            $q.notify({
              type: "negative",
              message: `Failed to delete ${failCount} function(s)`,
              timeout: 3000,
            });
          } else {
            // All successful
            $q.notify({
              type: "positive",
              message: `${successCount} function(s) deleted successfully`,
              timeout: 2000,
            });
          }
        } else {
          // Fallback success message
          $q.notify({
            type: "positive",
            message: `${selectedFunctions.value.length} function(s) deleted successfully`,
            timeout: 2000,
          });
        }

        selectedFunctions.value = [];
        // Refresh functions list
        getJSTransforms();
      } catch (error: any) {
        dismiss();
        console.error("Error deleting functions:", error);

        // Show error message from response if available
        const errorMessage = error.response?.data?.message || error?.message || "Error deleting functions. Please try again.";
        if (error.response?.status != 403 || error?.status != 403) {
          $q.notify({
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
      store,
      router,
      jsTransforms,
      columns,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      getJSTransforms,
      pagination,
      resultTotal,
      refreshList,
      perPageOptions,
      selectedPerPage,
      addTransform,
      deleteFn,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      changePagination,
      maxRecordToReturn,
      showAddJSTransformDialog,
      changeMaxRecordToReturn,
      outlinedDelete,
      outlinedAccountTree,
      forceDeleteFn,
      confirmForceDelete,
      pipelineList,
      selectedPipeline,
      closeDialog,
      onPipelineSelect,
      transformedPipelineList,
      getAssociatedPipelines,
      filterQuery,
      filterData,
      getImageURL,
      verifyOrganizationStatus,
      sendToAiChat,
      visibleRows,
      hasVisibleRows,
      openBulkDeleteDialog,
      bulkDeleteFunctions,
      confirmBulkDelete,
      selectedFunctions,
    };
  },
  computed: {
    // selectedOrg() {
    //   return this.store.state.selectedOrganization.identifier;
    // },
  },
  watch: {
    // selectedOrg(newVal: any, oldVal: any) {
    //   this.verifyOrganizationStatus(
    //     this.store.state.organizations,
    //     this.router
    //   );
    //   if (
    //     (newVal != oldVal || this.jsTransforms.value == undefined) &&
    //     this.router.currentRoute.value.name == "AppFunctions"
    //   ) {
    //     this.resultTotal = 0;
    //     this.jsTransforms = [];
    //     this.getJSTransforms();
    //   }
    // },
  },
});
</script>

<style lang="scss">
.pipeline-list-container {
  max-height: 200px; /* Adjust based on item height to fit 5 items */
  overflow-y: auto;
}
.dialog-heading {
  border-bottom: 1px solid $border-color;
}

.scrollable-list::-webkit-scrollbar {
  width: 8px;
}

.scrollable-list::-webkit-scrollbar-thumb {
  background-color: #888; /* Desired thumb color */
  border-radius: 4px;
}

.scrollable-list::-webkit-scrollbar-thumb:hover {
  background-color: blue; /* Darker shade on hover */
}

.scrollable-list::-webkit-scrollbar-track {
  background-color: blue; /* Track color */
}
</style>
