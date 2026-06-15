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
  <div
    data-test="eval-template-list-page"
    class="tw:flex tw:flex-col tw:h-full tw:min-h-0"
  >
    <!-- Standard section header: title + section tabs + actions. -->
    <AppPageHeader
      :title="t('evalTemplate.header')"
      icon="fact-check"
      :subtitle="'Reusable scoring templates for LLM evaluations'"
      tabs-below
      class="tw:shrink-0 tw:px-4"
    >
      <template #title>
        <span data-test="eval-template-list-title">{{ t("evalTemplate.header") }}</span>
      </template>
      <template #tabs>
        <PipelineSectionTabs />
      </template>
      <template #actions>
        <OButton
          data-test="eval-template-list-refresh-btn"
          variant="outline"
          size="sm"
          @click="loadTemplates"
        >
          {{ t('common.refresh') }}
        </OButton>
        <OButton
          data-test="eval-template-list-add-btn"
          variant="primary"
          size="sm"
          @click="goToCreate"
        >
          {{ t('evalTemplate.newTemplate') }}
        </OButton>
      </template>
    </AppPageHeader>

    <!-- Table area -->
    <div class="tw:w-full tw:flex-1 tw:min-h-0 tw:overflow-hidden">
      <div class="card-container tw:h-full">
        <OTable
          :frame="false"
          data-test="eval-template-list-table"
          :data="rows"
          :columns="columns"
          row-key="id"
          :loading="isLoading"
          v-model:global-filter="filterQuery"
          :show-global-filter="false"
          filter-mode="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          selection="multiple"
          v-model:selected-ids="selectedIds"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="pipelines-evaluation-templates"
          width="100%"
          class="tw:w-full tw:h-full"
        >
          <template #toolbar>
            <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
              <OSearchInput
                data-test="eval-template-list-search-input"
                v-model="filterQuery"
                class="tw:flex-1"
                :placeholder="t('evalTemplate.search')"
              />
            </div>
          </template>
          <!-- Version column -->
          <template #cell-version="{ row }">
            <span class="eval-version-badge">v{{ row.version }}</span>
          </template>

          <!-- Actions column -->
          <template #cell-actions="{ row }">
            <div class="tw:flex tw:items-center tw:justify-center actions-container">
              <OButton
                :data-test="`eval-template-list-${row.name}-edit-btn`"
                icon-left="edit"
                variant="ghost"
                size="icon-sm"
                :title="t('common.edit')"
                @click="goToEdit(row)"
              />
              <OButton
                :data-test="`eval-template-list-${row.name}-delete-btn`"
                icon-left="delete"
                variant="ghost-destructive"
                size="icon-sm"
                :title="t('common.delete')"
                @click="confirmDelete(row)"
              />
            </div>
          </template>

          <!-- Empty state -->
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-eval-templates"
              :filtered="!!filterQuery"
              @action="
                (id) => (id === 'clear-filters' ? (filterQuery = '') : goToCreate())
              "
            />
          </template>

          <!-- Pagination footer -->
          <template #bottom="bottomProps">
            <div
              class="tw:flex tw:items-center tw:justify-between tw:w-full tw:py-2"
            >
              <div
                class="tw:flex tw:items-center tw:font-bold tw:text-[14px] tw:mr-4"
              >
                {{ bottomProps.totalRows }} {{ t("evalTemplate.header") }}
              </div>
              <OButton
                v-if="selectedIds.length > 0"
                data-test="eval-template-list-bulk-delete-btn"
                icon-left="delete"
                variant="outline-destructive"
                size="sm"
                @click="openBulkDeleteDialog"
              >
                {{ t("common.delete") }}
              </OButton>
            </div>
          </template>
        </OTable>
      </div>
    </div>

    <!-- Single delete confirm dialog -->
    <ConfirmDialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @update:ok="deleteTemplate"
      @update:cancel="deleteDialog.show = false"
    />

    <!-- Bulk delete confirm dialog -->
    <ConfirmDialog
      v-model="bulkDeleteDialog.show"
      :title="bulkDeleteDialog.title"
      :message="bulkDeleteDialog.message"
      @update:ok="bulkDeleteTemplates"
      @update:cancel="bulkDeleteDialog.show = false"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, onBeforeMount, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { evalTemplateService } from "@/services/eval-template.service";
import OButton from '@/lib/core/Button/OButton.vue';
import OSearchInput from '@/lib/forms/SearchInput/OSearchInput.vue';
import PipelineSectionTabs from "@/components/pipeline/PipelineSectionTabs.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

interface Template {
  id: string;
  org_id: string;
  response_type: string;
  name: string;
  description?: string;
  content: string;
  dimensions: string[];
  version: number;
  created_at: number;
  updated_at: number;
}

const { t } = useI18n();
const store = useStore();
const router = useRouter();
// ── State ──────────────────────────────────────────────────────────────────────
const rows = ref<Template[]>([]);
const filterQuery = ref("");
const isLoading = ref(true);
const selectedIds = ref<string[]>([]);
const selectedItems = computed(() =>
  rows.value.filter((r: Template) => selectedIds.value.includes(r.id))
);
// ── Columns ────────────────────────────────────────────────────────────────────
const columns = ref<OTableColumnDef<Template>[]>([
  { id: "#", header: "#", accessorKey: "#", sortable: false, size: 67, meta: { align: "left" } },
  {
    id: "name",
    header: t("common.name"),
    accessorKey: "name",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.name,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "response_type",
    header: t("evalTemplate.responseType"),
    accessorKey: "response_type",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "version",
    header: t("common.version"),
    accessorKey: "version",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.version,
    meta: { align: "center" },
  },
  {
    id: "updated_at",
    header: t("common.updated_at"),
    accessorKey: "updated_at",
    sortable: true,
    resizable: true,
    hideable: true,
    size: COL.updatedAt,
    meta: {
      align: "left",
      format: (val: number) =>
        val
          ? new Date(val).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : t("evalTemplate.never"),
    },
  },
  {
    id: "actions",
    header: t("common.actions"),
    sortable: false,
    isAction: true,
    size: 80,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
  },
]);

// ── Delete dialogs ─────────────────────────────────────────────────────────────
const deleteDialog = ref({
  show: false,
  title: "",
  message: "",
  data: null as Template | null,
});

const bulkDeleteDialog = ref({
  show: false,
  title: "",
  message: "",
});
// ── Data loading ───────────────────────────────────────────────────────────────
const loadTemplates = async () => {
  isLoading.value = true;
  try {
    const orgId = store.state.selectedOrganization.identifier;
    const data = await evalTemplateService.listTemplates(orgId);
    rows.value = (data ?? []).map((item: Template, i: number) => ({
      "#": i + 1,
      ...item,
    }));
  } catch (err: any) {
    if (err?.response?.status !== 403) {
      toast({
        variant: "error",
        message: err?.response?.data?.message || t("evalTemplate.loadFailed"),
      });
    }
  } finally {
    isLoading.value = false;
  }
};

// ── Navigation ─────────────────────────────────────────────────────────────────
const goToCreate = () => {
  router.push({ name: "evalTemplatesAdd" });
};

const goToEdit = (template: Template) => {
  router.push({ name: "evalTemplatesEdit", params: { id: template.id } });
};

// ── Delete ─────────────────────────────────────────────────────────────────────
const confirmDelete = (template: Template) => {
  deleteDialog.value.show = true;
  deleteDialog.value.title = t("evalTemplate.deleteTemplate");
  deleteDialog.value.message = t("evalTemplate.deleteConfirmation", {
    name: template.name,
  });
  deleteDialog.value.data = template;
};

const deleteTemplate = async () => {
  const template = deleteDialog.value.data;
  if (!template) return;

  const dismiss = toast({ variant: "loading", message: t("common.loading"), timeout: 0 });

  try {
    const orgId = store.state.selectedOrganization.identifier;
    await evalTemplateService.deleteTemplate(orgId, template.id);
    toast({
      variant: "success",
      message: t("evalTemplate.deleteSuccess"),
    });
    await loadTemplates();
  } catch (err: any) {
    if (err?.response?.status !== 403) {
      toast({
        variant: "error",
        message:
          err?.response?.data?.message ||
          err?.message ||
          t("evalTemplate.deleteFailed"),
      });
    }
  } finally {
    dismiss();
    deleteDialog.value.show = false;
    deleteDialog.value.data = null;
  }
};

const openBulkDeleteDialog = () => {
  bulkDeleteDialog.value.show = true;
  bulkDeleteDialog.value.title = t("evalTemplate.deleteTemplate");
  bulkDeleteDialog.value.message = t("evalTemplate.bulkDeleteConfirmation", {
    count: selectedItems.value.length,
  });
};

const bulkDeleteTemplates = async () => {
  const dismiss = toast({ variant: "loading", message: t("common.loading"), timeout: 0 });

  try {
    const orgId = store.state.selectedOrganization.identifier;
    await Promise.all(
      selectedItems.value.map((item) =>
        evalTemplateService.deleteTemplate(orgId, item.id),
      ),
    );
    toast({ variant: "success", message: t("evalTemplate.deleteSuccess") });
    selectedItems.value = [];
    await loadTemplates();
  } catch (err: any) {
    if (err?.response?.status !== 403) {
      toast({
        variant: "error",
        message: err?.response?.data?.message || t("evalTemplate.deleteFailed"),
      });
    }
  } finally {
    dismiss();
    bulkDeleteDialog.value.show = false;
  }
};

// ── Lifecycle ──────────────────────────────────────────────────────────────────
onBeforeMount(async () => {
  await loadTemplates();
});
</script>

<style scoped lang="scss">
.eval-version-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: var(--text-xs);
  font-weight: 600;
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.15));
  color: var(--q-color-text);
  background: transparent;
}
</style>
