<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Log-explorer results filtered by a clicked dashboard cell; row click opens a detail drawer. -->
<script setup lang="ts">
import { ref, computed, onMounted, watch, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { useI18nTyped, raw } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import DateTime from "@/components/DateTime.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import TablePaginationControls from "@/components/dashboards/addPanel/TablePaginationControls.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
const JsonPreview = defineAsyncComponent(() => import("@/plugins/logs/JsonPreview.vue"));
const ChartRenderer = defineAsyncComponent(() => import("@/components/dashboards/panels/ChartRenderer.vue"));
import { toast } from "@/lib/feedback/Toast/useToast";
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
  baseWhere?: string; // panel's own WHERE, AND-combined with the clicked cell
}>();

const { t } = useI18nTyped();
const store  = useStore();
const route  = useRoute();
const router = useRouter();
const orgId  = computed(() => store.state.selectedOrganization.identifier);

// Editable time range (µs); searches read these refs, not the fixed props.
const rangeStart = ref(props.startTime);
const rangeEnd   = ref(props.endTime);
watch(
  () => [props.startTime, props.endTime],
  () => { rangeStart.value = props.startTime; rangeEnd.value = props.endTime; },
);
const onDateChange = (d: { startTime: number; endTime: number }) => {
  rangeStart.value = Number.isFinite(d.startTime) ? Math.trunc(d.startTime) : rangeStart.value;
  rangeEnd.value   = Number.isFinite(d.endTime)   ? Math.trunc(d.endTime)   : rangeEnd.value;
  loadEvents();
};

// ── Search state ──────────────────────────────────────────────────────────────
const events    = ref<any[]>([]);
const total     = ref(0);
const page      = ref(0);
const pageSize  = ref(100);
const loading   = ref(false);
const errorMsg  = ref("");

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const pageTo     = computed(() => Math.min(page.value * pageSize.value + events.value.length, total.value));
const hasPrev    = computed(() => page.value > 0);
const hasNext    = computed(() => pageTo.value < total.value);

const cols = computed((): string[] => {
  if (!events.value.length) return [];
  const keys = Object.keys(events.value[0]);
  return [...keys.filter(k => k === "_timestamp"), ...keys.filter(k => k !== "_timestamp" && !k.startsWith("_"))];
});

// ── SQL editor ────────────────────────────────────────────────────────────────
const customSql = ref("");

function escSql(v: string | number): string { return String(v).replace(/'/g, "''"); }
// Clicked cell predicate: IS NULL for empty, unquoted for numbers, escaped-quote otherwise.
function cellWhere(): string {
  const v = props.value;
  if (v === null || v === undefined || v === "") return `${props.field} IS NULL`;
  if (typeof v === "number") return `${props.field} = ${v}`;
  return `${props.field} = '${escSql(v)}'`;
}
// Cell predicate AND-combined with the panel's own filter so the drilldown
// matches the scoped data the panel actually shows.
function effectiveWhere(): string {
  const cell = cellWhere();
  return props.baseWhere ? `(${props.baseWhere}) AND ${cell}` : cell;
}
function buildDefaultSql(): string {
  return `SELECT * FROM "${props.stream}" WHERE ${effectiveWhere()} ORDER BY _timestamp DESC`;
}
function activeSql()  { return customSql.value || buildDefaultSql(); }

// ── Event detail drawer ───────────────────────────────────────────────────────
const selectedEvent = ref<Record<string, any> | null>(null);
const detailOpen    = computed(() => !!selectedEvent.value);
const detailTab     = ref("insights");

// ── Insights state (loaded when detail drawer opens) ──────────────────────────
const insightsLoading  = ref(false);
const timeline         = ref<{ keyMs: number; num: number }[]>([]);

// Field Anomaly Profile table: rarity column carries chip + bar, value column the sample.
const anomalyColumns = computed<OTableColumnDef[]>(() => [
  { id: "fld", header: t("panel.logExplorer.insights.colField"), accessorKey: "fld", size: 160 },
  { id: "rarity", header: t("panel.logExplorer.insights.colRarity"), accessorKey: "rarity", size: 120, minSize: 120 },
  // Elastic value column: absorbs leftover width and ellipsis-truncates instead of scrolling.
  { id: "sv", header: t("panel.logExplorer.insights.colValue"), accessorKey: "sv", meta: { autoWidth: true, fillRemaining: true } },
]);
const insightPatterns  = ref<any[]>([]);
const surroundEvents   = ref<any[]>([]);
const surroundMinutes  = ref(3);
const surroundLoading  = ref(false);
const surroundPage        = ref(0);
const surroundPageSize    = ref(20);
const surroundExpandedIdx = ref(new Set<number>());

const surroundWindowOptions = [
  { label: raw("±1 min"),  value: 1  },
  { label: raw("±2 min"),  value: 2  },
  { label: raw("±3 min"),  value: 3  },
  { label: raw("±5 min"),  value: 5  },
  { label: raw("±10 min"), value: 10 },
];
const surroundLabel = computed(
  () => surroundWindowOptions.find((o) => o.value === surroundMinutes.value)?.label ?? raw(""),
);

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

// Event Timeline as an ECharts bar chart via the shared ChartRenderer (same tooltip/theming).
const timelineChartOptions = computed(() => {
  const rootStyle = getComputedStyle(document.documentElement);
  const readVar = (name: string, fallback: string) =>
    rootStyle.getPropertyValue(name).trim() || fallback;
  // Touch the theme so colors recompute when it toggles.
  void store.state.theme;
  const accent   = readVar("--color-accent", "#7c6cf6");
  const axisText = readVar("--color-text-tertiary", "#9ca3af");
  const axisLine = readVar("--color-border-default", "#e5e7eb");

  const times  = timeline.value.map((b) => b.keyMs);
  const counts = timeline.value.map((b) => b.num);

  // Nearest bucket to the selected event → dashed marker line.
  const evMs = Number(selectedEvent.value?._timestamp ?? 0) / 1000;
  let markerIdx = -1;
  if (evMs > 0 && times.length) {
    let best = Infinity;
    times.forEach((tMs, i) => {
      const d = Math.abs(tMs - evMs);
      if (d < best) { best = d; markerIdx = i; }
    });
  }

  return {
    backgroundColor: "transparent",
    // containLabel:false — edge labels pinned via alignMin/MaxLabel below; top leaves marker room.
    grid: { top: 20, right: 4, bottom: 2, left: 4, containLabel: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const ms = Number(times[p.dataIndex]);
        const n = Number(p.data ?? 0);
        const label = n === 1 ? t("panel.logExplorer.event") : t("panel.logExplorer.events");
        return `${fmtTsShort(ms)}<br/>${n} ${label}`;
      },
    },
    xAxis: {
      type: "category",
      data: times,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: axisLine } },
      axisLabel: {
        color: axisText,
        fontSize: 10,
        interval: (index: number) => index === 0 || index === times.length - 1,
        formatter: (v: any) => fmtTsShort(Number(v)),
        showMinLabel: true,
        showMaxLabel: true,
        // Pin first/last labels to the plot edges so they don't overflow.
        alignMinLabel: "left",
        alignMaxLabel: "right",
      },
    },
    yAxis: { type: "value", show: false },
    series: [
      {
        type: "bar",
        data: counts,
        barCategoryGap: "20%",
        itemStyle: { color: accent, opacity: 0.8, borderRadius: [2, 2, 0, 0] },
        emphasis: { disabled: true },
        markLine: markerIdx >= 0
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { color: accent, type: "dashed", width: 1.5 },
              label: {
                show: true,
                position: "insideEndTop",
                // Event count in the selected event's bucket.
                formatter: () => String(counts[markerIdx] ?? 0),
                color: accent,
                fontSize: 10,
                fontWeight: 600,
                rotate: 0,
                align: "right",
                padding: [0, 2, 2, 0],
              },
              data: [{ xAxis: markerIdx }],
            }
          : undefined,
      },
    ],
  };
});
const surroundTotalPages = computed(() => Math.max(1, Math.ceil(surroundEvents.value.length / surroundPageSize.value)));
const surroundPagedEvents = computed(() =>
  surroundEvents.value.slice(surroundPage.value * surroundPageSize.value, (surroundPage.value + 1) * surroundPageSize.value)
);
function getTimeBucket(): string {
  const rangeMs = (rangeEnd.value - rangeStart.value) / 1_000;
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
    if (idx >= 0) surroundPage.value = Math.floor(idx / surroundPageSize.value);
  } catch { surroundEvents.value = []; }
  surroundLoading.value = false;
}

async function loadInsights(ev: Record<string, any>) {
  insightsLoading.value = true;
  timeline.value = [];
  insightPatterns.value = [];
  surroundEvents.value = [];

  const intv  = getTimeBucket();
  const where = effectiveWhere();

  const [histR, patR] = await Promise.allSettled([
    // 1. Histogram — event count per time bucket over full range
    searchService.search({
      org_identifier: orgId.value,
      query: { query: {
        sql: `SELECT histogram(_timestamp, '${intv}') AS zo_key, COUNT(*) AS zo_cnt FROM "${props.stream}" WHERE ${where} GROUP BY zo_key ORDER BY zo_key`,
        start_time: rangeStart.value, end_time: rangeEnd.value, from: 0, size: 500,
      }},
      page_type: props.streamType ?? "logs",
    }, "ui"),

    // 2. Log patterns — cluster similar log lines
    patternsService.extractPatterns({
      org_identifier: orgId.value,
      stream_name: props.stream,
      query: { query: { sql: `SELECT * FROM "${props.stream}" WHERE ${where}`, start_time: rangeStart.value, end_time: rangeEnd.value, from: 0, size: 1000 } },
    }),
  ]);

  if (histR.status === "fulfilled") {
    // zo_key is UTC ISO-8601 without a zone suffix; append "Z" so it isn't parsed as local.
    const toUtcMs = (key: string): number => {
      const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(key) ? key : `${key}Z`;
      return new Date(iso).getTime();
    };
    timeline.value = (histR.value.data?.hits ?? [])
      .map((h: any) => ({ keyMs: toUtcMs(String(h.zo_key ?? "")), num: Number(h.zo_cnt) }))
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

// Details tab: field/value rows, filtered by the search box.
const detailFilter = ref("");
const wrapDetailValues = ref(false);
// Format the timestamp column; pass everything else through for LogsHighLighting.
function getDetailDisplayValue(field: string, value: any): any {
  return field === "_timestamp" ? fmtTs(value) : value;
}
const detailRows = computed<[string, any][]>(() => {
  const entries = Object.entries(selectedEvent.value ?? {});
  const q = detailFilter.value.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    ([k, v]) => k.toLowerCase().includes(q) || String(v ?? "").toLowerCase().includes(q),
  );
});

// JsonPreview's @copy emits an object; stringify non-strings as pretty JSON.
function copyToClipboard(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  navigator.clipboard
    .writeText(text)
    .then(() => toast({ variant: "success", message: t("common.copiedToClipboard") }))
    .catch(() => {/* best-effort */});
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
      query: { query: { sql, start_time: rangeStart.value, end_time: rangeEnd.value, from: fromOffset, size: pageSize.value } },
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

// Restore the detail drawer from URL param via a 1-row fetch by exact _timestamp.
async function restoreEventDetail() {
  const ts = route.query.cell_event_ts;
  if (!ts || selectedEvent.value) return;
  try {
    const res = await searchService.search({
      org_identifier: orgId.value,
      query: { query: {
        sql: `SELECT * FROM "${props.stream}" WHERE _timestamp = ${ts}`,
        start_time: rangeStart.value, end_time: rangeEnd.value,
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
  return surroundExpandedIdx.value.has(surroundPage.value * surroundPageSize.value + pageIdx);
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
  url.searchParams.set("from",           String(rangeStart.value));
  url.searchParams.set("to",             String(rangeEnd.value));
  url.searchParams.set("query",          b64EncodeUnicode(patternToSql(template)) ?? "");
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
  url.searchParams.set("from",           String(rangeStart.value));
  url.searchParams.set("to",             String(rangeEnd.value));
  url.searchParams.set("query",          b64EncodeUnicode(activeSql()) ?? "");
  url.searchParams.set("sql_mode",       "true");
  url.searchParams.set("quick_mode",     "false");
  url.searchParams.set("show_histogram", "false");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 overflow-hidden">

    <!-- ── Toolbar: datetime picker + open-in-logs + run ───── -->
    <div class="flex flex-col border-b border-border-default shrink-0 min-w-0">
      <div class="flex items-center gap-2 pt-3 pb-2 min-w-0">
        <div class="flex-1" />
        <DateTime
          default-type="absolute"
          :default-absolute-time="{ startTime: rangeStart, endTime: rangeEnd }"
          data-test-name="dashboard-log-drawer-date-time"
          @on:date-change="onDateChange"
        />
        <OButton size="sm" variant="outline" icon-left="open-in-new"
          data-test="log-explorer-open-in-logs" @click="openInLogs">
          {{ t("panel.logExplorer.openInLogs") }}
        </OButton>
        <OButton size="sm" variant="primary" icon-left="play-arrow" :loading="loading"
          data-test="log-explorer-run" @click="runQuery">
          {{ t("panel.logExplorer.runQuery") }}
        </OButton>
      </div>
      <div class=" pb-2">
        <div class="border-border-default rounded-default overflow-hidden border">
          <QueryEditor
            :query="customSql"
            :languages="['sql']"
            editor-height="4rem"
            hide-nl-toggle
            data-test-prefix="log-explorer-editor"
            @update:query="customSql = $event"
            @run-query="runQuery"
          />
        </div>
      </div>
    </div>

    <!-- ── Error ────────────────────────────────────────────────────── -->
    <div v-if="errorMsg" class="flex items-start gap-2 px-4 py-3 shrink-0">
      <OIcon name="error-outline" size="sm" class="text-error-500 shrink-0 mt-0.5" />
      <code class="text-xs font-mono text-error-500 whitespace-pre-wrap break-all">{{ errorMsg }}</code>
    </div>

    <template v-else-if="loading && !events.length">
      <div v-for="n in 14" :key="n" class="dld-skeleton" />
    </template>

    <div v-else-if="!loading && !events.length && !errorMsg"
      class="flex flex-col items-center justify-center gap-4 flex-1 px-6">
      <OIcon name="manage-search" size="xl" class="text-text-tertiary opacity-30" />
      <span class="text-text-secondary text-sm">{{ t("panel.logExplorer.noEvents") }}</span>
      <code class="text-xs text-text-tertiary font-mono bg-surface-subtle rounded-default px-3 py-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all text-center">{{ customSql }}</code>
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

      <!-- Pagination footer — project-standard controls (matches dashboard tables) -->
      <div class="border-border-default flex h-10 w-full shrink-0 items-center border-t px-3">
        <div class="flex-1" />
        <TablePaginationControls
          :show-pagination="true"
          :pagination="{ page: page + 1, rowsPerPage: pageSize }"
          :total-rows="total"
          :pages-number="totalPages"
          :is-first-page="!hasPrev"
          :is-last-page="!hasNext"
          @update:rows-per-page="(n) => { pageSize = n; goToPage(0); }"
          @first-page="goToPage(0)"
          @prev-page="goToPage(page - 1)"
          @next-page="goToPage(page + 1)"
          @last-page="goToPage(totalPages - 1)"
        />
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
            <span class="text-text-tertiary text-xs font-mono">{{ stream }}</span>
          </div>
          <OButton size="sm" variant="outline" icon-left="link"
            @click="copyCurrentUrl()">
            {{ t("panel.logExplorer.detail.copyLink") }}
          </OButton>
        </div>

        <!-- Tabs -->
        <OTabs v-model="detailTab" dense bordered class="px-4 shrink-0 mb-2">
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
              <div class="px-4 pb-3">
                <OTable
                  :data="fieldAnomalyProfile"
                  :columns="anomalyColumns"
                  :default-columns="false"
                  :show-global-filter="false"
                  :bordered="true"
                  pagination="none"
                  sorting="none"
                  :wrap="true"
                >
                  <!-- Field name -->
                  <template #cell-fld="{ value }">
                    <span class="truncate text-text-primary">{{ value }}<OTooltip :content="raw(String(value))" /></span>
                  </template>
                  <!-- Rarity chip + magnitude bar -->
                  <template #cell-rarity="{ row }">
                    <div class="flex flex-col gap-1 py-1">
                      <OTag type="fieldRarity" :value="row.rarity" class="self-start">
                        {{ t(`panel.logExplorer.insights.rarity.${row.rarity}`) }} {{ row.pct }}%
                      </OTag>
                      <div class="h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
                        <div
                          :class="['h-full rounded-full opacity-80', row.rarity === 'anomalous' || row.rarity === 'rare' ? 'bg-error-500' : 'bg-accent']"
                          :style="`width:${row.pct}%`"
                        />
                      </div>
                    </div>
                  </template>
                  <!-- Sampled value -->
                  <template #cell-sv="{ value }">
                    <span class="truncate text-text-secondary">{{ value }}<OTooltip :content="raw(String(value))" max-width="22.5rem" /></span>
                  </template>
                </OTable>
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
                  <span class="text-xs text-text-tertiary">{{ t("panel.logExplorer.insights.timelineEmpty") }}</span>
                </div>
                <!-- ECharts bar chart via the shared dashboard ChartRenderer -->
                <div v-else class="h-24">
                  <ChartRenderer :data="{ options: timelineChartOptions }" />
                </div>
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
                  <span class="text-xs text-text-tertiary">{{ t("panel.logExplorer.insights.patternsEmpty") }}</span>
                </div>
                <template v-else>
                  <div v-for="p in insightPatterns" :key="p.template"
                    class="dld-pat-row px-4 py-2 flex flex-col gap-1 transition-colors">
                    <div class="flex items-center gap-2">
                      <!-- Anomaly badge if z_score is high -->
                      <OTag v-if="p.z_score > 2" type="fieldRarity"
                        :value="p.z_score > 3 ? 'anomalous' : 'rare'" class="shrink-0">
                        {{ t("panel.logExplorer.insights.zScore", { value: p.z_score.toFixed(1) }) }}
                      </OTag>
                      <span class="text-xs font-medium tabular-nums text-text-tertiary whitespace-nowrap shrink-0">{{ p.pct }}%</span>
                      <!-- Pattern template with wildcards -->
                      <code class="text-xs font-mono text-text-secondary flex-1 truncate">{{ p.template }}<OTooltip :content="raw(p.template)" max-width="22.5rem" /></code>
                      <!-- Open in Logs -->
                      <OButton size="sm" variant="ghost" icon-left="open-in-new" class="shrink-0"
                        data-test="log-explorer-pattern-open" @click.stop="openPatternInLogs(p.template)" />
                    </div>
                    <!-- Mini frequency bar -->
                    <div class="h-1 rounded-full bg-surface-subtle overflow-hidden">
                      <div class="h-full rounded-full bg-accent opacity-80"
                        :style="`width:${Math.min(p.pct, 100)}%`" />
                    </div>
                    <!-- Sample log line -->
                    <p v-if="p.sample" class="text-xs text-text-tertiary font-mono truncate leading-snug">{{ p.sample }}<OTooltip :content="raw(p.sample)" max-width="22.5rem" /></p>
                  </div>
                </template>
              </div>
            </section>

            <!-- ④ Surrounding Events -->
            <section class="dld-section">
              <header class="dld-section-header">
                <OIcon name="timeline" size="xs" class="text-accent shrink-0" />
                <span>{{ t("panel.logExplorer.insights.contextTitle") }}</span>
                <OTooltip :content="t('panel.logExplorer.insights.contextTooltip')" side="bottom" max-width="17.5rem">
                  <OIcon name="info-outline" size="xs" class="text-text-tertiary cursor-help" />
                </OTooltip>
                <div class="ml-auto shrink-0">
                  <ODropdown side="bottom" align="end">
                    <template #trigger>
                      <OButton size="sm" variant="outline" icon-right="arrow-drop-down"
                        data-test="log-explorer-surround-window">
                        {{ surroundLabel }}
                      </OButton>
                    </template>
                    <ODropdownItem
                      v-for="opt in surroundWindowOptions"
                      :key="opt.value"
                      :data-test="`log-explorer-surround-window-${opt.value}`"
                      @select="surroundMinutes = opt.value"
                    >
                      {{ opt.label }}
                    </ODropdownItem>
                  </ODropdown>
                </div>
              </header>
              <div class="flex flex-col">
                <div v-if="(insightsLoading || surroundLoading) && !surroundEvents.length"
                  class="flex flex-col gap-2 px-4 py-3">
                  <div v-for="n in 5" :key="n" class="h-7 rounded-default bg-surface-subtle animate-pulse" />
                </div>
                <div v-else-if="!surroundEvents.length" class="px-4 py-3">
                  <span class="text-xs text-text-tertiary">{{ t("panel.logExplorer.insights.contextEmpty") }}</span>
                </div>
                <template v-else>
                  <div v-for="(ev, i) in surroundPagedEvents" :key="i"
                    :class="['dld-ctx-row cursor-pointer', String(ev._timestamp) === String(selectedEvent!._timestamp) && 'dld-ctx-row--current']"
                    @click="toggleSurroundExpand(surroundPage * surroundPageSize + i)">
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
                        <span class="text-xs text-text-tertiary font-mono truncate flex-1">{{ fmtTsShort(ev._timestamp) }}</span>
                        <button class="dld-expand-btn shrink-0"
                          :aria-label="isSurroundExpanded(i) ? 'Collapse' : 'Expand'"
                          @click.stop="toggleSurroundExpand(surroundPage * surroundPageSize + i)">
                          <OIcon :name="isSurroundExpanded(i) ? 'expand-less' : 'expand-more'" size="xs" />
                        </button>
                      </div>

                      <!-- Collapsed: 4 fields inline truncated -->
                      <div v-if="!isSurroundExpanded(i)"
                        class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <template v-for="col in Object.keys(ev).filter(k => !k.startsWith('_')).slice(0, 4)" :key="col">
                          <span v-if="ev[col] != null" class="text-xs font-mono">
                            <span class="text-text-tertiary">{{ col }}=</span>
                            <span class="text-text-secondary truncate max-w-32 inline-block align-bottom">{{ ev[col] }}</span>
                          </span>
                        </template>
                      </div>

                      <!-- Expanded: all fields as KV list, full values wrap -->
                      <div v-else class="flex flex-col gap-0.5 mt-1 border-t border-border-default pt-1">
                        <div v-for="col in Object.keys(ev).filter(k => !k.startsWith('_'))" :key="col"
                          class="flex gap-2 text-xs font-mono">
                          <span class="text-text-tertiary shrink-0 w-36 truncate">{{ col }}<OTooltip :content="raw(col)" /></span>
                          <span class="text-text-secondary break-all">{{ ev[col] ?? "—" }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <!-- Surrounding events pagination — project-standard controls -->
                  <div v-if="surroundEvents.length" class="flex w-full items-center px-3 pt-2">
                    <div class="flex-1" />
                    <TablePaginationControls
                      :show-pagination="true"
                      :pagination="{ page: surroundPage + 1, rowsPerPage: surroundPageSize }"
                      :total-rows="surroundEvents.length"
                      :pages-number="surroundTotalPages"
                      :is-first-page="surroundPage === 0"
                      :is-last-page="surroundPage >= surroundTotalPages - 1"
                      @update:rows-per-page="(n) => { surroundPageSize = n; surroundPage = 0; }"
                      @first-page="surroundPage = 0"
                      @prev-page="surroundPage--"
                      @next-page="surroundPage++"
                      @last-page="surroundPage = surroundTotalPages - 1"
                    />
                  </div>
                </template>
              </div>
            </section>
          </OTabPanel>

          <!-- ═══ DETAILS TAB (searchable Name/Value table) ═════════════ -->
          <OTabPanel name="details" class="px-2 pb-2">
            <div class="mb-2 flex items-center gap-2">
              <OInput
                v-model="detailFilter"
                size="sm"
                icon-left="search"
                :placeholder="t('common.search')"
                class="flex-1"
                data-test="log-explorer-detail-search"
              />
              <OSwitch
                v-model="wrapDetailValues"
                :label="t('common.wrap')"
                size="md"
                data-test="log-explorer-detail-wrap"
              />
            </div>
            <table class="dld-kv-table">
              <thead>
                <tr class="dld-kv-head-row">
                  <th class="dld-kv-head dld-kv-head--key">{{ t("search.sourceName") }}</th>
                  <th class="dld-kv-head">{{ t("search.sourceValue") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="[k, v] in detailRows" :key="k"
                  class="dld-kv-row" :class="{ 'dld-kv-row--highlight': k === field }">
                  <td class="dld-kv-key log-key">{{ k }}</td>
                  <td class="dld-kv-val">
                    <pre
                      class="m-0 block w-full min-w-0 p-0 font-mono font-normal"
                      :class="wrapDetailValues ? 'whitespace-pre-wrap break-all' : 'overflow-hidden text-ellipsis whitespace-nowrap'"
                    ><LogsHighLighting :data="getDetailDisplayValue(k, v)" :show-braces="false" /></pre>
                  </td>
                </tr>
              </tbody>
            </table>
          </OTabPanel>

          <!-- ═══ JSON TAB (tree — same as Source Details) ═══════════════ -->
          <OTabPanel name="json" class="px-2 pb-2">
            <div class="dld-json-preview">
              <JsonPreview
                :value="selectedEvent"
                mode="sidebar"
                :stream-name="stream"
                :show-copy-button="true"
                hide-view-related
                hide-search-term-actions
                hide-field-options
                @copy="copyToClipboard"
              />
            </div>
          </OTabPanel>
        </OTabPanels>
      </div>
    </ODrawer>
  </div>
</template>

<style scoped>
/* keep(keyframes): pulse/progress @keyframes and :deep(OTextarea) SQL chrome cannot be expressed as Tailwind */
/* Scoped to .dld-json-preview so the shared JsonPreview elsewhere is unaffected. */
.dld-json-preview :deep(.log_json_content) {
  padding-block: 0.1875rem;
}
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
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: 1px table header divider */
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 100%, transparent);
}
.dld-row {
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: 1px row divider */
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
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: section divider (1 device pixel) */
  border-bottom: 1px solid var(--color-border-default);
  padding-bottom: 0.5rem;
}
.dld-section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.dld-section-header {
  display: flex; align-items: center; gap: 0.625rem;
  padding: 1.25rem 1rem 0.875rem;
  font-size: var(--text-sm); font-weight: 600; letter-spacing: 0;
  color: var(--color-text-primary);
}
/* Render the leading section OIcon as a small accent chip. */
.dld-section-header > :first-child {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.25rem; height: 1.25rem; flex: none;
  border-radius: 0.3125rem;
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}
.dld-section-header :deep(svg) { color: var(--color-accent); width: 0.75rem; height: 0.75rem; }
.dld-section-hint {
  font-weight: 400; letter-spacing: 0;
  font-size: var(--text-2xs);
  color: var(--color-text-tertiary);
  margin-left: auto;
}

/* ── Temporal context timeline ───────────────────────────────────────────── */
.dld-ctx-row {
  display: flex; align-items: stretch; gap: 0; min-width: 0;
  transition: background 80ms;
}
.dld-ctx-row:hover { background: color-mix(in srgb, var(--color-accent) 6%, transparent); }
.dld-pat-row:hover { background: color-mix(in srgb, var(--color-accent) 6%, transparent); }
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
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: 1px vertical connector line */
  width: 1px; flex: 1;
  background: color-mix(in srgb, var(--color-border-default) 60%, transparent);
  margin-top: 0.25rem;
}

/* ── Event detail KV table ───────────────────────────────────────────────── */
/* eslint-disable-next-line local/no-hardcoded-px -- hairline: table grid line (1 device pixel) */
.dld-kv-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--text-xs); border: 1px solid var(--color-border-default); }
/* eslint-disable-next-line local/no-hardcoded-px -- hairline: header divider (1 device pixel) */
.dld-kv-head-row { border-bottom: 1px solid var(--color-border-default); }
.dld-kv-head { padding: 0.35rem 0.5rem; text-align: left; font-weight: 600; color: var(--color-text-secondary); background: var(--color-surface-subtle); }
.dld-kv-head--key { padding-left: 1rem; width: 38%; }
/* eslint-disable-next-line local/no-hardcoded-px -- hairline: row divider (1 device pixel) */
.dld-kv-row { border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 50%, transparent); }
.dld-kv-row:hover { background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent); }
.dld-kv-row--highlight { background: color-mix(in srgb, var(--color-accent) 7%, transparent); }
.dld-kv-row--highlight:hover { background: color-mix(in srgb, var(--color-accent) 13%, transparent); }
/* Key colour from the global `.log-key` class; values coloured by LogsHighLighting. */
/* eslint-disable-next-line local/no-hardcoded-px -- hairline: column divider (1 device pixel) */
.dld-kv-key { padding: 0.35rem 0.5rem 0.35rem 1rem; font-family: var(--font-mono); font-weight: normal; white-space: nowrap; width: 38%; vertical-align: top; border-right: 1px solid color-mix(in srgb, var(--color-border-default) 50%, transparent); }
.dld-kv-val { padding: 0.35rem 0.5rem; vertical-align: top; max-width: 0; }
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
