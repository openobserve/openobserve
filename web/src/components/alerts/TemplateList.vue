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
  <div class="tw:rounded-md tw:flex tw:flex-col tw:h-full tw:p-0">
    <div v-if="!showImportTemplate && !showTemplateEditor" class="tw:flex tw:flex-col tw:h-full">
      <!-- Standard section header: title + actions only. Search moved to toolbar. -->
      <AppPageHeader
        :title="t('alert_templates.header')"
        icon="description"
        :subtitle="'Reusable alert message templates'"
        class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
      >
        <template #actions>
          <OToggleGroup
            :model-value="activeTab"
            @update:model-value="(v: any) => { activeTab = v; }"
            data-test="template-list-tabs"
            class="tw:mr-2"
          >
            <OToggleGroupItem value="all" size="sm" data-test="template-tab-all">
              <template #icon-left><OIcon name="format-list-bulleted" size="sm" /></template>
              {{ t("alert_templates.filterAll") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="prebuilt" size="sm" data-test="template-tab-prebuilt">
              <template #icon-left><OIcon name="auto-awesome" size="sm" /></template>
              {{ t("alert_templates.filterPrebuilt") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="custom" size="sm" data-test="template-tab-custom">
              <template #icon-left><OIcon name="settings" size="sm" /></template>
              {{ t("alert_templates.filterCustom") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OButton
            variant="outline"
            size="sm-action"
            @click="importTemplate"
            data-test="template-import"
            >{{ t(`dashboard.import`) }}</OButton
          >
          <OButton
            data-test="template-list-add-btn"
            variant="primary"
            size="sm"
            @click="editTemplate(null)"
            >{{ t(`alert_templates.add`) }}</OButton
          >
        </template>
      </AppPageHeader>
      <div class="card-container tw:flex-1 tw:min-h-0 tw:overflow-hidden">
      <OTable
        :frame="false"
        data-test="alert-templates-list-table"
        :data="visibleRows"
        :columns="columns"
        row-key="name"
        :loading="loading"
        :selected-ids="selectedTemplateIds"
        selection="multiple"
        :is-row-selectable="isTemplateRowSelectable"
        pagination="client"
        :page-size="20"
        :page-size-options="[5, 10, 20, 50, 100]"
        :footer-title="t('alert_templates.header')"
        sorting="client"
        filter-mode="client"
        :default-columns="false"
        :show-global-filter="false"
        @update:selected-ids="handleSelectedIdsUpdate"
      >
        <template #toolbar>
          <OSearchInput
            v-model="filterQuery"
            class="tw:flex-1"
            :placeholder="t('template.search')"
          />
        </template>
        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-alert-templates"
            :filtered="!!filterQuery"
            :hide-action="!filterQuery"
            @action="(id) => id === 'clear-filters' && (filterQuery = '')"
          />
        </template>
        <template #cell-name="{ row }">
          <div class="tw:flex tw:items-center tw:gap-2">
            <span>{{ row.name }}</span>
            <span
              v-if="row.isPrebuilt"
              class="dimension-badge badge-blue"
              :title="t('alert_templates.prebuiltBadgeHint')"
              data-test="alert-template-prebuilt-badge"
            >{{ t('alert_templates.prebuiltBadge') }}</span>
            <span
              v-else
              class="dimension-badge"
              data-test="alert-template-custom-badge"
            >{{ t('alert_templates.customBadge') }}</span>
          </div>
        </template>
        <template #cell-actions="{ row }">
          <OButton
            title="Export Template"
            class="tw:ml-1"
            variant="ghost"
            size="icon-sm"
            @click.stop="exportTemplate(row)"
            data-test="destination-export"
          >
            <OIcon name="download" size="sm" />
          </OButton>
          <OButton
            :data-test="`alert-template-list-${row.name}-update-template`"
            class="tw:ml-1"
            variant="ghost"
            size="icon-sm"
            :title="row.isPrebuilt ? t('alert_templates.systemReadOnly') : t('alert_templates.edit')"
            :disabled="row.isPrebuilt"
            @click="editTemplate(row)"
          >
            <OIcon name="edit" size="sm" />
          </OButton>
          <OButton
            :data-test="`alert-template-list-${row.name}-clone-template`"
            class="tw:ml-1"
            variant="ghost"
            size="icon-sm"
            :title="t('alert_templates.clone')"
            @click="cloneTemplate(row)"
          >
            <OIcon name="content-copy" size="sm" />
          </OButton>
          <OButton
            :data-test="`alert-template-list-${row.name}-delete-template`"
            class="tw:ml-1"
            variant="ghost"
            size="icon-sm"
            :title="row.isPrebuilt ? t('alert_templates.systemReadOnly') : t('alert_templates.delete')"
            :disabled="row.isPrebuilt"
            @click="conformDeleteDestination(row)"
          >
            <OIcon name="delete" size="sm" />
          </OButton>
        </template>
        <template
          v-if="selectedTemplates.length > 0"
          #bottom
        >
          <span class="tw:text-xs tw:text-text-primary">
            {{ selectedTemplates.length }} selected
          </span>
          <OButton
            data-test="template-list-delete-templates-btn"
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            @click="openBulkDeleteDialog"
          >
            Delete
          </OButton>
        </template>
      </OTable>
      </div>
    </div>
    <div v-else-if="!showImportTemplate && showTemplateEditor">
      <AddTemplate
        :template="editingTemplate"
        :is-clone="cloningTemplate"
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
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import templateService from "@/services/alert_templates";
import ConfirmDialog from "../ConfirmDialog.vue";
import type { TemplateData, Template } from "@/ts/interfaces";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import ImportTemplate from "./ImportTemplate.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { TABLE_INDEX_COL_SIZE } from "@/lib/core/Table/OTable.types";

const AddTemplate = defineAsyncComponent(
  () => import("@/components/alerts/AddTemplate.vue"),
);

const store = useStore();
const { t } = useI18n();
const router = useRouter();
const { track } = useReo();
const templates: Ref<Template[]> = ref([]);
const columns: OTableColumnDef[] = [
  {
    id: "#",
    header: "#",
    accessorKey: "#",
    size: TABLE_INDEX_COL_SIZE,
    meta: { align: "left" },
  },
  {
    id: "name",
    header: t("alert_templates.name"),
    accessorKey: "name",
    sortable: true,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "actions",
    header: t("alert_templates.actions"),
    isAction: true,
    pinned: "right",
    size: 150,
    meta: { align: "center", actionCount: 4 },
  },
];
const showTemplateEditor = ref(false);
const showImportTemplate = ref(false);
const editingTemplate: Ref<TemplateData | null> = ref(null);
// True when the editor was opened via the clone action — the AddTemplate
// form should treat the prefilled data as a fresh template (not an update).
const cloningTemplate = ref(false);
const resultTotal = ref<number>(0);

const confirmDelete: Ref<{
  visible: boolean;
  data: any;
}> = ref({ visible: false, data: null });
const selectedTemplates: Ref<any[]> = ref([]);
const confirmBulkDelete = ref(false);
const filterQuery = ref("");
// Top-right tab filter — mirrors the alerts list pattern. "prebuilt" shows
// system templates (name starts with `prebuilt_`), "custom" shows the rest.
const activeTab = ref<"all" | "prebuilt" | "custom">("all");

const selectedTemplateIds = computed(() =>
  selectedTemplates.value.map((item: any) => item.name),
);

const handleSelectedIdsUpdate = (ids: string[]) => {
  const map = new Map(templates.value.map((r: any) => [r.name, r]));
  // OTable's "Select All" header ignores `isRowSelectable` and emits every
  // visible row's id; strip prebuilt rows here so they can never land in the
  // bulk-delete payload.
  selectedTemplates.value = ids
    .map((id: any) => map.get(id))
    .filter((r: any) => r && !r.isPrebuilt);
};

// Disables the individual row checkbox for prebuilt templates. The select-all
// filtering happens in `handleSelectedIdsUpdate` above, since that's the only
// signal we get when the header checkbox is used.
const isTemplateRowSelectable = (row: any) => !row?.isPrebuilt;
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

const loading = ref(false);
const getTemplates = () => {
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while loading templates...",
      timeout: 0,
});

  loading.value = true;
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
        toast({
          variant: "error",
          message: "Error while pulling templates.",
        });
      }
    })
    .finally(() => {
      dismiss();
      loading.value = false;
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
  cloningTemplate.value = false;
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
const cloneTemplate = (template: any) => {
  track("Button Click", {
    button: "Clone Template",
    page: "Alert Templates",
  });
  // Pre-fill the editor with a copy of the source template. AddTemplate
  // treats this as a create (since isClone=true), so the user can rename
  // and save without overwriting the original.
  // Underscored prefix because template names reject spaces and the other
  // reserved characters (':', '#', '?', '&', '%', '/', quotes).
  editingTemplate.value = {
    ...template,
    name: `Copy_of_${template.name}`,
  };
  cloningTemplate.value = true;
  showTemplateEditor.value = true;
  router.push({
    name: "alertTemplates",
    query: {
      action: "add",
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};
const deleteTemplate = () => {
  if (confirmDelete.value?.data?.name) {
    templateService
      .delete({
        org_identifier: store.state.selectedOrganization.identifier,
        template_name: confirmDelete.value.data.name,
      })
      .then(() => {
        toast({
          variant: "success",
          message: `Template ${confirmDelete.value.data.name} deleted successfully`,
        });

        getTemplates();
      })
      .catch((err) => {
        if (err.response.data.code === 409) {
          toast({
            variant: "error",
            message: err.response.data.message,
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
  const base = templates.value || [];
  const byTab =
    activeTab.value === "prebuilt"
      ? base.filter((t: any) => !!t.isPrebuilt)
      : activeTab.value === "custom"
        ? base.filter((t: any) => !t.isPrebuilt)
        : base;
  if (!filterQuery.value) return byTab;
  return filterData(byTab, filterQuery.value);
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
        toast({
          variant: "success",
          message: `Successfully deleted ${successful.length} template(s)`,
        });
      } else if (successful.length > 0 && unsuccessful.length > 0) {
        toast({
          variant: "warning",
          message: `Deleted ${successful.length} template(s), but ${unsuccessful.length} failed`,
        });
      } else if (unsuccessful.length > 0) {
        toast({
          variant: "error",
          message: `Failed to delete ${unsuccessful.length} template(s)`,
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
        toast({
          variant: "error",
          message: errorMessage,
        });
      }
    });
};
</script>
<style lang="scss" scoped>
// Badge style copied from ModelPricingList.vue so the "Prebuilt" / "Default"
// labels match the LLM-pricing list visually.
.dimension-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid #d1d5db;
  color: inherit;
}

.badge-blue {
  border: 1px solid #1d4ed8;
}

.badge-green {
  border: 1px solid #065f46;
}

:global(body.body--dark) .dimension-badge {
  color: #ffffff;
  border-color: #4b5563;
}

:global(body.body--dark) .badge-blue {
  border-color: #93c5fd;
}

:global(body.body--dark) .badge-green {
  border-color: #6ee7b7;
}
</style>
