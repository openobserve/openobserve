<template>
    <q-page class="q-pa-none" style="min-height: inherit; height: calc(100vh - 88px);" 
    >
    <div v-if="!showImportRegexPatternDialog" class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
    >
      <div class="q-table__title tw:font-[600]" data-test="regex-pattern-list-title">
            {{ t("regex_patterns.title") }}
          </div>
          <q-input
                v-model="filterQuery"
                borderless
                dense
                class="q-ml-auto no-border o2-search-input"
                :placeholder="t('regex_patterns.search')"
              >
                <template #prepend>
                  <q-icon class="o2-search-input-icon"  name="search" />
                </template>
              </q-input>
          <q-btn
            class="o2-secondary-button q-ml-sm tw:h-[36px]"
            no-caps
            flat
            :label="t(`regex_patterns.import`)"
            @click="importRegexPattern"
            data-test="regex-pattern-list-import"
          />
          <q-btn
            data-test="regex-pattern-list-add-pattern-btn"
            class="o2-primary-button q-ml-sm tw:h-[36px]"
            no-caps
            flat
            :label="t(`regex_patterns.create_pattern`)"
            @click="createRegexPattern"
          />
    </div>
        <q-table
          v-if="!showImportRegexPatternDialog"
          data-test="regex-pattern-list-table"
          ref="regexPatternListTableRef"
          :rows="visibleRows"
          :columns="columns"
          row-key="id"
          selection="multiple"
          v-model:selected="selectedPatterns"
          :pagination="pagination"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          :style="hasVisibleRows
            ? 'width: 100%; height: calc(100vh - 112px); overflow-y: auto;'
            : 'width: 100%'"
        >
        <template #no-data>
          <div v-if="!listLoading && filterQuery == ''" class="full-width column flex-center q-mt-xs full-height" style="font-size: 1.5rem">
          <NoRegexPatterns  @create-new-regex-pattern="createRegexPattern" @import-regex-pattern="importRegexPattern" />
          </div>
          <div v-else-if="!listLoading && filterQuery != ''" class="full-width column flex-center q-mt-xs" style="font-size: 1.5rem">
            <NoData />
          </div>
          <div v-else class="full-width column flex-center q-mt-xs" style="font-size: 1.5rem">
            <q-spinner-hourglass size="50px" color="primary" style="margin-top: 20vh" />

          </div>
        </template>
        <template v-slot:body-selection="scope">
          <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
        </template>
        <template v-slot:header="props">
         <q-tr :props="props">
              <!-- Adding this block to render the select-all checkbox -->
              <q-th v-if="columns.length > 0" auto-width>
                <q-checkbox
                  v-model="props.selected"
                  size="sm"
                  :class="store.state.theme === 'dark' ? 'o2-table-checkbox-dark' : 'o2-table-checkbox-light'"
                  class="o2-table-checkbox"
                />
              </q-th>

              <!-- render the table headers -->
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
        <template v-slot:body="props">
          <q-tr :props="props">
          <!-- render checkbox column -->
          <q-td auto-width>
            <q-checkbox v-model="props.selected" size="sm" class="o2-table-checkbox" />
          </q-td>

          <!-- render the body of the columns -->
          <q-td v-for="col in columns" :key="col.name " :props="props" :style="col.style">
            <template v-if="col.name  !== 'actions'">
              <div class="o2-table-cell-content">
                {{ props.row[col.field] }}
              </div>
            </template>
            <template v-else>
              <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
                <q-btn
                  :data-test="`regex-pattern-list-${props.row.id}-export-regex-pattern`"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  icon="download"
                  title="Export Regex Pattern"
                  @click.stop="exportRegexPattern(props.row)"
                >
                </q-btn>
                <q-btn
                  :data-test="`regex-pattern-list-${props.row.id}-update-regex-pattern`"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  icon="edit"
                  :title="t('regex_patterns.edit')"
                  @click.stop="editRegexPattern(props.row)"
                >
                </q-btn>
                <q-btn
                  :data-test="`regex-pattern-list-${props.row.id}-delete-regex-pattern`"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  :icon="outlinedDelete"
                  :title="t('regex_patterns.delete')"
                  @click.stop="confirmDeleteRegexPattern(props.row)"
                >
                </q-btn>
              </div>
            </template>
          </q-td>
                      
        </q-tr>
        </template>
        <template #bottom="scope">
          <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
            <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[150px] tw:mr-md">
              {{ resultTotal }} {{ t('regex_patterns.bottom_header') }}
            </div>
            <q-btn
              v-if="selectedPatterns.length > 0"
              data-test="regex-pattern-list-delete-patterns-btn"
              class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-secondary-button-dark'
                  : 'o2-secondary-button-light'
              "
              no-caps
              dense
              @click="openBulkDeleteDialog"
            >
              <q-icon name="delete" size="16px" />
              <span class="tw:ml-2">Delete</span>
            </q-btn>
            <QTablePagination
              :scope="scope"
              :position="'bottom'"
              :resultTotal="resultTotal"
              :perPageOptions="perPageOptions"
              @update:changeRecordPerPage="changePagination"
            />
          </div>
        </template>
        </q-table>
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
        <q-dialog v-model="showAddRegexPatternDialog.show" position="right" full-height maximized>
          <AddRegexPattern :data="showAddRegexPatternDialog.data" :is-edit="showAddRegexPatternDialog.isEdit" @update:list="getRegexPatterns" @close="closeAddRegexPatternDialog" />
        </q-dialog>
      </q-page>
  </template>

<script lang="ts">
    import { ref, onBeforeMount, onActivated, watch, defineComponent, onMounted, computed } from "vue"; 
    import type { Ref } from "vue";
    import { useI18n } from "vue-i18n";
    import { useQuasar, type QTableProps } from "quasar";
    import { convertUnixToQuasarFormat, getImageURL } from "@/utils/zincutils";
    import ConfirmDialog from "../ConfirmDialog.vue";
    import { useRouter } from "vue-router";
    import QTablePagination from "@/components/shared/grid/Pagination.vue";
    import { useStore } from "vuex";
    import NoRegexPatterns from "./NoRegexPatterns.vue";
    import regexPatternsService from "@/services/regex_pattern";
    import AddRegexPattern from "./AddRegexPattern.vue";
    import ImportRegexPattern from "./ImportRegexPattern.vue";
    import config from "@/aws-exports";
    import NoData from "@/components/shared/grid/NoData.vue";
    import { outlinedDelete } from "@quasar/extras/material-icons-outlined";

    export default defineComponent({
        name: "RegexPatternList",
        components: {
            QTablePagination,
            NoRegexPatterns,
            ConfirmDialog,
            AddRegexPattern,
            ImportRegexPattern,
            NoData,
        },
    setup() {

    const regexPatternListTableRef = ref(null);
    const pagination: any = ref({
        rowsPerPage: 20,
      });
    const filterQuery = ref("");
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();


    const columns = ref<any>([
        {
          name: "#",
          label: "#",
          field: "#",
          align: "left",
          style: "width: 67px",
        },
        {
          name: "name",
          field: "name",
          label: t("regex_patterns.name"),
          align: "left",
          sortable: true,
        },
        {
          name: "pattern",
          field: "pattern",
          label: t("regex_patterns.pattern"),
          align: "left",
          style: "max-width: 400px; overflow: hidden;",
        },
        {
          name: "created_at",
          field: "created_at",
          label: t("regex_patterns.created_at"),
          align: "left",
          style: "width: 180px",
        },
        {
          name: "updated_at",
          field: "updated_at",
          label: t("regex_patterns.updated_at"),
          align: "left",
          sortable: true,
          style: "width: 180px",
        },
        {
          name: "actions",
          field: "actions",
          label: t("regex_patterns.actions"),
          align: "left",
          classes: "actions-column",
        }
      ]);
    const deleteDialog = ref({
      show: false,
      title: "Delete Regex Pattern",
      message: "Are you sure you want to delete this regex pattern?",
      data: "" as any,
    });

    const regexPatterns = ref([]);
    const selectedPatterns: Ref<any[]> = ref([]);
    const confirmBulkDelete = ref(false);

    const resultTotal = ref(0);

    const perPageOptions = ref([10, 20, 50, 100]);

    const $q = useQuasar();

    const listLoading = ref(false);
    const selectedPerPage = ref<number>(20);

    const showImportRegexPatternDialog = ref(false);


    const showAddRegexPatternDialog = ref({
      show: false,
      data: {} as any,
      isEdit: false,
    });

    onMounted(async () => {
      //if the regex patterns are not in the store, then we need to fetch them from the api
      //else we can use the regex patterns from the store
      //this is done to avoid multiple api calls while switching between the regex pattern list and other pages
      if(store.state.organizationData.regexPatterns.length == 0){
        await getRegexPatterns();
      }
      else{
        regexPatterns.value = store.state.organizationData.regexPatterns;
        resultTotal.value = regexPatterns.value.length;
      }
      // we need to open the add regex pattern dialog if the user has been redirected from the logs page
      if(router.currentRoute.value.query.from == 'logs' && config.isEnterprise == 'true'){
        createRegexPattern();
      }
      //this is kept so that when user tries to refresh the page while in import regex pattern dialog, the dialog is not closed
      if(router.currentRoute.value.query.action == 'import' && config.isEnterprise == 'true'){
        importRegexPattern();
      }
    });

    const changePagination = (val: { label: string; value: any }) => { 
      //this is done sometimes we are getting the value as an object and sometimes as a number
      //so we need to handle both cases
      let rowsPerPage = val.value ? val.value : val;
      selectedPerPage.value = rowsPerPage;
      pagination.value.rowsPerPage = rowsPerPage;
      regexPatternListTableRef.value?.setPagination(pagination.value);
    };

    watch(filterQuery, (newVal) => {
      if(newVal == ""){
        resultTotal.value = regexPatterns.value.length;
      }
    })
    //this is used to filter the regex pattern based on the name using the search input
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
    }
    //call this function only on mounted or any changes in the list like updating the existing regex pattern or deleting the existing regex pattern
    //we are storing the regex patterns in the store to avoid multiple api calls and it is stored in the organizationData.regexPatterns
    //it can be reused because after converting all the required data to quasar format, it can be used in the table
    const getRegexPatterns = async () => {
      listLoading.value = true;
      try{
        const response = await regexPatternsService.list(store.state.selectedOrganization.identifier);
        let counter = 1;
        regexPatterns.value = response.data.patterns.map((pattern: any) => ({
          ...pattern,
          "#": counter <= 9 ? `0${counter++}` : counter++,
          created_at: convertUnixToQuasarFormat(pattern.created_at),
          updated_at: convertUnixToQuasarFormat(pattern.updated_at),
        }));
        store.dispatch("setRegexPatterns", regexPatterns.value);
        resultTotal.value = regexPatterns.value.length;
      } catch (error) {
        $q.notify({
          message: error.data.message || "Error fetching regex patterns",
          color: "negative",
          icon: "error",
        });
      }
      finally{
        listLoading.value = false;
      }
    }

    const editRegexPattern = (row: any) => {
      showAddRegexPatternDialog.value.show = true;
      showAddRegexPatternDialog.value.isEdit = true;
      showAddRegexPatternDialog.value.data = row;
    }

    const confirmDeleteRegexPattern = (row: any) => {
      deleteDialog.value.show = true;
      deleteDialog.value.data = row.id;
    }

    const deleteRegexPattern = async () => {
      try{
        await regexPatternsService.delete(store.state.selectedOrganization.identifier, deleteDialog.value.data);
        getRegexPatterns();
        $q.notify({
          message: `Regex pattern deleted successfully.`,
          color: "positive",
          timeout: 1500,
        });
      } catch (error) {
        $q.notify({
          message: error?.data?.message || error?.response?.data?.message || "Error deleting regex pattern",
          color: "negative",
          timeout: 1500,
        });
      }
    }

    const importRegexPattern = () => {
      showImportRegexPatternDialog.value = true;
      router.push({
        path: '/settings/regex_patterns',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          action: 'import'
        },
      })
    }

    const exportRegexPattern = (row: any) => {
      let url = "";
      try{
      const regexPatternToBeExported = {
        name: row.name,
        pattern: row.pattern,
        description: row.description,
      }

      const regexPatternJson = JSON.stringify(regexPatternToBeExported, null, 2);
      const blob = new Blob([regexPatternJson], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${row.name || 'regex_pattern'}.json`;
      link.click();
      $q.notify({
        message: `Regex pattern exported successfully`,
        color: "positive",
        icon: "check",
      });
    } catch (error) {
      $q.notify({
        message: error.data.message || "Error exporting regex pattern",
        color: "negative",
        icon: "error",
      });
    }
    finally{
      //this is added for proper clean up of the blob url
      if(url){
        URL.revokeObjectURL(url);
      }
    }
  }
  const closeAddRegexPatternDialog = () => {
    //reset the values if any before closing the dialog
    //this will make sure that the values are not set in the ai chat input context when user clicks on the create regex pattern button again
    showAddRegexPatternDialog.value.show = false;
    store.state.organizationData.regexPatternPrompt = "";
    store.state.organizationData.regexPatternTestValue = "";
    router.push({
      path: '/settings/regex_patterns',
      query:{
        org_identifier: store.state.selectedOrganization.identifier,
      }
    })
  };

    const visibleRows = computed(() => {
      return filterData(regexPatterns.value, filterQuery.value);
    });
    const hasVisibleRows = computed(() => {
      return visibleRows.value.length > 0;
    });

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteRegexPatterns = async () => {
      const patternIds = selectedPatterns.value.map((pattern: any) => pattern.id);

      try {
        const res = await regexPatternsService.bulkDelete(store.state.selectedOrganization.identifier, { ids: patternIds });
        const { successful, unsuccessful } = res.data;

        if (successful.length > 0 && unsuccessful.length === 0) {
          $q.notify({
            message: `Successfully deleted ${successful.length} regex pattern(s)`,
            color: "positive",
            timeout: 2000,
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          $q.notify({
            message: `Deleted ${successful.length} regex pattern(s), but ${unsuccessful.length} failed`,
            color: "warning",
            timeout: 3000,
          });
        } else if (unsuccessful.length > 0) {
          $q.notify({
            message: `Failed to delete ${unsuccessful.length} regex pattern(s)`,
            color: "negative",
            timeout: 2000,
          });
        }

        selectedPatterns.value = [];
        confirmBulkDelete.value = false;
        await getRegexPatterns();
      } catch (error: any) {
        const errorMessage = error?.data?.message || error?.message || "Error while deleting regex patterns";
        if (error.response?.status != 403 || error?.status != 403) {
          $q.notify({
            message: errorMessage,
            color: "negative",
            timeout: 2000,
          });
        }
      }
    };

    return {
        t,
        store,
        router,
        regexPatternListTableRef,
        pagination,
        filterQuery,
        columns,
        regexPatterns,
        filterData,
        resultTotal,
        perPageOptions,
        changePagination,
        createRegexPattern,
        listLoading,
        editRegexPattern,
        deleteRegexPattern,
        deleteDialog,
        confirmDeleteRegexPattern,
        showAddRegexPatternDialog,
        getRegexPatterns,
        selectedPerPage,
        showImportRegexPatternDialog,
        importRegexPattern,
        exportRegexPattern,
        closeAddRegexPatternDialog,
        visibleRows,
        hasVisibleRows,
        outlinedDelete,
        selectedPatterns,
        confirmBulkDelete,
        openBulkDeleteDialog,
        bulkDeleteRegexPatterns,
    }
    }
})

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