<!-- Copyright 2026 OpenObserve Inc.

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
  <div class="tw:rounded-md q-pa-none"
    style="height: calc(100vh - 88px); min-height: inherit"
  >
    <div v-if="!showImportTemplate && !showTemplateEditor">
      <div
        class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
      >
        <div class="q-table__title tw:font-[600]" data-test="alert-templates-list-title">
            {{ t("alert_templates.header") }}
          </div>
          <div class="tw:flex tw:justify-end tw:gap-2">
            <OInput
              v-model="filterQuery"
              class="q-ml-auto no-border o2-search-input"
              :placeholder="t('template.search')"
            >
              <template #prepend>
                <OIcon class="o2-search-input-icon" name="search" size="sm" />
              </template>
            </OInput>
          <OButton
            variant="outline"
            size="sm-action"
            class="q-ml-sm"
            @click="importTemplate"
            data-test="template-import"
            >{{ t(`dashboard.import`) }}</OButton
          >
          <OButton
            data-test="template-list-add-btn"
            variant="primary"
            size="sm-action"
            class="q-ml-sm"
            @click="editTemplate(null)"
            >{{ t(`alert_templates.add`) }}</OButton
          >
        </div>
      </div>
      <OTable
        data-test="alert-templates-list-table"
        :data="visibleRows"
        :columns="columns"
        row-key="name"
        :selected-ids="selectedTemplateIds"
        selection="multiple"
        pagination="client"
        :page-size="20"
        :page-size-options="[5, 10, 20, 50, 100]"
        sorting="client"
        filter-mode="client"
        :default-columns="false"
        :show-global-filter="false"
        @update:selected-ids="handleSelectedIdsUpdate"
      >
        <template #empty>
          <NoData />
        </template>
        <template #cell-actions="{ row }">
          <OButton
            title="Export Template"
            class="q-ml-xs"
            variant="ghost"
            size="icon-circle-sm"
            @click.stop="exportTemplate(row)"
            data-test="destination-export"
          >
            <OIcon name="download" size="sm" />
          </OButton>
          <OButton
            :data-test="`alert-template-list-${row.name}-update-template`"
            class="q-ml-xs"
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alert_templates.edit')"
            @click="editTemplate(row)"
          >
            <OIcon name="edit" size="sm" />
          </OButton>
          <OButton
            :data-test="`alert-template-list-${row.name}-delete-template`"
            class="q-ml-xs"
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alert_templates.delete')"
            @click="conformDeleteDestination(row)"
          >
            <OIcon name="delete" size="sm" />
          </OButton>
        </template>
        <template
          v-if="selectedTemplates.length > 0"
          #bottom
        >
          <span class="tw:text-xs tw:text-text-primary tw:font-medium">
            {{ selectedTemplates.length }} selected
          </span>
          <OButton
            data-test="template-list-delete-templates-btn"
            variant="outline"
            size="sm"
            icon-left="delete"
            @click="openBulkDeleteDialog"
          >
            Delete
          </OButton>
        </template>
      </OTable>
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
  </div>
</template>
<script lang="ts" setup>
import {
  ref,
  onActivated,
  onMounted,
  watch,
  defineAsyncComponent,
  computed,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import templateService from "@/services/alert_templates";
import ConfirmDialog from "../ConfirmDialog.vue";
import type { TemplateData, Template } from "@/ts/interfaces";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ImportTemplate from "./ImportTemplate.vue";
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
const columns: OTableColumnDef[] = [
  {
    id: "#",
    header: "#",
    accessorKey: "#",
    size: 67,
    meta: { align: "left" },
  },
  {
    id: "name",
    header: t("alert_templates.name"),
    accessorKey: "name",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("alert_templates.actions"),
    isAction: true,
    pinned: "right",
    size: 120,
    meta: { align: "center" },
  },
];
const showTemplateEditor = ref(false);
const showImportTemplate = ref(false);
const editingTemplate: Ref<TemplateData | null> = ref(null);
const resultTotal = ref<number>(0);

const confirmDelete: Ref<{
  visible: boolean;
  data: any;
}> = ref({ visible: false, data: null });
const selectedTemplates: Ref<any[]> = ref([]);
const confirmBulkDelete = ref(false);
const filterQuery = ref("");

const selectedTemplateIds = computed(() =>
  selectedTemplates.value.map((item: any) => item.name),
);

const handleSelectedIdsUpdate = (ids: string[]) => {
  const map = new Map(templates.value.map((r: any) => [r.name, r]));
  selectedTemplates.value = ids.map((id: any) => map.get(id)).filter(Boolean);
};
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
      page: "Alert Templates",
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
// Watch visibleRows to sync resultTotal with search filter
watch(
  visibleRows,
  (newVisibleRows) => {
    resultTotal.value = newVisibleRows.length;
  },
  { immediate: true },
);

const openBulkDeleteDialog = () => {
  confirmBulkDelete.value = true;
};

const bulkDeleteTemplates = () => {
  const templateNames = selectedTemplates.value.map(
    (template: any) => template.name,
  );

  templateService
    .bulkDelete(store.state.selectedOrganization.identifier, {
      ids: templateNames,
    })
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
      const errorMessage =
        err.response?.data?.message ||
        err?.message ||
        "Error while deleting templates. Please try again.";
      if (err.response?.status != 403 || err?.status != 403) {
        q.notify({
          type: "negative",
          message: errorMessage,
          timeout: 2000,
        });
      }
    });
};
</script>
<style lang=""></style>
