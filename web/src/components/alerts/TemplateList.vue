<template>
  <q-page class="q-pa-none" style="min-height: inherit">
    <div v-if="!showTemplateEditor">
      <q-table
        ref="q-table"
        :rows="templates"
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
              :title="t('alert_templates.edit')"
              @click="editTemplate(props.row)"
            ></q-btn>
            <q-btn
              :icon="'img:' + getImageURL('images/common/delete_icon.svg')"
              class="q-ml-xs iconHoverBtn"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :title="t('alert_templates.delete')"
              @click="conformDeleteDestination(props.row)"
            ></q-btn>
          </q-td>
        </template>
        <template #top>
          <div class="q-table__title">
            {{ t("alert_templates.header") }}
          </div>
          <q-input
            v-model="destinationSearchKey"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            :placeholder="t('alert_templates.search')"
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
            :label="t(`alert_templates.add`)"
            @click="toggleTemplateEditor"
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
      <AddTemplate
        :template="editingTemplate"
        @cancel:hideform="toggleTemplateEditor"
      />
    </div>

    <ConfirmDialog
      title="Delete Alert"
      message="Are you sure you want to delete alert?"
      @update:ok="deleteTemplate"
      @update:cancel="cancelDeleteTemplate"
      v-model="confirmDelete.visible"
    />
  </q-page>
</template>
<script lang="ts" setup>
import { ref, onBeforeMount, defineProps } from "vue";
import { useI18n } from "vue-i18n";
import type { QTableProps } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import { getImageURL } from "@/utils/zincutils";
import { AddTemplate } from "./index";
import templateService from "@/services/alert_templates";
import ConfirmDialog from "../ConfirmDialog.vue";

import { useStore } from "vuex";
const props = defineProps({
  templates: {
    type: Array,
    default: () => [],
  },
});
const store = useStore();
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
    label: t("alert_templates.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "actions",
    field: "actions",
    label: t("alert_templates.actions"),
    align: "center",
    sortable: false,
  },
]);
const destinationSearchKey = ref("");
const showTemplateEditor = ref(false);
const perPageOptions: any = [
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "All", value: 0 },
];
const resultTotal = ref<number>(0);
const editingTemplate = ref(null);
const confirmDelete = ref({ visible: false, data: null });

const editTemplate = (template: any) => {
  toggleTemplateEditor();
  editingTemplate.value = { ...template };
};
const deleteTemplate = () => {
  console.log(confirmDelete.value.data);
  if (confirmDelete.value?.data?.name) {
    templateService.delete({
      org_identifier: store.state.selectedOrganization.identifier,
      template_name: confirmDelete.value.data.name,
    });
  }
};

const conformDeleteDestination = (destination: any) => {
  confirmDelete.value.visible = true;
  confirmDelete.value.data = destination;
};

const cancelDeleteTemplate = () => {
  confirmDelete.value.visible = false;
  confirmDelete.value.data = null;
};

const toggleTemplateEditor = () => {
  showTemplateEditor.value = !showTemplateEditor.value;
};
</script>
<style lang=""></style>
