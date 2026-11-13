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
      class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4"
      data-test="assistant-home-tab"
      :data-state="state"
    >
      <!-- A fixed top offset, not centring, so rows arriving below never move the Ask box -->
      <div
        class="relative mx-auto flex min-h-0 w-full max-w-5xl min-w-0 flex-1 flex-col gap-4 pt-[12vh] max-md:pt-0"
        data-test="assistant-home-main"
      >
        <AgentHomeGreeting :class="entering && RISE.greeting" />
        <AgentHomeAskNote
          v-if="offReason"
          :reason="offReason"
          :org="data.org.value"
          class="mx-auto max-w-3xl"
        />
        <AssistantLauncher
          v-else
          ref="launcher"
          layout="overview"
          :page-range="pageRange"
          class="mx-auto max-w-3xl"
        />
        <HomeNeedsAttention
          class="mt-4"
          :snapshot="attentionSnapshot"
          :row-meta="rowMeta"
          :empty="attentionEmpty"
          :loading="!data.nowList.state.value"
          :timezone="data.timezone.value"
          :assistant="!offReason"
          :added-keys="addedKeys"
          @open="openRow"
          @investigate="investigate"
          @add-to-chat="toggleChat"
          @view-all="openOverview"
          @retry="() => void data.load(true)"
          @send-data="go({ name: 'ingestion', query: { org_identifier: data.org.value } })"
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
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  ref,
} from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";

import AssistantLauncher from "@/components/ai-assistant/welcome/AssistantLauncher.vue";
import {
  contextChipFor,
  openAssistant,
  useAssistantRuns,
  useAssistantStore,
  type ComposerState,
} from "@/composables/assistant";
import { HOME_TAB_QUERY_KEY } from "@/composables/assistant/pure";
import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import { armHomeReturn, withHomeReturn } from "@/composables/goto/homeReturn";
import useBreakpoint from "@/composables/useBreakpoint";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";

import AgentHomeAskNote from "./AgentHomeAskNote.vue";
import AgentHomeGreeting from "./AgentHomeGreeting.vue";
import HomeNeedsAttention, { type EmptyState } from "./HomeNeedsAttention.vue";
import type { NowRowMeta } from "./HomeNowRow.vue";
import { healthState } from "./homeHealth";
import { attentionChip, attentionChipId, investigateRow } from "./homeInvestigate";
import { HOME_RAIL_CLASS } from "./homeState";
import { homeReturnState, readHomeUrl, writeHomeUrl } from "./homeUrl";
import { groupNowRows, incidentService, needsYou } from "./nowGrouping";
import { useAgentHomeState } from "./useAgentHomeState";
import { incidentOpenedAt } from "./useHomeNow";
import { useHomeNowData } from "./useHomeNowData";
import { useHomeRefresh } from "./useHomeRefresh";

const HomeChatsRail = defineAsyncComponent(() => import("./HomeChatsRail.vue"));
const AlertHistoryDrawer = defineAsyncComponent(
  () => import("@/components/alerts/AlertHistoryDrawer.vue"),
);

/** The traces stream a service alert reads when the topology names none. */
const DEFAULT_TRACES_STREAM = "default";

/** Needs Attention shows this many rows; View All opens the Overview with the rest. */
const ATTENTION_ROWS = 20;

// A 0.5s fade-up, none under reduced motion; a literal string so Tailwind emits it.
const RISE = {
  greeting: "motion-safe:animate-[assistant-fade-up_0.5s_ease-out_both]",
} as const;

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const { lgUp } = useBreakpoint();
const { state, offReason } = useAgentHomeState();

const urlState = readHomeUrl(route.query);
const data = useHomeNowData(urlState.range);
if (urlState.row) data.nowList.selectedKey.value = urlState.row;

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
  focusAsk();
});
// A kept-alive return to Home is an arrival too; the first activation follows the mount, which already asked.
let activatedOnce = false;
onActivated(() => {
  if (activatedOnce) focusAsk();
  activatedOnce = true;
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

const incidentsById = computed(() => {
  const lists = data.incidents.value;
  const all = lists ? [...lists.open, ...lists.acknowledged] : [];
  return new Map(all.map((incident) => [incident.id, incident]));
});
const grouped = computed(() =>
  groupNowRows(data.nowList.snapshot.value.rows, (id) => {
    const incident = incidentsById.value.get(id);
    return incident ? incidentService(incident) : null;
  }),
);
const rowMeta = computed<Record<string, NowRowMeta>>(() =>
  Object.fromEntries(
    grouped.value.map((item) => {
      const incident = item.row.kind === "incident" && incidentsById.value.get(item.row.id);
      return [
        item.row.key,
        {
          service: item.service,
          repeats: item.repeats,
          flapping: item.flapping,
          ...(incident && { openedAt: incidentOpenedAt(incident) }),
        },
      ];
    }),
  ),
);
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

// The entrance plays once per mount; a kept-alive return re-inserts the nodes, which would replay it.
const entering = ref(true);
onDeactivated(() => (entering.value = false));

const launcher = ref<InstanceType<typeof AssistantLauncher> | null>(null);

function focusAsk(): void {
  void nextTick(() => launcher.value?.focusAsk?.());
}

// A row's Add to Chat is a toggle on its chip in the Ask box, which clears its chips once it sends.
const addedKeys = computed(() =>
  attentionSnapshot.value.rows
    .filter((row) => launcher.value?.hasContext?.(attentionChipId(row)))
    .map((row) => row.key),
);

function toggleChat(row: OverviewNowRow): void {
  const id = attentionChipId(row);
  if (launcher.value?.hasContext?.(id)) launcher.value.removeContext(id);
  else launcher.value?.addContext?.(attentionChip(row, attentionSnapshot.value, data.org.value, t));
}

// Home's Ask box takes the door, so a sent row opens its chat full page; a refusal says why in a toast.
async function investigate(row: OverviewNowRow): Promise<void> {
  selectRow(row);
  // Read on the click, so Open Source and an agent-off Home never touch the assistant runtime.
  const runs = useAssistantRuns();
  const outcome = await investigateRow(row, {
    open: openAssistant,
    runs: { active: runs.active.value, cap: runs.cap.value },
    creditsExhausted: state.value === "budget",
    snapshot: attentionSnapshot.value,
    t,
    incidentChip: (incident) => {
      const chip = contextChipFor(
        "incident_id",
        incident.id,
        { currentPage: "home", org_id: data.org.value, incident_title: incident.title },
        t,
      );
      return chip ? { ...chip, provenance: "door" } : null;
    },
    arm: armHomeReturn,
    returnState: { ...returnState.value, row: row.key },
    userOrgKey: useAssistantStore().state.userOrgKey ?? undefined,
  });
  if (outcome.kind === "fallback") openRow(row);
  else if (outcome.kind === "not_sent")
    toast({
      variant: "warning",
      message: outcome.note,
      ...(outcome.showRuns && {
        action: {
          label: t("assistant.error.run_limit_member.action"),
          handler: () => void runs.requestOpen(),
        },
      }),
    });
}

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
    go({
      name: "incidentDetail",
      params: { id: row.id },
      query: { org_identifier: data.org.value },
    });
  else if (row.kind === "service") openService(row);
  else if (row.kind === "anomaly")
    historyAlert.value = {
      details: { name: row.name },
      id: row.configId,
      type: "anomaly_detection",
    };
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
