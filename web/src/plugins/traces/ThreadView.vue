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
    - Classify spans by `llm_observation_type`
    - Render the trace summary chip-bar (turn count, total duration, cost,
      model, tool calls, errors)
    - Empty + skeleton states

  Phase B+ will add the actual conversation rendering.
-->
<template>
  <div
    class="thread-view tw:flex tw:flex-col tw:w-full tw:h-full"
    :class="{ 'thread-view--dark': isDark }"
  >
    <!-- Summary toolbar — sidebar-style badge chips. -->
    <div class="thread-summary">
      <q-chip
        dense
        square
        class="thread-chip thread-chip--steps"
        :title="`${summary.turnCount} LLM step${summary.turnCount === 1 ? '' : 's'}`"
      >
        <q-icon name="auto_awesome" size="12px" class="q-mr-xs" />
        <span class="thread-chip__label">Steps</span>
        <span class="thread-chip__value">{{ summary.turnCount }}</span>
      </q-chip>

      <q-chip dense square class="thread-chip thread-chip--tools">
        <q-icon name="build" size="12px" class="q-mr-xs" />
        <span class="thread-chip__label">Tools</span>
        <span class="thread-chip__value">{{ summary.toolCallCount }}</span>
      </q-chip>

      <q-chip dense square class="thread-chip thread-chip--duration">
        <q-icon name="schedule" size="12px" class="q-mr-xs" />
        <span class="thread-chip__label">Duration</span>
        <span class="thread-chip__value">
          {{ formatDuration(summary.totalDurationNs) }}
        </span>
      </q-chip>

      <q-chip dense square class="thread-chip thread-chip--cost">
        <q-icon name="payments" size="12px" class="q-mr-xs" />
        <span class="thread-chip__label">Cost</span>
        <span class="thread-chip__value">
          {{ formatCost(summary.totalCost) }}
        </span>
      </q-chip>

      <q-chip
        v-if="summary.dominantModel"
        dense
        square
        class="thread-chip thread-chip--model"
        :title="summary.dominantModel"
      >
        <q-icon name="bolt" size="12px" class="q-mr-xs" />
        <span class="thread-chip__label">Model</span>
        <span class="thread-chip__value">{{ summary.dominantModel }}</span>
      </q-chip>

      <q-chip
        v-if="summary.errorCount > 0"
        dense
        square
        class="thread-chip thread-chip--error"
      >
        <q-icon name="error_outline" size="12px" class="q-mr-xs" />
        <span class="thread-chip__label">Errors</span>
        <span class="thread-chip__value">{{ summary.errorCount }}</span>
      </q-chip>

    </div>

    <!-- Body -->
    <div
      v-if="!props.spans || props.spans.length === 0"
      class="tw:flex-1 tw:flex tw:items-center tw:justify-center tw:text-[var(--o2-text-3)] tw:text-[0.85rem]"
    >
      No spans loaded for this trace.
    </div>
    <div
      v-else-if="turns.length === 0"
      class="tw:flex-1 tw:flex tw:items-center tw:justify-center tw:text-[var(--o2-text-3)] tw:text-[0.85rem]"
    >
      No LLM turns detected. The trace doesn't contain spans with
      <code>llm_observation_type = GENERATION</code>.
    </div>
    <div v-else class="tw:flex-1 tw:overflow-auto tw:px-[1rem] tw:py-[0.75rem]">
      <!-- System prompt (global — identical across traces in a session). -->
      <div v-if="head.systemPrompt" class="thread-system">
        <div
          class="thread-system__head"
          @click="showSystemFull = !showSystemFull"
        >
          <span class="thread-system__badge">
            <q-icon name="settings" size="11px" class="q-mr-xs" />
            System
          </span>
          <span
            v-if="!showSystemFull"
            class="thread-system__preview"
          >
            {{ truncate(head.systemPrompt, 160) }}
          </span>
          <span v-else class="tw:flex-1" />
          <span class="thread-system__toggle">
            <q-icon
              :name="showSystemFull ? 'expand_less' : 'expand_more'"
              size="18px"
            />
          </span>
        </div>
        <div v-if="showSystemFull" class="thread-system__content">
          {{ head.systemPrompt }}
        </div>
      </div>

      <template v-for="group in traceGroups" :key="group.traceId">
        <!-- Hint about historical user messages from prior traces in the
             same session — these are answered in earlier traces. -->
        <div
          v-if="group.historicalUserCount > 0"
          class="thread-prior tw:flex tw:items-center tw:gap-[0.5rem] tw:px-[0.75rem] tw:py-[0.4rem] tw:mb-[0.5rem] tw:rounded tw:border tw:border-dashed tw:border-[var(--o2-border-color)] tw:text-[0.72rem] tw:text-[var(--o2-text-3)]"
        >
          <span>↶</span>
          <span>
            {{ group.historicalUserCount }} earlier
            {{ group.historicalUserCount === 1 ? "message" : "messages" }}
            from this session — handled in previous traces.
          </span>
        </div>

        <!-- This group's user query. -->
        <div
          v-if="group.userQuery"
          class="thread-bubble thread-bubble--user thread-user-row"
        >
          <div
            class="thread-user-avatar"
            :title="group.userId || 'User'"
          >
            <q-icon name="person" size="16px" />
            <q-tooltip
              v-if="group.userId"
              anchor="bottom middle"
              self="top middle"
              :offset="[0, 6]"
            >
              {{ group.userId }}
            </q-tooltip>
          </div>
          <div class="thread-user-row__text">{{ group.userQuery }}</div>
        </div>

        <!-- Timeline rail of turns. -->
        <div class="thread-rail">
          <div
            v-for="turn in group.turns"
            :key="turn.span.span_id"
            class="thread-turn"
          >
          <div class="thread-turn__avatar">
            <q-icon name="auto_awesome" size="14px" />
          </div>
          <div class="thread-turn__body">
          <!-- Genuine follow-up user message(s). -->
          <div
            v-for="(u, uIdx) in turn.followupUsers"
            :key="`u-${uIdx}`"
            class="thread-bubble thread-bubble--user thread-bubble--user-followup"
          >
            {{ u.content }}
          </div>

          <!-- Assistant text. -->
          <div
            v-for="(msg, mIdx) in turn.assistant"
            :key="`a-${mIdx}`"
            class="thread-bubble thread-bubble--assistant"
          >
            {{ msg.content }}
          </div>

          <!-- Tool calls — one grouped card. -->
          <div v-if="turn.toolCalls.length > 0" class="thread-tools-card">
            <div class="thread-tools-card__header">
              <span class="thread-tools-card__count">
                {{ turn.toolCalls.length }}
                {{ turn.toolCalls.length === 1 ? "Tool call" : "Tool calls" }}
              </span>
              <span class="thread-tools-card__total">
                Σ {{ formatDuration(totalToolDuration(turn.toolCalls)) }}
              </span>
            </div>
            <div
              v-for="t in turn.toolCalls"
              :key="t.span_id"
              class="thread-tool"
              :class="{ 'thread-tool--open': expandedTools.has(t.span_id) }"
            >
              <div class="thread-tool-row" @click="toggleTool(t.span_id)">
                <span class="thread-tool-row__caret">{{
                  expandedTools.has(t.span_id) ? "▾" : "▸"
                }}</span>
                <span class="thread-tool-row__icon">{{
                  toolGlyph(
                    t.tool_name || t.gen_ai_tool_name || t.operation_name,
                  )
                }}</span>
                <span class="thread-tool-row__name">{{
                  t.tool_name || t.gen_ai_tool_name || t.operation_name
                }}</span>
                <span class="tw:flex-1" />
                <span
                  class="thread-pill"
                  :class="
                    t.span_status === 'ERROR'
                      ? 'thread-pill--error'
                      : 'thread-pill--ok'
                  "
                >
                  {{ t.span_status === "ERROR" ? "ERROR" : "OK" }}
                  · {{ formatDuration(t.duration) }}
                </span>
                <button
                  class="thread-tool-row__view"
                  @click.stop="emit('span-selected', t.span_id)"
                  title="Open span details"
                >
                  <q-icon name="open_in_new" size="14px" />
                </button>
              </div>

              <div v-if="expandedTools.has(t.span_id)" class="thread-tool-body">
                <div class="thread-tool-body__section">
                  <div class="thread-tool-body__label">Arguments</div>
                  <pre class="thread-tool-body__pre">{{
                    formatToolPayload(getInputRaw(t) || t.tool_args)
                  }}</pre>
                </div>
                <div class="thread-tool-body__section">
                  <div class="thread-tool-body__label">
                    Result
                    <span
                      v-if="t.span_status === 'ERROR'"
                      class="tw:text-[#dc2626]"
                    >
                      · ERROR
                    </span>
                  </div>
                  <pre class="thread-tool-body__pre">{{
                    formatToolPayload(getOutputRaw(t)) ||
                    t.status_message ||
                    "(empty)"
                  }}</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer. -->
          <div class="thread-turn__footer">
            <span class="thread-metric" :title="`Started at ${formatTime(turn.span.start_time)}`">
              <q-icon name="schedule" size="11px" />
              {{ formatTime(turn.span.start_time) }}
            </span>
            <span class="thread-metric thread-metric--model" :title="getModel(turn.span)">
              <q-icon name="bolt" size="11px" />
              {{ getModel(turn.span) || "unknown" }}
            </span>
            <span class="thread-metric" title="Duration">
              <q-icon name="timer" size="11px" />
              {{ formatDuration(turn.span.duration) }}
            </span>
            <span class="thread-metric" title="Tokens">
              <q-icon name="data_usage" size="11px" />
              {{ formatNumber(getTokens(turn.span)) }} tokens
            </span>
            <span class="thread-metric" title="Cost">
              <q-icon name="payments" size="11px" />
              {{ formatCost(getCost(turn.span)) }}
            </span>
            <span
              v-if="turn.span.span_status === 'ERROR'"
              class="thread-metric thread-metric--error"
            >
              <q-icon name="error_outline" size="11px" />
              Error
            </span>
            <button
              class="thread-turn__view-span"
              @click="emit('span-selected', turn.span.span_id)"
            >
              View span
              <q-icon name="arrow_forward" size="12px" />
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

interface Props {
  spans: any[];
  selectedSpanId?: string;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "span-selected", spanId: string): void;
}>();

import { useStore } from "vuex";
import {
  getModel,
  getInputRaw,
  getOutputRaw,
  getCost,
  getTokens,
  classify,
  buildTraceGroup,
  type Message,
  type Turn,
  type TraceGroup,
} from "./threadView.utils";

const store = useStore();

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

/* ─── tool row expansion ──────────────────────────────────────────────── */
const expandedTools = ref<Set<string>>(new Set());

function totalToolDuration(tools: any[]): number {
  let sum = 0;
  for (const t of tools) sum += Number(t.duration) || 0;
  return sum;
}

function toggleTool(spanId: string) {
  const next = new Set(expandedTools.value);
  if (next.has(spanId)) next.delete(spanId);
  else next.add(spanId);
  expandedTools.value = next;
}

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

/** Pick a glyph for a tool span based on its name. */
function toolGlyph(name: string | null | undefined): string {
  const n = String(name || "").toLowerCase();
  if (n.includes("schema")) return "🗄";
  if (n.includes("list") || n.includes("history")) return "📋";
  if (n.includes("search") || n.includes("query") || n.includes("sql"))
    return "🔍";
  if (n.includes("read") || n.includes("get") || n.includes("fetch"))
    return "📖";
  if (n.includes("write") || n.includes("edit") || n.includes("create"))
    return "✏";
  if (n.includes("delete") || n.includes("remove")) return "🗑";
  if (n.includes("tool") || n.includes("call")) return "⚙";
  if (n.includes("nav")) return "🧭";
  if (n.includes("time") || n.includes("range")) return "⏱";
  if (n.includes("merged")) return "∑";
  if (n.includes("skill") || n.includes("plan")) return "🧩";
  return "▸";
}

function formatToolPayload(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    // Try to pretty-print JSON, fall back to raw string.
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        // not JSON
      }
    }
    return trimmed;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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

<style scoped lang="scss">
.thread-view {
  background: var(--o2-card-bg);
}

/* Subtle off-white background for the scroll body, like the design. */
.thread-view > div.tw\:flex-1.tw\:overflow-auto {
  background: var(--o2-bg-2, var(--o2-card-bg));
}

.thread-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  background: var(--o2-bg-2, transparent);
  border-bottom: 1px solid var(--o2-border-color);
}

.thread-chip {
  height: 26px !important;
  padding: 0 0.625rem !important;
  background: var(--o2-card-bg) !important;
  border: 1px solid var(--o2-border-color);
  border-radius: 0.25rem !important;
  font-size: 12px !important;
  font-feature-settings: "tnum";
  color: var(--o2-text-1) !important;

  :deep(.q-icon) {
    color: var(--o2-text-2);
  }

  &__label {
    color: var(--o2-text-2);
    font-weight: 500;
    margin-right: 5px;
    letter-spacing: 0;
    font-size: 11.5px;
  }

  &__value {
    color: var(--o2-text-1);
    font-weight: 600;
    font-size: 12px;
  }

  &--turns { border-left: 3px solid #6366f1; }
  &--steps { border-left: 3px solid #cc785c; }
  &--tools { border-left: 3px solid #0ea5e9; }
  &--duration { border-left: 3px solid #64748b; }
  &--cost { border-left: 3px solid #16a34a; }
  &--model { border-left: 3px solid #8b5cf6; }
  &--error {
    border-left: 3px solid #dc2626;
    .thread-chip__value {
      color: #dc2626;
    }
  }
}

.thread-system {
  margin-bottom: 1rem;
  border: 1px solid var(--o2-border-color);
  border-left: 3px solid #8b5cf6;
  border-radius: 0.4rem;
  background: var(--o2-card-bg);
  overflow: hidden;

  &__head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    transition: background 120ms ease;

    &:hover {
      background: rgba(139, 92, 246, 0.04);
    }
  }

  &__badge {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    background: rgba(139, 92, 246, 0.1);
    color: #8b5cf6;
    border-radius: 0.25rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02rem;
    flex-shrink: 0;
  }

  &__preview {
    flex: 1;
    min-width: 0;
    font-size: 0.8rem;
    color: var(--o2-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--q-primary);
    font-size: 0.72rem;
    font-weight: 500;
    flex-shrink: 0;
  }

  &__content {
    padding: 0.75rem 0.875rem;
    border-top: 1px solid var(--o2-border-color);
    background: var(--o2-bg-2, var(--o2-card-bg));
    font-size: 0.82rem;
    line-height: 1.55;
    color: var(--o2-text-1);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 360px;
    overflow: auto;
  }
}

.thread-bubble {
  padding: 0.625rem 0.875rem;
  border-radius: 0.5rem;
  font-size: 0.85rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;

  &--user {
    background: linear-gradient(135deg, #f8f9ff 0%, #e8edff 100%);
    border: 1px solid #e0e6ff;
    color: #2c3e50;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);

    &-followup {
      max-width: min(640px, 75%);
    }
  }

  &--assistant {
    align-self: flex-start;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    color: #2c3e50;
    max-width: 100%;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  &--muted {
    background: transparent;
    border-style: dashed;
    color: var(--o2-text-3);
  }
}

.thread-user-row {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  margin-bottom: 1rem;
  margin-left: auto;
  max-width: 40%;
  width: fit-content;

  &__text {
    flex: 1;
    min-width: 0;
    align-self: center;
  }
}

.thread-user-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  flex-shrink: 0;
  cursor: default;
}

/* ─── timeline rail ───────────────────────────────────────────────────── */
.thread-rail {
  position: relative;
  padding-left: 0;
}

.thread-turn {
  position: relative;
  display: flex;
  gap: 0.875rem;
  padding-bottom: 1rem;

  /* Connector line drawn through the avatar column. */
  &::before {
    content: "";
    position: absolute;
    top: 30px;
    bottom: 0;
    left: 14px; /* avatar width / 2 */
    width: 2px;
    background: var(--o2-border-color);
    border-radius: 1px;
  }

  &:last-child::before {
    display: none;
  }

  &__avatar {
    flex-shrink: 0;
    position: relative;
    z-index: 1;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #f3eaff; /* light purple wash */
    color: #8b5cf6;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(139, 92, 246, 0.25);
    box-shadow: 0 0 0 4px var(--o2-card-bg);
  }

  &__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  &__footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--o2-border-color);
    font-size: 0.72rem;
    color: var(--o2-text-2);
  }

  &__view-span {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.2rem 0.55rem;
    border-radius: 0.3rem;
    color: var(--q-primary);
    font-size: 0.72rem;
    font-weight: 500;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 120ms ease;
    flex-shrink: 0;

    &:hover {
      background: rgba(59, 130, 246, 0.08);
      border-color: rgba(59, 130, 246, 0.25);
    }
  }
}

/* ─── footer metric chips ─────────────────────────────────────────────── */
.thread-metric {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.5rem;
  border-radius: 0.3rem;
  background: var(--o2-bg-2, rgba(0, 0, 0, 0.03));
  border: 1px solid var(--o2-border-color);
  color: var(--o2-text-2);
  font-size: 0.7rem;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;

  .q-icon {
    color: var(--o2-text-3);
  }

  &--model {
    color: #8b5cf6;
    background: rgba(139, 92, 246, 0.06);
    border-color: rgba(139, 92, 246, 0.2);
    font-weight: 500;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;

    .q-icon {
      color: #8b5cf6;
    }
  }

  &--error {
    color: #dc2626;
    background: rgba(220, 38, 38, 0.08);
    border-color: rgba(220, 38, 38, 0.25);
    font-weight: 500;

    .q-icon {
      color: #dc2626;
    }
  }
}

/* ─── grouped tool card (secondary weight) ───────────────────────────── */
.thread-tools-card {
  border: 1px solid rgba(76, 175, 80, 0.18);
  border-radius: 0.4rem;
  background: rgba(76, 175, 80, 0.06);
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.625rem;
    border-bottom: 1px solid rgba(76, 175, 80, 0.15);
    font-size: 0.68rem;
    color: #4a5568;
  }

  &__count {
    font-weight: 600;
    color: #4a5568;
    letter-spacing: 0;
    font-size: 0.72rem;
  }

  &__total {
    margin-left: auto;
    font-family: monospace;
  }
}

.thread-tool {
  border-bottom: 1px solid rgba(76, 175, 80, 0.15);
  background: rgba(76, 175, 80, 0.04);
  transition: background 120ms ease;

  &:last-child {
    border-bottom: none;
  }

  &--open {
    background: rgba(76, 175, 80, 0.1);
  }
}

.thread-tool-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.5rem 0.45rem 0.75rem;
  font-size: 0.78rem;
  cursor: pointer;
  color: #4a5568;
  transition: background 120ms ease;

  &:hover {
    background: rgba(76, 175, 80, 0.12);
  }

  &__caret {
    color: #4a5568;
    font-size: 0.7rem;
    width: 12px;
    text-align: center;
  }

  &__icon {
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.95rem;
  }

  &__name {
    font-family: monospace;
    color: #2f7a31;
    font-weight: 500;
  }

  &__view {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 0.25rem;
    background: transparent;
    border: none;
    color: var(--o2-text-3);
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
    transition: all 120ms ease;

    &:hover {
      background: rgba(76, 175, 80, 0.18);
      color: #2f7a31;
    }
  }
}

/* ─── status pills ────────────────────────────────────────────────────── */
.thread-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.03rem;
  font-family: monospace;
  white-space: nowrap;

  &--ok {
    background: rgba(22, 163, 74, 0.1);
    color: #16a34a;
    border: 1px solid rgba(22, 163, 74, 0.25);
  }

  &--error {
    background: rgba(220, 38, 38, 0.1);
    color: #dc2626;
    border: 1px solid rgba(220, 38, 38, 0.25);
  }
}

/* ─── dark mode overrides ─────────────────────────────────────────────── */
.thread-view--dark {
  .thread-bubble--user {
    background: linear-gradient(135deg, #2a2d47 0%, #1e213a 100%);
    border-color: #3a3d5c;
    color: #e2e8f0;
    box-shadow: 0 1px 2px rgba(255, 255, 255, 0.08);
  }

  .thread-bubble--assistant {
    background: #1a1a1a;
    border-color: #333333;
    color: #e2e2e2;
    box-shadow: 0 1px 2px rgba(255, 255, 255, 0.08);
  }

  .thread-user-avatar {
    background: linear-gradient(135deg, #4c63d2 0%, #5a67d8 100%);
    color: #ffffff;
  }

  .thread-turn__avatar {
    background: rgba(139, 92, 246, 0.16);
    color: #c4b5fd;
    border-color: rgba(139, 92, 246, 0.4);
    box-shadow: 0 0 0 4px var(--o2-card-bg);
  }

  .thread-tools-card {
    background: rgba(76, 175, 80, 0.08);
    border-color: rgba(76, 175, 80, 0.22);

    &__header {
      border-bottom-color: rgba(76, 175, 80, 0.2);
      color: #a0aec0;
    }

    &__count {
      color: #a0aec0;
    }
  }

  .thread-tool {
    background: rgba(76, 175, 80, 0.06);
    border-bottom-color: rgba(76, 175, 80, 0.2);
    color: #a0aec0;

    &--open {
      background: rgba(76, 175, 80, 0.14);
    }
  }

  .thread-tool-row {
    color: #a0aec0;

    &:hover {
      background: rgba(76, 175, 80, 0.16);
    }

    &__caret {
      color: #a0aec0;
    }

    &__name {
      color: #6dd170;
    }

    &__view:hover {
      background: rgba(76, 175, 80, 0.22);
      color: #6dd170;
    }
  }

  .thread-pill--ok {
    background: rgba(34, 197, 94, 0.14);
    color: #4ade80;
    border-color: rgba(34, 197, 94, 0.3);
  }

  .thread-pill--error {
    background: rgba(248, 113, 113, 0.14);
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.3);
  }

  .thread-metric {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.08);

    &--model {
      color: #c4b5fd;
      background: rgba(139, 92, 246, 0.12);
      border-color: rgba(139, 92, 246, 0.3);

      .q-icon {
        color: #c4b5fd;
      }
    }

    &--error {
      color: #f87171;
      background: rgba(248, 113, 113, 0.12);
      border-color: rgba(248, 113, 113, 0.3);

      .q-icon {
        color: #f87171;
      }
    }
  }

  .thread-turn__footer {
    border-top-color: rgba(255, 255, 255, 0.08);
  }

  .thread-turn__view-span:hover {
    background: rgba(96, 165, 250, 0.12);
    border-color: rgba(96, 165, 250, 0.3);
  }

  .thread-system {
    border-left-color: #a78bfa;

    &__head:hover {
      background: rgba(139, 92, 246, 0.08);
    }

    &__badge {
      background: rgba(139, 92, 246, 0.18);
      color: #c4b5fd;
    }
  }
}

.thread-tool-body {
  padding: 0.5rem 0.75rem 0.75rem;
  background: var(--o2-bg-2, var(--o2-card-bg));
  border-top: 1px dashed var(--o2-border-color);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__section {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  &__label {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.06rem;
    color: var(--o2-text-3);
  }

  &__pre {
    margin: 0;
    padding: 0.5rem 0.625rem;
    background: var(--o2-card-bg);
    border: 1px solid var(--o2-border-color);
    border-radius: 0.25rem;
    font-family: monospace;
    font-size: 0.72rem;
    color: var(--o2-text-1);
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 280px;
    overflow: auto;
  }
}
</style>
