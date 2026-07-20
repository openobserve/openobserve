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

  Phase A scope (this commit):
    - Classify spans by `gen_ai_operation_name`
    - Render the trace summary chip-bar (turn count, total duration, cost,
      model, tool calls, errors)
    - Empty + skeleton states

  Phase B+ will add the actual conversation rendering.
-->
<template>
  <div
    class="thread-view flex flex-col w-full h-full bg-(--color-surface-base)"
    :class="{ 'thread-view--dark': isDark }"
  >
    <!-- Summary toolbar — sidebar-style badge chips. Hidden in the Session
         Detail Pretty view (those metrics already show in the KPI cards). -->
    <div v-if="props.showSummary" class="thread-summary flex flex-wrap items-center gap-[0.4rem] py-2 px-4 bg-(--color-surface-base,transparent) border-b border-(--color-border-default)">
      <OTag
        type="metricChip"
        class="thread-chip thread-chip--steps h-[26px]! px-[0.625rem]! py-0! bg-(--color-surface-base)! border border-(--color-border-default) rounded! text-xs! text-(--color-text-body)! border-l-[3px]! border-l-[#cc785c]!"
        :title="summary.turnCount === 1 ? t('traces.threadView.llmStep', { n: summary.turnCount }) : t('traces.threadView.llmSteps', { n: summary.turnCount })"
      >
        <template #icon><OIcon name="auto-awesome" size="xs" /></template>
        <span class="thread-chip__label text-(--color-text-secondary) font-medium mr-[5px] tracking-normal text-[11.5px]">{{ t('traces.threadView.steps') }}</span>
        <span class="thread-chip__value text-(--color-text-body) font-semibold text-xs">{{ summary.turnCount }}</span>
      </OTag>

      <OTag type="metricChip" class="thread-chip thread-chip--tools h-[26px]! px-[0.625rem]! py-0! bg-(--color-surface-base)! border border-(--color-border-default) rounded! text-xs! text-(--color-text-body)! border-l-[3px]! border-l-[#0ea5e9]!">
        <template #icon><OIcon name="build" size="xs" /></template>
        <span class="thread-chip__label text-(--color-text-secondary) font-medium mr-[5px] tracking-normal text-[11.5px]">{{ t('traces.threadView.tools') }}</span>
        <span class="thread-chip__value text-(--color-text-body) font-semibold text-xs">{{ summary.toolCallCount }}</span>
      </OTag>

      <OTag type="metricChip" class="thread-chip thread-chip--duration h-[26px]! px-[0.625rem]! py-0! bg-(--color-surface-base)! border border-(--color-border-default) rounded! text-xs! text-(--color-text-body)! border-l-[3px]! border-l-[#64748b]!">
        <template #icon><OIcon name="schedule" size="xs" /></template>
        <span class="thread-chip__label text-(--color-text-secondary) font-medium mr-[5px] tracking-normal text-[11.5px]">{{ t('traces.threadView.duration') }}</span>
        <span class="thread-chip__value text-(--color-text-body) font-semibold text-xs">
          {{ formatDuration(summary.totalDurationNs) }}
        </span>
      </OTag>

      <OTag type="metricChip" class="thread-chip thread-chip--cost h-[26px]! px-[0.625rem]! py-0! bg-(--color-surface-base)! border border-(--color-border-default) rounded! text-xs! text-(--color-text-body)! border-l-[3px]! border-l-[#16a34a]!">
        <template #icon><OIcon name="payments" size="xs" /></template>
        <span class="thread-chip__label text-(--color-text-secondary) font-medium mr-[5px] tracking-normal text-[11.5px]">{{ t('traces.threadView.cost') }}</span>
        <span class="thread-chip__value text-(--color-text-body) font-semibold text-xs">
          {{ formatCost(summary.totalCost) }}
        </span>
      </OTag>

      <OTag
        v-if="summary.dominantModel"
        type="metricChip"
        class="thread-chip thread-chip--model h-[26px]! px-[0.625rem]! py-0! bg-(--color-surface-base)! border border-(--color-border-default) rounded! text-xs! text-(--color-text-body)! border-l-[3px]! border-l-[#8b5cf6]!"
        :title="summary.dominantModel"
      >
        <template #icon><OIcon name="bolt" size="xs" /></template>
        <span class="thread-chip__label text-(--color-text-secondary) font-medium mr-[5px] tracking-normal text-[11.5px]">{{ t('traces.threadView.model') }}</span>
        <span class="thread-chip__value text-(--color-text-body) font-semibold text-xs">{{ summary.dominantModel }}</span>
      </OTag>

      <OTag
        v-if="summary.errorCount > 0"
        type="metricChip"
        class="thread-chip thread-chip--error h-[26px]! px-[0.625rem]! py-0! bg-(--color-surface-base)! border border-(--color-border-default) rounded! text-xs! text-(--color-text-body)! border-l-[3px]! border-l-[var(--color-error-600)]!"
      >
        <template #icon><OIcon name="error-outline" size="xs" /></template>
        <span class="thread-chip__label text-(--color-text-secondary) font-medium mr-[5px] tracking-normal text-[11.5px]">{{ t('traces.threadView.errors') }}</span>
        <span class="thread-chip__value thread-chip__value--error font-semibold text-xs text-(--color-error-600)">{{ summary.errorCount }}</span>
      </OTag>

    </div>

    <!-- Body -->
    <div
      v-if="!props.spans || props.spans.length === 0"
      class="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-[0.85rem]"
    >
      {{ t('traces.threadView.noSpansLoaded') }}
    </div>
    <div
      v-else-if="turns.length === 0"
      class="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-[0.85rem]"
    >
      {{ t('traces.threadView.noLlmTurns') }}
      <code>gen_ai.operation.name = chat</code>.
    </div>
    <div v-else class="thread-scroll-body flex-1 overflow-auto px-[1rem] py-[0.75rem] bg-(--color-surface-base,var(--color-surface-base))">
      <!-- System prompt (global — identical across traces in a session). -->
      <div
        v-if="head.systemPrompt"
        class="thread-system mb-4 border border-(--color-border-default) border-l-[3px] border-l-[#8b5cf6] rounded-[0.4rem] bg-(--color-surface-base) overflow-hidden"
      >
        <div
          class="thread-system__head flex items-center gap-[0.625rem] py-2 px-3 cursor-pointer transition-all duration-[120ms]"
          @click="showSystemFull = !showSystemFull"
        >
          <span class="thread-system__badge inline-flex items-center py-[0.15rem] px-2 bg-[rgba(139,92,246,0.1)] text-[#8b5cf6] rounded text-[0.7rem] font-semibold tracking-[0.02rem] shrink-0">
            <OIcon name="settings" size="xs" class="mr-1" />
            {{ t('traces.threadView.system') }}
          </span>
          <span
            v-if="!showSystemFull"
            class="thread-system__preview flex-1 min-w-0 text-[0.8rem] text-(--color-text-secondary) truncate"
          >
            {{ truncate(head.systemPrompt, 160) }}
          </span>
          <span v-else class="flex-1" />
          <span class="thread-system__toggle inline-flex items-center gap-[0.15rem] text-(--q-primary) text-[0.72rem] font-medium shrink-0">
            <OIcon
              :name="showSystemFull ? 'expand-less' : 'expand-more'"
              size="sm"
            />
          </span>
        </div>
        <div
          v-if="showSystemFull"
          class="thread-system__content py-3 px-[0.875rem] border-t border-(--color-border-default) bg-(--color-surface-base,var(--color-surface-base)) text-[0.82rem] leading-[1.55] text-(--color-text-secondary) whitespace-pre-wrap break-words max-h-[360px] overflow-auto"
        >
          {{ head.systemPrompt }}
        </div>
      </div>

      <template v-for="group in displayGroups" :key="group.traceId">
        <!-- Hint about historical user messages from prior traces in the
             same session — these are answered in earlier traces. -->
        <div
          v-if="group.historicalUserCount > 0"
          class="thread-prior flex items-center gap-[0.5rem] px-[0.75rem] py-[0.4rem] mb-[0.5rem] rounded border border-dashed border-[var(--color-border-default)] text-[0.72rem] text-[var(--color-text-muted)]"
        >
          <span>↶</span>
          <span>
            {{ group.historicalUserCount === 1
              ? t('traces.threadView.historicalMessage', { count: group.historicalUserCount })
              : t('traces.threadView.historicalMessages', { count: group.historicalUserCount }) }}
          </span>
        </div>

        <!-- This group's user query. -->
        <div
          v-if="group.userQuery"
          class="thread-bubble thread-bubble--user thread-user-row flex items-start gap-[0.625rem] mb-4 ml-auto max-w-[40%] w-fit py-[0.625rem] px-[0.875rem] rounded-lg text-[0.85rem] leading-normal whitespace-pre-wrap break-words bg-[linear-gradient(135deg,#f8f9ff_0%,#e8edff_100%)] border border-[#e0e6ff] text-[#2c3e50] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
        >
          <div
            class="thread-user-avatar w-6 h-6 rounded-full bg-[linear-gradient(135deg,#8b5cf6_0%,#ec4899_100%)] text-white inline-flex items-center justify-content-center text-[0.7rem] font-bold shrink-0 cursor-default"
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
            class="thread-turn relative flex gap-[0.875rem] pb-4"
          >
          <div class="thread-turn__avatar shrink-0 relative z-[1] w-7 h-7 rounded-full bg-[#f3eaff] text-[#8b5cf6] flex items-center justify-center border border-[rgba(139,92,246,0.25)] shadow-[0_0_0_4px_var(--color-surface-base)]">
            <OIcon name="auto-awesome" size="xs" />
          </div>
          <div class="thread-turn__body flex-1 min-w-0 flex flex-col gap-2">
          <!-- Genuine follow-up user message(s). -->
          <div
            v-for="(u, uIdx) in turn.followupUsers"
            :key="`u-${uIdx}`"
            class="thread-bubble thread-bubble--user thread-bubble--user-followup py-[0.625rem] px-[0.875rem] rounded-lg text-[0.85rem] leading-normal whitespace-pre-wrap break-words max-w-[min(640px,75%)] bg-[linear-gradient(135deg,#f8f9ff_0%,#e8edff_100%)] border border-[#e0e6ff] text-[#2c3e50] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
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
            class="thread-bubble thread-bubble--assistant markdown-body self-start bg-white border border-[#e5e7eb] text-[#2c3e50] max-w-full shadow-[0_1px_2px_rgba(0,0,0,0.06)] py-[0.625rem] px-[0.875rem] rounded-lg text-[0.85rem] leading-normal break-words"
            v-html="renderMarkdown(msg.content)"
          />


          <!-- Footer. -->
          <div class="thread-turn__footer flex items-center flex-wrap gap-[0.35rem] mt-2 pt-2 border-t border-dashed border-(--color-border-default) text-[0.72rem] text-(--color-text-secondary)">
            <span class="thread-metric inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-[0.3rem] bg-(--color-surface-base,rgba(0,0,0,0.03)) border border-(--color-border-default) text-(--color-text-secondary) text-[0.7rem] leading-none whitespace-nowrap shrink-0" :title="t('traces.threadView.startedAt', { time: formatTime(turn.span.start_time) })">
              <OIcon name="schedule" size="xs" />
              {{ formatTime(turn.span.start_time) }}
            </span>
            <span class="thread-metric thread-metric--model inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-[0.3rem] text-[#8b5cf6] bg-[rgba(139,92,246,0.06)] border border-[rgba(139,92,246,0.2)] font-medium max-w-[200px] overflow-hidden text-ellipsis text-[0.7rem] leading-none whitespace-nowrap shrink-0" :title="getModel(turn.span)">
              <OIcon name="bolt" size="xs" />
              {{ getModel(turn.span) || t('traces.threadView.unknown') }}
            </span>
            <span class="thread-metric inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-[0.3rem] bg-(--color-surface-base,rgba(0,0,0,0.03)) border border-(--color-border-default) text-(--color-text-secondary) text-[0.7rem] leading-none whitespace-nowrap shrink-0" :title="t('traces.threadView.duration')">
              <OIcon name="timer" size="xs" />
              {{ formatDuration(turn.span.duration) }}
            </span>
            <span class="thread-metric inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-[0.3rem] bg-(--color-surface-base,rgba(0,0,0,0.03)) border border-(--color-border-default) text-(--color-text-secondary) text-[0.7rem] leading-none whitespace-nowrap shrink-0" :title="t('traces.threadView.tokens')">
              <OIcon name="data-usage" size="xs" />
              {{ formatNumber(getTokens(turn.span)) }} {{ t('traces.threadView.tokensSuffix') }}
            </span>
            <span class="thread-metric inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-[0.3rem] bg-(--color-surface-base,rgba(0,0,0,0.03)) border border-(--color-border-default) text-(--color-text-secondary) text-[0.7rem] leading-none whitespace-nowrap shrink-0" :title="t('traces.threadView.cost')">
              <OIcon name="payments" size="xs" />
              {{ formatCost(getCost(turn.span)) }}
            </span>
            <span
              v-if="turn.span.span_status === 'ERROR'"
              class="thread-metric thread-metric--error inline-flex items-center gap-1 py-[0.18rem] px-2 rounded-[0.3rem] text-[#dc2626] bg-[rgba(220,38,38,0.08)] border border-[rgba(220,38,38,0.25)] font-medium text-[0.7rem] leading-none whitespace-nowrap shrink-0"
            >
              <OIcon name="error-outline" size="xs" />
              {{ t('traces.threadView.error') }}
            </span>
            <button
              class="thread-turn__view-span ml-auto inline-flex items-center gap-[0.2rem] py-[0.2rem] px-[0.55rem] rounded-[0.3rem] text-(--q-primary) text-[0.72rem] font-medium bg-transparent border border-transparent cursor-pointer transition-all duration-[120ms] shrink-0"
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

const isDark = computed(() => store.state.theme === "dark");

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
const historicalUserCount = computed(() =>
  traceGroups.value.length ? traceGroups.value[0].historicalUserCount : 0,
);

const showSystemFull = ref(false);

/* ─── visual helpers ──────────────────────────────────────────────────── */

/** Model "family" glyph + accent color for the avatar. */
function modelBadge(model: string | null | undefined): {
  glyph: string;
  color: string;
} {
  const m = String(model || "").toLowerCase();
  if (m.includes("claude")) return { glyph: "A", color: "#cc785c" };
  if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3"))
    return { glyph: "O", color: "#10a37f" };
  if (m.includes("gemini")) return { glyph: "G", color: "#4285f4" };
  if (m.includes("deepseek")) return { glyph: "D", color: "#5a67d8" };
  if (m.includes("mistral")) return { glyph: "M", color: "#f97316" };
  return { glyph: "✦", color: "#10b981" };
}

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

<style>
/* OIcon color inside chip — descendant selector, cannot inline. */
.thread-chip .OIcon {
  color: var(--color-text-secondary);
}

/* Error chip value color — descendant selector. */
.thread-chip--error .thread-chip__value--error {
  color: var(--color-error-600);
}

/* ::before connector line on timeline turn — pseudo-element, cannot inline. */
.thread-turn::before {
  content: "";
  position: absolute;
  top: 30px;
  bottom: 0;
  left: 14px; /* avatar width / 2 */
  width: 2px;
  background: var(--color-border-default);
  border-radius: 1px;
}

.thread-turn:last-child::before {
  display: none;
}

/* Hover states — cannot inline. */
.thread-system__head:hover {
  background: rgba(139, 92, 246, 0.04);
}

.thread-turn__view-span:hover {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.25);
}

/* ─── dark mode overrides — all descendant selectors, cannot inline ───── */
.thread-view--dark .thread-bubble--user {
  background: linear-gradient(135deg, #2a2d47 0%, #1e213a 100%);
  border-color: #3a3d5c;
  color: #e2e8f0;
  box-shadow: 0 1px 2px rgba(255, 255, 255, 0.08);
}

.thread-view--dark .thread-bubble--assistant {
  background: #1a1a1a;
  border-color: #333333;
  color: #e2e2e2;
  box-shadow: 0 1px 2px rgba(255, 255, 255, 0.08);
}

.thread-view--dark .thread-user-avatar {
  background: linear-gradient(135deg, #4c63d2 0%, #5a67d8 100%);
  color: #ffffff;
}

.thread-view--dark .thread-turn__avatar {
  background: rgba(139, 92, 246, 0.16);
  color: #c4b5fd;
  border-color: rgba(139, 92, 246, 0.4);
  box-shadow: 0 0 0 4px var(--color-surface-base);
}

.thread-view--dark .thread-metric {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.thread-view--dark .thread-metric--model {
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.12);
  border-color: rgba(139, 92, 246, 0.3);
}

.thread-view--dark .thread-metric--error {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
  border-color: rgba(248, 113, 113, 0.3);
}

.thread-view--dark .thread-turn__footer {
  border-top-color: rgba(255, 255, 255, 0.08);
}

.thread-view--dark .thread-turn__view-span:hover {
  background: rgba(96, 165, 250, 0.12);
  border-color: rgba(96, 165, 250, 0.3);
}

.thread-view--dark .thread-system {
  border-left-color: #a78bfa;
}

.thread-view--dark .thread-system__head:hover {
  background: rgba(139, 92, 246, 0.08);
}

.thread-view--dark .thread-system__badge {
  background: rgba(139, 92, 246, 0.18);
  color: #c4b5fd;
}
</style>

<!-- Scoped block: the markdown-body :deep() selectors + SCSS nesting require a
     scoped lang="scss" style. :deep is the one sanctioned case for v-html
     (innerHTML) content, so these rules stay in a style block rather than
     inlined as  utilities. -->
<style scoped lang="scss">
/* ─── markdown rendering (assistant bubble v-html) ─────────────────────────
   Element styling for the sanitized markdown HTML. Scoped :deep is the one
   sanctioned case for innerHTML content; colours map to --color-* tokens. The
   bubble's pre-wrap is reset so rendered block elements don't get extra gaps. */
.thread-bubble--assistant.markdown-body {
  white-space: normal;
}
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
    font-size: 1.05rem;
  }
  :deep(h2) {
    font-size: 0.95rem;
  }
  :deep(h3) {
    font-size: 0.9rem;
  }
  :deep(h4) {
    font-size: 0.85rem;
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
    color: var(--color-primary-500, #3b82f6);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
  :deep(code) {
    font-family: monospace;
    font-size: 0.78rem;
    background: color-mix(in srgb, var(--color-text-body) 8%, transparent);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
  }
  :deep(pre) {
    background: color-mix(in srgb, var(--color-text-body) 5%, transparent);
    border: 1px solid var(--color-border-default);
    padding: 0.5rem 0.625rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  :deep(pre code) {
    background: transparent;
    padding: 0;
  }
  :deep(blockquote) {
    border-left: 3px solid var(--color-border-default);
    margin: 0.5rem 0;
    padding-left: 0.75rem;
    color: var(--color-text-secondary);
  }
  :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5rem 0;
    font-size: 0.78rem;
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
