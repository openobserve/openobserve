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

    <OPageLayout bleed
      v-if="!showDestinationEditor && !showImportDestination"
      :title="t('alert_destinations.header')"
      title-data-test="alert-destinations-list-title"
      icon="location-on"
      :subtitle="t('alert_destinations.subtitle')"
    >
        <template #actions>
          <OToggleGroup
            :model-value="activeTab"
            @update:model-value="(v) => { activeTab = v as 'all' | 'prebuilt' | 'custom'; }"
            data-test="destination-list-tabs"
          >
            <OToggleGroupItem value="all" size="sm" data-test="destination-tab-all">
              <template #icon-left><OIcon name="format-list-bulleted" size="sm" /></template>
              {{ t("alert_destinations.filterAll") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="prebuilt" size="sm" data-test="destination-tab-prebuilt">
              <template #icon-left><OIcon name="auto-awesome" size="sm" /></template>
              {{ t("alert_destinations.filterPrebuilt") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="custom" size="sm" data-test="destination-tab-custom">
              <template #icon-left><OIcon name="settings" size="sm" /></template>
              {{ t("alert_destinations.filterCustom") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OButton
            variant="outline"
            size="sm"
            @click="importDestination"
            data-test="destination-import"
          >{{ t(`dashboard.import`) }}</OButton>
          <OButton
            data-test="alert-destination-list-add-alert-btn"
            variant="primary"
            size="sm"
            :disabled="!templates.length"
            @click="editDestination(null)"
          >{{ t(`alert_destinations.add`) }}</OButton>
        </template>
      <div class="bg-card-glass-bg flex-1 min-h-0">
        <OTable
          data-test="alert-destinations-list-table"
          :data="visibleRows"
          :columns="columns"
          row-key="name"
          :loading="loading"
          :selected-ids="selectedDestinationIds"
          selection="multiple"
          pagination="client"
          :page-size="20"
          :page-size-options="[5, 10, 20, 50, 100]"
          :footer-title="t('alert_destinations.header')"
          sorting="client"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="settings-alert-destinations"
          show-index
          :show-global-filter="false"
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <template #toolbar>
            <OSearchInput
              v-model="filterQuery"
              data-test="destination-list-search-input"
              class="flex-1"
              :placeholder="t('alert_destinations.search')"
            />
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="alert-destinations-list-refresh-btn"
              @click="getDestinations"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="alertDestinationsRefresh" />
            </OButton>
          </template>

          <template #bottom="{ totalRows }">
            <span class="text-xs font-normal">
              {{ totalRows.toLocaleString() }} {{ t('alert_destinations.header') }}
            </span>
            <OButton
              v-if="selectedDestinations.length > 0"
              data-test="destination-list-delete-destinations-btn"
              variant="outline-destructive"
              size="sm"
              :loading="bulkDeleteLoading"
              @click="openBulkDeleteDialog"
            >
              <template #icon-left>
                <OIcon name="delete" size="sm" />
              </template>
              {{ t('common.delete') }}
            </OButton>
          </template>

          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-alert-destinations"
              :filtered="!!filterQuery"
              :actions="[
                { id: 'create', icon: 'add', titleKey: 'emptyState.noAlertDestinations.action', descriptionKey: 'emptyState.noAlertDestinations.actionDesc' },
                { id: 'import', icon: 'upload-file', titleKey: 'emptyState.noAlertDestinations.import', descriptionKey: 'emptyState.noAlertDestinations.importDesc' },
              ]"
              @action="(id) => id === 'clear-filters' ? (filterQuery = '') : id === 'import' ? importDestination() : (templates.length && editDestination(null))"
            />
          </template>

          <template #cell-template="{ row }">
            <div
              v-if="row.template"
              class="flex items-center gap-2 min-w-0"
              :data-test="`destination-template-${row.name}`"
            >
              <span
                class="truncate min-w-0"
                :title="row.template"
              >{{ row.template }}</span>
              <OTag
                v-if="isDefaultPrebuiltTemplate(row)"
                :data-test="`destination-template-default-badge-${row.name}`"
                type="templateDefaultFlag"
                value="default"
                class="flex-shrink-0"
              />
            </div>
            <span v-else class="text-text-secondary">—</span>
          </template>

          <template #cell-type="{ row }">
            <div class="flex items-center gap-2">
              <template v-if="getPrebuiltTypeName(row)">
                <OTag
                  :data-test="`destination-type-badge-${getPrebuiltTypeName(row)?.toLowerCase()}`"
                  type="destinationKind"
                  value="prebuilt"
                >{{ getPrebuiltTypeName(row) }}</OTag>
                <OIcon
                  name="auto-awesome"
                  size="sm"
                  :title="'Prebuilt ' + getPrebuiltTypeName(row) + ' destination'"
                />
              </template>
              <template v-else>
                <OTag
                  data-test="destination-type-badge-custom"
                  type="destinationKind"
                  value="custom"
                >{{ getCustomDestinationLabel(row) }}</OTag>
                <OIcon
                  name="settings"
                  size="sm"
                  :title="getCustomDestinationLabel(row)"
                />
              </template>
            </div>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex items-center gap-1 justify-center">
              <OButton
                data-test="destination-export"
                data-row-action="export"
                variant="ghost"
                size="icon-sm"
                :title="t('alert_destinations.exportDestination')"
                @click.stop="exportDestination(row)"
              >
                <OIcon name="download" size="sm" />
              </OButton>
              <OButton
                :data-test="`alert-destination-list-${row.name}-update-destination`"
                data-row-action="edit"
                variant="ghost"
                size="icon-sm"
                :title="t('alert_destinations.edit')"
                @click="editDestination(row)"
              >
                <OIcon name="edit" size="sm" />
              </OButton>
              <OButton
                :data-test="`alert-destination-list-${row.name}-delete-destination`"
                data-row-action="delete"
                variant="ghost"
                size="icon-sm"
                :title="t('alert_destinations.delete')"
                @click="conformDeleteDestination(row)"
              >
                <OIcon name="delete" size="sm" />
              </OButton>
            </div>
          </template>
        </OTable>
      </div>
    </OPageLayout>
    <div v-else-if="showDestinationEditor && !showImportDestination" class="flex-1 min-h-0">
      <AddDestination
        :is-alerts="true"
        :destination="editingDestination"
        :templates="templates"
        @cancel:hideform="toggleDestinationEditor"
        @get:destinations="getDestinations"
      />
    </div>
    <div v-else class="flex-1 min-h-0">
      <ImportDestination
        :destinations="destinations"
        :templates="templates"
        @update:destinations="getDestinations"
      />
    </div>

    <ConfirmDialog
      :title="t('alert_destinations.deleteDestinationTitle')"
      :message="t('alert_destinations.deleteDestinationMessage')"
      @update:ok="deleteDestination"
      @update:cancel="cancelDeleteDestination"
      v-model="confirmDelete.visible"
    />

    <ConfirmDialog
      :title="t('alert_destinations.deleteDestinationsTitle')"
      :message="`Are you sure you want to delete ${selectedDestinations.length} destination(s)?`"
      @update:ok="bulkDeleteDestinations"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
  </div>
</template>
<script lang="ts">

import {
  ref,
  onBeforeMount,
  onActivated,
  watch,
  defineComponent,
  onMounted,
  computed,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { getImageURL } from "@/utils/zincutils";
import AddDestination from "./AddDestination.vue";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useRouter } from "vue-router";
import type { DestinationPayload } from "@/ts/interfaces";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import type { Template } from "@/ts/interfaces/index";

import ImportDestination from "./ImportDestination.vue";
import useActions from "@/composables/useActions";
import { useReo } from "@/services/reodotdev_analytics";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTag from '@/lib/core/Badge/OTag.vue';
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import { COL } from "@/lib/core/Table/OTable.types";

interface ConformDelete {
  visible: boolean;
  data: any;
}
export default defineComponent({
  name: "PageAlerts",
  components: {
    OIcon,
    AddDestination,
    OEmptyState,
    ConfirmDialog,
    ImportDestination,
    OButton,
    OTooltip,
    OSearchInput,
    OTag,
    OTable,
    OToggleGroup,
    OToggleGroupItem,
    OPageLayout,
  },
  setup() {
    const store = useStore();
    const editingDestination: Ref<DestinationPayload | null> = ref(null);
    const { t } = useI18n();
    const { getAllActions } = useActions();
    const { track } = useReo();

    const { detectPrebuiltType, availableTypes } = usePrebuiltDestinations();

    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("alert_destinations.name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 320,
        meta: { align: "left", flex: true },
      },
      {
        id: "type",
        header: "Type",
        accessorKey: "type",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 170,
        meta: { align: "left" },
      },
      {
        id: "url",
        header: t("alert_destinations.url"),
        accessorKey: "url",
        resizable: true,
        hideable: true,
        size: COL.url,
        meta: { align: "left" },
      },
      {
        id: "template",
        header: t("alert_destinations.template"),
        accessorKey: "template",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.template,
        meta: { align: "left" },
      },
      {
        id: "method",
        header: t("alert_destinations.method"),
        accessorKey: "method",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.method,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("alert_destinations.actions"),
        isAction: true,
        pinned: "right",
        size: 120,
        meta: { align: "center", actionCount: 3 },
      },
    ];
    const destinations: Ref<DestinationPayload[]> = ref([]);
    const templates: Ref<Template[]> = ref([
      { name: "test", body: "", type: "http" },
    ]);
    const confirmDelete: Ref<ConformDelete> = ref({
      visible: false,
      data: null,
    });
    const confirmBulkDelete = ref<boolean>(false);
    const bulkDeleteLoading = ref(false);
    const selectedDestinations = ref<any[]>([]);
    const showDestinationEditor = ref(false);
    const showImportDestination = ref(false);
    const router = useRouter();
    const filterQuery = ref("");
    const resultTotal = ref(0);

    const selectedDestinationIds = computed(() =>
      selectedDestinations.value.map((d: any) => d.name),
    );

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const map = new Map(destinations.value.map((r: any) => [r.name, r]));
      selectedDestinations.value = ids
        .map((id: any) => map.get(id))
        .filter(Boolean);
    };

    onActivated(() => {
      getTemplates();
      if (!destinations.value.length) getDestinations();
    });
    onBeforeMount(() => {
      getDestinations();
      getTemplates();
      getActions();
    });

    watch(
      () => router.currentRoute.value.query.action,
      (action) => {
        if (!action) {
          showDestinationEditor.value = false;
          showImportDestination.value = false;
        }
      },
    );

    onMounted(() => {
      updateRoute();
    });

    const getActions = async () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading alert destination...",
              timeout: 0,
});
      if (store.state.organizationData.actions.length == 0) {
        await getAllActions()
          .catch(() => {
            toast({
              variant: "error",
              message: "Error while loading actions.",
            });
          })
          .finally(() => dismiss());
      }
    };

    const loading = ref(false);
    const getDestinations = () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading destinations...",
              timeout: 0,
});
      loading.value = true;
      destinationService
        .list({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        })
        .then((res) => {
          res.data = res.data.filter(
            (destination: any) =>
              destination.type == "http" ||
              destination.type == "email" ||
              destination.type === "action",
          );
          resultTotal.value = res.data.length;
          destinations.value = res.data;
          updateRoute();
        })
        .catch((err) => {
          if (err.response.status != 403) {
            toast({
              variant: "error",
              message: "Error while pulling destinations.",
            });
          }
          dismiss();
        })
        .finally(() => {
          dismiss();
          loading.value = false;
        });
    };
    const getTemplates = () => {
      templateService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
        })
        .then((res) => (templates.value = res.data));
    };
    const updateRoute = () => {
      if (router.currentRoute.value.query.action === "add")
        editDestination(null);
      if (router.currentRoute.value.query.action === "update")
        editDestination(
          getDestinationByName(router.currentRoute.value.query.name as string),
        );
      if (router.currentRoute.value.query.action === "import")
        showImportDestination.value = true;
    };
    const getDestinationByName = (name: string) => {
      return destinations.value.find(
        (destination) => destination.name === name,
      );
    };
    const editDestination = (destination: any) => {
      if (!destination) {
        track("Button Click", {
          button: "Add Destination",
          page: "Alert Destinations"
        });
      }
      toggleDestinationEditor();
      resetEditingDestination();
      if (!destination) {
        router.push({
          name: "alertDestinations",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      } else {
        editingDestination.value = { ...destination };
        router.push({
          name: "alertDestinations",
          query: {
            action: "update",
            name: destination.name,
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    };
    const resetEditingDestination = () => {
      editingDestination.value = null;
    };
    const deleteDestination = () => {
      if (confirmDelete.value?.data?.name) {
        destinationService
          .delete({
            org_identifier: store.state.selectedOrganization.identifier,
            destination_name: confirmDelete.value.data.name,
          })
          .then(() => {
            toast({
              variant: "success",
              message: `Destination ${confirmDelete.value.data.name} deleted successfully`,
            });
            getDestinations();
          })
          .catch((err) => {
            if (err.response.data.code === 409) {
              const message =
                err.response.data?.message ||
                err.response.data?.error ||
                "Error while deleting destination";
              toast({
                variant: "error",
                message,
              });
            }
          });
      }
    };
    const conformDeleteDestination = (destination: any) => {
      confirmDelete.value.visible = true;
      confirmDelete.value.data = destination;
    };
    const cancelDeleteDestination = () => {
      confirmDelete.value.visible = false;
      confirmDelete.value.data = null;
    };
    const toggleDestinationEditor = () => {
      showDestinationEditor.value = !showDestinationEditor.value;
      if (!showDestinationEditor.value)
        router.push({
          name: "alertDestinations",
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

    const routeTo = (name: string) => {
      router.push({
        name: name,
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const exportDestination = (row: any) => {
      const findDestination: any = getDestinationByName(row.name);
      const destinationByName = { ...findDestination };
      const destinationJson = JSON.stringify(destinationByName, null, 2);
      const blob = new Blob([destinationJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${destinationByName.name}.json`;
      link.click();
      URL.revokeObjectURL(url);
    };
    const importDestination = () => {
      showImportDestination.value = true;
      router.push({
        name: "alertDestinations",
        query: {
          action: "import",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    // True when the row's template name matches the canonical `prebuilt_<type>`
    // for its detected prebuilt type — i.e. the user kept the default rather
    // than picking a custom template. Used to show a "Default" badge.
    const isDefaultPrebuiltTemplate = (destination: any): boolean => {
      const prebuiltType = detectPrebuiltType(destination);
      if (!prebuiltType) return false;
      return destination.template === `prebuilt_${prebuiltType}`;
    };

    const getPrebuiltTypeName = (destination: DestinationPayload): string | null => {
      const prebuiltType = detectPrebuiltType(destination);
      if (!prebuiltType) return null;

      const typeConfig = availableTypes.value.find(t => t.id === prebuiltType);
      return typeConfig ? typeConfig.name : prebuiltType;
    };

    const getCustomDestinationLabel = (destination: DestinationPayload): string => {
      if (destination.type === "http") {
        return t("alert_destinations.customWebhook");
      } else if (destination.type === "email") {
        return t("alert_destinations.customEmail");
      } else if (destination.type === "action") {
        return t("alert_destinations.customAction");
      }
      return t("alert_destinations.custom");
    };

    // Top-right tab filter — mirrors the alerts list and templates list.
    // "prebuilt" matches any destination detectable as a prebuilt type
    // (Slack/Opsgenie/PagerDuty/ServiceNow/etc., identified via the
    // `prebuilt_type` metadata or URL/template pattern); "custom" is the
    // negation, capturing user-defined HTTP/Email/Action destinations.
    const activeTab = ref<"all" | "prebuilt" | "custom">("all");

    const visibleRows = computed(() => {
      const base = destinations.value || [];
      const byTab =
        activeTab.value === "prebuilt"
          ? base.filter((d: any) => !!detectPrebuiltType(d))
          : activeTab.value === "custom"
            ? base.filter((d: any) => !detectPrebuiltType(d))
            : base;
      if (!filterQuery.value) return byTab;
      return filterData(byTab, filterQuery.value);
    });

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteDestinations = async () => {
      bulkDeleteLoading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: "Deleting destinations...",
        timeout: 0,
      });

      try {
        if (selectedDestinations.value.length === 0) {
          toast({
            variant: "error",
            message: "No destinations selected for deletion",
          });
          dismiss();
          return;
        }

        const payload = {
          ids: selectedDestinations.value.map((d: any) => d.name),
        };

        const response = await destinationService.bulkDelete(
          store.state.selectedOrganization.identifier,
          payload
        );

        dismiss();

        if (response.data) {
          const { successful = [], unsuccessful = [] } = response.data;
          const successCount = successful.length;
          const failCount = unsuccessful.length;

          if (failCount > 0 && successCount > 0) {
            toast({
              variant: "warning",
              message: `${successCount} destination(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            toast({
              variant: "error",
              message: `Failed to delete ${failCount} destination(s)`,
            });
          } else {
            toast({
              variant: "success",
              message: `${successCount} destination(s) deleted successfully`,
            });
          }
        } else {
          toast({
            variant: "success",
            message: `${selectedDestinations.value.length} destination(s) deleted successfully`,
          });
        }

        selectedDestinations.value = [];
        getDestinations();
      } catch (error: any) {
        dismiss();
        const errorMessage = error.response?.data?.message || error?.message || "Error deleting destinations. Please try again.";
        if (error.response?.status != 403 || error?.status != 403) {
          toast({
            variant: "error",
            message: errorMessage,
          });
        }
      } finally {
        bulkDeleteLoading.value = false;
      }

      confirmBulkDelete.value = false;
    };


    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });


    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "alertDestinationsAdd",
        handler: () => { if (!isInputFocused()) editDestination(null); },
      },
      {
        id: "alertDestinationsRefresh",
        handler: () => { if (!isInputFocused()) getDestinations(); },
      },
      {
        id: "alertDestinationsFocusSearch",
        handler: () => {
          focusSearchInput("destination-list-search-input");
        },
      },
    ]);
    return {
      t,
      showDestinationEditor,
      destinations,
      columns,
      editDestination,
      getImageURL,
      loading,
      conformDeleteDestination,
      filterQuery,
      filterData,
      editingDestination,
      templates,
      toggleDestinationEditor,
      getDestinations,
      deleteDestination,
      cancelDeleteDestination,
      confirmDelete,
      resultTotal,
      routeTo,
      exportDestination,
      showImportDestination,
      importDestination,
      store,
      getActions,
      getTemplates,
      updateRoute,
      getDestinationByName,
      resetEditingDestination,
      visibleRows,
      activeTab,
      selectedDestinationIds,
      handleSelectedIdsUpdate,
      openBulkDeleteDialog,
      bulkDeleteDestinations,
      confirmBulkDelete,
      bulkDeleteLoading,
      selectedDestinations,
      getPrebuiltTypeName,
      getCustomDestinationLabel,
      isDefaultPrebuiltTemplate,
    };
  },
});
</script>
