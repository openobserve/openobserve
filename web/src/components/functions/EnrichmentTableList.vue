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
  <div
    data-test="enrichment-tables-list-page"
    class="flex flex-col h-full min-h-0"
  >
    <OPageLayout
      v-if="!showAddJSTransformDialog"
      :title="t('function.enrichmentTables')"
      icon="dataset"
      :subtitle="t('function.enrichmentTablesSubtitle')"
      tabs-below
      bleed
    >
        <template #header-tabs>
          <PipelineSectionTabs />
        </template>
        <template #actions>
          <OButton
            data-test="enrichment-tables-add-btn"
            variant="primary"
            size="sm"
            @click="showAddUpdateFn(null)"
          >
            {{ t(`function.addEnrichmentTable`) }}
          </OButton>
        </template>
      <div class="w-full flex-1 min-h-0 overflow-hidden">
        <div class="bg-card-glass-bg h-full">
            <OTable
              ref="qTable"
              :frame="false"
              data-test="enrichment-tables-list-table"
              :data="visibleRows"
              :columns="columns"
              row-key="name"
              :loading="loading"
              pagination="client"
              :page-size="selectedPerPage"
              :page-size-options="perPageOptionsList"
              sorting="client"
              filter-mode="client"
              show-index
              :show-global-filter="false"
              :default-columns="false"
              :enable-column-resize="true"
              :persist-columns="true"
              table-id="pipelines-enrichment-tables"
              selection="multiple"
              :selected-ids="selectedEnrichmentTableIds"
              @update:selected-ids="handleSelectedIdsUpdate"
              width="100%"
              class="w-full h-full"
            >
              <!-- Toolbar: type filter + search -->
              <template #toolbar>
                <div class="flex items-center gap-2 w-full">
                  <OToggleGroup
                    :model-value="selectedFilter"
                    @update:model-value="(v) => { selectedFilter = v as string; updateActiveTab(); }"
                    data-test="enrichment-tables-list-tabs"
                  >
                    <OToggleGroupItem value="all" size="sm" data-test="tab-all">
                      <template #icon-left><OIcon name="format-list-bulleted" size="sm" /></template>
                      {{ t("function.filterAll") }}
                    </OToggleGroupItem>
                    <OToggleGroupItem value="uploaded" size="sm" data-test="tab-uploaded">
                      <template #icon-left><OIcon name="upload" size="sm" /></template>
                      {{ t("function.filterFile") }}
                    </OToggleGroupItem>
                    <OToggleGroupItem value="file_url" size="sm" data-test="tab-file-url">
                      <template #icon-left><OIcon name="link" size="sm" /></template>
                      {{ t("function.filterUrl") }}
                    </OToggleGroupItem>
                  </OToggleGroup>
                  <OSearchInput
                    data-test="enrichment-tables-search-input"
                    v-model="filterQuery"
                    class="ml-auto w-64"
                    :placeholder="t('function.searchEnrichmentTable')"
                  />
                </div>
              </template>
              <template #toolbar-trailing>
                <OButton
                  variant="outline"
                  size="icon-sm"
                  icon-left="refresh"
                  :loading="loading"
                  data-test="enrichment-tables-list-refresh-btn"
                  @click="refreshList"
                >
                  <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="enrichmentTablesRefresh" />
                </OButton>
              </template>
              <template #empty>
                <OEmptyState
                  size="hero"
                  preset="no-enrichment-tables"
                  :filtered="!!filterQuery"
                  @action="
                    (id) =>
                      id === 'clear-filters'
                        ? (filterQuery = '')
                        : showAddUpdateFn(null)
                  "
                />
              </template>
              <template #cell-type="{ row }">
                <div
                  :data-test="`${row.name}-type-cell`"
                  class="flex items-center gap-2"
                >
                  <OTag v-if="!row.urlJobs || row.urlJobs.length === 0" type="enrichmentType" value="file" :data-test="`${row.name}-type-file`" />
                  <template v-else>
                    <span
                      :data-test="`${row.name}-type-url-trigger`"
                      class="cursor-pointer inline-flex items-center gap-1"
                      @click="showUrlJobsDialog(row)"
                    >
                      <OTag type="enrichmentType" value="url" />
                      <span v-if="row.urlJobs.length > 1" class="text-text-body"> ({{ row.urlJobs.length }})</span>
                    </span>
                    <span v-if="row.aggregateStatus === 'completed'">
                      <OIcon name="check-circle" size="sm" class="text-status-positive">
                        <OTooltip>
                          <template #content>
                            <div style="max-width: 300px;">
                              <strong>Status: All Completed</strong><br/>
                              {{ row.urlJobs.length }} URL job(s) completed<br/>
                              <br/>
                              <em style="font-size: 0.85em;">Click "Url" to see details</em>
                            </div>
                          </template>
                        </OTooltip>
                      </OIcon>
                    </span>
                    <span v-else-if="row.aggregateStatus === 'processing'">
                      <OIcon name="sync" size="sm" class="animate-spin">
                        <OTooltip>
                          <template #content>
                            <div style="max-width: 300px;">
                              <strong>Status: Processing</strong><br/>
                              One or more jobs are currently processing<br/>
                              <br/>
                              <em style="font-size: 0.85em;">Note: Progress is not real-time. Refresh to see latest updates.<br/>Click "Url" for details</em>
                            </div>
                          </template>
                        </OTooltip>
                      </OIcon>
                    </span>
                    <span v-else-if="row.aggregateStatus === 'failed'">
                      <OIcon
                        name="warning"
                        size="sm"
                        class="cursor-pointer"
                        @click="showUrlJobsDialog(row)"
                      >
                        <OTooltip>
                          <template #content>
                            <div style="max-width: 350px;">
                              <strong>Status: Failed</strong><br/>
                              One or more jobs have failed<br/>
                              <br/>
                              Click to see details and retry failed jobs
                            </div>
                          </template>
                        </OTooltip>
                      </OIcon>
                    </span>
                    <span v-else-if="row.aggregateStatus === 'pending'">
                      <OIcon name="schedule" size="sm">
                        <OTooltip>
                          <template #content>
                            <div style="max-width: 300px;">
                              <strong>Status: Pending</strong><br/>
                              Job(s) waiting to be processed<br/>
                              <br/>
                              <em style="font-size: 0.85em;">Click "Url" for details</em>
                            </div>
                          </template>
                        </OTooltip>
                      </OIcon>
                    </span>
                  </template>
                </div>
              </template>
              <template #cell-actions="{ row }">
                <div class="flex items-center justify-center">
                  <OButton
                    v-if="!row.urlJobs || row.urlJobs.length === 0 || row.aggregateStatus === 'completed'"
                    :data-test="`${row.name}-explore-btn`"
                    :title="t('logStream.explore')"
                    variant="ghost"
                    size="icon-sm"
                    @click="exploreEnrichmentTable(row)"
                    icon-left="search"
                    data-row-action="view"
                  />

                  <!-- Schema Settings button - show for uploaded tables or completed URL jobs -->
                  <OButton
                    v-if="!row.urlJobs || row.urlJobs.length === 0 || row.aggregateStatus === 'completed'"
                    :data-test="`${row.name}-schema-btn`"
                    :title="t('logStream.schemaHeader')"
                    variant="ghost"
                    size="icon-sm"
                    @click="listSchema(row)"
                    icon-left="format-list-bulleted"
                    data-row-action="view"
                  />

                  <!-- Edit button - show for uploaded tables, completed URL jobs, or failed URL jobs (to add more URLs) -->
                  <OButton
                    v-if="!row.urlJobs || row.urlJobs.length === 0 || row.aggregateStatus === 'completed' || row.aggregateStatus === 'failed'"
                    :data-test="`${row.name}-edit-btn`"
                    :title="t('function.enrichmentTables')"
                    variant="ghost"
                    size="icon-sm"
                    @click="showAddUpdateFn(row)"
                    icon-left="edit"
                    data-row-action="edit"
                  />

                  <!-- Delete button - always visible -->
                  <OButton
                    :data-test="`${row.name}-delete-btn`"
                    :title="t('function.delete')"
                    variant="ghost-destructive"
                    size="icon-sm"
                    @click="showDeleteDialogFn(row)"
                    icon-left="delete"
                    data-row-action="delete"
                  />
                </div>
              </template>

              <template #cell-doc_num="{ row }">
                <ONumberCell :value="row.doc_num" format="number" />
              </template>

              <template #cell-function="{ row }">
                <div>
                  <OTooltip>
                    <template #content><pre>{{ row.function }}</pre></template>
                  </OTooltip>
                  <pre style="white-space: break-spaces">{{ row.function }}</pre>
                </div>
              </template>

              <template #bottom>
                <div class="flex items-center justify-between w-full py-2">
                  <div class="flex items-center text-xs font-normal mr-4">
                    {{ resultTotal }} {{ t('function.enrichmentTables') }}
                  </div>
                  <OButton
                    v-if="selectedEnrichmentTables.length > 0"
                    data-test="enrichment-tables-bulk-delete-btn"
                    variant="outline-destructive"
                    size="sm"
                    icon-left="delete"
                    @click="openBulkDeleteDialog"
                  >
                    Delete
                  </OButton>
                </div>
              </template>
            </OTable>
          </div>
        </div>
    </OPageLayout>
    <div v-else>
      <add-enrichment-table
        v-model="formData"
        :isUpdating="isUpdated"
        @update:list="refreshList"
        @cancel:hideform="hideForm"
      />
    </div>
    <ConfirmDialog
      title="Delete Enrichment Table"
      message="Are you sure you want to delete enrichment table?"
      @update:ok="deleteLookupTable"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
    <ConfirmDialog
      title="Bulk Delete Enrichment Tables"
      :message="`Are you sure you want to delete ${selectedEnrichmentTables.length} enrichment table(s)?`"
      @update:ok="bulkDeleteEnrichmentTables"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
    <EnrichmentSchema
      v-model:open="showEnrichmentSchema"
      :selectedEnrichmentTable="selectedEnrichmentTable"
    />

    <!-- URL Jobs Dialog -->
    <ODrawer data-test="enrichment-table-list-url-jobs-drawer"
      bleed
      v-model:open="showUrlJobsDialogState"
      size="lg"
    >
      <div class="p-4">
        <div class="flex items-center justify-between mb-4">
          <div class="text-xl font-semibold">URL Jobs for {{ selectedTableForUrlJobs?.name }}</div>
        </div>
        <div v-if="selectedTableForUrlJobs?.urlJobs && selectedTableForUrlJobs.urlJobs.length > 0">
          <ul class="flex flex-col divide-y divide-border">
            <li v-for="(job, index) in selectedTableForUrlJobs.urlJobs" :key="job.id" :data-test="`enrichment-url-jobs-item-${index}`" class="flex items-center gap-2 p-4">
              <div class="flex flex-col flex-1 min-w-0">
                <span class="text-sm font-bold">Job {{ (index as number) + 1 }}</span>
                <span class="block text-xs text-muted-foreground">{{ job.url }}</span>
                <span class="block text-xs text-muted-foreground mt-2">
                  <OTag
                    :data-test="`enrichment-url-jobs-item-${index}-status-badge`"
                    :data-test-value="job.status"
                    type="enrichmentJobStatus"
                    :value="job.status"
                  />
                </span>
                <span v-if="job.status === 'completed'" class="block text-xs text-muted-foreground mt-2">
                    Records: {{ job.total_records_processed?.toLocaleString() }}<br/>
                    Size: {{ job.total_bytes_fetched ? formatSizeFromMB(((job.total_bytes_fetched / 1024 / 1024).toFixed(2))) : '0 MB' }}
                  </span>
                  <span v-if="job.status === 'failed'" :data-test="`enrichment-url-jobs-item-${index}-error`" class="block text-xs text-status-error-text mt-2">
                    Error: {{ job.error_message }}
                  </span>
                </div>
              </li>
            </ul>
          </div>
          <div v-else class="text-center p-3 text-text-muted">
            No URL jobs found
          </div>
      </div>
    </ODrawer>
  </div>
</template>

<script lang="ts">

import { computed, defineComponent, onBeforeMount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import AddEnrichmentTable from "./AddEnrichmentTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import segment from "../../services/segment_analytics";
import {
  formatSizeFromMB,
  getImageURL,
  verifyOrganizationStatus,
} from "../../utils/zincutils";
import streamService from "@/services/stream";
import useStreams from "@/composables/useStreams";
import EnrichmentSchema from "./EnrichmentSchema.vue";
import { useReo } from "@/services/reodotdev_analytics";
import jsTransformService from "@/services/jstransform";
import { useToast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import PipelineSectionTabs from "@/components/pipeline/PipelineSectionTabs.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import OTag from "@/lib/core/Badge/OTag.vue";
import ONumberCell from "@/lib/core/Table/cells/ONumberCell.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "EnrichmentTableList",
  components: {
    OPageLayout,
    PipelineSectionTabs,
    AddEnrichmentTable,
    OEmptyState,
    ConfirmDialog,
    EnrichmentSchema,
    OToggleGroup,
    OToggleGroupItem,
    OButton,
    ODrawer,
    OSearchInput,
    OTooltip,
    OIcon,
    OTag,
    ONumberCell,
    OTable,
},
  emits: [
    "updated:fields",
    "update:changeRecordPerPage",
    "update:maxRecordToReturn",
  ],
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const jsTransforms: any = ref([]);
    const formData: any = ref({});
    const showAddJSTransformDialog: any = ref(false);
    const qTable: any = ref(null);
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmBulkDelete = ref<boolean>(false);
    const selectedEnrichmentTables = ref<any[]>([]);
    const showEnrichmentSchema = ref<boolean>(false);
    const showUrlJobsDialogState = ref<boolean>(false);
    const selectedTableForUrlJobs = ref<any>(null);
    const filterQuery = ref("");
    const loading = ref(false);
    const { track } = useReo();
    const { toast } = useToast();
    const columns: OTableColumnDef[] = [
      { id: "name", header: t("common.name"), accessorKey: "name", sortable: true, resizable: true, hideable: true, size: COL.name, minSize: 160, meta: { align: "left", flex: true } },
      { id: "type", header: "Type", accessorFn: (row: any) => (row.urlJobs && row.urlJobs.length > 0) ? "Url" : "File", sortable: true, resizable: true, hideable: true, meta: { align: "left" }, size: COL.type },
      { id: "doc_num", header: t("logStream.docNum"), accessorKey: "doc_num", sortable: true, resizable: true, hideable: true, meta: { align: "right" }, size: COL.count },
      { id: "storage_size", header: t("logStream.storageSize"), accessorKey: "original_storage_size", sortable: true, resizable: true, hideable: true, meta: { align: "right", format: (_v: any, row: any) => formatSizeFromMB(row.storage_size) }, size: COL.sizeBytes },
      { id: "compressed_size", header: t("logStream.compressedSize"), accessorKey: "original_compressed_size", sortable: true, resizable: true, hideable: true, meta: { align: "right", format: (_v: any, row: any) => formatSizeFromMB(row.compressed_size) }, size: COL.sizeBytes },
      { id: "actions", header: t("function.actions"), accessorKey: "actions", sortable: false, meta: { align: "center", actionCount: 4 }, isAction: true },
    ];

    const selectedEnrichmentTableIds = computed(() =>
      selectedEnrichmentTables.value.map((t: any) => t.name)
    );

    const handleSelectedIdsUpdate = (ids: string[]) => {
      selectedEnrichmentTables.value = ids
        .map((id) => visibleRows.value.find((r: any) => r.name === id))
        .filter(Boolean);
    };

    const perPageOptionsList = [20, 50, 100, 250, 500];
    const { getStreams, resetStreamType, getStream } = useStreams();

    onBeforeMount(() => {
      getLookupTables();
    });
    //here we need to check if the action is there or not
    //because if action is there user before refresh the page user was there in add / update page
    //so to maitain consistency we are checking the action and if action is there we are showing the add / update page
    //else we are showing the list of enrichment tables
    onMounted(()=>{
      //it is for showing empty add page when user refresh the page
      if(router.currentRoute.value.query.action === "add"){
        showAddUpdateFn(null)
      }
      //it is for showing the update page when user refresh the page
      //we are passing the name of the enrichment table to the update page
      else if(router.currentRoute.value.query.action === "update" && router.currentRoute.value.query.name){
        showAddUpdateFn({
          name: router.currentRoute.value.query.name,
        })
      }
      //fallback: if action=update came in without a name, treat it as an add
      else if(router.currentRoute.value.query.action === "update"){
        showAddUpdateFn(null)
      }
    })

    const getLookupTables = async (force: boolean = false) => {
      loading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading enrichment tables...",
              timeout: 0,
});

      try {
        // Fetch both streams and URL job statuses in parallel
        const [streamsRes, statusRes] = await Promise.all([
          getStreams("enrichment_tables", false, false, force),
          jsTransformService.get_all_enrichment_table_statuses(
            store.state.selectedOrganization.identifier
          ).catch((err: any) => {
            // If status API fails, continue with empty status map
            console.warn("Error fetching URL statuses:", err);
            return { data: {} };
          })
        ]);

        const res: any = streamsRes;
        const urlJobMap = statusRes.data || {};

        // Create a map of stream names from the streams list
        const streamMap = new Map();
        res.list.forEach((stream: any) => {
          streamMap.set(stream.name, stream);
        });

        // Combine streams with URL jobs (now arrays)
        const allTables = new Map();
        let counter = 1;

        // Helper function to compute aggregate status from URL jobs array
        const computeAggregateStatus = (urlJobs: any[]) => {
          if (!urlJobs || urlJobs.length === 0) return null;

          // If any job is failed, aggregate status is failed
          if (urlJobs.some((job: any) => job.status === 'failed')) return 'failed';

          // If any job is processing, aggregate status is processing
          if (urlJobs.some((job: any) => job.status === 'processing')) return 'processing';

          // If any job is pending, aggregate status is pending
          if (urlJobs.some((job: any) => job.status === 'pending')) return 'pending';

          // If all jobs are completed, aggregate status is completed
          if (urlJobs.every((job: any) => job.status === 'completed')) return 'completed';

          return 'pending';
        };

        // Add all streams
        res.list.forEach((data: any) => {
          let doc_num = "";
          let storage_size = "";
          let compressed_size = "";
          let original_storage_size = "";
          let original_compressed_size = "";

          if (data.stats) {
            doc_num = data.stats.doc_num;
            storage_size = data.stats.storage_size + " MB";
            compressed_size = data.stats.compressed_size + " MB";
            original_storage_size = data.stats.storage_size;
            original_compressed_size = data.stats.compressed_size;
          }

          const urlJobs = urlJobMap[data.name] || [];

          allTables.set(data.name, {
            id: data.name + counter++,
            name: data.name,
            doc_num: doc_num,
            storage_size: storage_size,
            compressed_size: compressed_size,
            original_storage_size: original_storage_size,
            original_compressed_size: original_compressed_size,
            actions: "action buttons",
            stream_type: data.stream_type,
            urlJobs: urlJobs,
            aggregateStatus: computeAggregateStatus(urlJobs),
          });
        });

        // Add URL jobs that don't have schemas yet (pending/processing)
        Object.entries(urlJobMap).forEach(([tableName, urlJobs]: [string, any]) => {
          if (!allTables.has(tableName)) {
            // This is a URL job without a schema yet
            allTables.set(tableName, {
              id: tableName + counter++,
              name: tableName,
              doc_num: "",
              storage_size: "",
              compressed_size: "",
              original_storage_size: "",
              original_compressed_size: "",
              actions: "action buttons",
              stream_type: "enrichment_tables",
              urlJobs: urlJobs,
              aggregateStatus: computeAggregateStatus(urlJobs),
            });
          }
        });

        jsTransforms.value = Array.from(allTables.values());
        resultTotal.value = jsTransforms.value.length;
        dismiss();
      } catch (err: any) {
        console.info("Error while fetching enrichment tables", err);
        dismiss();
        if (err.response?.status != 403) {
          toast({
            variant: "error",
            message:
              err.response?.data?.message ||
              "Error while fetching functions.",
          });
        }
      } finally {
        loading.value = false;
      }
    };

    const resultTotal = ref<number>(0);
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const selectedEnrichmentTable = ref<any>(null);
    const selectedFilter = ref<string>("all");

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
    };

    const updateActiveTab = () => {
      // Filter tabs are handled in the computed visibleRows
      // This function is just for consistency with PipelinesList structure
    };

    const addLookupTable = () => {
      showAddJSTransformDialog.value = true;
    };

    const showAddUpdateFn = (row: any) => {
      formData.value = row;
      let action;
      if (!row) {
        isUpdated.value = false;
        action = "Add Enrichment Table";
        router.push({
          name: "enrichmentTables",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        track("Button Click", {
          button: "Add Enrichment Table",
          page: "Functions"
        });
      } else {
        isUpdated.value = true;
        action = "Update Enrichment Table";
        router.push({
          name: "enrichmentTables",
          query: {
            action: "update",
            name: row.name,
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        track("Button Click", {
          button: "Update Enrichment Table",
          page: "Functions"
        });
      }
      addLookupTable();

      segment.track("Button Click", {
        button: action,
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Functions",
      });
    };

    const refreshList = () => {
      router.push({
        name: "enrichmentTables",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      showAddJSTransformDialog.value = false;
      resetStreamType("enrichment_tables");
      getLookupTables(true);
    };

    const hideForm = () => {
      showAddJSTransformDialog.value = false;
      router.replace({
        name: "enrichmentTables",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const deleteLookupTable = () => {
      streamService
        .delete(
          store.state.selectedOrganization.identifier,
          selectedDelete.value.name,
          "enrichment_tables",
        )
        .then((res: any) => {
          if (res.data.code == 200) {
            toast({
              message: `${selectedDelete.value.name} deleted successfully.`,
              variant: "success",
            });
            resetStreamType("enrichment_tables");
            getLookupTables(true);
          }
        })
        .catch((err: any) => {
          if (err.response.status != 403) {
            toast({
              message:
                err.response?.data?.message || "Error while deleting stream.",
              variant: "error",
            });
          }
        });

      segment.track("Button Click", {
        button: "Delete Enrichment Table",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        function_name: selectedDelete.value.name,
        is_ingest_func: selectedDelete.value.ingest,
        page: "Functions",
      });
    };

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteEnrichmentTables = () => {
      const selectedItems = selectedEnrichmentTables.value;
      const promises: Promise<any>[] = [];

      selectedItems.forEach((table: any) => {
        promises.push(
          streamService.delete(
            store.state.selectedOrganization.identifier,
            table.name,
            "enrichment_tables",
          ),
        );
      });

      Promise.allSettled(promises)
        .then((results) => {
          let successfulDeletions = 0;
          let failedDeletions = 0;

          results.forEach((result) => {
            if (result.status === 'fulfilled') {
              // Check if the response indicates success
              if (result.value?.data?.code === 200) {
                successfulDeletions++;
              } else {
                failedDeletions++;
              }
            } else {
              // Handle rejected promises (errors)
              const error = result.reason;
              // Don't count 403 errors as failures (silent)
              if (error?.response?.status !== 403 && error?.status !== 403) {
                failedDeletions++;
              }
            }
          });

          if (successfulDeletions > 0 && failedDeletions === 0) {
            toast({
              message: `Successfully deleted ${successfulDeletions} enrichment table(s).`,
              variant: "success",
            });
          } else if (successfulDeletions > 0 && failedDeletions > 0) {
            toast({
              message: `Deleted ${successfulDeletions} enrichment table(s). Failed to delete ${failedDeletions} enrichment table(s).`,
              variant: "warning",
            });
          } else if (failedDeletions > 0) {
            toast({
              message: `Failed to delete ${failedDeletions} enrichment table(s).`,
              variant: "error",
            });
          }

          resetStreamType("enrichment_tables");
          getLookupTables(true);
          selectedEnrichmentTables.value = [];
          confirmBulkDelete.value = false;
        });
    };

    const showDeleteDialogFn = (row: any) => {
      selectedDelete.value = row;
      confirmDelete.value = true;
    };

    /**
     * Get time range for stream explorer, for enrichment tables it will get the time range from the stream data min and max time
     * @param stream: Stream object
     */
    const getTimeRange = async (stream: any) => {
      const dateTime: { period?: string; from?: number; to?: number } = {};

      const dismiss = toast({
        variant: "loading",
        message: "Redirecting to explorer...",
              timeout: 0,
});

      try {
        await getStream(stream.name, stream.stream_type, true)
          .then((streamResponse) => {
            if (
              streamResponse.stats.doc_time_min &&
              streamResponse.stats.doc_time_max
            ) {
              //reducing the doc_time_min by 1000000 (1sec) to get the exact time range
              dateTime["from"] = streamResponse.stats.doc_time_min - 1000000;
              //adding 60000000(1min)
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
            console.error("Error while getting enrichment table: ", err);
            dateTime["period"] = "15m";
          })
          .finally(() => {
            dismiss();
          });
      } catch (err) {
        console.error("Error while getting enrichment table: ", err);
        dateTime["period"] = "15m";
        dismiss();
      }

      return dateTime;
    };

    const exploreEnrichmentTable = async (row: any) => {
      store.dispatch("logs/setIsInitialized", false);
      const timestamps = await getTimeRange(row);
      router.push({
        name: "logs",
        query: {
          stream_type: row.stream_type,
          stream: row.name,
          refresh: "0",
          query: "",
          type: "stream_explorer",
          org_identifier: store.state.selectedOrganization.identifier,
          ...timestamps,
        },
      });
    };
    const listSchema = async (row: any) => {
      selectedEnrichmentTable.value = row.name;
      showEnrichmentSchema.value = true;
    };

    const showUrlJobsDialog = (row: any) => {
      selectedTableForUrlJobs.value = row;
      showUrlJobsDialogState.value = true;
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
      let rows = jsTransforms.value || [];

      // Apply type filter
      if (selectedFilter.value === 'uploaded') {
        rows = rows.filter((row: any) => !row.urlJobs || row.urlJobs.length === 0);
      } else if (selectedFilter.value === 'file_url') {
        rows = rows.filter((row: any) => row.urlJobs && row.urlJobs.length > 0);
      }

      // Apply search filter
      if (!filterQuery.value) return rows;
      return filterData(rows, filterQuery.value);
    });
    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    // Watch visibleRows to sync resultTotal with search filter
    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });

    useShortcuts([
      { id: "enrichmentTablesRefresh", handler: () => { if (!isInputFocused()) refreshList(); } },
    ]);

    return {
      t,
      qTable,
      store,
      router,
      jsTransforms,
      columns,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      getLookupTables,
      loading,
      resultTotal,
      refreshList,
      perPageOptionsList,
      selectedPerPage,
      addLookupTable,
      deleteLookupTable,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      changePagination,
      maxRecordToReturn,
      showAddJSTransformDialog,
      "delete": "delete",
      filterQuery,
      filterData,
      getImageURL,
      verifyOrganizationStatus,
      exploreEnrichmentTable,
      showEnrichmentSchema,
      listSchema,
      selectedEnrichmentTable,
      getTimeRange,
      visibleRows,
      hasVisibleRows,
      confirmBulkDelete,
      selectedEnrichmentTables,
      selectedEnrichmentTableIds,
      handleSelectedIdsUpdate,
      openBulkDeleteDialog,
      bulkDeleteEnrichmentTables,
      selectedFilter,
      showUrlJobsDialog,
      showUrlJobsDialogState,
      selectedTableForUrlJobs,
      formatSizeFromMB,
      updateActiveTab,
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
        this.router,
      );
      if (
        (newVal != oldVal || this.jsTransforms.value == undefined) &&
        this.router.currentRoute.value.name == "pipeline"
      ) {
        this.resultTotal = 0;
        this.jsTransforms = [];
        this.getLookupTables(true);
      }
    },
  },
});
</script>

