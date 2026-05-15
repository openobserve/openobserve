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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <OPage class="q-pa-none" style="min-height: inherit; height: calc(100vh - 88px);">
    <div v-if="!showAddDialog">
      <!-- Header bar -->
      <div
        class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
      >
        <div
          class="q-table__title tw:font-[600]"
          data-test="ai-toolsets-list-title"
        >
          {{ t("aiToolset.header") }}
        </div>
        <div class="col-auto flex">
          <q-input
            v-model="filterQuery"
            borderless
            dense
            class="q-ml-auto no-border o2-search-input"
            :placeholder="t('aiToolset.search')"
          >
            <template #prepend>
              <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </q-input>
          <OButton
            class="q-ml-sm"
            data-test="ai-toolsets-add-btn"
            variant="primary"
            size="sm-action"
            @click="addToolset"
          >{{ t('aiToolset.add') }}</OButton>
        </div>
      </div>

      <!-- Table -->
      <q-table
        ref="qTable"
        :rows="visibleRows"
        :columns="columns"
        row-key="id"
        :pagination="pagination"
        class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
        :style="
          hasVisibleRows
            ? 'width: 100%; height: calc(100vh - 112px); overflow-y: auto;'
            : 'width: 100%'
        "
      >
        <template #no-data><NoData /></template>

        <template v-slot:header="props">
          <q-tr :props="props">
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

        <template v-slot:body-cell-kind="props">
          <q-td :props="props">
            <q-badge
              :color="kindBadgeColor(props.row.kind)"
              :label="props.row.kind.toUpperCase()"
              class="tw:text-xs"
            />
          </q-td>
        </template>

        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <OButton
              :data-test="`ai-toolset-${props.row.name}-edit`"
              variant="ghost"
              size="icon-xs-sq"
              :title="t('common.edit')"
              @click="editToolset(props.row)"
            >
              <template #icon-left><Pencil class="tw:size-3.5 tw:shrink-0" /></template>
            </OButton>
            <OButton
              :data-test="`ai-toolset-${props.row.name}-delete`"
              variant="ghost-destructive"
              size="icon-xs-sq"
              :title="t('common.delete')"
              @click="confirmDeleteToolset(props.row)"
            >
              <template #icon-left><Trash2 class="tw:size-3.5 tw:shrink-0" /></template>
            </OButton>
          </q-td>
        </template>

        <template #bottom="scope">
          <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
            <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[150px] tw:mr-md">
              {{ resultTotal }} {{ t("aiToolset.header") }}
            </div>
            <QTablePagination
              :scope="scope"
              :resultTotal="resultTotal"
              :perPageOptions="perPageOptions"
              position="bottom"
              @update:changeRecordPerPage="changePagination"
            />
          </div>
        </template>
      </q-table>
    </div>

    <!-- Add / Edit form -->
    <div v-else>
      <AddAiToolset @cancel:hideform="hideAddDialog" />
    </div>
  </OPage>

  <!-- Delete confirmation -->
  <ConfirmDialog
    :title="t('aiToolset.deleteTitle')"
    :message="t('aiToolset.deleteMessage', { name: confirmDelete.data?.name ?? '' })"
    @update:ok="deleteToolset"
    @update:cancel="cancelDelete"
    v-model="confirmDelete.visible"
  />
</template>

<script lang="ts">

import {
  defineComponent,
  ref,
  computed,
  watch,
  onMounted,
  onUpdated,
  Ref,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import OButton from "@/lib/core/Button/OButton.vue";
import { Pencil, Trash2 } from "lucide-vue-next";

import QTablePagination from "@/components/shared/grid/Pagination.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AddAiToolset from "@/components/ai_toolsets/AddAiToolset.vue";
import aiToolsetsService from "@/services/ai_toolsets";

const KIND_COLORS: Record<string, string> = {
  mcp: "blue-7",
  cli: "green-7",
  skill: "purple-7",
  generic: "grey-7",
};

export default defineComponent({
  name: "PageAiToolsets",
  components: {
    QTablePagination,
    NoData,
    ConfirmDialog,
    AddAiToolset,
    OButton,
    Pencil,
    Trash2,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();

    const tabledata: any = ref([]);
    const showAddDialog = ref(false);
    const qTable: any = ref(null);
    const loading = ref(false);
    const filterQuery = ref("");

    const columns = ref<QTableProps["columns"]>([
      { name: "#", label: "#", field: "#", align: "left", style: "width: 52px" },
      { name: "name", field: "name", label: t("aiToolset.name"), align: "left", sortable: true },
      { name: "kind", field: "kind", label: t("aiToolset.kind"), align: "left", sortable: true, style: "width: 110px" },
      { name: "description", field: "description", label: t("aiToolset.description"), align: "left" },
      {
        name: "actions",
        field: "actions",
        label: t("aiToolset.actions"),
        align: "center",
        sortable: false,
        classes: "actions-column",
      },
    ]);

    const perPageOptions = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
    ];
    const resultTotal = ref(0);
    const pagination: any = ref({ rowsPerPage: 20 });
    const selectedPerPage = ref(20);

    const confirmDelete: Ref<{ visible: boolean; data: any }> = ref({
      visible: false,
      data: null,
    });

    // -----------------------------------------------------------------------
    // Route-driven show/hide form
    // -----------------------------------------------------------------------
    watch(
      () => router.currentRoute.value.query?.action,
      (action) => {
        showAddDialog.value = action === "add" || action === "edit";
      }
    );

    onMounted(() => {
      const action = router.currentRoute.value.query.action;
      if (action === "add" || action === "edit") showAddDialog.value = true;
    });

    onUpdated(() => {
      const action = router.currentRoute.value.query.action;
      showAddDialog.value = action === "add" || action === "edit";
    });

    // -----------------------------------------------------------------------
    // Data loading
    // -----------------------------------------------------------------------
    const getData = () => {
      loading.value = true;
      const dismiss = $q.notify({
        spinner: true,
        message: t("common.loading"),
      });

      aiToolsetsService
        .list(store.state.selectedOrganization.identifier)
        .then((res) => {
          const items = res.data?.toolsets ?? [];
          tabledata.value = items.map((item: any, i: number) => ({
            "#": i + 1,
            id: item.id,
            name: item.name,
            kind: item.kind,
            description: item.description || "",
          }));
          resultTotal.value = tabledata.value.length;
        })
        .catch((err) => {
          if (err?.status !== 403) {
            $q.notify({
              type: "negative",
              message:
                err?.response?.data?.message ||
                t("aiToolset.loadFailed"),
              timeout: 5000,
            });
          }
        })
        .finally(() => {
          loading.value = false;
          dismiss();
        });
    };

    getData();

    // -----------------------------------------------------------------------
    // Filter
    // -----------------------------------------------------------------------
    const visibleRows = computed(() => {
      const q = filterQuery.value.toLowerCase();
      if (!q) return tabledata.value;
      return tabledata.value.filter(
        (r: any) =>
          r.name.toLowerCase().includes(q) ||
          r.kind.toLowerCase().includes(q) ||
          (r.description || "").toLowerCase().includes(q)
      );
    });

    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    watch(visibleRows, (rows) => { resultTotal.value = rows.length; }, { immediate: true });

    // -----------------------------------------------------------------------
    // Navigation helpers
    // -----------------------------------------------------------------------
    const addToolset = () => {
      router.push({
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const editToolset = (row: any) => {
      router.push({
        query: {
          action: "edit",
          id: row.id,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const hideAddDialog = async () => {
      showAddDialog.value = false;
      await getData();
      router.push({
        name: "aiToolsets",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    };

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value?.setPagination(pagination.value);
    };

    // -----------------------------------------------------------------------
    // Delete
    // -----------------------------------------------------------------------
    const confirmDeleteToolset = (row: any) => {
      confirmDelete.value = { visible: true, data: row };
    };

    const cancelDelete = () => {
      confirmDelete.value = { visible: false, data: null };
    };

    const deleteToolset = () => {
      const row = confirmDelete.value.data;
      if (!row?.id) return;

      const dismiss = $q.notify({
        spinner: true,
        message: t("common.pleaseWait"),
        type: "warning",
      });

      aiToolsetsService
        .delete(store.state.selectedOrganization.identifier, row.id)
        .then(() => {
          $q.notify({ type: "positive", message: t("aiToolset.deletedSuccessfully"), timeout: 2000 });
          getData();
        })
        .catch((err) => {
          if (err?.status !== 403) {
            $q.notify({
              type: "negative",
              message: err?.response?.data?.message || t("aiToolset.deleteFailed"),
              timeout: 3000,
            });
          }
        })
        .finally(() => {
          dismiss();
          confirmDelete.value = { visible: false, data: null };
        });
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    const kindBadgeColor = (kind: string) => KIND_COLORS[kind] ?? "grey-6";

    return {
      t,
      store,
      qTable,
      loading,
      tabledata,
      columns,
      showAddDialog,
      pagination,
      perPageOptions,
      selectedPerPage,
      resultTotal,
      filterQuery,
      visibleRows,
      hasVisibleRows,
      confirmDelete,
      outlinedDelete,
      addToolset,
      editToolset,
      hideAddDialog,
      getData,
      changePagination,
      confirmDeleteToolset,
      cancelDelete,
      deleteToolset,
      kindBadgeColor,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
</style>
