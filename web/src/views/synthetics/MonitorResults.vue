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
    :title="raw(monitorName)"
    data-test="synthetic-monitor-results-page"
    :back="{
      label: t('synthetics.tabs.checks'),
      to: backTo,
    }"
    bleed
  >
    <template #actions>
      <OSelect
        v-if="envNames.length >= 2"
        :model-value="envScope"
        :options="envScopeOptions"
        :aria-label="t('synthetics.results.environmentScope')"
        data-test="synthetic-monitor-results-env-scope"
        @update:model-value="onEnvScopeChange(String($event))"
      />
      <ODateTimeRange
        :key="checkIdentity"
        auto-apply
        menu-align="end"
        :default-type="timeState.valueType"
        :default-absolute-time="{
          startTime: timeState.startTime ?? 0,
          endTime: timeState.endTime ?? 0,
        }"
        :default-relative-time="timeState.relativeTimePeriod ?? ''"
        data-test="synthetic-monitor-results-date-time"
        class=""
        @on:date-change="onDateChange"
      />
      <OButton
        variant="secondary"
        icon="play-arrow"
        :loading="isTriggering"
        data-test="synthetic-monitor-results-trigger-run-btn"
        @click="triggerRun"
      >
        {{ t("synthetics.runs.triggerRun") }}
      </OButton>
      <OButton
        variant="secondary"
        icon="edit"
        data-test="synthetic-monitor-results-edit-btn"
        @click="editMonitor"
      >
        {{ t("synthetics.results.editCheck") }}
      </OButton>
      <ORefreshButton
        :last-run-at="lastRunAt"
        :loading="isRefreshing"
        data-test="synthetic-monitor-results-refresh-btn"
        @click="refresh"
      />
    </template>
    <div class="min-h-0 flex-1 overflow-hidden">
      <MonitorRuns
        :key="checkIdentity"
        ref="runsRef"
        :monitor-id="monitorId"
        :monitor-name="monitorName"
        :monitor-status="monitorStatus"
        :last-triggered-at="lastTriggeredAt"
        :check-type="checkType"
        :retries="retries"
        :environments="envNames"
        :environment-scope="envScope === ENV_SCOPE_ALL ? '' : envScope"
        @edit="editMonitor"
        @open-run="openRunDetail"
        @open-run-error="openRunError"
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
    size="xl"
    :title="raw(monitorName)"
    :subtitle="raw(drawerTimestamp)"
    data-test="synthetics-run-detail-drawer"
    @update:open="onDrawerClose"
  >
    <template #header-left>
      <OBadge
        v-if="drawerRunStatus"
        :tone="drawerRunStatus.variant"
        size="sm"
        :icon="drawerRunStatus.icon"
        class="ms-3"
      >
        {{ drawerRunStatus.label }}
      </OBadge>
      <OBadge
        v-if="drawerEnvironment"
        tone="neutral"
        size="sm"
        icon="layers"
        data-test="synthetics-run-drawer-env-badge"
      >
        {{ drawerEnvironment }}
      </OBadge>
      <!-- See RunDetail's URL badge: `truncate` must sit on the inner text, not
           on OBadge's inline-flex root, or the URL is cut with no ellipsis. -->
      <OBadge
        v-if="drawerUrl"
        tone="neutral"
        size="sm"
        icon="link"
        class="max-w-xs min-w-0"
        data-test="synthetics-run-drawer-url-badge"
      >
        <OTruncatedText class="block">{{ drawerUrl }}</OTruncatedText>
      </OBadge>
    </template>
    <RunDetail
      :key="checkIdentity"
      :drawer-mode="true"
      :override-monitor-id="monitorId"
      :override-monitor-name="monitorName"
      :override-run-id="selectedRunId"
      :override-execution-id="selectedExecutionId"
      :override-monitor-type="resolvedCheckType"
      :override-error="drawerErrorRecord"
      @update-status="onRunStatusUpdate"
    />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import { useLoadedAt } from "@/composables/useLoadedAt";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { ChipTone } from "@/lib/core/Badge/OBadge.types";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import MonitorRuns from "@/views/synthetics/MonitorRuns.vue";
import RunDetail from "@/views/synthetics/RunDetail.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import { syntheticsEditRoute, syntheticsListRoute } from "@/utils/synthetics/routes";

defineOptions({ name: "SyntheticMonitorResults" });

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();
const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier ?? "");

// Fresh check data from the API — avoids a duplicate fetch in MonitorRuns
// and distinguishes "never triggered" from "no runs in this window."
const lastTriggeredAt = ref(0);
const checkType = ref("browser");
/** The check's configured retry count. 0 means nothing can ever be observed as
 *  flaky, so the flakiness tiles have no answer to give rather than a zero. */
const retries = ref(0);
// True once fetchCheck() resolves — the drawer can auto-open from a run/exec
// query param before that happens, so RunDetail must not trust checkType's
// "browser" default until it's confirmed.
const checkTypeReady = ref(false);
// Empty until confirmed, so RunDetail falls back to resolving the type itself
// instead of trusting a possibly-stale default.
const resolvedCheckType = computed(() => (checkTypeReady.value ? checkType.value : ""));

const DEFAULT_RELATIVE = "15m";

const monitorId = computed(() => String(route.params.id ?? ""));
const checkName = ref("");
const monitorName = computed(
  () => checkName.value || String(route.query.name ?? "") || t("synthetics.results.title"),
);

// Sentinel, not "": an environment could legitimately be named "all".
const ENV_SCOPE_ALL = "__all__";
/** The check's environment NAMES, in the check's configured order. */
const envNames = ref<string[]>([]);
const envScope = ref(ENV_SCOPE_ALL);
const envScopeOptions = computed(() => [
  { label: t("synthetics.results.allEnvironments"), value: ENV_SCOPE_ALL },
  ...envNames.value.map((name) => ({ label: raw(name), value: name })),
]);

function onEnvScopeChange(value: string) {
  const shouldRefresh = checkTypeReady.value;
  envScope.value = value;
  const next = { ...route.query };
  if (value === ENV_SCOPE_ALL) delete next.env;
  else next.env = value;
  router.replace({ query: next }).catch(() => {});
  nextTick(() => {
    if (shouldRefresh) runsRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
  });
}
// `?folder=` carries the folder ID; the server gates RBAC on it.
const folderId = computed(() => String(route.query.folder ?? ""));
const checkIdentity = computed(() =>
  JSON.stringify([
    orgIdentifier.value,
    monitorId.value,
    folderId.value,
    store.state.userInfo?.email,
  ]),
);
const monitorStatus = computed<"healthy" | "degraded" | "critical">(
  () => (route.query.status as any) || "degraded",
);

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
const runsRef = ref<any>(null);
const isRefreshing = ref(false);
const lastRunAt = useLoadedAt(isRefreshing);

// ── Run Detail Drawer ────────────────────────────────────────────────────────
const drawerOpen = ref(false);
const selectedRunId = ref("");
const selectedExecutionId = ref("");
// Set for a run that never produced an execution record (quota skip, reaper
// row): it has no ids to fetch, so RunDetail renders the error from this.
const drawerErrorRecord = ref<{
  errorSource: string;
  message: string;
  timestamp: number;
  location: string;
  browser: string;
  device: string;
} | null>(null);
const drawerRunStatus = ref<{
  variant: ChipTone;
  icon: string;
  label: I18nText;
} | null>(null);
const drawerUrl = ref("");
const drawerTimestamp = ref("");
const drawerEnvironment = ref("");

function onRunStatusUpdate(status: {
  variant: ChipTone;
  icon: string;
  label: I18nText;
  url: string;
  timestamp: string;
  environment?: string;
}) {
  drawerRunStatus.value = status;
  drawerUrl.value = status.url;
  drawerTimestamp.value = status.timestamp;
  drawerEnvironment.value = status.environment ?? "";
}

function clearDrawerDetails() {
  drawerRunStatus.value = null;
  drawerUrl.value = "";
  drawerTimestamp.value = "";
  drawerErrorRecord.value = null;
  drawerEnvironment.value = "";
}

function onDrawerClose(open: boolean) {
  if (!open) {
    clearDrawerDetails();
    // Clear drawer query params
    const next = { ...route.query };
    delete next.run;
    delete next.exec;
    router.replace({ query: next }).catch(() => {});
  }
}

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range || !(range.startTime < range.endTime)) return false;
  timeRange.value = { startTime: range.startTime, endTime: range.endTime };
  timeState.value = {
    valueType: "relative",
    relativeTimePeriod: period,
    startTime: range.startTime,
    endTime: range.endTime,
  };
  return true;
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

  return typeof periodRaw === "string" && applyRelative(periodRaw);
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

async function onDateChange(value: {
  valueType?: string;
  relativeTimePeriod: string | null;
  startTime: number;
  endTime: number;
  userChangedValue?: boolean;
}) {
  if (value.userChangedValue === false) return;
  const shouldRefresh = checkTypeReady.value;
  if (value.valueType === "relative" && value.relativeTimePeriod) {
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
  if (shouldRefresh) runsRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
}

async function refresh() {
  if (isRefreshing.value || !checkTypeReady.value) return;
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
  const shouldRefresh = checkTypeReady.value;
  timeState.value = {
    valueType: "absolute",
    startTime,
    endTime,
    relativeTimePeriod: null,
  };
  timeRange.value = { startTime, endTime };
  writeToUrl();
  nextTick(() => {
    if (shouldRefresh) runsRef.value?.refresh?.(startTime, endTime);
  });
}

/** Ambient params this page was reached with, forwarded to every hop out of it. */
const navContext = computed(() => ({
  orgIdentifier: orgIdentifier.value,
  folderId: folderId.value,
}));

/** Returns to the list on the folder the user came from, not a reset to Default. */
const backTo = computed(() => syntheticsListRoute(navContext.value));

function editMonitor() {
  router.push(syntheticsEditRoute(navContext.value, monitorId.value));
}

/**
 * Run the check once, now.
 *
 * The trigger already existed but only inside MonitorRuns' two empty states, so
 * it became unreachable the moment a monitor recorded its first run — which is
 * exactly when someone wants to re-run it after a fix. The call itself stays in
 * MonitorRuns (it owns the org/folder/monitor ids and the refresh); this is the
 * header affordance for it.
 */
const isTriggering = computed<boolean>(() => !!runsRef.value?.runTriggerLoading);

function triggerRun() {
  runsRef.value?.triggerRun?.();
}

function openRunDetail(runId: string, executionId: string) {
  if (!runId || !executionId) return;
  drawerErrorRecord.value = null;
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

/** Open the drawer for a run that never executed (quota skip / reaper row):
 *  no ids to fetch, so RunDetail renders the error straight from the row. */
function openRunError(info: {
  errorSource: string;
  message: string;
  timestamp: number;
  location: string;
  browser: string;
  device: string;
}) {
  selectedRunId.value = "";
  selectedExecutionId.value = "";
  drawerRunStatus.value = null;
  drawerErrorRecord.value = info;
  drawerOpen.value = true;
}

let checkGeneration = 0;
const captureCheckRequest = () => ({
  generation: checkGeneration,
  org: orgIdentifier.value,
  id: monitorId.value,
  folder: folderId.value,
  subject: store.state.userInfo?.email,
});
const isCurrentCheckRequest = (request: ReturnType<typeof captureCheckRequest>) =>
  request.generation === checkGeneration &&
  request.org === orgIdentifier.value &&
  request.id === monitorId.value &&
  request.folder === folderId.value &&
  request.subject === store.state.userInfo?.email;
onBeforeUnmount(() => {
  checkGeneration++;
});
watch(
  checkIdentity,
  () => {
    checkGeneration++;
    checkName.value = "";
    checkTypeReady.value = false;
    lastTriggeredAt.value = 0;
    retries.value = 0;
    envNames.value = [];
    clearDrawerDetails();
    if (!readFromUrl()) applyRelative(DEFAULT_RELATIVE);

    const { env, run, exec } = route.query;
    envScope.value = typeof env === "string" && env ? env : ENV_SCOPE_ALL;
    if (typeof run === "string" && run && typeof exec === "string" && exec) {
      selectedRunId.value = run;
      selectedExecutionId.value = exec;
      drawerOpen.value = true;
    } else {
      selectedRunId.value = "";
      selectedExecutionId.value = "";
      drawerOpen.value = false;
    }
    writeToUrl();
    void fetchCheck();
  },
  { immediate: true },
);

async function fetchCheck() {
  const request = captureCheckRequest();
  try {
    // Folder-scoped RBAC grants resolve through `?folder=`, so it must be sent
    // here too — RunDetail already did, and the two pages disagreed.
    const res = await syntheticsService.get(request.org, request.id, request.folder);
    if (!isCurrentCheckRequest(request)) return;
    if (res?.data) {
      lastTriggeredAt.value = Number(res.data.last_triggered_at) || 0;
      checkType.value = res.data.type ?? "browser";
      checkName.value = String(res.data.name ?? "");
      // The flaky tiles are only answerable when the check is allowed to retry.
      retries.value = Number(res.data.retries ?? res.data.settings?.retries ?? 0) || 0;
      await resolveEnvironmentNames((res.data.environments ?? []) as string[], request);
    }
  } catch (err: any) {
    if (!isCurrentCheckRequest(request)) return;
    if (err?.response?.status === 404) {
      router.push(syntheticsListRoute(navContext.value));
      toast({ variant: "warning", message: t("synthetics.newCheck.notFoundInOrg") });
      return;
    }
  }
  if (!isCurrentCheckRequest(request)) return;
  // Every other runs refresh waits for this flag, so a failed check read must still load the runs.
  checkTypeReady.value = true;
  await nextTick();
  if (!isCurrentCheckRequest(request)) return;
  await runsRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
}

/** Check env ids → the names rows are stamped with; deleted ids drop out. */
async function resolveEnvironmentNames(
  envIds: string[],
  request: ReturnType<typeof captureCheckRequest>,
) {
  envNames.value = [];
  if (envIds.length) {
    try {
      const res = await syntheticsService.listEnvironments(request.org);
      if (!isCurrentCheckRequest(request)) return;
      const byId = new Map(
        ((res?.data ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]),
      );
      envNames.value = envIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
    } catch {
      if (!isCurrentCheckRequest(request)) return;
      // No scope control is a degraded render, not an error state.
      envNames.value = [];
    }
  }
  dropStaleEnvScope();
}

/** A `?env=` the hidden or shorter picker cannot show would empty the page with no way back. */
function dropStaleEnvScope(): boolean {
  if (envScope.value === ENV_SCOPE_ALL) return false;
  if (envNames.value.length >= 2 && envNames.value.includes(envScope.value)) return false;
  onEnvScopeChange(ENV_SCOPE_ALL);
  return true;
}
</script>
