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
        @update:model-value="loadPages"
      />
      <OSelect
        v-model="deviceClass"
        :aria-label="t('rum.heatmap.deviceLabel')"
        :options="deviceOptions"
        size="sm"
        class="w-36 max-md:hidden"
        data-test="rum-heatmap-device-select"
        @update:model-value="loadPage"
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
        @update:model-value="loadPage"
      />
    </template>

    <OEmptyState
      v-if="!loading && !pageOptions.length"
      preset="no-data"
      :title="t('rum.heatmap.noPages')"
      data-test="rum-heatmap-empty"
    />
    <div v-else class="flex h-full min-h-0 flex-col">
      <div v-if="points.length" class="shrink-0 px-4 pt-4" data-test="rum-heatmap-stats">
        <OStatStrip :items="statItems" :loading="loading" />
      </div>
      <div class="flex min-h-0 flex-1 gap-4 p-4 max-lg:flex-col">
        <div
          ref="scrollerRef"
          class="rounded-surface border-border-default min-w-0 flex-1 overflow-auto border"
        >
          <OBanner
            v-if="pageUrl && !loading && !points.length"
            variant="warning"
            dense
            :content="
              deviceClass === 'all' ? t('rum.heatmap.noPosition') : t('rum.heatmap.noDeviceData')
            "
            data-test="rum-heatmap-no-position"
          />
          <div class="flex p-4">
            <div class="mx-auto shrink-0">
              <OSpinner v-if="snapshotLoading" size="lg" data-test="rum-heatmap-snapshot-loading" />
              <div v-show="snapshotReady" ref="stageRef" data-test="rum-heatmap-stage" />
            </div>
          </div>
        </div>

        <div class="flex w-136 shrink-0 flex-col gap-2 max-lg:w-full">
          <OBanner
            v-if="loadError"
            variant="warning"
            dense
            :content="loadError"
            data-test="rum-heatmap-load-error"
          />
          <OBanner
            v-if="snapshotError && deviceClass === 'all'"
            variant="info"
            dense
            :content="snapshotError"
            data-test="rum-heatmap-snapshot-error"
          />
          <span class="text-text-secondary text-xs" data-test="rum-heatmap-placed">
            {{ t("rum.heatmap.placed", { placed: placedCount, total: groups.length }) }}
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
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
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
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { rumFieldSql } from "@/utils/rum/fields";
import { createMultiViewDecoder } from "@/utils/rum/sessionReplayViews";
import { resolveRelativeLinks } from "@/utils/rum/sessionReplayUrls";
import {
  drawOutline,
  groupBySelector,
  placeGroup,
  renderHeat,
  sharePercent,
  summarizeClicks,
  type ClickPoint,
  type ElementGroup,
  type HeatSpot,
  type OutlineRect,
  toClickPoint,
} from "@/utils/rum/clickHeatmap";

interface ElementRow {
  selector: string;
  name: string;
  feature: string;
  detail: string;
  clicks: number;
  share: number;
  sessions: number;
  frustrated: number;
}

const MAX_CLICKS = 5000;
const SNAPSHOT_LOOKBACK_HOURS = 720;
const TABLET_MIN_WIDTH = 768;
const DESKTOP_MIN_WIDTH = 1024;
const OUTLINE_SCROLL_MARGIN = 96;
const MAX_UNUSED = 30;
const UNUSED_LABEL_MAX = 40;
const INTERACTIVE_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';
const SNAPSHOT_WAIT_MS = 8000;
const SETTLE_MS = 400;
const FULL_SNAPSHOT = 2;
const META = 4;
const RANGE_HOURS: Record<string, number> = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 };

const { t } = useI18nTyped();
const store = useStore();
const { getStream } = useStreams(t);

const rangeKey = ref("24h");
const deviceClass = ref("all");
const pageUrl = ref("");
const pageOptions = ref<{ label: ReturnType<typeof raw>; value: string }[]>([]);
const loading = ref(false);
const points = ref<ClickPoint[]>([]);
const placedSelectors = ref<Set<string>>(new Set());
const snapshotLoading = ref(false);
const snapshotReady = ref(false);
const snapshotError = ref<I18nText | null>(null);
const loadError = ref<I18nText | null>(null);
const stageRef = ref<HTMLElement | null>(null);
const scrollerRef = ref<HTMLElement | null>(null);
const selectedSelector = ref("");
const capped = ref(false);

let player: any = null;
let overlay: HTMLCanvasElement | null = null;
let elementRects = new Map<string, OutlineRect>();
let loadToken = 0;

const rangeOptions = computed(() => [
  { label: t("rum.heatmap.range1h"), value: "1h" },
  { label: t("rum.heatmap.range24h"), value: "24h" },
  { label: t("rum.heatmap.range7d"), value: "7d" },
  { label: t("rum.heatmap.range30d"), value: "30d" },
]);

const deviceOptions = computed(() => [
  { label: t("rum.heatmap.deviceAll"), value: "all" },
  { label: t("rum.heatmap.deviceDesktop"), value: "desktop" },
  { label: t("rum.heatmap.deviceTablet"), value: "tablet" },
  { label: t("rum.heatmap.devicePhone"), value: "phone" },
]);

const groups = computed<ElementGroup[]>(() => groupBySelector(points.value));
const placedCount = computed(() => placedSelectors.value.size);
const summary = computed(() => summarizeClicks(points.value, groups.value));
const clicksMax = computed(() => groups.value[0]?.clicks ?? 0);
const unusedRows = ref<ElementRow[]>([]);
const tableRows = computed<ElementRow[]>(() => [
  ...groups.value.map((g) => ({
    selector: g.selector,
    name: g.name,
    feature: g.name || g.selector,
    detail: [
      g.name ? g.selector : "",
      placedSelectors.value.has(g.selector) ? "" : t("rum.heatmap.notOnPage"),
    ]
      .filter(Boolean)
      .join(" · "),
    clicks: g.clicks,
    share: sharePercent(g.clicks, summary.value.clicks),
    sessions: g.sessions,
    frustrated: g.frustrated,
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
      value: addCommasToNumber(unusedRows.value.length),
      sub: t("rum.heatmap.statUnusedSub"),
      dataTest: "rum-heatmap-stat-unused",
    });
  }
  return items;
});

const tsField = () => store.state.zoConfig.timestamp_column || "_timestamp";
const org = () => store.state.selectedOrganization.identifier;
const sqlText = (v: string) => v.replace(/'/g, "''");

function windowMicros(hours: number) {
  const end = Date.now() * 1000;
  return { start_time: end - hours * 3_600_000_000, end_time: end };
}

async function runSql(
  sql: string,
  size: number,
  hours = RANGE_HOURS[rangeKey.value],
): Promise<any[]> {
  const res = await searchService.search(
    {
      org_identifier: org(),
      query: { query: { sql, from: 0, size, ...windowMicros(hours) } },
      page_type: "logs",
    },
    "RUM",
  );
  return res.data.hits ?? [];
}

async function viewportClause(): Promise<string> {
  if (deviceClass.value === "all") return "";
  const stream = await getStream("_rumdata", "logs", true);
  if (!(stream?.schema ?? []).some((f: any) => f?.name === "display_viewport_width")) {
    return " AND 1 = 0";
  }
  const col = "display_viewport_width";
  if (deviceClass.value === "phone") return ` AND ${col} < ${TABLET_MIN_WIDTH}`;
  if (deviceClass.value === "tablet")
    return ` AND ${col} >= ${TABLET_MIN_WIDTH} AND ${col} < ${DESKTOP_MIN_WIDTH}`;
  return ` AND ${col} >= ${DESKTOP_MIN_WIDTH}`;
}

async function columnsFor() {
  const stream = await getStream("_rumdata", "logs", true);
  const pick = (f: string) => rumFieldSql(stream?.schema, f);
  const hasType = (stream?.schema ?? []).some((f: any) => f?.name === "action_type");
  const clickOnly = hasType ? " AND action_type = 'click'" : "";
  const has = (name: string) => (stream?.schema ?? []).some((f: any) => f?.name === name);
  const extras = [
    has("action_target_name") ? ", action_target_name AS name" : "",
    has("session_id") ? ", session_id AS sid" : "",
    has("action_frustration_type") ? ", action_frustration_type AS frus" : "",
  ].join("");
  const json = { pos: pick("action_position"), tgt: pick("action_target") };
  if (json.pos && json.tgt) {
    return {
      select: `${json.pos} AS pos, ${json.tgt} AS tgt${extras}`,
      where: `${json.pos} IS NOT NULL AND ${json.tgt} IS NOT NULL${clickOnly}`,
    };
  }
  const flat = {
    sel: pick("action_target_selector"),
    x: pick("action_position_x"),
    y: pick("action_position_y"),
    w: pick("action_target_width") ?? "0",
    h: pick("action_target_height") ?? "0",
  };
  if (!flat.sel || !flat.x || !flat.y) return null;
  return {
    select: `${flat.sel} AS sel, ${flat.x} AS x, ${flat.y} AS y, ${flat.w} AS w, ${flat.h} AS h${extras}`,
    where: `${flat.sel} IS NOT NULL AND ${flat.x} IS NOT NULL AND ${flat.y} IS NOT NULL${clickOnly}`,
  };
}

async function loadPages() {
  loading.value = true;
  try {
    const hits = await runSql(
      `SELECT view_url, count(*) AS c FROM "_rumdata" WHERE type = 'action' AND view_url IS NOT NULL GROUP BY view_url ORDER BY c DESC LIMIT 50`,
      50,
    );
    pageOptions.value = hits.map((h) => ({ label: raw(h.view_url), value: h.view_url }));
    if (!pageOptions.value.some((o) => o.value === pageUrl.value)) {
      pageUrl.value = pageOptions.value[0]?.value ?? "";
    }
  } catch (error) {
    console.error("Click heatmap: page list failed", error);
    pageOptions.value = [];
    loadError.value = t("rum.heatmap.loadFailed");
  } finally {
    loading.value = false;
  }
  await loadPage();
}

async function loadPage() {
  const token = ++loadToken;
  destroyPlayer();
  points.value = [];
  placedSelectors.value = new Set();
  snapshotError.value = null;
  loadError.value = null;
  selectedSelector.value = "";
  capped.value = false;
  unusedRows.value = [];
  if (!pageUrl.value) return;
  const [clicks, snapshot] = await Promise.allSettled([loadClicks(token), loadSnapshot(token)]);
  if (token !== loadToken) return;
  if (clicks.status === "rejected") {
    console.error("Click heatmap: clicks failed", clicks.reason);
    loadError.value = t("rum.heatmap.loadFailed");
  }
  if (snapshot.status === "fulfilled" && snapshotReady.value) drawHeat();
}

async function loadClicks(token: number) {
  loading.value = true;
  try {
    const c = await columnsFor();
    if (!c) return;
    const hits = await runSql(
      `SELECT ${c.select} FROM "_rumdata" WHERE type = 'action' AND view_url = '${sqlText(pageUrl.value)}' AND ${c.where}${await viewportClause()} ORDER BY ${tsField()} DESC`,
      MAX_CLICKS,
    );
    if (token !== loadToken) return;
    capped.value = hits.length >= MAX_CLICKS;
    points.value = hits.map(toClickPoint).filter((p): p is ClickPoint => p !== null);
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

const isSnapshotFlag = (v: unknown) => v === true || v === "true" || Number(v) === 1;

async function findSnapshotSegment(): Promise<any | null> {
  const views = await runSql(
    `SELECT view_id, max(${tsField()}) AS t FROM "_rumdata" WHERE type = 'view' AND view_url = '${sqlText(pageUrl.value)}'${await viewportClause()} GROUP BY view_id ORDER BY t DESC LIMIT 30`,
    30,
    SNAPSHOT_LOOKBACK_HOURS,
  );
  if (!views.length) return null;
  const ids = views.map((v) => `'${sqlText(String(v.view_id))}'`).join(",");
  const rows = await runSql(
    `SELECT start, has_full_snapshot, view_id FROM "_sessionreplay" WHERE view_id IN (${ids}) ORDER BY start DESC`,
    500,
    SNAPSHOT_LOOKBACK_HOURS,
  );
  const row = rows.find((r) => isSnapshotFlag(r.has_full_snapshot));
  if (!row) return null;
  const [body] = await runSql(
    `SELECT segment FROM "_sessionreplay" WHERE view_id = '${sqlText(String(row.view_id))}' AND start = ${Number(row.start)} LIMIT 1`,
    1,
    SNAPSHOT_LOOKBACK_HOURS,
  );
  return body ?? null;
}

function snapshotEvents(hit: any): any[] {
  const body = JSON.parse(hit.segment);
  const { events } = createMultiViewDecoder().push([body], Infinity);
  let href: unknown;
  return events.map((e: any) => {
    if (e.type === 8) return { ...e, type: 5, data: { payload: { ...e.data }, tag: "viewport" } };
    if (e.type === META) href = e.data?.href;
    if (e.type === FULL_SNAPSHOT && e.data?.node) resolveRelativeLinks(e.data.node, href);
    return e;
  });
}

async function loadSnapshot(token: number) {
  snapshotLoading.value = true;
  snapshotReady.value = false;
  try {
    const hit = await findSnapshotSegment();
    if (token !== loadToken) return;
    const events = hit ? snapshotEvents(hit) : [];
    const meta = events.find((e) => e.type === META);
    if (!events.some((e) => e.type === FULL_SNAPSHOT) || !meta) {
      snapshotError.value = t("rum.heatmap.noReplay");
      return;
    }
    snapshotReady.value = true;
    await nextTick();
    if (token !== loadToken || !stageRef.value) return;
    await mountPlayer(events, meta.data.width, meta.data.height, token);
  } catch (error) {
    if (token !== loadToken) return;
    console.error("Click heatmap: snapshot failed", error);
    snapshotReady.value = false;
    snapshotError.value = t("rum.heatmap.snapshotFailed");
  } finally {
    if (token === loadToken) snapshotLoading.value = false;
  }
}

async function mountPlayer(events: any[], width: number, height: number, token: number) {
  const module: any = await import("@openobserve/rrweb-player");
  await import("@openobserve/rrweb-player/dist/style.css");
  if (token !== loadToken || !stageRef.value) return;
  const Player = module.default;
  player = markRaw(
    new Player({
      target: stageRef.value as HTMLElement,
      props: {
        events,
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
}

// The replayer rebuilds the first snapshot on a timer after construction, so the iframe is empty until then.
async function waitForSnapshotDom(token: number) {
  const deadline = performance.now() + SNAPSHOT_WAIT_MS;
  while (token === loadToken && performance.now() < deadline) {
    const body = frameDoc()?.doc.body;
    if (body && body.childElementCount > 0) {
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      return;
    }
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
  return full;
}

function ensureOverlay(frame: { wrapper: HTMLElement }, width: number, height: number) {
  if (!overlay) {
    overlay = document.createElement("canvas");
    overlay.dataset.test = "rum-heatmap-canvas";
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
    spots.push(...placeGroup(g, box, win?.scrollX ?? 0, win?.scrollY ?? 0));
    rects.set(g.selector, {
      x: box.left + (win?.scrollX ?? 0),
      y: box.top + (win?.scrollY ?? 0),
      width: box.width,
      height: box.height,
    });
    placed.add(g.selector);
  }
  placedSelectors.value = placed;
  unusedRows.value = findUnusedControls(frame.doc, clickedEls, rects);
  elementRects = rects;
  renderHeat(canvas, spots);
  const selected = elementRects.get(selectedSelector.value);
  if (selected) drawOutline(canvas, selected);
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
      detail: tag,
      clicks: 0,
      share: 0,
      sessions: 0,
      frustrated: 0,
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
  scroller.scrollTo({ top: stageTop + rect.y - OUTLINE_SCROLL_MARGIN, behavior: "smooth" });
}

onMounted(loadPages);
onBeforeUnmount(destroyPlayer);
</script>
