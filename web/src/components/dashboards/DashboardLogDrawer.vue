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
const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);
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
  endTime: number; // microseconds
  baseWhere?: string; // panel's own WHERE, AND-combined with the clicked cell
}>();

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const SQL_IDENT = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const paramsValid = computed(() => SQL_IDENT.test(props.field) && SQL_IDENT.test(props.stream));

// Editable time range (µs); searches read these refs, not the fixed props.
const rangeStart = ref(props.startTime);
const rangeEnd = ref(props.endTime);
watch(
  () => [props.startTime, props.endTime],
  () => {
    rangeStart.value = props.startTime;
    rangeEnd.value = props.endTime;
  },
);
let dateReady = false;
const onDateChange = (d: { startTime: number; endTime: number }) => {
  if (!dateReady) return;
  const s = Number.isFinite(d.startTime) ? Math.trunc(d.startTime) : rangeStart.value;
  const e = Number.isFinite(d.endTime) ? Math.trunc(d.endTime) : rangeEnd.value;
  if (s === rangeStart.value && e === rangeEnd.value) return;
  rangeStart.value = s;
  rangeEnd.value = e;
  loadEvents();
};

// ── Search state ──────────────────────────────────────────────────────────────
const events = ref<any[]>([]);
const total = ref(0);
const page = ref(0);
const pageSize = ref(100);
const loading = ref(false);
const errorMsg = ref("");

const cols = computed((): string[] => {
  if (!events.value.length) return [];
  const keys = Object.keys(events.value[0]);
  return [
    ...keys.filter((k) => k === "_timestamp"),
    ...keys.filter((k) => k !== "_timestamp" && !k.startsWith("_")),
  ];
});
// OTable column defs for the results grid (same table component as the alert list).
const resultColumns = computed<OTableColumnDef[]>(() =>
  (cols.value.length ? cols.value : ["_timestamp", "source"]).map((c) => ({
    id: c,
    header: c === "_timestamp" ? t("panel.logExplorer.timestamp") : raw(c),
    accessorKey: c,
  })),
);
const resultPageSizeOptions = [50, 100, 250, 500];

// ── SQL editor ────────────────────────────────────────────────────────────────
const customSql = ref("");
const showSql = ref(false); // query editor is collapsed until the SQL toggle

function escSql(v: string | number): string {
  return String(v).replace(/'/g, "''");
}
// Clicked cell predicate: IS NULL for empty, unquoted for numbers, escaped-quote otherwise.
function cellWhere(): string {
  const v = props.value;
  if (v === null || v === undefined || v === "") return `${props.field} IS NULL`;
  if (typeof v === "number") return `${props.field} = ${v}`;
  return `${props.field} = '${escSql(v)}'`;
}
// Cell predicate AND-combined with the panel's own filter to match its scoped data.
function effectiveWhere(): string {
  const cell = cellWhere();
  return props.baseWhere ? `(${props.baseWhere}) AND ${cell}` : cell;
}
function buildDefaultSql(): string {
  return `SELECT * FROM "${props.stream}" WHERE ${effectiveWhere()} ORDER BY _timestamp DESC`;
}
function activeSql() {
  return customSql.value || buildDefaultSql();
}

// ── Event detail drawer ───────────────────────────────────────────────────────
const selectedEvent = ref<Record<string, any> | null>(null);
const detailOpen = computed(() => !!selectedEvent.value);
const detailTab = ref("insights");

// ── Insights state (loaded when detail drawer opens) ──────────────────────────
const insightsLoading = ref(false);
const timeline = ref<{ keyMs: number; num: number }[]>([]);

// Field Anomaly Profile table: rarity column carries chip + bar, value column the sample.
const anomalyColumns = computed<OTableColumnDef[]>(() => [
  // Auto-size to the field name so long keys aren't truncated at a fixed width.
  {
    id: "fld",
    header: t("panel.logExplorer.insights.colField"),
    accessorKey: "fld",
    meta: { autoWidth: true },
  },
  {
    id: "rarity",
    header: t("panel.logExplorer.insights.colRarity"),
    accessorKey: "rarity",
    size: 120,
    minSize: 120,
  },
  // Content-sized value column: long values overflow into the table's horizontal scroll.
  {
    id: "sv",
    header: t("panel.logExplorer.insights.colValue"),
    accessorKey: "sv",
    meta: { autoWidth: true },
  },
]);
const insightPatterns = ref<any[]>([]);
const surroundEvents = ref<any[]>([]);
const surroundMinutes = ref(3);
const surroundLoading = ref(false);
const surroundPage = ref(0);
const surroundPageSize = ref(20);
const surroundExpandedIdx = ref(new Set<number>());

const surroundWindowOptions = [
  { label: raw("±1 min"), value: 1 },
  { label: raw("±2 min"), value: 2 },
  { label: raw("±3 min"), value: 3 },
  { label: raw("±5 min"), value: 5 },
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
      const cnt = events.value.filter((e) => String(e[fld] ?? "—") === sv).length;
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
  const accent = readVar("--color-accent", "#7c6cf6");
  const axisText = readVar("--color-text-secondary", "#9ca3af");
  const axisLine = readVar("--color-border-default", "#e5e7eb");

  const times = timeline.value.map((b) => b.keyMs);
  const counts = timeline.value.map((b) => b.num);

  // Nearest bucket to the selected event → dashed marker line.
  const evMs = Number(selectedEvent.value?._timestamp ?? 0) / 1000;
  let markerIdx = -1;
  if (evMs > 0 && times.length) {
    let best = Infinity;
    times.forEach((tMs, i) => {
      const d = Math.abs(tMs - evMs);
      if (d < best) {
        best = d;
        markerIdx = i;
      }
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
        markLine:
          markerIdx >= 0
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
const surroundTotalPages = computed(() =>
  Math.max(1, Math.ceil(surroundEvents.value.length / surroundPageSize.value)),
);
const surroundPagedEvents = computed(() =>
  surroundEvents.value.slice(
    surroundPage.value * surroundPageSize.value,
    (surroundPage.value + 1) * surroundPageSize.value,
  ),
);
function getTimeBucket(): string {
  const rangeMs = (rangeEnd.value - rangeStart.value) / 1_000;
  if (rangeMs < 30 * 60_000) return "1 minute";
  if (rangeMs < 3 * 3_600_000) return "5 minute";
  if (rangeMs < 12 * 3_600_000) return "15 minute";
  if (rangeMs < 3 * 86_400_000) return "1 hour";
  return "6 hour";
}

async function loadSurrounding(ev: Record<string, any>) {
  const ts = Number(ev._timestamp ?? 0);
  if (!ts) return;
  const win = surroundMinutes.value * 60 * 1_000_000;
  surroundLoading.value = true;
  surroundPage.value = 0;
  surroundExpandedIdx.value = new Set();
  try {
    const res = await searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: {
            sql: `SELECT * FROM "${props.stream}" ORDER BY _timestamp ASC`,
            start_time: ts - win,
            end_time: ts + win,
            from: 0,
            size: 200,
          },
        },
        page_type: props.streamType ?? "logs",
      },
      "ui",
    );
    surroundEvents.value = res.data?.hits ?? [];
    // Jump to the page containing the selected event
    const idx = surroundEvents.value.findIndex((e) => String(e._timestamp) === String(ts));
    if (idx >= 0) surroundPage.value = Math.floor(idx / surroundPageSize.value);
  } catch {
    surroundEvents.value = [];
  }
  surroundLoading.value = false;
}

async function loadInsights(ev: Record<string, any>) {
  insightsLoading.value = true;
  timeline.value = [];
  insightPatterns.value = [];
  surroundEvents.value = [];

  const intv = getTimeBucket();
  const where = effectiveWhere();

  const [histR, patR] = await Promise.allSettled([
    // 1. Histogram — event count per time bucket over full range
    searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: {
            sql: `SELECT histogram(_timestamp, '${intv}') AS zo_key, COUNT(*) AS zo_cnt FROM "${props.stream}" WHERE ${where} GROUP BY zo_key ORDER BY zo_key`,
            start_time: rangeStart.value,
            end_time: rangeEnd.value,
            from: 0,
            size: 500,
          },
        },
        page_type: props.streamType ?? "logs",
      },
      "ui",
    ),

    // 2. Log patterns — cluster similar log lines
    patternsService.extractPatterns({
      org_identifier: orgId.value,
      stream_name: props.stream,
      query: {
        query: {
          sql: `SELECT * FROM "${props.stream}" WHERE ${where}`,
          start_time: rangeStart.value,
          end_time: rangeEnd.value,
          from: 0,
          size: 1000,
        },
      },
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
      count: p.frequency ?? p.count ?? 0,
      pct: Math.round(p.percentage ?? 0),
      z_score: p.z_score ?? 0,
      sample: p.examples?.[0]?.log ?? p.sample_logs?.[0] ?? "",
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
    ([k, v]) =>
      k.toLowerCase().includes(q) ||
      String(v ?? "")
        .toLowerCase()
        .includes(q),
  );
});
// Name/Value grid rendered with OTable (same component as the other tables).
const detailTableRows = computed(() => detailRows.value.map(([name, value]) => ({ name, value })));
const detailColumns = computed<OTableColumnDef[]>(() => [
  { id: "name", header: t("search.sourceName"), accessorKey: "name", size: 220 },
  {
    id: "value",
    header: t("search.sourceValue"),
    accessorKey: "value",
    meta: { autoWidth: true, fillRemaining: true },
  },
]);

// JsonPreview's @copy emits an object; stringify non-strings as pretty JSON.
function copyToClipboard(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  navigator.clipboard
    .writeText(text)
    .then(() => toast({ variant: "success", message: t("common.copiedToClipboard") }))
    .catch(() => {
      /* best-effort */
    });
}
function copyCurrentUrl() {
  copyToClipboard(window.location.href);
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtTs(ts: unknown): string {
  if (!ts) return "—";
  const raw = Number(ts);
  const ms = raw > 1e13 ? raw / 1000 : raw;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtTsShort(ts: unknown): string {
  if (!ts) return "—";
  const raw = Number(ts);
  const ms = raw > 1e13 ? raw / 1000 : raw;
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtRelTime(tsMicros: number, refMicros: number): string {
  const diffMs = (tsMicros - refMicros) / 1_000;
  if (Math.abs(diffMs) < 500) return "now";
  const sign = diffMs >= 0 ? "+" : "−";
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return `${sign}${Math.floor(abs / 1_000)}s`;
  // Use floor for both m and s to avoid "2m 60s" from rounding up
  const m = Math.floor(abs / 60_000);
  const s = Math.floor((abs % 60_000) / 1_000);
  return s === 0 ? `${sign}${m}m` : `${sign}${m}m ${s}s`;
}

// ── Search ────────────────────────────────────────────────────────────────────
async function runSql(sql: string, fromOffset: number) {
  if (!orgId.value || !props.stream) {
    errorMsg.value = props.stream ? "" : `Stream not resolved (field: ${props.field})`;
    return;
  }
  if (!paramsValid.value) {
    errorMsg.value = t("panel.logExplorer.invalidParams");
    events.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    const res = await searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: {
            sql,
            start_time: rangeStart.value,
            end_time: rangeEnd.value,
            from: fromOffset,
            size: pageSize.value,
          },
        },
        page_type: props.streamType ?? "logs",
      },
      "ui",
    );
    events.value = res.data?.hits ?? [];
    total.value = res.data?.total ?? events.value.length;
  } catch (e: any) {
    errorMsg.value = `${e?.response?.data?.error ?? e?.message ?? "Search failed"}\n\n${sql}`;
    events.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

async function loadEvents() {
  page.value = 0;
  const sql = buildDefaultSql();
  customSql.value = sql;
  await runSql(sql, 0);
}
async function runQuery() {
  page.value = 0;
  await runSql(activeSql(), 0);
}
async function goToPage(p: number) {
  page.value = p;
  await runSql(activeSql(), p * pageSize.value);
}

// Restore the detail drawer from URL param via a 1-row fetch by exact _timestamp.
async function restoreEventDetail() {
  if (selectedEvent.value || !paramsValid.value) return;
  const rawTs = String(route.query.cell_event_ts ?? "");
  if (!/^\d{1,20}$/.test(rawTs)) return;
  const ts = Number(rawTs);
  try {
    const res = await searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: {
            sql: `SELECT * FROM "${props.stream}" WHERE _timestamp = ${ts}`,
            start_time: rangeStart.value,
            end_time: rangeEnd.value,
            from: 0,
            size: 1,
          },
        },
        page_type: props.streamType ?? "logs",
      },
      "ui",
    );
    const found = res.data?.hits?.[0];
    if (found) {
      selectedEvent.value = found;
      detailTab.value = "insights";
      loadInsights(found);
    }
  } catch {
    /* best-effort */
  }
}

watch(pageSize, () => goToPage(0));
onMounted(async () => {
  dateReady = true;
  await loadEvents();
  await restoreEventDetail();
});
watch(
  () => [props.field, props.value, props.stream],
  () => {
    selectedEvent.value = null;
    loadEvents();
  },
);
watch(surroundMinutes, () => {
  surroundPage.value = 0;
  if (selectedEvent.value) loadSurrounding(selectedEvent.value);
});

function toggleSurroundExpand(globalIdx: number) {
  const next = new Set(surroundExpandedIdx.value);
  if (next.has(globalIdx)) next.delete(globalIdx);
  else next.add(globalIdx);
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
  const pos = window.location.pathname.indexOf("/web/");
  const base =
    pos > -1
      ? window.location.origin + window.location.pathname.slice(0, pos) + "/web"
      : window.location.origin;
  const url = new URL(`${base}/logs`);
  url.searchParams.set("org_identifier", orgId.value);
  url.searchParams.set("stream_type", props.streamType ?? "logs");
  url.searchParams.set("stream", props.stream);
  url.searchParams.set("from", String(rangeStart.value));
  url.searchParams.set("to", String(rangeEnd.value));
  url.searchParams.set("query", b64EncodeUnicode(patternToSql(template)) ?? "");
  url.searchParams.set("sql_mode", "true");
  url.searchParams.set("quick_mode", "false");
  url.searchParams.set("show_histogram", "true");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function openInLogs() {
  const pos = window.location.pathname.indexOf("/web/");
  const base =
    pos > -1
      ? window.location.origin + window.location.pathname.slice(0, pos) + "/web"
      : window.location.origin;
  const url = new URL(`${base}/logs`);
  url.searchParams.set("org_identifier", orgId.value);
  url.searchParams.set("stream_type", props.streamType ?? "logs");
  url.searchParams.set("stream", props.stream);
  url.searchParams.set("from", String(rangeStart.value));
  url.searchParams.set("to", String(rangeEnd.value));
  url.searchParams.set("query", b64EncodeUnicode(activeSql()) ?? "");
  url.searchParams.set("sql_mode", "true");
  url.searchParams.set("quick_mode", "false");
  url.searchParams.set("show_histogram", "false");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <!-- ── Toolbar: datetime picker + open-in-logs + run ───── -->
    <div class="border-border-default flex min-w-0 shrink-0 flex-col border-b">
      <div class="flex min-w-0 items-center gap-2 px-2 pt-3 pb-2">
        <div class="flex-1" />
        <DateTime
          default-type="absolute"
          :default-absolute-time="{ startTime: rangeStart, endTime: rangeEnd }"
          data-test-name="dashboard-log-drawer-date-time"
          @on:date-change="onDateChange"
        />
        <OButton
          size="sm"
          :variant="showSql ? 'primary' : 'outline'"
          icon-left="code"
          data-test="log-explorer-sql-toggle"
          @click="showSql = !showSql"
        >
          {{ t("panel.logExplorer.queryMode") }}
        </OButton>
        <OButton
          size="sm"
          variant="outline"
          icon-left="open-in-new"
          data-test="log-explorer-open-in-logs"
          @click="openInLogs"
        >
          {{ t("panel.logExplorer.openInLogs") }}
        </OButton>
        <OButton
          size="icon-sm"
          variant="outline"
          icon-left="refresh"
          :loading="loading"
          data-test="log-explorer-run"
          @click="runQuery"
        >
          <OTooltip :content="t('panel.logExplorer.runQuery')" />
        </OButton>
      </div>
      <div v-if="showSql" class="px-2 pb-2">
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
    <div v-if="errorMsg" class="flex shrink-0 items-start gap-2 px-4 py-3">
      <OIcon name="error-outline" size="sm" class="text-error-500 mt-0.5 shrink-0" />
      <code class="text-error-500 font-mono text-xs break-all whitespace-pre-wrap">{{
        errorMsg
      }}</code>
    </div>

    <!-- ── Results — same OTable as the alert list (sticky header, loading
         skeleton, server pagination); no hand-rolled table/header gap ── -->
    <OTable
      v-else
      class="min-h-0 flex-1"
      :frame="false"
      :data="events"
      :columns="resultColumns"
      :loading="loading"
      :horizontal-scroll="true"
      :row-class="(row: any) => (selectedEvent === row ? 'dld-row--active' : '')"
      pagination="server"
      :current-page="page + 1"
      :total-count="total"
      :page-size="pageSize"
      :page-size-options="resultPageSizeOptions"
      width="100%"
      :show-global-filter="false"
      :default-columns="false"
      data-test="log-explorer-results-table"
      @update:current-page="(p: number) => goToPage(p - 1)"
      @update:page-size="(n: number) => (pageSize = n)"
      @row-click="(row: any) => openEventDetail(row)"
    >
      <template #cell-_timestamp="{ value }">{{ fmtTs(value) }}</template>
      <template #empty>
        <div class="flex flex-col items-center justify-center gap-4 px-6 py-10">
          <OIcon name="manage-search" size="xl" class="text-text-secondary opacity-30" />
          <span class="text-text-secondary text-sm">{{ t("panel.logExplorer.noEvents") }}</span>
          <code
            class="text-text-secondary bg-surface-subtle rounded-default max-w-full overflow-x-auto px-3 py-2 text-center font-mono text-xs break-all whitespace-pre-wrap"
            >{{ customSql }}</code
          >
        </div>
      </template>
    </OTable>

    <!-- ── Event detail drawer ─────────────────────────────────────── -->
    <ODrawer
      :open="detailOpen"
      side="right"
      :width="55"
      bleed
      :title="t('panel.logExplorer.detail.drawerTitle')"
      data-test="log-explorer-event-detail-drawer"
      @update:open="
        (v) => {
          if (!v) closeEventDetail();
        }
      "
    >
      <div v-if="selectedEvent" class="flex h-full min-h-0 flex-col">
        <!-- Event meta strip -->
        <div
          class="border-border-default bg-surface-panel flex shrink-0 items-center gap-3 border-b px-2 py-2"
        >
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-text-heading text-xs font-medium tabular-nums">{{
              fmtTs(selectedEvent["_timestamp"])
            }}</span>
            <span class="text-text-secondary text-xs">{{ stream }}</span>
          </div>
          <OButton size="sm" variant="outline" icon-left="link" @click="copyCurrentUrl()">
            {{ t("panel.logExplorer.detail.copyLink") }}
          </OButton>
        </div>

        <!-- Tabs -->
        <OTabs v-model="detailTab" dense bordered class="mb-2 shrink-0 px-2">
          <OTab name="insights" :label="t('panel.logExplorer.detail.insights')" icon="insights" />
          <OTab name="details" :label="t('panel.logExplorer.detail.details')" />
          <OTab name="json" :label="t('panel.logExplorer.detail.json')" />
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
                <span class="dld-section-hint">{{
                  t("panel.logExplorer.insights.anomalyHint", { n: events.length })
                }}</span>
              </header>
              <div class="pb-3">
                <OTable
                  :data="fieldAnomalyProfile"
                  :columns="anomalyColumns"
                  :default-columns="false"
                  :show-global-filter="false"
                  :bordered="true"
                  :frame="false"
                  pagination="none"
                  sorting="none"
                  :horizontal-scroll="true"
                  :wrap="false"
                >
                  <!-- Field name -->
                  <template #cell-fld="{ value }">
                    <span class="text-text-body truncate"
                      >{{ value }}<OTooltip :content="raw(String(value))"
                    /></span>
                  </template>
                  <!-- Rarity chip + magnitude bar -->
                  <template #cell-rarity="{ row }">
                    <div class="flex flex-col gap-1 py-1">
                      <OTag type="fieldRarity" :value="row.rarity" class="self-start">
                        {{ t(`panel.logExplorer.insights.rarity.${row.rarity}`) }} {{ row.pct }}%
                      </OTag>
                      <div class="bg-surface-subtle h-1 w-full overflow-hidden rounded-full">
                        <div
                          :class="[
                            'h-full rounded-full opacity-80',
                            row.rarity === 'anomalous' || row.rarity === 'rare'
                              ? 'bg-error-500'
                              : 'bg-accent',
                          ]"
                          :style="`width:${row.pct}%`"
                        />
                      </div>
                    </div>
                  </template>
                  <!-- Sampled value -->
                  <template #cell-sv="{ value }">
                    <span class="text-text-secondary truncate"
                      >{{ value }}<OTooltip :content="raw(String(value))" max-width="22.5rem"
                    /></span>
                  </template>
                </OTable>
              </div>
            </section>

            <!-- ② Event Timeline (SVG histogram — API call) -->
            <section class="dld-section">
              <header class="dld-section-header">
                <OIcon name="bar-chart" size="xs" class="text-accent shrink-0" />
                <span>{{ t("panel.logExplorer.insights.timelineTitle") }}</span>
                <span class="dld-section-hint">{{
                  t("panel.logExplorer.insights.timelineHint")
                }}</span>
              </header>
              <div class="px-2 pb-3">
                <!-- Skeleton while loading -->
                <div
                  v-if="insightsLoading && !timeline.length"
                  class="rounded-default bg-surface-subtle h-14 animate-pulse"
                />
                <div v-else-if="!timeline.length" class="flex h-14 items-center justify-center">
                  <span class="text-text-secondary text-xs">{{
                    t("panel.logExplorer.insights.timelineEmpty")
                  }}</span>
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
                <span class="dld-section-hint">{{
                  t("panel.logExplorer.insights.patternsHint")
                }}</span>
              </header>
              <div class="divide-border-default flex flex-col divide-y">
                <div
                  v-if="insightsLoading && !insightPatterns.length"
                  class="flex flex-col gap-2 px-2 py-3"
                >
                  <div
                    v-for="n in 3"
                    :key="n"
                    class="rounded-default bg-surface-subtle h-6 animate-pulse"
                  />
                </div>
                <div v-else-if="!insightPatterns.length" class="px-2 py-3">
                  <span class="text-text-secondary text-xs">{{
                    t("panel.logExplorer.insights.patternsEmpty")
                  }}</span>
                </div>
                <template v-else>
                  <div
                    v-for="p in insightPatterns"
                    :key="p.template"
                    class="dld-pat-row flex flex-col gap-1 px-2 py-2 transition-colors"
                  >
                    <div class="flex items-center gap-2">
                      <!-- Anomaly badge if z_score is high -->
                      <OTag
                        v-if="p.z_score > 2"
                        type="fieldRarity"
                        :value="p.z_score > 3 ? 'anomalous' : 'rare'"
                        class="shrink-0"
                      >
                        {{
                          t("panel.logExplorer.insights.zScore", { value: p.z_score.toFixed(1) })
                        }}
                      </OTag>
                      <span
                        class="text-text-heading shrink-0 text-xs font-medium whitespace-nowrap tabular-nums"
                        >{{ p.pct }}%</span
                      >
                      <!-- Pattern template with wildcards -->
                      <code class="text-text-secondary flex-1 truncate font-mono text-xs"
                        >{{ p.template }}<OTooltip :content="raw(p.template)" max-width="22.5rem"
                      /></code>
                      <!-- Open in Logs -->
                      <OButton
                        size="sm"
                        variant="ghost"
                        icon-left="open-in-new"
                        class="shrink-0"
                        data-test="log-explorer-pattern-open"
                        @click.stop="openPatternInLogs(p.template)"
                      />
                    </div>
                    <!-- Mini frequency bar -->
                    <div class="bg-surface-subtle h-1 overflow-hidden rounded-full">
                      <div
                        class="bg-accent h-full rounded-full opacity-80"
                        :style="`width:${Math.min(p.pct, 100)}%`"
                      />
                    </div>
                    <!-- Sample log line -->
                    <p
                      v-if="p.sample"
                      class="text-text-secondary truncate font-mono text-xs leading-snug"
                    >
                      {{ p.sample }}<OTooltip :content="raw(p.sample)" max-width="22.5rem" />
                    </p>
                  </div>
                </template>
              </div>
            </section>

            <!-- ④ Surrounding Events -->
            <section class="dld-section">
              <header class="dld-section-header">
                <OIcon name="timeline" size="xs" class="text-accent shrink-0" />
                <span>{{ t("panel.logExplorer.insights.contextTitle") }}</span>
                <OTooltip
                  :content="t('panel.logExplorer.insights.contextTooltip')"
                  side="bottom"
                  max-width="17.5rem"
                >
                  <OIcon name="info-outline" size="xs" class="text-text-secondary cursor-help" />
                </OTooltip>
                <div class="ml-auto shrink-0">
                  <ODropdown side="bottom" align="end">
                    <template #trigger>
                      <OButton
                        size="sm"
                        variant="outline"
                        icon-right="arrow-drop-down"
                        data-test="log-explorer-surround-window"
                      >
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
                <div
                  v-if="(insightsLoading || surroundLoading) && !surroundEvents.length"
                  class="flex flex-col gap-2 px-2 py-3"
                >
                  <div
                    v-for="n in 5"
                    :key="n"
                    class="rounded-default bg-surface-subtle h-7 animate-pulse"
                  />
                </div>
                <div v-else-if="!surroundEvents.length" class="px-2 py-3">
                  <span class="text-text-secondary text-xs">{{
                    t("panel.logExplorer.insights.contextEmpty")
                  }}</span>
                </div>
                <template v-else>
                  <div
                    v-for="(ev, i) in surroundPagedEvents"
                    :key="i"
                    :class="[
                      'dld-ctx-row cursor-pointer',
                      String(ev._timestamp) === String(selectedEvent!._timestamp) &&
                        'dld-ctx-row--current',
                      isSurroundExpanded(i) && 'dld-ctx-row--expanded',
                    ]"
                    @click="toggleSurroundExpand(surroundPage * surroundPageSize + i)"
                  >
                    <!-- Timeline spine: line above + dot (centered) + line below -->
                    <div class="dld-ctx-spine">
                      <div class="dld-ctx-line" :class="{ invisible: i === 0 }" />
                      <div
                        :class="[
                          'dld-ctx-dot rounded-full',
                          String(ev._timestamp) === String(selectedEvent!._timestamp) &&
                            'dld-ctx-dot--current ring-accent/25 ring-2',
                        ]"
                      />
                      <div
                        class="dld-ctx-line"
                        :class="{ invisible: i === surroundPagedEvents.length - 1 }"
                      />
                    </div>
                    <!-- Content -->
                    <div class="flex min-w-0 flex-1 flex-col py-2 pr-2">
                      <!-- Row: rel time + timestamp + body preview (like the Logs page) + expand -->
                      <div class="flex items-center gap-2">
                        <span
                          :class="[
                            'w-16 shrink-0 text-xs whitespace-nowrap tabular-nums',
                            String(ev._timestamp) === String(selectedEvent!._timestamp)
                              ? 'text-accent font-semibold'
                              : 'text-text-secondary',
                          ]"
                        >
                          {{ fmtRelTime(Number(ev._timestamp), Number(selectedEvent!._timestamp)) }}
                        </span>
                        <span
                          class="text-text-secondary shrink-0 text-xs whitespace-nowrap tabular-nums"
                          >{{ fmtTsShort(ev._timestamp) }}</span
                        >
                        <span class="dld-ctx-body min-w-0 flex-1 truncate font-mono text-xs">
                          <LogsHighLighting :data="ev" :show-braces="true" />
                        </span>
                        <button
                          class="dld-expand-btn shrink-0"
                          :aria-label="
                            isSurroundExpanded(i) ? t('common.collapse') : t('common.expand')
                          "
                          @click.stop="toggleSurroundExpand(surroundPage * surroundPageSize + i)"
                        >
                          <OIcon
                            :name="isSurroundExpanded(i) ? 'expand-less' : 'expand-more'"
                            size="xs"
                          />
                        </button>
                      </div>

                      <!-- Expanded: full log detail, same as the Logs page -->
                      <div
                        v-if="isSurroundExpanded(i)"
                        class="dld-json-preview border-border-default mt-1 border-t pt-1"
                        @click.stop
                      >
                        <JsonPreview
                          :value="ev"
                          mode="sidebar"
                          :stream-name="stream"
                          :show-copy-button="true"
                          hide-view-related
                          hide-search-term-actions
                          hide-field-options
                          @copy="copyToClipboard"
                        />
                      </div>
                    </div>
                  </div>
                  <div
                    v-if="surroundEvents.length"
                    class="bg-dialog-bg border-border-default sticky bottom-0 z-10 flex w-full items-center border-t px-3 py-2"
                  >
                    <div class="flex-1" />
                    <TablePaginationControls
                      :show-pagination="true"
                      :pagination="{ page: surroundPage + 1, rowsPerPage: surroundPageSize }"
                      :total-rows="surroundEvents.length"
                      :pages-number="surroundTotalPages"
                      :is-first-page="surroundPage === 0"
                      :is-last-page="surroundPage >= surroundTotalPages - 1"
                      @update:rows-per-page="
                        (n) => {
                          surroundPageSize = n;
                          surroundPage = 0;
                        }
                      "
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
            <div class="mb-2 flex items-center gap-2 px-2">
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
            <OTable
              :data="detailTableRows"
              :columns="detailColumns"
              :default-columns="false"
              :show-global-filter="false"
              :bordered="true"
              :frame="false"
              pagination="none"
              sorting="none"
              :wrap="wrapDetailValues"
              :row-class="(row: any) => (row.name === field ? 'dld-kv-row--highlight' : '')"
            >
              <template #cell-name="{ value }">
                <span class="log-key font-mono">{{ value }}</span>
              </template>
              <template #cell-value="{ row }">
                <pre
                  class="m-0 block w-full min-w-0 p-0 font-mono font-normal"
                  :class="
                    wrapDetailValues
                      ? 'break-all whitespace-pre-wrap'
                      : 'overflow-hidden text-ellipsis whitespace-nowrap'
                  "
                ><LogsHighLighting :data="getDetailDisplayValue(row.name, row.value)" :show-braces="false" /></pre>
              </template>
            </OTable>
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
.dld-json-preview {
  overflow-x: hidden;
  max-width: 100%;
}
.dld-json-preview :deep(.log_json_content) {
  padding-block: 0.1875rem;
}
/* Long values (base64 blobs etc.) must wrap, not force a horizontal scroll. */
.dld-json-preview :deep(.log_json_content),
.dld-json-preview :deep(.log_json_content *) {
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}
/* ── Loading bar ──────────────────────────────────────────────────────────── */
.dld-progress {
  position: sticky;
  top: 0;
  height: 0.125rem;
  z-index: 10;
  background: color-mix(in srgb, var(--color-accent) 70%, transparent);
  animation: dld-bar-anim 1.2s ease-in-out infinite;
  transform-origin: left;
}
@keyframes dld-bar-anim {
  0% {
    transform: scaleX(0.05);
  }
  60% {
    transform: scaleX(0.85);
  }
  100% {
    transform: scaleX(1);
  }
}

/* ── SQL editor ──────────────────────────────────────────────────────────── */
.dld-editor {
  background: color-mix(in srgb, var(--color-surface-base) 100%, transparent);
}
.dld-editor__dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  background: color-mix(in srgb, var(--color-border-default) 80%, transparent);
}
.dld-editor__body :deep([class*="wrapper"]),
.dld-editor__body :deep([class*="o-textarea"]) {
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}
.dld-editor__body :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.7;
  padding: 0.75rem 1rem;
  background: color-mix(in srgb, var(--color-surface-subtle) 50%, transparent);
  color: color-mix(in srgb, var(--color-text-body) 100%, transparent);
  border-left: 0.1875rem solid color-mix(in srgb, var(--color-accent) 50%, transparent);
  resize: none;
  width: 100%;
}
.dld-editor__body :deep(textarea:focus) {
  border-left-color: color-mix(in srgb, var(--color-accent) 90%, transparent);
  outline: none;
}

/* Active results row (selected event) — applied to OTable's row via :row-class. */
.dld-row--active {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
}
.dld-row--active:hover {
  background: color-mix(in srgb, var(--color-accent) 13%, transparent);
}

/* ── Insight sections ────────────────────────────────────────────────────── */
.dld-section {
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: section divider (1 device pixel) */
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 100%, transparent);
  padding-bottom: 0.5rem;
}
.dld-section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.dld-section-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 1.25rem 0.5rem 0.875rem;
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0;
  color: color-mix(in srgb, var(--color-text-body) 100%, transparent);
}
/* Render the leading section OIcon as a small accent chip. */
.dld-section-header > :first-child {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  flex: none;
  border-radius: 0.3125rem;
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}
.dld-section-header :deep(svg) {
  color: var(--color-accent);
  width: 0.75rem;
  height: 0.75rem;
}
.dld-section-hint {
  font-weight: 400;
  letter-spacing: 0;
  font-size: var(--text-2xs);
  color: color-mix(in srgb, var(--color-text-secondary) 100%, transparent);
  margin-left: auto;
}

/* ── Temporal context timeline ───────────────────────────────────────────── */
.dld-ctx-row {
  display: flex;
  align-items: stretch;
  gap: 0;
  min-width: 0;
  transition: background 80ms;
}
.dld-ctx-row:hover {
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
}
.dld-pat-row:hover {
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
}
.dld-ctx-row--current {
  background: color-mix(in srgb, var(--color-accent) 5%, transparent);
}
.dld-ctx-row--current:hover {
  background: color-mix(in srgb, var(--color-accent) 9%, transparent);
}
/* No hover highlight once a row is expanded — the JSON body isn't a click target. */
.dld-ctx-row--expanded:hover {
  background: transparent;
}
/* A selected + expanded row keeps its base selection tint, just no hover boost. */
.dld-ctx-row--expanded.dld-ctx-row--current:hover {
  background: color-mix(in srgb, var(--color-accent) 5%, transparent);
}

.dld-ctx-spine {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 2.5rem;
  flex-shrink: 0;
}
.dld-ctx-dot {
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--color-border-default) 100%, transparent);
}
.dld-ctx-dot--current {
  background: color-mix(in srgb, var(--color-accent) 90%, transparent);
}
.dld-ctx-line {
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: 1px vertical connector line */
  width: 1px;
  flex: 1;
  min-height: 0.25rem;
  background: color-mix(in srgb, var(--color-border-default) 60%, transparent);
}

/* ── Event detail KV table (OTable) — selected-field row highlight ────────── */
.dld-kv-row--highlight {
  background: color-mix(in srgb, var(--color-accent) 7%, transparent);
}
.dld-kv-row--highlight:hover {
  background: color-mix(in srgb, var(--color-accent) 13%, transparent);
}
.dld-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: 0.25rem;
  border: none;
  background: transparent;
  cursor: pointer;
  color: color-mix(in srgb, var(--color-text-secondary) 100%, transparent);
  transition:
    color 100ms,
    background 100ms;
}
.dld-copy-btn:hover {
  color: color-mix(in srgb, var(--color-text-body) 100%, transparent);
  background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent);
}

/* ── Surrounding events expand button ───────────────────────────────────── */
.dld-expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem;
  border-radius: 0.25rem;
  border: none;
  background: transparent;
  cursor: pointer;
  color: color-mix(in srgb, var(--color-text-secondary) 100%, transparent);
  transition:
    color 100ms,
    background 100ms;
}
.dld-expand-btn:hover {
  color: color-mix(in srgb, var(--color-text-body) 100%, transparent);
  background: color-mix(in srgb, var(--color-surface-subtle) 100%, transparent);
}

/* ── JSON view ───────────────────────────────────────────────────────────── */
.dld-json {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1.6;
  padding: 3rem 1rem 0.75rem;
  white-space: pre-wrap;
  word-break: break-all;
  color: color-mix(in srgb, var(--color-text-body) 100%, transparent);
  margin: 0;
}
</style>
