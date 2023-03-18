<template>
  <q-page class="q-pa-none" style="min-height: inherit">
    <div v-if="!showDestinationEditor">
      <q-table
        ref="q-table"
        :rows="destinations"
        :columns="columns"
        row-key="id"
        style="width: 100%"
      >
        <template #no-data>
          <NoData />
        </template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              icon="edit"
              class="q-ml-xs iconHoverBtn"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('alert_destinations.edit')"
              @click="editDestination(props.row)"
            ></q-btn>
            <q-btn
              :icon="'img:' + getImageURL('images/common/delete_icon.svg')"
              class="q-ml-xs iconHoverBtn"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('alert_destinations.delete')"
              @click="conformDeleteDestination(props.row)"
            ></q-btn>
          </q-td>
        </template>
        <template #top>
          <div class="q-table__title">
            {{ t("alert_destinations.header") }}
          </div>
          <q-input
            v-model="destinationSearchKey"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            :placeholder="t('alert_destinations.search')"
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
            :label="t(`alert_destinations.add`)"
            @click="toggleDestionationEditor"
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
      <AddDestination
        :destination="editingDestination"
        :templates="templates"
      />
    </div>

    <ConfirmDialog
      title="Delete Alert"
      message="Are you sure you want to delete alert?"
      @update:ok="deleteDestination"
      @update:cancel="cancelDeleteDestination"
      v-model="confirmDelete.visible"
    />
  </q-page>
</template>
<script lang="ts" setup>
import { ref, defineProps } from "vue";
import { useI18n } from "vue-i18n";
import type { QTableProps } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import { getImageURL } from "@/utils/zincutils";
import AddDestination from "./AddDestination.vue";
import destinationService from "@/services/alert_destination";
import { useStore } from "vuex";
import ConfirmDialog from "../ConfirmDialog.vue";

const props = defineProps({
  destinations: {
    type: Array,
    default: () => [],
  },
  templates: {
    type: Array,
    default: () => [],
  },
});

const store = useStore();
const editingDestination = ref(null);
const { t } = useI18n();
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
    label: t("alert_destinations.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "url",
    field: "url",
    label: t("alert_destinations.url"),
    align: "left",
    sortable: false,
  },
  {
    name: "method",
    field: "method",
    label: t("alert_destinations.method"),
    align: "left",
    sortable: true,
  },
  {
    name: "actions",
    field: "actions",
    label: t("alert_destinations.actions"),
    align: "center",
    sortable: false,
  },
]);
const confirmDelete = ref({ visible: false, data: null });
const destinationSearchKey = ref("");
const showDestinationEditor = ref(false);
const perPageOptions: any = [
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "All", value: 0 },
];
const resultTotal = ref<number>(0);
const editDestination = (destination: any) => {
  toggleDestionationEditor();
  editingDestination.value = { ...destination };
};

const deleteDestination = () => {
  console.log(confirmDelete.value.data);
  if (confirmDelete.value?.data?.name) {
    destinationService.delete({
      org_identifier: store.state.selectedOrganization.identifier,
      destination_name: confirmDelete.value.data.name,
    });
  }
};

const conformDeleteDestination = (destination: any) => {
  confirmDelete.value.visible = true;
  confirmDelete.value.data = destination;
};

const cancelDeleteDestination = () => {
  confirmDelete.value.visible = false;
  confirmDelete.value.data = null;
};

const createNewDestination = (props) => {};
const changePagination = () => {};
const toggleDestionationEditor = () => {
  showDestinationEditor.value = !showDestinationEditor.value;
};
</script>
<style lang=""></style>
