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
          <div class="flex justify-between full-width tw:py-3 tw:px-4 items-center tw:h-[68px]">
            <div class="q-table__title tw:font-[600]" data-test="enrichment-tables-list-title">
              {{ t("function.enrichmentTables") }}
            </div>
            <div class="tw:flex tw:items-center q-ml-auto">
              <div class="app-tabs-container tw:h-[36px] q-mr-sm">
                <app-tabs
                  data-test="enrichment-tables-list-tabs"
                  class="tabs-selection-container"
                  :tabs="filterTabs"
                  v-model:active-tab="selectedFilter"
                  @update:active-tab="updateActiveTab"
                />
              </div>

              <q-input
                data-test="enrichment-tables-search-input"
                v-model="filterQuery"
                borderless
                dense
                flat
                class="no-border o2-search-input"
                :placeholder="t('function.searchEnrichmentTable')"
              >
                <template #prepend>
                  <q-icon class="o2-search-input-icon" name="search" />
                </template>
              </q-input>
              <q-btn
                class="q-ml-sm o2-primary-button tw:h-[36px]"
                flat
                no-caps
                :label="t(`function.addEnrichmentTable`)"
                @click="showAddUpdateFn({})"
              />
            </div>
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
              style="width: 100%"
              :style="hasVisibleRows
                  ? 'width: 100%; height: calc(100vh - 127px)'
                  : 'width: 100%'"
              class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky "
              selection="multiple"
              v-model:selected="selectedEnrichmentTables"
            >
              <template #no-data>
                <NoData />
              </template>
              <template v-slot:body-selection="scope">
                <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
              </template>
              <template v-slot:body-cell-type="props">
                <q-td :props="props">
                  <div class="tw:flex tw:items-center tw:gap-2">
                    <span v-if="!props.row.urlJobs || props.row.urlJobs.length === 0">File</span>
                    <template v-else>
                      <span
                        class="cursor-pointer"
                        @click="showUrlJobsDialog(props.row)"
                        :class="{'text-primary': props.row.urlJobs.length > 1}"
                      >
                        Url
                        <span v-if="props.row.urlJobs.length > 1" class="text-grey-7"> ({{ props.row.urlJobs.length }})</span>
                      </span>
                      <q-icon
                        v-if="props.row.aggregateStatus === 'completed'"
                        name="check_circle"
                        color="positive"
                        size="18px"
                      >
                        <q-tooltip>
                          <div style="max-width: 300px;">
                            <strong>Status: All Completed</strong><br/>
                            {{ props.row.urlJobs.length }} URL job(s) completed<br/>
                            <br/>
                            <em style="font-size: 0.85em;">Click "Url" to see details</em>
                          </div>
                        </q-tooltip>
                      </q-icon>
                      <q-icon
                        v-else-if="props.row.aggregateStatus === 'processing'"
                        name="sync"
                        color="primary"
                        size="18px"
                        class="rotate-animation"
                      >
                        <q-tooltip>
                          <div style="max-width: 300px;">
                            <strong>Status: Processing</strong><br/>
                            One or more jobs are currently processing<br/>
                            <br/>
                            <em style="font-size: 0.85em;">Note: Progress is not real-time. Refresh to see latest updates.<br/>Click "Url" for details</em>
                          </div>
                        </q-tooltip>
                      </q-icon>
                      <q-icon
                        v-else-if="props.row.aggregateStatus === 'failed'"
                        name="warning"
                        color="negative"
                        size="18px"
                        class="cursor-pointer"
                        @click="showUrlJobsDialog(props.row)"
                      >
                        <q-tooltip>
                          <div style="max-width: 350px;">
                            <strong>Status: Failed</strong><br/>
                            One or more jobs have failed<br/>
                            <br/>
                            Click to see details and retry failed jobs
                          </div>
                        </q-tooltip>
                      </q-icon>
                      <q-icon
                        v-else-if="props.row.aggregateStatus === 'pending'"
                        name="schedule"
                        color="grey-7"
                        size="18px"
                      >
                        <q-tooltip>
                          <div style="max-width: 300px;">
                            <strong>Status: Pending</strong><br/>
                            Job(s) waiting to be processed<br/>
                            <br/>
                            <em style="font-size: 0.85em;">Click "Url" for details</em>
                          </div>
                        </q-tooltip>
                      </q-icon>
                    </template>
                  </div>
                </q-td>
              </template>
              <template v-slot:body-cell-actions="props">
                <q-td :props="props">
                  <!-- Search button - show for uploaded tables or completed URL jobs -->
                  <q-btn
                    v-if="!props.row.urlJobs || props.row.urlJobs.length === 0 || props.row.aggregateStatus === 'completed'"
                    :data-test="`${props.row.name}-explore-btn`"
                    :title="t('logStream.explore')"
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    @click="exploreEnrichmentTable(props)"
                    icon="search"
                  />

                  <!-- Schema Settings button - show for uploaded tables or completed URL jobs -->
                  <q-btn
                    v-if="!props.row.urlJobs || props.row.urlJobs.length === 0 || props.row.aggregateStatus === 'completed'"
                    icon="list_alt"
                    :title="t('logStream.schemaHeader')"
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    @click="listSchema(props)"
                  />

                  <!-- Edit button - show for uploaded tables, completed URL jobs, or failed URL jobs (to add more URLs) -->
                  <q-btn
                    v-if="!props.row.urlJobs || props.row.urlJobs.length === 0 || props.row.aggregateStatus === 'completed' || props.row.aggregateStatus === 'failed'"
                    padding="sm"
                    unelevated
                    size="sm"
                    icon="edit"
                    round
                    flat
                    :title="t('function.enrichmentTables')"
                    @click="showAddUpdateFn(props)"
                  />

                  <!-- Delete button - always visible -->
                  <q-btn
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    :icon="outlinedDelete"
                    flat
                    :title="t('function.delete')"
                    @click="showDeleteDialogFn(props)"
                  />
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

              <template #bottom="scope">
                <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
                  <div class="tw:flex tw:items-center tw:gap-2">
                    <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-md">
                      {{ resultTotal }} {{ t('function.enrichmentTables') }}
                    </div>
                    <q-btn
                      v-if="selectedEnrichmentTables.length > 0"
                      data-test="enrichment-tables-bulk-delete-btn"
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
    </div>
    <div v-else>
      <add-enrichment-table
        v-model="formData"
        :isUpdating="isUpdated"
        @update:list="refreshList"
        @cancel:hideform="hideForm"
      />
    </div>
    <ConfirmDialog
      title="Delete Enrichment Table"
      message="Are you sure you want to delete enrichment table?"
      @update:ok="deleteLookupTable"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
    <ConfirmDialog
      title="Bulk Delete Enrichment Tables"
      :message="`Are you sure you want to delete ${selectedEnrichmentTables.length} enrichment table(s)?`"
      @update:ok="bulkDeleteEnrichmentTables"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
    <q-dialog
      v-model="showEnrichmentSchema"
      position="right"
      full-height
      maximized
    >
      <EnrichmentSchema :selectedEnrichmentTable="selectedEnrichmentTable" />
    </q-dialog>

    <!-- URL Jobs Dialog -->
    <q-dialog
      v-model="showUrlJobsDialogState"
      position="right"
      full-height
      maximized
    >
      <q-card style="width: 600px; max-width: 80vw;">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">URL Jobs for {{ selectedTableForUrlJobs?.name }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div v-if="selectedTableForUrlJobs?.urlJobs && selectedTableForUrlJobs.urlJobs.length > 0">
            <q-list separator>
              <q-item v-for="(job, index) in selectedTableForUrlJobs.urlJobs" :key="job.id" class="q-pa-md">
                <q-item-section>
                  <q-item-label class="text-weight-bold">Job {{ index + 1 }}</q-item-label>
                  <q-item-label caption>{{ job.url }}</q-item-label>
                  <q-item-label caption class="q-mt-sm">
                    <q-badge :color="job.status === 'completed' ? 'positive' : job.status === 'failed' ? 'negative' : job.status === 'processing' ? 'primary' : 'grey'">
                      {{ job.status }}
                    </q-badge>
                  </q-item-label>
                  <q-item-label caption v-if="job.status === 'completed'" class="q-mt-sm">
                    Records: {{ job.total_records_processed?.toLocaleString() }}<br/>
                    Size: {{ job.total_bytes_fetched ? formatSizeFromMB(((job.total_bytes_fetched / 1024 / 1024).toFixed(2))) : '0 MB' }}
                  </q-item-label>
                  <q-item-label caption v-if="job.status === 'failed'" class="q-mt-sm text-negative">
                    Error: {{ job.error_message }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
          <div v-else class="text-center q-pa-md text-grey-7">
            No URL jobs found
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeMount, onMounted, ref, watch, reactive } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "../shared/grid/Pagination.vue";
import AddEnrichmentTable from "./AddEnrichmentTable.vue";
import NoData from "../shared/grid/NoData.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import AppTabs from "../common/AppTabs.vue";
import segment from "../../services/segment_analytics";
import {
  formatSizeFromMB,
  getImageURL,
  verifyOrganizationStatus,
} from "../../utils/zincutils";
import streamService from "@/services/stream";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import useStreams from "@/composables/useStreams";
import EnrichmentSchema from "./EnrichmentSchema.vue";
import { useReo } from "@/services/reodotdev_analytics";
import jsTransformService from "@/services/jstransform";

export default defineComponent({
  name: "EnrichmentTableList",
  components: {
    QTablePagination,
    AddEnrichmentTable,
    NoData,
    ConfirmDialog,
    EnrichmentSchema,
    AppTabs,
  },
  emits: [
    "updated:fields",
    "update:changeRecordPerPage",
    "update:maxRecordToReturn",
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
    const confirmBulkDelete = ref<boolean>(false);
    const selectedEnrichmentTables = ref<any[]>([]);
    const showEnrichmentSchema = ref<boolean>(false);
    const showUrlJobsDialogState = ref<boolean>(false);
    const selectedTableForUrlJobs = ref<any>(null);
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
        name: "type",
        field: (row: any) => (row.urlJobs && row.urlJobs.length > 0) ? "Url" : "File",
        label: "Type",
        align: "left",
        sortable: true,
        sort: (a: string, b: string) => a.localeCompare(b),
        style: "width: 150px",
      },
      {
        name: "doc_num",
        field: (row: any) => row.doc_num.toLocaleString(),
        label: t("logStream.docNum"),
        align: "left",
        sortable: true,
        sort: (_a, _b, rowA, rowB) => {
          return parseInt(rowA.doc_num) - parseInt(rowB.doc_num);
        },
        style: "width: 150px",
      },
      {
        name: "storage_size",
        label: t("logStream.storageSize"),
        field: (row: any) => formatSizeFromMB(row.storage_size),
        align: "left",
        sortable: true,
        sort: (_a, _b, rowA, rowB) => {
          return rowA.original_storage_size - rowB.original_storage_size;
        },
        style: "width: 150px",
      },
      {
        name: "compressed_size",
        field: (row: any) => formatSizeFromMB(row.compressed_size),
        label: t("logStream.compressedSize"),
        align: "left",
        sortable: false,
        sort: (_a, _b, rowA, rowB) =>
          rowA.original_compressed_size- rowB.original_compressed_size,
        style: "width: 150px",
      },

      {
        name: "actions",
        field: "actions",
        label: t("function.actions"),
        align: "center",
        sortable: false,
        classes: "actions-column",
      },
    ]);
    const { getStreams, resetStreamType, getStream } = useStreams();

    onBeforeMount(() => {
      getLookupTables();
    });
    //here we need to check if the action is there or not 
    //because if action is there user before refresh the page user was there in add / update page
    //so to maitain consistency we are checking the action and if action is there we are showing the add / update page
    //else we are showing the list of enrichment tables
    onMounted(()=>{
      //it is for showing empty add page when user refresh the page
      if(router.currentRoute.value.query.action === "add"){
        showAddUpdateFn({})
      }
      //it is for showing the update page when user refresh the page
      //we are passing the name of the enrichment table to the update page
      else if(router.currentRoute.value.query.action === "update"){
        showAddUpdateFn({
          row: {
            name: router.currentRoute.value.query.name,
          }
        })
      }
    })

    const getLookupTables = async (force: boolean = false) => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading enrichment tables...",
      });

      try {
        // Fetch both streams and URL job statuses in parallel
        const [streamsRes, statusRes] = await Promise.all([
          getStreams("enrichment_tables", false, false, force),
          jsTransformService.get_all_enrichment_table_statuses(
            store.state.selectedOrganization.identifier
          ).catch((err: any) => {
            // If status API fails, continue with empty status map
            console.warn("Error fetching URL statuses:", err);
            return { data: {} };
          })
        ]);

        const res: any = streamsRes;
        const urlJobMap = statusRes.data || {};

        // Create a map of stream names from the streams list
        const streamMap = new Map();
        res.list.forEach((stream: any) => {
          streamMap.set(stream.name, stream);
        });

        // Combine streams with URL jobs (now arrays)
        const allTables = new Map();
        let counter = 1;

        // Helper function to compute aggregate status from URL jobs array
        const computeAggregateStatus = (urlJobs: any[]) => {
          if (!urlJobs || urlJobs.length === 0) return null;

          // If any job is failed, aggregate status is failed
          if (urlJobs.some((job: any) => job.status === 'failed')) return 'failed';

          // If any job is processing, aggregate status is processing
          if (urlJobs.some((job: any) => job.status === 'processing')) return 'processing';

          // If any job is pending, aggregate status is pending
          if (urlJobs.some((job: any) => job.status === 'pending')) return 'pending';

          // If all jobs are completed, aggregate status is completed
          if (urlJobs.every((job: any) => job.status === 'completed')) return 'completed';

          return 'pending';
        };

        // Add all streams
        res.list.forEach((data: any) => {
          let doc_num = "";
          let storage_size = "";
          let compressed_size = "";
          let original_storage_size = "";
          let original_compressed_size = "";

          if (data.stats) {
            doc_num = data.stats.doc_num;
            storage_size = data.stats.storage_size + " MB";
            compressed_size = data.stats.compressed_size + " MB";
            original_storage_size = data.stats.storage_size;
            original_compressed_size = data.stats.compressed_size;
          }

          const urlJobs = urlJobMap[data.name] || [];

          allTables.set(data.name, {
            "#": counter <= 9 ? `0${counter++}` : counter++,
            id: data.name + counter,
            name: data.name,
            doc_num: doc_num,
            storage_size: storage_size,
            compressed_size: compressed_size,
            original_storage_size: original_storage_size,
            original_compressed_size: original_compressed_size,
            actions: "action buttons",
            stream_type: data.stream_type,
            urlJobs: urlJobs,
            aggregateStatus: computeAggregateStatus(urlJobs),
          });
        });

        // Add URL jobs that don't have schemas yet (pending/processing)
        Object.entries(urlJobMap).forEach(([tableName, urlJobs]: [string, any]) => {
          if (!allTables.has(tableName)) {
            // This is a URL job without a schema yet
            allTables.set(tableName, {
              "#": counter <= 9 ? `0${counter++}` : counter++,
              id: tableName + counter,
              name: tableName,
              doc_num: "",
              storage_size: "",
              compressed_size: "",
              original_storage_size: "",
              original_compressed_size: "",
              actions: "action buttons",
              stream_type: "enrichment_tables",
              urlJobs: urlJobs,
              aggregateStatus: computeAggregateStatus(urlJobs),
            });
          }
        });

        jsTransforms.value = Array.from(allTables.values());
        resultTotal.value = jsTransforms.value.length;
        dismiss();
      } catch (err: any) {
        console.info("Error while fetching enrichment tables", err);
        dismiss();
        if (err.response?.status != 403) {
          $q.notify({
            type: "negative",
            message:
              err.response?.data?.message ||
              "Error while fetching functions.",
            timeout: 2000,
          });
        }
      }
    };

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
    const selectedEnrichmentTable = ref<any>(null);
    const selectedFilter = ref<string>("all");

    const filterTabs = reactive([
      {
        label: t("function.filterAll"),
        value: "all",
      },
      {
        label: t("function.filterFile"),
        value: "uploaded",
      },
      {
        label: t("function.filterUrl"),
        value: "file_url",
      },
    ]);

    const pagination: any = ref({
      rowsPerPage: 20,
    });
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };

    const updateActiveTab = () => {
      // Filter tabs are handled in the computed visibleRows
      // This function is just for consistency with PipelinesList structure
    };

    const addLookupTable = () => {
      showAddJSTransformDialog.value = true;
    };

    const showAddUpdateFn = (props: any) => {
      formData.value = props.row;
      let action;
      if (!props.row) {
        isUpdated.value = false;
        action = "Add Enrichment Table";
        router.push({
          name: "enrichmentTables",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        track("Button Click", {
          button: "Add Enrichment Table",
          page: "Functions"
        });
      } else {
        isUpdated.value = true;
        action = "Update Enrichment Table";
        router.push({
          name: "enrichmentTables",
          query: {
            action: "update",
            name: props.row.name,
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        track("Button Click", {
          button: "Update Enrichment Table",
          page: "Functions"
        });
      }
      addLookupTable();

      segment.track("Button Click", {
        button: action,
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Functions",
      });
    };

    const refreshList = () => {
      router.push({
        name: "enrichmentTables",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      showAddJSTransformDialog.value = false;
      resetStreamType("enrichment_tables");
      getLookupTables(true);
    };

    const hideForm = () => {
      showAddJSTransformDialog.value = false;
      router.replace({
        name: "enrichmentTables",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const deleteLookupTable = () => {
      streamService
        .delete(
          store.state.selectedOrganization.identifier,
          selectedDelete.value.name,
          "enrichment_tables",
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              color: "positive",
              message: `${selectedDelete.value.name} deleted successfully.`,
            });
            resetStreamType("enrichment_tables");
            getLookupTables(true);
          }
        })
        .catch((err: any) => {
          if (err.response.status != 403) {
            $q.notify({
              color: "negative",
              message:
                err.response?.data?.message || "Error while deleting stream.",
            });
          }
        });

      segment.track("Button Click", {
        button: "Delete Enrichment Table",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        function_name: selectedDelete.value.name,
        is_ingest_func: selectedDelete.value.ingest,
        page: "Functions",
      });
    };

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteEnrichmentTables = () => {
      const selectedItems = selectedEnrichmentTables.value;
      const promises: Promise<any>[] = [];

      selectedItems.forEach((table: any) => {
        promises.push(
          streamService.delete(
            store.state.selectedOrganization.identifier,
            table.name,
            "enrichment_tables",
          ),
        );
      });

      Promise.allSettled(promises)
        .then((results) => {
          let successfulDeletions = 0;
          let failedDeletions = 0;

          results.forEach((result) => {
            if (result.status === 'fulfilled') {
              // Check if the response indicates success
              if (result.value?.data?.code === 200) {
                successfulDeletions++;
              } else {
                failedDeletions++;
              }
            } else {
              // Handle rejected promises (errors)
              const error = result.reason;
              // Don't count 403 errors as failures (silent)
              if (error?.response?.status !== 403 && error?.status !== 403) {
                failedDeletions++;
              }
            }
          });

          if (successfulDeletions > 0 && failedDeletions === 0) {
            $q.notify({
              color: "positive",
              message: `Successfully deleted ${successfulDeletions} enrichment table(s).`,
            });
          } else if (successfulDeletions > 0 && failedDeletions > 0) {
            $q.notify({
              color: "warning",
              message: `Deleted ${successfulDeletions} enrichment table(s). Failed to delete ${failedDeletions} enrichment table(s).`,
            });
          } else if (failedDeletions > 0) {
            $q.notify({
              color: "negative",
              message: `Failed to delete ${failedDeletions} enrichment table(s).`,
            });
          }

          resetStreamType("enrichment_tables");
          getLookupTables(true);
          selectedEnrichmentTables.value = [];
          confirmBulkDelete.value = false;
        });
    };

    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDelete.value = true;
    };

    /**
     * Get time range for stream explorer, for enrichment tables it will get the time range from the stream data min and max time
     * @param stream: Stream object
     */
    const getTimeRange = async (stream: any) => {
      const dateTime: { period?: string; from?: number; to?: number } = {};

      const dismiss = $q.notify({
        spinner: true,
        message: "Redirecting to explorer...",
        color: "secondary",
      });

      try {
        await getStream(stream.name, stream.stream_type, true)
          .then((streamResponse) => {
            if (
              streamResponse.stats.doc_time_min &&
              streamResponse.stats.doc_time_max
            ) {
              //reducing the doc_time_min by 1000000 to get the exact time range
              //previously we were subtracting 60000000 which might confuse some users so we are using 1000000 (1sec)
              dateTime["from"] = streamResponse.stats.doc_time_min - 1000000;
              //adding 60000000(1min)
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
            console.error("Error while getting enrichment table: ", err);
            dateTime["period"] = "15m";
          })
          .finally(() => {
            dismiss();
          });
      } catch (err) {
        console.error("Error while getting enrichment table: ", err);
        dateTime["period"] = "15m";
        dismiss();
      }

      return dateTime;
    };

    const exploreEnrichmentTable = async (props: any) => {
      store.dispatch("logs/setIsInitialized", false);
      const timestamps = await getTimeRange(props.row);
      router.push({
        name: "logs",
        query: {
          stream_type: props.row.stream_type,
          stream: props.row.name,
          refresh: "0",
          query: "",
          type: "stream_explorer",
          org_identifier: store.state.selectedOrganization.identifier,
          ...timestamps,
        },
      });
    };
    const listSchema = async (props: any) => {
      selectedEnrichmentTable.value = props.row.name;
      showEnrichmentSchema.value = true;
    };

    const showUrlJobsDialog = (row: any) => {
      selectedTableForUrlJobs.value = row;
      showUrlJobsDialogState.value = true;
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
      let rows = jsTransforms.value || [];

      // Apply type filter
      if (selectedFilter.value === 'uploaded') {
        rows = rows.filter((row: any) => !row.urlJobs || row.urlJobs.length === 0);
      } else if (selectedFilter.value === 'file_url') {
        rows = rows.filter((row: any) => row.urlJobs && row.urlJobs.length > 0);
      }

      // Apply search filter
      if (!filterQuery.value) return rows;
      return filterData(rows, filterQuery.value);
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
      jsTransforms,
      columns,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      getLookupTables,
      pagination,
      resultTotal,
      refreshList,
      perPageOptions,
      selectedPerPage,
      addLookupTable,
      deleteLookupTable,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      changePagination,
      maxRecordToReturn,
      showAddJSTransformDialog,
      outlinedDelete,
      filterQuery,
      filterData,
      getImageURL,
      verifyOrganizationStatus,
      exploreEnrichmentTable,
      showEnrichmentSchema,
      listSchema,
      selectedEnrichmentTable,
      getTimeRange,
      visibleRows,
      hasVisibleRows,
      confirmBulkDelete,
      selectedEnrichmentTables,
      openBulkDeleteDialog,
      bulkDeleteEnrichmentTables,
      selectedFilter,
      showUrlJobsDialog,
      showUrlJobsDialogState,
      selectedTableForUrlJobs,
      formatSizeFromMB,
      filterTabs,
      updateActiveTab,
    };
  },
  computed: {
    selectedOrg() {
      return this.store.state.selectedOrganization.identifier;
    },
  },
  watch: {
    selectedOrg(newVal: any, oldVal: any) {
      this.verifyOrganizationStatus(
        this.store.state.organizations,
        this.router,
      );
      if (
        (newVal != oldVal || this.jsTransforms.value == undefined) &&
        this.router.currentRoute.value.name == "pipeline"
      ) {
        this.resultTotal = 0;
        this.jsTransforms = [];
        this.getLookupTables(true);
      }
    },
  },
});
</script>

<style lang="scss">

.search-en-table-input {
  .q-field__inner {
    width: 250px;
  }
}

.rotate-animation {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* No custom styles needed - using Quasar components */
</style>
