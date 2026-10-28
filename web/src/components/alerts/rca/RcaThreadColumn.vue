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
  <aside
    data-test="rca-thread-column"
    class="border-border-default bg-surface-panel flex min-h-0 flex-none flex-col border-t max-lg:h-144 lg:h-full lg:border-s lg:border-t-0"
    :aria-label="t('alerts.incidents.rcaThread.title')"
  >
    <header
      class="border-border-default bg-surface-base flex flex-none flex-col gap-1 border-b px-4 pt-3.5 pb-3"
    >
      <div class="flex items-center gap-2">
        <OIcon name="forum" size="sm" class="text-accent" />
        <h2 class="text-text-heading m-0 text-sm font-bold">
          {{ t("alerts.incidents.rcaThread.title") }}
        </h2>
        <OBadge
          v-if="runLive"
          data-test="rca-thread-live-pill"
          variant="success-soft"
          size="xs"
          dot
        >
          {{ t("alerts.incidents.rcaThread.live") }}
        </OBadge>
        <OBadge
          v-else-if="thread"
          data-test="rca-thread-saved-pill"
          variant="default-soft"
          size="xs"
        >
          {{ t("alerts.incidents.rcaThread.saved") }}
        </OBadge>
        <span class="flex-1" />
        <span
          v-if="thread?.transcript === 'available'"
          data-test="rca-thread-step-count"
          class="text-text-secondary text-xs"
        >
          {{
            t(
              "alerts.incidents.rcaThread.stepCount",
              { count: thread.steps.length },
              thread.steps.length,
            )
          }}
        </span>
      </div>
      <p
        v-if="statsLine"
        data-test="rca-thread-stats"
        class="text-text-secondary text-2xs m-0 font-mono"
      >
        {{ statsLine }}
      </p>
    </header>

    <div ref="scrollArea" class="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 py-3.5">
      <p
        v-if="status === 'loading'"
        data-test="rca-thread-loading"
        class="text-text-secondary text-compact m-0 flex items-center gap-2"
      >
        <OSpinner size="xs" />
        {{ t("alerts.incidents.rcaThread.loading") }}
      </p>

      <div
        v-else-if="emptyMessage"
        data-test="rca-thread-empty"
        class="text-text-secondary text-compact flex flex-col items-start gap-2"
      >
        <p class="m-0 flex items-start gap-2">
          <OIcon name="info" size="sm" class="mt-0.5 shrink-0" />
          {{ emptyMessage }}
        </p>
        <!-- A live run retries on its own poll; a finished run needs the user. -->
        <OButton
          v-if="status === 'unavailable' && !runLive"
          data-test="rca-thread-retry-btn"
          variant="outline"
          size="sm"
          icon-left="refresh"
          @click="$emit('retry')"
        >
          {{ t("common.retry") }}
        </OButton>
      </div>

      <p
        v-else-if="!thread && runLive"
        data-test="rca-thread-working"
        role="status"
        class="text-text-secondary text-compact m-0 flex items-center gap-2"
      >
        <OSpinner size="xs" />
        {{ t("alerts.incidents.rcaThread.working") }}
      </p>

      <ol v-else-if="thread" class="m-0 flex list-none flex-col gap-3.5 p-0">
        <li
          v-if="thread.truncated"
          data-test="rca-thread-truncated"
          class="text-text-secondary text-compact flex items-start gap-2"
        >
          <OIcon name="info" size="sm" class="mt-0.5 shrink-0" />
          {{ t("alerts.incidents.rcaThread.transcriptTruncated") }}
        </li>
        <!-- Start entry: trigger, time, the prompt, and the leads it was given. -->
        <li
          v-if="thread.started"
          data-test="rca-thread-start"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2.5"
        >
          <span class="flex h-5 items-center justify-center">
            <OIcon name="play-circle" size="sm" class="text-text-secondary" />
          </span>
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex min-w-0 items-baseline gap-2">
              <span class="text-text-heading text-compact shrink-0 font-bold">
                {{ t("alerts.incidents.rcaThread.analysisStarted") }}
              </span>
              <span
                v-if="triggerLabel"
                data-test="rca-thread-start-trigger"
                class="text-text-secondary min-w-0 flex-1 truncate text-xs"
              >
                {{ triggerLabel }}
              </span>
              <span v-else class="flex-1" />
              <span class="text-text-secondary text-2xs shrink-0 font-mono">
                {{ formatRcaClock(thread.started.at) }}
              </span>
            </div>
            <p
              v-if="thread.started.prompt"
              data-test="rca-thread-start-prompt"
              class="text-text-body text-compact m-0 line-clamp-3 break-words"
            >
              {{ thread.started.prompt }}
            </p>

            <template v-if="contextSummary">
              <button
                type="button"
                data-test="rca-thread-context-toggle"
                class="text-text-body flex cursor-pointer items-center gap-1 self-start border-none bg-transparent p-0 text-xs font-semibold"
                :aria-expanded="contextOpen"
                :aria-controls="contextPanelId"
                @click="contextOpen = !contextOpen"
              >
                <OIcon :name="contextOpen ? 'expand-less' : 'expand-more'" size="sm" />
                {{ contextSummary }}
              </button>
              <div
                v-if="contextOpen"
                :id="contextPanelId"
                data-test="rca-thread-context"
                class="rounded-default border-border-default bg-surface-base flex flex-col gap-1.5 border px-3 py-2.5"
              >
                <OBadge variant="default-outline" size="xs" class="self-start">
                  {{ t("alerts.incidents.rcaThread.leadsNotEvidence") }}
                </OBadge>
                <p
                  v-for="(item, idx) in contextItems"
                  :key="idx"
                  class="text-text-body m-0 text-xs break-words"
                >
                  <span class="text-text-heading font-semibold">{{ item.name }}</span>
                  · {{ item.group }}
                </p>
              </div>
            </template>
          </div>
        </li>

        <template v-for="entry in entries" :key="entry.key">
          <RcaThreadStep
            v-if="entry.kind === 'step'"
            :step="entry.step"
            :run-live="runLive"
            :run-waiting="runWaiting"
            :finished="!unfinishedSteps.has(entry.step)"
            :evidence-numbers="evidenceNumbers"
            @open-evidence="$emit('open-evidence', $event)"
          />

          <!-- "Needs input": the agent's question and whether it was answered. -->
          <li
            v-else-if="entry.kind === 'question'"
            data-test="rca-thread-question"
            class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2.5"
          >
            <span class="flex h-5 items-center justify-center">
              <OIcon name="help-outline" size="sm" class="text-status-warning-text" />
            </span>
            <div
              class="rounded-default bg-surface-tint-warning flex min-w-0 flex-col gap-1 px-3 py-2"
            >
              <div class="flex min-w-0 items-baseline gap-2">
                <span class="text-text-heading text-compact min-w-0 flex-1 font-bold">
                  {{ t("alerts.incidents.rcaSteer.needsInput") }}
                </span>
                <span
                  v-if="entry.question.at !== null"
                  class="text-text-secondary text-2xs shrink-0 font-mono"
                >
                  {{ formatRcaClock(entry.question.at) }}
                </span>
              </div>
              <p class="text-text-body text-compact m-0 break-words whitespace-pre-wrap">
                {{ entry.question.question }}
              </p>
              <p
                v-if="questionStatus(entry.question)"
                data-test="rca-thread-question-status"
                class="text-text-heading m-0 text-xs font-bold"
              >
                {{ questionStatus(entry.question) }}
              </p>
            </div>
          </li>

          <!-- A responder's message: right-side bubble with its pill. -->
          <li
            v-else
            data-test="rca-thread-steer"
            :data-status="entry.item.status"
            :data-kind="entry.item.kind"
            class="flex flex-col items-end gap-1 ps-8"
          >
            <div class="flex max-w-full flex-wrap items-center justify-end gap-1.5">
              <OBadge
                data-test="rca-thread-steer-pill"
                :variant="steerPillVariant(entry.item)"
                size="xs"
              >
                {{ rcaSteerStatusLabel(entry.item) }}
              </OBadge>
              <OBadge
                v-if="entry.item.kind === 'answer'"
                data-test="rca-thread-steer-lead"
                variant="default-outline"
                size="xs"
              >
                {{ t("alerts.incidents.rcaSteer.pill.leadNotEvidence") }}
              </OBadge>
              <span class="text-text-heading truncate text-xs font-bold">
                {{ userLocalPart(entry.item.author_email) }}
              </span>
              <span class="text-text-secondary text-2xs shrink-0 font-mono">
                {{ formatRcaClock(entry.item.created_at) }}
              </span>
              <span
                class="bg-surface-tint-accent text-accent text-3xs inline-flex size-5 shrink-0 items-center justify-center rounded-full font-bold uppercase"
                aria-hidden="true"
              >
                {{ initials(entry.item.author_email) }}
              </span>
            </div>
            <p
              data-test="rca-thread-steer-text"
              class="bg-surface-tint-accent text-text-body text-compact rounded-surface rounded-br-default m-0 max-w-full px-3 py-2 break-words whitespace-pre-wrap"
            >
              <span v-if="entry.item.kind === 'guidance'" class="text-text-heading font-semibold">
                {{ t("alerts.incidents.rcaSteer.guidance") }}:
              </span>
              {{ entry.item.text }}
            </p>
            <p
              v-if="entry.item.agent_note"
              data-test="rca-thread-steer-note"
              class="text-text-secondary m-0 max-w-full text-xs break-words"
            >
              {{ t("alerts.incidents.rcaSteer.agentNote", { note: entry.item.agent_note }) }}
            </p>
            <OButton
              v-if="rcaSteerOffersReanalyze(entry.item)"
              data-test="rca-thread-steer-reanalyze"
              variant="outline"
              size="sm"
              icon-left="refresh"
              @click="$emit('reanalyze-with', entry.item.text)"
            >
              {{ t("alerts.incidents.rcaSteer.reanalyzeWithMessage") }}
            </OButton>
          </li>
        </template>

        <!-- Live with no running step yet (before the first step, or between steps); a paused run waits instead. -->
        <li
          v-if="runLive && !runWaiting && !hasRunningStep"
          data-test="rca-thread-working"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2.5"
        >
          <span class="flex h-5 items-center justify-center"><OSpinner size="xs" /></span>
          <p class="text-text-secondary text-compact m-0" role="status">
            {{ t("alerts.incidents.rcaThread.working") }}
          </p>
        </li>
      </ol>

      <!-- A steering read failure hides messages and questions, not the thread, and is not a send failure. -->
      <div
        v-if="steeringStatus === 'unavailable' && !noTranscript"
        data-test="rca-thread-steering-failed"
        role="status"
        class="text-text-secondary text-compact flex flex-col items-start gap-2"
      >
        <p class="m-0 flex items-start gap-2">
          <OIcon name="info" size="sm" class="mt-0.5 shrink-0" />
          {{ t("alerts.incidents.rcaSteer.loadFailed") }}
        </p>
        <OButton
          data-test="rca-thread-steering-retry-btn"
          variant="outline"
          size="sm"
          icon-left="refresh"
          @click="$emit('retry')"
        >
          {{ t("common.retry") }}
        </OButton>
      </div>
    </div>

    <div
      v-if="refusal"
      data-test="rca-thread-refusal"
      role="alert"
      class="border-border-default bg-surface-tint-error flex flex-none flex-col gap-2 border-t px-4 py-3"
    >
      <div class="flex items-start gap-2">
        <p class="text-status-error-text m-0 min-w-0 flex-1 text-xs">{{ refusal.message }}</p>
        <OButton
          data-test="rca-thread-refusal-dismiss"
          variant="ghost"
          size="icon-xs"
          :aria-label="t('common.close')"
          @click="refusal = null"
        >
          <OIcon name="close" size="xs" />
        </OButton>
      </div>
      <p
        data-test="rca-thread-refusal-text"
        class="text-text-body m-0 line-clamp-3 text-xs break-words whitespace-pre-wrap"
      >
        {{ refusal.text }}
      </p>
      <OButton
        data-test="rca-thread-refusal-reanalyze"
        class="self-start"
        variant="outline"
        size="sm"
        icon-left="refresh"
        @click="reanalyzeRefused"
      >
        {{ t("alerts.incidents.rcaSteer.reanalyzeWithMessage") }}
      </OButton>
    </div>

    <RcaSteerComposer
      v-if="canSteer && send"
      ref="composer"
      :run-id="thread?.run_id ?? ''"
      :waiting-input="runState === 'waiting_input'"
      :open-question="steering?.open_question ?? null"
      :author-email="authorEmail"
      :sending="sending"
      :send="sendFromComposer"
    />
    <!-- The note under every run that no longer takes messages; a run Resume can continue is not final. -->
    <footer
      v-else-if="runState && !runLive"
      data-test="rca-thread-final-note"
      class="border-border-default bg-surface-base text-text-secondary flex flex-none items-start gap-2 border-t px-4 py-3 text-xs"
    >
      <OIcon :name="canResume ? 'info' : 'lock'" size="sm" class="mt-px shrink-0" />
      <span>{{
        canResume
          ? t("alerts.incidents.rcaThread.resumableNote")
          : t("alerts.incidents.rcaThread.finalNote")
      }}</span>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  RcaContextUsed,
  RcaRunState,
  RcaRunStats,
  RcaSteerRecord,
  RcaSteering,
  RcaStep,
  RcaThread,
  RcaThreadQuestion,
} from "@/services/incidents";
import type { RcaReadStatus } from "@/composables/useIncidentRca";
import type { RcaSteerSendResult } from "@/composables/useRcaSteering";
import {
  formatRcaClock,
  formatRcaDuration,
  isFinishedStep,
  rcaThreadEntries,
  type RcaThreadEntry,
} from "@/utils/incidents/rcaThread";
import { userLocalPart } from "@/utils/incidents/rcaCell";
import {
  isClosedRunRefusal,
  rcaSteerOffersReanalyze,
  rcaSteerStatusLabel,
  rcaSteeredCount,
} from "@/utils/incidents/rcaSteering";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import RcaSteerComposer from "./RcaSteerComposer.vue";
import RcaThreadStep from "./RcaThreadStep.vue";

const props = withDefaults(
  defineProps<{
    thread: RcaThread | null;
    status: RcaReadStatus;
    /** The thread's run is running or waiting for input. */
    runLive: boolean;
    /** State of the thread's run; a run that is not live gets the closing note. */
    runState: RcaRunState | null;
    /** Resume can continue the thread's run, so its note is not final. */
    canResume?: boolean;
    /** "Auto on incident open", "Re-analyze by j.okafor", … */
    triggerLabel?: I18nText | null;
    /** `rca_runs.context_used` of the thread's run, when known. */
    contextUsed?: RcaContextUsed | null;
    /** The run's stored stats; the stats line uses them when the thread has none. */
    runStats?: RcaRunStats | null;
    /** The run has no transcript to read (a pre-upgrade report), so no thread was requested. */
    noTranscript?: boolean;
    /** Evidence id → entry number from the run's summary; null shows raw ids. */
    evidenceNumbers?: Map<string, number> | null;
    /** Steering view of the thread's run; null while unread or not allowed. */
    steering?: RcaSteering | null;
    /** How the steering read went; a failure shows apart from send failures. */
    steeringStatus?: RcaReadStatus;
    /** The steer box shows: the run takes messages and the user may send them. */
    canSteer?: boolean;
    /** The signed-in user's address ("Sending as"). */
    authorEmail?: string;
    sending?: boolean;
    /** Sends one message to the run. */
    send?: ((text: string) => Promise<RcaSteerSendResult>) | null;
  }>(),
  {
    canResume: false,
    triggerLabel: null,
    contextUsed: null,
    runStats: null,
    noTranscript: false,
    evidenceNumbers: null,
    steering: null,
    steeringStatus: "idle",
    canSteer: false,
    authorEmail: "",
    sending: false,
    send: null,
  },
);

const emit = defineEmits<{
  retry: [];
  "open-evidence": [number: number];
  /** Open the guidance dialog with this text. */
  "reanalyze-with": [text: string];
}>();

const { t } = useI18nTyped();

const scrollArea = ref<HTMLElement | null>(null);
const contextOpen = ref(false);
const contextPanelId = useId();

watch(
  () => props.thread?.run_id,
  () => (contextOpen.value = false),
);

const emptyMessage = computed<I18nText | null>(() => {
  if (props.noTranscript) return t("alerts.incidents.rcaThread.noTranscript");
  // A live run's session is created after the run starts, so "expired" is only a race there.
  if (props.runLive && !props.thread && props.status === "expired") return null;
  switch (props.status) {
    case "expired":
      return t("alerts.incidents.rcaThread.transcriptExpired");
    case "incomplete":
      return t("alerts.incidents.rcaThread.transcriptIncomplete");
    case "unavailable":
    case "missing":
    case "unsupported":
      return t("alerts.incidents.rcaThread.loadFailed");
    case "idle":
      return t("alerts.incidents.rcaThread.noRun");
  }
  if (props.thread?.transcript === "none") return t("alerts.incidents.rcaThread.noTranscript");
  if (props.thread?.transcript === "expired")
    return t("alerts.incidents.rcaThread.transcriptExpired");
  return null;
});

// Always shown; the thread's stats, else the run's stored stats.
const statsLine = computed(() => {
  const fromThread = props.thread?.transcript === "available" ? props.thread.stats : null;
  const run = props.runStats;
  const stats =
    fromThread ??
    (run && run.steps !== undefined && run.tool_calls !== undefined && run.duration_ms !== undefined
      ? { steps: run.steps, tool_calls: run.tool_calls, duration_ms: run.duration_ms }
      : null);
  if (!stats) return "";
  const line = t("alerts.incidents.rcaThread.stats", {
    checks: t("alerts.incidents.rcaThread.checks", { count: stats.steps }, stats.steps),
    toolCalls: t(
      "alerts.incidents.rcaThread.toolCallCount",
      { count: stats.tool_calls },
      stats.tool_calls,
    ),
    duration: formatRcaDuration(stats.duration_ms),
  });
  const steered = steeredCount.value;
  return steered > 0
    ? `${line} · ${t("alerts.incidents.rcaSteer.steered", { count: steered })}`
    : line;
});

// "steered N×"; the run's stored count first, else the rows that reached the agent.
const steeredCount = computed(
  () => props.runStats?.steered ?? rcaSteeredCount(props.steering?.items ?? []),
);

/** "Waiting for an answer" while open, "Answered by <author>" after. */
const questionStatus = (question: RcaThreadQuestion): string => {
  const answer = props.steering?.items.find(
    (item) => item.kind === "answer" && item.question_id === question.question_id,
  );
  const author = question.answered_by ?? answer?.author_email ?? null;
  if (author) return t("alerts.incidents.rcaSteer.answeredBy", { author: userLocalPart(author) });
  const isLast = props.thread?.questions?.at(-1)?.question_id === question.question_id;
  const open =
    props.steering?.open_question?.question_id === question.question_id ||
    (isLast && props.runState === "waiting_input");
  return open ? t("alerts.incidents.rcaSteer.waitingForAnswer") : "";
};

/** Steps, questions and responder messages in time order, as "Copy thread" lists them. */
const entries = computed<RcaThreadEntry[]>(() =>
  props.thread ? rcaThreadEntries(props.thread, props.steering?.items ?? []) : [],
);

/** A cancelled or failed run's steps that a Resume repeats; a completed run repeats none. */
const unfinishedSteps = computed(() => {
  const thread = props.thread;
  if (!thread || (props.runState !== "cancelled" && props.runState !== "failed")) {
    return new Set<RcaStep>();
  }
  return new Set(thread.steps.filter((step, idx) => !isFinishedStep(thread, step, idx)));
});

const STEER_PILL_VARIANT: Record<RcaSteerRecord["status"], BadgeVariant> = {
  queued: "default-outline",
  delivered: "default-outline",
  read: "primary-outline",
  applied: "success-soft",
  declined: "warning-soft",
  not_read: "warning-soft",
  rejected: "error-soft",
};
const steerPillVariant = (item: RcaSteerRecord): BadgeVariant => STEER_PILL_VARIANT[item.status];

/** "a.rao@acme.io" → "AR". */
const initials = (email: string): string =>
  userLocalPart(email)
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

const hasRunningStep = computed(
  () => props.thread?.steps.some((step) => step.ended_at === null) ?? false,
);

const runWaiting = computed(() => props.runLive && props.runState === "waiting_input");

const contextItems = computed(() => {
  const used = props.contextUsed;
  if (!used) return [];
  return [
    ...(used.past_causes ?? []).map((cause) => ({
      name: cause.summary || cause.id,
      group: t("alerts.incidents.rcaThread.contextPastCause"),
    })),
    ...(used.skills ?? []).map((name) => ({
      name,
      group: t("alerts.incidents.rcaThread.contextSkill"),
    })),
    ...(used.toolsets ?? []).map((name) => ({
      name,
      group: t("alerts.incidents.rcaThread.contextToolset"),
    })),
  ];
});

const contextSummary = computed(() => {
  const used = props.contextUsed;
  if (!used) return "";
  const pastCauses = used.past_causes?.length ?? 0;
  const skills = used.skills?.length ?? 0;
  const toolsets = used.toolsets?.length ?? 0;
  const parts: string[] = [t("alerts.incidents.rcaThread.contextUsed")];
  if (pastCauses > 0)
    parts.push(t("alerts.incidents.rcaThread.pastCauses", { count: pastCauses }, pastCauses));
  if (skills > 0) parts.push(t("alerts.incidents.rcaThread.skills", { count: skills }, skills));
  if (toolsets > 0)
    parts.push(t("alerts.incidents.rcaThread.toolsets", { count: toolsets }, toolsets));
  return parts.length > 1 ? parts.join(" · ") : "";
});

/** Scrolls to the newest entry ("Follow in thread"). */
const scrollToLatest = async () => {
  await nextTick();
  const el = scrollArea.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
};

/** Changes when an entry is added or the newest one grows or changes state. */
const latestEntryKey = computed(() => {
  const last = entries.value.at(-1);
  if (!last) return "";
  switch (last.kind) {
    case "step":
      return `${entries.value.length}:${last.key}:${last.step.ended_at}:${last.step.tool_calls.length}:${last.step.note?.length ?? 0}`;
    case "question":
      return `${entries.value.length}:${last.key}:${last.question.answered_by ?? ""}`;
    case "steer":
      return `${entries.value.length}:${last.key}:${last.item.status}`;
  }
  return "";
});

// While live, a reader at the bottom keeps seeing the newest entry.
watch(latestEntryKey, () => {
  const el = scrollArea.value;
  if (!props.runLive || !el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight / 4;
  if (atBottom) void scrollToLatest();
});

const composer = ref<InstanceType<typeof RcaSteerComposer> | null>(null);

/** "Tell the agent": focus the steer box. */
const focusComposer = () => composer.value?.focus();

/** The newest message the run refused as closed; cleared by a new run or the user. */
const refusal = ref<{ text: string; message: I18nText } | null>(null);

/** The composer's send. */
const sendFromComposer = async (text: string): Promise<RcaSteerSendResult> => {
  const send = props.send;
  if (!send) {
    return { ok: false, code: null, message: t("alerts.incidents.rcaSteer.error.generic") };
  }
  const result = await send(text);
  if (!result.ok && isClosedRunRefusal(result.code)) {
    refusal.value = { text, message: result.message };
  }
  return result;
};

watch(
  () => props.thread?.run_id,
  () => (refusal.value = null),
);

const reanalyzeRefused = () => {
  if (!refusal.value) return;
  emit("reanalyze-with", refusal.value.text);
  refusal.value = null;
};

defineExpose({ scrollToLatest, focusComposer });
</script>
