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
    class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]"
  >
    <!-- Header bar -->
    <div class="card-container tw:mb-[0.625rem]">
      <div
        class="flex justify-between full-width tw:py-3 tw:px-4 tw:h-[68px] items-center"
      >
        <div
          class="q-table__title tw:font-[600]"
          data-test="eval-template-list-title"
        >
          {{ t("evalTemplate.header") }}
        </div>

        <div class="flex q-ml-auto tw:ps-2 items-center">
          <!-- Search input -->
          <q-input
            data-test="eval-template-list-search-input"
            v-model="filterQuery"
            borderless
            dense
            class="no-border o2-search-input"
            :placeholder="t('evalTemplate.search')"
          >
            <template #prepend>
              <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </q-input>

          <!-- Refresh button -->
          <OButton
            data-test="eval-template-list-refresh-btn"
            variant="outline"
            size="sm-action"
            class="q-ml-sm"
            @click="loadTemplates"
          >
            {{ t('common.refresh') }}
          </OButton>

          <!-- Add button -->
          <OButton
            data-test="eval-template-list-add-btn"
            variant="primary"
            size="sm-action"
            class="q-ml-sm"
            @click="goToCreate"
          >
            {{ t('evalTemplate.newTemplate') }}
          </OButton>
        </div>
      </div>
    </div>

    <!-- Table area -->
    <div class="tw:w-full tw:h-full">
      <div class="card-container tw:h-[calc(100vh-127px)]">
        <q-table
          data-test="eval-template-list-table"
          ref="qTableRef"
          :rows="isLoading ? [] : visibleRows"
          :columns="columns"
          row-key="id"
          :loading="isLoading"
          :pagination="pagination"
          selection="multiple"
          v-model:selected="selectedItems"
          style="width: 100%"
          :style="
            !isLoading && hasVisibleRows
              ? 'width: 100%; height: calc(100vh - var(--navbar-height) - 87px)'
              : 'width: 100%'
          "
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
        >
          <!-- Custom header with select-all checkbox -->
          <template v-slot:header="props">
            <q-tr :props="props">
              <q-th v-if="columns.length > 0" auto-width>
                <q-checkbox
                  v-model="props.selected"
                  size="sm"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-table-checkbox-dark'
                      : 'o2-table-checkbox-light'
                  "
                  class="o2-table-checkbox"
                />
              </q-th>
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

          <!-- Row selection checkbox -->
          <template v-slot:body-selection="scope">
            <q-checkbox
              v-model="scope.selected"
              size="sm"
              class="o2-table-checkbox"
            />
          </template>

          <!-- Version column -->
          <template v-slot:body-cell-version="props">
            <q-td :props="props" class="tw:text-center">
              <span class="eval-version-badge">v{{ props.row.version }}</span>
            </q-td>
          </template>

          <!-- Actions column -->
          <template v-slot:body-cell-actions="props">
            <q-td :props="props">
              <div class="tw:flex tw:items-center tw:justify-center actions-container">
                <OButton
                  :data-test="`eval-template-list-${props.row.name}-edit-btn`"
                  icon-left="edit"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('common.edit')"
                  @click="goToEdit(props.row)"
                />
                <OButton
                  :data-test="`eval-template-list-${props.row.name}-delete-btn`"
                  icon-left="delete"
                  variant="ghost-destructive"
                  size="icon-sm"
                  :title="t('common.delete')"
                  @click="confirmDelete(props.row)"
                />
              </div>
            </q-td>
          </template>

          <!-- Loading state -->
          <template #loading>
            <div class="tw:flex tw:items-center tw:justify-center tw:py-20">
              <q-spinner-hourglass color="primary" size="3rem" />
            </div>
          </template>

          <!-- Empty state -->
          <template #no-data>
            <div
              v-if="!isLoading"
              class="tw:flex tw:items-center tw:justify-center tw:w-full tw:h-full"
            >
              <NoData />
            </div>
          </template>

          <!-- Pagination footer -->
          <template #bottom="scope">
            <div
              class="tw:flex tw:items-center tw:justify-between tw:w-full tw:py-2"
            >
              <div class="tw:flex tw:items-center tw:gap-2">
                <div
                  class="o2-table-footer-title tw:flex tw:items-center tw:whitespace-nowrap"
                >
                  {{ resultTotal }} {{ t("evalTemplate.header") }}
                </div>
                <OButton
                  v-if="selectedItems.length > 0"
                  data-test="eval-template-list-bulk-delete-btn"
                  icon-left="delete"
                  variant="outline"
                  size="sm-action"
                  @click="openBulkDeleteDialog"
                >
                  {{ t("common.delete") }}
                </OButton>
              </div>
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
import { ref, onBeforeMount, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { evalTemplateService } from "@/services/eval-template.service";
import OButton from '@/lib/core/Button/OButton.vue';


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
const q = useQuasar();
const store = useStore();
const router = useRouter();
const qTableRef: any = ref({});

// ── State ──────────────────────────────────────────────────────────────────────
const rows = ref<Template[]>([]);
const filterQuery = ref("");
const selectedItems = ref<any[]>([]);
const isLoading = ref(false);

// ── Pagination ─────────────────────────────────────────────────────────────────
const perPageOptions: any = [
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "250", value: 250 },
  { label: "500", value: 500 },
];
const resultTotal = ref<number>(0);
const selectedPerPage = ref<number>(20);
const pagination: any = ref({ rowsPerPage: 20 });

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  qTableRef.value?.setPagination(pagination.value);
};

// ── Columns ────────────────────────────────────────────────────────────────────
const columns: any = ref([
  { name: "#", label: "#", field: "#", align: "left", style: "width: 67px" },
  {
    name: "name",
    label: t("common.name"),
    field: "name",
    align: "left",
    sortable: true,
  },
  {
    name: "response_type",
    label: t("evalTemplate.responseType"),
    field: "response_type",
    align: "left",
    sortable: true,
  },
  {
    name: "version",
    label: t("common.version"),
    field: "version",
    align: "center",
    sortable: true,
  },
  {
    name: "updated_at",
    label: t("common.updated_at"),
    field: "updated_at",
    align: "left",
    sortable: true,
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
  {
    name: "actions",
    label: t("common.actions"),
    field: "actions",
    align: "center",
    sortable: false,
    classes: "actions-column",
    style: "width: 80px; min-width: 80px;",
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

// ── Computed: filtered rows ────────────────────────────────────────────────────
const filterData = (items: Template[], term: string) => {
  const lc = term.toLowerCase();
  return items.filter((r) => r.name?.toLowerCase().includes(lc));
};

const visibleRows = computed(() => {
  if (!filterQuery.value) return rows.value;
  return filterData(rows.value, filterQuery.value);
});

const hasVisibleRows = computed(() => visibleRows.value.length > 0);

watch(
  visibleRows,
  (newRows) => {
    resultTotal.value = newRows.length;
  },
  { immediate: true },
);

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
      q.notify({
        type: "negative",
        message: err?.response?.data?.message || t("evalTemplate.loadFailed"),
        timeout: 3000,
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

  const dismiss = q.notify({ spinner: true, message: t("common.loading"), timeout: 0 });

  try {
    const orgId = store.state.selectedOrganization.identifier;
    await evalTemplateService.deleteTemplate(orgId, template.id);
    q.notify({
      type: "positive",
      message: t("evalTemplate.deleteSuccess"),
      timeout: 2000,
    });
    await loadTemplates();
  } catch (err: any) {
    if (err?.response?.status !== 403) {
      q.notify({
        type: "negative",
        message:
          err?.response?.data?.message ||
          err?.message ||
          t("evalTemplate.deleteFailed"),
        timeout: 3000,
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
  const dismiss = q.notify({ spinner: true, message: t("common.loading"), timeout: 0 });

  try {
    const orgId = store.state.selectedOrganization.identifier;
    await Promise.all(
      selectedItems.value.map((item) =>
        evalTemplateService.deleteTemplate(orgId, item.id),
      ),
    );
    q.notify({ type: "positive", message: t("evalTemplate.deleteSuccess"), timeout: 2000 });
    selectedItems.value = [];
    await loadTemplates();
  } catch (err: any) {
    if (err?.response?.status !== 403) {
      q.notify({
        type: "negative",
        message: err?.response?.data?.message || t("evalTemplate.deleteFailed"),
        timeout: 3000,
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
