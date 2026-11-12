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
  <section :aria-labelledby="headingId" class="flex min-w-0 flex-col gap-2" data-test="home-now">
    <div
      class="flex min-h-8 min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 ps-1"
      data-test="home-now-heading"
    >
      <h2 :id="headingId" class="text-text-heading text-base font-semibold">
        {{ t("home.agent.problems.title") }}
      </h2>
      <OTag type="countChip" value="warning" data-test="home-now-count">{{
        snapshot.rows.length
      }}</OTag>
      <OText variant="meta" class="ms-auto" data-test="home-now-problems-note">{{
        t("home.agent.problems.note")
      }}</OText>
    </div>
    <div
      class="border-border-default rounded-surface bg-surface-panel overflow-hidden border border-[0.0625em]"
    >
      <ul class="flex flex-col" data-test="home-now-rows">
        <HomeNowRow
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
          :askable="askable"
          :meta="rowMeta[row.key] ?? null"
          :create-alert="createAlert"
          @investigate="onInvestigate"
          @create-alert="(r) => emit('createAlert', r)"
          @open="(r) => emit('open', r)"
          @service="(r) => emit('service', r)"
          @show-runs="showRunningChats"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, reactive, useId, watch, type WatchStopHandle } from "vue";

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
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { ServicesTrendResponse } from "@/services/service_graph";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import HomeNowRow, { type NowRowMeta } from "./HomeNowRow.vue";
import { investigateRow, rowSentence } from "./homeInvestigate";
import { trendPoints } from "./useHomeNow";

const CHAT_GATES: ReadonlySet<string> = new Set(["available", "unhealthy"]);

const props = withDefaults(
  defineProps<{
    /** Home's services no alert matches, as one joined list. */
    snapshot: OverviewNowSnapshot;
    org: string;
    timezone: string;
    trend: ServicesTrendResponse | null;
    returnState: HomeReturnState;
    tracesLocked?: boolean;
    /** What Home's grouping learned per row key: its service and whether it flaps. */
    rowMeta?: Record<string, NowRowMeta>;
    /** Each row offers Create alert; disabled for a role that cannot create alerts. */
    createAlert?: { enabled: boolean } | null;
  }>(),
  {
    tracesLocked: false,
    rowMeta: () => ({}),
    createAlert: null,
  },
);

const emit = defineEmits<{
  select: [row: NowRow];
  open: [row: NowRow];
  service: [row: NowRow];
  /** The row's own page action: AI off, credits used up, or a gate the door refused. */
  fallback: [row: NowRow];
  createAlert: [row: NowRow];
}>();

const { t } = useI18nTyped();
const headingId = `home-now-${useId()}`;
const capability = useAssistantCapability();
const runs = useAssistantRuns();
const assistant = useAssistantStore();
const busyKeys = reactive(new Set<string>());
const notes = reactive<Record<string, { text: I18nText; showRuns: boolean }>>({});
// The door accepts before the server admits, so each sent row watches its chat for a run-cap refusal.
const refusalWatches = new Map<string, WatchStopHandle>();

const creditsExhausted = computed(() => capability.value.creditMode === "exhausted");
// Without a chat to send to, the row's button names the page it opens instead of falling back silently.
const askable = computed(() => CHAT_GATES.has(capability.value.gate) && !creditsExhausted.value);

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
  if (!askable.value) {
    emit("fallback", row);
    return;
  }
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

// Home lists no chats, so the run cap's way out is All chats, where a running one can be stopped.
function showRunningChats(): void {
  void runs.requestOpen();
}
</script>
