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
  <div class="flex flex-col h-full p-0">
    <OPageLayout
      v-if="!showAddDialog"
      :title="t('cipherKey.header')"
      icon="key"
      :subtitle="t('settings.cipherKeysPage.subtitle')"
      bleed
    >
        <template #actions>
          <OButton
            variant="primary"
            size="sm"
            @click="addCipherKey"
            data-test="cipher-keys-add-btn"
          >
            {{ t(`cipherKey.add`) }}
          </OButton>
        </template>
      <div class="bg-card-glass-bg flex-1 min-h-0 overflow-hidden">
      <OTable
        :frame="false"
        :data="visibleRows"
        :columns="columns"
        row-key="name"
        :loading="loading"
        :selected-ids="selectedKeyIds"
        selection="multiple"
        pagination="client"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        :footer-title="t('cipherKey.header')"
        sorting="client"
        filter-mode="client"
        :default-columns="false"
        show-index
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="settings-cipher-keys"
        :show-global-filter="false"
        @update:selected-ids="handleSelectedIdsUpdate"
      >
        <template #toolbar>
          <OSearchInput
            v-model="filterQuery"
            class="flex-1"
            :placeholder="t('cipherKey.search')"
          />
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="cipher-keys-list-refresh-btn"
            @click="getData"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="cipherKeysRefresh" />
          </OButton>
        </template>
        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-cipher-keys"
            :filtered="!!filterQuery"
            @action="(id) => id === 'clear-filters' ? (filterQuery = '') : addCipherKey()"
          />
        </template>
        <template #cell-actions="{ row }">
          <OButton
            :data-test="`cipherkey-list-${row.name}-update`"
            data-row-action="edit"
            variant="ghost"
            size="icon-sm"
            class="ml-1"
            :title="t('common.edit')"
            @click="editCipherKey(row)"
            icon-left="edit"
          />
          <OButton
            :data-test="`cipherkey-list-${row.name}-delete`"
            data-row-action="delete"
            variant="ghost-destructive"
            size="icon-sm"
            class="ml-1"
            :title="t('common.delete')"
            @click="confirmDeleteCipherKey(row)"
            icon-left="delete"
          />
        </template>
        <template
          v-if="selectedKeys.length > 0"
          #bottom
        >
          <span class="text-xs text-text-body font-medium">
            {{ t('settings.cipherKeysPage.selected', { count: selectedKeys.length }) }}
          </span>
          <OButton
            data-test="cipher-keys-list-delete-keys-btn"
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            @click="openBulkDeleteDialog"
          >
            {{ t('settings.cipherKeysPage.delete') }}
          </OButton>
        </template>
      </OTable>
      </div>
    </OPageLayout>
    <div v-else>
      <add-cipher-key @cancel:hideform="hideAddDialog" />
    </div>
  </div>
  <ConfirmDialog
    :title="t('settings.cipherKeysPage.deleteCipherKeyTitle')"
    :message="t('settings.cipherKeysPage.deleteCipherKeyMessage')"
    @update:ok="deleteCipherKey"
    @update:cancel="cancelDeleteCipherKey"
    v-model="confirmDelete.visible"
  />

  <ConfirmDialog
    :title="t('settings.cipherKeysPage.deleteCipherKeysTitle')"
    :message="t('settings.cipherKeysPage.deleteCipherKeysMessage', { count: selectedKeys.length })"
    @update:ok="bulkDeleteCipherKeys"
    @update:cancel="confirmBulkDelete = false"
    v-model="confirmBulkDelete"
  />
</template>

<script lang="ts">

import { defineComponent, ref, onMounted, onUpdated, watch, Ref, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import segment from "@/services/segment_analytics";
import { convertToTitleCase } from "@/utils/zincutils";
import config from "@/aws-exports";
import AddCipherKey from "@/components/cipherkeys/AddCipherKey.vue";
import CipherKeysService from "@/services/cipher_keys";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "PageCipherKeys",
  components: {
    OPageLayout,
    OEmptyState,
    AddCipherKey,
    ConfirmDialog,
    OButton,
    OTooltip,
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
        header: t("cipherKey.name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "store_type",
        header: t("cipherKey.storeType"),
        accessorKey: "store_type",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.type,
        meta: { align: "left" },
      },
      {
        id: "mechanism_type",
        header: t("cipherKey.mechanismType"),
        accessorKey: "mechanism_type",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.type,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("cipherKey.actions"),
        isAction: true,
        pinned: "right",
        size: 100,
        meta: { align: "center", actionCount: 2 },
      },
    ];
    const resultTotal = ref<number>(0);

    const confirmDelete: Ref<{
      visible: boolean;
      data: any;
    }> = ref({ visible: false, data: null });
    const selectedKeys: Ref<any[]> = ref([]);
    const confirmBulkDelete = ref(false);

    watch(
      () => router.currentRoute.value.query?.action,
      (action) => {
        if (action == "add" || action == "edit") {
          showAddDialog.value = true;
        }
      },
    );

    onMounted(() => {
      if (
        router.currentRoute.value.query.action == "add" ||
        router.currentRoute.value.query.action == "edit"
      ) {
        showAddDialog.value = true;
      }
    });

    onUpdated(() => {
      if (
        router.currentRoute.value.query.action == "add" ||
        router.currentRoute.value.query.action == "edit"
      ) {
        showAddDialog.value = true;
      } else {
        showAddDialog.value = false;
      }
    });

    const selectedKeyIds = computed(() =>
      selectedKeys.value.map((k: any) => k.name),
    );

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const map = new Map(tabledata.value.map((r: any) => [r.name, r]));
      selectedKeys.value = ids.map((id: any) => map.get(id)).filter(Boolean);
    };

    const addCipherKey = (evt: any) => {
      router.push({
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const editCipherKey = (data: any) => {
      router.push({
        query: {
          action: "edit",
          org_identifier: store.state.selectedOrganization.identifier,
          name: data.name,
        },
      });
    };

    const getData = () => {
      loading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: t("settings.cipherKeysPage.loadingData"),
              timeout: 0,
});

      CipherKeysService.list(store.state.selectedOrganization.identifier)
        .then((response) => {
          const data = [];
          const responseData = response.data.keys;
          for (let i = 0; i < responseData.length; i++) {
            data.push({
              name: responseData[i].name,
              store_type: responseData[i].key.store.type,
              mechanism_type: responseData[i].key.mechanism.type,
            });
          }

          tabledata.value = data;
          resultTotal.value = responseData.length;
          loading.value = false;
          dismiss();
        })
        .catch((error) => {
          loading.value = false;
          dismiss();
          if (error.status != 403) {
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                t("settings.cipherKeysPage.fetchFailed"),
              timeout: 5000,
            });
          }
        });
    };

    getData();

    const hideAddDialog = async () => {
      showAddDialog.value = !showAddDialog.value;
      await getData();
      router.push({
        name: "cipherKeys",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const deleteCipherKey = () => {
      if (confirmDelete.value?.data?.name) {
        const dismiss = toast({
          variant: "loading",
          message: t("settings.cipherKeysPage.processingDelete"),
                  timeout: 0,
});
        CipherKeysService.delete(
          store.state.selectedOrganization.identifier,
          confirmDelete.value.data.name,
        )
          .then(() => {
            dismiss();
            toast({
              variant: "success",
              message: t("settings.cipherKeysPage.deleteSuccess"),
            });

            getData();
          })
          .catch((err) => {
            dismiss();
            if (err.response.data.code === 409) {
              toast({
                variant: "error",
                message: err.response.data.message,
              });
            } else {
              if (err?.status != 403) {
                toast({
                  variant: "error",
                  message: err.response.data.message,
                });
              }
            }
          });
      }
    };
    const confirmDeleteCipherKey = (destination: any) => {
      confirmDelete.value.visible = true;
      confirmDelete.value.data = destination;
    };
    const cancelDeleteCipherKey = () => {
      confirmDelete.value.visible = false;
      confirmDelete.value.data = null;
    };
    const filterData = (rows: string | any[], terms: string) => {
        const filtered = [];
        terms = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      };

    const visibleRows = computed(() => {
      if (!filterQuery.value) return tabledata.value || [];
      return filterData(tabledata.value || [], filterQuery.value);
    });

    // Watch visibleRows to sync resultTotal with search filter
    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteCipherKeys = () => {
      const keyNames = selectedKeys.value.map((key: any) => key.name);

      CipherKeysService.bulkDelete(store.state.selectedOrganization.identifier, { ids: keyNames })
        .then((res) => {
          const { successful, unsuccessful } = res.data;

          if (successful.length > 0 && unsuccessful.length === 0) {
            toast({
              variant: "success",
              message: t("settings.cipherKeysPage.bulkDeleteSuccess", { count: successful.length }),
            });
          } else if (successful.length > 0 && unsuccessful.length > 0) {
            toast({
              variant: "warning",
              message: t("settings.cipherKeysPage.bulkDeletePartial", { successful: successful.length, failed: unsuccessful.length }),
            });
          } else if (unsuccessful.length > 0) {
            toast({
              variant: "error",
              message: t("settings.cipherKeysPage.bulkDeleteFailed", { count: unsuccessful.length }),
            });
          }

          selectedKeys.value = [];
          confirmBulkDelete.value = false;
          getData();
        })
        .catch((err: any) => {
          if (err.response?.status != 403 || err?.status != 403) {
            toast({
              variant: "error",
              message: err.response?.data?.message || err?.message || t("settings.cipherKeysPage.bulkDeleteError"),
            });
          }
        });
    };

    useShortcuts([
      { id: "cipherKeysRefresh", handler: () => { if (!isInputFocused()) getData(); } },
    ]);

    return {
      t,
      store,
      router,
      loading,
      tabledata,
      columns,
      showAddDialog,
      addCipherKey,
      getData,
      resultTotal,
      filterQuery,
      hideAddDialog,
      cancelDeleteCipherKey,
      confirmDeleteCipherKey,
      confirmDelete,
      editCipherKey,
      deleteCipherKey,
      visibleRows,
      filterData,
      selectedKeys,
      selectedKeyIds,
      handleSelectedIdsUpdate,
      confirmBulkDelete,
      openBulkDeleteDialog,
      bulkDeleteCipherKeys,
    };
  },
});
</script>
