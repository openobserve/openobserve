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
    ref="root"
    class="flex min-w-0 flex-col gap-3 overflow-y-auto p-4 max-md:p-3"
    :aria-label="t('assistant.rca.tag')"
    data-dd-privacy="mask"
    data-test="rca-panel"
  >
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-test="rca-announce"
      >{{ announcement }}</span
    >
    <div class="flex min-w-0 flex-wrap items-center gap-2" data-test="rca-toolbar">
      <OText v-if="analyzedLabel" variant="meta" as="span" data-test="rca-analyzed-ago">{{
        analyzedLabel
      }}</OText>
      <ODropdown v-if="history.length" align="start">
        <template #trigger>
          <OButton variant="ghost-muted" size="sm" data-test="rca-history-btn">
            {{ versionLabel(viewingIndex) }}
            <OIcon name="keyboard-arrow-down" size="xs" class="ms-1" />
          </OButton>
        </template>
        <ODropdownItem
          data-test="rca-history-current"
          :disabled="viewingIndex === null"
          @select="emit('view-report', null)"
        >
          {{ versionLabel(null) }}
        </ODropdownItem>
        <ODropdownItem
          v-for="(report, index) in history"
          :key="report.archived_at"
          :data-test="`rca-history-item-${index}`"
          :disabled="viewingIndex === index"
          @select="emit('view-report', index)"
        >
          {{ versionLabel(index) }}
        </ODropdownItem>
      </ODropdown>
      <span v-if="reportText" class="ms-auto flex items-center gap-2">
        <AiEntryButton
          v-if="mdUp"
          v-bind="askDoor"
          :build="buildAsk"
          data-test="ai-entry-incident-report-ask"
        />
        <ODropdown v-else align="end">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon"
              :class="TOUCH_TARGET_CLASS"
              :aria-label="t('assistant.rca.moreActions')"
              data-test="rca-toolbar-menu"
            >
              <OIcon name="more-vert" size="sm" />
            </OButton>
          </template>
          <AiEntryButton
            v-bind="askDoor"
            appearance="menu-item"
            :build="buildAsk"
            data-test="ai-entry-incident-report-ask"
          />
        </ODropdown>
      </span>
    </div>

    <template v-if="gate">
      <AssistantGateState
        v-if="gate.state !== 'rca_off'"
        :reason="gate.reason"
        size="inline"
        :is-admin="isAdmin"
        :context="{ org, feature: 'rca' }"
        data-test="rca-gate-state"
      />
      <div
        v-else
        class="border-border-default rounded-default flex min-w-0 flex-col gap-2 border p-3"
        data-test="rca-gate-state"
      >
        <OText class="break-words">{{ t("assistant.rca.gate.off") }}</OText>
        <OText variant="meta" class="break-words">{{
          isAdmin ? t("assistant.rca.gate.offAdmin") : t("assistant.rca.gate.offMember")
        }}</OText>
        <AssistantAskAdminPopover v-if="!isAdmin" kind="settings" :org="org">
          <template #trigger>
            <OButton
              variant="secondary"
              size="md"
              class="max-md:w-full"
              data-test="rca-gate-ask-admin"
            >
              {{ t("assistant.outcome.actions.askAdmin") }}
            </OButton>
          </template>
        </AssistantAskAdminPopover>
      </div>
    </template>

    <template v-else>
      <div
        v-if="severityOffer"
        role="group"
        :aria-label="severityText"
        class="border-border-default rounded-default flex min-w-0 flex-wrap items-center gap-2 border p-2"
        data-test="rca-rerun-chip"
      >
        <OText class="min-w-0 flex-[1_1_14rem] break-words">{{ severityText }}</OText>
        <span class="flex flex-wrap gap-2 max-md:w-full">
          <OButton
            variant="secondary"
            size="sm"
            :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
            data-test="rca-rerun-chip-accept"
            @click="rerunForSeverity"
          >
            {{ t("assistant.rca.reanalyze") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
            data-test="rca-rerun-chip-dismiss"
            @click="dismissSeverity"
          >
            {{ t("assistant.helper.hintDismiss") }}
          </OButton>
        </span>
      </div>

      <AssistantConsentCard
        v-if="consentCard"
        :key="`consent:${consentCard.sid}`"
        v-bind="consentCard"
        @enable="analysis.resolveConsent(true)"
        @cancel="analysis.resolveConsent(false)"
      />
      <AssistantTurnStatus
        v-else-if="running && session"
        variant="card"
        copy="rca"
        :line="followLine"
        :turn="session.turn"
        :meta="session.turnMeta"
        :owned-by-this-tab="session.turnMeta.ownedByThisTab"
        data-test="rca-turn-status"
        @stop="stop"
      />
      <div
        v-else-if="elsewhere"
        class="border-border-default rounded-default flex min-w-0 flex-col gap-2 border p-3 text-xs"
        data-test="rca-running-elsewhere"
      >
        <span class="flex min-w-0 items-center gap-2">
          <OSpinner variant="dots" size="xs" aria-hidden="true" />
          <OText as="span" variant="meta" class="min-w-0 break-words">{{ elsewhereLine }}</OText>
        </span>
        <OText v-if="elsewhereStarted" variant="meta" class="break-words">{{
          elsewhereStarted
        }}</OText>
        <OText
          v-if="stale"
          variant="meta"
          class="text-status-warning-text break-words"
          data-test="rca-stale"
          >{{ t("assistant.rca.stale", { elapsed: elsewhereElapsed }) }}</OText
        >
        <OText v-if="stopFailed" variant="meta" class="break-words" data-test="rca-stop-failed">{{
          t("assistant.rca.stopFailed")
        }}</OText>
        <OButton
          variant="outline"
          size="sm"
          :disabled="stoppingElsewhere"
          :class="['self-start max-md:w-full', TOUCH_TARGET_CLASS]"
          data-test="rca-stop-btn"
          @click="stopElsewhere"
        >
          {{
            stoppingElsewhere
              ? t("assistant.turn.stopping")
              : stopFailed
                ? t("assistant.rca.tryAgain")
                : t("assistant.rca.stop")
          }}
        </OButton>
      </div>
      <OText
        v-else-if="analysis.refusal.value === 'priority_off'"
        class="break-words"
        data-test="rca-priority-off"
        >{{ t("assistant.rca.priorityOff") }}</OText
      >
      <div
        v-else-if="outcome"
        role="group"
        :aria-label="t('assistant.rca.announce.failed')"
        class="flex min-w-0 flex-col gap-2"
        data-test="rca-error-card"
      >
        <AssistantTurnOutcome
          :kind="outcome.kind"
          :error="outcome.error"
          :role="isAdmin ? 'admin' : 'member'"
          :retry-snapshot-available="false"
          :partial="!!streamed"
          :org="org"
          :sid="session?.sid"
          @action="onOutcomeAction"
        />
        <OButton
          v-if="logsHref"
          as="a"
          :href="logsHref"
          target="_blank"
          rel="noopener noreferrer"
          variant="ghost-primary"
          size="sm"
          :class="['self-start', TOUCH_TARGET_CLASS]"
          data-test="rca-open-logs"
        >
          {{ t("assistant.rca.openLogs") }}
          <span class="sr-only">{{ t("assistant.docs.opensInNewTab") }}</span>
        </OButton>
      </div>

      <div
        v-if="!running && !elsewhere"
        class="flex min-w-0 flex-wrap items-center gap-2"
        data-test="rca-actions"
      >
        <OText v-if="endLine" class="w-full break-words" data-test="rca-end-line">{{
          endLine
        }}</OText>
        <span
          v-if="cancelUnconfirmed"
          class="flex w-full flex-wrap items-center gap-2"
          data-test="rca-stop-failed"
        >
          <OText as="span" class="min-w-0 break-words">{{ t("assistant.rca.stopFailed") }}</OText>
          <OButton
            variant="secondary"
            size="sm"
            :disabled="stoppingElsewhere"
            :class="TOUCH_TARGET_CLASS"
            data-test="rca-stop-retry"
            @click="cancelOnServer"
          >
            {{ t("assistant.rca.tryAgain") }}
          </OButton>
        </span>
        <template v-if="hasRun">
          <OButton
            ref="againEl"
            variant="primary"
            size="md"
            class="max-md:w-full"
            data-test="rca-reanalyze-btn"
            @click="analyze({ reanalysis: true, buildOnPrevious: false })"
          >
            {{ rerunLabel(t("assistant.rca.fresh")) }}
          </OButton>
          <OButton
            variant="outline"
            size="md"
            class="max-md:w-full"
            data-test="rca-build-on-previous-btn"
            @click="analyze({ reanalysis: true, buildOnPrevious: true })"
          >
            {{ rerunLabel(t("assistant.rca.buildOnPrevious")) }}
          </OButton>
        </template>
        <template v-else>
          <OButton
            ref="againEl"
            variant="primary"
            size="md"
            class="max-md:w-full"
            data-test="trigger-rca-btn"
            @click="analyze({ reanalysis: false, buildOnPrevious: false })"
          >
            {{ t("assistant.rca.analyze") }}
          </OButton>
          <OText variant="meta" class="break-words" data-test="rca-analyze-hint">{{
            metered ? t("assistant.rca.analyzeHintMetered") : t("assistant.rca.analyzeHint")
          }}</OText>
        </template>
      </div>

      <OBanner
        v-if="viewingIndex !== null"
        variant="warning"
        icon="history"
        dense
        inline-actions
        data-test="rca-archived-banner"
      >
        {{ t("alerts.incidents.rcaViewingArchived") }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            data-test="rca-back-to-current-btn"
            @click="emit('view-report', null)"
          >
            {{ t("alerts.incidents.rcaBackToCurrent") }}
          </OButton>
        </template>
      </OBanner>

      <IncidentAnalysisReport
        v-if="reportText"
        :report="reportText"
        :live="running"
        :report-key="reportKey"
        :partial="partialLabel"
      />
    </template>
  </section>
</template>

<script lang="ts">
import { reactive } from "vue";

/** A superseded report as the retired `rca/history` route returned it. */
export interface ArchivedRcaReport {
  content: string;
  /** Microseconds since epoch. */
  archived_at: number;
}

export interface IncidentAnalysisPanelProps {
  incidentId: string;
  incidentTitle: string;
  severity?: string;
  status?: string;
  /** The report on screen: the current one, or the archived one being viewed. */
  existingReport?: string;
  /** Superseded reports, newest first. */
  history?: ArchivedRcaReport[];
  /** The archived report being viewed; `null` for the current one. */
  viewingIndex?: number | null;
  /** When the current report was produced (ms). */
  analyzedAt?: number | null;
  /** A run the server reports in flight that this tab did not start (ms of its begin). */
  serverRunStartedAt?: number | null;
  /** The incident's alert window ±15 min (ms): the Time chip and the Logs link. */
  window?: { from: number; to: number } | null;
  /** Log streams correlated with the incident, for "Open logs for this incident". */
  logStreams?: string[];
  /** The severity a save just set; offers a re-analysis once. */
  severityChange?: string | null;
}

export interface IncidentAnalysisPanelEmits {
  /** A run finished; the drawer reloads the incident once. */
  (e: "completed"): void;
  (e: "view-report", index: number | null): void;
  /** The server's run state may have changed; the drawer re-reads the event log. */
  (e: "refresh-state"): void;
  (e: "dismiss-severity"): void;
}

/** Mirrors the server's stale threshold (`reanalysis_cooldown_minutes * 2`). */
export const RCA_STALE_AFTER_MS = 60 * 60 * 1000;

// A dismissed severity offer stays dismissed for that incident and severity this session.
const dismissedOffers: Set<string> = reactive(new Set<string>());
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import AssistantConsentCard from "@/components/ai-assistant/credits/AssistantConsentCard.vue";
import AiEntryButton from "@/components/ai-assistant/entry/AiEntryButton.vue";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import AssistantGateState from "@/components/ai-assistant/gate/AssistantGateState.vue";
import AssistantTurnOutcome, {
  type OutcomeAction,
  type OutcomeKind,
} from "@/components/ai-assistant/turn/AssistantTurnOutcome.vue";
import AssistantTurnStatus from "@/components/ai-assistant/turn/AssistantTurnStatus.vue";
import {
  consentCardFor,
  followKey,
  followedAnalyses,
  isMeteredCredit,
  orgDisplayName,
  rcaRefusalOf,
  useAssistantCapability,
  useAssistantName,
  useAssistantStore,
  useIncidentAnalysis,
  type IncidentAnalysisRun,
} from "@/composables/assistant";
import { answerTextOf, type AssistantError } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import incidentsService from "@/services/incidents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { buildIncidentReportPrompt } from "@/utils/assistant/prompts";
import { formatBytes, formatElapsed, formatOrgTime, formatRelative } from "@/utils/formatters";

import IncidentAnalysisReport from "./IncidentAnalysisReport.vue";

const props = withDefaults(defineProps<IncidentAnalysisPanelProps>(), {
  severity: undefined,
  status: undefined,
  existingReport: "",
  history: () => [],
  viewingIndex: null,
  analyzedAt: null,
  serverRunStartedAt: null,
  window: null,
  logStreams: () => [],
  severityChange: null,
});
const emit = defineEmits<IncidentAnalysisPanelEmits>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const { mdUp } = useBreakpoint();
const vuex = useStore();
const router = useRouter();
const store = useAssistantStore();
const capability = useAssistantCapability();
const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const analysis = useIncidentAnalysis(() => props.incidentId, {
  org: () => org.value,
  // Until `/config` carries `rca_enabled`, only the route's refusal says analysis is off.
  rcaFlagKnown: () => typeof vuex.state.zoConfig?.rca_enabled === "boolean",
});
const root = ref<HTMLElement | null>(null);
const againEl = ref<{ $el?: HTMLElement } | null>(null);
const endedAt = ref<number | null>(null);
const lastRun = ref<IncidentAnalysisRun | null>(null);
const reportAtStart = ref<string | null>(null);
const announcement = ref<I18nText>(raw(""));
const now = ref(Date.now());
const stoppingElsewhere = ref(false);
const stopFailed = ref(false);
const stoppedElsewhereAfter = ref<number | null>(null);
// A different run on the server is no longer the one this tab stopped.
watch(
  () => props.serverRunStartedAt,
  (next, before) => {
    if (next != null && next !== before) stoppedElsewhereAfter.value = null;
  },
);
let clock: ReturnType<typeof setInterval> | null = null;

const gate = computed(() => analysis.gate.value);
const session = computed(() => analysis.session.value);
const running = computed(() => analysis.running.value);
const isAdmin = computed(() => capability.value.isAdmin);
const metered = computed(() => isMeteredCredit(capability.value.creditMode));
// A refused or empty run leaves nothing to re-analyze or build on.
const hasRun = computed(
  () => !!props.existingReport || !!props.history.length || !!streamed.value.trim(),
);
const streamed = computed(() => answerTextOf(analysis.answer.value));
const turnState = computed(() => session.value?.turn.state ?? "idle");

const consentCard = computed(() =>
  session.value?.turn.state === "awaiting_consent"
    ? consentCardFor(
        session.value,
        (id) => orgDisplayName(id, vuex.state.selectedOrganization),
        "compact",
      )
    : null,
);

const elsewhere = computed(
  () =>
    !running.value &&
    stoppedElsewhereAfter.value === null &&
    (props.serverRunStartedAt != null || analysis.refusal.value === "running_elsewhere"),
);
const elsewhereElapsed = computed(() =>
  raw(
    props.serverRunStartedAt
      ? formatElapsed(Math.max(0, now.value - props.serverRunStartedAt))
      : "0 s",
  ),
);
const elsewhereLine = computed(() =>
  props.serverRunStartedAt
    ? t("assistant.rca.status.analysing", { elapsed: elsewhereElapsed.value })
    : t("assistant.rca.status.running"),
);
const elsewhereStarted = computed(() =>
  props.serverRunStartedAt
    ? t("assistant.rca.runningStarted", {
        time: raw(formatRelative(props.serverRunStartedAt, now.value)),
      })
    : null,
);
const stale = computed(
  () => !!props.serverRunStartedAt && now.value - props.serverRunStartedAt > RCA_STALE_AFTER_MS,
);

const follow = computed(() => followedAnalyses.get(followKey(org.value, props.incidentId)) ?? null);
const followLine = computed<I18nText | null>(() => {
  const state = follow.value;
  if (state?.reason !== "reconnect") return null;
  return state.caughtUpAt ? t("assistant.turn.caughtUp") : t("assistant.turn.reconnecting");
});

// Refusals the route gave for this incident render as their own states, never as a failure card.
const outcome = computed<{ kind: OutcomeKind; error: AssistantError } | null>(() => {
  const turn = session.value?.turn;
  if (turn?.state !== "failed" && turn?.state !== "refused") return null;
  if (rcaRefusalOf(turn.error)) return null;
  return { kind: turn.state, error: turn.error };
});

const cancelUnconfirmed = computed(() => turnState.value === "stopped" && stopFailed.value);

const elapsed = computed(() => {
  const current = session.value;
  const started = current?.turnMeta.startedAt;
  const ended = endedAt.value ?? (current ? store.lastTurnAt(current.sid) : null);
  return raw(
    started && ended && ended > started ? formatElapsed(ended - started) : formatElapsed(0),
  );
});

const endLine = computed<I18nText | null>(() => {
  if (stoppedElsewhereAfter.value !== null)
    return t("assistant.rca.stoppedByYou", {
      elapsed: raw(formatElapsed(stoppedElsewhereAfter.value)),
    });
  if (turnState.value === "stopped") return t("assistant.rca.stopped", { elapsed: elapsed.value });
  if (turnState.value === "done") return t("assistant.rca.done", { elapsed: elapsed.value });
  return null;
});

// The saved report replaces the streamed one once the drawer has reloaded it; an archived one always shows.
const reportText = computed(() => {
  if (props.viewingIndex !== null) return props.existingReport;
  if (running.value) return streamed.value;
  const state = turnState.value;
  if (!session.value || state === "idle") return props.existingReport;
  if (state === "done") {
    const reloaded = !!props.existingReport && props.existingReport !== reportAtStart.value;
    return reloaded ? props.existingReport : streamed.value || props.existingReport;
  }
  return streamed.value || props.existingReport;
});

const partialLabel = computed<I18nText | null>(() => {
  if (props.viewingIndex !== null || !streamed.value || running.value) return null;
  const state = turnState.value;
  if (state !== "stopped" && state !== "failed") return null;
  return t("assistant.rca.partial", { time: raw(formatOrgTime(endedAt.value ?? Date.now())) });
});

const reportKey = computed(() => {
  const version = props.viewingIndex === null ? "current" : `archived-${props.viewingIndex}`;
  return `rca:${props.incidentId}:${session.value?.sid ?? "saved"}:${version}`;
});

const analyzedLabel = computed(() => {
  if (!props.analyzedAt || props.viewingIndex !== null || running.value) return null;
  return t("assistant.rca.analyzedAgo", { time: raw(formatRelative(props.analyzedAt, now.value)) });
});

const severityText = computed(() =>
  t("assistant.rca.severityChanged", { severity: raw(props.severityChange ?? "") }),
);
const severityOffer = computed(
  () =>
    !!props.severityChange &&
    !dismissedOffers.has(`${props.incidentId}:${props.severityChange}`) &&
    !running.value &&
    !elsewhere.value,
);

const logsHref = computed(() => {
  const window = props.window;
  if (!window || !props.logStreams.length) return null;
  return router.resolve({
    name: "logs",
    query: {
      org_identifier: org.value,
      stream_type: "logs",
      stream: props.logStreams.join(","),
      from: String(Math.round(window.from * 1000)),
      to: String(Math.round(window.to * 1000)),
    },
  }).href;
});

const askDoor = computed(() => ({
  verb: "ask" as const,
  entryKind: "object_verb" as const,
  objectKind: "incident" as const,
  thread: "new" as const,
  label: t("assistant.rca.askAbout"),
  tooltip: t("assistant.rca.askAboutTooltip", { product }),
  disabledReason: running.value ? t("assistant.rca.askAboutWait") : undefined,
}));

watch(
  () => gate.value?.state ?? null,
  (state) => {
    if (state === "rca_off") trackAssistant("ai_gate_blocked", { reason: "off_for_org" });
  },
  { immediate: true },
);

// One announcement per transition; elapsed ticks are never read.
watch(turnState, (state, was) => {
  if (state === was) return;
  if (state === "connecting" && was === "queued") announce(t("assistant.rca.announce.started"));
  else if (state === "stopped") announce(t("assistant.rca.announce.stopped"));
  else if (state === "done") announce(t("assistant.rca.announce.done"));
  else if (state === "failed" || state === "refused") announce(t("assistant.rca.announce.failed"));
});

watch(elsewhere, (shown) => {
  if (shown) announce(elsewhereLine.value);
  syncClock();
});

watch(severityOffer, (shown) => {
  if (shown) announce(severityText.value);
});

watch(
  () => analysis.refusal.value,
  (refusal) => {
    if (refusal === "running_elsewhere") emit("refresh-state");
    if (refusal === "priority_off") announce(t("assistant.rca.priorityOff"));
  },
);

// The server's run ended: whatever this tab was refused for it no longer holds.
watch(
  () => props.serverRunStartedAt,
  (startedAt, was) => {
    if (startedAt === null && was !== null) analysis.dismissRefusal();
  },
);

watch(running, () => syncClock());
watch(
  () => props.analyzedAt,
  () => syncClock(),
  { immediate: true },
);

onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
  clock = null;
});

function syncClock(): void {
  // Seconds tick while a run is shown; minutes are enough for "Analysed {time}".
  const period = running.value || elsewhere.value ? 1_000 : props.analyzedAt ? 30_000 : 0;
  if (clock) clearInterval(clock);
  clock = period ? setInterval(() => (now.value = Date.now()), period) : null;
}

function announce(text: I18nText): void {
  announcement.value = raw("");
  void nextTick(() => (announcement.value = text));
}

function versionLabel(index: number | null): I18nText {
  const count = props.history.length;
  if (index === null)
    return props.analyzedAt
      ? t("assistant.rca.version", { n: count + 1, time: raw(formatOrgTime(props.analyzedAt)) })
      : t("assistant.rca.versionOnly", { n: count + 1 });
  const report = props.history[index];
  return t("assistant.rca.version", {
    n: count - index,
    time: raw(report ? formatOrgTime(report.archived_at / 1000) : ""),
  });
}

function rerunLabel(action: I18nText): I18nText {
  return metered.value
    ? t("assistant.rca.rerunMetered", { action })
    : t("assistant.rca.rerunTimed", { action });
}

async function analyze(run: IncidentAnalysisRun): Promise<void> {
  lastRun.value = run;
  endedAt.value = null;
  stopFailed.value = false;
  stoppedElsewhereAfter.value = null;
  reportAtStart.value = props.existingReport;
  if (props.viewingIndex !== null) emit("view-report", null);
  const terminal = await analysis.analyze(run);
  if (!terminal) return;
  endedAt.value = Date.now();
  if (terminal.state === "done") emit("completed");
}

async function stop(): Promise<void> {
  await analysis.stop();
  stopFailed.value = stoppedUnconfirmed();
  await nextTick();
  againEl.value?.$el?.focus?.();
}

// The engine writes an unconfirmed cancel into the answer's outcome block.
function stoppedUnconfirmed(): boolean {
  const blocks = analysis.answer.value?.contentBlocks ?? [];
  return blocks.some((block) => block.type === "turn_outcome" && block.outcome?.cancelUnconfirmed);
}

async function cancelOnServer(): Promise<boolean> {
  stoppingElsewhere.value = true;
  try {
    await incidentsService.cancelRca(org.value, props.incidentId);
    stopFailed.value = false;
    return true;
  } catch {
    stopFailed.value = true;
    return false;
  } finally {
    stoppingElsewhere.value = false;
  }
}

async function stopElsewhere(): Promise<void> {
  if (stoppingElsewhere.value) return;
  const startedAt = props.serverRunStartedAt;
  if (!(await cancelOnServer())) return;
  stoppedElsewhereAfter.value = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  analysis.dismissRefusal();
  announce(t("assistant.rca.announce.stopped"));
  emit("refresh-state");
  await nextTick();
  againEl.value?.$el?.focus?.();
}

async function rerunForSeverity(): Promise<void> {
  dismissSeverity();
  await analyze({ reanalysis: true, buildOnPrevious: false });
}

function dismissSeverity(): void {
  if (props.severityChange) dismissedOffers.add(`${props.incidentId}:${props.severityChange}`);
  emit("dismiss-severity");
}

function onOutcomeAction(action: OutcomeAction): void {
  if (action === "retry")
    void analyze(lastRun.value ?? { reanalysis: hasRun.value, buildOnPrevious: false });
}

function buildAsk() {
  const report = reportText.value;
  const prompt = buildIncidentReportPrompt(
    {
      org: org.value,
      incidentId: props.incidentId,
      title: props.incidentTitle,
      ...(props.severity && { severity: props.severity }),
      ...(props.status && { status: props.status }),
      report,
      reportLabel: t("assistant.rca.reportChip", {
        version: versionLabel(props.viewingIndex),
        size: raw(formatBytes(new TextEncoder().encode(report).length)),
      }),
      ...(props.window && { window: props.window }),
    },
    t,
  );
  return { text: prompt.text, chips: prompt.chips, title: prompt.title };
}
</script>
