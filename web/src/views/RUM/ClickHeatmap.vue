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
  <div class="h-full min-h-0" data-test="rum-heatmap-page">
    <div class="flex h-full min-h-0 flex-col">
      <div
        class="border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5"
        data-test="rum-heatmap-toolbar"
      >
        <div class="w-44 shrink-0 max-md:w-full">
          <OSelect
            v-model="rangeKey"
            :aria-label="t('rum.heatmap.rangeLabel')"
            :options="rangeOptions"
            size="sm"
            data-test="rum-heatmap-range-select"
            @update:model-value="loadApps"
          >
            <template #icon-left><OIcon name="schedule" size="sm" /></template>
          </OSelect>
        </div>
        <div class="w-48 shrink-0 max-md:w-full">
          <OSelect
            v-model="appId"
            :aria-label="t('rum.heatmap.appLabel')"
            :options="appOptions"
            size="sm"
            searchable
            data-test="rum-heatmap-app-select"
            @update:model-value="onAppChange"
          >
            <template #icon-left><OIcon name="view-in-ar" size="sm" /></template>
          </OSelect>
        </div>
        <OToggleGroup
          :model-value="deviceClass"
          :aria-label="t('rum.heatmap.deviceLabel')"
          mobile-dropdown
          data-test="rum-heatmap-device-select"
          @update:model-value="onDeviceChange"
        >
          <OToggleGroupItem
            v-for="opt in deviceOptions"
            :key="opt.value"
            :value="opt.value"
            :icon-left="opt.icon"
            size="sm"
            :data-test="`rum-heatmap-device-${opt.value}`"
          >
            {{ opt.label }}
          </OToggleGroupItem>
        </OToggleGroup>
        <div class="min-w-0 flex-[1_1_20rem]">
          <OPopover
            v-model:open="pageOpen"
            :aria-label="t('rum.heatmap.pageLabel')"
            content-class="w-(--reka-popover-trigger-width) p-0"
          >
            <template #trigger>
              <OButton
                variant="outline"
                size="sm"
                block
                :disabled="!pageRows.length"
                :aria-label="t('rum.heatmap.pageLabel')"
                data-test="rum-heatmap-page-select"
              >
                <template #icon-left><OIcon name="link" size="sm" /></template>
                <span
                  class="text-compact min-w-0 flex-1 truncate text-left font-mono"
                  :title="pageUrl"
                  data-test="rum-heatmap-page-current"
                >
                  {{ pageUrl || t("rum.heatmap.pagePlaceholder") }}
                </span>
                <span
                  class="text-text-muted text-xs font-normal"
                  data-test="rum-heatmap-page-count"
                >
                  {{ t("rum.heatmap.pageCount", { count: pageRows.length }, pageRows.length) }}
                </span>
                <template #icon-right><OIcon name="unfold-more" size="sm" /></template>
              </OButton>
            </template>
            <div class="flex flex-col" data-test="rum-heatmap-page-list">
              <div class="border-border-default border-b p-2">
                <OSearchInput
                  v-model="pageQuery"
                  :placeholder="t('rum.heatmap.pageSearch')"
                  data-test="rum-heatmap-page-search"
                />
              </div>
              <div
                class="text-text-muted grid grid-cols-[minmax(0,1fr)_4.5rem_5rem] gap-2 px-3 py-1.5 text-xs font-semibold"
              >
                <span>{{ t("rum.heatmap.pageColPage") }}</span>
                <span class="text-right">{{ t("rum.heatmap.colClicks") }}</span>
                <span class="text-right">{{ t("rum.heatmap.colSessions") }}</span>
              </div>
              <div class="max-h-72 overflow-auto">
                <OButton
                  v-for="p in visiblePages"
                  :key="p.url"
                  variant="ghost"
                  size="sm"
                  block
                  :data-test="`rum-heatmap-page-option-${p.url}`"
                  @click="onPagePick(p.url)"
                >
                  <span
                    class="text-compact grid w-full grid-cols-[minmax(0,1fr)_4.5rem_5rem] items-center gap-2 text-left font-normal"
                    :class="p.url === pageUrl ? 'text-accent' : ''"
                  >
                    <span class="truncate font-mono" :title="p.url">{{ p.url }}</span>
                    <span class="text-right font-semibold">{{ addCommasToNumber(p.clicks) }}</span>
                    <span class="text-right">{{ addCommasToNumber(p.sessions) }}</span>
                  </span>
                </OButton>
                <p
                  v-if="!visiblePages.length"
                  class="text-text-muted px-3 py-4 text-center text-xs"
                  data-test="rum-heatmap-page-none"
                >
                  {{ t("rum.heatmap.pageNone") }}
                </p>
              </div>
            </div>
          </OPopover>
        </div>
      </div>

      <OBanner
        v-if="settingsFailed"
        variant="warning"
        dense
        :content="t('rum.heatmap.settingsFailed')"
        data-test="rum-heatmap-settings-failed"
      />
      <OBanner
        v-if="deviceSplitFailed"
        variant="warning"
        dense
        :content="t('rum.heatmap.deviceSplitFailed')"
        data-test="rum-heatmap-device-split-failed"
      />

      <OEmptyState
        v-if="!loading && !pageRows.length && !loadError"
        preset="no-data"
        :title="t('rum.heatmap.noPages')"
        data-test="rum-heatmap-empty"
      />
      <div v-else-if="loadError" class="p-4">
        <OBanner
          variant="warning"
          dense
          :content="loadError ?? undefined"
          data-test="rum-heatmap-load-error"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              data-test="rum-heatmap-retry-btn"
              @click="onRetry"
              >{{ t("common.retry") }}</OButton
            >
          </template>
        </OBanner>
      </div>
      <template v-else>
        <div
          v-if="summary.clicks"
          class="border-border-default bg-surface-subtle flex shrink-0 flex-wrap items-stretch gap-y-2 border-b px-4 py-2.5"
          data-test="rum-heatmap-stats"
        >
          <div
            v-for="stat in statItems"
            :key="stat.key"
            class="border-border-default flex min-w-0 flex-col justify-center border-e px-6 first:ps-0"
            :data-test="stat.dataTest"
          >
            <span class="text-text-secondary text-xs font-semibold">{{ stat.label }}</span>
            <span class="text-xl leading-tight font-bold" :class="stat.valueClass">{{
              stat.value
            }}</span>
          </div>
          <div
            v-if="summary.top"
            class="flex min-w-0 flex-1 flex-col justify-center px-6"
            data-test="rum-heatmap-stat-top"
          >
            <span class="text-text-secondary text-xs font-semibold">{{
              t("rum.heatmap.statTopElement")
            }}</span>
            <span class="min-w-0 truncate font-bold">
              {{ summary.top.name || summary.top.selector }}
              <span class="text-text-muted font-normal">{{
                t("rum.heatmap.statTopShare", {
                  pct: sharePercent(summary.top.clicks, summary.clicks),
                })
              }}</span>
            </span>
          </div>
        </div>
        <div
          class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,38%)] max-lg:grid-cols-1 max-lg:grid-rows-[minmax(24rem,1fr)_auto]"
        >
          <div class="relative min-h-0 min-w-0 p-4">
            <div
              ref="scrollerRef"
              class="rounded-surface border-border-default h-full min-w-0 overflow-auto border"
            >
              <OEmptyState
                v-if="snapshotError"
                size="block"
                :title="snapshotError"
                data-test="rum-heatmap-snapshot-error"
              />
              <OBanner
                v-if="pageUrl && !loading && !groups.length"
                variant="warning"
                dense
                :content="
                  deviceClass === 'all'
                    ? t('rum.heatmap.noPosition')
                    : t('rum.heatmap.noDeviceData')
                "
                data-test="rum-heatmap-no-position"
              />
              <div class="flex p-4">
                <div ref="fitRef" class="mx-auto shrink-0 overflow-hidden">
                  <OSpinner
                    v-if="snapshotLoading"
                    size="lg"
                    data-test="rum-heatmap-snapshot-loading"
                  />
                  <div
                    v-show="snapshotReady"
                    ref="stageRef"
                    role="img"
                    :aria-label="t('rum.heatmap.stageLabel')"
                    class="origin-top-left [&_.replayer-mouse]:hidden [&_.replayer-mouse-tail]:hidden"
                    data-test="rum-heatmap-stage"
                  />
                </div>
              </div>
            </div>
            <div
              v-if="snapshotReady"
              class="border-border-default bg-surface-base rounded-default pointer-events-none absolute bottom-8 left-8 flex items-center gap-2 border px-2.5 py-1.5 text-xs shadow-sm"
              data-test="rum-heatmap-legend"
            >
              {{ t("rum.heatmap.legendFewer") }}
              <span class="bg-heat-legend h-2 w-24 rounded-full" aria-hidden="true" />
              {{ t("rum.heatmap.legendMore") }}
            </div>
          </div>

          <div
            class="border-border-default flex min-h-0 flex-col border-s max-lg:border-s-0 max-lg:border-t"
          >
            <div class="border-border-default flex flex-col gap-2 border-b px-3 py-2.5">
              <OSearchInput
                v-model="elementQuery"
                :placeholder="t('rum.heatmap.elementSearch')"
                data-test="rum-heatmap-element-search"
              />
              <div class="flex flex-wrap items-center gap-1.5">
                <OBadge
                  v-for="chip in chips"
                  :key="chip.key"
                  :variant="chip.active ? 'primary-soft' : 'default-outline'"
                  clickable
                  :disabled="chip.disabled"
                  :title="chip.title"
                  :aria-pressed="chip.active"
                  :data-test="`rum-heatmap-chip-${chip.key}`"
                  @click="chip.toggle"
                >
                  {{ chip.label }}
                </OBadge>
                <span class="text-text-muted ms-auto text-xs" data-test="rum-heatmap-element-count">
                  {{
                    t("rum.heatmap.elementCount", { count: visibleRows.length }, visibleRows.length)
                  }}
                </span>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-auto">
              <OTable
                :data="visibleRows"
                :columns="columns"
                :default-columns="false"
                row-key="selector"
                pagination="none"
                sorting="server"
                sort-by="clicks"
                :sort-order="sortOrder"
                :show-global-filter="false"
                :frame="false"
                horizontal-scroll
                :row-class="rowClass"
                :loading="loading"
                data-test="rum-heatmap-elements-table"
                @row-click="onRowClick"
                @sort-change="onSortChange"
              >
                <template #cell-feature="{ row }">
                  <div
                    class="flex min-w-0 flex-col"
                    :data-test="`rum-heatmap-feature-${row.selector}`"
                  >
                    <span
                      v-if="row.firstUnused"
                      class="text-text-secondary text-xs font-medium"
                      data-test="rum-heatmap-unused-heading"
                    >
                      {{ t("rum.heatmap.unusedHeading") }}
                    </span>
                    <OTruncatedText class="text-sm font-semibold">{{ row.feature }}</OTruncatedText>
                    <OTruncatedText
                      v-if="row.name"
                      class="text-text-muted font-mono text-xs"
                      data-test="rum-heatmap-selector"
                    >
                      {{ row.selector }}
                    </OTruncatedText>
                    <span v-if="row.clicks" class="text-text-secondary text-xs">
                      {{
                        t(
                          "rum.heatmap.sessionsCount",
                          { count: addCommasToNumber(row.sessions) },
                          row.sessions,
                        )
                      }}
                      <span
                        v-if="row.frustrated"
                        :title="
                          t('rum.heatmap.frustrationSplit', {
                            rage: addCommasToNumber(row.rage),
                            dead: addCommasToNumber(row.dead),
                            error: addCommasToNumber(row.error),
                          })
                        "
                        :data-test="`rum-heatmap-frustrated-${row.selector}`"
                      >
                        {{ frustrationText(row) }}
                      </span>
                      <span
                        v-if="row.missing"
                        class="text-status-warning-text font-semibold"
                        :data-test="`rum-heatmap-not-on-snapshot-${row.selector}`"
                      >
                        · {{ t("rum.heatmap.chipNotOnSnapshot") }}
                      </span>
                    </span>
                  </div>
                </template>
                <template #cell-clicks="{ row }">
                  <div v-if="row.clicks" class="flex flex-col items-end gap-1.5">
                    <span class="font-bold">{{ addCommasToNumber(row.clicks) }}</span>
                    <span class="bg-border-default h-1 w-full rounded-full">
                      <span
                        class="bg-progress-bar-default block h-1 rounded-full"
                        :style="{ width: barPercent(row.clicks) + '%' }"
                      />
                    </span>
                  </div>
                </template>
                <template #cell-share="{ row }">
                  <span v-if="row.clicks" class="text-text-secondary">{{
                    t("rum.heatmap.sharePct", { pct: row.share })
                  }}</span>
                </template>
              </OTable>
            </div>
            <div
              class="border-border-default text-text-muted flex flex-wrap gap-x-1 border-t px-3 py-2 text-xs"
              data-test="rum-heatmap-footer"
            >
              <span v-if="limitedText" data-test="rum-heatmap-limited">{{ limitedText }}</span>
              <span v-if="limitedText && snapshotReady" aria-hidden="true">·</span>
              <span v-if="snapshotReady" data-test="rum-heatmap-placed">
                {{ t("rum.heatmap.drawn", { placed: placedCount, total: groups.length }) }}
              </span>
              <span v-if="unknownDeviceClicks" data-test="rum-heatmap-unknown-device">
                {{
                  t(
                    "rum.heatmap.unknownDevice",
                    { count: addCommasToNumber(unknownDeviceClicks) },
                    unknownDeviceClicks,
                  )
                }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { addCommasToNumber } from "@/utils/formatters";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import useStreams from "@/composables/useStreams";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { createMultiViewDecoder } from "@/utils/rum/sessionReplayViews";
import { resolveRelativeLinks } from "@/utils/rum/sessionReplayUrls";
import useAnalyticsSearch, { type SearchSpec } from "@/composables/rum/useAnalyticsSearch";
import rumProductAnalytics from "@/services/rumProductAnalytics";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import {
  drawOutline,
  placeGroup,
  renderHeat,
  sharePercent,
  sortElements,
  toElementGroup,
  type ClickSummary,
  type ElementGroup,
  type HeatSpot,
  type OutlineRect,
} from "@/utils/rum/clickHeatmap";
import {
  deviceClause,
  deviceSplitSql,
  PAGE_LIST_LIMIT,
  pageListSql,
  RANKING_LIMIT,
  rankingSql,
  totalsSql,
  type DeviceBucket,
  type DeviceClass,
} from "@/utils/rum/clickHeatmapQueries";
import { appProbeSql, rowScope, type AnalyticsScope } from "@/utils/rum/productAnalyticsQueries";

interface ElementRow {
  selector: string;
  name: string;
  feature: string;
  clicks: number;
  share: number;
  sessions: number;
  frustrated: number;
  rage: number;
  dead: number;
  error: number;
  firstUnused?: boolean;
  missing?: boolean;
}

interface PageRow {
  url: string;
  clicks: number;
  sessions: number;
}

interface StatCell {
  key: string;
  label: I18nText;
  value: string;
  valueClass?: string;
  dataTest: string;
}

interface FilterChip {
  key: string;
  label: I18nText;
  active: boolean;
  disabled?: boolean;
  title?: I18nText;
  toggle: () => void;
}

const APP_LIMIT = 100;
const RANK_PANELS = ["devices", "totals", "ranking"] as const;
const SNAPSHOT_LOOKBACK_HOURS = 720;
const OUTLINE_SCROLL_MARGIN = 96;
const MAX_UNUSED = 30;
const MIN_PLACED_CLICK_SHARE = 0.9;
const UNUSED_LABEL_MAX = 40;
const INTERACTIVE_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';
const SNAPSHOT_WAIT_MS = 8000;
const MAX_REPLAY_SEGMENTS = 80;
const SETTLE_MS = 400;
const FULL_SNAPSHOT = 2;
const META = 4;
const RANGE_HOURS: Record<string, number> = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 };

const { t } = useI18nTyped();
const store = useStore();
const { getStream } = useStreams(t);
const search = useAnalyticsSearch();

const rangeKey = ref("24h");
const deviceClass = ref<DeviceClass>("all");
const appId = ref("");
const appOptions = ref<{ label: ReturnType<typeof raw>; value: string }[]>([]);
const pageUrl = ref("");
const pageRows = ref<PageRow[]>([]);
const pageOpen = ref(false);
const pageQuery = ref("");
const elementQuery = ref("");
const onlyMissing = ref(false);
const onlyFrustrated = ref(false);
const showUnused = ref(false);
const unusedAvailable = ref(false);
const sortOrder = ref<"asc" | "desc">("desc");
const loading = ref(true);
const groups = ref<ElementGroup[]>([]);
const totals = ref({ clicks: 0, sessions: 0, frustrated: 0 });
const deviceClicks = ref<Partial<Record<DeviceBucket, number>>>({});
const deviceSplitLoaded = ref(false);
const deviceSplitFailed = ref(false);
const schemaFlags = ref<Record<string, boolean>>({});
const exclusions = ref<AnalyticsScope["exclusions"]>(undefined);
const placedSelectors = ref<Set<string>>(new Set());
const snapshotLoading = ref(false);
const snapshotReady = ref(false);
const snapshotError = ref<I18nText | null>(null);
const loadError = ref<I18nText | null>(null);
const settingsFailed = ref(false);
const stageRef = ref<HTMLElement | null>(null);
const scrollerRef = ref<HTMLElement | null>(null);
const fitRef = ref<HTMLElement | null>(null);
let stageScale = 1;
let pageSize = { width: 0, height: 0 };
let resizeObserver: ResizeObserver | null = null;
const selectedSelector = ref("");
const pagesLimited = ref(false);
const rankingLimited = ref(false);
let settingsKey = "";

type Row = Record<string, unknown>;

interface ReplayPlayer {
  getReplayer?: () => { iframe?: HTMLIFrameElement; wrapper?: HTMLElement; destroy?: () => void };
  $destroy?: () => void;
  goto: (ms: number, play?: boolean) => void;
}

let player: ReplayPlayer | null = null;
let overlay: HTMLCanvasElement | null = null;
let elementRects = new Map<string, OutlineRect>();
let loadToken = 0;
let retryTarget: "apps" | "page" = "apps";
let cycleEnd = Date.now() * 1000;

const rangeOptions = computed(() => [
  { label: t("rum.heatmap.range1h"), value: "1h" },
  { label: t("rum.heatmap.range24h"), value: "24h" },
  { label: t("rum.heatmap.range7d"), value: "7d" },
  { label: t("rum.heatmap.range30d"), value: "30d" },
]);

const deviceLabel = (key: string, device: DeviceBucket) => {
  const n = deviceClicks.value[device];
  if (!deviceSplitLoaded.value) return t(key);
  return t("rum.heatmap.deviceWithCount", { device: t(key), count: addCommasToNumber(n ?? 0) });
};

const deviceOptions = computed(() => [
  { label: t("rum.heatmap.deviceAll"), value: "all", icon: "devices" },
  {
    label: deviceLabel("rum.heatmap.deviceDesktop", "desktop"),
    value: "desktop",
    icon: "computer",
  },
  { label: deviceLabel("rum.heatmap.deviceTablet", "tablet"), value: "tablet", icon: "tablet" },
  { label: deviceLabel("rum.heatmap.devicePhone", "phone"), value: "phone", icon: "smartphone" },
]);

const unknownDeviceClicks = computed(() => deviceClicks.value.unknown ?? 0);
const placedCount = computed(() => placedSelectors.value.size);
const summary = computed<ClickSummary>(() => ({ ...totals.value, top: groups.value[0] ?? null }));
const clicksMax = computed(() => groups.value[0]?.clicks ?? 0);
const unusedRows = ref<ElementRow[]>([]);
const clickedRows = computed<ElementRow[]>(() =>
  groups.value.map((g) => ({
    selector: g.selector,
    name: g.name,
    feature: g.name || g.selector,
    clicks: g.clicks,
    share: sharePercent(g.clicks, summary.value.clicks),
    sessions: g.sessions,
    frustrated: g.frustrated,
    rage: g.rage,
    dead: g.dead,
    error: g.error,
    missing: snapshotReady.value && !placedSelectors.value.has(g.selector),
  })),
);
const matchesQuery = (r: ElementRow) =>
  `${r.feature} ${r.selector}`.toLowerCase().includes(elementQuery.value.trim().toLowerCase());
const visibleRows = computed<ElementRow[]>(() => {
  const clicked = clickedRows.value.filter(
    (r) =>
      matchesQuery(r) &&
      (!onlyMissing.value || r.missing) &&
      (!onlyFrustrated.value || r.frustrated),
  );
  if (sortOrder.value === "asc") clicked.reverse();
  const filtered = onlyMissing.value || onlyFrustrated.value;
  const unused =
    showUnused.value && unusedAvailable.value && !filtered
      ? unusedRows.value.filter(matchesQuery).map((r, i) => ({ ...r, firstUnused: i === 0 }))
      : [];
  return [...clicked, ...unused];
});
const columns = computed<OTableColumnDef<ElementRow>[]>(() => [
  {
    id: "feature",
    header: t("rum.heatmap.colFeature"),
    size: 120,
    meta: { autoWidth: true, fillRemaining: true },
  },
  {
    id: "clicks",
    header: t("rum.heatmap.colClicks"),
    accessorKey: "clicks",
    size: 88,
    sortable: true,
    meta: { align: "right" },
  },
  { id: "share", header: t("rum.heatmap.colShare"), size: 56, meta: { align: "right" } },
]);
const chips = computed<FilterChip[]>(() => [
  {
    key: "missing",
    label: t("rum.heatmap.chipNotOnSnapshot"),
    active: onlyMissing.value,
    toggle: () => (onlyMissing.value = !onlyMissing.value),
  },
  {
    key: "frustrated",
    label: t("rum.heatmap.chipFrustrated"),
    active: onlyFrustrated.value,
    toggle: () => (onlyFrustrated.value = !onlyFrustrated.value),
  },
  {
    key: "unused",
    label: t("rum.heatmap.unusedHeading"),
    active: showUnused.value && unusedAvailable.value,
    disabled: !unusedAvailable.value,
    title: unusedAvailable.value ? undefined : t("rum.heatmap.chipUnusedDisabled"),
    toggle: () => (showUnused.value = !showUnused.value),
  },
]);
const visiblePages = computed(() => {
  const q = pageQuery.value.trim().toLowerCase();
  return pageRows.value.filter((p) => p.url.toLowerCase().includes(q));
});
const limitedText = computed(() => {
  const pages = pagesLimited.value ? PAGE_LIST_LIMIT : 0;
  const elements = rankingLimited.value ? RANKING_LIMIT : 0;
  if (pages && elements) return t("rum.heatmap.limitedBoth", { pages, elements });
  if (pages) return t("rum.heatmap.limitedPages", { count: pages });
  if (elements) return t("rum.heatmap.limitedElements", { count: elements });
  return "";
});
const statItems = computed<StatCell[]>(() => {
  const { clicks, sessions, frustrated } = summary.value;
  return [
    {
      key: "clicks",
      label: t("rum.heatmap.statClicks"),
      value: addCommasToNumber(clicks),
      dataTest: "rum-heatmap-stat-clicks",
    },
    {
      key: "sessions",
      label: t("rum.heatmap.statSessions"),
      value: addCommasToNumber(sessions),
      dataTest: "rum-heatmap-stat-sessions",
    },
    {
      key: "frustrated",
      label: t("rum.heatmap.statFrustrated"),
      value: addCommasToNumber(frustrated),
      valueClass: frustrated ? "text-status-warning-text" : "text-text-disabled",
      dataTest: "rum-heatmap-stat-frustrated",
    },
  ];
});

const tsField = () => store.state.zoConfig.timestamp_column || "_timestamp";
const org = () => store.state.selectedOrganization.identifier;

const scope = (): AnalyticsScope => ({
  app: appId.value,
  env: [],
  version: [],
  schema: schemaFlags.value,
  ...(exclusions.value ? { exclusions: exclusions.value } : {}),
});

function windowMicros(hours: number) {
  return { start_time: cycleEnd - hours * 3_600_000_000, end_time: cycleEnd };
}

function startCycle() {
  cycleEnd = Date.now() * 1000;
}

class ForbiddenError extends Error {}

// A null result means a newer request replaced this one, so the caller must drop it.
async function searchRows<T>(
  id: string,
  sql: string,
  limit: number,
  win: { start_time: number; end_time: number },
  stream?: string,
): Promise<T[] | null> {
  const spec: SearchSpec = {
    sql,
    startUs: win.start_time,
    endUs: win.end_time,
    limit,
    sampled: 1,
    stream,
  };
  const res = await search.run<T>(id, spec, `${id}:${sql}`);
  if (res.status === "ok") return res.rows;
  if (res.status === "forbidden") throw new ForbiddenError();
  if (res.status === "error") throw new Error(res.error?.message || res.status);
  return null;
}

// Replay lookups go through the shared search so superseding or leaving the page cancels them.
async function replayRows(
  id: string,
  sql: string,
  limit: number,
  stream = "_rumdata",
): Promise<Row[]> {
  const rows = await searchRows<Row>(id, sql, limit, windowMicros(SNAPSHOT_LOOKBACK_HOURS), stream);
  if (!rows) throw new Error("replay lookup superseded");
  return rows;
}

async function ensureSchema() {
  const stream = await getStream("_rumdata", "logs", true);
  schemaFlags.value = Object.fromEntries((stream?.schema ?? []).map((f: any) => [f?.name, true]));
}

function failLoad(label: string, error: unknown, retry: "apps" | "page" = "apps") {
  retryTarget = retry;
  console.error(`Click heatmap: ${label} failed`, error);
  loadError.value = t(
    error instanceof ForbiddenError ? "rum.heatmap.forbidden" : "rum.heatmap.loadFailed",
  );
}

function onRetry() {
  return retryTarget === "page" ? loadPage() : loadApps();
}

async function loadApps() {
  startCycle();
  const token = ++loadToken;
  loading.value = true;
  loadError.value = null;
  try {
    await ensureSchema();
    const rows = await searchRows<{ app: string }>(
      "apps",
      appProbeSql(),
      APP_LIMIT,
      windowMicros(RANGE_HOURS[rangeKey.value]),
    );
    if (token !== loadToken) return;
    if (!rows) {
      loading.value = false;
      return;
    }
    appOptions.value = rows.map((r) => ({ label: raw(r.app), value: r.app }));
    if (!appOptions.value.some((o) => o.value === appId.value)) {
      appId.value = appOptions.value[0]?.value ?? "";
    }
    await loadSettings();
  } catch (error) {
    if (token !== loadToken) return;
    failLoad("app list", error);
    appOptions.value = [];
    loading.value = false;
    return;
  }
  if (token === loadToken) await loadPages();
}

// Bot rules come from the product analytics settings; without them the page still loads unfiltered.
async function loadSettings() {
  const key = `${org()}|${appId.value}`;
  if (!appId.value || key === settingsKey) return;
  try {
    const res = await rumProductAnalytics.getAppSettings(org(), appId.value);
    exclusions.value = res.data;
    settingsKey = key;
    settingsFailed.value = false;
  } catch (error) {
    console.error("Click heatmap: app settings failed", error);
    exclusions.value = undefined;
    settingsKey = "";
    settingsFailed.value = true;
  }
}

async function onAppChange() {
  startCycle();
  const token = ++loadToken;
  await loadSettings();
  if (token === loadToken) await loadPages();
}

async function loadPages() {
  const token = ++loadToken;
  loading.value = true;
  try {
    const rows = appId.value
      ? await searchRows<{ view_url: string; clicks?: unknown; sessions?: unknown }>(
          "pages",
          pageListSql(scope()),
          PAGE_LIST_LIMIT,
          windowMicros(RANGE_HOURS[rangeKey.value]),
        )
      : [];
    if (token !== loadToken || !rows) return;
    pagesLimited.value = rows.length >= PAGE_LIST_LIMIT;
    pageRows.value = rows.map((h) => ({
      url: h.view_url,
      clicks: Number(h.clicks) || 0,
      sessions: Number(h.sessions) || 0,
    }));
    if (!pageRows.value.some((p) => p.url === pageUrl.value)) {
      pageUrl.value = pageRows.value[0]?.url ?? "";
    }
  } catch (error) {
    if (token !== loadToken) return;
    resetPage();
    failLoad("page list", error);
    pageRows.value = [];
    loading.value = false;
    return;
  }
  loading.value = false;
  await loadPage(true, false);
}

function resetPage() {
  destroyPlayer();
  groups.value = [];
  totals.value = { clicks: 0, sessions: 0, frustrated: 0 };
  placedSelectors.value = new Set();
  snapshotError.value = null;
  loadError.value = null;
  rankingLimited.value = false;
  pagesLimited.value = false;
  selectedSelector.value = "";
  unusedRows.value = [];
  unusedAvailable.value = false;
}

async function loadPage(refreshSplit = true, newCycle = true) {
  if (newCycle) startCycle();
  const token = ++loadToken;
  if (refreshSplit) {
    deviceClicks.value = {};
    deviceSplitLoaded.value = false;
    deviceSplitFailed.value = false;
  }
  const pageListFull = pagesLimited.value;
  resetPage();
  pagesLimited.value = pageListFull;
  if (!pageUrl.value) {
    for (const id of RANK_PANELS) search.hold(id, "idle");
    return;
  }
  const [clicks, snapshot] = await Promise.allSettled([
    loadClicks(token, refreshSplit),
    loadSnapshot(token),
  ]);
  if (token !== loadToken) return;
  if (clicks.status === "rejected") failLoad("clicks", clicks.reason, "page");
  if (snapshot.status === "fulfilled" && snapshotReady.value) drawHeat();
}

async function loadClicks(token: number, withSplit: boolean) {
  loading.value = true;
  try {
    const win = windowMicros(RANGE_HOURS[rangeKey.value]);
    const sc = scope();
    const url = pageUrl.value;
    const rankSql = rankingSql(sc, url, deviceClass.value);
    const [splitRes, totRes, rankRes] = await Promise.allSettled([
      withSplit
        ? searchRows<Record<string, unknown>>("devices", deviceSplitSql(sc, url), 8, win)
        : [],
      searchRows<Record<string, unknown>>("totals", totalsSql(sc, url, deviceClass.value), 1, win),
      rankSql ? searchRows<Record<string, unknown>>("ranking", rankSql, RANKING_LIMIT, win) : [],
    ]);
    if (token !== loadToken) return;
    if (totRes.status === "rejected") throw totRes.reason;
    if (rankRes.status === "rejected") throw rankRes.reason;
    const tot = totRes.value;
    const ranked = rankRes.value;
    if (!tot || !ranked) return;
    if (withSplit) {
      if (splitRes.status === "rejected") {
        console.error("Click heatmap: device split failed", splitRes.reason);
        deviceSplitFailed.value = true;
      } else if (splitRes.value) {
        const split = splitRes.value;
        deviceClicks.value = Object.fromEntries(split.map((r) => [r.cls, Number(r.clicks) || 0]));
        deviceSplitLoaded.value = true;
      }
    }
    rankingLimited.value = ranked.length >= RANKING_LIMIT;
    const row = tot[0] ?? {};
    totals.value = {
      clicks: Number(row.clicks) || 0,
      sessions: Number(row.sessions) || 0,
      frustrated: Number(row.frustrated) || 0,
    };
    groups.value = sortElements(
      ranked.map(toElementGroup).filter((g): g is ElementGroup => g !== null),
    );
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

const isSnapshotFlag = (v: unknown) => v === true || v === "true" || Number(v) === 1;

interface SnapshotSource {
  events: any[];
  seekMs: number;
}

async function pickReplayView(token: number): Promise<string | null> {
  const stream = await getStream("_rumdata", "logs", true);
  if (token !== loadToken) return null;
  const hasActions = (stream?.schema ?? []).some((f: any) => f?.name === "view_action_count");
  const views = await replayRows(
    "replay-views",
    `SELECT view_id, max(${tsField()}) AS t${hasActions ? ", max(view_action_count) AS ac" : ""} FROM "_rumdata" WHERE ${rowScope(scope())} AND type = 'view' AND view_url = ${sqlLiteral(pageUrl.value)}${deviceClause(scope(), deviceClass.value)} GROUP BY view_id ORDER BY ${hasActions ? "ac DESC, " : ""}t DESC LIMIT 30`,
    30,
  );
  if (!views.length || token !== loadToken) return null;
  const replayStream = await getStream("_sessionreplay", "logs", true);
  if (token !== loadToken) return null;
  // Older and mobile streams have no has_full_snapshot column, so any view may hold a snapshot.
  if (!(replayStream?.schema ?? []).some((f: any) => f?.name === "has_full_snapshot")) {
    return String(views[0].view_id);
  }
  const ids = views.map((v) => sqlLiteral(String(v.view_id))).join(",");
  const rows = await replayRows(
    "replay-flags",
    `SELECT view_id, bool_or(has_full_snapshot) AS has_full_snapshot FROM "_sessionreplay" WHERE view_id IN (${ids}) GROUP BY view_id`,
    views.length,
    "_sessionreplay",
  );
  if (token !== loadToken) return null;
  const withSnapshot = new Set(
    rows.filter((r) => isSnapshotFlag(r.has_full_snapshot)).map((r) => String(r.view_id)),
  );
  const best = views.find((v) => withSnapshot.has(String(v.view_id)));
  return best ? String(best.view_id) : null;
}

function decodeReplayEvents(bodies: any[]): any[] {
  const { events } = createMultiViewDecoder().push(bodies, Infinity);
  let href: unknown;
  return events.map((e: any) => {
    if (e.type === 8) return { ...e, type: 5, data: { payload: { ...e.data }, tag: "viewport" } };
    if (e.type === META) href = e.data?.href;
    if (e.type === FULL_SNAPSHOT && e.data?.node) resolveRelativeLinks(e.data.node, href);
    return e;
  });
}

// The first snapshot is taken at page load, before an app has drawn its content, so play on to when people clicked.
async function loadSnapshotSource(token: number): Promise<SnapshotSource | null> {
  const viewId = await pickReplayView(token);
  if (!viewId || token !== loadToken) return null;
  const segments = await replayRows(
    "replay-segments",
    `SELECT start, segment FROM "_sessionreplay" WHERE view_id = ${sqlLiteral(viewId)} ORDER BY start ASC`,
    MAX_REPLAY_SEGMENTS,
    "_sessionreplay",
  );
  const bodies = segments.flatMap((r) => {
    try {
      return [JSON.parse(String(r.segment))];
    } catch {
      return [];
    }
  });
  if (token !== loadToken) return null;
  const events = decodeReplayEvents(bodies);
  if (!events.length) return null;
  const first = Number(events[0].timestamp);
  const last = Number(events[events.length - 1].timestamp);
  const [lastClick] = await replayRows(
    "replay-click",
    `SELECT max(date) AS d FROM "_rumdata" WHERE ${rowScope(scope())} AND type = 'action' AND view_id = ${sqlLiteral(viewId)}`,
    1,
  );
  if (token !== loadToken) return null;
  const clickAt = Number(lastClick?.d);
  const target = Number.isFinite(clickAt) && clickAt > first ? clickAt : last;
  return { events, seekMs: Math.min(Math.max(target - first, 0), Math.max(last - first, 0)) };
}

async function loadSnapshot(token: number) {
  snapshotLoading.value = true;
  snapshotReady.value = false;
  try {
    const source = await loadSnapshotSource(token);
    if (token !== loadToken) return;
    const meta = source?.events.find((e) => e.type === META);
    if (!source || !source.events.some((e) => e.type === FULL_SNAPSHOT) || !meta) {
      snapshotError.value = t("rum.heatmap.noReplay");
      return;
    }
    snapshotReady.value = true;
    await nextTick();
    if (token !== loadToken || !stageRef.value) return;
    await mountPlayer(source, meta.data.width, meta.data.height, token);
  } catch (error) {
    if (token !== loadToken) return;
    console.error("Click heatmap: snapshot failed", error);
    snapshotReady.value = false;
    snapshotError.value = t("rum.heatmap.snapshotFailed");
  } finally {
    if (token === loadToken) snapshotLoading.value = false;
  }
}

async function mountPlayer(source: SnapshotSource, width: number, height: number, token: number) {
  const module: any = await import("@openobserve/rrweb-player");
  await import("@openobserve/rrweb-player/dist/style.css");
  if (token !== loadToken || !stageRef.value) return;
  const Player = module.default;
  player = markRaw(
    new Player({
      target: stageRef.value as HTMLElement,
      props: {
        events: source.events,
        autoPlay: false,
        showController: false,
        mouseTail: false,
        UNSAFE_replayCanvas: false,
        mutateChildNodes: true,
        width,
        height,
      },
    }),
  );
  await waitForSnapshotDom(token);
  if (token !== loadToken) return;
  player?.goto(source.seekMs, false);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
}

// The replayer rebuilds the first snapshot on a timer after construction, so the iframe is empty until then.
async function waitForSnapshotDom(token: number) {
  const deadline = performance.now() + SNAPSHOT_WAIT_MS;
  while (token === loadToken && performance.now() < deadline) {
    const body = frameDoc()?.doc.body;
    if (body && body.childElementCount > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (token === loadToken) throw new Error("snapshot did not render");
}

function destroyPlayer() {
  snapshotReady.value = false;
  overlay = null;
  try {
    player?.getReplayer?.()?.destroy?.();
    player?.$destroy?.();
  } catch {
    // The player is already gone; nothing left to release.
  }
  player = null;
  if (stageRef.value) stageRef.value.replaceChildren();
}

function frameDoc(): { doc: Document; wrapper: HTMLElement; iframe: HTMLIFrameElement } | null {
  const replayer = player?.getReplayer?.();
  const iframe: HTMLIFrameElement | undefined = replayer?.iframe;
  const wrapper: HTMLElement | undefined = replayer?.wrapper;
  const doc = iframe?.contentDocument;
  return doc && wrapper && iframe ? { doc, wrapper, iframe } : null;
}

function growToFullPage(frame: { doc: Document; wrapper: HTMLElement; iframe: HTMLIFrameElement }) {
  const full = Math.max(frame.doc.documentElement.scrollHeight, Number(frame.iframe.height) || 0);
  frame.iframe.setAttribute("height", String(full));
  const boxes = [
    frame.wrapper,
    stageRef.value?.querySelector<HTMLElement>(".rr-player__frame"),
    stageRef.value?.querySelector<HTMLElement>(".rr-player"),
  ];
  for (const box of boxes) {
    // Must match the iframe's px height attribute exactly.
    box?.style.setProperty("height", `${full}px`);
  }
  pageSize = {
    width: Number(frame.iframe.width) || frame.doc.documentElement.scrollWidth,
    height: full,
  };
  fitStage();
  return full;
}

// Shrinks a wide page to the pane so the whole width is visible without sideways scrolling.
function fitStage() {
  const scroller = scrollerRef.value;
  const fit = fitRef.value;
  const stage = stageRef.value;
  if (!scroller || !fit || !stage || !pageSize.width) return;
  const gutter = 2 * parseFloat(getComputedStyle(document.documentElement).fontSize);
  stageScale = Math.min(1, (scroller.clientWidth - gutter) / pageSize.width);
  stage.style.setProperty("transform", `scale(${stageScale})`);
  fit.style.setProperty("width", `${pageSize.width * stageScale}px`);
  fit.style.setProperty("height", `${pageSize.height * stageScale}px`);
}

// A hand-rolled canvas because it paints over a rebuilt replay DOM, which no chart component can host.
function ensureOverlay(frame: { wrapper: HTMLElement }, width: number, height: number) {
  if (!overlay) {
    overlay = document.createElement("canvas");
    overlay.dataset.test = "rum-heatmap-canvas";
    overlay.setAttribute("aria-hidden", "true");
    overlay.className = "pointer-events-none absolute left-0 top-0 z-10";
    frame.wrapper.appendChild(overlay);
  }
  overlay.width = width;
  overlay.height = height;
  return overlay;
}

// Hidden controls (collapsed menus) still match a selector but have no place on the page.
function isVisible(el: Element): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !!style && style.display !== "none" && style.visibility !== "hidden";
}

function drawHeat() {
  const frame = frameDoc();
  if (!frame) return;
  const full = growToFullPage(frame);
  const canvas = ensureOverlay(
    frame,
    Number(frame.iframe.width) || frame.doc.documentElement.scrollWidth,
    full,
  );
  const spots: HeatSpot[] = [];
  const placed = new Set<string>();
  const rects = new Map<string, OutlineRect>();
  const clickedEls: Element[] = [];
  const win = frame.doc.defaultView;
  for (const g of groups.value) {
    let el: Element | null = null;
    try {
      el = frame.doc.querySelector(g.selector);
    } catch {
      el = null;
    }
    if (!el || !isVisible(el)) continue;
    const box = el.getBoundingClientRect();
    const spot = placeGroup(g, clicksMax.value, box, win?.scrollX ?? 0, win?.scrollY ?? 0);
    if (!spot) continue;
    clickedEls.push(el);
    spots.push(spot);
    rects.set(g.selector, {
      x: box.left + (win?.scrollX ?? 0),
      y: box.top + (win?.scrollY ?? 0),
      width: box.width,
      height: box.height,
    });
    placed.add(g.selector);
  }
  placedSelectors.value = placed;
  unusedAvailable.value = mostlyPlaced(placed);
  unusedRows.value = unusedAvailable.value ? findUnusedControls(frame.doc, clickedEls, rects) : [];
  elementRects = rects;
  renderHeat(canvas, spots);
  const selected = elementRects.get(selectedSelector.value);
  if (selected) drawOutline(canvas, selected);
}

// Unplaced clicks may be on controls this snapshot lacks, so "never clicked" is only trustworthy when most clicks landed.
function mostlyPlaced(placed: Set<string>): boolean {
  const placedClicks = groups.value
    .filter((g) => placed.has(g.selector))
    .reduce((sum, g) => sum + g.clicks, 0);
  return totals.value.clicks > 0 && placedClicks / totals.value.clicks >= MIN_PLACED_CLICK_SHARE;
}

function findUnusedControls(
  doc: Document,
  clicked: Element[],
  rects: Map<string, OutlineRect>,
): ElementRow[] {
  if (!clicked.length) return [];
  const win = doc.defaultView;
  const rows: ElementRow[] = [];
  for (const el of doc.querySelectorAll(INTERACTIVE_SELECTOR)) {
    if (rows.length >= MAX_UNUSED) break;
    if (clicked.some((c) => c === el || el.contains(c))) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const key = `unused-${rows.length}`;
    const tag = el.tagName.toLowerCase();
    const label =
      el.getAttribute("aria-label") ||
      el.textContent?.trim().slice(0, UNUSED_LABEL_MAX) ||
      el.getAttribute("name") ||
      tag;
    rects.set(key, {
      x: box.left + (win?.scrollX ?? 0),
      y: box.top + (win?.scrollY ?? 0),
      width: box.width,
      height: box.height,
    });
    rows.push({
      selector: key,
      name: "",
      feature: label,
      clicks: 0,
      share: 0,
      sessions: 0,
      frustrated: 0,
      rage: 0,
      dead: 0,
      error: 0,
    });
  }
  return rows;
}

function onDeviceChange(value: unknown) {
  if (typeof value !== "string" || !value || value === deviceClass.value) return;
  deviceClass.value = value as DeviceClass;
  loadPage(false);
}

function onPagePick(url: string) {
  pageOpen.value = false;
  pageQuery.value = "";
  if (url === pageUrl.value) return;
  pageUrl.value = url;
  loadPage();
}

function onSortChange() {
  sortOrder.value = sortOrder.value === "desc" ? "asc" : "desc";
}

const rowClass = (row: ElementRow) =>
  row.selector === selectedSelector.value ? "bg-surface-tint-accent" : "";

const barPercent = (clicks: number) => (clicksMax.value > 0 ? (clicks / clicksMax.value) * 100 : 0);

function frustrationText(row: ElementRow): string {
  const parts = [
    row.rage && t("rum.heatmap.rageCount", { count: addCommasToNumber(row.rage) }),
    row.dead && t("rum.heatmap.deadCount", { count: addCommasToNumber(row.dead) }),
    row.error && t("rum.heatmap.errorCount", { count: addCommasToNumber(row.error) }),
  ].filter(Boolean);
  return `· ${parts.join(" · ")}`;
}

function onRowClick(row: ElementRow) {
  selectedSelector.value = selectedSelector.value === row.selector ? "" : row.selector;
  drawHeat();
  const rect = elementRects.get(selectedSelector.value);
  if (!rect || !scrollerRef.value || !stageRef.value) return;
  const scroller = scrollerRef.value;
  const stageTop =
    stageRef.value.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop;
  scroller.scrollTo({
    top: stageTop + rect.y * stageScale - OUTLINE_SCROLL_MARGIN,
    behavior: "smooth",
  });
}

onMounted(loadApps);

// The scroller only exists once the page list has loaded, so observe it whenever it appears.
watch(scrollerRef, (el) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) return;
  resizeObserver = new ResizeObserver(fitStage);
  resizeObserver.observe(el);
});

function cancelLoads() {
  loadToken++;
  search.abortAll();
}

onBeforeUnmount(() => {
  cancelLoads();
  resizeObserver?.disconnect();
  destroyPlayer();
});
</script>
