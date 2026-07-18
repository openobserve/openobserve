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
  ThreadToolCalls — the collapsed "Show calls" tool thread (zigzag pill that
  reveals the per-tool args/result rows). Extracted from ThreadView so the same
  design is reused by both the Pretty transcript (ThreadView) and the Session
  Detail collapsed turn body. Takes the turn's execute_tool spans; emits the
  span id when a tool's "open span" button is clicked.

  Self-contained: own one-way reveal state + per-tool expand state + the scoped
  artwork (the zigzag is a tiled inline SVG Tailwind can't express, so scoped
  CSS is allowed here per the redesign rules §5a).
-->
<template>
  <div
    v-if="toolCalls.length > 0"
    class="thread-tools-thread"
    :class="{ 'thread-tools-thread--dark': isDark }"
  >
    <!-- One-way reveal: clicking shows the calls and removes the pill. -->
    <button v-if="!shown" class="tt-toggle" @click="shown = true">
      <span class="tt-zz"></span>
      <span class="tt-pill">
        <span class="tt-count">
          {{ toolCalls.length }}
          {{
            toolCalls.length === 1
              ? t('traces.threadToolCalls.toolCall')
              : t('traces.threadToolCalls.toolCalls')
          }}
          · {{ formatDuration(totalToolDuration(toolCalls)) }}
        </span>
        <span class="tt-link">{{ t('traces.threadToolCalls.showCalls') }}</span>
      </span>
      <span class="tt-zz"></span>
    </button>

    <div v-else class="tt-body">
      <div
        v-for="tool in toolCalls"
        :key="tool.span_id"
        class="thread-tool"
        :class="{ 'thread-tool--open': expandedTools.has(tool.span_id) }"
      >
        <div class="thread-tool-row" @click="toggleTool(tool.span_id)">
          <span class="thread-tool-row__caret">{{
            expandedTools.has(tool.span_id) ? "▾" : "▸"
          }}</span>
          <OIcon name="build" size="xs" class="thread-tool-row__icon" />
          <span class="thread-tool-row__name">{{
            tool.tool_name || tool.gen_ai_tool_name || tool.operation_name
          }}</span>
          <span class="flex-1" />
          <span
            class="thread-pill"
            :class="
              tool.span_status === 'ERROR'
                ? 'thread-pill--error'
                : 'thread-pill--ok'
            "
          >
            {{ tool.span_status === "ERROR" ? "ERROR" : "OK" }}
            · {{ formatDuration(tool.duration) }}
          </span>
          <button
            class="thread-tool-row__view"
            @click.stop="emit('span-selected', tool.span_id)"
            :title="t('traces.threadToolCalls.openSpanDetails')"
          >
            <OIcon name="open-in-new" size="xs" />
          </button>
        </div>

        <div v-if="expandedTools.has(tool.span_id)" class="thread-tool-body">
          <div class="thread-tool-body__section">
            <div class="thread-tool-body__label">{{ t('traces.threadToolCalls.arguments') }}</div>
            <pre class="thread-tool-body__pre">{{
              formatToolPayload(getInputRaw(tool) || tool.tool_args)
            }}</pre>
          </div>
          <div class="thread-tool-body__section">
            <div class="thread-tool-body__label">
              {{ t('traces.threadToolCalls.result') }}
              <span v-if="tool.span_status === 'ERROR'" class="text-[color:var(--color-error-600)]">
                · ERROR
              </span>
            </div>
            <pre class="thread-tool-body__pre">{{
              formatToolPayload(getOutputRaw(tool)) ||
              tool.status_message ||
              t('traces.threadToolCalls.empty')
            }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { getInputRaw, getOutputRaw } from "./threadView.utils";

defineProps<{
  /** The turn's execute_tool spans (name/args/result/status/duration). */
  toolCalls: any[];
}>();
const emit = defineEmits<{ (e: "span-selected", spanId: string): void }>();

const store = useStore();
const { t } = useI18n();
const isDark = computed(() => store.state.theme === "dark");

// One-way reveal for the whole group; per-tool rows expand independently.
const shown = ref(false);
const expandedTools = ref<Set<string>>(new Set());

function toggleTool(spanId: string) {
  const next = new Set(expandedTools.value);
  if (next.has(spanId)) next.delete(spanId);
  else next.add(spanId);
  expandedTools.value = next;
}

function totalToolDuration(tools: any[]): number {
  let sum = 0;
  for (const t of tools) sum += Number(t.duration) || 0;
  return sum;
}

function formatToolPayload(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        // not JSON — fall through to raw string
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

function formatDuration(ns: number): string {
  if (!ns || !isFinite(ns)) return "0ms";
  const ms = ns / 1_000_000;
  if (ms < 1) return ms.toFixed(2) + "ms";
  if (ms < 1000) return Math.round(ms) + "ms";
  if (ms < 60_000) return (ms / 1000).toFixed(2) + "s";
  return (ms / 60_000).toFixed(2) + "m";
}
</script>

<style scoped lang="scss">
/* Tool thread — collapsed "Show calls" pill (redesign mockup .tools-thread). */
.thread-tools-thread {
  margin: 0.5rem 0;

  .tt-toggle {
    display: flex;
    align-items: center;
    width: 100%;
    background: none;
    border: 0;
    padding: 0.125rem 0;
    cursor: pointer;
  }

  .tt-zz {
    flex: 1;
    min-width: 1rem;
    height: 0.75rem;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='12'%3E%3Cpath d='M0 9L4 3L8 9' fill='none' stroke='%23d6dde7' stroke-width='1.4'/%3E%3C/svg%3E")
      repeat-x center;
    opacity: 0.7;
  }

  .tt-pill {
    flex: none;
    margin: 0 0.75rem;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0.5rem 1.125rem;
    border: 1px solid var(--color-border-default);
    border-radius: 0.625rem;
    background: var(--color-surface-base);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
  }

  .tt-toggle:hover .tt-pill {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .tt-count {
    font-size: 0.72rem;
    color: var(--color-text-secondary);
    font-weight: 600;
    white-space: nowrap;
  }

  .tt-link {
    font-size: 0.78rem;
    color: var(--color-primary-500, #3b82f6);
    font-weight: 650;
  }

  .tt-body {
    padding-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
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
    color: var(--color-text-secondary);
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
    color: var(--color-success-600);
    border: 1px solid rgba(22, 163, 74, 0.25);
  }

  &--error {
    background: rgba(220, 38, 38, 0.1);
    color: var(--color-error-600);
    border: 1px solid rgba(220, 38, 38, 0.25);
  }
}

.thread-tool-body {
  padding: 0.5rem 0.75rem 0.75rem;
  background: var(--color-surface-base);
  border-top: 1px dashed var(--color-border-default);
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
    color: var(--color-text-secondary);
  }

  &__pre {
    margin: 0;
    padding: 0.5rem 0.625rem;
    background: var(--color-surface-base);
    border: 1px solid var(--color-border-default);
    border-radius: 0.25rem;
    font-family: monospace;
    font-size: 0.72rem;
    color: var(--color-text-body);
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 280px;
    overflow: auto;
  }
}

/* ─── dark mode overrides ─────────────────────────────────────────────── */
.thread-tools-thread--dark {
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
}
</style>
