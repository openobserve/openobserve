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
        <div v-if="workflowName" class="text-text-secondary truncate text-xs leading-tight">
          {{ workflowName }}
        </div>
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
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="workflow-runs-refresh"
          @click="fetchHistory"
        >
          <OTooltip side="bottom" :content="t('common.refresh')" />
        </OButton>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <!-- Run-frequency timeline (reused from AlertHistory for consistency). -->
      <WorkflowExecutionTimeline
        v-if="rows.length > 0"
        :history="timelineHistory"
        :firing-label="t('workflow.history.failed')"
        :ok-label="t('workflow.history.success')"
        class="shrink-0"
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
          :footer-title="t('workflow.history.button')"
          :show-index="true"
          :enable-column-resize="true"
          sort-by="start_time"
          sort-order="desc"
          width="100%"
          class="h-full w-full"
          @row-click="openRun"
        >
          <!-- A failed fetch used to fall through to <NoData />, so "request
               failed" and "this workflow has never run" looked identical and the
               user had no way to retry. -->
          <template #empty>
            <div class="py-10">
              <OEmptyState
                v-if="loadError"
                preset="load-error"
                data-test="workflow-runs-load-error"
                @action="fetchHistory"
              />
              <NoData v-else />
            </div>
          </template>

          <template #cell-start_time="{ value }">
            <OTimeCell
              :value="value"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
              :empty-label="raw('—')"
            />
          </template>

          <template #cell-duration="{ row }">
            {{ formatDuration(row.end_time - row.start_time) }}
          </template>

          <!-- The reason rides on the Failed badge (as in the run switcher) rather
               than a column: in a 27.5rem panel a dedicated Error column is blank
               on every healthy run and still too narrow to read a message in. -->
          <template #cell-status="{ row }">
            <OBadge :variant="getStatusVariant(row.error ? 'failed' : 'success')" size="sm">
              {{ row.error ? t("workflow.history.failed") : t("workflow.history.success") }}
              <OTooltip
                v-if="row.error"
                side="left"
                max-width="22rem"
                :content="raw(String(humanizeNodeIds(row.error, t)))"
              />
            </OBadge>
          </template>

          <!-- A dot, not a badge: at 44px a worded badge is what clipped to "T".
               The label stays reachable via the tooltip and the screen-reader text. -->
          <template #cell-event_type="{ row }">
            <OTooltip
              v-if="isTestRun(row)"
              :content="t('workflow.history.testRunTooltip')"
              class="inline-flex"
            >
              <span
                class="bg-text-secondary inline-block size-2 rounded-full align-middle"
                data-test="workflow-run-test-marker"
              >
                <span class="sr-only">{{ t("workflow.history.testRun") }}</span>
              </span>
            </OTooltip>
            <span v-else class="text-text-secondary">—</span>
          </template>

          <!-- Retry is offered ONLY where the backend can honour it: a failed run
               whose errors were persisted. Test and Retry runs record no input, so
               the row simply has no button rather than a dead one. -->
          <template #cell-actions="{ row }">
            <OButton
              v-if="isRetryableRun(row)"
              variant="ghost"
              size="icon-sm"
              icon-left="refresh"
              :loading="retryingRunId === row.run_id"
              :data-test="`workflow-run-retry-${row.run_id}`"
              @click.stop="askRetry(row)"
            >
              <OTooltip side="left" :content="t('workflow.history.retryTooltip')" />
            </OButton>
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
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import DateTime from "@/components/DateTime.vue";
import WorkflowExecutionTimeline from "@/components/alerts/AlertHistoryTimeline.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  workflowObj,
  loadRunsHistory,
  isTestRun,
  useTestRunVisibility,
  humanizeNodeIds,
  isRetryableRun,
  retryWorkflowRun,
} from "@/plugins/workflows/useWorkflowCanvas";

const props = defineProps<{
  orgId: string;
  workflowId: string;
  workflowName?: string;
  // The run currently loaded on the canvas — highlighted in the list.
  selectedRunId?: string;
}>();
const emit = defineEmits<{
  (e: "select-run", runId: string): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

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

// mirrors AlertHistory.getStatusVariant.
const getStatusVariant = (status: string) => {
  switch (status?.toLowerCase()) {
    case "success":
      return "success-outline";
    case "failed":
    case "error":
      return "error-outline";
    default:
      return "default-outline";
  }
};

// Shared with the editor's History dropdown so the two run-history surfaces cannot
// disagree about what a published workflow should show.
const { showTestRuns, testRunCount, visibleRuns } = useTestRunVisibility();

const rows = computed(() => visibleRuns(workflowObj.runsHistory.list));

// Highlight the run currently loaded on the canvas. `!` (important) so the tint
// wins over OTable's default/hover row background — keeping the list and canvas
// in sync without a scoped :deep() override.
const rowClass = (row: any) =>
  row.run_id && row.run_id === props.selectedRunId ? "bg-select-item-hover-bg!" : "";

// Feed the shared timeline: one bar per run, coloured by success/error.
const timelineHistory = computed(() =>
  workflowObj.runsHistory.list.map((r: any) => ({
    status: r.error ? "error" : "success",
    timestamp: r.start_time,
  })),
);

// The panel is a fixed 27.5rem column, so these sizes are a budget: anything over
// it silently pushes a column out of reach (the panel has no horizontal scroll).
// Scanning order — when it ran, how long, whether it passed, was it a rehearsal —
// comes first; Error is the diagnostic you open a row for, so it goes last and no
// longer flexes, and Ended is derivable from Started + Duration so it is dropped.
const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "start_time",
    header: t("workflow.history.started"),
    accessorKey: "start_time",
    sortable: true,
    size: 132,
    maxSize: 132,
    meta: { align: "left" },
  },
  {
    id: "duration",
    header: t("workflow.history.duration"),
    accessorFn: (row: any) => row.end_time - row.start_time,
    sortable: true,
    size: 72,
    maxSize: 72,
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("workflow.history.status"),
    accessorFn: (row: any) => (row.error ? "failed" : "success"),
    sortable: true,
    size: 80,
    maxSize: 80,
    meta: { align: "left" },
  },
  // Its own column: crowded into the status cell it was clipped to a stray "T".
  {
    id: "event_type",
    header: t("workflow.history.runType"),
    accessorFn: (row: any) => (isTestRun(row) ? "test" : "live"),
    sortable: true,
    size: 44,
    maxSize: 44,
    meta: { align: "center" },
  },
  {
    id: "actions",
    header: t("workflow.actions"),
    isAction: true,
    pinned: "right",
    size: 56,
    maxSize: 56,
    meta: { align: "center" },
  },
]);

const fetchHistory = async () => {
  if (!props.workflowId) return;
  const res = await loadRunsHistory({
    orgId: props.orgId,
    workflowId: props.workflowId,
    start: dateTimeValues.value.startTime,
    end: dateTimeValues.value.endTime,
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
