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
    <span v-if="source" class="sr-only" role="status" data-test="autoobserve-coverage-announce">{{
      loadText
    }}</span>
    <div
      v-if="source && liveHolds"
      class="relative flex min-h-60 min-w-0 flex-1 flex-col"
      data-test="autoobserve-coverage-live-status"
    >
      <div
        v-if="skeleton"
        class="flex min-h-0 flex-1 flex-col"
        aria-busy="true"
        :data-skeleton-view="view"
        data-test="autoobserve-coverage-skeleton"
      >
        <div
          class="px-page-edge border-border-default flex items-center gap-x-5 border-b py-3.5"
          aria-hidden="true"
        >
          <OSkeleton animation="none" class="h-4 w-44" />
          <OSkeleton
            v-if="!headerBar"
            animation="none"
            class="h-2 w-56 max-md:w-24"
            data-test="autoobserve-coverage-skeleton-split"
          />
          <OSkeleton animation="none" class="ms-auto h-3 w-20" />
        </div>
        <div class="px-page-edge flex items-center gap-2 py-2" aria-hidden="true">
          <OSkeleton animation="none" class="h-8 w-72 max-md:w-40" />
          <OSkeleton animation="none" class="h-8 w-32" />
          <template v-if="view === 'map'">
            <OSkeleton animation="none" class="h-8 w-44 max-md:hidden" />
            <OSkeleton animation="none" class="h-8 w-56 max-md:hidden" />
          </template>
        </div>
        <div
          v-if="view === 'map'"
          class="px-page-edge flex flex-wrap content-start gap-1 py-4"
          aria-hidden="true"
        >
          <OSkeleton
            v-for="i in MAP_SKELETON_HEXES"
            :key="i"
            type="circle"
            animation="none"
            class="size-20 max-md:size-14"
          />
        </div>
        <OTable
          v-else
          :data="[]"
          :columns="columns"
          :frame="false"
          loading
          pagination="none"
          :show-global-filter="false"
          class="min-h-0 flex-1"
          aria-hidden="true"
        />
      </div>
      <LiveNoticeState
        v-else-if="liveNoticeView"
        :notice="liveNoticeView"
        size="block"
        :detail="source.detail"
        :busy="source.busy"
        :data-test="`autoobserve-coverage-${liveNoticeView.failure}`"
        retry-test="autoobserve-coverage-retry"
        @retry="source.retry()"
      />
      <template v-else-if="source.status === 'ready'">
        <div v-if="source.stale" class="px-page-edge absolute inset-x-0 top-0 z-10 pt-2">
          <LiveRefreshFailed
            surface="coverage"
            :stale="source.stale"
            :busy="source.busy"
            data-test="autoobserve-coverage-refresh-failed"
            @retry="source.retry()"
          />
        </div>
        <LiveNoticeState
          :notice="emptyNotice"
          size="block"
          :data-test="
            source.passMinutes === null
              ? 'autoobserve-coverage-no-pass'
              : 'autoobserve-coverage-no-services'
          "
          :action="explain ? emptyNotice.action : undefined"
          @action="emit('how-it-works')"
        />
      </template>
    </div>
    <div
      v-else
      class="flex min-h-0 min-w-0 flex-1 flex-col max-lg:min-h-150"
      :class="view === 'map' ? 'max-lg:flex-none' : ''"
    >
      <div
        class="px-page-edge border-border-default flex flex-wrap items-center gap-x-5 gap-y-2 border-b py-3"
        :class="source ? 'min-h-14' : ''"
        data-test="autoobserve-coverage-summary"
      >
        <span class="text-text-heading text-base font-semibold tabular-nums">{{
          summaryText
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
          v-if="!headerBar"
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
        <LiveRefreshFailed
          v-if="source?.stale"
          class="ms-auto min-w-0"
          dense
          surface="coverage"
          :stale="source.stale"
          :busy="source.busy"
          data-test="autoobserve-coverage-refresh-failed"
          @retry="source.retry()"
        />
        <span
          v-else
          class="text-text-secondary ms-auto text-xs tabular-nums"
          data-test="autoobserve-coverage-detectors"
          >{{ detectorCountText(t, totals.detectors) }}</span
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
            :placeholder="searchPlaceholder"
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
              <span class="rounded-default size-3 shrink-0" :class="SWATCH[item.cls]" />
              <span>{{ item.label }}</span>
              <span class="text-text-secondary tabular-nums">{{ item.count }}</span>
            </OToggleGroupItem>
          </OToggleGroup>
        </template>
        <OToggleGroup
          v-else
          :model-value="filter"
          :aria-label="t('autoobserve.coverage.filterLabel')"
          data-test="autoobserve-coverage-filter"
          @update:model-value="(v) => v && (filter = v as CoverageFilter)"
        >
          <OToggleGroupItem
            v-for="option in filters"
            :key="option"
            :value="option"
            size="xs"
            :disabled="!counts[option] && option !== filter"
            :data-test="`autoobserve-coverage-filter-${option}`"
          >
            {{ filterLabel(option) }}
            <span class="ms-1 tabular-nums">{{ counts[option] }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <template v-if="view === 'map'">
        <OEmptyState
          v-if="term && !searched.length"
          size="block"
          illustration="no-results"
          :title="noMatchTitle"
          :action-label="t('autoobserve.coverage.clearSearch')"
          data-test="autoobserve-coverage-no-match"
          @action="clearSearch"
        />
        <!-- The service drawer is not modal and opens over the map's right side, so the hexes move out from under it. -->
        <div
          v-else
          class="px-page-edge min-h-0 flex-1 overflow-auto py-4 max-lg:h-[60vh] max-lg:flex-none"
          :class="selectedRow ? 'xl:pe-160' : ''"
          data-test="autoobserve-coverage-map-scroller"
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
                    class="bg-status-neutral-text absolute inset-y-0 start-0 rounded-full"
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
          <template #cell-where="{ row }">
            <span class="text-text-secondary">{{ row.where }}</span>
          </template>
          <template v-for="check in LIVE_CHECKS" :key="check" #[`cell-check-${check}`]="{ row }">
            <button
              v-if="row.checks"
              type="button"
              class="hover:bg-surface-subtle-hover focus-visible:outline-focus-ring-accent rounded-default text-text-body -ms-1.5 inline-flex h-7 cursor-pointer items-center gap-1.5 px-1.5 focus-visible:outline-2 focus-visible:outline-offset-1"
              :title="row.checks[check].state === 'gap' ? row.checks[check].reason : undefined"
              :aria-label="liveCellAria(row, check)"
              :aria-pressed="isSelected(row.service, check)"
              :data-test="`autoobserve-coverage-cell-${row.service}-${check}`"
              @click="selected = { service: row.service, signal: check }"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="LIVE_DOT[cellLook(row, check)]"
                aria-hidden="true"
              />{{
                liveCellWord(t, row.checks[check].engine?.stateKey ?? "none", isAdded(row, check))
              }}
            </button>
          </template>
          <template #cell-state="{ row }">
            <OTag
              v-if="row.status"
              :variant="row.status.state === 'gap' ? 'amber-soft' : 'success-soft'"
              size="sm"
              :label="row.status.label"
              :data-test="`autoobserve-coverage-state-${row.service}`"
            />
          </template>
          <template #cell-lastScanned="{ row }">
            <span class="text-text-secondary text-xs">{{ row.lastScanned }}</span>
          </template>
          <template #empty>
            <OEmptyState
              v-if="searched.length && filter !== 'all'"
              size="block"
              illustration="no-results"
              :title="filterHidesTitle"
              :action-label="t('autoobserveLive.coverage.showAll')"
              data-test="autoobserve-coverage-filter-hides"
              @action="filter = 'all'"
            />
            <OEmptyState
              v-else-if="term"
              size="block"
              illustration="no-results"
              :title="noMatchTitle"
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
            v-if="source"
            class="ms-auto flex flex-wrap items-center gap-x-4 gap-y-1"
            :aria-label="t('autoobserve.coverage.legendLabel')"
          >
            <li
              v-for="look in LIVE_LEGEND"
              :key="look"
              class="flex items-center gap-1.5"
              :data-test="`autoobserve-coverage-legend-${look}-key`"
            >
              <span class="size-2 rounded-full" :class="LIVE_DOT[look]" />{{
                liveLookWord(t, look)
              }}
            </li>
          </ul>
          <ul
            v-else
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
                  class="bg-status-neutral-text absolute inset-y-0 start-0 w-1/2 rounded-full"
                />
              </span>
              {{ t("autoobserve.coverage.learning") }}
            </li>
            <li class="flex items-center gap-1.5" data-test="autoobserve-coverage-legend-gap-key">
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
      message=""
      :live="!!source"
      @close="closeDrawer"
      @expand="(signal) => selected && (selected = { ...selected, signal })"
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
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef, RowRailTone } from "@/lib/core/Table/OTable.types";
import CoverageHexMap, { type HexClass, type HexItem } from "./CoverageHexMap.vue";
import CoverageServiceDrawer from "./CoverageServiceDrawer.vue";
import {
  SIGNAL_LABEL,
  SIGNALS,
  coverageFor,
  coverageStats,
  detectorsOf,
  LIVE_CHECKS,
  planFor,
  type CellState,
  type CoverageCell,
  type CoverageRow,
  type LedgerEntry,
  type LiveCheck,
  type Scenario,
  type Signal,
} from "./fixtures";
import type { CoverageSource } from "./live/liveAdapter";
import {
  coverageWord,
  detectorCountText,
  emptyCoverageNotice,
  LIVE_DOT,
  liveCellLook,
  liveCellWord,
  liveCheckName,
  liveCheckText,
  liveLoadText,
  liveLookWord,
  liveNotice,
  type LiveCellLook,
  type LiveCoverageState,
} from "./live/liveCopy";
import { useStore } from "vuex";
import { useLoadPhase } from "./live/liveModel";
import { justAdded } from "./insight/coverageCta";
import LiveNoticeState from "./live/LiveNoticeState.vue";
import LiveRefreshFailed from "./live/LiveRefreshFailed.vue";

type CoverageFilter = "all" | "watched" | "learning" | "gaps" | "cantWatch";
type CoverageView = "map" | "table";
type CoverageFill = "state" | "learning" | "detectors" | "scanned";
type ServiceState = "watched" | "learning" | "gap";

const { t, locale } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const SEARCH_ID = "autoobserve-coverage-search";
const DRAWER_ANCHOR = "[data-autoobserve-coverage]";
const GAP_CHIP =
  "bg-button-warning text-button-warning-foreground rounded-default px-1.5 py-0.5 text-2xs leading-none font-semibold";
const MAP_SKELETON_HEXES = 18;
const FILTERS: CoverageFilter[] = ["all", "watched", "learning", "gaps", "cantWatch"];
// Live coverage has two states only, so learning and the fixture-only "can't watch" subset drop out.
const LIVE_FILTERS: CoverageFilter[] = ["all", "watched", "gaps"];
const VIEWS: CoverageView[] = ["map", "table"];
const FILLS: CoverageFill[] = ["state", "learning", "detectors", "scanned"];
const LIVE_FILLS: CoverageFill[] = ["state", "detectors", "scanned"];
const LIVE_FILTER_WORD: Partial<Record<CoverageFilter, LiveCoverageState>> = {
  watched: "watched",
  gaps: "gap",
};
// Live coverage has three checks, so a service's alerts fall in 3+, 2, 1 or none, not the fixture's 6/5.
const LIVE_DETECTOR_LEGEND: { cls: HexClass; key: I18nKey }[] = [
  { cls: "s1", key: "autoobserveLive.coverage.bucketThree" },
  { cls: "s2", key: "autoobserveLive.coverage.bucketTwo" },
  { cls: "s3", key: "autoobserveLive.coverage.bucketOne" },
  { cls: "none", key: "autoobserve.coverage.bucketNone" },
];
const LIVE_STATE_LEGEND: { cls: HexClass; state: LiveCoverageState }[] = [
  { cls: "gap", state: "gap" },
  { cls: "watched", state: "watched" },
];

const FILTER_LABEL: Record<CoverageFilter, I18nKey> = {
  all: "autoobserve.coverage.all",
  watched: "autoobserve.coverage.watched",
  learning: "autoobserve.coverage.learning",
  gaps: "autoobserve.coverage.gaps",
  cantWatch: "autoobserve.coverage.cantWatch",
};
const LIVE_LEGEND: LiveCellLook[] = ["covered", "gap"];

const FILL_LABEL: Record<CoverageFill, I18nKey> = {
  state: "autoobserve.coverage.fillState",
  learning: "autoobserve.coverage.fillLearning",
  detectors: "autoobserve.coverage.fillDetectors",
  scanned: "autoobserve.coverage.fillScanned",
};
const SEGMENT_CLASS: Record<CellState, string> = {
  watched: "bg-icon-chip-success-text",
  learning: "bg-status-neutral-text",
  gap: "bg-badge-amber-soft-text",
  na: "",
};
const SWATCH: Record<HexClass, string> = {
  watched: "bg-badge-success-soft-text/15 border border-badge-success-soft-text/60",
  learning: "bg-badge-default-soft-bg border border-dashed border-status-neutral-text",
  gap: "bg-badge-amber-soft-text",
  none: "bg-status-neutral-text",
  s1: "bg-map-seq-1",
  s2: "bg-map-seq-2",
  s3: "bg-map-seq-3",
  s4: "bg-map-seq-4",
  s5: "bg-map-seq-5",
};
const LEGEND: Record<CoverageFill, { cls: HexClass; key: I18nKey }[]> = {
  state: [
    { cls: "gap", key: "autoobserve.coverage.gap" },
    { cls: "learning", key: "autoobserve.coverage.learning" },
    { cls: "watched", key: "autoobserve.coverage.watched" },
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
const props = defineProps<{
  ledger: LedgerEntry[];
  scenario: Scenario;
  source?: CoverageSource;
  skeleton?: boolean;
  explain?: boolean;
  /** The page above already draws the watched-and-gap bar, so this tab must not draw a second one. */
  headerBar?: boolean;
}>();

const emit = defineEmits<{ "how-it-works": [] }>();

const liveHolds = computed(
  () =>
    !!props.source &&
    (props.skeleton || props.source.status !== "ready" || !props.source.rows.length),
);

const liveNoticeView = computed(() =>
  props.source?.status === "error" && props.source.failure
    ? liveNotice(t, "coverage", props.source.failure)
    : null,
);

const emptyNotice = computed(() =>
  emptyCoverageNotice(t, locale.value, props.source?.passMinutes ?? null),
);

const loadPhase = useLoadPhase(
  () => props.source?.status ?? "ready",
  computed(() => !!props.skeleton),
);
const loadText = computed(() => liveLoadText(t, "coverage", loadPhase.value));

const filters = computed(() => (props.source ? LIVE_FILTERS : FILTERS));
const fills = computed(() => (props.source ? LIVE_FILLS : FILLS));

const filterLabel = (option: CoverageFilter): I18nText => {
  const word = props.source ? LIVE_FILTER_WORD[option] : undefined;
  return word ? coverageWord(t, word) : t(FILTER_LABEL[option]);
};

const hasState = (row: CoverageRow, state: CellState) =>
  SIGNALS.some((s) => row.cells[s].state === state);

const rank = (row: CoverageRow) => {
  if (row.status) return row.status.state === "gap" ? 0 : 2;
  if (hasState(row, "gap")) return 0;
  return hasState(row, "learning") ? 1 : 2;
};

const serviceState = (row: CoverageRow): ServiceState =>
  (["gap", "learning", "watched"] as const)[rank(row)];

const learnedDays = (row: CoverageRow) =>
  SIGNALS.map((s) => row.cells[s].progress).find(Boolean) ?? null;

const allRows = computed(() =>
  [...(props.source ? props.source.rows : coverageFor(props.scenario, t))].sort(
    (a, b) => rank(a) - rank(b) || a.service.localeCompare(b.service),
  ),
);
const totals = computed(() => props.source?.totals ?? coverageStats(props.scenario));

const serviceStates = computed(() =>
  Object.fromEntries(allRows.value.map((r) => [r.service, serviceState(r)])),
);

const watchedPct = computed(() =>
  totals.value.total ? Math.round((100 * totals.value.fullyWatched) / totals.value.total) : 0,
);

const split = computed(() => [
  { cls: "bg-badge-success-soft-text", count: totals.value.fullyWatched },
  { cls: "bg-status-neutral-text/60", count: totals.value.learning },
  { cls: "bg-badge-amber-soft-text", count: totals.value.gaps },
]);

const summaryText = computed(() => {
  const params = {
    watched: totals.value.fullyWatched,
    total: totals.value.total,
    pct: watchedPct.value,
  };
  return props.source
    ? t("autoobserveLive.coverage.summaryWatched", params)
    : t("autoobserve.coverage.summaryWatched", params);
});

const splitLabel = computed(() =>
  props.source
    ? t("autoobserveLive.coverage.splitLabel", {
        watched: totals.value.fullyWatched,
        gaps: totals.value.gaps,
      })
    : t("autoobserve.coverage.splitLabel", {
        watched: totals.value.fullyWatched,
        learning: totals.value.learning,
        gaps: totals.value.gaps,
      }),
);

const planned = computed(
  () => props.source?.planned ?? new Set(planFor(props.scenario).map((p) => p.service)),
);

const pick = <T extends string>(value: unknown, options: T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const query = ref("");
const term = computed(() => query.value.trim().toLowerCase());
const filter = ref<CoverageFilter>("all");
const view = ref<CoverageView>(pick(route.query.cov, VIEWS, "map"));
const fill = ref<CoverageFill>(pick(route.query.fill, fills.value, "state"));
const highlight = ref<HexClass[]>([]);

const initialService = typeof route.query.service === "string" ? route.query.service : null;
const initialSignal = pick<Signal | LiveCheck | "">(
  route.query.signal,
  [...SIGNALS, "absence"],
  "",
);
const selected = ref<{ service: string; signal: Signal | LiveCheck | null } | null>(
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

// Search matches the columns on screen: the live table shows Where, the fixture table shows Stream.
const searched = computed(() =>
  allRows.value.filter(
    (r) =>
      !term.value ||
      r.service.toLowerCase().includes(term.value) ||
      (props.source ? (r.where ?? "") : r.stream).toLowerCase().includes(term.value),
  ),
);
const searchPlaceholder = computed(() =>
  props.source
    ? t("autoobserveLive.coverage.searchPlaceholder")
    : t("autoobserve.coverage.searchPlaceholder"),
);
const rows = computed(() => searched.value.filter((r) => inFilter(r, filter.value)));

const matches = computed(() => (term.value ? new Set(searched.value.map((r) => r.service)) : null));

const counts = computed(
  () =>
    Object.fromEntries(
      filters.value.map((f) => [f, searched.value.filter((r) => inFilter(r, f)).length]),
    ) as Record<CoverageFilter, number>,
);

const announcement = computed(() => {
  const count = view.value === "map" ? searched.value.length : rows.value.length;
  return term.value ? t("autoobserve.coverage.matchCount", { count }, count) : "";
});

// Live search matches service, cluster and namespace; the fixture table's matches service or stream.
const noMatchTitle = computed(() =>
  props.source
    ? t("autoobserveLive.coverage.noMatch", { query: raw(term.value) })
    : t("autoobserve.coverage.noMatch", { query: raw(term.value) }),
);

const filterHidesTitle = computed(() => {
  const count = searched.value.length;
  const state = filterLabel(filter.value);
  return term.value
    ? t(
        "autoobserveLive.coverage.filterHidesSearch",
        { count, query: raw(term.value), state },
        count,
      )
    : t("autoobserveLive.coverage.filterHides", { state });
});

const clearSearch = () => {
  query.value = "";
  document.getElementById(SEARCH_ID)?.focus();
};

const fillClass = (row: CoverageRow): HexClass => {
  const state = serviceState(row);
  if (fill.value === "state") return state;
  if (fill.value === "learning") {
    if (state === "gap" || props.source) return "none";
    const days = learnedDays(row)?.[0];
    if (days == null) return "s1";
    if (days >= 6) return "s2";
    return days >= 3 ? "s3" : "s4";
  }
  if (fill.value === "detectors") {
    const n = detectorsOf(row);
    if (n === 0) return "none";
    if (props.source) return n >= 3 ? "s1" : n === 2 ? "s2" : "s3";
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
  if (row.status) return row.status.label;
  const state = serviceState(row);
  const days = learnedDays(row);
  if (state === "learning" && days)
    return t("autoobserve.coverage.stateLearning", { days: days[0], total: days[1] });
  return state === "gap"
    ? t("autoobserve.coverage.stateGap")
    : t("autoobserve.coverage.stateWatched");
};

const detectorText = (row: CoverageRow) => detectorCountText(t, detectorsOf(row));

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
  (props.source && fill.value === "state"
    ? LIVE_STATE_LEGEND.map(({ cls, state }) => ({ cls, label: coverageWord(t, state) }))
    : (props.source && fill.value === "detectors" ? LIVE_DETECTOR_LEGEND : LEGEND[fill.value]).map(
        ({ cls, key }) => ({ cls, label: t(key) }),
      )
  ).map((item) => ({
    ...item,
    count: searched.value.filter((r) => fillClass(r) === item.cls).length,
  })),
);

const fillOptions = computed(() => fills.value.map((f) => ({ label: t(FILL_LABEL[f]), value: f })));

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

const isSelected = (service: string, signal: Signal | LiveCheck) =>
  selected.value?.service === service && selected.value.signal === signal;

const railTone = (row: CoverageRow): RowRailTone | null =>
  (["amber", "neutral", null] as const)[rank(row)];

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
  if (cell.state === "gap")
    return props.source && cell.reason
      ? cell.reason
      : t("autoobserve.coverage.tipGap", { signal: name });
  return props.source
    ? t("autoobserveLive.cell.tipNoClass", { signal: name })
    : t("autoobserve.coverage.tipNa", { signal: name });
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

const isAdded = (row: CoverageRow, check: LiveCheck) =>
  !!props.source &&
  justAdded(String(store.state.selectedOrganization?.identifier ?? ""), row, check);
const cellLook = (row: CoverageRow, check: LiveCheck) =>
  liveCellLook(row.checks?.[check].engine?.stateKey ?? "none", isAdded(row, check));
const liveCellAria = (row: CoverageRow, check: LiveCheck) =>
  liveCheckText(t, check, row.checks?.[check].engine?.stateKey ?? "none", isAdded(row, check));

const SERVICE_COLUMN: OTableColumnDef<CoverageRow> = {
  id: "service",
  header: t("autoobserve.coverage.service"),
  accessorKey: "service",
  size: 160,
  sortable: true,
};

// Sorting a check column puts the worst first: no monitor, then the ways one falls short, then covered.
const CHECK_RANK: Record<string, number> = {
  none: 0,
  blind: 1,
  unmapped: 2,
  silent: 3,
  weak: 4,
  covered: 5,
};

const liveColumns: OTableColumnDef<CoverageRow>[] = [
  SERVICE_COLUMN,
  {
    id: "where",
    header: t("autoobserveLive.coverage.columns.where"),
    accessorFn: (row: CoverageRow) => row.where ?? "",
    size: 170,
    sortable: true,
  },
  ...LIVE_CHECKS.map((check) => ({
    id: `check-${check}`,
    header: liveCheckName(t, check),
    accessorFn: (row: CoverageRow) => CHECK_RANK[row.checks?.[check].engine?.stateKey ?? "none"],
    size: 130,
    sortable: true,
  })),
  {
    id: "state",
    header: t("autoobserveLive.coverage.columns.state"),
    accessorFn: (row: CoverageRow) => rank(row),
    size: 130,
    sortable: true,
  },
  {
    id: "lastScanned",
    header: t("autoobserveLive.coverage.columns.lastChecked"),
    accessorFn: (row: CoverageRow) => row.scannedMinutes ?? Number.MAX_SAFE_INTEGER,
    size: 130,
    sortable: true,
  },
];

const fixtureColumns: OTableColumnDef<CoverageRow>[] = [
  SERVICE_COLUMN,
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

const columns = computed(() => (props.source ? liveColumns : fixtureColumns));
</script>
