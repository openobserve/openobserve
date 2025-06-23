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
  <q-page class="q-pa-none" style="min-height: inherit">
    <div v-if="!showAddJSTransformDialog">
      <div :class="store.state.theme === 'dark' ? 'o2-table-header-dark' : 'o2-table-header-light'"
      class="tw-flex tw-items-center tw-justify-between tw-py-3 tw-px-4"
      >
        <div class="q-table__title">
            {{ t("function.enrichmentTables") }}
          </div>
          <div class="q-ml-auto" data-test="enrichment-tables-search-input">
            <q-input
              v-model="filterQuery"
              borderless
              filled
              dense
              class="q-ml-auto no-border search-en-table-input"
              :placeholder="t('function.searchEnrichmentTable')"
            >
              <template #prepend>
                <q-icon name="search" class="cursor-pointer" />
              </template>
            </q-input>
          </div>
          <q-btn
            class="q-ml-md text-bold no-border"
            padding="sm lg"
            color="secondary"
            no-caps
            :label="t(`function.addEnrichmentTable`)"
            @click="showAddUpdateFn({})"
          />
      </div>
      <q-table
        ref="qTable"
        :rows="jsTransforms"
        :columns="columns"
        row-key="id"
        :pagination="pagination"
        :filter="filterQuery"
        :filter-method="filterData"
        style="width: 100%"
        :class="store.state.theme === 'dark' ? 'o2-quasar-table-dark' : 'o2-quasar-table-light'"
        class="o2-quasar-table"
      >
        <template #no-data>
          <NoData />
        </template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              :data-test="`${props.row.name}-explore-btn`"
              icon="search"
              :title="t('logStream.explore')"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              @click="exploreEnrichmentTable(props)"
            />
            <q-btn
              icon="list_alt"
              :title="t('logStream.schemaHeader')"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              @click="listSchema(props)"
            />
            <q-btn
              icon="edit"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('function.enrichmentTables')"
              @click="showAddUpdateFn(props)"
            ></q-btn>
            <q-btn
              :icon="outlinedDelete"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('function.delete')"
              @click="showDeleteDialogFn(props)"
            ></q-btn>
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
        <template #top="scope">
          <QTablePagination
            :scope="scope"
            :pageTitle="t('function.enrichmentTables')"
            :position="'top'"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </template>

        <template #bottom="scope">
          <QTablePagination
            :scope="scope"
            :position="'bottom'"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </template>
      </q-table>
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
    <q-dialog
      v-model="showEnrichmentSchema"
      position="right"
      full-height
      maximized
    >
      <EnrichmentSchema :selectedEnrichmentTable="selectedEnrichmentTable" />
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, onBeforeMount, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "../shared/grid/Pagination.vue";
import AddEnrichmentTable from "./AddEnrichmentTable.vue";
import NoData from "../shared/grid/NoData.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
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

export default defineComponent({
  name: "EnrichmentTableList",
  components: {
    QTablePagination,
    AddEnrichmentTable,
    NoData,
    ConfirmDialog,
    EnrichmentSchema,
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
    const showEnrichmentSchema = ref<boolean>(false);
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
        label: t("function.name"),
        align: "left",
        sortable: true,
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
          return rowA.original_storage_size - rowB.original_storage_size;
        },
      },
      {
        name: "compressed_size",
        field: (row: any) => formatSizeFromMB(row.compressed_size),
        label: t("logStream.compressedSize"),
        align: "left",
        sortable: false,
        sort: (a, b, rowA, rowB) =>
          rowA.original_compressed_size - rowB.original_compressed_size,
      },
      {
        name: "actions",
        field: "actions",
        label: t("function.actions"),
        align: "center",
        sortable: false,
      },
    ]);
    const { getStreams, resetStreamType, getStream } = useStreams();

    onBeforeMount(() => {
      getLookupTables();
    });

    const getLookupTables = (force: boolean = false) => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading enrichment tables...",
      });

      getStreams("enrichment_tables", false, false, force)
        .then((res: any) => {
          let counter = 1;
          resultTotal.value = res.list.length;
          jsTransforms.value = res.list.map((data: any) => {
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
            return {
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
            };
          });
          dismiss();
        })
        .catch((err) => {
          console.info("Error while fetching enrichment tables", err);
          dismiss();
          if (err.response.status != 403) {
            $q.notify({
              type: "negative",
              message:
                err.response?.data?.message ||
                "Error while fetching functions.",
              timeout: 2000,
            });
          }
        });
    };

    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "All", value: 0 },
    ];

    const resultTotal = ref<number>(0);
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const selectedEnrichmentTable = ref<any>(null);
    const pagination: any = ref({
      rowsPerPage: 20,
    });
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
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
      filterQuery: ref(""),
      filterData(rows: any, terms: any) {
        var filtered = [];
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      getImageURL,
      verifyOrganizationStatus,
      exploreEnrichmentTable,
      showEnrichmentSchema,
      listSchema,
      selectedEnrichmentTable,
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
</style>
