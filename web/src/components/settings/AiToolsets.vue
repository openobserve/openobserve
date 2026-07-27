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
  <div class="p-0" style="min-height: inherit; height: calc(100vh - 88px)">
    <OPageLayout
      v-if="!showAddDialog"
      :title="t('aiToolset.header')"
      icon="smart-toy"
      :subtitle="t('settings.aiToolsetsPage.subtitle')"
      bleed
    >
      <template #actions>
        <OButton
          data-test="ai-toolsets-add-btn"
          variant="primary"
          size="sm-action"
          @click="addToolset"
          >{{ t("aiToolset.add") }}</OButton
        >
      </template>

      <!-- Table -->
      <div class="bg-card-glass-bg mt-2.5 overflow-hidden">
        <OTable
          :frame="false"
          :data="visibleRows"
          :columns="columns"
          row-key="id"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100]"
          sorting="client"
          :default-columns="false"
          show-index
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="settings-ai-toolsets"
          :show-global-filter="false"
        >
          <template #toolbar>
            <OSearchInput
              v-model="filterQuery"
              class="no-border o2-search-input w-64"
              :placeholder="t('aiToolset.search')"
            />
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="ai-toolsets-list-refresh-btn"
              @click="getData"
            >
              <OTooltip
                side="bottom"
                :content="t('common.refresh')"
                shortcut-id="aiToolsetsRefresh"
              />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-ai-toolsets"
              :filtered="!!filterQuery"
              @action="(id) => (id === 'clear-filters' ? (filterQuery = '') : addToolset())"
            />
          </template>

          <template #cell-kind="{ row }">
            <OTag type="aiToolsetKind" :value="row.kind" />
          </template>

          <template #cell-actions="{ row }">
            <OButton
              :data-test="`ai-toolset-${row.name}-edit`"
              data-row-action="edit"
              variant="ghost"
              size="icon-sm"
              :title="t('common.edit')"
              @click="editToolset(row)"
              icon-left="edit"
            />
            <OButton
              :data-test="`ai-toolset-${row.name}-delete`"
              data-row-action="delete"
              variant="ghost-destructive"
              size="icon-sm"
              :title="t('common.delete')"
              @click="confirmDeleteToolset(row)"
              icon-left="delete"
            />
          </template>
        </OTable>
      </div>
    </OPageLayout>

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
import { defineComponent, ref, computed, watch, onMounted, onUpdated, Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AddAiToolset from "@/components/ai_toolsets/AddAiToolset.vue";
import aiToolsetsService from "@/services/ai_toolsets";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "PageAiToolsets",
  components: {
    OPageLayout,
    OEmptyState,
    ConfirmDialog,
    AddAiToolset,
    OButton,
    OTooltip,
    OTag,
    OSearchInput,
    OTable,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();

    const tabledata: any = ref([]);
    const showAddDialog = ref(false);
    const loading = ref(false);
    const filterQuery = ref("");

    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("aiToolset.name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "kind",
        header: t("aiToolset.kind"),
        accessorKey: "kind",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.type,
        meta: { align: "left" },
      },
      {
        id: "description",
        header: t("aiToolset.description"),
        accessorKey: "description",
        resizable: true,
        hideable: true,
        size: COL.description,
        meta: { align: "left" },
      },
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
      },
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
      const dismiss = toast({
        variant: "loading",
        message: t("common.loading"),
        timeout: 0,
      });

      aiToolsetsService
        .list(store.state.selectedOrganization.identifier)
        .then((res) => {
          const items = res.data?.toolsets ?? [];
          tabledata.value = items.map((item: any) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            description: item.description || "",
          }));
          resultTotal.value = tabledata.value.length;
        })
        .catch((err) => {
          if (err?.status !== 403) {
            toast({
              variant: "error",
              message: err?.response?.data?.message || t("aiToolset.loadFailed"),
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
          (r.description || "").toLowerCase().includes(q),
      );
    });

    watch(
      visibleRows,
      (rows) => {
        resultTotal.value = rows.length;
      },
      { immediate: true },
    );

    useShortcuts([
      {
        id: "aiToolsetsRefresh",
        handler: () => {
          if (!isInputFocused()) getData();
        },
      },
    ]);

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

      const dismiss = toast({
        variant: "loading",
        message: t("common.pleaseWait"),
        timeout: 0,
      });

      aiToolsetsService
        .delete(store.state.selectedOrganization.identifier, row.id)
        .then(() => {
          toast({ variant: "success", message: t("aiToolset.deletedSuccessfully") });
          getData();
        })
        .catch((err) => {
          if (err?.status !== 403) {
            toast({
              variant: "error",
              message: err?.response?.data?.message || t("aiToolset.deleteFailed"),
            });
          }
        })
        .finally(() => {
          dismiss();
          confirmDelete.value = { visible: false, data: null };
        });
    };

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
    };
  },
});
</script>
