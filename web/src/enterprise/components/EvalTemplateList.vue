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
    class="tw:flex tw:flex-col tw:h-full tw:min-h-0 tw:pr-[0.625rem]"
  >
    <!-- Header bar -->
    <div class="tw:shrink-0">
      <div class="card-container tw:mb-[0.625rem]">
        <div
          class="tw:flex tw:justify-between tw:items-center tw:py-3 tw:px-4 tw:h-[68px]"
        >
          <div
            class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]"
            data-test="eval-template-list-title"
          >
            {{ t("evalTemplate.header") }}
          </div>

          <div class="tw:flex tw:ml-auto tw:ps-2 tw:items-center">
            <!-- Search input -->
            <OSearchInput
              data-test="eval-template-list-search-input"
              v-model="filterQuery"
              class="tw:ml-2 tw:w-[200px]"
              :placeholder="t('evalTemplate.search')"
            />

            <!-- Refresh button -->
            <OButton
              data-test="eval-template-list-refresh-btn"
              variant="outline"
              size="sm"
              class="tw:ml-2"
              @click="loadTemplates"
            >
              {{ t('common.refresh') }}
            </OButton>

            <!-- Add button -->
            <OButton
              data-test="eval-template-list-add-btn"
              variant="primary"
              size="sm"
              class="tw:ml-2"
              @click="goToCreate"
            >
              {{ t('evalTemplate.newTemplate') }}
            </OButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Table area -->
    <div class="tw:flex-1 tw:min-h-0">
      <div class="card-container tw:h-full">
        <OTable
          data-test="eval-template-list-table"
          :data="rows"
          :columns="columns"
          row-key="id"
          :loading="isLoading"
          :global-filter="filterQuery"
          :show-global-filter="false"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          selection="multiple"
          v-model:selected-ids="selectedIds"
          width="100%"
          class="tw:w-full tw:h-full"
        >
          <!-- Version column -->
          <template #cell-version="{ row }">
            <span class="eval-version-badge">v{{ row.version }}</span>
          </template>

          <!-- Actions column -->
          <template #cell-actions="{ row }">
            <div class="tw:flex tw:items-center tw:justify-center actions-container">
              <OButton
                :data-test="`eval-template-list-${row.name}-edit-btn`"
                data-row-action="edit"
                icon-left="edit"
                variant="ghost"
                size="icon-sm"
                :title="t('common.edit')"
                @click="goToEdit(row)"
              />
              <OButton
                :data-test="`eval-template-list-${row.name}-delete-btn`"
                data-row-action="delete"
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
            <NoData />
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
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { evalTemplateService } from "@/services/eval-template.service";
import OButton from '@/lib/core/Button/OButton.vue';
import OSearchInput from '@/lib/forms/SearchInput/OSearchInput.vue';
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
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "response_type",
    header: t("evalTemplate.responseType"),
    accessorKey: "response_type",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "version",
    header: t("common.version"),
    accessorKey: "version",
    sortable: true,
    meta: { align: "center" },
  },
  {
    id: "updated_at",
    header: t("common.updated_at"),
    accessorKey: "updated_at",
    sortable: true,
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
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.15));
  color: var(--q-color-text);
  background: transparent;
}
</style>
