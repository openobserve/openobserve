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
  <div class="bg-card-glass-bg flex h-full min-h-0 flex-col">
    <div
      class="border-border-default flex shrink-0 flex-nowrap items-center gap-1.5 border-b p-1.5"
    >
      <div class="max-w-36 min-w-0 flex-1">
        <OSelect
          v-model="selectedStream"
          :label="t('profiles.stream')"
          label-position="inside"
          :options="streamOptions"
          :disabled="!streamOptions.length"
          class="w-full"
          data-test="profiles-stream-select"
        />
      </div>
      <div class="max-w-36 min-w-0 flex-1">
        <OSelect
          v-model="selectedService"
          :label="t('profiles.service')"
          label-position="inside"
          :options="serviceOptions"
          class="w-full"
          data-test="profiles-service-select"
        />
      </div>
      <div class="max-w-44 min-w-0 flex-1">
        <OSelect
          v-model="selectedProfileType"
          :label="t('profiles.profileType')"
          label-position="inside"
          :options="profileTypeOptions"
          class="w-full"
          data-test="profiles-type-select"
        />
      </div>
      <div class="max-w-36 min-w-0 flex-1">
        <OSelect
          v-model="draftTagKey"
          :label="t('profiles.tagKey')"
          label-position="inside"
          :options="tagKeyOptions"
          :disabled="!tagKeyOptions.length"
          clearable
          class="w-full"
          data-test="profiles-tag-key-select"
        />
      </div>
      <div class="max-w-36 min-w-0 flex-1">
        <OSelect
          v-model="draftTagValue"
          :label="t('profiles.tagValue')"
          label-position="inside"
          :options="tagValueOptions"
          :disabled="!draftTagKey || tagValuesLoading"
          :loading="tagValuesLoading"
          clearable
          class="w-full"
          data-test="profiles-tag-value-select"
        />
      </div>
      <OButton
        class="shrink-0"
        variant="outline"
        size="sm-toolbar"
        icon-left="add"
        :disabled="!canAddFilter"
        data-test="profiles-add-filter"
        @click="addFilter"
      >
        {{ t("profiles.addFilter") }}
      </OButton>

      <div class="ms-auto flex shrink-0 items-center gap-2">
        <DateTimePickerDashboard v-model="dateState" />
        <OButton
          variant="primary"
          size="sm-toolbar"
          icon-left="search"
          :loading="queryLoading"
          :disabled="queryLoading || !canQuery"
          data-test="profiles-run-query"
          @click="runQuery"
        >
          {{ t("profiles.runQuery") }}
        </OButton>
      </div>
    </div>

    <div
      v-if="appliedFilters.length"
      class="border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b px-1.5 py-1.5"
      data-test="profiles-applied-filters"
    >
      <OTag
        v-for="filter in appliedFilters"
        :key="`${filter.key}=${filter.value}`"
        type="fieldTag"
        value="primarysm"
        class="max-w-62.5"
        :data-test="`profiles-filter-chip-${filter.key}`"
      >
        <span class="truncate font-mono text-xs">{{ filter.key }} = {{ filter.value }}</span>
        <template #trailing>
          <button
            type="button"
            class="ms-1 inline-flex cursor-pointer items-center"
            :aria-label="t('profiles.removeFilter', { key: filter.key, value: filter.value })"
            :data-test="`profiles-filter-remove-${filter.key}`"
            @click.stop="removeFilter(filter)"
          >
            <OIcon name="close" size="xs" />
          </button>
        </template>
      </OTag>
    </div>

    <div
      class="min-h-0 flex-1 overflow-y-auto"
      :class="!hasProfileData && streamOptions.length ? 'flex flex-col' : ''"
    >
      <div
        v-if="errorMessage"
        class="bg-surface-panel border-border-default text-status-error-text rounded-default m-2.5 border p-3 text-sm"
        data-test="profiles-error"
      >
        {{ errorMessage }}
      </div>

      <div
        v-if="!streamOptions.length"
        class="bg-surface-panel border-border-default rounded-default m-2.5 border p-6 text-center"
        data-test="profiles-no-stream"
      >
        {{ t("profiles.noStreams") }}
      </div>

      <div
        v-else-if="queryLoading && !hasProfileData"
        class="text-text-secondary flex flex-1 flex-col items-center justify-center gap-2.5 opacity-80"
        data-test="profiles-loading"
      >
        <OSpinner size="lg" />
        <span>{{ t("profiles.loading") }}</span>
      </div>

      <div
        v-else-if="!hasProfileData"
        class="flex min-h-0 flex-1 flex-col items-center justify-center p-3"
        data-test="profiles-no-results"
      >
        <OEmptyState preset="no-profiles" size="block" :hide-action="true" />
      </div>

      <OContent v-else class="flex flex-col gap-2.5 py-2.5">
        <section class="bg-surface-panel border-border-default rounded-default border">
          <header class="border-border-default border-b px-3 py-2 text-sm font-semibold">
            {{ t("profiles.timeSeriesTitle") }}
          </header>
          <div class="h-36 p-3">
            <ChartRenderer
              v-if="seriesPoints.length"
              :data="seriesChartData"
              class="h-full w-full"
            />
            <div
              v-else
              class="text-text-secondary flex h-full items-center justify-center text-sm"
              data-test="profiles-no-series"
            >
              {{ t("profiles.noSeries") }}
            </div>
          </div>
        </section>

        <section class="bg-surface-panel border-border-default rounded-default border">
          <header
            class="border-border-default flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
          >
            <div class="text-sm font-semibold">{{ t("profiles.resultTitle") }}</div>
            <div class="flex flex-wrap items-center gap-2">
              <div class="w-56">
                <OSearchInput
                  v-model="searchQuery"
                  :placeholder="t('profiles.searchFrames')"
                  data-test="profiles-search-frames"
                />
              </div>
              <div class="flex items-center gap-1">
                <OButton
                  :variant="activeView === 'top' ? 'primary' : 'ghost'"
                  size="sm"
                  data-test="profiles-view-top"
                  @click="activeView = 'top'"
                >
                  {{ t("profiles.viewTop") }}
                </OButton>
                <OButton
                  :variant="activeView === 'flame' ? 'primary' : 'ghost'"
                  size="sm"
                  data-test="profiles-view-flame"
                  @click="activeView = 'flame'"
                >
                  {{ t("profiles.viewFlame") }}
                </OButton>
                <OButton
                  :variant="activeView === 'tree' ? 'primary' : 'ghost'"
                  size="sm"
                  data-test="profiles-view-tree"
                  @click="activeView = 'tree'"
                >
                  {{ t("profiles.viewTree") }}
                </OButton>
              </div>
            </div>
          </header>
          <div class="p-3">
            <div v-if="activeView === 'top'" class="overflow-auto">
              <table class="w-full table-fixed text-sm">
                <thead class="bg-surface-page text-left">
                  <tr>
                    <th class="min-w-0 px-2 py-1">{{ t("function.header") }}</th>
                    <th class="w-40 px-2 py-1 text-right">
                      <button
                        type="button"
                        class="hover:text-text-body inline-flex cursor-pointer items-center gap-1"
                        :aria-label="t('profiles.sortBySelf')"
                        data-test="profiles-sort-self"
                        @click="toggleTopSort('self')"
                      >
                        {{ valueColumnLabel(t("profiles.self")) }}
                        <span v-if="topSortKey === 'self'" class="text-text-secondary">{{
                          topSortAsc ? "↑" : "↓"
                        }}</span>
                      </button>
                    </th>
                    <th class="w-40 px-2 py-1 text-right">
                      <button
                        type="button"
                        class="hover:text-text-body inline-flex cursor-pointer items-center gap-1"
                        :aria-label="t('profiles.sortByTotal')"
                        data-test="profiles-sort-total"
                        @click="toggleTopSort('total')"
                      >
                        {{ valueColumnLabel(t("profiles.total")) }}
                        <span v-if="topSortKey === 'total'" class="text-text-secondary">{{
                          topSortAsc ? "↑" : "↓"
                        }}</span>
                      </button>
                    </th>
                    <th class="w-16 px-2 py-1 text-right">{{ t("profiles.percent") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in topRows"
                    :key="row.name"
                    class="border-border-default hover:bg-table-row-hover-bg border-t"
                  >
                    <td class="max-w-0 px-2 py-1 font-mono text-xs">
                      <span class="block truncate" v-html="highlightName(row.name)" />
                      <OTooltip
                        :content="raw(row.name)"
                        side="top"
                        align="start"
                        hoverable
                        max-width="40rem"
                        content-class="font-mono text-xs break-all"
                      />
                    </td>
                    <td class="px-2 py-1 text-right whitespace-nowrap">
                      {{ formatTableValue(row.self) }}
                    </td>
                    <td class="px-2 py-1 text-right whitespace-nowrap">
                      {{ formatTableValue(row.total) }}
                    </td>
                    <td class="px-2 py-1 text-right whitespace-nowrap">
                      {{ formatPercent(row.total, mergeResult?.total ?? 0) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-else-if="activeView === 'flame'" class="overflow-auto">
              <CommonFlameGraph
                :root="mergeResult?.root ?? null"
                :summary-label="t('profiles.total')"
                :summary-value="formatTableValue(mergeResult?.total ?? 0)"
                :unit-label="tableUnitLabel"
                :empty-label="t('profiles.noProfilesFound')"
                :value-formatter="formatTableValue"
                :search-query="searchQuery"
              />
            </div>

            <div v-else class="overflow-auto">
              <table class="w-full table-fixed text-sm">
                <thead class="bg-surface-page text-left">
                  <tr>
                    <th class="min-w-0 px-2 py-1">{{ t("function.header") }}</th>
                    <th class="w-40 px-2 py-1 text-right">
                      {{ valueColumnLabel(t("profiles.self")) }}
                    </th>
                    <th class="w-40 px-2 py-1 text-right">
                      {{ valueColumnLabel(t("profiles.total")) }}
                    </th>
                    <th class="w-16 px-2 py-1 text-right">{{ t("profiles.percent") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in visibleStackRows"
                    :key="row.id"
                    class="border-border-default hover:bg-table-row-hover-bg border-t"
                    :data-test="`profiles-stack-row-${row.id}`"
                  >
                    <td class="max-w-0 px-2 py-1 font-mono text-xs">
                      <button
                        type="button"
                        class="inline-flex max-w-full min-w-0 items-center gap-1 text-start"
                        :class="row.hasChildren ? 'cursor-pointer' : 'cursor-default'"
                        :style="{ paddingInlineStart: `${row.depth}rem` }"
                        :aria-expanded="
                          row.hasChildren ? expandedStackNodeIds.has(row.id) : undefined
                        "
                        @click="row.hasChildren && toggleStackNode(row.id)"
                      >
                        <span
                          class="text-text-secondary inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs"
                          aria-hidden="true"
                        >
                          <template v-if="row.hasChildren">
                            {{ expandedStackNodeIds.has(row.id) ? "▾" : "▸" }}
                          </template>
                        </span>
                        <span class="min-w-0 truncate" v-html="highlightName(row.name)" />
                      </button>
                      <OTooltip
                        :content="raw(row.name)"
                        side="top"
                        align="start"
                        hoverable
                        max-width="40rem"
                        content-class="font-mono text-xs break-all"
                      />
                    </td>
                    <td class="px-2 py-1 text-right whitespace-nowrap">
                      {{ formatTableValue(row.self) }}
                    </td>
                    <td class="px-2 py-1 text-right whitespace-nowrap">
                      {{ formatTableValue(row.total) }}
                    </td>
                    <td class="px-2 py-1 text-right whitespace-nowrap">
                      {{ formatPercent(row.total, mergeResult?.total ?? 0) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </OContent>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useStore } from "vuex";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import CommonFlameGraph from "@/components/common/FlameGraphView.vue";
import streamService from "@/services/stream";
import profilesService, {
  type ProfileFilter,
  type ProfilesMergeResponse,
  type ProfilesQueryBody,
  type ProfilesSeriesResponse,
  type ProfilesTreeNode,
} from "@/services/profiles";
import { getConsumableRelativeTime } from "@/utils/date";
import { escapeHtml } from "@/utils/html";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

type SelectOption = { label: I18nText; value: string };
type ProfileView = "top" | "flame" | "tree";
type TopSortKey = "self" | "total";
type StackRow = {
  id: string;
  depth: number;
  name: string;
  self: number;
  total: number;
  hasChildren: boolean;
};

const { t } = useI18nTyped();
const store = useStore();

const dateState = ref({
  startTime: 0,
  endTime: 0,
  relativeTimePeriod: "15m",
  valueType: "relative",
});
const streamOptions = ref<SelectOption[]>([]);
const selectedStream = ref<string | null>(null);
const selectedService = ref<string | null>(null);
const selectedProfileType = ref<string | null>(null);
const draftTagKey = ref<string | null>(null);
const draftTagValue = ref<string | null>(null);
const tagValueOptions = ref<SelectOption[]>([]);
const tagValuesLoading = ref(false);
const appliedFilters = ref<ProfileFilter[]>([]);
const searchQuery = ref("");
const topSortKey = ref<TopSortKey>("total");
const topSortAsc = ref(false);
const activeView = ref<ProfileView>("top");
const expandedStackNodeIds = ref<Set<string>>(new Set());

const metaResponse = ref<{
  services: string[];
  profile_types: Array<{ type: string; unit: string }>;
  label_names: string[];
} | null>(null);
const seriesResponse = ref<ProfilesSeriesResponse | null>(null);
const mergeResult = ref<ProfilesMergeResponse | null>(null);

const queryLoading = ref(false);
const errorMessage = ref("");
let metaRequestSeq = 0;
let queryRequestSeq = 0;
let tagValuesRequestSeq = 0;

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier as string | undefined,
);

const serviceOptions = computed<SelectOption[]>(() =>
  (metaResponse.value?.services ?? []).map((value) => ({ label: raw(value), value })),
);
const profileTypeOptions = computed<SelectOption[]>(() =>
  (metaResponse.value?.profile_types ?? []).map((item) => ({
    label: raw(`${item.type} (${seriesUnitLabel(item.type, item.unit)})`),
    value: `${item.type}\u0000${item.unit}`,
  })),
);
const tagKeyOptions = computed<SelectOption[]>(() =>
  (metaResponse.value?.label_names ?? []).map((value) => ({ label: raw(value), value })),
);
const currentProfileType = computed(() => {
  const selected = selectedProfileType.value;
  if (!selected) return null;
  const [type, unit = ""] = selected.split("\u0000");
  if (!type) return null;
  return { type, unit };
});
const canQuery = computed(
  () => !!orgIdentifier.value && !!selectedStream.value && !!currentProfileType.value,
);
const hasProfileData = computed(() => (mergeResult.value?.total ?? 0) > 0);
const canAddFilter = computed(
  () => !!draftTagKey.value && !!draftTagValue.value && !queryLoading.value,
);
const seriesPoints = computed(() => seriesResponse.value?.series ?? []);
const seriesStepSecs = computed(() => Math.max(1, seriesResponse.value?.step_secs ?? 1));
const currentUnit = computed(
  () => currentProfileType.value?.unit || seriesResponse.value?.unit || "",
);
const currentType = computed(
  () => currentProfileType.value?.type || seriesResponse.value?.profile_type || "",
);
const isCpuMetric = computed(
  () => currentType.value.toLowerCase() === "cpu" && /nano/i.test(currentUnit.value),
);

const seriesChartData = computed(() => {
  const unit = seriesUnitLabel(currentType.value, currentUnit.value);
  const seriesData = seriesPoints.value.map((point) => [
    Math.floor(point.timestamp / 1000),
    seriesDisplayValue(point.value),
  ]);
  return {
    options: {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => formatSeriesValue(v as number),
      },
      grid: { left: 36, right: 16, top: 24, bottom: 30 },
      xAxis: { type: "time" },
      yAxis: {
        type: "value",
        name: unit,
        axisLabel: { formatter: (v: number) => formatSeriesAxisLabel(v) },
      },
      series: [
        {
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.12 },
          data: seriesData,
        },
      ],
    },
  };
});
const topRows = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  const rows = [...(mergeResult.value?.top ?? [])].filter((row) =>
    needle ? row.name.toLowerCase().includes(needle) : true,
  );
  const key = topSortKey.value;
  const direction = topSortAsc.value ? 1 : -1;
  rows.sort((a, b) => {
    const delta = a[key] - b[key];
    if (delta !== 0) return delta * direction;
    return a.name.localeCompare(b.name);
  });
  return rows.slice(0, 200);
});
const stackRows = computed<StackRow[]>(() => {
  const root = mergeResult.value?.root;
  if (!root) return [];
  const rows: StackRow[] = [];
  const walk = (node: ProfilesTreeNode, depth: number, nodeId: string) => {
    const children = [...(node.children ?? [])].sort((a, b) => b.total - a.total);
    rows.push({
      id: nodeId,
      depth,
      name: node.name,
      self: node.self,
      total: node.total,
      hasChildren: children.length > 0,
    });
    for (const [index, child] of children.entries()) {
      walk(child, depth + 1, `${nodeId}/${index}`);
    }
  };
  walk(root, 0, "root");
  return rows;
});
const visibleStackRows = computed<StackRow[]>(() => {
  const visibleRows: StackRow[] = [];
  const hiddenPrefixes: string[] = [];
  for (const row of stackRows.value) {
    const hidden = hiddenPrefixes.some((prefix) => row.id.startsWith(`${prefix}/`));
    if (hidden) continue;
    visibleRows.push(row);
    if (row.hasChildren && !expandedStackNodeIds.value.has(row.id)) {
      hiddenPrefixes.push(row.id);
    }
  }
  return visibleRows;
});

const seriesUnitLabel = (profileType: string, unit: string) => {
  if (profileType.toLowerCase() === "cpu" && /nano/i.test(unit)) return "cores";
  if (/nanosecond|^ns$/i.test(unit)) return "nanoseconds";
  if (/byte|^b$/i.test(unit)) return "bytes";
  if (!unit) return "count";
  return unit;
};

const valueColumnLabel = (title: string) => `${title} (${tableUnitLabel.value})`;

const tableUnitLabel = computed(() => {
  if (isCpuMetric.value) return t("profiles.cpuDuration");
  return seriesUnitLabel(currentType.value, currentUnit.value);
});

const formatBytes = (value: number) => {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let current = Math.abs(value);
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  const signed = value < 0 ? -current : current;
  return `${signed.toLocaleString(undefined, { maximumFractionDigits: current >= 100 ? 0 : 2 })} ${units[index]}`;
};

const formatDurationNanos = (value: number) => {
  const abs = Math.abs(value);
  if (abs < 1_000) return `${value.toLocaleString()} ns`;
  if (abs < 1_000_000)
    return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} µs`;
  if (abs < 1_000_000_000) {
    return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ms`;
  }
  if (abs < 60_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
  }
  if (abs < 3_600_000_000_000) {
    return `${(value / 60_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} min`;
  }
  return `${(value / 3_600_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
};

const formatTableValue = (value: number) => {
  if (isCpuMetric.value) return formatDurationNanos(value);
  if (/byte|^b$/i.test(currentUnit.value)) return formatBytes(value);
  if (/nanosecond|^ns$/i.test(currentUnit.value)) return formatDurationNanos(value);
  return Number(value || 0).toLocaleString();
};

const seriesDisplayValue = (value: number) => {
  if (!isCpuMetric.value) return value;
  return value / (seriesStepSecs.value * 1_000_000_000);
};

const formatCpuCore = (value: number) => {
  const abs = Math.abs(value);
  if (abs === 0) return "0 cores";
  if (abs < 0.001) {
    const mcore = value * 1_000;
    const digits = Math.abs(mcore) < 10 ? 3 : 2;
    return `${mcore.toLocaleString(undefined, { maximumFractionDigits: digits })} mcore`;
  }
  const digits = abs < 0.01 ? 6 : abs < 0.1 ? 5 : abs < 1 ? 4 : 3;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} cores`;
};

const formatSeriesAxisLabel = (value: number) => {
  if (isCpuMetric.value) return formatCpuCore(value);
  if (/byte|^b$/i.test(currentUnit.value)) return formatBytes(value);
  if (/nanosecond|^ns$/i.test(currentUnit.value)) return formatDurationNanos(value);
  return Number(value).toLocaleString();
};

const formatSeriesValue = (value: number) => {
  if (isCpuMetric.value) return formatCpuCore(value);
  if (/byte|^b$/i.test(currentUnit.value)) return formatBytes(value);
  if (/nanosecond|^ns$/i.test(currentUnit.value)) return formatDurationNanos(value);
  return `${Number(value).toLocaleString()} ${seriesUnitLabel(currentType.value, currentUnit.value)}`.trim();
};

const formatPercent = (value: number, total: number) =>
  total > 0 ? `${((value / total) * 100).toFixed(2)}%` : "0.00%";

const highlightName = (name: string) => {
  const query = searchQuery.value.trim();
  if (!query) return escapeHtml(name);
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let html = "";
  let cursor = 0;
  while (cursor < name.length) {
    const matchAt = lowerName.indexOf(lowerQuery, cursor);
    if (matchAt === -1) {
      html += escapeHtml(name.slice(cursor));
      break;
    }
    html += escapeHtml(name.slice(cursor, matchAt));
    html += `<mark class="bg-status-warning-bg text-text-body rounded-default px-0.5">${escapeHtml(
      name.slice(matchAt, matchAt + query.length),
    )}</mark>`;
    cursor = matchAt + query.length;
  }
  return html;
};

const toggleTopSort = (key: TopSortKey) => {
  if (topSortKey.value === key) {
    topSortAsc.value = !topSortAsc.value;
    return;
  }
  topSortKey.value = key;
  topSortAsc.value = false;
};

const toggleStackNode = (nodeId: string) => {
  if (!nodeId) return;
  const next = new Set(expandedStackNodeIds.value);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  expandedStackNodeIds.value = next;
};

const resetStackExpansion = (root?: ProfilesTreeNode) => {
  if (root?.children?.length) {
    expandedStackNodeIds.value = new Set(["root"]);
    return;
  }
  expandedStackNodeIds.value = new Set();
};

const resolveTimeRange = () => {
  if (dateState.value.valueType === "relative") {
    return getConsumableRelativeTime(dateState.value.relativeTimePeriod) ?? null;
  }
  if (dateState.value.startTime > 0 && dateState.value.endTime > 0) {
    return { startTime: dateState.value.startTime, endTime: dateState.value.endTime };
  }
  return getConsumableRelativeTime("15m") ?? null;
};

const queryPayload = (range = resolveTimeRange()): ProfilesQueryBody | null => {
  const profileType = currentProfileType.value;
  if (!range || !profileType) return null;
  return {
    start_time: range.startTime,
    end_time: range.endTime,
    service_name: selectedService.value || undefined,
    profile_type: profileType.type,
    profile_unit: profileType.unit,
    filters: appliedFilters.value.map((filter) => ({ ...filter })),
  };
};

const buildErrorMessage = (error: unknown): string => {
  const err = error as {
    response?: { data?: { message?: string; error?: string } };
    message?: string;
  };
  return (
    err.response?.data?.message ||
    err.response?.data?.error ||
    err.message ||
    t("profiles.errors.loadFailed")
  );
};

const clearDraftTag = () => {
  draftTagKey.value = null;
  draftTagValue.value = null;
  tagValueOptions.value = [];
};

const resetProfilesState = () => {
  selectedService.value = null;
  selectedProfileType.value = null;
  appliedFilters.value = [];
  searchQuery.value = "";
  topSortKey.value = "total";
  topSortAsc.value = false;
  clearDraftTag();
  seriesResponse.value = null;
  mergeResult.value = null;
  expandedStackNodeIds.value = new Set();
  activeView.value = "top";
  errorMessage.value = "";
};

const addFilter = async () => {
  const key = draftTagKey.value;
  const value = draftTagValue.value;
  if (!key || !value) return;
  const exists = appliedFilters.value.some(
    (filter) => filter.key === key && filter.value === value,
  );
  if (!exists) {
    appliedFilters.value = [...appliedFilters.value, { key, op: "=", value }];
  }
  draftTagValue.value = null;
  await runQuery();
};

const removeFilter = async (filter: ProfileFilter) => {
  appliedFilters.value = appliedFilters.value.filter(
    (item) => !(item.key === filter.key && item.value === filter.value),
  );
  await runQuery();
};

const loadTagValues = async () => {
  const org = orgIdentifier.value;
  const stream = selectedStream.value;
  const tag = draftTagKey.value;
  const range = resolveTimeRange();
  const profileType = currentProfileType.value;
  if (!org || !stream || !tag || !range) {
    tagValueOptions.value = [];
    return;
  }
  const requestSeq = ++tagValuesRequestSeq;
  tagValuesLoading.value = true;
  try {
    const response = await profilesService.tagValues(org, stream, {
      start_time: range.startTime,
      end_time: range.endTime,
      service_name: selectedService.value || undefined,
      profile_type: profileType?.type,
      profile_unit: profileType?.unit,
      filters: appliedFilters.value.map((filter) => ({ ...filter })),
      tag,
    });
    if (requestSeq !== tagValuesRequestSeq) return;
    tagValueOptions.value = (response.data.values ?? []).map((value) => ({
      label: raw(value),
      value,
    }));
    if (
      draftTagValue.value &&
      !tagValueOptions.value.some((option) => option.value === draftTagValue.value)
    ) {
      draftTagValue.value = null;
    }
  } catch (error) {
    if (requestSeq !== tagValuesRequestSeq) return;
    tagValueOptions.value = [];
    errorMessage.value = buildErrorMessage(error);
  } finally {
    if (requestSeq === tagValuesRequestSeq) {
      tagValuesLoading.value = false;
    }
  }
};

const loadStreams = async () => {
  const org = orgIdentifier.value;
  if (!org) return;
  const response = await streamService.nameList(org, "profiles", false);
  const list = Array.isArray(response?.data?.list) ? response.data.list : [];
  streamOptions.value = list
    .map((item: Record<string, unknown>) => String(item.name ?? item.stream_name ?? ""))
    .filter((name: string) => name.length > 0)
    .map((name: string) => ({ label: raw(name), value: name }));
  if (!streamOptions.value.length) {
    selectedStream.value = null;
    return;
  }
  if (
    !selectedStream.value ||
    !streamOptions.value.some((opt) => opt.value === selectedStream.value)
  ) {
    selectedStream.value = streamOptions.value[0].value;
  }
};

const loadMeta = async () => {
  const org = orgIdentifier.value;
  const stream = selectedStream.value;
  const range = resolveTimeRange();
  if (!org || !stream || !range) return;
  const requestSeq = ++metaRequestSeq;
  try {
    const response = await profilesService.meta(org, stream, {
      start_time: range.startTime,
      end_time: range.endTime,
    });
    if (requestSeq !== metaRequestSeq) return;
    metaResponse.value = response.data;
    const firstService = serviceOptions.value[0]?.value ?? null;
    const firstProfileType = profileTypeOptions.value[0]?.value ?? null;

    if (
      !selectedService.value ||
      !serviceOptions.value.some((item) => item.value === selectedService.value)
    ) {
      selectedService.value = firstService;
    }
    if (
      !selectedProfileType.value ||
      !profileTypeOptions.value.some((item) => item.value === selectedProfileType.value)
    ) {
      selectedProfileType.value = firstProfileType;
    }
    if (
      draftTagKey.value &&
      !tagKeyOptions.value.some((item) => item.value === draftTagKey.value)
    ) {
      clearDraftTag();
    }
  } catch (error) {
    if (requestSeq !== metaRequestSeq) return;
    errorMessage.value = buildErrorMessage(error);
  }
};

const runQuery = async () => {
  const org = orgIdentifier.value;
  const stream = selectedStream.value;
  const range = resolveTimeRange();
  const payload = queryPayload(range);
  if (!org || !stream || !payload) return;
  const requestSeq = ++queryRequestSeq;
  queryLoading.value = true;
  errorMessage.value = "";
  try {
    const [seriesResult, mergeResponseValue] = await Promise.all([
      profilesService.series(org, stream, payload),
      profilesService.merge(org, stream, { ...payload, max_nodes: 4096 }),
    ]);
    if (requestSeq !== queryRequestSeq) return;
    seriesResponse.value = seriesResult.data;
    mergeResult.value = mergeResponseValue.data;
    resetStackExpansion(mergeResponseValue.data.root);
  } catch (error) {
    if (requestSeq !== queryRequestSeq) return;
    errorMessage.value = buildErrorMessage(error);
  } finally {
    if (requestSeq === queryRequestSeq) {
      queryLoading.value = false;
    }
  }
};

const initPage = async () => {
  resetProfilesState();
  await loadStreams();
  if (!selectedStream.value) return;
  await loadMeta();
  await runQuery();
};

watch(draftTagKey, async (key, previousKey) => {
  if (key === previousKey) return;
  draftTagValue.value = null;
  tagValueOptions.value = [];
  if (!key) return;
  await loadTagValues();
});

watch(selectedStream, async (stream, previousStream) => {
  if (!stream || stream === previousStream) return;
  selectedService.value = null;
  appliedFilters.value = [];
  clearDraftTag();
  await loadMeta();
  await runQuery();
});

watch(dateState, async () => {
  await loadMeta();
  if (draftTagKey.value) {
    await loadTagValues();
  }
});

watch(
  orgIdentifier,
  async (org, previousOrg) => {
    if (!org || org === previousOrg) return;
    await initPage();
  },
  { immediate: true },
);
</script>
