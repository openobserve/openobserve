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
  <div class="flex flex-col h-full min-h-0" data-test="workflow-runs-panel">
    <!-- Compact header: title + datetime range picker + refresh -->
    <div
      class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border-default shrink-0"
    >
      <div class="min-w-0">
        <div class="text-sm font-semibold text-text-body leading-tight">
          {{ t("workflow.history.title") }}
        </div>
        <div v-if="workflowName" class="text-xs text-text-secondary truncate leading-tight">
          {{ workflowName }}
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
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

    <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
      <!-- Run-frequency timeline (reused from AlertHistory for consistency). -->
      <WorkflowExecutionTimeline
        v-if="rows.length > 0"
        :history="timelineHistory"
        :firing-label="t('workflow.history.failed')"
        :ok-label="t('workflow.history.success')"
        class="shrink-0"
      />

      <div class="alert-history-table flex-1 min-h-0">
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
          class="w-full h-full"
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
              empty-label="—"
            />
          </template>

          <template #cell-end_time="{ value }">
            <OTimeCell
              :value="value"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
              empty-label="—"
            />
          </template>

          <template #cell-duration="{ row }">
            {{ formatDuration(row.end_time - row.start_time) }}
          </template>

          <template #cell-status="{ row }">
            <OBadge :variant="getStatusVariant(row.error ? 'failed' : 'success')" size="sm">
              {{ row.error ? t("workflow.history.failed") : t("workflow.history.success") }}
            </OBadge>
          </template>

          <template #cell-error="{ value }">
            <span :title="value || ''">{{ value || "—" }}</span>
          </template>
        </OTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
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
import { toast } from "@/lib/feedback/Toast/useToast";
import workflowService from "@/services/workflows";

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

const { t } = useI18n();
const store = useStore();

const loading = ref(false);
// Distinguishes "the fetch failed" from "there are no runs" — the table's empty
// slot renders a retryable error state for the former.
const loadError = ref(false);
const runs = ref<any[]>([]);

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

const rows = computed(() => runs.value);

// Highlight the run currently loaded on the canvas. `!` (important) so the tint
// wins over OTable's default/hover row background — keeping the list and canvas
// in sync without a scoped :deep() override.
const rowClass = (row: any) =>
  row.run_id && row.run_id === props.selectedRunId ? "bg-select-item-hover-bg!" : "";

// Feed the shared timeline: one bar per run, coloured by success/error.
const timelineHistory = computed(() =>
  runs.value.map((r: any) => ({
    status: r.error ? "error" : "success",
    timestamp: r.start_time,
  })),
);

// Column order surfaces the run outcome first: Status, then the Error message,
// then Duration, then the Started / Ended timestamps.
const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "status",
    header: t("workflow.history.status"),
    accessorFn: (row: any) => (row.error ? "failed" : "success"),
    sortable: true,
    size: 100,
    maxSize: 100,
    meta: { align: "left" },
  },
  {
    id: "error",
    header: t("workflow.history.error"),
    accessorKey: "error",
    size: 280,
    minSize: 220,
    resizable: true,
    meta: { align: "left", flex: true },
  },
  {
    id: "duration",
    header: t("workflow.history.duration"),
    accessorFn: (row: any) => row.end_time - row.start_time,
    sortable: true,
    size: 96,
    maxSize: 96,
    meta: { align: "left" },
  },
  {
    id: "start_time",
    header: t("workflow.history.started"),
    accessorKey: "start_time",
    sortable: true,
    size: 165,
    maxSize: 165,
    meta: { align: "left" },
  },
  {
    id: "end_time",
    header: t("workflow.history.ended"),
    accessorKey: "end_time",
    sortable: true,
    size: 165,
    maxSize: 165,
    meta: { align: "left" },
  },
]);

const fetchHistory = async () => {
  if (!props.workflowId) return;
  loading.value = true;
  try {
    const res = await workflowService.getWorkflowHistory({
      org_identifier: props.orgId,
      id: props.workflowId,
      start_time: dateTimeValues.value.startTime,
      end_time: dateTimeValues.value.endTime,
    });
    runs.value = Array.isArray(res.data) ? res.data : [];
    loadError.value = false;
  } catch (e: any) {
    // 403 is "no permission", not a failure to load — keep the plain empty
    // state for it rather than offering a retry that cannot succeed.
    loadError.value = e?.response?.status !== 403;
    if (loadError.value) {
      toast({ variant: "error", message: t("workflow.history.loadError") });
    }
    runs.value = [];
  } finally {
    loading.value = false;
  }
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

// Fetch on mount and whenever the workflow changes.
watch(
  () => props.workflowId,
  (id) => {
    if (id) fetchHistory();
  },
  { immediate: true },
);

defineExpose({ fetchHistory });
</script>
