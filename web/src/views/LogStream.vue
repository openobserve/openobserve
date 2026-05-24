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
  <div data-test="alert-list-page" class="tw:p-0 tw:flex tw:flex-col">
    <div class="tw:w-full tw:h-full tw:flex tw:flex-col tw:px-2.5 tw:pb-2.5 tw:pt-1">
      <div class="card-container tw:mb-2.5">
        <div
          class="tw:flex tw:items-center tw:justify-between tw:w-full tw:py-3 tw:px-4 tw:h-[68px]"
        >
          <div
            class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]"
            data-test="log-stream-title-text"
          >
            {{ t("logStream.header") }}
          </div>
          <div class="tw:flex tw:items-start">
            <div class="tw:flex tw:justify-between tw:items-end">
              <OToggleGroup
                :model-value="streamActiveTab"
                @update:model-value="(v) => filterLogStreamByTab(v as string)"
                class="tw:mr-2"
              >
                <OToggleGroupItem value="logs" size="sm">
                  <template #icon-left
                    ><OIcon name="search" size="xs" class="tw:shrink-0"
                  /></template>
                  {{ t("logStream.labelLogs") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="metrics" size="sm">
                  <template #icon-left
                    ><OIcon name="bar-chart" size="xs" class="tw:shrink-0"
                  /></template>
                  {{ t("logStream.labelMetrics") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="traces" size="sm">
                  <template #icon-left
                    ><OIcon name="account-tree" size="xs" class="tw:shrink-0"
                  /></template>
                  {{ t("logStream.labelTraces") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="metadata" size="sm">
                  <template #icon-left
                    ><OIcon name="info" size="xs" class="tw:shrink-0"
                  /></template>
                  {{ t("logStream.labelMetadata") }}
                </OToggleGroupItem>
              </OToggleGroup>
            </div>
            <div>
              <OInput
                data-test="streams-search-stream-input"
                v-model="filterQuery"
                class="tw:ml-auto no-border o2-search-input tw:h-[36px]"
                :placeholder="t('logStream.search')"
                :debounce="300"
              >
                <template #icon-left>
                  <OIcon class="o2-search-input-icon" name="search" size="sm" />
                </template>
              </OInput>
            </div>
            <OButton
              data-test="log-stream-refresh-stats-btn"
              variant="outline"
              size="sm-action"
              class="tw:ml-2"
              @click="getLogStream(true)"
            >
              {{ t(`logStream.refreshStats`) }}
            </OButton>
            <OButton
              v-if="isSchemaUDSEnabled"
              data-test="log-stream-add-stream-btn"
              variant="primary"
              size="sm-action"
              class="tw:ml-2"
              @click="addStream"
            >
              {{ t(`logStream.add`) }}
            </OButton>
          </div>
        </div>
      </div>
      <div class="card-container tw:flex-1 tw:min-h-0 tw:overflow-hidden">
        <OTable
          data-test="log-stream-table"
          :data="logStream"
          :columns="columns"
          row-key="_rowKey"
          selection="multiple"
          v-model:selected-ids="selectedIds"
          pagination="server"
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-size-options="pageSizeOptions"
          :total-count="totalCount"
          sorting="server"
          v-model:sort-by="sortBy"
          v-model:sort-order="sortOrder"
          :show-global-filter="false"
          :default-columns="false"
          :loading="loadingState"
          width="100%"
          :style="
            logStream?.length
              ? 'width: 100%; height: 100%'
              : 'width: 100%'
          "
        >
          <!--
            Render the stream-name cell with a deterministic per-name data-test.
            Tests can target a specific stream row via
            `[data-test="log-stream-name-cell-<name>"]` and walk up to the OTable
            row via `xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]`
            without needing element/text predicates. Mirrors the
            `dashboard-name-cell-<name>` pattern in Dashboards.vue.
          -->
          <template #cell-name="{ row }">
            <span :data-test="`log-stream-name-cell-${row.name}`">{{ row.name }}</span>
          </template>
          <template #cell-actions="{ row }">
             <div class="tw:flex tw:items-center actions-container">
              <OButton
                icon-left="search"
                :title="t('logStream.explore')"
                data-test="log-stream-explore-btn"
                variant="ghost"
                size="icon-sm"
                @click="exploreStream({ row })"
              />
              <OButton
                icon-left="description"
                :title="t('logStream.schemaHeader')"
                data-test="log-stream-schema-btn"
                variant="ghost"
                size="icon-sm"
                @click="listSchema({ row })"
              />
              <OButton
                icon-left="delete"
                :title="t('logStream.delete')"
                data-test="log-stream-delete-btn"
                variant="ghost-destructive"
                size="icon-sm"
                @click="confirmDeleteAction({ row })"
              />
            </div>
          </template>
          <template #empty>
            <div v-if="!loadingState">
              <NoData />
            </div>
          </template>
          <template #bottom="scope">
            <div
              class="tw:flex tw:items-center tw:justify-between tw:w-full tw:py-2"
            >
              <div
                class="tw:flex tw:items-center tw:w-full tw:font-bold tw:text-[14px]"
              >
                {{ scope.totalRows }} Stream(s)
                <OButton
                  v-if="selectedIds.length > 0"
                  icon-left="delete"
                  variant="outline-destructive"
                  size="sm-action"
                  class="tw:ml-4"
                  :disabled="isDeleting"
                  @click="confirmBatchDeleteAction"
                >
                  {{ isDeleting ? "Deleting..." : "Delete" }}
                </OButton>
              </div>
            </div>
          </template>
        </OTable>
      </div>
    </div>

    <SchemaIndex v-if="showIndexSchemaDialog" v-model="schemaData" v-model:open="showIndexSchemaDialog" @close="showIndexSchemaDialog = false" />

    <AddStream
      v-model:open="addStreamDialog.show"
      :is-in-pipeline="false"
      @close="addStreamDialog.show = false"
      @streamAdded="getLogStream"
    />

    <ODialog data-test="log-stream-delete-dialog"
      v-model:open="confirmDelete"
      size="sm"
      :title="t('logStream.confirmDeleteHead')"
      :secondary-button-label="t('logStream.cancel')"
      :primary-button-label="t('logStream.ok')"
      primary-button-variant="destructive"
      @click:secondary="confirmDelete = false"
      @click:primary="() => { deleteStream(); confirmDelete = false; }"
    >
      <div class="tw:flex tw:flex-col tw:gap-3 tw:py-1">
        <p class="tw:text-sm">{{ t("logStream.confirmDeleteMsg") }}</p>
        <div
          class="tw:w-full tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-gray-500"
        >
          <OCheckbox
            class="checkbox-delete-associated-alerts-pipelines"
            v-model="deleteAssociatedAlertsPipelines"
          />
          <span class="delete-associated-alerts-pipelines-text">
            Delete all Pipelines and Alerts associated with the stream
          </span>
        </div>
      </div>
    </ODialog>

    <ODialog data-test="log-stream-batch-delete-dialog"
      v-model:open="confirmBatchDelete"
      size="sm"
      :title="t('logStream.confirmBatchDeleteHead')"
      :secondary-button-label="t('logStream.cancel')"
      :primary-button-label="t('logStream.ok')"
      primary-button-variant="destructive"
      @click:secondary="confirmBatchDelete = false"
      @click:primary="() => { deleteBatchStream(); confirmBatchDelete = false; }"
    >
      <div class="tw:flex tw:flex-col tw:gap-3 tw:py-1">
        <p class="tw:text-sm">{{ t("logStream.confirmBatchDeleteMsg") }}</p>
        <div
          class="tw:w-full tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-gray-500"
        >
          <OCheckbox
            class="checkbox-delete-associated-alerts-pipelines"
            v-model="deleteAssociatedAlertsPipelines"
          />
          <span class="delete-associated-alerts-pipelines-text">
            Delete all Pipelines and Alerts associated with the selected streams
          </span>
        </div>
      </div>
    </ODialog>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  onActivated,
  onBeforeMount,
  type Ref,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import streamService from "../services/stream";
import SchemaIndex from "../components/logstream/schema.vue";
import NoData from "../components/shared/grid/NoData.vue";
import segment from "../services/segment_analytics";
import {
  getImageURL,
  verifyOrganizationStatus,
  formatSizeFromMB,
} from "../utils/zincutils";
import config from "@/aws-exports";
import { cloneDeep } from "lodash-es";
import useStreams from "@/composables/useStreams";
import AddStream from "@/components/logstream/AddStream.vue";
import { watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useReo } from "@/services/reodotdev_analytics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
export default defineComponent({
  name: "PageLogStream",
  components: {
    SchemaIndex,
    NoData,
    AddStream,
    OButton,
    ODialog,
    OIcon,
    OToggleGroup,
    OToggleGroupItem,
    OSpinner,
    OInput,
    OCheckbox,
    OTable,
  },
  emits: [],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const logStream: Ref<any[]> = ref([]);
    const showIndexSchemaDialog = ref(false);
    const isDeleting = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmBatchDelete = ref<boolean>(false);
    const schemaData = ref({ name: "", schema: [Object], stream_type: "" });
    const resultTotal = ref<number>(0);
    const selectedIds = ref<string[]>([]);
    const orgData: any = ref(store.state.selectedOrganization);
    const previousOrgIdentifier = ref("");
    const filterQuery = ref("");
    const duplicateStreamList: Ref<any[]> = ref([]);
    const selectedStreamType = ref("logs");
    const loadingState = ref(true);
    const searchKeyword = ref("");
    const deleteAssociatedAlertsPipelines = ref(true);
    const streamActiveTab = ref("logs");
    const { track } = useReo();

    const pageSize = ref(20);
    const pageSizeOptions = [20, 50, 100, 250, 500];
    const currentPage = ref(1);
    const sortBy = ref("name");
    const sortOrder = ref<"asc" | "desc">("asc");
    const totalCount = ref(0);

    const selectedItems = computed(() =>
      logStream.value.filter((s: any) => selectedIds.value.includes(s._rowKey))
    );

    const streamTabs: never[] = [];
    const {
      getStreams,
      resetStreams,
      removeStream,
      getStream,
      getPaginatedStreams,
      addNewStreams,
    } = useStreams();
    const columns = ref<OTableColumnDef[]>([
      {
        id: "#",
        header: "#",
        accessorKey: "#",
        size: 67,
        meta: { align: "left" },
      },
      {
        id: "name",
        accessorKey: "name",
        header: t("logStream.name"),
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "stream_type",
        accessorKey: "stream_type",
        header: t("logStream.type"),
        meta: { align: "left" },
      },
      {
        id: "doc_num",
        accessorFn: (row: any) =>
          row.doc_num?.toLocaleString?.() ?? row.doc_num,
        header: t("logStream.docNum"),
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "storage_size",
        accessorFn: (row: any) => formatSizeFromMB(row.storage_size),
        header: t("logStream.storageSize"),
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "compressed_size",
        accessorFn: (row: any) => formatSizeFromMB(row.compressed_size),
        header: t("logStream.compressedSize"),
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "index_size",
        accessorFn: (row: any) => formatSizeFromMB(row.index_size),
        header: t("logStream.indexSize"),
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("user.actions"),
        isAction: true,
        size: 120,
        meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
      },
    ]);

    if (config.isCloud == "true") {
      columns.value = columns.value.filter((c: any) => c.id !== "compressed_size");
    }

    const addStreamDialog = ref({
      show: false,
      data: {
        name: "",
        stream_type: "",
        index_type: "",
        retention_period: 14,
      },
    });

    let deleteStreamName = "";
    let deleteStreamType = "";

    onBeforeMount(() => {
      if (columns.value && !store.state.zoConfig.show_stream_stats_doc_num) {
        columns.value = columns.value.filter((col) => col.id !== "doc_num");
      }

      if (router.currentRoute.value.name === "streamExplorer") {
        router.push({
          name: "streamExplorer",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const isSchemaUDSEnabled = computed(() => {
      return store.state.zoConfig.user_defined_schemas_enabled;
    });

    // As filter data don't gets called when search input is cleared.
    // So calling onChangeStreamFilter to filter again
    // watch(
    //   () => filterQuery.value,
    //   (value) => {
    //     if (!value) {
    //       onChangeStreamFilter(selectedStreamType.value);
    //     }
    //   },
    // );

    const getLogStream = (refresh: boolean = false) => {
      if (store.state.selectedOrganization != null) {
        loadingState.value = true;
        previousOrgIdentifier.value =
          store.state.selectedOrganization.identifier;
        const dismiss = toast({
          variant: "loading",
          message: "Please wait while loading streams...",
        });
        logStream.value = [];

        const offset = (currentPage.value - 1) * pageSize.value;
        let counter = 1 + (offset < 0 ? 0 : offset);
        let streamResponse;
        // if(selectedStreamType.value == "all") {
        //   streamResponse = getStreams(selectedStreamType.value || "", false, false);
        // } else {
        streamResponse = getPaginatedStreams(
          selectedStreamType.value || "",
          false,
          false,
          offset < 0 ? 0 : offset,
          pageSize.value,
          filterQuery.value,
          sortBy.value,
          sortOrder.value === "asc",
        );
        // }

        streamResponse
          .then((res: any) => {
            logStream.value = [];
            let doc_num = "";
            let storage_size = "";
            let compressed_size = "";
            let index_size = "";
            resultTotal.value = res.list.length;
            totalCount.value = res.total;

            logStream.value.push(
              ...res.list.map((data: any) => {
                doc_num = "--";
                storage_size = "--";
                if (data.stats) {
                  doc_num = data.stats.doc_num;
                  storage_size = data.stats.storage_size + " MB";
                  compressed_size = data.stats.compressed_size + " MB";
                  index_size = data.stats.index_size + " MB";
                }
                return {
                  "#": counter <= 9 ? `0${counter++}` : counter++,
                  _rowKey: `${data.name}-${data.stream_type}`,
                  name: data.name,
                  doc_num: doc_num,
                  storage_size: storage_size,
                  compressed_size: compressed_size,
                  index_size: index_size,
                  storage_type: data.storage_type,
                  actions: "action buttons",
                  schema: data.schema ? data.schema : [],
                  stream_type: data.stream_type,
                };
              }),
            );
            duplicateStreamList.value = [...logStream.value];

            logStream.value.forEach((element: any) => {
              if (element.name == router.currentRoute.value.query.dialog) {
                listSchema({ row: element });
              }
            });
            loadingState.value = false;

            addNewStreams(selectedStreamType.value, res.list);

            dismiss();
          })
          .catch((err) => {
            if (err.response?.status != 403) {
              toast({
                variant: "error",
                message:
                  err.response?.data?.message ||
                  "Error while fetching streams.",
                timeout: 2000,
              });
            }
            loadingState.value = false;
            dismiss();
          })
          .finally(() => {
            loadingState.value = false;
            dismiss();
          });
      }

      segment.track("Button Click", {
        button: "Refresh Streams",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Streams",
      });
    };

    getLogStream();

    const listSchema = (props: any) => {
      schemaData.value.name = props.row.name;
      schemaData.value.schema = props.row.schema;
      schemaData.value.stream_type = props.row.stream_type;
      showIndexSchemaDialog.value = true;

      segment.track("Button Click", {
        button: "Actions",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        stream_name: props.row.name,
        page: "Streams",
      });
    };

    const confirmDeleteAction = (props: any) => {
      confirmDelete.value = true;
      deleteStreamName = props.row.name;
      deleteStreamType = props.row.stream_type;
    };
    const confirmBatchDeleteAction = () => {
      confirmBatchDelete.value = true;
    };

    const deleteStream = () => {
      streamService
        .delete(
          store.state.selectedOrganization.identifier,
          deleteStreamName,
          deleteStreamType,
          deleteAssociatedAlertsPipelines.value,
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            toast({
              message: "Stream deleted successfully.",
            });
            removeStream(deleteStreamName, deleteStreamType);
            selectedIds.value = [];
            getLogStream();
          }
        })
        .catch((err: any) => {
          if (err.response.status != 403) {
            toast({
              message: "Error while deleting stream.",
            });
          }
        })
        .finally(() => {
          deleteAssociatedAlertsPipelines.value = true;
        });
    };
    const deleteBatchStream = () => {
      isDeleting.value = true;
      const items = selectedItems.value;
      const promises: Promise<any>[] = [];

      items.forEach((stream: any) => {
        promises.push(
          streamService.delete(
            store.state.selectedOrganization.identifier,
            stream.name,
            stream.stream_type,
            deleteAssociatedAlertsPipelines.value,
          ),
        );
      });

      Promise.all(promises)
        .then((responses) => {
          const successfulDeletions = responses.filter(
            (res) => res.data.code === 200,
          );
          const failedDeletions = responses.filter(
            (res) => res.data.code !== 200,
          );

          if (successfulDeletions.length > 0) {
            toast({
              message: `Deleted ${successfulDeletions.length} streams successfully.`,
            });
          }

          if (failedDeletions.length > 0) {
            toast({
              message: `Failed to delete ${failedDeletions.length} streams.`,
            });
          }

          // Remove deleted streams from the list
          items.forEach((stream: any) => {
            removeStream(stream.name, stream.stream_type);
          });

          selectedIds.value = [];
          getLogStream();
        })
        .catch((error) => {
          if (error.response.status != 403) {
            toast({
              message:
                error.response?.data?.message ||
                "Error while deleting streams.",
            });
          }
        })
        .finally(() => {
          deleteAssociatedAlertsPipelines.value = true;
          isDeleting.value = false;
        });
    };

    watch([currentPage, pageSize, sortBy, sortOrder], () => {
      getLogStream();
    });

    watch(filterQuery, () => {
      currentPage.value = 1;
      getLogStream();
    });

    onActivated(() => {
      if (logStream.value.length > 0) {
        logStream.value.forEach((element: any) => {
          if (element.name == router.currentRoute.value.query.dialog) {
            listSchema({ row: element });
          }
        });
      }

      if (
        previousOrgIdentifier.value !=
        store.state.selectedOrganization.identifier
      ) {
        getLogStream();
      }
    });
    /**
     * Get time range for stream explorer, for enrichment tables it will get the time range from the stream data min and max time
     * @param stream: Stream object
     */
    const getTimeRange = async (stream: any) => {
      const dateTime: { period?: string; from?: number; to?: number } = {};

      if (stream.stream_type === "enrichment_tables") {
        const dismiss = toast({
          variant: "loading",
          message: "Redirecting to explorer...",
        });

        await getStream(stream.name, stream.stream_type, true)
          .then((streamResponse) => {
            if (
              streamResponse.stats.doc_time_min &&
              streamResponse.stats.doc_time_max
            ) {
              dateTime["from"] = streamResponse.stats.doc_time_min - 60000000;
              dateTime["to"] = streamResponse.stats.doc_time_max + 60000000;
            } else if (streamResponse.stats.created_at) {
              // When enrichment table is uploaded, stats will not have doc_time_min and doc_time_max.
              // Stats will be available asynchronously, so we can use created_at time to get the time range.
              dateTime["from"] = streamResponse.stats.created_at - 60000000;
              dateTime["to"] = streamResponse.stats.created_at + 3600000000;
            } else {
              dateTime["period"] = "15m";
            }
          })
          .catch((err) => {
            dateTime["period"] = "15m";
          })
          .finally(() => {
            dismiss();
          });
      } else {
        dateTime["period"] = "15m";
      }

      return dateTime;
    };

    const exploreStream = async (props: any) => {
      store.dispatch("logs/setIsInitialized", false);

      // We need to check if stream is present in store, if not then we need to fetch the stream

      const dateTime = await getTimeRange(props.row);
      router.push({
        name: "logs",
        query: {
          stream_type: props.row.stream_type,
          stream: props.row.name,
          refresh: "0",
          query: "",
          type: "stream_explorer",
          quick_mode: store.state.zoConfig.quick_mode_enabled
            ? "true"
            : "false",
          org_identifier: store.state.selectedOrganization.identifier,
          ...dateTime,
        },
      });
    };

    const onChangeStreamFilter = (value: string) => {
      selectedStreamType.value = value;
      getLogStream(true);
      // logStream.value = filterData(
      //   duplicateStreamList.value,
      //   filterQuery.value.toLowerCase(),
      // );
      // resultTotal.value = logStream.value.length;
    };

    const addStream = () => {
      addStreamDialog.value.show = true;
      track("Button Click", {
        button: "Add Stream",
        pageTitle: "Stream Explorer",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Streams",
      });
      // router.push({
      //   name: "addStream",
      //   query: {
      //     org_identifier: store.state.selectedOrganization.identifier,
      //   },
      // });
    };

    const onPaginationChange = async (params: { page: number; size: number }) => {
      currentPage.value = params.page;
      pageSize.value = params.size;
      await getLogStream();
    };

    const onSortChange = async (params: { column: string; order: "asc" | "desc" }) => {
      sortBy.value = params.column;
      sortOrder.value = params.order;
      currentPage.value = 1;
      await getLogStream();
    };

    const filterLogStreamByTab = (tab: string) => {
      streamActiveTab.value = tab;
      onChangeStreamFilter(tab);
    };
    return {
      t,
      router,
      store,
      logStream: logStream,
      columns,
      selectedIds,
      selectedItems,
      orgData,
      getLogStream: getLogStream,
      resultTotal,
      listSchema,
      deleteStream,
      deleteBatchStream,
      confirmDeleteAction,
      confirmBatchDeleteAction,
      confirmDelete,
      confirmBatchDelete,
      schemaData,
      pageSize,
      pageSizeOptions,
      currentPage,
      sortBy,
      sortOrder,
      totalCount,
      onPaginationChange,
      onSortChange,
      showIndexSchemaDialog,
      isSchemaUDSEnabled,
      filterQuery,
      getImageURL,
      verifyOrganizationStatus,
      exploreStream,
      selectedStreamType,
      streamTabs,
      onChangeStreamFilter,
      addStreamDialog,
      addStream,
      loadingState,
      isDeleting,
      searchKeyword,
      deleteAssociatedAlertsPipelines,
      filterLogStreamByTab,
      streamActiveTab,
    };
  },
});
</script>

<style lang="scss" scoped></style>

<style lang="scss">
.bottom-bar {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
}
.delete-btn {
  width: 10vw;
}

.confirmBodyLogStream {
  padding: 22px 1.375rem 0;
  font-size: 0.875rem;
  text-align: center;
  font-weight: 700;

  .head {
    line-height: 2.15em;
    margin-bottom: 4px;
  }

  .para {
    color: $light-text;
  }
}

.delete-associated-alerts-pipelines-text {
  color: $light-text;
  font-size: 12px;
  font-weight: 500;
}

.confirmActionsLogStream {
  justify-content: center;
  padding: 16px 22px 22px;
  display: flex;
}
.checkbox-delete-associated-alerts-pipelines {
  .q-checkbox__inner {
    height: 28px !important;
    min-height: 28px !important;
    width: 28px !important;
    min-width: 28px !important;
  }
  .q-checkbox__bg {
    height: 16px !important;
    width: 16px !important;
  }
}
</style>
