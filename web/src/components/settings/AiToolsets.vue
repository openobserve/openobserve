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
  <div class="tw:rounded-md q-pa-none" style="min-height: inherit; height: calc(100vh - 88px);">
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
          <OInput
            v-model="filterQuery"
            class="q-ml-auto no-border o2-search-input"
            :placeholder="t('aiToolset.search')"
          >
            <template #prepend>
              <OIcon class="o2-search-input-icon" name="search" size="sm" />
            </template>
          </OInput>
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
      <OTable
        :data="visibleRows"
        :columns="columns"
        row-key="id"
        pagination="client"
        :page-size="20"
        :page-size-options="[20, 50, 100]"
        sorting="client"
        :default-columns="false"
        :show-global-filter="false"
      >
        <template #empty><NoData /></template>

        <template #cell-kind="{ row }">
          <OBadge
            :variant="kindBadgeVariant(row.kind)"
            size="sm"
          >{{ row.kind.toUpperCase() }}</OBadge>
        </template>

        <template #cell-actions="{ row }">
          <OButton
            :data-test="`ai-toolset-${row.name}-edit`"
            variant="ghost"
            size="icon-xs-sq"
            :title="t('common.edit')"
            @click="editToolset(row)"
            icon-left="edit"
          />
          <OButton
            :data-test="`ai-toolset-${row.name}-delete`"
            variant="ghost-destructive"
            size="icon-xs-sq"
            :title="t('common.delete')"
            @click="confirmDeleteToolset(row)"
            icon-left="delete"
          />
        </template>
      </OTable>
    </div>

    <!-- Add / Edit form -->
    <div v-else>
      <AddAiToolset @cancel:hideform="hideAddDialog" />
    </div>
  </div>

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
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";

import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AddAiToolset from "@/components/ai_toolsets/AddAiToolset.vue";
import aiToolsetsService from "@/services/ai_toolsets";

const KIND_VARIANTS: Record<string, string> = {
  mcp: "primary",
  cli: "success",
  skill: "primary-soft",
  generic: "default",
};

export default defineComponent({
  name: "PageAiToolsets",
  components: {
    NoData,
    ConfirmDialog,
    AddAiToolset,
    OButton,
    OIcon,
    OBadge,
    OInput,
    OTable,
},
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();

    const tabledata: any = ref([]);
    const showAddDialog = ref(false);
    const loading = ref(false);
    const filterQuery = ref("");

    const columns: OTableColumnDef[] = [
      { id: "#", header: "#", accessorKey: "#", size: 52, meta: { align: "left" } },
      { id: "name", header: t("aiToolset.name"), accessorKey: "name", sortable: true, meta: { align: "left" } },
      { id: "kind", header: t("aiToolset.kind"), accessorKey: "kind", sortable: true, size: 110, meta: { align: "left" } },
      { id: "description", header: t("aiToolset.description"), accessorKey: "description", meta: { align: "left" } },
      {
        id: "actions",
        header: t("aiToolset.actions"),
        isAction: true,
        pinned: "right",
        size: 80,
        meta: { align: "center" },
      },
    ];

    const resultTotal = ref(0);

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
    const kindBadgeVariant = (kind: string) => KIND_VARIANTS[kind] ?? "default";

    return {
      t,
      store,
      loading,
      tabledata,
      columns,
      showAddDialog,
      resultTotal,
      filterQuery,
      visibleRows,
      confirmDelete,
      addToolset,
      editToolset,
      hideAddDialog,
      getData,
      confirmDeleteToolset,
      cancelDelete,
      deleteToolset,
      kindBadgeVariant,
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
