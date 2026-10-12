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
    class="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-auto"
    data-autoobserve-coverage
    data-test="autoobserve-coverage"
  >
    <div
      class="flex min-h-0 min-w-0 flex-1 flex-col max-lg:min-h-150"
      :class="view === 'map' ? 'max-lg:flex-none' : ''"
    >
      <div
        class="px-page-edge border-border-default flex flex-wrap items-center gap-x-5 gap-y-2 border-b py-3"
        data-test="autoobserve-coverage-summary"
      >
        <span class="text-text-heading text-base font-semibold tabular-nums">{{
          t("autoobserve.coverage.summaryWatched", {
            watched: totals.fullyWatched,
            total: totals.total,
            pct: watchedPct,
          })
        }}</span>
        <span
          v-if="totals.added"
          class="text-text-secondary flex items-center gap-1 text-xs tabular-nums"
          data-test="autoobserve-coverage-added"
        >
          <OIcon name="arrow-upward" size="xs" />{{
            t("autoobserve.coverage.addedThisWeek", { count: totals.added }, totals.added)
          }}
        </span>
        <span
          role="img"
          :aria-label="splitLabel"
          class="bg-progress-bar-track flex h-2 w-56 overflow-hidden rounded-full max-md:w-full"
          data-test="autoobserve-coverage-split"
        >
          <span
            v-for="part in split"
            :key="part.cls"
            :class="part.cls"
            :style="{ flexGrow: part.count }"
          />
        </span>
        <span
          class="text-text-secondary ms-auto text-xs tabular-nums"
          data-test="autoobserve-coverage-detectors"
          >{{
            t("autoobserve.coverage.detectorCount", { count: totals.detectors }, totals.detectors)
          }}</span
        >
      </div>

      <div
        class="px-page-edge flex flex-wrap items-center gap-2 py-2"
        data-test="autoobserve-coverage-controls"
      >
        <div class="flex min-w-48 flex-1 items-center sm:max-w-72">
          <label :for="SEARCH_ID" class="sr-only">{{
            t("autoobserve.coverage.searchLabel")
          }}</label>
          <OInput
            :id="SEARCH_ID"
            v-model="query"
            size="sm"
            clearable
            class="w-full"
            :placeholder="t('autoobserve.coverage.searchPlaceholder')"
            data-test="autoobserve-coverage-search"
            @keydown.esc="clearSearch"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" class="text-text-secondary" />
            </template>
          </OInput>
          <span class="sr-only" role="status" data-test="autoobserve-coverage-search-status">{{
            announcement
          }}</span>
        </div>
        <OToggleGroup
          :model-value="view"
          :aria-label="t('autoobserve.coverage.viewLabel')"
          data-test="autoobserve-coverage-view"
          @update:model-value="(v) => v && (view = v as CoverageView)"
        >
          <OToggleGroupItem value="map" size="sm" data-test="autoobserve-coverage-view-map">
            {{ t("autoobserve.coverage.viewMap") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="table" size="sm" data-test="autoobserve-coverage-view-table">
            {{ t("autoobserve.coverage.viewTable") }}
          </OToggleGroupItem>
        </OToggleGroup>
        <template v-if="view === 'map'">
          <OSelect
            class="max-md:w-full"
            width="md"
            size="sm"
            label-position="inside"
            :label="t('autoobserve.coverage.fillBy')"
            :model-value="fill"
            :options="fillOptions"
            data-test="autoobserve-coverage-fill"
            @update:model-value="(v) => (fill = v as CoverageFill)"
          />
        </template>
        <OToggleGroup
          v-else
          :model-value="filter"
          :aria-label="t('autoobserve.coverage.filterLabel')"
          data-test="autoobserve-coverage-filter"
          @update:model-value="(v) => v && (filter = v as CoverageFilter)"
        >
          <OToggleGroupItem
            v-for="option in FILTERS"
            :key="option"
            :value="option"
            size="xs"
            :disabled="!counts[option] && option !== filter"
            :data-test="`autoobserve-coverage-filter-${option}`"
          >
            {{ t(FILTER_LABEL[option]) }}
            <span class="ms-1 tabular-nums">{{ counts[option] }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <template v-if="view === 'map'">
        <OEmptyState
          v-if="term && !searched.length"
          size="block"
          illustration="no-results"
          :title="t('autoobserve.coverage.noMatch', { query: raw(term) })"
          :action-label="t('autoobserve.coverage.clearSearch')"
          data-test="autoobserve-coverage-no-match"
          @action="clearSearch"
        />
        <div
          v-else
          class="px-page-edge min-h-0 flex-1 overflow-auto py-4 max-lg:h-[60vh] max-lg:flex-none"
        >
          <CoverageHexMap
            :items="items"
            :label="mapLabel"
            :selected="selected?.service ?? null"
            :highlight="highlight"
            :matches="matches"
            @select="selectService"
          />
        </div>
        <div
          class="px-page-edge border-table-row-divider text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 text-xs"
          data-test="autoobserve-coverage-map-legend"
        >
          <span>{{ t(FILL_LABEL[fill]) }}</span>
          <OToggleGroup
            v-model="highlight"
            type="multiple"
            class="max-w-full overflow-x-auto"
            :aria-label="t('autoobserve.coverage.legendOf', { fill: t(FILL_LABEL[fill]) })"
            data-test="autoobserve-coverage-legend-chips"
          >
            <OToggleGroupItem
              v-for="item in legend"
              :key="item.cls"
              :value="item.cls"
              size="sm"
              :data-test="`autoobserve-coverage-legend-${item.cls}`"
            >
              <span class="rounded-default h-3 w-4 shrink-0" :class="SWATCH[item.cls]" />
              <span>{{ item.label }}</span>
              <span class="text-text-secondary tabular-nums">{{ item.count }}</span>
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
      </template>

      <template v-else>
        <OTable
          :data="rows"
          :columns="columns"
          :frame="false"
          row-key="service"
          pagination="none"
          :show-global-filter="false"
          :row-rail-tone="railTone"
          :row-class="rowClass"
          class="min-h-0 flex-1"
          data-test="autoobserve-coverage-matrix"
        >
          <template #cell-service="{ row }">
            <span class="text-text-heading font-medium">{{ row.service }}</span>
          </template>
          <template #cell-coverage="{ row }">
            <span
              class="flex items-center gap-2"
              :title="coverageLabel(row)"
              :aria-label="coverageLabel(row)"
              role="img"
              :data-test="`autoobserve-coverage-summary-${row.service}`"
            >
              <span class="flex gap-0.5" aria-hidden="true">
                <span
                  v-for="signal in applicable(row)"
                  :key="signal"
                  class="h-1.5 w-3 rounded-full"
                  :class="SEGMENT_CLASS[row.cells[signal].state]"
                />
              </span>
              <span class="text-text-secondary text-xs tabular-nums" aria-hidden="true">{{
                t("autoobserve.coverage.coverageCount", {
                  watched: watchedCount(row),
                  total: applicable(row).length,
                })
              }}</span>
            </span>
          </template>
          <template #cell-stream="{ row }">
            <OText variant="mono" class="text-text-secondary">{{ row.stream }}</OText>
          </template>
          <template v-for="signal in SIGNALS" :key="signal" #[`cell-${signal}`]="{ row }">
            <button
              type="button"
              class="hover:bg-surface-subtle-hover focus-visible:outline-focus-ring-accent rounded-default inline-flex h-7 min-w-10 cursor-pointer items-center justify-center gap-1 px-2 focus-visible:outline-2 focus-visible:outline-offset-1"
              :class="isSelected(row.service, signal) ? 'ring-accent bg-surface-base ring-2' : ''"
              :title="cellTip(row.cells[signal], signal)"
              :aria-label="cellTip(row.cells[signal], signal)"
              :aria-pressed="isSelected(row.service, signal)"
              :data-test="`autoobserve-coverage-cell-${row.service}-${signal}`"
              @click="selected = { service: row.service, signal }"
            >
              <template v-if="row.cells[signal].state === 'watched'">
                <span
                  class="border-icon-chip-success-text size-2.5 rounded-full border-2"
                  :class="row.cells[signal].method === 'anomaly' ? 'bg-icon-chip-success-text' : ''"
                />
              </template>
              <template v-else-if="row.cells[signal].state === 'learning'">
                <span class="bg-progress-bar-track relative h-1 w-6 overflow-hidden rounded-full">
                  <span
                    class="bg-icon-chip-info-text absolute inset-y-0 start-0 rounded-full"
                    :style="{ width: `${progressPct(row.cells[signal])}%` }"
                  />
                </span>
                <span class="text-text-secondary text-2xs tabular-nums">{{
                  daysShort(row.cells[signal])
                }}</span>
              </template>
              <span v-else-if="row.cells[signal].state === 'gap'" :class="GAP_CHIP">{{
                t("autoobserve.coverage.gapChip")
              }}</span>
              <span v-else class="text-text-secondary text-sm leading-none">–</span>
            </button>
          </template>
          <template #cell-lastScanned="{ row }">
            <span class="text-text-secondary text-xs">{{ row.lastScanned }}</span>
          </template>
          <template #empty>
            <OEmptyState
              v-if="term"
              size="block"
              illustration="no-results"
              :title="t('autoobserve.coverage.noMatch', { query: raw(term) })"
              :action-label="t('autoobserve.coverage.clearSearch')"
              data-test="autoobserve-coverage-no-match"
              @action="clearSearch"
            />
          </template>
        </OTable>
        <div
          class="px-page-edge border-table-row-divider text-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1 border-t py-2 text-xs"
          data-test="autoobserve-coverage-legend"
        >
          <span class="tabular-nums">{{
            t("autoobserve.coverage.showing", { shown: rows.length, total: totals.total })
          }}</span>
          <ul
            class="ms-auto flex flex-wrap items-center gap-x-4 gap-y-1"
            :aria-label="t('autoobserve.coverage.legendLabel')"
          >
            <li class="flex items-center gap-1.5">
              <span class="bg-icon-chip-success-text size-2.5 rounded-full" />{{
                t("autoobserve.coverage.anomaly")
              }}
            </li>
            <li class="flex items-center gap-1.5">
              <span class="border-icon-chip-success-text size-2.5 rounded-full border-2" />{{
                t("autoobserve.coverage.threshold")
              }}
            </li>
            <li class="flex items-center gap-1.5">
              <span class="bg-progress-bar-track relative h-1 w-6 overflow-hidden rounded-full">
                <span
                  class="bg-icon-chip-info-text absolute inset-y-0 start-0 w-1/2 rounded-full"
                />
              </span>
              {{ t("autoobserve.coverage.learning") }}
            </li>
            <li class="flex items-center gap-1.5">
              <span :class="GAP_CHIP">{{ t("autoobserve.coverage.gapChip") }}</span
              >{{ t("autoobserve.coverage.gap") }}
            </li>
            <li class="flex items-center gap-1.5">
              <span aria-hidden="true">–</span>{{ t("autoobserve.coverage.na") }}
            </li>
          </ul>
        </div>
      </template>
    </div>

    <CoverageServiceDrawer
      v-if="selectedRow"
      :row="selectedRow"
      :service-states="serviceStates"
      :scenario="scenario"
      :ledger="ledger"
      :expanded="selected?.signal ?? null"
      :anchor="DRAWER_ANCHOR"
      :fix="fixFor(selectedRow.service)"
      :message="actionMessage"
      @close="closeDrawer"
      @expand="(signal) => selected && (selected = { ...selected, signal })"
      @fix="runSelectedFix"
      @select="(service) => (selected = { service, signal: null })"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { OTableColumnDef, RowRailTone } from "@/lib/core/Table/OTable.types";
import CoverageHexMap, { type HexClass, type HexItem } from "./CoverageHexMap.vue";
import CoverageServiceDrawer from "./CoverageServiceDrawer.vue";
import {
  SIGNAL_LABEL,
  SIGNALS,
  coverageFor,
  coverageStats,
  planFor,
  type CellState,
  type CoverageCell,
  type CoverageRow,
  type LedgerEntry,
  type Scenario,
  type Signal,
} from "./fixtures";

type CoverageFilter = "all" | "watched" | "learning" | "gaps" | "cantWatch";
type CoverageView = "map" | "table";
type CoverageFill = "state" | "learning" | "detectors" | "scanned";
type ServiceState = "watched" | "learning" | "gap";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();

const SEARCH_ID = "autoobserve-coverage-search";
const DRAWER_ANCHOR = "[data-autoobserve-coverage]";
const GAP_CHIP =
  "bg-button-warning text-button-warning-foreground rounded-default px-1.5 py-0.5 text-2xs leading-none font-semibold";
const FILTERS: CoverageFilter[] = ["all", "watched", "learning", "gaps", "cantWatch"];
const VIEWS: CoverageView[] = ["map", "table"];
const FILLS: CoverageFill[] = ["state", "learning", "detectors", "scanned"];

const FILTER_LABEL: Record<CoverageFilter, I18nKey> = {
  all: "autoobserve.coverage.all",
  watched: "autoobserve.coverage.watched",
  learning: "autoobserve.coverage.learning",
  gaps: "autoobserve.coverage.gaps",
  cantWatch: "autoobserve.coverage.cantWatch",
};
const FILL_LABEL: Record<CoverageFill, I18nKey> = {
  state: "autoobserve.coverage.fillState",
  learning: "autoobserve.coverage.fillLearning",
  detectors: "autoobserve.coverage.fillDetectors",
  scanned: "autoobserve.coverage.fillScanned",
};
const SEGMENT_CLASS: Record<CellState, string> = {
  watched: "bg-icon-chip-success-text",
  learning: "bg-icon-chip-info-text",
  gap: "bg-icon-chip-warning-text",
  na: "",
};
const SWATCH: Record<HexClass, string> = {
  watched: "bg-badge-success-soft-text dark:bg-status-positive",
  learning: "bg-status-info-text",
  gap: "bg-status-warning-text",
  none: "bg-status-neutral-text",
  s1: "bg-map-seq-1",
  s2: "bg-map-seq-2",
  s3: "bg-map-seq-3",
  s4: "bg-map-seq-4",
  s5: "bg-map-seq-5",
};
const LEGEND: Record<CoverageFill, { cls: HexClass; key: I18nKey }[]> = {
  state: [
    { cls: "watched", key: "autoobserve.coverage.watched" },
    { cls: "learning", key: "autoobserve.coverage.learning" },
    { cls: "gap", key: "autoobserve.coverage.gap" },
  ],
  learning: [
    { cls: "s1", key: "autoobserve.coverage.bucketLearned" },
    { cls: "s2", key: "autoobserve.coverage.bucketDays67" },
    { cls: "s3", key: "autoobserve.coverage.bucketDays35" },
    { cls: "s4", key: "autoobserve.coverage.bucketDays02" },
    { cls: "none", key: "autoobserve.coverage.bucketNoData" },
  ],
  detectors: [
    { cls: "s1", key: "autoobserve.coverage.bucketSix" },
    { cls: "s2", key: "autoobserve.coverage.bucketFive" },
    { cls: "s3", key: "autoobserve.coverage.bucketFewer" },
    { cls: "none", key: "autoobserve.coverage.bucketNone" },
  ],
  scanned: [
    { cls: "s1", key: "autoobserve.coverage.bucketFresh" },
    { cls: "s2", key: "autoobserve.coverage.bucketRecent" },
    { cls: "s3", key: "autoobserve.coverage.bucketHour" },
    { cls: "s5", key: "autoobserve.coverage.bucketStale" },
    { cls: "none", key: "autoobserve.coverage.bucketNotScanned" },
  ],
};
const FIX_KEY: Record<"noLink" | "stopped", I18nKey> = {
  noLink: "autoobserve.coverage.fixNoLink",
  stopped: "autoobserve.coverage.fixStopped",
};

const props = defineProps<{
  ledger: LedgerEntry[];
  scenario: Scenario;
}>();

const hasState = (row: CoverageRow, state: CellState) =>
  SIGNALS.some((s) => row.cells[s].state === state);

const rank = (row: CoverageRow) => {
  if (hasState(row, "gap")) return 0;
  return hasState(row, "learning") ? 1 : 2;
};

const serviceState = (row: CoverageRow): ServiceState =>
  (["gap", "learning", "watched"] as const)[rank(row)];

const learnedDays = (row: CoverageRow) =>
  SIGNALS.map((s) => row.cells[s].progress).find(Boolean) ?? null;

const detectorsOf = (row: CoverageRow) => SIGNALS.filter((s) => row.cells[s].detector).length;

const allRows = computed(() =>
  [...coverageFor(props.scenario, t)].sort(
    (a, b) => rank(a) - rank(b) || a.service.localeCompare(b.service),
  ),
);
const totals = computed(() => coverageStats(props.scenario));

const serviceStates = computed(() =>
  Object.fromEntries(allRows.value.map((r) => [r.service, serviceState(r)])),
);

const watchedPct = computed(() =>
  totals.value.total ? Math.round((100 * totals.value.fullyWatched) / totals.value.total) : 0,
);

const split = computed(() => [
  { cls: "bg-badge-success-soft-text dark:bg-status-positive", count: totals.value.fullyWatched },
  { cls: "bg-status-info-text", count: totals.value.learning },
  { cls: "bg-status-warning-text", count: totals.value.gaps },
]);

const splitLabel = computed(() =>
  t("autoobserve.coverage.splitLabel", {
    watched: totals.value.fullyWatched,
    learning: totals.value.learning,
    gaps: totals.value.gaps,
  }),
);

const fixFor = (service: string): I18nText | null => {
  const blockedBy = allRows.value.find((r) => r.service === service)?.blockedBy;
  return blockedBy ? t(FIX_KEY[blockedBy]) : null;
};

const planned = computed(() => new Set(planFor(props.scenario).map((p) => p.service)));

const pick = <T extends string>(value: unknown, options: T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const query = ref("");
const term = computed(() => query.value.trim().toLowerCase());
const filter = ref<CoverageFilter>("all");
const view = ref<CoverageView>(pick(route.query.cov, VIEWS, "map"));
const fill = ref<CoverageFill>(pick(route.query.fill, FILLS, "state"));
const highlight = ref<HexClass[]>([]);

const initialService = typeof route.query.service === "string" ? route.query.service : null;
const initialSignal = pick<Signal | "">(route.query.signal, SIGNALS, "");
const selected = ref<{ service: string; signal: Signal | null } | null>(
  initialService ? { service: initialService, signal: initialSignal || null } : null,
);

const selectService = (service: string) => {
  selected.value = selected.value?.service === service ? null : { service, signal: null };
};

watch(fill, () => {
  highlight.value = [];
});

watch([view, fill, selected], () => {
  void router.replace({
    query: {
      ...route.query,
      cov: view.value === "map" ? undefined : view.value,
      fill: fill.value === "state" ? undefined : fill.value,
      service: selected.value?.service,
      signal: selected.value?.signal ?? undefined,
    },
  });
});

const inFilter = (row: CoverageRow, f: CoverageFilter) => {
  if (f === "watched") return rank(row) === 2;
  if (f === "learning") return rank(row) === 1;
  if (f === "gaps") return rank(row) === 0;
  if (f === "cantWatch") return planned.value.has(row.service);
  return true;
};

const searched = computed(() =>
  allRows.value.filter(
    (r) =>
      !term.value ||
      r.service.toLowerCase().includes(term.value) ||
      r.stream.toLowerCase().includes(term.value),
  ),
);
const rows = computed(() => searched.value.filter((r) => inFilter(r, filter.value)));

const matches = computed(() => (term.value ? new Set(searched.value.map((r) => r.service)) : null));

const counts = computed(
  () =>
    Object.fromEntries(
      FILTERS.map((f) => [f, searched.value.filter((r) => inFilter(r, f)).length]),
    ) as Record<CoverageFilter, number>,
);

const announcement = computed(() => {
  const count = view.value === "map" ? searched.value.length : rows.value.length;
  return term.value ? t("autoobserve.coverage.matchCount", { count }, count) : "";
});

const clearSearch = () => {
  query.value = "";
  document.getElementById(SEARCH_ID)?.focus();
};

const fillClass = (row: CoverageRow): HexClass => {
  const state = serviceState(row);
  if (fill.value === "state") return state;
  if (fill.value === "learning") {
    if (state === "gap") return "none";
    const days = learnedDays(row)?.[0];
    if (days == null) return "s1";
    if (days >= 6) return "s2";
    return days >= 3 ? "s3" : "s4";
  }
  if (fill.value === "detectors") {
    const n = detectorsOf(row);
    if (n === 0) return "none";
    if (n >= 6) return "s1";
    return n === 5 ? "s2" : "s3";
  }
  const minutes = row.scannedMinutes;
  if (minutes == null) return "none";
  if (minutes < 5) return "s1";
  if (minutes < 15) return "s2";
  return minutes < 60 ? "s3" : "s5";
};

const stateText = (row: CoverageRow): I18nText => {
  const state = serviceState(row);
  const days = learnedDays(row);
  if (state === "learning" && days)
    return t("autoobserve.coverage.stateLearning", { days: days[0], total: days[1] });
  return state === "gap"
    ? t("autoobserve.coverage.stateGap")
    : t("autoobserve.coverage.stateWatched");
};

const detectorText = (row: CoverageRow) =>
  t("autoobserve.coverage.detectorCount", { count: detectorsOf(row) }, detectorsOf(row));

const toItem = (row: CoverageRow): HexItem => ({
  key: row.service,
  cls: fillClass(row),
  stateCls: serviceState(row),
  state: stateText(row),
  stream: row.stream,
  detectors: detectorText(row),
  name: t("autoobserve.coverage.hexName", {
    service: raw(row.service),
    state: stateText(row),
    stream: raw(row.stream),
    detectors: detectorText(row),
  }),
});

// allRows already leads with problems: gaps, then learning, then A to Z.
const items = computed(() => allRows.value.map(toItem));

const legend = computed(() =>
  LEGEND[fill.value].map(({ cls, key }) => ({
    cls,
    label: t(key),
    count: allRows.value.filter((r) => fillClass(r) === cls).length,
  })),
);

const fillOptions = computed(() => FILLS.map((f) => ({ label: t(FILL_LABEL[f]), value: f })));

const mapLabel = computed(() =>
  t(
    "autoobserve.coverage.mapLabel",
    {
      count: allRows.value.length,
      fill: t(FILL_LABEL[fill.value]),
    },
    allRows.value.length,
  ),
);

const selectedRow = computed(() =>
  selected.value ? allRows.value.find((r) => r.service === selected.value?.service) : undefined,
);

const isSelected = (service: string, signal: Signal) =>
  selected.value?.service === service && selected.value.signal === signal;

const railTone = (row: CoverageRow): RowRailTone | null =>
  (["warning", "info", null] as const)[rank(row)];

const rowClass = (row: CoverageRow) =>
  row.service === selected.value?.service ? "bg-table-row-selected-bg" : "";

const applicable = (row: CoverageRow) => SIGNALS.filter((s) => row.cells[s].state !== "na");
const watchedCount = (row: CoverageRow) =>
  SIGNALS.filter((s) => row.cells[s].state === "watched").length;
const coverageLabel = (row: CoverageRow) =>
  t("autoobserve.coverage.coverageLabel", {
    watched: watchedCount(row),
    total: applicable(row).length,
  });

const progressPct = (cell: CoverageCell) =>
  cell.progress ? Math.round((100 * cell.progress[0]) / cell.progress[1]) : 0;

const daysShort = (cell: CoverageCell) =>
  cell.progress
    ? t("autoobserve.coverage.daysShort", { days: cell.progress[0], total: cell.progress[1] })
    : "";

const cellTip = (cell: CoverageCell, signal: Signal): I18nText => {
  const name = t(SIGNAL_LABEL[signal]);
  if (cell.state === "watched")
    return cell.method === "anomaly"
      ? t("autoobserve.coverage.tipAnomaly", { signal: name })
      : t("autoobserve.coverage.tipThreshold", { signal: name });
  if (cell.state === "learning")
    return t("autoobserve.coverage.tipLearning", {
      signal: name,
      days: cell.progress?.[0] ?? 0,
      total: cell.progress?.[1] ?? 0,
    });
  if (cell.state === "gap") return t("autoobserve.coverage.tipGap", { signal: name });
  return t("autoobserve.coverage.tipNa", { signal: name });
};

const actionMessage = ref<I18nText | "">("");
const runFix = (action: I18nText, service: string) => {
  actionMessage.value = t("autoobserve.coverage.fixQueued", { action, service: raw(service) });
};

const runSelectedFix = () => {
  const service = selected.value?.service;
  const action = service ? fixFor(service) : null;
  if (service && action) runFix(action, service);
};

// The drawer returns focus to whatever opened it first; the hex selected last is the one to land on.
const closeDrawer = () => {
  const service = selected.value?.service;
  selected.value = null;
  requestAnimationFrame(() =>
    document
      .querySelector<SVGElement>(
        `[data-test="autoobserve-coverage-hex-${CSS.escape(service ?? "")}"]`,
      )
      ?.focus(),
  );
};

const columns: OTableColumnDef<CoverageRow>[] = [
  {
    id: "service",
    header: t("autoobserve.coverage.service"),
    accessorKey: "service",
    size: 160,
  },
  {
    id: "coverage",
    header: t("autoobserve.coverage.coverage"),
    accessorFn: (row: CoverageRow) => watchedCount(row),
    size: 140,
  },
  {
    id: "stream",
    header: t("autoobserve.coverage.stream"),
    accessorKey: "stream",
    size: 130,
  },
  ...SIGNALS.map((signal) => ({
    id: signal,
    header: t(SIGNAL_LABEL[signal]),
    accessorFn: (row: CoverageRow) => row.cells[signal].state,
    size: 104,
  })),
  {
    id: "lastScanned",
    header: t("autoobserve.coverage.lastScanned"),
    accessorKey: "lastScanned",
    size: 120,
  },
];
</script>
