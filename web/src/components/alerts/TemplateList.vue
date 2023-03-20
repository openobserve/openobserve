<template>
  <q-page class="q-pa-none" style="min-height: inherit">
    <div v-if="!showTemplateEditor">
      <q-table
        ref="q-table"
        :rows="templates"
        :columns="columns"
        row-key="id"
        style="width: 100%"
        hide-bottom
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
      </q-table>
    </div>
    <div v-else>
      <AddTemplate
        :template="editingTemplate"
        @cancel:hideform="toggleTemplateEditor"
        @get:templates="$emit('get:templates')"
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
import { ref, defineProps, defineEmits } from "vue";
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

const emit = defineEmits(["get:templates"]);

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

const editingTemplate = ref(null);
const confirmDelete = ref({ visible: false, data: null });

const editTemplate = (template: any) => {
  toggleTemplateEditor();
  editingTemplate.value = { ...template };
};
const deleteTemplate = () => {
  console.log(confirmDelete.value.data);
  if (confirmDelete.value?.data?.name) {
    templateService
      .delete({
        org_identifier: store.state.selectedOrganization.identifier,
        template_name: confirmDelete.value.data.name,
      })
      .then(() => emit("get:templates"));
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
  editingTemplate.value = null;
  showTemplateEditor.value = !showTemplateEditor.value;
};
</script>
<style lang=""></style>
