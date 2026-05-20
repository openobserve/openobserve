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
    <div class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px] tw:flex-shrink-0">
      <div class="q-table__title tw:font-[600]" data-test="regex-pattern-list-title">
        {{ t("regex_patterns.title") }}
      </div>
      <OInput
        v-model="filterQuery"
        class="tw:ml-auto no-border o2-search-input"
        :placeholder="t('regex_patterns.search')"
      >
        <template #icon-left>
          <OIcon class="o2-search-input-icon" name="search" size="sm" />
        </template>
      </OInput>
      <OButton
        class="tw:ml-2"
        variant="outline"
        size="sm-action"
        @click="importRegexPattern"
        data-test="regex-pattern-list-import"
      >{{ t("regex_patterns.import") }}</OButton>
      <OButton
        data-test="regex-pattern-list-add-pattern-btn"
        class="tw:ml-2"
        variant="primary"
        size="sm-action"
        @click="createRegexPattern"
      >{{ t("regex_patterns.create_pattern") }}</OButton>
    </div>
    <div class="tw:flex-1 tw:min-h-0">
    <OTable
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
      :show-global-filter="false"
      :loading="listLoading"
      @update:selected-ids="handleSelectedIdsUpdate"
    >
      <template #empty>
        <div v-if="!listLoading && filterQuery == ''" class="tw:w-full tw:flex tw:flex-col flex-center tw:mt-1 tw:h-full" style="font-size: 1.5rem">
          <NoRegexPatterns @create-new-regex-pattern="createRegexPattern" @import-regex-pattern="importRegexPattern" />
        </div>
        <NoData v-else-if="!listLoading && filterQuery != ''" />
      </template>
      <template #cell-actions="{ row }">
        <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
          <OButton
            :data-test="`regex-pattern-list-${row.id}-export-regex-pattern`"
            variant="ghost"
            size="icon-xs-sq"
            title="Export Regex Pattern"
            @click.stop="exportRegexPattern(row)"
            icon-left="download"
          />
          <OButton
            :data-test="`regex-pattern-list-${row.id}-update-regex-pattern`"
            variant="ghost"
            size="icon-xs-sq"
            :title="t('regex_patterns.edit')"
            @click.stop="editRegexPattern(row)"
            icon-left="edit"
          />
          <OButton
            :data-test="`regex-pattern-list-${row.id}-delete-regex-pattern`"
            variant="ghost-destructive"
            size="icon-xs-sq"
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
            variant="outline"
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
import NoData from "@/components/shared/grid/NoData.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "RegexPatternList",
  components: {
    NoRegexPatterns,
    ConfirmDialog,
    AddRegexPattern,
    ImportRegexPattern,
    NoData,
    OButton,
    OInput,
    OIcon,
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
        size: 67,
        meta: { align: "left" },
      },
      {
        id: "name",
        header: t("regex_patterns.name"),
        accessorKey: "name",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "pattern",
        header: t("regex_patterns.pattern"),
        accessorKey: "pattern",
        size: 400,
        meta: { align: "left" },
      },
      {
        id: "created_at",
        header: t("regex_patterns.created_at"),
        accessorKey: "created_at",
        size: 180,
        meta: { align: "left" },
      },
      {
        id: "updated_at",
        header: t("regex_patterns.updated_at"),
        accessorKey: "updated_at",
        sortable: true,
        size: 180,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("regex_patterns.actions"),
        isAction: true,
        pinned: "right",
        meta: { align: "center" },
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
          timeout: 1500,
        });
      } catch (error: any) {
        toast({
          message:
            error?.data?.message ||
            error?.response?.data?.message ||
            "Error deleting regex pattern",
          timeout: 1500,
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
        });
      } catch (error: any) {
        toast({
          message: error.data.message || "Error exporting regex pattern",
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
            timeout: 2000,
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          toast({
            message: `Deleted ${successful.length} regex pattern(s), but ${unsuccessful.length} failed`,
            timeout: 3000,
          });
        } else if (unsuccessful.length > 0) {
          toast({
            message: `Failed to delete ${unsuccessful.length} regex pattern(s)`,
            timeout: 2000,
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
            timeout: 2000,
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
