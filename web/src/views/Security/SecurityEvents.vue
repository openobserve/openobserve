<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Security Events — hunt one stream at a time, normalised onto OCSF; every value is a
     pivot, and the URL carries the whole view. -->
<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";
import DateTime from "@/components/DateTime.vue";
import SecuritySeverityChart from "@/components/security/SecuritySeverityChart.vue";
import SecurityEventDrawer from "./SecurityEventDrawer.vue";
import streamService from "@/services/stream";
import searchService from "@/services/search";
import { bestMatch, isSecuritySource, type Classification } from "@/utils/security/classify";
import { normalizeEvents, populatedColumns, sourceColumnFor } from "@/utils/security/normalize";
import {
  NORMALIZED_COLUMNS,
  ocsfCategoryOf,
  toOcsfSeverity,
  type NormalizedEvent,
} from "@/utils/security/ocsf";
import { sigmaLogsourceLabel } from "@/utils/security/sourceTypes";
import { blockedReason, caveat } from "@/utils/security/sigma";
import { useSigmaRules } from "@/composables/security/useSigmaRules";
import {
  addToSqlWhere,
  eventKey,
  eventsSql,
  filterClause,
  foldHistogram,
  histogramInterval,
  histogramSql,
  topValuesSql,
  whereParts,
  type FieldFilter,
  type HistogramResult,
  type SeverityValue,
} from "@/utils/security/eventQuery";
import {
  SEVERITY_TONES,
  TONE_ICON,
  TONE_STAT,
  TONE_TOKEN,
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  toneOfSeverityId,
  toneOfSigmaLevel,
  type SeverityTone,
} from "@/utils/security/severity";
import {
  loadTaggedStreams,
  saveTaggedStreams,
  securityStreamNames,
  sourceHealth,
  type SourceHealth,
} from "@/utils/security/streams";
import { FieldIndex } from "@/utils/security/fields";
import { toast } from "@/lib/feedback/Toast/useToast";
import { displayOrder, positionOf, stepRow, type NavTable } from "@/utils/security/recordNav";
import { b64DecodeUnicodeSafe, b64EncodeUnicode, formatEventCount } from "@/utils/formatters";

const CodeQueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

// ── View state: the URL is the source of truth; localStorage restores a bare URL ──
interface DateState {
  type: "relative" | "absolute";
  period: string;
  absolute: { startTime: number; endTime: number } | null;
}
interface ViewState {
  stream: string | null;
  sqlMode: boolean;
  query: string;
  severity: SeverityValue[];
  filters: FieldFilter[];
  date: DateState;
  eventTs: string | null;
}

const URL_KEYS = [
  "stream",
  "period",
  "from",
  "to",
  "sql_mode",
  "query",
  "severity",
  "filters",
  "event_ts",
];
const EMPTY_DATE: DateState = { type: "relative", period: "15m", absolute: null };
const stateKey = () => `oo_sec_events_state_${orgId.value}`;
const colsKey = () => `oo_sec_events_cols_${orgId.value}`;
const prefsKey = () => `oo_sec_events_prefs_${orgId.value}`;

function parseFilters(raw: string): FieldFilter[] {
  try {
    const parsed = JSON.parse(raw.trim().startsWith("[") ? raw : b64DecodeUnicodeSafe(raw, "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f: any) => f?.field && f?.value != null)
      .map((f: any) => ({
        field: String(f.field),
        op: String(f.op ?? "="),
        value: String(f.value),
      }));
  } catch {
    return [];
  }
}

function stateFromUrl(): ViewState | null {
  const q = route.query as Record<string, any>;
  if (!URL_KEYS.some((k) => q[k] != null && q[k] !== "")) return null;
  return {
    stream: q.stream ? String(q.stream) : null,
    sqlMode: String(q.sql_mode) === "true",
    query: q.query ? b64DecodeUnicodeSafe(String(q.query), "") : "",
    severity: q.severity
      ? String(q.severity)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    filters: q.filters ? parseFilters(String(q.filters)) : [],
    date:
      q.from && q.to
        ? {
            type: "absolute",
            period: "",
            absolute: { startTime: Number(q.from), endTime: Number(q.to) },
          }
        : { type: "relative", period: String(q.period ?? "15m"), absolute: null },
    eventTs: q.event_ts ? String(q.event_ts) : null,
  };
}

function stateFromStorage(): ViewState | null {
  try {
    const raw = localStorage.getItem(stateKey());
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      stream: s.stream ?? null,
      sqlMode: !!s.sqlMode,
      query: s.query ?? "",
      severity: Array.isArray(s.severity) ? s.severity.map(String) : [],
      filters: Array.isArray(s.filters) ? s.filters : [],
      date: s.date?.type ? s.date : { ...EMPTY_DATE },
      eventTs: null,
    };
  } catch {
    return null;
  }
}

const initialState: ViewState = stateFromUrl() ??
  stateFromStorage() ?? {
    stream: null,
    sqlMode: false,
    query: "",
    severity: [],
    filters: [],
    date: { ...EMPTY_DATE },
    eventTs: null,
  };

const PERIOD_MICROS: Record<string, number> = {
  s: 1_000_000,
  m: 60_000_000,
  h: 3_600_000_000,
  d: 86_400_000_000,
  w: 604_800_000_000,
  M: 2_592_000_000_000,
};
function relativeToMicros(period: string): number {
  const m = period?.match(/^(\d+)\s*([smhdwM])$/);
  return m ? Number(m[1]) * (PERIOD_MICROS[m[2]] ?? PERIOD_MICROS.m) : 15 * 60 * 1_000_000;
}
function rangeFor(d: DateState) {
  if (d.type === "absolute" && d.absolute?.startTime && d.absolute?.endTime) {
    return { start: Number(d.absolute.startTime), end: Number(d.absolute.endTime) };
  }
  const end = Date.now() * 1000;
  return { start: end - relativeToMicros(d.period), end };
}

const dateState = ref<DateState>({ ...initialState.date });
const timeRange = ref(rangeFor(initialState.date));
// Bumped to remount the picker when the range is set from outside it (chart zoom).
const dateKey = ref(0);

// ── Preferences (per viewer) ─────────────────────────────────────────────────
function loadPrefs(): { timeline: boolean; raw: boolean; sidebar: number } {
  try {
    return {
      timeline: true,
      raw: false,
      sidebar: 260,
      ...JSON.parse(localStorage.getItem(prefsKey()) ?? "{}"),
    };
  } catch {
    return { timeline: true, raw: false, sidebar: 260 };
  }
}
const prefs = loadPrefs();
const showTimeline = ref<boolean>(prefs.timeline);
const showRaw = ref<boolean>(prefs.raw);
const sidebarWidth = ref<number>(prefs.sidebar || 260);
const lastSidebarWidth = ref<number>(sidebarWidth.value || 260);
watch([showTimeline, showRaw, sidebarWidth], () => {
  try {
    localStorage.setItem(
      prefsKey(),
      JSON.stringify({
        timeline: showTimeline.value,
        raw: showRaw.value,
        sidebar: sidebarWidth.value,
      }),
    );
  } catch {
    /* best-effort */
  }
});
function toggleSidebar() {
  if (sidebarWidth.value > 0) {
    lastSidebarWidth.value = sidebarWidth.value;
    sidebarWidth.value = 0;
  } else {
    sidebarWidth.value = lastSidebarWidth.value || 260;
  }
}

// ── Streams ──────────────────────────────────────────────────────────────────
const streamList = ref<any[]>([]);
const streamsLoading = ref(false);
const taggedStreams = ref<string[]>([]);
const selectedStream = ref<string | null>(null);

const allStreamNames = computed(() => streamList.value.map((s) => String(s.name)));
const secStreamNames = computed(() =>
  securityStreamNames(allStreamNames.value, taggedStreams.value),
);
const otherStreamNames = computed(() =>
  allStreamNames.value.filter((n) => !secStreamNames.value.includes(n)),
);
const streamStats = computed(() => new Map(streamList.value.map((s) => [String(s.name), s.stats])));

const streamOptions = computed(() => {
  const opts: { label: string; value: string; header?: boolean }[] = [];
  if (secStreamNames.value.length) {
    opts.push({ label: t("siem.events.securityStreams"), value: "__h_sec__", header: true });
    secStreamNames.value.forEach((n) => opts.push({ label: n, value: n }));
  }
  if (otherStreamNames.value.length) {
    opts.push({ label: t("siem.events.otherStreams"), value: "__h_other__", header: true });
    otherStreamNames.value.forEach((n) => opts.push({ label: n, value: n }));
  }
  return opts;
});
const addStreamOptions = computed(() =>
  otherStreamNames.value.map((n) => ({ label: n, value: n })),
);

function addStreamToSecurity(name: unknown) {
  const n = String(name ?? "");
  if (!n || taggedStreams.value.includes(n)) return;
  taggedStreams.value = [...taggedStreams.value, n];
  saveTaggedStreams(orgId.value, taggedStreams.value);
  selectedStream.value = n;
}
function removeStreamFromSecurity(name: string) {
  taggedStreams.value = taggedStreams.value.filter((s) => s !== name);
  saveTaggedStreams(orgId.value, taggedStreams.value);
}

const HEALTH_DOT: Record<SourceHealth, string> = {
  live: "bg-status-positive",
  quiet: "bg-badge-amber-solid-bg",
  never: "bg-border-default",
};

// ── Schema ───────────────────────────────────────────────────────────────────
interface StreamField {
  name: string;
  ftype: string;
}
const schemaFields = ref<StreamField[]>([]);
const fieldNames = computed(() => schemaFields.value.map((f) => f.name));

const FIELD_GROUPS: [RegExp, string][] = [
  [
    /^(class_uid|class_name|activity_id|activity_name|type_uid|severity_id|severity|level|status|status_code|status_id)$/,
    "event",
  ],
  [/^actor[._]/, "actor"],
  [/^(src_endpoint|dst_endpoint|connection_info|network_traffic|src|dst)[._]/, "network"],
  [/^device[._]/, "device"],
  [/^metadata[._]/, "metadata"],
];
const fieldItems = computed<FieldItem[]>(() => {
  const groups: Record<string, StreamField[]> = {};
  for (const f of schemaFields.value) {
    const group = FIELD_GROUPS.find(([re]) => re.test(f.name))?.[1] ?? "other";
    (groups[group] ??= []).push(f);
  }
  return ["event", "actor", "network", "device", "metadata", "other"]
    .filter((g) => groups[g]?.length)
    .flatMap((g) => [
      { name: `__group_${g}`, isGroup: true, groupName: t(`siem.fieldGroup.${g}`), group: g },
      ...groups[g].map((f) => ({ name: f.name, type: f.ftype, group: g })),
    ]);
});

// ── Columns (raw mode) ───────────────────────────────────────────────────────
const PREFERRED = [
  "_timestamp",
  "severity_id",
  "class_name",
  "activity_name",
  "actor_user_name",
  "src_endpoint_ip",
  "device_hostname",
  "metadata_product_name",
];
const visibleCols = ref<string[]>([]);

function loadSavedCols(stream: string): string[] | null {
  try {
    const cols = JSON.parse(localStorage.getItem(colsKey()) ?? "{}")?.[stream];
    return Array.isArray(cols) && cols.length ? cols : null;
  } catch {
    return null;
  }
}
function saveCols(stream: string, cols: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(colsKey()) ?? "{}");
    all[stream] = cols;
    localStorage.setItem(colsKey(), JSON.stringify(all));
  } catch {
    /* best-effort */
  }
}
function initColumns(fields: StreamField[]) {
  const names = new Set(fields.map((f) => f.name));
  const restored = (selectedStream.value ? loadSavedCols(selectedStream.value) : null)?.filter(
    (c) => names.has(c),
  );
  if (restored?.length) {
    visibleCols.value = restored;
    return;
  }
  const preferred = PREFERRED.filter((c) => names.has(c));
  visibleCols.value =
    preferred.length >= 2
      ? preferred
      : [
          "_timestamp",
          ...fields
            .filter((f) => !f.name.startsWith("_"))
            .slice(0, 6)
            .map((f) => f.name),
        ];
}
function toggleCol(name: string) {
  const i = visibleCols.value.indexOf(name);
  if (i === -1) visibleCols.value = [...visibleCols.value, name];
  else if (visibleCols.value.length > 1)
    visibleCols.value = visibleCols.value.filter((c) => c !== name);
  if (selectedStream.value) saveCols(selectedStream.value, visibleCols.value);
  showRaw.value = true;
}

// ── Query state ──────────────────────────────────────────────────────────────
const sqlQuery = ref(initialState.query);
const sqlMode = ref(initialState.sqlMode);
const severityFilter = ref<SeverityValue[]>([]);
const fieldFilters = ref<FieldFilter[]>([...initialState.filters]);

// Severity column: the detected source's, else a common name. Numeric fallbacks are
// skipped — syslog counts the other way (0 is worst) and would invert the tiles.
const SEVERITY_FIELDS = [
  "severity_id",
  "severity",
  "level",
  "log_level",
  "loglevel",
  "severity_text",
];
const severityField = computed(() => {
  const index = new FieldIndex(fieldNames.value);
  for (const path of (detected.value?.source.map.severityId as string[] | undefined) ?? []) {
    for (const option of path.split("|")) {
      const column = index.resolve(option);
      if (column) return column;
    }
  }
  const fallback = SEVERITY_FIELDS.find((c) => fieldNames.value.includes(c)) ?? null;
  // A numeric "level"/"severity" from an unknown producer has no known scale
  // (syslog runs 0=worst, pino 10..60), so it is not read as severity at all.
  const type = schemaFields.value.find((f) => f.name === fallback)?.ftype ?? "";
  if (fallback && fallback !== "severity_id" && /int|float|double|decimal/i.test(type)) return null;
  return fallback;
});
const severityIsOcsf = computed(() => severityField.value === "severity_id");
const severityIsNumeric = computed(() => {
  const type = schemaFields.value.find((f) => f.name === severityField.value)?.ftype ?? "";
  return severityIsOcsf.value || /int|float|double|decimal/i.test(type);
});

const SEVERITY_ID_OPTIONS = computed(() =>
  [
    { id: 6, key: "siem.severity.fatal" },
    { id: 5, key: toneLabelKey("critical") },
    { id: 4, key: toneLabelKey("high") },
    { id: 3, key: toneLabelKey("medium") },
    { id: 2, key: toneLabelKey("low") },
    { id: 1, key: toneLabelKey("info") },
    { id: 0, key: toneLabelKey("unknown") },
    { id: 99, key: "siem.severity.other" },
  ].map(({ id, key }) => ({ label: t(key), value: id })),
);
const severityTextOptions = ref<{ label: string; value: string }[]>([]);
const severityOptions = computed(() =>
  severityIsOcsf.value ? SEVERITY_ID_OPTIONS.value : severityTextOptions.value,
);

async function loadSeverityValues() {
  severityTextOptions.value = [];
  const field = severityField.value;
  if (!field || severityIsOcsf.value || !selectedStream.value) return;
  try {
    const res = await streamService.fieldValues({
      org_identifier: orgId.value,
      stream_name: selectedStream.value,
      fields: [field],
      size: 50,
      start_time: timeRange.value.start,
      end_time: timeRange.value.end,
      type: "logs",
    });
    const vals: string[] = (res.data?.hits ?? []).flatMap((h: any) =>
      (h.values ?? []).map((v: any) => String(v.zo_sql_key ?? v.key ?? v)),
    );
    const uniq = [...new Set(vals)].filter((v) => v !== "" && v !== "null");
    // Worst first, whatever order the data came back in.
    uniq.sort((a, b) => toOcsfSeverity(b) - toOcsfSeverity(a) || a.localeCompare(b));
    severityTextOptions.value = uniq.map((v) => ({ label: v, value: v }));
  } catch {
    severityTextOptions.value = [];
  }
}

function onSeverityChange(v: unknown) {
  const next = (Array.isArray(v) ? v : v == null ? [] : [v]).filter(
    (x) => x !== null && x !== undefined && x !== "",
  ) as SeverityValue[];
  const cur = severityFilter.value;
  if (next.length === cur.length && next.every((n, i) => n === cur[i])) return;
  severityFilter.value = next;
}

const filters = computed(() => ({
  severityField: severityField.value,
  severityNumeric: severityIsNumeric.value,
  severity: severityFilter.value,
  filters: fieldFilters.value,
}));

// ── Filter builder ───────────────────────────────────────────────────────────
const builderField = ref("");
const builderOp = ref("=");
const builderValue = ref("");
const builderValueOptions = ref<{ label: string; value: string }[]>([]);
const builderValuesLoading = ref(false);

const FILTER_OPS = computed(() => [
  { label: t("siem.op.eq"), value: "=" },
  { label: t("siem.op.neq"), value: "!=" },
  { label: t("siem.op.contains"), value: "contains" },
  { label: t("siem.op.notContains"), value: "not_contains" },
]);
const OP_SYMBOL: Record<string, string> = {
  "=": "=",
  "!=": "≠",
  contains: "~",
  not_contains: "!~",
};
const fieldNameOptions = computed(() => fieldNames.value.map((n) => ({ label: n, value: n })));

watch(builderField, async (field) => {
  builderValue.value = "";
  builderValueOptions.value = [];
  if (!field || !selectedStream.value) {
    builderValuesLoading.value = false;
    return;
  }
  builderValuesLoading.value = true;
  const values = await fetchTopValues(field, 50);
  // Another field may have been picked while these loaded.
  if (builderField.value !== field) return;
  builderValueOptions.value = values.map((v) => ({ label: v.value, value: v.value }));
  builderValuesLoading.value = false;
});

function commitFilter() {
  const field = builderField.value.trim();
  const value = String(builderValue.value ?? "").trim();
  if (!field || !value) return;
  addFilter(field, value, builderOp.value);
  builderValue.value = "";
}

function addFilter(field: string, value: string, op = "=") {
  if (!field || value == null) return;
  // In SQL mode a pivot narrows the hand-written query rather than discarding it.
  if (sqlMode.value && sqlQuery.value.trim()) {
    const next = addToSqlWhere(sqlQuery.value, filterClause({ field, op, value }));
    if (next) {
      sqlQuery.value = next;
      void runSearch();
    } else {
      // Never silently drop a hand-written query for builder filters.
      toast({ variant: "warning", message: t("siem.events.pivotSqlUnsupported") });
    }
    return;
  }
  const existing = fieldFilters.value.findIndex((f) => f.field === field && f.value === value);
  if (existing !== -1) {
    if (fieldFilters.value[existing].op === op) return;
    // Same field/value with the opposite sense replaces rather than contradicts.
    fieldFilters.value = fieldFilters.value.map((f, i) => (i === existing ? { ...f, op } : f));
  } else {
    fieldFilters.value = [...fieldFilters.value, { field, op, value }];
  }
  sqlMode.value = false;
  void runSearch();
}
function removeFilter(idx: number) {
  fieldFilters.value = fieldFilters.value.filter((_, i) => i !== idx);
  void runSearch();
}
function invertFilter(idx: number) {
  const inverse: Record<string, string> = {
    "=": "!=",
    "!=": "=",
    contains: "not_contains",
    not_contains: "contains",
  };
  fieldFilters.value = fieldFilters.value.map((f, i) =>
    i === idx ? { ...f, op: inverse[f.op] ?? "=" } : f,
  );
  void runSearch();
}
function clearFilters() {
  fieldFilters.value = [];
  // A non-empty severity selection re-queries through its watcher.
  if (severityFilter.value.length) severityFilter.value = [];
  else void runSearch();
}

// ── Results ──────────────────────────────────────────────────────────────────
const PAGE_ROWS = 250;
const events = ref<Record<string, any>[]>([]);
const loading = ref(false);
const total = ref(0);
const errorMsg = ref("");
const lastRunAt = ref<number | null>(null);

const detected = ref<Classification | null>(null);
function detectSource(sample: Record<string, unknown> | null = events.value[0] ?? null) {
  detected.value = fieldNames.value.length ? bestMatch(fieldNames.value, { sample }) : null;
}

const normalizedEvents = computed<NormalizedEvent[]>(() =>
  normalizeEvents(events.value as Record<string, unknown>[], detected.value?.source ?? null),
);
const normalizedColumns = computed(
  () => populatedColumns(normalizedEvents.value, NORMALIZED_COLUMNS) as (keyof NormalizedEvent)[],
);

const detectedSummary = computed(() => {
  const match = detected.value;
  if (!match) return null;
  return {
    label: match.source.label,
    confidence: Math.round(match.confidence * 100),
    category: ocsfCategoryOf(match.source.ocsfClass)?.name ?? "",
    sigma: sigmaLogsourceLabel(match.source.sigma),
    evidence: [...match.matchedRequired, ...match.matchedSignals].join(", "),
    isSecurity: isSecuritySource(match),
  };
});

// ── Table ────────────────────────────────────────────────────────────────────
type Row = NormalizedEvent & { _key: string; _tone: SeverityTone };
const rows = computed<Row[]>(() =>
  normalizedEvents.value.map((ev, i) => ({
    ...ev,
    _key: `${ev.raw._timestamp ?? ""}-${i}`,
    _tone: toneOfSeverityId(ev.severityId),
  })),
);

const COLUMN_SIZE: Partial<Record<keyof NormalizedEvent, number>> = {
  time: 170,
  severityId: 110,
  className: 170,
  statusId: 100,
  srcIp: 140,
  dstIp: 140,
  message: 360,
};

function readRaw(row: Record<string, unknown>, col: string): string {
  const v = col.includes(".") ? col.split(".").reduce((o: any, k) => o?.[k], row) : row[col];
  return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
}

const columns = computed<OTableColumnDef<Row>[]>(() => {
  if (showRaw.value) {
    return visibleCols.value.map((col) => ({
      id: col === "_timestamp" ? "time" : `raw:${col}`,
      header: col === "_timestamp" ? t("siem.column.time") : col,
      accessorFn: (row: Row) => (col === "_timestamp" ? row.time : readRaw(row.raw, col)),
      size: col === "_timestamp" ? 170 : 180,
      meta: { rawField: col },
    }));
  }
  return normalizedColumns.value.map((col) => ({
    id: col,
    header: t(`siem.column.${col}`),
    accessorKey: col,
    size: COLUMN_SIZE[col] ?? 160,
    hideable: col !== "time" && col !== "severityId",
    meta: { isName: col === "className" },
  }));
});

const drawerEvent = ref<Record<string, any> | null>(null);
const pendingEventTs = ref<string | null>(initialState.eventTs);
const pendingEventKey = ref<string | null>(
  route.query.event_key ? String(route.query.event_key) : null,
);
const drawerNormalized = computed(
  () =>
    rows.value.find((r) => r.raw === drawerEvent.value) ??
    (drawerEvent.value
      ? normalizeEvents([drawerEvent.value], detected.value?.source ?? null)[0]
      : null),
);

// Rows are matched by content, not `_timestamp`: many events can share one.
const drawerKey = computed(() => eventKey(drawerEvent.value));
function isActiveRow(row: Row) {
  return !!drawerEvent.value && eventKey(row.raw) === drawerKey.value;
}
// Prev/next walk the table as displayed (its sort, across its pages).
const eventsTable = ref<{ table?: NavTable<Row> } | null>(null);
const sortTick = ref(0);
const isDrawerRow = (r: Row) => eventKey(r.raw) === drawerKey.value;
const drawerIndex = computed(() => {
  void sortTick.value;
  return positionOf(displayOrder(eventsTable.value?.table, rows.value), isDrawerRow);
});
function stepDrawer(delta: number) {
  const next = stepRow(eventsTable.value?.table, rows.value, isDrawerRow, delta);
  if (next) openDrawer(next.row);
}
/** Turns the table to the page holding the open record (deep links). */
function revealDrawerRow() {
  const table = eventsTable.value?.table;
  const i = drawerIndex.value;
  const size = table?.getState().pagination?.pageSize;
  if (table && i !== null && size) table.setPageIndex(Math.floor(i / size));
}
const rowClass = (row: Row) => (isActiveRow(row) ? "!bg-table-row-selected-bg" : "");
const rowRail = (row: Row) => severityRailColor(row._tone);

/** Field + value a cell pivots on, or null when the value was derived. */
function pivotFor(row: Row, columnId: string): { field: string; value: string } | null {
  if (columnId.startsWith("raw:")) {
    const field = columnId.slice(4);
    const value = readRaw(row.raw, field);
    return value ? { field, value } : null;
  }
  if (columnId === "time") return null;
  const field = sourceColumnFor(
    row.raw,
    detected.value?.source ?? null,
    columnId as keyof NormalizedEvent,
  );
  if (!field) return null;
  const value = readRaw(row.raw, field);
  return value ? { field, value } : null;
}

function fmtTs(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Timeline + severity tiles (server-side, whole window) ────────────────────
const histogram = ref<HistogramResult | null>(null);
const histogramLoading = ref(false);

// Each search bumps this; a response from an older search is dropped, so a slow
// query can never overwrite the results of the one the analyst ran after it.
let searchSeq = 0;

async function runHistogram(seq: number) {
  const stream = selectedStream.value;
  if (!stream || sqlMode.value) {
    histogram.value = null;
    return;
  }
  histogramLoading.value = true;
  const { start, end } = timeRange.value;
  const interval = histogramInterval((end - start) / 1000);
  try {
    const res = await searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: {
            sql: histogramSql(
              stream,
              whereParts(filters.value, false),
              severityField.value,
              interval.sql,
            ),
            start_time: start,
            end_time: end,
            from: 0,
            size: -1,
          },
        },
        page_type: "logs",
      },
      "ui",
    );
    if (seq !== searchSeq) return;
    histogram.value = foldHistogram(res.data?.hits ?? [], !!severityField.value);
    histogramFresh.value = true;
  } catch {
    if (seq === searchSeq) histogram.value = null;
  } finally {
    if (seq === searchSeq) histogramLoading.value = false;
  }
}

/** Whether `histogram` describes the search currently on screen. */
const histogramFresh = ref(false);

// Exact window total from the histogram (the search total is capped at the page);
// null in SQL mode or before the histogram lands.
const windowTotal = computed<number | null>(() => {
  const h = histogram.value;
  // No exact total to offer: the response total is capped at the page size.
  if (!h || !histogramFresh.value || sqlMode.value) return null;
  if (!severityFilter.value.length) return h.total;
  return severityFilter.value.reduce<number>((sum, v) => sum + (h.rawCounts[String(v)] ?? 0), 0);
});

/** Tones drawn: the five, plus Unknown when events carry no readable severity. */
const shownTones = computed<SeverityTone[]>(() =>
  histogram.value?.totals.unknown ? [...SEVERITY_TONES, "unknown"] : [...SEVERITY_TONES],
);

const chartSeries = computed(() =>
  severityField.value
    ? [...shownTones.value].reverse().map((tone) => ({
        key: tone,
        label: t(toneLabelKey(tone)),
        token: TONE_TOKEN[tone],
      }))
    : [{ key: "info", label: t("siem.events.events"), token: "--color-accent" as const }],
);

/** Raw severity values a tile stands for, so a click can become a filter. */
function valuesForTone(tone: SeverityTone): SeverityValue[] {
  const seen = histogram.value?.rawByTone[tone] ?? [];
  return severityIsNumeric.value ? seen.map(Number).filter((n) => Number.isFinite(n)) : seen;
}

const severityStats = computed<StatItem[]>(() => {
  const h = histogram.value;
  // No "All" tile: the count sits in the table toolbar, and re-clicking the
  // active tile clears the facet.
  return shownTones.value.map((tone) => ({
    key: tone,
    label: t(toneLabelKey(tone)),
    value: h ? h.totals[tone] : "—",
    icon: TONE_ICON[tone],
    tone: TONE_STAT[tone],
    max: h?.total || undefined,
    dataTest: `security-events-severity-${tone}`,
  }));
});

const selectedTone = computed<string | null>(() => {
  if (!severityFilter.value.length) return null;
  const current = new Set(severityFilter.value.map(String));
  return (
    shownTones.value.find((tone) => {
      const values = valuesForTone(tone).map(String);
      return values.length === current.size && values.every((v) => current.has(v));
    }) ?? null
  );
});

function onSeverityTile(key: string) {
  if (key === selectedTone.value) {
    severityFilter.value = [];
    return;
  }
  const values = valuesForTone(key as SeverityTone);
  if (values.length) severityFilter.value = values;
}

function onChartZoom({ start, end }: { start: number; end: number }) {
  dateState.value = {
    type: "absolute",
    period: "",
    absolute: { startTime: start * 1000, endTime: end * 1000 },
  };
  timeRange.value = { start: start * 1000, end: end * 1000 };
  dateKey.value += 1;
  void runSearch();
}

// ── Field sidebar: top values per field ──────────────────────────────────────
const expandedField = ref<string | null>(null);
const topValues = ref<{ value: string; count: number }[]>([]);
const topValuesLoading = ref(false);

async function fetchTopValues(
  field: string,
  limit = 10,
): Promise<{ value: string; count: number }[]> {
  const stream = selectedStream.value;
  if (!stream) return [];
  const { start, end } = timeRange.value;
  try {
    const res = await searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: {
            sql: topValuesSql(stream, sqlMode.value ? [] : whereParts(filters.value), field, limit),
            start_time: start,
            end_time: end,
            from: 0,
            size: limit,
          },
        },
        page_type: "logs",
      },
      "ui",
    );
    return (res.data?.hits ?? [])
      .filter((h: any) => h.zo_value !== null && h.zo_value !== undefined && h.zo_value !== "")
      .map((h: any) => ({ value: String(h.zo_value), count: Number(h.zo_n ?? 0) }));
  } catch {
    return [];
  }
}

async function onFieldClick(row: FieldItem) {
  if (row.isGroup) return;
  if (expandedField.value === row.name) {
    expandedField.value = null;
    topValuesLoading.value = false;
    return;
  }
  expandedField.value = row.name;
  topValues.value = [];
  await loadTopValues(row.name);
}

let topValuesSeq = 0;
async function loadTopValues(field: string) {
  const seq = ++topValuesSeq;
  topValuesLoading.value = true;
  const values = await fetchTopValues(field);
  // A newer load, or another field opened meanwhile, owns the panel now.
  if (seq !== topValuesSeq || expandedField.value !== field) return;
  topValues.value = values;
  topValuesLoading.value = false;
}
const topValuesTotal = computed(() => topValues.value.reduce((sum, v) => sum + v.count, 0));

// ── Sigma rules for this source ──────────────────────────────────────────────
const {
  ranked: sigmaRules,
  counting: rulesCounting,
  error: rulesError,
  runnableCount,
  firingCount,
  compileFor,
  countHits,
} = useSigmaRules();
const showRules = ref(false);

function refreshRules() {
  compileFor(detected.value?.source ?? null, fieldNames.value);
  const stream = selectedStream.value;
  if (!stream || !runnableCount.value) return;
  void countHits(orgId.value, stream, timeRange.value);
}

function createDetectionFrom(sigmaId: string) {
  router.push({
    path: "/security/detections",
    query: {
      org_identifier: orgId.value,
      sigma_id: sigmaId,
      stream: selectedStream.value ?? "",
      source: detected.value?.source.id ?? "",
    },
  });
}

function filterByRule(where: string) {
  const stream = selectedStream.value;
  if (!stream) return;
  sqlMode.value = true;
  sqlQuery.value = `SELECT * FROM "${stream}" WHERE ${where} ORDER BY _timestamp DESC`;
  showRules.value = false;
  void runSearch();
}

// ── Drawer ───────────────────────────────────────────────────────────────────
function openDrawer(row: Row) {
  drawerEvent.value = row.raw;
  syncUrl();
}
function closeDrawer() {
  if (!drawerEvent.value && !pendingEventTs.value) return;
  drawerEvent.value = null;
  pendingEventTs.value = null;
  pendingEventKey.value = null;
  syncUrl();
}
// A shared link pins the absolute window — a relative one would resolve against
// the viewer's clock and show different events.
const shareUrl = computed(() => {
  if (!drawerEvent.value || typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  Object.entries(buildQuery(true)).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url.toString();
});

// ── SQL ──────────────────────────────────────────────────────────────────────
function buildSQL(): string {
  const stream = selectedStream.value;
  if (!stream) return "";
  if (sqlMode.value && sqlQuery.value.trim()) return sqlQuery.value.trim();
  return eventsSql(stream, sqlMode.value ? [] : whereParts(filters.value));
}
// Seeds the SQL editor from the builder, unless the analyst edited the last seed.
let seededSql = "";
function switchToSql(value: unknown) {
  const next = value === "sql";
  if (next === sqlMode.value) return;
  if (next && (!sqlQuery.value.trim() || sqlQuery.value === seededSql)) {
    sqlQuery.value = eventsSql(selectedStream.value ?? "", whereParts(filters.value));
    seededSql = sqlQuery.value;
  }
  sqlMode.value = next;
  void runSearch();
}

// ── URL sync ─────────────────────────────────────────────────────────────────
function buildQuery(pinTime = false): Record<string, string> {
  const q: Record<string, string> = { org_identifier: orgId.value };
  if (selectedStream.value) q.stream = selectedStream.value;
  if (dateState.value.type === "relative" && !pinTime) {
    q.period = dateState.value.period || "15m";
  } else {
    q.from = String(timeRange.value.start);
    q.to = String(timeRange.value.end);
  }
  q.sql_mode = String(sqlMode.value);
  if (sqlMode.value && sqlQuery.value.trim())
    q.query = b64EncodeUnicode(sqlQuery.value.trim()) ?? "";
  if (severityFilter.value.length) q.severity = severityFilter.value.join(",");
  if (fieldFilters.value.length)
    q.filters = b64EncodeUnicode(JSON.stringify(fieldFilters.value)) ?? "";
  const eventTs = drawerEvent.value?._timestamp ?? pendingEventTs.value;
  if (eventTs != null) q.event_ts = String(eventTs);
  const key = drawerEvent.value ? drawerKey.value : pendingEventKey.value;
  if (key) q.event_key = key;
  return q;
}
function syncUrl() {
  router.replace({ query: buildQuery() });
  try {
    localStorage.setItem(
      stateKey(),
      JSON.stringify({
        stream: selectedStream.value,
        sqlMode: sqlMode.value,
        query: sqlQuery.value,
        severity: severityFilter.value,
        filters: fieldFilters.value,
        date: dateState.value,
      }),
    );
  } catch {
    /* the URL still carries the full state */
  }
}

// ── Loading ──────────────────────────────────────────────────────────────────
async function loadStreams() {
  streamsLoading.value = true;
  try {
    const res = await streamService.nameList(orgId.value, "logs", false);
    streamList.value = res.data?.list ?? [];
    const wanted = initialState.stream;
    if (wanted && allStreamNames.value.includes(wanted)) selectedStream.value = wanted;
    else if (secStreamNames.value.length) selectedStream.value = secStreamNames.value[0];
    else if (allStreamNames.value.length) selectedStream.value = allStreamNames.value[0];
  } finally {
    streamsLoading.value = false;
  }
}

async function loadSchema(streamName: string) {
  schemaFields.value = [];
  try {
    const res = await streamService.schema(orgId.value, streamName, "logs");
    if (selectedStream.value !== streamName) return;
    const raw: any[] = res.data?.schema ?? res.data?.fields ?? [];
    schemaFields.value = raw.map((f: any) => ({
      name: f.name,
      ftype: f.type ?? f.field_type ?? "",
    }));
    initColumns(schemaFields.value);
    // Identify from the schema alone so the severity column is known before
    // the first search; the search re-identifies with a real row.
    detectSource(null);
  } catch {
    if (selectedStream.value === streamName) schemaFields.value = [];
  }
}

let mountComplete = false;

async function runSearch() {
  if (mountComplete) syncUrl();
  if (!selectedStream.value || !orgId.value) return;
  if (dateState.value.type === "relative") timeRange.value = rangeFor(dateState.value);
  loading.value = true;
  errorMsg.value = "";
  const { start, end } = timeRange.value;
  const seq = ++searchSeq;
  histogramFresh.value = false;
  const histogramDone = runHistogram(seq);
  try {
    const res = await searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: { sql: buildSQL(), start_time: start, end_time: end, from: 0, size: PAGE_ROWS },
        },
        page_type: "logs",
      },
      "ui",
    );
    if (seq !== searchSeq) return;
    events.value = res.data?.hits ?? [];
    total.value = res.data?.total ?? events.value.length;
    if (!schemaFields.value.length && events.value.length) {
      schemaFields.value = Object.keys(events.value[0]).map((k) => ({ name: k, ftype: "Utf8" }));
      initColumns(schemaFields.value);
    }
    detectSource();
    refreshRules();
    if (drawerEvent.value) {
      const fresh = events.value.find((e) => eventKey(e) === drawerKey.value);
      if (fresh) drawerEvent.value = fresh;
    }
    lastRunAt.value = Date.now();
  } catch (e: any) {
    if (seq !== searchSeq) return;
    errorMsg.value =
      e?.response?.data?.error ??
      e?.response?.data?.message ??
      e?.message ??
      t("siem.events.searchFailed");
    events.value = [];
    total.value = 0;
  } finally {
    if (seq === searchSeq) loading.value = false;
  }
  if (expandedField.value) void loadTopValues(expandedField.value);
  await histogramDone;
}

async function restoreDrawerFromUrl() {
  const ts = pendingEventTs.value;
  if (!ts || drawerEvent.value) return;
  // With a content key only that exact event will do (others share its timestamp);
  // not in the page → the server lookup below.
  const inPage = pendingEventKey.value
    ? events.value.find((e) => eventKey(e) === pendingEventKey.value)
    : events.value.find((e) => String(e._timestamp) === ts);
  if (inPage) {
    drawerEvent.value = inPage;
    pendingEventTs.value = null;
    pendingEventKey.value = null;
    void nextTick(revealDrawerRow);
    return;
  }
  const tsNum = Number(ts);
  const stream = selectedStream.value;
  if (Number.isFinite(tsNum) && stream) {
    try {
      const res = await searchService.search(
        {
          org_identifier: orgId.value,
          query: {
            query: {
              sql: `SELECT * FROM "${stream.replace(/"/g, '""')}" WHERE _timestamp = ${tsNum}`,
              start_time: tsNum - 1_000_000,
              end_time: tsNum + 1_000_000,
              from: 0,
              size: 100,
            },
          },
          page_type: "logs",
        },
        "ui",
      );
      const hits: Record<string, any>[] = res.data?.hits ?? [];
      // Several events can share the timestamp; the content key picks the one linked.
      const hit = pendingEventKey.value
        ? hits.find((h) => eventKey(h) === pendingEventKey.value)
        : hits[0];
      // The analyst may have switched stream while this looked the event up.
      if (hit && selectedStream.value === stream) drawerEvent.value = hit;
    } catch {
      /* aged out — leave the drawer closed */
    }
  }
  pendingEventTs.value = null;
  pendingEventKey.value = null;
  if (!drawerEvent.value) syncUrl();
}

// ── Watchers ─────────────────────────────────────────────────────────────────
let suppressSeverityWatch = false;
function applySeverity(values: SeverityValue[]) {
  suppressSeverityWatch = true;
  severityFilter.value = severityIsNumeric.value
    ? values.map(Number).filter((n) => !Number.isNaN(n))
    : values.map(String);
  void nextTick(() => (suppressSeverityWatch = false));
}

let switchingStream = false;
watch(selectedStream, async (v) => {
  if (!mountComplete || !v) return;
  switchingStream = true;
  fieldFilters.value = [];
  sqlQuery.value = "";
  sqlMode.value = false;
  drawerEvent.value = null;
  pendingEventTs.value = null;
  pendingEventKey.value = null;
  expandedField.value = null;
  showRules.value = false;
  await loadSchema(v);
  if (selectedStream.value !== v) return;
  await loadSeverityValues();
  if (selectedStream.value !== v) return;
  applySeverity([]);
  switchingStream = false;
  void runSearch();
});
// Re-identification can move severity to another column; the facet follows it,
// except a URL severity, which is re-applied once on the first move.
let severityRestorePending = initialState.severity.length > 0;
watch(severityField, (next, prev) => {
  if (!mountComplete || switchingStream || next === prev) return;
  applySeverity(severityRestorePending ? initialState.severity : []);
  severityRestorePending = false;
  void loadSeverityValues();
  void runSearch();
});
watch(
  severityFilter,
  () => {
    if (!mountComplete || suppressSeverityWatch) return;
    void runSearch();
  },
  { deep: true },
);
watch(sqlMode, () => {
  if (mountComplete) syncUrl();
});

function sameRange(a: { start: number; end: number }, b: { start: number; end: number }) {
  return Math.abs(a.start - b.start) < 1_000_000 && Math.abs(a.end - b.end) < 1_000_000;
}

function onDateChange(dt: any) {
  const next = { start: Number(dt.startTime), end: Number(dt.endTime) };
  const relative = String(dt.valueType ?? "relative").startsWith("relative");
  const nextDate: DateState = relative
    ? {
        type: "relative",
        period: dt.relativeTimePeriod || dateState.value.period || "15m",
        absolute: null,
      }
    : { type: "absolute", period: "", absolute: { startTime: next.start, endTime: next.end } };
  const unchanged =
    nextDate.type === dateState.value.type &&
    (relative ? nextDate.period === dateState.value.period : sameRange(next, timeRange.value));
  timeRange.value = next;
  dateState.value = nextDate;
  // The picker re-reports its value on mount; only a real change re-queries.
  if (!mountComplete || unchanged) return;
  void runSearch();
}

onMounted(async () => {
  taggedStreams.value = loadTaggedStreams(orgId.value);
  await loadStreams();
  if (selectedStream.value) {
    await loadSchema(selectedStream.value);
    await loadSeverityValues();
    applySeverity(initialState.severity);
  }
  mountComplete = true;
  if (selectedStream.value) {
    await runSearch();
    // The watcher had its one chance to re-apply the URL severity.
    await nextTick();
    severityRestorePending = false;
    await restoreDrawerFromUrl();
  } else {
    syncUrl();
  }
});

const filtersActive = computed(
  () => fieldFilters.value.length > 0 || severityFilter.value.length > 0,
);
function onEmptyAction(id?: string) {
  if (id === "clear-filters") clearFilters();
}
</script>

<template>
  <OPageLayout
    :title="t('siem.events.title')"
    :subtitle="t('siem.events.subtitle')"
    icon="manage-search"
    bleed
    resizable
    v-model:sidebar-width="sidebarWidth"
    :splitter-limits="[0, 480]"
    title-data-test="security-events-title"
  >
    <template #actions>
      <div class="flex items-center gap-2">
        <DateTime
          :key="dateKey"
          :default-type="dateState.type"
          :default-relative-time="dateState.period || '15m'"
          :default-absolute-time="dateState.absolute ?? undefined"
          :auto-apply="true"
          data-test="security-events-datetime"
          @on:date-change="onDateChange"
        />
        <OButton
          variant="primary"
          size="sm"
          icon-left="play-arrow"
          :loading="loading"
          data-test="security-events-run"
          @click="runSearch"
        >
          {{ t("siem.events.run") }}
        </OButton>
      </div>
    </template>

    <!-- ── Query bar ─────────────────────────────────────────────────────── -->
    <template #subnav>
      <div class="px-page-edge flex flex-col gap-2 py-2" data-test="security-events-query-bar">
        <div class="flex flex-wrap items-center gap-2">
          <OButton
            variant="ghost"
            size="icon-sm"
            :icon-left="sidebarWidth > 0 ? 'left-panel-close' : 'left-panel-open'"
            data-test="security-events-toggle-sidebar"
            @click="toggleSidebar"
          >
            <OTooltip
              :content="
                sidebarWidth > 0 ? t('siem.events.hideSidebar') : t('siem.events.showSidebar')
              "
            />
          </OButton>
          <div class="w-60 shrink-0">
            <OSelect
              :model-value="selectedStream"
              :options="streamOptions"
              :placeholder="t('siem.events.selectStream')"
              :loading="streamsLoading"
              searchable
              data-test="security-events-stream"
              @update:model-value="selectedStream = $event as string"
            />
          </div>
          <OToggleGroup
            :model-value="sqlMode ? 'sql' : 'builder'"
            data-test="security-events-mode"
            @update:model-value="switchToSql"
          >
            <OToggleGroupItem
              value="builder"
              size="sm"
              icon-left="filter-list"
              data-test="security-events-mode-builder"
            >
              {{ t("siem.events.builder") }}
            </OToggleGroupItem>
            <OToggleGroupItem
              value="sql"
              size="sm"
              icon-left="code"
              data-test="security-events-mode-sql"
              >{{ t("siem.events.sql") }}</OToggleGroupItem
            >
          </OToggleGroup>

          <template v-if="!sqlMode">
            <div v-if="severityField" class="w-52 shrink-0">
              <OSelect
                :model-value="severityFilter"
                :options="severityOptions"
                multiple
                clearable
                :placeholder="t('siem.events.allSeverities')"
                data-test="security-events-severity-filter"
                @update:model-value="onSeverityChange"
              />
            </div>
            <OSeparator vertical class="mx-1 h-5" />
            <div class="w-48 shrink-0">
              <OSelect
                v-model="builderField"
                :options="fieldNameOptions"
                :placeholder="t('siem.events.field')"
                searchable
                data-test="security-events-builder-field"
              />
            </div>
            <div class="w-36 shrink-0">
              <OSelect
                v-model="builderOp"
                :options="FILTER_OPS"
                data-test="security-events-builder-op"
              />
            </div>
            <div class="w-56 shrink-0">
              <OSelect
                v-model="builderValue"
                :options="builderValueOptions"
                :loading="builderValuesLoading"
                :disabled="!builderField"
                :placeholder="t('siem.events.value')"
                searchable
                creatable
                @create="(v: string) => (builderValue = v)"
                data-test="security-events-builder-value"
              />
            </div>
            <OButton
              variant="outline"
              size="sm"
              icon-left="add"
              :disabled="!builderField || !builderValue"
              data-test="security-events-builder-add"
              @click="commitFilter"
            >
              {{ t("siem.events.addFilter") }}
            </OButton>
          </template>
        </div>

        <!-- Active filters: flip include/exclude, or remove -->
        <div v-if="!sqlMode && fieldFilters.length" class="flex flex-wrap items-center gap-1.5">
          <OTag
            v-for="(f, i) in fieldFilters"
            :key="`${f.field}-${f.op}-${f.value}`"
            :variant="f.op === '!=' || f.op === 'not_contains' ? 'error-soft' : 'primary-soft'"
            shape="rounded"
            size="sm"
            :data-test="`security-events-filter-${i}`"
          >
            <span class="max-w-80 truncate font-mono">
              <span class="font-semibold">{{ f.field }}</span>
              {{ OP_SYMBOL[f.op] ?? f.op }} {{ f.value }}
            </span>
            <template #trailing>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="swap-horiz"
                :data-test="`security-events-filter-invert-${i}`"
                @click="invertFilter(i)"
              >
                <OTooltip :content="t('siem.events.invertFilter')" />
              </OButton>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="close"
                :data-test="`security-events-filter-remove-${i}`"
                @click="removeFilter(i)"
              >
                <OTooltip :content="t('siem.events.removeFilter')" />
              </OButton>
            </template>
          </OTag>
          <OButton
            variant="ghost-muted"
            size="xs"
            data-test="security-events-clear-filters"
            @click="clearFilters"
          >
            {{ t("siem.events.clearFilters") }}
          </OButton>
        </div>

        <div
          v-if="sqlMode"
          class="border-border-default rounded-default h-24 overflow-hidden border"
        >
          <CodeQueryEditor
            editor-id="security-events-sql"
            :query="sqlQuery"
            :show-line-numbers="false"
            :debounce-time="200"
            class="h-full"
            data-test="security-events-sql"
            @update:query="(q: string) => (sqlQuery = q)"
            @run-query="runSearch"
          />
        </div>
      </div>
    </template>

    <!-- ── Sidebar: sources + fields ─────────────────────────────────────── -->
    <template #sidebar>
      <OFieldList
        :fields="fieldItems"
        :show-pagination="false"
        :expanded-ids="expandedField ? [expandedField] : []"
        :search-placeholder="t('siem.events.searchFields')"
        data-test="security-events-fields"
        @row-click="onFieldClick"
      >
        <template #before-list>
          <div class="border-border-default flex flex-col gap-1 border-b pt-2 pb-2">
            <div
              class="px-page-edge text-text-secondary text-2xs flex items-center justify-between font-semibold tracking-wide uppercase"
            >
              <span>{{ t("siem.events.sources") }}</span>
              <span class="tabular-nums">{{ secStreamNames.length }}</span>
            </div>
            <ul class="flex max-h-48 flex-col overflow-y-auto">
              <li
                v-for="name in secStreamNames"
                :key="name"
                class="group px-page-edge hover:bg-surface-subtle flex cursor-pointer items-center gap-2 py-1"
                :class="{ 'bg-surface-subtle': selectedStream === name }"
                role="button"
                tabindex="0"
                :data-test="`security-events-source-${name}`"
                @click="selectedStream = name"
                @keydown.enter="selectedStream = name"
                @keydown.space.prevent="selectedStream = name"
              >
                <span
                  class="size-2 shrink-0 rounded-full"
                  :class="HEALTH_DOT[sourceHealth(streamStats.get(name))]"
                >
                  <OTooltip :content="t(`siem.health.${sourceHealth(streamStats.get(name))}`)" />
                </span>
                <span
                  class="min-w-0 flex-1 truncate font-mono text-xs"
                  :class="
                    selectedStream === name
                      ? 'text-text-heading font-semibold'
                      : 'text-text-heading'
                  "
                  >{{ name }}</span
                >
                <span class="text-text-secondary text-2xs tabular-nums">{{
                  formatEventCount(Number(streamStats.get(name)?.doc_num ?? 0))
                }}</span>
                <OButton
                  :data-test="`security-events-source-remove-${name}`"
                  v-if="taggedStreams.includes(name)"
                  variant="ghost"
                  size="icon-xs"
                  icon-left="remove"
                  class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  @click.stop="removeStreamFromSecurity(name)"
                >
                  <OTooltip :content="t('siem.events.removeSource')" />
                </OButton>
              </li>
            </ul>
            <div class="px-page-edge">
              <OSelect
                :model-value="null"
                :options="addStreamOptions"
                :placeholder="t('siem.events.addSource')"
                searchable
                size="sm"
                data-test="security-events-add-source"
                @update:model-value="addStreamToSecurity"
              />
            </div>
          </div>
        </template>

        <template #field-actions="{ row }">
          <OButton
            variant="ghost"
            size="icon-xs"
            :icon-left="
              showRaw && visibleCols.includes(row.name) ? 'visibility-off' : 'view-column'
            "
            :data-test="`security-events-field-column-${row.name}`"
            @click.stop="toggleCol(row.name)"
          >
            <OTooltip
              :content="
                showRaw && visibleCols.includes(row.name)
                  ? t('siem.events.removeColumn')
                  : t('siem.events.addColumn')
              "
            />
          </OButton>
        </template>

        <template #expansion="{ row }">
          <div
            class="flex flex-col gap-1 px-2"
            :data-test="`security-events-field-values-${row.name}`"
          >
            <span v-if="sqlMode" class="text-text-secondary text-2xs px-1">
              {{ t("siem.events.topValuesWholeStream") }}
            </span>
            <div v-if="topValuesLoading" class="flex justify-center py-2">
              <OSpinner size="sm" />
            </div>
            <span v-else-if="!topValues.length" class="text-text-secondary px-1 py-1 text-xs">
              {{ t("siem.events.noValues") }}
            </span>
            <template v-else>
              <div
                v-for="v in topValues"
                :key="v.value"
                class="group rounded-default hover:bg-surface-subtle flex flex-col gap-0.5 px-1 py-0.5"
              >
                <div class="flex items-center gap-1">
                  <span class="text-text-heading min-w-0 flex-1 truncate font-mono text-xs"
                    >{{ v.value }}<OTooltip :content="v.value"
                  /></span>
                  <span class="text-text-secondary text-2xs tabular-nums">{{
                    formatEventCount(v.count)
                  }}</span>
                  <div
                    class="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  >
                    <OButton
                      :data-test="`security-events-value-include-${v.value}`"
                      variant="ghost"
                      size="icon-xs"
                      icon-left="add-circle-outline"
                      @click.stop="addFilter(row.name, v.value, '=')"
                    >
                      <OTooltip :content="t('siem.pivot.include')" />
                    </OButton>
                    <OButton
                      :data-test="`security-events-value-exclude-${v.value}`"
                      variant="ghost"
                      size="icon-xs"
                      icon-left="block"
                      @click.stop="addFilter(row.name, v.value, '!=')"
                    >
                      <OTooltip :content="t('siem.pivot.exclude')" />
                    </OButton>
                  </div>
                </div>
                <OProgressBar :value="topValuesTotal ? v.count / topValuesTotal : 0" size="xs" />
              </div>
            </template>
          </div>
        </template>

        <template #empty>
          {{ selectedStream ? t("siem.events.noFields") : t("siem.events.selectStreamFirst") }}
        </template>
      </OFieldList>
    </template>

    <!-- ── Body ──────────────────────────────────────────────────────────── -->
    <div class="flex min-h-0 flex-1 flex-col">
      <!-- What the stream was identified as, and on what evidence -->
      <div
        v-if="detectedSummary"
        class="px-page-edge border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b py-1.5 text-xs"
        data-test="security-events-detected"
      >
        <OIcon
          :name="detectedSummary.isSecurity ? 'verified-user' : 'info-outline'"
          size="sm"
          :class="
            detectedSummary.isSecurity ? 'text-icon-chip-primary-text' : 'text-text-secondary'
          "
        />
        <span class="text-text-heading font-semibold">{{ detectedSummary.label }}</span>
        <OTag variant="primary-soft" size="xs">
          {{ t("siem.events.confidence", { n: detectedSummary.confidence }) }}
        </OTag>
        <OTag v-if="detectedSummary.category" variant="default-soft" size="xs">{{
          detectedSummary.category
        }}</OTag>
        <OTag v-if="detectedSummary.sigma" variant="purple-soft" size="xs" class="font-mono">
          {{ detectedSummary.sigma }}
        </OTag>
        <OTag v-if="!detectedSummary.isSecurity" variant="default-soft" size="xs">
          {{ t("siem.events.telemetryOnly") }}
        </OTag>
        <span class="text-text-secondary max-w-md truncate">
          {{ t("siem.events.matchedOn", { fields: detectedSummary.evidence }) }}
          <OTooltip :content="detectedSummary.evidence" />
        </span>
        <div class="flex-1" />
        <OButton
          v-if="sigmaRules.length"
          :variant="firingCount ? 'outline-destructive' : 'outline'"
          size="xs"
          icon-left="shield-alert-outline"
          :icon-right="showRules ? 'expand-less' : 'expand-more'"
          data-test="security-events-rules-toggle"
          @click="showRules = !showRules"
        >
          {{ t("siem.events.detections", runnableCount) }}
          <template v-if="firingCount"> · {{ t("siem.events.firing", firingCount) }}</template>
        </OButton>
      </div>

      <!-- Sigma rules written for this source, counted over the window -->
      <div
        v-if="showRules && sigmaRules.length"
        class="border-border-default bg-surface-panel flex max-h-72 shrink-0 flex-col overflow-y-auto border-b"
        data-test="security-events-rules"
      >
        <div class="px-page-edge text-text-secondary flex items-center gap-2 py-1.5 text-xs">
          <span class="font-semibold">{{
            t("siem.events.rulesFor", { source: detectedSummary?.sigma || "" })
          }}</span>
          <OSpinner v-if="rulesCounting" size="xs" />
          <span v-else-if="rulesError" class="text-status-error-text">{{ rulesError }}</span>
        </div>
        <div
          v-for="entry in sigmaRules"
          :key="entry.rule.id ?? entry.rule.title"
          class="px-page-edge border-border-subtle flex items-center gap-2 border-t py-1.5 text-xs"
          :class="{ 'opacity-60': !entry.compiled.runnable }"
        >
          <OTag
            type="severity"
            :value="severityTagValue(toneOfSigmaLevel(entry.rule.level))"
            :label="t(toneLabelKey(toneOfSigmaLevel(entry.rule.level)))"
            size="xs"
          />
          <span class="text-text-heading truncate font-medium">
            {{ entry.rule.title }}
            <OTooltip v-if="entry.rule.description" :content="entry.rule.description" />
          </span>
          <OTag
            v-for="tech in entry.rule.techniques.slice(0, 3)"
            :key="tech"
            variant="purple-soft"
            shape="rounded"
            size="xs"
            >{{ tech }}</OTag
          >
          <div class="flex-1" />
          <span v-if="!entry.compiled.runnable" class="text-text-secondary max-w-80 truncate">
            {{ blockedReason(entry.compiled) }}
            <OTooltip :content="blockedReason(entry.compiled)" />
          </span>
          <template v-else>
            <OIcon
              v-if="caveat(entry.compiled)"
              name="warning-amber"
              size="xs"
              class="text-status-warning-text"
            >
              <OTooltip :content="caveat(entry.compiled)" />
            </OIcon>
            <OTag
              v-if="entry.count !== null"
              :variant="entry.count > 0 ? 'error-soft' : 'default-soft'"
              size="xs"
              class="tabular-nums"
            >
              {{ t("siem.events.hits", { n: formatEventCount(entry.count) }, entry.count) }}
            </OTag>
            <OButton
              :data-test="`security-events-rule-view-${entry.rule.id}`"
              v-if="entry.count"
              variant="ghost"
              size="xs"
              @click="filterByRule(entry.compiled.where)"
            >
              {{ t("siem.events.viewHits") }}
            </OButton>
            <OButton
              :data-test="`security-events-rule-create-${entry.rule.id}`"
              variant="ghost-primary"
              size="xs"
              @click="createDetectionFrom(entry.rule.id ?? '')"
            >
              {{ t("siem.events.createDetection") }}
            </OButton>
          </template>
        </div>
      </div>

      <!-- Timeline: severity tiles (facet) + stacked volume, whole window -->
      <div
        v-if="selectedStream && !sqlMode && showTimeline"
        class="px-page-edge border-border-default flex shrink-0 flex-col gap-2 border-b py-2"
        data-test="security-events-timeline"
      >
        <OStatStrip
          v-if="severityField"
          data-test="security-events-severity-strip"
          :items="severityStats"
          :loading="histogramLoading && !histogram"
          selectable
          :selected-key="selectedTone"
          @select="onSeverityTile"
        />
        <div class="h-28">
          <SecuritySeverityChart
            :buckets="histogram?.buckets ?? []"
            :series="chartSeries"
            :loading="histogramLoading"
            :highlight="selectedTone"
            :min="Math.floor(timeRange.start / 1000)"
            :max="Math.ceil(timeRange.end / 1000)"
            zoomable
            data-test="security-events-chart"
            @zoom="onChartZoom"
          />
        </div>
      </div>
      <OBanner
        v-else-if="selectedStream && sqlMode"
        variant="default"
        icon="info-outline"
        dense
        data-test="security-events-sql-timeline-note"
        class="mx-page-edge my-2"
      >
        {{ t("siem.events.sqlTimelineNote") }}
      </OBanner>

      <!-- ── Results ─────────────────────────────────────────────────────── -->
      <OEmptyState
        v-if="!selectedStream && !streamsLoading"
        size="hero"
        icon="manage-search"
        :title="t('siem.events.noStreamTitle')"
        :description="t('siem.events.noStreamHint')"
      />
      <OTable
        v-else
        :key="showRaw ? 'raw' : 'normalized'"
        :data="rows"
        :columns="columns"
        row-key="_key"
        :loading="loading"
        :error="errorMsg || null"
        ref="eventsTable"
        :page-size="50"
        :page-size-options="[50, 100, 250]"
        :show-global-filter="false"
        :persist-columns="!showRaw"
        :table-id="showRaw ? undefined : 'security-events-normalized'"
        :enable-column-resize="true"
        :row-class="rowClass"
        :get-row-status-color="rowRail"
        class="min-h-0 flex-1"
        data-test="security-events-table"
        @row-click="openDrawer"
        @sort-change="sortTick++"
      >
        <template #toolbar>
          <div class="flex w-full items-center gap-3">
            <span class="text-text-secondary text-xs" data-test="security-events-count">
              <template v-if="windowTotal === null">{{
                t("siem.events.latestCount", rows.length)
              }}</template>
              <template v-else-if="windowTotal > rows.length">
                {{
                  t("siem.events.showingOf", {
                    shown: formatEventCount(rows.length),
                    total: formatEventCount(windowTotal),
                  })
                }}
              </template>
              <template v-else>{{
                t("siem.events.count", { n: formatEventCount(windowTotal) }, windowTotal)
              }}</template>
            </span>
            <div class="flex-1" />
            <OButton
              v-if="selectedStream && !sqlMode"
              variant="ghost"
              size="xs"
              :icon-left="showTimeline ? 'expand-less' : 'expand-more'"
              data-test="security-events-toggle-timeline"
              @click="showTimeline = !showTimeline"
            >
              {{ showTimeline ? t("siem.events.hideTimeline") : t("siem.events.showTimeline") }}
            </OButton>
            <OToggleGroup
              :model-value="showRaw ? 'raw' : 'normalized'"
              data-test="security-events-view"
              @update:model-value="(v: unknown) => (showRaw = v === 'raw')"
            >
              <OToggleGroupItem
                data-test="security-events-view-normalized"
                value="normalized"
                size="xs"
                :tooltip="t('siem.events.normalizedHint')"
              >
                {{ t("siem.events.normalized") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="raw" size="xs" data-test="security-events-view-raw">{{
                t("siem.events.raw")
              }}</OToggleGroupItem>
            </OToggleGroup>
          </div>
        </template>

        <template #cell-time="{ row }">
          <span class="text-text-secondary font-mono text-xs whitespace-nowrap">{{
            fmtTs(row.time)
          }}</span>
        </template>
        <template #cell-severityId="{ row }">
          <OTag
            type="severity"
            :value="severityTagValue(row._tone)"
            :label="t(toneLabelKey(row._tone))"
            size="xs"
          />
        </template>
        <template #cell-className="{ row }">
          <span class="text-text-heading truncate font-medium">{{ row.className || "—" }}</span>
        </template>
        <template #cell-statusId="{ row }">
          <OTag
            v-if="row.statusId === 1 || row.statusId === 2"
            :variant="row.statusId === 2 ? 'error-soft' : 'success-soft'"
            size="xs"
            >{{ t(`siem.outcome.${row.statusId === 2 ? "failure" : "success"}`) }}</OTag
          >
          <span v-else class="text-text-secondary">—</span>
        </template>
        <template #cell-srcIp="{ row }">
          <span class="truncate font-mono text-xs">{{ row.srcIp || "—" }}</span>
        </template>
        <template #cell-dstIp="{ row }">
          <span class="truncate font-mono text-xs">{{ row.dstIp || "—" }}</span>
        </template>

        <!-- Every value is a pivot: include or exclude it without leaving the row -->
        <template #cell-hover-actions="{ row, column, active }">
          <div
            v-if="active && pivotFor(row, column.id)"
            class="bg-surface-base border-border-default rounded-default flex items-center border"
          >
            <OButton
              :data-test="`security-events-pivot-include-${column.id}`"
              variant="ghost"
              size="icon-xs"
              icon-left="add-circle-outline"
              @click.stop="
                addFilter(pivotFor(row, column.id)!.field, pivotFor(row, column.id)!.value, '=')
              "
            >
              <OTooltip :content="t('siem.pivot.include')" />
            </OButton>
            <OButton
              :data-test="`security-events-pivot-exclude-${column.id}`"
              variant="ghost"
              size="icon-xs"
              icon-left="block"
              @click.stop="
                addFilter(pivotFor(row, column.id)!.field, pivotFor(row, column.id)!.value, '!=')
              "
            >
              <OTooltip :content="t('siem.pivot.exclude')" />
            </OButton>
          </div>
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="security-events-refresh"
            @click="runSearch"
          >
            <OTooltip side="bottom" :content="t('siem.events.refresh')" />
          </OButton>
        </template>

        <template #empty>
          <OEmptyState
            v-if="!loading"
            size="block"
            icon="search-off"
            :title="t('siem.events.noEvents')"
            :description="t('siem.events.noEventsHint')"
            :filtered="filtersActive"
            @action="onEmptyAction"
          />
        </template>
      </OTable>
    </div>

    <SecurityEventDrawer
      v-if="drawerEvent && drawerNormalized"
      :open="!!drawerEvent"
      :event="drawerEvent"
      :normalized="drawerNormalized"
      :detected="detected"
      :stream="selectedStream ?? ''"
      :org-id="orgId"
      :rules="sigmaRules"
      :share-url="shareUrl"
      :index="drawerIndex"
      :total="rows.length"
      @close="closeDrawer"
      @prev="stepDrawer(-1)"
      @next="stepDrawer(1)"
      @add-filter="addFilter"
    />
  </OPageLayout>
</template>
