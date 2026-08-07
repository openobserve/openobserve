<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Primary: log-explorer results filtered by a clicked dashboard cell.
     Secondary: clicking any row opens a full ODrawer with 4 visual insight sections. -->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import { b64EncodeUnicode } from "@/utils/formatters";
import searchService from "@/services/search";
import patternsService from "@/services/patterns";

const props = defineProps<{
  stream: string;
  streamType?: string;
  field: string;
  value: string | number;
  startTime: number; // microseconds
  endTime: number;   // microseconds
}>();

const { t } = useI18nTyped();
const store  = useStore();
const route  = useRoute();
const router = useRouter();
const orgId  = computed(() => store.state.selectedOrganization.identifier);

// ── Search state ──────────────────────────────────────────────────────────────
const events    = ref<any[]>([]);
const total     = ref(0);
const page      = ref(0);
const pageSize  = ref(100);
const loading   = ref(false);
const errorMsg  = ref("");

const pageSizeOptions = [
  { label: "50 / page",  value: 50  },
  { label: "100 / page", value: 100 },
  { label: "200 / page", value: 200 },
  { label: "500 / page", value: 500 },
];

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const pageFrom   = computed(() => total.value === 0 ? 0 : page.value * pageSize.value + 1);
const pageTo     = computed(() => Math.min(page.value * pageSize.value + events.value.length, total.value));
const hasPrev    = computed(() => page.value > 0);
const hasNext    = computed(() => pageTo.value < total.value);

const cols = computed((): string[] => {
  if (!events.value.length) return [];
  const keys = Object.keys(events.value[0]);
  return [...keys.filter(k => k === "_timestamp"), ...keys.filter(k => k !== "_timestamp" && !k.startsWith("_"))];
});

// ── SQL editor ────────────────────────────────────────────────────────────────
const queryMode = ref(false);
const customSql = ref("");

function escSql(v: string | number): string { return String(v).replace(/'/g, "''"); }
function buildDefaultSql(): string {
  return `SELECT * FROM "${props.stream}" WHERE "${props.field}" = '${escSql(props.value)}' ORDER BY _timestamp DESC`;
}
function activeSql()  { return customSql.value || buildDefaultSql(); }
function resetSql()   { customSql.value = buildDefaultSql(); }

// ── Event detail drawer ───────────────────────────────────────────────────────
const selectedEvent = ref<Record<string, any> | null>(null);
const detailOpen    = computed(() => !!selectedEvent.value);
const detailTab     = ref("insights");

// ── Insights state (loaded when detail drawer opens) ──────────────────────────
const insightsLoading  = ref(false);
const timeline         = ref<{ keyMs: number; num: number }[]>([]);
const insightPatterns  = ref<any[]>([]);
const surroundEvents   = ref<any[]>([]);
const surroundMinutes  = ref(3);
const surroundLoading  = ref(false);
const surroundPage        = ref(0);
const SURROUND_PER_PAGE   = 20;
const surroundExpandedIdx = ref(new Set<number>());

const surroundWindowOptions = [
  { label: "±1 min",  value: 1  },
  { label: "±2 min",  value: 2  },
  { label: "±3 min",  value: 3  },
  { label: "±5 min",  value: 5  },
  { label: "±10 min", value: 10 },
];

// Field anomaly profile: how rare is each field value in this event vs current page?
const fieldAnomalyProfile = computed(() => {
  if (!selectedEvent.value || !events.value.length) return [];
  const n = events.value.length;
  return Object.entries(selectedEvent.value)
    .filter(([k]) => !k.startsWith("_"))
    .map(([fld, val]) => {
      const sv = String(val ?? "—");
      const cnt = events.value.filter(e => String(e[fld] ?? "—") === sv).length;
      const pct = Math.round((cnt / n) * 100);
      const rarity: "anomalous" | "rare" | "uncommon" | "common" =
        pct < 2 ? "anomalous" : pct < 10 ? "rare" : pct < 40 ? "uncommon" : "common";
      return { fld, sv, cnt, pct, rarity, n };
    })
    .sort((a, b) => a.pct - b.pct); // rarest fields first
});

const timelineMax      = computed(() => Math.max(1, ...timeline.value.map(b => b.num)));
const surroundTotalPages = computed(() => Math.max(1, Math.ceil(surroundEvents.value.length / SURROUND_PER_PAGE)));
const surroundPagedEvents = computed(() =>
  surroundEvents.value.slice(surroundPage.value * SURROUND_PER_PAGE, (surroundPage.value + 1) * SURROUND_PER_PAGE)
);
// eventXFrac: position of the selected event within the full time range (0–1)
// props times are µs; selected event _timestamp is µs
const eventXFrac  = computed(() => {
  if (!selectedEvent.value || !timeline.value.length) return -1;
  const ts   = Number(selectedEvent.value._timestamp ?? 0);
  // Use the actual timeline bucket range for the fraction so the marker lines up with the bars
  const tMin = timeline.value[0].keyMs * 1_000;  // ms → µs
  const tMax = timeline.value[timeline.value.length - 1].keyMs * 1_000;
  const span = tMax - tMin;
  if (!ts || span <= 0) return -1;
  return Math.max(0, Math.min(1, (ts - tMin) / span));
});

function getTimeBucket(): string {
  const rangeMs = (props.endTime - props.startTime) / 1_000;
  if (rangeMs < 30 * 60_000)        return "1 minute";
  if (rangeMs < 3 * 3_600_000)      return "5 minute";
  if (rangeMs < 12 * 3_600_000)     return "15 minute";
  if (rangeMs < 3 * 86_400_000)     return "1 hour";
  return "6 hour";
}

async function loadSurrounding(ev: Record<string, any>) {
  const ts  = Number(ev._timestamp ?? 0);
  if (!ts) return;
  const win = surroundMinutes.value * 60 * 1_000_000;
  surroundLoading.value = true;
  surroundPage.value = 0;
  surroundExpandedIdx.value = new Set();
  try {
    const res = await searchService.search({
      org_identifier: orgId.value,
      query: { query: {
        sql: `SELECT * FROM "${props.stream}" ORDER BY _timestamp ASC`,
        start_time: ts - win, end_time: ts + win, from: 0, size: 200,
      }},
      page_type: props.streamType ?? "logs",
    }, "ui");
    surroundEvents.value = res.data?.hits ?? [];
    // Jump to the page containing the selected event
    const idx = surroundEvents.value.findIndex(e => String(e._timestamp) === String(ts));
    if (idx >= 0) surroundPage.value = Math.floor(idx / SURROUND_PER_PAGE);
  } catch { surroundEvents.value = []; }
  surroundLoading.value = false;
}

async function loadInsights(ev: Record<string, any>) {
  insightsLoading.value = true;
  timeline.value = [];
  insightPatterns.value = [];
  surroundEvents.value = [];

  const intv  = getTimeBucket();
  const where = `"${props.field}" = '${escSql(props.value)}'`;

  const [histR, patR] = await Promise.allSettled([
    // 1. Histogram — event count per time bucket over full range
    searchService.search({
      org_identifier: orgId.value,
      query: { query: {
        sql: `SELECT histogram(_timestamp, '${intv}') AS zo_key, COUNT(*) AS zo_cnt FROM "${props.stream}" WHERE ${where} GROUP BY zo_key ORDER BY zo_key`,
        start_time: props.startTime, end_time: props.endTime, from: 0, size: 500,
      }},
      page_type: props.streamType ?? "logs",
    }, "ui"),

    // 2. Log patterns — cluster similar log lines
    patternsService.extractPatterns({
      org_identifier: orgId.value,
      stream_name: props.stream,
      query: { query: { sql: `SELECT * FROM "${props.stream}" WHERE ${where}`, start_time: props.startTime, end_time: props.endTime, from: 0, size: 1000 } },
    }),
  ]);

  if (histR.status === "fulfilled") {
    // OpenObserve histogram() returns zo_key as an ISO-8601 date string (e.g. "2024-01-15T10:30:00")
    timeline.value = (histR.value.data?.hits ?? [])
      .map((h: any) => ({ keyMs: new Date(h.zo_key).getTime(), num: Number(h.zo_cnt) }))
      .filter((b: any) => !isNaN(b.keyMs))
      .sort((a: any, b: any) => a.keyMs - b.keyMs);
  }
  if (patR.status === "fulfilled") {
    insightPatterns.value = (patR.value.data?.patterns ?? []).slice(0, 8).map((p: any) => ({
      template: p.template || p.description || "—",
      count:    p.frequency ?? p.count ?? 0,
      pct:      Math.round(p.percentage ?? 0),
      z_score:  p.z_score ?? 0,
      sample:   (p.examples?.[0]?.log ?? p.sample_logs?.[0] ?? ""),
    }));
  }

  insightsLoading.value = false;
  // Load surrounding events concurrently (separate loading state for dropdown changes)
  loadSurrounding(ev);
}

function openEventDetail(ev: Record<string, any>) {
  selectedEvent.value = ev;
  detailTab.value = "insights";
  router.replace({ query: { ...route.query, cell_event_ts: String(ev._timestamp ?? "") } });
  loadInsights(ev);
}

function closeEventDetail() {
  selectedEvent.value = null;
  const q = { ...route.query };
  delete (q as any).cell_event_ts;
  router.replace({ query: q });
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(String(text)).catch(() => {/* best-effort */});
}
function copyCurrentUrl() {
  copyToClipboard(window.location.href);
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtTs(ts: unknown): string {
  if (!ts) return "—";
  const raw = Number(ts);
  const ms  = raw > 1e13 ? raw / 1000 : raw;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtTsShort(ts: unknown): string {
  if (!ts) return "—";
  const raw = Number(ts);
  const ms  = raw > 1e13 ? raw / 1000 : raw;
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtRelTime(tsµs: number, refµs: number): string {
  const diffMs = (tsµs - refµs) / 1_000;
  if (Math.abs(diffMs) < 500) return "now";
  const sign = diffMs >= 0 ? "+" : "−";
  const abs  = Math.abs(diffMs);
  if (abs < 60_000) return `${sign}${Math.floor(abs / 1_000)}s`;
  // Use floor for both m and s to avoid "2m 60s" from rounding up
  let m = Math.floor(abs / 60_000);
  const s = Math.floor((abs % 60_000) / 1_000);
  return s === 0 ? `${sign}${m}m` : `${sign}${m}m ${s}s`;
}

const dateRange = computed(() => {
  if (!props.startTime || !props.endTime) return "";
  const fmt = (µs: number) =>
    new Date(µs / 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${fmt(props.startTime)} – ${fmt(props.endTime)}`;
});

function fmtJson(obj: any): string { return JSON.stringify(obj, null, 2); }

// ── Search ────────────────────────────────────────────────────────────────────
async function runSql(sql: string, fromOffset: number) {
  if (!orgId.value || !props.stream) {
    errorMsg.value = props.stream ? "" : `Stream not resolved (field: ${props.field})`;
    return;
  }
  loading.value  = true;
  errorMsg.value = "";
  try {
    const res = await searchService.search({
      org_identifier: orgId.value,
      query: { query: { sql, start_time: props.startTime, end_time: props.endTime, from: fromOffset, size: pageSize.value } },
      page_type: props.streamType ?? "logs",
    }, "ui");
    events.value = res.data?.hits ?? [];
    total.value  = res.data?.total ?? events.value.length;
  } catch (e: any) {
    errorMsg.value = `${e?.response?.data?.error ?? e?.message ?? "Search failed"}\n\n${sql}`;
    events.value = []; total.value = 0;
  } finally { loading.value = false; }
}

async function loadEvents() { page.value = 0; const sql = buildDefaultSql(); customSql.value = sql; await runSql(sql, 0); }
async function runQuery()   { page.value = 0; await runSql(activeSql(), 0); }
async function goToPage(p: number) { page.value = p; await runSql(activeSql(), p * pageSize.value); }

// Restore the event detail drawer from URL param — does a dedicated 1-row fetch
// by exact _timestamp so the event never has to be on the first results page.
async function restoreEventDetail() {
  const ts = route.query.cell_event_ts;
  if (!ts || selectedEvent.value) return;
  try {
    const res = await searchService.search({
      org_identifier: orgId.value,
      query: { query: {
        sql: `SELECT * FROM "${props.stream}" WHERE _timestamp = ${ts}`,
        start_time: props.startTime, end_time: props.endTime,
        from: 0, size: 1,
      }},
      page_type: props.streamType ?? "logs",
    }, "ui");
    const found = res.data?.hits?.[0];
    if (found) {
      selectedEvent.value = found;
      detailTab.value = "insights";
      loadInsights(found);
    }
  } catch { /* best-effort */ }
}

watch(pageSize, () => goToPage(0));
onMounted(async () => {
  await loadEvents();
  await restoreEventDetail();
});
watch(() => [props.field, props.value, props.stream], () => { selectedEvent.value = null; loadEvents(); });
watch(surroundMinutes, () => { surroundPage.value = 0; if (selectedEvent.value) loadSurrounding(selectedEvent.value); });

function toggleSurroundExpand(globalIdx: number) {
  const next = new Set(surroundExpandedIdx.value);
  if (next.has(globalIdx)) next.delete(globalIdx); else next.add(globalIdx);
  surroundExpandedIdx.value = next;
}
function isSurroundExpanded(pageIdx: number) {
  return surroundExpandedIdx.value.has(surroundPage.value * SURROUND_PER_PAGE + pageIdx);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function patternToSql(template: string): string {
  // Replace SDR wildcards like <:IP>, <:NUM>, <:URI> with SQL LIKE wildcards (%)
  const likePattern = template.replace(/<:[^>]+>/g, "%").replace(/'/g, "''");
  return `SELECT * FROM "${props.stream}" WHERE _all LIKE '${likePattern}' ORDER BY _timestamp DESC`;
}

function openPatternInLogs(template: string) {
  const pos  = window.location.pathname.indexOf("/web/");
  const base = pos > -1
    ? window.location.origin + window.location.pathname.slice(0, pos) + "/web"
    : window.location.origin;
  const url  = new URL(`${base}/logs`);
  url.searchParams.set("org_identifier", orgId.value);
  url.searchParams.set("stream_type",    props.streamType ?? "logs");
  url.searchParams.set("stream",         props.stream);
  url.searchParams.set("from",           String(props.startTime));
  url.searchParams.set("to",             String(props.endTime));
  url.searchParams.set("query",          b64EncodeUnicode(patternToSql(template)));
  url.searchParams.set("sql_mode",       "true");
  url.searchParams.set("quick_mode",     "false");
  url.searchParams.set("show_histogram", "true");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function openInLogs() {
  const pos  = window.location.pathname.indexOf("/web/");
  const base = pos > -1
    ? window.location.origin + window.location.pathname.slice(0, pos) + "/web"
    : window.location.origin;
  const url  = new URL(`${base}/logs`);
  url.searchParams.set("org_identifier", orgId.value);
  url.searchParams.set("stream_type",    props.streamType ?? "logs");
  url.searchParams.set("stream",         props.stream);
  url.searchParams.set("from",           String(props.startTime));
  url.searchParams.set("to",             String(props.endTime));
  url.searchParams.set("query",          b64EncodeUnicode(activeSql()));
  url.searchParams.set("sql_mode",       "true");
  url.searchParams.set("quick_mode",     "false");
  url.searchParams.set("show_histogram", "false");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 overflow-hidden">

    <!-- ── Header context strip ─────────────────────────────────────── -->
    <div class="flex flex-col border-b border-border-default bg-surface-panel shrink-0 min-w-0">
      <div class="flex items-center gap-2 px-4 pt-2 pb-1 min-w-0">
        <span class="text-text-secondary text-xs font-mono shrink-0">{{ field }}</span>
        <OIcon name="arrow-forward" size="xs" class="text-text-tertiary shrink-0" />
        <span class="text-accent text-xs font-mono font-semibold truncate">{{ value }}</span>
        <div class="flex-1" />
        <OButton size="sm" :variant="queryMode ? 'secondary' : 'ghost'" icon-left="code"
          data-test="log-explorer-query-mode-toggle" @click="queryMode = !queryMode">
          {{ t("panel.logExplorer.queryMode") }}
        </OButton>
        <OButton size="sm" variant="ghost" icon-left="open-in-new"
          data-test="log-explorer-open-in-logs" @click="openInLogs">
          {{ t("panel.logExplorer.openInLogs") }}
        </OButton>
        <OButton size="sm" variant="ghost" icon-left="refresh" :loading="loading"
          data-test="log-explorer-refresh" @click="loadEvents" />
      </div>
      <div v-if="dateRange" class="flex items-center gap-1 px-4 pb-2">
        <OIcon name="schedule" size="xs" class="text-text-tertiary shrink-0" />
        <span class="text-text-tertiary text-2xs font-mono">{{ dateRange }}</span>
      </div>
    </div>

    <!-- ── SQL editor ──────────────────────────────────────────────── -->
    <div v-if="queryMode" class="dld-editor shrink-0 border-b border-border-default"
      @keydown.ctrl.enter.prevent="runQuery">
      <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-subtle border-b border-border-default">
        <span class="dld-editor__dot rounded-full" /><span class="dld-editor__dot rounded-full" /><span class="dld-editor__dot rounded-full" />
        <span class="text-text-tertiary text-2xs font-mono ml-1 flex-1">SQL</span>
        <OButton size="sm" variant="ghost" icon-left="restart-alt" @click="resetSql">{{ t("panel.logExplorer.resetSql") }}</OButton>
        <OButton size="sm" variant="primary" icon-left="play-arrow" :loading="loading" @click="runQuery">
          {{ t("panel.logExplorer.runQuery") }}<span class="text-2xs opacity-50 ml-1 hidden sm:inline">Ctrl↵</span>
        </OButton>
      </div>
      <div class="dld-editor__body">
        <OTextarea v-model="customSql" :rows="6" :autogrow="false" :placeholder="t('panel.logExplorer.sqlPlaceholder')" />
      </div>
    </div>

    <!-- ── Error ────────────────────────────────────────────────────── -->
    <div v-if="errorMsg" class="flex items-start gap-2 px-4 py-3 shrink-0">
      <OIcon name="error-outline" size="sm" class="text-error-500 shrink-0 mt-0.5" />
      <code class="text-2xs font-mono text-error-500 whitespace-pre-wrap break-all">{{ errorMsg }}</code>
    </div>

    <template v-else-if="loading && !events.length">
      <div v-for="n in 14" :key="n" class="dld-skeleton" />
    </template>

    <div v-else-if="!loading && !events.length && !errorMsg"
      class="flex flex-col items-center justify-center gap-4 flex-1 px-6">
      <OIcon name="manage-search" size="xl" class="text-text-tertiary opacity-30" />
      <span class="text-text-secondary text-sm">{{ t("panel.logExplorer.noEvents") }}</span>
      <code class="text-2xs text-text-tertiary font-mono bg-surface-subtle rounded-default px-3 py-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all text-center">{{ customSql }}</code>
    </div>

    <!-- ── Results ──────────────────────────────────────────────────── -->
    <template v-else-if="events.length">
      <div class="flex-1 overflow-auto min-h-0 relative">
        <div v-if="loading" class="dld-progress" />
        <table class="dld-table">
          <thead>
            <tr>
              <th v-for="col in cols" :key="col" class="dld-th">
                {{ col === "_timestamp" ? t("panel.logExplorer.timestamp") : col }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(ev, i) in events" :key="i" class="dld-row"
              :class="{ 'dld-row--active': selectedEvent === ev }"
              @click="openEventDetail(ev)">
              <td v-for="col in cols" :key="col" class="dld-td">
                <template v-if="col === '_timestamp'">{{ fmtTs(ev[col]) }}</template>
                <template v-else>{{ ev[col] ?? "—" }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination footer -->
      <div class="flex items-center gap-3 px-3 h-10 shrink-0 border-t border-border-default bg-surface-panel">
        <OSelect v-model="pageSize" :options="pageSizeOptions" size="sm" />
        <span class="text-text-tertiary text-xs tabular-nums whitespace-nowrap">
          {{ pageFrom.toLocaleString() }}–{{ pageTo.toLocaleString() }}
          {{ t("panel.logExplorer.of") }} {{ total.toLocaleString() }}
          {{ total === 1 ? t("panel.logExplorer.event") : t("panel.logExplorer.events") }}
        </span>
        <div class="flex-1" />
        <div class="flex items-center gap-1">
          <OButton size="sm" variant="ghost" icon-left="first-page"    :disabled="!hasPrev" @click="goToPage(0)" />
          <OButton size="sm" variant="ghost" icon-left="chevron-left"  :disabled="!hasPrev" @click="goToPage(page - 1)" />
          <span class="text-text-secondary text-xs tabular-nums px-2 whitespace-nowrap">{{ (page + 1).toLocaleString() }} / {{ totalPages.toLocaleString() }}</span>
          <OButton size="sm" variant="ghost" icon-left="chevron-right" :disabled="!hasNext" @click="goToPage(page + 1)" />
          <OButton size="sm" variant="ghost" icon-left="last-page"     :disabled="!hasNext" @click="goToPage(totalPages - 1)" />
        </div>
      </div>
    </template>

    <!-- ── Event detail drawer ─────────────────────────────────────── -->
    <ODrawer
      :open="detailOpen"
      side="right"
      :width="55"
      :title="t('panel.logExplorer.detail.drawerTitle')"
      data-test="log-explorer-event-detail-drawer"
      @update:open="v => { if (!v) closeEventDetail(); }"
    >
      <div v-if="selectedEvent" class="flex flex-col h-full min-h-0">

        <!-- Event meta strip -->
        <div class="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-surface-panel shrink-0">
          <div class="flex flex-col min-w-0 flex-1">
            <span class="text-text-heading text-xs font-medium font-mono tabular-nums">{{ fmtTs(selectedEvent["_timestamp"]) }}</span>
            <span class="text-text-tertiary text-2xs font-mono">{{ stream }}</span>
          </div>
          <OButton size="sm" variant="ghost" icon-left="link"
            @click="copyCurrentUrl()">
            {{ t("panel.logExplorer.detail.copyLink") }}
          </OButton>
        </div>

        <!-- Tabs -->
        <OTabs v-model="detailTab" dense bordered class="px-4 shrink-0">
          <OTab name="insights" :label="t('panel.logExplorer.detail.insights')" icon="insights" />
          <OTab name="details"  :label="t('panel.logExplorer.detail.details')" />
          <OTab name="json"     :label="t('panel.logExplorer.detail.json')" />
        </OTabs>

        <OTabPanels v-model="detailTab" :grow="true" scroll="y" class="min-h-0">

          <!-- ═══ INSIGHTS TAB ═══════════════════════════════════════ -->
          <OTabPanel name="insights" class="p-0">

            <!-- Global loading bar -->
            <div v-if="insightsLoading" class="dld-progress shrink-0" />

            <!-- ① Field Anomaly Profile (instant — computed from current page) -->
            <section class="dld-section">
              <header class="dld-section-header">
                <OIcon name="search" size="xs" class="text-accent shrink-0" />
                <span>{{ t("panel.logExplorer.insights.anomalyTitle") }}</span>
                <span class="dld-section-hint">{{ t("panel.logExplorer.insights.anomalyHint", { n: events.length }) }}</span>
              </header>
              <div class="flex flex-col gap-2 px-4 pb-3">
                <div v-for="item in fieldAnomalyProfile" :key="item.fld"
                  class="flex flex-col gap-0.5 group">
                  <div class="flex items-center gap-2">
                    <span class="text-2xs text-text-tertiary font-mono w-32 shrink-0 truncate" :title="item.fld">{{ item.fld }}</span>
                    <span :class="['dld-rarity-badge rounded-full', `dld-rarity-badge--${item.rarity}`]">
                      {{ t(`panel.logExplorer.insights.rarity.${item.rarity}`) }} {{ item.pct }}%
                    </span>
                    <span class="text-2xs text-text-secondary font-mono flex-1 truncate" :title="item.sv">{{ item.sv }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="w-32 shrink-0" />
                    <div class="flex-1 h-1 rounded-full bg-surface-subtle overflow-hidden">
                      <div :class="['h-full rounded-full', item.rarity === 'common' ? 'bg-accent opacity-40' : item.rarity === 'uncommon' ? 'bg-accent opacity-60' : 'bg-error-500 opacity-70']"
                        :style="`--dld-pct:${item.pct}%;width:var(--dld-pct,0%)`" />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- ② Event Timeline (SVG histogram — API call) -->
            <section class="dld-section">
              <header class="dld-section-header">
                <OIcon name="bar-chart" size="xs" class="text-accent shrink-0" />
                <span>{{ t("panel.logExplorer.insights.timelineTitle") }}</span>
                <span class="dld-section-hint">{{ t("panel.logExplorer.insights.timelineHint") }}</span>
              </header>
              <div class="px-4 pb-3">
                <!-- Skeleton while loading -->
                <div v-if="insightsLoading && !timeline.length" class="h-14 rounded-default bg-surface-subtle animate-pulse" />
                <div v-else-if="!timeline.length" class="h-14 flex items-center justify-center">
                  <span class="text-2xs text-text-tertiary">No data</span>
                </div>
                <template v-else>
                  <!-- SVG bar chart -->
                  <svg class="dld-timeline-svg" viewBox="0 0 200 54" preserveAspectRatio="none">
                    <!-- Bars -->
                    <rect
                      v-for="(bucket, i) in timeline"
                      :key="i"
                      :x="(i / timeline.length) * 200"
                      :y="52 - (bucket.num / timelineMax) * 46"
                      :width="Math.max(0.5, (200 / timeline.length) - 0.5)"
                      :height="(bucket.num / timelineMax) * 46"
                      class="dld-timeline-bar"
                    />
                    <!-- Selected event marker -->
                    <line v-if="eventXFrac >= 0"
                      :x1="eventXFrac * 200" :x2="eventXFrac * 200"
                      y1="0" y2="54"
                      class="dld-timeline-marker"
                    />
                  </svg>
                  <!-- X-axis labels -->
                  <div class="flex justify-between mt-1">
                    <span class="text-2xs text-text-tertiary font-mono">{{ fmtTsShort(timeline[0]?.keyMs) }}</span>
                    <span class="text-2xs text-text-tertiary font-mono">{{ fmtTsShort(timeline[timeline.length - 1]?.keyMs) }}</span>
                  </div>
                </template>
              </div>
            </section>

            <!-- ③ Log Patterns (patterns API) -->
            <section class="dld-section">
              <header class="dld-section-header">
                <OIcon name="pattern" size="xs" class="text-accent shrink-0" />
                <span>{{ t("panel.logExplorer.insights.patternsTitle") }}</span>
                <span class="dld-section-hint">{{ t("panel.logExplorer.insights.patternsHint") }}</span>
              </header>
              <div class="flex flex-col divide-y divide-border-default">
                <div v-if="insightsLoading && !insightPatterns.length"
                  class="flex flex-col gap-2 px-4 py-3">
                  <div v-for="n in 3" :key="n" class="h-6 rounded-default bg-surface-subtle animate-pulse" />
                </div>
                <div v-else-if="!insightPatterns.length" class="px-4 py-3">
                  <span class="text-2xs text-text-tertiary">{{ t("panel.logExplorer.insights.patternsEmpty") }}</span>
                </div>
                <template v-else>
                  <div v-for="p in insightPatterns" :key="p.template"
                    class="px-4 py-2 flex flex-col gap-1 hover:bg-surface-subtle transition-colors">
                    <div class="flex items-center gap-2">
                      <!-- Anomaly badge if z_score is high -->
                      <span v-if="p.z_score > 2" class="dld-rarity-badge rounded-full dld-rarity-badge--rare shrink-0">
                        z={{ p.z_score.toFixed(1) }}
                      </span>
                      <span class="text-2xs font-medium tabular-nums text-text-tertiary whitespace-nowrap shrink-0">{{ p.pct }}%</span>
                      <!-- Pattern template with wildcards -->
                      <code class="text-2xs font-mono text-text-secondary flex-1 truncate" :title="p.template">{{ p.template }}</code>
                      <!-- Open in Logs -->
                      <OButton size="sm" variant="ghost" icon-left="open-in-new" class="shrink-0"
                        data-test="log-explorer-pattern-open" @click.stop="openPatternInLogs(p.template)" />
                    </div>
                    <!-- Mini frequency bar -->
                    <div class="h-1 rounded-full bg-surface-subtle overflow-hidden">
                      <div class="h-full rounded-full bg-accent opacity-50"
                        :style="`width:${Math.min(p.pct, 100)}%`" />
                    </div>
                    <!-- Sample log line -->
                    <p v-if="p.sample" class="text-2xs text-text-tertiary font-mono truncate leading-snug" :title="p.sample">{{ p.sample }}</p>
                  </div>
                </template>
              </div>
            </section>

            <!-- ④ Surrounding Events -->
            <section class="dld-section">
              <header class="dld-section-header">
                <OIcon name="timeline" size="xs" class="text-accent shrink-0" />
                <span>{{ t("panel.logExplorer.insights.contextTitle") }}</span>
                <OTooltip :content="t('panel.logExplorer.insights.contextTooltip')" side="bottom" :max-width="'280px'">
                  <OIcon name="info-outline" size="xs" class="text-text-tertiary cursor-help" />
                </OTooltip>
                <div class="ml-auto shrink-0">
                  <OSelect v-model="surroundMinutes" :options="surroundWindowOptions" size="sm"
                    data-test="log-explorer-surround-window" />
                </div>
              </header>
              <div class="flex flex-col">
                <div v-if="(insightsLoading || surroundLoading) && !surroundEvents.length"
                  class="flex flex-col gap-2 px-4 py-3">
                  <div v-for="n in 5" :key="n" class="h-7 rounded-default bg-surface-subtle animate-pulse" />
                </div>
                <div v-else-if="!surroundEvents.length" class="px-4 py-3">
                  <span class="text-2xs text-text-tertiary">{{ t("panel.logExplorer.insights.contextEmpty") }}</span>
                </div>
                <template v-else>
                  <div v-for="(ev, i) in surroundPagedEvents" :key="i"
                    :class="['dld-ctx-row', String(ev._timestamp) === String(selectedEvent!._timestamp) && 'dld-ctx-row--current']">
                    <!-- Timeline spine -->
                    <div class="dld-ctx-spine">
                      <div :class="['dld-ctx-dot rounded-full', String(ev._timestamp) === String(selectedEvent!._timestamp) && 'dld-ctx-dot--current']" />
                      <div v-if="i < surroundPagedEvents.length - 1" class="dld-ctx-line" />
                    </div>
                    <!-- Content -->
                    <div class="flex flex-col min-w-0 py-2 pr-2 flex-1">
                      <!-- Row header: rel time + timestamp + expand toggle -->
                      <div class="flex items-center gap-2">
                        <span :class="['text-2xs font-mono tabular-nums whitespace-nowrap shrink-0', String(ev._timestamp) === String(selectedEvent!._timestamp) ? 'text-accent font-semibold' : 'text-text-tertiary']">
                          {{ fmtRelTime(Number(ev._timestamp), Number(selectedEvent!._timestamp)) }}
                        </span>
                        <span class="text-2xs text-text-tertiary font-mono truncate flex-1">{{ fmtTsShort(ev._timestamp) }}</span>
                        <button class="dld-expand-btn shrink-0"
                          :aria-label="isSurroundExpanded(i) ? 'Collapse' : 'Expand'"
                          @click.stop="toggleSurroundExpand(surroundPage * SURROUND_PER_PAGE + i)">
                          <OIcon :name="isSurroundExpanded(i) ? 'expand-less' : 'expand-more'" size="xs" />
                        </button>
                      </div>

                      <!-- Collapsed: 4 fields inline truncated -->
                      <div v-if="!isSurroundExpanded(i)"
                        class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <template v-for="col in Object.keys(ev).filter(k => !k.startsWith('_')).slice(0, 4)" :key="col">
                          <span v-if="ev[col] != null" class="text-2xs font-mono">
                            <span class="text-text-tertiary">{{ col }}=</span>
                            <span class="text-text-secondary truncate max-w-32 inline-block align-bottom">{{ ev[col] }}</span>
                          </span>
                        </template>
                      </div>

                      <!-- Expanded: all fields as KV list, full values wrap -->
                      <div v-else class="flex flex-col gap-0.5 mt-1 border-t border-border-default pt-1">
                        <div v-for="col in Object.keys(ev).filter(k => !k.startsWith('_'))" :key="col"
                          class="flex gap-2 text-2xs font-mono">
                          <span class="text-text-tertiary shrink-0 w-36 truncate" :title="col">{{ col }}</span>
                          <span class="text-text-secondary break-all">{{ ev[col] ?? "—" }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <!-- Surrounding events pagination -->
                  <div v-if="surroundTotalPages > 1"
                    class="flex items-center justify-between px-4 py-2 border-t border-border-default bg-surface-panel">
                    <span class="text-2xs text-text-tertiary tabular-nums">
                      {{ surroundPage + 1 }} / {{ surroundTotalPages }}
                      &nbsp;·&nbsp; {{ surroundEvents.length }} events
                    </span>
                    <div class="flex items-center gap-1">
                      <OButton size="sm" variant="ghost" icon-left="first-page"
                        :disabled="surroundPage === 0" @click="surroundPage = 0" />
                      <OButton size="sm" variant="ghost" icon-left="chevron-left"
                        :disabled="surroundPage === 0" @click="surroundPage--" />
                      <OButton size="sm" variant="ghost" icon-left="chevron-right"
                        :disabled="surroundPage >= surroundTotalPages - 1" @click="surroundPage++" />
                      <OButton size="sm" variant="ghost" icon-left="last-page"
                        :disabled="surroundPage >= surroundTotalPages - 1" @click="surroundPage = surroundTotalPages - 1" />
                    </div>
                  </div>
                </template>
              </div>
            </section>
          </OTabPanel>

          <!-- ═══ DETAILS TAB ════════════════════════════════════════ -->
          <OTabPanel name="details" class="p-0">
            <table class="dld-kv-table">
              <tbody>
                <tr v-for="[k, v] in Object.entries(selectedEvent)" :key="k"
                  class="dld-kv-row" :class="{ 'dld-kv-row--highlight': k === field }">
                  <td class="dld-kv-key">{{ k }}</td>
                  <td class="dld-kv-val">
                    <template v-if="k === '_timestamp'">{{ fmtTs(v) }}</template>
                    <template v-else>{{ v ?? "—" }}</template>
                  </td>
                  <td class="dld-kv-copy">
                    <button class="dld-copy-btn" @click.stop="copyToClipboard(v)">
                      <OIcon name="content-copy" size="xs" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </OTabPanel>

          <!-- ═══ JSON TAB ═══════════════════════════════════════════ -->
          <OTabPanel name="json" class="p-0">
            <div class="relative">
              <OButton size="sm" variant="ghost" icon-left="content-copy"
                class="absolute top-2 right-2 z-10"
                @click="copyToClipboard(fmtJson(selectedEvent))">
                {{ t("panel.logExplorer.detail.copy") }}
              </OButton>
              <pre class="dld-json">{{ fmtJson(selectedEvent) }}</pre>
            </div>
          </OTabPanel>
        </OTabPanels>
      </div>
    </ODrawer>
  </div>
</template>

<style scoped>
/* keep(keyframes): pulse/progress @keyframes and :deep(OTextarea) SQL chrome cannot be expressed as Tailwind */
/* ── Skeletons ────────────────────────────────────────────────────────────── */
.dld-skeleton {
  height: 2rem; border-radius: 0.25rem; margin: 0.125rem 1rem;
  background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
  animation: dld-pulse 1.4s ease-in-out infinite;
}
@keyframes dld-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.75; } }

.dld-progress {
  position: sticky; top: 0; height: 0.125rem; z-index: 10;
  background: color-mix(in srgb, var(--color-accent) 70%, transparent);
  animation: dld-bar-anim 1.2s ease-in-out infinite; transform-origin: left;
}
@keyframes dld-bar-anim { 0% { transform: scaleX(0.05); } 60% { transform: scaleX(0.85); } 100% { transform: scaleX(1); } }

/* ── SQL editor ──────────────────────────────────────────────────────────── */
.dld-editor { background: color-mix(in srgb, var(--color-surface-base) 100%, transparent); }
.dld-editor__dot {
  display: inline-block; width: 0.5rem; height: 0.5rem;
  background: color-mix(in srgb, var(--color-border-default) 80%, transparent);
}
.dld-editor__body :deep([class*="wrapper"]),
.dld-editor__body :deep([class*="o-textarea"]) {
  border: none !important; border-radius: 0 !important; box-shadow: none !important; background: transparent !important;
}
.dld-editor__body :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 0.75rem; line-height: 1.7; padding: 0.75rem 1rem;
  background: color-mix(in srgb, var(--color-surface-subtle) 50%, transparent);
  color: color-mix(in srgb, var(--color-text-primary) 100%, transparent);
  border-left: 0.1875rem solid color-mix(in srgb, var(--color-accent) 50%, transparent);
  resize: none; width: 100%;
}
.dld-editor__body :deep(textarea:focus) {
  border-left-color: color-mix(in srgb, var(--color-accent) 90%, transparent); outline: none;
}

/* ── Log results table ───────────────────────────────────────────────────── */
.dld-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
.dld-th {
  position: sticky; top: 0; z-index: 1; padding: 0.375rem 0.75rem;
  text-align: left; font-weight: 600; font-size: 0.6875rem; text-transform: uppercase;
  letter-spacing: 0.04em; white-space: nowrap;
  background: color-mix(in srgb, var(--color-surface-panel) 100%, transparent);
  color: color-mix(in srgb, var(--color-text-tertiary) 100%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 100%, transparent);
}
.dld-row {
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 100%, transparent);
  cursor: pointer; transition: background 80ms;
}
.dld-row:hover { background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent); }
.dld-row--active { background: color-mix(in srgb, var(--color-accent) 8%, transparent); }
.dld-row--active:hover { background: color-mix(in srgb, var(--color-accent) 13%, transparent); }
.dld-td {
  padding: 0.375rem 0.75rem; white-space: nowrap; max-width: 20rem;
  overflow: hidden; text-overflow: ellipsis;
  color: color-mix(in srgb, var(--color-text-primary) 100%, transparent);
}

/* ── Insight sections ────────────────────────────────────────────────────── */
.dld-section {
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 100%, transparent);
}
.dld-section-header {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.625rem 1rem;
  font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--color-text-secondary) 100%, transparent);
  background: color-mix(in srgb, var(--color-surface-subtle) 40%, transparent);
}
.dld-section-hint {
  font-weight: 400; text-transform: none; letter-spacing: 0;
  font-size: 0.625rem;
  color: color-mix(in srgb, var(--color-text-tertiary) 100%, transparent);
  margin-left: auto;
}

/* Rarity badges */
.dld-rarity-badge {
  display: inline-flex; align-items: center;
  padding: 0.1rem 0.4rem;
  font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  white-space: nowrap; flex-shrink: 0;
}
.dld-rarity-badge--common   { background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent); color: color-mix(in srgb, var(--color-text-tertiary) 100%, transparent); }
.dld-rarity-badge--uncommon { background: color-mix(in srgb, oklch(70% 0.18 75) 15%, transparent); color: oklch(60% 0.18 75); }
.dld-rarity-badge--rare     { background: color-mix(in srgb, oklch(60% 0.2 25) 15%, transparent);  color: oklch(60% 0.2 25); }
.dld-rarity-badge--anomalous{ background: color-mix(in srgb, oklch(55% 0.22 25) 20%, transparent); color: oklch(55% 0.22 25); font-weight: 900; }

/* ── Timeline SVG chart ──────────────────────────────────────────────────── */
.dld-timeline-svg { width: 100%; height: 3.5rem; display: block; }
.dld-timeline-bar {
  fill: color-mix(in srgb, var(--color-accent) 55%, transparent);
  transition: fill 80ms;
}
.dld-timeline-bar:hover { fill: color-mix(in srgb, var(--color-accent) 80%, transparent); }
.dld-timeline-marker { stroke: color-mix(in srgb, var(--color-accent) 90%, transparent); stroke-width: 1.5; stroke-dasharray: 3 2; }

/* ── Temporal context timeline ───────────────────────────────────────────── */
.dld-ctx-row {
  display: flex; align-items: stretch; gap: 0; min-width: 0;
  transition: background 80ms;
}
.dld-ctx-row:hover { background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent); }
.dld-ctx-row--current { background: color-mix(in srgb, var(--color-accent) 5%, transparent); }
.dld-ctx-row--current:hover { background: color-mix(in srgb, var(--color-accent) 9%, transparent); }

.dld-ctx-spine {
  display: flex; flex-direction: column; align-items: center; width: 2.5rem;
  padding-top: 0.625rem; flex-shrink: 0;
}
.dld-ctx-dot {
  width: 0.5rem; height: 0.5rem; flex-shrink: 0;
  background: color-mix(in srgb, var(--color-border-default) 100%, transparent);
}
.dld-ctx-dot--current {
  background: color-mix(in srgb, var(--color-accent) 90%, transparent);
  box-shadow: 0 0 0 0.1875rem color-mix(in srgb, var(--color-accent) 25%, transparent);
}
.dld-ctx-line {
  width: 1px; flex: 1;
  background: color-mix(in srgb, var(--color-border-default) 60%, transparent);
  margin-top: 0.25rem;
}

/* ── Event detail KV table ───────────────────────────────────────────────── */
.dld-kv-table { width: 100%; border-collapse: collapse; font-size: 0.6875rem; }
.dld-kv-row { border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 50%, transparent); }
.dld-kv-row:hover { background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent); }
.dld-kv-row--highlight { background: color-mix(in srgb, var(--color-accent) 7%, transparent); }
.dld-kv-row--highlight:hover { background: color-mix(in srgb, var(--color-accent) 13%, transparent); }
.dld-kv-key { padding: 0.35rem 0.5rem 0.35rem 1rem; font-family: var(--font-mono); font-weight: 600; white-space: nowrap; width: 38%; vertical-align: top; color: color-mix(in srgb, var(--color-text-secondary) 100%, transparent); }
.dld-kv-val { padding: 0.35rem 0.5rem; word-break: break-all; vertical-align: top; color: color-mix(in srgb, var(--color-text-primary) 100%, transparent); }
.dld-kv-copy { padding: 0.25rem 0.75rem 0.25rem 0; vertical-align: top; }
.dld-copy-btn {
  display: flex; align-items: center; justify-content: center; padding: 0.25rem;
  border-radius: 0.25rem; border: none; background: transparent; cursor: pointer;
  color: color-mix(in srgb, var(--color-text-tertiary) 100%, transparent); transition: color 100ms, background 100ms;
}
.dld-copy-btn:hover { color: color-mix(in srgb, var(--color-text-primary) 100%, transparent); background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent); }

/* ── Surrounding events expand button ───────────────────────────────────── */
.dld-expand-btn {
  display: flex; align-items: center; justify-content: center;
  padding: 0.125rem; border-radius: 0.25rem; border: none; background: transparent; cursor: pointer;
  color: color-mix(in srgb, var(--color-text-tertiary) 100%, transparent);
  transition: color 100ms, background 100ms;
}
.dld-expand-btn:hover {
  color: color-mix(in srgb, var(--color-text-primary) 100%, transparent);
  background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent);
}

/* ── JSON view ───────────────────────────────────────────────────────────── */
.dld-json {
  font-family: var(--font-mono); font-size: 0.6875rem; line-height: 1.6;
  padding: 3rem 1rem 0.75rem; white-space: pre-wrap; word-break: break-all;
  color: color-mix(in srgb, var(--color-text-primary) 100%, transparent); margin: 0;
}
</style>
