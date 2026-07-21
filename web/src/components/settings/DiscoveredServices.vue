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
    class="flex flex-col w-full h-full bg-card-glass-bg discovered-services"
  >
    <!-- Loading State -->
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <OSpinner size="sm" data-test="discovered-services-loading-indicator" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex flex-col flex-1 items-center justify-center gap-3">
      <OIcon
        name="error-outline"
        class="text-status-error-text" style="width: 3rem; height: 3rem;" />
      <div class="text-base text-status-error-text">{{ error }}</div>
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
    <div v-else-if="services.length === 0" class="flex flex-1 items-center justify-center">
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
    <div v-else class="flex flex-col flex-1 min-h-0 pt-3">
      <!-- Info banner -->
      <div
        class="info-banner shrink-0 mb-3 mx-page-edge rounded-default flex items-center gap-3 py-3 px-4 bg-banner-info-bg border border-banner-info-border"
      >
        <OIcon
          name="info"
          size="md"
          class="shrink-0 info-banner-icon text-status-info-text"
        />
        <div
          class="text-sm leading-relaxed info-banner-text text-text-body"
        >
          {{ t("settings.correlation.discoveredServicesDescription") }}
          <a
            class="cursor-pointer inline-block mx-1 px-2 py-0.5 rounded-default text-xs font-semibold no-underline align-middle border border-text-link text-text-link bg-badge-blue-soft-bg transition-[background] duration-150 hover:bg-[color-mix(in_srgb,var(--color-badge-blue-ol-border)_18%,transparent)]"
            @click.prevent="$emit('navigate-to-configuration')"
            >{{ t("settings.correlation.goToConfiguration") }}</a
          >
          <span>{{ t("settings.correlation.configureServicesHint") }}</span>
        </div>
      </div>

      <!-- Header with title -->
      <div class="bg-card-glass-bg shrink-0 mb-2.5">
        <div
          class="services-header-bar flex justify-between items-center w-full py-3 px-page-edge h-[4.25rem]"
        >
          <div
            class="text-xl tracking-[0.005em] font-[600]"
            data-test="services-list-title"
          >
            {{ t("settings.correlation.discoveredServicesTitle") }}
          </div>
          <!-- Filter bar -->
          <div class="flex items-center gap-2">
            <span class="text-md text-text-muted whitespace-nowrap">{{
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
              class="o2-search-input filter-select min-w-40"
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
                class="o2-search-input filter-select min-w-40"
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
      <div class="flex-1 min-h-0">
        <div class="h-full">
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
            class="o2-table o2-row-md o2-table-header-sticky services-table w-full"
            :class="filteredGroupCount > 0 ? 'services-table-full-height h-[calc(100vh-21.25rem)]' : ''"
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
              <div v-if="row.__type === 'group'" class="flex items-center gap-2 ml-2">
                <span class="font-semibold">{{ row.service_name }}</span>
                <OTag type="countChip" value="neutral">
                  {{ row.instances.length }}
                  {{
                    row.instances.length === 1
                      ? t("settings.correlation.instanceSingular")
                      : t("settings.correlation.instancePlural")
                  }}
                </OTag>
              </div>
              <div v-else class="flex items-center gap-2 flex-wrap">
                <span class="set-id-badge inline-flex items-center py-[0.0625rem] px-2 rounded-default text-2xs font-semibold border whitespace-nowrap shrink-0 bg-badge-purple-soft-bg text-badge-purple-soft-text border-badge-purple-ol-border">{{ row.set_id }}</span>
                <ODimensionChip
                  v-for="[key, value] in Object.entries(
                    row.disambiguation,
                  ).sort(([a], [b]) => a.localeCompare(b))"
                  :key="`${key}=${value}`"
                  :dim-key="key"
                  :value="value"
                />
                <span
                  v-if="Object.keys(row.disambiguation).length === 0"
                  class="text-xs italic no-dimensions-text text-text-muted"
                  >{{ t("settings.correlation.noDimensions") }}</span
                >
              </div>
            </template>
            <template #cell-telemetry="{ row }">
              <div v-if="row.__type === 'group'" class="instance-telemetry-grid inline-grid grid-cols-[minmax(4rem,auto)_minmax(5rem,auto)_minmax(5.75rem,auto)] gap-1 items-center justify-items-start">
                <OTag
                  v-if="row.totalLogs > 0"
                  type="streamType"
                  :value="'logs'"
                />
                <span v-else class="telemetry-slot-empty inline-block"></span>
                <OTag
                  v-if="row.totalTraces > 0"
                  type="streamType"
                  :value="'traces'"
                />
                <span v-else class="telemetry-slot-empty inline-block"></span>
                <OTag
                  v-if="row.totalMetrics > 0"
                  type="streamType"
                  :value="'metrics'"
                />
                <span v-else class="telemetry-slot-empty inline-block"></span>
              </div>
              <div v-else class="instance-telemetry-grid inline-grid grid-cols-[minmax(4rem,auto)_minmax(5rem,auto)_minmax(5.75rem,auto)] gap-1 items-center justify-items-start">
                <span
                  v-if="row.logs_streams.length > 0"
                  class="inline-flex min-w-0"
                >
                  <OTag type="streamType" :value="'logs'">
                    {{
                      t("settings.correlation.logsWithCount", {
                        count: row.logs_streams.length,
                      })
                    }}
                  </OTag>
                  <OTooltip
                    :content="row.logs_streams.join(', ')"
                    content-class="text-xs"
                  />
                </span>
                <span v-else class="telemetry-slot-empty inline-block"></span>

                <span
                  v-if="row.traces_streams.length > 0"
                  class="inline-flex min-w-0"
                >
                  <OTag type="streamType" :value="'traces'">
                    {{
                      t("settings.correlation.tracesWithCount", {
                        count: row.traces_streams.length,
                      })
                    }}
                  </OTag>
                  <OTooltip
                    :content="row.traces_streams.join(', ')"
                    content-class="text-xs"
                  />
                </span>
                <span v-else class="telemetry-slot-empty inline-block"></span>

                <span
                  v-if="row.metrics_streams.length > 0"
                  class="inline-flex min-w-0"
                >
                  <OTag type="streamType" :value="'metrics'">
                    {{
                      t("settings.correlation.metricsWithCount", {
                        count: row.metrics_streams.length,
                      })
                    }}
                  </OTag>
                  <OTooltip
                    :content="row.metrics_streams.join(', ')"
                    content-class="text-xs"
                  />
                </span>
                <span v-else class="telemetry-slot-empty inline-block"></span>
              </div>
            </template>
            <template #cell-last_seen="{ row }">
              <OTimeCell
                :value="row.lastSeen"
                unit="us"
                :timezone="store.state.timezone"
                :class="row.__type === 'group' ? 'text-sm' : 'text-xs'"
              />
            </template>

            <!-- Bottom -->
            <template #bottom>
              <div
                class="flex items-center justify-between w-full h-9"
              >
                <div class="text-xs font-normal w-[15.625rem] mr-md">
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
      bleed
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
        <span class="set-id-badge inline-flex items-center py-[0.0625rem] px-2 rounded-default text-2xs font-semibold border whitespace-nowrap shrink-0 bg-badge-purple-soft-bg text-badge-purple-soft-text border-badge-purple-ol-border">{{ selectedService?.set_id }}</span>
      </template>

      <!-- Default set warning banner -->
      <div
        v-if="selectedService?.set_id === 'default'"
        class="panel-warning-banner flex items-start gap-2.5 py-3 px-5 bg-banner-warning-bg border-b border-b-banner-warning-border text-banner-warning-text"
      >
        <OIcon name="info-outline" size="sm" class="shrink-0 mt-0.5" />
        <div class="text-xs leading-relaxed">
          <span class="font-semibold">{{
            t("settings.correlation.defaultSetWarningTitle")
          }}</span>
          {{ t("settings.correlation.defaultSetWarningBody") }}
        </div>
      </div>

      <OSeparator />

      <!-- Scrollable body -->
      <div class="panel-body flex-1 overflow-y-auto p-0">
        <!-- Instance Identity -->
        <div class="panel-block py-4 px-5 border-b border-b-border-default">
          <div class="panel-block-label text-xs font-semibold normal-case tracking-normal text-text-label mb-2.5">
            {{ t("settings.correlation.instanceIdentity") }}
          </div>
          <div
            v-if="
              selectedService &&
              Object.keys(selectedService.disambiguation).length > 0
            "
            class="flex flex-wrap gap-1.5"
          >
            <ODimensionChip
              v-for="[key, value] in Object.entries(
                selectedService.disambiguation,
              ).sort(([a], [b]) => a.localeCompare(b))"
              :key="`${key}=${value}`"
              :dim-key="key"
              :value="value"
            />
          </div>
          <div v-else class="panel-empty-text text-compact text-text-muted italic">
            {{ t("settings.correlation.noDimensionsCatchAll") }}
          </div>
        </div>

        <!-- Stream Sources -->
        <div class="panel-block py-4 px-5 border-b border-b-border-default">
          <div class="panel-block-label text-xs font-semibold normal-case tracking-normal text-text-label mb-2.5">
            {{ t("settings.correlation.streamSources") }}
          </div>
          <div class="flex flex-col gap-3">
            <!-- Logs -->
            <div
              v-if="selectedService && selectedService.logs_streams.length > 0"
            >
              <div class="panel-signal-row flex items-start gap-3">
                <OTag
                  type="streamType"
                  :value="'logs'"
                  class="panel-signal-type"
                />
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="stream in selectedService.logs_streams"
                    :key="stream"
                    class="stream-name-badge inline-flex items-center py-[0.0625rem] px-[0.4375rem] rounded-default text-2xs font-mono border whitespace-nowrap bg-surface-subtle text-text-body border-border-default"
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
              <div class="panel-signal-row flex items-start gap-3">
                <OTag
                  type="streamType"
                  :value="'traces'"
                  class="panel-signal-type"
                />
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="stream in selectedService.traces_streams"
                    :key="stream"
                    class="stream-name-badge inline-flex items-center py-[0.0625rem] px-[0.4375rem] rounded-default text-2xs font-mono border whitespace-nowrap bg-surface-subtle text-text-body border-border-default"
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
              <div class="panel-signal-row flex items-start gap-3">
                <OTag
                  type="streamType"
                  :value="'metrics'"
                  class="panel-signal-type"
                />
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="stream in selectedService.metrics_streams"
                    :key="stream"
                    class="stream-name-badge inline-flex items-center py-[0.0625rem] px-[0.4375rem] rounded-default text-2xs font-mono border whitespace-nowrap bg-surface-subtle text-text-body border-border-default"
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
          class="panel-block py-4 px-5 border-b border-b-border-default"
        >
          <div class="panel-block-label text-xs font-semibold normal-case tracking-normal text-text-label mb-2.5">
            {{ t("settings.correlation.fieldNameMapping") }}
          </div>
          <div class="panel-mapping-grid">
            <template
              v-for="[raw, mapped] in Object.entries(
                selectedService.field_name_mapping ?? {},
              ).sort(([a], [b]) => a.localeCompare(b))"
              :key="raw"
            >
              <span class="mapping-key font-mono text-2xs py-[0.0625rem] px-1.5 rounded-default border whitespace-nowrap bg-surface-subtle text-text-body border-border-default">{{ raw }}</span>
              <OIcon
                name="arrow-forward"
                size="xs"
                class="text-text-muted justify-self-center"
              />
              <span class="mapping-val font-mono text-2xs py-[0.0625rem] px-1.5 rounded-default border whitespace-nowrap bg-badge-success-soft-bg text-badge-success-soft-text border-badge-success-ol-border">{{ mapped }}</span>
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
import OTag from "@/lib/core/Badge/OTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
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
      throw new Error(t("settings.discoveredServices.noOrganizationSelected"));
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
    error.value = err?.message || t("settings.discoveredServices.failedToLoadServices");
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
      throw new Error(t("settings.discoveredServices.noOrganizationSelected"));
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

