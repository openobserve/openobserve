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
  <div class="tw:rounded-md tw:p-0" style="min-height: inherit">
    <OTable
      data-test="log-stream-table"
      :data="filteredStreamData"
      :columns="columns"
      row-key="name"
      selection="multiple"
      v-model:selected-ids="selectedIds"
      pagination="client"
      :page-size="pageSize"
      :page-size-options="pageSizeOptions"
      expansion="single"
      v-model:expanded-ids="expandedIds"
      :show-global-filter="false"
      :default-columns="false"
      width="100%"
      @row-click="onExpandRow"
    >
      <template #empty>
        <NoData />
      </template>

      <template #top>
        <div class="tw:flex tw:items-center tw:w-full tw:border-b tw:border-[var(--o2-border)] tw:pb-2 tw:mb-1">
          <div class="tw:text-[15px] tw:font-[600]" data-test="log-stream-title-text">
            {{ t("logStream.header") }}
          </div>
          <div class="tw:ml-auto" data-test="stream-association-search-input">
            <OSearchInput
              v-model="filterQuery"
              class="tw:mb-1"
              :placeholder="t('logStream.search')"
            />
          </div>
          <OButton
            data-test="log-stream-refresh-stats-btn"
            class="tw:ml-3 tw:mb-1"
            variant="outline"
            size="sm-action"
            @click="getLogStream"
            icon-left="refresh"
          >
            {{ t(`logStream.refreshStats`) }}
          </OButton>
        </div>
      </template>

      <template #expansion="{ row }">
        <div
          v-show="loadingFunctions"
          class="tw:pl-3 tw:py-1"
          style="height: 60px"
        >
          <OInnerLoading
            :showing="loadingFunctions"
            label="Fetching functions..."
            size="sm"
          />
        </div>
        <div v-show="!loadingFunctions">
          <OTable
            :data-test="`associated-functions-${expandedRow.name}-table`"
            class="border"
            bordered
            :data="displayFunctionsList"
            :columns="functionsColumns"
            pagination="none"
            :show-global-filter="false"
            :default-columns="false"
          >
            <template #top>
              <div
                style="
                  display: flex;
                  flex-direction: row;
                  width: 100%;
                  justify-content: space-between;
                "
              >
                <div
                  class="tw:text-[15px] tw:font-[600] tw:flex tw:items-center"
                  data-test="log-stream-title-text"
                >
                  {{ t("function.associatedFunctionHeader") }}
                </div>
                <OButton
                  data-test="stream-association-associate-function-btn"
                  variant="outline"
                  size="sm-action"
                  class="tw:ml-3 tw:mb-1"
                  @click="addFunctionInProgress = true"
                >
                  Associate Function
                </OButton>
              </div>
            </template>

            <template #cell-#="{ row, index }">
              <span v-if="!row._isAddRow">{{ index + 1 }}</span>
            </template>

            <template #cell-name="{ row }">
              <span v-if="!row._isAddRow">{{ row.name }}</span>
              <OSelect
                v-else
                v-model="selectedFunction"
                data-test="stream-association-functions-select-input"
                labelKey="name"
                valueKey="name"
                :label="t('function.selectFunction')"
                :options="filterFunctions"
                :loading="addFunctionInProgressLoading"
                :disabled="addFunctionInProgressLoading"
                searchable
                @search="filterFn"
              />
            </template>

            <template #cell-order="{ row }">
              <span v-if="!row._isAddRow">{{ row.order }}</span>
            </template>

            <template #cell-applyBeforeFlattening="{ row }">
              <OSwitch
                v-if="!row._isAddRow"
                data-test="stream-association-applyBeforeFlattening-toggle"
                v-model="row.applyBeforeFlattening"
                @update:model-value="updateAssociatedFunctions(row)"
              />
            </template>

            <template #cell-actions="{ row }">
              <OButton
                v-if="!row._isAddRow"
                data-test="stream-association-delete-function-btn"
                :title="t('function.deleteAssociatedFunction')"
                class="tw:ml-1"
                variant="ghost-destructive"
                size="icon-sm"
                icon-left="delete"
              />
            </template>

            <template #empty>
              <div
                v-if="!addFunctionInProgress"
                style="width: 100%; text-align: center"
              >
                No functions found
              </div>
            </template>
          </OTable>
        </div>
      </template>
    </OTable>
    <ODrawer data-test="associated-stream-function-index-schema-drawer"
      v-model:open="showIndexSchemaDialog"
      size="lg"
    >
      <SchemaIndex v-model="schemaData" />
    </ODrawer>
  </div>
</template>

<script lang="ts">

import {
  defineComponent,
  ref,
  onActivated,
  onMounted,
  watch,
  computed,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import jsTransformService from "../../services/jstransform";

import streamService from "../../services/stream";
import SchemaIndex from "../logstream/schema.vue";
import NoData from "../shared/grid/NoData.vue";
import segment from "../../services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import useStreams from "@/composables/useStreams";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "PageLogStream",
  components: { SchemaIndex, NoData, OButton, ODrawer, OInnerLoading, OSwitch, OSelect, OSearchInput,
    OIcon, OTable,
},
  emits: ["update:changeRecordPerPage", "update:maxRecordToReturn"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const logStream = ref([]);
    const showIndexSchemaDialog = ref(false);
    const schemaData = ref({ name: "", schema: [Object], stream_type: "" });
    const resultTotal = ref<number>(0);
    const orgData: any = ref(store.state.selectedOrganization);

    const previousOrgIdentifier = ref("");
    const functionsList = ref<any>([]);
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
        accessorKey: "name",
        header: t("logStream.name"),
        sortable: true,
        size: COL.streamName,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "stream_type",
        accessorKey: "stream_type",
        header: t("logStream.type"),
        sortable: true,
        size: COL.streamType,
        meta: { align: "left" },
      },
      {
        id: "doc_num",
        accessorKey: "doc_num",
        header: t("logStream.docNum"),
        sortable: true,
        size: COL.count,
        meta: { align: "left" },
      },
      {
        id: "storage_size",
        accessorKey: "storage_size",
        header: t("logStream.storageSize"),
        sortable: true,
        size: COL.sizeBytes,
        meta: { align: "left" },
      },
      {
        id: "compressed_size",
        accessorKey: "compressed_size",
        header: t("logStream.compressedSize"),
        sortable: true,
        size: COL.sizeBytes,
        meta: { align: "left" },
      },
    ];
    const addFunctionInProgress = ref(false);
    const addFunctionInProgressLoading = ref(false);
    const { getStreams } = useStreams();

    let deleteStreamName = "";
    let deleteStreamType = "";
    const loadingFunctions = ref(false);
    const expandedRow = ref({ name: "", stream_type: "" });
    const allFunctionsList = ref([]);
    const selectedFunction = ref<any | null>(null);
    const filterFunctions = ref([]);
    const selectedIds = ref<string[]>([]);
    const filterQuery = ref("");

    const expandedIds = computed(() => {
      return expandedRow.value.name ? [expandedRow.value.name] : [];
    });

    const filteredStreamData = computed(() => {
      const query = filterQuery.value.toLowerCase();
      if (!query) return logStream.value;
      return logStream.value.filter(
        (row: any) =>
          row.name.toLowerCase().includes(query) ||
          row.stream_type.toLowerCase().includes(query)
      );
    });

    const displayFunctionsList = computed(() => {
      if (addFunctionInProgress.value) {
        return [
          {
            _isAddRow: true,
            name: "",
            order: 0,
            applyBeforeFlattening: false,
          },
          ...functionsList.value,
        ];
      }
      return functionsList.value;
    });

    const onExpandRow = (row: any) => {
      if (expandedRow.value.name === row.name) {
        expandedRow.value = { name: "", stream_type: "" };
      } else {
        expandedRow.value.name = row.name;
        expandedRow.value.stream_type = row.stream_type;
      }
      if (expandedRow.value.name) {
        addFunctionInProgress.value = false;
        getStreamFunctions(row.name, row.stream_type);
      }
    };

    const functionsColumns = computed<OTableColumnDef[]>(() => {
      const cols: OTableColumnDef[] = [
        {
          id: "#",
          header: "#",
          cell: " ",
          size: 50,
          meta: { align: "left" },
        },
        {
          id: "name",
          accessorKey: "name",
          header: t("logStream.name"),
          cell: " ",
          sortable: true,
          size: COL.name,
          meta: { align: "left", autoWidth: true },
        },
        {
          id: "order",
          accessorKey: "order",
          header: "Order",
          cell: " ",
          sortable: true,
          size: COL.count,
          meta: { align: "left" },
        },
        {
          id: "applyBeforeFlattening",
          accessorKey: "applyBeforeFlattening",
          header: "Apply Before Flattening",
          cell: " ",
          sortable: true,
          size: 180,
          meta: { align: "left" },
        },
        {
          id: "actions",
          header: t("user.actions"),
          isAction: true,
          size: 80,
          meta: { align: "left", actionCount: 1 },
        },
      ];
      if (expandedRow.value.stream_type !== "logs") {
        return cols.filter((col) => col.id !== "applyBeforeFlattening");
      }
      return cols;
    });

    const getLogStream = () => {
      if (store.state.selectedOrganization != null) {
        previousOrgIdentifier.value =
          store.state.selectedOrganization.identifier;
        const dismiss = toast({
          variant: "loading",
          message: "Please wait while loading streams...",
                  timeout: 0,
});

        getStreams("", false)
          .then((res: any) => {
            let counter = 1;
            let doc_num = "";
            let storage_size = "";
            let compressed_size = "";
            resultTotal.value = res.list.length;
            logStream.value = res.list
              .filter(
                (stream: any) => stream.stream_type !== "enrichment_tables"
              )
              .map((data: any) => {
                doc_num = "--";
                storage_size = "--";
                if (data.stats) {
                  doc_num = data.stats.doc_num;
                  storage_size = data.stats.storage_size + " MB";
                  compressed_size = data.stats.compressed_size + " MB";
                }
                return {
                  "#": counter <= 9 ? `0${counter++}` : counter++,
                  name: data.name,
                  doc_num: doc_num,
                  storage_size: storage_size,
                  compressed_size: compressed_size,
                  storage_type: data.storage_type,
                  actions: "action buttons",
                  schema: data.schema ? data.schema : [],
                  stream_type: data.stream_type,
                };
              });

            if (logStream.value.length > 0) {
              getAllFunctions();
            }

            dismiss();
          })
          .catch((err) => {
            dismiss();
            toast({
              variant: "error",
              message: "Error while pulling stream.",
            });
          });
      }

      segment.track("Button Click", {
        button: "Refresh Streams",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Streams",
      });
    };

    const filterFn = (val: string) => {
      const needle = val.toLowerCase();
      filterFunctions.value = allFunctionsList.value
        .filter(
          (item: any) =>
            !functionsList.value.some((obj: any) => obj.name === item.name)
        ) // filter existing applied functions
        .filter((v: any) => v.name.toLowerCase().indexOf(needle) > -1); // filter based on search term
    };

    getLogStream();

    const getAllFunctions = () => {
      jsTransformService
        .list(
          1,
          100000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier
        )
        .then((res: any) => {
          res.data.list.forEach((element: any) => {
            element.applyBeforeFlattening =
              element.applyBeforeFlattening || false;
          });
          allFunctionsList.value = res.data?.list || [];
          filterFunctions.value = res.data?.list || [];
        })
        .catch((err) => {
          toast({
            variant: "error",
            message:
              JSON.stringify(err.response.data["error"]) ||
              "Function fetching failed",
          });
        });
    };

    watch([selectedFunction], async () => {
      if (selectedFunction.value) {
        // save it
        const order =
          functionsList.value.reduce((prev: any, current: any) => {
            return prev == null || prev.order < current.order ? current : prev;
          }, null)?.order || 0;

        const apiData = {
          order: order + 1,
        };
        addFunctionInProgressLoading.value = true;
        await jsTransformService
          .apply_stream_function(
            store.state.selectedOrganization.identifier,
            expandedRow.value.name,
            expandedRow.value.stream_type,
            selectedFunction.value.name,
            apiData
          )
          .then(() => {
            return getStreamFunctions(
              expandedRow.value.name,
              expandedRow.value.stream_type
            );
          })
          .finally(() => {
            addFunctionInProgressLoading.value = false;
            addFunctionInProgress.value = false;
            selectedFunction.value = null;
          });
      }
    });

    const getStreamFunctions = async (
      stream_name: any,
      stream_type: string
    ) => {
      loadingFunctions.value = stream_name ? true : false;
      await jsTransformService
        .stream_function(
          store.state.selectedOrganization.identifier,
          stream_name,
          stream_type
        )
        .then((res: any) => {
          functionsList.value = res.data?.list || [];
          functionsList.value.forEach((element: any) => {
            element.applyBeforeFlattening =
              element.applyBeforeFlattening || false;
          });
        })
        .catch((err) => {
          toast({
            variant: "error",
            message:
              JSON.stringify(err.response.data["error"]) ||
              "Function creation failed",
          });
        })
        .finally(() => {
          loadingFunctions.value = false;
        });
    };

    const deleteFunctionFromStream = async (functionName: string) => {
      await jsTransformService
        .remove_stream_function(
          store.state.selectedOrganization.identifier,
          expandedRow.value.name,
          expandedRow.value.stream_type,
          functionName
        )
        .then(() => {
          return getStreamFunctions(
            expandedRow.value.name,
            expandedRow.value.stream_type
          );
        })
        .finally(() => {
          addFunctionInProgressLoading.value = false;
        });
    };

    // const listSchema = (props: any) => {
    //   schemaData.value.name = props.row.name;
    //   schemaData.value.schema = props.row.schema;
    //   schemaData.value.stream_type = props.row.stream_type;
    //   showIndexSchemaDialog.value = true;

    //   segment.track("Button Click", {
    //     button: "Actions",
    //     user_org: store.state.selectedOrganization.identifier,
    //     user_id: store.state.userInfo.email,
    //     stream_name: props.row.name,
    //     page: "Streams",
    //   });
    // };

    const pageSize = ref<number>(20);
    const pageSizeOptions = [5, 10, 20, 50, 100];

    const deleteStream = () => {
      streamService
        .delete(
          store.state.selectedOrganization.identifier,
          deleteStreamName,
          deleteStreamType
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            toast({
              message: "Stream deleted successfully.",
              variant: "success",
            });
            getLogStream();
          }
        })
        .catch((err: any) => {
          toast({
            message: "Error while deleting stream.",
            variant: "error",
          });
        });
    };

    onMounted(() => {
      // getAllFunctions();
    });

    onActivated(() => {
      if (
        previousOrgIdentifier.value !=
        store.state.selectedOrganization.identifier
      ) {
        getLogStream();
      }
    });

    const updateAssociatedFunctions = (_function: any) => {
      jsTransformService
        .apply_stream_function(
          store.state.selectedOrganization.identifier,
          expandedRow.value.name,
          expandedRow.value.stream_type,
          _function.name,
          _function
        )
        .then((res) => {
          getStreamFunctions(
            expandedRow.value.name,
            expandedRow.value.stream_type
          );
        });
    };

    return {
      t,
      router,
      store,
      logStream: logStream,
      columns,
      selectedIds,
      orgData,
      getLogStream: getLogStream,
      resultTotal,
      // listSchema,
      deleteStream,
      schemaData,
      showIndexSchemaDialog,
      getStreamFunctions,
      functionsList,
      expandedRow,
      expandedIds,
      filteredStreamData,
      displayFunctionsList,
      filterQuery,
      functionsColumns,
      deleteFunctionFromStream,
      addFunctionInProgress,
      allFunctionsList,
      selectedFunction,
      filterFn,
      filterFunctions,
      addFunctionInProgressLoading,
      onExpandRow,
      pageSize,
      pageSizeOptions,
      "delete": "delete",
      getImageURL,
      loadingFunctions,
      verifyOrganizationStatus,
      updateAssociatedFunctions,
    };
  },
  computed: {
    selectedOrg() {
      return this.store.state.selectedOrganization.identifier;
    },
  },
  watch: {
    selectedOrg(newVal: any, oldVal: any) {
      this.verifyOrganizationStatus(
        this.store.state.organizations,
        this.router
      );
      this.orgData = newVal;
      if (
        (newVal != oldVal || this.logStream.values == undefined) &&
        this.router.currentRoute.value.name == "streams"
      ) {
        this.logStream = [];
        this.resultTotal = 0;
        this.getLogStream();
      }
    },
  },
});
</script>

<style lang="scss" scoped>
/* q-table__title replaced with inline Tailwind — font-size and weight now set directly on elements */

.confirmBody {
  padding: 11px 1.375rem 0;
  font-size: 0.875rem;
  text-align: center;
  font-weight: 700;

  .head {
    line-height: 2.125rem;
    margin-bottom: 0.5rem;
    color: $dark-page;
  }

  .para {
    color: $light-text;
  }
}

.confirmActions {
  justify-content: center;
  padding: 1.25rem 1.375rem 1.625rem;
  display: flex;

  .q-btn {
    font-size: 0.75rem;
    font-weight: 700;
  }
}
</style>
