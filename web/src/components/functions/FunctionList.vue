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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div data-test="function-list-page" class="flex h-full min-h-0 flex-col">
    <OPageLayout
      v-if="!showAddJSTransformDialog"
      :title="t('function.header')"
      icon="function"
      :subtitle="t('function.subtitle')"
      tabs-below
      bleed
    >
      <template #header-tabs>
        <PipelineSectionTabs />
      </template>
      <template #actions>
        <OButton
          variant="primary"
          size="sm"
          data-test="function-list-add-function-btn"
          @click="showAddUpdateFn({})"
        >
          {{ t(`function.add`) }}
        </OButton>
      </template>
      <div class="min-h-0 w-full flex-1 overflow-hidden">
        <div class="h-full">
          <OTable
            :frame="false"
            :data="visibleRows"
            :columns="columns"
            row-key="name"
            :loading="loading"
            pagination="client"
            :page-size="pageSize"
            :page-size-options="pageSizeOptions"
            selection="multiple"
            v-model:selected-ids="selectedFunctionIds"
            show-index
            :show-global-filter="false"
            :default-columns="false"
            width="100%"
            class="h-full w-full"
          >
            <template #toolbar>
              <div class="flex w-full items-center gap-2">
                <OSearchInput
                  data-test="functions-list-search-input"
                  v-model="filterQuery"
                  class="flex-1"
                  :placeholder="t('function.search')"
                />
              </div>
            </template>
            <template #toolbar-trailing>
              <OButton
                variant="outline"
                size="icon-sm"
                icon-left="refresh"
                :loading="loading"
                data-test="functions-list-refresh-btn"
                @click="getJSTransforms"
              >
                <OTooltip
                  side="bottom"
                  :content="t('common.refresh')"
                  shortcut-id="functionsRefresh"
                />
              </OButton>
            </template>
            <template #empty>
              <OEmptyState
                size="hero"
                preset="no-functions"
                :filtered="!!filterQuery"
                @action="
                  (id) => (id === 'clear-filters' ? (filterQuery = '') : showAddUpdateFn({}))
                "
              />
            </template>

            <template #cell-name="{ row, value }">
              <span
                class="text-text-body"
                :data-test="`function-list-name-cell-${row?.name ?? value}`"
                >{{ value }}</span
              >
            </template>

            <!-- Language of the transform. Its own column (sortable + hideable)
                   rather than a glyph on the name, so JS vs VRL reads at a glance. -->
            <template #cell-transType="{ row }">
              <OBadge
                size="xs"
                :variant="row?.transType === '1' ? 'amber-soft' : 'blue-soft'"
                :data-test="`function-list-type-badge-${row?.transType === '1' ? 'js' : 'vrl'}`"
              >
                {{ row?.transType === "1" ? t("function.javascript") : t("function.vrl") }}
              </OBadge>
            </template>

            <template #cell-actions="{ row }">
              <div class="actions-container flex items-center">
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  :title="t('function.updateTitle')"
                  data-test="function-list-edit-function-btn"
                  data-row-action="edit"
                  @click="showAddUpdateFn({ row })"
                  icon-left="edit"
                />
                <OButton
                  variant="ghost-destructive"
                  size="icon-sm"
                  :title="t('function.delete')"
                  data-test="function-list-delete-function-btn"
                  data-row-action="delete"
                  @click="showDeleteDialogFn({ row })"
                  icon-left="delete"
                />
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="account-tree"
                  :title="'Associated Pipelines'"
                  data-row-action="view"
                  @click="getAssociatedPipelines({ row })"
                />
              </div>
            </template>

            <template #bottom>
              <div class="flex w-full items-center justify-between py-2">
                <div class="mr-4 flex items-center text-xs font-normal">
                  {{ resultTotal }} {{ t("function.header") }}
                </div>
                <OButton
                  v-if="selectedFunctions.length > 0"
                  data-test="function-list-delete-functions-btn"
                  variant="outline-destructive"
                  size="sm"
                  :loading="bulkDeleteLoading"
                  @click="openBulkDeleteDialog"
                  icon-left="delete"
                >
                  Delete
                </OButton>
              </div>
            </template>
          </OTable>
        </div>
      </div>
    </OPageLayout>
    <div v-else class="min-h-0 flex-1">
      <AddFunction
        v-model="formData"
        :isUpdated="isUpdated"
        class="p-2"
        @update:list="refreshList"
        @cancel:hideform="hideForm"
        @sendToAiChat="sendToAiChat"
      />
    </div>
    <ConfirmDialog
      title="Delete Transform"
      message="Are you sure you want to delete transform?"
      @update:ok="deleteFn"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />

    <ConfirmDialog
      title="Delete Functions"
      :message="`Are you sure you want to delete ${selectedFunctions.length} function(s)?`"
      @update:ok="bulkDeleteFunctions"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />

    <ODialog
      data-test="function-list-force-delete-dialog"
      v-model:open="confirmForceDelete"
      persistent
      size="md"
      :title="`Pipelines Associated with ${selectedDelete?.name}`"
    >
      <div v-if="transformedPipelineList.length > 0" class="max-h-50 overflow-y-auto">
        <ul class="scrollable-list m-0 flex list-none flex-col p-0">
          <li
            v-for="(pipeline, index) in transformedPipelineList"
            :key="pipeline.value"
            @click="onPipelineSelect(pipeline)"
            class="hover:bg-muted/50 flex cursor-pointer items-center px-3 py-2"
            :data-test="`function-list-pipeline-item-${pipeline.value}`"
          >
            <span class="text-sm">{{ index + 1 }}. {{ pipeline.label }}</span>
          </li>
        </ul>
      </div>
      <div v-else>
        <div class="text-center text-xl font-semibold">
          No pipelines associated with this function
        </div>
      </div>
    </ODialog>
  </div>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import jsTransformService from "../../services/jstransform";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import segment from "../../services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "../../utils/zincutils";
import { useReo } from "@/services/reodotdev_analytics";
import searchState from "@/composables/useLogs/searchState";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import PipelineSectionTabs from "@/components/pipeline/PipelineSectionTabs.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "functionList",
  components: {
    OEmptyState,
    OPageLayout,
    PipelineSectionTabs,
    OTable,
    AddFunction: defineAsyncComponent(() => import("./AddFunction.vue")),
    ConfirmDialog,
    OButton,
    OBadge,
    ODialog,
    OSearchInput,
    OTooltip,
  },
  emits: [
    "updated:fields",
    "update:changeRecordPerPage",
    "update:maxRecordToReturn",
    "sendToAiChat",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const jsTransforms: any = ref([]);
    const formData: any = ref({});
    const showAddJSTransformDialog: any = ref(false);
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmForceDelete = ref<boolean>(false);
    const confirmBulkDelete = ref<boolean>(false);
    const bulkDeleteLoading = ref<boolean>(false);
    const { searchObj } = searchState();
    const pipelineList = ref([]);
    const selectedPipeline = ref("");
    const filterQuery = ref("");
    const { track } = useReo();
    const columns: OTableColumnDef[] = [
      {
        id: "name",
        accessorKey: "name",
        header: t("common.name"),
        sortable: true,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "transType",
        accessorKey: "transType",
        header: t("common.type"),
        sortable: true,
        size: 120,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("function.actions"),
        isAction: true,
        size: 150,
        meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
      },
    ];

    const onPipelineSelect = (pipeline: any) => {
      const routeUrl = router.resolve({
        name: "pipelineEditor",
        query: {
          id: pipeline.value,
          name: pipeline.label,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;

      window.open(routeUrl, "_blank");
    };

    const loading = ref(false);
    const getJSTransforms = () => {
      loading.value = true;
      // return ;
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading functions...",
        timeout: 0,
      });

      jsTransformService
        .list(1, 100000, "name", false, "", store.state.selectedOrganization.identifier)
        .then((res) => {
          resultTotal.value = res.data.list.length;
          if (router.currentRoute.value.query.action == "add") {
            showAddUpdateFn({ row: undefined });
          }
          jsTransforms.value = res.data.list.map((data: any) => {
            if (router.currentRoute.value.query.action == "update") {
              if (router.currentRoute.value.query.name == data.name) {
                showAddUpdateFn({ row: data });
              }
            }

            return {
              name: data.name,
              function: data.function,
              params: data.params,
              // order: data.order ? data.order : 1,
              // stream_name: data.stream_name ? data.stream_name : "--",
              // stream_type: data.stream_type ? data.stream_type : "--",
              transType: data.transType.toString(),
              // ingest: data.stream_name ? true : false,
              actions: "",
            };
          });

          searchObj.data.transforms = jsTransforms.value;

          dismiss();
        })
        .catch((err) => {
          console.error("Error while pulling function", err);

          dismiss();
          if (err?.response?.status && err?.response?.status != 403) {
            toast({
              variant: "error",
              message: "Error while pulling function.",
            });
          }
        })
        .finally(() => {
          loading.value = false;
        });
    };

    if (jsTransforms.value == "" || jsTransforms.value == undefined) {
      getJSTransforms();
    }

    const resultTotal = ref<number>(0);
    const pageSize = ref(20);
    const pageSizeOptions = [20, 50, 100, 250, 500];

    const selectedFunctionIds = ref<string[]>([]);
    const selectedFunctions = computed({
      get: () =>
        (jsTransforms.value || []).filter((row: any) =>
          selectedFunctionIds.value.includes(row.name),
        ),
      set: (val) => {
        selectedFunctionIds.value = val.map((row: any) => row.name);
      },
    });

    const addTransform = () => {
      showAddJSTransformDialog.value = true;
    };

    const transformedPipelineList = computed(() => {
      return pipelineList.value.map((pipeline: any) => ({
        label: pipeline.name,
        value: pipeline.id,
      }));
    });

    const showAddUpdateFn = (props: any) => {
      formData.value = props.row;
      let action;
      if (!props.row) {
        isUpdated.value = false;
        action = "Add Function";
        router.push({
          name: "functionList",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        track("Button Click", {
          button: "Add Function",
          page: "Functions",
        });
      } else {
        isUpdated.value = true;
        action = "Update Function";
        router.push({
          name: "functionList",
          query: {
            action: "update",
            name: props.row.name,
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        track("Button Click", {
          button: "Update Function",
          page: "Functions",
        });
      }
      addTransform();

      segment.track("Button Click", {
        button: action,
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Functions",
      });
    };

    const refreshList = () => {
      router.push({
        name: "functionList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      showAddJSTransformDialog.value = false;
      getJSTransforms();
    };

    const hideForm = () => {
      showAddJSTransformDialog.value = false;
      router.replace({
        name: "functionList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const deleteFn = () => {
      jsTransformService
        .delete(store.state.selectedOrganization.identifier, selectedDelete.value.name)
        .then((res: any) => {
          if (res.data.code == 200) {
            toast({
              variant: "success",
              message: res.data.message,
            });
            getJSTransforms();
          } else {
            toast({
              variant: "error",
              message: res.data.message,
            });
          }
        })
        .catch((err) => {
          if (err.response.data.code == 409) {
            toast({
              variant: "error",
              message:
                "Function deletion failed as it is associated with pipelines. Click on view button to get associated pipelines.",
              timeout: 10000,
              action: {
                label: "View",
                handler: () => {
                  forceRemoveFunction(err.response.data["message"]);
                },
              },
            });
            return;
          }
          if (err.response.status != 403) {
            toast({
              variant: "error",
              message: JSON.stringify(err.response.data["message"]) || "Function deletion failed.",
            });
          }
        });

      segment.track("Button Click", {
        button: "Delete Function",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        function_name: selectedDelete.value.name,
        is_ingest_func: selectedDelete.value.ingest,
        page: "Functions",
      });
    };

    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDelete.value = true;
    };

    const getAssociatedPipelines = (props: any) => {
      selectedDelete.value = props.row;
      jsTransformService
        .getAssociatedPipelines(store.state.selectedOrganization.identifier, props.row.name)
        .then((res: any) => {
          pipelineList.value = res.data.list;
          confirmForceDelete.value = true;
        })
        .catch((err) => {
          console.log(err);
        });
    };

    const forceRemoveFunction = (message: any) => {
      const match = message.match(/\[([^\]]+)\]/);
      if (match) {
        // Convert the matched string to an array of pipeline names
        pipelineList.value = JSON.parse(match[0].replace(/'/g, '"'));
      }

      confirmForceDelete.value = true;
    };

    const closeDialog = () => {
      confirmForceDelete.value = false;
    };

    const forceDeleteFn = () => {};

    const sendToAiChat = (value: any) => {
      emit("sendToAiChat", value);
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

    const visibleRows = computed(() => {
      if (!filterQuery.value) return jsTransforms.value || [];
      return filterData(jsTransforms.value || [], filterQuery.value);
    });
    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    // Watch visibleRows to sync resultTotal with search filter
    watch(
      visibleRows,
      (newVisibleRows) => {
        resultTotal.value = newVisibleRows.length;
      },
      { immediate: true },
    );

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteFunctions = async () => {
      bulkDeleteLoading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: "Deleting functions...",
        timeout: 0,
      });

      try {
        if (selectedFunctions.value.length === 0) {
          toast({
            variant: "error",
            message: "No functions selected for deletion",
          });
          dismiss();
          return;
        }

        // Extract function names for the API call (BE supports names)
        const payload = {
          ids: selectedFunctions.value.map((f: any) => f.name),
        };

        const response = await jsTransformService.bulkDelete(
          store.state.selectedOrganization.identifier,
          payload,
        );

        dismiss();

        // Handle response based on successful/unsuccessful arrays
        if (response.data) {
          const { successful = [], unsuccessful = [] } = response.data;
          const successCount = successful.length;
          const failCount = unsuccessful.length;

          if (failCount > 0 && successCount > 0) {
            // Partial success
            toast({
              variant: "warning",
              message: `${successCount} function(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            // All failed
            toast({
              variant: "error",
              message: `Failed to delete ${failCount} function(s)`,
            });
          } else {
            // All successful
            toast({
              variant: "success",
              message: `${successCount} function(s) deleted successfully`,
            });
          }
        } else {
          // Fallback success message
          toast({
            variant: "success",
            message: `${selectedFunctions.value.length} function(s) deleted successfully`,
          });
        }

        selectedFunctions.value = [];
        // Refresh functions list
        getJSTransforms();
      } catch (error: any) {
        dismiss();
        console.error("Error deleting functions:", error);

        // Show error message from response if available
        const errorMessage =
          error.response?.data?.message ||
          error?.message ||
          "Error deleting functions. Please try again.";
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

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "functionsAdd",
        handler: () => {
          if (!isInputFocused()) showAddUpdateFn({});
        },
      },
      {
        id: "functionsRefresh",
        handler: () => {
          if (!isInputFocused()) getJSTransforms();
        },
      },
      {
        id: "functionsFocusSearch",
        handler: () => {
          focusSearchInput("functions-list-search-input");
        },
      },
    ]);
    return {
      t,
      store,
      router,
      jsTransforms,
      columns,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      getJSTransforms,
      loading,
      resultTotal,
      refreshList,
      pageSize,
      pageSizeOptions,
      addTransform,
      deleteFn,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      showAddJSTransformDialog,
      forceDeleteFn,
      confirmForceDelete,
      pipelineList,
      selectedPipeline,
      closeDialog,
      onPipelineSelect,
      transformedPipelineList,
      getAssociatedPipelines,
      filterQuery,
      filterData,
      getImageURL,
      verifyOrganizationStatus,
      sendToAiChat,
      visibleRows,
      hasVisibleRows,
      openBulkDeleteDialog,
      bulkDeleteFunctions,
      bulkDeleteLoading,
      confirmBulkDelete,
      selectedFunctions,
      selectedFunctionIds,
    };
  },
  computed: {
    // selectedOrg() {
    //   return this.store.state.selectedOrganization.identifier;
    // },
  },
  watch: {
    // selectedOrg(newVal: any, oldVal: any) {
    //   this.verifyOrganizationStatus(
    //     this.store.state.organizations,
    //     this.router
    //   );
    //   if (
    //     (newVal != oldVal || this.jsTransforms.value == undefined) &&
    //     this.router.currentRoute.value.name == "AppFunctions"
    //   ) {
    //     this.resultTotal = 0;
    //     this.jsTransforms = [];
    //     this.getJSTransforms();
    //   }
    // },
  },
});
</script>

<style scoped>
/* keep(scrollbar): custom webkit scrollbar for the function list */
.scrollable-list::-webkit-scrollbar {
  width: 0.5rem;
}

.scrollable-list::-webkit-scrollbar-thumb {
  background-color: var(--color-border-strong);
  border-radius: 0.25rem;
}

.scrollable-list::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-text-muted);
}

.scrollable-list::-webkit-scrollbar-track {
  background-color: transparent;
}
</style>
