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

<!--
  Workflow runs list — the persistent "detail list" of the Runs inspection view
  (master-detail). Renders inline (no drawer chrome): a compact header with a
  datetime range picker + refresh, the run-frequency timeline, and a table of
  runs. Selecting a run emits `select-run`; the currently-loaded run
  (`selectedRunId`) is highlighted so the list and the canvas stay in sync.

  This is the single source of the runs list — data comes from
  GET /workflows/{id}/history, mirroring AlertHistory's presentation.
-->
<template>
  <div class="flex h-full min-h-0 flex-col" data-test="workflow-runs-panel">
    <!-- Compact header: title + datetime range picker + refresh -->
    <div
      class="border-border-default flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2"
    >
      <div class="min-w-0">
        <div class="text-text-body text-sm leading-tight font-semibold">
          {{ t("workflow.history.title") }}
        </div>
        <OTruncatedText
          v-if="workflowName"
          as="div"
          class="text-text-secondary text-xs leading-tight"
        >
          {{ workflowName }}
        </OTruncatedText>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <DateTime
          ref="dateTimeRef"
          auto-apply
          :default-type="dateTimeType"
          :default-absolute-time="{
            startTime: absoluteTime.startTime,
            endTime: absoluteTime.endTime,
          }"
          :default-relative-time="relativeTime"
          data-test="workflow-runs-date-picker"
          @on:date-change="updateDateTime"
        />
        <OButton
          v-if="testRunCount > 0"
          variant="outline"
          size="sm"
          data-test="workflow-runs-show-test"
          @click="showTestRuns = !showTestRuns"
        >
          {{
            showTestRuns
              ? t("workflow.history.hideTestRuns")
              : t("workflow.history.showTestRuns", { count: testRunCount })
          }}
        </OButton>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="workflowObj.runsHistory.fetchedAt || null"
          :loading="loading"
          data-test="workflow-runs-refresh"
          @click="fetchHistory(true)"
        />
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <!-- Offered only once the workflow has or had an endpoint; every other workflow keeps today's list. -->
      <div v-if="showTriggerFilter" class="flex shrink-0 flex-wrap items-center gap-2">
        <OToggleGroup
          :model-value="activeFilter"
          mobile-dropdown
          data-test="workflow-runs-trigger-filter"
          @update:model-value="onFilterChange"
        >
          <OToggleGroupItem
            v-for="opt in filterOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            class="w-28 shrink-0"
            :data-test="`workflow-runs-trigger-filter-${opt.value}`"
          >
            {{ opt.label }}
          </OToggleGroupItem>
        </OToggleGroup>
        <div class="min-w-0 flex-1 max-md:min-w-40">
          <OSearchInput
            v-model="search"
            size="sm"
            clearable
            :placeholder="t('workflow.history.searchRuns')"
            data-test="workflow-runs-search"
          />
        </div>
      </div>

      <WorkflowRunsTimeline
        :runs="timelineRuns"
        :start="dateTimeValues.startTime"
        :end="dateTimeValues.endTime"
        :timezone="store.state.timezone"
      />

      <div class="alert-history-table min-h-0 flex-1">
        <OTable
          data-test="workflow-runs-table"
          :data="rows"
          :columns="columns"
          row-key="run_id"
          :row-class="rowClass"
          :page-size="20"
          :page-size-options="[20, 50, 100]"
          :loading="loading"
          :show-global-filter="false"
          :default-columns="false"
          :enable-column-resize="true"
          sort-by="start_time"
          sort-order="desc"
          width="100%"
          class="h-full w-full [&_[data-test=o2-table-scroll-container]]:[scrollbar-gutter:stable]"
          @row-click="openRun"
        >
          <template #empty>
            <div class="py-10">
              <OEmptyState
                v-if="loadError"
                preset="load-error"
                data-test="workflow-runs-load-error"
                @action="fetchHistory(true)"
              />
              <OEmptyState
                v-else-if="!search.trim() && activeFilter !== 'all'"
                size="inline"
                :icon="filterEmpty.icon"
                :title="filterEmpty.title"
                :description="filterEmpty.description"
                :action-label="t('workflow.http.runsEmptyAction')"
                :data-test="
                  activeFilter === 'http_request'
                    ? 'workflow-runs-http-empty'
                    : 'workflow-runs-filter-empty'
                "
                @action="onFilterChange('all')"
              />
              <OEmptyState
                v-else-if="search.trim()"
                size="inline"
                icon="search"
                :title="t('workflow.history.searchEmptyTitle')"
                :action-label="t('workflow.history.searchEmptyAction')"
                data-test="workflow-runs-search-empty"
                @action="search = ''"
              />
              <NoData v-else />
            </div>
          </template>

          <template #cell-start_time="{ value }">
            <OTimeCell
              :value="value"
              unit="us"
              mode="absolute"
              :format="RUN_TIME_SHORT"
              :timezone="store.state.timezone"
              :empty-label="dash"
            />
          </template>

          <template #cell-duration="{ row }">
            {{ NO_DURATION.has(row.status) ? dash : formatDuration(row.end_time - row.start_time) }}
          </template>

          <template #cell-status="{ row }">
            <div class="flex min-w-0 flex-col items-start gap-0.5">
              <span class="inline-flex">
                <OTag type="hookRunStatus" :value="row.status" size="sm" />
                <OTooltip
                  v-if="row.status === 'failed' && row.error && !runReasonOf(row)"
                  side="left"
                  max-width="22rem"
                  :content="raw(String(humanizeNodeIds(row.error, t)))"
                />
              </span>
              <span
                v-if="runReasonOf(row)"
                :data-test="`workflow-run-reason-${row.run_id}`"
                class="text-text-secondary text-2xs leading-tight whitespace-normal"
              >
                {{ reasonText(row) }}
              </span>
            </div>
          </template>

          <template #cell-run_id="{ row }">
            <span class="font-mono">
              {{ shortRunId(row.run_id) }}
              <OTooltip side="left" :content="raw(row.run_id)" />
            </span>
          </template>

          <template #cell-trigger="{ row }">
            <span class="inline-flex max-w-full min-w-0">
              <OTag
                variant="default-soft"
                shape="rounded"
                size="sm"
                :icon="sourceIcon(row)"
                :label="sourceLabel(row)"
                :data-test="isTestRun(row) ? 'workflow-run-test-marker' : undefined"
              />
              <OTooltip
                v-if="isTestRun(row)"
                side="left"
                :content="t('workflow.history.testRunTooltip')"
              />
            </span>
          </template>

          <template #cell-details="{ row }">
            <div
              class="flex min-w-0 flex-col leading-tight"
              :data-test="`workflow-run-details-${row.run_id}`"
            >
              <OTruncatedText
                class="text-xs"
                :class="
                  runSourceOf(row) === 'http' || runSourceOf(row) === 'retry' ? 'font-mono' : ''
                "
              >
                {{ detailsOf(row).primary }}
              </OTruncatedText>
              <OTruncatedText v-if="detailsOf(row).secondary" class="text-text-secondary text-2xs">
                {{ detailsOf(row).secondary }}
              </OTruncatedText>
            </div>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex items-center gap-1">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="open-in-new"
                :aria-label="t('workflow.history.openRun')"
                :data-test="`workflow-run-open-${row.run_id}`"
                @click.stop="openRun(row)"
              >
                <OTooltip side="left" :content="t('workflow.history.openRun')" />
              </OButton>
              <OButton
                v-if="isRetryableRun(row)"
                variant="ghost"
                size="icon-sm"
                icon-left="refresh"
                :aria-label="t('workflow.history.retryTooltip')"
                :loading="retryingRunId === row.run_id"
                :data-test="`workflow-run-retry-${row.run_id}`"
                @click.stop="askRetry(row)"
              >
                <OTooltip side="left" :content="t('workflow.history.retryTooltip')" />
              </OButton>
              <span
                v-else
                class="inline-block size-8 shrink-0"
                aria-hidden="true"
                data-test="workflow-run-retry-slot"
              />
            </div>
          </template>
        </OTable>
      </div>
    </div>

    <ConfirmDialog
      v-model="retryConfirm.show"
      :title="t('workflow.history.retryTitle')"
      :message="t('workflow.history.retryMessage')"
      :ok-label="t('workflow.history.retry')"
      @update:ok="doRetry"
      @update:cancel="retryConfirm.show = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import DateTime from "@/components/DateTime.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useQuery } from "@tanstack/vue-query";
import { workflowHttpTriggerQuery } from "@/services/workflows.queries";
import { alertsListQuery } from "@/services/alerts.queries";
import type { WorkflowHistoryRow } from "@/services/workflows";
import {
  RUN_SOURCE_LABEL_KEYS,
  isHttpRun,
  runSourceOf,
  workflowHooksEnabled,
  type RunSource,
} from "@/plugins/workflows/httpEndpoint";
import {
  RUN_REASON_KEYS,
  matchesRunSearch,
  matchesTriggerFilter,
  runReasonOf,
  shortRunId,
  triggerFilterSource,
  RUN_TIME_SHORT,
  type RunTriggerFilter,
} from "@/plugins/workflows/runStatus";
import { triggerDef } from "@/plugins/workflows/triggers";
import {
  workflowObj,
  loadRunsHistory,
  isTestRun,
  useTestRunVisibility,
  humanizeNodeIds,
  isRetryableRun,
  retryWorkflowRun,
  currentTriggerKind,
} from "@/plugins/workflows/useWorkflowCanvas";
import WorkflowRunsTimeline, { type TimelineRun } from "./WorkflowRunsTimeline.vue";

// Nothing ran yet, or the run never started, so there is no duration to show.
const NO_DURATION: ReadonlySet<string> = new Set(["queued", "running", "expired"]);

const props = defineProps<{
  orgId: string;
  workflowId: string;
  workflowName?: string;
  // The run currently loaded on the canvas — highlighted in the list.
  selectedRunId?: string;
}>();
const emit = defineEmits<{ (e: "select-run", runId: string): void }>();
const triggerFilter = defineModel<RunTriggerFilter>("triggerFilter", { default: "all" });

const { t } = useI18nTyped();
const store = useStore();
const dash = raw("—");

// Loading + the runs list live in SHARED state (workflowObj.runsHistory) so the
// NDV run switcher reuses the same fetch instead of re-hitting /history.
const loading = computed(() => workflowObj.runsHistory.loading);
// Distinguishes "the fetch failed" from "there are no runs" — the table's empty
// slot renders a retryable error state for the former.
const loadError = ref(false);

// Default range: last 24 hours (user can widen it via the picker). Same shape as
// AlertHistory — startTime/endTime are microseconds.
const dateTimeType = ref("relative");
const relativeTime = ref("24h");
const now = Date.now();
const dayAgo = now - 24 * 60 * 60 * 1000;
const absoluteTime = ref({
  startTime: dayAgo * 1000,
  endTime: now * 1000,
});
const dateTimeValues = ref({
  startTime: dayAgo * 1000,
  endTime: now * 1000,
});

// mirrors AlertHistory.formatDuration (microseconds -> h/m/s). The unit
// suffixes go through i18n rather than being concatenated, so a locale can
// relabel or reorder them ("2h 5m" is not universal).
const formatDuration = (microseconds: number) => {
  if (!microseconds || microseconds <= 0) return t("workflow.history.durationZero");
  const seconds = Math.floor(microseconds / 1_000_000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0)
    return t("workflow.history.durationHoursMinutes", {
      hours,
      minutes: minutes % 60,
    });
  if (minutes > 0)
    return t("workflow.history.durationMinutesSeconds", {
      minutes,
      seconds: seconds % 60,
    });
  return t("workflow.history.durationSeconds", { seconds });
};

// Shared with the editor's History dropdown so the two run-history surfaces cannot
// disagree about what a published workflow should show.
const { showTestRuns, testRunCount, visibleRuns } = useTestRunVisibility();

const hooksOn = computed(() => workflowHooksEnabled(store.state.zoConfig));
const endpoint = useQuery(() => ({
  ...workflowHttpTriggerQuery(props.orgId, props.workflowId),
  enabled: hooksOn.value && !!props.orgId && !!props.workflowId,
}));
// "Has or had": a configured endpoint (even one turned off) or HTTP runs still in the window.
const showTriggerFilter = computed(
  () =>
    hooksOn.value &&
    (endpoint.data.value?.configured === true ||
      workflowObj.currentSelectedWorkflow?.http_endpoint_enabled === true ||
      workflowObj.runsHistory.list.some(isHttpRun)),
);
const activeFilter = computed(() => (showTriggerFilter.value ? triggerFilter.value : "all"));
const search = ref("");

const onFilterChange = (value: unknown) => {
  if (typeof value === "string" && value) triggerFilter.value = value;
};

const filterOptions = computed(() => {
  const kind = currentTriggerKind();
  const kindSource = triggerFilterSource(kind);
  return [
    { value: "all", label: t("workflow.history.allTriggers") },
    ...(kind && kindSource ? [{ value: kind, label: t(RUN_SOURCE_LABEL_KEYS[kindSource]) }] : []),
    { value: "http_request", label: t("workflow.history.sourceHttp") },
  ];
});

const SOURCE_ICONS: Record<RunSource, IconName> = {
  http: "webhook",
  alert_fired: triggerDef("alert_fired").icon,
  incident_event: triggerDef("incident_event").icon,
  test: "science",
  retry: "replay",
  manual: "person",
  other: "bolt",
};
const sourceIcon = (row: WorkflowHistoryRow): IconName => SOURCE_ICONS[runSourceOf(row)];
const sourceLabel = (row: WorkflowHistoryRow) => t(RUN_SOURCE_LABEL_KEYS[runSourceOf(row)]);
const reasonText = (row: WorkflowHistoryRow) => {
  const reason = runReasonOf(row);
  return reason ? t(RUN_REASON_KEYS[reason]) : "";
};

const visible = computed(() => visibleRuns(workflowObj.runsHistory.list as WorkflowHistoryRow[]));

const alerts = useQuery(() => ({
  ...alertsListQuery(props.orgId, ""),
  enabled: !!props.orgId && visible.value.some((r) => runSourceOf(r) === "alert_fired"),
}));
const alertNames = computed(
  () =>
    new Map<string, string>(
      (alerts.data.value ?? []).map((a: { alert_id: string; name: string }) => [
        a.alert_id,
        a.name,
      ]),
    ),
);
const alertNameOf = (row: WorkflowHistoryRow): string | null =>
  runSourceOf(row) === "alert_fired"
    ? alertNames.value.get(row.source_id) || row.source_id || null
    : null;

const startedAt = (row: WorkflowHistoryRow): number =>
  isHttpRun(row) && (row.status === "queued" || !row.start_time) ? row._timestamp : row.start_time;

const detailsOf = (row: WorkflowHistoryRow): { primary: I18nText; secondary: I18nText | null } => {
  const source = runSourceOf(row);
  if (source === "http") {
    const facts = row.http_request;
    const ip = raw(facts?.caller_ip || "—");
    return {
      primary: raw(facts?.credential_prefix || "—"),
      secondary: facts?.idempotency_key
        ? t("workflow.history.detailsWithKey", { ip, key: raw(facts.idempotency_key) })
        : t("workflow.history.detailsNoKey", { ip }),
    };
  }
  if (source === "alert_fired") return { primary: raw(alertNameOf(row) || "—"), secondary: null };
  if (source === "retry") {
    return {
      primary: row.source_id
        ? t("workflow.history.retryOf", { run: raw(shortRunId(row.source_id)) })
        : dash,
      secondary: null,
    };
  }
  return { primary: raw(row.source_id || "—"), secondary: null };
};

const rows = computed(() =>
  visible.value.filter(
    (r) =>
      matchesTriggerFilter(r, activeFilter.value) &&
      matchesRunSearch(r, search.value, alertNameOf(r)),
  ),
);

const filterEmpty = computed(() => {
  const filter = activeFilter.value;
  const source = filter === "http_request" ? "http" : triggerFilterSource(filter);
  const others = visible.value.length > 0;
  const titles: Partial<Record<RunSource, I18nText>> = {
    http: t("workflow.http.runsEmptyTitle"),
    alert_fired: t("workflow.history.alertFiredEmptyTitle"),
    incident_event: t("workflow.history.incidentEventEmptyTitle"),
  };
  return {
    icon: source ? SOURCE_ICONS[source] : SOURCE_ICONS.other,
    title: (source && titles[source]) || t("workflow.history.filterEmptyTitle"),
    description: others
      ? t("workflow.history.filterEmptyDimmed")
      : source === "http"
        ? t("workflow.http.runsEmptyBody")
        : undefined,
  };
});

// Highlight the run currently loaded on the canvas. `!` (important) so the tint
// wins over OTable's default/hover row background — keeping the list and canvas
// in sync without a scoped :deep() override.
const rowClass = (row: any) =>
  row.run_id && row.run_id === props.selectedRunId ? "bg-select-item-hover-bg!" : "";

const timelineRuns = computed<TimelineRun[]>(() => {
  const shown = new Set(rows.value.map((r) => r.run_id));
  return visible.value.map((r) => ({
    id: r.run_id,
    at: startedAt(r),
    status: r.status,
    matched: shown.has(r.run_id),
  }));
});

function fixedColumn(
  id: string,
  header: OTableColumnDef["header"],
  size: number,
  access: Pick<OTableColumnDef, "accessorKey" | "accessorFn">,
): OTableColumnDef {
  return { id, header, ...access, sortable: true, size, maxSize: size, meta: { align: "left" } };
}

const columns = computed<OTableColumnDef[]>(() => [
  fixedColumn("start_time", t("workflow.history.started"), 112, { accessorFn: startedAt }),
  fixedColumn("status", t("workflow.history.status"), 92, {
    accessorFn: (row: WorkflowHistoryRow) => row.status,
  }),
  fixedColumn("run_id", t("workflow.history.run"), 88, { accessorKey: "run_id" }),
  fixedColumn("trigger", t("workflow.history.triggerFilter"), 124, {
    accessorFn: (row: WorkflowHistoryRow) => runSourceOf(row),
  }),

  {
    ...fixedColumn("details", t("workflow.history.sourceDetails"), 210, {
      accessorFn: (row: WorkflowHistoryRow) => String(detailsOf(row).primary),
    }),
    minSize: 160,
    maxSize: undefined,
    meta: { align: "left", autoWidth: true, fillRemaining: true },
  },
  fixedColumn("duration", t("workflow.history.duration"), 84, {
    accessorFn: (row: WorkflowHistoryRow) => row.end_time - row.start_time,
  }),
  {
    id: "actions",
    header: t("workflow.actions"),
    isAction: true,
    pinned: "right",
    size: 68,
    maxSize: 68,
    meta: { align: "center", actionCount: 2 },
  },
]);

// `force` for the refresh and retry buttons; a mount or window change reads the cache.
const fetchHistory = async (force = false) => {
  if (!props.workflowId) return;
  const res = await loadRunsHistory({
    orgId: props.orgId,
    workflowId: props.workflowId,
    start: dateTimeValues.value.startTime,
    end: dateTimeValues.value.endTime,
    force,
  });
  if (res.ok) {
    loadError.value = false;
    return;
  }
  // 403 is "no permission", not a failure to load — keep the plain empty state
  // for it rather than offering a retry that cannot succeed.
  loadError.value = res.status !== 403;
  if (loadError.value) {
    toast({ variant: "error", message: t("workflow.history.loadError") });
  }
};

// Replaying dispatches destination steps for real, so it is confirmed first.
const retryConfirm = ref<{ show: boolean; row: any }>({ show: false, row: null });
const retryingRunId = ref("");

const askRetry = (row: any) => {
  if (!isRetryableRun(row)) return;
  retryConfirm.value = { show: true, row };
};

const doRetry = async () => {
  const row = retryConfirm.value.row;
  retryConfirm.value = { show: false, row: null };
  if (!row?.run_id) return;
  retryingRunId.value = row.run_id;
  const r = await retryWorkflowRun({
    orgId: props.orgId,
    workflowId: props.workflowId,
    runId: row.run_id,
    run: row,
  });
  retryingRunId.value = "";
  if (!r.ok) {
    toast({
      message: raw(r.error || t("workflow.history.retryError")),
      variant: "error",
    });
    return;
  }
  toast({ message: t("workflow.history.retryStarted"), variant: "success" });
  // The retry is a separate run — the list is stale until it is re-pulled.
  await fetchHistory();
};

const updateDateTime = (value: any) => {
  dateTimeValues.value = { startTime: value.startTime, endTime: value.endTime };
  if (value.relativeTimePeriod) {
    dateTimeType.value = "relative";
    relativeTime.value = value.relativeTimePeriod;
  } else {
    dateTimeType.value = "absolute";
    absoluteTime.value = { startTime: value.startTime, endTime: value.endTime };
  }
  fetchHistory();
};

const openRun = (row: any) => {
  if (!row?.run_id) return;
  emit("select-run", row.run_id);
};

// Refetch when the workflow changes. The INITIAL fetch is NOT triggered here — the
// DateTime picker emits `@on:date-change` on mount (→ updateDateTime → fetchHistory)
// with the actual displayed range, so an `immediate` watch would double-fetch.
watch(
  () => props.workflowId,
  (id, prev) => {
    if (id && id !== prev) fetchHistory();
  },
);

defineExpose({ fetchHistory });
</script>
