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

<!-- The right-hand "Investigation thread" column of the Analysis tab (02 TH38,
     contract E5): header with Live/Saved and the run stats (no credits, TH37),
     the start entry with "Context used", one entry per step, and the final note
     of a completed run. Read-only in Phase 2. -->
<template>
  <aside
    data-test="rca-thread-column"
    class="border-border-default bg-surface-panel flex h-full min-h-0 flex-col border-s"
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

      <ol v-else-if="thread" class="m-0 flex list-none flex-col gap-3.5 p-0">
        <!-- Start entry (TH38): trigger, time, the prompt, and the leads it was given. -->
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

        <RcaThreadStep
          v-for="step in thread.steps"
          :key="step.index"
          :step="step"
          :run-live="runLive"
        />

        <!-- Live with no running step yet (before the first step, or between steps). -->
        <li
          v-if="runLive && !hasRunningStep"
          data-test="rca-thread-working"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2.5"
        >
          <span class="flex h-5 items-center justify-center"><OSpinner size="xs" /></span>
          <p class="text-text-secondary text-compact m-0" role="status">
            {{ t("alerts.incidents.rcaThread.working") }}
          </p>
        </li>
      </ol>
    </div>

    <footer
      v-if="runState === 'completed'"
      data-test="rca-thread-final-note"
      class="border-border-default bg-surface-base text-text-secondary flex flex-none items-start gap-2 border-t px-4 py-3 text-xs"
    >
      <OIcon name="lock" size="sm" class="mt-px shrink-0" />
      <span>{{ t("alerts.incidents.rcaThread.finalNote") }}</span>
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
import type { RcaContextUsed, RcaRunState, RcaRunStats, RcaThread } from "@/services/incidents";
import type { RcaThreadStatus } from "@/composables/useRcaThread";
import { formatRcaClock, formatRcaDuration } from "@/utils/incidents/rcaThread";
import RcaThreadStep from "./RcaThreadStep.vue";

const props = withDefaults(
  defineProps<{
    thread: RcaThread | null;
    status: RcaThreadStatus;
    /** The thread's run is running or waiting for input. */
    runLive: boolean;
    /** State of the thread's run; a completed run gets the final note. */
    runState: RcaRunState | null;
    /** "Auto on incident open", "Re-analyze by j.okafor", … */
    triggerLabel?: I18nText | null;
    /** `rca_runs.context_used` of the thread's run, when known. */
    contextUsed?: RcaContextUsed | null;
    /** The run's stored stats; the stats line uses them when the thread has none (TH37). */
    runStats?: RcaRunStats | null;
  }>(),
  { triggerLabel: null, contextUsed: null, runStats: null },
);

defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();

const scrollArea = ref<HTMLElement | null>(null);
const contextOpen = ref(false);
const contextPanelId = useId();

watch(
  () => props.thread?.run_id,
  () => (contextOpen.value = false),
);

const emptyMessage = computed<I18nText | null>(() => {
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

// TH37: always shown; the thread's stats, else the run's stored stats.
const statsLine = computed(() => {
  const fromThread = props.thread?.transcript === "available" ? props.thread.stats : null;
  const run = props.runStats;
  const stats =
    fromThread ??
    (run && run.steps !== undefined && run.tool_calls !== undefined && run.duration_ms !== undefined
      ? { steps: run.steps, tool_calls: run.tool_calls, duration_ms: run.duration_ms }
      : null);
  if (!stats) return "";
  return t("alerts.incidents.rcaThread.stats", {
    checks: t("alerts.incidents.rcaThread.checks", { count: stats.steps }, stats.steps),
    toolCalls: t(
      "alerts.incidents.rcaThread.toolCallCount",
      { count: stats.tool_calls },
      stats.tool_calls,
    ),
    duration: formatRcaDuration(stats.duration_ms),
  });
});

const hasRunningStep = computed(
  () => props.thread?.steps.some((step) => step.ended_at === null) ?? false,
);

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

/** Scrolls to the newest entry ("Follow in thread", 02 TH40 M). */
const scrollToLatest = async () => {
  await nextTick();
  const el = scrollArea.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
};

// While live, a reader at the bottom keeps seeing the newest step.
watch(
  () => props.thread?.steps.length ?? 0,
  (count, previous) => {
    const el = scrollArea.value;
    if (!props.runLive || !el || count <= (previous ?? 0)) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight / 4;
    if (atBottom) void scrollToLatest();
  },
);

defineExpose({ scrollToLatest });
</script>
