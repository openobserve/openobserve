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
  <div class="flex h-full flex-col p-0">
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
          size="sm"
          :aria-label="
            toolsetDrafts.hasNew
              ? t('common.editorDraft.newDot', { label: t('aiToolset.add') })
              : undefined
          "
          @click="addToolset"
          >{{ t("aiToolset.add") }}
          <EditorDraftDot
            v-if="toolsetDrafts.hasNew"
            :saved-at="toolsetDrafts.savedAt(null)"
            corner
            data-test="ai-toolsets-add-draft-dot"
        /></OButton>
      </template>

      <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
        <OTable
          ref="oTableRef"
          :forbidden="forbidden"
          :frame="false"
          :data="visibleRows"
          :columns="columns"
          :row-actions="rowActions"
          row-actions-more-data-test="ai-toolsets-row-more-actions"
          row-key="id"
          :loading="loading"
          pagination="client"
          :page-size="pageSize"
          :page-size-options="[20, 50, 100]"
          :current-page="currentPage"
          :sort-by="sortBy"
          :sort-order="sortOrder"
          @update:page-size="pageSize = $event"
          @update:current-page="currentPage = $event"
          @update:sort-by="sortBy = $event"
          @update:sort-order="sortOrder = $event"
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
              class="flex-1"
              :placeholder="t('aiToolset.search')"
            />
          </template>
          <template #toolbar-trailing>
            <ORefreshButton
              layout="inline"
              variant="outline"
              :last-run-at="lastUpdatedAt"
              :loading="fetching"
              shortcut-id="aiToolsetsRefresh"
              data-test="ai-toolsets-list-refresh-btn"
              @click="refreshData"
            />
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-ai-toolsets"
              :filtered="!!filterQuery"
              @action="(id) => (id === 'clear-filters' ? (filterQuery = '') : addToolset())"
            />
          </template>

          <template #cell-name="{ row }">
            <div class="flex min-w-0 items-center gap-2">
              <ONameLinkCell :to="() => editToolset(row)" data-test="ai-toolsets-list-name-link">{{
                row.name
              }}</ONameLinkCell>
              <EditorDraftDot
                v-if="toolsetDrafts.ids.has(row.id)"
                :saved-at="toolsetDrafts.savedAt(row.id)"
                :data-test="`ai-toolsets-${row.name}-draft-dot`"
              />
            </div>
          </template>

          <template #cell-kind="{ row }">
            <OTag type="aiToolsetKind" :value="row.kind" />
          </template>
        </OTable>
      </div>
    </OPageLayout>

    <!-- Add / Edit form -->
    <div v-else>
      <AddAiToolset @cancel:hideform="hideAddDialog" @update:list="refreshData" />
    </div>
  </div>

  <!-- Delete confirmation -->
  <ConfirmDialog
    :title="t('aiToolset.deleteTitle')"
    message-keypath="aiToolset.deleteMessage"
    :message-name="confirmDelete.data?.name"
    ok-variant="destructive"
    @update:ok="deleteToolset"
    @update:cancel="cancelDelete"
    v-model="confirmDelete.visible"
  />
</template>

<script lang="ts">
import { aiToolsetsQuery } from "@/services/ai_toolsets.queries";
import { aiToolsetKeys } from "@/services/ai_toolsets.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { useOrgId } from "@/composables/query/useOrgId";
import { useQuery } from "@tanstack/vue-query";
import { defineComponent, ref, computed, watch, onMounted, onUpdated, Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ONameLinkCell from "@/lib/core/Table/cells/ONameLinkCell.vue";
import { COL, type OTableColumnDef, type OTableRowAction } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AddAiToolset from "@/components/ai_toolsets/AddAiToolset.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import { forbiddenState } from "@/utils/featureGate";
import { useListViewState } from "@/composables/useListViewState";
import aiToolsetsService from "@/services/ai_toolsets";
import EditorDraftDot from "@/components/common/drafts/EditorDraftDot.vue";
import { useEditorDraftIds } from "@/composables/useEditorDraft";
import { deleteEditorDraftsFor } from "@/utils/drafts/editorDraftStore";
import { useLicenseLock } from "@/composables/useFeatureLock";

export default defineComponent({
  name: "PageAiToolsets",
  components: {
    OPageLayout,
    OEmptyState,
    ConfirmDialog,
    AddAiToolset,
    OButton,
    ORefreshButton,
    OTag,
    OSearchInput,
    OTable,
    ONameLinkCell,
    EditorDraftDot,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18nTyped();
    const toolsetDrafts = useEditorDraftIds("ai_toolset");

    const orgIdForList = useOrgId();
    const { locked: toolsetsFeatureLocked } = useLicenseLock("ai_toolsets");
    const { locked: assistantLocked } = useLicenseLock("ai_assistant");
    // The list endpoint is licensed under ai_assistant, so either lock would 403 it.
    const toolsetsLocked = computed(() => toolsetsFeatureLocked.value || assistantLocked.value);
    const toolsetsList = useQuery(() =>
      Object.assign(aiToolsetsQuery(orgIdForList.value), {
        enabled: !!orgIdForList.value && !toolsetsLocked.value,
      }),
    );

    // The list is the query, not a copy: only an observer applies `staleTime` and revalidates on mount.
    const tabledata: any = computed(() =>
      (toolsetsList.data.value ?? []).map((item: any) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        description: item.description || "",
      })),
    );
    const showAddDialog = ref(false);
    // a disabled query stays pending forever
    const loading = computed(() => !toolsetsLocked.value && toolsetsList.isPending.value);
    // A request is in flight while rows stay on screen — the refresh button's
    // spinner. `loading` is the skeleton, which only a cold read wants.
    const fetching = toolsetsList.isFetching;
    // Epoch ms of the last successful read — drives the button's "1m ago" label.
    const lastUpdatedAt = toolsetsList.dataUpdatedAt;
    // A 403 lands in the query's error rather than a loader's catch, so derive the no-access state from it.
    const forbidden = computed(() => {
      const e: any = toolsetsList.error.value;
      return forbiddenState(e) || e?.status === 403;
    });
    const viewState = useListViewState("ai-toolsets", {
      filterQuery: "",
      pageSize: 20,
      currentPage: 1,
      sortBy: "",
      sortOrder: "asc" as "asc" | "desc",
    });
    const filterQuery = ref(viewState.filterQuery);
    const pageSize = ref(viewState.pageSize);
    const currentPage = ref(viewState.currentPage);
    const sortBy = ref(viewState.sortBy);
    const sortOrder = ref(viewState.sortOrder);
    const oTableRef = ref<any>(null);

    watch([filterQuery, pageSize, currentPage, sortBy, sortOrder], () => {
      Object.assign(viewState, {
        filterQuery: filterQuery.value,
        pageSize: pageSize.value,
        currentPage: currentPage.value,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value,
      });
    });
    // setTimeout(0) runs after TanStack's deferred auto-reset-on-data-change, so the restored page wins.
    watch(
      loading,
      (v) => {
        if (v) return;
        setTimeout(() => oTableRef.value?.restorePage?.(currentPage.value), 0);
      },
      { once: true, immediate: true },
    );

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
      },
    ];
    const rowActions: OTableRowAction[] = [
      {
        id: "edit",
        label: t("common.edit"),
        icon: "edit",
        onSelect: (row) => editToolset(row),
        dataTest: (row) => `ai-toolset-${row.name}-edit`,
      },
      {
        id: "delete",
        label: t("common.delete"),
        icon: "delete",
        onSelect: (row) => confirmDeleteToolset(row),
        dataTest: (row) => `ai-toolset-${row.name}-delete`,
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
    // Bound to refresh / "list changed" events: always hits the server.
    const refreshData = () => getData(true);

    const getData = async (force = false) => {
      if (force && !toolsetsLocked.value) await toolsetsList.refetch();
    };

    let dismissLoading: (() => void) | null = null;
    watch(
      loading,
      (pending) => {
        if (pending && !dismissLoading) {
          dismissLoading = toast({
            variant: "loading",
            message: t("common.loading"),
            timeout: 0,
          });
        } else if (!pending && dismissLoading) {
          dismissLoading();
          dismissLoading = null;
        }
      },
      { immediate: true },
    );

    watch(toolsetsList.error, (err: any) => {
      if (!err || err?.status === 403) return;
      toast({
        variant: "error",
        message:
          err?.response?.data?.message ||
          t("aiToolset.loadFailed", { product: raw("AI Toolsets") }),
        timeout: 5000,
      });
    });

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
          if (!isInputFocused()) getData(true);
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

    // The route goes first: while it still says add/edit, onUpdated would remount the editor and re-offer its draft.
    const hideAddDialog = async () => {
      await router.push({
        name: "aiToolsets",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      showAddDialog.value = false;
      await getData(true);
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
          deleteEditorDraftsFor({
            kind: "ai_toolset",
            org: store.state.selectedOrganization.identifier,
            entityId: row.id,
          });
          toast({ variant: "success", message: t("aiToolset.deletedSuccessfully") });
          // Drop the row from the cache first so it disappears now, not when
          // the refetch lands; the forced reload re-persists the list.
          queryClient.setQueriesData(
            { queryKey: aiToolsetKeys.all(store.state.selectedOrganization.identifier) },
            (list: any) =>
              Array.isArray(list) ? list.filter((tool: any) => tool.id !== row.id) : list,
          );
          getData(true);
        })
        .catch((err) => {
          if (err?.status !== 403) {
            toast({
              variant: "error",
              message:
                err?.response?.data?.message ||
                t("aiToolset.deleteFailed", { product: raw("AI Toolset") }),
            });
          }
        })
        .finally(() => {
          dismiss();
          confirmDelete.value = { visible: false, data: null };
        });
    };

    return {
      refreshData,
      toolsetDrafts,
      t,
      store,
      loading,
      fetching,
      lastUpdatedAt,
      forbidden,
      toolsetsLocked,
      tabledata,
      columns,
      rowActions,
      showAddDialog,
      resultTotal,
      filterQuery,
      pageSize,
      currentPage,
      sortBy,
      sortOrder,
      oTableRef,
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
