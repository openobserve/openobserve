<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import DateTime from "@/components/DateTime.vue";
import SecurityEventDrawer from "./SecurityEventDrawer.vue";
import streamService from "@/services/stream";
import searchService from "@/services/search";
import { bestMatch, isSecuritySource, type Classification } from "@/utils/security/classify";
import { buildFacets, normalizeEvents, populatedColumns } from "@/utils/security/normalize";
import {
  NORMALIZED_COLUMNS,
  ocsfCategoryOf,
  ocsfSeverity,
  ocsfStatusName,
} from "@/utils/security/ocsf";
import { sigmaLogsourceLabel } from "@/utils/security/sourceTypes";
import type { NormalizedEvent } from "@/utils/security/ocsf";
import { blockedReason, caveat } from "@/utils/security/sigma";
import { useSigmaRules } from "@/composables/security/useSigmaRules";
import { b64EncodeUnicode, b64DecodeUnicodeSafe } from "@/utils/formatters";

// ── Store / route ─────────────────────────────────────────────────────────────
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

// ── View state persistence ────────────────────────────────────────────────────
// The URL is the source of truth, exactly like the logs explorer: every knob the
// user turns is written back with router.replace, so a refresh or a shared link
// rebuilds the same view. A copy is mirrored into localStorage so landing on the
// page with a bare URL (nav click, new tab) still restores the last selection.
//
//   stream    selected stream name
//   period    relative range, e.g. "15m" (mutually exclusive with from/to)
//   from,to   absolute range in microseconds
//   sql_mode  "true" when the raw-SQL editor is active
//   query     base64 SQL (sql mode only)
//   severity  comma-separated severity/level selection
//   filters   base64 JSON array of { field, op, value }
//   event_ts  _timestamp of the event whose detail drawer is open
interface FieldFilter {
  field: string;
  op: string;
  value: string;
}
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

type SeverityValue = number | string;

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
] as const;

function stateKey() {
  return `oo_sec_events_state_${orgId.value}`;
}
function colsKey() {
  return `oo_sec_events_cols_${orgId.value}`;
}

function parseFilters(raw: string): FieldFilter[] {
  try {
    const json = raw.trim().startsWith("[") ? raw : b64DecodeUnicodeSafe(raw, "[]");
    const parsed = JSON.parse(json);
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

const EMPTY_DATE: DateState = { type: "relative", period: "15m", absolute: null };

function stateFromUrl(): ViewState | null {
  const q = route.query as Record<string, any>;
  if (!URL_KEYS.some((k) => q[k] != null && q[k] !== "")) return null;
  const date: DateState =
    q.from && q.to
      ? {
          type: "absolute",
          period: "",
          absolute: { startTime: Number(q.from), endTime: Number(q.to) },
        }
      : { type: "relative", period: String(q.period ?? "15m"), absolute: null };
  return {
    stream: q.stream ? String(q.stream) : null,
    sqlMode: String(q.sql_mode) === "true",
    query: q.query ? b64DecodeUnicodeSafe(String(q.query), "") : "",
    // Severity values stay strings here; they are coerced to numbers once the
    // stream schema tells us whether the field is the numeric OCSF scale.
    severity: q.severity
      ? String(q.severity)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    filters: q.filters ? parseFilters(String(q.filters)) : [],
    date,
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
      // A stale drawer target shouldn't reopen on a fresh visit — only a URL does that.
      eventTs: null,
    };
  } catch {
    return null;
  }
}

// URL wins; a bare URL falls back to the last session; otherwise defaults.
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

// Mirrors what the DateTime picker last reported, so the URL can carry a relative
// period (which survives a refresh as "last 15m") rather than pinned timestamps.
const dateState = ref<DateState>({ ...initialState.date });

// "15m" / "2h" / "7d" → microseconds, matching the DateTime picker's period format.
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
  if (!m) return 15 * 60 * 1_000_000;
  return Number(m[1]) * (PERIOD_MICROS[m[2]] ?? PERIOD_MICROS.m);
}
// Seeds the first search with the restored range so results are correct even
// before the DateTime picker has mounted and reported back.
function initialTimeRange() {
  const d = initialState.date;
  if (d.type === "absolute" && d.absolute?.startTime && d.absolute?.endTime) {
    return { start: Number(d.absolute.startTime), end: Number(d.absolute.endTime) };
  }
  const end = Date.now() * 1000;
  return { start: end - relativeToMicros(d.period), end };
}

// Per-stream column choices — not in the URL (it would get unwieldy); localStorage
// only, mirroring how the logs explorer remembers selected fields.
function loadSavedCols(stream: string): string[] | null {
  try {
    const all = JSON.parse(localStorage.getItem(colsKey()) ?? "{}");
    const cols = all?.[stream];
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
    /* quota / private mode — column memory is best-effort */
  }
}

// ── Splitter sizes ────────────────────────────────────────────────────────────
const topSplitter = ref(120);
const sideSplitter = ref(240);

// ── Security stream registry (localStorage-backed) ────────────────────────────
// Key: oo_sec_streams_<orgId> → string[] (user-tagged stream names)
// Key: oo_sec_ocsf_<orgId>   → Record<stream, boolean> (OCSF+Sigma flags)
const SEC_RE = /security|audit|siem|event|login|auth|access|cloudtrail|okta|firewall|vpc|cdc/i;

function lsKey(suffix: string) {
  return `oo_sec_${suffix}_${orgId.value}`;
}

function loadTaggedStreams(): string[] {
  try {
    return JSON.parse(localStorage.getItem(lsKey("streams")) ?? "[]");
  } catch {
    return [];
  }
}
function saveTaggedStreams(list: string[]) {
  localStorage.setItem(lsKey("streams"), JSON.stringify(list));
}
function loadOcsfFlags(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(lsKey("ocsf")) ?? "{}");
  } catch {
    return {};
  }
}
function saveOcsfFlags(flags: Record<string, boolean>) {
  localStorage.setItem(lsKey("ocsf"), JSON.stringify(flags));
}

const taggedStreams = ref<string[]>([]); // user-added (non-auto-detected) streams
const ocsfFlags = ref<Record<string, boolean>>({});

// Add a stream to security (+ button)
function addStreamToSecurity(name: string) {
  if (!taggedStreams.value.includes(name)) {
    taggedStreams.value.push(name);
    saveTaggedStreams(taggedStreams.value);
  }
  // Enable OCSF + Sigma for this stream
  ocsfFlags.value[name] = true;
  saveOcsfFlags(ocsfFlags.value);
  buildStreamOptions();
  if (!selectedStream.value) selectedStream.value = name;
}

// Remove a stream from security (- button on tagged streams)
function removeStreamFromSecurity(name: string) {
  taggedStreams.value = taggedStreams.value.filter((s) => s !== name);
  saveTaggedStreams(taggedStreams.value);
  // Note: don't remove OCSF flag — if re-added, it should be pre-enabled
  buildStreamOptions();
  if (selectedStream.value === name) selectedStream.value = null;
}

// Auto-detected + user-tagged = full security set
const allStreams = ref<string[]>([]);
const secStreamNames = computed(() => {
  const auto = allStreams.value.filter((n) => SEC_RE.test(n));
  const tagged = taggedStreams.value.filter((n) => !auto.includes(n));
  return [...auto, ...tagged];
});
const otherStreamNames = computed(() =>
  allStreams.value.filter((n) => !secStreamNames.value.includes(n)),
);
// Streams that are tagged by user (can show "−" button)
function isUserTagged(name: string) {
  return taggedStreams.value.includes(name);
}
// Streams that have OCSF enabled
function hasOcsf(name: string) {
  return !!ocsfFlags.value[name];
}

// ── Stream dropdown options ───────────────────────────────────────────────────
const streamOptions = ref<{ label: string; value: string; header?: boolean }[]>([]);
function buildStreamOptions() {
  const opts: typeof streamOptions.value = [];
  if (secStreamNames.value.length) {
    opts.push({ label: "Security Streams", value: "__h1__", header: true });
    secStreamNames.value.forEach((n) => opts.push({ label: n, value: n }));
  }
  if (otherStreamNames.value.length) {
    opts.push({ label: "Other Streams", value: "__h2__", header: true });
    otherStreamNames.value.forEach((n) => opts.push({ label: n, value: n }));
  }
  streamOptions.value = opts;
}

const selectedStream = ref<string | null>(null);
const streamsLoading = ref(false);

// Panel showing stream-add picker in sidebar
const showAddStream = ref(false);

// ── Stream schema ─────────────────────────────────────────────────────────────
interface StreamField {
  name: string;
  ftype: string;
}
const schemaFields = ref<StreamField[]>([]);
const fieldSearch = ref("");

const OCSF_PATTERNS: [RegExp, string][] = [
  [
    /^(class_uid|class_name|activity_id|activity_name|type_uid|severity_id|status|status_code)$/,
    "Event",
  ],
  [/^actor\./, "Actor"],
  [/^(src_endpoint|dst_endpoint|connection_info|network_traffic)\./, "Network"],
  [/^device\./, "Device"],
  [/^metadata\./, "Metadata"],
];
function ocsfCat(name: string): string | null {
  for (const [re, cat] of OCSF_PATTERNS) if (re.test(name)) return cat;
  return null;
}
const groupedFields = computed(() => {
  const q = fieldSearch.value.toLowerCase();
  const filtered = schemaFields.value.filter((f) => !q || f.name.toLowerCase().includes(q));
  const groups: Record<string, StreamField[]> = {
    Event: [],
    Actor: [],
    Network: [],
    Device: [],
    Metadata: [],
    Other: [],
  };
  for (const f of filtered) groups[ocsfCat(f.name) ?? "Other"].push(f);
  return Object.entries(groups).filter(([, fs]) => fs.length > 0);
});

// ── Column visibility ─────────────────────────────────────────────────────────
const PREFERRED = [
  "_timestamp",
  "severity_id",
  "class_name",
  "activity_name",
  "actor.user.name",
  "src_endpoint.ip",
  "device.hostname",
  "metadata.product.name",
];
const visibleCols = ref<string[]>([]);
const expandedGroups = ref<Set<string>>(new Set(["Event", "Other"]));
const sourcesExpanded = ref(true);

function initColumns(fields: StreamField[]) {
  const names = new Set(fields.map((f) => f.name));
  // A previous session's column choice for this stream wins over the defaults,
  // minus any field that has since left the schema.
  const saved = selectedStream.value ? loadSavedCols(selectedStream.value) : null;
  const restored = saved?.filter((c) => names.has(c)) ?? [];
  if (restored.length) {
    visibleCols.value = restored;
    return;
  }
  const p = PREFERRED.filter((c) => names.has(c));
  visibleCols.value =
    p.length >= 2
      ? p
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
  if (i === -1) visibleCols.value.push(name);
  else if (visibleCols.value.length > 1) visibleCols.value.splice(i, 1);
  if (selectedStream.value) saveCols(selectedStream.value, visibleCols.value);
}

// ── Time / filters ────────────────────────────────────────────────────────────
const timeRange = ref(initialTimeRange());
const sqlQuery = ref(initialState.query);
const sqlMode = ref(initialState.sqlMode); // true = raw SQL, false = query builder (filter chips)
const severityFilter = ref<SeverityValue[]>([]);
const fieldFilters = ref<FieldFilter[]>([...initialState.filters]);

// ── Severity / level filter ───────────────────────────────────────────────────
// Only OCSF streams carry `severity_id`; plain streams (cdc_events, nginx) carry a
// textual level instead, so the filter binds to whichever the schema actually has
// rather than disappearing on non-OCSF streams. First match wins.
const SEVERITY_FIELDS = [
  "severity_id",
  "severity",
  "level",
  "log_level",
  "loglevel",
  "severity_text",
  "syslog_severity",
];
const severityField = computed(
  () => SEVERITY_FIELDS.find((c) => schemaFields.value.some((f) => f.name === c)) ?? null,
);
// severity_id is the numeric OCSF scale; everything else is free text from the data.
const severityIsNumeric = computed(() => severityField.value === "severity_id");
// Row tinting reads the OCSF scale specifically.
const hasSeverity = computed(() => schemaFields.value.some((f) => f.name === "severity_id"));

const severityTextOptions = ref<{ label: string; value: string }[]>([]);
const severityOptionsLoading = ref(false);
const severityOptions = computed(() =>
  severityIsNumeric.value ? SEVERITY_SEL_OPTS : severityTextOptions.value,
);

// ── Filter builder (inline add row) ──────────────────────────────────────────
const filterBuilderField = ref("");
const filterBuilderOp = ref("=");
const filterBuilderValue = ref("");
const fieldValueOptions = ref<{ label: string; value: string }[]>([]);
const fieldValuesLoading = ref(false);

const FILTER_OPS = [
  { label: "=", value: "=" },
  { label: "!=", value: "!=" },
  { label: "contains", value: "contains" },
  { label: "not contains", value: "not_contains" },
];

const SEVERITY_SEL_OPTS = [
  { label: "Critical", value: 5 },
  { label: "High", value: 4 },
  { label: "Medium", value: 3 },
  { label: "Low", value: 2 },
  { label: "Info", value: 1 },
];

// Ranked so the dropdown reads worst-first regardless of what order the data
// hands back; anything unrecognised falls through to alphabetical.
const LEVEL_ORDER = [
  "fatal",
  "critical",
  "crit",
  "severe",
  "error",
  "err",
  "warning",
  "warn",
  "notice",
  "info",
  "informational",
  "debug",
  "trace",
];

async function loadSeverityValues() {
  severityTextOptions.value = [];
  const field = severityField.value;
  if (!field || severityIsNumeric.value || !selectedStream.value) return;
  severityOptionsLoading.value = true;
  try {
    const { start, end } = timeRange.value.end ? timeRange.value : defaultTimeRange();
    const res = await streamService.fieldValues({
      org_identifier: orgId.value,
      stream_name: selectedStream.value,
      fields: [field],
      size: 50,
      start_time: start,
      end_time: end,
      type: "logs",
    });
    const hits: any[] = res.data?.hits ?? [];
    const vals: string[] = hits.flatMap((h: any) =>
      (h.values ?? []).map((v: any) => String(v.zo_sql_key ?? v.key ?? v)),
    );
    const uniq = [...new Set(vals)].filter((v) => v !== "" && v !== "null");
    uniq.sort((a, b) => {
      const ia = LEVEL_ORDER.indexOf(a.toLowerCase());
      const ib = LEVEL_ORDER.indexOf(b.toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    severityTextOptions.value = uniq.map((v) => ({ label: v, value: v }));
  } catch {
    severityTextOptions.value = [];
  } finally {
    severityOptionsLoading.value = false;
  }
}

// Info by default: severity_id 1 on OCSF streams, the info-ish level elsewhere.
function defaultSeveritySelection(): SeverityValue[] {
  if (!severityField.value) return [];
  if (severityIsNumeric.value) return [1];
  const info = severityTextOptions.value.find((o) => /^inf(o|ormational)?$/i.test(o.label));
  return info ? [info.value] : [];
}

function onSeverityChange(v: unknown) {
  const next = (Array.isArray(v) ? v : v == null ? [] : [v]).filter(
    (x) => x !== null && x !== undefined && x !== "",
  ) as SeverityValue[];
  // Bail when the contents match — re-assigning a fresh array on every emit
  // hands OSelect a new modelValue identity and it re-emits in a loop.
  const cur = severityFilter.value;
  if (next.length === cur.length && next.every((n, i) => n === cur[i])) return;
  severityFilter.value = next;
}

const fieldNameOptions = computed(() =>
  schemaFields.value.map((f) => ({ label: f.name, value: f.name })),
);

async function loadFieldValues(fieldName: string) {
  if (!fieldName || !selectedStream.value) return;
  fieldValueOptions.value = [];
  fieldValuesLoading.value = true;
  try {
    const { start, end } = timeRange.value.end ? timeRange.value : defaultTimeRange();
    const res = await streamService.fieldValues({
      org_identifier: orgId.value,
      stream_name: selectedStream.value,
      fields: [fieldName],
      size: 50,
      start_time: start,
      end_time: end,
      type: "logs",
    });
    const hits: any[] = res.data?.hits ?? [];
    const vals: string[] = hits.flatMap((h: any) =>
      (h.values ?? []).map((v: any) => String(v.zo_sql_key ?? v.key ?? v)),
    );
    fieldValueOptions.value = [...new Set(vals)].map((v) => ({ label: v, value: v }));
  } catch {
    fieldValueOptions.value = [];
  } finally {
    fieldValuesLoading.value = false;
  }
}

watch(filterBuilderField, (v) => {
  filterBuilderValue.value = "";
  loadFieldValues(v);
});

function commitFilter() {
  const field = filterBuilderField.value.trim();
  const val = filterBuilderValue.value.trim();
  if (!field || !val) return;
  addFilter(field, val, filterBuilderOp.value);
  filterBuilderValue.value = "";
}

function addFilter(field: string, value: string, op = "=") {
  if (!value) return;
  if (!fieldFilters.value.some((f) => f.field === field && f.value === value && f.op === op)) {
    fieldFilters.value.push({ field, op, value });
    runSearch();
  }
}
function removeFilter(idx: number) {
  fieldFilters.value.splice(idx, 1);
  runSearch();
}

// ── Severity row coloring ─────────────────────────────────────────────────────
function rowSevClass(ev: any): string {
  if (!hasSeverity.value) return "";
  const n = Number(ev.severity_id);
  return n >= 5
    ? "row-sev-critical"
    : n >= 4
      ? "row-sev-high"
      : n >= 3
        ? "row-sev-medium"
        : n >= 2
          ? "row-sev-low"
          : "row-sev-info";
}

// ── Results ───────────────────────────────────────────────────────────────────
const events = ref<any[]>([]);
const loading = ref(false);
const total = ref(0);
const errorMsg = ref("");

// ── Source detection and normalization ───────────────────────────────────────
// The stream is identified from its shape, not its name, and every row is mapped
// onto the OCSF columns so one table can show CloudTrail, Okta and nginx alike.
// See utils/security/classify.ts for how the match is decided.
const detected = ref<Classification | null>(null);
const showRawColumns = ref(false);

function detectSource() {
  const fields = schemaFields.value.map((f) => f.name);
  if (!fields.length) {
    detected.value = null;
    return;
  }
  detected.value = bestMatch(fields, { sample: events.value[0] ?? null });
}

const normalizedEvents = computed<NormalizedEvent[]>(() =>
  normalizeEvents(events.value as Record<string, unknown>[], detected.value?.source ?? null),
);

/** Only the columns this source actually fills, so no wall of empty cells. */
const normalizedColumns = computed(
  () => populatedColumns(normalizedEvents.value, NORMALIZED_COLUMNS) as (keyof NormalizedEvent)[],
);

const facets = computed(() => buildFacets(normalizedEvents.value));

const COLUMN_LABELS: Record<string, string> = {
  time: "Time",
  severityId: "Severity",
  className: "Class",
  activity: "Activity",
  statusId: "Outcome",
  actor: "Actor",
  srcIp: "Source IP",
  dstIp: "Destination IP",
  host: "Host",
  process: "Process",
  operation: "Operation",
  resource: "Resource",
  product: "Product",
  message: "Message",
};

const detectedSummary = computed(() => {
  const match = detected.value;
  if (!match) return null;
  const category = ocsfCategoryOf(match.source.ocsfClass);
  return {
    label: match.source.label,
    confidence: Math.round(match.confidence * 100),
    category: category?.name ?? "",
    sigma: sigmaLogsourceLabel(match.source.sigma),
    evidence: [...match.matchedRequired, ...match.matchedSignals].join(", "),
    isSecurity: isSecuritySource(match),
  };
});

function normalizedCell(event: NormalizedEvent, column: keyof NormalizedEvent): string {
  const value = event[column];
  return value == null || value === "" ? "" : String(value);
}

// ── Detections that apply to this stream ─────────────────────────────────────
// Once the stream is identified, its Sigma logsource decides which of the
// shipped rules were written for it. They are compiled against the stream's real
// columns and counted over the window on screen, so the answer is "these three
// fired 40 times in the last hour" rather than "these rules exist".
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
  compileFor(
    detected.value?.source ?? null,
    schemaFields.value.map((f) => f.name),
  );
  const stream = selectedStream.value;
  if (!stream || !runnableCount.value) return;
  const { start, end } = timeRange.value.end ? timeRange.value : defaultTimeRange();
  void countHits(orgId.value, stream, { start, end });
}

/** Sends a rule to the Detections page, which owns creating one. */
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

/** Narrows the event table to the rows one rule matches. */
function filterByRule(where: string) {
  const stream = selectedStream.value;
  if (!stream) return;
  sqlMode.value = true;
  sqlQuery.value = `SELECT * FROM "${stream}" WHERE ${where} ORDER BY _timestamp DESC`;
  void runSearch();
}

// ── Drawer ────────────────────────────────────────────────────────────────────
const drawerEvent = ref<any | null>(null);
// Holds `event_ts` from the URL until the matching event has been located, so a
// URL rewrite in between doesn't drop the deep link before it can be honoured.
const pendingEventTs = ref<string | null>(initialState.eventTs);

function openDrawer(ev: any) {
  drawerEvent.value = ev;
  syncUrl();
}
function closeDrawer() {
  if (!drawerEvent.value && !pendingEventTs.value) return;
  drawerEvent.value = null;
  pendingEventTs.value = null;
  syncUrl();
}
function isActiveRow(ev: any) {
  // Compared by timestamp, not identity: a drawer restored from the URL is a
  // separately fetched object even when the same event is in the result list.
  return !!drawerEvent.value && String(drawerEvent.value._timestamp) === String(ev._timestamp);
}
// A shared link pins the absolute window the viewer should see — a relative
// period would resolve against *their* clock and show different events.
const shareUrl = computed(() => {
  if (!drawerEvent.value || typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  const q = buildQuery(true);
  Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url.toString();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getVal(ev: any, col: string): string {
  const v = col.includes(".") ? col.split(".").reduce((o: any, k) => o?.[k], ev) : ev[col];
  return v != null ? String(v) : "";
}
function fmtTs(ts: any): string {
  if (!ts) return "—";
  const raw = Number(ts);
  const ms = raw > 1e13 ? raw / 1000 : raw;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function defaultTimeRange() {
  const end = Date.now() * 1000;
  return { start: end - 15 * 60 * 1_000_000, end };
}

// ── SQL builder ───────────────────────────────────────────────────────────────
const sqlPlaceholder = computed(
  () =>
    `SELECT * FROM "${selectedStream.value ?? "stream"}" WHERE severity_id >= 3 ORDER BY _timestamp DESC`,
);
function buildSQL(): string {
  const stream = selectedStream.value;
  if (!stream) return "";
  if (sqlMode.value && sqlQuery.value.trim()) return sqlQuery.value.trim();
  if (!sqlMode.value) {
    const parts: string[] = [];
    const sevField = severityField.value;
    if (sevField && severityFilter.value.length) {
      const list = severityIsNumeric.value
        ? severityFilter.value.map((v) => Number(v)).join(", ")
        : severityFilter.value.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
      parts.push(
        severityFilter.value.length === 1
          ? `"${sevField}" = ${list}`
          : `"${sevField}" IN (${list})`,
      );
    }
    for (const f of fieldFilters.value) {
      const v = f.value.replace(/'/g, "''");
      if (f.op === "!=") parts.push(`"${f.field}" != '${v}'`);
      else if (f.op === "contains") parts.push(`"${f.field}" LIKE '%${v}%'`);
      else if (f.op === "not_contains") parts.push(`"${f.field}" NOT LIKE '%${v}%'`);
      else parts.push(`"${f.field}" = '${v}'`);
    }
    const where = parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
    return `SELECT * FROM "${stream}"${where} ORDER BY _timestamp DESC`;
  }
  return `SELECT * FROM "${stream}" ORDER BY _timestamp DESC`;
}

// ── URL sync ──────────────────────────────────────────────────────────────────
// `pinTime` forces the absolute window into the link instead of the relative
// period — used for share links, never for the address bar.
function buildQuery(pinTime = false): Record<string, string> {
  const q: Record<string, string> = { org_identifier: orgId.value };
  if (selectedStream.value) q.stream = selectedStream.value;

  if (dateState.value.type === "relative" && !pinTime) {
    q.period = dateState.value.period || "15m";
  } else {
    const { start, end } = timeRange.value.end ? timeRange.value : defaultTimeRange();
    q.from = String(start);
    q.to = String(end);
  }

  q.sql_mode = String(sqlMode.value);
  if (sqlMode.value && sqlQuery.value.trim()) {
    q.query = b64EncodeUnicode(sqlQuery.value.trim()) ?? "";
  }
  if (severityFilter.value.length) q.severity = severityFilter.value.join(",");
  if (fieldFilters.value.length) {
    q.filters = b64EncodeUnicode(JSON.stringify(fieldFilters.value)) ?? "";
  }
  const eventTs = drawerEvent.value?._timestamp ?? pendingEventTs.value;
  if (eventTs != null) q.event_ts = String(eventTs);
  return q;
}

function persistState() {
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
    /* quota / private mode — the URL still carries the full state */
  }
}

function syncUrl() {
  // replace, not push: filter tweaks shouldn't stack history entries the way a
  // navigation would, but the address bar always reflects the current view.
  router.replace({ query: buildQuery() });
  persistState();
}

// ── Load streams ──────────────────────────────────────────────────────────────
async function loadStreams() {
  streamsLoading.value = true;
  try {
    const res = await streamService.nameList(orgId.value, "logs", false);
    allStreams.value = (res.data?.list ?? []).map((s: any) => s.name);
    buildStreamOptions();
    // Restored stream (URL or last session) wins, then auto-detected security
    // streams, then whatever exists.
    const wanted = initialState.stream;
    if (wanted && allStreams.value.includes(wanted)) selectedStream.value = wanted;
    else if (secStreamNames.value.length) selectedStream.value = secStreamNames.value[0];
    else if (allStreams.value.length) selectedStream.value = allStreams.value[0];
  } finally {
    streamsLoading.value = false;
  }
}

// ── Load schema ───────────────────────────────────────────────────────────────
async function loadSchema(streamName: string) {
  schemaFields.value = [];
  try {
    const res = await streamService.schema(orgId.value, streamName, "logs");
    const raw: any[] = res.data?.schema ?? res.data?.fields ?? [];
    schemaFields.value = raw.map((f: any) => ({
      name: f.name,
      ftype: f.field_type ?? f.ftype ?? "",
    }));
    initColumns(schemaFields.value);
  } catch {
    schemaFields.value = [];
  }
}

// ── Run search ────────────────────────────────────────────────────────────────
async function runSearch() {
  // Every search re-publishes the view to the URL, so whatever produced it —
  // filter chip, severity pick, SQL edit, time range — is reproducible on reload.
  if (mountComplete) syncUrl();
  if (!selectedStream.value || !orgId.value) return;
  loading.value = true;
  errorMsg.value = "";
  const { start, end } = timeRange.value.end ? timeRange.value : defaultTimeRange();
  try {
    const res = await searchService.search(
      {
        org_identifier: orgId.value,
        query: { query: { sql: buildSQL(), start_time: start, end_time: end, from: 0, size: 200 } },
        page_type: "logs",
      },
      "ui",
    );
    events.value = res.data?.hits ?? [];
    total.value = res.data?.total ?? events.value.length;
    if (!schemaFields.value.length && events.value.length) {
      schemaFields.value = Object.keys(events.value[0]).map((k) => ({ name: k, ftype: "Utf8" }));
      initColumns(schemaFields.value);
    }
    detectSource();
    refreshRules();
    if (drawerEvent.value) {
      // Keep the open drawer pointed at the freshly fetched copy of its event.
      const refreshed = events.value.find(
        (e) => String(e._timestamp) === String(drawerEvent.value._timestamp),
      );
      if (refreshed) drawerEvent.value = refreshed;
    }
  } catch (e: any) {
    errorMsg.value = e?.response?.data?.error ?? e?.message ?? "Search failed";
    events.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

// ── Deep-linked event ─────────────────────────────────────────────────────────
// Reopens the drawer for `event_ts` after a reload. The event is usually in the
// result page already; when it isn't (different sort position, page size, a
// link shared with a wider range) it is fetched on its own so the deep link
// still resolves.
async function restoreDrawerFromUrl() {
  const ts = pendingEventTs.value;
  if (!ts || drawerEvent.value) return;
  const inPage = events.value.find((e) => String(e._timestamp) === ts);
  if (inPage) {
    drawerEvent.value = inPage;
    pendingEventTs.value = null;
    return;
  }
  const tsNum = Number(ts);
  if (Number.isFinite(tsNum) && selectedStream.value) {
    try {
      const res = await searchService.search(
        {
          org_identifier: orgId.value,
          query: {
            query: {
              sql: `SELECT * FROM "${selectedStream.value}" WHERE _timestamp = ${tsNum}`,
              start_time: tsNum - 1_000_000,
              end_time: tsNum + 1_000_000,
              from: 0,
              size: 1,
            },
          },
          page_type: "logs",
        },
        "ui",
      );
      const hit = res.data?.hits?.[0];
      if (hit) drawerEvent.value = hit;
    } catch {
      /* aged out or no longer queryable — leave the drawer closed */
    }
  }
  pendingEventTs.value = null;
  if (!drawerEvent.value) syncUrl(); // drop the dangling event_ts
}

// ── Watchers ──────────────────────────────────────────────────────────────────
let mountComplete = false;
let suppressSeverityWatch = false;

// Seeds the severity selection for the current stream without kicking off a
// search — the caller owns the single search that follows.
function applySeverityDefault() {
  suppressSeverityWatch = true;
  severityFilter.value = defaultSeveritySelection();
  nextTick(() => {
    suppressSeverityWatch = false;
  });
}
// Applies a restored severity selection, coercing to the scale the stream's
// severity field actually uses (numeric OCSF vs. free-text level).
function applySeveritySelection(values: SeverityValue[]) {
  suppressSeverityWatch = true;
  severityFilter.value = severityIsNumeric.value
    ? values.map(Number).filter((n) => !Number.isNaN(n))
    : values.map(String);
  nextTick(() => {
    suppressSeverityWatch = false;
  });
}
watch(selectedStream, async (v) => {
  if (!mountComplete) return;
  if (!v) return;
  fieldFilters.value = [];
  sqlQuery.value = "";
  drawerEvent.value = null;
  pendingEventTs.value = null;
  await loadSchema(v);
  // Both run after the schema resolves, so `severityField` reflects the new stream
  // and the text options exist before a default can be picked from them.
  await loadSeverityValues();
  applySeverityDefault();
  runSearch();
});
watch(
  severityFilter,
  () => {
    if (!mountComplete || suppressSeverityWatch) return;
    runSearch();
  },
  { deep: true },
);
// Switching between the filter builder and the SQL editor changes what the URL
// has to carry, so republish even though the results haven't been re-fetched yet.
watch(sqlMode, () => {
  if (mountComplete) syncUrl();
});

// ── DateTime ──────────────────────────────────────────────────────────────────
function onDateChange(dt: any) {
  timeRange.value = { start: Number(dt.startTime), end: Number(dt.endTime) };
  // A relative range is stored as its period ("15m") so a reload keeps meaning
  // "the last 15 minutes" instead of freezing the window at load time.
  dateState.value = String(dt.valueType ?? "relative").startsWith("relative")
    ? {
        type: "relative",
        period: dt.relativeTimePeriod || dateState.value.period || "15m",
        absolute: null,
      }
    : {
        type: "absolute",
        period: "",
        absolute: { startTime: Number(dt.startTime), endTime: Number(dt.endTime) },
      };
  if (!mountComplete) return; // the mount flow owns the first search
  runSearch();
}

// ── Mount ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  taggedStreams.value = loadTaggedStreams();
  ocsfFlags.value = loadOcsfFlags();
  if (!timeRange.value.end) timeRange.value = defaultTimeRange();
  await loadStreams();
  if (selectedStream.value) {
    await loadSchema(selectedStream.value);
    await loadSeverityValues();
    // A restored severity wins; otherwise seed the default for this stream.
    // Applied here because only now do we know whether the field is numeric.
    if (initialState.severity.length) applySeveritySelection(initialState.severity);
    else applySeverityDefault();
  }
  mountComplete = true;
  // runSearch republishes the URL itself, so it is always a complete description
  // of the view from the first paint on; syncUrl covers the no-stream case.
  if (selectedStream.value) {
    await runSearch();
    await restoreDrawerFromUrl();
  } else {
    syncUrl();
  }
});
</script>

<template>
  <div
    class="rounded-default flex h-full max-h-full! min-h-full! flex-row overflow-hidden"
    id="secEventsPage"
  >
    <!-- ── LEFT: search bar + field panel + results ──────────────────────────── -->
    <div class="sec-main-pane">
      <div class="h-full max-h-full overflow-hidden">
        <OSplitter
          class="h-full max-h-full overflow-hidden"
          v-model="topSplitter"
          :horizontal="true"
          unit="px"
          :limits="[80, 260]"
          :separatorStyle="{
            height: '10px',
            marginTop: '-5px',
            marginBottom: '-5px',
            zIndex: '10',
          }"
        >
          <!-- ── SEARCH BAR ─────────────────────────────────────────────────── -->
          <template #before>
            <div class="bg-surface-panel flex h-full w-full flex-col">
              <!-- Toolbar: stream selector + filters + datetime + run -->
              <div
                class="border-border-default flex w-full items-center gap-1.5 overflow-x-auto border-b px-1.5 py-1"
              >
                <!-- Stream selector -->
                <div class="w-52 shrink-0">
                  <OSelect
                    :model-value="selectedStream"
                    :options="streamOptions"
                    placeholder="Select stream…"
                    :searchable="true"
                    class="w-full"
                    @update:model-value="selectedStream = $event as string"
                  />
                </div>

                <!-- SQL / Filter mode toggle -->
                <div class="sec-mode-toggle shrink-0">
                  <button
                    :class="['sec-mode-btn', { 'sec-mode-btn--active': !sqlMode }]"
                    @click="sqlMode = false"
                  >
                    Filters
                  </button>
                  <button
                    :class="['sec-mode-btn', { 'sec-mode-btn--active': sqlMode }]"
                    @click="sqlMode = true"
                  >
                    SQL
                  </button>
                </div>

                <!-- Severity / level multi-select (same toolbar level as Filters/SQL).
                     Always rendered so it doesn't vanish on streams without the field. -->
                <OSelect
                  v-if="!sqlMode"
                  :model-value="severityFilter"
                  :options="severityOptions"
                  :disabled="!severityField"
                  :loading="severityOptionsLoading"
                  multiple
                  select-all
                  clearable
                  :placeholder="severityField ? `All ${severityField}` : 'No severity field'"
                  :title="
                    severityField
                      ? `Filtering on ${severityField}`
                      : 'This stream has no severity or level field'
                  "
                  data-test="security-events-severity-filter"
                  class="sec-severity-sel shrink-0"
                  @update:model-value="onSeverityChange"
                />

                <div class="min-w-2 flex-1" />

                <!-- DateTime picker — seeded from the restored range so a reload
                     reopens on the same window rather than snapping back to 15m -->
                <DateTime
                  :default-type="dateState.type"
                  :default-relative-time="dateState.period || '15m'"
                  :default-absolute-time="dateState.absolute ?? undefined"
                  :auto-apply="true"
                  class="shrink-0"
                  @on:date-change="onDateChange"
                />

                <!-- Run button -->
                <OButton
                  size="sm"
                  variant="primary"
                  :loading="loading"
                  class="shrink-0"
                  @click="runSearch"
                >
                  <OIcon name="play-arrow" size="sm" />
                  Run
                </OButton>
              </div>

              <!-- Filter builder row (only in filter mode) -->
              <div v-if="!sqlMode" class="sec-filter-builder-row">
                <!-- Field + Op + Value add row -->
                <div class="flex min-w-0 flex-1 items-center gap-1">
                  <OSelect
                    v-model="filterBuilderField"
                    :options="fieldNameOptions"
                    placeholder="Field…"
                    :searchable="true"
                    class="sec-filter-field-sel"
                  />
                  <OSelect
                    v-model="filterBuilderOp"
                    :options="FILTER_OPS"
                    class="sec-filter-op-sel"
                  />
                  <OSelect
                    v-model="filterBuilderValue"
                    :options="fieldValueOptions"
                    :loading="fieldValuesLoading"
                    :searchable="true"
                    :creatable="true"
                    :disabled="!filterBuilderField"
                    placeholder="Value…"
                    class="sec-filter-value-sel"
                  />
                  <OButton
                    size="sm"
                    variant="outline"
                    class="shrink-0"
                    :disabled="!filterBuilderField || !filterBuilderValue"
                    @click="commitFilter"
                  >
                    <OIcon name="add" size="xs" />
                    Add
                  </OButton>
                </div>

                <!-- Active filter chips -->
                <div v-if="fieldFilters.length" class="flex flex-wrap items-center gap-1">
                  <div v-for="(f, i) in fieldFilters" :key="i" class="sec-filter-chip">
                    <span class="max-w-48 truncate font-mono text-xs">
                      <strong>{{ f.field }}</strong>
                      <span class="sec-filter-op-label">{{
                        f.op === "not_contains" ? "not ~" : f.op === "contains" ? "~" : f.op
                      }}</span>
                      {{ f.value }}
                    </span>
                    <button class="sec-filter-remove" @click="removeFilter(i)">✕</button>
                  </div>
                </div>
              </div>

              <!-- SQL editor row (only when SQL mode) -->
              <div v-if="sqlMode" class="sec-sql-editor-row">
                <textarea
                  v-model="sqlQuery"
                  :placeholder="sqlPlaceholder"
                  class="sec-sql-textarea"
                  rows="2"
                  spellcheck="false"
                  @keydown.ctrl.enter.prevent="runSearch"
                  @keydown.meta.enter.prevent="runSearch"
                />
                <div class="sec-sql-hint">Ctrl+↵ to run</div>
              </div>
            </div>
          </template>

          <!-- ── CONTENT: field panel + results ───────────────────────────── -->
          <template #after>
            <div class="border-border-default h-full max-h-full overflow-hidden border-t">
              <OSplitter
                v-model="sideSplitter"
                :limits="[180, 440]"
                unit="px"
                class="h-full max-h-full w-full overflow-hidden"
                :separatorStyle="{
                  width: '10px',
                  marginLeft: '-5px',
                  marginRight: '-5px',
                  zIndex: '10',
                }"
              >
                <!-- ── FIELD SIDEBAR ────────────────────────────────────── -->
                <template #before>
                  <div
                    class="bg-surface-panel border-border-default flex h-full flex-col overflow-hidden border-r"
                  >
                    <!-- Field search -->
                    <div class="shrink-0 px-2 py-2">
                      <div
                        class="border-border-default bg-input-bg flex items-center gap-1 rounded border px-2 py-1"
                      >
                        <OIcon name="manage-search" size="xs" class="text-text-tertiary shrink-0" />
                        <input
                          v-model="fieldSearch"
                          type="text"
                          placeholder="Search fields…"
                          class="text-input-text placeholder:text-input-placeholder min-w-0 flex-1 bg-transparent text-xs outline-none"
                        />
                      </div>
                    </div>

                    <div class="flex-1 overflow-y-auto">
                      <!-- ── SOURCES section ── -->
                      <button
                        class="sec-field-group-hdr"
                        @click="sourcesExpanded = !sourcesExpanded"
                      >
                        <OIcon
                          :name="sourcesExpanded ? 'expand-more' : 'arrow-forward'"
                          size="xs"
                          class="text-text-tertiary shrink-0"
                        />
                        <span
                          class="text-text-secondary min-w-0 flex-1 truncate text-left text-xs font-semibold tracking-widest uppercase"
                          >Sources</span
                        >
                      </button>

                      <div v-if="sourcesExpanded">
                        <!-- Security streams with − button for user-tagged ones -->
                        <div
                          v-for="name in secStreamNames"
                          :key="name"
                          :class="[
                            'sec-source-row',
                            { 'sec-source-row--active': selectedStream === name },
                          ]"
                          @click="selectedStream = name"
                        >
                          <div
                            class="sec-source-dot"
                            :class="hasOcsf(name) ? 'sec-source-dot--ocsf' : 'sec-source-dot--auto'"
                          />
                          <span class="sec-source-name" :title="name">{{ name }}</span>
                          <span
                            v-if="hasOcsf(name)"
                            class="sec-ocsf-badge"
                            title="OCSF + Sigma enabled"
                            >OCSF</span
                          >
                          <!-- Only show − for user-tagged (not auto-detected) streams -->
                          <button
                            v-if="isUserTagged(name)"
                            class="sec-source-action sec-source-action--remove"
                            title="Remove from security streams"
                            @click.stop="removeStreamFromSecurity(name)"
                          >
                            −
                          </button>
                        </div>

                        <!-- + Add stream button -->
                        <div class="px-2 py-1">
                          <button
                            class="sec-add-source-btn"
                            @click="showAddStream = !showAddStream"
                          >
                            <OIcon name="add" size="xs" />
                            Add stream
                          </button>
                        </div>

                        <!-- Add stream picker -->
                        <div v-if="showAddStream" class="sec-add-source-panel">
                          <div class="sec-add-source-header">
                            <span class="text-text-secondary text-xs font-semibold"
                              >Other streams</span
                            >
                            <button class="sec-add-close" @click="showAddStream = false">✕</button>
                          </div>
                          <div v-if="otherStreamNames.length">
                            <div
                              v-for="name in otherStreamNames"
                              :key="name"
                              class="sec-add-stream-row"
                              @click="
                                addStreamToSecurity(name);
                                showAddStream = false;
                              "
                            >
                              <span class="flex-1 truncate font-mono text-xs">{{ name }}</span>
                              <span class="sec-add-plus">+</span>
                            </div>
                          </div>
                          <div v-else class="text-text-tertiary px-3 py-2 text-xs">
                            All streams are already in security
                          </div>
                        </div>
                      </div>

                      <!-- Divider -->
                      <div class="border-border-default mx-2 my-1 border-t" />

                      <!-- ── FIELDS grouped ── -->
                      <div v-if="!schemaFields.length" class="px-3 py-4 text-center">
                        <span class="text-text-tertiary text-xs"
                          >Select a stream to see fields</span
                        >
                      </div>
                      <template v-for="[groupName, fields] in groupedFields" :key="groupName">
                        <button
                          class="sec-field-group-hdr"
                          @click="
                            expandedGroups.has(groupName)
                              ? expandedGroups.delete(groupName)
                              : expandedGroups.add(groupName)
                          "
                        >
                          <OIcon
                            :name="expandedGroups.has(groupName) ? 'expand-more' : 'arrow-forward'"
                            size="xs"
                            class="text-text-tertiary shrink-0"
                          />
                          <span class="min-w-0 flex-1 truncate text-left text-xs font-semibold">{{
                            groupName
                          }}</span>
                          <span class="text-text-tertiary text-xs tabular-nums">{{
                            fields.length
                          }}</span>
                        </button>
                        <div v-if="expandedGroups.has(groupName)">
                          <div
                            v-for="field in fields"
                            :key="field.name"
                            :class="[
                              'sec-field-row',
                              { 'sec-field-row--active': visibleCols.includes(field.name) },
                            ]"
                          >
                            <span class="sec-field-name" :title="field.name">{{ field.name }}</span>
                            <span class="sec-field-type">{{ field.ftype?.slice(0, 3) ?? "" }}</span>
                            <button
                              :class="[
                                'sec-field-btn',
                                { 'sec-field-btn--on': visibleCols.includes(field.name) },
                              ]"
                              :title="
                                visibleCols.includes(field.name) ? 'Remove column' : 'Add as column'
                              "
                              @click.stop="toggleCol(field.name)"
                            >
                              <OIcon
                                :name="
                                  visibleCols.includes(field.name)
                                    ? 'visibility-off'
                                    : 'format-list-bulleted'
                                "
                                size="xs"
                              />
                            </button>
                            <button
                              class="sec-field-btn"
                              title="Add to WHERE clause"
                              @click.stop="
                                sqlQuery = `SELECT * FROM &quot;${selectedStream}&quot; WHERE &quot;${field.name}&quot; = '' ORDER BY _timestamp DESC`;
                                sqlMode = true;
                              "
                            >
                              <OIcon name="filter-alt" size="xs" />
                            </button>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </template>

                <!-- ── RESULTS ─────────────────────────────────────────── -->
                <template #after>
                  <div class="bg-card-glass-bg h-full w-full overflow-auto">
                    <div v-if="errorMsg" class="flex items-center gap-2 p-4 text-sm text-red-500">
                      <OIcon name="error-outline" size="sm" />{{ errorMsg }}
                    </div>

                    <template v-else-if="loading">
                      <div v-for="n in 14" :key="n" class="sec-row-skeleton" />
                    </template>

                    <div
                      v-else-if="!selectedStream"
                      class="flex h-48 flex-col items-center justify-center gap-3"
                    >
                      <OIcon name="manage-search" size="xl" class="text-text-tertiary opacity-30" />
                      <div class="text-text-secondary text-sm font-medium">
                        Select a stream to begin
                      </div>
                    </div>

                    <div
                      v-else-if="events.length === 0"
                      class="flex h-48 flex-col items-center justify-center gap-3"
                    >
                      <OIcon name="manage-search" size="xl" class="text-text-tertiary opacity-30" />
                      <div class="text-text-primary text-sm font-medium">No events found</div>
                      <div class="text-text-secondary text-xs">
                        Adjust filters or widen the time range
                      </div>
                    </div>

                    <template v-else>
                      <!-- What this stream was identified as, and on what evidence.
                           A classification an analyst cannot see the reasoning for
                           is one they cannot correct. -->
                      <div v-if="detectedSummary" class="sec-detect-bar">
                        <OIcon
                          :name="
                            detectedSummary.isSecurity ? 'shield-alert-outline' : 'info-outline'
                          "
                          size="xs"
                        />
                        <span class="font-semibold">{{ detectedSummary.label }}</span>
                        <span class="sec-detect-chip">{{ detectedSummary.confidence }}% match</span>
                        <span v-if="detectedSummary.category" class="sec-detect-chip">{{
                          detectedSummary.category
                        }}</span>
                        <span
                          v-if="detectedSummary.sigma"
                          class="sec-detect-chip sec-detect-chip--sigma font-mono"
                          :title="`Sigma rules for ${detectedSummary.sigma} apply to this stream`"
                        >
                          {{ detectedSummary.sigma }}
                        </span>
                        <span v-if="!detectedSummary.isSecurity" class="sec-detect-chip"
                          >telemetry only</span
                        >
                        <span class="sec-detect-evidence" :title="detectedSummary.evidence">
                          matched on {{ detectedSummary.evidence }}
                        </span>
                        <div class="flex-1" />
                        <button
                          v-if="sigmaRules.length"
                          class="sec-detect-toggle"
                          @click="showRules = !showRules"
                        >
                          {{ runnableCount }} detection{{ runnableCount !== 1 ? "s" : "" }}
                          <template v-if="firingCount"> · {{ firingCount }} firing</template>
                        </button>
                        <button class="sec-detect-toggle" @click="showRawColumns = !showRawColumns">
                          {{ showRawColumns ? "Show normalized" : "Show raw fields" }}
                        </button>
                      </div>

                      <!-- The shipped Sigma rules written for this stream's
                           logsource, compiled against its real columns and
                           counted over the window on screen. A rule that cannot
                           run is listed with the reason rather than hidden. -->
                      <div
                        v-if="showRules && sigmaRules.length"
                        class="border-border-default flex max-h-80 flex-col gap-1 overflow-y-auto border-b px-3 py-2"
                      >
                        <div class="text-text-secondary flex items-center gap-2 text-xs">
                          <span class="font-semibold">Detections for this stream</span>
                          <span v-if="rulesCounting" class="text-text-tertiary">counting…</span>
                          <span v-else-if="rulesError" class="text-error">{{ rulesError }}</span>
                          <div class="flex-1" />
                          <span class="text-text-tertiary">
                            {{ sigmaRules.length }} written for
                            {{ detectedSummary?.sigma || "this source" }}
                          </span>
                        </div>

                        <div
                          v-for="entry in sigmaRules"
                          :key="entry.rule.id ?? entry.rule.title"
                          class="border-border-subtle flex items-center gap-2 border-b py-1.5 text-xs last:border-b-0"
                        >
                          <span
                            :class="['sev-badge', `sev-${entry.rule.level ?? 'medium'}`]"
                            class="shrink-0"
                          >
                            {{ entry.rule.level ?? "medium" }}
                          </span>
                          <span
                            class="text-text-primary truncate font-medium"
                            :title="entry.rule.description ?? entry.rule.title"
                          >
                            {{ entry.rule.title }}
                          </span>
                          <span
                            v-for="technique in entry.rule.techniques"
                            :key="technique"
                            class="mitre-chip shrink-0"
                          >
                            {{ technique }}
                          </span>

                          <div class="flex-1" />

                          <!-- Why a rule is not running, stated rather than hidden -->
                          <span
                            v-if="!entry.compiled.runnable"
                            class="text-text-tertiary max-w-64 truncate"
                            :title="blockedReason(entry.compiled)"
                          >
                            {{ blockedReason(entry.compiled) }}
                          </span>
                          <template v-else>
                            <span
                              v-if="caveat(entry.compiled)"
                              class="text-text-tertiary"
                              :title="caveat(entry.compiled)"
                            >
                              ⚠
                            </span>
                            <span
                              v-if="entry.count !== null"
                              :class="[
                                'sec-detect-chip shrink-0 tabular-nums',
                                entry.count > 0 ? 'sec-detect-chip--sigma' : '',
                              ]"
                            >
                              {{ entry.count.toLocaleString() }} hit{{
                                entry.count === 1 ? "" : "s"
                              }}
                            </span>
                            <button
                              v-if="entry.count"
                              class="sec-detect-toggle shrink-0"
                              @click="filterByRule(entry.compiled.where)"
                            >
                              View
                            </button>
                            <button
                              class="sec-detect-toggle shrink-0"
                              @click="createDetectionFrom(entry.rule.id ?? '')"
                            >
                              Create detection
                            </button>
                          </template>
                        </div>
                      </div>

                      <!-- Result count + facets over what is on screen -->
                      <div
                        class="border-border-default bg-card-glass-bg sticky top-0 z-10 flex h-8 items-center gap-3 border-b px-3 text-xs"
                      >
                        <span class="text-text-secondary font-medium"
                          >{{ total.toLocaleString() }} event{{ total !== 1 ? "s" : "" }}</span
                        >
                        <template v-if="!showRawColumns">
                          <span
                            v-for="bucket in facets.severity"
                            :key="bucket.id"
                            :class="['sec-facet', `sev-${ocsfSeverity(bucket.id).tone}`]"
                          >
                            {{ ocsfSeverity(bucket.id).name }} {{ bucket.count }}
                          </span>
                        </template>
                        <div class="flex-1" />
                        <span class="text-text-tertiary">
                          {{ showRawColumns ? visibleCols.length : normalizedColumns.length }} cols
                        </span>
                      </div>

                      <!-- ── Normalized (OCSF) table ── -->
                      <template v-if="!showRawColumns">
                        <div class="sec-col-header">
                          <div class="sec-expand-cell" />
                          <div
                            v-for="col in normalizedColumns"
                            :key="col"
                            class="sec-col-hdr-cell"
                            :class="col === 'time' ? 'sec-ts-cell' : 'sec-data-cell'"
                          >
                            {{ COLUMN_LABELS[col] ?? col }}
                          </div>
                        </div>

                        <div
                          v-for="(ev, idx) in normalizedEvents"
                          :key="idx"
                          :class="[
                            'sec-event-row',
                            `row-sev-${ocsfSeverity(ev.severityId).tone}`,
                            { 'sec-event-row--active': isActiveRow(ev.raw) },
                          ]"
                          @click="openDrawer(ev.raw)"
                        >
                          <div class="sec-expand-cell">
                            <OIcon
                              :name="isActiveRow(ev.raw) ? 'expand-more' : 'arrow-forward'"
                              size="xs"
                              class="text-text-tertiary"
                            />
                          </div>
                          <div
                            v-for="col in normalizedColumns"
                            :key="col"
                            class="sec-data-cell-val"
                            :class="col === 'time' ? 'sec-ts-cell' : 'sec-data-cell'"
                          >
                            <template v-if="col === 'time'">{{ fmtTs(ev.time) }}</template>
                            <template v-else-if="col === 'severityId'">
                              <span
                                :class="[
                                  'sec-sev-badge',
                                  `sev-${ocsfSeverity(ev.severityId).tone}`,
                                ]"
                              >
                                {{ ocsfSeverity(ev.severityId).name }}
                              </span>
                            </template>
                            <template v-else-if="col === 'statusId'">
                              <span
                                :class="[
                                  'sec-status-badge',
                                  ev.statusId === 2
                                    ? 'sec-status-fail'
                                    : ev.statusId === 1
                                      ? 'sec-status-ok'
                                      : '',
                                ]"
                              >
                                {{ ocsfStatusName(ev.statusId) }}
                              </span>
                            </template>
                            <template v-else-if="col === 'className'">
                              <span class="sec-class-badge">{{ ev.className }}</span>
                            </template>
                            <template v-else-if="col === 'srcIp' || col === 'dstIp'">
                              <span class="truncate font-mono text-xs">{{
                                normalizedCell(ev, col) || "—"
                              }}</span>
                            </template>
                            <template v-else>
                              <span class="truncate">{{ normalizedCell(ev, col) || "—" }}</span>
                            </template>
                          </div>
                        </div>
                      </template>

                      <!-- ── Raw fields, the pre-normalization view ── -->
                      <template v-else>
                        <div class="sec-col-header">
                          <div class="sec-expand-cell" />
                          <div
                            v-for="col in visibleCols"
                            :key="col"
                            class="sec-col-hdr-cell"
                            :class="col === '_timestamp' ? 'sec-ts-cell' : 'sec-data-cell'"
                          >
                            {{ col === "_timestamp" ? "Timestamp" : col }}
                          </div>
                        </div>

                        <div
                          v-for="(ev, idx) in events"
                          :key="idx"
                          :class="[
                            'sec-event-row',
                            rowSevClass(ev),
                            { 'sec-event-row--active': isActiveRow(ev) },
                          ]"
                          @click="openDrawer(ev)"
                        >
                          <div class="sec-expand-cell">
                            <OIcon
                              :name="isActiveRow(ev) ? 'expand-more' : 'arrow-forward'"
                              size="xs"
                              class="text-text-tertiary"
                            />
                          </div>
                          <div
                            v-for="col in visibleCols"
                            :key="col"
                            class="sec-data-cell-val"
                            :class="col === '_timestamp' ? 'sec-ts-cell' : 'sec-data-cell'"
                          >
                            <template v-if="col === '_timestamp'">{{
                              fmtTs(ev._timestamp)
                            }}</template>
                            <template v-else>
                              <span class="truncate">{{ getVal(ev, col) || "—" }}</span>
                            </template>
                          </div>
                        </div>
                      </template>
                    </template>
                  </div>
                </template>
              </OSplitter>
            </div>
          </template>
        </OSplitter>
      </div>
    </div>

    <!-- ── Event detail — overlay drawer, slides over the results instead of
         squeezing them; open state lives in the URL (event_ts) ───────────── -->
    <ODrawer
      :open="!!drawerEvent"
      side="right"
      size="xl"
      bleed
      :show-close="false"
      data-test="security-event-drawer"
      @update:open="
        (v: boolean) => {
          if (!v) closeDrawer();
        }
      "
    >
      <SecurityEventDrawer
        v-if="drawerEvent"
        :event="drawerEvent"
        :stream="selectedStream ?? ''"
        :share-url="shareUrl"
        @close="closeDrawer"
        @add-filter="addFilter"
      />
    </ODrawer>
  </div>
</template>

<style>
/* ── Root layout ─────────────────────────────────────────────────────────── */
/* The event detail is an ODrawer overlay, so the results pane keeps the full
   width whether or not an event is open — no reflow on select. */
.sec-main-pane {
  flex: 1 1 100%;
  min-width: 0;
  overflow: hidden;
}

/* ── Mode toggle (Filters / SQL) ─────────────────────────────────────────── */
.sec-mode-toggle {
  display: flex;
  gap: 0;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 5px;
  padding: 1px;
}
.dark .sec-mode-toggle {
  background: rgba(255, 255, 255, 0.06);
}
.sec-mode-btn {
  padding: 2px 10px;
  border-radius: 4px;
  border: none;
  background: none;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  color: var(--color-text-secondary, #6b7280);
  transition: all 0.1s;
  white-space: nowrap;
}
.sec-mode-btn--active {
  background: white;
  color: #6d5ce0 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.dark .sec-mode-btn--active {
  background: #2a2a3a;
}

/* ── Filter builder row ──────────────────────────────────────────────────── */
.sec-filter-builder-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  min-height: 38px;
  border-top: 1px solid var(--color-border-default, rgba(0, 0, 0, 0.08));
  background: var(--color-surface-panel, #f9fafb);
}
.dark .sec-filter-builder-row {
  background: #0f111a;
}

.sec-filter-divider {
  width: 1px;
  height: 18px;
  background: var(--color-border-default, rgba(0, 0, 0, 0.1));
  flex-shrink: 0;
}

.sec-severity-sel {
  width: 13rem;
  flex-shrink: 0;
}
.sec-filter-field-sel {
  width: 160px;
  flex-shrink: 0;
}
.sec-filter-op-sel {
  width: 110px;
  flex-shrink: 0;
}
.sec-filter-value-sel {
  width: 200px;
  flex-shrink: 0;
}

.sec-filter-op-label {
  opacity: 0.55;
  margin: 0 3px;
  font-weight: 400;
}

/* ── SQL editor ──────────────────────────────────────────────────────────── */
.sec-sql-editor-row {
  position: relative;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--color-border-default, rgba(0, 0, 0, 0.08));
  background: var(--color-input-bg, #fafafa);
}
.dark .sec-sql-editor-row {
  background: #12131a;
}
.sec-sql-textarea {
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  padding: 8px 12px 4px;
  color: var(--color-text-primary, #111);
  min-height: 52px;
}
.dark .sec-sql-textarea {
  color: #e5e7eb;
}
.sec-sql-textarea::placeholder {
  color: var(--color-text-tertiary, #9ca3af);
  opacity: 1;
}
.sec-sql-hint {
  font-size: 10px;
  color: var(--color-text-tertiary, #9ca3af);
  padding: 0 12px 4px;
  text-align: right;
  font-family: monospace;
  user-select: none;
}

/* ── Severity chips ──────────────────────────────────────────────────────── */
.sec-sev-chip {
  padding: 2px 10px;
  border-radius: 99px;
  border: 1px solid var(--color-border-default, rgba(0, 0, 0, 0.12));
  background: transparent;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
  line-height: 1.6;
  white-space: nowrap;
}
.sec-sev-chip:hover:not(.sec-sev-chip--active) {
  background: rgba(0, 0, 0, 0.04);
}
.dark .sec-sev-chip:hover:not(.sec-sev-chip--active) {
  background: rgba(255, 255, 255, 0.06);
}
.sec-sev-chip.sec-sev-chip--active.sev-critical {
  background: #dc2626;
  color: #fff;
  border-color: #dc2626;
}
.sec-sev-chip.sec-sev-chip--active.sev-high {
  background: #ea580c;
  color: #fff;
  border-color: #ea580c;
}
.sec-sev-chip.sec-sev-chip--active.sev-medium {
  background: #ca8a04;
  color: #fff;
  border-color: #ca8a04;
}
.sec-sev-chip.sec-sev-chip--active.sev-low {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.sec-sev-chip.sec-sev-chip--active.sev-info {
  background: #6b7280;
  color: #fff;
  border-color: #6b7280;
}
.sec-sev-chip.sec-sev-chip--active:not([class*="sev-"]) {
  background: #6d5ce0;
  color: #fff;
  border-color: #6d5ce0;
}

/* ── Filter chips ────────────────────────────────────────────────────────── */
.sec-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px 1px 8px;
  border-radius: 4px;
  background: rgba(109, 92, 224, 0.1);
  border: 1px solid rgba(109, 92, 224, 0.2);
  font-size: 11px;
}
.sec-filter-remove {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: #9ca3af;
  line-height: 1;
}

/* ── SOURCES section ─────────────────────────────────────────────────────── */
.sec-source-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px 4px 28px;
  cursor: pointer;
  transition: background 0.08s;
}
.sec-source-row:hover {
  background: rgba(0, 0, 0, 0.03);
}
.dark .sec-source-row:hover {
  background: rgba(255, 255, 255, 0.03);
}
.sec-source-row--active {
  background: rgba(109, 92, 224, 0.08) !important;
}
.dark .sec-source-row--active {
  background: rgba(109, 92, 224, 0.14) !important;
}
.sec-source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sec-source-dot--auto {
  background: #22c55e;
}
.sec-source-dot--ocsf {
  background: #6d5ce0;
}
.dark .sec-source-dot--ocsf {
  background: #a78bfa;
}
.sec-source-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  font-family: monospace;
}
.sec-ocsf-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
  background: rgba(109, 92, 224, 0.12);
  color: #6d5ce0;
  letter-spacing: 0.04em;
}
.dark .sec-ocsf-badge {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}
.sec-source-action {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  opacity: 0;
  transition:
    opacity 0.1s,
    background 0.1s;
  color: inherit;
}
.sec-source-row:hover .sec-source-action {
  opacity: 1;
}
.sec-source-action--remove:hover {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}

.sec-add-source-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px dashed var(--color-border-default, rgba(0, 0, 0, 0.12));
  background: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--color-text-tertiary, #9ca3af);
  transition: all 0.1s;
}
.sec-add-source-btn:hover {
  border-color: #6d5ce0;
  color: #6d5ce0;
  background: rgba(109, 92, 224, 0.05);
}

.sec-add-source-panel {
  border-top: 1px solid var(--color-border-default, rgba(0, 0, 0, 0.06));
  border-bottom: 1px solid var(--color-border-default, rgba(0, 0, 0, 0.06));
  background: rgba(0, 0, 0, 0.02);
  max-height: 200px;
  overflow-y: auto;
}
.dark .sec-add-source-panel {
  background: rgba(255, 255, 255, 0.02);
}
.sec-add-source-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  font-size: 11px;
}
.sec-add-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-tertiary, #9ca3af);
  font-size: 12px;
}
.sec-add-stream-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 16px;
  cursor: pointer;
  transition: background 0.08s;
}
.sec-add-stream-row:hover {
  background: rgba(109, 92, 224, 0.06);
}
.sec-add-plus {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(22, 163, 74, 0.1);
  color: #16a34a;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}

/* ── Field sidebar shared ────────────────────────────────────────────────── */
.sec-field-group-hdr {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 12px;
  background: none;
  border: none;
  cursor: pointer;
  transition: background 0.1s;
}
.sec-field-group-hdr:hover {
  background: rgba(0, 0, 0, 0.04);
}
.dark .sec-field-group-hdr:hover {
  background: rgba(255, 255, 255, 0.04);
}
.sec-field-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 12px 3px 28px;
  transition: background 0.08s;
}
.sec-field-row:hover {
  background: rgba(0, 0, 0, 0.03);
}
.dark .sec-field-row:hover {
  background: rgba(255, 255, 255, 0.03);
}
.sec-field-row--active {
  background: rgba(109, 92, 224, 0.06);
}
.dark .sec-field-row--active {
  background: rgba(109, 92, 224, 0.1);
}
.sec-field-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: monospace;
}
.sec-field-type {
  font-size: 10px;
  color: var(--color-text-tertiary, #9ca3af);
  font-family: monospace;
  width: 24px;
  text-align: right;
  flex-shrink: 0;
}
.sec-field-btn {
  padding: 2px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 3px;
  color: var(--color-text-tertiary, #9ca3af);
  opacity: 0;
  transition: opacity 0.1s;
  flex-shrink: 0;
}
.sec-field-row:hover .sec-field-btn {
  opacity: 1;
}
.sec-field-btn:hover {
  color: #6d5ce0;
}
.sec-field-btn--on {
  color: #6d5ce0;
  opacity: 1 !important;
}

/* ── Source detection bar ────────────────────────────────────────────────── */
.sec-detect-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 5px 12px;
  font-size: 11.5px;
  border-bottom: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
}
.sec-detect-chip {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 600;
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent);
}
.sec-detect-chip--sigma {
  font-weight: 500;
}
.sec-detect-evidence {
  color: var(--color-text-tertiary);
  font-size: 10.5px;
  max-width: 34rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sec-detect-toggle {
  border: 1px solid var(--color-border-default);
  background: none;
  cursor: pointer;
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 10.5px;
  color: var(--color-text-secondary);
}
.sec-detect-toggle:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.sec-facet {
  padding: 0 6px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 600;
}
.sec-status-badge {
  font-size: 10.5px;
  font-weight: 600;
}
.sec-status-ok {
  color: var(--color-status-positive);
}
.sec-status-fail {
  color: var(--color-status-negative);
}

/* The OCSF scale adds Unknown/Other, which the phase-0 1-5 scale had no tone
   for. The rest reuse the severity classes already defined below. */
.sev-muted {
  background: color-mix(in srgb, var(--color-text-tertiary) 12%, transparent);
  color: var(--color-text-tertiary);
}
.row-sev-muted {
  border-left-color: var(--color-border-default);
}

/* ── Results ─────────────────────────────────────────────────────────────── */
.sec-col-header {
  display: flex;
  align-items: center;
  position: sticky;
  top: 32px;
  z-index: 1;
  background: var(--color-surface-base, #fff);
  border-bottom: 1px solid var(--color-border-default, rgba(0, 0, 0, 0.08));
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.dark .sec-col-header {
  background: var(--d-base, #0d1117);
}
.sec-event-row {
  display: flex;
  align-items: center;
  min-height: 34px;
  border-bottom: 1px solid var(--color-border-default, rgba(0, 0, 0, 0.06));
  border-left: 3px solid transparent;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.08s;
}
.sec-event-row:hover {
  background: rgba(0, 0, 0, 0.025);
}
.dark .sec-event-row {
  border-color: rgba(255, 255, 255, 0.05);
}
.dark .sec-event-row:hover {
  background: rgba(255, 255, 255, 0.025);
}
.sec-event-row--active {
  background: rgba(109, 92, 224, 0.07) !important;
}
.dark .sec-event-row--active {
  background: rgba(109, 92, 224, 0.12) !important;
}
.row-sev-critical {
  border-left-color: #dc2626;
}
.row-sev-high {
  border-left-color: #ea580c;
}
.row-sev-medium {
  border-left-color: #ca8a04;
}
.row-sev-low {
  border-left-color: #2563eb;
}
.row-sev-info {
  border-left-color: #9ca3af;
}
.sec-expand-cell {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sec-ts-cell {
  width: 148px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-secondary, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sec-data-cell {
  flex: 1;
  min-width: 80px;
  max-width: 220px;
  overflow: hidden;
}
.sec-col-hdr-cell {
  padding: 6px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sec-data-cell-val {
  padding: 4px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
}
.sec-sev-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  line-height: 1.6;
}
.sec-class-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(109, 92, 224, 0.1);
  color: #6d5ce0;
}
.dark .sec-class-badge {
  background: rgba(109, 92, 224, 0.22);
  color: #a78bfa;
}
.sev-critical {
  background: #fef2f2;
  color: #dc2626;
}
.sev-high {
  background: #fff7ed;
  color: #ea580c;
}
.sev-medium {
  background: #fefce8;
  color: #854d0e;
}
.sev-low {
  background: #eff6ff;
  color: #2563eb;
}
.sev-info {
  background: #f9fafb;
  color: #6b7280;
}
.dark .sev-critical {
  background: rgba(220, 38, 38, 0.18);
  color: #f87171;
}
.dark .sev-high {
  background: rgba(234, 88, 12, 0.18);
  color: #fb923c;
}
.dark .sev-medium {
  background: rgba(202, 138, 4, 0.18);
  color: #fcd34d;
}
.dark .sev-low {
  background: rgba(37, 99, 235, 0.18);
  color: #60a5fa;
}
.dark .sev-info {
  background: rgba(107, 114, 128, 0.18);
  color: #9ca3af;
}
.sec-row-skeleton {
  height: 34px;
  border-radius: 3px;
  margin: 2px 8px;
  background: rgba(0, 0, 0, 0.04);
  animation: sec-pulse 1.4s ease-in-out infinite;
}
.dark .sec-row-skeleton {
  background: rgba(255, 255, 255, 0.04);
}
@keyframes sec-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.75;
  }
}
</style>
