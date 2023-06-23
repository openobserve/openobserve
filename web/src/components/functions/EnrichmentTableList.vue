<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <q-page class="q-pa-none" style="min-height: inherit">
    <div v-if="!showAddJSTransformDialog">
      <q-table
        ref="qTable"
        :rows="jsTransforms"
        :columns="columns"
        row-key="id"
        :pagination="pagination"
        :filter="filterQuery"
        :filter-method="filterData"
        style="width: 100%"
      >
        <template #no-data>
          <NoData />
        </template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              icon="transform"
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
              :icon="outlinedDelete" color="red"
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
          <div class="q-table__title">
            {{ t("function.enrichmentTables") }}
          </div>
          <q-input
            v-model="filterQuery"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border search-en-table-input"
            :placeholder="t('function.searchEnrichmentTable')"
          >
            <template #prepend>
              <q-icon name="search" class="cursor-pointer" />
            </template>
          </q-input>
          <q-btn
            class="q-ml-md q-mb-xs text-bold no-border"
            padding="sm lg"
            color="secondary"
            no-caps
            :label="t(`function.addEnrichmentTable`)"
            @click="showAddUpdateFn({})"
          />

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
import { getImageURL, verifyOrganizationStatus } from "../../utils/zincutils";
import streamService from "@/services/stream";
import { outlinedDelete } from '@quasar/extras/material-icons-outlined'

export default defineComponent({
  name: "EnrichmentTableList",
  components: { QTablePagination, AddEnrichmentTable, NoData, ConfirmDialog },
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
        name: "actions",
        field: "actions",
        label: t("function.actions"),
        align: "center",
        sortable: false,
      },
    ]);

    onBeforeMount(() => {
      getLookupTables();
    });

    const getLookupTables = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading functions...",
      });

      streamService
        .nameList(
          store.state.selectedOrganization.identifier,
          "enrichment_tables",
          false
        )
        .then((res) => {
          let counter = 1;
          resultTotal.value = res.data.list.length;
          jsTransforms.value = res.data.list.map((data: any) => {
            return {
              "#": counter <= 9 ? `0${counter++}` : counter++,
              id: data.name + counter,
              name: data.name,
              actions: "action buttons",
              stream_type: data.stream_type,
            };
          });
          dismiss();
        })
        .catch((err) => {
          console.log("--", err);

          dismiss();
          $q.notify({
            type: "negative",
            message: "Error while pulling function.",
            timeout: 2000,
          });
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
      getLookupTables();
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
          "enrichment_tables"
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              color: "positive",
              message: `${selectedDelete.value.name} deleted successfully.`,
            });
            getLookupTables();
          }
        })
        .catch((err: any) => {
          $q.notify({
            color: "negative",
            message: "Error while deleting stream.",
          });
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
        this.router
      );
      if (
        (newVal != oldVal || this.jsTransforms.value == undefined) &&
        this.router.currentRoute.value.name == "functions"
      ) {
        this.resultTotal = 0;
        this.jsTransforms = [];
        this.getLookupTables();
      }
    },
  },
});
</script>

<style lang="scss">
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}

.search-en-table-input {
  .q-field__inner {
    width: 250px;
  }
}
</style>
