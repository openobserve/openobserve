<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Cases — where triage lives.
     A case is an OpenObserve incident: related firings rolled up by the
     correlation engine, with a status an analyst moves along, a timeline, and
     comments. Firings are facts (Alerts page); a case is the decision made
     about them. Incident correlation is an enterprise/cloud feature, so an OSS
     build says so instead of showing an empty queue. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import SecurityKeyValues from "@/components/security/SecurityKeyValues.vue";
import incidentsService, { type Incident, type IncidentWithAlerts } from "@/services/incidents";
import { readableAlertName } from "@/utils/security/detection";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import {
  CASE_STATUSES,
  STATUS_VARIANT,
  TRANSITIONS,
  caseDetections,
  caseFirings,
  groupValueRows,
  toTimeline,
  toneOfPriority,
  type CaseStatus,
  type TimelineEntry,
} from "@/utils/security/cases";
import {
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  toneOfSigmaLevel,
} from "@/utils/security/severity";
import { formatEventCount } from "@/utils/formatters";
import config from "@/aws-exports";

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// Incident correlation ships with enterprise and cloud; OSS answers an empty
// 200, which would otherwise read as "no cases".
const available = config.isEnterprise === "true" || config.isCloud === "true";

const { byName, load: loadDetections } = useSiemDetections();

// ── View state ───────────────────────────────────────────────────────────────
const q = route.query as Record<string, string | undefined>;
const statusFilter = ref<CaseStatus | null>(
  CASE_STATUSES.includes(q.status as CaseStatus) ? (q.status as CaseStatus) : null,
);
const search = ref(q.q ?? "");
const selectedId = ref<string | null>(q.case ?? null);
const currentPage = ref(1);
const pageSize = ref(50);

function syncUrl() {
  const query: Record<string, string> = { org_identifier: orgId.value };
  if (statusFilter.value) query.status = statusFilter.value;
  if (search.value.trim()) query.q = search.value.trim();
  if (selectedId.value) query.case = selectedId.value;
  router.replace({ query });
}
watch([statusFilter, search, selectedId], syncUrl);

// ── List (server-paginated; the server filters by status only) ───────────────
const cases = ref<Incident[]>([]);
const total = ref(0);
const totals = ref<Record<CaseStatus, number | null>>({
  open: null,
  acknowledged: null,
  resolved: null,
});
const loading = ref(false);
const error = ref("");
let listSeq = 0;

async function fetchTotals() {
  const results = await Promise.allSettled(
    CASE_STATUSES.map((status) => incidentsService.list(orgId.value, status, 1, 0)),
  );
  const next = { ...totals.value };
  CASE_STATUSES.forEach((status, i) => {
    const r = results[i];
    next[status] = r.status === "fulfilled" ? Number(r.value.data?.total ?? 0) : null;
  });
  totals.value = next;
}

async function fetchCases() {
  if (!available || !orgId.value) return;
  const mine = ++listSeq;
  loading.value = true;
  error.value = "";
  try {
    const res = await incidentsService.list(
      orgId.value,
      statusFilter.value ?? undefined,
      pageSize.value,
      (currentPage.value - 1) * pageSize.value,
    );
    if (mine !== listSeq) return;
    cases.value = res.data?.incidents ?? [];
    total.value = Number(res.data?.total ?? cases.value.length);
  } catch (e: any) {
    if (mine !== listSeq) return;
    cases.value = [];
    total.value = 0;
    error.value = e?.response?.data?.message ?? e?.message ?? t("siem.cases.loadError");
  } finally {
    if (mine === listSeq) loading.value = false;
  }
}

function refresh() {
  void fetchCases();
  void fetchTotals();
}

watch(statusFilter, () => {
  currentPage.value = 1;
  void fetchCases();
});
watch([currentPage, pageSize], () => void fetchCases());

/** Search narrows the loaded page only — the list API has no text filter. */
const shown = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return cases.value;
  return cases.value.filter(
    (c) =>
      (c.title ?? "").toLowerCase().includes(needle) ||
      c.id.toLowerCase().includes(needle) ||
      (c.assigned_to ?? "").toLowerCase().includes(needle) ||
      groupValueRows(c.group_values).some((g) => g.value.toLowerCase().includes(needle)),
  );
});

const STATUS_TILE: Record<CaseStatus, Pick<StatItem, "icon" | "tone">> = {
  open: { icon: "inbox", tone: "error" },
  acknowledged: { icon: "visibility", tone: "warning" },
  resolved: { icon: "task-alt", tone: "success" },
};
const stats = computed<StatItem[]>(() =>
  CASE_STATUSES.map((status) => ({
    key: status,
    label: t(`siem.caseStatus.${status}`),
    value: totals.value[status] ?? "—",
    icon: STATUS_TILE[status].icon,
    tone: STATUS_TILE[status].tone,
    dataTest: `security-cases-stat-${status}`,
  })),
);
function onStatusTile(key: string) {
  statusFilter.value = statusFilter.value === key ? null : (key as CaseStatus);
}

const columns = computed<OTableColumnDef<Incident>[]>(() => [
  { id: "severity", header: t("siem.cases.column.priority"), accessorKey: "severity", size: 90 },
  {
    id: "title",
    header: t("siem.cases.column.title"),
    accessorFn: (c) => c.title || c.id,
    meta: { isName: true },
  },
  { id: "status", header: t("siem.cases.column.status"), accessorKey: "status", size: 130 },
  {
    id: "alert_count",
    header: t("siem.cases.column.alerts"),
    accessorKey: "alert_count",
    size: 90,
    meta: { align: "right" },
  },
  {
    id: "assigned_to",
    header: t("siem.cases.column.assignee"),
    accessorKey: "assigned_to",
    size: 170,
    hideable: true,
  },
  {
    id: "first_alert_at",
    header: t("siem.cases.column.firstSeen"),
    accessorKey: "first_alert_at",
    size: 120,
    hideable: true,
  },
  {
    id: "last_alert_at",
    header: t("siem.cases.column.lastSeen"),
    accessorKey: "last_alert_at",
    size: 120,
  },
]);
const rowRail = (c: Incident) => severityRailColor(toneOfPriority(c.severity));
const rowClass = (c: Incident) => {
  if (c.id === selectedId.value) return "!bg-table-row-selected-bg";
  // Closed cases recede; open ones keep the full-strength row.
  return c.status === "resolved" ? "!bg-surface-panel" : "";
};

const filtersActive = computed(() => !!statusFilter.value || !!search.value.trim());
function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    statusFilter.value = null;
    search.value = "";
  }
}

// ── One case ─────────────────────────────────────────────────────────────────
const detail = ref<IncidentWithAlerts | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const events = ref<TimelineEntry[]>([]);
/** The server rebuilt this timeline from incident rows; notes and status changes may be missing. */
const eventsPartial = ref(false);
const eventsLoading = ref(false);
const tab = ref("overview");
let detailSeq = 0;

const summary = computed<Incident | null>(
  () => detail.value ?? cases.value.find((c) => c.id === selectedId.value) ?? null,
);
const selectedIndex = computed(() => {
  const i = shown.value.findIndex((c) => c.id === selectedId.value);
  return i === -1 ? null : i;
});

async function loadDetail(id: string) {
  const mine = ++detailSeq;
  detail.value = null;
  events.value = [];
  eventsPartial.value = false;
  detailError.value = "";
  detailLoading.value = true;
  eventsLoading.value = true;
  const [one, timeline] = await Promise.allSettled([
    incidentsService.get(orgId.value, id),
    incidentsService.getEvents(orgId.value, id),
  ]);
  if (mine !== detailSeq) return;
  if (one.status === "fulfilled") detail.value = one.value.data;
  else
    detailError.value = (one.reason as any)?.response?.data?.message ?? t("siem.cases.openError");
  events.value = timeline.status === "fulfilled" ? toTimeline(timeline.value.data?.events) : [];
  eventsPartial.value =
    timeline.status === "fulfilled" && !!timeline.value.data?.partial_reconstruction;
  detailLoading.value = false;
  eventsLoading.value = false;
}

/** True while `id` is still the open case — every await re-checks before writing. */
const stillOpen = (id: string) => selectedId.value === id;

watch(selectedId, (id) => {
  if (id && available) void loadDetail(id);
  else detail.value = null;
});

function open(c: Incident) {
  selectedId.value = c.id;
}
function close() {
  selectedId.value = null;
}
/** Where to land after a page turn made by prev/next. */
let pendingEdge: "first" | "last" | null = null;
function step(delta: number) {
  const i = selectedIndex.value;
  if (i === null) return;
  const next = shown.value[i + delta];
  if (next) {
    selectedId.value = next.id;
    return;
  }
  // Past the edge of this page: turn the server page (search narrows one page only).
  if (search.value.trim()) return;
  if (delta > 0 && currentPage.value * pageSize.value < total.value) {
    pendingEdge = "first";
    currentPage.value += 1;
  } else if (delta < 0 && currentPage.value > 1) {
    pendingEdge = "last";
    currentPage.value -= 1;
  }
}
watch(cases, (rows) => {
  if (!pendingEdge || !rows.length) return;
  selectedId.value = (pendingEdge === "first" ? rows[0] : rows[rows.length - 1]).id;
  pendingEdge = null;
});
/** Position across all server pages, so "12 of 240" means the whole queue. */
const globalIndex = computed(() =>
  selectedIndex.value === null
    ? null
    : search.value.trim()
      ? selectedIndex.value
      : (currentPage.value - 1) * pageSize.value + selectedIndex.value,
);
const globalTotal = computed(() => (search.value.trim() ? shown.value.length : total.value));

// Built from the intended query: window.location lags router.replace.
const shareUrl = computed(() => {
  if (!selectedId.value || typeof window === "undefined") return "";
  const href = router.resolve({
    path: route.path,
    query: { ...route.query, case: selectedId.value },
  }).href;
  return new URL(href, window.location.origin).toString();
});

const tone = computed(() => toneOfPriority(summary.value?.severity));

function duration(from?: number, to?: number): string {
  if (!from || !to || to <= from) return "—";
  const mins = Math.round((to - from) / 60_000_000);
  if (mins < 60) return t("siem.cases.durationMinutes", { n: mins });
  const hours = Math.round(mins / 60);
  return hours < 48
    ? t("siem.cases.durationHours", { n: hours })
    : t("siem.cases.durationDays", { n: Math.round(hours / 24) });
}

const facts = computed<RecordFact[]>(() => {
  const c = summary.value;
  if (!c) return [];
  return [
    { label: t("siem.cases.column.alerts"), value: formatEventCount(c.alert_count) },
    {
      label: t("siem.cases.column.firstSeen"),
      value: new Date(c.first_alert_at / 1000).toLocaleString(),
    },
    {
      label: t("siem.cases.column.lastSeen"),
      value: new Date(c.last_alert_at / 1000).toLocaleString(),
    },
    {
      label: t("siem.cases.fact.duration"),
      value: duration(c.first_alert_at, c.resolved_at ?? c.last_alert_at),
    },
  ];
});

/** Distinct detections behind the case, with their SIEM metadata where known. */
// Firings are `triggers`; the response's `alerts` are alert definitions.
// `alertName` joins to the detection; `name` is what is shown.
const detections = computed(() =>
  caseDetections(detail.value?.triggers).map((d) => ({
    ...d,
    name: byName.value.get(d.alertName)?.meta.title ?? readableAlertName(d.alertName),
    detection: byName.value.get(d.alertName) ?? null,
  })),
);

const alertRows = computed(() => caseFirings(detail.value?.triggers));

const entityRows = computed(() =>
  groupValueRows(summary.value?.group_values).map((g) => ({
    key: g.key,
    value: g.value,
    mono: true,
  })),
);

const rca = computed(() => detail.value?.topology_context?.suggested_root_cause ?? "");

const tabs = computed<RecordTab[]>(() => [
  { name: "overview", label: t("siem.cases.tab.overview"), icon: "dashboard" },
  {
    name: "alerts",
    label: t("siem.cases.tab.alerts"),
    icon: "notifications-active",
    count: detail.value ? alertRows.value.length : null,
  },
  {
    name: "timeline",
    label: t("siem.cases.tab.timeline"),
    icon: "history",
    count: events.value.length || null,
  },
  { name: "analysis", label: t("siem.cases.tab.analysis"), icon: "psychology" },
]);

const TIMELINE_VARIANT: Record<
  TimelineEntry["kind"],
  "primary" | "success" | "destructive" | "info" | "muted"
> = {
  created: "info",
  alert: "destructive",
  severity: "destructive",
  status: "success",
  comment: "primary",
  title: "muted",
  assignment: "muted",
  analysis: "info",
  other: "muted",
};

// ── Actions (server-confirmed; the row only changes after the server agrees) ─
const updating = ref(false);

async function setStatus(status: CaseStatus) {
  const c = summary.value;
  if (!c) return;
  updating.value = true;
  const id = c.id;
  try {
    await incidentsService.updateStatus(orgId.value, id, status);
    toast({
      variant: "success",
      message: t("siem.cases.statusChanged", { status: t(`siem.caseStatus.${status}`) }),
    });
    // The list is filtered by status on the server, so re-ask rather than patch:
    // a case just closed must leave the "New" list and its count.
    void fetchCases();
    void fetchTotals();
    if (stillOpen(id)) void loadDetail(id);
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? t("siem.cases.updateError") });
  } finally {
    updating.value = false;
  }
}

const PRIORITIES = ["P1", "P2", "P3", "P4"];
const priorityOptions = computed(() =>
  PRIORITIES.map((p) => ({
    label: t("siem.cases.priorityOption", { p, level: t(toneLabelKey(toneOfPriority(p))) }),
    value: p,
  })),
);
async function setPriority(value: unknown) {
  const c = summary.value;
  const severity = String(value ?? "");
  if (!c || !PRIORITIES.includes(severity) || severity === c.severity) return;
  updating.value = true;
  const id = c.id;
  try {
    await incidentsService.updateIncident(orgId.value, id, { severity });
    const next = severity as Incident["severity"];
    cases.value = cases.value.map((row) => (row.id === id ? { ...row, severity: next } : row));
    toast({ variant: "success", message: t("siem.cases.priorityChanged", { p: severity }) });
    if (stillOpen(id)) void loadDetail(id);
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? t("siem.cases.updateError") });
  } finally {
    updating.value = false;
  }
}

// Drafts are kept per case, so a half-written note never follows the analyst
// to the next case, and a post in flight clears only its own case's draft.
const drafts = ref<Record<string, string>>({});
const postingId = ref<string | null>(null);
const comment = computed({
  get: () => (selectedId.value ? (drafts.value[selectedId.value] ?? "") : ""),
  set: (text: string) => {
    if (selectedId.value) drafts.value = { ...drafts.value, [selectedId.value]: text };
  },
});
const posting = computed(() => !!postingId.value && postingId.value === selectedId.value);
async function postComment() {
  const c = summary.value;
  const text = comment.value.trim();
  if (!c || !text || postingId.value) return;
  const id = c.id;
  const mine = detailSeq;
  postingId.value = id;
  try {
    await incidentsService.postComment(orgId.value, id, text);
    const { [id]: _posted, ...rest } = drafts.value;
    drafts.value = rest;
    const res = await incidentsService.getEvents(orgId.value, id);
    // Another case opened meanwhile owns the timeline now.
    if (stillOpen(id) && mine === detailSeq) events.value = toTimeline(res.data?.events);
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? t("siem.cases.commentError"),
    });
  } finally {
    postingId.value = null;
  }
}

const analyzing = ref(false);
async function runAnalysis() {
  const c = summary.value;
  if (!c) return;
  const id = c.id;
  analyzing.value = true;
  try {
    const res = await incidentsService.triggerRca(orgId.value, id, { reanalysis: !!rca.value });
    if (stillOpen(id) && detail.value?.id === id && res.data?.rca_content) {
      detail.value = {
        ...detail.value,
        topology_context: {
          ...(detail.value.topology_context ?? { nodes: [], edges: [], related_incident_ids: [] }),
          suggested_root_cause: res.data.rca_content,
        } as IncidentWithAlerts["topology_context"],
      };
    }
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? t("siem.cases.analysisError"),
    });
  } finally {
    analyzing.value = false;
  }
}

function openDetection(name: string) {
  const id = byName.value.get(name)?.alert.id;
  router.push({
    path: "/security/detections",
    query: { org_identifier: orgId.value, ...(id ? { detection: String(id) } : {}) },
  });
}
/**
 * Firings of the case's busiest detection over the case's own lifetime. The
 * search is the raw alert name (what history rows carry), and the window is
 * first..last alert with a little slack either side.
 */
function openAlerts() {
  const c = selectedId.value ? summary.value : null;
  const top = c ? detections.value[0]?.alertName : undefined;
  const SLACK_US = 5 * 60_000_000;
  const window =
    c && c.first_alert_at && c.last_alert_at
      ? {
          from: String(c.first_alert_at - SLACK_US),
          to: String((c.resolved_at ?? c.last_alert_at) + SLACK_US),
        }
      : { period: "7d" };
  router.push({
    path: "/security/alerts",
    query: { org_identifier: orgId.value, ...window, ...(top ? { q: top } : {}) },
  });
}

onMounted(() => {
  if (!available) return;
  void loadDetections(orgId.value);
  refresh();
  if (selectedId.value) void loadDetail(selectedId.value);
  syncUrl();
});
</script>

<template>
  <OPageLayout
    :title="t('siem.cases.title')"
    :subtitle="t('siem.cases.subtitle')"
    icon="assignment"
    bleed
    title-data-test="security-cases-title"
  >
    <OEmptyState
      v-if="!available"
      size="hero"
      icon="assignment"
      :title="t('siem.cases.unavailableTitle')"
      :description="t('siem.cases.unavailableHint')"
      :action-label="t('siem.cases.goToAlerts')"
      action-icon="notifications-active"
      data-test="security-cases-unavailable"
      @action="openAlerts"
    />
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="border-border-default px-page-edge flex shrink-0 flex-col gap-2 border-b py-3">
        <OBanner
          v-if="error"
          variant="error-soft"
          icon="error-outline"
          dense
          data-test="security-cases-error"
        >
          {{ error }}
        </OBanner>
        <OStatStrip
          :items="stats"
          :loading="totals.open === null && loading"
          selectable
          :selected-key="statusFilter"
          data-test="security-cases-stats"
          @select="onStatusTile"
        />
      </div>

      <OTable
        :data="shown"
        :columns="columns"
        row-key="id"
        :loading="loading"
        pagination="server"
        :total-count="total"
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-size-options="[50, 100, 250]"
        sorting="none"
        :show-global-filter="false"
        :persist-columns="true"
        table-id="security-cases"
        :column-visibility="{ first_alert_at: false }"
        :row-class="rowClass"
        :get-row-status-color="rowRail"
        class="min-h-0 flex-1"
        data-test="security-cases-table"
        @row-click="open"
      >
        <template #toolbar>
          <div class="flex w-full items-center gap-3">
            <div class="w-80">
              <OSearchInput
                v-model="search"
                :placeholder="t('siem.cases.search')"
                size="sm"
                data-test="security-cases-search"
              />
            </div>
          </div>
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="security-cases-refresh"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('siem.cases.refresh')" />
          </OButton>
        </template>

        <template #cell-severity="{ row }">
          <OTag type="severity" :value="row.severity.toLowerCase()" size="xs" />
        </template>
        <template #cell-title="{ row }">
          <div class="flex min-w-0 flex-col">
            <span class="text-text-heading truncate font-medium">{{
              row.title || t("siem.overview.untitledCase")
            }}</span>
            <span class="text-text-secondary text-2xs truncate font-mono">{{ row.id }}</span>
          </div>
        </template>
        <template #cell-status="{ row }">
          <OTag :variant="STATUS_VARIANT[row.status as CaseStatus]" size="xs">{{
            t(`siem.caseStatus.${row.status}`)
          }}</OTag>
        </template>
        <template #cell-alert_count="{ row }">
          <span class="tabular-nums">{{ formatEventCount(row.alert_count) }}</span>
        </template>
        <template #cell-assigned_to="{ row }">
          <span v-if="row.assigned_to" class="truncate text-xs">{{ row.assigned_to }}</span>
          <span v-else class="text-text-secondary">{{ t("siem.cases.unassigned") }}</span>
        </template>
        <template #cell-first_alert_at="{ row }">
          <OTimeCell :value="row.first_alert_at" unit="us" />
        </template>
        <template #cell-last_alert_at="{ row }">
          <OTimeCell :value="row.last_alert_at" unit="us" />
        </template>

        <template #empty>
          <OEmptyState
            v-if="!loading"
            size="block"
            icon="task-alt"
            :title="t('siem.cases.empty')"
            :description="t('siem.cases.emptyHint')"
            :filtered="filtersActive"
            @action="onEmptyAction"
          />
        </template>
      </OTable>
    </div>

    <SecurityRecordDrawer
      v-if="selectedId && available"
      :open="!!selectedId"
      v-model:tab="tab"
      :title="
        summary
          ? summary.title || t('siem.overview.untitledCase')
          : detailError
            ? t('siem.cases.notFound')
            : ''
      "
      :eyebrow="t('siem.cases.eyebrow')"
      :subtitle="summary?.id ?? selectedId"
      icon="assignment"
      :tone="tone"
      :facts="facts"
      :tabs="tabs"
      :index="globalIndex"
      :total="globalTotal"
      :share-url="shareUrl"
      :loading="detailLoading"
      data-test="security-cases-drawer"
      @close="close"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template v-if="summary" #chips>
        <OTag type="severity" :value="summary.severity.toLowerCase()" size="sm" />
        <OTag :variant="STATUS_VARIANT[summary.status as CaseStatus]" size="sm">{{
          t(`siem.caseStatus.${summary.status}`)
        }}</OTag>
        <OTag v-if="summary.assigned_to" variant="default-soft" icon="person" size="sm">{{
          summary.assigned_to
        }}</OTag>
        <OTag v-else variant="default-soft" icon="person" size="sm">{{
          t("siem.cases.unassigned")
        }}</OTag>
      </template>

      <template #tab-overview>
        <OBanner v-if="detailError" variant="error-soft" icon="error-outline" dense>{{
          detailError
        }}</OBanner>
        <section class="flex flex-col gap-2">
          <h3 class="text-text-secondary text-xs font-semibold tracking-wide uppercase">
            {{ t("siem.cases.detections") }}
          </h3>
          <div v-if="detailLoading" class="flex justify-center py-4"><OSpinner size="sm" /></div>
          <OEmptyState
            v-else-if="!detections.length"
            size="inline"
            icon="rule"
            :title="t('siem.cases.noDetections')"
          />
          <div v-else class="border-border-default rounded-surface overflow-hidden border">
            <div
              v-for="d in detections"
              :key="d.alertName"
              class="border-border-subtle hover:bg-surface-subtle focus-visible:ring-accent flex cursor-pointer items-center gap-2 border-b px-3 py-2 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
              role="button"
              tabindex="0"
              :data-test="`security-cases-drawer-detection-${d.alertName}`"
              @click="openDetection(d.alertName)"
              @keydown.enter="openDetection(d.alertName)"
              @keydown.space.prevent="openDetection(d.alertName)"
            >
              <OTag
                v-if="d.detection"
                type="severity"
                :value="severityTagValue(toneOfSigmaLevel(d.detection.meta.level))"
                :label="t(toneLabelKey(toneOfSigmaLevel(d.detection.meta.level)))"
                size="xs"
              />
              <OTag v-else variant="default-soft" size="xs">{{ t("siem.alerts.notSiem") }}</OTag>
              <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-medium">{{
                d.name
              }}</span>
              <OTag
                v-for="tech in (d.detection?.meta.techniques ?? []).slice(0, 2)"
                :key="tech"
                variant="purple-soft"
                shape="rounded"
                size="xs"
                >{{ tech }}</OTag
              >
              <span class="text-text-secondary text-xs tabular-nums">{{
                t("siem.cases.firedTimes", d.count)
              }}</span>
            </div>
          </div>
        </section>
        <section class="flex flex-col gap-2">
          <h3 class="text-text-secondary text-xs font-semibold tracking-wide uppercase">
            {{ t("siem.cases.entities") }}
          </h3>
          <SecurityKeyValues
            v-if="entityRows.length"
            :rows="entityRows"
            data-test="security-cases-drawer-entities"
          />
          <span v-else class="text-text-secondary text-xs">{{ t("siem.cases.noEntities") }}</span>
        </section>
      </template>

      <template #tab-alerts>
        <div v-if="detailLoading" class="flex justify-center py-6"><OSpinner size="sm" /></div>
        <OEmptyState
          v-else-if="!alertRows.length"
          size="inline"
          icon="notifications-active"
          :title="t('siem.cases.noAlerts')"
        />
        <div
          v-else
          class="border-border-default rounded-surface overflow-hidden border"
          data-test="security-cases-drawer-alerts"
        >
          <div
            v-for="a in alertRows"
            :key="`${a.alert_id}-${a.alert_fired_at}`"
            class="border-border-subtle flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
          >
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="text-text-heading truncate text-sm font-medium">{{
                byName.get(a.alert_name)?.meta.title ?? readableAlertName(a.alert_name)
              }}</span>
              <span class="text-text-secondary text-2xs">{{
                t(`siem.cases.reason.${a.correlation_reason}`)
              }}</span>
            </div>
            <OTag v-if="a.alert_kind === 'external'" variant="cyan-soft" size="xs">{{
              a.detected_source || t("siem.cases.external")
            }}</OTag>
            <OTimeCell :value="a.alert_fired_at" unit="us" class="shrink-0 text-xs" />
          </div>
        </div>
      </template>

      <template #tab-timeline>
        <div class="flex flex-col gap-2">
          <OTextarea
            v-model="comment"
            :placeholder="t('siem.cases.commentPlaceholder')"
            :rows="3"
            autogrow
            data-test="security-cases-drawer-comment"
          />
          <div class="flex justify-end">
            <OButton
              variant="primary"
              size="sm-action"
              icon-left="send"
              :loading="posting"
              :disabled="!comment.trim()"
              data-test="security-cases-drawer-post-comment"
              @click="postComment"
            >
              {{ t("siem.cases.postComment") }}
            </OButton>
          </div>
        </div>
        <OBanner
          v-if="eventsPartial && !eventsLoading"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-cases-drawer-timeline-partial"
        >
          {{ t("siem.cases.timelinePartial") }}
        </OBanner>
        <div v-if="eventsLoading" class="flex justify-center py-6"><OSpinner size="sm" /></div>
        <OEmptyState
          v-else-if="!events.length"
          size="inline"
          icon="history"
          :title="t('siem.cases.noEvents')"
        />
        <OTimeline v-else data-test="security-cases-drawer-timeline">
          <OTimelineItem
            v-for="(e, i) in events"
            :key="`${e.timestamp}-${i}`"
            :title="t(`siem.cases.event.${e.key}`, e.params)"
            :subtitle="
              [e.actor, new Date(e.timestamp / 1000).toLocaleString()].filter(Boolean).join(' · ')
            "
            :icon="e.icon"
            :variant="TIMELINE_VARIANT[e.kind]"
          >
            <p
              v-if="e.body"
              class="text-text-heading bg-surface-subtle rounded-surface mt-1 px-3 py-2 text-sm whitespace-pre-wrap"
            >
              {{ e.body }}
            </p>
          </OTimelineItem>
        </OTimeline>
      </template>

      <template #tab-analysis>
        <div class="flex items-center gap-2">
          <span class="text-text-secondary text-xs">{{ t("siem.cases.analysisHint") }}</span>
          <div class="flex-1" />
          <OButton
            variant="outline"
            size="sm"
            icon-left="psychology"
            :loading="analyzing"
            data-test="security-cases-drawer-run-analysis"
            @click="runAnalysis"
          >
            {{ rca ? t("siem.cases.rerunAnalysis") : t("siem.cases.runAnalysis") }}
          </OButton>
        </div>
        <p
          v-if="rca"
          class="text-text-heading bg-surface-subtle rounded-surface px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
          data-test="security-cases-drawer-rca"
        >
          {{ rca }}
        </p>
        <OEmptyState
          v-else-if="!analyzing"
          size="inline"
          icon="psychology"
          :title="t('siem.cases.noAnalysis')"
        />
      </template>

      <template v-if="summary" #footer>
        <div class="w-44">
          <OSelect
            :model-value="summary.severity"
            :options="priorityOptions"
            :disabled="updating"
            size="sm"
            data-test="security-cases-drawer-priority"
            @update:model-value="setPriority"
          />
        </div>
        <div class="flex-1" />
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="notifications-active"
          data-test="security-cases-drawer-open-alerts"
          @click="openAlerts"
        >
          {{ t("siem.cases.viewFirings") }}
        </OButton>
        <OButton
          v-for="next in TRANSITIONS[summary.status as CaseStatus]"
          :key="next"
          :variant="next === TRANSITIONS[summary.status as CaseStatus][0] ? 'primary' : 'outline'"
          size="sm-action"
          :loading="updating"
          :data-test="`security-cases-drawer-status-${next}`"
          @click="setStatus(next)"
        >
          {{ t(`siem.cases.transition.${next}`) }}
        </OButton>
      </template>
    </SecurityRecordDrawer>
  </OPageLayout>
</template>
