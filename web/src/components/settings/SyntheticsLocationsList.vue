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
  <div class="flex flex-col h-full p-0">
    <template v-if="!showImportDialog">
      <OPageLayout
        :title="t('synthetics.locations.title')"
        icon="location-on"
        :subtitle="t('synthetics.locations.description')"
        bleed
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            @click="openImportDialog"
            data-test="synthetics-locations-import-btn"
            >{{ t("synthetics.locations.importTitle") }}</OButton
          >
          <OButton
            variant="outline"
            size="sm"
            @click="exportLocations"
            data-test="synthetics-locations-export-btn"
            >{{ t("synthetics.locations.exportTitle") }}</OButton
          >
          <OButton
            data-test="synthetics-locations-add-btn"
            variant="primary"
            size="sm"
            @click="openCreateDialog"
            >{{ t("synthetics.locations.addLocation") }}</OButton
          >
        </template>

        <div class="bg-card-glass-bg flex-1 min-h-0 overflow-hidden">
          <OTable
            :frame="false"
            data-test="synthetics-locations-list-table"
            :data="visibleRows"
            :columns="columns"
            row-key="id"
            :selected-ids="selectedLocationIds"
            selection="multiple"
            pagination="client"
            :page-size="20"
            :page-size-options="[10, 20, 50, 100]"
            sorting="client"
            filter-mode="client"
            :default-columns="false"
            show-index
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="settings-synthetics-locations"
            :show-global-filter="false"
            :loading="listLoading"
            @update:selected-ids="handleSelectedIdsUpdate"
          >
            <template #toolbar>
              <OSearchInput
                v-model="filterQuery"
                class="flex-1"
                :placeholder="t('synthetics.locations.searchPlaceholder')"
              />
            </template>
            <template #toolbar-trailing>
              <OButton
                variant="outline"
                size="icon-sm"
                icon-left="refresh"
                :loading="listLoading"
                data-test="synthetics-locations-refresh-btn"
                @click="fetchLocations"
              >
                <OTooltip side="bottom" :content="t('common.refresh')" />
              </OButton>
            </template>
            <template #empty>
              <OEmptyState
                v-if="!listLoading"
                size="hero"
                :preset="filterQuery !== '' ? 'no-search-results' : 'no-data'"
                :filtered="filterQuery !== ''"
                @action="(id?: string) => (id === 'clear-filters' ? (filterQuery = '') : undefined)"
              />
            </template>
            <template #cell-actions="{ row }">
              <div class="flex items-center gap-0.5" @click.stop>
                <!-- Enable / Disable toggle with per-row spinner -->
                <div
                  v-if="toggleLoadingMap[row.id]"
                  class="flex items-center justify-center w-7 h-8"
                  :data-test="`synthetics-locations-${row.id}-toggle-spinner`"
                >
                  <OSpinner size="xs" />
                  <OTooltip
                    side="bottom"
                    :content="
                      row.enabled
                        ? t('synthetics.locations.disabling')
                        : t('synthetics.locations.enabling')
                    "
                  />
                </div>
                <OButton
                  v-else
                  :variant="row.enabled ? 'ghost-destructive' : 'ghost'"
                  size="icon-sm"
                  :icon-left="row.enabled ? 'pause' : 'play-arrow'"
                  :data-test="`synthetics-locations-${row.id}-${row.enabled ? 'disable' : 'enable'}-btn`"
                  @click.stop="toggleLocationEnabled(row)"
                >
                  <OTooltip
                    side="bottom"
                    :content="
                      row.enabled
                        ? t('synthetics.locations.disable')
                        : t('synthetics.locations.enable')
                    "
                  />
                </OButton>

                <!-- Edit -->
                <OButton
                  :data-test="`synthetics-locations-${row.id}-edit-btn`"
                  data-row-action="edit"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('common.edit')"
                  @click.stop="openEditDialog(row)"
                  icon-left="edit"
                >
                  <OTooltip side="bottom" :content="t('common.edit')" />
                </OButton>

                <!-- Delete -->
                <OButton
                  :data-test="`synthetics-locations-${row.id}-delete-btn`"
                  data-row-action="delete"
                  variant="ghost-destructive"
                  size="icon-sm"
                  :title="t('common.delete')"
                  @click.stop="confirmDelete(row)"
                  icon-left="delete"
                >
                  <OTooltip side="bottom" :content="t('common.delete')" />
                </OButton>
              </div>
            </template>
            <template #bottom>
              <div class="flex w-full justify-between items-center h-12 gap-1">
                <span class="text-xs text-secondary min-w-25">
                  <template v-if="selectedLocations.length > 0">
                    {{
                      t("synthetics.locations.selectedCount", {
                        selected: selectedLocations.length,
                        total: resultTotal,
                      })
                    }}
                  </template>
                  <template v-else>
                    {{ resultTotal }} {{ t("synthetics.locations.bottomHeader") }}
                  </template>
                </span>
                <template v-if="selectedLocations.length > 0">
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="play-arrow"
                    data-test="synthetics-locations-enable-selected-btn"
                    :disabled="!!bulkActionLoading"
                    @click="bulkToggleEnabled(true)"
                    >{{ t("synthetics.locations.enable") }}</OButton
                  >
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="pause"
                    data-test="synthetics-locations-disable-selected-btn"
                    :disabled="!!bulkActionLoading"
                    @click="bulkToggleEnabled(false)"
                    >{{ t("synthetics.locations.disable") }}</OButton
                  >
                  <OButton
                    variant="outline-destructive"
                    size="sm"
                    icon-left="delete"
                    data-test="synthetics-locations-delete-selected-btn"
                    :loading="!!bulkActionLoading"
                    @click="openBulkDeleteConfirm"
                    >{{ t("common.delete") }}</OButton
                  >
                </template>
              </div>
            </template>
          </OTable>
        </div>
      </OPageLayout>
    </template>

    <ImportSyntheticsLocations
      v-else
      @cancel:hideform="showImportDialog = false"
      @update:list="fetchLocations"
    />

    <SyntheticsLocationForm
      data-test="synthetics-location-form-drawer"
      v-model:open="formDialog.show"
      :data="formDialog.data"
      :is-edit="formDialog.isEdit"
      @update:list="fetchLocations"
      @close="closeFormDialog"
    />
  </div>
</template>

<script lang="ts">
import { ref, onMounted, defineComponent, computed } from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import syntheticsService from "@/services/synthetics";
import SyntheticsLocationForm from "./SyntheticsLocationForm.vue";
import ImportSyntheticsLocations from "./ImportSyntheticsLocations.vue";
import type { SyntheticsLocationRecord } from "@/types/synthetics";

export default defineComponent({
  name: "SyntheticsLocationsList",
  components: {
    OPageLayout,
    OButton,
    OTooltip,
    OSearchInput,
    OTable,
    OEmptyState,
    OSpinner,
    SyntheticsLocationForm,
    ImportSyntheticsLocations,
  },
  setup() {
    const filterQuery = ref("");
    const { t } = useI18n();
    const store = useStore();
    const { confirm } = useConfirmDialog();

    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("synthetics.locations.label"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 200,
        meta: { align: "left", flex: true },
      },
      {
        id: "id",
        header: t("synthetics.locations.locationId"),
        accessorKey: "id",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 220,
        minSize: 140,
        meta: { align: "left" },
      },
      {
        id: "provider",
        header: t("synthetics.locations.provider"),
        accessorKey: "provider",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 120,
        minSize: 80,
        meta: { align: "left" },
      },
      {
        id: "region",
        header: t("synthetics.locations.region"),
        accessorKey: "region",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 160,
        minSize: 100,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: "",
        isAction: true,
        pinned: "right",
        size: 130,
        minSize: 130,
        sortable: false,
        meta: { align: "center" },
      },
    ];

    const locations = ref<SyntheticsLocationRecord[]>([]);
    const selectedLocations: Ref<SyntheticsLocationRecord[]> = ref([]);
    const listLoading = ref(false);
    const bulkActionLoading = ref(false);
    const toggleLoadingMap = ref<Record<string, boolean>>({});
    const resultTotal = ref(0);
    const showImportDialog = ref(false);

    const formDialog = ref({
      show: false,
      data: {} as any,
      isEdit: false,
    });

    const selectedLocationIds = computed(() => selectedLocations.value.map((l) => l.id));

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const map = new Map(locations.value.map((l) => [l.id, l]));
      selectedLocations.value = ids
        .map((id) => map.get(id))
        .filter(Boolean) as SyntheticsLocationRecord[];
    };

    onMounted(() => {
      fetchLocations();
    });

    const filterData = (rows: any[], query: string) => {
      const q = query.toLowerCase();
      const filtered = rows.filter(
        (row) =>
          row.name?.toLowerCase().includes(q) ||
          row.id?.toLowerCase().includes(q) ||
          row.provider?.toLowerCase().includes(q) ||
          row.region?.toLowerCase().includes(q),
      );
      resultTotal.value = filtered.length;
      return filtered;
    };

    const visibleRows = computed(() => {
      return filterData(locations.value, filterQuery.value);
    });

    const fetchLocations = async () => {
      listLoading.value = true;
      try {
        const response = await syntheticsService.getLocations(
          store.state.selectedOrganization.identifier,
        );
        const data = response.data;
        // Only show public locations — filter out private ones.
        locations.value = ((data.locations ?? []) as SyntheticsLocationRecord[]).filter(
          (l) => l.kind === "public",
        );
        resultTotal.value = locations.value.length;
      } catch (error: any) {
        toast({
          message: error?.response?.data?.message || t("synthetics.locations.fetchFailed"),
          variant: "error",
        });
      } finally {
        listLoading.value = false;
      }
    };

    const openCreateDialog = () => {
      formDialog.value = { show: true, data: {}, isEdit: false };
    };

    const openEditDialog = (row: SyntheticsLocationRecord) => {
      formDialog.value = { show: true, data: row, isEdit: true };
    };

    const closeFormDialog = () => {
      formDialog.value.show = false;
    };

    // ── Single-row enable / disable toggle ──────────────────────────────
    const toggleLocationEnabled = async (row: SyntheticsLocationRecord) => {
      toggleLoadingMap.value[row.id] = true;
      const newEnabled = !row.enabled;
      try {
        await syntheticsService.updateLocation(
          store.state.selectedOrganization.identifier,
          row.id,
          { label: row.name, enabled: newEnabled },
        );
        // Update the local row in-place instead of re-fetching.
        const idx = locations.value.findIndex((l) => l.id === row.id);
        if (idx !== -1) {
          locations.value[idx] = { ...locations.value[idx], enabled: newEnabled };
        }
        toast({
          message: row.enabled
            ? t("synthetics.locations.disabledSuccess")
            : t("synthetics.locations.enabledSuccess"),
          variant: "success",
        });
        selectedLocations.value = [];
      } catch (error: any) {
        toast({
          message: error?.response?.data?.message || t("synthetics.locations.toggleFailed"),
          variant: "error",
        });
      } finally {
        toggleLoadingMap.value[row.id] = false;
      }
    };

    // ── Bulk enable / disable ────────────────────────────────────────────
    const bulkToggleEnabled = async (enabled: boolean) => {
      bulkActionLoading.value = true;
      const ids = selectedLocations.value.map((l) => l.id);
      const labels = selectedLocations.value.map((l) => l.name);
      let successCount = 0;
      const successIds = new Set<string>();
      try {
        for (let i = 0; i < ids.length; i++) {
          try {
            await syntheticsService.updateLocation(
              store.state.selectedOrganization.identifier,
              ids[i],
              { label: labels[i], enabled },
            );
            successCount++;
            successIds.add(ids[i]);
          } catch {
            // continue with remaining locations
          }
        }
        // Update local rows in-place instead of re-fetching.
        for (let i = 0; i < locations.value.length; i++) {
          if (successIds.has(locations.value[i].id)) {
            locations.value[i] = { ...locations.value[i], enabled };
          }
        }
        if (successCount === ids.length) {
          toast({
            message: enabled
              ? t("synthetics.locations.bulkEnabledSuccess", { count: successCount })
              : t("synthetics.locations.bulkDisabledSuccess", { count: successCount }),
            variant: "success",
          });
        } else if (successCount > 0) {
          toast({
            message: enabled
              ? t("synthetics.locations.bulkEnabledPartial", {
                  success: successCount,
                  total: ids.length,
                })
              : t("synthetics.locations.bulkDisabledPartial", {
                  success: successCount,
                  total: ids.length,
                }),
            variant: "warning",
          });
        } else {
          toast({
            message: enabled
              ? t("synthetics.locations.bulkEnableFailed")
              : t("synthetics.locations.bulkDisableFailed"),
            variant: "error",
          });
        }
        selectedLocations.value = [];
      } finally {
        bulkActionLoading.value = false;
      }
    };

    // ── Delete ───────────────────────────────────────────────────────────
    const confirmDelete = async (row: SyntheticsLocationRecord) => {
      const ok = await confirm({
        title: t("synthetics.locations.deleteConfirmTitle"),
        message: t("synthetics.locations.deleteConfirmMessage"),
      });
      if (ok) {
        await deleteLocation(row.id);
      }
    };

    const deleteLocation = async (id: string) => {
      try {
        await syntheticsService.deleteLocation(store.state.selectedOrganization.identifier, id);
        // Remove the local row in-place instead of re-fetching.
        const idx = locations.value.findIndex((l) => l.id === id);
        if (idx !== -1) locations.value.splice(idx, 1);
        resultTotal.value = locations.value.length;
        toast({
          message: t("synthetics.locations.deleteSuccess"),
          variant: "success",
        });
      } catch (error: any) {
        toast({
          message: error?.response?.data?.message || t("synthetics.locations.deleteFailed"),
          variant: "error",
        });
      }
    };

    const openBulkDeleteConfirm = async () => {
      const count = selectedLocations.value.length;
      const ok = await confirm({
        title: t("synthetics.locations.bulkDeleteConfirmTitle"),
        message: t("synthetics.locations.bulkDeleteConfirmMessage", { count }),
      });
      if (ok) {
        await bulkDeleteLocations();
      }
    };

    const bulkDeleteLocations = async () => {
      bulkActionLoading.value = true;
      const ids = selectedLocations.value.map((l) => l.id);
      let successCount = 0;
      const successIds = new Set<string>();
      try {
        for (const id of ids) {
          try {
            await syntheticsService.deleteLocation(store.state.selectedOrganization.identifier, id);
            successCount++;
            successIds.add(id);
          } catch {
            // continue with other deletions
          }
        }
        // Remove successful deletes from local array in-place.
        locations.value = locations.value.filter((l) => !successIds.has(l.id));
        resultTotal.value = locations.value.length;
        if (successCount === ids.length) {
          toast({
            message: t("synthetics.locations.bulkDeleteSuccess", { count: successCount }),
            variant: "success",
          });
        } else if (successCount > 0) {
          toast({
            message: t("synthetics.locations.bulkDeletePartial", {
              success: successCount,
              total: ids.length,
            }),
            variant: "warning",
          });
        } else {
          toast({
            message: t("synthetics.locations.bulkDeleteFailed"),
            variant: "error",
          });
        }
        selectedLocations.value = [];
      } finally {
        bulkActionLoading.value = false;
      }
    };

    const openImportDialog = () => {
      showImportDialog.value = true;
    };

    const exportLocations = () => {
      try {
        const exportData = locations.value.map((loc) => ({
          provider: loc.provider,
          region: loc.region,
          label: loc.name,
          enabled: loc.enabled,
        }));
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "synthetics_locations.json";
        link.click();
        URL.revokeObjectURL(url);
        toast({
          message: t("synthetics.locations.exportSuccess"),
          variant: "success",
        });
      } catch {
        toast({
          message: t("synthetics.locations.exportFailed"),
          variant: "error",
        });
      }
    };

    return {
      t,
      store,
      filterQuery,
      columns,
      locations,
      listLoading,
      resultTotal,
      visibleRows,
      selectedLocations,
      selectedLocationIds,
      handleSelectedIdsUpdate,
      fetchLocations,
      openCreateDialog,
      openEditDialog,
      closeFormDialog,
      toggleLocationEnabled,
      toggleLoadingMap,
      bulkToggleEnabled,
      bulkActionLoading,
      confirmDelete,
      openBulkDeleteConfirm,
      bulkDeleteLocations,
      formDialog,
      showImportDialog,
      openImportDialog,
      exportLocations,
    };
  },
});
</script>
