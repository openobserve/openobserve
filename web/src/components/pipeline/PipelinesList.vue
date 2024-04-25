<template>
  <div>
    <div class="full-wdith">
      <q-table
        data-test="alert-list-table"
        ref="qTable"
        :rows="pipelines"
        :columns="columns"
        row-key="name"
        :pagination="pagination"
        :filter="filterQuery"
        :filter-method="filterData"
        style="width: 100%"
      >
        <template #no-data>
          <no-data />
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
              @click="editPipeline(props.row)"
            ></q-btn>
            <q-btn
              :data-test="`alert-list-${props.row.name}-delete-alert`"
              :icon="outlinedDelete"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('alerts.delete')"
              @click="openDeleteDialog(props)"
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
            {{ t("pipeline.header") }}
          </div>
          <q-input
            data-test="alert-list-search-input"
            v-model="filterQuery"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            :placeholder="t('pipeline.search')"
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
            :label="t(`pipeline.addPipeline`)"
            @click="createPipeline"
          />

          <q-table-pagination
            :scope="scope"
            :pageTitle="t('pipeline.header')"
            :position="'top'"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </template>

        <template #bottom="scope">
          <q-table-pagination
            :scope="scope"
            :position="'bottom'"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </template>
      </q-table>
    </div>
  </div>
  <q-dialog v-model="showCreatePipeline" position="right" full-height maximized>
    <stream-selection @save="savePipeline" />
  </q-dialog>
</template>
<script setup lang="ts">
import { ref, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import StreamSelection from "./StreamSelection.vue";
import pipelineService from "@/services/pipelines";
import { useStore } from "vuex";
import type { QTableProps } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import QTablePagination from "@/components/shared/grid/Pagination.vue";

interface Pipeline {
  name: string;
  description: string;
  stream_type: string;
  stream_name: string;
}

const { t } = useI18n();
const router = useRouter();

// const qTable: any = ref(null);

const filterQuery = ref("");

const showCreatePipeline = ref(false);

const pipelines = ref([]);

const store = useStore();

const confirmDialog = ref({
  show: false,
  title: "",
  message: "",
  onConfirm: () => {},
});

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
  // qTable.value?.setPagination(pagination.value);
};

const editingPipeline = ref<Pipeline | null>(null);

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
    label: t("common.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "description",
    field: "description",
    label: t("common.description"),
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
    name: "stream_type",
    field: "stream_type",
    label: t("alerts.streamType"),
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

onBeforeMount(() => {
  getPipelines();
});

const createPipeline = () => {
  showCreatePipeline.value = true;
};

const getPipelines = () => {
  pipelineService
    .getPipelines(store.state.selectedOrganization.identifier)
    .then((response) => {
      pipelines.value = response.data.list.map(
        (pipeline: any, index: number) => {
          return {
            ...pipeline,
            "#": index + 1,
          };
        }
      );
    })
    .catch((error) => {
      console.error(error);
    });
};

const editPipeline = (pipeline: Pipeline) => {
  router.push({
    name: "pipelineEditor",
    query: {
      name: pipeline.name,
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const openDeleteDialog = () => {
  confirmDialog.value.show = true;
  confirmDialog.value.title = t("pipeline.deletePipeline");
  confirmDialog.value.message =
    "Are you sure you want to delete this pipeline?";
  confirmDialog.value.onConfirm = deletePipeline;
};

const savePipeline = (data: Pipeline) => {
  pipelineService
    .createPipeline({
      ...data,
      org_identifier: store.state.selectedOrganization.identifier,
    })
    .then(() => {
      showCreatePipeline.value = false;
    });
};

const deletePipeline = () => {
  pipelineService
    .deletePipeline(store.state.selectedOrganization.identifier)
    .then(() => {
      showCreatePipeline.value = false;
    });
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
</script>
<style lang=""></style>
