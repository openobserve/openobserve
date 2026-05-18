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
  <div class="tw:rounded-md">
    <q-splitter
      v-model="splitterModel"
      :limits="[0, 250]"
      unit="px"
      style="overflow: hidden; height: calc(100vh - 40px)"
    >
      <template v-slot:before>
        <div class="q-pt-sm tw:mt-4" style="height: calc(100vh - 80px)">
          <div class="sticky-header q-px-sm">
            <span class="q-ma-none q-pa-sm" style="font-size: 18px">
              {{ t("nodes.filter_header") }} <OIcon name="filter-list" size="sm" />
              <div class="float-right">
                <a
                  class="cursor-pointer text-caption tw:underline"
                  :class="filterApplied ? 'text-primary' : ''"
                  @click="clearAll()"
                  >{{ t("nodes.clear_all") }}</a
                >
              </div>
            </span>
          </div>

          <div class="tw:flex tw:flex-col tw:h-[calc(100vh-110px)]">
            <div class="tw:flex-1 tw:overflow-y-auto">
            <q-list>
              <q-expansion-item
                v-if="
                  regionRows.length > 0 &&
                  store.state.zoConfig.super_cluster_enabled
                "
                expand-separator
                :label="t('nodes.region')"
                class="text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <div class="q-pa-none q-ma-none">
                      <OInput
                        data-test="nodes-region-filter-search-input"
                        v-model="filterRegionQuery"
                        clearable
                        debounce="1"
                        :placeholder="t('nodes.searchRegion')"
                        class="full-width filter-input"
                      >
                        <template #prepend>
                          <OIcon name="search" size="sm" />
                        </template>
                      </OInput>
                    </div>
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
                        <div class="full-width text-center q-pa-md">
                          <OIcon name="warning" size="md" />
                          <span class="q-ml-sm">No data available</span>
                        </div>
                      </template>
                    </OTable>
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                v-if="
                  clusterRows.length > 0 &&
                  store.state.zoConfig.super_cluster_enabled
                "
                expand-separator
                :label="t('nodes.cluster')"
                class="q-mt-sm text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <div class="q-pa-none q-ma-none">
                      <OInput
                        data-test="nodes-cluster-filter-search-input"
                        v-model="filterClusterQuery"
                        clearable
                        debounce="1"
                        :placeholder="t('nodes.searchCluster')"
                        class="full-width filter-input"
                      >
                        <template #prepend>
                          <OIcon name="search" size="sm" />
                        </template>
                      </OInput>
                    </div>
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
                        <div class="full-width text-center q-pa-md">
                          <OIcon name="warning" size="md" />
                          <span class="q-ml-sm">No data available</span>
                        </div>
                      </template>
                    </OTable>
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                v-if="nodetypeRows.length > 0"
                expand-separator
                :label="t('nodes.nodetype')"
                class="q-mt-sm text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
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
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                v-if="statusesRows.length > 0"
                expand-separator
                :label="t('nodes.status')"
                class="q-mt-sm text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
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
                          class="q-mr-xs"
                        ></span>{{ row.name }}
                      </template>
                    </OTable>
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                expand-separator
                :label="t('nodes.cpuusage')"
                class="q-mt-sm text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <OInput
                        data-test="nodes-filter-cpuusage-min"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        max="100"
                        v-model="cpuUsage.min"
                      />
                      <span class="q-px-sm">to</span>
                      <OInput
                        data-test="nodes-filter-cpuusage-max"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        max="100"
                        v-model="cpuUsage.max"
                      />
                    </div>
                    <ORange
                      data-test="nodes-filter-cpuusage-range-slider"
                      :model-value="cpuUsage"
                      @change="
                        (val) => {
                          cpuUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxCPUUsage"
                      class="tw:w-[85%] q-mt-md q-ml-md"
                    />
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                expand-separator
                :label="t('nodes.memoryusage')"
                class="q-mt-sm text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <OInput
                        data-test="nodes-filter-memoryusage-min"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        max="100"
                        v-model="memoryUsage.min"
                      />
                      <span class="q-px-sm">to</span>
                      <OInput
                        data-test="nodes-filter-memoryusage-max"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        max="100"
                        v-model="memoryUsage.max"
                      />
                    </div>
                    <ORange
                      data-test="nodes-filter-memoryusage-range-slider"
                      :model-value="memoryUsage"
                      @change="
                        (val) => {
                          memoryUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxMemoryUsage"
                      class="tw:w-[85%] q-mt-md q-ml-md"
                    />
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                expand-separator
                :label="t('nodes.tcpusage')"
                class="q-mt-sm text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <OCheckbox
                      type="checkbox"
                      v-model="establishedToggle"
                      :label="t('nodes.establishedLabel')"
                    />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <OInput
                        :disable="!establishedToggle"
                        data-test="nodes-filter-established-min"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        :max="maxEstablished"
                        v-model="establishedUsage.min"
                      />
                      <span class="q-px-sm">to</span>
                      <OInput
                        :disable="!establishedToggle"
                        data-test="nodes-filter-established-max"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        :max="maxEstablished"
                        v-model="establishedUsage.max"
                      />
                    </div>
                    <ORange
                      :disabled="!establishedToggle"
                      data-test="nodes-filter-tcp-established-range-slider"
                      :model-value="establishedUsage"
                      @change="
                        (val) => {
                          establishedUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxEstablished"
                      class="tw:w-[85%] q-mt-md q-ml-md"
                    />

                    <OCheckbox
                      type="checkbox"
                      class="q-mt-sm"
                      v-model="closewaitToggle"
                      :label="t('nodes.closewaitLabel')"
                    />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <OInput
                        :disable="!closewaitToggle"
                        data-test="nodes-filter-closewait-min"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        :max="maxClosewait"
                        v-model="closewaitUsage.min"
                      />
                      <span class="q-px-sm">to</span>
                      <OInput
                        :disable="!closewaitToggle"
                        data-test="nodes-filter-closewait-max"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        :max="maxClosewait"
                        v-model="closewaitUsage.max"
                      />
                    </div>
                    <ORange
                      :disabled="!closewaitToggle"
                      data-test="nodes-filter-tcp-closewait-range-slider"
                      :model-value="closewaitUsage"
                      @change="
                        (val) => {
                          closewaitUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxClosewait"
                      class="tw:w-[85%] q-mt-md q-ml-md"
                    />

                    <OCheckbox
                      type="checkbox"
                      class="q-mt-sm"
                      v-model="waittimeToggle"
                      :label="t('nodes.waittimeLabel')"
                    />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <OInput
                        :disable="!waittimeToggle"
                        data-test="nodes-filter-waittime-min"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        :max="maxWaittime"
                        v-model="waittimeUsage.min"
                      />
                      <span class="q-px-sm">to</span>
                      <OInput
                        :disable="!waittimeToggle"
                        data-test="nodes-filter-waittime-max"
                        type="number"
                        class="tw:w-[35%]"
                        min="0"
                        :max="maxWaittime"
                        v-model="waittimeUsage.max"
                      />
                    </div>
                    <ORange
                      :disabled="!waittimeToggle"
                      data-test="nodes-filter-tcp-waittime-range-slider"
                      :model-value="waittimeUsage"
                      @change="
                        (val) => {
                          waittimeUsage = val;
                        }
                      "
                      :min="0"
                      :max="maxWaittime"
                      class="tw:w-[85%] q-mt-md q-ml-md"
                    />
                  </q-card-section>
                </q-card>
              </q-expansion-item>

            </q-list>
            </div>
            <div class="tw:flex tw:justify-end tw:px-2 tw:py-2 tw:shrink-0">
              <OButton
                variant="primary"
                size="sm-action"
                @click="applyFilter()"
              >
                {{ t("nodes.applyFilter") }}
              </OButton>
            </div>
          </div>
        </div>
      </template>
      <template v-slot:after>
        <div class="row full-width q-pt-sm flex items-center q-pl-md">
          <div
            class="col q-table__title items-start"
            data-test="cipher-keys-list-title"
          >
            {{ t("nodes.header") }}
          </div>
          <div class="tw:flex tw:h-[36px] tw:mb-2">
            <OInput
              v-model="filterQuery"
              class="q-ml-none q-mb-xs q-mr-sm o2-search-input"
              style="width: 400px"
              :placeholder="t('nodes.search')"
            >
              <template #prepend>
                <OIcon name="search" size="sm" class="o2-search-input-icon" />
              </template>
            </OInput>
            <OButton
              variant="outline"
              size="sm-action"
              @click="getData(true)"
            >
              {{ t("common.refresh") }}
            </OButton>
          </div>
        </div>
        <OTable
          ref="qTable"
          data-test="nodes-main-table"
          :data="visibleRows"
          :columns="computedOTableColumns"
          row-key="name"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          :show-global-filter="false"
          :loading="loading"
        >
          <template #empty><NoData /></template>

          <template #cell-id="{ row }">
            <span :class="`status-${row.status.toLowerCase()}`">
              {{ row.id }}
            </span>
          </template>

          <template #cell-name="{ row }">
            {{
              row.name.length > 40
                ? row.name.substring(0, 40) + "..."
                : row.name
            }}
            <OTooltip :content="row.name" />
          </template>

          <template
            v-if="store.state.zoConfig.super_cluster_enabled"
            #cell-region="{ row }"
          >
            <OBadge variant="default" class="badge-region q-mr-xs"
              >{{ row.region }}
              <OTooltip :content="t('nodes.region')" />
            </OBadge>
            <OBadge variant="default" class="badge-cluster"
              >{{ row.cluster }}
              <OTooltip :content="t('nodes.cluster')" />
            </OBadge>
          </template>

          <template #cell-tcp="{ row }">
            {{ row.tcp_conns }} (E:{{
              row.tcp_conns_established
            }}, C:{{ row.tcp_conns_close_wait }}, T:{{
              row.tcp_conns_time_wait
            }})
          </template>

          <template #cell-cpu="{ row }">
            <OProgressBar
              size="sm"
              class="progresbar tw:w-[80%]! tw:max-w-[80%] tw:inline-block"
              :value="row.cpu_usage / 100"
              :variant="row.cpu_usage > 85 ? 'danger' : 'default'"
            />
            {{ row.cpu_usage }}%
          </template>

          <template #cell-memory="{ row }">
            <OProgressBar
              size="sm"
              class="progresbar tw:w-[80%]! tw:max-w-[80%] tw:inline-block"
              :value="row.percentage_memory_usage / 100"
              :variant="row.percentage_memory_usage > 85 ? 'danger' : 'default'"
            />
            {{ row.percentage_memory_usage }}%
          </template>
        </OTable>
      </template>
    </q-splitter>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  watch,
  Ref,
  computed,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import NoData from "@/components/shared/grid/NoData.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ORange from "@/lib/forms/Range/ORange.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import CommonService from "@/services/common";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageCipherKeys",
  components: {
    NoData,
    OButton,
    OProgressBar,
    OInput,
    OCheckbox,
    OTooltip,
    ORange,
    OIcon,
    OBadge,
    OTable,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const tabledata: any = ref([]);
    const originalData: any = ref([]);
    const loading = ref(false);
    const splitterModel = ref(250);
    const filterQuery = ref("");

    const filterOTableColumns: OTableColumnDef[] = [
      { id: "name", header: "Name", accessorKey: "name", meta: { align: "left" } },
    ];

    const computedOTableColumns = computed(() => {
      const columns: OTableColumnDef[] = [
        { id: "id", header: "#", accessorKey: "id", meta: { align: "center" } },
        {
          id: "name",
          header: t("nodes.name"),
          accessorKey: "name",
          sortable: true,
          meta: { align: "left" },
        },
        {
          id: "region",
          header: t("nodes.region"),
          accessorKey: "region",
          size: 50,
          meta: { align: "left" },
        },
        {
          id: "version",
          header: t("nodes.version"),
          accessorKey: "version",
          sortable: true,
          size: 100,
          meta: { align: "center" },
        },
        {
          id: "cpu",
          header: t("nodes.cpu"),
          accessorKey: "cpu_usage",
          sortable: true,
          size: 200,
          meta: { align: "left" },
        },
        {
          id: "memory",
          header: t("nodes.memory"),
          accessorKey: "percentage_memory_usage",
          size: 200,
          meta: { align: "left" },
        },
        {
          id: "tcp",
          header: t("nodes.tcp"),
          accessorKey: "tcp_conns",
          size: 150,
          meta: { align: "left" },
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
      selectedClusters.value = ids.map((id: any) => map.get(id)).filter(Boolean);
    };
    const handleSelectedNodetypeIdsUpdate = (ids: string[]) => {
      const map = new Map(nodetypeRows.value.map((n: any) => [n.name, n]));
      selectedNodetypes.value = ids.map((id: any) => map.get(id)).filter(Boolean);
    };
    const handleSelectedStatusIdsUpdate = (ids: string[]) => {
      const map = new Map(statusesRows.value.map((s: any) => [s.name, s]));
      selectedStatuses.value = ids.map((id: any) => map.get(id)).filter(Boolean);
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
        message: "Please wait while loading data...",
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
                "Failed to fetch nodes. Please try again.",
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
      return filterClusterData(clusterRows.value || [], filterClusterQuery.value);
    });

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
    };
  },
});
</script>

<style lang="scss" scoped>
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}

.badge-region {
  background-color: #ede9fe;
  line-height: 23px;
  padding-left: 7px;
  padding-right: 7px;
  color: #6d28d9;
}

.badge-cluster {
  background-color: #fff2d4;
  line-height: 23px;
  padding-left: 7px;
  padding-right: 7px;
  color: #374151;
}

.progresbar {
  background-color: lightgrey;
}

.tcp-cell {
  letter-spacing: 1.5px;
}

.pagination-align {
  margin-top: -10px;
}

.nodes-list-table {
  tr th {
    background-color: light-grey !important;
  }
}

/* Ensure the container fills the height */
.full-height {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Sticky Header */
.sticky-header {
  position: sticky;
  top: 0;
}

/* Scrollable Content */
.content {
  flex-grow: 1;
  overflow-y: auto;
  padding: 10px;
}

/* Sticky Footer */
.sticky-footer {
  position: sticky;
  bottom: 0;
}
</style>

<style lang="scss">
.nodes-list-table .q-table tr th {
  background-color: #f2f2f2 !important;
  color: #000000;
}

.status-online {
  border-left: #00a76f 5px solid !important;
}

.status-offline {
  border-left: 5px solid #ce2528 !important;
}

.status-prepare {
  border-left: 5px solid #ffab00 !important;
}

.node-list-filter-table {
  max-height: 200px;
  overflow: auto;

  .q-table__top {
    padding: 0px !important;
  }

  .q-table__control {
    width: 100% !important;
  }

  td {
    padding: 0 0 0 7px !important;

    &::before {
      background: none !important;
    }
  }
}

.nodes-filter-list .q-item__label {
  font-weight: 500 !important;
}
.text-subtitle1 {
  font-size: 14px !important;
}
</style>
