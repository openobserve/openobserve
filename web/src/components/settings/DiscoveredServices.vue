<!-- Copyright 2025 OpenObserve Inc.

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

<template>
  <div class="tw:w-full discovered-services" :class="{ 'ds-dark': store.state.theme === 'dark' }">
    <!-- Loading State -->
    <div v-if="loading" class="tw:flex tw:justify-center tw:py-8">
      <q-spinner-hourglass color="primary" size="30px" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="tw:text-center tw:py-8">
      <q-icon name="error_outline" size="3rem" color="negative" class="tw:mb-4" />
      <div class="text-body1 text-negative">{{ error }}</div>
      <q-btn
        data-test="retry-discovered-services-btn"
        flat no-caps dense
        label="Retry"
        icon="refresh"
        @click="loadServices"
      />
    </div>

    <!-- Empty State -->
    <div v-else-if="services.length === 0" class="tw:text-center tw:py-8">
      <q-icon name="search_off" size="3rem" color="grey-5" class="tw:mb-4" />
      <div class="text-body1">{{ t("settings.correlation.noServicesYet") }}</div>
      <div class="text-body2 text-grey-6 tw:mt-2">
        {{ t("settings.correlation.noServicesDescription") }}
      </div>
      <q-btn
        data-test="refresh-discovered-services-btn"
        flat no-caps dense
        :label="t('common.refresh')"
        icon="refresh"
        @click="loadServices(true)"
        :loading="refreshing"
        class="tw:mt-3"
      />
    </div>

    <!-- Services List -->
    <div v-else>
      <!-- Info banner -->
      <div class="tw:mb-3 tw:rounded-lg tw:flex tw:items-center tw:gap-3 tw:px-4 tw:py-3"
        :style="store.state.theme === 'dark'
          ? 'background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.25)'
          : 'background: rgba(59,130,246,0.04); border: 1px solid rgba(59,130,246,0.15)'"
      >
        <q-icon name="info" size="20px" class="tw:shrink-0"
          :color="store.state.theme === 'dark' ? 'blue-4' : 'blue-7'"
        />
        <div class="tw:text-sm tw:leading-relaxed"
          :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'"
        >
          {{ t("settings.correlation.discoveredServicesDescription") }}
          <a
            class="config-link-btn tw:cursor-pointer tw:inline-block tw:mx-1 tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold tw:no-underline tw:align-middle"
            @click.prevent="$emit('navigate-to-configuration')"
          >Go to Configuration</a>
          <span>to configure how services are identified and grouped.</span>
        </div>
      </div>

      <!-- Header with title -->
      <div class="card-container tw:mb-[0.625rem]">
        <div class="tw:flex tw:justify-between tw:items-center tw:w-full tw:py-3 tw:px-4 tw:h-[68px]">
          <div class="q-table__title tw:font-[600]" data-test="services-list-title">
            {{ t("settings.correlation.discoveredServicesTitle") }}
          </div>
          <!-- Filter bar -->
          <div class="tw:flex tw:items-center tw:gap-2">
            <span class="tw:text-md tw:text-grey-6">Filter by :</span>
            <q-select
              v-model="filterKey"
              :options="filteredKeyOptions"
              dense
              borderless
              clearable
              use-input
              fill-input
              hide-selected
              input-debounce="0"
              emit-value
              map-options
              placeholder="Select field"
              data-test="service-filter-key"
              class="o2-search-input"
              style="min-width: 160px;"
              @filter="filterKeyFn"
              @update:model-value="filterValue = null"
            />
            <span>
              <q-select
                v-model="filterValue"
                :options="filteredValueOptions"
                dense
                borderless
                clearable
                use-input
                fill-input
                hide-selected
                input-debounce="0"
                emit-value
                map-options
                :disable="!filterKey"
                placeholder="Select value"
                data-test="service-filter-value"
                class="o2-search-input"
                style="min-width: 160px;"
                @filter="filterValueFn"
              />
              <q-tooltip v-if="!filterKey">Select a field first</q-tooltip>
            </span>
            <q-input
              v-model="searchQuery"
              dense
              borderless
              :placeholder="t('settings.correlation.searchServiceName')"
              data-test="service-search-input"
              clearable
              class="o2-search-input"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
            <q-btn
              data-test="reset-discovered-services-btn"
              round
              class="o2-secondary-button"
              :label="t('settings.correlation.resetServices')"
              :loading="resetting"
              @click="confirmResetServices"
            >
              <q-tooltip>{{ t("settings.correlation.resetServicesTooltip") }}</q-tooltip>
            </q-btn>
            <q-btn
              flat
              round
              :loading="refreshing"
              @click="loadServices(true)"
              data-test="refresh-discovered-services-btn"
              class="o2-secondary-button refresh-btn"
              label="Refresh"
            />
          </div>
        </div>
      </div>

      <!-- Grouped Services Table -->
      <div class="tw:w-full tw:h-full">
        <div class="tw:h-[calc(100vh-340px)]">
          <q-table
            :pagination="{ rowsPerPage: 0 }"
            :rows="refreshing ? [] : paginatedGroups"
            :columns="columns"
            :loading="refreshing"
            row-key="service_name"
            hide-pagination
            style="width: 100%"
            :style="filteredGroups.length > 0
              ? 'width: 100%; height: calc(100vh - 340px)'
              : 'width: 100%'"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
            data-test="services-list-table"
          >
            <!-- Loading state -->
            <template #loading>
              <div class="tw:flex tw:items-center tw:justify-center tw:pb-40">
                <q-spinner-hourglass color="primary" size="3rem" />
              </div>
            </template>
            <template v-if="refreshing" #no-data>
              <span></span>
            </template>
            <template v-slot:body="props">
              <!-- Group header row -->
              <q-tr
                :props="props"
                class="group-header-row"
                data-test="service-group-row"
                @click="toggleGroup(props.row.service_name)"
              >
                <q-td key="service_name" :props="props">
                  <div class="tw:flex tw:items-center tw:gap-2">
                    <q-icon
                      :name="expandedGroups.has(props.row.service_name) ? 'expand_more' : 'chevron_right'"
                      size="20px"
                      class="tw:text-gray-400"
                    />
                    <span class="tw:font-semibold">{{ props.row.service_name }}</span>
                    <span class="instance-count-badge">
                      {{ props.row.instances.length }} {{ props.row.instances.length === 1 ? 'instance' : 'instances' }}
                    </span>
                  </div>
                </q-td>
                <q-td key="telemetry" :props="props">
                  <div class="tw:flex tw:gap-1.5 tw:flex-wrap tw:items-center">
                    <span class="telemetry-badge"
                      :class="props.row.totalLogs > 0 ? 'telemetry-logs' : 'telemetry-inactive'"
                    >{{ props.row.totalLogs }} Logs</span>
                    <span class="telemetry-badge"
                      :class="props.row.totalTraces > 0 ? 'telemetry-traces' : 'telemetry-inactive'"
                    >{{ props.row.totalTraces }} Traces</span>
                    <span class="telemetry-badge"
                      :class="props.row.totalMetrics > 0 ? 'telemetry-metrics' : 'telemetry-inactive'"
                    >{{ props.row.totalMetrics }} Metrics</span>
                  </div>
                </q-td>
                <q-td key="last_seen" :props="props" style="text-align: right">
                  <span class="tw:text-sm"
                    :class="store.state.theme === 'dark' ? 'tw:text-grey-5' : 'tw:text-grey-6'"
                  >{{ formatRelativeTime(props.row.lastSeen) }}</span>
                </q-td>
              </q-tr>

              <!-- Expanded instance rows -->
              <template v-if="expandedGroups.has(props.row.service_name)">
                <q-tr
                  v-for="instance in props.row.instances"
                  :key="instance.id"
                  class="instance-row"
                  data-test="service-instance-row"
                  @click="selectedService = instance"
                >
                  <q-td :colspan="3">
                    <div class="tw:pl-7 tw:flex tw:items-center tw:gap-3">
                      <!-- All dimensions in one horizontal line -->
                      <div class="tw:flex tw:items-center tw:gap-1.5 tw:flex-1 tw:min-w-0">
                        <span
                          v-for="[key, value] in Object.entries(instance.disambiguation).sort(([a], [b]) => a.localeCompare(b))"
                          :key="`${key}=${value}`"
                          class="dimension-badge"
                          :class="getDimensionColorClass(key)"
                        >
                          <span class="tw:font-medium">{{ key }}</span>=<span>{{ value }}</span>
                          <q-tooltip anchor="top middle" self="bottom middle" class="tw:text-xs">
                            {{ key }} = {{ value }}
                          </q-tooltip>
                        </span>
                      </div>
                      <span class="tw:text-xs tw:shrink-0"
                        :class="store.state.theme === 'dark' ? 'tw:text-grey-5' : 'tw:text-grey-6'"
                      >{{ formatRelativeTime(instance.last_seen) }}</span>
                    </div>
                  </q-td>
                </q-tr>
              </template>
            </template>

            <!-- Pagination footer -->
            <template v-slot:bottom>
              <div class="bottom-btn tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[36px]">
                <div class="o2-table-footer-title tw:w-[250px] tw:mr-md">
                  {{ filteredGroups.length }} {{ filteredGroups.length === 1 ? 'Service' : 'Services' }}
                  ({{ totalInstances }} instances)
                </div>
                <QTablePagination
                  :scope="paginationScope"
                  :position="'bottom'"
                  :resultTotal="filteredGroups.length"
                  :perPageOptions="perPageOptions"
                  @update:changeRecordPerPage="changePagination"
                />
              </div>
            </template>
          </q-table>
        </div>
      </div>
    </div>

    <!-- Service detail side panel -->
    <q-dialog
      :model-value="!!selectedService"
      position="right"
      full-height
      maximized
      @update:model-value="(val: boolean) => { if (!val) selectedService = null }"
    >
      <q-card
        class="service-side-panel"
        data-test="service-side-panel"
      >
        <!-- Panel header -->
        <q-card-section class="panel-header q-ma-none">
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:text-[16px] tw:flex tw:items-center">
              {{ t("settings.correlation.service") }}
              <span
                :class="[
                  'tw:font-bold tw:px-2 tw:py-0.5 tw:rounded-md tw:ml-2 tw:max-w-xs tw:truncate tw:inline-block',
                  store.state.theme === 'dark'
                    ? 'tw:text-blue-400 tw:bg-blue-900/50'
                    : 'tw:text-blue-600 tw:bg-blue-50'
                ]"
              >
                {{ selectedService?.service_name }}
                <q-tooltip v-if="(selectedService?.service_name?.length ?? 0) > 25" class="tw:text-xs">
                  {{ selectedService?.service_name }}
                </q-tooltip>
              </span>
            </div>
          </div>
          <q-btn v-close-popup round flat dense icon="cancel" size="sm" />
        </q-card-section>

        <q-separator />

        <!-- Scrollable content -->
        <q-card-section class="panel-content q-ma-none">
          <!-- Stream Sources donut chart -->
          <div class="tw:mb-4">
            <div class="tw:text-[11px] tw:tracking-wide tw:font-medium tw:mb-2 section-label">
              Stream Sources
            </div>
            <div style="height: 40vh; min-height: 180px;">
              <CustomChartRenderer :data="selectedServiceChartOptions" />
            </div>
            <!-- Legend -->
            <div class="tw:flex tw:items-center tw:justify-center tw:gap-4 tw:mt-2 tw:shrink-0">
              <template v-for="[label, count, color] in [
                ['Logs', selectedService?.logs_streams.length ?? 0, '#3b82f6'],
                ['Metrics', selectedService?.metrics_streams.length ?? 0, '#22c55e'],
                ['Traces', selectedService?.traces_streams.length ?? 0, '#f59e0b'],
              ]" :key="label as string">
                <div class="tw:flex tw:items-center tw:gap-1.5 tw:text-xs">
                  <span class="tw:w-2.5 tw:h-2.5 tw:rounded-full tw:inline-block" :style="{ background: color as string }" />
                  <span>{{ label }}</span>
                  <span class="tw:font-semibold">{{ count }}</span>
                </div>
              </template>
            </div>
          </div>

          <q-separator class="tw:my-3" />

          <!-- Instance Identity -->
          <div class="panel-section">
            <div class="tw:text-[11px] tw:tracking-wide tw:font-medium tw:mb-2 section-label">
              Instance Identity
            </div>
            <div
              v-if="selectedService && Object.keys(selectedService.disambiguation).length > 0"
              class="tw:flex tw:flex-wrap tw:gap-1.5"
            >
              <span
                v-for="[key, value] in Object.entries(selectedService.disambiguation).sort(([a], [b]) => a.localeCompare(b))"
                :key="`${key}=${value}`"
                class="dimension-badge"
                :class="getDimensionColorClass(key)"
              >
                <span class="tw:font-medium">{{ key }}</span>=<span>{{ value }}</span>
              </span>
            </div>
            <div v-else class="tw:text-sm tw:italic section-label">
              No dimensions configured.
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <ConfirmDialog
      :title="t('settings.correlation.resetServicesConfirmTitle')"
      message="This will delete all discovered services for this organization."
      warningMessage="Services will be automatically re-discovered as new telemetry data is ingested. This action cannot be undone."
      @update:ok="doResetServices"
      @update:cancel="confirmResetOpen = false"
      v-model="confirmResetOpen"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import serviceStreamsService from "@/services/service_streams";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

const emit = defineEmits<{
  (e: "navigate-to-configuration"): void;
}>();

const q = useQuasar();
const { t } = useI18n();

interface ServiceRecord {
  id: string;
  org_id: string;
  service_name: string;
  disambiguation: Record<string, string>;
  logs_streams: string[];
  traces_streams: string[];
  metrics_streams: string[];
  last_seen: number; // microseconds epoch
}

interface ServiceGroup {
  service_name: string;
  instances: ServiceRecord[];
  sharedDimensions: [string, string][]; // dimensions same across all instances
  varyingKeys: string[]; // dimension keys that differ
  totalLogs: number;
  totalTraces: number;
  totalMetrics: number;
  lastSeen: number;
}

const store = useStore();

const loading = ref(true);
const refreshing = ref(false);
const resetting = ref(false);
const error = ref<string | null>(null);
const services = ref<ServiceRecord[]>([]);
const searchQuery = ref("");
const filterKey = ref<string | null>(null);
const filterValue = ref<string | null>(null);
const selectedService = ref<ServiceRecord | null>(null);
const expandedGroups = ref<Set<string>>(new Set());

// Reset pagination when filters change
watch([filterKey, filterValue, searchQuery], () => {
  pagination.value.page = 1;
});

// All unique dimension keys across all services
const allKeys = computed((): string[] => {
  const keys = new Set<string>();
  for (const s of services.value) {
    for (const k of Object.keys(s.disambiguation)) keys.add(k);
  }
  return [...keys].sort();
});

// Values for the currently selected key
const allValues = computed((): string[] => {
  if (!filterKey.value) return [];
  const vals = new Set<string>();
  for (const s of services.value) {
    const v = s.disambiguation[filterKey.value];
    if (v) vals.add(v);
  }
  return [...vals].sort();
});

// Filtered options for use-input type-to-search
const filteredKeyOptions = ref<string[]>([]);
const filteredValueOptions = ref<string[]>([]);

function filterKeyFn(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase();
    filteredKeyOptions.value = needle
      ? allKeys.value.filter(k => k.toLowerCase().includes(needle))
      : allKeys.value;
  });
}

function filterValueFn(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase();
    filteredValueOptions.value = needle
      ? allValues.value.filter(v => v.toLowerCase().includes(needle))
      : allValues.value;
  });
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}

const pagination = ref({
  page: 1,
  rowsPerPage: 20,
});

const perPageOptions: any = [
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "250", value: 250 },
  { label: "500", value: 500 },
];

const changePagination = (val: { label: string; value: number }) => {
  pagination.value.rowsPerPage = val.value;
  pagination.value.page = 1;
};

const columns = computed(() => [
  {
    name: "service_name",
    label: t("settings.correlation.serviceName"),
    field: "service_name",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "telemetry",
    label: t("settings.correlation.telemetryCoverage"),
    field: "logs_streams",
    align: "left" as const,
    style: "width: 220px",
  },
  {
    name: "last_seen",
    label: t("settings.correlation.lastSeen"),
    field: "last_seen",
    align: "right" as const,
    sortable: true,
    style: "width: 120px",
  },
]);

// Group services by service_name
const serviceGroups = computed((): ServiceGroup[] => {
  const groupMap: Record<string, ServiceRecord[]> = {};
  for (const s of services.value) {
    if (!groupMap[s.service_name]) groupMap[s.service_name] = [];
    groupMap[s.service_name].push(s);
  }

  return Object.entries(groupMap).map(([name, instances]) => {
    // Find shared dimensions (same value across all instances)
    const allKeys = new Set<string>();
    for (const inst of instances) {
      for (const k of Object.keys(inst.disambiguation)) allKeys.add(k);
    }

    const shared: [string, string][] = [];
    const varying: string[] = [];
    for (const key of allKeys) {
      const values = new Set(instances.map(i => i.disambiguation[key]).filter(Boolean));
      if (values.size === 1) {
        shared.push([key, [...values][0]]);
      } else {
        varying.push(key);
      }
    }

    // Aggregate telemetry: count unique streams across all instances
    const allLogs = new Set<string>();
    const allTraces = new Set<string>();
    const allMetrics = new Set<string>();
    let latestSeen = 0;
    for (const inst of instances) {
      inst.logs_streams.forEach(s => allLogs.add(s));
      inst.traces_streams.forEach(s => allTraces.add(s));
      inst.metrics_streams.forEach(s => allMetrics.add(s));
      if (inst.last_seen > latestSeen) latestSeen = inst.last_seen;
    }

    return {
      service_name: name,
      instances,
      sharedDimensions: shared.sort(([a], [b]) => a.localeCompare(b)),
      varyingKeys: varying.sort(),
      totalLogs: allLogs.size,
      totalTraces: allTraces.size,
      totalMetrics: allMetrics.size,
      lastSeen: latestSeen,
    };
  }).sort((a, b) => a.service_name.localeCompare(b.service_name));
});

/** Filter instances within a group based on active key/value filter */
function filterInstances(instances: ServiceRecord[]): ServiceRecord[] {
  if (!filterKey.value || !filterValue.value) return instances;
  return instances.filter(inst => {
    const v = inst.disambiguation[filterKey.value!];
    return v === filterValue.value;
  });
}

const filteredGroups = computed((): ServiceGroup[] => {
  let groups = serviceGroups.value;

  // Filter by dimension key+value — only apply when both are selected
  if (filterKey.value && filterValue.value) {
    groups = groups
      .map(g => ({ ...g, instances: filterInstances(g.instances) }))
      .filter(g => g.instances.length > 0);
  }

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    groups = groups.filter(g =>
      g.service_name.toLowerCase().includes(query) ||
      g.instances.some(inst =>
        Object.entries(inst.disambiguation).some(([k, v]) =>
          k.toLowerCase().includes(query) || v.toLowerCase().includes(query)
        ) ||
        inst.logs_streams.some(stream => stream.toLowerCase().includes(query)) ||
        inst.traces_streams.some(stream => stream.toLowerCase().includes(query)) ||
        inst.metrics_streams.some(stream => stream.toLowerCase().includes(query))
      )
    );
  }

  return groups;
});

const totalInstances = computed(() =>
  filteredGroups.value.reduce((sum, g) => sum + g.instances.length, 0)
);

// Manual pagination for groups
const paginatedGroups = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.rowsPerPage;
  return filteredGroups.value.slice(start, start + pagination.value.rowsPerPage);
});

// Provide a scope-like object for QTablePagination
const paginationScope = computed(() => ({
  pagination: {
    page: pagination.value.page,
    rowsPerPage: pagination.value.rowsPerPage,
    rowsNumber: filteredGroups.value.length,
  },
  pagesNumber: Math.ceil(filteredGroups.value.length / pagination.value.rowsPerPage),
  isFirstPage: pagination.value.page === 1,
  isLastPage: pagination.value.page >= Math.ceil(filteredGroups.value.length / pagination.value.rowsPerPage),
  firstPage: () => { pagination.value.page = 1; },
  prevPage: () => { if (pagination.value.page > 1) pagination.value.page--; },
  nextPage: () => {
    const maxPage = Math.ceil(filteredGroups.value.length / pagination.value.rowsPerPage);
    if (pagination.value.page < maxPage) pagination.value.page++;
  },
  lastPage: () => {
    pagination.value.page = Math.ceil(filteredGroups.value.length / pagination.value.rowsPerPage);
  },
}));

const STREAM_TYPE_COLORS: Record<string, string> = {
  logs: '#3b82f6',
  traces: '#f59e0b',
  metrics: '#22c55e',
};

const selectedServiceChartOptions = computed(() => {
  if (!selectedService.value) return {};
  const svc = selectedService.value;
  const isDark = store.state.theme === 'dark';

  const streamDetails = [
    { type: 'Logs', streams: svc.logs_streams, color: STREAM_TYPE_COLORS.logs },
    { type: 'Traces', streams: svc.traces_streams, color: STREAM_TYPE_COLORS.traces },
    { type: 'Metrics', streams: svc.metrics_streams, color: STREAM_TYPE_COLORS.metrics },
  ].filter(d => d.streams.length > 0);

  const pieData = streamDetails.map(d => ({
    name: d.type,
    value: d.streams.length,
    streamNames: d.streams,
  }));

  const totalStreams = pieData.reduce((sum, d) => sum + d.value, 0);

  return {
    tooltip: {
      trigger: 'item',
      enterable: true,
      appendToBody: true,
      confine: false,
      textStyle: { color: isDark ? '#fff' : '#000', fontSize: 12 },
      backgroundColor: isDark ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)',
      extraCssText: 'max-height: 240px; overflow-y: auto;',
      formatter: function (params: any) {
        const names: string[] = params.data?.streamNames ?? [];
        const header = `${params.marker} ${params.name} : <b>${params.value} streams (${params.percent}%)</b>`;
        if (!names.length) return header;
        const list = names.map((n: string) =>
          `<div style="padding:1px 0;padding-left:14px;font-size:11px;">${n}</div>`
        ).join('');
        return header + '<div style="margin-top:4px;">' + list + '</div>';
      },
    },
    color: streamDetails.map(d => d.color),
    series: [{
      type: 'pie',
      radius: ['50%', '78%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderRadius: 4,
        borderColor: isDark ? '#111827' : '#fff',
        borderWidth: 2,
      },
      label: { show: false },
      emphasis: {
        label: { show: false },
        itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.2)' },
      },
      data: pieData,
    }],
    graphic: totalStreams > 0 ? [{
      type: 'text',
      left: 'center',
      top: 'center',
      style: {
        text: `${totalStreams}`,
        fontSize: 22,
        fontWeight: 'bold',
        fill: isDark ? '#e5e7eb' : '#1f2937',
        textAlign: 'center',
      },
    }] : [],
  };
});

const toggleGroup = (serviceName: string) => {
  const newSet = new Set(expandedGroups.value);
  if (newSet.has(serviceName)) {
    newSet.delete(serviceName);
  } else {
    newSet.add(serviceName);
  }
  expandedGroups.value = newSet;
};


const getDimensionColorClass = (key: string): string => {
  const colorMap: Record<string, string> = {
    'k8s-deployment': 'badge-blue',
    'k8s-namespace': 'badge-orange',
    'k8s-cluster': 'badge-indigo',
    'deployment': 'badge-blue',
    'namespace': 'badge-orange',
    'cluster': 'badge-indigo',
    'env': 'badge-green',
    'environment': 'badge-green',
    'host': 'badge-purple',
    'hostname': 'badge-purple',
    'service': 'badge-cyan',
    'service_name': 'badge-cyan',
    'region': 'badge-pink',
    'zone': 'badge-pink',
    'pod': 'badge-teal',
    'container': 'badge-red',
    'app': 'badge-yellow',
    'application': 'badge-yellow',
  };

  if (colorMap[key]) return colorMap[key];

  const lowerKey = key.toLowerCase();
  for (const [pattern, className] of Object.entries(colorMap)) {
    if (lowerKey.includes(pattern)) return className;
  }

  const classes = ['badge-gray', 'badge-amber', 'badge-violet', 'badge-rose'];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash = hash & hash;
  }
  return classes[Math.abs(hash) % classes.length];
};

const formatRelativeTime = (microseconds: number): string => {
  if (!microseconds) return "—";
  const nowMs = Date.now();
  const thenMs = microseconds / 1000;
  const diffSeconds = Math.floor((nowMs - thenMs) / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const loadServices = async (isRefresh = false) => {
  if (isRefresh) {
    refreshing.value = true;
  } else {
    loading.value = true;
  }
  error.value = null;

  try {
    const orgId = store.state.selectedOrganization?.identifier;
    if (!orgId) {
      throw new Error("No organization selected");
    }

    const response = await serviceStreamsService.getServicesList(orgId);
    const raw: ServiceRecord[] = response.data || [];
    services.value = raw.map((s) => ({
      ...s,
      logs_streams: unique(s.logs_streams),
      traces_streams: unique(s.traces_streams),
      metrics_streams: unique(s.metrics_streams),
    }));
  } catch (err: any) {
    console.error("Failed to load services:", err);
    error.value = err?.message || "Failed to load services";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
};

const confirmResetOpen = ref(false);

const confirmResetServices = () => {
  confirmResetOpen.value = true;
};

const doResetServices = async () => {
  resetting.value = true;
  try {
    const orgId = store.state.selectedOrganization?.identifier;
    if (!orgId) {
      throw new Error("No organization selected");
    }

    const response = await serviceStreamsService.resetServices(orgId);
    const { deleted_count, note } = response.data;

    q.notify({
      type: "positive",
      message: t("settings.correlation.resetServicesSuccess", { count: deleted_count }),
      caption: note,
      timeout: 5000,
    });

    // Reload the services list
    await loadServices();
  } catch (err: any) {
    q.notify({
      type: "negative",
      message: t("settings.correlation.resetServicesFailed"),
      caption: err?.message || String(err),
    });
  } finally {
    resetting.value = false;
  }
};

onMounted(() => {
  loadServices();
});
</script>

<style scoped lang="scss">
.discovered-services {
  background: var(--o2-card-bg);
}

.config-link-btn {
  border: 1px solid #3b82f6;
  color: #2563eb;
  background: rgba(59, 130, 246, 0.08);
  transition: background 0.15s;
  &:hover {
    background: rgba(59, 130, 246, 0.18);
  }
}

.ds-dark .config-link-btn {
  border-color: #60a5fa;
  color: #93c5fd;
  background: rgba(96, 165, 250, 0.12);
  &:hover {
    background: rgba(96, 165, 250, 0.22);
  }
}

/* Group header row */
.group-header-row {
  cursor: pointer;
  font-weight: 500;
  &:hover {
    background: rgba(0, 0, 0, 0.02) !important;
  }
}

.ds-dark .group-header-row:hover {
  background: rgba(255, 255, 255, 0.03) !important;
}

.instance-count-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  background: #e5e7eb;
  color: #6b7280;
}

.ds-dark .instance-count-badge {
  background: #4b5563;
  color: #d1d5db;
}

/* Instance sub-rows */
.instance-row {
  cursor: pointer;
  &:hover {
    background: rgba(59, 130, 246, 0.04) !important;
  }
}

.ds-dark .instance-row:hover {
  background: rgba(59, 130, 246, 0.08) !important;
}

.instance-label {
  font-weight: 500;
}

/* Dimension badges — border-only, matching IncidentList pattern */
.dimension-badge-sm {
  padding: 1px 6px;
  font-size: 10px;
  max-width: 200px;
}

.dimension-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  max-width: 180px;

  span {
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.badge-more {
  background: #e5e7eb;
  color: #6b7280;
  font-weight: 500;
}

/* Telemetry badges — border-only */
.telemetry-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.telemetry-sm {
  padding: 1px 6px;
  font-size: 10px;
}

.telemetry-logs { border: 1px solid #1d4ed8; }
.telemetry-traces { border: 1px solid #c2410c; }
.telemetry-metrics { border: 1px solid #065f46; }
.telemetry-inactive { border: 1px solid #9ca3af; color: #9ca3af; }

/* Dimension color palette — border only */
.badge-blue { border: 1px solid #1d4ed8; }
.badge-green { border: 1px solid #065f46; }
.badge-yellow { border: 1px solid #92400e; }
.badge-pink { border: 1px solid #9f1239; }
.badge-purple { border: 1px solid #7c3aed; }
.badge-orange { border: 1px solid #c2410c; }
.badge-cyan { border: 1px solid #0e7490; }
.badge-indigo { border: 1px solid #4f46e5; }
.badge-teal { border: 1px solid #0f766e; }
.badge-red { border: 1px solid #dc2626; }
.badge-gray { border: 1px solid #4b5563; }
.badge-amber { border: 1px solid #d97706; }
.badge-violet { border: 1px solid #7c3aed; }
.badge-rose { border: 1px solid #e11d48; }

/* Dark mode */
.ds-dark .badge-more { background: #4b5563; color: #d1d5db; }
.ds-dark .telemetry-logs { border-color: #93c5fd; }
.ds-dark .telemetry-traces { border-color: #fdba74; }
.ds-dark .telemetry-metrics { border-color: #6ee7b7; }
.ds-dark .telemetry-inactive { border-color: #6b7280; color: #6b7280; }
.ds-dark .badge-blue { border-color: #93c5fd; }
.ds-dark .badge-green { border-color: #6ee7b7; }
.ds-dark .badge-yellow { border-color: #fcd34d; }
.ds-dark .badge-pink { border-color: #f9a8d4; }
.ds-dark .badge-purple { border-color: #c4b5fd; }
.ds-dark .badge-orange { border-color: #fdba74; }
.ds-dark .badge-cyan { border-color: #67e8f9; }
.ds-dark .badge-indigo { border-color: #a5b4fc; }
.ds-dark .badge-teal { border-color: #5eead4; }
.ds-dark .badge-red { border-color: #fca5a5; }
.ds-dark .badge-gray { border-color: #d1d5db; }
.ds-dark .badge-amber { border-color: #fbbf24; }
.ds-dark .badge-violet { border-color: #c4b5fd; }
.ds-dark .badge-rose { border-color: #fda4af; }

/* Side panel */
.service-side-panel {
  width: 420px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px !important;
  flex-shrink: 0;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px !important;
}

.panel-section {
  padding: 8px 0;
}

.section-label {
  color: #6b7280;
}

.ds-dark .section-label {
  color: #9ca3af;
}
.refresh-btn{
  min-height: 36px;
  height: 36px;
}
</style>
