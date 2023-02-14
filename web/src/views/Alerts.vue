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
    <div v-if="!showAddAlertDialog">
      <q-table
        ref="qTable"
        :rows="alerts"
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
              class="q-ml-xs iconHoverBtn"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('alerts.add')"
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
              :title="t('alerts.delete')"
              @click="showDeleteDialogFn(props)"
            ></q-btn>
          </q-td>
        </template>

        <template v-slot:body-cell-function="props">
          <q-td :props="props">
            <q-tooltip>
              <pre>{{ props.row.sql }}</pre>
            </q-tooltip>
            <pre style="white-space: break-spaces">{{ props.row.sql }}</pre>
          </q-td>
        </template>
        <template #top="scope">
          <div class="q-table__title">
            {{ t("alerts.header") }}
          </div>
          <q-input
            v-model="filterQuery"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            :placeholder="t('alerts.search')"
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
            :label="t(`alerts.add`)"
            @click="showAddUpdateFn({})"
          />

          <QTablePagination
            :scope="scope"
            :pageTitle="t('alerts.header')"
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
      title="Delete Alert"
      message="Are you sure you want to delete alert?"
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
import alertsService from "../services/alerts";
import AddTransform from "../components/alerts/add.vue"
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
    const alerts: any = ref([]);
    const formData: any = ref({});
    const showAddAlertDialog: any = ref(false);
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
        label: t("alerts.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "stream_name",
        field: "stream_name",
        label: t("alerts.stream_name"),
        align: "left",
        sortable: true,
      },
      {
        name: "sql",
        field: "sql",
        label: t("alerts.sql"),
        align: "left",
        sortable: true,
        style: "width: 30vw;word-break: break-all;",
      },
      {
        name: "sql",
        field: "condition_str",
        label: t("alerts.condition"),
        align: "left",
        sortable: true,
        style: "width: 10vw;word-break: break-all;",
      },
     
      {
        name: "actions",
        field: "actions",
        label: t("alerts.actions"),
        align: "center",
        sortable: false,
      },
    ]);

    const getAlerts = (orgId: number) => {
      if (orgId > 0) {
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait while loading alerts...",
        });

        alertsService.list(1, 100000, "name", false, "", store.state.selectedOrganization.identifier).then((res) => {
          var counter = 1;
          resultTotal.value = res.data.list.length;
          alerts.value = res.data.list.map((data: any) => {
            if (data.is_ingest_time){
              data.query.sql= "--"
            }
            return {
              "#": counter <= 9 ? `0${counter++}` : counter++,
              name: data.name,
              sql: data.query.sql,
              stream_name: (data.stream) ? data.stream : "--",
              condition_str: data.condition.column + " " + data.condition.operator + " "+data.condition.value,
              actions: "",
              duration: {
                value: data.duration,
                unit: "Minutes"
              },
              frequency: {
                value: data.frequency,
                unit: "Minutes"
              },
              time_between_alerts: {
                value: data.time_between_alerts,
                unit: "Minutes"
              },
              destination: data.destination,
              condition: data.condition,
              isScheduled: (!data.is_ingest_time).toString(),
            };
          });

          dismiss();
        })
          .catch((err) => {
            dismiss();
            $q.notify({
              type: "negative",
              message: "Error while pulling alerts.",
              timeout: 2000,
            });
          });
      }
    };

    if (alerts.value == "" || alerts.value == undefined) {
      getAlerts(store.state.selectedOrganization.id);
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
      showAddAlertDialog.value = true;
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
      showAddAlertDialog.value = false;
      getAlerts(store.state.selectedOrganization.id);
    }

    const hideForm = () => {
      showAddAlertDialog.value = false;
    }

    const deleteFn = () => {
      alertsService.delete(store.state.selectedOrganization.identifier, selectedDelete.value.stream_name
, selectedDelete.value.name).then((res: any) => {
        if (res.data.code == 200) {
          $q.notify({
            type: "positive",
            message: res.data.message,
            timeout: 2000,
          });
          getAlerts(store.state.selectedOrganization.id);
        } else {
          $q.notify({
            type: "negative",
            message: res.data.message,
            timeout: 2000,
          });
        }
      })
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
      alerts,
      columns,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      getAlerts,
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
      showAddAlertDialog,
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
      if ((newVal != oldVal || this.alerts.value == undefined) && this.router.currentRoute.value.name == "transform") {
        this.resultTotal = 0
        this.alerts = [];
        this.getAlerts(this.store.state.selectedOrganization.id);
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
