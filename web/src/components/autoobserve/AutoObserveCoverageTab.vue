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
    <span class="sr-only" role="status" data-test="autoobserve-coverage-announce">{{
      loadText
    }}</span>
    <div
      v-if="liveHolds"
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
        class="px-page-edge border-border-default flex min-h-14 flex-wrap items-center gap-x-5 gap-y-2 border-b py-3"
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
            t("autoobserve.coverage.addedThisWeek", { count: num(totals.added) }, totals.added)
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
          v-if="source.stale"
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
              <span class="text-text-secondary tabular-nums">{{ num(item.count) }}</span>
            </OToggleGroupItem>
          </OToggleGroup>
        </template>
        <OToggleGroup
          v-else
          :model-value="filter"
          :aria-label="t('autoobserve.coverage.filterLabel')"
          data-test="autoobserve-coverage-filter"
          @update:model-value="(v) => v && chooseFilter(v as CoverageFilter)"
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
            <span class="ms-1 tabular-nums">{{ num(counts[option]) }}</span>
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
            :selected="selectedHex"
            :matches="matches"
            @select="selectHex"
          />
          <p
            v-if="mapView.more"
            class="text-text-secondary mt-3 flex flex-wrap items-center gap-x-2 text-xs tabular-nums"
            data-test="autoobserve-coverage-map-more"
          >
            {{ t("autoobserve.coverage.mapMore", { count: num(mapView.more) }, mapView.more) }}
            <OButton
              variant="ghost-primary"
              size="sm"
              data-test="autoobserve-coverage-map-more-table"
              @click="showAllInTable"
            >
              {{ t("autoobserve.coverage.showInTable") }}
            </OButton>
          </p>
        </div>
      </template>

      <template v-else>
        <OTable
          v-model:expanded-ids="expanded"
          :data="tableRows"
          :columns="columns"
          :frame="false"
          row-key="service"
          pagination="none"
          :show-global-filter="false"
          sorting="server"
          :sort-by="sortBy"
          :sort-order="sortOrder"
          tree
          :row-rail-tone="railTone"
          :row-class="rowClass"
          class="min-h-0 flex-1"
          data-test="autoobserve-coverage-matrix"
          @sort-change="onSort"
        >
          <template #cell-service="{ row }">
            <span class="text-text-heading font-medium">{{
              isGroup(row) ? row.title : row.service
            }}</span>
          </template>
          <template #cell-where="{ row }">
            <span
              v-if="isGroup(row)"
              class="text-text-secondary tabular-nums"
              :data-test="`autoobserve-coverage-group-${row.title}`"
              :data-group-key="row.service"
              >{{ groupWhere(row) }}</span
            >
            <span v-else class="text-text-secondary">{{ row.where }}</span>
          </template>
          <template #cell-traffic="{ row }">
            <span
              class="tabular-nums"
              :class="trafficOf(row) == null ? 'text-text-muted' : 'text-text-body'"
              >{{ trafficText(trafficOf(row)) }}</span
            >
          </template>
          <template v-for="check in LIVE_CHECKS" :key="check" #[`cell-check-${check}`]="{ row }">
            <span
              v-if="isGroup(row)"
              class="text-text-secondary flex items-center gap-1.5 text-xs tabular-nums"
            >
              <template v-if="groupGaps(row, check)">
                <OTag
                  variant="warning-soft"
                  size="xs"
                  :label="t('autoobserve.coverageLive.gapChip')"
                />
                {{
                  t("autoobserve.coverage.groupOf", {
                    count: num(groupGaps(row, check)),
                    total: num(row.children.length),
                  })
                }}
              </template>
            </span>
            <OButton
              v-else-if="row.checks"
              variant="ghost"
              size="sm"
              class="text-text-body -ms-1.5 gap-1.5 px-1.5 font-normal"
              :active="isSelected(row.service, check)"
              :title="row.checks[check].state === 'gap' ? row.checks[check].reason : undefined"
              :aria-label="liveCellAria(row, check)"
              :aria-pressed="isSelected(row.service, check)"
              :data-test="`autoobserve-coverage-cell-${row.service}-${check}`"
              @click="selected = { service: row.service, signal: check }"
            >
              <OTag
                v-if="AMBER_LOOKS.has(cellLook(row, check))"
                variant="warning-soft"
                size="xs"
                :label="
                  cellLook(row, check) === 'weak'
                    ? liveLookWord(t, 'weak')
                    : t('autoobserve.coverageLive.gapChip')
                "
              />
              <span v-else-if="cellLook(row, check) === 'learning'" class="text-text-secondary">{{
                liveLookWord(t, "learning")
              }}</span>
              <template v-else>
                <span
                  class="size-2 shrink-0 rounded-full"
                  :class="LIVE_DOT[cellLook(row, check)]"
                  aria-hidden="true"
                /><span :class="cellLook(row, check) === 'covered' ? 'sr-only' : ''">{{
                  liveLookWord(t, cellLook(row, check))
                }}</span>
              </template>
            </OButton>
          </template>
          <template #cell-state="{ row }">
            <span v-if="isGroup(row)" class="text-text-body text-xs tabular-nums">{{
              groupState(row)
            }}</span>
            <OTag
              v-else-if="row.status"
              :variant="STATE_TAG[row.status.state]"
              size="sm"
              :label="row.status.label"
              :data-test="`autoobserve-coverage-state-${row.service}`"
            />
          </template>
          <template #cell-lastScanned="{ row }">
            <span v-if="!isGroup(row)" class="text-text-secondary text-xs">{{
              row.lastScanned
            }}</span>
          </template>
          <template #empty>
            <OEmptyState
              v-if="searched.length && filter !== 'all'"
              size="block"
              illustration="no-results"
              :title="filterHidesTitle"
              :action-label="t('autoobserveLive.coverage.showAll')"
              data-test="autoobserve-coverage-filter-hides"
              @action="chooseFilter('all')"
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
            t("autoobserve.coverage.showing", { shown: num(rows.length), total: num(totals.total) })
          }}</span>
          <ODropdown align="start">
            <template #trigger>
              <OButton
                variant="ghost"
                size="xs"
                icon-right="expand-more"
                class="text-text-secondary -ms-1.5 font-normal tabular-nums"
                data-test="autoobserve-coverage-grouped"
                >{{ groupLine }}</OButton
              >
            </template>
            <ODropdownItem
              v-for="option in GROUP_PICKS"
              :key="option"
              role="menuitemradio"
              :aria-checked="option === groupPick"
              :data-test="`autoobserve-coverage-group-pick-${option}`"
              @select="groupPick = option"
            >
              <span class="flex-1">{{ t(GROUP_PICK_LABEL[option]) }}</span>
              <template #icon-right>
                <OIcon
                  name="check"
                  size="sm"
                  :class="option === groupPick ? 'text-text-heading' : 'invisible'"
                />
              </template>
            </ODropdownItem>
          </ODropdown>
          <span v-if="unknownShown" data-test="autoobserve-coverage-traffic-unknown">{{
            t("autoobserve.coverage.trafficUnknown")
          }}</span>
          <ul
            class="ms-auto flex flex-wrap items-center gap-x-4 gap-y-1"
            :aria-label="t('autoobserve.coverage.legendLabel')"
          >
            <li
              class="flex items-center gap-1.5"
              data-test="autoobserve-coverage-legend-covered-key"
            >
              <span class="size-2 rounded-full" :class="LIVE_DOT.covered" />{{
                liveLookWord(t, "covered")
              }}
            </li>
            <li class="flex items-center gap-1.5" data-test="autoobserve-coverage-legend-gap-key">
              <OTag
                variant="warning-soft"
                size="xs"
                :label="t('autoobserve.coverageLive.gapChip')"
              />
              {{ liveLookWord(t, "gap") }}
            </li>
            <li
              v-if="hasWeak"
              class="flex items-center gap-1.5"
              data-test="autoobserve-coverage-legend-weak-key"
            >
              <OTag variant="warning-soft" size="xs" :label="liveLookWord(t, 'weak')" />
              {{ t("autoobserve.coverageLive.weakLegend") }}
            </li>
            <li
              v-if="totals.learning"
              class="flex items-center gap-1.5"
              data-test="autoobserve-coverage-legend-learning-key"
            >
              {{ coverageWord(t, "learning") }}
            </li>
          </ul>
        </div>
      </template>
    </div>

    <CoverageServiceDrawer
      v-if="selectedRow"
      :row="selectedRow"
      :service-states="serviceStates"
      :expanded="selected?.signal ?? null"
      :anchor="DRAWER_ANCHOR"
      :history-days-needed="source.learning?.history_days_needed"
      message=""
      @close="closeDrawer"
      @expand="(signal) => selected && (selected = { ...selected, signal })"
      @select="(service) => (selected = { service, signal: null })"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { OTableColumnDef, OTableSortParams, RowRailTone } from "@/lib/core/Table/OTable.types";
import { formatLargeNumber } from "@/utils/formatters";
import CoverageHexMap, { type HexClass, type HexItem } from "./CoverageHexMap.vue";
import CoverageServiceDrawer from "./CoverageServiceDrawer.vue";
import {
  SIGNALS,
  detectorsOf,
  LIVE_CHECKS,
  type CoverageRow,
  type LiveCheck,
  type Signal,
} from "./aoTypes";
import type { CoverageSource } from "./live/liveAdapter";
import {
  countText,
  coverageWord,
  detectorCountText,
  emptyCoverageNotice,
  LIVE_DOT,
  liveCellLook,
  liveCheckName,
  liveCheckText,
  liveLoadText,
  liveLookWord,
  liveNotice,
  percentText,
  type LiveCellLook,
  type LiveCoverageState,
} from "./live/liveCopy";
import { useStore } from "vuex";
import { useLoadPhase } from "./live/liveModel";
import { justAdded } from "./insight/coverageCta";
import LiveNoticeState from "./live/LiveNoticeState.vue";
import LiveRefreshFailed from "./live/LiveRefreshFailed.vue";
import {
  chooseCoverageGrouping,
  coverageName,
  coveragePlace,
  SERVICE_RANK,
  SORT_KEYS,
  chooseMapGrouping,
  groupCoverage,
  groupPrefix,
  groupWorst,
  isGroup,
  mapCoverage,
  serviceState,
  sortCoverage,
  sortValue,
  type CoverageGroup,
  type CoverageGroupBy,
  type CoverageGrouper,
  type CoverageSortKey,
  type CoverageTableRow,
  type ServiceState,
} from "./coverageTable";

type CoverageFilter = "needs" | "all" | "watched" | "partial" | "learning" | "gaps";
type CoverageView = "map" | "table";
type CoverageFill = "state" | "detectors" | "scanned";

const { t, locale } = useI18nTyped();
const num = (n: number) => countText(locale.value, n);
const store = useStore();
const route = useRoute();
const router = useRouter();

const SEARCH_ID = "autoobserve-coverage-search";
const DRAWER_ANCHOR = "[data-autoobserve-coverage]";
const MAP_SKELETON_HEXES = 18;
// Past this many hexes the map stops being readable, so it draws groups and counts the rest.
const MAP_HEX_CAP = 200;
type GroupPick = "auto" | CoverageGroupBy;
const GROUP_PICKS: GroupPick[] = ["auto", "service", "place", "none"];
const GROUP_PICK_LABEL: Record<GroupPick, I18nKey> = {
  auto: "autoobserve.coverage.groupPick.auto",
  service: "autoobserve.coverage.groupPick.service",
  place: "autoobserve.coverage.groupPick.place",
  none: "autoobserve.coverage.groupPick.none",
};
// Learning shows only while some service learns.
const FILTERS: CoverageFilter[] = ["needs", "all", "watched", "partial", "learning", "gaps"];
const VIEWS: CoverageView[] = ["map", "table"];
const FILLS: CoverageFill[] = ["state", "detectors", "scanned"];
const FILTER_WORD: Partial<Record<CoverageFilter, LiveCoverageState>> = {
  watched: "watched",
  partial: "partial",
  learning: "learning",
  gaps: "gap",
};
// The home and the coverage bar name a filter by what the reader wants to see.
const FILTER_ALIAS: Record<string, CoverageFilter> = {
  attention: "gaps",
  watching: "watched",
};
// Partly watched and learning appear in the legend only while some service is in them.
const OPTIONAL_STATES: ReadonlySet<HexClass> = new Set(["partial", "learning"]);
const AMBER_LOOKS: ReadonlySet<LiveCellLook> = new Set(["gap", "weak"]);
const STATE_TAG: Record<ServiceState, BadgeVariant> = {
  gap: "warning-soft",
  partial: "warning-outline",
  learning: "default-soft",
  watched: "success-soft",
};
// Three checks, so a service's alerts fall in 3+, 2, 1 or none.
const DETECTOR_LEGEND: { cls: HexClass; key: I18nKey }[] = [
  { cls: "s1", key: "autoobserveLive.coverage.bucketThree" },
  { cls: "s2", key: "autoobserveLive.coverage.bucketTwo" },
  { cls: "s3", key: "autoobserveLive.coverage.bucketOne" },
  { cls: "none", key: "autoobserve.coverage.bucketNone" },
];
const STATE_LEGEND: { cls: HexClass; state: LiveCoverageState }[] = [
  { cls: "gap", state: "gap" },
  { cls: "partial", state: "partial" },
  { cls: "learning", state: "learning" },
  { cls: "watched", state: "watched" },
];

const FILL_LABEL: Record<CoverageFill, I18nKey> = {
  state: "autoobserve.coverage.fillState",
  detectors: "autoobserve.coverage.fillDetectors",
  scanned: "autoobserve.coverage.fillScanned",
};
const SWATCH: Record<HexClass, string> = {
  watched: "bg-badge-success-soft-text/15 border border-badge-success-soft-text/60",
  partial: "bg-ingest-accent-amber/25 border border-ingest-accent-amber",
  learning: "bg-badge-default-soft-bg border border-dashed border-status-neutral-text",
  gap: "bg-ingest-accent-amber",
  none: "bg-status-neutral-text",
  s1: "bg-map-seq-1",
  s2: "bg-map-seq-2",
  s3: "bg-map-seq-3",
  s4: "bg-map-seq-4",
  s5: "bg-map-seq-5",
};
const SCANNED_LEGEND: { cls: HexClass; key: I18nKey }[] = [
  { cls: "s1", key: "autoobserve.coverage.bucketFresh" },
  { cls: "s2", key: "autoobserve.coverage.bucketRecent" },
  { cls: "s3", key: "autoobserve.coverage.bucketHour" },
  { cls: "s5", key: "autoobserve.coverage.bucketStale" },
  { cls: "none", key: "autoobserve.coverage.bucketNotScanned" },
];
const props = defineProps<{
  source: CoverageSource;
  skeleton?: boolean;
  explain?: boolean;
  /** The page above already draws the watched-and-gap bar, so this tab must not draw a second one. */
  headerBar?: boolean;
}>();

const emit = defineEmits<{ "how-it-works": [] }>();

const liveHolds = computed(
  () => props.skeleton || props.source.status !== "ready" || !props.source.rows.length,
);

const liveNoticeView = computed(() =>
  props.source.status === "error" && props.source.failure
    ? liveNotice(t, "coverage", props.source.failure)
    : null,
);

const emptyNotice = computed(() => emptyCoverageNotice(t, locale.value, props.source.passMinutes));

const loadPhase = useLoadPhase(
  () => props.source.status,
  computed(() => !!props.skeleton),
);
const loadText = computed(() => liveLoadText(t, "coverage", loadPhase.value));

const filters = computed(() =>
  FILTERS.filter((f) => f !== "learning" || props.source.totals.learning > 0),
);

const filterLabel = (option: CoverageFilter): I18nText => {
  const word = FILTER_WORD[option];
  if (word) return coverageWord(t, word);
  return option === "needs" ? t("autoobserve.coverage.needsAction") : t("autoobserve.coverage.all");
};

const rank = (row: CoverageRow) => SERVICE_RANK[serviceState(row)];

const allRows = computed(() =>
  [...props.source.rows].sort((a, b) => rank(a) - rank(b) || a.service.localeCompare(b.service)),
);
const totals = computed(() => props.source.totals);
// Weak appears in the legend only while some check in the table is weak, as Learning does.
const hasWeak = computed(() =>
  props.source.rows.some((r) => LIVE_CHECKS.some((c) => cellLook(r, c) === "weak")),
);

const serviceStates = computed(() =>
  Object.fromEntries(allRows.value.map((r) => [r.service, serviceState(r)])),
);

const split = computed(() => [
  { cls: "bg-badge-success-soft-text", count: totals.value.fullyWatched },
  { cls: "bg-ingest-accent-amber/50", count: totals.value.partial },
  { cls: "bg-status-neutral-text/60", count: totals.value.learning },
  { cls: "bg-ingest-accent-amber", count: totals.value.gaps },
]);

const summaryText = computed(() => {
  const params = {
    watched: num(totals.value.fullyWatched),
    total: num(totals.value.total),
    pct: percentText(t, locale.value, totals.value.fullyWatched, totals.value.total),
  };
  return t("autoobserveLive.coverage.summaryWatchedShare", params);
});

const splitLabel = computed(() =>
  t("autoobserveLive.coverage.splitLabel", {
    watched: num(totals.value.fullyWatched),
    gaps: num(totals.value.total - totals.value.fullyWatched),
  }),
);

const pick = <T extends string>(value: unknown, options: T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const query = ref("");
const term = computed(() => query.value.trim().toLowerCase());
type Selection = { service: string; signal: Signal | LiveCheck | null };

// Every setting the URL holds, read the same way on mount and on each later link or Back.
const fromUrl = () => {
  const q = route.query;
  const service = typeof q.service === "string" ? q.service : null;
  const signal = pick<Signal | LiveCheck | "">(q.signal, [...SIGNALS, "absence"], "") || null;
  return {
    filter: pick<CoverageFilter>(FILTER_ALIAS[String(q.filter)] ?? q.filter, FILTERS, "needs"),
    view: pick<CoverageView>(q.cov, VIEWS, "table"),
    fill: pick<CoverageFill>(q.fill, FILLS, "state"),
    sortBy: pick<CoverageSortKey>(q.sort, SORT_KEYS, "traffic"),
    sortOrder: pick<"asc" | "desc">(q.order, ["asc", "desc"], "desc"),
    groupPick: pick<GroupPick>(q.group, GROUP_PICKS, "auto"),
    selected: service ? ({ service, signal } as Selection) : null,
  };
};
const linked = fromUrl();
const filter = ref(linked.filter);
const settled = computed(() => !props.skeleton && props.source.status === "ready");
// Learning is only offered once a settled read holds a learning service, so a link's filter waits for it.
watch(
  () => settled.value && !filters.value.includes(filter.value),
  (gone) => {
    if (gone) filter.value = "all";
  },
  { immediate: true },
);
// Needs action reads All while nothing needs action, and comes back when a later scan finds some.
const needsFellBack = ref(false);
watch(
  [settled, () => totals.value.gaps + totals.value.partial, filter],
  ([ready, needing]) => {
    if (filter.value !== "all") needsFellBack.value = false;
    if (!ready) return;
    if (!needing && filter.value === "needs") {
      needsFellBack.value = true;
      filter.value = "all";
    } else if (needing && needsFellBack.value) {
      needsFellBack.value = false;
      filter.value = "needs";
    }
  },
  { immediate: true },
);
// A filter the reader or a link picks is theirs, even when it is the All a fallback already showed.
const chooseFilter = (next: CoverageFilter) => {
  needsFellBack.value = false;
  filter.value = next;
};
const view = ref(linked.view);
const fill = ref(linked.fill);
const sortBy = ref(linked.sortBy);
const sortOrder = ref(linked.sortOrder);
const expanded = ref<string[]>([]);
// Automatic regroups as a search or filter narrows the rows; a picked grouping stays put.
const groupPick = ref(linked.groupPick);

// OTable clears a column clicked while descending; traffic descending is the default, so there
// the clear reverses it, and any other column's clear goes back to the default.
const onSort = ({ column, order }: OTableSortParams) => {
  if (!column && sortBy.value === "traffic" && sortOrder.value === "desc") {
    sortOrder.value = "asc";
    return;
  }
  sortBy.value = pick(column, SORT_KEYS, "traffic");
  sortOrder.value = column && order === "asc" ? "asc" : "desc";
};
const highlight = ref<HexClass[]>([]);

const selected = ref<Selection | null>(linked.selected);

// The tab stays mounted across links and Back, so a URL change carries every setting it holds.
watch(
  () => JSON.stringify(fromUrl()),
  () => {
    const next = fromUrl();
    chooseFilter(next.filter);
    view.value = next.view;
    fill.value = next.fill;
    sortBy.value = next.sortBy;
    sortOrder.value = next.sortOrder;
    groupPick.value = next.groupPick;
    if (JSON.stringify(selected.value) !== JSON.stringify(next.selected))
      selected.value = next.selected;
  },
);

const selectService = (service: string) => {
  selected.value = selected.value?.service === service ? null : { service, signal: null };
};

watch(fill, () => {
  highlight.value = [];
});

watch([view, fill, selected, filter, groupPick, sortBy, sortOrder], () => {
  const sorted = sortBy.value !== "traffic" || sortOrder.value !== "desc";
  void router.replace({
    query: {
      ...route.query,
      cov: view.value === "table" ? undefined : view.value,
      fill: fill.value === "state" ? undefined : fill.value,
      filter: filter.value === "needs" || needsFellBack.value ? undefined : filter.value,
      group: groupPick.value === "auto" ? undefined : groupPick.value,
      sort: sorted ? sortBy.value : undefined,
      order: sorted ? sortOrder.value : undefined,
      service: selected.value?.service,
      signal: selected.value?.signal ?? undefined,
    },
  });
});

const inFilter = (row: CoverageRow, f: CoverageFilter) => {
  if (f === "needs") return serviceState(row) === "gap" || serviceState(row) === "partial";
  if (f === "watched") return serviceState(row) === "watched";
  if (f === "partial") return serviceState(row) === "partial";
  if (f === "learning") return serviceState(row) === "learning";
  if (f === "gaps") return serviceState(row) === "gap";
  return true;
};

// Search matches the columns on screen: service and Where.
const searched = computed(() =>
  allRows.value.filter(
    (r) =>
      !term.value ||
      r.service.toLowerCase().includes(term.value) ||
      (r.where ?? "").toLowerCase().includes(term.value),
  ),
);
const searchPlaceholder = computed(() => t("autoobserveLive.coverage.searchPlaceholder"));
const rows = computed(() => searched.value.filter((r) => inFilter(r, filter.value)));

// A row with no place never folds by place, so no catch-all group hides the services outside one.
const GROUPERS: Record<CoverageGroupBy, CoverageGrouper | null> = {
  none: null,
  service: { keyOf: coverageName, titleOf: coverageName },
  place: { keyOf: coveragePlace, titleOf: (row) => coveragePlace(row) ?? row.service },
};
// The rows on screen pick their own grouping, so a search that leaves a few shows them flat.
const group = computed(() =>
  groupPick.value === "auto"
    ? chooseCoverageGrouping(rows.value, coverageName, coveragePlace)
    : groupPick.value,
);
watch(group, () => (expanded.value = []));

const tableRows = computed(() => {
  const grouper = GROUPERS[group.value];
  return sortCoverage(
    grouper
      ? groupCoverage(rows.value, grouper.keyOf, grouper.titleOf, groupPrefix(allRows.value))
      : rows.value,
    sortBy.value,
    sortOrder.value,
  );
});

const trafficOf = (row: CoverageTableRow) => row.traffic ?? null;
const unknownShown = computed(() => rows.value.some((r) => r.traffic == null));

// Rows left apart for having no place are not places, so a place count skips them.
const groupLines = (lines: CoverageTableRow[], by: CoverageGroupBy) =>
  by === "place"
    ? lines.filter((r) => isGroup(r) || coveragePlace(r) !== null).length
    : lines.length;

const groupLine = computed((): I18nText => {
  if (group.value === "none") return t("autoobserve.coverage.groupedBy.none");
  const lines = groupLines(tableRows.value, group.value);
  return t(`autoobserve.coverage.groupedBy.${group.value}`, { count: num(lines) }, lines);
});
const trafficText = (value: number | null) =>
  value == null ? raw("—") : raw(formatLargeNumber(Math.round(value)));

const groupWhere = (row: CoverageGroup): I18nText => {
  const count = row.children.length;
  const places = new Set(row.children.map(coveragePlace).filter((p) => p !== null)).size;
  if (group.value !== "service" || places !== count)
    return t("autoobserve.coverage.groupServices", { count: num(count) }, count);
  return t("autoobserve.coverage.groupPlaces", { count: num(places) }, places);
};

const groupGaps = (row: CoverageGroup, check: LiveCheck) =>
  row.children.filter((c) => AMBER_LOOKS.has(cellLook(c, check))).length;

// Worst state first, so the count a reader acts on leads.
const groupState = (row: CoverageGroup): I18nText =>
  raw(
    (["gap", "partial", "learning", "watched"] as const)
      .filter((state) => row.counts[state])
      .map((state) =>
        t(
          `autoobserve.coverage.groupCount.${state}`,
          { count: num(row.counts[state]) },
          row.counts[state],
        ),
      )
      .join(" · "),
  );

// A group hex is drawn as its worst service, so it lights when any service in it matches.
const matches = computed(() => {
  const lit = highlight.value;
  if (!term.value && !lit.length) return null;
  const keys = new Set(
    searched.value.filter((r) => !lit.length || lit.includes(fillClass(r))).map((r) => r.service),
  );
  for (const hex of mapView.value.items)
    if (isGroup(hex) && hex.children.some((c) => keys.has(c.service))) keys.add(hex.service);
  return keys;
});

const counts = computed(
  () =>
    Object.fromEntries(
      filters.value.map((f) => [f, searched.value.filter((r) => inFilter(r, f)).length]),
    ) as Record<CoverageFilter, number>,
);

const announcement = computed(() => {
  const count = view.value === "map" ? searched.value.length : rows.value.length;
  return term.value ? t("autoobserve.coverage.matchCount", { count: num(count) }, count) : "";
});

const noMatchTitle = computed(() =>
  t("autoobserveLive.coverage.noMatch", { query: raw(term.value) }),
);

const filterHidesTitle = computed(() => {
  const count = searched.value.length;
  if (filter.value === "needs")
    return term.value
      ? t(
          "autoobserve.coverage.needsNoneSearch",
          { count: num(count), query: raw(term.value) },
          count,
        )
      : t("autoobserve.coverage.needsNone");
  const state = filterLabel(filter.value);
  return term.value
    ? t(
        "autoobserveLive.coverage.filterHidesSearch",
        { count: num(count), query: raw(term.value), state },
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
  if (fill.value === "detectors") {
    const n = detectorsOf(row);
    if (n === 0) return "none";
    return n >= 3 ? "s1" : n === 2 ? "s2" : "s3";
  }
  const minutes = row.scannedMinutes;
  if (minutes == null) return "none";
  if (minutes < 5) return "s1";
  if (minutes < 15) return "s2";
  return minutes < 60 ? "s3" : "s5";
};

const stateText = (row: CoverageRow): I18nText => row.status?.label ?? coverageWord(t, "gap");

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

const mapGroup = computed(() =>
  chooseMapGrouping(
    allRows.value,
    MAP_HEX_CAP,
    groupPick.value === "auto" ? null : groupPick.value,
    coverageName,
    coveragePlace,
  ),
);
const searchedSet = computed(() => (term.value ? new Set(searched.value) : null));
// Past the cap the selected service, then what the search and legend match, keep their hexes.
const mapView = computed(() => {
  const found = searchedSet.value;
  const lit = highlight.value;
  const chosen = selected.value?.service;
  const rowRank = (r: CoverageRow) => {
    if (r.service === chosen) return 0;
    return (!found || found.has(r)) && (!lit.length || lit.includes(fillClass(r))) ? 1 : 2;
  };
  const rank =
    found || lit.length || chosen
      ? (hex: CoverageTableRow) =>
          isGroup(hex)
            ? hex.children.reduce((min, c) => Math.min(min, rowRank(c)), 2)
            : rowRank(hex)
      : null;
  return mapCoverage(allRows.value, MAP_HEX_CAP, GROUPERS[mapGroup.value], rank);
});

// A group hex takes the look of its worst service, which sorts first inside it.
const toGroupItem = (row: CoverageGroup): HexItem => {
  const worst = row.children[0];
  const count = row.children.length;
  const state = groupState(row);
  return {
    key: row.service,
    title: String(t("autoobserve.coverage.hexGroup", { name: raw(row.title), count: num(count) })),
    cls: fillClass(worst),
    stateCls: groupWorst(row),
    state,
    stream: "",
    detectors: t("autoobserve.coverage.groupServices", { count: num(count) }, count),
    name: t("autoobserve.coverage.hexGroupName", { name: raw(row.title), state }),
  };
};

// A grouped map has no hex of the selected service's own, so its group's hex carries the selection.
const selectedHex = computed(() => {
  const service = selected.value?.service;
  const hex = service
    ? mapView.value.items.find((h) =>
        isGroup(h) ? h.children.some((c) => c.service === service) : h.service === service,
      )
    : undefined;
  return hex?.service ?? null;
});

// allRows already leads with problems: gaps, then learning, then A to Z.
const items = computed(() =>
  mapView.value.items.map((row) => (isGroup(row) ? toGroupItem(row) : toItem(row))),
);

// A group folds only with two rows shown, so a search or filter that hides more gives way.
const showsGroup = (children: CoverageRow[], shown: CoverageRow[]) => {
  const set = new Set(shown);
  return children.filter((c) => set.has(c)).length > 1;
};

// The table takes the map's grouping, so the clicked group is a row it can open.
const selectHex = async (key: string) => {
  const hex = mapView.value.items.find((r) => r.service === key);
  if (!hex || !isGroup(hex)) return selectService(key);
  if (!showsGroup(hex.children, searched.value)) query.value = "";
  if (!showsGroup(hex.children, rows.value)) chooseFilter("all");
  if (group.value !== mapGroup.value) groupPick.value = mapGroup.value;
  view.value = "table";
  // Regrouping clears the open rows, so the group opens once that has run.
  await nextTick();
  // Keys stay unique per row set, so the table's copy of the group is found by what its rows share.
  const opened = tableRows.value.find((r) => isGroup(r) && r.id === hex.id);
  expanded.value = opened ? [opened.service] : [];
  await nextTick();
  [...document.querySelectorAll<HTMLElement>("[data-group-key]")]
    .find((el) => el.dataset.groupKey === opened?.service)
    ?.scrollIntoView?.({ block: "nearest" });
};

// The hexes past the cap include services Needs action or a search hides, so the table lists them all.
const showAllInTable = () => {
  query.value = "";
  chooseFilter("all");
  view.value = "table";
};

const legend = computed(() =>
  (fill.value === "state"
    ? STATE_LEGEND.map(({ cls, state }) => ({ cls, label: coverageWord(t, state) }))
    : (fill.value === "detectors" ? DETECTOR_LEGEND : SCANNED_LEGEND).map(({ cls, key }) => ({
        cls,
        label: t(key),
      }))
  )
    .map((item) => ({
      ...item,
      count: searched.value.filter((r) => fillClass(r) === item.cls).length,
    }))
    .filter((item) => !(OPTIONAL_STATES.has(item.cls) && !item.count)),
);

const fillOptions = computed(() => FILLS.map((f) => ({ label: t(FILL_LABEL[f]), value: f })));

// A group hex stands for all its services, so the label counts services, and groups apart.
const mapLabel = computed(() => {
  const hexes = mapView.value.items;
  const services = hexes.reduce((sum, h) => sum + (isGroup(h) ? h.children.length : 1), 0);
  const fillText = t(FILL_LABEL[fill.value]);
  const by = mapGroup.value;
  if (by === "none")
    return t("autoobserve.coverage.mapLabel", { count: num(services), fill: fillText }, services);
  return t(`autoobserve.coverage.mapLabelGrouped.${by}`, {
    services: t("autoobserve.coverage.groupServices", { count: num(services) }, services),
    groups: t(
      `autoobserve.coverage.mapGroupCount.${by}`,
      { count: num(groupLines(hexes, by)) },
      groupLines(hexes, by),
    ),
    fill: fillText,
  });
});

const selectedRow = computed(() =>
  selected.value ? allRows.value.find((r) => r.service === selected.value?.service) : undefined,
);

const isSelected = (service: string, signal: Signal | LiveCheck) =>
  selected.value?.service === service && selected.value.signal === signal;

const RAIL_TONE: Record<ServiceState, RowRailTone | null> = {
  gap: "amber",
  partial: null,
  learning: "neutral",
  watched: null,
};
const railTone = (row: CoverageTableRow): RowRailTone | null =>
  RAIL_TONE[isGroup(row) ? groupWorst(row) : serviceState(row)];

const rowClass = (row: CoverageTableRow) =>
  row.service === selected.value?.service ? "bg-table-row-selected-bg" : "";

// The drawer returns focus to whatever opened it first; the hex selected last is the one to land on.
const closeDrawer = () => {
  const service = selectedHex.value;
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
  justAdded(String(store.state.selectedOrganization?.identifier ?? ""), row, check);
const cellLook = (row: CoverageRow, check: LiveCheck) =>
  liveCellLook(
    row.checks?.[check].engine?.stateKey ?? "none",
    isAdded(row, check),
    serviceState(row) === "learning",
  );
const liveCellAria = (row: CoverageRow, check: LiveCheck) =>
  liveCheckText(
    t,
    check,
    row.checks?.[check].engine?.stateKey ?? "none",
    isAdded(row, check),
    serviceState(row) === "learning",
  );

const column = (
  id: CoverageSortKey,
  header: I18nText,
  size: number,
  meta?: OTableColumnDef<CoverageTableRow>["meta"],
): OTableColumnDef<CoverageTableRow> => ({
  id,
  header,
  accessorFn: (row: CoverageTableRow) => sortValue(row, id),
  size,
  sortable: true,
  ...(meta ? { meta } : {}),
});

const columns: OTableColumnDef<CoverageTableRow>[] = [
  column("service", t("autoobserve.coverage.service"), 220),
  column("where", t("autoobserveLive.coverage.columns.where"), 170),
  column("traffic", t("autoobserve.coverage.traffic"), 100, { align: "right" }),
  ...LIVE_CHECKS.map((check) => column(`check-${check}`, liveCheckName(t, check), 130)),
  column("state", t("autoobserveLive.coverage.columns.state"), 180),
  column("lastScanned", t("autoobserveLive.coverage.columns.lastChecked"), 130),
];
</script>
