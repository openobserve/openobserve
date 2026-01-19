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
    class="q-pa-none flex flex-col"
  >
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] q-pt-xs">
        <div class="card-container tw:mb-[0.625rem]">
          <div class="flex items-center justify-between full-width tw:py-3 tw:px-4 tw:h-[68px]">
            <div class="q-table__title tw:font-[600]" data-test="log-stream-title-text">
              {{ t("logStream.header") }}
            </div>
            <div class="flex items-start">
              <div class="flex justify-between items-end">

                  <div class="app-tabs-container tw:h-[36px] q-mr-sm">
                      <app-tabs
                      class="tabs-selection-container"
                      :tabs="streamTabs"
                      v-model:active-tab="streamActiveTab"
                      @update:active-tab="filterLogStreamByTab"
                    />
                </div>
              </div>
              <div data-test="streams-search-stream-input">
                <q-input
                  v-model="filterQuery"
                  borderless
                  dense
                  class="q-ml-auto no-border o2-search-input tw:h-[36px]"
                  :placeholder="t('logStream.search')"
                  debounce="300"
                >
                  <template #prepend>
                    <q-icon class="o2-search-input-icon" name="search" />
                  </template>
                </q-input>
              </div>
              <q-btn
                data-test="log-stream-refresh-stats-btn"
                class="q-ml-sm o2-secondary-button tw:h-[36px]"
                flat
                no-caps
                @click="getLogStream(true)"
              >
                <span>{{ t(`logStream.refreshStats`) }}</span>
              </q-btn>
              <q-btn
                v-if="isSchemaUDSEnabled"
                data-test="log-stream-add-stream-btn"
                class="q-ml-sm o2-primary-button tw:h-[36px]"
                flat
                no-caps
                :label="t(`logStream.add`)"
                @click="addStream"
              />
            </div>
          </div>
        </div>
      <div class="tw:w-full tw:h-full">
        <div class="card-container tw:h-[calc(100vh-126px)]">
          <q-table
            data-test="log-stream-table"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
            ref="qTable"
            v-model:selected="selected"
            :rows="logStream"
            :columns="columns"
            :row-key="getRowKey"
            :selected-rows-label="getSelectedString"
            selection="multiple"
            v-model:pagination="pagination"
            :filter="filterQuery"
            :filter-method="filterData"
            :style="logStream?.length
                  ? 'width: 100%; height: calc(100vh - 126px)' 
                  : 'width: 100%'"
            :rows-per-page-options="perPageOptions"
            @request="onRequest"
          >
            <template #no-data>
              <div v-if="!loadingState" class="text-center full-width full-height">
                <NoData />
              </div>
              <div
                v-else
                class="text-center full-width full-height q-mt-lg tw:flex tw:justify-center"
              >
                <q-spinner-hourglass color="primary" size="lg" />
              </div>
            </template>
            <template #body-selection="scope">
              <q-checkbox v-model="scope.selected" size="sm" :class="store.state.theme === 'dark' ? 'o2-table-checkbox-dark' : 'o2-table-checkbox-light'" class="o2-table-checkbox" />
            </template>
            <template #body-cell-actions="props">
              <q-td :props="props">
                <q-btn
                  :title="t('logStream.explore')"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  @click="exploreStream(props)"
                  icon="search"
                >
              </q-btn>
                <q-btn
                  :title="t('logStream.schemaHeader')"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  @click="listSchema(props)"
                  icon="list_alt"
                >
              </q-btn>
                <q-btn
                  :title="t('logStream.delete')"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  @click="confirmDeleteAction(props)"
                  :icon="outlinedDelete"
                >
              </q-btn>
              </q-td>
            </template>
            <template v-slot:pagination="scope">
              <div class="tw:flex tw:items-center tw:justify-between tw:py-3 tw:px-4">


              <div class="q-btn-group row no-wrap inline q-ml-md">
                <q-btn
                  icon="chevron_left"
                  color="grey-8"
                  round
                  dense
                  flat
                  size="sm"
                  class="q-px-sm"
                  :disable="scope.isFirstPage"
                  @click="scope.prevPage"
                />
                <hr
                  class="q-separator q-separator--vertical"
                  aria-orientation="vertical"
                />
                <q-btn
                  icon="chevron_right"
                  color="grey-8"
                  round
                  dense
                  flat
                  size="sm"
                  class="q-px-sm"
                  :disable="scope.isLastPage"
                  @click="scope.nextPage"
                />
              </div>
              </div>

            </template>
            <template v-slot:header="props">
                  <q-tr :props="props">
                    <!-- Adding this block to render the select-all checkbox -->
                    <q-th auto-width>
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

            <template v-slot:bottom="scope">
              <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
                <div class="q-table__separator tw:flex tw:items-center tw:w-full text-bold tw:text-[14px]">
                  {{scope.pagination.rowsNumber}} Stream(s)
                  <q-btn
                  v-if="selected.length > 0"
                  class="o2-secondary-button tw:h-[36px] tw:ml-4"
                  no-caps
                  flat
                  :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                  :disable="isDeleting"
                  @click="confirmBatchDeleteAction"
                >
                  <q-icon name="delete" size="16px" />
                  <span class="tw:ml-2">{{ isDeleting ? 'Deleting...' : 'Delete' }}</span>
              </q-btn>
                </div>
                <QTablePagination
                  :scope="scope"
                  :position="'bottom'"
                  :resultTotal="pagination.rowsNumber"
                  :perPageOptions="perPageOptions"
                  @update:changeRecordPerPage="changePagination"
                />
              </div>

            </template>

          </q-table> 
        </div>
      </div>
    </div> 
  
    <q-dialog
      v-model="showIndexSchemaDialog"
      position="right"
      full-height
      maximized
    >
      <SchemaIndex v-model="schemaData" />
    </q-dialog>

    <q-dialog
      v-model="addStreamDialog.show"
      position="right"
      full-height
      maximized
    >
      <AddStream
        :is-in-pipeline="false"
        @close="addStreamDialog.show = false"
        @streamAdded="getLogStream"
      />
    </q-dialog>

    <q-dialog v-model="confirmDelete">
      <q-card style="width: 420px">
        <q-card-section class="confirmBodyLogStream">
          <div class="head">{{ t("logStream.confirmDeleteHead") }}</div>
          <div class="para">{{ t("logStream.confirmDeleteMsg") }}</div>
        </q-card-section>
        <div class="tw:w-full tw:flex tw:justify-center tw:items-center tw:text-sm tw:text-gray-500">
            <q-checkbox class="checkbox-delete-associated-alerts-pipelines" v-model="deleteAssociatedAlertsPipelines" />
          <span class="delete-associated-alerts-pipelines-text">
            Delete all pipelines and alerts associated with the stream
          </span>
          </div>
        <q-card-actions class="confirmActionsLogStream">
          <q-btn v-close-popup="true" unelevated no-caps class="q-mr-sm">
            {{ t("logStream.cancel") }}
          </q-btn>
          <q-btn
            v-close-popup="true"
            unelevated
            no-caps
            class="no-border"
            color="primary"
            @click="deleteStream"
          >
            {{ t("logStream.ok") }}
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-dialog v-model="confirmBatchDelete">
      <q-card style="width: 420px">
        <q-card-section class="confirmBodyLogStream">
          <div class="head">{{ t("logStream.confirmBatchDeleteHead") }}</div>
          <div class="para">{{ t("logStream.confirmBatchDeleteMsg") }}</div>
        </q-card-section>
        <div class="tw:w-full tw:flex tw:justify-center tw:items-center tw:text-sm tw:text-gray-500">
            <q-checkbox class="checkbox-delete-associated-alerts-pipelines" v-model="deleteAssociatedAlertsPipelines" />
          <span class="delete-associated-alerts-pipelines-text">
            Delete all pipelines and alerts associated with the selected streams
          </span>
          </div>
        <q-card-actions class="confirmActionsLogStream">
          <q-btn v-close-popup="true" unelevated no-caps class="q-mr-sm">
            {{ t("logStream.cancel") }}
          </q-btn>
          <q-btn
            v-close-popup="true"
            unelevated
            no-caps
            class="no-border"
            color="primary"
            @click="deleteBatchStream"
          >
            {{ t("logStream.ok") }}
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  onActivated,
  onBeforeMount,
  type Ref,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "../components/shared/grid/Pagination.vue";
import streamService from "../services/stream";
import SchemaIndex from "../components/logstream/schema.vue";
import NoData from "../components/shared/grid/NoData.vue";
import segment from "../services/segment_analytics";
import {
  getImageURL,
  verifyOrganizationStatus,
  formatSizeFromMB,
} from "../utils/zincutils";
import config from "@/aws-exports";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { cloneDeep } from "lodash-es";
import useStreams from "@/composables/useStreams";
import AddStream from "@/components/logstream/AddStream.vue";
import { watch } from "vue";
import AppTabs from "@/components/common/AppTabs.vue";
import { useReo } from "@/services/reodotdev_analytics";
export default defineComponent({
  name: "PageLogStream",
  components: { QTablePagination, SchemaIndex, NoData, AddStream, AppTabs, },
  emits: ["update:changeRecordPerPage", "update:maxRecordToReturn"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const router = useRouter();
    const logStream: Ref<any[]> = ref([]);
    const showIndexSchemaDialog = ref(false);
    const isDeleting = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmBatchDelete = ref<boolean>(false);
    const schemaData = ref({ name: "", schema: [Object], stream_type: "" });
    const resultTotal = ref<number>(0);
    const selected = ref<any>([]);
    const orgData: any = ref(store.state.selectedOrganization);
    const qTable: any = ref(null);
    const previousOrgIdentifier = ref("");
    const filterQuery = ref("");
    const duplicateStreamList: Ref<any[]> = ref([]);
    const selectedStreamType = ref("logs");
    const loadingState = ref(true);
    const searchKeyword = ref("");
    const deleteAssociatedAlertsPipelines = ref(true);
    const streamActiveTab = ref("logs");
    const { track } = useReo();

    const perPageOptions: any = [20, 50, 100, 250, 500];
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const pagination = ref({
      sortBy: "name",
      descending: false,
      page: 1,
      rowsPerPage: 20,
      rowsNumber: 0,
    });
    const sortField = ref("name");
    const sortAsc = ref(true);

    const offset =
      (pagination.value.page - 1) * pagination.value.rowsPerPage < 0
        ? 0
        : (pagination.value.page - 1) * pagination.value.rowsPerPage;

    const pageOffset = ref(offset);

    const pageRecordsPerPage = ref(pagination.value.rowsPerPage);

    const streamTabs = [
      { label: t("logStream.labelLogs"), value: "logs" },
      { label: t("logStream.labelMetrics"), value: "metrics" },
      { label: t("logStream.labelTraces"), value: "traces" },
      { label: t("logStream.labelMetadata"), value: "metadata" },
    ];
    const {
      getStreams,
      resetStreams,
      removeStream,
      getStream,
      getPaginatedStreams,
      addNewStreams,
    } = useStreams();
    const columns = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
      },
      {
        name: "name",
        field: "name",
        label: t("logStream.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "stream_type",
        field: "stream_type",
        label: t("logStream.type"),
        align: "left",
        sortable: false,
      },
      {
        name: "doc_num",
        field: (row: any) => row.doc_num.toLocaleString(),
        label: t("logStream.docNum"),
        align: "left",
        sortable: true,
        sort: (a, b, rowA, rowB) => {
          return parseInt(rowA.doc_num) - parseInt(rowB.doc_num);
        },
      },
      {
        name: "storage_size",
        label: t("logStream.storageSize"),
        field: (row: any) => formatSizeFromMB(row.storage_size),
        align: "left",
        sortable: true,
        sort: (a, b, rowA, rowB) => {
          return parseInt(rowA.storage_size) - parseInt(rowB.storage_size);
        },
      },
      {
        name: "compressed_size",
        field: (row: any) => formatSizeFromMB(row.compressed_size),
        label: t("logStream.compressedSize"),
        align: "left",
        sortable: true,
        sort: (a, b, rowA, rowB) =>
          parseInt(rowA.compressed_size) - parseInt(rowB.compressed_size),
      },
      {
        name: "index_size",
        field: (row: any) => formatSizeFromMB(row.index_size),
        label: t("logStream.indexSize"),
        align: "left",
        sortable: true,
        sort: (a, b, rowA, rowB) =>
          parseInt(rowA.index_size) - parseInt(rowB.index_size),
      },
      {
        name: "actions",
        field: "actions",
        label: t("user.actions"),
        align: "center",
        classes: "actions-column",
      },
    ]);

    if (config.isCloud == "true") {
      columns.value?.splice(5, 1);
    }

    const addStreamDialog = ref({
      show: false,
      data: {
        name: "",
        stream_type: "",
        index_type: "",
        retention_period: 14,
      },
    });

    let deleteStreamName = "";
    let deleteStreamType = "";

    onBeforeMount(() => {
      if (columns.value && !store.state.zoConfig.show_stream_stats_doc_num) {
        columns.value = columns.value.filter(
          (column) => column.name !== "doc_num",
        );
      }

      if (router.currentRoute.value.name === "streamExplorer") {
        router.push({
          name: "streamExplorer",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const isSchemaUDSEnabled = computed(() => {
      return store.state.zoConfig.user_defined_schemas_enabled;
    });

    // As filter data don't gets called when search input is cleared.
    // So calling onChangeStreamFilter to filter again
    // watch(
    //   () => filterQuery.value,
    //   (value) => {
    //     if (!value) {
    //       onChangeStreamFilter(selectedStreamType.value);
    //     }
    //   },
    // );

    const getLogStream = (refresh: boolean = false) => {
      if (store.state.selectedOrganization != null) {
        loadingState.value = true;
        previousOrgIdentifier.value =
          store.state.selectedOrganization.identifier;
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait while loading streams...",
        });
        logStream.value = [];

        let counter = 1 + pageOffset.value;
        let streamResponse;
        // if(selectedStreamType.value == "all") {
        //   streamResponse = getStreams(selectedStreamType.value || "", false, false);
        // } else {
        streamResponse = getPaginatedStreams(
          selectedStreamType.value || "",
          false,
          false,
          pageOffset.value,
          pageRecordsPerPage.value,
          filterQuery.value,
          sortField.value,
          sortAsc.value,
        );
        // }

        streamResponse
          .then((res: any) => {
            logStream.value = [];
            let doc_num = "";
            let storage_size = "";
            let compressed_size = "";
            let index_size = "";
            resultTotal.value = res.list.length;
            pagination.value.rowsNumber = res.total;

            logStream.value.push(
              ...res.list.map((data: any) => {
                doc_num = "--";
                storage_size = "--";
                if (data.stats) {
                  doc_num = data.stats.doc_num;
                  storage_size = data.stats.storage_size + " MB";
                  compressed_size = data.stats.compressed_size + " MB";
                  index_size = data.stats.index_size + " MB";
                }
                return {
                  "#": counter <= 9 ? `0${counter++}` : counter++,
                  name: data.name,
                  doc_num: doc_num,
                  storage_size: storage_size,
                  compressed_size: compressed_size,
                  index_size: index_size,
                  storage_type: data.storage_type,
                  actions: "action buttons",
                  schema: data.schema ? data.schema : [],
                  stream_type: data.stream_type,
                };
              }),
            );
            duplicateStreamList.value = [...logStream.value];

            logStream.value.forEach((element: any) => {
              if (element.name == router.currentRoute.value.query.dialog) {
                listSchema({ row: element });
              }
            });
            loadingState.value = false;

            addNewStreams(selectedStreamType.value, res.list);

            dismiss();
          })
          .catch((err) => {
            if (err.response?.status != 403) {
              $q.notify({
                type: "negative",
                message:
                  err.response?.data?.message ||
                  "Error while fetching streams.",
                timeout: 2000,
              });
            }
            loadingState.value = false;
            dismiss();
          })
          .finally(() => {
            loadingState.value = false;
            dismiss();
          });
      }

      segment.track("Button Click", {
        button: "Refresh Streams",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Streams",
      });
    };

    getLogStream();

    const listSchema = (props: any) => {
      schemaData.value.name = props.row.name;
      schemaData.value.schema = props.row.schema;
      schemaData.value.stream_type = props.row.stream_type;
      showIndexSchemaDialog.value = true;

      segment.track("Button Click", {
        button: "Actions",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        stream_name: props.row.name,
        page: "Streams",
      });
    };

    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
    };

    const confirmDeleteAction = (props: any) => {
      confirmDelete.value = true;
      deleteStreamName = props.row.name;
      deleteStreamType = props.row.stream_type;
    };
    const confirmBatchDeleteAction = () => {
      confirmBatchDelete.value = true;
    };

    const deleteStream = () => {
      streamService
        .delete(
          store.state.selectedOrganization.identifier,
          deleteStreamName,
          deleteStreamType,
          deleteAssociatedAlertsPipelines.value
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              color: "positive",
              message: "Stream deleted successfully.",
            });
            removeStream(deleteStreamName, deleteStreamType);
            selected.value = [];
            getLogStream();
          }
        })
        .catch((err: any) => {
          if (err.response.status != 403) {
            $q.notify({
              color: "negative",
              message: "Error while deleting stream.",
            });
          }
        })
        .finally(() => {
          deleteAssociatedAlertsPipelines.value = true;
        });
    };
    const deleteBatchStream = () => {
      isDeleting.value = true;
      const selectedItems = selected.value;
      const promises: Promise<any>[] = [];

      selectedItems.forEach((stream: any) => {
        promises.push(
          streamService.delete(
            store.state.selectedOrganization.identifier,
            stream.name,
            stream.stream_type,
            deleteAssociatedAlertsPipelines.value
          ),
        );
      });

      Promise.all(promises)
        .then((responses) => {
          const successfulDeletions = responses.filter(
            (res) => res.data.code === 200,
          );
          const failedDeletions = responses.filter(
            (res) => res.data.code !== 200,
          );

          if (successfulDeletions.length > 0) {
            $q.notify({
              color: "positive",
              message: `Deleted ${successfulDeletions.length} streams successfully.`,
            });
          }

          if (failedDeletions.length > 0) {
            $q.notify({
              color: "negative",
              message: `Failed to delete ${failedDeletions.length} streams.`,
            });
          }

          // Remove deleted streams from the list
          selectedItems.forEach((stream: any) => {
            removeStream(stream.name, stream.stream_type);
            selected.value = selected.value.filter(
              (item: any) =>
                item.name !== stream.name &&
                item.stream_type !== stream.stream_type,
            );
          });

          getLogStream();
        })
        .catch((error) => {
          if (error.response.status != 403) {
            $q.notify({
              color: "negative",
              message:
                error.response?.data?.message ||
                "Error while deleting streams.",
            });
          }
        })
        .finally(() => {
          deleteAssociatedAlertsPipelines.value = true;
          isDeleting.value = false;
        });
    };

    onActivated(() => {
      if (logStream.value.length > 0) {
        logStream.value.forEach((element: any) => {
          if (element.name == router.currentRoute.value.query.dialog) {
            listSchema({ row: element });
          }
        });
      }

      if (
        previousOrgIdentifier.value !=
        store.state.selectedOrganization.identifier
      ) {
        getLogStream();
      }
    });
    const getSelectedString = () => {
      return selected.value.length === 0
        ? ""
        : `${selected.value.length} record${
            selected.value.length > 1 ? "s" : ""
          } selected`;
    };

    /**
     * Get time range for stream explorer, for enrichment tables it will get the time range from the stream data min and max time
     * @param stream: Stream object
     */
    const getTimeRange = async (stream: any) => {
      const dateTime: { period?: string; from?: number; to?: number } = {};

      if (stream.stream_type === "enrichment_tables") {
        const dismiss = $q.notify({
          spinner: true,
          message: "Redirecting to explorer...",
          color: "secondary",
        });

        await getStream(stream.name, stream.stream_type, true)
          .then((streamResponse) => {
            if (
              streamResponse.stats.doc_time_min &&
              streamResponse.stats.doc_time_max
            ) {
              dateTime["from"] = streamResponse.stats.doc_time_min - 60000000;
              dateTime["to"] = streamResponse.stats.doc_time_max + 60000000;
            } else if (streamResponse.stats.created_at) {
              // When enrichment table is uploaded, stats will not have doc_time_min and doc_time_max.
              // Stats will be available asynchronously, so we can use created_at time to get the time range.
              dateTime["from"] = streamResponse.stats.created_at - 60000000;
              dateTime["to"] = streamResponse.stats.created_at + 3600000000;
            } else {
              dateTime["period"] = "15m";
            }
          })
          .catch((err) => {
            dateTime["period"] = "15m";
          })
          .finally(() => {
            dismiss();
          });
      } else {
        dateTime["period"] = "15m";
      }

      return dateTime;
    };

    const exploreStream = async (props: any) => {
      store.dispatch("logs/setIsInitialized", false);

      // We need to check if stream is present in store, if not then we need to fetch the stream

      const dateTime = await getTimeRange(props.row);
      router.push({
        name: "logs",
        query: {
          stream_type: props.row.stream_type,
          stream: props.row.name,
          refresh: "0",
          query: "",
          type: "stream_explorer",
          quick_mode: store.state.zoConfig.quick_mode_enabled ? "true" : "false",
          org_identifier: store.state.selectedOrganization.identifier,
          ...dateTime,
        },
      });
    };

    const filterData = (rows: any, terms: any) => {
      var filtered = [];
      terms = terms.toLowerCase();

      for (var i = 0; i < duplicateStreamList.value.length; i++) {
        if (
          (selectedStreamType.value ===
            duplicateStreamList.value[i]["stream_type"] ||
            selectedStreamType.value === "all") &&
          (duplicateStreamList.value[i]["name"].toLowerCase().includes(terms) ||
            duplicateStreamList.value[i]["stream_type"]
              .toLowerCase()
              .includes(terms))
        ) {
          filtered.push(duplicateStreamList.value[i]);
        }
      }
      return filtered;
    };

    const onChangeStreamFilter = (value: string) => {
      selectedStreamType.value = value;
      getLogStream(true);
      // logStream.value = filterData(
      //   duplicateStreamList.value,
      //   filterQuery.value.toLowerCase(),
      // );
      // resultTotal.value = logStream.value.length;
    };

    const addStream = () => {
      addStreamDialog.value.show = true;
      track("Button Click", {
        button: "Add Stream",
        pageTitle: "Stream Explorer",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Streams",
      });
      // router.push({
      //   name: "addStream",
      //   query: {
      //     org_identifier: store.state.selectedOrganization.identifier,
      //   },
      // });
    };

    const getRowKey = (row: any) => {
      return `${row.name}-${row.stream_type}`; // Unique key by combining `name` and `stream_type`
    };

    const onRequest = async (props: any) => {
      const { page, rowsPerPage, sortBy, descending } = props.pagination;
      const filter = props.filter;

      if (sortBy != null) {
        sortField.value = sortBy;
        sortAsc.value = !descending;
      } else {
        sortField.value = "name";
        sortAsc.value = true;
      }

      pageOffset.value =
        (page - 1) * rowsPerPage < 0 ? 0 : (page - 1) * rowsPerPage;
      pageRecordsPerPage.value = rowsPerPage;

      loadingState.value = true;

      await getLogStream();

      // don't forget to update local pagination object
      pagination.value.page = page;
      pagination.value.rowsPerPage = rowsPerPage;
      pagination.value.sortBy = sortBy;
      pagination.value.descending = descending;

      // ...and turn of loading indicator
      loadingState.value = false;
    };

    const filterLogStreamByTab = (tab: string) => {
      streamActiveTab.value = tab;
      onChangeStreamFilter(tab);
    };
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.hasOwnProperty("value") ? val.value : val;
      pagination.value.rowsPerPage = val.hasOwnProperty("value") ? val.value : val;
      pagination.value.page = 1; // Reset to first page when changing records per page
      qTable.value?.requestServerInteraction({
        pagination: pagination.value
      });
    };

    return {
      t,
      qTable,
      router,
      store,
      logStream: logStream,
      columns,
      selected,
      orgData,
      getLogStream: getLogStream,
      pagination,
      resultTotal,
      listSchema,
      deleteStream,
      deleteBatchStream,
      confirmDeleteAction,
      confirmBatchDeleteAction,
      confirmDelete,
      confirmBatchDelete,
      schemaData,
      perPageOptions,
      selectedPerPage,
      maxRecordToReturn,
      showIndexSchemaDialog,
      changeMaxRecordToReturn,
      outlinedDelete,
      isSchemaUDSEnabled,
      filterQuery,
      filterData,
      getImageURL,
      verifyOrganizationStatus,
      exploreStream,
      selectedStreamType,
      streamTabs,
      onChangeStreamFilter,
      addStreamDialog,
      addStream,
      loadingState,
      getSelectedString,
      isDeleting,
      getRowKey,
      searchKeyword,
      onRequest,
      deleteAssociatedAlertsPipelines,
      filterLogStreamByTab,
      streamActiveTab,
      changePagination,
    };
  },
});
</script>

<style lang="scss" scoped>
</style>

<style lang="scss">

.bottom-bar {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
}
.delete-btn {
  width: 10vw;
}

.confirmBodyLogStream {
  padding: 22px 1.375rem 0;
  font-size: 0.875rem;
  text-align: center;
  font-weight: 700;

  .head {
    line-height: 2.15em;
    margin-bottom: 4px;
  }

  .para {
    color: $light-text;
  }
}

.delete-associated-alerts-pipelines-text{
  color: $light-text;
  font-size: 12px;
  font-weight: 500;
}

.confirmActionsLogStream {
  justify-content: center;
  padding: 16px 22px 22px;
  display: flex;

  .q-btn {
    font-size: 0.75rem;
    font-weight: 700;
  }
}
.checkbox-delete-associated-alerts-pipelines{
  .q-checkbox__inner{
    height: 28px !important;
    min-height: 28px !important;
    width: 28px !important;
    min-width: 28px !important;
  }
  .q-checkbox__bg{
    height: 16px !important;
    width: 16px !important;
  }
}
</style>
