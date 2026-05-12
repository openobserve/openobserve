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

<template>
  <div
    class="tw:w-full discovered-services"
    :class="{ 'ds-dark': store.state.theme === 'dark' }"
  >
    <!-- Loading State -->
    <div v-if="loading" class="tw:flex tw:justify-center tw:py-8">
      <OSpinner size="sm" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="tw:text-center tw:py-8">
      <q-icon
        name="error_outline"
        size="3rem"
        color="negative"
        class="tw:mb-4"
      />
      <div class="text-body1 text-negative">{{ error }}</div>
      <OButton
        data-test="retry-discovered-services-btn"
        variant="outline"
        size="sm-action"
        @click="loadServices"
      >
        <template #icon-left><RefreshCw class="tw:size-3.5 tw:shrink-0" /></template>
        {{ t("settings.correlation.retry") }}
      </OButton>
    </div>

    <!-- Empty State -->
    <div v-else-if="services.length === 0" class="tw:text-center tw:py-8">
      <q-icon name="search_off" size="3rem" color="grey-5" class="tw:mb-4" />
      <div class="text-body1">
        {{ t("settings.correlation.noServicesYet") }}
      </div>
      <div class="text-body2 text-grey-6 tw:mt-2">
        {{ t("settings.correlation.noServicesDescription") }}
      </div>
      <OButton
        data-test="refresh-discovered-services-btn"
        variant="outline"
        size="sm-action"
        :loading="refreshing"
        class="tw:mt-3"
        @click="loadServices(true)"
      >
        <template #icon-left><RefreshCw class="tw:size-3.5 tw:shrink-0" /></template>
        {{ t("common.refresh") }}
      </OButton>
    </div>

    <!-- Services List -->
    <div v-else>
      <!-- Info banner -->
      <div
        class="info-banner tw:mb-3 tw:rounded-lg tw:flex tw:items-center tw:gap-3"
      >
        <q-icon
          name="info"
          size="1.25rem"
          class="tw:shrink-0 info-banner-icon"
        />
        <div class="tw:text-sm tw:leading-relaxed info-banner-text">
          {{ t("settings.correlation.discoveredServicesDescription") }}
          <a
            class="config-link-btn tw:cursor-pointer tw:inline-block tw:mx-1 tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold tw:no-underline tw:align-middle"
            @click.prevent="$emit('navigate-to-configuration')"
            >{{ t("settings.correlation.goToConfiguration") }}</a
          >
          <span>{{ t("settings.correlation.configureServicesHint") }}</span>
        </div>
      </div>

      <!-- Header with title -->
      <div class="card-container tw:mb-[0.625rem]">
        <div
          class="services-header-bar tw:flex tw:justify-between tw:items-center tw:w-full"
        >
          <div
            class="q-table__title tw:font-[600]"
            data-test="services-list-title"
          >
            {{ t("settings.correlation.discoveredServicesTitle") }}
          </div>
          <!-- Filter bar -->
          <div class="tw:flex tw:items-center tw:gap-2">
            <span class="tw:text-md tw:text-grey-6">{{
              t("settings.correlation.filterBy")
            }}</span>
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
              :placeholder="t('settings.correlation.selectFieldPlaceholder')"
              data-test="service-filter-key"
              class="o2-search-input filter-select"
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
                :placeholder="t('settings.correlation.selectValuePlaceholder')"
                data-test="service-filter-value"
                class="o2-search-input filter-select"
                @filter="filterValueFn"
              />
              <q-tooltip v-if="!filterKey">{{
                t("settings.correlation.selectFieldFirst")
              }}</q-tooltip>
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
            <OButton
              data-test="reset-discovered-services-btn"
              variant="outline"
              size="sm-action"
              :loading="resetting"
              @click="confirmResetServices"
            >
              {{ t("settings.correlation.resetServices") }}
              <q-tooltip>{{
                t("settings.correlation.resetServicesTooltip")
              }}</q-tooltip>
            </OButton>
            <OButton
              variant="outline"
              size="sm-action"
              :loading="refreshing"
              @click="loadServices(true)"
              data-test="refresh-discovered-services-btn"
            >
              {{ t("common.refresh") }}
            </OButton>
          </div>
        </div>
      </div>

      <!-- Grouped Services Table -->
      <div class="tw:w-full tw:h-full">
        <div class="tw:h-[calc(100vh-21.25rem)]">
          <q-table
            :pagination="{
              rowsPerPage: 0,
              sortBy: sortBy,
              descending: sortDescending,
            }"
            :rows="refreshing ? [] : paginatedGroups"
            :columns="columns"
            :loading="refreshing"
            row-key="service_name"
            hide-pagination
            @request="onTableRequest"
            :class="[
              'o2-quasar-table o2-row-md o2-quasar-table-header-sticky services-table',
              filteredGroups.length > 0 ? 'services-table-full-height' : '',
            ]"
            data-test="services-list-table"
          >
            <!-- Loading state -->
            <template #loading>
              <div class="tw:flex tw:items-center tw:justify-center tw:pb-40">
                <OSpinner size="lg" />
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
                      :name="
                        expandedGroups.has(props.row.service_name)
                          ? 'expand_more'
                          : 'chevron_right'
                      "
                      size="1.25rem"
                      class="tw:text-gray-400"
                    />
                    <span class="tw:font-semibold">{{
                      props.row.service_name
                    }}</span>
                    <span class="instance-count-badge">
                      {{ props.row.instances.length }}
                      {{
                        props.row.instances.length === 1
                          ? t("settings.correlation.instanceSingular")
                          : t("settings.correlation.instancePlural")
                      }}
                    </span>
                  </div>
                </q-td>
                <q-td key="telemetry" :props="props">
                  <div class="instance-telemetry-grid">
                    <span
                      v-if="props.row.totalLogs > 0"
                      class="telemetry-badge telemetry-logs"
                      >{{ t("settings.correlation.logs") }}</span
                    >
                    <span v-else class="telemetry-slot-empty"></span>
                    <span
                      v-if="props.row.totalTraces > 0"
                      class="telemetry-badge telemetry-traces"
                      >{{ t("settings.correlation.traces") }}</span
                    >
                    <span v-else class="telemetry-slot-empty"></span>
                    <span
                      v-if="props.row.totalMetrics > 0"
                      class="telemetry-badge telemetry-metrics"
                      >{{ t("settings.correlation.metrics") }}</span
                    >
                    <span v-else class="telemetry-slot-empty"></span>
                  </div>
                </q-td>
                <q-td key="last_seen" :props="props" class="td-last-seen">
                  <span class="tw:text-sm last-seen-text">{{
                    formatRelativeTime(props.row.lastSeen)
                  }}</span>
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
                  <!-- Service name cell: set_id badge + dimension badges -->
                  <q-td key="service_name" :props="props">
                    <div
                      class="tw:pl-7 tw:flex tw:items-center tw:gap-2 tw:flex-wrap"
                    >
                      <span class="set-id-badge">{{ instance.set_id }}</span>
                      <span
                        v-for="[key, value] in Object.entries(
                          instance.disambiguation,
                        ).sort(([a], [b]) => a.localeCompare(b))"
                        :key="`${key}=${value}`"
                        class="dimension-badge"
                        :class="getDimensionColorClass(key)"
                      >
                        <span class="tw:font-medium">{{ key }}</span
                        >=<span>{{ value }}</span>
                      </span>
                      <span
                        v-if="Object.keys(instance.disambiguation).length === 0"
                        class="tw:text-xs tw:italic no-dimensions-text"
                        >{{ t("settings.correlation.noDimensions") }}</span
                      >
                    </div>
                  </q-td>

                  <!-- Telemetry cell: fixed slots so Logs/Traces/Metrics align vertically across instances -->
                  <q-td
                    key="telemetry"
                    :props="props"
                    class="td-telemetry-instance"
                  >
                    <div class="instance-telemetry-grid">
                      <span
                        v-if="instance.logs_streams.length > 0"
                        class="telemetry-badge telemetry-sm telemetry-logs"
                      >
                        <q-tooltip class="tw:text-xs">{{
                          instance.logs_streams.join(", ")
                        }}</q-tooltip>
                        {{
                          t("settings.correlation.logsWithCount", {
                            count: instance.logs_streams.length,
                          })
                        }}
                      </span>
                      <span v-else class="telemetry-slot-empty"></span>

                      <span
                        v-if="instance.traces_streams.length > 0"
                        class="telemetry-badge telemetry-sm telemetry-traces"
                      >
                        <q-tooltip class="tw:text-xs">{{
                          instance.traces_streams.join(", ")
                        }}</q-tooltip>
                        {{
                          t("settings.correlation.tracesWithCount", {
                            count: instance.traces_streams.length,
                          })
                        }}
                      </span>
                      <span v-else class="telemetry-slot-empty"></span>

                      <span
                        v-if="instance.metrics_streams.length > 0"
                        class="telemetry-badge telemetry-sm telemetry-metrics"
                      >
                        <q-tooltip class="tw:text-xs">{{
                          instance.metrics_streams.join(", ")
                        }}</q-tooltip>
                        {{
                          t("settings.correlation.metricsWithCount", {
                            count: instance.metrics_streams.length,
                          })
                        }}
                      </span>
                      <span v-else class="telemetry-slot-empty"></span>
                    </div>
                  </q-td>

                  <!-- Last seen cell: right-aligned to match group header -->
                  <q-td key="last_seen" :props="props" class="td-last-seen">
                    <span class="tw:text-xs last-seen-text">{{
                      formatRelativeTime(instance.last_seen)
                    }}</span>
                  </q-td>
                </q-tr>
              </template>
            </template>

            <!-- Pagination footer -->
            <template v-slot:bottom>
              <div
                class="bottom-btn tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[2.25rem]"
              >
                <div class="o2-table-footer-title tw:w-[15.625rem] tw:mr-md">
                  {{
                    filteredGroups.length === 1
                      ? t("settings.correlation.serviceCountSingular", {
                          count: filteredGroups.length,
                        })
                      : t("settings.correlation.serviceCountPlural", {
                          count: filteredGroups.length,
                        })
                  }}
                  {{
                    t("settings.correlation.instancesCount", {
                      count: totalInstances,
                    })
                  }}
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
      @update:model-value="
        (val: boolean) => {
          if (!val) selectedService = null;
        }
      "
    >
      <q-card class="service-side-panel" data-test="service-side-panel">
        <!-- Header -->
        <div class="panel-header">
          <div
            class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap tw:flex-1 tw:min-w-0"
          >
            <span class="panel-service-name">{{
              selectedService?.service_name
            }}</span>
            <span class="set-id-badge">{{ selectedService?.set_id }}</span>
          </div>
          <span class="tw:shrink-0">
            <OButton variant="ghost" size="icon" v-close-popup>
              <q-icon name="close" size="14px" />
            </OButton>
          </span>
        </div>

        <!-- Default set warning banner -->
        <div
          v-if="selectedService?.set_id === 'default'"
          class="panel-warning-banner"
        >
          <q-icon
            name="info_outline"
            size="1rem"
            class="tw:shrink-0 tw:mt-0.5"
          />
          <div class="tw:text-xs tw:leading-relaxed">
            <span class="tw:font-semibold">{{
              t("settings.correlation.defaultSetWarningTitle")
            }}</span>
            {{ t("settings.correlation.defaultSetWarningBody") }}
          </div>
        </div>

        <q-separator />

        <!-- Scrollable body -->
        <div class="panel-body">
          <!-- Instance Identity -->
          <div class="panel-block">
            <div class="panel-block-label">
              {{ t("settings.correlation.instanceIdentity") }}
            </div>
            <div
              v-if="
                selectedService &&
                Object.keys(selectedService.disambiguation).length > 0
              "
              class="tw:flex tw:flex-wrap tw:gap-1.5"
            >
              <span
                v-for="[key, value] in Object.entries(
                  selectedService.disambiguation,
                ).sort(([a], [b]) => a.localeCompare(b))"
                :key="`${key}=${value}`"
                class="dimension-badge"
                :class="getDimensionColorClass(key)"
              >
                <span class="tw:font-medium">{{ key }}</span
                >=<span>{{ value }}</span>
              </span>
            </div>
            <div v-else class="panel-empty-text">
              {{ t("settings.correlation.noDimensionsCatchAll") }}
            </div>
          </div>

          <!-- Stream Sources -->
          <div class="panel-block">
            <div class="panel-block-label">
              {{ t("settings.correlation.streamSources") }}
            </div>
            <div class="tw:flex tw:flex-col tw:gap-3">
              <!-- Logs -->
              <div
                v-if="
                  selectedService && selectedService.logs_streams.length > 0
                "
              >
                <div class="panel-signal-row">
                  <span
                    class="telemetry-badge telemetry-logs panel-signal-type"
                    >{{ t("settings.correlation.logs") }}</span
                  >
                  <div class="tw:flex tw:flex-wrap tw:gap-1.5">
                    <span
                      v-for="stream in selectedService.logs_streams"
                      :key="stream"
                      class="stream-name-badge"
                      >{{ stream }}</span
                    >
                  </div>
                </div>
              </div>

              <!-- Traces -->
              <div
                v-if="
                  selectedService && selectedService.traces_streams.length > 0
                "
              >
                <div class="panel-signal-row">
                  <span
                    class="telemetry-badge telemetry-traces panel-signal-type"
                    >{{ t("settings.correlation.traces") }}</span
                  >
                  <div class="tw:flex tw:flex-wrap tw:gap-1.5">
                    <span
                      v-for="stream in selectedService.traces_streams"
                      :key="stream"
                      class="stream-name-badge"
                      >{{ stream }}</span
                    >
                  </div>
                </div>
              </div>

              <!-- Metrics -->
              <div
                v-if="
                  selectedService && selectedService.metrics_streams.length > 0
                "
              >
                <div class="panel-signal-row">
                  <span
                    class="telemetry-badge telemetry-metrics panel-signal-type"
                    >{{ t("settings.correlation.metrics") }}</span
                  >
                  <div class="tw:flex tw:flex-wrap tw:gap-1.5">
                    <span
                      v-for="stream in selectedService.metrics_streams"
                      :key="stream"
                      class="stream-name-badge"
                      >{{ stream }}</span
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Field Name Mapping -->
          <div
            v-if="
              selectedService &&
              Object.keys(selectedService.field_name_mapping ?? {}).length > 0
            "
            class="panel-block"
          >
            <div class="panel-block-label">
              {{ t("settings.correlation.fieldNameMapping") }}
            </div>
            <div class="panel-mapping-grid">
              <template
                v-for="[raw, mapped] in Object.entries(
                  selectedService.field_name_mapping ?? {},
                ).sort(([a], [b]) => a.localeCompare(b))"
                :key="raw"
              >
                <span class="mapping-key">{{ raw }}</span>
                <q-icon
                  name="arrow_forward"
                  size="0.75rem"
                  class="tw:text-gray-400 tw:justify-self-center"
                />
                <span class="mapping-val">{{ mapped }}</span>
              </template>
            </div>
          </div>
        </div>
      </q-card>
    </q-dialog>

    <ConfirmDialog
      :title="t('settings.correlation.resetServicesConfirmTitle')"
      :message="t('settings.correlation.resetServicesConfirmMessage')"
      :warningMessage="t('settings.correlation.resetServicesConfirmWarning')"
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
import OButton from "@/lib/core/Button/OButton.vue";
import { RefreshCw } from "lucide-vue-next";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

const emit = defineEmits<{
  (e: "navigate-to-configuration"): void;
}>();

const q = useQuasar();
const { t } = useI18n();

interface ServiceRecord {
  id: string;
  org_id: string;
  service_name: string;
  set_id: string;
  disambiguation: Record<string, string>;
  all_dimensions: Record<string, string>;
  logs_streams: string[];
  traces_streams: string[];
  metrics_streams: string[];
  field_name_mapping: Record<string, string>;
  last_seen: number; // microseconds epoch
}

interface ServiceGroup {
  service_name: string;
  instances: ServiceRecord[];
  sharedDimensions: [string, string][];
  varyingKeys: string[];
  totalLogs: number;
  totalTraces: number;
  totalMetrics: number;
  correlationScore: number; // 0–3: number of signal types present across all instances
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

// Label override for internal field keys shown in the filter dropdown
const KEY_DISPLAY_LABELS: Record<string, string> = {
  set_id: t("settings.correlation.workload"),
};

// All unique dimension keys + set_id across all services, as { label, value } objects
const allKeys = computed((): { label: string; value: string }[] => {
  const keys = new Set<string>();
  keys.add("set_id");
  for (const s of services.value) {
    for (const k of Object.keys(s.disambiguation)) keys.add(k);
  }
  return [...keys]
    .sort()
    .map((k) => ({ label: KEY_DISPLAY_LABELS[k] ?? k, value: k }));
});

// Values for the currently selected key
const allValues = computed((): string[] => {
  if (!filterKey.value) return [];
  const vals = new Set<string>();
  for (const s of services.value) {
    if (filterKey.value === "set_id") {
      vals.add(s.set_id);
    } else {
      const v = s.disambiguation[filterKey.value];
      if (v) vals.add(v);
    }
  }
  return [...vals].sort();
});

// Filtered options for use-input type-to-search
const filteredKeyOptions = ref<{ label: string; value: string }[]>([]);
const filteredValueOptions = ref<string[]>([]);

function filterKeyFn(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase();
    filteredKeyOptions.value = needle
      ? allKeys.value.filter((k) => k.label.toLowerCase().includes(needle))
      : allKeys.value;
  });
}

function filterValueFn(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase();
    filteredValueOptions.value = needle
      ? allValues.value.filter((v) => v.toLowerCase().includes(needle))
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

const sortBy = ref<string>("last_seen");
const sortDescending = ref<boolean>(true);

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

const onTableRequest = (props: any) => {
  const { sortBy: newSortBy, descending } = props.pagination;
  if (newSortBy && newSortBy !== sortBy.value) {
    sortBy.value = newSortBy;
    sortDescending.value = descending;
    pagination.value.page = 1;
  } else if (newSortBy && newSortBy === sortBy.value) {
    sortDescending.value = descending;
  }
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
    style: "width: 16.25rem; min-width: 16.25rem",
  },
  {
    name: "last_seen",
    label: t("settings.correlation.lastSeen"),
    field: "lastSeen",
    align: "right" as const,
    sortable: true,
    style: "width: 7.5rem; min-width: 7.5rem; padding-right: 1.25rem",
    headerStyle: "width: 7.5rem; min-width: 7.5rem; padding-right: 1.25rem",
  },
]);

// Group services by service_name
const serviceGroups = computed((): ServiceGroup[] => {
  const groupMap: Record<string, ServiceRecord[]> = {};
  for (const s of services.value) {
    if (!groupMap[s.service_name]) groupMap[s.service_name] = [];
    groupMap[s.service_name].push(s);
  }

  return Object.entries(groupMap)
    .map(([name, instances]) => {
      const allDimKeys = new Set<string>();
      for (const inst of instances) {
        for (const k of Object.keys(inst.disambiguation)) allDimKeys.add(k);
      }

      const shared: [string, string][] = [];
      const varying: string[] = [];
      for (const key of allDimKeys) {
        const values = new Set(
          instances.map((i) => i.disambiguation[key]).filter(Boolean),
        );
        if (values.size === 1) {
          shared.push([key, [...values][0]]);
        } else {
          varying.push(key);
        }
      }

      const allLogs = new Set<string>();
      const allTraces = new Set<string>();
      const allMetrics = new Set<string>();
      let latestSeen = 0;
      for (const inst of instances) {
        inst.logs_streams.forEach((s) => allLogs.add(s));
        inst.traces_streams.forEach((s) => allTraces.add(s));
        inst.metrics_streams.forEach((s) => allMetrics.add(s));
        if (inst.last_seen > latestSeen) latestSeen = inst.last_seen;
      }

      const correlationScore =
        (allLogs.size > 0 ? 1 : 0) +
        (allTraces.size > 0 ? 1 : 0) +
        (allMetrics.size > 0 ? 1 : 0);

      // Sort instances: highest correlation first, default set_id always last
      const sortedInstances = [...instances].sort((a, b) => {
        const aIsDefault = a.set_id === "default" ? 1 : 0;
        const bIsDefault = b.set_id === "default" ? 1 : 0;
        if (aIsDefault !== bIsDefault) return aIsDefault - bIsDefault;
        const scoreA =
          (a.logs_streams.length > 0 ? 1 : 0) +
          (a.traces_streams.length > 0 ? 1 : 0) +
          (a.metrics_streams.length > 0 ? 1 : 0);
        const scoreB =
          (b.logs_streams.length > 0 ? 1 : 0) +
          (b.traces_streams.length > 0 ? 1 : 0) +
          (b.metrics_streams.length > 0 ? 1 : 0);
        return scoreB - scoreA;
      });

      return {
        service_name: name,
        instances: sortedInstances,
        sharedDimensions: shared.sort(([a], [b]) => a.localeCompare(b)),
        varyingKeys: varying.sort(),
        totalLogs: allLogs.size,
        totalTraces: allTraces.size,
        totalMetrics: allMetrics.size,
        correlationScore,
        lastSeen: latestSeen,
      };
    })
    .sort((a, b) => b.lastSeen - a.lastSeen);
});

/** Filter instances within a group based on active key/value filter */
function filterInstances(instances: ServiceRecord[]): ServiceRecord[] {
  if (!filterKey.value || !filterValue.value) return instances;
  return instances.filter((inst) => {
    if (filterKey.value === "set_id") return inst.set_id === filterValue.value;
    const v = inst.disambiguation[filterKey.value!];
    return v === filterValue.value;
  });
}

const filteredGroups = computed((): ServiceGroup[] => {
  let groups = serviceGroups.value;

  // Filter by dimension key+value (including set_id)
  if (filterKey.value && filterValue.value) {
    groups = groups
      .map((g) => ({ ...g, instances: filterInstances(g.instances) }))
      .filter((g) => g.instances.length > 0);
  }

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    groups = groups.filter(
      (g) =>
        g.service_name.toLowerCase().includes(query) ||
        g.instances.some(
          (inst) =>
            inst.set_id.toLowerCase().includes(query) ||
            Object.entries(inst.disambiguation).some(
              ([k, v]) =>
                k.toLowerCase().includes(query) ||
                v.toLowerCase().includes(query),
            ) ||
            inst.logs_streams.some((stream) =>
              stream.toLowerCase().includes(query),
            ) ||
            inst.traces_streams.some((stream) =>
              stream.toLowerCase().includes(query),
            ) ||
            inst.metrics_streams.some((stream) =>
              stream.toLowerCase().includes(query),
            ),
        ),
    );
  }

  // Apply sorting
  if (sortBy.value) {
    groups = [...groups].sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortBy.value === "last_seen") {
        aVal = a.lastSeen || 0;
        bVal = b.lastSeen || 0;
      } else {
        aVal = (a as any)[sortBy.value];
        bVal = (b as any)[sortBy.value];
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        const result = aVal.localeCompare(bVal);
        return sortDescending.value ? -result : result;
      }
      const diff = aVal - bVal;
      return sortDescending.value ? -diff : diff;
    });
  }

  return groups;
});

const totalInstances = computed(() =>
  filteredGroups.value.reduce((sum, g) => sum + g.instances.length, 0),
);

const paginatedGroups = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.rowsPerPage;
  return filteredGroups.value.slice(
    start,
    start + pagination.value.rowsPerPage,
  );
});

const paginationScope = computed(() => ({
  pagination: {
    page: pagination.value.page,
    rowsPerPage: pagination.value.rowsPerPage,
    rowsNumber: filteredGroups.value.length,
  },
  pagesNumber: Math.ceil(
    filteredGroups.value.length / pagination.value.rowsPerPage,
  ),
  isFirstPage: pagination.value.page === 1,
  isLastPage:
    pagination.value.page >=
    Math.ceil(filteredGroups.value.length / pagination.value.rowsPerPage),
  firstPage: () => {
    pagination.value.page = 1;
  },
  prevPage: () => {
    if (pagination.value.page > 1) pagination.value.page--;
  },
  nextPage: () => {
    const maxPage = Math.ceil(
      filteredGroups.value.length / pagination.value.rowsPerPage,
    );
    if (pagination.value.page < maxPage) pagination.value.page++;
  },
  lastPage: () => {
    pagination.value.page = Math.ceil(
      filteredGroups.value.length / pagination.value.rowsPerPage,
    );
  },
}));

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
    "k8s-deployment": "badge-blue",
    "k8s-namespace": "badge-orange",
    "k8s-cluster": "badge-indigo",
    deployment: "badge-blue",
    namespace: "badge-orange",
    cluster: "badge-indigo",
    env: "badge-green",
    environment: "badge-green",
    host: "badge-purple",
    hostname: "badge-purple",
    service: "badge-cyan",
    service_name: "badge-cyan",
    region: "badge-pink",
    zone: "badge-pink",
    pod: "badge-teal",
    container: "badge-red",
    app: "badge-yellow",
    application: "badge-yellow",
  };

  if (colorMap[key]) return colorMap[key];

  const lowerKey = key.toLowerCase();
  for (const [pattern, className] of Object.entries(colorMap)) {
    if (lowerKey.includes(pattern)) return className;
  }

  const classes = ["badge-gray", "badge-amber", "badge-violet", "badge-rose"];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
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
      message: t("settings.correlation.resetServicesSuccess", {
        count: deleted_count,
      }),
      caption: note,
      timeout: 5000,
    });

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

/* Info banner */
.info-banner {
  padding: 0.75rem 1rem;
  background: rgba(59, 130, 246, 0.04);
  border: 1px solid rgba(59, 130, 246, 0.15);
}

.ds-dark .info-banner {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.25);
}

.info-banner-icon {
  color: #1d4ed8;
}

.ds-dark .info-banner-icon {
  color: #93c5fd;
}

.info-banner-text {
  color: #374151;
}

.ds-dark .info-banner-text {
  color: #d1d5db;
}

/* Services header bar */
.services-header-bar {
  padding: 0.75rem 1rem;
  height: 4.25rem;
}

/* Filter selects */
.filter-select {
  min-width: 10rem;
}

/* Table sizing */
.services-table {
  width: 100%;
}

.services-table-full-height {
  height: calc(100vh - 21.25rem);
}

/* Table cell overrides */
.td-last-seen {
  text-align: right;
  padding-right: 1.25rem;
}

.td-telemetry-instance {
  padding-left: 0;
  text-align: right;
}

.last-seen-text {
  color: #6b7280;
}

.ds-dark .last-seen-text {
  color: #9ca3af;
}

.no-dimensions-text {
  color: #9ca3af;
}

.ds-dark .no-dimensions-text {
  color: #6b7280;
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
  padding: 0.0625rem 0.5rem;
  border-radius: 0.625rem;
  font-size: 0.6875rem;
  font-weight: 500;
  background: #e5e7eb;
  color: #6b7280;
}

.ds-dark .instance-count-badge {
  background: #4b5563;
  color: #d1d5db;
}

/* set_id badge */
.set-id-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.0625rem 0.5rem;
  border-radius: 0.625rem;
  font-size: 0.6875rem;
  font-weight: 600;
  background: #ede9fe;
  color: #5b21b6;
  border: 1px solid #a78bfa;
  white-space: nowrap;
  flex-shrink: 0;
}

.ds-dark .set-id-badge {
  background: rgba(109, 40, 217, 0.2);
  color: #c4b5fd;
  border-color: #7c3aed;
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

/* Dimension badges — full values, no truncation */
.dimension-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.1875rem 0.625rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.dimension-badge-sm {
  padding: 0.125rem 0.5rem;
  font-size: 0.6875rem;
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
  padding: 0.25rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}

.telemetry-sm {
  padding: 0.1875rem 0.625rem;
  font-size: 0.75rem;
}

.telemetry-logs {
  border: 1px solid #1d4ed8;
}
.telemetry-traces {
  border: 1px solid #c2410c;
}
.telemetry-metrics {
  border: 1px solid #065f46;
}
.telemetry-inactive {
  border: 1px solid #9ca3af;
  color: #9ca3af;
}

/* Dimension color palette — border only */
.badge-blue {
  border: 1px solid #1d4ed8;
}
.badge-green {
  border: 1px solid #065f46;
}
.badge-yellow {
  border: 1px solid #92400e;
}
.badge-pink {
  border: 1px solid #9f1239;
}
.badge-purple {
  border: 1px solid #7c3aed;
}
.badge-orange {
  border: 1px solid #c2410c;
}
.badge-cyan {
  border: 1px solid #0e7490;
}
.badge-indigo {
  border: 1px solid #4f46e5;
}
.badge-teal {
  border: 1px solid #0f766e;
}
.badge-red {
  border: 1px solid #dc2626;
}
.badge-gray {
  border: 1px solid #4b5563;
}
.badge-amber {
  border: 1px solid #d97706;
}
.badge-violet {
  border: 1px solid #7c3aed;
}
.badge-rose {
  border: 1px solid #e11d48;
}

/* Dark mode */
.ds-dark .badge-more {
  background: #4b5563;
  color: #d1d5db;
}
.ds-dark .telemetry-logs {
  border-color: #93c5fd;
}
.ds-dark .telemetry-traces {
  border-color: #fdba74;
}
.ds-dark .telemetry-metrics {
  border-color: #6ee7b7;
}
.ds-dark .telemetry-inactive {
  border-color: #6b7280;
  color: #6b7280;
}
.ds-dark .badge-blue {
  border-color: #93c5fd;
}
.ds-dark .badge-green {
  border-color: #6ee7b7;
}
.ds-dark .badge-yellow {
  border-color: #fcd34d;
}
.ds-dark .badge-pink {
  border-color: #f9a8d4;
}
.ds-dark .badge-purple {
  border-color: #c4b5fd;
}
.ds-dark .badge-orange {
  border-color: #fdba74;
}
.ds-dark .badge-cyan {
  border-color: #67e8f9;
}
.ds-dark .badge-indigo {
  border-color: #a5b4fc;
}
.ds-dark .badge-teal {
  border-color: #5eead4;
}
.ds-dark .badge-red {
  border-color: #fca5a5;
}
.ds-dark .badge-gray {
  border-color: #d1d5db;
}
.ds-dark .badge-amber {
  border-color: #fbbf24;
}
.ds-dark .badge-violet {
  border-color: #c4b5fd;
}
.ds-dark .badge-rose {
  border-color: #fda4af;
}

/* Side panel */
.service-side-panel {
  width: 35rem;
  max-width: 95vw;
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 0 !important;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 1rem 1.25rem;
  flex-shrink: 0;
  border-bottom: 1px solid #e5e7eb;
}

.ds-dark .panel-header {
  border-bottom-color: #374151;
}

.panel-service-name {
  font-size: 1.125rem;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.01em;
}

.ds-dark .panel-service-name {
  color: #f9fafb;
}

.panel-warning-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.75rem 1.25rem;
  background: rgba(234, 179, 8, 0.08);
  border-bottom: 1px solid rgba(234, 179, 8, 0.25);
  color: #854d0e;
}

.ds-dark .panel-warning-banner {
  background: rgba(234, 179, 8, 0.1);
  border-bottom-color: rgba(234, 179, 8, 0.3);
  color: #fde68a;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.panel-block {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #f3f4f6;
}

.ds-dark .panel-block {
  border-bottom-color: #1f2937;
}

.panel-block-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: normal;
  color: #9ca3af;
  margin-bottom: 0.625rem;
}

.panel-empty-text {
  font-size: 0.8125rem;
  color: #9ca3af;
  font-style: italic;
}

.ds-dark .panel-empty-text {
  color: #6b7280;
}

.panel-signal-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.panel-signal-type {
  flex-shrink: 0;
  min-width: 3.75rem;
  justify-content: center;
  margin-top: 0.0625rem;
}

/* Clickable log stream badges */
.stream-nav-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.1875rem 0.625rem;
  border-radius: 0.3125rem;
  font-size: 0.75rem;
  font-family: monospace;
  cursor: pointer;
  border: none;
  transition:
    background 0.15s,
    color 0.15s;
}

.stream-nav-logs {
  background: rgba(29, 78, 216, 0.07);
  color: #1d4ed8;
  border: 1px solid rgba(29, 78, 216, 0.2);
}

.stream-nav-logs:hover {
  background: rgba(29, 78, 216, 0.15);
  border-color: #1d4ed8;
}

.ds-dark .stream-nav-logs {
  background: rgba(147, 197, 253, 0.1);
  color: #93c5fd;
  border-color: rgba(147, 197, 253, 0.25);
}

.ds-dark .stream-nav-logs:hover {
  background: rgba(147, 197, 253, 0.2);
  border-color: #93c5fd;
}

/* Field mapping grid */
.panel-mapping-grid {
  display: grid;
  grid-template-columns: auto 1.25rem auto;
  align-items: center;
  gap: 0.375rem 0.5rem;
}

.section-label {
  color: #6b7280;
}

.ds-dark .section-label {
  color: #9ca3af;
}

/* Stream sources matrix */
.streams-matrix {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.streams-matrix-row {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
}

.streams-matrix-type {
  flex-shrink: 0;
  width: 3.5rem;
  justify-content: center;
}

.stream-name-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.0625rem 0.4375rem;
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  font-family: monospace;
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #e5e7eb;
  white-space: nowrap;
}

.ds-dark .stream-name-badge {
  background: #1f2937;
  color: #d1d5db;
  border-color: #374151;
}

/* Field mapping */
.mapping-key {
  font-family: monospace;
  font-size: 0.6875rem;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.25rem;
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #e5e7eb;
  white-space: nowrap;
}

.mapping-val {
  font-family: monospace;
  font-size: 0.6875rem;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.25rem;
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
  white-space: nowrap;
}

.ds-dark .mapping-key {
  background: #1f2937;
  color: #d1d5db;
  border-color: #374151;
}

.ds-dark .mapping-val {
  background: rgba(6, 95, 70, 0.2);
  color: #6ee7b7;
  border-color: #065f46;
}

/* Instance telemetry — fixed columns wide enough for "Logs (99)" / "Traces (99)" / "Metrics (99)" */
.instance-telemetry-grid {
  display: inline-grid;
  grid-template-columns: minmax(4rem, auto) minmax(5rem, auto) minmax(
      5.75rem,
      auto
    );
  gap: 0.25rem;
  align-items: center;
  justify-items: start;
}

.telemetry-slot-empty {
  display: inline-block;
}

/* Prevent last-seen text from overlapping scrollbar */
:deep(td:last-child),
:deep(th:last-child) {
  padding-right: 1.5rem !important;
}


</style>
