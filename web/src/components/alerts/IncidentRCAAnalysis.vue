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

<!-- The Analysis tab (contract E5): a left analysis column (analysis bar, verdict
     card, report) and the right "Investigation thread" column (02 TH38). -->
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
        :triggering="triggering"
        :cancelling="cancelling"
        @select-run="$emit('view-run', $event)"
        @reanalyze="$emit('trigger-rca', $event)"
        @cancel="$emit('cancel-rca')"
        @copy-report="copyReport"
        @download-report="downloadReport"
        @copy-thread="copyThread"
      />

      <RcaVerdictCard
        :card-state="cardState"
        :run-id="cardRunId"
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
        @cancel="$emit('cancel-rca')"
        @follow-thread="followThread"
        @retry="$emit('trigger-rca', $event)"
      />

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
      <p
        v-else-if="live && !reportRun"
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
      @retry="retryThread"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, toRef, watch } from "vue";
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
  RcaSummary,
} from "@/services/incidents";
import { useRcaThread } from "@/composables/useRcaThread";
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
import RcaAnalysisBar from "./rca/RcaAnalysisBar.vue";
import RcaThreadColumn from "./rca/RcaThreadColumn.vue";
import RcaVerdictCard from "./rca/RcaVerdictCard.vue";
import RcaReportContent from "./rca/RcaReportContent.vue";
import { useTheme } from "@/composables/useTheme";

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
  },
);

defineEmits<{
  "trigger-rca": [options: { buildOnPrevious: boolean }];
  "cancel-rca": [];
  "view-run": [runId: string | null];
}>();

const { t } = useI18nTyped();
const { isDark } = useTheme();

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

// Copy thread (02 TH38): step titles, notes, tool names and key arguments as plain text.
const copyThread = () => {
  const current = thread.value;
  if (!current || current.transcript !== "available") return;
  void copyText(
    rcaThreadPlainText(current, t("alerts.incidents.rcaThread.title")),
    t("alerts.incidents.rcaThread.copied"),
    t("alerts.incidents.rcaThread.copyFailed"),
  );
};
</script>
