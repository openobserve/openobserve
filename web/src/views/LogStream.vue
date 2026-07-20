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
  <div data-test="alert-list-page" class="h-full">
    <OPageLayout bleed
      :title="t('logStream.header')"
      title-data-test="log-stream-title-text"
      :subtitle="t('logStream.subtitle')"
      icon="window"
    >
          <template #actions>
            <OButton
              v-if="isSchemaUDSEnabled"
              data-test="log-stream-add-stream-btn"
              variant="primary"
              size="sm-action"
              @click="addStream"
            >
              {{ t(`logStream.add`) }}
            </OButton>
          </template>

      <div class="bg-card-glass-bg h-full">
      <OTable
        data-test="log-stream-table"
        :data="logStream"
        :columns="columns"
        show-index
        row-key="_rowKey"
        :frame="false"
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
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="streams-log-stream-list"
        class="w-full h-full"
      >
          <!-- Toolbar inside the table frame: stream-type filter + search. -->
          <template #toolbar>
            <div
              class="flex items-center justify-between gap-2 w-full"
            >
              <OToggleGroup
                :model-value="streamActiveTab"
                @update:model-value="(v) => filterLogStreamByTab(v as string)"
              >
                <OToggleGroupItem value="logs" size="sm">
                  <template #icon-left
                    ><OIcon name="search" size="xs" class="shrink-0"
                  /></template>
                  {{ t("logStream.labelLogs") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="metrics" size="sm">
                  <template #icon-left
                    ><OIcon name="bar-chart" size="xs" class="shrink-0"
                  /></template>
                  {{ t("logStream.labelMetrics") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="traces" size="sm">
                  <template #icon-left
                    ><OIcon name="account-tree" size="xs" class="shrink-0"
                  /></template>
                  {{ t("logStream.labelTraces") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="metadata" size="sm">
                  <template #icon-left
                    ><OIcon name="info" size="xs" class="shrink-0"
                  /></template>
                  {{ t("logStream.labelMetadata") }}
                </OToggleGroupItem>
              </OToggleGroup>
              <OSearchInput
                data-test="streams-search-stream-input"
                v-model="filterQuery"
                class="w-64 no-border o2-search-input"
                :placeholder="t('logStream.search')"
                :debounce="300"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loadingState"
              data-test="log-stream-refresh-stats-btn"
              @click="() => getLogStream(true)"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="streamsRefresh" />
            </OButton>
          </template>
          <!--
            Render the stream-name cell with a deterministic per-name data-test.
            Tests can target a specific stream row via
            `[data-test="log-stream-name-cell-<name>"]` and walk up to the OTable
            row via `xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]`
            without needing element/text predicates. Mirrors the
            `dashboard-name-cell-<name>` pattern in Dashboards.vue.
          -->
          <template #cell-name="{ row }">
            <span :data-test="`log-stream-name-cell-${row.name}`" class="text-text-body">{{ row.name }}</span>
          </template>
          <template #cell-actions="{ row }">
             <div class="flex items-center actions-container">
              <OButton
                icon-left="search"
                :title="t('logStream.explore')"
                data-test="log-stream-explore-btn"
                data-row-action="view"
                variant="ghost"
                size="icon-sm"
                @click="exploreStream({ row })"
              />
              <OButton
                icon-left="description"
                :title="t('logStream.schemaHeader')"
                data-test="log-stream-schema-btn"
                data-row-action="view"
                variant="ghost"
                size="icon-sm"
                @click="listSchema({ row })"
              />
              <OButton
                icon-left="delete"
                :title="t('logStream.delete')"
                data-test="log-stream-delete-btn"
                data-row-action="delete"
                variant="ghost-destructive"
                size="icon-sm"
                @click="confirmDeleteAction({ row })"
              />
            </div>
          </template>
          <template #empty>
            <div v-if="!loadingState">
              <OEmptyState
                size="hero"
                preset="no-streams"
                :actions="streamsEmptyActions"
                :filtered="!!filterQuery"
                @action="onStreamsEmptyStateAction"
              >
                <template v-if="!filterQuery" #extra>
                  <div class="flex items-center justify-center gap-2 flex-wrap">
                    <span class="text-sm font-semibold text-text-secondary mr-1">
                      {{ t('logStream.emptyOr') }}
                    </span>
                    <EmptyStateIngestionChip
                      data-test="log-stream-empty-kubernetes-btn"
                      @click="router.push({ name: 'ingestFromKubernetes', query: { org_identifier: store.state.selectedOrganization.identifier } })"
                    >
                      <img :src="getImageURL('images/common/kubernetes.svg')" class="w-3.5 h-3.5 shrink-0 object-contain" alt="" />
                      {{ t('logStream.emptyKubernetes') }}
                    </EmptyStateIngestionChip>
                    <EmptyStateIngestionChip
                      data-test="log-stream-empty-aws-btn"
                      @click="router.push({ name: 'AWSConfig', query: { org_identifier: store.state.selectedOrganization.identifier } })"
                    >
                      <img :src="getImageURL('images/ingestion/aws.svg')" class="w-3.5 h-3.5 shrink-0 object-contain" alt="" />
                      {{ t('logStream.emptyAws') }}
                    </EmptyStateIngestionChip>
                    <EmptyStateIngestionChip
                      data-test="log-stream-empty-linux-btn"
                      @click="router.push({ name: 'ingestFromLinux', query: { org_identifier: store.state.selectedOrganization.identifier } })"
                    >
                      <img :src="getImageURL('images/common/linux.svg')" class="w-3.5 h-3.5 shrink-0 object-contain" alt="" />
                      {{ t('logStream.emptyLinux') }}
                    </EmptyStateIngestionChip>
                    <EmptyStateIngestionChip
                      data-test="log-stream-empty-windows-btn"
                      @click="router.push({ name: 'ingestFromWindows', query: { org_identifier: store.state.selectedOrganization.identifier } })"
                    >
                      <img :src="getImageURL('images/common/windows.svg')" class="w-3.5 h-3.5 shrink-0 object-contain" alt="" />
                      {{ t('logStream.emptyWindows') }}
                    </EmptyStateIngestionChip>
                  </div>
                </template>
              </OEmptyState>
            </div>
          </template>
          <template #bottom="scope">
            <div
              class="flex items-center justify-between w-full py-2"
            >
              <div
                class="flex items-center w-full text-xs font-normal"
              >
                {{ scope.totalRows }} Stream(s)
                <OButton
                  v-if="selectedIds.length > 0"
                  icon-left="delete"
                  variant="outline-destructive"
                  size="sm-action"
                  class="ml-4"
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
    </OPageLayout>

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
      <div class="flex flex-col gap-3 py-1">
        <p class="text-sm">{{ t("logStream.confirmDeleteMsg") }}</p>
        <div
          class="w-full flex items-center gap-2 text-sm text-text-secondary"
        >
          <OCheckbox
            v-model="deleteAssociatedAlertsPipelines"
          />
          <span class="text-text-secondary text-xs font-medium">
            {{ t("logStream.deleteAssociatedAlertsPipelines") }}
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
      <div class="flex flex-col gap-3 py-1">
        <p class="text-sm">{{ t("logStream.confirmBatchDeleteMsg") }}</p>
        <div
          class="w-full flex items-center gap-2 text-sm text-text-secondary"
        >
          <OCheckbox
            v-model="deleteAssociatedAlertsPipelines"
          />
          <span class="text-text-secondary text-xs font-medium">
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
  onDeactivated,
  onUnmounted,
  onBeforeMount,
  type Ref,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import streamService from "../services/stream";
import SchemaIndex from "../components/logstream/schema.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";
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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useReo } from "@/services/reodotdev_analytics";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
export default defineComponent({
  name: "PageLogStream",
  components: {
    OPageLayout,
    SchemaIndex,
    OEmptyState,
    EmptyStateIngestionChip,
    AddStream,
    OButton,
    OTooltip,
    ODialog,
    OIcon,
    OToggleGroup,
    OToggleGroupItem,
    OSpinner,
    OSearchInput,
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
        id: "name",
        accessorKey: "name",
        header: t("logStream.name"),
        sortable: true,
        hideable: true,
        size: 320,
        minSize: 160,
        // Flex: fills the leftover width on load, freezes on first resize.
        meta: { align: "left", flex: true },
      },
      {
        id: "doc_num",
        accessorFn: (row: any) =>
          row.doc_num?.toLocaleString?.() ?? row.doc_num,
        header: t("logStream.docNum"),
        sortable: true,
        resizable: true,
        hideable: true,
        size: 150,
        meta: { align: "right" },
      },
      {
        id: "storage_size",
        accessorFn: (row: any) => formatSizeFromMB(row.storage_size),
        header: t("logStream.storageSize"),
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.sizeBytes,
        meta: { align: "right" },
      },
      {
        id: "compressed_size",
        accessorFn: (row: any) => formatSizeFromMB(row.compressed_size),
        header: t("logStream.compressedSize"),
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.sizeBytes,
        meta: { align: "right" },
      },
      {
        id: "index_size",
        accessorFn: (row: any) => formatSizeFromMB(row.index_size),
        header: t("logStream.indexSize"),
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.sizeBytes,
        meta: { align: "right" },
      },
      {
        id: "actions",
        header: t("user.actions"),
        isAction: true,
        // Initial hint only — OTable measures the rendered buttons and sizes
        // the column to fit them exactly.
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
                  timeout: 0,
});
        logStream.value = [];

        const offset = (currentPage.value - 1) * pageSize.value;
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
              variant: "success",
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
              variant: "error",
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
              variant: "success",
            });
          }

          if (failedDeletions.length > 0) {
            toast({
              message: `Failed to delete ${failedDeletions.length} streams.`,
              variant: "error",
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
              variant: "error",
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
                  timeout: 0,
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

    const streamsEmptyActions = computed(() => {
      const actions: { id: string; icon: string; titleKey: string; descriptionKey: string }[] = [
        {
          id: "setup-ingestion",
          icon: "cloud-upload",
          titleKey: "emptyState.noStreams.action",
          descriptionKey: "emptyState.noStreams.actionDesc",
        },
      ];
      if (isSchemaUDSEnabled.value) {
        actions.push({
          id: "create",
          icon: "add",
          titleKey: "emptyState.noStreams.createAction",
          descriptionKey: "emptyState.noStreams.createActionDesc",
        });
      }
      return actions;
    });

    const onStreamsEmptyStateAction = (id?: string) => {
      if (id === "clear-filters") {
        filterQuery.value = "";
        return;
      }
      if (id === "create") {
        addStream();
        return;
      }
      if (id === "setup-ingestion") {
        router.push({
          name: "ingestion",
          query: { org_identifier: store.state.selectedOrganization.identifier },
        });
      }
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



    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "streamsAdd",
        handler: () => { if (!isInputFocused()) addStream(); },
      },
      {
        id: "streamsRefresh",
        handler: () => { if (!isInputFocused()) getLogStream(true); },
      },
      {
        id: "streamsFocusSearch",
        handler: () => {
          focusSearchInput("streams-search-stream-input");
        },
      },
    ]);
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
      streamsEmptyActions,
      onStreamsEmptyStateAction,
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
