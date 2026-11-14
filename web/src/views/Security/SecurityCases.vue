<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { securityTime } from "@/utils/security/time";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import SecurityNotices, { type SecurityNotice } from "@/components/security/SecurityNotices.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import SecurityAccessLock from "@/components/security/SecurityAccessLock.vue";
import { failedRequests, viewDenial, type AccessDenial } from "@/composables/useAccessStore";
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
import SecurityCaseCloseDialog, {
  type CloseResultRow,
  type HighPriorityCase,
} from "@/components/security/SecurityCaseCloseDialog.vue";
import {
  suppressOf,
  type CaseCloseForm,
} from "@/components/security/SecurityCaseCloseDialog.schema";
import SecurityCaseFiringEvidence from "@/components/security/SecurityCaseFiringEvidence.vue";
import SecurityCaseSettingsDialog from "@/components/security/SecurityCaseSettingsDialog.vue";
import SecuritySuppressions from "@/components/security/SecuritySuppressions.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import SecurityCaseBulkBar, {
  type BulkAssignee,
} from "@/components/security/SecurityCaseBulkBar.vue";
import SecurityCaseMergeDialog from "@/components/security/SecurityCaseMergeDialog.vue";
import SecurityCaseSuppressDialog from "@/components/security/SecurityCaseSuppressDialog.vue";
import type {
  CaseSuppressForm,
  SuppressDuration,
} from "@/components/security/SecurityCaseSuppressDialog.schema";
import securityCases, {
  MAX_BULK_IDS,
  MAX_MERGE_SOURCES,
  type BulkCaseResult,
  type BulkCaseUpdate,
  type CasePriority,
  type CaseRow,
  type CaseSearchFilters,
} from "@/services/securityCases";
import {
  bulkUpdateCasesMutation,
  caseMatchIdsQuery,
  caseSearchQuery,
  mergeCasesMutation,
  suppressFromCaseMutation,
} from "@/services/securityCases.queries";
import { orgUsersQuery } from "@/services/users.queries";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import incidentsService, { type IncidentWithAlerts } from "@/services/incidents";
import { readableAlertName } from "@/utils/security/detection";
import { useRcaTrigger } from "@/composables/useRcaTrigger";
import { isLiveRca } from "@/utils/incidents/rcaCell";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import { isForbiddenError, useSecurityAccess } from "@/composables/security/useSecurityAccess";
import {
  CASE_STATUSES,
  ENTITY_ICON,
  STATUS_VARIANT,
  TRANSITIONS,
  activitySpan,
  caseDetectionId,
  caseDetections,
  caseEntities,
  caseFirings,
  firingRange,
  groupValueRows,
  timeToClose,
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
import {
  isCaseUnread,
  markCaseSeen,
  readCaseSeen,
  unreadFirst,
  type CaseSeenMap,
} from "@/utils/security/caseSeen";

const { t } = useI18nTyped();
const store = useStore();
const { canTriage, canAuthor, canAdmin } = useSecurityAccess();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

const { byName, byId, load: loadDetections } = useSiemDetections();

const q = route.query as Record<string, string | undefined>;
const PRIORITIES: CasePriority[] = ["P1", "P2", "P3", "P4"];
/** `null` is the working queue (New and Investigating); `all` adds Closed. */
type StatusFilter = CaseStatus | "all" | null;
const ALL_STATUSES = "all";
const WORKING_STATUSES: CaseStatus[] = ["open", "acknowledged"];
const statusFilter = ref<StatusFilter>(
  CASE_STATUSES.includes(q.status as CaseStatus)
    ? (q.status as CaseStatus)
    : q.status === ALL_STATUSES
      ? ALL_STATUSES
      : null,
);
const priorityFilter = ref<CasePriority[]>(
  (q.priority ?? "")
    .split(",")
    .filter((p): p is CasePriority => PRIORITIES.includes(p as CasePriority)),
);
const detectionFilter = ref<string[]>((q.detection ?? "").split(",").filter(Boolean));
const assigneeFilter = ref<string | null>(q.assignee || null);
const entityFilter = ref(q.entity ?? "");
const search = ref(q.q ?? "");
const selectedId = ref<string | null>(q.case ?? null);
const currentPage = ref(1);
const pageSize = ref(50);

// Typing must not fire a server search per keystroke.
const SEARCH_DEBOUNCE_MS = 300;
const debouncedSearch = ref(search.value.trim());
const debouncedEntity = ref(entityFilter.value.trim());
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch([search, entityFilter], () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = search.value.trim();
    debouncedEntity.value = entityFilter.value.trim();
  }, SEARCH_DEBOUNCE_MS);
});

function syncUrl() {
  const query: Record<string, string> = { org_identifier: orgId.value };
  if (statusFilter.value) query.status = statusFilter.value;
  if (priorityFilter.value.length) query.priority = priorityFilter.value.join(",");
  if (detectionFilter.value.length) query.detection = detectionFilter.value.join(",");
  if (assigneeFilter.value) query.assignee = assigneeFilter.value;
  if (entityFilter.value.trim()) query.entity = entityFilter.value.trim();
  if (search.value.trim()) query.q = search.value.trim();
  if (selectedId.value) query.case = selectedId.value;
  router.replace({ query });
}
watch(
  [statusFilter, priorityFilter, detectionFilter, assigneeFilter, entityFilter, search, selectedId],
  syncUrl,
);

const statusesOf = (f: StatusFilter): CaseStatus[] | undefined =>
  f === ALL_STATUSES ? undefined : f ? [f] : [...WORKING_STATUSES];
const filters = computed<CaseSearchFilters>(() => ({
  ...(statusesOf(statusFilter.value) ? { status: statusesOf(statusFilter.value) } : {}),
  ...(priorityFilter.value.length ? { priority: [...priorityFilter.value] } : {}),
  ...(detectionFilter.value.length ? { alert_id: [...detectionFilter.value] } : {}),
  ...(assigneeFilter.value ? { assignee: assigneeFilter.value } : {}),
  ...(debouncedEntity.value ? { entity: debouncedEntity.value } : {}),
  ...(debouncedSearch.value ? { q: debouncedSearch.value } : {}),
}));
const filtersKey = computed(() => JSON.stringify(filters.value));

const list = useQuery(() => ({
  ...caseSearchQuery(orgId.value, {
    ...filters.value,
    limit: pageSize.value,
    offset: (currentPage.value - 1) * pageSize.value,
  }),
  enabled: !!orgId.value,
}));
const userEmail = computed(() => String(store.state.userInfo?.email ?? ""));
/** When this analyst last opened each case; per browser, so "updated" means since I looked. */
const seen = ref<CaseSeenMap>({});
watch(
  [orgId, userEmail],
  ([org, user]) => {
    seen.value = org && user ? readCaseSeen(org, user) : {};
  },
  { immediate: true },
);
const unread = (c: CaseRow) => isCaseUnread(c, seen.value);
function markSeen(c: { id: string; last_detection_at?: number | null }) {
  if (!orgId.value || !userEmail.value) return;
  const at = Math.max(Date.now() * 1000, Number(c.last_detection_at ?? 0));
  seen.value = markCaseSeen(orgId.value, userEmail.value, c.id, at, seen.value);
}
// Unread order is fixed when a page loads, so opening a case does not reshuffle the rows under the cursor.
const pageOrder = ref<string[]>([]);
watch(
  () => list.data.value?.incidents,
  (rows) => {
    pageOrder.value = unreadFirst(rows ?? [], seen.value).map((c) => c.id);
  },
  { immediate: true },
);
const cases = computed<CaseRow[]>(() => {
  const rows = list.data.value?.incidents ?? [];
  const rank = new Map(pageOrder.value.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
});
const total = computed(() => Number(list.data.value?.total ?? cases.value.length));
const loading = computed(() => list.isFetching.value);
// The tiles count under every active filter except status, which the tiles themselves pick.
const tileFilters = computed<CaseSearchFilters>(() => {
  const { status: _status, ...rest } = filters.value;
  return rest;
});
const totalQueries = CASE_STATUSES.map((status) =>
  useQuery(() => ({
    ...caseSearchQuery(orgId.value, { ...tileFilters.value, status: [status], limit: 1 }),
    enabled: !!orgId.value,
  })),
);
const totals = computed(
  () =>
    Object.fromEntries(
      CASE_STATUSES.map((status, i) => {
        const data = totalQueries[i].data.value;
        return [status, data ? Number(data.total ?? 0) : null];
      }),
    ) as Record<CaseStatus, number | null>,
);
// A 403 body is plain text, so it would read "Request failed with status code 403"; the table locks instead.
const caseDenials = computed<AccessDenial[]>(() =>
  list.error.value && isForbiddenError(list.error.value)
    ? [viewDenial("incidents", "list", failedRequests(list.error.value))]
    : [],
);
const error = computed(() => {
  const e = list.error.value as any;
  if (!e || isForbiddenError(e)) return "";
  return e?.response?.data?.message ?? e?.message ?? t("siem.cases.loadError");
});

const notices = computed<SecurityNotice[]>(() => [
  ...(error.value
    ? [
        {
          key: "error",
          tone: "error" as const,
          text: error.value,
          dataTest: "security-cases-error",
        },
      ]
    : []),
  ...selectionNotices.value,
]);

function fetchTotals() {
  totalQueries.forEach((query) => void query.refetch());
}

function refetchCases() {
  void list.refetch();
}

function refresh() {
  refetchCases();
  fetchTotals();
}

watch(filtersKey, () => {
  currentPage.value = 1;
  clearSelection();
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
const showingClosed = computed(
  () => statusFilter.value === ALL_STATUSES || statusFilter.value === "resolved",
);
function toggleClosed() {
  statusFilter.value = showingClosed.value ? null : ALL_STATUSES;
}

const columns = computed<OTableColumnDef<CaseRow>[]>(() => [
  { id: "severity", header: t("siem.cases.column.priority"), accessorKey: "severity", size: 90 },
  {
    id: "title",
    header: t("siem.cases.column.title"),
    accessorFn: (c) => c.title || c.id,
    meta: { isName: true },
  },
  {
    id: "entity",
    header: t("siem.cases.column.entity"),
    accessorFn: (c) => caseEntities(c)[0]?.value ?? "",
    size: 200,
    hideable: true,
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
const rowRail = (c: CaseRow) => severityRailColor(toneOfPriority(c.severity));
const rowClass = (c: CaseRow) => {
  if (c.id === selectedId.value) return "!bg-table-row-selected-bg";
  return c.status === "resolved" ? "!bg-surface-panel" : "";
};

const filtersActive = computed(
  () =>
    statusFilter.value !== null ||
    priorityFilter.value.length > 0 ||
    detectionFilter.value.length > 0 ||
    !!assigneeFilter.value ||
    !!entityFilter.value.trim() ||
    !!search.value.trim(),
);
function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    statusFilter.value = null;
    priorityFilter.value = [];
    detectionFilter.value = [];
    assigneeFilter.value = null;
    entityFilter.value = "";
    search.value = "";
  }
}

const priorityFilterOptions = computed(() => PRIORITIES.map((p) => ({ label: raw(p), value: p })));
// Facets are counted without the detection filter, so picking one never hides the others.
const detectionlessFilters = computed<CaseSearchFilters>(() => {
  const { alert_id: _alertId, ...rest } = filters.value;
  return rest;
});
const facetQuery = useQuery(() => ({
  ...caseSearchQuery(orgId.value, { ...detectionlessFilters.value, limit: 1 }),
  enabled: !!orgId.value && detectionFilter.value.length > 0,
}));
const detectionOptions = computed(() => {
  const facets = detectionFilter.value.length
    ? (facetQuery.data.value ?? list.data.value)?.detection_facets
    : list.data.value?.detection_facets;
  const nameOf = (id: string, fallback: string) => {
    const row = byId.value.get(id);
    return row ? row.meta.title || String(row.alert.name) : fallback;
  };
  if (facets) {
    const options = facets.map((f) => ({
      label: t(
        "siem.cases.filter.detectionCount",
        { name: raw(nameOf(f.alert_id, f.title || readableAlertName(f.alert_name))), n: f.count },
        f.count,
      ),
      value: f.alert_id,
      count: f.count,
    }));
    // A detection still picked keeps its option even after its cases leave the filter.
    for (const id of detectionFilter.value) {
      if (!options.some((o) => o.value === id)) {
        options.push({ label: raw(nameOf(id, id)), value: id, count: 0 });
      }
    }
    return options
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .map(({ label, value }) => ({ label, value }));
  }
  return [...byId.value.entries()]
    .map(([id, row]) => ({ label: raw(row.meta.title || row.alert.name), value: id }))
    .sort((a, b) => a.label.localeCompare(b.label));
});
const assigneeFilterOptions = computed(() => [
  { label: t("siem.cases.unassigned"), value: "none" },
  ...((orgUsers.data.value ?? []) as Array<{ email: string }>).map((u) => optionOf(u.email)),
]);

/** Cases seen on any loaded page, so the dialogs can name selections from other pages. */
const seenCases = reactive(new Map<string, CaseRow>());
watch(cases, (rows) => rows.forEach((c) => seenCases.set(c.id, c)), { immediate: true });

/** Selected case ids; a selection can span pages and survives paging, but not a filter change. */
const selectedIds = ref<string[]>([]);
/** Set by "select all matching" and kept only while the selection is still exactly that set. */
const matching = ref<{
  count: number;
  capped: boolean;
  /** P1/P2 matches; left out of the selection unless `includeHigh`. */
  high: number;
  includeHigh: boolean;
} | null>(null);
const selectingAll = ref(false);
const queryClient = useQueryClient();

function clearSelection() {
  selectedIds.value = [];
  matching.value = null;
}
watch(selectedIds, (ids) => {
  if (matching.value && ids.length !== matching.value.count) matching.value = null;
});

const pageFullySelected = computed(() => {
  if (!cases.value.length) return false;
  const chosen = new Set(selectedIds.value);
  return cases.value.every((c) => chosen.has(c.id));
});

const HIGH_PRIORITIES: CasePriority[] = ["P1", "P2"];
const isHigh = (p: string | null | undefined) =>
  HIGH_PRIORITIES.includes(String(p ?? "").toUpperCase() as CasePriority);
/** Most P1/P2 matches read in full, so the close dialog can name them. */
const MAX_HIGH_LISTED = 500;

/** A sweeping selection leaves P1/P2 cases out unless the analyst asks for them. */
async function selectAllMatching(includeHigh = false) {
  selectingAll.value = true;
  const highPriorities = (
    filters.value.priority?.length ? filters.value.priority : PRIORITIES
  ).filter(isHigh);
  try {
    const [res, high] = await Promise.all([
      queryClient.fetchQuery(caseMatchIdsQuery(orgId.value, filters.value)),
      highPriorities.length
        ? securityCases
            .searchCases(orgId.value, {
              ...filters.value,
              priority: highPriorities,
              limit: MAX_HIGH_LISTED,
              select_all: true,
            })
            .then((r) => r.data)
        : null,
    ]);
    for (const c of high?.incidents ?? []) seenCases.set(c.id, c);
    const highIds = new Set(high?.ids ?? high?.incidents.map((c) => c.id) ?? []);
    const highInMatch = res.ids.filter((id) => highIds.has(id)).length;
    const ids = includeHigh ? res.ids : res.ids.filter((id) => !highIds.has(id));
    selectedIds.value = ids.slice(0, MAX_BULK_IDS);
    matching.value = {
      count: selectedIds.value.length,
      capped: res.capped,
      high: highInMatch,
      includeHigh,
    };
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("siem.cases.selection.selectError"),
    });
  } finally {
    selectingAll.value = false;
  }
}

const selectionNotices = computed<SecurityNotice[]>(() => {
  if (!canTriage.value) return [];
  if (matching.value) {
    const n = matching.value.count;
    const high = matching.value.high;
    const highNotice: SecurityNotice[] = !high
      ? []
      : matching.value.includeHigh
        ? [
            {
              key: "selection-high",
              tone: "warning",
              text: t("siem.cases.selection.highIncluded", { n: high }, high),
              actionLabel: t("siem.cases.selection.leaveOutHigh"),
              onAction: () => void selectAllMatching(false),
              dataTest: "security-cases-selection-high-included",
            },
          ]
        : [
            {
              key: "selection-high",
              tone: "info",
              text: t("siem.cases.selection.highLeftOut", { n: high }, high),
              actionLabel: t("siem.cases.selection.includeHigh", { n: high }, high),
              onAction: () => void selectAllMatching(true),
              dataTest: "security-cases-selection-high-left-out",
            },
          ];
    return [
      ...highNotice,
      matching.value.capped
        ? {
            key: "selection",
            tone: "warning",
            text: t("siem.cases.selection.capped", { n: n.toLocaleString() }),
            actionLabel: t("siem.cases.selection.clear"),
            onAction: clearSelection,
            dataTest: "security-cases-selection-capped",
          }
        : {
            key: "selection",
            tone: "info",
            text: t("siem.cases.selection.allMatching", { n: n.toLocaleString() }, n),
            actionLabel: t("siem.cases.selection.clear"),
            onAction: clearSelection,
            dataTest: "security-cases-selection-all",
          },
    ];
  }
  if (!pageFullySelected.value || total.value <= cases.value.length) return [];
  const onPage = cases.value.length;
  return [
    {
      key: "selection",
      tone: "info",
      text: t("siem.cases.selection.pageSelected", { n: onPage }, onPage),
      actionLabel: t(
        "siem.cases.selection.selectAllMatching",
        { n: total.value.toLocaleString() },
        total.value,
      ),
      onAction: () => void selectAllMatching(),
      dataTest: "security-cases-selection-page",
    },
  ];
});

const bulkMutation = useMutation(() => bulkUpdateCasesMutation(orgId.value));
const mergeMutation = useMutation(() => mergeCasesMutation(orgId.value));
const suppressMutation = useMutation(() => suppressFromCaseMutation(orgId.value));
const bulkBusy = computed(() => bulkMutation.isPending.value || selectingAll.value);
const bulkCloseOpen = ref(false);
/** The bulk close was opened as "close as benign and suppress". */
const bulkSuppressPreset = ref(false);
const bulkCloseResults = ref<CloseResultRow[] | null>(null);
const mergeOpen = ref(false);

const primaryEntity = (c: CaseRow | undefined) => caseEntities(c ?? {})[0]?.value ?? "";
const caseSummary = (id: string): HighPriorityCase => {
  const c = seenCases.get(id);
  return {
    id,
    title: c?.title || t("siem.overview.untitledCase"),
    priority: (String(c?.severity ?? "P3").toUpperCase() as CasePriority) || "P3",
    entity: primaryEntity(c),
  };
};
/** Selected cases naming no host, user or address; "suppress similar" cannot cover them. */
const selectedWithoutEntity = computed(
  () => selectedIds.value.filter((id) => !caseEntities(seenCases.get(id) ?? {}).length).length,
);
/** P1/P2 cases in the selection; a bulk close leaves them open unless the analyst includes them. */
const highSelected = computed<HighPriorityCase[]>(() =>
  selectedIds.value.filter((id) => isHigh(seenCases.get(id)?.severity)).map(caseSummary),
);

function openBulkClose(suppress: boolean) {
  bulkCloseResults.value = null;
  bulkSuppressPreset.value = suppress;
  bulkCloseOpen.value = true;
}

async function runBulk(update: Omit<BulkCaseUpdate, "ids">): Promise<boolean> {
  const ids = selectedIds.value.slice(0, MAX_BULK_IDS);
  if (!ids.length) return false;
  try {
    const res = await bulkMutation.mutateAsync({ ...update, ids });
    const failed = res?.failed ?? [];
    const updated = res?.updated?.length ?? ids.length - failed.length;
    if (failed.length) {
      toast({
        variant: "warning",
        message: t(
          "siem.cases.bulk.partial",
          { failed: failed.length, total: ids.length, error: raw(failed[0].error) },
          ids.length,
        ),
      });
      selectedIds.value = failed.map((f) => f.id);
    } else {
      toast({ variant: "success", message: t("siem.cases.bulk.updated", { n: updated }, updated) });
      clearSelection();
    }
    fetchTotals();
    if (selectedId.value && ids.includes(selectedId.value)) void loadDetail(selectedId.value);
    return true;
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("siem.cases.bulk.error"),
    });
    return false;
  }
}

/** Every selected case's outcome, including P1/P2 cases the analyst kept out of the request. */
function closeResultsOf(all: string[], sent: string[], res: BulkCaseResult): CloseResultRow[] {
  const sentSet = new Set(sent);
  const byId = new Map((res.results ?? []).map((r) => [r.id, r]));
  const failed = new Map(res.failed.map((f) => [f.id, f.error]));
  const skipped = new Set((res.skipped ?? []).map((s) => s.id));
  return all.map((id) => {
    const base = caseSummary(id);
    const r = byId.get(id);
    if (r) return { ...base, outcome: r.outcome, ...(r.error ? { error: r.error } : {}) };
    if (!sentSet.has(id) || skipped.has(id)) return { ...base, outcome: "skipped" as const };
    if (failed.has(id)) return { ...base, outcome: "failed" as const, error: failed.get(id) };
    return { ...base, outcome: "updated" as const };
  });
}

/** Resolves false so the dialog stays open on the per-case results. */
async function bulkClose(form: CaseCloseForm): Promise<boolean> {
  const all = selectedIds.value.slice(0, MAX_BULK_IDS);
  const high = new Set(highSelected.value.map((c) => c.id));
  const ids = form.includeHigh ? all : all.filter((id) => !high.has(id));
  if (!ids.length) return false;
  const minutes = suppressOf(form);
  try {
    const res = await bulkMutation.mutateAsync({
      ids,
      action: "close",
      verdict: form.verdict,
      reason: form.reason,
      ...(form.includeHigh ? { include_high: true } : {}),
      ...(minutes ? { suppress_minutes: minutes } : {}),
    });
    const results = closeResultsOf(all, ids, res);
    bulkCloseResults.value = results;
    const left = results.filter((r) => r.outcome === "failed").map((r) => r.id);
    if (left.length) selectedIds.value = left;
    else clearSelection();
    fetchTotals();
    if (selectedId.value && ids.includes(selectedId.value)) void loadDetail(selectedId.value);
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("siem.cases.bulk.error"),
    });
  }
  return false;
}
const bulkAssign = (assignee: string) => void runBulk({ action: "assign", assigned_to: assignee });
const bulkPriority = (severity: CasePriority) => void runBulk({ action: "priority", severity });

const mergeBlocked = computed(() =>
  selectedIds.value.length < 2 || selectedIds.value.length > MAX_MERGE_SOURCES + 1
    ? t("siem.cases.bulk.mergeLimit", { max: MAX_MERGE_SOURCES + 1 })
    : null,
);
const mergeCandidates = computed(() =>
  selectedIds.value.map((id) => {
    const c = seenCases.get(id);
    return {
      id,
      title: c?.title ?? undefined,
      entity: primaryEntity(c) || undefined,
      priority: c?.severity,
      createdAt: c?.created_at,
      alertCount: c?.alert_count,
    };
  }),
);
async function mergeSelected(targetId: string, sourceIds: string[], reason: string) {
  try {
    const target = await mergeMutation.mutateAsync({
      target_id: targetId,
      source_ids: sourceIds,
      ...(reason ? { reason } : {}),
    });
    toast({
      variant: "success",
      message: t(
        "siem.cases.merge.merged",
        {
          n: sourceIds.length,
          title: raw(target?.title || seenCases.get(targetId)?.title || targetId),
        },
        sourceIds.length,
      ),
    });
    clearSelection();
    // The kept case's alert count changes, so the list and an open drawer re-read it.
    refetchCases();
    fetchTotals();
    if (selectedId.value && [targetId, ...sourceIds].includes(selectedId.value)) {
      void loadDetail(selectedId.value);
    }
    return true;
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("siem.cases.merge.error"),
    });
    return false;
  }
}

const detail = ref<IncidentWithAlerts | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const events = ref<TimelineEntry[]>([]);
/** The server rebuilt this timeline from incident rows; notes and status changes may be missing. */
const eventsPartial = ref(false);
const eventsLoading = ref(false);
const tab = ref("overview");
let detailSeq = 0;

const summary = computed<CaseRow | IncidentWithAlerts | null>(
  () => detail.value ?? cases.value.find((c) => c.id === selectedId.value) ?? null,
);
const selectedIndex = computed(() => {
  const i = cases.value.findIndex((c) => c.id === selectedId.value);
  return i === -1 ? null : i;
});

async function loadDetail(id: string) {
  const mine = ++detailSeq;
  stopRcaPoll();
  if (rcaLoaded?.incidentId !== id) {
    rca.value = "";
    rcaLoaded = null;
  }
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
  else detailError.value = one.reason?.response?.data?.message ?? t("siem.cases.openError");
  events.value = timeline.status === "fulfilled" ? toTimeline(timeline.value.data?.events) : [];
  eventsPartial.value =
    timeline.status === "fulfilled" && !!timeline.value.data?.partial_reconstruction;
  detailLoading.value = false;
  eventsLoading.value = false;
  syncRca(id);
}

/** True while `id` is still the open case — every await re-checks before writing. */
const stillOpen = (id: string) => selectedId.value === id;

watch(selectedId, (id) => {
  if (id) void loadDetail(id);
  else {
    stopRcaPoll();
    detail.value = null;
  }
});

/** When the open case got a detection this analyst had not seen; kept while the drawer shows it. */
const drawerUpdatedAt = ref(0);
function noteOpened(c: { id: string; last_detection_at?: number | null; status?: string }) {
  if (c.id !== selectedId.value) return;
  if (isCaseUnread(c, seen.value)) drawerUpdatedAt.value = Number(c.last_detection_at);
  markSeen(c);
}
watch(selectedId, (id) => {
  drawerUpdatedAt.value = 0;
  const row = id ? (seenCases.get(id) ?? cases.value.find((c) => c.id === id)) : undefined;
  if (row) noteOpened(row);
});
watch(cases, (rows) => {
  const row = rows.find((c) => c.id === selectedId.value);
  if (row) noteOpened(row);
});
watch(detail, (d) => {
  if (d) noteOpened(d as IncidentWithAlerts & { last_detection_at?: number | null });
});

function open(c: CaseRow) {
  if (!selectedId.value) analytics.track("security_detail_opened", { view: "cases" });
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
  const next = cases.value[i + delta];
  if (next) {
    selectedId.value = next.id;
    return;
  }
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
    : (currentPage.value - 1) * pageSize.value + selectedIndex.value,
);
const globalTotal = computed(() => total.value);

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

function duration(span: number | null): string {
  if (!span) return "—";
  const mins = Math.max(1, Math.round(span / 60_000_000));
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
      value: securityTime(c.first_alert_at / 1000),
    },
    {
      label: t("siem.cases.column.lastSeen"),
      value: securityTime(c.last_alert_at / 1000),
    },
    {
      label: t("siem.cases.fact.duration"),
      value: duration(activitySpan(c)),
    },
    ...(c.resolved_at
      ? [{ label: t("siem.cases.fact.timeToClose"), value: duration(timeToClose(c)) }]
      : []),
  ];
});

// A case can group security firings with operational alerts on the same host; only the former belong here.
const siemTriggers = computed(() =>
  (detail.value?.triggers ?? []).filter((trigger) =>
    byId.value.has(String(trigger.alert_id ?? "")),
  ),
);
const hiddenTriggers = computed(
  () => (detail.value?.triggers?.length ?? 0) - siemTriggers.value.length,
);

const detections = computed(() =>
  caseDetections(siemTriggers.value).map((d) => ({
    ...d,
    name: byName.value.get(d.alertName)?.meta.title ?? readableAlertName(d.alertName),
    detection: byName.value.get(d.alertName) ?? null,
  })),
);

const alertRows = computed(() => caseFirings(siemTriggers.value));

const ENTITY_GROUP_KEYS = new Set(["security_host", "security_user", "security_ip"]);
/** The search row carries the server's entity list; the case read alone has only its key. */
const shownEntities = computed(() => {
  const row = selectedId.value ? seenCases.get(selectedId.value) : undefined;
  return caseEntities({
    group_values: summary.value?.group_values,
    entity: row?.entity,
    entity_kind: row?.entity_kind,
    entities: row?.entities,
  });
});

const entityRows = computed(() => {
  const detectionId = caseDetectionId(summary.value?.group_values);
  const row = detectionId ? byId.value.get(detectionId) : undefined;
  return [
    ...(row
      ? [
          {
            key: "detection",
            label: t("siem.cases.entityDetection"),
            value: row.meta.title || readableAlertName(String(row.alert.name ?? "")),
            field: null,
          },
        ]
      : []),
    ...shownEntities.value.map((e, i) => ({
      key: `entity-${i}`,
      label: t(`siem.entities.kind.${e.kind}`),
      value: e.value,
      mono: true,
    })),
    ...groupValueRows(summary.value?.group_values)
      .filter((g) => !ENTITY_GROUP_KEYS.has(g.key))
      .map((g) => ({ key: g.key, value: g.value, mono: true })),
  ];
});

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
  evidence: "primary",
  analysis: "info",
  other: "muted",
};

// Server-confirmed: the row only changes after the server agrees.
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
    // The server filters by status, so re-ask rather than patch: a closed case must leave "New".
    refetchCases();
    fetchTotals();
    if (stillOpen(id)) void loadDetail(id);
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? t("siem.cases.updateError") });
  } finally {
    updating.value = false;
  }
}

const closeOpen = ref(false);
/** The close dialog was opened as "close as benign and suppress". */
const closeSuppressPreset = ref(false);
const settingsOpen = ref(false);
/** Triage can read what is suppressed, so a recurring case can be checked against it. */
const suppressionsOpen = ref(false);
const detectionNames = computed<Record<string, string>>(() =>
  Object.fromEntries(
    [...byId.value.entries()].map(([id, row]) => [id, row.meta.title || String(row.alert.name)]),
  ),
);

function onTransition(next: CaseStatus) {
  if (next === "resolved") openClose(false);
  else void setStatus(next);
}
function openClose(suppress: boolean) {
  closeSuppressPreset.value = suppress;
  closeOpen.value = true;
}

async function closeCase(form: CaseCloseForm): Promise<boolean> {
  const c = summary.value;
  if (!c) return false;
  const id = c.id;
  const minutes = suppressOf(form);
  try {
    // One call closes as benign and suppresses, so a failed suppression never leaves a half-done close.
    if (minutes) {
      await suppressMutation.mutateAsync({
        case_id: id,
        duration_minutes: minutes,
        reason: form.reason,
        close_case: true,
      });
    } else {
      await securityCases.close(orgId.value, id, form.verdict, form.reason);
    }
    toast({
      variant: "success",
      message: minutes
        ? t("siem.cases.close.closedSuppressed")
        : t("siem.cases.statusChanged", { status: t("siem.caseStatus.resolved") }),
    });
    refetchCases();
    fetchTotals();
    if (stillOpen(id)) void loadDetail(id);
    return true;
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? t("siem.cases.updateError") });
    return false;
  }
}

// Readers filter by assignee too, so the user list is not gated on triage.
const orgUsers = useQuery(() =>
  Object.assign(orgUsersQuery(orgId.value), { enabled: !!orgId.value }),
);
const { optionOf } = useOrgUserNames();
// OSelect reads "" as no selection and renders a blank trigger, so "nobody" is the null option.
const assigneeOptions = computed(() => [
  { label: t("siem.cases.unassigned"), value: null },
  ...((orgUsers.data.value ?? []) as Array<{ email: string }>).map((u) => optionOf(u.email)),
]);
const bulkAssignees = computed<BulkAssignee[]>(() => [
  { label: t("siem.cases.unassigned"), value: "" },
  ...((orgUsers.data.value ?? []) as Array<{ email: string }>).map((u) => {
    const o = optionOf(u.email);
    return { label: o.label, value: o.value };
  }),
]);
async function setAssignee(value: unknown) {
  const c = summary.value;
  const assignee = String(value ?? "");
  if (!c || assignee === (c.assigned_to ?? "")) return;
  updating.value = true;
  const id = c.id;
  try {
    await securityCases.assign(orgId.value, id, assignee);
    refetchCases();
    toast({
      variant: "success",
      message: assignee
        ? t("siem.cases.assignedTo", { to: assignee })
        : t("siem.cases.unassignedToast"),
    });
    if (stillOpen(id)) void loadDetail(id);
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? t("siem.cases.updateError") });
  } finally {
    updating.value = false;
  }
}

const priorityOptions = computed(() =>
  PRIORITIES.map((p) => ({
    label: t("siem.cases.priorityOption", { p, level: t(toneLabelKey(toneOfPriority(p))) }),
    value: p,
  })),
);
async function setPriority(value: unknown) {
  const c = summary.value;
  const severity = String(value ?? "");
  if (!c || !PRIORITIES.includes(severity as CasePriority) || severity === c.severity) return;
  updating.value = true;
  const id = c.id;
  try {
    await incidentsService.updateIncident(orgId.value, id, { severity });
    refetchCases();
    toast({ variant: "success", message: t("siem.cases.priorityChanged", { p: severity }) });
    if (stillOpen(id)) void loadDetail(id);
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message ?? t("siem.cases.updateError") });
  } finally {
    updating.value = false;
  }
}

// Drafts are per case, so a half-written note never follows the analyst to the next case.
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

// Analysis runs in the background, so the incident is polled until the run ends.
const RCA_POLL_MS = 5_000;
const { requestRca } = useRcaTrigger();
/** Report of the incident's newest completed run. */
const rca = ref("");
let rcaLoaded: { incidentId: string; runId: string } | null = null;
let rcaPoll: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const triggering = ref(false);
const analyzing = computed(() => triggering.value || isLiveRca(detail.value?.rca));

function stopRcaPoll() {
  clearTimeout(rcaPoll);
  rcaPoll = undefined;
}

async function loadRcaReport(id: string) {
  const runId = detail.value?.rca?.report_run?.run_id;
  if (!runId || (rcaLoaded?.incidentId === id && rcaLoaded.runId === runId)) return;
  try {
    const res = await incidentsService.getRcaRun(orgId.value, id, runId);
    if (!stillOpen(id)) return;
    rca.value = res.data.report ?? "";
    rcaLoaded = { incidentId: id, runId };
  } catch (e: any) {
    if (stillOpen(id)) {
      toast({
        variant: "error",
        message: e?.response?.data?.message ?? t("siem.cases.analysisError"),
      });
    }
  }
}

function syncRca(id: string) {
  if (disposed) return;
  stopRcaPoll();
  if (detail.value?.id !== id) return;
  void loadRcaReport(id);
  if (isLiveRca(detail.value.rca)) rcaPoll = setTimeout(() => void refreshRca(id), RCA_POLL_MS);
}

async function refreshRca(id: string, wasLive = isLiveRca(detail.value?.rca)) {
  if (disposed) return;
  try {
    const res = await incidentsService.get(orgId.value, id);
    if (!stillOpen(id) || detail.value?.id !== id) return;
    const next = res.data.rca ?? null;
    detail.value = { ...detail.value, rca: next };
    if (wasLive && next?.state === "failed") {
      toast({
        variant: "error",
        message: next.summary.detail ? raw(next.summary.detail) : t("siem.cases.analysisError"),
      });
    }
  } catch (e) {
    // A failed read says nothing about the run; keep polling on the last known state.
    console.error("Failed to refresh case analysis:", e);
  }
  syncRca(id);
}

async function runAnalysis() {
  const c = summary.value;
  if (!c) return;
  const id = c.id;
  triggering.value = true;
  try {
    const res = await requestRca(orgId.value, id, {}, { isStillActive: () => stillOpen(id) });
    if (res.status === "exhausted") toast({ variant: "error", message: res.notice });
    else if (res.status === "unavailable") toast({ variant: "error", message: res.message });
    else if (res.status === "started" && stillOpen(id)) await refreshRca(id, true);
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? t("siem.cases.analysisError"),
    });
  } finally {
    triggering.value = false;
  }
}

onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(debounceTimer);
  stopRcaPoll();
});

function openDetection(name: string) {
  const id = byName.value.get(name)?.alert.id;
  router.push({
    path: "/security/detections",
    query: { org_identifier: orgId.value, ...(id ? { detection: String(id) } : {}) },
  });
}
// Searched by raw alert name, which is what history rows carry.
function openAlerts() {
  const c = selectedId.value ? summary.value : null;
  const top = c ? detections.value[0]?.alertName : undefined;
  const SLACK_US = 5 * 60_000_000;
  const window = (c && firingRange(siemTriggers.value, c, SLACK_US)) ?? { period: "7d" };
  router.push({
    path: "/security/alerts",
    query: { org_identifier: orgId.value, ...window, ...(top ? { q: top } : {}) },
  });
}

const suppressOpen = ref(false);
async function suppressSimilar(values: CaseSuppressForm): Promise<boolean> {
  const c = summary.value;
  if (!c) return false;
  const id = c.id;
  try {
    await suppressMutation.mutateAsync({
      case_id: id,
      duration_minutes: values.duration,
      reason: values.reason,
      close_case: values.closeCase,
    });
    toast({
      variant: "success",
      message: t("siem.cases.suppress.done", {
        duration: t(`siem.cases.suppress.duration_${values.duration as SuppressDuration}`),
      }),
    });
    if (values.closeCase) fetchTotals();
    if (stillOpen(id)) void loadDetail(id);
    return true;
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("siem.cases.suppress.error"),
    });
    return false;
  }
}

onMounted(() => {
  void loadDetections(orgId.value);
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
    <template v-if="canTriage || canAdmin" #actions>
      <OButton
        v-if="canTriage"
        variant="outline"
        size="sm"
        icon-left="notifications-paused"
        data-test="security-cases-suppressions"
        @click="suppressionsOpen = true"
        >{{ t("siem.cases.activeSuppressions") }}</OButton
      >
      <OButton
        v-if="canAdmin"
        variant="outline"
        size="icon-sm"
        icon-left="settings"
        :aria-label="t('siem.cases.settings.open')"
        data-test="security-cases-settings"
        @click="settingsOpen = true"
      >
        <OTooltip side="bottom" :content="t('siem.cases.settings.open')" />
      </OButton>
    </template>
    <div class="flex min-h-0 flex-1 flex-col">
      <SecurityNotices
        :notices="notices"
        class="mx-page-edge my-3 shrink-0"
        data-test="security-cases-notices"
      />

      <OTable
        :data="cases"
        :columns="columns"
        row-key="id"
        :selection="canTriage ? 'multiple' : 'none'"
        v-model:selected-ids="selectedIds"
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
        <template v-if="canTriage" #selection-actions>
          <SecurityCaseBulkBar
            :assignees="bulkAssignees"
            :priorities="priorityOptions"
            :busy="bulkBusy"
            :merge-blocked="mergeBlocked"
            @close="openBulkClose(false)"
            @close-suppress="openBulkClose(true)"
            @assign="bulkAssign"
            @priority="bulkPriority"
            @merge="mergeOpen = true"
            @clear="clearSelection"
          />
        </template>
        <template #toolbar>
          <div class="contents">
            <div class="min-w-0 flex-1 max-md:min-w-40 md:min-w-48">
              <OSearchInput
                v-model="search"
                class="w-full"
                :placeholder="t('siem.cases.searchAll')"
                size="sm"
                data-test="security-cases-search"
              />
            </div>
            <div class="w-40 shrink-0 max-md:w-full">
              <OSelect
                :aria-label="t('siem.cases.filter.priority')"
                :model-value="priorityFilter"
                :options="priorityFilterOptions"
                :placeholder="t('siem.cases.filter.anyPriority')"
                multiple
                clearable
                size="sm"
                data-test="security-cases-filter-priority"
                @update:model-value="
                  (v: unknown) => (priorityFilter = Array.isArray(v) ? (v as CasePriority[]) : [])
                "
              />
            </div>
            <div class="w-56 shrink-0 max-md:w-full">
              <OSelect
                :aria-label="t('siem.cases.filter.detection')"
                :model-value="detectionFilter"
                :options="detectionOptions"
                :placeholder="t('siem.cases.filter.anyDetection')"
                multiple
                searchable
                clearable
                size="sm"
                data-test="security-cases-filter-detection"
                @update:model-value="
                  (v: unknown) => (detectionFilter = Array.isArray(v) ? v.map(String) : [])
                "
              />
            </div>
            <div class="w-48 shrink-0 max-md:w-full">
              <OSelect
                :aria-label="t('siem.cases.filter.assignee')"
                :model-value="assigneeFilter"
                :options="assigneeFilterOptions"
                :placeholder="t('siem.cases.filter.anyAssignee')"
                searchable
                clearable
                size="sm"
                data-test="security-cases-filter-assignee"
                @update:model-value="(v: unknown) => (assigneeFilter = v ? String(v) : null)"
              />
            </div>
            <OSwitch
              :model-value="showingClosed"
              :label="t('siem.cases.filter.showClosed')"
              size="sm"
              class="shrink-0"
              data-test="security-cases-show-closed"
              @update:model-value="toggleClosed"
            />
            <div class="w-48 shrink-0 max-md:w-full">
              <OSearchInput
                v-model="entityFilter"
                class="w-full"
                :placeholder="t('siem.cases.filter.entity')"
                size="sm"
                data-test="security-cases-filter-entity"
              />
            </div>
            <OStatStrip
              compact-values
              :items="stats"
              :loading="totals.open === null && loading"
              selectable
              :row="false"
              class="max-md:order-last"
              :selected-key="statusFilter"
              data-test="security-cases-stats"
              @select="onStatusTile"
            />
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
            <span class="flex min-w-0 items-center gap-1.5">
              <OTruncatedText
                class="text-text-heading min-w-0 font-medium"
                :data-test="`security-cases-title-${row.id}`"
                >{{ row.title || t("siem.overview.untitledCase") }}</OTruncatedText
              >
              <OTag
                v-if="unread(row)"
                variant="primary-soft"
                icon="data-info-alert"
                size="xs"
                class="shrink-0"
                :data-test="`security-cases-updated-${row.id}`"
                >{{ t("siem.cases.updated")
                }}<OTooltip
                  :content="
                    t('siem.cases.updatedHint', {
                      at: securityTime(Number(row.last_detection_at) / 1000),
                    })
                  "
              /></OTag>
              <OTag
                v-if="row.historical"
                variant="default-soft"
                icon="history"
                size="xs"
                class="shrink-0"
                :data-test="`security-cases-historical-${row.id}`"
                >{{ t("siem.cases.historical")
                }}<OTooltip :content="t('siem.cases.historicalHint')"
              /></OTag>
            </span>
            <OTruncatedText class="text-text-secondary text-2xs font-mono">{{
              (row.detections ?? 0) > 1
                ? t("siem.cases.idWithDetections", { id: row.id, n: row.detections })
                : row.id
            }}</OTruncatedText>
          </div>
        </template>
        <template #cell-entity="{ row }">
          <span
            v-if="caseEntities(row).length"
            class="flex min-w-0 items-center gap-1.5"
            :data-test="`security-cases-entity-${row.id}`"
          >
            <OIcon
              :name="ENTITY_ICON[caseEntities(row)[0].kind]"
              size="sm"
              class="text-text-secondary shrink-0"
              :aria-label="t(`siem.entities.kind.${caseEntities(row)[0].kind}`)"
            />
            <OTruncatedText class="text-text-heading min-w-0 font-mono text-xs">{{
              caseEntities(row)[0].value
            }}</OTruncatedText>
            <OTag
              v-if="caseEntities(row).length > 1"
              variant="default-soft"
              size="xs"
              class="shrink-0"
              >{{ t("siem.cases.moreEntities", { n: caseEntities(row).length - 1 })
              }}<OTooltip
                :content="
                  raw(
                    caseEntities(row)
                      .slice(1)
                      .map((e) => e.value)
                      .join(', '),
                  )
                "
            /></OTag>
          </span>
          <span v-else class="text-text-secondary">—</span>
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
          <SecurityAccessLock
            v-if="caseDenials.length"
            :denials="caseDenials"
            data-test="security-cases-access-lock"
          />
          <OEmptyState
            v-else-if="!loading"
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
      v-if="selectedId"
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
        <OTag
          v-if="drawerUpdatedAt"
          variant="primary-soft"
          icon="data-info-alert"
          size="sm"
          data-test="security-cases-drawer-updated"
          >{{ t("siem.cases.updated")
          }}<OTooltip
            :content="t('siem.cases.updatedHint', { at: securityTime(drawerUpdatedAt / 1000) })"
        /></OTag>
        <OTag
          v-if="summary.historical"
          variant="default-soft"
          icon="history"
          size="sm"
          data-test="security-cases-drawer-historical"
          >{{ t("siem.cases.historical") }}<OTooltip :content="t('siem.cases.historicalHint')"
        /></OTag>
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
        <OBanner
          v-else-if="detail && !detailLoading && hiddenTriggers > 0"
          variant="info"
          icon="info-outline"
          dense
          data-test="security-cases-hidden-alerts"
          >{{
            siemTriggers.length
              ? t("siem.cases.hiddenAlerts", { n: hiddenTriggers }, hiddenTriggers)
              : t("siem.cases.noSecurityAlerts")
          }}</OBanner
        >
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
          <OCollapsible
            v-for="(a, i) in alertRows"
            :key="`${a.alert_id}-${a.alert_fired_at}`"
            :default-open="i === 0"
            class="border-border-subtle border-b last:border-b-0"
            trigger-class="!px-3 !py-2"
            :data-test="`security-cases-drawer-firing-${i}`"
          >
            <template #trigger>
              <div class="flex min-w-0 flex-1 items-center gap-3 text-start">
                <div class="flex min-w-0 flex-1 flex-col">
                  <OTruncatedText class="text-text-heading text-sm font-medium">{{
                    byName.get(a.alert_name)?.meta.title ?? readableAlertName(a.alert_name)
                  }}</OTruncatedText>
                  <span class="text-text-secondary text-2xs">{{
                    t(`siem.cases.reason.${a.correlation_reason}`)
                  }}</span>
                </div>
                <OTag v-if="a.alert_kind === 'external'" variant="cyan-soft" size="xs">{{
                  a.detected_source || t("siem.cases.external")
                }}</OTag>
                <OTimeCell :value="a.alert_fired_at" unit="us" class="shrink-0 text-xs" />
              </div>
            </template>
            <SecurityCaseFiringEvidence
              v-if="a.alert_kind !== 'external' && byId.get(String(a.alert_id))"
              :org="orgId"
              :alert-id="String(a.alert_id)"
              :fired-at="a.alert_fired_at"
              :period-minutes="byId.get(String(a.alert_id))?.alert.trigger_condition?.period"
              :source-type="byId.get(String(a.alert_id))?.meta.sourceType"
              :entities="shownEntities"
              :data-test="`security-cases-drawer-evidence-${i}`"
            />
          </OCollapsible>
        </div>
      </template>

      <template #tab-timeline>
        <div v-if="canTriage" class="flex flex-col gap-2">
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
            :subtitle="raw([e.actor, securityTime(e.timestamp / 1000)].filter(Boolean).join(' · '))"
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
            v-if="canTriage"
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
        <div v-if="canTriage" class="w-44">
          <OSelect
            :aria-label="t('siem.aria.casePriority')"
            :model-value="summary.severity"
            :options="priorityOptions"
            :disabled="updating"
            size="sm"
            data-test="security-cases-drawer-priority"
            @update:model-value="setPriority"
          />
        </div>
        <div v-if="canTriage" class="w-56">
          <OSelect
            :aria-label="t('siem.aria.caseAssignee')"
            :model-value="summary.assigned_to || null"
            :options="assigneeOptions"
            :disabled="updating"
            searchable
            size="sm"
            data-test="security-cases-drawer-assignee"
            @update:model-value="setAssignee"
          />
        </div>
        <div class="flex-1" />
        <ODropdown side="top" align="end">
          <template #trigger>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="more-vert"
              :aria-label="t('siem.cases.moreActions')"
              data-test="security-cases-drawer-more"
            >
              <OTooltip side="top" :content="t('siem.cases.moreActions')" />
            </OButton>
          </template>
          <ODropdownItem
            v-if="canTriage && summary.status !== 'resolved'"
            icon-left="task-alt"
            data-test="security-cases-drawer-close-suppress"
            @select="openClose(true)"
            >{{ t("siem.cases.closeSuppress") }}</ODropdownItem
          >
          <ODropdownItem
            v-if="canTriage && shownEntities.length"
            icon-left="volume-off"
            data-test="security-cases-drawer-suppress"
            @select="suppressOpen = true"
            >{{ t("siem.cases.suppress.open") }}</ODropdownItem
          >
          <ODropdownItem
            v-else-if="canTriage"
            icon-left="volume-off"
            disabled
            data-test="security-cases-drawer-suppress-unavailable"
            >{{ t("siem.cases.suppress.noEntity") }}</ODropdownItem
          >
          <ODropdownItem
            icon-left="notifications-active"
            data-test="security-cases-drawer-open-alerts"
            @select="openAlerts"
            >{{ t("siem.cases.viewFirings") }}</ODropdownItem
          >
        </ODropdown>
        <template v-if="canTriage">
          <OButton
            v-for="next in TRANSITIONS[summary.status as CaseStatus]"
            :key="next"
            :variant="next === TRANSITIONS[summary.status as CaseStatus][0] ? 'primary' : 'outline'"
            size="sm-action"
            :loading="updating"
            :data-test="`security-cases-drawer-status-${next}`"
            @click="onTransition(next)"
          >
            {{ t(`siem.cases.transition.${next}`) }}
          </OButton>
        </template>
      </template>
    </SecurityRecordDrawer>
    <!-- Mounted on open: a dialog teleported before the drawer opened would stack under it. -->
    <SecurityCaseCloseDialog
      v-if="closeOpen"
      v-model:open="closeOpen"
      :close="closeCase"
      :suppress-preset="closeSuppressPreset"
      :no-entity="shownEntities.length ? 0 : 1"
    />
    <SecurityCaseCloseDialog
      v-if="canTriage && bulkCloseOpen"
      v-model:open="bulkCloseOpen"
      :count="bulkCloseResults ? bulkCloseResults.length : selectedIds.length"
      :high="highSelected"
      :suppress-preset="bulkSuppressPreset"
      :results="bulkCloseResults"
      :no-entity="selectedWithoutEntity"
      :close="bulkClose"
      data-test="security-cases-bulk-close-dialog"
    />
    <SecurityCaseMergeDialog
      v-if="canTriage && mergeOpen"
      v-model:open="mergeOpen"
      :cases="mergeCandidates"
      :merge="mergeSelected"
    />
    <SecurityCaseSuppressDialog
      v-if="canTriage && suppressOpen"
      v-model:open="suppressOpen"
      :allow-long="canAuthor"
      :suppress="suppressSimilar"
    />
    <SecurityCaseSettingsDialog v-if="canAdmin" v-model:open="settingsOpen" />
    <ODrawer
      v-if="canTriage && suppressionsOpen"
      v-model:open="suppressionsOpen"
      size="lg"
      bleed
      :title="t('siem.cases.activeSuppressions')"
      :sub-title="t('siem.cases.activeSuppressionsHint')"
      data-test="security-cases-suppressions-drawer"
    >
      <OContent class="flex flex-col gap-4">
        <SecuritySuppressions
          :org-id="orgId"
          :can-admin="canAdmin"
          :detection-names="detectionNames"
        />
      </OContent>
    </ODrawer>
  </OPageLayout>
</template>
