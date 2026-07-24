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
  <div class="flex h-full flex-col p-0">
    <template v-if="!showImportRegexPatternDialog">
      <!-- Standard section header: title + actions only. Search moved to toolbar. -->
      <OPageLayout
        :title="t('regex_patterns.title')"
        icon="pattern"
        :subtitle="t('settings.regexPatternList.subtitle')"
        bleed
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            @click="importRegexPattern"
            data-test="regex-pattern-list-import"
            >{{ t("regex_patterns.import") }}</OButton
          >
          <OButton
            data-test="regex-pattern-list-add-pattern-btn"
            variant="primary"
            size="sm"
            @click="createRegexPattern"
            >{{ t("regex_patterns.create_pattern") }}</OButton
          >
        </template>
        <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
          <OTable
            :frame="false"
            data-test="regex-pattern-list-table"
            :data="visibleRows"
            :columns="columns"
            row-key="id"
            :selected-ids="selectedPatternIds"
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
            table-id="settings-regex-patterns"
            :show-global-filter="false"
            :loading="listLoading"
            @update:selected-ids="handleSelectedIdsUpdate"
          >
            <template #toolbar>
              <OSearchInput
                v-model="filterQuery"
                class="flex-1"
                :placeholder="t('regex_patterns.search')"
              />
            </template>
            <template #toolbar-trailing>
              <OButton
                variant="outline"
                size="icon-sm"
                icon-left="refresh"
                :loading="listLoading"
                data-test="regex-pattern-list-refresh-btn"
                @click="getRegexPatterns"
              >
                <OTooltip
                  side="bottom"
                  :content="t('common.refresh')"
                  shortcut-id="regexPatternsRefresh"
                />
              </OButton>
            </template>
            <template #empty>
              <OEmptyState
                v-if="!listLoading"
                size="hero"
                preset="no-regex-patterns"
                :filtered="filterQuery !== ''"
                @action="
                  (id) =>
                    id === 'clear-filters'
                      ? (filterQuery = '')
                      : id === 'import'
                        ? importRegexPattern()
                        : createRegexPattern()
                "
              />
            </template>
            <template #cell-pattern="{ row }">
              <OCodeCell :value="row.pattern" />
            </template>
            <template #cell-created_at="{ row }">
              <OTimeCell :value="row.created_at" unit="iso" :timezone="store.state.timezone" />
            </template>
            <template #cell-updated_at="{ row }">
              <OTimeCell :value="row.updated_at" unit="iso" :timezone="store.state.timezone" />
            </template>
            <template #cell-actions="{ row }">
              <div class="flex items-center justify-center gap-1">
                <OButton
                  :data-test="`regex-pattern-list-${row.id}-export-regex-pattern`"
                  data-row-action="export"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('settings.regexPatternList.exportTitle')"
                  @click.stop="exportRegexPattern(row)"
                  icon-left="download"
                />
                <OButton
                  :data-test="`regex-pattern-list-${row.id}-update-regex-pattern`"
                  data-row-action="edit"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('regex_patterns.edit')"
                  @click.stop="editRegexPattern(row)"
                  icon-left="edit"
                />
                <OButton
                  :data-test="`regex-pattern-list-${row.id}-delete-regex-pattern`"
                  data-row-action="delete"
                  variant="ghost-destructive"
                  size="icon-sm"
                  :title="t('regex_patterns.delete')"
                  @click.stop="confirmDeleteRegexPattern(row)"
                  icon-left="delete"
                />
              </div>
            </template>
            <template #bottom>
              <div class="flex items-center gap-2">
                <span class="text-xs font-normal">
                  {{ resultTotal }} {{ t("regex_patterns.bottom_header") }}
                </span>
                <OButton
                  v-if="selectedPatterns.length > 0"
                  data-test="regex-pattern-list-delete-patterns-btn"
                  variant="outline-destructive"
                  size="sm-action"
                  icon-left="delete"
                  :loading="bulkDeleteLoading"
                  @click="openBulkDeleteDialog"
                >
                  {{ t("settings.regexPatternList.delete") }}
                </OButton>
              </div>
            </template>
          </OTable>
        </div>
      </OPageLayout>
    </template>
    <ImportRegexPattern
      v-else-if="showImportRegexPatternDialog"
      @cancel:hideform="showImportRegexPatternDialog = false"
      @update:list="getRegexPatterns"
      :regex-patterns="regexPatterns.map((pattern) => pattern.name)"
    />
    <ConfirmDialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @update:ok="deleteRegexPattern"
      @update:cancel="deleteDialog.show = false"
    />

    <ConfirmDialog
      :title="t('settings.regexPatternList.bulkDeleteTitle')"
      :message="t('settings.regexPatternList.bulkDeleteMessage', { n: selectedPatterns.length })"
      @update:ok="bulkDeleteRegexPatterns"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
    <AddRegexPattern
      data-test="regex-pattern-list-add-regex-pattern-drawer"
      v-model:open="showAddRegexPatternDialog.show"
      :data="showAddRegexPatternDialog.data"
      :is-edit="showAddRegexPatternDialog.isEdit"
      @update:list="getRegexPatterns"
      @close="closeAddRegexPatternDialog"
    />
  </div>
</template>

<script lang="ts">
import { ref, onMounted, defineComponent, computed } from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import { convertUnixToDateFormat } from "@/utils/zincutils";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import regexPatternsService from "@/services/regex_pattern";
import AddRegexPattern from "./AddRegexPattern.vue";
import ImportRegexPattern from "./ImportRegexPattern.vue";
import config from "@/aws-exports";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "RegexPatternList",
  components: {
    OPageLayout,
    ConfirmDialog,
    AddRegexPattern,
    ImportRegexPattern,
    OEmptyState,
    OButton,
    OTooltip,
    OSearchInput,
    OTable,
    OCodeCell,
    OTimeCell,
  },
  setup() {
    const filterQuery = ref("");
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("regex_patterns.name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 270,
        meta: { align: "left", flex: true },
      },
      {
        id: "pattern",
        header: t("regex_patterns.pattern"),
        accessorKey: "pattern",
        resizable: true,
        hideable: true,
        size: 400,
        minSize: 200,
        meta: { align: "left" },
      },
      {
        id: "created_at",
        header: t("regex_patterns.created_at"),
        accessorKey: "created_at",
        resizable: true,
        hideable: true,
        size: COL.createdAt,
        meta: { align: "left" },
      },
      {
        id: "updated_at",
        header: t("regex_patterns.updated_at"),
        accessorKey: "updated_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.updatedAt,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("regex_patterns.actions"),
        isAction: true,
        pinned: "right",
        meta: { align: "center", actionCount: 3 },
      },
    ];

    const deleteDialog = ref({
      show: false,
      title: t("settings.regexPatternList.deleteTitle"),
      message: t("settings.regexPatternList.deleteMessage"),
      data: "" as any,
    });

    const regexPatterns = ref<any[]>([]);
    const selectedPatterns: Ref<any[]> = ref([]);
    const confirmBulkDelete = ref(false);
    const bulkDeleteLoading = ref(false);

    const resultTotal = ref(0);

    const listLoading = ref(false);

    const showImportRegexPatternDialog = ref(false);

    const showAddRegexPatternDialog = ref({
      show: false,
      data: {} as any,
      isEdit: false,
    });

    const selectedPatternIds = computed(() => selectedPatterns.value.map((p: any) => p.id));

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const map = new Map(regexPatterns.value.map((r: any) => [r.id, r]));
      selectedPatterns.value = ids.map((id: any) => map.get(id)).filter(Boolean);
    };

    onMounted(async () => {
      if (store.state.organizationData.regexPatterns.length == 0) {
        await getRegexPatterns();
      } else {
        regexPatterns.value = store.state.organizationData.regexPatterns;
        resultTotal.value = regexPatterns.value.length;
      }
      if (router.currentRoute.value.query.from == "logs" && config.isEnterprise == "true") {
        createRegexPattern();
      }
      if (router.currentRoute.value.query.action == "import" && config.isEnterprise == "true") {
        importRegexPattern();
      }
    });

    const filterData = (rows: any, terms: any) => {
      var filtered = [];
      terms = terms.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i]["name"].toLowerCase().includes(terms)) {
          filtered.push(rows[i]);
        }
      }
      resultTotal.value = filtered.length;
      return filtered;
    };

    const createRegexPattern = () => {
      showAddRegexPatternDialog.value.show = true;
      showAddRegexPatternDialog.value.isEdit = false;
      showAddRegexPatternDialog.value.data = {};
    };

    const getRegexPatterns = async () => {
      listLoading.value = true;
      try {
        const response = await regexPatternsService.list(
          store.state.selectedOrganization.identifier,
        );
        regexPatterns.value = response.data.patterns.map((pattern: any) => ({
          ...pattern,
          created_at: convertUnixToDateFormat(pattern.created_at),
          updated_at: convertUnixToDateFormat(pattern.updated_at),
        }));
        store.dispatch("setRegexPatterns", regexPatterns.value);
        resultTotal.value = regexPatterns.value.length;
      } catch (error: any) {
        toast({
          message: error.data.message || t("settings.regexPatternList.errorFetching"),
          variant: "error",
        });
      } finally {
        listLoading.value = false;
      }
    };

    const editRegexPattern = (row: any) => {
      showAddRegexPatternDialog.value.show = true;
      showAddRegexPatternDialog.value.isEdit = true;
      showAddRegexPatternDialog.value.data = row;
    };

    const confirmDeleteRegexPattern = (row: any) => {
      deleteDialog.value.show = true;
      deleteDialog.value.data = row.id;
    };

    const deleteRegexPattern = async () => {
      try {
        await regexPatternsService.delete(
          store.state.selectedOrganization.identifier,
          deleteDialog.value.data,
        );
        getRegexPatterns();
        toast({
          message: t("settings.regexPatternList.deletedSuccess"),
          variant: "success",
        });
      } catch (error: any) {
        toast({
          message:
            error?.data?.message ||
            error?.response?.data?.message ||
            t("settings.regexPatternList.errorDeleting"),
          variant: "error",
        });
      }
    };

    const importRegexPattern = () => {
      showImportRegexPatternDialog.value = true;
      router.push({
        path: "/settings/regex_patterns",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          action: "import",
        },
      });
    };

    const exportRegexPattern = (row: any) => {
      let url = "";
      try {
        const regexPatternToBeExported = {
          name: row.name,
          pattern: row.pattern,
          description: row.description,
        };

        const regexPatternJson = JSON.stringify(regexPatternToBeExported, null, 2);
        const blob = new Blob([regexPatternJson], {
          type: "application/json",
        });
        url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${row.name || "regex_pattern"}.json`;
        link.click();
        toast({
          message: t("settings.regexPatternList.exportedSuccess"),
          variant: "success",
        });
      } catch (error: any) {
        toast({
          message: error.data.message || t("settings.regexPatternList.errorExporting"),
          variant: "error",
        });
      } finally {
        if (url) {
          URL.revokeObjectURL(url);
        }
      }
    };

    const closeAddRegexPatternDialog = () => {
      showAddRegexPatternDialog.value.show = false;
      store.state.organizationData.regexPatternPrompt = "";
      store.state.organizationData.regexPatternTestValue = "";
      router.push({
        path: "/settings/regex_patterns",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const visibleRows = computed(() => {
      return filterData(regexPatterns.value, filterQuery.value);
    });

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteRegexPatterns = async () => {
      bulkDeleteLoading.value = true;
      const patternIds = selectedPatterns.value.map((pattern: any) => pattern.id);

      try {
        const res = await regexPatternsService.bulkDelete(
          store.state.selectedOrganization.identifier,
          { ids: patternIds },
        );
        const { successful, unsuccessful } = res.data;

        if (successful.length > 0 && unsuccessful.length === 0) {
          toast({
            message: t("settings.regexPatternList.bulkDeleteSuccess", { n: successful.length }),
            variant: "success",
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          toast({
            message: t("settings.regexPatternList.bulkDeletePartial", {
              successful: successful.length,
              unsuccessful: unsuccessful.length,
            }),
            variant: "warning",
          });
        } else if (unsuccessful.length > 0) {
          toast({
            message: t("settings.regexPatternList.bulkDeleteFailed", { n: unsuccessful.length }),
            variant: "error",
          });
        }

        selectedPatterns.value = [];
        confirmBulkDelete.value = false;
        await getRegexPatterns();
      } catch (error: any) {
        const errorMessage =
          error?.data?.message ||
          error?.message ||
          t("settings.regexPatternList.errorBulkDeleting");
        if (error.response?.status != 403 || error?.status != 403) {
          toast({
            message: errorMessage,
            variant: "error",
          });
        }
      } finally {
        bulkDeleteLoading.value = false;
      }
    };

    useShortcuts([
      {
        id: "regexPatternsRefresh",
        handler: () => {
          if (!isInputFocused()) getRegexPatterns();
        },
      },
    ]);

    return {
      t,
      store,
      router,
      filterQuery,
      columns,
      regexPatterns,
      filterData,
      resultTotal,
      createRegexPattern,
      listLoading,
      editRegexPattern,
      deleteRegexPattern,
      deleteDialog,
      confirmDeleteRegexPattern,
      showAddRegexPatternDialog,
      getRegexPatterns,
      showImportRegexPatternDialog,
      importRegexPattern,
      exportRegexPattern,
      closeAddRegexPatternDialog,
      visibleRows,
      selectedPatterns,
      selectedPatternIds,
      handleSelectedIdsUpdate,
      confirmBulkDelete,
      openBulkDeleteDialog,
      bulkDeleteRegexPatterns,
      bulkDeleteLoading,
    };
  },
});
</script>
