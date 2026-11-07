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
  <div
    class="@container/home h-full min-h-0 min-w-0 overflow-y-auto px-4 py-4"
    data-test="assistant-home-tab"
    :data-state="state"
  >
    <div
      :class="[
        'mx-auto grid max-w-[90rem] min-w-0 grid-cols-1 gap-x-6 gap-y-4',
        wide && '@[75rem]/home:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]',
      ]"
      :data-columns="wide ? 'auto' : 'one'"
    >
      <div class="flex min-w-0 flex-col gap-4" data-test="assistant-home-main">
        <AssistantLauncher
          layout="overview"
          :page-range="pageRange"
          :go-to-only="offReason !== null"
          @update:page-range="onPageRange"
        >
          <template #note>
            <AgentHomeAskNote v-if="offReason" :reason="offReason" :org="data.org.value" />
          </template>
        </AssistantLauncher>
        <AgentHomeBriefing
          :counts="counts"
          :pending="data.pending.value"
          :refreshes="refreshes"
          :can-brief="state === 'ai'"
          :page-range="pageRange"
        />
        <HomeNowList
          v-bind="listProps"
          :snapshot="nowSnapshot"
          :row-meta="rowMeta"
          :failed-sources="data.failedSources.value"
          :denied-sources="data.deniedSources.value"
          :clear-text="split.problems.length > 0 ? t('home.agent.nowClearProblems') : null"
          @select="selectRow"
          @open="openRow"
          @service="openService"
          @fallback="openRow"
          @view-all="openSource"
          @retry="() => data.load(true)"
          @analysis="openAnalysis"
        />
        <HomeNowList
          v-if="wide && split.problems.length > 0"
          v-bind="listProps"
          variant="problems"
          :snapshot="problemsSnapshot"
          :row-meta="rowMeta"
          :failed-sources="[]"
          :denied-sources="[]"
          :create-alert="{ enabled: canCreateAlert }"
          @select="selectRow"
          @open="openRow"
          @service="openService"
          @fallback="openRow"
          @create-alert="createAlert"
        />
        <AgentHomeDashboards v-if="wide" />
      </div>
      <aside v-if="wide" class="flex min-w-0 flex-col gap-4" data-test="assistant-home-aside">
        <AgentHomeSince
          :since="since"
          :items="sinceItems"
          :timezone="data.timezone.value"
          @open="openSinceItem"
        />
        <AssistantLauncher
          v-if="state === 'ai' || state === 'budget'"
          layout="chats"
          data-test="assistant-home-threads"
        />
      </aside>
    </div>
    <AlertHistoryDrawer
      v-if="historyAlert"
      :open="historyAlert !== null"
      :alert-details="historyAlert.details"
      :alert-id="historyAlert.id"
      :alert-type="historyAlert.type"
      data-test="assistant-home-alert-history"
      @update:open="(open: boolean) => !open && (historyAlert = null)"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";

import AssistantLauncher from "@/components/ai-assistant/welcome/AssistantLauncher.vue";
import {
  useAssistantHistory,
  useAssistantStore,
  type ComposerState,
  type Sid,
} from "@/composables/assistant";
import { fullThreadLocation } from "@/composables/assistant/pure";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import { useHomeContextProvider } from "@/composables/contextProviders/homeContextProvider";
import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import { withHomeReturn } from "@/composables/goto/homeReturn";
import useBreakpoint from "@/composables/useBreakpoint";
import { useI18nTyped } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";

import AgentHomeAskNote from "./AgentHomeAskNote.vue";
import AgentHomeBriefing from "./AgentHomeBriefing.vue";
import AgentHomeDashboards from "./AgentHomeDashboards.vue";
import AgentHomeSince from "./AgentHomeSince.vue";
import type { BuiltFromSource } from "./HomeBuiltFrom.vue";
import HomeNowList from "./HomeNowList.vue";
import type { NowRowMeta } from "./HomeNowRow.vue";
import { canCreateAlerts, serviceAlertPrefill } from "./homeAlertPrefill";
import { homeUserKey, readLastVisit, writeLastVisit } from "./homeStorage";
import { homeReturnState, readHomeUrl, writeHomeUrl, type HomeRange } from "./homeUrl";
import {
  briefingCounts,
  groupNowRows,
  incidentService,
  needsYou,
  splitNowRows,
} from "./nowGrouping";
import {
  sinceLastVisit,
  type SinceItem,
  type SinceThread,
  type SinceThreadEnd,
} from "./sinceLastVisit";
import { useAgentHomeState } from "./useAgentHomeState";
import { useHomeNowData } from "./useHomeNowData";
import { useHomeRefresh } from "./useHomeRefresh";

const AlertHistoryDrawer = defineAsyncComponent(
  () => import("@/components/alerts/AlertHistoryDrawer.vue"),
);

/** History rows the since-last-visit section scans for finished threads and waiting approvals. */
const THREAD_LOOKUP = 20;

/** The traces stream a service alert reads when the topology names none. */
const DEFAULT_TRACES_STREAM = "default";

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const store = useStore();
const { lgUp } = useBreakpoint();
const { state, offReason } = useAgentHomeState();

const urlState = readHomeUrl(route.query);
const data = useHomeNowData(urlState.range);
if (urlState.row) data.nowList.selectedKey.value = urlState.row;

// A phone shows the Ask box and Now only, so the services no alert matches stay in Now there.
const wide = computed(() => lgUp.value);
const refreshes = computed(() => data.range.value.type === "relative");
useHomeRefresh(
  () => refreshes.value,
  () => void data.load(),
);
onMounted(() => void data.load());

const pageRange = computed<NonNullable<ComposerState["timeOverride"]>>(() => {
  const range = data.range.value;
  const window = data.window.value;
  return {
    from: Math.floor(window.start / 1000),
    to: Math.ceil(window.end / 1000),
    ...(range.type === "relative" && { period: range.period }),
  };
});
const returnState = computed(() =>
  homeReturnState({ row: data.nowList.selectedKey.value, range: data.range.value }),
);
const listProps = computed(() => ({
  org: data.org.value,
  timezone: data.timezone.value,
  trend: data.trend.value,
  pending: data.pending.value,
  sources: data.sources.value,
  moreDegraded: data.nowList.state.value?.moreDegraded ?? 0,
  returnState: returnState.value,
  trendCapped: data.trendCapped.value,
  tracesLocked: data.tracesLocked.value,
}));

const incidentServices = computed(() => {
  const lists = data.incidents.value;
  const all = lists ? [...lists.open, ...lists.acknowledged, ...lists.resolved] : [];
  return new Map(all.map((incident) => [incident.id, incidentService(incident)]));
});
const grouped = computed(() =>
  groupNowRows(data.nowList.snapshot.value.rows, (id) => incidentServices.value.get(id) ?? null),
);
const split = computed(() =>
  wide.value ? splitNowRows(grouped.value) : { now: grouped.value.filter(needsYou), problems: [] },
);
const counts = computed(() => briefingCounts(split.value));
const rowMeta = computed<Record<string, NowRowMeta>>(() =>
  Object.fromEntries(
    grouped.value.map((item) => [
      item.row.key,
      { service: item.service, repeats: item.repeats, flapping: item.flapping },
    ]),
  ),
);
const nowSnapshot = computed<OverviewNowSnapshot>(() => ({
  ...data.nowList.snapshot.value,
  rows: split.value.now.map((item) => item.row),
}));
const problemsSnapshot = computed<OverviewNowSnapshot>(() => ({
  ...data.nowList.snapshot.value,
  rows: split.value.problems.map((item) => item.row),
}));
// The agent and its page chips see the rows Home draws, so a recovered row neither counts nor travels.
const drawnSnapshot = computed<OverviewNowSnapshot>(() => ({
  ...data.nowList.snapshot.value,
  rows: [...split.value.now, ...split.value.problems].map((item) => item.row),
}));
useHomeContextProvider(() => drawnSnapshot.value, store);
const canCreateAlert = computed(
  () => !data.alertsLocked.value && canCreateAlerts(store.state.currentuser?.role),
);

// The Open Source build has no assistant history to read.
const history = state.value === "oss" ? null : useAssistantHistory();
const assistantStore = history ? useAssistantStore() : null;
const recentRows = history?.recent(THREAD_LOOKUP) ?? null;
const threads = computed<SinceThread[]>(() =>
  (recentRows?.value ?? []).map((row) => ({
    sid: row.sid,
    title: String(row.title),
    updatedAt: row.updatedAt,
    activeTurn: row.activeTurn,
    pendingApproval: row.pendingApproval,
    ended: threadEnd(row.sid, row.lastTurnEnd),
  })),
);

const userKey = computed(() => {
  const email = store.state.userInfo?.email;
  return email && data.org.value ? homeUserKey(email, data.org.value) : null;
});
// The previous visit is read once per user and org; this visit is written when the tab is left.
const since = ref<number | null>(null);
watch(
  userKey,
  (key, previous) => {
    if (previous) writeLastVisit(previous, Date.now());
    since.value = key ? readLastVisit(key) : null;
  },
  { immediate: true },
);
const sinceItems = computed<SinceItem[]>(() =>
  sinceLastVisit({
    since: since.value,
    incidents: data.incidents.value,
    rows: data.nowList.snapshot.value.rows,
    threads: threads.value,
  }),
);

// A thread this tab loaded knows its newest end first; after a reload only the server's row does.
function threadEnd(sid: Sid, listed: SinceThreadEnd | undefined): SinceThreadEnd {
  const turn = assistantStore?.state.sessions[sid]?.turn.state;
  if (turn === "done" || turn === "stopped" || turn === "failed") return turn;
  return listed ?? null;
}

function leave(): void {
  if (userKey.value) writeLastVisit(userKey.value, Date.now());
}
window.addEventListener("pagehide", leave);
onDeactivated(leave);
onActivated(() => {
  if (userKey.value) since.value = readLastVisit(userKey.value);
});
onBeforeUnmount(() => {
  window.removeEventListener("pagehide", leave);
  leave();
});

const historyAlert = ref<{ details: unknown; id: string; type: string } | null>(null);

function onPageRange(range: NonNullable<ComposerState["timeOverride"]>): void {
  const next: HomeRange = range.period
    ? { type: "relative", period: range.period }
    : { type: "absolute", from: range.from * 1000, to: range.to * 1000 };
  data.setRange(next);
  writeUrl();
}

// The row and range ride in the URL, so a pasted link or Back to Home restores them.
function writeUrl(): void {
  writeHomeUrl(router, { row: data.nowList.selectedKey.value, range: data.range.value });
}

function selectRow(row: OverviewNowRow): void {
  data.nowList.selectedKey.value = row.key;
  writeUrl();
}

// A trip from a row carries the way back to this row and range.
function go(location: RouteLocationRaw): void {
  void router.push(withHomeReturn(location, returnState.value)).catch(() => undefined);
}

function openRow(row: OverviewNowRow): void {
  selectRow(row);
  if (row.kind === "incident") go(incidentLocation(row.id));
  else if (row.kind === "service") openService(row);
  else if (row.kind === "anomaly") {
    historyAlert.value = {
      details: { name: row.name },
      id: row.configId,
      type: "anomaly_detection",
    };
  } else {
    const item = data.alertList.value?.find((alert) => alert.alert_id === row.alertId);
    historyAlert.value = {
      details: item ?? { name: row.name },
      id: item?.alert_id ?? row.alertId,
      type: item?.alert_type ?? "scheduled",
    };
  }
}

function openService(row: OverviewNowRow): void {
  if (row.kind !== "service" || data.tracesLocked.value) return;
  let filter = sqlEquals("service_name", row.service);
  if (row.signal === "errors") filter += ` AND span_status = 'ERROR'`;
  go({
    name: "traces",
    query: {
      ...rangeQuery(),
      tab: "spans",
      query: b64EncodeUnicode(filter) ?? "",
      stream: streamOf(row.service),
      org_identifier: data.org.value,
    },
  });
}

// Investigate on an incident sent its question to the Panel; the incident's own analysis tab shows the run beside it.
function openAnalysis(row: OverviewNowRow): void {
  if (row.kind !== "incident") return;
  go(incidentLocation(row.id, { tab: "incidentAnalysis" }));
}

function openSource(source: BuiltFromSource): void {
  const org = data.org.value;
  if (source === "incidents")
    go({ name: "incidentList", query: { status: "open", org_identifier: org } });
  else if (source === "services")
    go({ name: "traces", query: { ...rangeQuery(), tab: "service-graph", org_identifier: org } });
  else if (source === "anomalies")
    go({ name: "alertList", query: { tab: "anomalyDetection", org_identifier: org } });
  else go({ name: "alertList", query: { org_identifier: org } });
}

function createAlert(row: OverviewNowRow): void {
  if (row.kind !== "service" || !canCreateAlert.value) return;
  const range = data.range.value;
  const window = data.window.value;
  const prefill = serviceAlertPrefill(row, streamOf(row.service), {
    type: range.type,
    ...(range.type === "relative" && { relativeTimePeriod: range.period }),
    startTime: window.start,
    endTime: window.end,
  });
  requestAlertCreation(prefill, {}, () => prefill);
}

function openSinceItem(item: SinceItem): void {
  if (item.kind === "incident_opened" || item.kind === "incident_resolved") {
    go(incidentLocation(item.target));
    return;
  }
  if (item.kind === "alert_fired") {
    const row = data.nowList.snapshot.value.rows.find((r) => r.key === `alert:${item.target}`);
    if (row) openRow(row);
    return;
  }
  void router.push(fullThreadLocation(item.target)).catch(() => undefined);
}

function incidentLocation(id: string, query: Record<string, string> = {}): RouteLocationRaw {
  return {
    name: "incidentDetail",
    params: { id },
    query: { ...query, org_identifier: data.org.value },
  };
}

function rangeQuery(): Record<string, string> {
  const range = data.range.value;
  if (range.type === "relative") return { period: range.period };
  return { from: String(range.from), to: String(range.to) };
}

function streamOf(service: string): string {
  const node = data.topology.value?.nodes.find((n) => (n.label ?? n.id) === service) as
    { stream_name?: string } | undefined;
  return node?.stream_name ?? DEFAULT_TRACES_STREAM;
}
</script>
