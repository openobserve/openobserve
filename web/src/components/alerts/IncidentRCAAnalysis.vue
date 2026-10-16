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

<!-- The Analysis tab (contract E5, P3 F1): a left analysis column (analysis bar,
     verdict card, What happened, Hypotheses, Blind spots, Evidence) and the right
     "Investigation thread" column (02 TH38). A legacy run shows its markdown
     report in place of the sections (03 VE42). -->
<template>
  <!-- K: nothing ran yet (02 TH40). -->
  <div
    v-if="!rca"
    data-test="rca-analysis-container"
    class="flex min-h-0 flex-1 flex-col overflow-auto px-7 pt-4 pb-10"
  >
    <section
      data-test="rca-trigger-section"
      class="rounded-default border-border-default bg-surface-base flex max-w-215 flex-col items-start gap-2 border p-6"
    >
      <h2 class="text-text-heading m-0 text-base font-bold">
        {{ t("alerts.incidents.rcaRun.noAnalysisTitle") }}
      </h2>
      <p class="text-text-body text-compact m-0">
        {{ t("alerts.incidents.rcaRun.noAnalysisText") }}
      </p>
      <OButton
        data-test="trigger-rca-btn"
        variant="primary"
        size="sm"
        icon-left="auto-awesome"
        :loading="triggering"
        @click="$emit('trigger-rca', { buildOnPrevious: false })"
      >
        {{ t("alerts.incidents.rcaAnalyzeIncident") }}
      </OButton>
    </section>
  </div>

  <div
    v-else
    data-test="rca-analysis-container"
    class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_25rem] overflow-hidden"
  >
    <div class="flex min-w-0 flex-col gap-6 overflow-auto px-7 pt-4 pb-10">
      <RcaAnalysisBar
        :runs="history"
        :latest-run-id="rca.run_id"
        :selected-run-id="cardRunId"
        :live="live"
        :subtitle="subtitle"
        :has-report="!!reportText"
        :can-build-on-previous="!!reportRun"
        :has-thread="!!thread && thread.transcript === 'available'"
        :can-ask="canAsk"
        :triggering="triggering"
        :resuming="resuming"
        :cancelling="cancelling"
        @select-run="$emit('view-run', $event)"
        @reanalyze="$emit('trigger-rca', $event)"
        @reanalyze-guidance="openGuidance('')"
        @cancel="$emit('cancel-rca')"
        @copy-report="copyReport"
        @download-report="downloadReport"
        @copy-thread="copyThread"
        @ask="ask"
      />

      <RcaVerdictCard
        :card-state="cardState"
        :run-id="cardRunId"
        :waiting-input="waitingInput"
        :summary="recordSummary"
        :stale="stale"
        :stale-since="staleSince"
        :stage-index="rca.summary.stage_index"
        :stage="rca.summary.stage"
        :live-mode="currentRun?.mode ?? null"
        :failed-mode="currentRun?.mode ?? null"
        :earlier-report-note="earlierReportNote"
        :error="error"
        :cancelled-text="cancelledText"
        :triggering="triggering"
        :cancelling="cancelling"
        :can-resume="!!resumeRunId && !viewedRun"
        :resuming="resuming"
        :org="orgId"
        :can-steer="canSteer"
        :paused-step="pausedStep"
        :paused-question="pausedQuestion"
        :deadline-text="deadlineText"
        :unblocked="unblocked"
        @cancel="$emit('cancel-rca')"
        @follow-thread="followThread"
        @retry="$emit('trigger-rca', $event)"
        @show-unverified="evidenceList?.showUnverified()"
        @show-blind-spots="showBlindSpots"
        @tell-agent="threadColumn?.focusComposer()"
        @resume="resumeLatest"
      >
        <template v-if="cardRunId" #feedback>
          <RcaFeedback
            :key="cardRunId"
            :org-id="orgId"
            :incident-id="incidentId"
            :run-id="cardRunId"
          />
        </template>
      </RcaVerdictCard>

      <template v-if="recordSummary">
        <RcaWhatHappened
          v-if="cardState === 'investigating' || cardState === 'analyzed'"
          :timeline="recordSummary.timeline"
          :evidence="recordSummary.evidence"
          :hypotheses="recordSummary.hypotheses"
          :org="orgId"
          :live="cardState === 'investigating'"
        />
        <RcaHypotheses
          :hypotheses="recordSummary.hypotheses"
          :outcome="recordSummary.card.outcome"
          :evidence="recordSummary.evidence"
          :org="orgId"
          :live="cardState === 'investigating'"
          :can-steer="canSteer"
          :pending="pendingActions"
          :sending="steerSending"
          @steer-action="sendHypothesisAction"
        />
        <RcaBlindSpots
          ref="blindSpots"
          :blind-spots="recordSummary.blind_spots"
          :org="orgId"
          :live="cardState === 'investigating'"
          :can-resume="!!resumeRunId && !viewedRun && threadRunId === rca.run_id"
          :resuming="resuming"
          :triggering="triggering"
          @resume="resumeLatest"
        />
        <RcaEvidenceList
          ref="evidenceList"
          :evidence="recordSummary.evidence"
          :unverified="recordSummary.unverified"
          :hypotheses="recordSummary.hypotheses"
          :org="orgId"
        />
      </template>
      <p
        v-else-if="summaryStatus === 'loading' && !showReport"
        data-test="rca-summary-loading"
        class="text-text-secondary m-0 flex items-center gap-2 text-sm"
      >
        <OSpinner variant="dots" size="xs" />
        {{ t("alerts.incidents.rcaSummary.loading") }}
      </p>

      <template v-if="showReport">
        <p
          v-if="reportLoading && !reportText"
          data-test="rca-report-loading"
          class="text-text-secondary m-0 flex items-center gap-2 text-sm"
        >
          <OSpinner variant="dots" size="xs" />
          {{ t("alerts.incidents.rcaRun.loadingReport") }}
        </p>
        <RcaReportContent
          v-else-if="reportText"
          data-test="rca-existing-container"
          class="max-w-215"
          :html="formattedReport"
          :is-dark-mode="isDark"
        />
      </template>
      <p
        v-if="live && !reportRun && !recordSummary"
        data-test="rca-report-pending"
        class="text-text-secondary text-compact m-0"
      >
        {{ t("alerts.incidents.rcaRun.reportAfterRun") }}
      </p>
    </div>

    <RcaThreadColumn
      ref="threadColumn"
      :thread="thread"
      :status="threadStatus"
      :run-live="threadLive"
      :run-state="threadRunState"
      :trigger-label="threadTriggerLabel"
      :context-used="threadContextUsed"
      :run-stats="threadRunStats"
      :evidence-numbers="evidenceNumbers"
      :steering="steering"
      :can-steer="canSteer"
      :author-email="authorEmail"
      :sending="steerSending"
      :send="sendMessage"
      @retry="retryThread"
      @open-evidence="evidenceList?.openEntry($event)"
      @reanalyze-with="openGuidance"
    />

    <RcaGuidanceDialog
      v-model:open="guidanceOpen"
      :initial-guidance="guidanceText"
      :can-build-on-previous="!!reportRun"
      :triggering="triggering || resuming"
      @start="$emit('trigger-rca', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, toRef, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  RcaContextUsed,
  RcaRunError,
  RcaRunItem,
  RcaRunState,
  RcaRunStats,
  RcaSteerAction,
  RcaSummary,
} from "@/services/incidents";
import { useRcaThread } from "@/composables/useRcaThread";
import { useRcaSummary } from "@/composables/useRcaSummary";
import { useRcaSteering } from "@/composables/useRcaSteering";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { formatTimestampInTimezone } from "@/utils/date";
import { humanizeElapsed, isLiveRca, userLocalPart } from "@/utils/incidents/rcaCell";
import { renderRcaReport } from "@/utils/incidents/rcaReportMarkdown";
import {
  finishedStepCount,
  formatRcaClock,
  formatRcaDuration,
  formatRcaElapsed,
  rcaThreadPlainText,
  rcaTriggerLabel,
  type RcaCardState,
} from "@/utils/incidents/rcaThread";
import { rcaEvidenceNumbers } from "@/utils/incidents/rcaSummary";
import {
  rcaNeedSubject,
  rcaPendingHypothesisActions,
  rcaUnblockingAnswer,
  type RcaUnblockedLine,
} from "@/utils/incidents/rcaSteering";
import RcaAnalysisBar from "./rca/RcaAnalysisBar.vue";
import RcaBlindSpots from "./rca/RcaBlindSpots.vue";
import RcaEvidenceList from "./rca/RcaEvidenceList.vue";
import RcaHypotheses from "./rca/RcaHypotheses.vue";
import RcaThreadColumn from "./rca/RcaThreadColumn.vue";
import RcaGuidanceDialog from "./rca/RcaGuidanceDialog.vue";
import RcaVerdictCard from "./rca/RcaVerdictCard.vue";
import RcaWhatHappened from "./rca/RcaWhatHappened.vue";
import RcaReportContent from "./rca/RcaReportContent.vue";
import { useTheme } from "@/composables/useTheme";
import RcaFeedback from "./rca/RcaFeedback.vue";
import { buildRcaAskAttachment, type RcaAskPayload } from "@/utils/incidents/rcaAskAttachment";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";

const props = withDefaults(
  defineProps<{
    orgId: string;
    incidentId: string;
    /** Run summary of the latest run with the detail fields, or null when none ran. */
    rca: RcaSummary | null;
    /** Newest completed run; its report shows unless an earlier one is picked. */
    reportRun?: RcaRunItem | null;
    /** A completed run picked from the history, or null to follow the latest run. */
    viewedRun?: RcaRunItem | null;
    /** Runs of this incident, newest first. */
    history?: RcaRunItem[];
    /** Server flag: the live run has had no update past the stale threshold. */
    stale?: boolean;
    /** The latest run's failure, or null when it did not fail. */
    error?: RcaRunError | null;
    /** Markdown of the shown report. */
    reportText?: string;
    reportLoading?: boolean;
    /** The run whose thread shows: the picked run, else the latest. */
    threadRunId?: string | null;
    /** The thread's run is live; its thread is polled (02 TH32). */
    threadLive?: boolean;
    triggering?: boolean;
    cancelling?: boolean;
    /**
     * The run "Resume run" resumes (J9): the latest failed or cancelled run, or
     * the source of a resume that never ran; null offers no Resume.
     */
    resumeRunId?: string | null;
    resuming?: boolean;
    /** The incident's title, for the Ask attachment header. */
    incidentTitle?: string;
  }>(),
  {
    reportRun: null,
    viewedRun: null,
    history: () => [],
    stale: false,
    error: null,
    reportText: "",
    reportLoading: false,
    threadRunId: null,
    threadLive: false,
    triggering: false,
    cancelling: false,
    resumeRunId: null,
    resuming: false,
    incidentTitle: "",
  },
);

const emit = defineEmits<{
  "trigger-rca": [options: { buildOnPrevious: boolean; guidance?: string }];
  "cancel-rca": [];
  "view-run": [runId: string | null];
  /** A message resumed the paused run: the run state changed (04 SG18). */
  steered: [];
  /** "Resume run" on L, E or the `resume_run` blind spot (J9). */
  "resume-rca": [runId: string];
  /** "Ask about this analysis" (J5): the hand-off payload for a new AI chat. */
  "ask-ai": [payload: RcaAskPayload];
}>();

const { t } = useI18nTyped();
const { isDark } = useTheme();
const store = useStore();
const timezone = useViewerTimezone();

/** AI chat is on for this user: the edition offers it and the server enabled it. */
const aiEnabled = computed(
  () =>
    checkFeatureAccess("aiAssistant", buildFeatureGateContext(store.state.zoConfig)).allowed &&
    Boolean(store.state.zoConfig?.ai_enabled),
);

const live = computed(() => isLiveRca(props.rca));
const currentRun = computed(() => props.rca?.current_run ?? null);

const {
  thread,
  status: threadStatus,
  retry: retryThread,
} = useRcaThread(
  toRef(props, "orgId"),
  toRef(props, "incidentId"),
  toRef(props, "threadRunId"),
  toRef(props, "threadLive"),
);

// The summary view of the same run, polled with the thread (03 §12).
const { summary, status: summaryStatus } = useRcaSummary(
  toRef(props, "orgId"),
  toRef(props, "incidentId"),
  toRef(props, "threadRunId"),
  toRef(props, "threadLive"),
);

/** The summary of a run with a record (live or stored); null for legacy runs and errors. */
const recordSummary = computed(() => {
  const current = summary.value;
  return current && !current.legacy && current.run_id === props.threadRunId ? current : null;
});

/** Evidence id → number for the thread's chips (03 VE24); null shows raw ids. */
const evidenceNumbers = computed(() => rcaEvidenceNumbers(recordSummary.value));

/**
 * The markdown report shows for a legacy run (VE42), when the summary of a
 * finished run cannot be read, and as the earlier result under a run that has
 * not finished (RR-42). A run with a record shows none (F1).
 */
const showReport = computed(() => {
  if (summary.value?.legacy) return true;
  if (cardState.value !== "analyzed") return earlierReportNote.value !== null;
  if (recordSummary.value) return false;
  return (
    summaryStatus.value !== "loading" &&
    summaryStatus.value !== "ready" &&
    summaryStatus.value !== "idle"
  );
});

const evidenceList = ref<InstanceType<typeof RcaEvidenceList> | null>(null);
const blindSpots = ref<InstanceType<typeof RcaBlindSpots> | null>(null);
const showBlindSpots = () =>
  (blindSpots.value?.$el as HTMLElement | undefined)?.scrollIntoView({
    block: "start",
    behavior: "smooth",
  });

// Ticks so the ages in the bar stay current: every second while live, else every 30 s.
const now = ref(Date.now());
let tickTimer: number | null = null;
watch(
  live,
  (isLive) => {
    if (tickTimer !== null) clearInterval(tickTimer);
    now.value = Date.now();
    tickTimer = window.setInterval(() => (now.value = Date.now()), isLive ? 1_000 : 30_000);
  },
  { immediate: true },
);
onUnmounted(() => {
  if (tickTimer !== null) clearInterval(tickTimer);
});

/** The card shows a picked completed run, else the latest run. */
const cardState = computed<RcaCardState>(() => {
  if (props.viewedRun) return "analyzed";
  switch (props.rca?.state) {
    case "running":
    case "waiting_input":
      return "investigating";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "analyzed";
  }
});

const cardRunId = computed(() => props.viewedRun?.run_id ?? props.rca?.run_id ?? "");

/** The latest run is paused for an answer (03 VE22); a picked run never is. */
const waitingInput = computed(() => !props.viewedRun && props.rca?.state === "waiting_input");

const findRun = (runId: string | null | undefined) =>
  runId ? (props.history.find((run) => run.run_id === runId) ?? null) : null;

/** Trigger + age of the shown run: "Auto on incident open · started 1m47s ago". */
const subtitle = computed<I18nText | string>(() => {
  const rca = props.rca;
  if (!rca) return "";
  const item = props.viewedRun ?? findRun(rca.run_id);
  const trigger = item
    ? rcaTriggerLabel(item.trigger, item.started_by)
    : currentRun.value
      ? rcaTriggerLabel(currentRun.value.trigger, currentRun.value.started_by)
      : null;
  const sinceMs = (us: number) => Math.max(0, now.value - us / 1000);
  let age: I18nText;
  if (props.viewedRun || rca.state === "completed") {
    const endedAt = (props.viewedRun ?? item)?.ended_at ?? rca.updated_at;
    age = t("alerts.incidents.rcaRun.analyzedAgo", { time: humanizeElapsed(sinceMs(endedAt)) });
  } else if (live.value) {
    age = t("alerts.incidents.rcaRun.startedAgo", {
      time: formatRcaElapsed(sinceMs(rca.started_at)),
    });
  } else if (rca.state === "cancelled") {
    age = t("alerts.incidents.rcaRun.stoppedAfter", { duration: runDuration.value });
  } else {
    const endedAt = currentRun.value?.ended_at ?? rca.updated_at;
    age = t("alerts.incidents.rcaRun.failedAgo", { time: humanizeElapsed(sinceMs(endedAt)) });
  }
  return trigger ? raw(`${trigger} · ${age}`) : age;
});

/** Run time of the latest run, from its stats or its timestamps. */
const runDuration = computed(() => {
  const rca = props.rca;
  if (!rca) return "";
  const endedAt = currentRun.value?.ended_at ?? rca.updated_at;
  const ms = currentRun.value?.stats?.duration_ms ?? (endedAt - rca.started_at) / 1000;
  return formatRcaDuration(ms);
});

// Names the report shown below while the latest run has none of its own (02 TH40 M, L, E).
const earlierReportNote = computed<I18nText | null>(() => {
  if (cardState.value === "analyzed") return null;
  const shown = props.reportRun;
  if (!shown || shown.run_id === props.rca?.run_id) return null;
  return t("alerts.incidents.rcaRun.earlierReportBelow", {
    time: formatTimestampInTimezone(shown.started_at, "HH:mm", "UTC"),
  });
});

const staleSince = computed(() => (props.rca ? formatRcaClock(props.rca.updated_at) : ""));

// E: "Cancelled by <user> at HH:MM:SS UTC after <duration>. <n> of <m> checks finished; …"
const cancelledText = computed<I18nText | null>(() => {
  const rca = props.rca;
  if (!rca || rca.state !== "cancelled") return null;
  const endedAt = currentRun.value?.ended_at ?? rca.updated_at;
  const time = formatTimestampInTimezone(endedAt, "HH:mm:ss", "UTC");
  const current = thread.value?.run_id === rca.run_id ? thread.value : null;
  // The summary can count a step the last thread read did not see yet.
  const total = Math.max(current?.steps.length ?? 0, rca.summary.steps);
  // Without a thread, the step that was open at the cancel is the one not counted.
  const done = current ? finishedStepCount(current) : Math.max(total - 1, 0);
  const user = currentRun.value?.cancelled_by ?? rca.summary.cancelled_by;
  const values = { time, duration: runDuration.value, done, total };
  return user
    ? t("alerts.incidents.rcaRun.cancelledByChecks", { ...values, user: userLocalPart(user) })
    : t("alerts.incidents.rcaRun.cancelledAtChecks", values);
});

const formattedReport = computed(() => (props.reportText ? renderRcaReport(props.reportText) : ""));

// The thread column describes the thread's run, which is not always the latest.
const threadRunState = computed<RcaRunState | null>(() => {
  if (!props.threadRunId) return null;
  if (props.threadRunId === props.rca?.run_id) return props.rca.state;
  return findRun(props.threadRunId)?.state ?? null;
});

const threadTriggerLabel = computed<I18nText | null>(() => {
  const item = findRun(props.threadRunId);
  if (item) return rcaTriggerLabel(item.trigger, item.started_by);
  const run = currentRun.value;
  return run && run.run_id === props.threadRunId
    ? rcaTriggerLabel(run.trigger, run.started_by)
    : null;
});

const threadContextUsed = computed<RcaContextUsed | null>(() => {
  const run = currentRun.value;
  return run && run.run_id === props.threadRunId ? (run.context_used ?? null) : null;
});

// The run's own stats keep the stats line when the thread has none (legacy, 410, 503).
const threadRunStats = computed<RcaRunStats | null>(() => {
  const run = currentRun.value;
  return run && run.run_id === props.threadRunId ? (run.stats ?? null) : null;
});

const threadColumn = ref<InstanceType<typeof RcaThreadColumn> | null>(null);
const followThread = () => void threadColumn.value?.scrollToLatest();

// Steering (04 SG37–SG40, H16): the rows, the open question and `can_steer` of
// the thread's run, polled with the thread.
const {
  steering,
  sending: steerSending,
  send: steer,
} = useRcaSteering(
  toRef(props, "orgId"),
  toRef(props, "incidentId"),
  toRef(props, "threadRunId"),
  toRef(props, "threadLive"),
);

const authorEmail = computed<string>(() => store.state.userInfo?.email ?? "");

/** The latest run is shown and live, and the server lets this user steer it (SG37). */
const canSteer = computed(
  () =>
    !props.viewedRun &&
    live.value &&
    props.threadRunId === props.rca?.run_id &&
    steering.value?.can_steer === true,
);

const afterSend = (runState: RcaRunState) => {
  // An answer resumes a paused run: re-read the detail so the card leaves frame D.
  if (runState !== props.rca?.state) emit("steered");
};

const sendMessage = async (text: string) => {
  const result = await steer({ text, kind: "message" });
  if (result.ok) afterSend(result.runState);
  return result;
};

const sendHypothesisAction = async (request: { hypothesisId: string; action: RcaSteerAction }) => {
  // The server writes the text of an action (SG31).
  const result = await steer({
    text: "",
    kind: "hypothesis_action",
    action: request.action,
    hypothesis_id: request.hypothesisId,
  });
  if (result.ok) afterSend(result.runState);
  else toast({ variant: "error", message: result.message });
};

const pendingActions = computed(() => rcaPendingHypothesisActions(steering.value?.items ?? []));

/** The thread of the latest run, when that is the thread shown. */
const latestThread = computed(() =>
  thread.value && thread.value.run_id === props.rca?.run_id ? thread.value : null,
);

/** Frame D: the step the paused run stopped after. */
const pausedStep = computed(() =>
  waitingInput.value ? (latestThread.value?.steps.at(-1)?.title ?? null) : null,
);

const pausedQuestion = computed(() => {
  if (!waitingInput.value) return null;
  return (
    steering.value?.open_question?.question ??
    latestThread.value?.questions?.at(-1)?.question ??
    null
  );
});

/** SG39: the answer deadline in the viewer's local time. */
const deadlineText = computed(() => {
  if (!waitingInput.value) return null;
  const deadline = steering.value?.open_question?.deadline_at ?? props.rca?.summary.deadline_at;
  return deadline ? formatTimestampInTimezone(deadline, "HH:mm", timezone.value) : null;
});

/** Frame G: "Unblocked by <author> at <time>" from the newest read answer (SG39). */
const unblocked = computed<RcaUnblockedLine | null>(() => {
  if (cardState.value !== "analyzed") return null;
  const answer = rcaUnblockingAnswer(steering.value?.items ?? []);
  if (!answer?.read_at) return null;
  const author = (props.viewedRun ? null : props.rca?.summary.unblocked_by) ?? answer.author_email;
  const question = thread.value?.questions?.find((q) => q.question_id === answer.question_id);
  return {
    author: userLocalPart(author),
    time: formatTimestampInTimezone(answer.read_at, "HH:mm", timezone.value),
    need: rcaNeedSubject(question?.need),
  };
});

// Frame I: "Re-analyze with guidance", from the menu or a message the run did not take (SG40).
const guidanceOpen = ref(false);
const guidanceText = ref("");
const openGuidance = (text: string) => {
  guidanceText.value = text;
  guidanceOpen.value = true;
};

const copyText = async (text: string, success: I18nText, failure: I18nText) => {
  try {
    await navigator.clipboard.writeText(text);
    toast({ variant: "success", message: success });
  } catch (error) {
    console.error("Failed to copy to the clipboard:", error);
    toast({ variant: "error", message: failure });
  }
};

const copyReport = () => {
  if (!props.reportText) return;
  void copyText(
    props.reportText,
    t("alerts.incidents.rcaCopied"),
    t("alerts.incidents.rcaCopyFailed"),
  );
};

const downloadReport = () => {
  if (!props.reportText) return;
  const blob = new Blob([props.reportText], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `incident-${props.incidentId}-rca.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Copy thread (02 TH38): steps, questions and responder messages as plain text.
const copyThread = () => {
  const current = thread.value;
  if (!current || current.transcript !== "available") return;
  const items = (steering.value?.items ?? []).filter((item) => item.run_id === current.run_id);
  void copyText(
    rcaThreadPlainText(current, t("alerts.incidents.rcaThread.title"), items),
    t("alerts.incidents.rcaThread.copied"),
    t("alerts.incidents.rcaThread.copyFailed"),
  );
};

// J9: the drawer owns the request and the toast; the target may be the latest
// run's source when the latest is a resume that never ran.
const resumeLatest = () => {
  if (props.resumeRunId) emit("resume-rca", props.resumeRunId);
};

// J5: Ask is about the run whose record shows, else the run whose report shows.
const displayedRunId = computed(() => props.viewedRun?.run_id ?? props.reportRun?.run_id ?? null);
const askRun = computed<RcaRunItem | null>(() => {
  if (recordSummary.value) return findRun(recordSummary.value.run_id);
  return props.reportText ? findRun(displayedRunId.value) : null;
});

const canAsk = computed(() => aiEnabled.value && askRun.value !== null);

const ask = () => {
  const run = askRun.value;
  if (!run) return;
  const index = props.history.findIndex((item) => item.run_id === run.run_id);
  const runLabel = t("alerts.incidents.rcaRun.runAt", {
    number: props.history.length - index,
    time: formatTimestampInTimezone(run.started_at, "MMM D, HH:mm", "UTC"),
  });
  const query = buildRcaAskAttachment({
    incidentId: props.incidentId,
    incidentTitle: props.incidentTitle || null,
    runLabel,
    run,
    summary: recordSummary.value?.run_id === run.run_id ? recordSummary.value : null,
    // The loaded report belongs to the displayed run only.
    report: displayedRunId.value === run.run_id ? props.reportText : "",
  });
  emit("ask-ai", {
    query,
    chipName: t("alerts.incidents.rcaAsk.chip", { run: runLabel }),
    newChat: true,
    autoSend: false,
    // No incident or run keys: they would route the chat to the RCA agent (J5).
    context: { currentPage: "incidents", org_id: props.orgId },
  });
};
</script>
