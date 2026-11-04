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
  <!-- Nothing ran yet. -->
  <div
    v-if="!rca"
    data-test="rca-analysis-container"
    class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-7 pt-4 pb-10"
  >
    <RcaBlockedBanner
      v-if="refusal"
      class="max-w-215"
      :refusal="refusal"
      :retrying="triggering"
      @retry="$emit('trigger-rca', refusal.retry ?? { buildOnPrevious: false })"
    />
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
      <div class="flex flex-wrap items-center gap-2">
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
        <span
          v-if="analyzeCreditCost"
          data-test="rca-credit-cost"
          class="text-text-secondary text-xs"
        >
          {{ t("alerts.incidents.rcaCreditCost", { cost: analyzeCreditCost }, analyzeCreditCost) }}
        </span>
      </div>
    </section>
  </div>

  <div
    v-else
    data-test="rca-analysis-container"
    class="flex min-h-0 flex-1 flex-col overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:overflow-hidden"
  >
    <div class="flex min-w-0 flex-col gap-6 px-7 pt-4 pb-10 lg:overflow-auto">
      <RcaAnalysisBar
        :runs="history"
        :latest-run-id="rca.run_id"
        :selected-run-id="cardRunId"
        :live="live"
        :subtitle="subtitle"
        :has-report="!!ownReport"
        :has-thread="!!thread && thread.transcript === 'available'"
        :can-ask="canAsk"
        :triggering="triggering"
        :resuming="resuming"
        :cancelling="cancelling"
        @select-run="$emit('view-run', $event)"
        @reanalyze="openGuidance('')"
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
        :live-resume-step="liveResumeStep"
        :failed-mode="viewedRun?.mode ?? currentRun?.mode ?? null"
        :has-earlier-report="hasEarlierReport"
        :error="cardError"
        :verdict-details="ownVerdict"
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
        :refusal="refusal"
        :reanalyze-credit-cost="reanalyzeCreditCost"
        @cancel="$emit('cancel-rca')"
        @follow-thread="followThread"
        @retry="$emit('trigger-rca', $event)"
        @show-unverified="evidenceList?.showUnverified()"
        @show-blind-spots="showBlindSpots"
        @tell-agent="threadColumn?.focusComposer()"
        @resume="resumeLatest"
      />

      <template v-if="recordSummary">
        <RcaWhatHappened
          v-if="cardState === 'investigating' || cardState === 'analyzed'"
          :timeline="recordSummary.timeline"
          :evidence="recordSummary.evidence"
          :hypotheses="recordSummary.hypotheses"
          :org="orgId"
          :live="cardState === 'investigating'"
          @open-hypothesis="hypothesesSection?.showHypothesis($event)"
        />
        <RcaHypotheses
          ref="hypothesesSection"
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
        <RcaEvidenceList
          ref="evidenceList"
          :evidence="recordSummary.evidence"
          :unverified="recordSummary.unverified"
          :hypotheses="recordSummary.hypotheses"
          :org="orgId"
          @open-hypothesis="hypothesesSection?.showHypothesis($event)"
        />
        <RcaBlindSpots
          ref="blindSpots"
          :blind-spots="recordSummary.blind_spots"
          :org="orgId"
          :live="cardState === 'investigating'"
          :can-resume="canResumeThreadRun"
          :resuming="resuming"
          :triggering="triggering"
          @resume="resumeLatest"
        />
        <RcaProposedActions v-if="proposedActions.length" :actions="proposedActions" />
        <!-- The shown run's markdown, collapsed under its structured record. -->
        <OCollapsible
          v-if="showFullReport"
          data-test="rca-full-report"
          trigger-class="-mx-2 w-[calc(100%+1rem)]!"
        >
          <template #trigger="{ open }">
            <span class="text-text-heading flex-1 text-base font-bold">
              {{ t("alerts.incidents.rcaRun.fullReport") }}
            </span>
            <OIcon
              name="expand-more"
              size="md"
              class="text-collapsible-icon transition-transform duration-200"
              :class="open ? 'rotate-180' : 'rotate-0'"
            />
          </template>
          <p
            v-if="ownReportLoading && !ownReport"
            data-test="rca-full-report-loading"
            class="text-text-secondary m-0 flex items-center gap-2 pt-2 text-sm"
          >
            <OSpinner variant="dots" size="xs" />
            {{ t("alerts.incidents.rcaRun.loadingReport") }}
          </p>
          <RcaReportContent
            v-else
            data-test="rca-full-report-content"
            class="max-w-215 pt-2"
            :html="formattedReport"
            :is-dark-mode="isDark"
          />
        </OCollapsible>
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
          v-if="ownReportLoading && !ownReport"
          data-test="rca-report-loading"
          class="text-text-secondary m-0 flex items-center gap-2 text-sm"
        >
          <OSpinner variant="dots" size="xs" />
          {{ t("alerts.incidents.rcaRun.loadingReport") }}
        </p>
        <RcaReportContent
          v-else-if="ownReport"
          data-test="rca-existing-container"
          class="max-w-215"
          :html="formattedReport"
          :is-dark-mode="isDark"
        />
      </template>
      <p
        v-if="cardState === 'investigating' && !recordSummary"
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
      :can-resume="canResumeThreadRun"
      :trigger-label="threadTriggerLabel"
      :context-used="threadContextUsed"
      :run-stats="threadRunStats"
      :no-transcript="threadRunIsV1"
      :evidence-numbers="evidenceNumbers"
      :steering="steering"
      :steering-status="steeringStatus"
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
      :latest-run-id="rca.run_id"
      :credit-cost="reanalyzeCreditCost"
      @start="$emit('trigger-rca', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, toRef, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  RcaContextUsed,
  RcaRunError,
  RcaRunItem,
  RcaRunState,
  RcaRunStats,
  RcaRunSummary,
  RcaSteerAction,
  RcaSteering,
  RcaSummary,
  RcaThread,
  RcaVerdictDetails,
} from "@/services/incidents";
import type { RcaReadStatus, RcaRefusal } from "@/composables/useIncidentRca";
import { useRcaSteering } from "@/composables/useRcaSteering";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { formatTimestampInTimezone } from "@/utils/date";
import {
  formatRcaLocalClock,
  humanizeElapsed,
  isLiveRca,
  userLocalPart,
} from "@/utils/incidents/rcaCell";
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
import RcaBlockedBanner from "./rca/RcaBlockedBanner.vue";
import RcaBlindSpots from "./rca/RcaBlindSpots.vue";
import RcaEvidenceList from "./rca/RcaEvidenceList.vue";
import RcaHypotheses from "./rca/RcaHypotheses.vue";
import RcaProposedActions from "./rca/RcaProposedActions.vue";
import RcaThreadColumn from "./rca/RcaThreadColumn.vue";
import RcaGuidanceDialog from "./rca/RcaGuidanceDialog.vue";
import RcaVerdictCard from "./rca/RcaVerdictCard.vue";
import RcaWhatHappened from "./rca/RcaWhatHappened.vue";
import RcaReportContent from "./rca/RcaReportContent.vue";
import { useTheme } from "@/composables/useTheme";
import { buildRcaAskAttachment, type RcaAskPayload } from "@/utils/incidents/rcaAskAttachment";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";

const props = withDefaults(
  defineProps<{
    orgId: string;
    incidentId: string;
    /** Run summary of the latest run with the detail fields, or null when none ran. */
    rca: RcaSummary | null;
    /** Newest completed run; its report shows for that run only, never under a later run. */
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
    /** Impacted services and proposed actions of the shown report's stored verdict. */
    reportVerdict?: RcaVerdictDetails | null;
    reportLoading?: boolean;
    /** The run whose thread shows: the picked run, else the latest. */
    threadRunId?: string | null;
    /** The thread's run is the latest and live. */
    threadLive?: boolean;
    /** The thread's run is a pre-upgrade report with no thread, record or steering. */
    threadRunIsV1?: boolean;
    /** The thread, summary and steering of the thread's run, from the live stream. */
    thread?: RcaThread | null;
    threadStatus?: RcaReadStatus;
    runSummary?: RcaRunSummary | null;
    runSummaryStatus?: RcaReadStatus;
    steering?: RcaSteering | null;
    steeringStatus?: RcaReadStatus;
    triggering?: boolean;
    cancelling?: boolean;
    resumeRunId?: string | null;
    resuming?: boolean;
    /** The incident's title, for the Ask attachment header. */
    incidentTitle?: string;
    /** A refused trigger or resume (AI credits, paid usage declined); no run records it. */
    refusal?: RcaRefusal | null;
    /** AI credits an analysis and a re-analysis use; unset outside cloud, where no cost shows. */
    analyzeCreditCost?: number | null;
    reanalyzeCreditCost?: number | null;
  }>(),
  {
    reportRun: null,
    viewedRun: null,
    history: () => [],
    stale: false,
    error: null,
    reportText: "",
    reportVerdict: null,
    reportLoading: false,
    threadRunId: null,
    threadLive: false,
    threadRunIsV1: false,
    thread: null,
    threadStatus: "idle",
    runSummary: null,
    runSummaryStatus: "idle",
    steering: null,
    steeringStatus: "idle",
    triggering: false,
    cancelling: false,
    resumeRunId: null,
    resuming: false,
    incidentTitle: "",
    refusal: null,
    analyzeCreditCost: null,
    reanalyzeCreditCost: null,
  },
);

const emit = defineEmits<{
  "trigger-rca": [options: { buildOnPrevious: boolean; guidance?: string }];
  "cancel-rca": [];
  "view-run": [runId: string | null];
  /** "Try again" on a thread that could not be read: reconnect the live stream. */
  "retry-live": [];
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
/** Step a resumed live run restarted from. */
const liveResumeStep = computed(() =>
  currentRun.value?.trigger === "resume"
    ? (currentRun.value.context_used?.resumed_from?.from_step.title ?? null)
    : null,
);

const findRun = (runId: string | null | undefined) =>
  runId ? (props.history.find((run) => run.run_id === runId) ?? null) : null;

const threadRunIsV1 = toRef(props, "threadRunIsV1");

// The run-scoped routes answer 404 for a v1 run, so a v1 run takes no steering.
const recordRunId = computed(() => (threadRunIsV1.value ? null : props.threadRunId));

const thread = toRef(props, "thread");
const threadStatus = toRef(props, "threadStatus");
const summary = toRef(props, "runSummary");
const summaryStatus = toRef(props, "runSummaryStatus");
const retryThread = () => emit("retry-live");

/** The summary of a run with a record (live or stored); null for legacy runs and errors. */
const recordSummary = computed(() => {
  const current = summary.value;
  return current && !current.legacy && current.run_id === props.threadRunId ? current : null;
});

/** Evidence id → number for the thread's chips; null shows raw ids. */
const evidenceNumbers = computed(() => rcaEvidenceNumbers(recordSummary.value));

/** The markdown takes the place of the record: v1 runs, legacy runs, and unreadable summaries. */
const showReport = computed(() => {
  if (cardState.value !== "analyzed") return false;
  if (summary.value?.legacy || threadRunIsV1.value) return true;
  if (recordSummary.value) return false;
  return (
    summaryStatus.value !== "loading" &&
    summaryStatus.value !== "ready" &&
    summaryStatus.value !== "idle"
  );
});

/** A finished run with a record keeps its markdown in a collapsed "Full report". */
const showFullReport = computed(
  () =>
    cardState.value === "analyzed" &&
    recordSummary.value !== null &&
    (!!ownReport.value || ownReportLoading.value),
);

const hypothesesSection = ref<InstanceType<typeof RcaHypotheses> | null>(null);
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

/** The card shows a run picked from the history in its own state, else the latest run. */
const cardState = computed<RcaCardState>(() => {
  // A picked run is never the latest, so it is never live.
  switch (props.viewedRun?.state ?? props.rca?.state) {
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

/** The failure of the shown run: a picked failed run carries only its reason. */
const cardError = computed<RcaRunError | null>(() => {
  const viewed = props.viewedRun;
  if (!viewed) return props.error;
  if (viewed.state !== "failed") return null;
  return { code: "", reason: viewed.error_reason ?? "", details: null, trigger_type: null };
});

const cardRunId = computed(() => props.viewedRun?.run_id ?? props.rca?.run_id ?? "");

/** The loaded report belongs to the shown run; an earlier run's report never shows for it. */
const ownsReport = computed(() => (props.viewedRun ?? props.reportRun)?.run_id === cardRunId.value);
const ownReport = computed(() => (ownsReport.value ? props.reportText : ""));
const ownReportLoading = computed(() => ownsReport.value && props.reportLoading);
/** The shown completed run's impacted services and proposed actions (inert text). */
const ownVerdict = computed(() =>
  ownsReport.value && cardState.value === "analyzed" ? props.reportVerdict : null,
);
/** A graded run's proposed actions. */
const proposedActions = computed(() =>
  recordSummary.value?.card.outcome ? (ownVerdict.value?.proposedActions ?? []) : [],
);

/** The latest run is paused for an answer; a picked run never is. */
const waitingInput = computed(() => !props.viewedRun && props.rca?.state === "waiting_input");

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
  const shown = props.viewedRun ?? item;
  let age: I18nText;
  if (cardState.value === "analyzed") {
    const endedAt = shown?.ended_at ?? rca.updated_at;
    age = t("alerts.incidents.rcaRun.analyzedAgo", { time: humanizeElapsed(sinceMs(endedAt)) });
  } else if (live.value && !props.viewedRun) {
    age = t("alerts.incidents.rcaRun.startedAgo", {
      time: formatRcaElapsed(sinceMs(rca.started_at)),
    });
  } else if (cardState.value === "cancelled") {
    age = t("alerts.incidents.rcaRun.stoppedAfter", { duration: runDuration.value });
  } else {
    const endedAt = props.viewedRun
      ? (props.viewedRun.ended_at ?? props.viewedRun.started_at)
      : (currentRun.value?.ended_at ?? rca.updated_at);
    age = t("alerts.incidents.rcaRun.failedAgo", { time: humanizeElapsed(sinceMs(endedAt)) });
  }
  return trigger ? raw(`${trigger} · ${age}`) : age;
});

/** Run time of the shown run, from its stats (latest run only) or its timestamps. */
const runDuration = computed(() => {
  const viewed = props.viewedRun;
  if (viewed) {
    return formatRcaDuration(((viewed.ended_at ?? viewed.started_at) - viewed.started_at) / 1000);
  }
  const rca = props.rca;
  if (!rca) return "";
  const endedAt = currentRun.value?.ended_at ?? rca.updated_at;
  const ms = currentRun.value?.stats?.duration_ms ?? (endedAt - rca.started_at) / 1000;
  return formatRcaDuration(ms);
});

// A re-run follows a completed run: the banners offer its modes. A picked
// run is not a re-run in progress, so it never offers them.
const hasEarlierReport = computed(() => {
  if (cardState.value === "analyzed" || props.viewedRun) return false;
  const shown = props.reportRun;
  return !!shown && shown.run_id !== props.rca?.run_id;
});

const staleSince = computed(() => (props.rca ? formatRcaClock(props.rca.updated_at) : ""));

// "Cancelled by <user> at HH:MM:SS UTC after <duration>. <n> of <m> checks finished; …"
const cancelledText = computed<I18nText | null>(() => {
  const rca = props.rca;
  if (!rca || cardState.value !== "cancelled") return null;
  const viewed = props.viewedRun;
  const runId = viewed?.run_id ?? rca.run_id;
  const endedAt = viewed
    ? (viewed.ended_at ?? viewed.started_at)
    : (currentRun.value?.ended_at ?? rca.updated_at);
  const time = formatTimestampInTimezone(endedAt, "HH:mm:ss", "UTC");
  const current = thread.value?.run_id === runId ? thread.value : null;
  // The summary can count a step the last thread read did not see yet; it describes the latest run.
  const total = Math.max(current?.steps.length ?? 0, viewed ? 0 : rca.summary.steps);
  // Without a thread: the latest run's stored Resume count, else all but the step open at the cancel.
  const done = current
    ? finishedStepCount(current)
    : viewed
      ? 0
      : (rca.summary.reusable_steps ?? Math.max(total - 1, 0));
  const user = viewed
    ? viewed.cancelled_by
    : (currentRun.value?.cancelled_by ?? rca.summary.cancelled_by);
  const values = { time, duration: runDuration.value, done, total };
  return user
    ? t("alerts.incidents.rcaRun.cancelledByChecks", { ...values, user: userLocalPart(user) })
    : t("alerts.incidents.rcaRun.cancelledAtChecks", values);
});

const formattedReport = computed(() => (ownReport.value ? renderRcaReport(ownReport.value) : ""));

// The thread column describes the thread's run, which is not always the latest.
const threadRunState = computed<RcaRunState | null>(() => {
  if (!props.threadRunId) return null;
  if (props.threadRunId === props.rca?.run_id) return props.rca.state;
  return findRun(props.threadRunId)?.state ?? null;
});

/** The thread shows the latest run and Resume can continue it. */
const canResumeThreadRun = computed(
  () => !!props.resumeRunId && !props.viewedRun && props.threadRunId === props.rca?.run_id,
);

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

// Steering: the rows, the open question and `can_steer` of the thread's run.
// A sent row and a resumed run arrive on the live stream.
const steering = toRef(props, "steering");
const { sending: steerSending, send: steer } = useRcaSteering(
  toRef(props, "orgId"),
  toRef(props, "incidentId"),
  recordRunId,
);

const authorEmail = computed<string>(() => store.state.userInfo?.email ?? "");

/** The latest run is shown and live, and the server lets this user steer it. */
const canSteer = computed(
  () =>
    !props.viewedRun &&
    live.value &&
    props.threadRunId === props.rca?.run_id &&
    steering.value?.can_steer === true,
);

const sendMessage = (text: string) => steer({ text, kind: "message" });

const sendHypothesisAction = async (request: { hypothesisId: string; action: RcaSteerAction }) => {
  // The server writes the text of an action.
  const result = await steer({
    text: "",
    kind: "hypothesis_action",
    action: request.action,
    hypothesis_id: request.hypothesisId,
  });
  if (!result.ok) toast({ variant: "error", message: result.message });
};

const pendingActions = computed(() => rcaPendingHypothesisActions(steering.value?.items ?? []));

/** The thread of the latest run, when that is the thread shown. */
const latestThread = computed(() =>
  thread.value && thread.value.run_id === props.rca?.run_id ? thread.value : null,
);

/** The step the paused run stopped after. */
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

/** The answer deadline in the viewer's local time, with its zone. */
const deadlineText = computed(() => {
  if (!waitingInput.value) return null;
  const deadline = steering.value?.open_question?.deadline_at ?? props.rca?.summary.deadline_at;
  return deadline ? formatRcaLocalClock(deadline, timezone.value) : null;
});

/** "Unblocked by <author> at <time> <zone>" from the newest read answer, in local time. */
const unblocked = computed<RcaUnblockedLine | null>(() => {
  if (cardState.value !== "analyzed") return null;
  const answer = rcaUnblockingAnswer(steering.value?.items ?? []);
  if (!answer?.read_at) return null;
  const author = (props.viewedRun ? null : props.rca?.summary.unblocked_by) ?? answer.author_email;
  const question = thread.value?.questions?.find((q) => q.question_id === answer.question_id);
  return {
    author: userLocalPart(author),
    time: formatRcaLocalClock(answer.read_at, timezone.value),
    need: rcaNeedSubject(question?.need),
  };
});

// Re-analyze, from the bar or with a message the run did not take.
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
  if (!ownReport.value) return;
  void copyText(
    ownReport.value,
    t("alerts.incidents.rcaCopied"),
    t("alerts.incidents.rcaCopyFailed"),
  );
};

const downloadReport = () => {
  if (!ownReport.value) return;
  const blob = new Blob([ownReport.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  // The run is in the name, as the selector numbers it, so downloads of different runs do not collide.
  const index = props.history.findIndex((run) => run.run_id === cardRunId.value);
  const run = index < 0 ? cardRunId.value : `run-${props.history.length - index}`;
  link.download = `incident-${props.incidentId}-rca-${run}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Copy thread: steps, questions and responder messages as plain text.
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
