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
  <li data-test="rca-thread-step" class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2.5">
    <span class="flex h-5 items-center justify-center" data-test="rca-thread-step-status">
      <OSpinner v-if="status === 'running'" size="xs" />
      <OIcon v-else :name="statusIcon" size="sm" :class="statusClass" :label="statusLabel" />
    </span>

    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex min-w-0 items-baseline gap-2">
        <span
          data-test="rca-thread-step-title"
          class="text-text-heading text-compact min-w-0 flex-1 font-bold"
        >
          {{ step.title }}
          <span
            v-if="step.from_steering"
            data-test="rca-thread-step-from-steering"
            class="text-accent text-2xs ms-1 font-bold"
          >
            {{ t("alerts.incidents.rcaSteer.fromSteering") }}
          </span>
        </span>
        <span v-if="startedClock" class="text-text-secondary text-2xs shrink-0 font-mono">
          {{ startedClock }}
        </span>
      </div>

      <p
        v-if="step.note"
        data-test="rca-thread-step-note"
        class="text-text-body text-compact m-0 [text-wrap:pretty] break-words whitespace-pre-line"
      >
        <template v-for="(segment, idx) in noteSegments" :key="idx">
          <template v-if="segment.kind === 'text'">
            <code
              v-if="segment.code"
              class="rounded-default bg-surface-subtle text-text-code px-1 font-mono text-xs"
              :class="{ 'font-bold': segment.bold, italic: segment.italic }"
              >{{ segment.text }}</code
            >
            <strong
              v-else-if="segment.bold"
              class="font-bold"
              :class="{ italic: segment.italic }"
              >{{ segment.text }}</strong
            >
            <em v-else-if="segment.italic">{{ segment.text }}</em>
            <span v-else>{{ segment.text }}</span>
          </template>
          <button
            v-else-if="evidenceNumbers?.has(segment.id)"
            type="button"
            data-test="rca-citation-chip"
            class="rounded-default border-border-control text-text-heading bg-surface-base hover:bg-surface-subtle-hover text-3xs mx-0.5 inline-flex h-4.5 min-w-5 cursor-pointer items-center justify-center border px-1 align-baseline font-mono font-semibold"
            :aria-label="
              t('alerts.incidents.rcaSummary.openEvidence', {
                number: evidenceNumbers.get(segment.id),
              })
            "
            @click="$emit('open-evidence', evidenceNumbers.get(segment.id) as number)"
          >
            {{ evidenceNumbers.get(segment.id) }}
          </button>
          <span
            v-else-if="evidenceNumbers"
            data-test="rca-citation-unverified"
            class="rounded-default border-status-warning-text text-status-warning-text bg-surface-base text-3xs mx-0.5 inline-flex h-4.5 items-center border border-dashed px-1 align-baseline font-mono font-semibold"
          >
            {{ t("alerts.incidents.rcaSummary.notVerifiedId", { id: segment.id }) }}
          </span>
          <span
            v-else
            data-test="rca-citation-chip"
            class="rounded-default border-border-default text-text-heading bg-surface-base text-3xs mx-0.5 inline-flex h-4.5 min-w-5 items-center justify-center border px-1 align-baseline font-mono font-semibold"
          >
            {{ segment.id }}
          </span>
        </template>
        <span v-if="step.note_truncated" class="text-text-secondary">…</span>
      </p>

      <p
        v-if="status === 'running'"
        data-test="rca-thread-step-working"
        class="text-text-secondary text-compact m-0"
        role="status"
      >
        {{ t("alerts.incidents.rcaThread.working") }}
      </p>

      <template v-if="step.tool_calls.length > 0">
        <button
          type="button"
          data-test="rca-thread-step-calls-toggle"
          class="text-text-secondary flex cursor-pointer items-center gap-1 self-start border-none bg-transparent p-0 text-xs"
          :aria-expanded="callsOpen"
          :aria-controls="callsListId"
          @click="callsOpen = !callsOpen"
        >
          <OIcon :name="callsOpen ? 'expand-less' : 'expand-more'" size="sm" />
          {{ callsLabel }}
        </button>
        <ul
          v-if="callsOpen"
          :id="callsListId"
          data-test="rca-thread-step-calls"
          class="rounded-default border-border-default bg-surface-base divide-border-subtle m-0 flex list-none flex-col divide-y border p-0"
        >
          <RcaToolCallRow v-for="call in step.tool_calls" :key="call.call_id" :call="call" />
        </ul>
      </template>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useI18nTyped } from "@/types/i18n";
import type { RcaStep } from "@/services/incidents";
import {
  formatRcaClock,
  formatRcaDuration,
  isInterruptedStep,
  splitRcaNote,
  toolCallsDurationMs,
} from "@/utils/incidents/rcaThread";
import RcaToolCallRow from "./RcaToolCallRow.vue";

const props = withDefaults(
  defineProps<{
    step: RcaStep;
    /** The run is live: an unfinished step is the running one. */
    runLive: boolean;
    /** The live run is paused for an answer, so its unfinished step is not working. */
    runWaiting?: boolean;
    /** The step counts as finished; an ended run's step that Resume repeats does not. */
    finished?: boolean;
    /** Evidence id → entry number from the run's summary; null when no summary is loaded, so chips show the raw id. */
    evidenceNumbers?: Map<string, number> | null;
  }>(),
  { runWaiting: false, finished: true, evidenceNumbers: null },
);

defineEmits<{
  /** A citation chip was clicked: open evidence entry `number`. */
  "open-evidence": [number: number];
}>();

const { t } = useI18nTyped();

const callsListId = useId();

/** running: the live step; waiting: paused for an answer; stopped: the step did not finish; warn: a tool failed. */
const status = computed<"running" | "waiting" | "stopped" | "warn" | "ok">(() => {
  if (props.step.ended_at === null) {
    if (!props.runLive) return "stopped";
    return props.runWaiting ? "waiting" : "running";
  }
  if (!props.finished || isInterruptedStep(props.step)) return "stopped";
  return props.step.tool_calls.some((call) => call.status === "error") ? "warn" : "ok";
});

const statusIcon = computed(() => {
  switch (status.value) {
    case "stopped":
      return "error";
    case "waiting":
      return "help-outline";
    case "warn":
      return "warning";
    default:
      return "check-circle";
  }
});

const statusClass = computed(() => {
  switch (status.value) {
    case "stopped":
      return "text-status-negative";
    case "waiting":
    case "warn":
      return "text-status-warning-text";
    default:
      return "text-status-positive";
  }
});

const statusLabel = computed(() => {
  switch (status.value) {
    case "stopped":
      return t("alerts.incidents.rcaThread.stepStopped");
    case "waiting":
      return t("alerts.incidents.rcaSteer.waitingForAnswer");
    case "warn":
      return t("alerts.incidents.rcaThread.stepToolFailed");
    default:
      return t("alerts.incidents.rcaThread.stepDone");
  }
});

const startedClock = computed(() => formatRcaClock(props.step.started_at));

const noteSegments = computed(() => splitRcaNote(props.step.note ?? ""));

// Only the running step starts open (reference: "Default open only for the running step").
const callsOpen = ref(status.value === "running");
watch(status, (next, previous) => {
  if (previous === "running" && next !== "running") callsOpen.value = false;
});

const callsLabel = computed(() => {
  const count = props.step.tool_calls.length;
  const duration = formatRcaDuration(toolCallsDurationMs(props.step.tool_calls));
  return status.value === "running"
    ? t("alerts.incidents.rcaThread.toolCallsRunning", { count, duration }, count)
    : t("alerts.incidents.rcaThread.toolCalls", { count, duration }, count);
});
</script>
