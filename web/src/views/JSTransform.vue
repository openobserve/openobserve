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
        <template #no-data><NoData /></template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              icon="transform"
              class="q-ml-xs iconHoverBtn"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('jstransform.add')"
              @click="showAddUpdateFn(props)"
            ></q-btn>
            <q-btn
              icon="img:/src/assets/images/common/delete_icon.svg"
              class="q-ml-xs iconHoverBtn"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('jstransform.delete')"
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
            {{ t("jstransform.header") }}
          </div>
          <q-input
            v-model="filterQuery"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            :placeholder="t('jstransform.search')"
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
            :label="t(`jstransform.add`)"
            @click="showAddUpdateFn({})"
          />

          <QTablePagination
            :scope="scope"
            :pageTitle="t('jstransform.header')"
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
      <AddTransform
        v-model="formData"
        :isUpdated="isUpdated"
        @update:list="refreshList"
        @cancel:hideform="hideForm"
      />
    </div>
    <ConfirmDialog
      title="Delete Transform"
      message="Are you sure you want to delete transform?"
      @update:ok="deleteFn"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "../components/shared/grid/Pagination.vue";
import jsTransformService from "../services/jstransform";
import AddTransform from "../components/jstransform/add.vue"
import NoData from "../components/shared/grid/NoData.vue"
import ConfirmDialog from "../components/ConfirmDialog.vue";

export default defineComponent({
  name: "PageJSTransform",
  components: { QTablePagination, AddTransform, NoData, ConfirmDialog },
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
    const formData:any = ref({});
    const showAddJSTransformDialog: any = ref(false);
    const qTable: any = ref(null);
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const columns:any = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
      },
      {
        name: "name",
        field: "name",
        label: t("jstransform.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "stream_name",
        field: "stream_name",
        label: t("jstransform.stream_name"),
        align: "left",
        sortable: true,
      },
      {
        name: "ingest",
        field: (row: any) => {
          return row.ingest ? "Ingest" : "Query";
        },
        label: t("jstransform.type"),
        align: "left",
        sortable: true,
      },
      {
        name: "order",
        field: "order",
        label: t("jstransform.order"),
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("jstransform.actions"),
        align: "center",
        sortable: false,
      },
    ]);

    const getJSTransforms = (orgId: number) => {
      if (orgId > 0) {
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait while loading functions...",
        });

        jsTransformService.list(1, 100000, "name", false, "", store.state.selectedOrganization.identifier).then((res) => {
          var counter = 1;
          resultTotal.value = res.data.list.length;
          jsTransforms.value = res.data.list.map((data: any) => {
            return {
              "#": counter <= 9 ? `0${counter++}` : counter++,
              name: data.name,
              function: data.function,
              order: (data.order) ? data.order : 1,
              stream_name: (data.stream_name) ? data.stream_name : "--",
              ingest: (data.stream_name) ? true : false,
              actions: "",
            };
          });

          dismiss();
        })
        .catch((err) => {
          dismiss();
          $q.notify({
            type: "negative",
            message: "Error while pulling function.",
            timeout: 2000,
          });
        });
      }
    };

    if (jsTransforms.value == "" || jsTransforms.value == undefined) {
      getJSTransforms(store.state.selectedOrganization.id);
    }
 
    interface OptionType {
      label: String;
      value: number | String;
    }
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
    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
    };

    const addTransform = () => {
      showAddJSTransformDialog.value = true;
    }    

    const showAddUpdateFn = (props: any) => {
      formData.value = props.row;
      if (!props.row) {
        isUpdated.value = false;
      } else {
        isUpdated.value = true;
      }
      addTransform();
    }

    const refreshList = () => {
      showAddJSTransformDialog.value = false;
      getJSTransforms(store.state.selectedOrganization.id);
    }

    const hideForm = () => {
      showAddJSTransformDialog.value = false;
    }

    const deleteFn = () => {
      if (selectedDelete.value.ingest) {
        jsTransformService.delete_stream_function(store.state.selectedOrganization.identifier, selectedDelete.value.stream_name, selectedDelete.value.name).then((res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              type: "positive",
              message: res.data.message,
              timeout: 2000,
            });
            getJSTransforms(store.state.selectedOrganization.id);
          } else {
            $q.notify({
              type: "negative",
              message: res.data.message,
              timeout: 2000,
            });
          }
        })
      }
      else {
        jsTransformService.delete(store.state.selectedOrganization.identifier, selectedDelete.value.name).then((res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              type: "positive",
              message: res.data.message,
              timeout: 2000,
            });
            getJSTransforms(store.state.selectedOrganization.id);
          } else {
            $q.notify({
              type: "negative",
              message: res.data.message,
              timeout: 2000,
            });
          }
        })
      }
    }

    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDelete.value = true;
    }

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
    };
  },
  computed: {
    selectedOrg() {
      return this.store.state.selectedOrganization.identifier
    }
  },
  watch: {
    selectedOrg(newVal: any, oldVal: any) {
      if ((newVal != oldVal || this.jsTransforms.value == undefined) && this.router.currentRoute.value.name=="function") {
        this.resultTotal=0
        this.jsTransforms = [];
        this.getJSTransforms(this.store.state.selectedOrganization.id);
      }
    }
  }
});
</script>

<style lang="scss">
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
</style>
