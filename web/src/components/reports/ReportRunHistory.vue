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
  <div class="flex h-full min-h-0 flex-col" data-test="reports-reportrunhistory">
    <OBanner
      v-if="linkedRunMessage"
      variant="warning"
      :content="linkedRunMessage"
      data-test="reports-reportrunhistory-linked-run-message"
    />
    <OTable
      :data="rows"
      :columns="columns"
      :row-key="rowKeyOf"
      pagination="server"
      :current-page="currentPage"
      :page-size="pageSize"
      :total-count="totalCount"
      sorting="server"
      :sort-by="sortColumn"
      :sort-order="sortOrder"
      :loading="history.isLoading.value"
      :forbidden="forbidden"
      :error="loadError"
      :frame="false"
      :show-global-filter="false"
      :persist-columns="true"
      :column-visibility="hiddenByDefault"
      :table-id="showReportColumn ? 'reports-history-org' : 'reports-history-report'"
      :enable-column-resize="true"
      :row-rail-tone="runRailTone"
      :row-class="rowClass"
      class="h-full min-h-0"
      data-test="reports-reportrunhistory-table"
      @pagination-change="onPaginationChange"
      @sort-change="onSortChange"
      @row-click="openRun"
    >
      <template #subheader>
        <div
          class="px-page-edge border-table-row-divider border-b py-1.5"
          data-test="reports-reportrunhistory-summary"
        >
          <OStatStrip
            :items="tiles"
            :loading="history.isLoading.value"
            selectable
            compact
            :selected-key="tile"
            @select="onTileSelect"
          />
        </div>
      </template>

      <template #toolbar>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-md:contents">
          <slot name="toolbar-start" />
          <OToggleGroup
            :model-value="range"
            mobile-dropdown
            data-test="reports-reportrunhistory-range"
            @update:model-value="onRangeChange"
          >
            <OToggleGroupItem
              v-for="option in REPORT_HISTORY_RANGES"
              :key="option.value"
              :value="option.value"
              size="sm"
              :data-test="`reports-reportrunhistory-range-${option.value}`"
            >
              {{ t(option.labelKey) }}
            </OToggleGroupItem>
            <OToggleGroupItem
              value="custom"
              size="sm"
              data-test="reports-reportrunhistory-range-custom"
            >
              {{ t("reports.history.rangeCustom") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <DateTime
            v-if="range === 'custom'"
            auto-apply
            default-type="absolute"
            :default-absolute-time="{ startTime: customRange.start, endTime: customRange.end }"
            data-test="reports-reportrunhistory-date-picker"
            @on:date-change="onCustomRange"
          />
          <OToggleGroup
            :model-value="triggerSource"
            mobile-dropdown
            data-test="reports-reportrunhistory-trigger"
            @update:model-value="onTriggerChange"
          >
            <OToggleGroupItem value="all" size="sm">
              {{ t("reports.history.triggerAll") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="scheduled" size="sm">
              {{ t("reports.history.triggerScheduled") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="manual" size="sm">
              {{ t("reports.history.triggerManual") }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
      </template>

      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="history.dataUpdatedAt.value"
          :loading="history.isFetching.value"
          data-test="reports-reportrunhistory-refresh"
          @click="refresh"
        />
      </template>

      <template #cell-timestamp="{ row }">
        <OTimeCell
          :value="row.timestamp"
          unit="us"
          mode="absolute"
          :timezone="store.state.timezone"
        />
      </template>

      <template #cell-report_name="{ row }">
        <OTruncatedText v-if="row.report_name">{{ row.report_name }}</OTruncatedText>
        <span v-else class="text-text-secondary">
          {{ t("reports.history.deletedReport", { id: row.report_id.slice(0, 6) }) }}
        </span>
      </template>

      <template #cell-status="{ row }">
        <span class="inline-flex">
          <OTag
            type="reportRunStatus"
            :value="runChip(row)"
            data-test="reports-reportrunhistory-status"
          />
        </span>
      </template>

      <template #cell-trigger_source="{ row }">
        <OTruncatedText v-if="row.trigger_source === 'manual'">
          {{
            row.triggered_by
              ? t("reports.history.triggerManualBy", { user: row.triggered_by })
              : t("reports.history.triggerManual")
          }}
        </OTruncatedText>
        <span v-else>{{ t("reports.history.triggerScheduled") }}</span>
      </template>

      <template #cell-recipient_count="{ row }">
        <span class="tabular-nums">{{
          row.is_cached || row.recipient_count == null ? "—" : row.recipient_count
        }}</span>
      </template>

      <template #cell-duration_ms="{ row }">
        <span class="tabular-nums">{{
          row.duration_ms == null
            ? "—"
            : t("reports.history.seconds", { count: Math.round(row.duration_ms / 1000) })
        }}</span>
      </template>

      <template #cell-delay_in_secs="{ row }">
        <span class="tabular-nums">{{
          row.delay_in_secs == null || row.trigger_source === "manual"
            ? "—"
            : t("reports.history.seconds", { count: row.delay_in_secs })
        }}</span>
      </template>

      <template #cell-time_in_queue_ms="{ row }">
        <span class="tabular-nums">{{
          row.time_in_queue_ms == null
            ? "—"
            : t("reports.history.milliseconds", { count: row.time_in_queue_ms })
        }}</span>
      </template>

      <template #empty>
        <OEmptyState
          v-if="history.data.value?.disabled_reason"
          size="hero"
          :title="disabledTitle"
          :description="disabledDescription"
          hide-action
          data-test="reports-reportrunhistory-disabled"
        />
        <OEmptyState
          v-else-if="isFiltered"
          size="hero"
          :title="t('reports.history.emptyRangeTitle')"
          :description="t('reports.history.emptyRangeDescription')"
          :action-label="t('reports.history.widenRange')"
          data-test="reports-reportrunhistory-empty-range"
          @action="widenRange"
        />
        <OEmptyState
          v-else
          size="hero"
          :title="t('reports.history.emptyNoRunsTitle')"
          :description="noRunsDescription"
          :action-label="canTrigger && reportId ? t('reports.history.runNow') : undefined"
          :hide-action="!(canTrigger && reportId)"
          data-test="reports-reportrunhistory-empty"
          @action="emit('run-now')"
        />
      </template>
    </OTable>

    <ReportRunDrawer
      :open="!!selectedRun"
      :run="selectedRun"
      :report="drawerReport"
      :can-trigger="canTrigger"
      :running="running"
      @update:open="(open) => !open && closeRun()"
      @run-now="emit('run-now', selectedRun?.report_id)"
      @edit-recipients="editRecipients"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useQuery, useQueries } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import DateTime from "@/components/DateTime.vue";
import ReportRunDrawer from "@/components/reports/ReportRunDrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useOrgId } from "@/composables/query/useOrgId";
import { reportByIdQuery, reportHistoryQuery, reportRunQuery } from "@/services/reports.queries";
import type {
  ReportHistoryQuery,
  ReportRunHit,
  ReportRunStatus,
  ReportTriggerSource,
} from "@/services/reports";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import {
  REPORT_HISTORY_RANGES,
  RUN_TIME_FORMAT,
  pendingManualRuns,
  runChip,
  runKey,
  runIdentity,
  runRailTone,
  type ReportHistoryRange,
} from "@/utils/reports/reportRun";

type Tile = "error" | "skipped" | "succeeded" | "cached" | "all";

/** Column id → the handler's sort allow-list. */
const SORT_KEYS: Record<string, NonNullable<ReportHistoryQuery["sort_by"]>> = {
  timestamp: "_timestamp",
  status: "status",
  retries: "retries",
};
const DEFAULT_RANGE: ReportHistoryRange = "7d";
/** The stream copy of a run written by the report server path lands within a minute. */
const LATE_ROW_REREAD_MS = 60_000;

const props = withDefaults(
  defineProps<{
    /** One report's runs; omitted for every report in the org. */
    reportId?: string;
    /** The report's configuration, for the drawer and the first-run empty state. */
    report?: any;
    showReportColumn?: boolean;
    showCachedTile?: boolean;
    canTrigger?: boolean;
    running?: boolean;
  }>(),
  {
    reportId: undefined,
    report: null,
    showReportColumn: false,
    showCachedTile: false,
    canTrigger: true,
    running: false,
  },
);

const emit = defineEmits<{ "run-now": [reportId?: string] }>();

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();

const range = ref<ReportHistoryRange>(DEFAULT_RANGE);
const anchor = ref(Date.now());
const customRange = ref({ start: (Date.now() - 7 * 86_400_000) * 1000, end: Date.now() * 1000 });
const triggerSource = ref<"all" | ReportTriggerSource>("all");
const tile = ref<Tile | null>(null);
const currentPage = ref(1);
const pageSize = ref(50);
const sortColumn = ref("timestamp");
const sortOrder = ref<"asc" | "desc">("desc");

const window = computed(() => {
  if (range.value === "custom") return customRange.value;
  const preset = REPORT_HISTORY_RANGES.find((r) => r.value === range.value)!;
  return { start: (anchor.value - preset.ms) * 1000, end: anchor.value * 1000 };
});

const searchableRunKeys = ref(new Set<string>());
const historyDisabled = ref(false);
const pending = computed(() => {
  if (
    historyDisabled.value ||
    sortColumn.value !== "timestamp" ||
    sortOrder.value !== "desc" ||
    tile.value ||
    triggerSource.value === "scheduled"
  )
    return [];
  return pendingManualRuns(orgId.value, props.reportId, [])
    .filter((hit) => !searchableRunKeys.value.has(runIdentity(hit)))
    .filter((hit) => hit.timestamp >= window.value.start && hit.timestamp <= window.value.end)
    .sort((a, b) => b.timestamp - a.timestamp);
});
const pendingOnPage = computed(() =>
  pending.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value),
);

const query = computed<ReportHistoryQuery>(() => {
  const q: ReportHistoryQuery = {
    report_id: props.reportId || undefined,
    start_time: window.value.start,
    end_time: window.value.end,
    from: Math.max(0, (currentPage.value - 1) * pageSize.value - pending.value.length),
    size: Math.max(1, pageSize.value - pendingOnPage.value.length),
    sort_by: SORT_KEYS[sortColumn.value] ?? "_timestamp",
    sort_order: sortOrder.value,
  };
  if (triggerSource.value !== "all") q.trigger_source = triggerSource.value;
  if (tile.value === "cached") {
    q.status = ["succeeded"];
    q.is_cached = true;
  } else if (tile.value === "succeeded") {
    q.status = ["succeeded"];
    if (props.showCachedTile) q.is_cached = false;
  } else if (tile.value && tile.value !== "all") {
    q.status = [tile.value as ReportRunStatus];
  }
  return q;
});

const history = useQuery(() =>
  Object.assign(reportHistoryQuery(orgId.value, query.value), { enabled: !!orgId.value }),
);

const pendingProbes = useQueries({
  queries: () =>
    pending.value.map((hit) => ({
      ...reportRunQuery(orgId.value, hit.report_id, hit.timestamp, hit.retries, !props.reportId),
      enabled: !!orgId.value && history.isSuccess.value,
    })),
});
watch(pendingProbes, (results) => {
  const candidates = new Set(pending.value.map(runIdentity));
  const known = new Set(searchableRunKeys.value);
  for (const result of results) {
    for (const hit of result.data?.hits ?? []) {
      const key = runIdentity(hit);
      if (candidates.has(key)) known.add(key);
    }
  }
  if (known.size !== searchableRunKeys.value.size) searchableRunKeys.value = known;
});
watch([currentPage, history.dataUpdatedAt], () => {
  for (const probe of pendingProbes.value) void probe.refetch();
});

const forbidden = computed(() => {
  const e: any = history.error.value;
  return e?.response?.status === 403;
});
const loadError = computed(() => {
  const e: any = history.error.value;
  if (!e || forbidden.value) return null;
  return raw(e?.response?.data?.message) || t("reports.history.loadError");
});

const served = computed<ReportRunHit[]>(() => history.data.value?.hits ?? []);
watch(history.data, (data) => {
  historyDisabled.value = !!data?.disabled_reason;
  const pendingKeys = new Set(pendingManualRuns(orgId.value, props.reportId, []).map(runIdentity));
  const known = new Set(searchableRunKeys.value);
  for (const hit of data?.hits ?? []) {
    const key = runIdentity(hit);
    if (pendingKeys.has(key)) known.add(key);
  }
  searchableRunKeys.value = known;
});
watch(orgId, () => {
  searchableRunKeys.value = new Set();
  historyDisabled.value = false;
});
const totalCount = computed(() => (history.data.value?.total ?? 0) + pending.value.length);
const rows = computed<ReportRunHit[]>(() => [
  ...pendingOnPage.value,
  ...served.value.slice(0, pageSize.value - pendingOnPage.value.length),
]);

const rowKeyOf = (row: ReportRunHit) => `${row.report_id}:${runKey(row)}`;
const rowClass = (row: ReportRunHit) => (row.status === "error" ? "!bg-status-error-bg" : "");

const counts = computed(() => {
  const stored = history.data.value?.counts;
  if (!stored) return undefined;
  const counts = { ...stored };
  for (const hit of pending.value) {
    counts.total += 1;
    if (hit.status === "succeeded") counts[hit.is_cached ? "cached" : "succeeded"] += 1;
    else if (hit.status === "error" || hit.status === "skipped") counts[hit.status] += 1;
  }
  return counts;
});
const tiles = computed<StatItem[]>(() => {
  const c = counts.value;
  const items: StatItem[] = [
    {
      key: "error",
      label: t("reports.history.tileFailed"),
      value: c?.error ?? 0,
      icon: "error",
      tone: "error",
      dataTest: "reports-reportrunhistory-tile-error",
    },
    {
      key: "skipped",
      label: t("reports.history.tileSkipped"),
      value: c?.skipped ?? 0,
      icon: "block",
      tone: "warning",
      dataTest: "reports-reportrunhistory-tile-skipped",
    },
    {
      key: "succeeded",
      label: t("reports.history.tileSent"),
      value: props.showCachedTile ? (c?.succeeded ?? 0) : (c?.succeeded ?? 0) + (c?.cached ?? 0),
      icon: "send",
      tone: "success",
      dataTest: "reports-reportrunhistory-tile-sent",
    },
  ];
  if (props.showCachedTile) {
    items.push({
      key: "cached",
      label: t("reports.history.tileCached"),
      value: c?.cached ?? 0,
      icon: "database",
      tone: "blue",
      dataTest: "reports-reportrunhistory-tile-cached",
    });
  }
  items.push({
    key: "all",
    label: t("reports.history.tileAll"),
    value: c?.total ?? 0,
    icon: "history",
    tone: "neutral",
    dataTest: "reports-reportrunhistory-tile-all",
  });
  return items;
});

const onTileSelect = (key: string) => {
  tile.value = key === "all" || key === tile.value ? null : (key as Tile);
  currentPage.value = 1;
};

const onRangeChange = (value: unknown) => {
  if (!value) return;
  range.value = value as ReportHistoryRange;
  anchor.value = Date.now();
  currentPage.value = 1;
};

const onCustomRange = (value: { startTime: number; endTime: number }) => {
  customRange.value = { start: value.startTime, end: value.endTime };
  currentPage.value = 1;
};

const onTriggerChange = (value: unknown) => {
  if (!value) return;
  triggerSource.value = value as "all" | ReportTriggerSource;
  currentPage.value = 1;
};

const onPaginationChange = (params: { page: number; size: number }) => {
  currentPage.value = params.page;
  pageSize.value = params.size;
};

const onSortChange = (params: { column: string; order: "asc" | "desc" }) => {
  sortColumn.value = params.column;
  sortOrder.value = params.order;
  currentPage.value = 1;
};

/** The default 7d window and the widened 30d one both read as "no runs yet"; only a narrower view is a filter. */
const isFiltered = computed(
  () =>
    !!tile.value ||
    triggerSource.value !== "all" ||
    (range.value !== DEFAULT_RANGE && range.value !== "30d"),
);

const widenRange = () => {
  tile.value = null;
  triggerSource.value = "all";
  range.value = "30d";
  anchor.value = Date.now();
  currentPage.value = 1;
};

/** Every read on the view is forced: the window moves to now, so the key changes. */
const refresh = () => {
  anchor.value = Date.now();
  void history.refetch();
  for (const probe of pendingProbes.value) void probe.refetch();
};

let lateReread: ReturnType<typeof setTimeout> | undefined;
/** Called by the page after a Run now resolves. */
const afterManualRun = () => {
  refresh();
  clearTimeout(lateReread);
  lateReread = setTimeout(refresh, LATE_ROW_REREAD_MS);
};
onBeforeUnmount(() => clearTimeout(lateReread));
defineExpose({ afterManualRun });

const disabledTitle = computed(() =>
  history.data.value?.disabled_reason === "trial_expired"
    ? t("reports.history.disabledTrialTitle")
    : t("reports.history.disabledTitle"),
);
const disabledDescription = computed(() => {
  switch (history.data.value?.disabled_reason) {
    case "trial_expired":
      return t("reports.history.disabledTrialDescription");
    default:
      return t("reports.history.disabledRemoteDescription", {
        setting: raw("ZO_USAGE_REPORTING_MODE"),
      });
  }
});

const noRunsDescription = computed(() => {
  if (!props.reportId) return t("reports.history.emptyOrgDescription");
  const next = props.report?.next_run_at;
  if (!next) return t("reports.history.emptyNoRunsUnscheduled");
  const tz = props.report?.timezone || "UTC";
  return t("reports.history.emptyNoRunsFirst", {
    time: raw(`${formatTimestampInTimezone(next, RUN_TIME_FORMAT, tz)} (${tz})`),
  });
});

const linkedIdentity = computed(() => {
  const key = route.query.run;
  if (typeof key !== "string") return null;
  const match = /^(\d+)(?:-(\d+))?$/.exec(key);
  if (!match) return null;
  const timestamp = Number(match[1]);
  const retries = Number(match[2] ?? 0);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isSafeInteger(retries))
    return null;
  const reportId =
    props.reportId ||
    (typeof route.query.run_report_id === "string" ? route.query.run_report_id : undefined);
  return { timestamp, retries, reportId };
});
const linkedRun = useQuery(() => {
  const identity = linkedIdentity.value;
  return Object.assign(
    reportRunQuery(
      orgId.value,
      identity?.reportId,
      identity?.timestamp ?? 0,
      identity?.retries ?? 0,
      !props.reportId,
    ),
    {
      enabled: !!orgId.value && !!identity,
    },
  );
});
const linkedMatches = computed(() => {
  const identity = linkedIdentity.value;
  if (!identity) return [];
  return (linkedRun.data.value?.hits ?? []).filter(
    (hit) =>
      hit.timestamp === identity.timestamp &&
      hit.retries === identity.retries &&
      (!identity.reportId || hit.report_id === identity.reportId),
  );
});
const selectedRun = computed<ReportRunHit | null>(() => {
  if (!linkedIdentity.value || linkedRun.error.value) return null;
  if (linkedRun.isSuccess.value) {
    if (!linkedIdentity.value.reportId && (linkedRun.data.value?.total ?? 0) > 1) return null;
    const pendingHit = pending.value.find(
      (hit) => hit.report_id === linkedIdentity.value?.reportId && runKey(hit) === route.query.run,
    );
    return linkedMatches.value.length === 1 ? linkedMatches.value[0] : (pendingHit ?? null);
  }
  const identity = linkedIdentity.value;
  if (!identity.reportId) return null;
  return (
    rows.value.find(
      (hit) =>
        hit.report_id === identity.reportId &&
        hit.timestamp === identity.timestamp &&
        hit.retries === identity.retries,
    ) ?? null
  );
});
/** A denied or deleted report is not an error here: the drawer falls back to UTC and no dashboards. */
const runReport = useQuery(() =>
  Object.assign(
    reportByIdQuery(orgId.value, selectedRun.value?.report_id ?? "", { silentForbidden: true }),
    { enabled: !!orgId.value && !props.report && !!selectedRun.value },
  ),
);
const drawerReport = computed(() => props.report ?? runReport.data.value ?? null);

const linkedRunMessage = computed(() => {
  if (!route.query.run) return null;
  if (!linkedIdentity.value) return t("reports.history.linkedRunInvalid");
  const error: any = linkedRun.error.value;
  if (error?.response?.status === 403) return t("reports.history.linkedRunForbidden");
  if (error) return t("reports.history.loadError");
  if (!linkedRun.isSuccess.value) return null;
  if (
    linkedMatches.value.length > 1 ||
    (!linkedIdentity.value.reportId && (linkedRun.data.value?.total ?? 0) > 1)
  )
    return t("reports.history.linkedRunAmbiguous");
  return linkedMatches.value.length === 0 && !selectedRun.value
    ? t("reports.history.linkedRunMissing")
    : null;
});

const openRun = (row: ReportRunHit) =>
  router.replace({ query: { ...route.query, run: runKey(row), run_report_id: row.report_id } });

const closeRun = () => {
  const { run: _run, run_report_id: _report, ...rest } = route.query;
  router.replace({ query: rest });
};

const editRecipients = () => {
  const run = selectedRun.value;
  if (!run) return;
  router.push({
    name: "createReport",
    query: {
      report_id: run.report_id,
      name: run.report_name,
      org_identifier: orgId.value,
      folder: (route.query.folder as string) || "default",
      step: "destinations",
      returnTo: router.resolve({
        name: "reportDetail",
        params: { report_id: run.report_id },
        query: { org_identifier: orgId.value, tab: "history" },
      }).fullPath,
    },
  });
};

watch(
  () => props.reportId,
  () => {
    currentPage.value = 1;
  },
);

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "timestamp",
    accessorKey: "timestamp",
    header: t("reports.history.colRunAt"),
    cell: " ",
    size: 170,
    sortable: true,
    resizable: true,
    meta: { align: "left" },
  },
  ...(props.showReportColumn
    ? [
        {
          id: "report_name",
          accessorKey: "report_name",
          header: t("reports.history.colReport"),
          cell: " ",
          size: 200,
          resizable: true,
          hideable: true,
          meta: { align: "left" },
        } as OTableColumnDef,
      ]
    : []),
  {
    id: "status",
    accessorKey: "status",
    header: t("reports.history.colStatus"),
    cell: " ",
    size: 130,
    sortable: true,
    resizable: true,
    meta: { align: "left" },
  },
  {
    id: "trigger_source",
    accessorKey: "trigger_source",
    header: t("reports.history.colTrigger"),
    cell: " ",
    size: 180,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "recipient_count",
    accessorKey: "recipient_count",
    header: t("reports.history.colRecipients"),
    cell: " ",
    size: 110,
    resizable: true,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "duration_ms",
    accessorKey: "duration_ms",
    header: t("reports.history.colDuration"),
    cell: " ",
    size: 100,
    resizable: true,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "delay_in_secs",
    accessorKey: "delay_in_secs",
    header: t("reports.history.colDelay"),
    cell: " ",
    size: 90,
    resizable: true,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "retries",
    accessorKey: "retries",
    header: t("reports.history.colRetries"),
    size: 90,
    sortable: true,
    resizable: true,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "error",
    accessorKey: "error",
    header: t("reports.history.colReason"),
    resizable: true,
    hideable: true,
    meta: { align: "left", flex: true },
  },
  {
    id: "source_node",
    accessorKey: "source_node",
    header: t("reports.history.colNode"),
    size: 160,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "scheduler_trace_id",
    accessorKey: "scheduler_trace_id",
    header: t("reports.history.colTraceId"),
    size: 200,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "time_in_queue_ms",
    accessorKey: "time_in_queue_ms",
    header: t("reports.history.colQueueTime"),
    cell: " ",
    size: 110,
    resizable: true,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "attachment_type",
    accessorKey: "attachment_type",
    header: t("reports.history.colAttachment"),
    size: 110,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "dashboard_count",
    accessorKey: "dashboard_count",
    header: t("reports.history.colDashboards"),
    size: 110,
    resizable: true,
    hideable: true,
    meta: { align: "right" },
  },
]);

const hiddenByDefault = {
  source_node: false,
  scheduler_trace_id: false,
  time_in_queue_ms: false,
  attachment_type: false,
  dashboard_count: false,
};
</script>
