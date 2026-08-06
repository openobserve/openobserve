<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import DateTime from "@/components/DateTime.vue";
import SecurityEventDrawer from "./SecurityEventDrawer.vue";
import streamService from "@/services/stream";
import searchService from "@/services/search";

// ── Store / route ─────────────────────────────────────────────────────────────
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

// ── Splitter sizes ────────────────────────────────────────────────────────────
const topSplitter = ref(120);
const sideSplitter = ref(240);

// ── Security stream registry (localStorage-backed) ────────────────────────────
// Key: oo_sec_streams_<orgId> → string[] (user-tagged stream names)
// Key: oo_sec_ocsf_<orgId>   → Record<stream, boolean> (OCSF+Sigma flags)
const SEC_RE = /security|audit|siem|event|login|auth|access|cloudtrail|okta|firewall|vpc|cdc/i;

function lsKey(suffix: string) { return `oo_sec_${suffix}_${orgId.value}`; }

function loadTaggedStreams(): string[] {
  try { return JSON.parse(localStorage.getItem(lsKey("streams")) ?? "[]"); } catch { return []; }
}
function saveTaggedStreams(list: string[]) {
  localStorage.setItem(lsKey("streams"), JSON.stringify(list));
}
function loadOcsfFlags(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(lsKey("ocsf")) ?? "{}"); } catch { return {}; }
}
function saveOcsfFlags(flags: Record<string, boolean>) {
  localStorage.setItem(lsKey("ocsf"), JSON.stringify(flags));
}

const taggedStreams = ref<string[]>([]);   // user-added (non-auto-detected) streams
const ocsfFlags    = ref<Record<string, boolean>>({});

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
  allStreams.value.filter((n) => !secStreamNames.value.includes(n))
);
// Streams that are tagged by user (can show "−" button)
function isUserTagged(name: string) { return taggedStreams.value.includes(name); }
// Streams that have OCSF enabled
function hasOcsf(name: string) { return !!ocsfFlags.value[name]; }

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
interface StreamField { name: string; ftype: string }
const schemaFields = ref<StreamField[]>([]);
const fieldSearch = ref("");

const OCSF_PATTERNS: [RegExp, string][] = [
  [/^(class_uid|class_name|activity_id|activity_name|type_uid|severity_id|status|status_code)$/, "Event"],
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
  const groups: Record<string, StreamField[]> = { Event: [], Actor: [], Network: [], Device: [], Metadata: [], Other: [] };
  for (const f of filtered) groups[ocsfCat(f.name) ?? "Other"].push(f);
  return Object.entries(groups).filter(([, fs]) => fs.length > 0);
});

// ── Column visibility ─────────────────────────────────────────────────────────
const PREFERRED = ["_timestamp","severity_id","class_name","activity_name","actor.user.name","src_endpoint.ip","device.hostname","metadata.product.name"];
const visibleCols = ref<string[]>([]);
const expandedGroups = ref<Set<string>>(new Set(["Event","Other"]));
const sourcesExpanded = ref(true);

function initColumns(fields: StreamField[]) {
  const names = new Set(fields.map((f) => f.name));
  const p = PREFERRED.filter((c) => names.has(c));
  visibleCols.value = p.length >= 2
    ? p
    : ["_timestamp", ...fields.filter((f) => !f.name.startsWith("_")).slice(0, 6).map((f) => f.name)];
}
function toggleCol(name: string) {
  const i = visibleCols.value.indexOf(name);
  if (i === -1) visibleCols.value.push(name);
  else if (visibleCols.value.length > 1) visibleCols.value.splice(i, 1);
}

// ── Time / filters ────────────────────────────────────────────────────────────
const timeRange = ref({ start: 0, end: 0 });
const sqlQuery = ref("");
const sqlMode = ref(false); // true = raw SQL, false = query builder (filter chips)
const severityFilter = ref<number | null>(null);
const hasSeverity = computed(() => schemaFields.value.some((f) => f.name === "severity_id"));
const fieldFilters = ref<{ field: string; op: string; value: string }[]>([]);

// ── Filter builder (inline add row) ──────────────────────────────────────────
const filterBuilderField = ref("");
const filterBuilderOp    = ref("=");
const filterBuilderValue = ref("");
const fieldValueOptions  = ref<{ label: string; value: string }[]>([]);
const fieldValuesLoading = ref(false);

const FILTER_OPS = [
  { label: "=",            value: "=" },
  { label: "!=",           value: "!=" },
  { label: "contains",     value: "contains" },
  { label: "not contains", value: "not_contains" },
];

const SEVERITY_SEL_OPTS = [
  { label: "All Severities", value: "" },
  { label: "Critical (5)",   value: "5" },
  { label: "High (4)",       value: "4" },
  { label: "Medium (3)",     value: "3" },
  { label: "Low (2)",        value: "2" },
  { label: "Info (1)",       value: "1" },
];

const severitySelectVal = computed({
  get: () => severityFilter.value === null ? "" : String(severityFilter.value),
  set: (v: string) => { severityFilter.value = v === "" ? null : Number(v); },
});

const fieldNameOptions = computed(() =>
  schemaFields.value.map((f) => ({ label: f.name, value: f.name }))
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
    const vals: string[] = hits.flatMap((h: any) => (h.values ?? []).map((v: any) => String(v.zo_sql_key ?? v.key ?? v)));
    fieldValueOptions.value = [...new Set(vals)].map((v) => ({ label: v, value: v }));
  } catch { fieldValueOptions.value = []; }
  finally { fieldValuesLoading.value = false; }
}

watch(filterBuilderField, (v) => { filterBuilderValue.value = ""; loadFieldValues(v); });

function commitFilter() {
  const field = filterBuilderField.value.trim();
  const val   = filterBuilderValue.value.trim();
  if (!field || !val) return;
  addFilter(field, val, filterBuilderOp.value);
  filterBuilderValue.value = "";
}

const SEVERITY_OPTS = [
  { id: null, label: "All",      cls: "" },
  { id: 5,    label: "Critical", cls: "sev-critical" },
  { id: 4,    label: "High",     cls: "sev-high" },
  { id: 3,    label: "Medium",   cls: "sev-medium" },
  { id: 2,    label: "Low",      cls: "sev-low" },
  { id: 1,    label: "Info",     cls: "sev-info" },
] as const;

function addFilter(field: string, value: string, op = "=") {
  if (!value) return;
  if (!fieldFilters.value.some((f) => f.field === field && f.value === value && f.op === op)) {
    fieldFilters.value.push({ field, op, value });
    syncUrl();
    runSearch();
  }
}
function removeFilter(idx: number) {
  fieldFilters.value.splice(idx, 1);
  syncUrl();
  runSearch();
}

// ── Severity row coloring ─────────────────────────────────────────────────────
const SEV_MAP: Record<number, { label: string; cls: string }> = {
  5: { label: "Critical", cls: "sev-critical" },
  4: { label: "High",     cls: "sev-high" },
  3: { label: "Medium",   cls: "sev-medium" },
  2: { label: "Low",      cls: "sev-low" },
  1: { label: "Info",     cls: "sev-info" },
};
function sevInfo(id: any) { return SEV_MAP[Number(id)] ?? { label: "", cls: "sev-info" }; }
function rowSevClass(ev: any): string {
  if (!hasSeverity.value) return "";
  const n = Number(ev.severity_id);
  return n >= 5 ? "row-sev-critical" : n >= 4 ? "row-sev-high" : n >= 3 ? "row-sev-medium" : n >= 2 ? "row-sev-low" : "row-sev-info";
}

// ── Results ───────────────────────────────────────────────────────────────────
const events = ref<any[]>([]);
const loading = ref(false);
const total = ref(0);
const errorMsg = ref("");

// ── Drawer ────────────────────────────────────────────────────────────────────
const drawerEvent = ref<any | null>(null);

function openDrawer(ev: any) {
  drawerEvent.value = ev;
  router.replace({ query: { ...route.query, event_ts: String(ev._timestamp) } });
}
function closeDrawer() {
  drawerEvent.value = null;
  const q = { ...route.query };
  delete q.event_ts;
  router.replace({ query: q });
}
const shareUrl = computed(() => {
  if (!drawerEvent.value || typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  if (selectedStream.value) url.searchParams.set("stream", selectedStream.value);
  url.searchParams.set("event_ts", String(drawerEvent.value._timestamp));
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
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function defaultTimeRange() {
  const end = Date.now() * 1000;
  return { start: end - 15 * 60 * 1_000_000, end };
}

// ── SQL builder ───────────────────────────────────────────────────────────────
const sqlPlaceholder = computed(() =>
  `SELECT * FROM "${selectedStream.value ?? "stream"}" WHERE severity_id >= 3 ORDER BY _timestamp DESC`
);
function buildSQL(): string {
  const stream = selectedStream.value;
  if (!stream) return "";
  if (sqlMode.value && sqlQuery.value.trim()) return sqlQuery.value.trim();
  if (!sqlMode.value) {
    const parts: string[] = [];
    if (severityFilter.value !== null && hasSeverity.value) parts.push(`severity_id = ${severityFilter.value}`);
    for (const f of fieldFilters.value) {
      const v = f.value.replace(/'/g, "''");
      if (f.op === "!=")             parts.push(`"${f.field}" != '${v}'`);
      else if (f.op === "contains")  parts.push(`"${f.field}" LIKE '%${v}%'`);
      else if (f.op === "not_contains") parts.push(`"${f.field}" NOT LIKE '%${v}%'`);
      else                           parts.push(`"${f.field}" = '${v}'`);
    }
    const where = parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
    return `SELECT * FROM "${stream}"${where} ORDER BY _timestamp DESC`;
  }
  return `SELECT * FROM "${stream}" ORDER BY _timestamp DESC`;
}

// ── URL sync ──────────────────────────────────────────────────────────────────
function syncUrl() {
  const q: Record<string, string> = { ...(route.query as any), org_identifier: orgId.value };
  if (selectedStream.value) q.stream = selectedStream.value; else delete q.stream;
  if (sqlMode.value && sqlQuery.value.trim()) q.query = sqlQuery.value.trim(); else delete q.query;
  if (severityFilter.value !== null) q.severity = String(severityFilter.value); else delete q.severity;
  if (fieldFilters.value.length) q.filters = JSON.stringify(fieldFilters.value); else delete q.filters;
  if (drawerEvent.value) q.event_ts = String(drawerEvent.value._timestamp); else delete q.event_ts;
  router.replace({ query: q });
}

// ── Load streams ──────────────────────────────────────────────────────────────
async function loadStreams() {
  streamsLoading.value = true;
  try {
    const res = await streamService.nameList(orgId.value, "logs", false);
    allStreams.value = (res.data?.list ?? []).map((s: any) => s.name);
    buildStreamOptions();
    const urlStream = route.query.stream as string;
    if (urlStream && allStreams.value.includes(urlStream)) selectedStream.value = urlStream;
    else if (secStreamNames.value.length) selectedStream.value = secStreamNames.value[0];
    else if (allStreams.value.length) selectedStream.value = allStreams.value[0];
  } finally { streamsLoading.value = false; }
}

// ── Load schema ───────────────────────────────────────────────────────────────
async function loadSchema(streamName: string) {
  schemaFields.value = [];
  try {
    const res = await streamService.schema(orgId.value, streamName, "logs");
    const raw: any[] = res.data?.schema ?? res.data?.fields ?? [];
    schemaFields.value = raw.map((f: any) => ({ name: f.name, ftype: f.field_type ?? f.ftype ?? "" }));
    initColumns(schemaFields.value);
  } catch { schemaFields.value = []; }
}

// ── Run search ────────────────────────────────────────────────────────────────
async function runSearch() {
  if (!selectedStream.value || !orgId.value) return;
  loading.value = true;
  errorMsg.value = "";
  const { start, end } = timeRange.value.end ? timeRange.value : defaultTimeRange();
  try {
    const res = await searchService.search(
      { org_identifier: orgId.value, query: { query: { sql: buildSQL(), start_time: start, end_time: end, from: 0, size: 200 } }, page_type: "logs" },
      "ui",
    );
    events.value = res.data?.hits ?? [];
    total.value = res.data?.total ?? events.value.length;
    if (!schemaFields.value.length && events.value.length) {
      schemaFields.value = Object.keys(events.value[0]).map((k) => ({ name: k, ftype: "Utf8" }));
      initColumns(schemaFields.value);
    }
    const urlTs = route.query.event_ts as string;
    if (urlTs && !drawerEvent.value) {
      const found = events.value.find((e) => String(e._timestamp) === urlTs);
      if (found) drawerEvent.value = found;
    } else if (drawerEvent.value) {
      const refreshed = events.value.find((e) => String(e._timestamp) === String(drawerEvent.value._timestamp));
      if (refreshed) drawerEvent.value = refreshed;
    }
  } catch (e: any) {
    errorMsg.value = e?.response?.data?.error ?? e?.message ?? "Search failed";
    events.value = [];
    total.value = 0;
  } finally { loading.value = false; }
}

// ── Watchers ──────────────────────────────────────────────────────────────────
let mountComplete = false;
watch(selectedStream, async (v) => {
  if (!mountComplete) return;
  if (!v) return;
  fieldFilters.value = [];
  severityFilter.value = null;
  sqlQuery.value = "";
  syncUrl();
  await loadSchema(v);
  runSearch();
});
watch(severityFilter, () => { if (!mountComplete) return; syncUrl(); runSearch(); });

// ── DateTime ──────────────────────────────────────────────────────────────────
function onDateChange(dt: any) {
  timeRange.value = { start: Number(dt.startTime), end: Number(dt.endTime) };
  runSearch();
}

// ── Mount ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  taggedStreams.value = loadTaggedStreams();
  ocsfFlags.value = loadOcsfFlags();
  timeRange.value = defaultTimeRange();
  if (route.query.query) { sqlQuery.value = route.query.query as string; sqlMode.value = true; }
  if (route.query.severity) severityFilter.value = Number(route.query.severity);
  if (route.query.filters) { try { const parsed = JSON.parse(route.query.filters as string); fieldFilters.value = parsed.map((f: any) => ({ field: f.field, op: f.op ?? "=", value: f.value })); } catch { /**/ } }
  await loadStreams();
  mountComplete = true;
  if (selectedStream.value) { await loadSchema(selectedStream.value); runSearch(); }
});
</script>

<template>
  <div class="rounded-default h-full max-h-full! min-h-full! overflow-hidden flex flex-row" id="secEventsPage">

    <!-- ── LEFT: search bar + field panel + results ──────────────────────────── -->
    <div class="sec-main-pane" :class="{ 'sec-main-pane--split': drawerEvent }">
      <div class="h-full max-h-full overflow-hidden">
        <OSplitter
          class="h-full max-h-full overflow-hidden"
          v-model="topSplitter"
          :horizontal="true"
          unit="px"
          :limits="[80, 260]"
          :separatorStyle="{ height: '10px', marginTop: '-5px', marginBottom: '-5px', zIndex: '10' }"
        >
          <!-- ── SEARCH BAR ─────────────────────────────────────────────────── -->
          <template #before>
            <div class="h-full w-full flex flex-col bg-surface-panel">
              <!-- Toolbar: stream selector + filters + datetime + run -->
              <div class="border-border-default border-b flex w-full items-center gap-1.5 overflow-x-auto px-1.5 py-1">
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
                  <button :class="['sec-mode-btn', { 'sec-mode-btn--active': !sqlMode }]" @click="sqlMode = false">Filters</button>
                  <button :class="['sec-mode-btn', { 'sec-mode-btn--active': sqlMode }]" @click="sqlMode = true">SQL</button>
                </div>

                <!-- Severity dropdown (same toolbar level as Filters/SQL) -->
                <OSelect
                  v-if="!sqlMode && hasSeverity"
                  v-model="severitySelectVal"
                  :options="SEVERITY_SEL_OPTS"
                  class="sec-severity-sel shrink-0"
                />

                <div class="flex-1 min-w-2" />

                <!-- DateTime picker -->
                <DateTime
                  defaultRelativeTime="15m"
                  defaultType="relative"
                  :autoApply="true"
                  class="shrink-0"
                  @on:date-change="onDateChange"
                />

                <!-- Run button -->
                <OButton size="sm" variant="solid" :loading="loading" class="shrink-0" @click="runSearch">
                  <OIcon name="play-arrow" size="sm" />
                  Run
                </OButton>
              </div>

              <!-- Filter builder row (only in filter mode) -->
              <div v-if="!sqlMode" class="sec-filter-builder-row">
                <!-- Field + Op + Value add row -->
                <div class="flex items-center gap-1 flex-1 min-w-0">
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
                  <OButton size="sm" variant="outline" class="shrink-0" :disabled="!filterBuilderField || !filterBuilderValue" @click="commitFilter">
                    <OIcon name="add" size="xs" />
                    Add
                  </OButton>
                </div>

                <!-- Active filter chips -->
                <div v-if="fieldFilters.length" class="flex flex-wrap gap-1 items-center">
                  <div v-for="(f, i) in fieldFilters" :key="i" class="sec-filter-chip">
                    <span class="max-w-48 truncate text-xs font-mono">
                      <strong>{{ f.field }}</strong>
                      <span class="sec-filter-op-label">{{ f.op === 'not_contains' ? 'not ~' : f.op === 'contains' ? '~' : f.op }}</span>
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
            <div class="border-border-default border-t h-full max-h-full overflow-hidden">
              <OSplitter
                v-model="sideSplitter"
                :limits="[180, 440]"
                unit="px"
                class="h-full max-h-full w-full overflow-hidden"
                :separatorStyle="{ width: '10px', marginLeft: '-5px', marginRight: '-5px', zIndex: '10' }"
              >

                <!-- ── FIELD SIDEBAR ────────────────────────────────────── -->
                <template #before>
                  <div class="bg-surface-panel border-border-default h-full border-r flex flex-col overflow-hidden">

                    <!-- Field search -->
                    <div class="px-2 py-2 shrink-0">
                      <div class="border-border-default bg-input-bg flex items-center gap-1 rounded border px-2 py-1">
                        <OIcon name="manage-search" size="xs" class="text-text-tertiary shrink-0" />
                        <input v-model="fieldSearch" type="text" placeholder="Search fields…"
                          class="text-input-text placeholder:text-input-placeholder min-w-0 flex-1 bg-transparent text-xs outline-none" />
                      </div>
                    </div>

                    <div class="flex-1 overflow-y-auto">
                      <!-- ── SOURCES section ── -->
                      <button class="sec-field-group-hdr" @click="sourcesExpanded = !sourcesExpanded">
                        <OIcon :name="sourcesExpanded ? 'expand-more' : 'arrow-forward'" size="xs" class="text-text-tertiary shrink-0" />
                        <span class="min-w-0 flex-1 truncate text-left text-xs font-semibold text-text-secondary uppercase tracking-widest">Sources</span>
                      </button>

                      <div v-if="sourcesExpanded">
                        <!-- Security streams with − button for user-tagged ones -->
                        <div
                          v-for="name in secStreamNames"
                          :key="name"
                          :class="['sec-source-row', { 'sec-source-row--active': selectedStream === name }]"
                          @click="selectedStream = name"
                        >
                          <div class="sec-source-dot" :class="hasOcsf(name) ? 'sec-source-dot--ocsf' : 'sec-source-dot--auto'" />
                          <span class="sec-source-name" :title="name">{{ name }}</span>
                          <span v-if="hasOcsf(name)" class="sec-ocsf-badge" title="OCSF + Sigma enabled">OCSF</span>
                          <!-- Only show − for user-tagged (not auto-detected) streams -->
                          <button
                            v-if="isUserTagged(name)"
                            class="sec-source-action sec-source-action--remove"
                            title="Remove from security streams"
                            @click.stop="removeStreamFromSecurity(name)"
                          >−</button>
                        </div>

                        <!-- + Add stream button -->
                        <div class="px-2 py-1">
                          <button class="sec-add-source-btn" @click="showAddStream = !showAddStream">
                            <OIcon name="add" size="xs" />
                            Add stream
                          </button>
                        </div>

                        <!-- Add stream picker -->
                        <div v-if="showAddStream" class="sec-add-source-panel">
                          <div class="sec-add-source-header">
                            <span class="text-xs font-semibold text-text-secondary">Other streams</span>
                            <button class="sec-add-close" @click="showAddStream = false">✕</button>
                          </div>
                          <div v-if="otherStreamNames.length">
                            <div
                              v-for="name in otherStreamNames"
                              :key="name"
                              class="sec-add-stream-row"
                              @click="addStreamToSecurity(name); showAddStream = false"
                            >
                              <span class="text-xs truncate flex-1 font-mono">{{ name }}</span>
                              <span class="sec-add-plus">+</span>
                            </div>
                          </div>
                          <div v-else class="text-text-tertiary text-xs px-3 py-2">All streams are already in security</div>
                        </div>
                      </div>

                      <!-- Divider -->
                      <div class="border-border-default border-t mx-2 my-1" />

                      <!-- ── FIELDS grouped ── -->
                      <div v-if="!schemaFields.length" class="px-3 py-4 text-center">
                        <span class="text-text-tertiary text-xs">Select a stream to see fields</span>
                      </div>
                      <template v-for="[groupName, fields] in groupedFields" :key="groupName">
                        <button class="sec-field-group-hdr"
                          @click="expandedGroups.has(groupName) ? expandedGroups.delete(groupName) : expandedGroups.add(groupName)">
                          <OIcon :name="expandedGroups.has(groupName) ? 'expand-more' : 'arrow-forward'" size="xs" class="text-text-tertiary shrink-0" />
                          <span class="min-w-0 flex-1 truncate text-left text-xs font-semibold">{{ groupName }}</span>
                          <span class="text-text-tertiary text-xs tabular-nums">{{ fields.length }}</span>
                        </button>
                        <div v-if="expandedGroups.has(groupName)">
                          <div v-for="field in fields" :key="field.name"
                            :class="['sec-field-row', { 'sec-field-row--active': visibleCols.includes(field.name) }]">
                            <span class="sec-field-name" :title="field.name">{{ field.name }}</span>
                            <span class="sec-field-type">{{ field.ftype?.slice(0, 3) ?? "" }}</span>
                            <button :class="['sec-field-btn', { 'sec-field-btn--on': visibleCols.includes(field.name) }]"
                              :title="visibleCols.includes(field.name) ? 'Remove column' : 'Add as column'"
                              @click.stop="toggleCol(field.name)">
                              <OIcon :name="visibleCols.includes(field.name) ? 'visibility-off' : 'format-list-bulleted'" size="xs" />
                            </button>
                            <button class="sec-field-btn" title="Add to WHERE clause"
                              @click.stop="sqlQuery = `SELECT * FROM &quot;${selectedStream}&quot; WHERE &quot;${field.name}&quot; = '' ORDER BY _timestamp DESC`; sqlMode = true">
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

                    <div v-else-if="!selectedStream" class="flex h-48 flex-col items-center justify-center gap-3">
                      <OIcon name="manage-search" size="xl" class="text-text-tertiary opacity-30" />
                      <div class="text-text-secondary text-sm font-medium">Select a stream to begin</div>
                    </div>

                    <div v-else-if="events.length === 0" class="flex h-48 flex-col items-center justify-center gap-3">
                      <OIcon name="manage-search" size="xl" class="text-text-tertiary opacity-30" />
                      <div class="text-text-primary text-sm font-medium">No events found</div>
                      <div class="text-text-secondary text-xs">Adjust filters or widen the time range</div>
                    </div>

                    <template v-else>
                      <!-- Result count bar -->
                      <div class="border-border-default bg-card-glass-bg sticky top-0 z-10 flex h-8 items-center border-b px-3 text-xs">
                        <span class="text-text-secondary font-medium">{{ total.toLocaleString() }} event{{ total !== 1 ? "s" : "" }}</span>
                        <div class="flex-1" />
                        <span class="text-text-tertiary">{{ visibleCols.length }} cols</span>
                      </div>

                      <!-- Column headers -->
                      <div class="sec-col-header">
                        <div class="sec-expand-cell" />
                        <div v-for="col in visibleCols" :key="col"
                          class="sec-col-hdr-cell"
                          :class="col === '_timestamp' ? 'sec-ts-cell' : 'sec-data-cell'">
                          {{ col === "_timestamp" ? "Timestamp" : col }}
                        </div>
                      </div>

                      <!-- Event rows -->
                      <div v-for="(ev, idx) in events" :key="idx"
                        :class="['sec-event-row', rowSevClass(ev), { 'sec-event-row--active': drawerEvent === ev }]"
                        @click="openDrawer(ev)">
                        <div class="sec-expand-cell">
                          <OIcon :name="drawerEvent === ev ? 'expand-more' : 'arrow-forward'" size="xs" class="text-text-tertiary" />
                        </div>
                        <div v-for="col in visibleCols" :key="col"
                          class="sec-data-cell-val"
                          :class="col === '_timestamp' ? 'sec-ts-cell' : 'sec-data-cell'">
                          <template v-if="col === 'severity_id' && ev.severity_id != null">
                            <span :class="['sec-sev-badge', sevInfo(ev.severity_id).cls]">{{ sevInfo(ev.severity_id).label }}</span>
                          </template>
                          <template v-else-if="col === 'class_name' && ev.class_name">
                            <span class="sec-class-badge">{{ ev.class_name }}</span>
                          </template>
                          <template v-else-if="col === '_timestamp'">{{ fmtTs(ev._timestamp) }}</template>
                          <template v-else>
                            <span class="truncate">{{ getVal(ev, col) || "—" }}</span>
                          </template>
                        </div>
                      </div>
                    </template>
                  </div>
                </template>
              </OSplitter>
            </div>
          </template>
        </OSplitter>
      </div>
    </div>

    <!-- ── RIGHT: drawer (full height, half page) ──────────────────────────── -->
    <Transition name="sec-drawer-slide">
      <SecurityEventDrawer
        v-if="drawerEvent"
        class="sec-drawer-pane"
        :event="drawerEvent"
        :stream="selectedStream ?? ''"
        :share-url="shareUrl"
        @close="closeDrawer"
        @add-filter="addFilter"
      />
    </Transition>
  </div>
</template>

<style>
/* ── Root layout ─────────────────────────────────────────────────────────── */
.sec-main-pane {
  flex: 1 1 100%; min-width: 0; overflow: hidden;
  transition: flex-basis 0.26s cubic-bezier(0.16, 1, 0.3, 1), max-width 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}
.sec-main-pane--split { flex: 0 0 50%; max-width: 50%; }

.sec-drawer-pane {
  flex: 0 0 50%; width: 50%; min-width: 380px; height: 100%; overflow: hidden;
}
.sec-drawer-slide-enter-active { transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease; }
.sec-drawer-slide-leave-active { transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1), opacity 0.15s ease; }
.sec-drawer-slide-enter-from, .sec-drawer-slide-leave-to { transform: translateX(32px); opacity: 0; }

/* ── Mode toggle (Filters / SQL) ─────────────────────────────────────────── */
.sec-mode-toggle {
  display: flex; gap: 0; background: rgba(0,0,0,0.05); border-radius: 5px; padding: 1px;
}
.dark .sec-mode-toggle { background: rgba(255,255,255,0.06); }
.sec-mode-btn {
  padding: 2px 10px; border-radius: 4px; border: none; background: none; font-size: 11px; font-weight: 600;
  cursor: pointer; color: var(--color-text-secondary, #6b7280); transition: all 0.1s; white-space: nowrap;
}
.sec-mode-btn--active {
  background: white; color: #6d5ce0 !important; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.dark .sec-mode-btn--active { background: #2a2a3a; }

/* ── Filter builder row ──────────────────────────────────────────────────── */
.sec-filter-builder-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 5px 8px; min-height: 38px;
  border-top: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  background: var(--color-surface-panel, #f9fafb);
}
.dark .sec-filter-builder-row { background: #0f111a; }

.sec-filter-divider {
  width: 1px; height: 18px; background: var(--color-border-default, rgba(0,0,0,0.1));
  flex-shrink: 0;
}

.sec-severity-sel     { width: 150px; flex-shrink: 0; }
.sec-filter-field-sel { width: 160px; flex-shrink: 0; }
.sec-filter-op-sel    { width: 110px; flex-shrink: 0; }
.sec-filter-value-sel { width: 200px; flex-shrink: 0; }

.sec-filter-op-label { opacity: 0.55; margin: 0 3px; font-weight: 400; }

/* ── SQL editor ──────────────────────────────────────────────────────────── */
.sec-sql-editor-row {
  position: relative; display: flex; flex-direction: column;
  border-top: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  background: var(--color-input-bg, #fafafa);
}
.dark .sec-sql-editor-row { background: #12131a; }
.sec-sql-textarea {
  width: 100%; resize: none; border: none; outline: none; background: transparent;
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 12.5px; line-height: 1.6; padding: 8px 12px 4px;
  color: var(--color-text-primary, #111); min-height: 52px;
}
.dark .sec-sql-textarea { color: #e5e7eb; }
.sec-sql-textarea::placeholder { color: var(--color-text-tertiary, #9ca3af); opacity: 1; }
.sec-sql-hint {
  font-size: 10px; color: var(--color-text-tertiary, #9ca3af); padding: 0 12px 4px;
  text-align: right; font-family: monospace; user-select: none;
}

/* ── Severity chips ──────────────────────────────────────────────────────── */
.sec-sev-chip {
  padding: 2px 10px; border-radius: 99px;
  border: 1px solid var(--color-border-default, rgba(0,0,0,0.12));
  background: transparent; font-size: 11px; font-weight: 500;
  cursor: pointer; transition: all 0.12s; line-height: 1.6; white-space: nowrap;
}
.sec-sev-chip:hover:not(.sec-sev-chip--active) { background: rgba(0,0,0,0.04); }
.dark .sec-sev-chip:hover:not(.sec-sev-chip--active) { background: rgba(255,255,255,0.06); }
.sec-sev-chip.sec-sev-chip--active.sev-critical { background: #dc2626; color: #fff; border-color: #dc2626; }
.sec-sev-chip.sec-sev-chip--active.sev-high     { background: #ea580c; color: #fff; border-color: #ea580c; }
.sec-sev-chip.sec-sev-chip--active.sev-medium   { background: #ca8a04; color: #fff; border-color: #ca8a04; }
.sec-sev-chip.sec-sev-chip--active.sev-low      { background: #2563eb; color: #fff; border-color: #2563eb; }
.sec-sev-chip.sec-sev-chip--active.sev-info     { background: #6b7280; color: #fff; border-color: #6b7280; }
.sec-sev-chip.sec-sev-chip--active:not([class*="sev-"]) { background: #6d5ce0; color: #fff; border-color: #6d5ce0; }

/* ── Filter chips ────────────────────────────────────────────────────────── */
.sec-filter-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px 1px 8px; border-radius: 4px;
  background: rgba(109,92,224,0.1); border: 1px solid rgba(109,92,224,0.2); font-size: 11px;
}
.sec-filter-remove { background: none; border: none; cursor: pointer; padding: 0; color: #9ca3af; line-height: 1; }

/* ── SOURCES section ─────────────────────────────────────────────────────── */
.sec-source-row {
  display: flex; align-items: center; gap: 5px; padding: 4px 12px 4px 28px; cursor: pointer; transition: background 0.08s;
}
.sec-source-row:hover { background: rgba(0,0,0,0.03); }
.dark .sec-source-row:hover { background: rgba(255,255,255,0.03); }
.sec-source-row--active { background: rgba(109,92,224,0.08) !important; }
.dark .sec-source-row--active { background: rgba(109,92,224,0.14) !important; }
.sec-source-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.sec-source-dot--auto { background: #22c55e; }
.sec-source-dot--ocsf { background: #6d5ce0; }
.dark .sec-source-dot--ocsf { background: #a78bfa; }
.sec-source-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; font-family: monospace; }
.sec-ocsf-badge {
  font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; flex-shrink: 0;
  background: rgba(109,92,224,0.12); color: #6d5ce0; letter-spacing: 0.04em;
}
.dark .sec-ocsf-badge { background: rgba(167,139,250,0.15); color: #a78bfa; }
.sec-source-action {
  flex-shrink: 0; width: 18px; height: 18px; border-radius: 4px; border: none; background: none;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; line-height: 1; opacity: 0; transition: opacity 0.1s, background 0.1s; color: inherit;
}
.sec-source-row:hover .sec-source-action { opacity: 1; }
.sec-source-action--remove:hover { background: rgba(220,38,38,0.12); color: #dc2626; }

.sec-add-source-btn {
  display: flex; align-items: center; gap: 3px; width: 100%;
  padding: 3px 6px; border-radius: 4px; border: 1px dashed var(--color-border-default, rgba(0,0,0,0.12));
  background: none; cursor: pointer; font-size: 11px; color: var(--color-text-tertiary, #9ca3af); transition: all 0.1s;
}
.sec-add-source-btn:hover { border-color: #6d5ce0; color: #6d5ce0; background: rgba(109,92,224,0.05); }

.sec-add-source-panel {
  border-top: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  background: rgba(0,0,0,0.02); max-height: 200px; overflow-y: auto;
}
.dark .sec-add-source-panel { background: rgba(255,255,255,0.02); }
.sec-add-source-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 12px; font-size: 11px;
}
.sec-add-close { background: none; border: none; cursor: pointer; color: var(--color-text-tertiary, #9ca3af); font-size: 12px; }
.sec-add-stream-row {
  display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 16px;
  cursor: pointer; transition: background 0.08s;
}
.sec-add-stream-row:hover { background: rgba(109,92,224,0.06); }
.sec-add-plus {
  width: 18px; height: 18px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
  background: rgba(22,163,74,0.1); color: #16a34a; font-size: 14px; font-weight: 700; flex-shrink: 0;
}

/* ── Field sidebar shared ────────────────────────────────────────────────── */
.sec-field-group-hdr {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 5px 12px; background: none; border: none; cursor: pointer; transition: background 0.1s;
}
.sec-field-group-hdr:hover { background: rgba(0,0,0,0.04); }
.dark .sec-field-group-hdr:hover { background: rgba(255,255,255,0.04); }
.sec-field-row {
  display: flex; align-items: center; gap: 4px; padding: 3px 12px 3px 28px; transition: background 0.08s;
}
.sec-field-row:hover { background: rgba(0,0,0,0.03); }
.dark .sec-field-row:hover { background: rgba(255,255,255,0.03); }
.sec-field-row--active { background: rgba(109,92,224,0.06); }
.dark .sec-field-row--active { background: rgba(109,92,224,0.1); }
.sec-field-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-family: monospace; }
.sec-field-type { font-size: 10px; color: var(--color-text-tertiary, #9ca3af); font-family: monospace; width: 24px; text-align: right; flex-shrink: 0; }
.sec-field-btn { padding: 2px; border: none; background: none; cursor: pointer; border-radius: 3px; color: var(--color-text-tertiary, #9ca3af); opacity: 0; transition: opacity 0.1s; flex-shrink: 0; }
.sec-field-row:hover .sec-field-btn { opacity: 1; }
.sec-field-btn:hover { color: #6d5ce0; }
.sec-field-btn--on { color: #6d5ce0; opacity: 1 !important; }

/* ── Results ─────────────────────────────────────────────────────────────── */
.sec-col-header {
  display: flex; align-items: center; position: sticky; top: 32px; z-index: 1;
  background: var(--color-surface-base, #fff);
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.08));
  font-size: 11px; font-weight: 600; color: var(--color-text-tertiary, #9ca3af);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.dark .sec-col-header { background: var(--d-base, #0d1117); }
.sec-event-row {
  display: flex; align-items: center; min-height: 34px;
  border-bottom: 1px solid var(--color-border-default, rgba(0,0,0,0.06));
  border-left: 3px solid transparent; cursor: pointer; font-size: 12px; transition: background 0.08s;
}
.sec-event-row:hover { background: rgba(0,0,0,0.025); }
.dark .sec-event-row { border-color: rgba(255,255,255,0.05); }
.dark .sec-event-row:hover { background: rgba(255,255,255,0.025); }
.sec-event-row--active { background: rgba(109,92,224,0.07) !important; }
.dark .sec-event-row--active { background: rgba(109,92,224,0.12) !important; }
.row-sev-critical { border-left-color: #dc2626; }
.row-sev-high     { border-left-color: #ea580c; }
.row-sev-medium   { border-left-color: #ca8a04; }
.row-sev-low      { border-left-color: #2563eb; }
.row-sev-info     { border-left-color: #9ca3af; }
.sec-expand-cell { width: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.sec-ts-cell { width: 148px; flex-shrink: 0; font-size: 11px; color: var(--color-text-secondary, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sec-data-cell { flex: 1; min-width: 80px; max-width: 220px; overflow: hidden; }
.sec-col-hdr-cell { padding: 6px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sec-data-cell-val { padding: 4px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; }
.sec-sev-badge {
  display: inline-block; padding: 1px 6px; border-radius: 3px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1.6;
}
.sec-class-badge {
  display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 11px; font-weight: 500;
  background: rgba(109,92,224,0.1); color: #6d5ce0;
}
.dark .sec-class-badge { background: rgba(109,92,224,0.22); color: #a78bfa; }
.sev-critical { background: #fef2f2; color: #dc2626; }
.sev-high     { background: #fff7ed; color: #ea580c; }
.sev-medium   { background: #fefce8; color: #854d0e; }
.sev-low      { background: #eff6ff; color: #2563eb; }
.sev-info     { background: #f9fafb; color: #6b7280; }
.dark .sev-critical { background: rgba(220,38,38,0.18); color: #f87171; }
.dark .sev-high     { background: rgba(234,88,12,0.18); color: #fb923c; }
.dark .sev-medium   { background: rgba(202,138,4,0.18); color: #fcd34d; }
.dark .sev-low      { background: rgba(37,99,235,0.18); color: #60a5fa; }
.dark .sev-info     { background: rgba(107,114,128,0.18); color: #9ca3af; }
.sec-row-skeleton { height: 34px; border-radius: 3px; margin: 2px 8px; background: rgba(0,0,0,0.04); animation: sec-pulse 1.4s ease-in-out infinite; }
.dark .sec-row-skeleton { background: rgba(255,255,255,0.04); }
@keyframes sec-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.75; } }
</style>
