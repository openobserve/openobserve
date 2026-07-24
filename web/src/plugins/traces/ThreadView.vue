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

<!--
  Thread view — chat-style projection of an LLM trace.

    - Classify spans by `gen_ai_operation_name`
    - Render the trace summary chip-bar (turn count, total duration, cost,
      model, tool calls, errors)
    - Empty + skeleton states
-->
<template>
  <div
    class="thread-view flex flex-col w-full h-full bg-surface-base"
  >
    <!-- Summary toolbar — sidebar-style badge chips. Hidden in the Session
         Detail Pretty view (those metrics already show in the KPI cards). -->
    <div v-if="props.showSummary" class="thread-summary flex flex-wrap items-center gap-[0.4rem] py-2 px-4 bg-surface-base border-b border-border-default">
      <OTag
        type="metricChip"
        class="thread-chip thread-chip--steps h-6.5! px-2.5! py-0! bg-surface-base! border border-border-default rounded-default! text-xs! text-text-body! border-l-[3px]! border-l-[color-mix(in_srgb,var(--color-orange-700)_75%,var(--color-grey-300))]!"
        :title="summary.turnCount === 1 ? t('traces.threadView.llmStep', { n: summary.turnCount }) : t('traces.threadView.llmSteps', { n: summary.turnCount })"
      >
        <template #icon><OIcon name="auto-awesome" size="xs" /></template>
        <span class="thread-chip__label text-text-secondary font-medium mr-[0.3125rem] tracking-normal text-2xs">{{ t('traces.threadView.steps') }}</span>
        <span class="thread-chip__value text-text-body font-semibold text-xs">{{ summary.turnCount }}</span>
      </OTag>

      <OTag type="metricChip" class="thread-chip thread-chip--tools h-6.5! px-2.5! py-0! bg-surface-base! border border-border-default rounded-default! text-xs! text-text-body! border-l-[3px]! border-l-[color-mix(in_srgb,var(--color-cyan-500)_55%,var(--color-blue-500))]!">
        <template #icon><OIcon name="build" size="xs" /></template>
        <span class="thread-chip__label text-text-secondary font-medium mr-[0.3125rem] tracking-normal text-2xs">{{ t('traces.threadView.tools') }}</span>
        <span class="thread-chip__value text-text-body font-semibold text-xs">{{ summary.toolCallCount }}</span>
      </OTag>

      <OTag type="metricChip" class="thread-chip thread-chip--duration h-6.5! px-2.5! py-0! bg-surface-base! border border-border-default rounded-default! text-xs! text-text-body! border-l-[3px]! border-l-[color-mix(in_srgb,var(--color-grey-500)_80%,var(--color-blue-800))]!">
        <template #icon><OIcon name="schedule" size="xs" /></template>
        <span class="thread-chip__label text-text-secondary font-medium mr-[0.3125rem] tracking-normal text-2xs">{{ t('traces.threadView.duration') }}</span>
        <span class="thread-chip__value text-text-body font-semibold text-xs">
          {{ formatDuration(summary.totalDurationNs) }}
        </span>
      </OTag>

      <OTag type="metricChip" class="thread-chip thread-chip--cost h-6.5! px-2.5! py-0! bg-surface-base! border border-border-default rounded-default! text-xs! text-text-body! border-l-[3px]! border-l-success-600!">
        <template #icon><OIcon name="payments" size="xs" /></template>
        <span class="thread-chip__label text-text-secondary font-medium mr-[0.3125rem] tracking-normal text-2xs">{{ t('traces.threadView.cost') }}</span>
        <span class="thread-chip__value text-text-body font-semibold text-xs">
          {{ formatCost(summary.totalCost) }}
        </span>
      </OTag>

      <OTag
        v-if="summary.dominantModel"
        type="metricChip"
        class="thread-chip thread-chip--model h-6.5! px-2.5! py-0! bg-surface-base! border border-border-default rounded-default! text-xs! text-text-body! border-l-[3px]! border-l-ai-accent! dark:border-l-(--color-purple-400)!"
        :title="summary.dominantModel"
      >
        <template #icon><OIcon name="bolt" size="xs" /></template>
        <span class="thread-chip__label text-text-secondary font-medium mr-[0.3125rem] tracking-normal text-2xs">{{ t('traces.threadView.model') }}</span>
        <span class="thread-chip__value text-text-body font-semibold text-xs">{{ summary.dominantModel }}</span>
      </OTag>

      <OTag
        v-if="summary.errorCount > 0"
        type="metricChip"
        class="thread-chip thread-chip--error h-6.5! px-2.5! py-0! bg-surface-base! border border-border-default rounded-default! text-xs! text-text-body! border-l-[3px]! border-l-error-600!"
      >
        <template #icon><OIcon name="error-outline" size="xs" /></template>
        <span class="thread-chip__label text-text-secondary font-medium mr-[0.3125rem] tracking-normal text-2xs">{{ t('traces.threadView.errors') }}</span>
        <span class="thread-chip__value thread-chip__value--error font-semibold text-xs text-error-600">{{ summary.errorCount }}</span>
      </OTag>

    </div>

    <!-- Body -->
    <div
      v-if="!props.spans || props.spans.length === 0"
      class="flex-1 flex items-center justify-center text-text-muted text-sm"
    >
      {{ t('traces.threadView.noSpansLoaded') }}
    </div>
    <div
      v-else-if="turns.length === 0"
      class="flex-1 flex items-center justify-center text-text-muted text-sm"
    >
      {{ t('traces.threadView.noLlmTurns') }}
      <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- code sample: GenAI semantic-convention attribute name/value, must not be translated -->
      <code>gen_ai.operation.name = chat</code>.
    </div>
    <div v-else class="thread-scroll-body flex-1 overflow-auto px-4 py-3 bg-surface-base">
      <!-- System prompt (global — identical across traces in a session). -->
      <div
        v-if="head.systemPrompt"
        class="thread-system mb-4 border border-border-default border-l-[3px] border-l-ai-accent dark:border-l-(--color-purple-400) rounded-default bg-surface-base overflow-hidden"
      >
        <div
          class="thread-system__head flex items-center gap-2.5 py-2 px-3 cursor-pointer transition-all duration-120 hover:bg-[color-mix(in_srgb,var(--color-ai-accent)_4%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-ai-accent)_8%,transparent)]"
          @click="showSystemFull = !showSystemFull"
        >
          <span class="thread-system__badge inline-flex items-center py-[0.15rem] px-2 bg-[color-mix(in_srgb,var(--color-ai-accent)_10%,transparent)] dark:bg-[color-mix(in_srgb,var(--color-ai-accent)_18%,transparent)] text-ai-accent dark:text-(--color-purple-400) rounded-default text-2xs font-semibold tracking-[0.02rem] shrink-0">
            <OIcon name="settings" size="xs" class="mr-1" />
            {{ t('traces.threadView.system') }}
          </span>
          <span
            v-if="!showSystemFull"
            class="thread-system__preview flex-1 min-w-0 text-compact text-text-secondary truncate"
          >
            {{ truncate(head.systemPrompt, 160) }}
          </span>
          <span v-else class="flex-1" />
          <span class="thread-system__toggle inline-flex items-center gap-[0.15rem] text-theme-accent text-xs font-medium shrink-0">
            <OIcon
              :name="showSystemFull ? 'expand-less' : 'expand-more'"
              size="sm"
            />
          </span>
        </div>
        <div
          v-if="showSystemFull"
          class="thread-system__content py-3 px-3.5 border-t border-border-default bg-surface-base text-compact leading-[1.55] text-text-secondary whitespace-pre-wrap break-words max-h-90 overflow-auto"
        >
          {{ head.systemPrompt }}
        </div>
      </div>

      <template v-for="group in displayGroups" :key="group.traceId">
        <!-- Hint about historical user messages from prior traces in the
             same session — these are answered in earlier traces. -->
        <div
          v-if="group.historicalUserCount > 0"
          class="thread-prior flex items-center gap-2 px-3 py-[0.4rem] mb-2 rounded-default border border-dashed border-border-default text-xs text-text-muted"
        >
          <span>{{ t('traces.threadView.historicalIcon') }}</span>
          <span>
            {{ group.historicalUserCount === 1
              ? t('traces.threadView.historicalMessage', { count: group.historicalUserCount })
              : t('traces.threadView.historicalMessages', { count: group.historicalUserCount }) }}
          </span>
        </div>

        <!-- This group's user query. -->
        <div
          v-if="group.userQuery"
          class="thread-bubble thread-bubble--user thread-user-row flex items-start gap-2.5 mb-4 ml-auto max-w-[40%] w-fit py-2.5 px-3.5 rounded-default text-sm leading-normal whitespace-pre-wrap break-words bg-[image:var(--color-chat-bubble-user)] border border-(--color-indigo-100) dark:border-[color-mix(in_srgb,var(--color-indigo-900)_55%,var(--color-grey-700))] text-text-body shadow-[0_0.0625rem_0.125rem_color-mix(in_srgb,var(--color-black)_6%,transparent)] dark:shadow-[0_0.0625rem_0.125rem_color-mix(in_srgb,var(--color-white)_8%,transparent)]"
        >
          <div
            class="thread-user-avatar w-6 h-6 rounded-full bg-[image:var(--color-gradient-ai)] dark:bg-[image:linear-gradient(135deg,var(--color-indigo-600)_0%,var(--color-indigo-500)_100%)] text-white inline-flex items-center justify-content-center text-2xs font-bold shrink-0 cursor-default"
            :title="group.userId || t('traces.threadView.user')"
          >
            <OIcon name="person" size="sm" />
            <OTooltip
              v-if="group.userId"
              :content="group.userId"
              side="bottom"
              align="center"
              :side-offset="6"
            />
          </div>
          <div class="thread-user-row__text flex-1 min-w-0 self-center">{{ group.userQuery }}</div>
        </div>

        <!-- Timeline rail of turns. -->
        <div class="thread-rail relative pl-0">
          <div
            v-for="turn in group.turns"
            :key="turn.span.span_id"
            class="thread-turn relative flex gap-3.5 pb-4 before:content-[''] before:absolute before:top-[1.875rem] before:bottom-0 before:left-3.5 before:w-0.5 before:rounded-full before:bg-border-default last:before:hidden"
          >
          <div class="thread-turn__avatar shrink-0 relative z-1 w-7 h-7 rounded-full bg-(--color-purple-100) dark:bg-[color-mix(in_srgb,var(--color-ai-accent)_16%,transparent)] text-ai-accent dark:text-(--color-purple-400) flex items-center justify-center border border-[color-mix(in_srgb,var(--color-ai-accent)_25%,transparent)] dark:border-[color-mix(in_srgb,var(--color-ai-accent)_40%,transparent)] shadow-[0_0_0_0.25rem_var(--color-surface-base)]">
            <OIcon name="auto-awesome" size="xs" />
          </div>
          <div class="thread-turn__body flex-1 min-w-0 flex flex-col gap-2">
          <!-- Genuine follow-up user message(s). -->
          <div
            v-for="(u, uIdx) in turn.followupUsers"
            :key="`u-${uIdx}`"
            class="thread-bubble thread-bubble--user thread-bubble--user-followup py-2.5 px-3.5 rounded-default text-sm leading-normal whitespace-pre-wrap break-words max-w-[min(40rem,75%)] bg-[image:var(--color-chat-bubble-user)] border border-(--color-indigo-100) dark:border-[color-mix(in_srgb,var(--color-indigo-900)_55%,var(--color-grey-700))] text-text-body shadow-[0_0.0625rem_0.125rem_color-mix(in_srgb,var(--color-black)_6%,transparent)] dark:shadow-[0_0.0625rem_0.125rem_color-mix(in_srgb,var(--color-white)_8%,transparent)]"
          >
            {{ u.content }}
          </div>

          <!-- Tool calls — between the user input and the assistant output
               (the model calls tools, then answers). Shared component, also
               used by the Session Detail collapsed turn body. -->
          <ThreadToolCalls
            :tool-calls="turn.toolCalls"
            @span-selected="emit('span-selected', $event)"
          />

          <!-- Assistant text (the final answer, after any tool calls). Rendered
               as markdown — headings, tables, code, bold. v-html is sanitized in
               renderMarkdown(). -->
          <div
            v-for="(msg, mIdx) in turn.assistant"
            :key="`a-${mIdx}`"
            class="thread-bubble thread-bubble--assistant markdown-body self-start bg-surface-base border border-border-default text-text-body max-w-full shadow-[0_0.0625rem_0.125rem_color-mix(in_srgb,var(--color-black)_6%,transparent)] dark:shadow-[0_0.0625rem_0.125rem_color-mix(in_srgb,var(--color-white)_8%,transparent)] py-2.5 px-3.5 rounded-default text-sm leading-normal break-words whitespace-normal"
            v-html="renderMarkdown(msg.content)"
          />


          <!-- Footer. -->
          <div class="thread-turn__footer flex items-center flex-wrap gap-[0.35rem] mt-2 pt-2 border-t border-dashed border-border-default text-xs text-text-secondary">
            <span class="thread-metric inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-default bg-surface-subtle border border-border-default text-text-secondary text-2xs leading-none whitespace-nowrap shrink-0" :title="t('traces.threadView.startedAt', { time: formatTime(turn.span.start_time) })">
              <OIcon name="schedule" size="xs" />
              {{ formatTime(turn.span.start_time) }}
            </span>
            <span class="thread-metric thread-metric--model inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-default text-ai-accent dark:text-(--color-purple-400) bg-[color-mix(in_srgb,var(--color-ai-accent)_6%,transparent)] dark:bg-[color-mix(in_srgb,var(--color-ai-accent)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)] dark:border-[color-mix(in_srgb,var(--color-ai-accent)_30%,transparent)] font-medium max-w-50 overflow-hidden text-ellipsis text-2xs leading-none whitespace-nowrap shrink-0" :title="getModel(turn.span)">
              <OIcon name="bolt" size="xs" />
              {{ getModel(turn.span) || t('traces.threadView.unknown') }}
            </span>
            <span class="thread-metric inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-default bg-surface-subtle border border-border-default text-text-secondary text-2xs leading-none whitespace-nowrap shrink-0" :title="t('traces.threadView.duration')">
              <OIcon name="timer" size="xs" />
              {{ formatDuration(turn.span.duration) }}
            </span>
            <span class="thread-metric inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-default bg-surface-subtle border border-border-default text-text-secondary text-2xs leading-none whitespace-nowrap shrink-0" :title="t('traces.threadView.tokens')">
              <OIcon name="data-usage" size="xs" />
              {{ formatNumber(getTokens(turn.span)) }} {{ t('traces.threadView.tokensSuffix') }}
            </span>
            <span class="thread-metric inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-default bg-surface-subtle border border-border-default text-text-secondary text-2xs leading-none whitespace-nowrap shrink-0" :title="t('traces.threadView.cost')">
              <OIcon name="payments" size="xs" />
              {{ formatCost(getCost(turn.span)) }}
            </span>
            <span
              v-if="turn.span.span_status === 'ERROR'"
              class="thread-metric thread-metric--error inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-default text-error-600 dark:text-error-400 bg-[color-mix(in_srgb,var(--color-error-600)_8%,transparent)] dark:bg-[color-mix(in_srgb,var(--color-error-400)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-error-600)_25%,transparent)] dark:border-[color-mix(in_srgb,var(--color-error-400)_30%,transparent)] font-medium text-2xs leading-none whitespace-nowrap shrink-0"
            >
              <OIcon name="error-outline" size="xs" />
              {{ t('traces.threadView.error') }}
            </span>
            <button
              class="thread-turn__view-span ml-auto inline-flex items-center gap-[0.2rem] py-[0.2rem] px-[0.55rem] rounded-default text-theme-accent text-xs font-medium bg-transparent border border-transparent cursor-pointer transition-all duration-120 shrink-0 hover:bg-[color-mix(in_srgb,var(--color-blue-500)_8%,transparent)] hover:border-[color-mix(in_srgb,var(--color-blue-500)_25%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-blue-400)_12%,transparent)] dark:hover:border-[color-mix(in_srgb,var(--color-blue-400)_30%,transparent)]"
              @click="emit('span-selected', turn.span.span_id)"
            >
              {{ t('traces.threadView.viewSpan') }}
              <OIcon name="arrow-forward" size="xs" />
            </button>
          </div>
          </div>
        </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export interface Props {
  spans: any[];
  selectedSpanId?: string;
  /**
   * Show the summary chip strip (Steps / Tools / Duration / Cost / Model).
   * Defaults to true for the trace explorer; the Session Detail Pretty view
   * passes false because the same metrics already live in its KPI cards.
   */
  showSummary?: boolean;
  /**
   * Condense each trace's many LLM steps into a single bubble: the user query +
   * all tool calls merged + only the FINAL assistant answer. Defaults to false
   * (the trace explorer wants the full step-by-step). The Session Detail Pretty
   * view passes true so it reads like the Collapsed summary.
   */
  condenseTurns?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  showSummary: true,
  condenseTurns: false,
});
const emit = defineEmits<{
  (e: "span-selected", spanId: string): void;
}>();

import { useStore } from "vuex";
import {
  getModel,
  getCost,
  getTokens,
  classify,
  buildTraceGroup,
  type Message,
  type Turn,
  type TraceGroup,
} from "./threadView.utils";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ThreadToolCalls from "./ThreadToolCalls.vue";
import { renderMarkdown } from "./markdown";

const store = useStore();
const { t } = useI18n();


interface ThreadHead {
  systemPrompt: string;
  userQuery: string;
}

/* ─── trace groups ────────────────────────────────────────────────────── */
const traceGroups = computed<TraceGroup[]>(() => {
  const source = props.spans || [];
  if (!source.length) return [];

  const byTrace = new Map<string, any[]>();
  for (const s of source) {
    const tid = String(s.trace_id || "");
    if (!tid) continue;
    if (!byTrace.has(tid)) byTrace.set(tid, []);
    byTrace.get(tid)!.push(s);
  }

  const groups: TraceGroup[] = [];
  for (const [, spans] of byTrace) {
    const g = buildTraceGroup(spans);
    if (g) groups.push(g);
  }
  return groups.sort((a, b) => a.rootStartTime - b.rootStartTime);
});

// What the template renders. When `condenseTurns` is on, each trace's many LLM
// steps collapse into one synthetic turn: all tool calls merged (chronological)
// + only the final non-empty assistant message. The footer span carries the
// trace-level aggregates (duration / tokens / cost) so the metrics stay honest.
const displayGroups = computed<TraceGroup[]>(() => {
  if (!props.condenseTurns) return traceGroups.value;
  return traceGroups.value.map((g) => {
    if (g.turns.length <= 1) return g;

    const allTools = g.turns
      .flatMap((t) => t.toolCalls)
      .sort((a, b) => Number(a.start_time) - Number(b.start_time));

    let assistant: Message[] = [];
    for (let i = g.turns.length - 1; i >= 0; i--) {
      const msgs = g.turns[i].assistant.filter(
        (m) => m.role === "assistant" && m.content,
      );
      if (msgs.length) {
        assistant = msgs;
        break;
      }
    }

    const followupUsers = g.turns.flatMap((t) => t.followupUsers);
    const first = g.turns[0].span;
    const last = g.turns[g.turns.length - 1].span;
    const totalTokens = g.turns.reduce((n, t) => n + getTokens(t.span), 0);
    const anyError = g.turns.some((t) => t.span.span_status === "ERROR");

    const mergedSpan = {
      ...last,
      start_time: first.start_time,
      duration: g.totalDurationNs,
      gen_ai_usage_cost: g.totalCost,
      gen_ai_usage_total_tokens: totalTokens,
      span_status: anyError ? "ERROR" : last.span_status,
    };

    return {
      ...g,
      turns: [{ span: mergedSpan, toolCalls: allTools, assistant, followupUsers }],
    };
  });
});

/** Single-trace shortcuts for the existing template (back-compat). */
const turns = computed<Turn[]>(() =>
  traceGroups.value.length ? traceGroups.value[0].turns : [],
);
const head = computed<ThreadHead>(() =>
  traceGroups.value.length
    ? {
        systemPrompt: traceGroups.value[0].systemPrompt,
        userQuery: traceGroups.value[0].userQuery,
      }
    : { systemPrompt: "", userQuery: "" },
);
const showSystemFull = ref(false);

/* ─── visual helpers ──────────────────────────────────────────────────── */

/* ─── summary aggregates ──────────────────────────────────────────────── */
const summary = computed(() => {
  const all = props.spans || [];
  const allTurnSpans = traceGroups.value.flatMap((g) =>
    g.turns.map((t) => t.span),
  );
  const toolCount = all.filter((s) => classify(s) === "tool_call").length;

  let totalCost = 0;
  for (const t of allTurnSpans) totalCost += getCost(t);

  const starts = all.map((s) => Number(s.start_time)).filter(Number.isFinite);
  const ends = all.map((s) => Number(s.end_time)).filter(Number.isFinite);
  const totalDurationNs =
    starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;

  const modelCount: Record<string, number> = {};
  for (const t of allTurnSpans) {
    const m = getModel(t);
    if (!m) continue;
    modelCount[m] = (modelCount[m] || 0) + 1;
  }
  const dominantModel =
    Object.entries(modelCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  const errorCount = all.filter((s) => s.span_status === "ERROR").length;

  const userTurnCount =
    (head.value.userQuery ? 1 : 0) +
    turns.value.reduce((n, t) => n + t.followupUsers.length, 0);

  return {
    userTurnCount,
    turnCount: allTurnSpans.length, // = number of LLM steps across the loaded scope
    toolCallCount: toolCount,
    totalCost,
    totalDurationNs,
    dominantModel,
    errorCount,
  };
});

/* ─── formatters ──────────────────────────────────────────────────────── */
function formatDuration(ns: number): string {
  if (!ns || !isFinite(ns)) return "0ms";
  const ms = ns / 1_000_000;
  if (ms < 1) return ms.toFixed(2) + "ms";
  if (ms < 1000) return Math.round(ms) + "ms";
  if (ms < 60_000) return (ms / 1000).toFixed(2) + "s";
  return (ms / 60_000).toFixed(2) + "m";
}

function formatCost(usd: number): string {
  if (!usd || usd <= 0) return "$0";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

function formatTime(ns: number): string {
  if (!ns) return "";
  // start_time is nanoseconds since epoch
  const ms = Number(ns) / 1_000_000;
  if (!isFinite(ms)) return "";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
</script>

<style scoped lang="scss">
/* keep(generated-content): element styling for the sanitized markdown HTML that
   renderMarkdown() produces and the assistant bubble injects with v-html. Those
   nodes carry neither a scope attribute nor classes of their own, so :deep()
   element selectors are the only expressible form. Every colour is a --color-*
   token, so this one rule set covers light and dark. The bubble's own
   `whitespace-normal` utility keeps rendered block elements gap-free. */
.markdown-body {
  :deep(> *:first-child) {
    margin-top: 0;
  }
  :deep(> *:last-child) {
    margin-bottom: 0;
  }
  :deep(p) {
    margin: 0 0 0.5rem;
  }
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    font-weight: 650;
    margin: 0.75rem 0 0.35rem;
    line-height: 1.3;
  }
  :deep(h1) {
    font-size: var(--text-base);
  }
  :deep(h2) {
    font-size: var(--text-base);
  }
  :deep(h3) {
    font-size: var(--text-sm);
  }
  :deep(h4) {
    font-size: var(--text-sm);
  }
  :deep(ul),
  :deep(ol) {
    margin: 0.4rem 0;
    padding-left: 1.25rem;
  }
  :deep(li) {
    margin: 0.15rem 0;
  }
  :deep(a) {
    color: var(--color-text-link);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
  :deep(code) {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: color-mix(in srgb, var(--color-text-body) 8%, transparent);
    padding: 0.1rem 0.3rem;
    border-radius: 0.1875rem;
  }
  :deep(pre) {
    background: color-mix(in srgb, var(--color-text-body) 5%, transparent);
    border: 1px solid var(--color-border-default);
    padding: 0.5rem 0.625rem;
    border-radius: 0.25rem;
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  :deep(pre code) {
    background: transparent;
    padding: 0;
  }
  :deep(blockquote) {
    border-left: 0.1875rem solid var(--color-border-default);
    margin: 0.5rem 0;
    padding-left: 0.75rem;
    color: var(--color-text-secondary);
  }
  :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5rem 0;
    font-size: var(--text-xs);
  }
  :deep(th),
  :deep(td) {
    border: 1px solid var(--color-border-default);
    padding: 0.3rem 0.5rem;
    text-align: left;
  }
  :deep(th) {
    background: color-mix(in srgb, var(--color-text-body) 6%, transparent);
    font-weight: 600;
  }
  :deep(hr) {
    border: none;
    border-top: 1px solid var(--color-border-default);
    margin: 0.625rem 0;
  }
}
</style>
