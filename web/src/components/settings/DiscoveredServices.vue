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
    class="tw:flex tw:flex-col tw:w-full tw:h-full discovered-services"
    :class="{ 'ds-dark': store.state.theme === 'dark' }"
  >
    <!-- Loading State -->
    <div v-if="loading" class="tw:flex tw:flex-1 tw:items-center tw:justify-center">
      <OSpinner size="sm" data-test="discovered-services-loading-indicator" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="tw:flex tw:flex-col tw:flex-1 tw:items-center tw:justify-center tw:gap-3">
      <OIcon
        name="error-outline"
        class="tw:text-red-500" style="width: 3rem; height: 3rem;" />
      <div class="tw:text-base tw:text-red-500">{{ error }}</div>
      <OButton
        data-test="retry-discovered-services-btn"
        variant="outline"
        size="sm-action"
        @click="loadServices"
        icon-left="refresh"
      >
        {{ t("settings.correlation.retry") }}
      </OButton>
    </div>

    <!-- Empty State -->
    <div v-else-if="services.length === 0" class="tw:flex tw:flex-1 tw:items-center tw:justify-center">
      <OEmptyState
        size="hero"
        preset="no-discovered-services"
        :title="t('settings.correlation.noServicesYet')"
        :description="t('settings.correlation.noServicesDescription')"
        data-test="discovered-services-empty-state"
      >
        <template #actions>
          <OButton
            data-test="refresh-discovered-services-btn"
            variant="outline"
            size="sm-action"
            :loading="refreshing"
            @click="loadServices(true)"
            icon-left="refresh"
          >
            {{ t("common.refresh") }}
          </OButton>
        </template>
      </OEmptyState>
    </div>

    <!-- Services List -->
    <div v-else class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:pt-3">
      <!-- Info banner -->
      <div
        class="info-banner tw:shrink-0 tw:mb-3 tw:mx-4 tw:rounded-lg tw:flex tw:items-center tw:gap-3"
      >
        <OIcon
          name="info"
          size="md"
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
      <div class="card-container tw:shrink-0 tw:mb-[0.625rem]">
        <div
          class="services-header-bar tw:flex tw:justify-between tw:items-center tw:w-full"
        >
          <div
            class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]"
            data-test="services-list-title"
          >
            {{ t("settings.correlation.discoveredServicesTitle") }}
          </div>
          <!-- Filter bar -->
          <div class="tw:flex tw:items-center tw:gap-2">
            <span class="tw:text-md tw:text-gray-400 tw:whitespace-nowrap">{{
              t("settings.correlation.filterBy")
            }}</span>
            <OSelect
              v-model="filterKey"
              :options="allKeys"
              labelKey="label"
              valueKey="value"
              clearable
              searchable
              :placeholder="t('settings.correlation.selectFieldPlaceholder')"
              data-test="service-filter-key"
              class="o2-search-input filter-select"
              @update:model-value="filterValue = null"
            />
            <span>
              <OSelect
                v-model="filterValue"
                :options="allValues"
                clearable
                searchable
                :disabled="!filterKey"
                :placeholder="t('settings.correlation.selectValuePlaceholder')"
                data-test="service-filter-value"
                class="o2-search-input filter-select"
              />
              <OTooltip v-if="!filterKey" :content="t('settings.correlation.selectFieldFirst')" side="top" />
            </span>
            <OSearchInput
              v-model="searchQuery"
              :placeholder="t('settings.correlation.searchServiceName')"
              data-test="service-search-input"
              clearable
              class="o2-search-input"
            />
            <OButton
              data-test="reset-discovered-services-btn"
              variant="outline"
              size="sm"
              :loading="resetting"
              @click="confirmResetServices"
            >
              {{ t("settings.correlation.resetServices") }}
              <OTooltip :content="t('settings.correlation.resetServicesTooltip')" side="top" />
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
      <div class="tw:flex-1 tw:min-h-0">
        <div class="tw:h-full">
          <OTable
            :data="refreshing ? [] : filteredGroups"
            :columns="columns"
            :loading="refreshing"
            row-key="id"
            pagination="client"
            :page-size="pageSize"
            :page-size-options="[20, 50, 100, 250, 500]"
            sorting="client"
            filter-mode="client"
            :default-columns="false"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="settings-discovered-services"
            :show-global-filter="false"
            expansion="multi"
            :expand-on-row-click="(row: any) => row.__type === 'group'"
            :get-row-expansion-enabled="(row: any) => row.__type === 'group'"
            :keep-page-on-data-change="true"
            :current-page="currentPage"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky services-table"
            :class="filteredGroupCount > 0 ? 'services-table-full-height' : ''"
            data-test="services-list-table"
            @update:expanded-ids="syncExpansion"
            @row-click="handleRowClick"
            @pagination-change="({ page }: { page: number }) => currentPage = page"
          >
            <template #empty>
              <OEmptyState
                size="hero"
                preset="no-discovered-services"
                :filtered="!!searchQuery"
                :hide-action="!searchQuery"
                @action="(id) => id === 'clear-filters' && (searchQuery = '')"
              />
            </template>
            <template #cell-service_name="{ row }">
              <div v-if="row.__type === 'group'" class="tw:flex tw:items-center tw:gap-2">
                <span class="tw:font-semibold">{{ row.service_name }}</span>
                <span class="instance-count-badge">
                  {{ row.instances.length }}
                  {{
                    row.instances.length === 1
                      ? t("settings.correlation.instanceSingular")
                      : t("settings.correlation.instancePlural")
                  }}
                </span>
              </div>
              <div v-else class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                <span class="set-id-badge">{{ row.set_id }}</span>
                <span
                  v-for="[key, value] in Object.entries(
                    row.disambiguation,
                  ).sort(([a], [b]) => a.localeCompare(b))"
                  :key="`${key}=${value}`"
                  class="dimension-badge"
                  :class="getDimensionColorClass(key)"
                >
                  <span class="tw:font-medium">{{ key }}</span
                  >=<span>{{ value }}</span>
                </span>
                <span
                  v-if="Object.keys(row.disambiguation).length === 0"
                  class="tw:text-xs tw:italic no-dimensions-text"
                  >{{ t("settings.correlation.noDimensions") }}</span
                >
              </div>
            </template>
            <template #cell-telemetry="{ row }">
              <div v-if="row.__type === 'group'" class="instance-telemetry-grid">
                <span
                  v-if="row.totalLogs > 0"
                  class="telemetry-badge telemetry-logs"
                  >{{ t("settings.correlation.logs") }}</span
                >
                <span v-else class="telemetry-slot-empty"></span>
                <span
                  v-if="row.totalTraces > 0"
                  class="telemetry-badge telemetry-traces"
                  >{{ t("settings.correlation.traces") }}</span
                >
                <span v-else class="telemetry-slot-empty"></span>
                <span
                  v-if="row.totalMetrics > 0"
                  class="telemetry-badge telemetry-metrics"
                  >{{ t("settings.correlation.metrics") }}</span
                >
                <span v-else class="telemetry-slot-empty"></span>
              </div>
              <div v-else class="instance-telemetry-grid">
                <span
                  v-if="row.logs_streams.length > 0"
                  class="telemetry-badge telemetry-sm telemetry-logs"
                >
                  <OTooltip
                    :content="row.logs_streams.join(', ')"
                    content-class="tw:text-xs"
                  />
                  {{
                    t("settings.correlation.logsWithCount", {
                      count: row.logs_streams.length,
                    })
                  }}
                </span>
                <span v-else class="telemetry-slot-empty"></span>

                <span
                  v-if="row.traces_streams.length > 0"
                  class="telemetry-badge telemetry-sm telemetry-traces"
                >
                  <OTooltip
                    :content="row.traces_streams.join(', ')"
                    content-class="tw:text-xs"
                  />
                  {{
                    t("settings.correlation.tracesWithCount", {
                      count: row.traces_streams.length,
                    })
                  }}
                </span>
                <span v-else class="telemetry-slot-empty"></span>

                <span
                  v-if="row.metrics_streams.length > 0"
                  class="telemetry-badge telemetry-sm telemetry-metrics"
                >
                  <OTooltip
                    :content="row.metrics_streams.join(', ')"
                    content-class="tw:text-xs"
                  />
                  {{
                    t("settings.correlation.metricsWithCount", {
                      count: row.metrics_streams.length,
                    })
                  }}
                </span>
                <span v-else class="telemetry-slot-empty"></span>
              </div>
            </template>
            <template #cell-last_seen="{ row }">
              <span class="last-seen-text" :class="row.__type === 'group' ? 'tw:text-sm' : 'tw:text-xs'">{{
                formatRelativeTime(row.lastSeen)
              }}</span>
            </template>

            <!-- Bottom -->
            <template #bottom>
              <div
                class="bottom-btn tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[2.25rem]"
              >
                <div class="o2-table-footer-title tw:w-[15.625rem] tw:mr-md">
                  {{
                    filteredGroupCount === 1
                      ? t("settings.correlation.serviceCountSingular", {
                          count: filteredGroupCount,
                        })
                      : t("settings.correlation.serviceCountPlural", {
                          count: filteredGroupCount,
                        })
                  }}
                  {{
                    t("settings.correlation.instancesCount", {
                      count: totalInstances,
                    })
                  }}
                </div>
              </div>
            </template>
          </OTable>
        </div>
      </div>
    </div>

    <!-- Service detail side panel -->
    <ODrawer
      :open="!!selectedService"
      @update:open="
        (val) => {
          if (!val) selectedService = null;
        }
      "
      size="lg"
      :title="selectedService?.service_name"
      data-test="service-side-panel"
    >
      <template #header-right>
        <span class="set-id-badge">{{ selectedService?.set_id }}</span>
      </template>

      <!-- Default set warning banner -->
      <div
        v-if="selectedService?.set_id === 'default'"
        class="panel-warning-banner"
      >
        <OIcon name="info-outline" size="sm" class="tw:shrink-0 tw:mt-0.5" />
        <div class="tw:text-xs tw:leading-relaxed">
          <span class="tw:font-semibold">{{
            t("settings.correlation.defaultSetWarningTitle")
          }}</span>
          {{ t("settings.correlation.defaultSetWarningBody") }}
        </div>
      </div>

      <OSeparator />

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
              v-if="selectedService && selectedService.logs_streams.length > 0"
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
              <OIcon
                name="arrow-forward"
                size="xs"
                class="tw:text-gray-400 tw:justify-self-center"
              />
              <span class="mapping-val">{{ mapped }}</span>
            </template>
          </div>
        </div>
      </div>
    </ODrawer>

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
import { useI18n } from "vue-i18n";
import serviceStreamsService from "@/services/service_streams";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

const emit = defineEmits<{
  (e: "navigate-to-configuration"): void;
}>();

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
  correlationScore: number;
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
const expandedGroupNames = ref<Set<string>>(new Set());
const pageSize = ref(20);
const currentPage = ref(1);

watch([filterKey, filterValue, searchQuery], () => {
  currentPage.value = 1;
});

// Label override for internal field keys shown in the filter dropdown
const KEY_DISPLAY_LABELS: Record<string, string> = {
  set_id: t("settings.correlation.workload"),
};

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

const sortBy = ref<string>("lastSeen");
const sortDescending = ref<boolean>(true);

const columns: OTableColumnDef[] = [
  {
    id: "service_name",
    header: t("settings.correlation.serviceName"),
    accessorKey: "service_name",
    sortable: true,
    resizable: true,
    hideable: true,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "telemetry",
    header: t("settings.correlation.telemetryCoverage"),
    accessorKey: "telemetry",
    resizable: true,
    hideable: true,
    size: 260,
    meta: { align: "left" },
  },
  {
    id: "last_seen",
    header: t("settings.correlation.lastSeen"),
    accessorKey: "lastSeen",
    sortable: true,
    resizable: true,
    hideable: true,
    size: 120,
    meta: { align: "left" },
  },
];

function syncExpansion(ids: string[]) {
  expandedGroupNames.value = new Set(ids);
}

function handleRowClick(row: any) {
  if (row.__type !== 'group') {
    selectedService.value = row;
  }
}

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

function filterInstances(instances: ServiceRecord[]): ServiceRecord[] {
  if (!filterKey.value || !filterValue.value) return instances;
  return instances.filter((inst) => {
    if (filterKey.value === "set_id") return inst.set_id === filterValue.value;
    const v = inst.disambiguation[filterKey.value!];
    return v === filterValue.value;
  });
}

const filteredGroups = computed((): any[] => {
  let groups = serviceGroups.value;

  if (filterKey.value && filterValue.value) {
    groups = groups
      .map((g) => ({ ...g, instances: filterInstances(g.instances) }))
      .filter((g) => g.instances.length > 0);
  }

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
      if (sortBy.value === "lastSeen") {
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

  // Manually flatten: group rows + instance rows when expanded
  const result: any[] = [];
  for (const g of groups) {
    const groupRow = {
      id: g.service_name,
      __type: 'group',
      service_name: g.service_name,
      totalLogs: g.totalLogs,
      totalTraces: g.totalTraces,
      totalMetrics: g.totalMetrics,
      lastSeen: g.lastSeen,
      correlationScore: g.correlationScore,
      instances: g.instances,
    };
    result.push(groupRow);
    if (expandedGroupNames.value.has(g.service_name)) {
      for (const inst of g.instances) {
        result.push({
          ...inst,
          id: inst.id,
          __type: 'instance',
          lastSeen: inst.last_seen,
        });
      }
    }
  }
  return result;
});

const filteredGroupCount = computed(() =>
  filteredGroups.value.filter((r: any) => r.__type === 'group').length,
);

const totalInstances = computed(() =>
  filteredGroups.value.filter((r: any) => r.__type === 'group').reduce((sum: number, g: any) => sum + g.instances.length, 0),
);

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

    toast({
      variant: "success",
      message: t("settings.correlation.resetServicesSuccess", {
        count: deleted_count,
      }),
      caption: note,
      timeout: 5000,
    });

    await loadServices();
  } catch (err: any) {
    toast({
      variant: "error",
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

/* Dimension badges */
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

.badge-more {
  background: #e5e7eb;
  color: #6b7280;
  font-weight: 500;
}

/* Telemetry badges */
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

.telemetry-logs { border: 1px solid #1d4ed8; }
.telemetry-traces { border: 1px solid #c2410c; }
.telemetry-metrics { border: 1px solid #065f46; }
.telemetry-inactive { border: 1px solid #9ca3af; color: #9ca3af; }

/* Dimension color palette */
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

/* Instance telemetry grid */
.instance-telemetry-grid {
  display: inline-grid;
  grid-template-columns: minmax(4rem, auto) minmax(5rem, auto) minmax(5.75rem, auto);
  gap: 0.25rem;
  align-items: center;
  justify-items: start;
}

.telemetry-slot-empty {
  display: inline-block;
}

.bottom-btn {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
}


</style>
