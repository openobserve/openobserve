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
  <div v-if="toolCalls.length > 0" class="thread-tools-thread">
    <!-- One-way reveal: clicking shows the calls and removes the pill. -->
    <button v-if="!shown" class="tt-toggle" @click="shown = true">
      <span class="tt-zz bg-border-strong"></span>
      <span class="tt-pill border-border-default bg-surface-base border">
        <span class="tt-count text-text-secondary">
          {{ toolCalls.length }}
          {{
            toolCalls.length === 1
              ? t("traces.threadToolCalls.toolCall")
              : t("traces.threadToolCalls.toolCalls")
          }}
          · {{ formatDuration(totalToolDuration(toolCalls)) }}
        </span>
        <span class="tt-link text-thread-tool-link">{{
          t("traces.threadToolCalls.showCalls")
        }}</span>
      </span>
      <span class="tt-zz bg-border-strong"></span>
    </button>

    <div v-else class="tt-body">
      <div
        v-for="tool in toolCalls"
        :key="tool.span_id"
        class="thread-tool"
        :class="{ 'thread-tool--open': expandedTools.has(tool.span_id) }"
      >
        <div class="thread-tool-row text-text-secondary" @click="toggleTool(tool.span_id)">
          <span class="thread-tool-row__caret text-text-secondary">{{
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
                ? 'thread-pill--error text-error-600 dark:text-error-400'
                : 'thread-pill--ok text-success-600 dark:text-success-400'
            "
          >
            {{ tool.span_status === "ERROR" ? "ERROR" : "OK" }}
            · {{ formatDuration(tool.duration) }}
          </span>
          <button
            class="thread-tool-row__view text-text-secondary"
            @click.stop="emit('span-selected', tool.span_id)"
            :title="t('traces.threadToolCalls.openSpanDetails')"
          >
            <OIcon name="open-in-new" size="xs" />
          </button>
        </div>

        <div
          v-if="expandedTools.has(tool.span_id)"
          class="thread-tool-body bg-surface-base border-border-default border-t border-dashed"
        >
          <div class="thread-tool-body__section">
            <div class="thread-tool-body__label text-text-secondary">
              {{ t("traces.threadToolCalls.arguments") }}
            </div>
            <pre
              class="thread-tool-body__pre bg-surface-base border-border-default text-text-body border"
              >{{ formatToolPayload(getInputRaw(tool) || tool.tool_args) }}</pre>
          </div>
          <div class="thread-tool-body__section">
            <div class="thread-tool-body__label text-text-secondary">
              {{ t("traces.threadToolCalls.result") }}
              <span v-if="tool.span_status === 'ERROR'" class="text-error-600">
                · {{ t("traces.error") }}
              </span>
            </div>
            <pre
              class="thread-tool-body__pre bg-surface-base border-border-default text-text-body border"
              >{{
                formatToolPayload(getOutputRaw(tool)) ||
                tool.status_message ||
                t("traces.threadToolCalls.empty")
              }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { getInputRaw, getOutputRaw } from "./threadView.utils";

defineProps<{
  /** The turn's execute_tool spans (name/args/result/status/duration). */
  toolCalls: any[];
}>();
const emit = defineEmits<{ (e: "span-selected", spanId: string): void }>();

const { t } = useI18nTyped();

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

<style scoped>
/* keep(complex-state): the tiled SVG zigzag artwork (masked so it takes a theme
   token) plus the nested per-tool open/hover state cascade the utility layer
   cannot express. */
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

  /* Zigzag rule: the SVG is a MASK (stroke=black → alpha 1), so the visible
     colour comes from background-color and follows the theme token. A colour
     baked into the data-URI could not. */
  .tt-zz {
    flex: 1;
    min-width: 1rem;
    height: 0.75rem;
    --tt-zz-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='12'%3E%3Cpath d='M0 9L4 3L8 9' fill='none' stroke='black' stroke-width='1.4'/%3E%3C/svg%3E")
      repeat-x center;
    -webkit-mask: var(--tt-zz-mask);
    mask: var(--tt-zz-mask);
    opacity: 0.7;
  }

  .tt-pill {
    flex: none;
    margin: 0 0.75rem;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
    padding: 0.5rem 1.125rem;
    border-radius: 0.625rem;
    box-shadow: var(--shadow-glow-2xs-geom) color-mix(in srgb, var(--color-black) 4%, transparent);
    transition:
      box-shadow 0.15s ease,
      border-color 0.15s ease;
  }

  .tt-toggle:hover .tt-pill {
    box-shadow: var(--shadow-glow-md-geom) color-mix(in srgb, var(--color-black) 10%, transparent);
  }

  .tt-count {
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .tt-link {
    font-size: var(--text-xs);
    font-weight: 650;
  }

  .tt-body {
    padding-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
}

/* The tool-call thread's identity accent — a distinct green with its own
   semantic tokens (--color-tool-thread-accent / -text), deliberately not the
   orange dag-node-tool role nor a status green. Local aliases keep the many
   color-mix consumers below terse; the -text token flips in dark on its own. */
.thread-tools-thread {
  --tt-accent: var(--color-tool-thread-accent);
  --tt-accent-text: var(--color-tool-thread-accent-text);
}

.thread-tool {
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel tool row divider must not scale with text or it smears at fractional zoom */
  border-bottom: 1px solid color-mix(in srgb, var(--tt-accent) 15%, transparent);
  background: color-mix(in srgb, var(--tt-accent) 4%, transparent);
  transition: background 120ms ease;

  &:last-child {
    border-bottom: none;
  }
}

.thread-tool--open {
  background: color-mix(in srgb, var(--tt-accent) 10%, transparent);
}

.thread-tool-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.5rem 0.45rem 0.75rem;
  font-size: var(--text-xs);
  cursor: pointer;
  transition: background 120ms ease;

  &:hover {
    background: color-mix(in srgb, var(--tt-accent) 12%, transparent);
  }
}

.thread-tool-row__caret {
  font-size: var(--text-2xs);
  width: 0.75rem;
  text-align: center;
}

.thread-tool-row__icon {
  width: 1.125rem;
  height: 1.125rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-base);
}

.thread-tool-row__name {
  font-family: var(--font-mono);
  color: var(--tt-accent-text);
  font-weight: 500;
}

.thread-tool-row__view {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 0.25rem;
  background: transparent;
  border: none;
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
  transition: all 120ms ease;

  &:hover {
    background: color-mix(in srgb, var(--tt-accent) 18%, transparent);
    color: var(--tt-accent-text);
  }
}

.thread-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.5rem;
  border-radius: var(--radius-full);
  font-size: var(--text-3xs);
  font-weight: 600;
  letter-spacing: 0.03rem;
  font-family: var(--font-mono);
  white-space: nowrap;
}

.thread-pill--ok {
  background: color-mix(in srgb, var(--color-success-600) 10%, transparent);
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel pill border must not scale with text or it smears at fractional zoom */
  border: 1px solid color-mix(in srgb, var(--color-success-600) 25%, transparent);
}

.thread-pill--error {
  background: color-mix(in srgb, var(--color-error-600) 10%, transparent);
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel pill border must not scale with text or it smears at fractional zoom */
  border: 1px solid color-mix(in srgb, var(--color-error-600) 25%, transparent);
}

.thread-tool-body {
  padding: 0.5rem 0.75rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.thread-tool-body__section {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.thread-tool-body__label {
  font-size: var(--text-3xs);
  font-weight: 700;
  letter-spacing: 0.06rem;
}

.thread-tool-body__pre {
  margin: 0;
  padding: 0.5rem 0.625rem;
  border-radius: 0.25rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 17.5rem;
  overflow: auto;
}

/* ─── dark mode overrides ─────────────────────────────────────────────────
   Only what genuinely differs in dark: the accent text step, the slightly
   stronger accent washes (a translucent tint over a dark surface needs more
   alpha to read), and the lighter status steps. The row/caret text colours
   are gone from here — --color-text-secondary is already theme-paired. */
.dark .thread-tools-thread {
  /* --tt-accent-text flips via its own token (--color-tool-thread-accent-text). */
  .thread-tool {
    background: color-mix(in srgb, var(--tt-accent) 6%, transparent);
    border-bottom-color: color-mix(in srgb, var(--tt-accent) 20%, transparent);
  }
}

.dark .thread-tools-thread .thread-tool--open {
  background: color-mix(in srgb, var(--tt-accent) 14%, transparent);
}

.dark .thread-tools-thread {
  .thread-tool-row {
    &:hover {
      background: color-mix(in srgb, var(--tt-accent) 16%, transparent);
    }
  }
}

.dark .thread-tools-thread .thread-tool-row__view:hover {
  background: color-mix(in srgb, var(--tt-accent) 22%, transparent);
}

.dark .thread-tools-thread {
  .thread-pill--ok {
    background: color-mix(in srgb, var(--color-success-500) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-success-500) 30%, transparent);
  }

  .thread-pill--error {
    background: color-mix(in srgb, var(--color-error-400) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-error-400) 30%, transparent);
  }
}
</style>
