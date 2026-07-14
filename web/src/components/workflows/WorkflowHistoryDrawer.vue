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
  Workflow run history (Executions) drawer. Mirrors AlertHistory for consistency:
  a datetime range picker + refresh in the header, and an OTable of runs
  (OTimeCell for times, OBadge status, formatDuration). Data comes from
  GET /workflows/{id}/history; a failed run can be re-run via POST .../retry.
-->
<template>
  <ODrawer
    :open="open"
    :width="width ?? 65"
    :seamless="seamless"
    :persistent="seamless"
    :portal-target="portalTarget"
    :title="t('workflow.history.title')"
    :sub-title="workflowName"
    data-test="workflow-history-drawer"
    @update:open="(v) => !v && emit('close')"
  >
    <!-- Header controls: datetime range picker + refresh (defaults to the last
         24h). Placed in the drawer header, mirroring AlertHistory. -->
    <template #header-right>
      <DateTime
        ref="dateTimeRef"
        auto-apply
        :default-type="dateTimeType"
        :default-absolute-time="{
          startTime: absoluteTime.startTime,
          endTime: absoluteTime.endTime,
        }"
        :default-relative-time="relativeTime"
        data-test="workflow-history-date-picker"
        @on:date-change="updateDateTime"
      />
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        data-test="workflow-history-refresh"
        @click="fetchHistory"
      >
        <OTooltip side="bottom" :content="t('common.refresh')" />
      </OButton>
    </template>

    <div class="tw:h-full tw:flex tw:flex-col tw:min-h-0 tw:gap-2">
      <!-- Run-frequency timeline (reused from AlertHistory for consistency). -->
      <WorkflowExecutionTimeline
        v-if="rows.length > 0"
        :history="timelineHistory"
        :firing-label="t('workflow.history.failed')"
        :ok-label="t('workflow.history.success')"
        class="tw:shrink-0"
      />

      <div class="alert-history-table tw:flex-1 tw:min-h-0">
        <OTable
          data-test="workflow-history-table"
          :data="rows"
          :columns="columns"
          row-key="run_id"
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
          class="tw:w-full tw:h-full"
          @row-click="openRun"
        >
          <template #empty>
            <div class="tw:py-10"><NoData /></div>
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
  </ODrawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import DateTime from "@/components/DateTime.vue";
import WorkflowExecutionTimeline from "@/components/alerts/AlertHistoryTimeline.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import workflowService from "@/services/workflows";

const props = defineProps<{
  open: boolean;
  orgId: string;
  workflowId: string;
  workflowName?: string;
  // Side-by-side mode (open alongside the canvas): transparent, non-dismissing
  // backdrop, scoped to a container, at a reduced width.
  seamless?: boolean;
  width?: number;
  portalTarget?: string;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-run", runId: string): void;
}>();

const { t } = useI18n();
const store = useStore();

const loading = ref(false);
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

// mirrors AlertHistory.formatDuration (microseconds -> h/m/s).
const formatDuration = (microseconds: number) => {
  if (!microseconds || microseconds <= 0) return "0s";
  const seconds = Math.floor(microseconds / 1_000_000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
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

// Feed the shared timeline: one bar per run, coloured by success/error. The
// timeline reads status ("error" -> firing/red, "success" -> ok/green) and a
// timestamp (start_time, in microseconds).
const timelineHistory = computed(() =>
  runs.value.map((r: any) => ({
    status: r.error ? "error" : "success",
    timestamp: r.start_time,
  })),
);

const columns = computed<OTableColumnDef[]>(() => [
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
    resizable: true,
    meta: { align: "left", flex: true },
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
  } catch (e: any) {
    if (e?.response?.status !== 403) {
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

// Open this run in the workflow editor so the user can inspect its per-node
// input/output (loaded there by run_id). Parent owns the navigation since it
// holds the full workflow needed to hydrate the editor.
const openRun = (row: any) => {
  if (!row?.run_id) return;
  emit("open-run", row.run_id);
};

// Fetch each time the drawer opens.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) fetchHistory();
  },
  { immediate: true },
);
</script>
