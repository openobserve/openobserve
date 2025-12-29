<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page class="q-pa-none" style="height: calc(100vh - 88px); min-height: inherit">
    <div v-if="!showImportTemplate && !showTemplateEditor" >
      <div class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
      >
        <div class="q-table__title tw:font-[600]" data-test="alert-templates-list-title">
            {{ t("alert_templates.header") }}
          </div>
          <div class="tw:flex tw:justify-end">
            <q-input
              v-model="filterQuery"
              borderless
              dense
              class="q-ml-auto no-border o2-search-input"
              :placeholder="t('template.search')"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
          <q-btn
            class="o2-secondary-button q-ml-sm tw:h-[36px]"
            no-caps
            flat
            :label="t(`dashboard.import`)"
            @click="importTemplate"
            data-test="template-import"
          />
          <q-btn
            data-test="template-list-add-btn"
            class="o2-primary-button q-ml-sm tw:h-[36px]"
            no-caps
            flat
            :label="t(`alert_templates.add`)"
            @click="editTemplate(null)"
          />
        </div>
      </div>
      <q-table
        data-test="alert-templates-list-table"
        ref="qTableRef"
        :rows="visibleRows"
        :columns="columns"
        row-key="name"
        selection="multiple"
        v-model:selected="selectedTemplates"
        style="width: 100%"
        :rows-per-page-options="[0]"
        :pagination="pagination"
        class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
        :style="hasVisibleRows
            ? 'width: 100%; height: calc(100vh - 112px); overflow-y: auto;'
            : 'width: 100%'"
      >
        <template #no-data>
          <NoData />
        </template>
        <template v-slot:body-selection="scope">
          <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
        </template>
        <template v-slot:header="props">
          <q-tr :props="props">
            <!-- Adding this block to render the select-all checkbox -->
            <q-th v-if="columns.length > 0" auto-width>
              <q-checkbox
                v-model="props.selected"
                size="sm"
                :class="store.state.theme === 'dark' ? 'o2-table-checkbox-dark' : 'o2-table-checkbox-light'"
                class="o2-table-checkbox"
              />
            </q-th>

            <!-- render the table headers -->
            <q-th
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              :class="col.classes"
              :style="col.style"
            >
              {{ col.label }}
            </q-th>
          </q-tr>
        </template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              title="Export Template"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              icon="download"
              @click.stop="exportTemplate(props.row)"
              data-test="destination-export"
            >
            </q-btn>
            <q-btn
              :data-test="`alert-template-list-${props.row.name}-update-template`"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              icon="edit"
              :title="t('alert_templates.edit')"
              @click="editTemplate(props.row)"
            >
            </q-btn>
            <q-btn
              :data-test="`alert-template-list-${props.row.name}-delete-template`"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :icon="outlinedDelete"
              :title="t('alert_templates.delete')"
              @click="conformDeleteDestination(props.row)"
            >
            </q-btn>
          </q-td>
        </template>
        <template #bottom="scope">
          <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
            <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[150px] tw:mr-md">
              {{ resultTotal }} {{ t('alert_templates.header') }}
            </div>
            <q-btn
              v-if="selectedTemplates.length > 0"
              data-test="template-list-delete-templates-btn"
              class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-secondary-button-dark'
                  : 'o2-secondary-button-light'
              "
              no-caps
              dense
              @click="openBulkDeleteDialog"
            >
              <q-icon name="delete" size="16px" />
              <span class="tw:ml-2">Delete</span>
            </q-btn>
            <QTablePagination
              :scope="scope"
              :position="'bottom'"
              :resultTotal="resultTotal"
              :perPageOptions="perPageOptions"
              @update:changeRecordPerPage="changePagination"
            />
          </div>
        </template>
      </q-table>
    </div>
    <div v-else-if="!showImportTemplate && showTemplateEditor">
      <AddTemplate
        :template="editingTemplate"
        @cancel:hideform="toggleTemplateEditor"
        @get:templates="getTemplates"
      />
    </div>
    <div v-else>
      <ImportTemplate :templates="templates" @update:templates="getTemplates" />
    </div>

    <ConfirmDialog
      title="Delete Template"
      message="Are you sure you want to delete template?"
      @update:ok="deleteTemplate"
      @update:cancel="cancelDeleteTemplate"
      v-model="confirmDelete.visible"
    />

    <ConfirmDialog
      title="Delete Templates"
      :message="`Are you sure you want to delete ${selectedTemplates.length} template(s)?`"
      @update:ok="bulkDeleteTemplates"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
  </q-page>
</template>
<script lang="ts" setup>
import { ref, onActivated, onMounted, watch, defineAsyncComponent, computed } from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar, type QTableProps } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import templateService from "@/services/alert_templates";
import ConfirmDialog from "../ConfirmDialog.vue";
import type { TemplateData, Template } from "@/ts/interfaces";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import ImportTemplate from "./ImportTemplate.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import { useReo } from "@/services/reodotdev_analytics";

const AddTemplate = defineAsyncComponent(
  () => import("@/components/alerts/AddTemplate.vue"),
);

const store = useStore();
const { t } = useI18n();
const router = useRouter();
const q = useQuasar();
const { track } = useReo();
const templates: Ref<Template[]> = ref([]);
const columns: any = ref<QTableProps["columns"]>([
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left",
    style: "width: 67px",
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
    classes:'actions-column'
  },
]);
const showTemplateEditor = ref(false);
const showImportTemplate = ref(false);
const editingTemplate: Ref<TemplateData | null> = ref(null);
  const perPageOptions: any = [
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 }
];
const resultTotal = ref<number>(0);
const selectedPerPage = ref<number>(20);
const qTableRef = ref<any>(null);

const confirmDelete: Ref<{
  visible: boolean;
  data: any;
}> = ref({ visible: false, data: null });
const selectedTemplates: Ref<any[]> = ref([]);
const confirmBulkDelete = ref(false);
const pagination: any = ref({
  page: 1,
  rowsPerPage: 20, // 0 means all rows
});
const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  qTableRef.value?.setPagination(pagination.value);
};
const filterQuery = ref("");
onActivated(() => {
  if (!templates.value.length) updateRoute();
});
onMounted(() => {
  getTemplates();
});

watch(
  () => router.currentRoute.value.query.action,
  (action) => {
    if (!action) {
      showTemplateEditor.value = false;
      showImportTemplate.value = false;
    }
  },
);

const getTemplates = () => {
  const dismiss = q.notify({
    spinner: true,
    message: "Please wait while loading templates...",
  });

  templateService
    .list({
      org_identifier: store.state.selectedOrganization.identifier,
    })
    .then((res) => {
      resultTotal.value = res.data.length;
      templates.value = res.data.map((data: any, index: number) => ({
        ...data,
        "#": index + 1 <= 9 ? `0${index + 1}` : index + 1,
      }));
      updateRoute();
    })
    .catch((err) => {
      dismiss();
      if (err.response.status !== 403) {
        q.notify({
          type: "negative",
          message: "Error while pulling templates.",
          timeout: 2000,
        });
      }
    })
    .finally(() => {
      dismiss();
    });
};
const updateRoute = () => {
  if (router.currentRoute.value.query.action === "add") editTemplate();
  if (router.currentRoute.value.query.action === "update")
    editTemplate(
      getTemplateByName(router.currentRoute.value.query.name as string),
    );
  if (router.currentRoute.value.query.action === "import") {
    showImportTemplate.value = true;
  }
};
const getTemplateByName = (name: string) => {
  return templates.value.find((template) => template.name === name);
};
const editTemplate = (template: any = null) => {
  if (!template) {
    track("Button Click", {
      button: "Add Template",
      page: "Alert Templates"
    });
  }
  resetEditingTemplate();
  toggleTemplateEditor();

  const query: { [key: string]: string } = {
    action: template ? "update" : "add",
    org_identifier: store.state.selectedOrganization.identifier,
  };

  if (template) query.name = template.name;

  if (router.currentRoute.value.query.type)
    query.type = router.currentRoute.value.query.type.toString() as string;

  if (!template) {
    router.push({
      name: "alertTemplates",
      query,
    });
  } else {
    editingTemplate.value = { ...template };
    router.push({
      name: "alertTemplates",
      query: {
        action: "update",
        name: template.name,
        org_identifier: store.state.selectedOrganization.identifier,
      },
    });
  }
};
const resetEditingTemplate = () => {
  editingTemplate.value = null;
};
const deleteTemplate = () => {
  if (confirmDelete.value?.data?.name) {
    templateService
      .delete({
        org_identifier: store.state.selectedOrganization.identifier,
        template_name: confirmDelete.value.data.name,
      })
      .then(() => {
        q.notify({
          type: "positive",
          message: `Template ${confirmDelete.value.data.name} deleted successfully`,
          timeout: 2000,
        });

        getTemplates();
      })
      .catch((err) => {
        if (err.response.data.code === 409) {
          q.notify({
            type: "negative",
            message: err.response.data.message,
            timeout: 2000,
          });
        }
      });
  }
};
const importTemplate = () => {
  showImportTemplate.value = true;
  router.push({
    name: "alertTemplates",
    query: {
      action: "import",
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
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
  if (!showTemplateEditor.value)
    router.push({
      name: "alertTemplates",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
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
const exportTemplate = (row: any) => {
  const findTemplate: any = getTemplateByName(row.name);
  const templateByName = { ...findTemplate };
  if (templateByName.hasOwnProperty("#")) delete templateByName["#"];
  const templateJson = JSON.stringify(templateByName, null, 2);
  const blob = new Blob([templateJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  // Create an anchor element to trigger the download
  const link = document.createElement("a");
  link.href = url;

  // Set the filename of the download
  link.download = `${templateByName.name}.json`;

  // Trigger the download by simulating a click
  link.click();

  // Clean up the URL object after download
  URL.revokeObjectURL(url);
};

const visibleRows = computed(() => {
  if (!filterQuery.value) return templates.value || [];
  return filterData(templates.value || [], filterQuery.value);
});
const hasVisibleRows = computed(() => visibleRows.value.length > 0);


// Watch visibleRows to sync resultTotal with search filter
watch(visibleRows, (newVisibleRows) => {
  resultTotal.value = newVisibleRows.length;
}, { immediate: true });

const openBulkDeleteDialog = () => {
  confirmBulkDelete.value = true;
};

const bulkDeleteTemplates = () => {
  const templateNames = selectedTemplates.value.map((template: any) => template.name);

  templateService
    .bulkDelete(store.state.selectedOrganization.identifier, { ids: templateNames })
    .then((res) => {
      const { successful, unsuccessful } = res.data;

      if (successful.length > 0 && unsuccessful.length === 0) {
        q.notify({
          type: "positive",
          message: `Successfully deleted ${successful.length} template(s)`,
          timeout: 2000,
        });
      } else if (successful.length > 0 && unsuccessful.length > 0) {
        q.notify({
          type: "warning",
          message: `Deleted ${successful.length} template(s), but ${unsuccessful.length} failed`,
          timeout: 3000,
        });
      } else if (unsuccessful.length > 0) {
        q.notify({
          type: "negative",
          message: `Failed to delete ${unsuccessful.length} template(s)`,
          timeout: 2000,
        });
      }

      selectedTemplates.value = [];
      confirmBulkDelete.value = false;
      getTemplates();
    })
    .catch((err: any) => {
      const errorMessage = err.response?.data?.message || err?.message || "Error while deleting templates. Please try again.";
      if (err.response?.status != 403 || err?.status != 403) {
        q.notify({
          type: "negative",
          message: errorMessage,
          timeout: 2000,
        });
      }
    });
};</script>
<style lang=""></style>
