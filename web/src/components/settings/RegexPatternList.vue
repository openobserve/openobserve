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
  <div class="tw:rounded-md tw:flex tw:flex-col tw:h-full tw:p-0">
    <template v-if="!showImportRegexPatternDialog">
    <!-- Standard section header: title + actions only. Search moved to toolbar. -->
    <AppPageHeader
      :title="t('regex_patterns.title')"
      icon="pattern"
      :subtitle="'Reusable regex patterns for redaction'"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          @click="importRegexPattern"
          data-test="regex-pattern-list-import"
        >{{ t("regex_patterns.import") }}</OButton>
        <OButton
          data-test="regex-pattern-list-add-pattern-btn"
          variant="primary"
          size="sm"
          @click="createRegexPattern"
        >{{ t("regex_patterns.create_pattern") }}</OButton>
      </template>
    </AppPageHeader>
    <div class="card-container tw:flex-1 tw:min-h-0 tw:overflow-hidden">
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
          class="tw:flex-1"
          :placeholder="t('regex_patterns.search')"
        />
      </template>
      <template #empty>
        <div v-if="!listLoading && filterQuery == ''">
          <NoRegexPatterns @create-new-regex-pattern="createRegexPattern" @import-regex-pattern="importRegexPattern" />
        </div>
        <OEmptyState
          v-else-if="!listLoading && filterQuery != ''"
          size="hero"
          filtered
          :title="t('emptyState.filtered.title', { noun: t('regex_patterns.header').toLowerCase() })"
          :description="t('emptyState.filtered.description', { noun: t('regex_patterns.header').toLowerCase() })"
          @action="(id) => id === 'clear-filters' && (filterQuery = '')"
        />
      </template>
      <template #cell-actions="{ row }">
        <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
          <OButton
            :data-test="`regex-pattern-list-${row.id}-export-regex-pattern`"
            variant="ghost"
            size="icon-sm"
            title="Export Regex Pattern"
            @click.stop="exportRegexPattern(row)"
            icon-left="download"
          />
          <OButton
            :data-test="`regex-pattern-list-${row.id}-update-regex-pattern`"
            variant="ghost"
            size="icon-sm"
            :title="t('regex_patterns.edit')"
            @click.stop="editRegexPattern(row)"
            icon-left="edit"
          />
          <OButton
            :data-test="`regex-pattern-list-${row.id}-delete-regex-pattern`"
            variant="ghost-destructive"
            size="icon-sm"
            :title="t('regex_patterns.delete')"
            @click.stop="confirmDeleteRegexPattern(row)"
            icon-left="delete"
          />
        </div>
      </template>
      <template #bottom>
        <div class="tw:flex tw:items-center tw:gap-2">
          <span class="tw:text-xs tw:text-text-primary tw:font-medium">
            {{ resultTotal }} {{ t("regex_patterns.bottom_header") }}
          </span>
          <OButton
            v-if="selectedPatterns.length > 0"
            data-test="regex-pattern-list-delete-patterns-btn"
            variant="outline-destructive"
            size="sm-action"
            icon-left="delete"
            @click="openBulkDeleteDialog"
          >
            Delete
          </OButton>
        </div>
      </template>
    </OTable>
    </div>
    </template>
    <ImportRegexPattern
      v-else-if="showImportRegexPatternDialog"
      @cancel:hideform="showImportRegexPatternDialog = false"
      @update:list="getRegexPatterns"
      :regex-patterns="regexPatterns.map(pattern => pattern.name)"
    />
    <ConfirmDialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @update:ok="deleteRegexPattern"
      @update:cancel="deleteDialog.show = false"
    />

    <ConfirmDialog
      title="Delete Regex Patterns"
      :message="`Are you sure you want to delete ${selectedPatterns.length} regex pattern(s)?`"
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
import { ref, onMounted, watch, defineComponent, computed } from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import { convertUnixToQuasarFormat } from "@/utils/zincutils";
import ConfirmDialog from "../ConfirmDialog.vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import NoRegexPatterns from "./NoRegexPatterns.vue";
import regexPatternsService from "@/services/regex_pattern";
import AddRegexPattern from "./AddRegexPattern.vue";
import ImportRegexPattern from "./ImportRegexPattern.vue";
import config from "@/aws-exports";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "RegexPatternList",
  components: {
    AppPageHeader,
    NoRegexPatterns,
    ConfirmDialog,
    AddRegexPattern,
    ImportRegexPattern,
    OEmptyState,
    OButton,
    OSearchInput,
    OTable,
  },
  setup() {
    const filterQuery = ref("");
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    const columns: OTableColumnDef[] = [
      {
        id: "#",
        header: "#",
        accessorKey: "#",
        size: TABLE_INDEX_COL_SIZE,
        meta: { align: "left" },
      },
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
      title: "Delete Regex Pattern",
      message: "Are you sure you want to delete this regex pattern?",
      data: "" as any,
    });

    const regexPatterns = ref<any[]>([]);
    const selectedPatterns: Ref<any[]> = ref([]);
    const confirmBulkDelete = ref(false);

    const resultTotal = ref(0);


    const listLoading = ref(false);

    const showImportRegexPatternDialog = ref(false);

    const showAddRegexPatternDialog = ref({
      show: false,
      data: {} as any,
      isEdit: false,
    });

    const selectedPatternIds = computed(() =>
      selectedPatterns.value.map((p: any) => p.id),
    );

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
      if (
        router.currentRoute.value.query.from == "logs" &&
        config.isEnterprise == "true"
      ) {
        createRegexPattern();
      }
      if (
        router.currentRoute.value.query.action == "import" &&
        config.isEnterprise == "true"
      ) {
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
        let counter = 1;
        regexPatterns.value = response.data.patterns.map((pattern: any) => ({
          ...pattern,
          "#": counter <= 9 ? `0${counter++}` : counter++,
          created_at: convertUnixToQuasarFormat(pattern.created_at),
          updated_at: convertUnixToQuasarFormat(pattern.updated_at),
        }));
        store.dispatch("setRegexPatterns", regexPatterns.value);
        resultTotal.value = regexPatterns.value.length;
      } catch (error: any) {
        toast({
          message: error.data.message || "Error fetching regex patterns",
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
          message: "Regex pattern deleted successfully.",
          variant: "success",
        });
      } catch (error: any) {
        toast({
          message:
            error?.data?.message ||
            error?.response?.data?.message ||
            "Error deleting regex pattern",
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

        const regexPatternJson = JSON.stringify(
          regexPatternToBeExported,
          null,
          2,
        );
        const blob = new Blob([regexPatternJson], {
          type: "application/json",
        });
        url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${row.name || "regex_pattern"}.json`;
        link.click();
        toast({
          message: "Regex pattern exported successfully",
          variant: "success",
        });
      } catch (error: any) {
        toast({
          message: error.data.message || "Error exporting regex pattern",
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
      const patternIds = selectedPatterns.value.map(
        (pattern: any) => pattern.id,
      );

      try {
        const res = await regexPatternsService.bulkDelete(
          store.state.selectedOrganization.identifier,
          { ids: patternIds },
        );
        const { successful, unsuccessful } = res.data;

        if (successful.length > 0 && unsuccessful.length === 0) {
          toast({
            message: `Successfully deleted ${successful.length} regex pattern(s)`,
            variant: "success",
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          toast({
            message: `Deleted ${successful.length} regex pattern(s), but ${unsuccessful.length} failed`,
            variant: "warning",
          });
        } else if (unsuccessful.length > 0) {
          toast({
            message: `Failed to delete ${unsuccessful.length} regex pattern(s)`,
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
          "Error while deleting regex patterns";
        if (error.response?.status != 403 || error?.status != 403) {
          toast({
            message: errorMessage,
            variant: "error",
          });
        }
      }
    };

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
    };
  },
});
</script>

<style lang="scss">
.o2-table-cell-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  display: block;
}
</style>
