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
  <q-page class="q-pa-none">
    <q-separator class="separator" />
    <q-splitter
      v-model="splitterModel"
      :limits="[0, 250]"
      unit="px"
      style="min-height: 90vh; overflow: hidden"
    >
      <template style="background-color: red" v-slot:before>
        <div class="full-height">
          <div class="sticky-header">
            <h6 class="q-ma-none q-pa-sm">
              {{t("nodes.filter_header")}} <q-icon name="filter_list" />
              <div class="float-right"><a class="cursor-pointer text-caption tw-underline">{{t("nodes.clear_all")}}</a></div>
            </h6>
            <q-separator />
          </div>
          <div class="content">
            <q-list>
              <q-expansion-item
                v-if="regionRows.length > 0"
                expand-separator
                :label="t('nodes.region')"
                class="text-subtitle1"
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
                        <q-checkbox v-model="scope.selected" size="xs" color="secondary" />
                      </template>

                      <template v-slot:body-selection="scope">
                        <q-checkbox 
                          :model-value="scope.selected" 
                          size="xs" 
                          color="secondary" 
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
                          :placeholder="t('search.searchField')"
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
                v-if="clusterRows.length > 0"
                expand-separator
                :label="t('nodes.cluster')"
                class="q-mt-sm text-subtitle1"
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
                        <q-checkbox v-model="scope.selected" size="xs" color="secondary" />
                      </template>

                      <template v-slot:body-selection="scope">
                        <q-checkbox :model-value="scope.selected" size="xs" color="secondary" @update:model-value="(val, evt) => { 
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
                          :placeholder="t('search.searchField')"
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
                class="q-mt-sm text-subtitle1"
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
                        <q-checkbox v-model="scope.selected" size="xs" color="secondary" />
                      </template>

                      <template v-slot:body-selection="scope">
                        <q-checkbox :model-value="scope.selected" size="xs" color="secondary" @update:model-value="(val, evt) => { 
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
                class="q-mt-sm text-subtitle1"
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
                    >
                      <template v-slot:header-selection="scope">
                        <q-checkbox v-model="scope.selected" size="xs" color="secondary" />
                      </template>

                      <template v-slot:body-selection="scope">
                        <q-checkbox :model-value="scope.selected" size="xs" color="secondary" @update:model-value="(val, evt) => { 
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
                class="q-mt-sm text-subtitle1"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <q-input data-test="nodes-filter-cpuusage-min" type="number" dense class="tw-w-[35%]" min="0" max="100" v-model="cpuUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input data-test="nodes-filter-cpuusage-max" type="number" dense class="tw-w-[35%]" min="0" max="100" v-model="cpuUsage.max" />
                    </div>
                    <q-range
                       data-test="nodes-filter-cpuusage-range-slider"
                      :model-value="cpuUsage"
                      @change="val => { cpuUsage = val }"
                      :min="0"
                      :max="100"
                      label-side
                      size="25px"
                      class="tw-w-[90%] q-mt-md q-ml-sm"
                    />
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                expand-separator
                :label="t('nodes.memoryusage')"
                class="q-mt-sm text-subtitle1"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <q-input data-test="nodes-filter-memoryusage-min" type="number" dense class="tw-w-[35%]" min="0" max="100" v-model="memoryUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input data-test="nodes-filter-memoryusage-max" type="number" dense class="tw-w-[35%]" min="0" max="100" v-model="memoryUsage.max" />
                    </div>
                    <q-range
                       data-test="nodes-filter-memoryusage-range-slider"
                      :model-value="memoryUsage"
                      @change="val => { memoryUsage = val }"
                      :min="0"
                      :max="100"
                      label-side
                      size="25px"
                      class="tw-w-[90%] q-mt-md q-ml-sm"
                    />
                  </q-card-section>
                </q-card>
              </q-expansion-item>

              <q-expansion-item
                expand-separator
                :label="t('nodes.tcpusage')"
                class="q-mt-sm text-subtitle1"
              >
                <q-card>
                  <q-card-section class="q-pa-none q-ma-none">
                    <q-checkbox type="checkbox" size="xs" v-model="establishedToggle" :label="t('nodes.establishedLabel')" />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <q-input :disable="!establishedToggle" data-test="nodes-filter-established-min" type="number" dense class="tw-w-[35%]" min="0" :max="maxEstablished" v-model="establishedUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input :disable="!establishedToggle" data-test="nodes-filter-established-max" type="number" dense class="tw-w-[35%]" min="0" :max="maxEstablished" v-model="establishedUsage.max" />
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
                      class="tw-w-[90%] q-mt-md q-ml-sm"
                    />

                    <q-checkbox type="checkbox" class="q-mt-sm" size="xs" v-model="closewaitToggle" :label="t('nodes.closewaitLabel')" />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <q-input :disable="!closewaitToggle" data-test="nodes-filter-closewait-min" type="number" dense class="tw-w-[35%]" min="0" :max="maxClosewait" v-model="closewaitUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input :disable="!closewaitToggle" data-test="nodes-filter-closewait-max" type="number" dense class="tw-w-[35%]" min="0" :max="maxClosewait" v-model="closewaitUsage.max" />
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
                      class="tw-w-[90%] q-mt-md q-ml-sm"
                    />

                    <q-checkbox type="checkbox" class="q-mt-sm" size="xs" v-model="waittimeToggle" :label="t('nodes.waittimeLabel')" />
                    <div class="row items-center q-gutter-sm q-ml-xs">
                      <q-input :disable="!waittimeToggle" data-test="nodes-filter-waittime-min" type="number" dense class="tw-w-[35%]" min="0" :max="maxWaittime" v-model="waittimeUsage.min" />
                      <span class="q-px-sm">to</span>
                      <q-input :disable="!waittimeToggle" data-test="nodes-filter-waittime-max" type="number" dense class="tw-w-[35%]" min="0" :max="maxWaittime" v-model="waittimeUsage.max" />
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
                      class="tw-w-[90%] q-mt-md q-ml-sm"
                    />
                  </q-card-section>
                </q-card>
              </q-expansion-item>


            </q-list>
          </div>
          <div>
            <q-btn 
              :label="t('nodes.applyFilter')" 
              class="float-right q-mr-sm q-mb-sm text-bold text-capitalize" 
              color="secondary"
              @click="applyFilter(filterQuery)"
            >
            </q-btn>
          </div>
        </div>
      </template>
      <template style="background-color: red" v-slot:after>
        <q-table
          ref="qTable"
          :rows="tabledata"
          :columns="columns"
          row-key="id"
          :pagination="pagination"
          :filter="filterQuery"
          :filter-method="filterData"
          :loading="loading"
          class="nodes-list-table"
          dense
        >
          <template #no-data><NoData /></template>
          <template #top="scope">
            <div class="row full-width">
              <div
                class="col q-table__title items-start"
                data-test="cipher-keys-list-title"
              >
                {{ t("nodes.header") }}
              </div>
              <div class="col-auto flex">
                <q-input
                  v-model="filterQuery"
                  filled
                  dense
                  class="q-ml-none q-mb-xs"
                  style="width: 400px"
                  :placeholder="t('nodes.search')"
                  clearable
                >
                  <template #prepend>
                    <q-icon name="search" />
                  </template>
                </q-input>
              </div>
              <div class="col-auto flex q-ml-md pagination-align">
                <QTablePagination
                  v-if="resultTotal > 0"
                  :scope="scope"
                  :resultTotal="resultTotal"
                  :perPageOptions="perPageOptions"
                  position="top"
                  @update:changeRecordPerPage="changePagination"
                />
              </div>
            </div>
          </template>

          <template v-slot:body-cell-name="props">
            <q-td
              :props="props"
              :class="`status-${props.row.status.toLowerCase()}`"
            >
              {{ props.row.name }}
            </q-td>
          </template>

          <template v-slot:body-cell-region="props">
            <q-td :props="props">
              <q-badge class="badge-region q-mr-xs">{{ props.row.region }}</q-badge>
              <q-badge class="badge-cluster">{{ props.row.cluster }}</q-badge>
            </q-td>
          </template>

          <template v-slot:body-cell-tcp="props">
            <q-td :props="props" class="tcp-cell">
              {{ props.row.tcp_conns }} (E:{{
                props.row.tcp_conns_established
              }}, C:{{ props.row.tcp_conns_close_wait }}, W:{{
                props.row.tcp_conns_time_wait
              }})
            </q-td>
          </template>

          <template v-slot:body-cell-cpu="props">
            <q-td :props="props">
              <q-linear-progress
                dark
                size="10px"
                class="progresbar tw-w-[80%] inline-block"
                rounded
                :value="props.row.cpu_percentage_total / 100"
                :color="props.row.cpu_percentage_total > 85 ? 'red-9' : 'primary'"
              />
              {{ props.row.cpu_percentage_total }}%
            </q-td>
          </template>

          <template v-slot:body-cell-memory="props">
            <q-td :props="props">
              <q-linear-progress
                dark
                size="10px"
                class="progresbar tw-w-[80%] inline-block"
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
import { defineComponent, ref, onMounted, onUpdated, watch, Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, date, copyToClipboard, QTableProps } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "@/components/shared/grid/Pagination.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import CommonService from "@/services/common";

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
    const columns = ref<QTableProps["columns"]>([
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
        label: "",
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
        field: "cpu_percentage_total",
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
    ]);
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

        for (const region in data) {
            uniqueValues.regions.add(region);
            for (const cluster in data[region]) {
                uniqueValues.clusters.add(cluster);
                data[region][cluster].forEach((node: any) => {
                    node.metrics["percentage_memory_usage"] = (node.metrics.memory_usage > 0) ? Math.round((node.metrics.memory_usage/node.metrics.memory_total) * 100) : 0;
                    node.metrics["cpu_percentage_total"] = (node.metrics.cpu_usage > 0) ? Math.round((node.metrics.cpu_usage/node.metrics.cpu_total) * 100) : 0;
                    const { metrics, role, status, ...nodeData } = node;
                    
                    // Extract unique node types from role array
                    role.forEach((r: any) => uniqueValues.nodeTypes.add(r));
                    
                    // Extract unique statuses
                    uniqueValues.statuses.add(status);

                    if(node.tcp_conns_established > maxEstablished.value) {
                      maxEstablished.value = node.tcp_conns_established;
                    }

                    if(node.tcp_conns_close_wait > maxClosewait.value) {
                      maxClosewait.value = node.tcp_conns_close_wait;
                    }

                    if(node.tcp_conns_time_wait > maxWaittime.value) {
                      maxWaittime.value = node.tcp_conns_time_wait;
                    }

                    if(node.percentage_memory_usage > maxMemoryUsage.value) {
                      maxMemoryUsage.value = node.percentage_memory_usage;
                    }

                    if(node.cpu_percentage_total > maxCPUUsage.value) {
                      maxCPUUsage.value = node.cpu_percentage_total;
                    }
                    
                    result.push({
                        region,
                        cluster,
                        status,
                        role,
                        ...nodeData,
                        ...metrics,
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
            }
        };
    }

    const getData = () => {
      loading.value = true;
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading data...",
      });

      CommonService.list_nodes(store.state.selectedOrganization.identifier)
        .then((response) => {
          // let temp = response.data;
          // temp["test"] = JSON.parse(JSON.stringify(temp["openobserve"]))
          // temp["test"]["zo1"][0].name="test name";
          // console.log(temp)
          // const responseData = temp;
          const responseData = response.data;
          const { flattenedData, uniqueValues } = flattenObject(responseData);
          
          // let i=0;
          // while (i<100) {
          //   flattenedData.push(flattenedData[0]);
          //   i++;
          // }

          regionRows.value = uniqueValues.regions.map(name => ({ name }))
          clusterRows.value = uniqueValues.clusters.map(name => ({ name }))
          nodetypeRows.value = uniqueValues.nodeTypes.map(name => ({ name }))
          statusesRows.value = uniqueValues.statuses.map(name => ({ name }))
          tabledata.value = flattenedData;
          originalData.value = flattenedData;
          resultTotal.value = flattenedData.length;
          loading.value = false;
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

    getData();

    const applyFilter = (filterQuery: string) => {
      let terms = filterQuery.toLowerCase();
      const data = originalData.value.filter((row: any) => {
          const matchesSearch = row.name.toLowerCase().includes(terms);
          const matchesRegion = selectedRegions.value.length === 0 || selectedRegions.value.some((region: any) => region.name === row.region);
          const matchesCluster = selectedClusters.value.length === 0 || selectedClusters.value.some((cluster: any) => cluster.name === row.cluster);
          const matchesNodeType = selectedNodetypes.value.length === 0 || row.role.some((r: any) => selectedNodetypes.value.some((nt: any) => nt.name === r));
          const matchesStatus = selectedStatuses.value.length === 0 || selectedStatuses.value.some((status: any) => status.name === row.status);
          const matchesCPU = row.cpu_percentage_total >= cpuUsage.value.min && row.cpu_percentage_total <= cpuUsage.value.max;
          const matchesMemory = row.percentage_memory_usage >= memoryUsage.value.min && row.percentage_memory_usage <= memoryUsage.value.max;
          const matchesEstablished = row.tcp_conns_established >= establishedUsage.value.min && row.tcp_conns_established <= establishedUsage.value.max;
          const matchesCloseWait = row.tcp_conns_close_wait >= closewaitUsage.value.min && row.tcp_conns_close_wait <= closewaitUsage.value.max;
          const matchesWaitTime = row.tcp_conns_time_wait >= waittimeUsage.value.min && row.tcp_conns_time_wait <= waittimeUsage.value.max;
          
          return matchesSearch && matchesRegion && matchesCluster && matchesNodeType && matchesStatus && matchesCPU && matchesMemory && matchesEstablished && matchesCloseWait && matchesWaitTime;
      });

      tabledata.value = data;
      resultTotal.value = data.length;
    }

    return {
      t,
      store,
      router,
      qTable,
      loading,
      tabledata,
      columns,
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
      closewaitToggle,
      waittimeToggle,
      establishedUsage,
      closewaitUsage,
      waittimeUsage,
      maxEstablished,
      maxClosewait,
      maxWaittime,
      applyFilter,
      filterColumns: [{ name: "name", label: "Name", field: "name", align: "left" }],
      filterQuery: ref(""),
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
}

.status-online {
  border-left: 5px solid green !important;
}

.status-offline {
  border-left: 5px solid red;
}

.status-prepare {
  border-left: 5px solid warning;
}

.node-list-filter-table {
  max-height: 400px;
  overflow: auto;

  td {
    padding: 0 0 0 7px !important;

    &::before {
      background: none !important;
    }
  }

}
</style>
