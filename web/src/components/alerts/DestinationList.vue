<template>
  <q-page class="q-pa-none" style="min-height: inherit">
    <div v-if="!showDestinationEditor">
      <q-table
        ref="qTable"
        :rows="destinations"
        :columns="columns"
        row-key="id"
        style="width: 100%"
        :pagination="pagination"
        :filter="filterQuery"
        :filter-method="filterData"
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
        <template #top="scope">
          <div class="q-table__title">
            {{ t("alert_destinations.header") }}
          </div>
          <q-input
            v-model="filterQuery"
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
            @click="editDestination(null)"
          />

          <QTablePagination
            :scope="scope"
            :pageTitle="t('alert_destinations.header')"
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
      <AddDestination
        :destination="editingDestination"
        :templates="templates"
        @cancel:hideform="toggleDestionationEditor"
        @get:destinations="getDestinations"
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
<script lang="ts">
import {
  ref,
  onBeforeMount,
  onActivated,
  onMounted,
  defineComponent,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { QTableProps } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import { getImageURL } from "@/utils/zincutils";
import AddDestination from "./AddDestination.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useRouter } from "vue-router";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import type { DestinationData } from "@/ts/interfaces";
import type { Template } from "@/ts/interfaces/index";
interface ConformDelete {
  visible: boolean;
  data: any;
}
export default defineComponent({
  name: "PageAlerts",
  components: { AddDestination, NoData, ConfirmDialog, QTablePagination },
  setup() {
    const qTable = ref();
    const store = useStore();
    const editingDestination: Ref<DestinationData | null> = ref(null);
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
        style: "width: 110px",
      },
    ]);
    const destinations: Ref<DestinationData[]> = ref([]);
    const templates: Ref<Template[]> = ref([]);
    const confirmDelete: Ref<ConformDelete> = ref({
      visible: false,
      data: null,
    });
    const showDestinationEditor = ref(false);
    const router = useRouter();
    const filterQuery = ref("");
    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "All", value: 0 },
    ];
    const resultTotal = ref(0);
    const selectedPerPage = ref(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });
    onActivated(() => {
      getTemplates();
      if (!destinations.value.length) getDestinations();
    });
    onBeforeMount(() => {
      getDestinations();
      getTemplates();
    });
    const getDestinations = () => {
      destinationService
        .list({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          org_identifier: store.state.selectedOrganization.identifier,
        })
        .then((res) => {
          resultTotal.value = res.data.length;
          destinations.value = res.data.map((data: any, index: number) => ({
            ...data,
            "#": index + 1 <= 9 ? `0${index + 1}` : index + 1,
          }));
          updateRoute();
        })
        .catch(() => console.log("Error while fetching destinations"));
    };
    const getTemplates = () => {
      templateService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
        })
        .then((res) => (templates.value = res.data));
    };
    const updateRoute = () => {
      if (router.currentRoute.value.query.action === "add")
        editDestination(null);
      if (router.currentRoute.value.query.action === "update")
        editDestination(
          getDestinationByName(router.currentRoute.value.query.name as string)
        );
    };
    const getDestinationByName = (name: string) => {
      return destinations.value.find(
        (destination) => destination.name === name
      );
    };
    const editDestination = (destination: any) => {
      toggleDestionationEditor();
      resetEditingDestination();
      if (!destination) {
        router.push({
          name: "alertDestinations",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      } else {
        editingDestination.value = { ...destination };
        router.push({
          name: "alertDestinations",
          query: {
            action: "update",
            name: destination.name,
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    };
    const resetEditingDestination = () => {
      editingDestination.value = null;
    };
    const deleteDestination = () => {
      if (confirmDelete.value?.data?.name) {
        destinationService
          .delete({
            org_identifier: store.state.selectedOrganization.identifier,
            destination_name: confirmDelete.value.data.name,
          })
          .then(() => getDestinations());
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
    const toggleDestionationEditor = () => {
      showDestinationEditor.value = !showDestinationEditor.value;
      if (!showDestinationEditor.value)
        router.push({
          name: "alertDestinations",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
    };
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
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
    return {
      t,
      qTable,
      showDestinationEditor,
      destinations,
      columns,
      editDestination,
      getImageURL,
      conformDeleteDestination,
      filterQuery,
      filterData,
      editingDestination,
      templates,
      toggleDestionationEditor,
      getDestinations,
      deleteDestination,
      cancelDeleteDestination,
      confirmDelete,
      changePagination,
      perPageOptions,
      resultTotal,
      pagination,
    };
  },
});
</script>
<style lang=""></style>
