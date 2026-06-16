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
    class="thread-view tw:flex tw:flex-col tw:w-full tw:h-full tw:bg-(--o2-card-bg)"
    :class="{ 'thread-view--dark': isDark }"
  >
    <!-- Summary toolbar — sidebar-style badge chips. -->
    <div class="thread-summary tw:flex tw:flex-wrap tw:items-center tw:gap-[0.4rem] tw:py-2 tw:px-4 tw:bg-(--o2-bg-2,transparent) tw:border-b tw:border-(--o2-border-color)">
      <OBadge
        size="sm"
        class="thread-chip thread-chip--steps tw:h-[26px]! tw:px-[0.625rem]! tw:py-0! tw:bg-(--o2-card-bg)! tw:border tw:border-(--o2-border-color) tw:rounded! tw:text-xs! tw:text-(--o2-text-primary)! tw:border-l-[3px]! tw:border-l-[#cc785c]!"
        :title="`${summary.turnCount} LLM step${summary.turnCount === 1 ? '' : 's'}`"
      >
        <template #icon><OIcon name="auto-awesome" size="xs" /></template>
        <span class="thread-chip__label tw:text-(--o2-text-muted) tw:font-medium tw:mr-[5px] tw:tracking-normal tw:text-[11.5px]">Steps</span>
        <span class="thread-chip__value tw:text-(--o2-text-primary) tw:font-semibold tw:text-xs">{{ summary.turnCount }}</span>
      </OBadge>

      <OBadge size="sm" class="thread-chip thread-chip--tools tw:h-[26px]! tw:px-[0.625rem]! tw:py-0! tw:bg-(--o2-card-bg)! tw:border tw:border-(--o2-border-color) tw:rounded! tw:text-xs! tw:text-(--o2-text-primary)! tw:border-l-[3px]! tw:border-l-[#0ea5e9]!">
        <template #icon><OIcon name="build" size="xs" /></template>
        <span class="thread-chip__label tw:text-(--o2-text-muted) tw:font-medium tw:mr-[5px] tw:tracking-normal tw:text-[11.5px]">Tools</span>
        <span class="thread-chip__value tw:text-(--o2-text-primary) tw:font-semibold tw:text-xs">{{ summary.toolCallCount }}</span>
      </OBadge>

      <OBadge size="sm" class="thread-chip thread-chip--duration tw:h-[26px]! tw:px-[0.625rem]! tw:py-0! tw:bg-(--o2-card-bg)! tw:border tw:border-(--o2-border-color) tw:rounded! tw:text-xs! tw:text-(--o2-text-primary)! tw:border-l-[3px]! tw:border-l-[#64748b]!">
        <template #icon><OIcon name="schedule" size="xs" /></template>
        <span class="thread-chip__label tw:text-(--o2-text-muted) tw:font-medium tw:mr-[5px] tw:tracking-normal tw:text-[11.5px]">Duration</span>
        <span class="thread-chip__value tw:text-(--o2-text-primary) tw:font-semibold tw:text-xs">
          {{ formatDuration(summary.totalDurationNs) }}
        </span>
      </OBadge>

      <OBadge size="sm" class="thread-chip thread-chip--cost tw:h-[26px]! tw:px-[0.625rem]! tw:py-0! tw:bg-(--o2-card-bg)! tw:border tw:border-(--o2-border-color) tw:rounded! tw:text-xs! tw:text-(--o2-text-primary)! tw:border-l-[3px]! tw:border-l-[#16a34a]!">
        <template #icon><OIcon name="payments" size="xs" /></template>
        <span class="thread-chip__label tw:text-(--o2-text-muted) tw:font-medium tw:mr-[5px] tw:tracking-normal tw:text-[11.5px]">Cost</span>
        <span class="thread-chip__value tw:text-(--o2-text-primary) tw:font-semibold tw:text-xs">
          {{ formatCost(summary.totalCost) }}
        </span>
      </OBadge>

      <OBadge
        v-if="summary.dominantModel"
        size="sm"
        class="thread-chip thread-chip--model tw:h-[26px]! tw:px-[0.625rem]! tw:py-0! tw:bg-(--o2-card-bg)! tw:border tw:border-(--o2-border-color) tw:rounded! tw:text-xs! tw:text-(--o2-text-primary)! tw:border-l-[3px]! tw:border-l-[#8b5cf6]!"
        :title="summary.dominantModel"
      >
        <template #icon><OIcon name="bolt" size="xs" /></template>
        <span class="thread-chip__label tw:text-(--o2-text-muted) tw:font-medium tw:mr-[5px] tw:tracking-normal tw:text-[11.5px]">Model</span>
        <span class="thread-chip__value tw:text-(--o2-text-primary) tw:font-semibold tw:text-xs">{{ summary.dominantModel }}</span>
      </OBadge>

      <OBadge
        v-if="summary.errorCount > 0"
        size="sm"
        class="thread-chip thread-chip--error tw:h-[26px]! tw:px-[0.625rem]! tw:py-0! tw:bg-(--o2-card-bg)! tw:border tw:border-(--o2-border-color) tw:rounded! tw:text-xs! tw:text-(--o2-text-primary)! tw:border-l-[3px]! tw:border-l-[var(--o2-status-error-text)]!"
      >
        <template #icon><OIcon name="error-outline" size="xs" /></template>
        <span class="thread-chip__label tw:text-(--o2-text-muted) tw:font-medium tw:mr-[5px] tw:tracking-normal tw:text-[11.5px]">Errors</span>
        <span class="thread-chip__value thread-chip__value--error tw:font-semibold tw:text-xs tw:text-(--o2-status-error-text)">{{ summary.errorCount }}</span>
      </OBadge>

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
      <code>gen_ai.operation.name = chat</code>.
    </div>
    <div v-else class="thread-scroll-body tw:flex-1 tw:overflow-auto tw:px-[1rem] tw:py-[0.75rem] tw:bg-(--o2-bg-2,var(--o2-card-bg))">
      <!-- System prompt (global — identical across traces in a session). -->
      <div
        v-if="head.systemPrompt"
        class="thread-system tw:mb-4 tw:border tw:border-(--o2-border-color) tw:border-l-[3px] tw:border-l-[#8b5cf6] tw:rounded-[0.4rem] tw:bg-(--o2-card-bg) tw:overflow-hidden"
      >
        <div
          class="thread-system__head tw:flex tw:items-center tw:gap-[0.625rem] tw:py-2 tw:px-3 tw:cursor-pointer tw:transition-all tw:duration-[120ms]"
          @click="showSystemFull = !showSystemFull"
        >
          <span class="thread-system__badge tw:inline-flex tw:items-center tw:py-[0.15rem] tw:px-2 tw:bg-[rgba(139,92,246,0.1)] tw:text-[#8b5cf6] tw:rounded tw:text-[0.7rem] tw:font-semibold tw:tracking-[0.02rem] tw:shrink-0">
            <OIcon name="settings" size="xs" class="tw:mr-1" />
            System
          </span>
          <span
            v-if="!showSystemFull"
            class="thread-system__preview tw:flex-1 tw:min-w-0 tw:text-[0.8rem] tw:text-(--o2-text-2) tw:truncate"
          >
            {{ truncate(head.systemPrompt, 160) }}
          </span>
          <span v-else class="tw:flex-1" />
          <span class="thread-system__toggle tw:inline-flex tw:items-center tw:gap-[0.15rem] tw:text-(--q-primary) tw:text-[0.72rem] tw:font-medium tw:shrink-0">
            <OIcon
              :name="showSystemFull ? 'expand-less' : 'expand-more'"
              size="sm"
            />
          </span>
        </div>
        <div
          v-if="showSystemFull"
          class="thread-system__content tw:py-3 tw:px-[0.875rem] tw:border-t tw:border-(--o2-border-color) tw:bg-(--o2-bg-2,var(--o2-card-bg)) tw:text-[0.82rem] tw:leading-[1.55] tw:text-(--o2-text-1) tw:whitespace-pre-wrap tw:break-words tw:max-h-[360px] tw:overflow-auto"
        >
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
          class="thread-bubble thread-bubble--user thread-user-row tw:flex tw:items-start tw:gap-[0.625rem] tw:mb-4 tw:ml-auto tw:max-w-[40%] tw:w-fit tw:py-[0.625rem] tw:px-[0.875rem] tw:rounded-lg tw:text-[0.85rem] tw:leading-normal tw:whitespace-pre-wrap tw:break-words tw:bg-[linear-gradient(135deg,#f8f9ff_0%,#e8edff_100%)] tw:border tw:border-[#e0e6ff] tw:text-[#2c3e50] tw:shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
        >
          <div
            class="thread-user-avatar tw:w-6 tw:h-6 tw:rounded-full tw:bg-[linear-gradient(135deg,#8b5cf6_0%,#ec4899_100%)] tw:text-white tw:inline-flex tw:items-center tw:justify-content-center tw:text-[0.7rem] tw:font-bold tw:shrink-0 tw:cursor-default"
            :title="group.userId || 'User'"
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
          <div class="thread-user-row__text tw:flex-1 tw:min-w-0 tw:self-center">{{ group.userQuery }}</div>
        </div>

        <!-- Timeline rail of turns. -->
        <div class="thread-rail tw:relative tw:pl-0">
          <div
            v-for="turn in group.turns"
            :key="turn.span.span_id"
            class="thread-turn tw:relative tw:flex tw:gap-[0.875rem] tw:pb-4"
          >
          <div class="thread-turn__avatar tw:shrink-0 tw:relative tw:z-[1] tw:w-7 tw:h-7 tw:rounded-full tw:bg-[#f3eaff] tw:text-[#8b5cf6] tw:flex tw:items-center tw:justify-center tw:border tw:border-[rgba(139,92,246,0.25)] tw:shadow-[0_0_0_4px_var(--o2-card-bg)]">
            <OIcon name="auto-awesome" size="xs" />
          </div>
          <div class="thread-turn__body tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-2">
          <!-- Genuine follow-up user message(s). -->
          <div
            v-for="(u, uIdx) in turn.followupUsers"
            :key="`u-${uIdx}`"
            class="thread-bubble thread-bubble--user thread-bubble--user-followup tw:py-[0.625rem] tw:px-[0.875rem] tw:rounded-lg tw:text-[0.85rem] tw:leading-normal tw:whitespace-pre-wrap tw:break-words tw:max-w-[min(640px,75%)] tw:bg-[linear-gradient(135deg,#f8f9ff_0%,#e8edff_100%)] tw:border tw:border-[#e0e6ff] tw:text-[#2c3e50] tw:shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
          >
            {{ u.content }}
          </div>

          <!-- Assistant text. -->
          <div
            v-for="(msg, mIdx) in turn.assistant"
            :key="`a-${mIdx}`"
            class="thread-bubble thread-bubble--assistant tw:self-start tw:bg-white tw:border tw:border-[#e5e7eb] tw:text-[#2c3e50] tw:max-w-full tw:shadow-[0_1px_2px_rgba(0,0,0,0.06)] tw:py-[0.625rem] tw:px-[0.875rem] tw:rounded-lg tw:text-[0.85rem] tw:leading-normal tw:whitespace-pre-wrap tw:break-words"
          >
            {{ msg.content }}
          </div>

          <!-- Tool calls — one grouped card. -->
          <div
            v-if="turn.toolCalls.length > 0"
            class="thread-tools-card tw:border tw:border-[rgba(76,175,80,0.18)] tw:rounded-[0.4rem] tw:bg-[rgba(76,175,80,0.06)] tw:overflow-hidden"
          >
            <div class="thread-tools-card__header tw:flex tw:items-center tw:gap-2 tw:py-[0.3rem] tw:px-[0.625rem] tw:border-b tw:border-[rgba(76,175,80,0.15)] tw:text-[0.68rem] tw:text-[#4a5568]">
              <span class="thread-tools-card__count tw:font-semibold tw:text-[#4a5568] tw:tracking-normal tw:text-[0.72rem]">
                {{ turn.toolCalls.length }}
                {{ turn.toolCalls.length === 1 ? "Tool call" : "Tool calls" }}
              </span>
              <span class="thread-tools-card__total tw:ml-auto tw:font-mono">
                Σ {{ formatDuration(totalToolDuration(turn.toolCalls)) }}
              </span>
            </div>
            <div
              v-for="t in turn.toolCalls"
              :key="t.span_id"
              class="thread-tool tw:border-b tw:border-[rgba(76,175,80,0.15)] tw:bg-[rgba(76,175,80,0.04)] tw:transition-all tw:duration-[120ms]"
              :class="{ 'thread-tool--open': expandedTools.has(t.span_id) }"
            >
              <div class="thread-tool-row tw:flex tw:items-center tw:gap-2 tw:py-[0.45rem] tw:pr-2 tw:pl-3 tw:text-[0.78rem] tw:cursor-pointer tw:text-[#4a5568] tw:transition-all tw:duration-[120ms]" @click="toggleTool(t.span_id)">
                <span class="thread-tool-row__caret tw:text-[#4a5568] tw:text-[0.7rem] tw:w-3 tw:text-center">{{
                  expandedTools.has(t.span_id) ? "▾" : "▸"
                }}</span>
                <span class="thread-tool-row__icon tw:w-[18px] tw:h-[18px] tw:inline-flex tw:items-center tw:justify-center tw:text-[0.95rem]">{{
                  toolGlyph(
                    t.tool_name || t.gen_ai_tool_name || t.operation_name,
                  )
                }}</span>
                <span class="thread-tool-row__name tw:font-mono tw:text-[#2f7a31] tw:font-medium">{{
                  t.tool_name || t.gen_ai_tool_name || t.operation_name
                }}</span>
                <span class="tw:flex-1" />
                <span
                  class="thread-pill tw:inline-flex tw:items-center tw:gap-1 tw:py-[0.1rem] tw:px-2 tw:rounded-full tw:text-[0.65rem] tw:font-semibold tw:tracking-[0.03rem] tw:font-mono tw:whitespace-nowrap"
                  :class="
                    t.span_status === 'ERROR'
                      ? 'thread-pill--error tw:bg-[rgba(220,38,38,0.1)] tw:text-[#dc2626] tw:border tw:border-[rgba(220,38,38,0.25)]'
                      : 'thread-pill--ok tw:bg-[rgba(22,163,74,0.1)] tw:text-[#16a34a] tw:border tw:border-[rgba(22,163,74,0.25)]'
                  "
                >
                  {{ t.span_status === "ERROR" ? "ERROR" : "OK" }}
                  · {{ formatDuration(t.duration) }}
                </span>
                <button
                  class="thread-tool-row__view tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded tw:bg-transparent tw:border-0 tw:text-(--o2-text-3) tw:cursor-pointer tw:leading-none tw:shrink-0 tw:transition-all tw:duration-[120ms]"
                  @click.stop="emit('span-selected', t.span_id)"
                  title="Open span details"
                >
                  <OIcon name="open-in-new" size="xs" />
                </button>
              </div>

              <div
                v-if="expandedTools.has(t.span_id)"
                class="thread-tool-body tw:py-2 tw:px-3 tw:pb-3 tw:bg-(--o2-bg-2,var(--o2-card-bg)) tw:border-t tw:border-dashed tw:border-(--o2-border-color) tw:flex tw:flex-col tw:gap-2"
              >
                <div class="thread-tool-body__section tw:flex tw:flex-col tw:gap-[0.2rem]">
                  <div class="thread-tool-body__label tw:text-[0.62rem] tw:font-bold tw:tracking-[0.06rem] tw:text-(--o2-text-3)">Arguments</div>
                  <pre class="thread-tool-body__pre tw:m-0 tw:py-2 tw:px-[0.625rem] tw:bg-(--o2-card-bg) tw:border tw:border-(--o2-border-color) tw:rounded tw:font-mono tw:text-[0.72rem] tw:text-(--o2-text-1) tw:leading-[1.45] tw:whitespace-pre-wrap tw:break-words tw:max-h-[280px] tw:overflow-auto">{{
                    formatToolPayload(getInputRaw(t) || t.tool_args)
                  }}</pre>
                </div>
                <div class="thread-tool-body__section tw:flex tw:flex-col tw:gap-[0.2rem]">
                  <div class="thread-tool-body__label tw:text-[0.62rem] tw:font-bold tw:tracking-[0.06rem] tw:text-(--o2-text-3)">
                    Result
                    <span
                      v-if="t.span_status === 'ERROR'"
                      class="tw:text-[#dc2626]"
                    >
                      · ERROR
                    </span>
                  </div>
                  <pre class="thread-tool-body__pre tw:m-0 tw:py-2 tw:px-[0.625rem] tw:bg-(--o2-card-bg) tw:border tw:border-(--o2-border-color) tw:rounded tw:font-mono tw:text-[0.72rem] tw:text-(--o2-text-1) tw:leading-[1.45] tw:whitespace-pre-wrap tw:break-words tw:max-h-[280px] tw:overflow-auto">{{
                    formatToolPayload(getOutputRaw(t)) ||
                    t.status_message ||
                    "(empty)"
                  }}</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer. -->
          <div class="thread-turn__footer tw:flex tw:items-center tw:flex-wrap tw:gap-[0.35rem] tw:mt-2 tw:pt-2 tw:border-t tw:border-dashed tw:border-(--o2-border-color) tw:text-[0.72rem] tw:text-(--o2-text-2)">
            <span class="thread-metric tw:inline-flex tw:items-center tw:gap-1 tw:py-[0.18rem] tw:px-2 tw:rounded-[0.3rem] tw:bg-(--o2-bg-2,rgba(0,0,0,0.03)) tw:border tw:border-(--o2-border-color) tw:text-(--o2-text-2) tw:text-[0.7rem] tw:leading-none tw:whitespace-nowrap tw:shrink-0" :title="`Started at ${formatTime(turn.span.start_time)}`">
              <OIcon name="schedule" size="xs" />
              {{ formatTime(turn.span.start_time) }}
            </span>
            <span class="thread-metric thread-metric--model tw:inline-flex tw:items-center tw:gap-1 tw:py-[0.18rem] tw:px-2 tw:rounded-[0.3rem] tw:text-[#8b5cf6] tw:bg-[rgba(139,92,246,0.06)] tw:border tw:border-[rgba(139,92,246,0.2)] tw:font-medium tw:max-w-[200px] tw:overflow-hidden tw:text-ellipsis tw:text-[0.7rem] tw:leading-none tw:whitespace-nowrap tw:shrink-0" :title="getModel(turn.span)">
              <OIcon name="bolt" size="xs" />
              {{ getModel(turn.span) || "unknown" }}
            </span>
            <span class="thread-metric tw:inline-flex tw:items-center tw:gap-1 tw:py-[0.18rem] tw:px-2 tw:rounded-[0.3rem] tw:bg-(--o2-bg-2,rgba(0,0,0,0.03)) tw:border tw:border-(--o2-border-color) tw:text-(--o2-text-2) tw:text-[0.7rem] tw:leading-none tw:whitespace-nowrap tw:shrink-0" title="Duration">
              <OIcon name="timer" size="xs" />
              {{ formatDuration(turn.span.duration) }}
            </span>
            <span class="thread-metric tw:inline-flex tw:items-center tw:gap-1 tw:py-[0.18rem] tw:px-2 tw:rounded-[0.3rem] tw:bg-(--o2-bg-2,rgba(0,0,0,0.03)) tw:border tw:border-(--o2-border-color) tw:text-(--o2-text-2) tw:text-[0.7rem] tw:leading-none tw:whitespace-nowrap tw:shrink-0" title="Tokens">
              <OIcon name="data-usage" size="xs" />
              {{ formatNumber(getTokens(turn.span)) }} tokens
            </span>
            <span class="thread-metric tw:inline-flex tw:items-center tw:gap-1 tw:py-[0.18rem] tw:px-2 tw:rounded-[0.3rem] tw:bg-(--o2-bg-2,rgba(0,0,0,0.03)) tw:border tw:border-(--o2-border-color) tw:text-(--o2-text-2) tw:text-[0.7rem] tw:leading-none tw:whitespace-nowrap tw:shrink-0" title="Cost">
              <OIcon name="payments" size="xs" />
              {{ formatCost(getCost(turn.span)) }}
            </span>
            <span
              v-if="turn.span.span_status === 'ERROR'"
              class="thread-metric thread-metric--error tw:inline-flex tw:items-center tw:gap-1 tw:py-[0.18rem] tw:px-2 tw:rounded-[0.3rem] tw:text-[#dc2626] tw:bg-[rgba(220,38,38,0.08)] tw:border tw:border-[rgba(220,38,38,0.25)] tw:font-medium tw:text-[0.7rem] tw:leading-none tw:whitespace-nowrap tw:shrink-0"
            >
              <OIcon name="error-outline" size="xs" />
              Error
            </span>
            <button
              class="thread-turn__view-span tw:ml-auto tw:inline-flex tw:items-center tw:gap-[0.2rem] tw:py-[0.2rem] tw:px-[0.55rem] tw:rounded-[0.3rem] tw:text-(--q-primary) tw:text-[0.72rem] tw:font-medium tw:bg-transparent tw:border tw:border-transparent tw:cursor-pointer tw:transition-all tw:duration-[120ms] tw:shrink-0"
              @click="emit('span-selected', turn.span.span_id)"
            >
              View span
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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export interface Props {
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

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

<style>
/* OIcon color inside chip — descendant selector, cannot inline. */
.thread-chip .OIcon {
  color: var(--o2-text-secondary);
}

/* Error chip value color — descendant selector. */
.thread-chip--error .thread-chip__value--error {
  color: var(--o2-status-error-text);
}

/* ::before connector line on timeline turn — pseudo-element, cannot inline. */
.thread-turn::before {
  content: "";
  position: absolute;
  top: 30px;
  bottom: 0;
  left: 14px; /* avatar width / 2 */
  width: 2px;
  background: var(--o2-border-color);
  border-radius: 1px;
}

.thread-turn:last-child::before {
  display: none;
}

/* Last tool row border — :last-child pseudo-class, cannot inline. */
.thread-tool:last-child {
  border-bottom: none;
}

/* Hover states — cannot inline. */
.thread-system__head:hover {
  background: rgba(139, 92, 246, 0.04);
}

.thread-tool-row:hover {
  background: rgba(76, 175, 80, 0.12);
}

.thread-tool-row__view:hover {
  background: rgba(76, 175, 80, 0.18);
  color: #2f7a31;
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
  box-shadow: 0 0 0 4px var(--o2-card-bg);
}

.thread-view--dark .thread-tools-card {
  background: rgba(76, 175, 80, 0.08);
  border-color: rgba(76, 175, 80, 0.22);
}

.thread-view--dark .thread-tools-card__header {
  border-bottom-color: rgba(76, 175, 80, 0.2);
  color: #a0aec0;
}

.thread-view--dark .thread-tools-card__count {
  color: #a0aec0;
}

.thread-view--dark .thread-tool {
  background: rgba(76, 175, 80, 0.06);
  border-bottom-color: rgba(76, 175, 80, 0.2);
  color: #a0aec0;
}

.thread-view--dark .thread-tool--open {
  background: rgba(76, 175, 80, 0.14);
}

.thread-view--dark .thread-tool-row {
  color: #a0aec0;
}

.thread-view--dark .thread-tool-row:hover {
  background: rgba(76, 175, 80, 0.16);
}

.thread-view--dark .thread-tool-row__caret {
  color: #a0aec0;
}

.thread-view--dark .thread-tool-row__name {
  color: #6dd170;
}

.thread-view--dark .thread-tool-row__view:hover {
  background: rgba(76, 175, 80, 0.22);
  color: #6dd170;
}

.thread-view--dark .thread-pill--ok {
  background: rgba(34, 197, 94, 0.14);
  color: #4ade80;
  border-color: rgba(34, 197, 94, 0.3);
}

.thread-view--dark .thread-pill--error {
  background: rgba(248, 113, 113, 0.14);
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.3);
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
