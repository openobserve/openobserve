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
  <OPageLayout
    data-test="rum-heatmap-page"
    :title="t('rum.heatmap.title')"
    :subtitle="t('rum.heatmap.subtitle')"
    title-data-test="rum-heatmap-title"
    icon="insights"
    bleed
  >
    <template #actions>
      <OSelect
        v-model="rangeKey"
        :aria-label="t('rum.heatmap.rangeLabel')"
        :options="rangeOptions"
        size="sm"
        class="w-40"
        data-test="rum-heatmap-range-select"
        @update:model-value="loadApps"
      />
      <OSelect
        v-model="appId"
        :aria-label="t('rum.heatmap.appLabel')"
        :options="appOptions"
        size="sm"
        searchable
        class="w-48"
        data-test="rum-heatmap-app-select"
        @update:model-value="onAppChange"
      />
      <OSelect
        v-model="deviceClass"
        :aria-label="t('rum.heatmap.deviceLabel')"
        :options="deviceOptions"
        size="sm"
        class="w-36"
        data-test="rum-heatmap-device-select"
        @update:model-value="loadPage(false)"
      />
      <OSelect
        v-model="pageUrl"
        :aria-label="t('rum.heatmap.pageLabel')"
        :options="pageOptions"
        :placeholder="t('rum.heatmap.pagePlaceholder')"
        size="sm"
        searchable
        class="w-80 max-md:w-48"
        data-test="rum-heatmap-page-select"
        @update:model-value="loadPage()"
      />
    </template>

    <OEmptyState
      v-if="!loading && !pageOptions.length && !loadError"
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
            @click="loadApps"
            >{{ t("common.retry") }}</OButton
          >
        </template>
      </OBanner>
    </div>
    <div v-else class="flex h-full min-h-0 flex-col">
      <div v-if="summary.clicks" class="shrink-0 px-4 pt-4" data-test="rum-heatmap-stats">
        <OStatStrip :items="statItems" :loading="loading" />
      </div>
      <div class="flex min-h-0 flex-1 gap-4 p-4 max-lg:flex-col">
        <div
          ref="scrollerRef"
          class="rounded-surface border-border-default min-w-0 flex-1 overflow-auto border"
        >
          <OBanner
            v-if="pageUrl && !loading && !groups.length"
            variant="warning"
            dense
            :content="
              deviceClass === 'all' ? t('rum.heatmap.noPosition') : t('rum.heatmap.noDeviceData')
            "
            data-test="rum-heatmap-no-position"
          />
          <div class="flex p-4">
            <div ref="fitRef" class="mx-auto shrink-0 overflow-hidden">
              <OSpinner v-if="snapshotLoading" size="lg" data-test="rum-heatmap-snapshot-loading" />
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

        <div class="flex w-136 shrink-0 flex-col gap-2 max-lg:w-full">
          <OBanner
            v-if="snapshotError"
            variant="info"
            dense
            :content="snapshotError"
            data-test="rum-heatmap-snapshot-error"
          />
          <span
            v-if="pagesLimited"
            class="text-text-secondary text-xs"
            data-test="rum-heatmap-pages-limited"
          >
            {{ t("rum.heatmap.pagesLimited", { count: PAGE_LIST_LIMIT }, PAGE_LIST_LIMIT) }}
          </span>
          <span
            v-if="rankingLimited"
            class="text-text-secondary text-xs"
            data-test="rum-heatmap-ranking-limited"
          >
            {{ t("rum.heatmap.rankingLimited", { count: RANKING_LIMIT }, RANKING_LIMIT) }}
          </span>
          <span
            v-if="snapshotReady"
            class="text-text-secondary text-xs"
            data-test="rum-heatmap-placed"
          >
            {{ t("rum.heatmap.placed", { placed: placedCount, total: groups.length }) }}
          </span>
          <span
            v-if="unknownDeviceClicks"
            class="text-text-secondary text-xs"
            data-test="rum-heatmap-unknown-device"
          >
            {{
              t(
                "rum.heatmap.unknownDevice",
                { count: addCommasToNumber(unknownDeviceClicks) },
                unknownDeviceClicks,
              )
            }}
          </span>
          <OTable
            :data="tableRows"
            :columns="columns"
            :default-columns="false"
            row-key="selector"
            pagination="none"
            sorting="none"
            :show-global-filter="false"
            :frame="false"
            :loading="loading"
            data-test="rum-heatmap-elements-table"
            @row-click="onRowClick"
          >
            <template #cell-feature="{ row }">
              <div class="flex min-w-0 flex-col" :data-test="`rum-heatmap-feature-${row.selector}`">
                <OTruncatedText class="text-sm">{{ row.feature }}</OTruncatedText>
                <OTruncatedText v-if="row.name" class="text-text-secondary text-xs">
                  {{ row.selector }}
                </OTruncatedText>
                <span
                  v-if="snapshotReady && row.clicks && !placedSelectors.has(row.selector)"
                  class="text-text-secondary text-xs"
                  :data-test="`rum-heatmap-not-on-snapshot-${row.selector}`"
                >
                  {{ t("rum.heatmap.notOnPage") }}
                </span>
              </div>
            </template>
            <template #cell-clicks="{ row, value }">
              <ODataBarCell :value="row.clicks" :max="clicksMax" :display="String(value)" />
            </template>
            <template #cell-sessions="{ row }">
              <span v-if="row.clicks">
                {{
                  t("rum.heatmap.sessionsReach", {
                    count: row.sessions,
                    pct: sharePercent(row.sessions, summary.sessions),
                  })
                }}
              </span>
            </template>
            <template #cell-frustrated="{ row }">
              <span
                v-if="row.clicks"
                :title="
                  t('rum.heatmap.frustrationSplit', {
                    rage: row.rage,
                    dead: row.dead,
                    error: row.error,
                  })
                "
              >
                {{ row.frustrated }}
              </span>
            </template>
            <template #cell-share="{ row }">
              <span v-if="row.clicks">{{ t("rum.heatmap.sharePct", { pct: row.share }) }}</span>
            </template>
          </OTable>
        </div>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
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
const MAX_SNAPSHOT_LOOKUP_ROWS = 500;
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
const pageOptions = ref<{ label: ReturnType<typeof raw>; value: string }[]>([]);
const loading = ref(true);
const groups = ref<ElementGroup[]>([]);
const totals = ref({ clicks: 0, sessions: 0, frustrated: 0 });
const deviceClicks = ref<Partial<Record<DeviceBucket, number>>>({});
const schemaFlags = ref<Record<string, boolean>>({});
const exclusions = ref<AnalyticsScope["exclusions"]>(undefined);
const placedSelectors = ref<Set<string>>(new Set());
const snapshotLoading = ref(false);
const snapshotReady = ref(false);
const snapshotError = ref<I18nText | null>(null);
const loadError = ref<I18nText | null>(null);
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

const rangeOptions = computed(() => [
  { label: t("rum.heatmap.range1h"), value: "1h" },
  { label: t("rum.heatmap.range24h"), value: "24h" },
  { label: t("rum.heatmap.range7d"), value: "7d" },
  { label: t("rum.heatmap.range30d"), value: "30d" },
]);

const deviceLabel = (key: string, device: DeviceBucket) => {
  const n = deviceClicks.value[device];
  return n ? raw(`${t(key)} (${addCommasToNumber(n)})`) : t(key);
};

const deviceOptions = computed(() => [
  { label: t("rum.heatmap.deviceAll"), value: "all" },
  { label: deviceLabel("rum.heatmap.deviceDesktop", "desktop"), value: "desktop" },
  { label: deviceLabel("rum.heatmap.deviceTablet", "tablet"), value: "tablet" },
  { label: deviceLabel("rum.heatmap.devicePhone", "phone"), value: "phone" },
]);

const unknownDeviceClicks = computed(() => deviceClicks.value.unknown ?? 0);
const placedCount = computed(() => placedSelectors.value.size);
const summary = computed<ClickSummary>(() => ({ ...totals.value, top: groups.value[0] ?? null }));
const clicksMax = computed(() => groups.value[0]?.clicks ?? 0);
const unusedRows = ref<ElementRow[]>([]);
const tableRows = computed<ElementRow[]>(() => [
  ...groups.value.map((g) => ({
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
  })),
  ...unusedRows.value,
]);
const columns = computed<OTableColumnDef<ElementRow>[]>(() => [
  {
    id: "feature",
    header: t("rum.heatmap.colFeature"),
    size: 200,
    meta: { fillRemaining: true },
  },
  { id: "clicks", header: t("rum.heatmap.colClicks"), accessorKey: "clicks", size: 110 },
  { id: "share", header: t("rum.heatmap.colShare"), size: 70, meta: { align: "right" } },
  { id: "sessions", header: t("rum.heatmap.colSessions"), size: 100, meta: { align: "right" } },
  {
    id: "frustrated",
    header: t("rum.heatmap.colFrustrated"),
    accessorKey: "frustrated",
    size: 90,
    meta: { align: "right" },
  },
]);
const statItems = computed<StatItem[]>(() => {
  const { clicks, sessions, frustrated, top } = summary.value;
  const items: StatItem[] = [
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
      key: "top",
      label: t("rum.heatmap.statTop"),
      value: top ? top.name || top.selector : "—",
      sub: top ? t("rum.heatmap.statTopSub", { pct: sharePercent(top.clicks, clicks) }) : undefined,
      tone: "primary",
      dataTest: "rum-heatmap-stat-top",
    },
    {
      key: "frustrated",
      label: t("rum.heatmap.statFrustrated"),
      value: addCommasToNumber(frustrated),
      sub: frustrated
        ? t("rum.heatmap.statFrustratedSub", { pct: sharePercent(frustrated, clicks) })
        : undefined,
      tone: frustrated ? "warning" : "neutral",
      dataTest: "rum-heatmap-stat-frustrated",
    },
  ];
  if (unusedRows.value.length) {
    items.push({
      key: "unused",
      label: t("rum.heatmap.statUnused"),
      value: `${addCommasToNumber(unusedRows.value.length)}${unusedRows.value.length >= MAX_UNUSED ? "+" : ""}`,
      sub: t("rum.heatmap.statUnusedSub"),
      dataTest: "rum-heatmap-stat-unused",
    });
  }
  return items;
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
  const end = Date.now() * 1000;
  return { start_time: end - hours * 3_600_000_000, end_time: end };
}

class ForbiddenError extends Error {}

// A null result means a newer request replaced this one, so the caller must drop it.
async function searchRows<T>(
  id: string,
  sql: string,
  limit: number,
  win: { start_time: number; end_time: number },
): Promise<T[] | null> {
  const spec: SearchSpec = {
    sql,
    startUs: win.start_time,
    endUs: win.end_time,
    limit,
    sampled: 1,
  };
  const res = await search.run<T>(id, spec, `${id}:${sql}`);
  if (res.status === "ok") return res.rows;
  if (res.status === "forbidden") throw new ForbiddenError();
  if (res.status === "error") throw new Error(res.error?.message || res.status);
  return null;
}

// Replay lookups go through the shared search so superseding or leaving the page cancels them.
async function replayRows(id: string, sql: string, limit: number): Promise<Row[]> {
  const rows = await searchRows<Row>(id, sql, limit, windowMicros(SNAPSHOT_LOOKBACK_HOURS));
  if (!rows) throw new Error("replay lookup superseded");
  return rows;
}

async function ensureSchema() {
  const stream = await getStream("_rumdata", "logs", true);
  schemaFlags.value = Object.fromEntries((stream?.schema ?? []).map((f: any) => [f?.name, true]));
}

function failLoad(label: string, error: unknown) {
  console.error(`Click heatmap: ${label} failed`, error);
  loadError.value = t(
    error instanceof ForbiddenError ? "rum.heatmap.forbidden" : "rum.heatmap.loadFailed",
  );
}

async function loadApps() {
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
    if (token !== loadToken || !rows) return;
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
  } catch (error) {
    console.error("Click heatmap: app settings failed", error);
    exclusions.value = undefined;
    settingsKey = "";
  }
}

async function onAppChange() {
  const token = ++loadToken;
  await loadSettings();
  if (token === loadToken) await loadPages();
}

async function loadPages() {
  const token = ++loadToken;
  loading.value = true;
  try {
    const rows = appId.value
      ? await searchRows<{ view_url: string }>(
          "pages",
          pageListSql(scope()),
          PAGE_LIST_LIMIT,
          windowMicros(RANGE_HOURS[rangeKey.value]),
        )
      : [];
    if (token !== loadToken || !rows) return;
    pagesLimited.value = rows.length >= PAGE_LIST_LIMIT;
    pageOptions.value = rows.map((h) => ({ label: raw(h.view_url), value: h.view_url }));
    if (!pageOptions.value.some((o) => o.value === pageUrl.value)) {
      pageUrl.value = pageOptions.value[0]?.value ?? "";
    }
  } catch (error) {
    if (token !== loadToken) return;
    resetPage();
    failLoad("page list", error);
    pageOptions.value = [];
    loading.value = false;
    return;
  }
  loading.value = false;
  await loadPage();
}

function resetPage() {
  destroyPlayer();
  groups.value = [];
  totals.value = { clicks: 0, sessions: 0, frustrated: 0 };
  placedSelectors.value = new Set();
  snapshotError.value = null;
  loadError.value = null;
  selectedSelector.value = "";
  unusedRows.value = [];
}

async function loadPage(refreshSplit = true) {
  const token = ++loadToken;
  if (refreshSplit) deviceClicks.value = {};
  resetPage();
  if (!pageUrl.value) {
    for (const id of RANK_PANELS) search.hold(id, "idle");
    return;
  }
  const [clicks, snapshot] = await Promise.allSettled([
    loadClicks(token, refreshSplit),
    loadSnapshot(token),
  ]);
  if (token !== loadToken) return;
  if (clicks.status === "rejected") failLoad("clicks", clicks.reason);
  if (snapshot.status === "fulfilled" && snapshotReady.value) drawHeat();
}

async function loadClicks(token: number, withSplit: boolean) {
  loading.value = true;
  try {
    const win = windowMicros(RANGE_HOURS[rangeKey.value]);
    const sc = scope();
    const url = pageUrl.value;
    const rankSql = rankingSql(sc, url, deviceClass.value);
    const [split, tot, ranked] = await Promise.all([
      withSplit
        ? searchRows<Record<string, unknown>>("devices", deviceSplitSql(sc, url), 8, win)
        : [],
      searchRows<Record<string, unknown>>("totals", totalsSql(sc, url, deviceClass.value), 1, win),
      rankSql ? searchRows<Record<string, unknown>>("ranking", rankSql, RANKING_LIMIT, win) : [],
    ]);
    if (token !== loadToken || !split || !tot || !ranked) return;
    if (withSplit) {
      deviceClicks.value = Object.fromEntries(split.map((r) => [r.cls, Number(r.clicks) || 0]));
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

async function pickReplayView(): Promise<string | null> {
  const stream = await getStream("_rumdata", "logs", true);
  const hasActions = (stream?.schema ?? []).some((f: any) => f?.name === "view_action_count");
  const views = await replayRows(
    "replay-views",
    `SELECT view_id, max(${tsField()}) AS t${hasActions ? ", max(view_action_count) AS ac" : ""} FROM "_rumdata" WHERE ${rowScope(scope())} AND type = 'view' AND view_url = ${sqlLiteral(pageUrl.value)}${deviceClause(scope(), deviceClass.value)} GROUP BY view_id ORDER BY ${hasActions ? "ac DESC, " : ""}t DESC LIMIT 30`,
    30,
  );
  if (!views.length) return null;
  const ids = views.map((v) => sqlLiteral(String(v.view_id))).join(",");
  const rows = await replayRows(
    "replay-flags",
    `SELECT has_full_snapshot, view_id FROM "_sessionreplay" WHERE view_id IN (${ids})`,
    MAX_SNAPSHOT_LOOKUP_ROWS,
  );
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
async function loadSnapshotSource(): Promise<SnapshotSource | null> {
  const viewId = await pickReplayView();
  if (!viewId) return null;
  const segments = await replayRows(
    "replay-segments",
    `SELECT start, segment FROM "_sessionreplay" WHERE view_id = ${sqlLiteral(viewId)} ORDER BY start ASC`,
    MAX_REPLAY_SEGMENTS,
  );
  const bodies = segments.flatMap((r) => {
    try {
      return [JSON.parse(String(r.segment))];
    } catch {
      return [];
    }
  });
  const events = decodeReplayEvents(bodies);
  if (!events.length) return null;
  const first = Number(events[0].timestamp);
  const last = Number(events[events.length - 1].timestamp);
  const [lastClick] = await replayRows(
    "replay-click",
    `SELECT max(date) AS d FROM "_rumdata" WHERE ${rowScope(scope())} AND type = 'action' AND view_id = ${sqlLiteral(viewId)}`,
    1,
  );
  const clickAt = Number(lastClick?.d);
  const target = Number.isFinite(clickAt) && clickAt > first ? clickAt : last;
  return { events, seekMs: Math.min(Math.max(target - first, 0), Math.max(last - first, 0)) };
}

async function loadSnapshot(token: number) {
  snapshotLoading.value = true;
  snapshotReady.value = false;
  try {
    const source = await loadSnapshotSource();
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
    if (!el) continue;
    clickedEls.push(el);
    const box = el.getBoundingClientRect();
    spots.push(placeGroup(g, clicksMax.value, box, win?.scrollX ?? 0, win?.scrollY ?? 0));
    rects.set(g.selector, {
      x: box.left + (win?.scrollX ?? 0),
      y: box.top + (win?.scrollY ?? 0),
      width: box.width,
      height: box.height,
    });
    placed.add(g.selector);
  }
  placedSelectors.value = placed;
  unusedRows.value = mostlyPlaced(placed) ? findUnusedControls(frame.doc, clickedEls, rects) : [];
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
