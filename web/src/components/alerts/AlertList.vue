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
  <q-page
    data-test="alert-list-page"
    class="q-pa-none"
    style="min-height: inherit"
  >
    <div v-if="!showAddAlertDialog">
      <q-table
        data-test="alert-list-table"
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
              :data-test="`alert-list-${props.row.name}-udpate-alert`"
              icon="edit"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('alerts.edit')"
              @click="showAddUpdateFn(props)"
            ></q-btn>
            <q-btn
              :data-test="`alert-list-${props.row.name}-delete-alert`"
              icon="outlinedDelete" color="red"
              class="q-ml-xs"
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
          <div class="q-table__title" data-test="alerts-list-title">
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
            data-test="alert-list-add-alert-btn"
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
      <AddAlert
        v-model="formData"
        :isUpdated="isUpdated"
        :destinations="destinations"
        @update:list="refreshList"
        @cancel:hideform="hideForm"
      />
    </div>
    <ConfirmDialog
      title="Delete Alert"
      message="Are you sure you want to delete alert?"
      @update:ok="deleteAlert"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount, onActivated } from "vue";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { QTable, useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import AddAlert from "@/components/alerts/AddAlert.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import type { AlertData } from "@/ts/interfaces/index";
export default defineComponent({
  name: "AlertList",
  components: { QTablePagination, AddAlert, NoData, ConfirmDialog },
  emits: [
    "updated:fields",
    "update:changeRecordPerPage",
    "update:maxRecordToReturn",
  ],
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const router = useRouter();
    const alerts: Ref<AlertData[]> = ref([]);
    const formData: Ref<AlertData | {}> = ref({});
    const showAddAlertDialog: any = ref(false);
    const qTable: Ref<InstanceType<typeof QTable> | null> = ref(null);
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
        name: "stream_type",
        field: "stream_type",
        label: t("alerts.stream_type"),
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
        name: "destination",
        field: "destination",
        label: t("alerts.destination"),
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("alerts.actions"),
        align: "center",
        sortable: false,
      },
    ]);
    const activeTab: any = ref("alerts");
    const destinations = ref([]);
    const getAlerts = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading alerts...",
      });
      alertsService
        .list(
          1,
          100000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier
        )
        .then((res) => {
          var counter = 1;
          resultTotal.value = res.data.list.length;
          alerts.value = res.data.list.map((data: any) => {
            if (data.is_real_time) {
              data.query.sql = "--";
            }
            return {
              "#": counter <= 9 ? `0${counter++}` : counter++,
              name: data.name,
              sql: data.query.sql,
              stream_name: data.stream ? data.stream : "--",
              stream_type: data.stream_type,
              condition_str:
                data.condition.column +
                " " +
                data.condition.operator +
                " " +
                data.condition.value,
              actions: "",
              duration: {
                value: data.duration,
                unit: "Minutes",
              },
              frequency: {
                value: data.frequency,
                unit: "Minutes",
              },
              time_between_alerts: {
                value: data.time_between_alerts,
                unit: "Minutes",
              },
              destination: data.destination,
              condition: data.condition,
              isScheduled: (!data.is_real_time).toString(),
            };
          });
          if (router.currentRoute.value.query.action == "add") {
            showAddUpdateFn({ row: undefined });
          }
          if (router.currentRoute.value.query.action == "update") {
            const alertName = router.currentRoute.value.query.name as string;
            showAddUpdateFn({
              row: getAlertByName(alertName),
            });
          }
          dismiss();
        })
        .catch(() => {
          dismiss();
          $q.notify({
            type: "negative",
            message: "Error while pulling alerts.",
            timeout: 2000,
          });
        });
    };
    const getAlertByName = (name: string) => {
      return alerts.value.find((alert) => alert.name === name);
    };
    if (!alerts.value.length) {
      getAlerts();
    }
    onBeforeMount(() => getDestinations());
    onActivated(() => getDestinations());
    const getDestinations = () => {
      destinationService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
        })
        .then((res) => {
          destinations.value = res.data;
        })
        .catch((err) =>
          $q.notify({
            type: "negative",
            message: err.data.message,
            timeout: 2000,
          })
        );
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
      qTable.value?.setPagination(pagination.value);
    };
    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
    };
    const addAlert = () => {
      showAddAlertDialog.value = true;
    };
    const showAddUpdateFn = (props: any) => {
      formData.value = props.row;
      let action;
      if (!props.row) {
        isUpdated.value = false;
        action = "Add Alert";
        router.push({
          name: "alertList",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      } else {
        isUpdated.value = true;
        action = "Update Alert";
        router.push({
          name: "alertList",
          query: {
            action: "update",
            name: props.row.name,
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
      addAlert();
      if (config.enableAnalytics == "true") {
        segment.track("Button Click", {
          button: action,
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          page: "Alerts",
        });
      }
    };
    const refreshList = () => {
      getAlerts();
      hideForm();
    };
    const hideForm = () => {
      showAddAlertDialog.value = false;
      router.push({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };
    const deleteAlert = () => {
      alertsService
        .delete(
          store.state.selectedOrganization.identifier,
          selectedDelete.value.stream_name,
          selectedDelete.value.name,
          selectedDelete.value.stream_type
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              type: "positive",
              message: res.data.message,
              timeout: 2000,
            });
            getAlerts();
          } else {
            $q.notify({
              type: "negative",
              message: res.data.message,
              timeout: 2000,
            });
          }
        })
        .catch((err) => {
          $q.notify({
            type: "negative",
            message: err.data.message,
            timeout: 2000,
          });
        });
      if (config.enableAnalytics == "true") {
        segment.track("Button Click", {
          button: "Delete Alert",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          alert_name: selectedDelete.value.name,
          page: "Alerts",
        });
      }
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
      addAlert,
      deleteAlert,
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
      getImageURL,
      activeTab,
      destinations,
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
        newVal != oldVal &&
        this.router.currentRoute.value.name == "alertList"
      ) {
        this.resultTotal = 0;
        this.alerts = [];
        this.getAlerts();
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

.alerts-tabs {
  .q-tabs {
    &--vertical {
      margin: 1.5rem 1rem 0 0;

      .q-tab {
        justify-content: flex-start;
        padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;

        &__content.tab_content {
          .q-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }

        &--active {
          background-color: $accent;
        }
      }
    }
  }
}
</style>
