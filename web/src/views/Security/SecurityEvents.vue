<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Security Events: one stream normalised onto OCSF, or every source at once; the URL carries the whole view. -->
<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import SecurityNotices, { type SecurityNotice } from "@/components/security/SecurityNotices.vue";
import SecurityAccessLock from "@/components/security/SecurityAccessLock.vue";
import { failedRequests, viewDenial } from "@/composables/useAccessStore";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";
import DateTime from "@/components/DateTime.vue";
import SecurityEventsSources from "@/components/security/events/SecurityEventsSources.vue";
import SecurityEventsDetected from "@/components/security/events/SecurityEventsDetected.vue";
import SecurityEventsFilterBar from "@/components/security/events/SecurityEventsFilterBar.vue";
import SecurityEventsFilterChips from "@/components/security/events/SecurityEventsFilterChips.vue";
import SecurityEventsTopValues from "@/components/security/events/SecurityEventsTopValues.vue";
import SecurityEventsHunt from "@/components/security/events/SecurityEventsHunt.vue";
import SecurityEventsTimeline from "@/components/security/events/SecurityEventsTimeline.vue";
import SecurityEventsTable, {
  type EventRow,
} from "@/components/security/events/SecurityEventsTable.vue";
import SecurityEventDrawer from "./SecurityEventDrawer.vue";
import SecurityNewDetectionDialog, {
  type NewDetectionPreset,
} from "@/components/security/SecurityNewDetectionDialog.vue";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import streamService from "@/services/stream";
import searchService from "@/services/search";
import { runSql } from "@/composables/security/useSecurityStreamPlans";
import { generateTraceContext } from "@/utils/auth";
import type { Classification, SeveritySql } from "@/services/securitySources";
import { fetchSourceMatch } from "@/services/securitySources.queries";
import {
  normalizeEvent,
  normalizeEvents,
  populatedColumns,
  sourceColumnFor,
} from "@/utils/security/normalize";
import { NORMALIZED_COLUMNS, type NormalizedEvent } from "@/utils/security/ocsf";
import { useSigmaRules } from "@/composables/security/useSigmaRules";
import { useEventsDetection } from "@/composables/security/useEventsDetection";
import {
  EMPTY_DATE,
  initialViewState,
  loadSavedCols,
  rangeFor,
  sameRange,
  saveCols,
  useEventsPrefs,
  type DateState,
} from "@/composables/security/useEventsViewState";
import {
  addToSqlWhere,
  eventKey,
  eventsSql,
  filterClause,
  foldHistogram,
  histogramInterval,
  histogramSql,
  isAggregateSql,
  resultColumns,
  SEVERITY_ALIAS,
  splitSeverity,
  topValuesSql,
  whereParts,
  type EventSort,
  type FieldFilter,
  type HistogramResult,
  type SeverityValue,
} from "@/utils/security/eventQuery";
import { ALL_SOURCES, huntLinkQuery, type HuntQuery } from "@/utils/security/huntLink";
import { toneLabelKey, toneOfSeverityId } from "@/utils/security/severity";
import { widerPeriodFor } from "@/utils/security/streams";
import { useSecuritySources } from "@/composables/security/useSecuritySources";
import {
  forbiddenReason,
  isForbiddenError,
  useSecurityAccess,
} from "@/composables/security/useSecurityAccess";
import { FieldIndex } from "@/utils/security/fields";
import { groupFields } from "@/utils/security/fieldGroups";
import { quoteIdent } from "@/utils/security/sql";
import { toast } from "@/lib/feedback/Toast/useToast";
import { displayOrder, positionOf, stepRow, type NavTable } from "@/utils/security/recordNav";
import { b64EncodeUnicode } from "@/utils/formatters";
import { getStreamFromQuery } from "@/utils/query/sqlUtils";

const CodeQueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

// ── View state: the URL is the source of truth; localStorage restores a bare URL ──
const stateKey = () => `oo_sec_events_state_${orgId.value}`;
const colsKey = () => `oo_sec_events_cols_${orgId.value}`;
const initialState = initialViewState(route.query as Record<string, any>, stateKey());

const dateState = ref<DateState>({ ...(initialState.date ?? EMPTY_DATE) });
const timeRange = ref(rangeFor(initialState.date));
// Bumped to remount the picker when the range is set from outside it (chart zoom).
const dateKey = ref(0);

const { showTimeline, showRaw, sidebarWidth, toggleSidebar } = useEventsPrefs(
  () => `oo_sec_events_prefs_${orgId.value}`,
);

const secSources = useSecuritySources();
// Including a source is triage, excluding one weakens coverage (admin), and a detection is authoring.
const { canTriage, canAuthor, canAdmin } = useSecurityAccess();
const {
  streams: streamList,
  loading: streamsLoading,
  sourceNames: secStreamNames,
  suggestions: suggestedSources,
  classifying: classifyingSources,
} = secSources;
// The list answers 200 with no streams for a role without a stream read, which is not "nothing ingested".
const streamDenials = computed(() => [
  viewDenial("streams", "list", [`GET /api/${orgId.value}/security/sources`]),
]);
const selectedStream = ref<string | null>(null);
const isHunt = computed(() => selectedStream.value === ALL_SOURCES);
const huntState = ref<HuntQuery>({ ...initialState.hunt });

const allStreamNames = computed(() => streamList.value.map((s) => String(s.name)));
const sourceByName = computed(() => new Map(secSources.sources.value.map((e) => [e.name, e])));
const otherStreamNames = computed(() =>
  allStreamNames.value.filter((n) => !secStreamNames.value.includes(n)),
);
const streamStats = computed(() => new Map(streamList.value.map((s) => [String(s.name), s.stats])));

const streamOptions = computed(() => {
  const opts: SelectOption[] = [];
  if (secStreamNames.value.length) {
    opts.push({
      label: t("siem.events.securityStreams"),
      value: "__h_sec__",
      header: true,
      headerCount: raw(String(secStreamNames.value.length)),
    });
    opts.push({ label: t("siem.events.allSources"), value: ALL_SOURCES, icon: "manage-search" });
    secStreamNames.value.forEach((n) => opts.push({ label: raw(n), value: n, icon: "shield" }));
  }
  if (otherStreamNames.value.length) {
    opts.push({
      label: t("siem.events.otherStreams"),
      value: "__h_other__",
      header: true,
      headerCount: raw(String(otherStreamNames.value.length)),
    });
    otherStreamNames.value.forEach((n) => opts.push({ label: raw(n), value: n, icon: "database" }));
  }
  return opts;
});

// A refused save leaves the org-wide list unchanged, so the sidebar already shows the truth.
const sourceSaveFailed = (err: unknown, fallback: I18nText) => {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response
    ?.data;
  toast({ variant: "error", message: raw(data?.message ?? data?.error) || fallback });
};
async function addStreamToSecurity(name: string) {
  if (!canTriage.value) return;
  try {
    await secSources.include(name);
  } catch (err) {
    sourceSaveFailed(err, t("siem.events.includeFailed", { name }));
    return;
  }
  analytics.track("security_source_inclusion_changed", { included: true, view: "events" });
  selectedStream.value = name;
}
async function removeStreamFromSecurity(name: string) {
  if (!canAdmin.value) return;
  try {
    await secSources.exclude(name);
  } catch (err) {
    sourceSaveFailed(err, t("siem.events.excludeFailed", { name }));
    return;
  }
  analytics.track("security_source_inclusion_changed", { included: false, view: "events" });
}

interface StreamField {
  name: string;
  ftype: string;
}
const schemaFields = ref<StreamField[]>([]);
const fieldNames = computed(() => schemaFields.value.map((f) => f.name));

const fieldItems = computed<FieldItem[]>(() =>
  groupFields(schemaFields.value).flatMap(({ group, fields }) => [
    { name: `__group_${group}`, isGroup: true, groupName: t(`siem.fieldGroup.${group}`), group },
    ...fields.map((f) => ({ name: f.name, type: f.ftype, group })),
  ]),
);

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

function initColumns(fields: StreamField[]) {
  const names = new Set(fields.map((f) => f.name));
  const restored = (
    selectedStream.value ? loadSavedCols(colsKey(), selectedStream.value) : null
  )?.filter((c) => names.has(c));
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
  if (selectedStream.value) saveCols(colsKey(), selectedStream.value, visibleCols.value);
  showRaw.value = true;
}

const sqlQuery = ref(initialState.query);
const sqlMode = ref(initialState.sqlMode);
const severityFilter = ref<SeverityValue[]>([]);
const fieldFilters = ref<FieldFilter[]>([...initialState.filters]);

const notices = computed<SecurityNotice[]>(() =>
  selectedStream.value && sqlMode.value
    ? [
        {
          key: "sql-timeline",
          tone: "info",
          text: t("siem.events.sqlTimelineNote"),
          dataTest: "security-events-sql-timeline-note",
        },
      ]
    : [],
);

// The server owns the severity definition, so the tiles, chart and rows all read the same one.
const severityExpr = ref<SeveritySql | null>(null);
const severitySql = computed(() => severityExpr.value?.sql ?? null);
const hasSeverity = computed(() => !!severitySql.value);

const severityOptions = computed<SelectOption[]>(() =>
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

const filters = computed(() => ({
  severitySql: severitySql.value,
  severity: severityFilter.value,
  filters: fieldFilters.value,
}));

// ── Filters ──────────────────────────────────────────────────────────────────
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
const PAGE_SIZES = [50, 100, 250];
const page = ref(1);
const pageSize = ref(PAGE_SIZES[0]);
const sortBy = ref("time");
const sortOrder = ref<"asc" | "desc">("desc");
const events = ref<Record<string, any>[]>([]);
/** The server's severity per row of `events`; null where the query did not project it. */
const rowSeverity = ref<(number | null)[]>([]);
/** An aggregate or computed SQL result: shown as returned, never read as events. */
const resultMode = ref(false);
const resultCols = ref<string[]>([]);
/** The table a hand-written query reads, when it is a stream the picker knows. */
const queryOnPicked = ref(true);
const loading = ref(false);
const errorMsg = ref("");
/** The search was refused for a missing stream read, which the page shows as a lock rather than an error. */
const searchRefusal = shallowRef<unknown>(null);
const searchDenials = computed(() =>
  searchRefusal.value ? [viewDenial("streams", "list", failedRequests(searchRefusal.value))] : [],
);
const lastRunAt = ref<number | null>(null);

const detected = ref<Classification | null>(null);
let detectSeq = 0;
async function detectSource(sample: Record<string, unknown> | null = events.value[0] ?? null) {
  const seq = ++detectSeq;
  const fields = fieldNames.value;
  if (!fields.length) {
    detected.value = null;
    severityExpr.value = null;
    return;
  }
  try {
    const match = await fetchSourceMatch(orgId.value, fields, sample);
    if (seq !== detectSeq) return;
    detected.value = match.classification;
    severityExpr.value = match.severity;
  } catch {
    if (seq !== detectSeq) return;
    detected.value = null;
    severityExpr.value = null;
  }
}

const normalizedEvents = computed<NormalizedEvent[]>(() =>
  normalizeEvents(
    events.value as Record<string, unknown>[],
    detected.value?.source ?? null,
    rowSeverity.value,
  ),
);
const normalizedColumns = computed(
  () => populatedColumns(normalizedEvents.value, NORMALIZED_COLUMNS) as (keyof NormalizedEvent)[],
);

const { loadClassMix, detectedSummary } = useEventsDetection({
  orgId,
  detected,
  fieldNames,
  events,
  selectedStream,
});

// ── Table ────────────────────────────────────────────────────────────────────
type Row = EventRow;
const rows = computed<Row[]>(() =>
  resultMode.value
    ? events.value.map((raw, i) => ({
        ...normalizeEvent(raw, null, 0),
        _key: `result-${i}`,
        _tone: "unknown",
      }))
    : normalizedEvents.value.map((ev, i) => ({
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

/** Stored column a table column sorts by on the server; null when it has none. */
function sortFieldFor(columnId: string): string | null {
  if (columnId === "time") return "_timestamp";
  if (columnId.startsWith("raw:")) return columnId.slice(4);
  if (columnId === "severityId") return hasSeverity.value ? SEVERITY_ALIAS : null;
  const index = new FieldIndex(fieldNames.value);
  const paths = detected.value?.source.map[columnId as keyof NormalizedEvent] as
    string[] | undefined;
  for (const path of paths ?? []) {
    for (const option of path.split("|")) {
      const column = index.resolve(option);
      if (column) return column;
    }
  }
  return null;
}

// A plain-row query can return columns the schema lacks (aliases, computed fields).
const extraCols = computed(() => {
  if (!sqlMode.value || resultMode.value) return [];
  const known = new Set([...fieldNames.value, ...visibleCols.value]);
  return resultColumns(null, events.value).filter((c) => !known.has(c));
});

const columns = computed<OTableColumnDef<Row>[]>(() => {
  if (resultMode.value) {
    return resultCols.value.map((col) => ({
      id: `res:${col}`,
      header: raw(col),
      accessorFn: (row: Row) => readRaw(row.raw, col),
      size: 180,
      sortable: false,
      meta: { rawField: col },
    }));
  }
  if (showRaw.value) {
    return [...visibleCols.value, ...extraCols.value].map((col) => ({
      id: col === "_timestamp" ? "time" : `raw:${col}`,
      header: col === "_timestamp" ? t("siem.column.time") : raw(col),
      accessorFn: (row: Row) => (col === "_timestamp" ? row.time : readRaw(row.raw, col)),
      size: col === "_timestamp" ? 170 : 180,
      sortable: true,
      meta: { rawField: col },
    }));
  }
  return normalizedColumns.value.map((col) => ({
    id: col,
    header: t(`siem.column.${col}`),
    accessorKey: col,
    size: COLUMN_SIZE[col] ?? 160,
    hideable: col !== "time" && col !== "severityId",
    sortable: !!sortFieldFor(col),
    meta: { isName: col === "className" },
  }));
});

const currentSort = computed<EventSort | null>(() => {
  const field = sortFieldFor(sortBy.value);
  return field ? { field, order: sortOrder.value } : null;
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
// Prev/next walk the table as displayed, and turn the server page at its ends.
const eventsTable = ref<{ table?: NavTable<Row> } | null>(null);
const isDrawerRow = (r: Row) => eventKey(r.raw) === drawerKey.value;
const pageOffset = computed(() => (page.value - 1) * pageSize.value);
const drawerIndex = computed(() => {
  const i = positionOf(displayOrder(eventsTable.value?.table, rows.value), isDrawerRow);
  return i === null ? null : i + pageOffset.value;
});
async function stepDrawer(delta: number) {
  const next = stepRow(eventsTable.value?.table, rows.value, isDrawerRow, delta);
  if (next) {
    openDrawer(next.row);
    return;
  }
  const target = page.value + delta;
  if (target < 1 || (delta > 0 && !hasNextPage.value)) return;
  page.value = target;
  await runSearch({ pageOnly: true });
  const edge = delta > 0 ? rows.value[0] : rows.value[rows.value.length - 1];
  if (edge) openDrawer(edge);
}
const rowClass = (row: Row) => (isActiveRow(row) ? "!bg-table-row-selected-bg" : "");

/** Field + value a cell pivots on, or null when the value was derived. */
function pivotFor(row: Row, columnId: string): { field: string; value: string } | null {
  if (resultMode.value) {
    // Only a stored column of the queried table can narrow the query.
    const field = columnId.startsWith("res:") ? columnId.slice(4) : "";
    const value = readRaw(row.raw, field);
    return queryOnPicked.value && fieldNames.value.includes(field) && value
      ? { field, value }
      : null;
  }
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

// ── Timeline + severity tiles (server-side, whole window) ────────────────────
const histogram = ref<HistogramResult | null>(null);
const histogramLoading = ref(false);
/** Whether `histogram` describes the search currently on screen. */
const histogramFresh = ref(false);

// A slow older search's response is dropped, never overwriting a newer one.
let searchSeq = 0;

async function runHistogram(seq: number, run: SearchRun) {
  const stream = selectedStream.value;
  if (!stream || sqlMode.value || isHunt.value) {
    histogram.value = null;
    return;
  }
  histogramLoading.value = true;
  const { start, end } = timeRange.value;
  const interval = histogramInterval((end - start) / 1000);
  try {
    const { hits } = await runSql(
      orgId.value,
      histogramSql(stream, whereParts(filters.value, false), severitySql.value, interval.sql),
      start,
      end,
      -1,
      { signal: run.controller.signal, traceId: run.histogramTrace.traceId },
    );
    if (seq !== searchSeq) return;
    histogram.value = foldHistogram(hits, hasSeverity.value);
    histogramFresh.value = true;
  } catch {
    if (seq === searchSeq) histogram.value = null;
  } finally {
    if (seq === searchSeq) histogramLoading.value = false;
  }
}

// Exact window total from the histogram; null in SQL mode or before it lands.
const windowTotal = computed<number | null>(() => {
  const h = histogram.value;
  if (!h || !histogramFresh.value || sqlMode.value) return null;
  if (!severityFilter.value.length) return h.total;
  return severityFilter.value.reduce<number>((sum, v) => sum + (h.idCounts[v] ?? 0), 0);
});
/** A full page may have more behind it even when no exact total is known. */
const hasNextPage = computed(() =>
  windowTotal.value !== null
    ? pageOffset.value + rows.value.length < windowTotal.value
    : rows.value.length >= pageSize.value,
);
const pagerTotal = computed(() =>
  windowTotal.value !== null
    ? windowTotal.value
    : pageOffset.value + rows.value.length + (hasNextPage.value ? 1 : 0),
);

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

const expandedField = ref<string | null>(null);
const topValues = ref<{ value: string; count: number }[]>([]);
const topValuesLoading = ref(false);

async function fetchTopValues(
  field: string,
  limit = 10,
): Promise<{ value: string; count: number }[]> {
  const stream = selectedStream.value;
  if (!stream || isHunt.value) return [];
  const { start, end } = timeRange.value;
  try {
    const { hits } = await runSql(
      orgId.value,
      topValuesSql(stream, sqlMode.value ? [] : whereParts(filters.value), field, limit),
      start,
      end,
      limit,
    );
    return hits
      .filter((h: any) => h.zo_value !== null && h.zo_value !== undefined && h.zo_value !== "")
      .map((h: any) => ({ value: String(h.zo_value), count: Number(h.zo_n ?? 0) }));
  } catch {
    return [];
  }
}
const builderValues = (field: string) => fetchTopValues(field, 50);

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
let compiledKey = "";
let countedKey = "";

async function refreshRules() {
  const stream = selectedStream.value;
  const { start, end } = timeRange.value;
  const key = JSON.stringify([
    orgId.value,
    stream,
    detected.value?.source.id ?? null,
    fieldNames.value,
    start,
    end,
  ]);
  // Recompiling clears the counts, so it only happens when their inputs change.
  if (key !== compiledKey) {
    compiledKey = key;
    await compileFor(orgId.value, detected.value?.source ?? null, fieldNames.value);
    if (key !== compiledKey) return;
    if (rulesError.value) compiledKey = "";
  }
  if (!showRules.value || !stream || !runnableCount.value || key === countedKey) return;
  countedKey = key;
  void countHits(orgId.value, stream, timeRange.value).then(() => {
    if (rulesError.value && countedKey === key) countedKey = "";
  });
}
watch(showRules, (open) => {
  if (open) void refreshRules();
});

const detectionList = useSiemDetections();
const existingAlertNames = computed(() =>
  detectionList.alerts.value.map((alert) => String(alert.name ?? "")),
);
const newDetectionOpen = ref(false);
const newDetectionPreset = ref<NewDetectionPreset | null>(null);
// The dialog opens over Events, so the analyst keeps the query and results they started from.
function createDetectionFrom(sigmaId: string) {
  if (!canAuthor.value) return;
  newDetectionPreset.value = {
    sigmaId,
    stream: selectedStream.value ?? undefined,
    source: detected.value?.source.id ?? undefined,
  };
  newDetectionOpen.value = true;
  void detectionList.load(orgId.value);
}

function filterByRule(where: string) {
  const stream = selectedStream.value;
  if (!stream) return;
  sqlMode.value = true;
  sqlQuery.value = `SELECT * FROM ${quoteIdent(stream)} WHERE ${where} ORDER BY _timestamp DESC`;
  showRules.value = false;
  void runSearch();
}

function openDrawer(row: Row) {
  if (resultMode.value) return;
  if (!drawerEvent.value) analytics.track("security_detail_opened", { view: "events" });
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
// A shared link pins the absolute window; a relative one resolves on the viewer's clock.
const shareUrl = computed(() => {
  if (!drawerEvent.value || typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  Object.entries(buildQuery(true)).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url.toString();
});

function buildSQL(): string {
  const stream = selectedStream.value;
  if (!stream) return "";
  if (sqlMode.value && sqlQuery.value.trim()) return sqlQuery.value.trim();
  return eventsSql(
    stream,
    sqlMode.value ? [] : whereParts(filters.value),
    currentSort.value,
    severitySql.value,
  );
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

function buildQuery(pinTime = false): Record<string, string> {
  const q: Record<string, string> = { org_identifier: orgId.value };
  if (selectedStream.value) q.stream = selectedStream.value;
  if (dateState.value.type === "relative" && !pinTime) {
    q.period = dateState.value.period || "15m";
  } else {
    q.from = String(timeRange.value.start);
    q.to = String(timeRange.value.end);
  }
  if (isHunt.value) {
    if (huntState.value.value) Object.assign(q, huntLinkQuery(huntState.value));
    return q;
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
        hunt: huntState.value,
      }),
    );
  } catch {
    /* the URL still carries the full state */
  }
}

let streamsSeq = 0;
async function loadStreams() {
  const seq = ++streamsSeq;
  await secSources.load(orgId.value);
  if (seq !== streamsSeq) return;
  const wanted = initialState.stream;
  if (wanted === ALL_SOURCES || (wanted && allStreamNames.value.includes(wanted)))
    selectedStream.value = wanted;
  else selectedStream.value = newestSource();
}

/** The Security source that reported last; none leaves the page on its empty state. */
function newestSource(): string | null {
  const last = (name: string) => Number(streamStats.value.get(name)?.doc_time_max ?? 0);
  return secStreamNames.value.reduce<string | null>(
    (best, name) => (best === null || last(name) > last(best) ? name : best),
    null,
  );
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
    // Identified from the schema first so severity is known before the first search.
    await detectSource(null);
    void loadClassMix(streamName);
  } catch {
    if (selectedStream.value === streamName) schemaFields.value = [];
  }
}

let mountComplete = false;

interface SearchRun {
  controller: AbortController;
  searchTrace: { traceparent: string; traceId: string };
  histogramTrace: { traceparent: string; traceId: string };
}
let activeRun: SearchRun | null = null;

const huntRef = ref<InstanceType<typeof SecurityEventsHunt> | null>(null);
const huntLoading = ref(false);

/** Stops the running search and its histogram, in the browser and on the server. */
function cancelSearch({ quiet = false } = {}) {
  huntRef.value?.cancel();
  const run = activeRun;
  if (!run) return;
  activeRun = null;
  run.controller.abort();
  ++searchSeq;
  loading.value = false;
  histogramLoading.value = false;
  if (!quiet) errorMsg.value = t("siem.events.cancelled");
  searchService
    .delete_running_queries(orgId.value, [run.searchTrace.traceId, run.histogramTrace.traceId])
    .catch(() => {});
}

onBeforeUnmount(() => cancelSearch({ quiet: true }));

/** Searches the window; a page or sort change keeps the timeline and fetches only rows. */
async function runSearch({ pageOnly = false, userRun = false } = {}) {
  if (mountComplete) syncUrl();
  if (isHunt.value) {
    await huntRef.value?.run();
    return;
  }
  if (!selectedStream.value || !orgId.value) return;
  if (!sqlMode.value || !sqlQuery.value.trim()) queryOnPicked.value = true;
  else if (!pageOnly && (await followQueryTable())) return;
  if (!pageOnly) page.value = 1;
  if (dateState.value.type === "relative" && !pageOnly) timeRange.value = rangeFor(dateState.value);
  cancelSearch({ quiet: true });
  const run: SearchRun = {
    controller: new AbortController(),
    searchTrace: generateTraceContext(),
    histogramTrace: generateTraceContext(),
  };
  activeRun = run;
  loading.value = true;
  errorMsg.value = "";
  searchRefusal.value = null;
  const { start, end } = timeRange.value;
  const seq = ++searchSeq;
  if (!pageOnly) histogramFresh.value = false;
  const histogramDone = pageOnly ? Promise.resolve() : runHistogram(seq, run);
  const sql = buildSQL();
  try {
    const res = await searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: {
            sql,
            start_time: start,
            end_time: end,
            from: pageOffset.value,
            size: pageSize.value,
          },
        },
        page_type: "logs",
        signal: run.controller.signal,
        traceparent: run.searchTrace.traceparent,
      },
      "ui",
    );
    if (seq !== searchSeq) return;
    const hits: Record<string, unknown>[] = res.data?.hits ?? [];
    const split = splitSeverity(hits);
    resultMode.value =
      sqlMode.value && (isAggregateSql(sql) || (hits.length > 0 && !("_timestamp" in hits[0])));
    resultCols.value = resultMode.value ? resultColumns(res.data?.columns, split.rows) : [];
    events.value = split.rows;
    rowSeverity.value = split.severity;
    if (!resultMode.value && !schemaFields.value.length && events.value.length) {
      schemaFields.value = Object.keys(events.value[0]).map((k) => ({ name: k, ftype: "Utf8" }));
      initColumns(schemaFields.value);
    }
    if (queryOnPicked.value) {
      // A computed row would misidentify the source, so only a stored event is a sample.
      await detectSource(resultMode.value ? null : (events.value[0] ?? null));
      if (seq !== searchSeq) return;
      if (!pageOnly) void refreshRules();
    }
    if (drawerEvent.value) {
      const fresh = events.value.find((e) => eventKey(e) === drawerKey.value);
      if (fresh) drawerEvent.value = fresh;
    }
    lastRunAt.value = Date.now();
    if (userRun) {
      analytics.track("security_events_searched", {
        mode: sqlMode.value ? "sql" : "builder",
        filters: sqlMode.value ? 0 : fieldFilters.value.length,
        severity_filtered: severityFilter.value.length > 0,
      });
    }
  } catch (e: any) {
    if (seq !== searchSeq) return;
    if (isForbiddenError(e)) searchRefusal.value = e;
    else
      errorMsg.value =
        e?.response?.data?.error ??
        e?.response?.data?.message ??
        e?.message ??
        t("siem.events.searchFailed");
    events.value = [];
  } finally {
    if (seq === searchSeq) loading.value = false;
  }
  if (expandedField.value && !pageOnly) void loadTopValues(expandedField.value);
  await histogramDone;
  if (activeRun === run) activeRun = null;
}

/** Points the picker at a hand-written query's table; true when that re-runs the search. */
async function followQueryTable(): Promise<boolean> {
  const query = sqlQuery.value.trim();
  const table = String((await getStreamFromQuery(query)) ?? "");
  if (table && table !== selectedStream.value && allStreamNames.value.includes(table)) {
    pendingSql = query;
    selectedStream.value = table;
    return true;
  }
  queryOnPicked.value = table === selectedStream.value;
  // Rows from a table the page cannot identify are shown as they are, not as the picked source.
  if (!queryOnPicked.value) {
    detected.value = null;
    severityExpr.value = null;
  }
  return false;
}

function onPage({ page: p, size }: { page: number; size: number }) {
  if (p === page.value && size === pageSize.value) return;
  if (size !== pageSize.value) {
    pageSize.value = size;
    page.value = 1;
  } else page.value = p;
  void runSearch({ pageOnly: true });
}

function onSort({ column, order }: { column: string; order: "asc" | "desc" }) {
  sortBy.value = column;
  sortOrder.value = order;
  page.value = 1;
  void runSearch({ pageOnly: true });
}

async function restoreDrawerFromUrl() {
  const ts = pendingEventTs.value;
  if (!ts || drawerEvent.value) return;
  // A content key needs that exact event, since others share its timestamp.
  const inPage = pendingEventKey.value
    ? events.value.find((e) => eventKey(e) === pendingEventKey.value)
    : events.value.find((e) => String(e._timestamp) === ts);
  if (inPage) {
    drawerEvent.value = inPage;
    pendingEventTs.value = null;
    pendingEventKey.value = null;
    return;
  }
  const tsNum = Number(ts);
  const stream = selectedStream.value;
  if (Number.isFinite(tsNum) && stream) {
    try {
      const { hits } = await runSql(
        orgId.value,
        `SELECT * FROM "${stream.replace(/"/g, '""')}" WHERE _timestamp = ${tsNum}`,
        tsNum - 1_000_000,
        tsNum + 1_000_000,
        100,
      );
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

// ── Cross-source hunt ────────────────────────────────────────────────────────
/** A hunt row the analyst opened: its stream loads, then its event opens in the drawer. */
let huntJump: { stream: string; ts: number } | null = null;

function onHuntQuery(q: HuntQuery) {
  huntState.value = q;
  if (mountComplete) syncUrl();
}

function openFromHunt(stream: string, ts: number) {
  huntJump = { stream, ts };
  selectedStream.value = stream;
}

// ── Watchers ─────────────────────────────────────────────────────────────────
let suppressSeverityWatch = false;
function applySeverity(values: SeverityValue[]) {
  suppressSeverityWatch = true;
  severityFilter.value = values.map(Number).filter((n) => Number.isInteger(n));
  void nextTick(() => (suppressSeverityWatch = false));
}

/** A query the picker switched streams for; the switch keeps it instead of resetting to the builder. */
let pendingSql: string | null = null;

let switchingStream = false;
watch(selectedStream, async (v) => {
  if (!mountComplete || !v) return;
  switchingStream = true;
  const keptSql = pendingSql;
  pendingSql = null;
  fieldFilters.value = [];
  sqlQuery.value = keptSql ?? "";
  sqlMode.value = keptSql !== null;
  queryOnPicked.value = true;
  resultMode.value = false;
  drawerEvent.value = null;
  pendingEventTs.value = null;
  pendingEventKey.value = null;
  expandedField.value = null;
  showRules.value = false;
  sortBy.value = "time";
  sortOrder.value = "desc";
  if (v === ALL_SOURCES) {
    cancelSearch({ quiet: true });
    schemaFields.value = [];
    detected.value = null;
    severityExpr.value = null;
    events.value = [];
    histogram.value = null;
    switchingStream = false;
    await nextTick();
    void runSearch();
    return;
  }
  await loadSchema(v);
  if (selectedStream.value !== v) return;
  applySeverity([]);
  switchingStream = false;
  const jump = huntJump?.stream === v ? huntJump : null;
  huntJump = null;
  await runSearch();
  if (jump && selectedStream.value === v) {
    pendingEventTs.value = String(jump.ts);
    await restoreDrawerFromUrl();
    syncUrl();
  }
});
// The facet follows a moved severity column; a URL severity is re-applied once.
let severityRestorePending = initialState.severity.length > 0;
watch(severitySql, (next, prev) => {
  if (!mountComplete || switchingStream || next === prev) return;
  applySeverity(severityRestorePending ? initialState.severity : []);
  severityRestorePending = false;
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
  analytics.track("security_time_range_changed", {
    view: "events",
    range: relative ? "relative" : "absolute",
  });
  void runSearch();
}

onMounted(async () => {
  await loadStreams();
  if (selectedStream.value && !isHunt.value) {
    await loadSchema(selectedStream.value);
    applySeverity(initialState.severity);
  }
  mountComplete = true;
  if (isHunt.value) {
    await nextTick();
    await runSearch();
  } else if (selectedStream.value) {
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
  else if (widerPeriod.value) widenTo(widerPeriod.value);
}

// An empty window the stream has not reported in is not "no events": offer one that reaches it.
const lastReportedUs = computed(() =>
  Number(streamStats.value.get(selectedStream.value ?? "")?.doc_time_max ?? 0),
);
const widerPeriod = computed(() =>
  // A filter or hand-written query can empty the page; the last event says nothing then.
  filtersActive.value || (sqlMode.value && sqlQuery.value.trim())
    ? null
    : widerPeriodFor(lastReportedUs.value, timeRange.value.start),
);
const emptyHint = computed(() => {
  if (!widerPeriod.value) return t("siem.events.noEventsHint");
  const mins = Math.max(0, Math.round((Date.now() * 1000 - lastReportedUs.value) / 60_000_000));
  const ago =
    mins < 60
      ? t("siem.detections.ago.minutes", { n: mins })
      : mins < 1440
        ? t("siem.detections.ago.hours", { n: Math.round(mins / 60) })
        : t("siem.detections.ago.days", { n: Math.round(mins / 1440) });
  return t("siem.events.noEventsLastReported", { stream: selectedStream.value, ago });
});
function widenTo(period: string) {
  dateState.value = { type: "relative", period, absolute: null };
  timeRange.value = rangeFor(dateState.value);
  dateKey.value += 1;
  void runSearch();
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
          v-if="loading || histogramLoading || huntLoading"
          variant="outline-destructive"
          size="sm"
          icon-left="close"
          data-test="security-events-cancel"
          @click="cancelSearch()"
        >
          {{ t("siem.events.cancel") }}
        </OButton>
        <OButton
          v-else
          variant="primary"
          size="sm"
          icon-left="play-arrow"
          data-test="security-events-run"
          @click="runSearch({ userRun: true })"
        >
          {{ t("siem.events.run") }}
        </OButton>
      </div>
    </template>

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
              :aria-label="t('siem.aria.stream')"
              :model-value="selectedStream"
              :options="streamOptions"
              icon-key="icon"
              :placeholder="t('siem.events.selectStream')"
              :loading="streamsLoading"
              searchable
              data-test="security-events-stream"
              @update:model-value="selectedStream = $event as string"
            />
          </div>
          <OToggleGroup
            v-if="!isHunt"
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

          <SecurityEventsFilterBar
            v-if="!sqlMode && !isHunt"
            :field-names="fieldNames"
            :has-severity="hasSeverity"
            :severity-options="severityOptions"
            :severity="severityFilter"
            :load-values="builderValues"
            @update:severity="severityFilter = $event"
            @add="addFilter"
          />
        </div>

        <SecurityEventsFilterChips
          v-if="!sqlMode && !isHunt"
          :filters="fieldFilters"
          @invert="invertFilter"
          @remove="removeFilter"
          @clear="clearFilters"
        />

        <div
          v-if="sqlMode && !isHunt"
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
            @run-query="runSearch({ userRun: true })"
          />
        </div>
      </div>
    </template>

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
          <SecurityEventsSources
            :names="secStreamNames"
            :selected="selectedStream"
            :stream-stats="streamStats"
            :source-by-name="sourceByName"
            :suggestions="suggestedSources"
            :classifying="classifyingSources"
            :other-names="otherStreamNames"
            :can-include="canTriage"
            :can-exclude="canAdmin"
            @select="selectedStream = $event"
            @remove="removeStreamFromSecurity"
            @add="addStreamToSecurity"
            @dismiss="secSources.dismiss($event)"
          />
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
          <SecurityEventsTopValues
            :field="row.name"
            :values="topValues"
            :loading="topValuesLoading"
            :whole-stream="sqlMode"
            @add="addFilter"
          />
        </template>

        <template #empty>
          {{
            isHunt
              ? t("siem.events.hunt.noFields")
              : selectedStream
                ? t("siem.events.noFields")
                : t("siem.events.selectStreamFirst")
          }}
        </template>
      </OFieldList>
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <SecurityEventsDetected
        v-if="detectedSummary && !isHunt"
        v-model:show-rules="showRules"
        :summary="detectedSummary"
        :rules="sigmaRules"
        :counting="rulesCounting"
        :error="rulesError"
        :runnable-count="runnableCount"
        :firing-count="firingCount"
        :can-create="canAuthor"
        @filter-by-rule="filterByRule"
        @create-detection="createDetectionFrom"
      />

      <SecurityEventsTimeline
        v-if="selectedStream && !isHunt && !sqlMode && showTimeline"
        v-model:severity="severityFilter"
        :histogram="histogram"
        :loading="histogramLoading"
        :has-severity="hasSeverity"
        :start="timeRange.start"
        :end="timeRange.end"
        @zoom="onChartZoom"
      />
      <SecurityNotices
        v-else
        :notices="notices"
        class="mx-page-edge my-2"
        data-test="security-events-notices"
      />

      <SecurityAccessLock
        v-if="!selectedStream && !streamsLoading && !secSources.streamsReadable.value"
        :denials="streamDenials"
        size="hero"
        data-test="security-events-access-lock"
      />
      <OEmptyState
        v-else-if="!selectedStream && !streamsLoading"
        size="hero"
        icon="manage-search"
        :title="t('siem.events.noStreamTitle')"
        :description="t('siem.events.noStreamHint')"
      />
      <SecurityEventsHunt
        v-else-if="isHunt"
        ref="huntRef"
        :org-id="orgId"
        :start="timeRange.start"
        :end="timeRange.end"
        :initial="huntState"
        @update:query="onHuntQuery"
        @open-event="openFromHunt"
        @loading="huntLoading = $event"
      />
      <SecurityAccessLock
        v-else-if="searchDenials.length"
        :denials="searchDenials"
        :reason="raw(forbiddenReason(searchRefusal))"
        size="hero"
        data-test="security-events-search-lock"
      />
      <SecurityEventsTable
        v-else
        ref="eventsTable"
        v-model:show-raw="showRaw"
        v-model:show-timeline="showTimeline"
        :rows="rows"
        :columns="columns"
        :loading="loading"
        :error="errorMsg"
        :page="page"
        :page-size="pageSize"
        :page-sizes="PAGE_SIZES"
        :total="pagerTotal"
        :total-exact="windowTotal !== null"
        :sort-by="sortBy"
        :sort-order="sortOrder"
        :sql-mode="sqlMode"
        :result-table="resultMode"
        :can-show-timeline="!!selectedStream && !sqlMode"
        :row-class="rowClass"
        :pivot-for="pivotFor"
        :empty-hint="emptyHint"
        :filtered="filtersActive"
        :wider-period="widerPeriod"
        @row-click="openDrawer"
        @pagination-change="onPage"
        @sort-change="onSort"
        @refresh="runSearch()"
        @add-filter="addFilter"
        @empty-action="onEmptyAction"
      />
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
      :total="pagerTotal"
      @close="closeDrawer"
      @prev="stepDrawer(-1)"
      @next="stepDrawer(1)"
      @add-filter="addFilter"
    />
    <SecurityNewDetectionDialog
      v-model:open="newDetectionOpen"
      :org-id="orgId"
      :preset="newDetectionPreset"
      :existing-names="existingAlertNames"
    />
  </OPageLayout>
</template>
