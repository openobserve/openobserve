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
  MonitorResults — Page shell for the Monitor Runs multi-tab page.

  Follows the LLMInsightsPage.vue pattern:
    ROW 1: OPageHeader (breadcrumb + title + badge + actions)
    ROW 2: MonitorRuns (chrome-less tabbed content)
-->
<template>
  <OPageLayout
    data-test="synthetic-monitor-results-page"
    :title="monitorName"
    :subtitle="folderName"
    :back="{
      label: t('synthetics.results.monitors'),
      to: { name: 'synthetics' },
    }"
    bleed
  >
    <template #title-trail>
      <!-- <OBadge v-if="statusBadge" :variant="statusBadge.variant" size="sm" dot>
          {{ statusBadge.label }}
        </OBadge> -->
    </template>
    <template #actions>
      <DateTime
        ref="dateTimeRef"
        auto-apply
        menu-align="end"
        :default-type="timeState.valueType"
        :default-absolute-time="{
          startTime: timeState.startTime ?? 0,
          endTime: timeState.endTime ?? 0,
        }"
        :default-relative-time="timeState.relativeTimePeriod ?? ''"
        data-test="synthetic-monitor-results-date-time"
        class="h-8.5!"
        @on:date-change="onDateChange"
      />
      <OButton
        variant="outline"
        size="sm"
        icon-left="edit"
        data-test="synthetic-monitor-results-edit-btn"
        @click="editMonitor"
      >
        {{ t("synthetics.results.editMonitor") }}
      </OButton>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="isRefreshing"
        data-test="synthetic-monitor-results-refresh-btn"
        @click="refresh"
      />
    </template>
    <div class="min-h-0 flex-1 overflow-hidden">
      <MonitorRuns
        ref="runsRef"
        :monitor-id="monitorId"
        :monitor-name="monitorName"
        :monitor-status="monitorStatus"
        :last-triggered-at="lastTriggeredAt"
        :check-type="checkType"
        @edit="editMonitor"
        @open-run="openRunDetail"
        @refresh="refresh"
        @jump-to-window="onJumpToWindow"
      />
    </div>
  </OPageLayout>

  <!-- ════════════ Run Detail Drawer ════════════ -->
  <ODrawer
    bleed
    v-model:open="drawerOpen"
    side="right"
    :width="90"
    :title="monitorName"
    :subTitle="drawerTimestamp"
    data-test="synthetics-run-detail-drawer"
    @update:open="onDrawerClose"
  >
    <template #header-left>
      <OBadge
        v-if="drawerRunStatus"
        :variant="drawerRunStatus.variant"
        size="sm"
        :icon="drawerRunStatus.icon"
        class="ml-3"
      >
        {{ drawerRunStatus.label }}
      </OBadge>
      <OBadge v-if="drawerUrl" variant="default" size="sm" icon="link" class="max-w-50 truncate">
        {{ drawerUrl }}
      </OBadge>
    </template>
    <RunDetail
      :drawer-mode="true"
      :override-monitor-id="monitorId"
      :override-monitor-name="monitorName"
      :override-run-id="selectedRunId"
      :override-execution-id="selectedExecutionId"
      @update-status="onRunStatusUpdate"
    />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import DateTime from "@/components/DateTime.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import MonitorRuns from "@/views/synthetics/MonitorRuns.vue";
import RunDetail from "@/views/synthetics/RunDetail.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";

defineOptions({ name: "SyntheticMonitorResults" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();
const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier ?? "");

// Fresh check data from the API — avoids a duplicate fetch in MonitorRuns
// and distinguishes "never triggered" from "no runs in this window."
const lastTriggeredAt = ref(0);
const checkType = ref("browser");

const DEFAULT_RELATIVE = "15m";

const monitorId = computed(() => String(route.params.id ?? ""));
const monitorName = computed(() => String(route.query.name ?? "") || t("synthetics.results.title"));
const folderName = computed(() => String(route.query.folder ?? ""));
const monitorStatus = computed<"healthy" | "degraded" | "critical">(
  () => (route.query.status as any) || "degraded",
);

const badgeVariantMap: Record<string, "warning" | "success" | "error"> = {
  healthy: "success",
  degraded: "warning",
  critical: "error",
};
const statusBadge = computed(() => {
  const s = monitorStatus.value;
  const labels: Record<string, string> = {
    healthy: t("synthetics.status.healthy"),
    degraded: t("synthetics.status.degraded"),
    critical: t("synthetics.status.critical"),
  };
  if (!labels[s]) return null;
  return { variant: badgeVariantMap[s], label: labels[s] };
});

// ── Date state + URL sync (same pattern as LLMInsightsPage) ────────────
type DateValueType = "relative" | "absolute";
const timeState = ref<{
  valueType: DateValueType;
  startTime: number | null;
  endTime: number | null;
  relativeTimePeriod: string | null;
}>({
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: DEFAULT_RELATIVE,
});

const timeRange = ref({ startTime: 0, endTime: 0 });
const dateTimeRef = ref<any>(null);
const runsRef = ref<any>(null);
const isRefreshing = ref(false);

// ── Run Detail Drawer ────────────────────────────────────────────────────────
const drawerOpen = ref(false);
const selectedRunId = ref("");
const selectedExecutionId = ref("");
const drawerRunStatus = ref<{
  variant: BadgeVariant;
  icon: string;
  label: string;
} | null>(null);
const drawerUrl = ref("");
const drawerTimestamp = ref("");

function onRunStatusUpdate(status: {
  variant: BadgeVariant;
  icon: string;
  label: string;
  url: string;
  timestamp: string;
}) {
  drawerRunStatus.value = status;
  drawerUrl.value = status.url;
  drawerTimestamp.value = status.timestamp;
}

function onDrawerClose(open: boolean) {
  if (!open) {
    drawerRunStatus.value = null;
    drawerUrl.value = "";
    drawerTimestamp.value = "";
    // Clear drawer query params
    const next = { ...route.query };
    delete next.run;
    delete next.exec;
    router.replace({ query: next }).catch(() => {});
  }
}

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  timeRange.value = { startTime: range.startTime, endTime: range.endTime };
  timeState.value = {
    valueType: "relative",
    relativeTimePeriod: period,
    startTime: range.startTime,
    endTime: range.endTime,
  };
}

function readFromUrl(): boolean {
  const fromRaw = route.query.from;
  const toRaw = route.query.to;
  const periodRaw = route.query.period;

  if (typeof fromRaw === "string" && typeof toRaw === "string") {
    const startTime = Number(fromRaw);
    const endTime = Number(toRaw);
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
      timeState.value = {
        valueType: "absolute",
        startTime,
        endTime,
        relativeTimePeriod: null,
      };
      timeRange.value = { startTime, endTime };
      return true;
    }
  }

  if (typeof periodRaw === "string" && periodRaw) {
    applyRelative(periodRaw);
    return true;
  }

  return false;
}

function writeToUrl() {
  const next: Record<string, any> = { ...route.query };
  if (timeState.value.valueType === "relative") {
    next.period = timeState.value.relativeTimePeriod ?? DEFAULT_RELATIVE;
    delete next.from;
    delete next.to;
  } else {
    next.from = String(timeState.value.startTime ?? 0);
    next.to = String(timeState.value.endTime ?? 0);
    delete next.period;
  }
  router.replace({ query: next }).catch(() => {});
}

async function onDateChange(value: any) {
  if (value?.valueType === "relative" && value.relativeTimePeriod) {
    applyRelative(value.relativeTimePeriod);
  } else {
    timeState.value = {
      valueType: "absolute",
      startTime: value.startTime,
      endTime: value.endTime,
      relativeTimePeriod: null,
    };
    timeRange.value = { startTime: value.startTime, endTime: value.endTime };
  }
  writeToUrl();
  await nextTick();
  runsRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
}

async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    if (timeState.value.valueType === "relative") {
      applyRelative(timeState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
      writeToUrl();
    }
    await nextTick();
    await runsRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
  } finally {
    isRefreshing.value = false;
  }
}

function onJumpToWindow(startTime: number, endTime: number) {
  timeState.value = {
    valueType: "absolute",
    startTime,
    endTime,
    relativeTimePeriod: null,
  };
  timeRange.value = { startTime, endTime };
  writeToUrl();
  nextTick(() => {
    runsRef.value?.refresh?.(startTime, endTime);
  });
}

function editMonitor() {
  router.push({ name: "synthetics-edit", params: { id: monitorId.value } });
}

function openRunDetail(runId: string, executionId: string) {
  if (!runId || !executionId) return;
  selectedRunId.value = runId;
  selectedExecutionId.value = executionId;
  drawerRunStatus.value = null;
  drawerOpen.value = true;
  // Track selected run in query params for shareability / refresh
  router
    .replace({
      query: { ...route.query, run: runId, exec: executionId },
    })
    .catch(() => {});
}

onMounted(() => {
  // Always default to last 15 minutes; respect explicit URL params
  if (!readFromUrl()) {
    applyRelative(DEFAULT_RELATIVE);
  }
  writeToUrl();
  fetchCheck();
  // Auto-open drawer if query params present
  const runQ = route.query.run;
  const execQ = route.query.exec;
  if (typeof runQ === "string" && typeof execQ === "string" && runQ && execQ) {
    selectedRunId.value = runQ;
    selectedExecutionId.value = execQ;
    drawerOpen.value = true;
  }
});

// Fetches the check once on mount — provides type and last_triggered_at to
// MonitorRuns via props, consolidating what was previously split across
// MonitorRuns.resolveMonitorType() (always on mount) and the on-demand
// need-check-data emit (when zero runs). One API call instead of two.
async function fetchCheck() {
  try {
    const res = await syntheticsService.get(orgIdentifier.value, monitorId.value);
    if (res?.data) {
      lastTriggeredAt.value = Number(res.data.last_triggered_at) || 0;
      checkType.value = res.data.type ?? "browser";
    }
  } catch (err: any) {
    if (err?.response?.status === 404) {
      router.push({ name: "synthetics" });
      toast({ variant: "warning", message: t("synthetics.newCheck.notFoundInOrg") });
      return;
    }
  }
}
</script>
