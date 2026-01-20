<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page>
    <q-splitter
      v-model="splitterModel"
      :limits="[0, 250]"
      unit="px"
      style="overflow: hidden; height: calc(100vh - 40px);"
    >
      <template v-slot:before>
        <div class=" q-pt-sm tw:mt-4"
        style="height: calc(100vh - 80px);"
        >
          <div class="sticky-header q-px-sm">
            <span class="q-ma-none q-pa-sm" style="font-size: 18px;">
              {{t("nodes.filter_header")}} <q-icon name="filter_list" />
              <div class="float-right"><a class="cursor-pointer text-caption tw:underline"
                :class="filterApplied ? 'text-primary' : ''"
                 @click="clearAll()">{{t("nodes.clear_all")}}</a></div>
            </span>
          </div>

          <div class="tw:h-[calc(100vh-110px)] tw:overflow-y-auto">
            <q-list>
              <q-expansion-item
                v-if="regionRows.length > 0 && store.state.zoConfig.super_cluster_enabled"
                expand-separator
                :label="t('nodes.region')"
                class="text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <q-table 
                      data-test="nodes-region-table" 
                      :visible-columns="['name']"
                      :rows="regionRows" 
                      :row-key="(row: any) => 'node_region_' + row.name"
                      :columns="filterColumns" 
                      :rows-per-page-options="[0]" 
                      hide-header
                      hide-bottom 
                      dense
                      selection="multiple"
                      v-model:selected="selectedRegions" 
                      id="nodesRegionFilter"
                      class="q-pa-none q-ma-none node-list-filter-table"
                      :filter="filterRegionQuery"
                      :filter-method="filterRegionData"
                    >
                      <template v-slot:header-selection="scope">
                        <q-checkbox v-model="scope.selected" size="xs" />
                      </template>

                      <template v-slot:body-selection="scope">
                        <q-checkbox 
                          :model-value="scope.selected" 
                          size="xs" 
                          @update:model-value="(val, evt) => { 
                            if (Object.hasOwn(scope, 'selected')) {
                              Object.getOwnPropertyDescriptor(scope, 'selected')?.set?.(val);
                            }
                          }" 
                        />
                      </template>
                      <template #top-right>
                        <q-input
                          data-test="nodes-region-filter-search-input"
                          v-model="filterRegionQuery"
                          filled
                          borderless
                          dense
                          clearable
                          debounce="1"
                          :placeholder="t('nodes.searchRegion')"
                          class="full-width q-pa-none q-ma-none filter-input"
                        >
                          <template #prepend>
                            <q-icon name="search" />
                          </template>
                        </q-input>
                      </template>
                      <template v-slot:no-data>
                        <div class="full-width text-center q-pa-md">
                          <q-icon name="warning" color="grey" size="md" />
                          <span class="q-ml-sm">No data available</span>
                        </div>
                      </template>
                    </q-table>
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                v-if="clusterRows.length > 0 && store.state.zoConfig.super_cluster_enabled"
                expand-separator
                :label="t('nodes.cluster')"
                class="q-mt-sm text-subtitle1 nodes-filter-list"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <q-table 
                      data-test="nodes-cluster-table" 
                      :visible-columns="['name']"
                      :rows="clusterRows" 
                      :row-key="(row: any) => 'node_cluster_' + row.name"
                      :columns="filterColumns" 
                      :rows-per-page-options="[0]" 
                      hide-header
                      hide-bottom 
                      dense
                      selection="multiple"
                      v-model:selected="selectedClusters" 
                      id="nodesClusterFilter"
                      class="q-pa-none q-ma-none node-list-filter-table"
                      :filter="filterClusterQuery"
                      :filter-method="filterClusterData"
                    >
                      <template v-slot:header-selection="scope">
                        <q-checkbox v-model="scope.selected" size="xs" />
                      </template>

                      <template v-slot:body-selection="scope">
                        <q-checkbox :model-value="scope.selected" size="xs" @update:model-value="(val, evt) => { 
                            if (Object.hasOwn(scope, 'selected')) {
                              Object.getOwnPropertyDescriptor(scope, 'selected')?.set?.(val);
                            }
                          }"  />
                      </template>
                      <template #top-right>
                        <q-input
                          data-test="nodes-cluster-filter-search-input"
                          v-model="filterClusterQuery"
                          filled
                          borderless
                          dense
                          clearable
                          debounce="1"
                          :placeholder="t('nodes.searchCluster')"
                          class="full-width q-pa-none q-ma-none filter-input"
                        >
                          <template #prepend>
                            <q-icon name="search" />
                          </template>
                        </q-input>
                      </template>
                      <template v-slot:no-data>
                        <div class="full-width text-center q-pa-md">
                          <q-icon name="warning" color="grey" size="md" />
                          <span class="q-ml-sm">No data available</span>
                        </div>
                      </template>
                    </q-table>
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
                    <q-table 
                      data-test="nodes-nodetype-table" 
                      :visible-columns="['name']"
                      :rows="nodetypeRows" 
                      :row-key="(row: any) => 'node_nodetype_' + row.name"
                      :columns="filterColumns" 
                      :rows-per-page-options="[0]" 
                      hide-header
                      hide-bottom 
                      dense
                      selection="multiple"
                      v-model:selected="selectedNodetypes" 
                      id="nodesNodetypeFilter"
                      class="q-pa-none q-ma-none node-list-filter-table"
                    >
                      <template v-slot:header-selection="scope">
                        <q-checkbox v-model="scope.selected" size="xs" />
                      </template>

                      <template v-slot:body-selection="scope">
                        <q-checkbox :model-value="scope.selected" size="xs" @update:model-value="(val, evt) => { 
                            if (Object.hasOwn(scope, 'selected')) {
                              Object.getOwnPropertyDescriptor(scope, 'selected')?.set?.(val);
                            }
                          }"  />
                      </template>
                    </q-table>
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
                    <q-table 
                      data-test="nodes-status-table" 
                      :visible-columns="['name']"
                      :rows="statusesRows" 
                      :row-key="(row: any) => 'node_status_' + row.name"
                      :columns="filterColumns" 
                      :rows-per-page-options="[0]" 
                      hide-header
                      hide-bottom 
                      dense
                      selection="multiple"
                      v-model:selected="selectedStatuses" 
                      id="nodesStatusFilter"
                      class="q-pa-none q-ma-none node-list-filter-table"
                      :style="hasVisibleRows
                        ? 'width: 100%; height: calc(100vh - 115px); overflow-y: auto;' 
                        : 'width: 100%'"
                    >
                      <template v-slot:header-selection="scope">
                        <q-checkbox v-model="scope.selected" size="xs" />
                      </template>

                      <template v-slot:body-selection="scope">
                        <q-checkbox :model-value="scope.selected" size="xs" @update:model-value="(val, evt) => { 
                            if (Object.hasOwn(scope, 'selected')) {
                              Object.getOwnPropertyDescriptor(scope, 'selected')?.set?.(val);
                            }
                          }"  />
                      </template>
                      <template v-slot:body-cell-name="props">
                      <q-td
                        :props="props"
                      >
                        <span :class="`status-${props.row.name.toLowerCase()}`" class="q-mr-xs"></span>{{ props.row.name }}
                      </q-td>
                    </template>
                    </q-table>
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
                      <q-input data-test="nodes-filter-cpuusage-min" type="number" dense class="tw:w-[35%]" min="0" max="100" v-model="cpuUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input data-test="nodes-filter-cpuusage-max" type="number" dense class="tw:w-[35%]" min="0" max="100" v-model="cpuUsage.max" />
                    </div>
                    <q-range
                       data-test="nodes-filter-cpuusage-range-slider"
                      :model-value="cpuUsage"
                      @change="val => { cpuUsage = val }"
                      :min="0"
                      :max="maxCPUUsage"
                      label-side
                      size="25px"
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
                      <q-input data-test="nodes-filter-memoryusage-min" type="number" dense class="tw:w-[35%]" min="0" max="100" v-model="memoryUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input data-test="nodes-filter-memoryusage-max" type="number" dense class="tw:w-[35%]" min="0" max="100" v-model="memoryUsage.max" />
                    </div>
                    <q-range
                       data-test="nodes-filter-memoryusage-range-slider"
                      :model-value="memoryUsage"
                      @change="val => { memoryUsage = val }"
                      :min="0"
                      :max="maxMemoryUsage"
                      label-side
                      size="25px"
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
                    <q-checkbox type="checkbox" size="xs" v-model="establishedToggle" :label="t('nodes.establishedLabel')" />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <q-input :disable="!establishedToggle" data-test="nodes-filter-established-min" type="number" dense class="tw:w-[35%]" min="0" :max="maxEstablished" v-model="establishedUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input :disable="!establishedToggle" data-test="nodes-filter-established-max" type="number" dense class="tw:w-[35%]" min="0" :max="maxEstablished" v-model="establishedUsage.max" />
                    </div>
                    <q-range
                      :disable="!establishedToggle"
                       data-test="nodes-filter-tcp-established-range-slider"
                      :model-value="establishedUsage"
                      @change="val => { establishedUsage = val }"
                      :min="0"
                      :max="maxEstablished"
                      label-side
                      size="25px"
                      class="tw:w-[85%] q-mt-md q-ml-md"
                    />

                    <q-checkbox type="checkbox" class="q-mt-sm" size="xs" v-model="closewaitToggle" :label="t('nodes.closewaitLabel')" />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <q-input :disable="!closewaitToggle" data-test="nodes-filter-closewait-min" type="number" dense class="tw:w-[35%]" min="0" :max="maxClosewait" v-model="closewaitUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input :disable="!closewaitToggle" data-test="nodes-filter-closewait-max" type="number" dense class="tw:w-[35%]" min="0" :max="maxClosewait" v-model="closewaitUsage.max" />
                    </div>
                    <q-range
                      :disable="!closewaitToggle"
                       data-test="nodes-filter-tcp-closewait-range-slider"
                      :model-value="closewaitUsage"
                      @change="val => { closewaitUsage = val }"
                      :min="0"
                      :max="maxClosewait"
                      label-side
                      size="25px"
                      class="tw:w-[85%] q-mt-md q-ml-md"
                    />

                    <q-checkbox type="checkbox" class="q-mt-sm" size="xs" v-model="waittimeToggle" :label="t('nodes.waittimeLabel')" />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <q-input :disable="!waittimeToggle" data-test="nodes-filter-waittime-min" type="number" dense class="tw:w-[35%]" min="0" :max="maxWaittime" v-model="waittimeUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input :disable="!waittimeToggle" data-test="nodes-filter-waittime-max" type="number" dense class="tw:w-[35%]" min="0" :max="maxWaittime" v-model="waittimeUsage.max" />
                    </div>
                    <q-range
                      :disable="!waittimeToggle"
                       data-test="nodes-filter-tcp-waittime-range-slider"
                      :model-value="waittimeUsage"
                      @change="val => { waittimeUsage = val }"
                      :min="0"
                      :max="maxWaittime"
                      label-side
                      size="25px"
                      class="tw:w-[85%] q-mt-md q-ml-md"
                    />
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-btn 
                :label="t('nodes.applyFilter')" 
                class="float-right q-mr-sm q-mb-sm text-bold text-capitalize q-mt-sm o2-primary-button tw:h-[36px]" 
                flat
                @click="applyFilter()"
              >
              </q-btn>

            </q-list>
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
        <q-input
              v-model="filterQuery"
              dense
              class="q-ml-none q-mb-xs q-mr-sm o2-search-input"
              borderless
              style="width: 400px;"
              :placeholder="t('nodes.search')"
            >
              <template #prepend>
                <q-icon name="search" class="o2-search-input-icon" />
              </template>
            </q-input>
            <q-btn
              :label="t('common.refresh')"
              class="o2-secondary-button tw:h-[36px]"
              no-caps
              flat
              @click="getData(true)">
            </q-btn>
          </div>
           
        </div>
        <q-table
          ref="qTable"
          :rows="tabledata"
          :columns="computedColumns"
          :row-key="(row: any) => 'node_data_row_key_' + row.name"
          :pagination="pagination"
          :filter="filterQuery"
          :filter-method="filterData"
          :loading="loading"
          class="nodes-list-table tw:border-l tw:border-solid tw:border-gray-1200 tw:rounded-none"
          dense
          style="width: 100%; height: calc(100vh - 104px); overflow-y: auto;"
          hide-top
        >
          <template #no-data><NoData /></template>

          <template v-slot:body-cell-id="props">
            <q-td :props="props"
             :class="`status-${props.row.status.toLowerCase()}`"
            >
            {{ props.row.id }}
            </q-td>
          </template>

          <template v-slot:body-cell-name="props">
            <q-td
              :props="props"
            >
              {{ props.row.name.length > 40 ? props.row.name.substring(0, 40) + "..." : props.row.name }}
              <q-tooltip>{{props.row.name}}</q-tooltip>
            </q-td>
          </template>

          <template v-if="store.state.zoConfig.super_cluster_enabled" v-slot:body-cell-region="props">
            <q-td :props="props">
              <q-badge class="badge-region q-mr-xs">{{ props.row.region }}
                <q-tooltip>{{t("nodes.region")}}</q-tooltip>
              </q-badge>
              <q-badge class="badge-cluster">{{ props.row.cluster }}
                <q-tooltip>{{t("nodes.cluster")}}</q-tooltip>
              </q-badge>
            </q-td>
          </template>
          <template v-slot:body-cell-tcp="props">
            <q-td :props="props" class="tcp-cell">
              {{ props.row.tcp_conns }} (E:{{
                props.row.tcp_conns_established
              }}, C:{{ props.row.tcp_conns_close_wait }}, T:{{
                props.row.tcp_conns_time_wait
              }})
            </q-td>
          </template>

          <template v-slot:body-cell-cpu="props">
            <q-td :props="props">
              <q-linear-progress
                dark
                size="10px"
                class="progresbar tw:w-[80%] inline-block"
                rounded
                :value="props.row.cpu_usage / 100"
                :color="props.row.cpu_usage > 85 ? 'red-9' : 'primary'"
              />
              {{ props.row.cpu_usage }}%
            </q-td>
          </template>

          <template v-slot:body-cell-memory="props">
            <q-td :props="props">
              <q-linear-progress
                dark
                size="10px"
                class="progresbar tw:w-[80%] inline-block"
                rounded
                :value="props.row.percentage_memory_usage / 100"
                :color="props.row.percentage_memory_usage > 85 ? 'red-9' : 'primary'"
              />
              {{ props.row.percentage_memory_usage }}%
            </q-td>
          </template>

          <template #bottom="scope">
            <QTablePagination
              v-if="resultTotal > 0"
              :scope="scope"
              :resultTotal="resultTotal"
              :perPageOptions="perPageOptions"
              position="bottom"
              @update:changeRecordPerPage="changePagination"
            />
          </template>
        </q-table>
      </template>
    </q-splitter>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUpdated, watch, Ref, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, date, copyToClipboard, QTableProps } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "@/components/shared/grid/Pagination.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import CommonService from "@/services/common";
import useIsMetaOrg from "@/composables/useIsMetaOrg";

export default defineComponent({
  name: "PageCipherKeys",
  components: {
    QTablePagination,
    NoData,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const tabledata: any = ref([]);
    const originalData: any = ref([]);
    const qTable: any = ref(null);
    const loading = ref(false);
    const splitterModel = ref(250);
    const filterQuery = ref("");
    const computedColumns = computed(() => {
      const columns =  [
        {
          name: "id",
          field: "id",
          label: "#",
          align: "center",
          sortable: false,
        },
        {
          name: "name",
          field: "name",
          label: t("nodes.name"),
          align: "left",
          sortable: true,
      },
      {
        name: "region",
        field: "region",
        label: t("nodes.region"),
        align: "left",
        style: "width: 50px",
      },
      {
        name: "version",
        field: "version",
        label: t("nodes.version"),
        align: "center",
        sortable: true,
        style: "width: 100px;",
      },
      {
        name: "cpu",
        field: "cpu_usage",
        label: t("nodes.cpu"),
        align: "left",
        sortable: true,
        style: "width: 200px;",
      },
      {
        name: "memory",
        field: "percentage_memory_usage",
        label: t("nodes.memory"),
        align: "left",
        sortable: false,
        style: "width: 200px;",
      },
      {
        name: "tcp",
        field: "tcp_conns",
        label: t("nodes.tcp"),
        align: "left",
        sortable: false,
        style: "width: 150px;",
      },
    ];
      if(!store.state.zoConfig.super_cluster_enabled) {
        columns.splice(2, 1);
      }
      return columns;
    });
    const perPageOptions = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];
    const resultTotal = ref<number>(0);
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });
    const regionRows: any = ref([]);
    const selectedRegions: any = ref([]);

    const clusterRows: any = ref([]);
    const selectedClusters: any = ref([]);

    const nodetypeRows: any = ref([]);
    const selectedNodetypes: any = ref([]);

    const statusesRows: any = ref([]);
    const selectedStatuses: any = ref([]);

    const cpuUsage = ref({
      min: 0,
      max: 100
    });

    const memoryUsage = ref({
      min: 0,
      max: 100
    });

    const establishedToggle = ref(true);
    const closewaitToggle = ref(true);
    const waittimeToggle = ref(true);

    const establishedUsage = ref({
      min: 0,
      max: 60
    });

    const maxEstablished = ref(60);
    const maxClosewait = ref(60);
    const maxWaittime = ref(60);
    const maxCPUUsage = ref(100);
    const maxMemoryUsage = ref(100);
    const { isMetaOrg } = useIsMetaOrg();

    const closewaitUsage = ref({
      min: 0,
      max: 60
    });

    const waittimeUsage = ref({
      min: 0,
      max: 60
    });
    
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };

    function flattenObject(data: any) {
        const result: any = [];
        const uniqueValues = {
            regions: new Set(),
            clusters: new Set(),
            nodeTypes: new Set(),
            statuses: new Set()
        };

        const maxValues = {
            tcpConnsEstablished: { value: 0 },
            tcpConnsCloseWait: { value: 0 },
            tcpConnsTimeWait: { value: 0 },
            percentageMemoryUsage: { value: 0 },
            cpuUsage: { value: 0 }
        };
        //gloabal index is used to assign the id to the node
        //the global index should continue from the last id of the previous node and previous cluster
        let globalIndex = 1;

        for (const region in data) {
            uniqueValues.regions.add(region);

            for (const cluster in data[region]) {
                uniqueValues.clusters.add(cluster);

                data[region][cluster].forEach((node: any) => {
                    // Calculate memory usage percentage
                    const percentageMemoryUsage = (node.metrics.memory_usage > 0)
                        ? Math.round((node.metrics.memory_usage / node.metrics.memory_total) * 100)
                        : 0;

                    // Round CPU usage
                    const cpuUsage = Math.round(node.metrics.cpu_usage);

                    // Extract unique node types from role array
                    node.role.forEach((r: any) => uniqueValues.nodeTypes.add(r));

                    // Extract unique statuses
                    uniqueValues.statuses.add(node.status);

                    // Update max values
                    maxValues.tcpConnsEstablished.value = Math.max(maxValues.tcpConnsEstablished.value, node.metrics.tcp_conns_established);
                    maxValues.tcpConnsCloseWait.value = Math.max(maxValues.tcpConnsCloseWait.value, node.metrics.tcp_conns_close_wait);
                    maxValues.tcpConnsTimeWait.value = Math.max(maxValues.tcpConnsTimeWait.value, node.metrics.tcp_conns_time_wait);
                    maxValues.percentageMemoryUsage.value = Math.max(maxValues.percentageMemoryUsage.value, percentageMemoryUsage);
                    maxValues.cpuUsage.value = Math.max(maxValues.cpuUsage.value, cpuUsage);
                    //this is done because the id should be 2 digits to maintain consistency with other tables
                    node.id = globalIndex < 10 ? `0${globalIndex}` : globalIndex;
                    //increment the global index
                    globalIndex++;

                    result.push({
                        region,
                        cluster,
                        status: node.status,
                        role: node.role,
                        ...node,
                        ...node.metrics,
                        percentage_memory_usage: percentageMemoryUsage,
                        cpu_usage: cpuUsage
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
                statuses: Array.from(uniqueValues.statuses)
            },
            maxValues
        };
    }


    const getData = (filterFlag: boolean = false) => {
      loading.value = true;
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading data...",
      });

      CommonService.list_nodes(store.state.selectedOrganization.identifier)
        .then((response) => {
          const responseData = response.data;
          const { flattenedData, uniqueValues, maxValues } = flattenObject(responseData);          
          regionRows.value = uniqueValues.regions.map(name => ({ name }))
          clusterRows.value = uniqueValues.clusters.map(name => ({ name }))
          nodetypeRows.value = uniqueValues.nodeTypes.map(name => ({ name }))
          statusesRows.value = uniqueValues.statuses.map(name => ({ name }))
          tabledata.value = flattenedData;
          originalData.value = flattenedData;
          resultTotal.value = flattenedData.length;
          loading.value = false;
          maxCPUUsage.value = cpuUsage.value.max = maxValues.cpuUsage.value;
          maxMemoryUsage.value = memoryUsage.value.max = maxValues.percentageMemoryUsage.value;
          maxEstablished.value = establishedUsage.value.max = maxValues.tcpConnsEstablished.value;
          maxClosewait.value = closewaitUsage.value.max = maxValues.tcpConnsCloseWait.value;
          maxWaittime.value = waittimeUsage.value.max = maxValues.tcpConnsTimeWait.value;
          if(filterFlag) {
            applyFilter();
          }
          dismiss();
        })
        .catch((error) => {
          loading.value = false;
          dismiss();
          if (error.status != 403) {
            $q.notify({
              type: "negative",
              message:
                error.response?.data?.message ||
                "Failed to fetch nodes. Please try again.",
              timeout: 5000,
            });
          }
        });
    };
    //only call getData if the org is meta org otherwise we can ignore as the api is only allowed for meta org
    if(isMetaOrg.value){
      getData(false);
    }
    const applyFilter = () => {
      let terms = filterQuery.value.toLowerCase();
      const data = originalData.value.filter((row: any) => {
          const matchesSearch = row.name.toLowerCase().includes(terms);
          const matchesRegion = selectedRegions.value.length === 0 || selectedRegions.value.some((region: any) => region.name === row.region);
          const matchesCluster = selectedClusters.value.length === 0 || selectedClusters.value.some((cluster: any) => cluster.name === row.cluster);
          const matchesNodeType = selectedNodetypes.value.length === 0 || row.role.some((r: any) => selectedNodetypes.value.some((nt: any) => nt.name === r));
          const matchesStatus = selectedStatuses.value.length === 0 || selectedStatuses.value.some((status: any) => status.name === row.status);
          const matchesCPU = row.cpu_usage >= cpuUsage.value.min && row.cpu_usage <= cpuUsage.value.max;
          const matchesMemory = row.percentage_memory_usage >= memoryUsage.value.min && row.percentage_memory_usage <= memoryUsage.value.max;
          const matchesEstablished = row.tcp_conns_established >= establishedUsage.value.min && row.tcp_conns_established <= establishedUsage.value.max;
          const matchesCloseWait = row.tcp_conns_close_wait >= closewaitUsage.value.min && row.tcp_conns_close_wait <= closewaitUsage.value.max;
          const matchesWaitTime = row.tcp_conns_time_wait >= waittimeUsage.value.min && row.tcp_conns_time_wait <= waittimeUsage.value.max;
          return matchesSearch && matchesRegion && matchesCluster && matchesNodeType && matchesStatus && matchesCPU && matchesMemory && matchesEstablished && matchesCloseWait && matchesWaitTime;
      });

      tabledata.value = data;
      resultTotal.value = data.length;
    }

    const clearAll = () => {
      filterQuery.value = "";
      selectedRegions.value = [];
      selectedClusters.value = [];
      selectedNodetypes.value = [];
      selectedStatuses.value = [];
      cpuUsage.value = {min: 0, max: maxCPUUsage.value};
      memoryUsage.value = {min: 0, max: maxMemoryUsage.value};
      establishedUsage.value = {min: 0, max: maxEstablished.value};
      closewaitUsage.value = {min: 0, max: maxClosewait.value};
      waittimeUsage.value = {min: 0, max: maxWaittime.value};
      tabledata.value = originalData.value;
      resultTotal.value = originalData.value.length;
    }
    const filterApplied = computed(()=>{
      return selectedRegions.value.length > 0 || selectedClusters.value.length > 0 || selectedNodetypes.value.length > 0 || selectedStatuses.value.length > 0;
    })

    return {
      t,
      store,
      router,
      qTable,
      loading,
      tabledata,
      computedColumns,
      splitterModel,
      getData,
      pagination,
      resultTotal,
      perPageOptions,
      selectedPerPage,
      changePagination,
      maxRecordToReturn,
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
      filterColumns: [{ name: "name", label: "Name", field: "name", align: "left" }],
      filterQuery,
      filterData(rows: any, terms: string) {
        const filtered = [];
        terms = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms) || rows[i]["version"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      filterRegionQuery: ref(""),
      filterRegionData(rows: string | any[], terms: string) {
        const filtered = [];
        terms = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      filterClusterQuery: ref(""),
      filterClusterData(rows: string | any[], terms: string) {
        const filtered = [];
        terms = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
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
  border-left: #00A76F 5px solid  !important;
}

.status-offline {
  border-left: 5px solid #CE2528 !important;
}

.status-prepare {
  border-left: 5px solid #FFAB00  !important;
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
