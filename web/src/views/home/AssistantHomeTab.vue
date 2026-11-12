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
  <div class="relative isolate flex h-full min-h-0 min-w-0">
    <aside
      v-if="railShown"
      :aria-label="t('assistant.history.title')"
      :class="HOME_RAIL_CLASS"
      data-test="assistant-home-chats"
    >
      <HomeChatsRail v-if="railReady" />
    </aside>
    <div
      class="h-full min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4"
      data-test="assistant-home-tab"
      :data-state="state"
    >
      <!-- A fixed top offset, not centring, so Problems or Go to results arriving below never move the Ask box -->
      <div
        class="relative mx-auto flex max-w-5xl min-w-0 flex-col gap-4 pt-[12vh] max-md:pt-0"
        data-test="assistant-home-main"
      >
        <AgentHomeGreeting :answers-ready="answersReady" :class="entering && RISE.greeting" />
        <AssistantLauncher
          layout="overview"
          :page-range="pageRange"
          :go-to-only="offReason !== null"
          class="mx-auto max-w-3xl"
        >
          <template #note>
            <AgentHomeAskNote v-if="offReason" :reason="offReason" :org="data.org.value" />
          </template>
        </AssistantLauncher>
        <HomeNeedsAttention
          class="mt-4"
          :snapshot="attentionSnapshot"
          :row-meta="rowMeta"
          :empty="attentionEmpty"
          :loading="!data.nowList.state.value"
          @open="openRow"
          @view-all="openOverview"
          @retry="() => void data.load(true)"
          @send-data="go({ name: 'ingestion', query: { org_identifier: data.org.value } })"
        />
        <HomeNowList
          v-if="wide && split.problems.length > 0"
          :org="data.org.value"
          :timezone="data.timezone.value"
          :trend="data.trend.value"
          :return-state="returnState"
          :traces-locked="data.tracesLocked.value"
          :snapshot="problemsSnapshot"
          :row-meta="rowMeta"
          :create-alert="{ enabled: canCreateAlert }"
          @select="selectRow"
          @open="openRow"
          @service="openService"
          @fallback="openRow"
          @create-alert="createAlert"
        />
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
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onDeactivated, onMounted, ref } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";

import AssistantLauncher from "@/components/ai-assistant/welcome/AssistantLauncher.vue";
import { useAssistantRuns, type ComposerState } from "@/composables/assistant";
import { HOME_TAB_QUERY_KEY } from "@/composables/assistant/pure";
import type { PrefillTimeRange } from "@/utils/alerts/alertPrefill";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import { withHomeReturn } from "@/composables/goto/homeReturn";
import useBreakpoint from "@/composables/useBreakpoint";
import { useI18nTyped } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";

import AgentHomeAskNote from "./AgentHomeAskNote.vue";
import AgentHomeGreeting from "./AgentHomeGreeting.vue";
import HomeNeedsAttention, { type EmptyState } from "./HomeNeedsAttention.vue";
import HomeNowList from "./HomeNowList.vue";
import type { NowRowMeta } from "./HomeNowRow.vue";
import { canCreateAlerts, serviceAlertPrefill } from "./homeAlertPrefill";
import { healthState } from "./homeHealth";
import { HOME_RAIL_CLASS } from "./homeState";
import {
  homeReturnState,
  readHomeUrl,
  writeHomeUrl,
} from "./homeUrl";
import { groupNowRows, incidentService, needsYou, splitNowRows } from "./nowGrouping";
import { useAgentHomeState } from "./useAgentHomeState";
import { useHomeNowData } from "./useHomeNowData";
import { useHomeRefresh } from "./useHomeRefresh";

const HomeChatsRail = defineAsyncComponent(() => import("./HomeChatsRail.vue"));
const AlertHistoryDrawer = defineAsyncComponent(
  () => import("@/components/alerts/AlertHistoryDrawer.vue"),
);

/** The traces stream a service alert reads when the topology names none. */
const DEFAULT_TRACES_STREAM = "default";

/** Needs Attention shows this many rows; View All opens the Overview with the rest. */
const ATTENTION_ROWS = 3;

// A 0.5s fade-up, none under reduced motion; a literal string so Tailwind emits it.
const RISE = {
  greeting: "motion-safe:animate-[assistant-fade-up_0.5s_ease-out_both]",
} as const;

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const store = useStore();
const { lgUp } = useBreakpoint();
const { state, offReason } = useAgentHomeState();

const urlState = readHomeUrl(route.query);
const data = useHomeNowData(urlState.range);
if (urlState.row) data.nowList.selectedKey.value = urlState.row;

// A phone draws no Problems list, so there the agent reads the services no alert matches among the other rows.
const wide = computed(() => lgUp.value);
const refreshes = computed(() => data.range.value.type === "relative");
useHomeRefresh(
  () => refreshes.value,
  () => void data.load(),
);
// Past chats stay readable with the credits used up; no agent, Open Source or a loading gate draws no rail.
const railShown = computed(() => wide.value && (state.value === "ai" || state.value === "budget"));
// The rail's list reads the chats as it mounts, so it mounts only after Home's own read went out.
const railReady = ref(false);
onMounted(() => {
  void data.load();
  railReady.value = true;
});

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

const incidentServices = computed(() => {
  const lists = data.incidents.value;
  const all = lists ? [...lists.open, ...lists.acknowledged] : [];
  return new Map(all.map((incident) => [incident.id, incidentService(incident)]));
});
const grouped = computed(() =>
  groupNowRows(data.nowList.snapshot.value.rows, (id) => incidentServices.value.get(id) ?? null),
);
const split = computed(() =>
  wide.value ? splitNowRows(grouped.value) : { now: grouped.value.filter(needsYou), problems: [] },
);
const rowMeta = computed<Record<string, NowRowMeta>>(() =>
  Object.fromEntries(
    grouped.value.map((item) => [
      item.row.key,
      { service: item.service, repeats: item.repeats, flapping: item.flapping },
    ]),
  ),
);
const problemsSnapshot = computed<OverviewNowSnapshot>(() => ({
  ...data.nowList.snapshot.value,
  rows: split.value.problems.map((item) => item.row),
}));
// The most urgent rows that need attention, every kind; a failed source only drops its own rows, the strip says why.
const attentionSnapshot = computed<OverviewNowSnapshot>(() => ({
  ...data.nowList.snapshot.value,
  rows: grouped.value
    .filter(needsYou)
    .slice(0, ATTENTION_ROWS)
    .map((item) => item.row),
}));
// Only a loaded, watched, quiet org reads "clear"; an unwatched one is "no-data", never green.
const attentionEmpty = computed<EmptyState | null>(() => {
  const state = data.nowList.state.value
    ? healthState({
        incidents: data.incidents.value,
        trend: data.trend.value,
        topology: data.topology.value,
        rows: data.nowList.snapshot.value.rows,
        alertList: data.alertList.value,
        failed: data.failedSources.value.length > 0,
        denied: data.deniedSources.value.length > 0,
      })
    : null;
  if (state === "failed") return "failed";
  if (state === "allClear") return "clear";
  return state === "nothingMonitored" ? "no-data" : null;
});
const canCreateAlert = computed(
  () => !data.alertsLocked.value && canCreateAlerts(store.state.currentuser?.role),
);

// The Open Source build has no assistant runtime to read.
const assistantRuns = state.value === "oss" ? null : useAssistantRuns();
const answersReady = computed(
  () =>
    assistantRuns?.rows.value.filter((row) => row.group === "ready" && !row.otherOrg).length ?? 0,
);

// The entrance plays once per mount; a kept-alive return re-inserts the nodes, which would replay it.
const entering = ref(true);
onDeactivated(() => (entering.value = false));

const historyAlert = ref<{ details: unknown; id: string; type: string } | null>(null);

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

// An incident opens its page, a service its traces, and an alert or anomaly its history beside Home.
function openRow(row: OverviewNowRow): void {
  selectRow(row);
  if (row.kind === "incident")
    go({ name: "incidentDetail", params: { id: row.id }, query: { org_identifier: data.org.value } });
  else if (row.kind === "service") openService(row);
  else if (row.kind === "anomaly")
    historyAlert.value = { details: { name: row.name }, id: row.configId, type: "anomaly_detection" };
  else {
    const item = data.alertList.value?.find((alert) => alert.alert_id === row.alertId);
    historyAlert.value = {
      details: item ?? { name: row.name },
      id: item?.alert_id ?? row.alertId,
      type: item?.alert_type ?? "scheduled",
    };
  }
}

// View All is the Overview tab, named in the URL as any Home link names a tab.
function openOverview(): void {
  void router
    .push({ query: { ...route.query, [HOME_TAB_QUERY_KEY]: "overview" } })
    .catch(() => undefined);
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

function createAlert(row: OverviewNowRow): void {
  if (row.kind !== "service" || !canCreateAlert.value) return;
  const prefill = serviceAlertPrefill(row, streamOf(row.service), datetimeOfRange());
  requestAlertCreation(prefill, {}, () => prefill);
}

function datetimeOfRange(): PrefillTimeRange {
  const range = data.range.value;
  const window = data.window.value;
  return {
    type: range.type,
    ...(range.type === "relative" && { relativeTimePeriod: range.period }),
    startTime: window.start,
    endTime: window.end,
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
