<!-- Copyright 2023 Zinc Labs Inc.

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
  <div
    data-test="report-list-page"
    class="q-pa-none flex"
    style="height: calc(100vh - 57px)"
  >
    <div class="full-width">
      <q-table
        data-test="report-list-table"
        ref="reportListTableRef"
        :rows="reportsTableRows"
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
            <div
              data-test="report-list-loading-reports"
              v-if="reportsStateLoadingMap[props.row.uuid]"
              style="display: inline-block; width: 33.14px; height: auto"
              class="flex justify-center items-center q-ml-xs"
              :title="`Turning ${props.row.enabled ? 'Off' : 'On'}`"
            >
              <q-circular-progress
                indeterminate
                rounded
                size="16px"
                :value="1"
                color="secondary"
              />
            </div>
            <q-btn
              v-else
              :data-test="`report-list-${props.row.name}-pause-start-report`"
              :icon="props.row.enabled ? outlinedPause : outlinedPlayArrow"
              class="q-ml-xs material-symbols-outlined"
              padding="sm"
              unelevated
              size="sm"
              :color="props.row.enabled ? 'negative' : 'positive'"
              round
              flat
              :title="props.row.enabled ? t('alerts.pause') : t('alerts.start')"
              @click="toggleReportState(props.row)"
            />
            <q-btn
              :data-test="`report-list-${props.row.name}-edit-report`"
              icon="edit"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('alerts.edit')"
              @click="editReport(props.row)"
            ></q-btn>
            <q-btn
              :data-test="`report-list-${props.row.name}-delete-report`"
              :icon="outlinedDelete"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('alerts.delete')"
              @click="confirmDeleteReport(props.row)"
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
          <div class="q-table__title" data-test="report-list-title">
            {{ t("reports.header") }}
          </div>
          <q-input
            data-test="report-list-search-input"
            v-model="filterQuery"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            :placeholder="t('reports.search')"
          >
            <template #prepend>
              <q-icon name="search" class="cursor-pointer" />
            </template>
          </q-input>
          <q-btn
            data-test="report-list-add-report-btn"
            class="q-ml-md q-mb-xs text-bold no-border"
            padding="sm lg"
            color="secondary"
            no-caps
            :label="t(`reports.add`)"
            @click="createNewReport"
          />

          <QTablePagination
            :scope="scope"
            :pageTitle="t('reports.header')"
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

    <ConfirmDialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @update:ok="deleteReport"
      @update:cancel="deleteDialog.show = false"
    />
  </div>
</template>

<script setup lang="ts">
import { defineComponent, ref, onBeforeMount, onActivated, watch } from "vue";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
} from "@quasar/extras/material-icons-outlined";
import config from "@/aws-exports";
import {
  getImageURL,
  getUUID,
  verifyOrganizationStatus,
} from "@/utils/zincutils";
import { useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
import reports from "@/services/reports";
import { cloneDeep } from "lodash-es";

const reportsTableRows = ref([
  {
    "#": 1,
    name: "report1",
  },
]);

const { t } = useI18n();

const router = useRouter();

const confirmDelete = ref(false);

const store = useStore();

const editingReport: any = ref(null);

const q = useQuasar();

const isLoadingReports = ref(false);

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

const reportsStateLoadingMap: Ref<{ [key: string]: boolean }> = ref({});

const filterQuery = ref("");

const showConfirmDeleteDialog = ref(false);

const deleteDialog = ref({
  show: false,
  title: "Delete Report",
  message: "Are you sure you want to delete report?",
});

const reportListTableRef = ref(null);

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
    name: "description",
    field: "description",
    label: t("alerts.description"),
    align: "center",
    sortable: false,
  },
  {
    name: "actions",
    field: "actions",
    label: t("alerts.actions"),
    align: "center",
    style: "width: 300px",
    sortable: false,
  },
]);

onBeforeMount(() => {
  isLoadingReports.value = true;
  reports
    .list(store.state.selectedOrganization.identifier)
    .then((res) => {
      reportsTableRows.value = res.data.map((report: any, index: number) => ({
        "#": index + 1,
        ...report,
      }));
    })
    .catch((err) => {
      q.notify({
        message: err.data.message || "Error while fetching reports!",
        timeout: 3000,
      });
    })
    .finally(() => (isLoadingReports.value = false));
});

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  reportListTableRef.value?.setPagination(pagination.value);
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

const toggleReportState = (report: any) => {
  const state = report.enabled ? "Pausing" : "Resuming";
  const dismiss = q.notify({
    message: `${state} report "${report.name}"`,
  });
  reports
    .toggleReportState(
      store.state.selectedOrganization.identifier,
      report.name,
      !report.enabled
    )
    .then((res) => {})
    .catch((err) => {
      console.log(err);
    })
    .finally(() => dismiss());
};

const editReport = (report: any) => {
  editingReport.value = cloneDeep(report);
  router.push({
    name: "createReport",
    query: {
      name: report.name,
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const confirmDeleteReport = (report: any) => {
  console.log("Confirm delete report");
  deleteDialog.value.show = true;
  deleteDialog.value.message = `Are you sure you want to delete report "${report.name}"`;
};

const deleteReport = (report: any) => {
  const dismiss = q.notify({
    message: `Deleting report "${report.name}"`,
  });
  reports
    .toggleReportState(
      store.state.selectedOrganization.identifier,
      report.name,
      !report.enabled
    )
    .then((res) => {})
    .catch((err) => {
      console.log(err);
    })
    .finally(() => dismiss());
};

const createNewReport = () => {
  router.push({ name: "createReport" });
};
</script>

<style scoped></style>
