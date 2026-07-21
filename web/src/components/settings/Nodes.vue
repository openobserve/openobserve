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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <OPageLayout
    :title="t('nodes.header')"
    icon="hub"
    :subtitle="t('settings.nodesPage.subtitle')"
    bleed
  >
    <OSplitter
      :model-value="splitterModel"
      @update:model-value="(v: number) => splitterModel = v"
      :limits="[0, 250]"
      unit="px"
      class="flex-1 min-h-0 overflow-hidden"
    >
      <template #before>
        <div class="flex flex-col border-r4 border-r border-border-default h-full">
          <div class="sticky top-0 px-2 shrink-0">
            <div class="flex items-center justify-between p-2 " style="font-size: var(--text-lg)">
              <span class="flex items-center gap-1">
                {{ t("nodes.filter_header") }}
                <OIcon name="filter-list" size="sm" />
              </span>
              <OButton
                variant="outline"
                size="xs"
                :class="filterApplied ? 'text-primary' : ''"
                @click="clearAll()"
              >{{ t("nodes.clear_all") }}</OButton>
            </div>
          </div>

          <div class=" min-h-0 overflow-y-auto">
            <div class="flex flex-col pb-2 px-2">
              <OCollapsible
                v-if="
                  regionRows.length > 0 &&
                  store.state.zoConfig.super_cluster_enabled
                "
                variant="sidebar"
                :model-value="sectionOpen.region"
                @update:model-value="(v) => (sectionOpen.region = v)"
                :label="t('nodes.region')"
              >
                <div class="p-0">
                  <OSearchInput
                    data-test="nodes-region-filter-search-input"
                    v-model="filterRegionQuery"
                    clearable
                    :debounce="1"
                    :placeholder="t('nodes.searchRegion')"
                    class="w-full filter-input"
                  />
                  <OTable
                      data-test="nodes-region-table"
                      :data="visibleRegionRows"
                      :columns="filterOTableColumns"
                      row-key="name"
                      :selected-ids="selectedRegionIds"
                      selection="multiple"
                      pagination="none"
                      :show-global-filter="false"
                      :default-columns="false"
                      @update:selected-ids="handleSelectedRegionIdsUpdate"
                    >
                      <template #empty>
                        <OEmptyState size="block" preset="no-nodes" />
                      </template>
                    </OTable>
                  </div>
                </OCollapsible>
                <OSeparator v-if="regionRows.length > 0 && store.state.zoConfig.super_cluster_enabled && sectionOpen.region" class="my-2" />

                <OCollapsible
                  v-if="
                    clusterRows.length > 0 &&
                    store.state.zoConfig.super_cluster_enabled
                  "
                  variant="sidebar"
                  :model-value="sectionOpen.cluster"
                  @update:model-value="(v) => (sectionOpen.cluster = v)"
                  :label="t('nodes.cluster')"
                >
                  <div class="p-0">
                    <OSearchInput
                      data-test="nodes-cluster-filter-search-input"
                      v-model="filterClusterQuery"
                      clearable
                      :debounce="1"
                      :placeholder="t('nodes.searchCluster')"
                      class="w-full filter-input"
                    />
                    <OTable
                      data-test="nodes-cluster-table"
                      :data="visibleClusterRows"
                      :columns="filterOTableColumns"
                      row-key="name"
                      :selected-ids="selectedClusterIds"
                      selection="multiple"
                      pagination="none"
                      :show-global-filter="false"
                      :default-columns="false"
                      @update:selected-ids="handleSelectedClusterIdsUpdate"
                    >
                      <template #empty>
                        <OEmptyState size="block" preset="no-nodes" />
                      </template>
                    </OTable>
                  </div>
                </OCollapsible>
                <OSeparator v-if="clusterRows.length > 0 && store.state.zoConfig.super_cluster_enabled && sectionOpen.cluster" class="my-2" />

                <OCollapsible
                  v-if="nodetypeRows.length > 0"
                  variant="sidebar"
                  :model-value="sectionOpen.nodetype"
                  @update:model-value="(v) => (sectionOpen.nodetype = v)"
                  :label="t('nodes.nodetype')"
                >
                  <div class="px-1">
                    <OTable
                      data-test="nodes-nodetype-table"
                      :data="nodetypeRows"
                      :columns="filterOTableColumns"
                      row-key="name"
                      :selected-ids="selectedNodetypeIds"
                      selection="multiple"
                      pagination="none"
                      :show-global-filter="false"
                      :default-columns="false"
                      @update:selected-ids="handleSelectedNodetypeIdsUpdate"
                    />
                  </div>
                </OCollapsible>

                <OCollapsible
                  v-if="statusesRows.length > 0"
                  variant="sidebar"
                  :model-value="sectionOpen.status"
                  @update:model-value="(v) => (sectionOpen.status = v)"
                  :label="t('nodes.status')"
                >
                  <div class="px-1">
                    <OTable
                      data-test="nodes-status-table"
                      :data="statusesRows"
                      :columns="filterOTableColumns"
                      row-key="name"
                      :selected-ids="selectedStatusIds"
                      selection="multiple"
                      pagination="none"
                      :show-global-filter="false"
                      :default-columns="false"
                      @update:selected-ids="handleSelectedStatusIdsUpdate"
                    >
                      <template #cell-name="{ row }">
                        <span
                          :class="`status-${row.name.toLowerCase()}`"
                          class="self-stretch mr-1"
                        ></span
                        >{{ row.name }}
                      </template>
                    </OTable>
                  </div>
                </OCollapsible>

                <OCollapsible
                  variant="sidebar"
                  :model-value="sectionOpen.cpu"
                  @update:model-value="(v) => (sectionOpen.cpu = v)"
                  :label="t('nodes.cpuusage')"
                >
                  <div class="px-1 pb-2">
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1 pr-2 ml-1">
                      <OInput
                        data-test="nodes-filter-cpuusage-min"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        max="100"
                        v-model="cpuUsage.min"
                      />
                      <span class="px-1 text-center">{{ t('settings.nodesPage.to') }}</span>
                      <OInput
                        data-test="nodes-filter-cpuusage-max"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        max="100"
                        v-model="cpuUsage.max"
                      />
                    </div>
                    <ORange
                      data-test="nodes-filter-cpuusage-range-slider"
                      :model-value="cpuUsage"
                      @update:model-value="
                        (val) => {
                          cpuUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxCPUUsage"
                      class="w-[85%] mt-3 ml-3"
                    />
                  </div>
                </OCollapsible>
                <OSeparator v-if="sectionOpen.cpu" class="my-2" />

                <OCollapsible
                  variant="sidebar"
                  :model-value="sectionOpen.memory"
                  @update:model-value="(v) => (sectionOpen.memory = v)"
                  :label="t('nodes.memoryusage')"
                >
                  <div class="px-1 pb-2">
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1 pr-2 ml-1">
                      <OInput
                        data-test="nodes-filter-memoryusage-min"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        max="100"
                        v-model="memoryUsage.min"
                      />
                      <span class="px-1 text-center">{{ t('settings.nodesPage.to') }}</span>
                      <OInput
                        data-test="nodes-filter-memoryusage-max"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        max="100"
                        v-model="memoryUsage.max"
                      />
                    </div>
                    <ORange
                      data-test="nodes-filter-memoryusage-range-slider"
                      :model-value="memoryUsage"
                      @update:model-value="
                        (val) => {
                          memoryUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxMemoryUsage"
                      class="w-[85%] mt-3 ml-3"
                    />
                  </div>
                </OCollapsible>
                <OSeparator v-if="sectionOpen.memory" class="my-2" />

                <OCollapsible
                  variant="sidebar"
                  :model-value="sectionOpen.tcp"
                  @update:model-value="(v) => (sectionOpen.tcp = v)"
                  :label="t('nodes.tcpusage')"
                >
                  <div class="px-1 pb-2">
                    <OCheckbox
                      type="checkbox"
                      v-model="establishedToggle"
                      :label="t('nodes.establishedLabel')"
                    />
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1 pr-2 ml-1">
                      <OInput
                        :disable="!establishedToggle"
                        data-test="nodes-filter-established-min"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        :max="maxEstablished"
                        v-model="establishedUsage.min"
                      />
                      <span class="px-1 text-center">{{ t('settings.nodesPage.to') }}</span>
                      <OInput
                        :disable="!establishedToggle"
                        data-test="nodes-filter-established-max"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        :max="maxEstablished"
                        v-model="establishedUsage.max"
                      />
                    </div>
                    <ORange
                      :disabled="!establishedToggle"
                      data-test="nodes-filter-tcp-established-range-slider"
                      :model-value="establishedUsage"
                      @update:model-value="
                        (val) => {
                          establishedUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxEstablished"
                      class="w-[85%] mt-3 ml-3"
                    />

                    <OCheckbox
                      type="checkbox"
                      class="mt-6"
                      v-model="closewaitToggle"
                      :label="t('nodes.closewaitLabel')"
                    />
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1 pr-2 ml-1">
                      <OInput
                        :disable="!closewaitToggle"
                        data-test="nodes-filter-closewait-min"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        :max="maxClosewait"
                        v-model="closewaitUsage.min"
                      />
                      <span class="px-1 text-center">{{ t('settings.nodesPage.to') }}</span>
                      <OInput
                        :disable="!closewaitToggle"
                        data-test="nodes-filter-closewait-max"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        :max="maxClosewait"
                        v-model="closewaitUsage.max"
                      />
                    </div>
                    <ORange
                      :disabled="!closewaitToggle"
                      data-test="nodes-filter-tcp-closewait-range-slider"
                      :model-value="closewaitUsage"
                      @update:model-value="
                        (val) => {
                          closewaitUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxClosewait"
                      class="w-[85%] mt-3 ml-3"
                    />

                    <OCheckbox
                      type="checkbox"
                      class="mt-6"
                      v-model="waittimeToggle"
                      :label="t('nodes.waittimeLabel')"
                    />
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1 pr-2 ml-1">
                      <OInput
                        :disable="!waittimeToggle"
                        data-test="nodes-filter-waittime-min"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        :max="maxWaittime"
                        v-model="waittimeUsage.min"
                      />
                      <span class="px-1 text-center">{{ t('settings.nodesPage.to') }}</span>
                      <OInput
                        :disable="!waittimeToggle"
                        data-test="nodes-filter-waittime-max"
                        type="number"
                        class="w-full min-w-0"
                        min="0"
                        :max="maxWaittime"
                        v-model="waittimeUsage.max"
                      />
                    </div>
                    <ORange
                      :disabled="!waittimeToggle"
                      data-test="nodes-filter-tcp-waittime-range-slider"
                      :model-value="waittimeUsage"
                      @update:model-value="
                        (val) => {
                          waittimeUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxWaittime"
                      class="w-[85%] mt-3 ml-3"
                    />
                  </div>
                </OCollapsible>

            </div>
          </div>
          <div class="flex justify-end px-2 py-2 shrink-0 border-t">
            <OButton
              variant="primary"
              size="sm-action"
              @click="applyFilter()"
            >
              {{ t("nodes.applyFilter") }}
            </OButton>
          </div>
        </div>
      </template>
      <template #after>
        <div class="flex flex-col h-full min-h-0">
        <OTable
          class="flex-1 min-h-0"
          ref="qTable"
          data-test="nodes-main-table"
          :data="visibleRows"
          :columns="computedOTableColumns"
          row-key="name"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          :footer-title="t('nodes.header')"
          :row-class="(row) => `status-row status-${row.status?.toLowerCase()}`"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="settings-nodes"
          :show-global-filter="false"
          :loading="loading"
        >
          <template #toolbar>
            <OSearchInput
              data-test="nodes-search-input"
              v-model="filterQuery"
              class="flex-1"
              :placeholder="t('nodes.search')"
            />
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="nodes-list-refresh-btn"
              @click="() => getData(true)"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="nodesRefresh" />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-nodes"
              :filtered="!!filterQuery"
              :hide-action="!filterQuery"
              @action="(id) => id === 'clear-filters' && (filterQuery = '')"
            />
          </template>

          <template #cell-id="{ row }">
            {{ row.id }}
          </template>

          <template #cell-name="{ row }">
            {{ row.name }}
          </template>

          <template
            v-if="store.state.zoConfig.super_cluster_enabled"
            #cell-region="{ row }"
          >
            <OTag type="fieldTag" class="badge-region mr-1"
              >{{ row.region }}
              <OTooltip :content="t('nodes.region')" />
            </OTag>
            <OTag type="fieldTag" class="badge-cluster"
              >{{ row.cluster }}
              <OTooltip :content="t('nodes.cluster')" />
            </OTag>
          </template>

          <template #cell-tcp="{ row }">
            {{ row.tcp_conns }} (E:{{ row.tcp_conns_established }}, C:{{
              row.tcp_conns_close_wait
            }}, T:{{ row.tcp_conns_time_wait }})
          </template>

          <template #cell-cpu="{ row }">
            <OProgressBar
              size="sm"
              class="bg-[lightgrey] w-[80%]! max-w-[80%] inline-block"
              :value="row.cpu_usage / 100"
              :variant="row.cpu_usage > 85 ? 'danger' : 'default'"
            />
            {{ row.cpu_usage }}%
          </template>

          <template #cell-memory="{ row }">
            <OProgressBar
              size="sm"
              class="bg-[lightgrey] w-[80%]! max-w-[80%] inline-block"
              :value="row.percentage_memory_usage / 100"
              :variant="row.percentage_memory_usage > 85 ? 'danger' : 'default'"
            />
            {{ row.percentage_memory_usage }}%
          </template>
        </OTable>
        </div>
      </template>
    </OSplitter>
  </OPageLayout>
</template>

<script lang="ts">
import {
  defineComponent,
  reactive,
  ref,
  onMounted,
  watch,
  Ref,
  computed,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ORange from "@/lib/forms/Range/ORange.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import CommonService from "@/services/common";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "PageCipherKeys",
  components: {
    OPageLayout,
    OEmptyState,
    OButton,
    OProgressBar,
    OInput,
    OCheckbox,
    OTooltip,
    ORange,
    OIcon,
    OSearchInput,
    OTag,
    OCollapsible,
    OSeparator,
    OSplitter,
    OTable,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();

    const sectionOpen = reactive({
      region: false,
      cluster: false,
      nodetype: false,
      status: false,
      cpu: false,
      memory: false,
      tcp: false,
    });

    const tabledata: any = ref([]);
    const originalData: any = ref([]);
    const loading = ref(false);
    const splitterModel = ref(250);
    const filterQuery = ref("");

    const filterOTableColumns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("settings.nodesPage.name"),
        accessorKey: "name",
        meta: { align: "left" },
      },
    ];

    const computedOTableColumns = computed(() => {
      const columns: OTableColumnDef[] = [
        { id: "id", header: "#", accessorKey: "id", size: 67, meta: { align: "center" } },
        {
          id: "name",
          header: t("nodes.name"),
          accessorKey: "name",
          sortable: true,
          resizable: true,
          hideable: true,
          minSize: 160,
          meta: { align: "left" , flex: true },
        },
        {
          id: "region",
          header: t("nodes.region"),
          accessorKey: "region",
          resizable: true,
          hideable: true,
          size: 50,
          meta: { align: "left" },
        },
        {
          id: "version",
          header: t("nodes.version"),
          accessorKey: "version",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 100,
          meta: { align: "left" },
        },
        {
          id: "cpu",
          header: t("nodes.cpu"),
          accessorKey: "cpu_usage",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "memory",
          header: t("nodes.memory"),
          accessorKey: "percentage_memory_usage",
          sortable: true,
          resizable: true,
          hideable: true,
          size: 200,
          meta: { align: "right" },
        },
        {
          id: "tcp",
          header: t("nodes.tcp"),
          accessorKey: "tcp_conns",
          resizable: true,
          hideable: true,
          size: 150,
          meta: { align: "right" },
        },
      ];
      if (!store.state.zoConfig.super_cluster_enabled) {
        columns.splice(2, 1);
      }
      return columns;
    });

    const resultTotal = ref<number>(0);

    const regionRows: any = ref([]);
    const selectedRegions: any = ref([]);

    const clusterRows: any = ref([]);
    const selectedClusters: any = ref([]);

    const nodetypeRows: any = ref([]);
    const selectedNodetypes: any = ref([]);

    const statusesRows: any = ref([]);
    const selectedStatuses: any = ref([]);

    // Selection ID computeds for sidebar filter tables
    const selectedRegionIds = computed(() =>
      selectedRegions.value.map((r: any) => r.name),
    );
    const selectedClusterIds = computed(() =>
      selectedClusters.value.map((c: any) => c.name),
    );
    const selectedNodetypeIds = computed(() =>
      selectedNodetypes.value.map((n: any) => n.name),
    );
    const selectedStatusIds = computed(() =>
      selectedStatuses.value.map((s: any) => s.name),
    );

    const handleSelectedRegionIdsUpdate = (ids: string[]) => {
      const map = new Map(regionRows.value.map((r: any) => [r.name, r]));
      selectedRegions.value = ids.map((id: any) => map.get(id)).filter(Boolean);
    };
    const handleSelectedClusterIdsUpdate = (ids: string[]) => {
      const map = new Map(clusterRows.value.map((c: any) => [c.name, c]));
      selectedClusters.value = ids
        .map((id: any) => map.get(id))
        .filter(Boolean);
    };
    const handleSelectedNodetypeIdsUpdate = (ids: string[]) => {
      const map = new Map(nodetypeRows.value.map((n: any) => [n.name, n]));
      selectedNodetypes.value = ids
        .map((id: any) => map.get(id))
        .filter(Boolean);
    };
    const handleSelectedStatusIdsUpdate = (ids: string[]) => {
      const map = new Map(statusesRows.value.map((s: any) => [s.name, s]));
      selectedStatuses.value = ids
        .map((id: any) => map.get(id))
        .filter(Boolean);
    };

    const cpuUsage = ref({
      min: 0,
      max: 100,
    });

    const memoryUsage = ref({
      min: 0,
      max: 100,
    });

    const establishedToggle = ref(true);
    const closewaitToggle = ref(true);
    const waittimeToggle = ref(true);

    const establishedUsage = ref({
      min: 0,
      max: 60,
    });

    const maxEstablished = ref(60);
    const maxClosewait = ref(60);
    const maxWaittime = ref(60);
    const maxCPUUsage = ref(100);
    const maxMemoryUsage = ref(100);
    const { isMetaOrg } = useIsMetaOrg();

    const closewaitUsage = ref({
      min: 0,
      max: 60,
    });

    const waittimeUsage = ref({
      min: 0,
      max: 60,
    });

    function flattenObject(data: any) {
      const result: any = [];
      const uniqueValues = {
        regions: new Set(),
        clusters: new Set(),
        nodeTypes: new Set(),
        statuses: new Set(),
      };

      const maxValues = {
        tcpConnsEstablished: { value: 0 },
        tcpConnsCloseWait: { value: 0 },
        tcpConnsTimeWait: { value: 0 },
        percentageMemoryUsage: { value: 0 },
        cpuUsage: { value: 0 },
      };
      let globalIndex = 1;

      for (const region in data) {
        uniqueValues.regions.add(region);

        for (const cluster in data[region]) {
          uniqueValues.clusters.add(cluster);

          data[region][cluster].forEach((node: any) => {
            const percentageMemoryUsage =
              node.metrics.memory_usage > 0
                ? Math.round(
                    (node.metrics.memory_usage / node.metrics.memory_total) *
                      100,
                  )
                : 0;

            const cpuUsageVal = Math.round(node.metrics.cpu_usage);

            node.role.forEach((r: any) => uniqueValues.nodeTypes.add(r));

            uniqueValues.statuses.add(node.status);

            maxValues.tcpConnsEstablished.value = Math.max(
              maxValues.tcpConnsEstablished.value,
              node.metrics.tcp_conns_established,
            );
            maxValues.tcpConnsCloseWait.value = Math.max(
              maxValues.tcpConnsCloseWait.value,
              node.metrics.tcp_conns_close_wait,
            );
            maxValues.tcpConnsTimeWait.value = Math.max(
              maxValues.tcpConnsTimeWait.value,
              node.metrics.tcp_conns_time_wait,
            );
            maxValues.percentageMemoryUsage.value = Math.max(
              maxValues.percentageMemoryUsage.value,
              percentageMemoryUsage,
            );
            maxValues.cpuUsage.value = Math.max(
              maxValues.cpuUsage.value,
              cpuUsageVal,
            );
            node.id = globalIndex < 10 ? `0${globalIndex}` : globalIndex;
            globalIndex++;

            result.push({
              region,
              cluster,
              status: node.status,
              role: node.role,
              ...node,
              ...node.metrics,
              percentage_memory_usage: percentageMemoryUsage,
              cpu_usage: cpuUsageVal,
            });
          });
        }
      }

      return {
        flattenedData: result,
        uniqueValues: {
          regions: Array.from(uniqueValues.regions),
          clusters: Array.from(uniqueValues.clusters),
          nodeTypes: Array.from(uniqueValues.nodeTypes),
          statuses: Array.from(uniqueValues.statuses),
        },
        maxValues,
      };
    }

    const getData = (filterFlag: boolean = false) => {
      loading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: t("settings.nodesPage.loadingData"),
              timeout: 0,
});

      CommonService.list_nodes(store.state.selectedOrganization.identifier)
        .then((response) => {
          const responseData = response.data;
          const { flattenedData, uniqueValues, maxValues } =
            flattenObject(responseData);
          regionRows.value = uniqueValues.regions.map((name) => ({ name }));
          clusterRows.value = uniqueValues.clusters.map((name) => ({ name }));
          nodetypeRows.value = uniqueValues.nodeTypes.map((name) => ({ name }));
          statusesRows.value = uniqueValues.statuses.map((name) => ({ name }));
          tabledata.value = flattenedData;
          originalData.value = flattenedData;
          resultTotal.value = flattenedData.length;
          loading.value = false;
          maxCPUUsage.value = cpuUsage.value.max = maxValues.cpuUsage.value;
          maxMemoryUsage.value = memoryUsage.value.max =
            maxValues.percentageMemoryUsage.value;
          maxEstablished.value = establishedUsage.value.max =
            maxValues.tcpConnsEstablished.value;
          maxClosewait.value = closewaitUsage.value.max =
            maxValues.tcpConnsCloseWait.value;
          maxWaittime.value = waittimeUsage.value.max =
            maxValues.tcpConnsTimeWait.value;
          if (filterFlag) {
            applyFilter();
          }
          dismiss();
        })
        .catch((error) => {
          loading.value = false;
          dismiss();
          if (error.status != 403) {
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                t("settings.nodesPage.fetchFailed"),
              timeout: 5000,
            });
          }
        });
    };

    if (isMetaOrg.value) {
      getData(false);
    }

    const applyFilter = () => {
      let terms = filterQuery.value.toLowerCase();
      const data = originalData.value.filter((row: any) => {
        const matchesSearch = row.name.toLowerCase().includes(terms);
        const matchesRegion =
          selectedRegions.value.length === 0 ||
          selectedRegions.value.some(
            (region: any) => region.name === row.region,
          );
        const matchesCluster =
          selectedClusters.value.length === 0 ||
          selectedClusters.value.some(
            (cluster: any) => cluster.name === row.cluster,
          );
        const matchesNodeType =
          selectedNodetypes.value.length === 0 ||
          row.role.some((r: any) =>
            selectedNodetypes.value.some((nt: any) => nt.name === r),
          );
        const matchesStatus =
          selectedStatuses.value.length === 0 ||
          selectedStatuses.value.some(
            (status: any) => status.name === row.status,
          );
        const matchesCPU =
          row.cpu_usage >= cpuUsage.value.min &&
          row.cpu_usage <= cpuUsage.value.max;
        const matchesMemory =
          row.percentage_memory_usage >= memoryUsage.value.min &&
          row.percentage_memory_usage <= memoryUsage.value.max;
        const matchesEstablished =
          row.tcp_conns_established >= establishedUsage.value.min &&
          row.tcp_conns_established <= establishedUsage.value.max;
        const matchesCloseWait =
          row.tcp_conns_close_wait >= closewaitUsage.value.min &&
          row.tcp_conns_close_wait <= closewaitUsage.value.max;
        const matchesWaitTime =
          row.tcp_conns_time_wait >= waittimeUsage.value.min &&
          row.tcp_conns_time_wait <= waittimeUsage.value.max;
        return (
          matchesSearch &&
          matchesRegion &&
          matchesCluster &&
          matchesNodeType &&
          matchesStatus &&
          matchesCPU &&
          matchesMemory &&
          matchesEstablished &&
          matchesCloseWait &&
          matchesWaitTime
        );
      });

      tabledata.value = data;
      resultTotal.value = data.length;
    };

    const clearAll = () => {
      filterQuery.value = "";
      selectedRegions.value = [];
      selectedClusters.value = [];
      selectedNodetypes.value = [];
      selectedStatuses.value = [];
      cpuUsage.value = { min: 0, max: maxCPUUsage.value };
      memoryUsage.value = { min: 0, max: maxMemoryUsage.value };
      establishedUsage.value = { min: 0, max: maxEstablished.value };
      closewaitUsage.value = { min: 0, max: maxClosewait.value };
      waittimeUsage.value = { min: 0, max: maxWaittime.value };
      tabledata.value = originalData.value;
      resultTotal.value = originalData.value.length;
    };

    const filterApplied = computed(() => {
      return (
        selectedRegions.value.length > 0 ||
        selectedClusters.value.length > 0 ||
        selectedNodetypes.value.length > 0 ||
        selectedStatuses.value.length > 0
      );
    });

    // Pre-filter for main table
    const filterData = (rows: any, terms: string) => {
      const filtered = [];
      terms = terms.toLowerCase();
      for (let i = 0; i < rows.length; i++) {
        if (
          rows[i]["name"].toLowerCase().includes(terms) ||
          rows[i]["version"].toLowerCase().includes(terms)
        ) {
          filtered.push(rows[i]);
        }
      }
      return filtered;
    };

    const visibleRows = computed(() => {
      if (!filterQuery.value) return tabledata.value || [];
      return filterData(tabledata.value || [], filterQuery.value);
    });

    // Pre-filter for sidebar region table
    const filterRegionQuery = ref("");
    const filterRegionData = (rows: string | any[], terms: string) => {
      const filtered = [];
      terms = terms.toLowerCase();
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]["name"].toLowerCase().includes(terms)) {
          filtered.push(rows[i]);
        }
      }
      return filtered;
    };
    const visibleRegionRows = computed(() => {
      if (!filterRegionQuery.value) return regionRows.value || [];
      return filterRegionData(regionRows.value || [], filterRegionQuery.value);
    });

    // Pre-filter for sidebar cluster table
    const filterClusterQuery = ref("");
    const filterClusterData = (rows: string | any[], terms: string) => {
      const filtered = [];
      terms = terms.toLowerCase();
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]["name"].toLowerCase().includes(terms)) {
          filtered.push(rows[i]);
        }
      }
      return filtered;
    };
    const visibleClusterRows = computed(() => {
      if (!filterClusterQuery.value) return clusterRows.value || [];
      return filterClusterData(
        clusterRows.value || [],
        filterClusterQuery.value,
      );
    });

    useShortcuts([
      { id: "nodesRefresh", handler: () => { if (!isInputFocused()) getData(true); } },
    ]);

    return {
      t,
      store,
      router,
      loading,
      tabledata,
      computedOTableColumns,
      splitterModel,
      getData,
      resultTotal,
      cpuUsage,
      memoryUsage,
      regionRows,
      clusterRows,
      nodetypeRows,
      statusesRows,
      selectedRegions,
      selectedClusters,
      selectedNodetypes,
      selectedStatuses,
      selectedRegionIds,
      selectedClusterIds,
      selectedNodetypeIds,
      selectedStatusIds,
      handleSelectedRegionIdsUpdate,
      handleSelectedClusterIdsUpdate,
      handleSelectedNodetypeIdsUpdate,
      handleSelectedStatusIdsUpdate,
      establishedToggle,
      filterApplied,
      closewaitToggle,
      waittimeToggle,
      establishedUsage,
      closewaitUsage,
      waittimeUsage,
      maxCPUUsage,
      maxMemoryUsage,
      maxEstablished,
      maxClosewait,
      maxWaittime,
      applyFilter,
      clearAll,
      filterOTableColumns,
      filterQuery,
      filterData,
      visibleRows,
      filterRegionQuery,
      filterRegionData,
      visibleRegionRows,
      filterClusterQuery,
      filterClusterData,
      visibleClusterRows,
      flattenObject,
      sectionOpen,
    };
  },
});
</script>

<style scoped>
/* keep(generated-content): status stripe on OTable rows (row-class-driven ::before,
   rendered inside the child OTable DOM — needs :deep) */
:deep(tr.status-row) > td:first-child {
  position: relative;
}
:deep(tr.status-row) > td:first-child::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0.3125rem;
}
:deep(tr.status-online) > td:first-child::before {
  background: var(--color-status-positive);
}
:deep(tr.status-offline) > td:first-child::before {
  background: var(--color-status-negative);
}
:deep(tr.status-prepare) > td:first-child::before {
  background: var(--color-status-warning-text);
}

/* Legacy span-based status indicator (slotted status filter list — parent-scoped) */
span.status-online {
  border-left: var(--color-status-positive) 0.3125rem solid !important;
}
span.status-offline {
  border-left: 0.3125rem solid var(--color-status-negative) !important;
}
span.status-prepare {
  border-left: 0.3125rem solid var(--color-status-warning-text) !important;
}
</style>
