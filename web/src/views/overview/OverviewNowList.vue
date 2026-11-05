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
  <section
    :aria-labelledby="headingId"
    class="flex min-w-0 flex-col gap-2"
    data-test="overview-now"
  >
    <div class="flex min-h-8 min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 ps-1">
      <h2 :id="headingId" class="text-text-heading text-base font-semibold">
        {{ t("overview.now.title") }}
      </h2>
      <OText v-if="dataAsOf" variant="meta" data-test="overview-now-data-as-of">{{
        dataAsOf
      }}</OText>
      <OText v-if="servicesUntil" variant="meta" data-test="overview-now-services-until">{{
        servicesUntil
      }}</OText>
      <OText
        v-if="snapshot.services.allRegions"
        variant="meta"
        data-test="overview-now-all-regions"
        >{{ t("overview.now.allRegions") }}</OText
      >
    </div>
    <OverviewCreditsLine v-if="creditsExhausted" :org="org" />
    <div
      class="border-border-default rounded-surface bg-surface-panel overflow-hidden border border-[0.0625em]"
    >
      <ul v-if="pending" class="flex flex-col gap-3 p-3" data-test="overview-now-loading">
        <li v-for="n in 3" :key="n"><OSkeleton type="text" class="h-5 w-2/3" /></li>
      </ul>
      <ul v-else class="flex flex-col" data-test="overview-now-rows">
        <li
          v-if="trendCapped"
          class="border-b-border-default text-text-secondary border-b-[0.0625em] px-3 py-2 text-xs"
          data-test="overview-now-trend-cap"
        >
          {{ t("overview.now.trendWindowCap") }}
        </li>
        <li
          v-if="snapshot.services.partial"
          class="border-b-border-default flex flex-col gap-0.5 border-b-[0.0625em] px-3 py-2"
          data-test="overview-now-partial"
        >
          <OText variant="body" class="text-status-warning-text text-sm">{{
            t("overview.now.partial")
          }}</OText>
          <OText v-for="(warning, i) in warnings" :key="i" variant="meta">{{ warning }}</OText>
        </li>
        <li
          v-for="source in failedSources"
          :key="source.key"
          class="border-b-border-default flex items-center gap-2 border-b-[0.0625em] px-3 py-2"
          :data-test="`overview-now-source-error-${source.key}`"
        >
          <OText variant="body" class="min-w-0 flex-1 text-sm">{{
            t("overview.now.sourceError", { source: source.label })
          }}</OText>
          <OButton
            variant="outline"
            size="sm"
            icon-left="refresh"
            :data-test="`overview-now-source-error-${source.key}-retry`"
            @click="emit('retry')"
          >
            {{ t("emptyState.loadError.action") }}
          </OButton>
        </li>
        <li
          v-for="source in deniedSources"
          :key="source.key"
          class="border-b-border-default flex items-center gap-2 border-b-[0.0625em] px-3 py-2"
          :data-test="`overview-now-source-denied-${source.key}`"
        >
          <OText variant="body" class="min-w-0 flex-1 text-sm">{{ source.label }}</OText>
          <OText variant="meta">{{ t("overview.state.tileForbidden") }}</OText>
        </li>
        <OverviewNowRow
          v-for="row in snapshot.rows"
          :key="row.key"
          :row="row"
          :snapshot="snapshot"
          :timezone="timezone"
          :selected="row.key === snapshot.selectedKey"
          :busy="busyKeys.has(row.key)"
          :points="pointsOf(row)"
          :fallback-text="fallbackOf(row)"
          :note="notes[row.key] ?? null"
          :link-locked="row.kind === 'service' && tracesLocked"
          @investigate="onInvestigate"
          @open="(r) => emit('open', r)"
          @service="(r) => emit('service', r)"
          @show-runs="showRunningChats"
        />
        <li
          v-if="
            snapshot.rows.length === 0 && failedSources.length === 0 && deniedSources.length === 0
          "
          class="text-text-secondary px-3 py-3 text-sm"
          data-test="overview-now-clear"
        >
          {{ t("overview.status.clear") }}
        </li>
      </ul>
    </div>
    <OverviewBuiltFrom
      :sources="sources"
      :more-degraded="moreDegraded"
      @open="(s) => emit('viewAll', s)"
    />
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onScopeDispose,
  reactive,
  useId,
  watch,
  type WatchStopHandle,
} from "vue";

import {
  contextChipFor,
  openAssistant,
  useAssistantCapability,
  useAssistantRuns,
  useAssistantStore,
} from "@/composables/assistant";
import { isTerminal, type TurnState } from "@/composables/assistant/pure";
import type {
  OverviewNowRow as NowRow,
  OverviewNowSnapshot,
} from "@/composables/contextProviders/types";
import { armHomeReturn, type HomeReturnState } from "@/composables/goto/homeReturn";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { ServicesTrendResponse } from "@/services/service_graph";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";

import OverviewBuiltFrom, { type BuiltFromSource } from "./OverviewBuiltFrom.vue";
import OverviewCreditsLine from "./OverviewCreditsLine.vue";
import OverviewNowRow from "./OverviewNowRow.vue";
import { investigateRow, rowSentence } from "./overviewInvestigate";
import { trendPoints } from "./useOverviewNow";

const props = withDefaults(
  defineProps<{
    snapshot: OverviewNowSnapshot;
    org: string;
    timezone: string;
    trend: ServicesTrendResponse | null;
    pending: boolean;
    failedSources: { key: string; label: I18nText }[];
    /** Sources the role may not read; while any shows, the list never says nothing needs attention. */
    deniedSources?: { key: string; label: I18nText }[];
    sources: BuiltFromSource[];
    moreDegraded: number;
    returnState: HomeReturnState;
    dataAsOf?: I18nText | null;
    /** The page range is over the trend's 7-day cap, so service rows show the topology figures. */
    trendCapped?: boolean;
    tracesLocked?: boolean;
  }>(),
  { dataAsOf: null, trendCapped: false, tracesLocked: false, deniedSources: () => [] },
);

const emit = defineEmits<{
  select: [row: NowRow];
  open: [row: NowRow];
  service: [row: NowRow];
  /** The row's own page action: AI off, credits used up, or a gate the door refused. */
  fallback: [row: NowRow];
  viewAll: [source: BuiltFromSource];
  retry: [];
}>();

const { t } = useI18nTyped();
const headingId = `overview-now-${useId()}`;
const capability = useAssistantCapability();
const runs = useAssistantRuns();
const assistant = useAssistantStore();
const busyKeys = reactive(new Set<string>());
const notes = reactive<Record<string, { text: I18nText; showRuns: boolean }>>({});
// The door accepts before the server admits, so each sent row watches its chat for a run-cap refusal.
const refusalWatches = new Map<string, WatchStopHandle>();

const creditsExhausted = computed(() => capability.value.creditMode === "exhausted");
const warnings = computed(() => (props.trend?.warnings ?? []).slice(0, 5).map((w) => raw(w)));
const servicesUntil = computed(() => {
  const until = props.snapshot.services.dataUntil;
  if (until === null) return null;
  return t("overview.now.servicesDataUntil", {
    time: formatTimestampInTimezone(until, "HH:mm", props.timezone),
  });
});

// A joined key, since a fresh array would fire on every returnState change, including a row selection.
watch(
  () =>
    [props.org, props.returnState.period, props.returnState.from, props.returnState.to].join("|"),
  () => {
    Object.keys(notes).forEach((key) => delete notes[key]);
    stopRefusalWatches();
  },
);

onScopeDispose(stopRefusalWatches);

function stopRefusalWatches(): void {
  refusalWatches.forEach((stop) => stop());
  refusalWatches.clear();
}

function watchRefusal(key: string, sid: string): void {
  const turnOf = () => assistant.state.sessions?.[sid]?.turn;
  if (settleRefusal(key, turnOf())) return;
  const stop = watch(turnOf, (turn) => {
    if (!settleRefusal(key, turn)) return;
    stop();
    refusalWatches.delete(key);
  });
  refusalWatches.set(key, stop);
}

function settleRefusal(key: string, turn: TurnState | undefined): boolean {
  if (!turn || !isTerminal(turn)) return false;
  if (turn.state === "refused" && turn.error.code === "run_limit_member") {
    const n = turn.error.active ?? turn.error.limit ?? runs.active.value;
    notes[key] = { text: t("overview.now.notSent.runCap", { n }), showRuns: true };
  }
  return true;
}

function pointsOf(row: NowRow) {
  if (row.kind !== "service") return null;
  const found = trendPoints(props.trend, row.service, row.signal);
  return found
    ? { points: found.points.map((value) => ({ value })), baseline: found.baseline }
    : null;
}

function fallbackOf(row: NowRow): I18nText | null {
  if (!creditsExhausted.value) return null;
  return t("overview.now.investigateFallback", { target: rowSentence(row, props.snapshot, t) });
}

async function onInvestigate(row: NowRow): Promise<void> {
  emit("select", row);
  delete notes[row.key];
  refusalWatches.get(row.key)?.();
  refusalWatches.delete(row.key);
  busyKeys.add(row.key);
  try {
    const outcome = await investigateRow(row, {
      open: openAssistant,
      runs: { active: runs.active.value, cap: runs.cap.value },
      creditsExhausted: creditsExhausted.value,
      snapshot: props.snapshot,
      t,
      incidentChip: (incident) => {
        const chip = contextChipFor(
          "incident_id",
          incident.id,
          { currentPage: "home", org_id: props.org, incident_title: incident.title },
          t,
        );
        return chip ? { ...chip, provenance: "door" } : null;
      },
      arm: armHomeReturn,
      returnState: { ...props.returnState, row: row.key },
      userOrgKey: assistant.state.userOrgKey ?? undefined,
    });
    if (outcome.kind === "fallback") emit("fallback", row);
    if (outcome.kind === "not_sent")
      notes[row.key] = { text: outcome.note, showRuns: outcome.showRuns };
    if (outcome.kind === "sent") watchRefusal(row.key, outcome.sid);
  } finally {
    busyKeys.delete(row.key);
  }
}

// In progress lists the running chats first, so the focus lands where the user can stop one.
async function showRunningChats(): Promise<void> {
  await nextTick();
  const chats = document.querySelector<HTMLElement>('[data-test="assistant-launcher-your-chats"]');
  chats?.scrollIntoView({ block: "nearest" });
  chats?.querySelector<HTMLElement>("button")?.focus();
}
</script>
