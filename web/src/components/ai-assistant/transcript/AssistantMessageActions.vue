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
  <div
    v-if="mode === 'editor'"
    ref="editorRoot"
    class="flex min-w-0 flex-col gap-2"
    data-test="assistant-msg-editor"
  >
    <OTextarea
      v-model="draft"
      :label="t('assistant.message.editLabel')"
      autogrow
      :rows="2"
      :max-rows="10"
      width="full"
      data-test="assistant-msg-edit-input"
      @keydown="onEditorKeydown"
    />
    <ul v-if="editChips.length" class="flex flex-wrap gap-1.5" data-test="assistant-msg-edit-chips">
      <li v-for="chip in editChips" :key="chip.id" class="max-w-full min-w-0">
        <AssistantContextChip
          :chip="chip"
          state="sent"
          :popup="false"
          @remove="removeChip(chip.id)"
        />
      </li>
    </ul>
    <div class="flex flex-wrap justify-end gap-2">
      <OButton
        variant="ghost"
        size="sm"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-msg-edit-cancel"
        @click="cancelEdit"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm"
        :disabled="!draft.trim() || !!editBlocked"
        :focusable-unavailable="!!editBlocked"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-msg-edit-send"
        @click="sendEdit"
      >
        {{ t("assistant.message.editSend") }}
        <template v-if="editBlocked" #unavailable-reason>{{ editBlocked }}</template>
        <OTooltip v-if="editBlocked" :content="editBlocked" />
      </OButton>
    </div>
  </div>

  <ODropdown v-else-if="!mdUp" align="end" privacy="mask">
    <template #trigger>
      <AssistantIconButton
        :label="t('assistant.message.more')"
        :icon="assistantGlyph.more"
        data-test="assistant-msg-more"
      />
    </template>
    <ODropdownItem
      v-for="item in items"
      :key="item.id"
      :disabled="item.disabled"
      :focusable-unavailable="item.disabled"
      :description="item.disabled ? item.reason : null"
      :icon-left="item.icon"
      class="min-h-11"
      :data-test="item.dataTest"
      @select="item.run"
    >
      {{ item.label }}
    </ODropdownItem>
  </ODropdown>

  <div
    v-else
    role="group"
    :aria-label="t('assistant.message.actionsName')"
    :class="[
      'flex shrink-0 items-center gap-1',
      isLast
        ? ''
        : 'opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100',
    ]"
    data-test="assistant-msg-actions"
  >
    <template v-for="item in items" :key="item.id">
      <OButton
        v-if="density === 'roomy'"
        variant="ghost"
        size="sm"
        :icon-left="item.icon"
        :disabled="item.disabled"
        :focusable-unavailable="item.disabled"
        class="pointer-coarse:min-h-11"
        :data-test="item.dataTest"
        @click="item.run"
      >
        {{ item.label }}
        <template v-if="item.disabled" #unavailable-reason>{{ item.reason }}</template>
        <OTooltip v-if="item.disabled" :content="item.reason" />
      </OButton>
      <AssistantIconButton
        v-else
        :label="item.label"
        :icon="item.icon"
        :disabled="item.disabled"
        :disabled-reason="item.disabled ? item.reason : undefined"
        :data-test="item.dataTest"
        @click="item.run"
      />
    </template>
  </div>
</template>

<script lang="ts">
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";

export interface AssistantMessageActionsProps {
  sid: string;
  message: ChatMessage;
  /** The user message an answer replies to; Regenerate resends it. */
  prompt?: ChatMessage | null;
  turnId: string;
  isLast: boolean;
  /** 1-based number of the turn's user message. */
  promptNumber: number;
  density?: "compact" | "roomy";
  /** `editor` renders Edit and resend's inline editor in place of the message text. */
  mode?: "bar" | "editor";
  /** False when the turn failed: its outcome block's Retry is the one place to act (`30` §8.3). */
  canRegenerate?: boolean;
}

export interface AssistantMessageActionsEmits {
  (e: "edit"): void;
  (e: "done"): void;
}

/** How long a copy button shows its check (EB-09 AC 5). */
export const COPIED_MS = 2_000;

/** What Copy as Markdown reads from the app: step labels, a query fence's source and the footer stamp. */
export interface AnswerMarkdownCopy {
  step(block: ContentBlock): string;
  /** "stream default · 13:43–13:58 IST" for the code of a query the turn ran, else `null`. */
  fenceSource(code: string): string | null;
  stamp: string | null;
  /** The footnote of a claim chip: what the cited step did, or `null` when no step has that id. */
  claim?(callId: string): string | null;
}

const QUERY_OPEN = /^(```|~~~)(sql|promql)/;

const FENCE_CLOSE = /^(```|~~~)[ \t]*\r?$/;

const FENCE_LINE = /^\s*(```|~~~)/;

const COMMENT_PREFIX: Record<string, string> = { sql: "--", promql: "#" };

const CLAIM_MARKER = /\[\^([A-Za-z0-9_-]{1,64})\]/g;

/** An answer as Markdown: its steps as a list, its text with query fences sourced, then the stamp (EB-09 AC 6). */
export function answerMarkdown(blocks: ContentBlock[], copy: AnswerMarkdownCopy): string {
  const steps = blocks.filter((block) => block.type === "tool_call" && block.tool).map(copy.step);
  const numbers = new Map<string, number>();
  const text = blocks
    .filter((block) => block.type === "text" && block.text?.trim())
    .map((block) =>
      withFenceSources(block.text!.trim().split("\n"), copy, (line) =>
        withClaims(line, numbers),
      ).join("\n"),
    );
  // Chips copy as "[1]" with the step each one cites listed once at the end.
  const notes = [...numbers].map(([callId, n]) => `${n}. ${copy.claim?.(callId) ?? callId}`);
  return [
    steps.length ? steps.map((step) => `- ${step}`).join("\n") : "",
    ...text,
    notes.join("\n"),
    copy.stamp,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function withClaims(line: string, numbers: Map<string, number>): string {
  return line.replace(CLAIM_MARKER, (_all, id: string) => {
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    return `[${numbers.get(id)}]`;
  });
}

// One pass over the lines: a query fence pairs with the first closer of its kind at least two lines on, as the old pattern did, so Copy stays linear (Y4).
function withFenceSources(
  lines: string[],
  copy: AnswerMarkdownCopy,
  prose: (line: string) => string = (line) => line,
): string[] {
  const closers = { "```": [] as number[], "~~~": [] as number[] };
  lines.forEach((line, index) => {
    const close = FENCE_CLOSE.exec(line);
    if (close) closers[close[1] as keyof typeof closers].push(index);
  });
  const next = { "```": 0, "~~~": 0 };
  const out: string[] = [];
  let inCode = false;
  for (let index = 0; index < lines.length; index++) {
    const open = QUERY_OPEN.exec(lines[index]);
    if (!open) {
      // Markers stay as written inside any other fence, as the renderer keeps them in code.
      if (FENCE_LINE.test(lines[index])) inCode = !inCode;
      out.push(inCode || FENCE_LINE.test(lines[index]) ? lines[index] : prose(lines[index]));
      continue;
    }
    out.push(lines[index]);
    const fence = open[1] as keyof typeof closers;
    const list = closers[fence];
    while (next[fence] < list.length && list[next[fence]] < index + 2) next[fence] += 1;
    const close = list[next[fence]];
    if (close === undefined) continue;
    const code = lines.slice(index + 1, close);
    const source = copy.fenceSource(code.join("\n"));
    if (source)
      out.push(
        `${COMMENT_PREFIX[open[2]]} ${source}`,
        ...code,
        fence + (lines[close].endsWith("\r") ? "\r" : ""),
      );
    else out.push(...code, lines[close]);
    index = close;
  }
  return out;
}

/** The query a stored `tool_call` ran, in both the flat and the `request_body` context shapes. */
export function queryRunOf(
  block: ContentBlock,
): { code: string; stream: string | null; from: number | null; to: number | null } | null {
  const context = { ...(block.context ?? {}), ...(block.callArgs ?? {}) } as Record<string, any>;
  const query = context.request_body?.query ?? {};
  const code = context.sql ?? query.sql ?? context.query;
  if (block.type !== "tool_call" || typeof code !== "string" || !code.trim()) return null;
  const stream = context.stream_name ?? context.stream;
  return {
    code: code.trim(),
    stream: typeof stream === "string" && stream ? stream : null,
    from: epochMs(context.start_time ?? query.start_time),
    to: epochMs(context.end_time ?? query.end_time),
  };
}

// Search times are microseconds on the wire; a value that large cannot be milliseconds.
function epochMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value > 1e14 ? Math.round(value / 1000) : value;
}
</script>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, toRaw } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { announceComposer } from "@/components/ai-assistant/composer/composerUi";
import AssistantContextChip from "@/components/ai-assistant/context/AssistantContextChip.vue";
import {
  isRunning,
  useAssistantCapability,
  useAssistantStore,
  type ContextChip,
} from "@/composables/assistant";
import { stepCitation } from "@/components/ai-assistant/evidence/evidenceText";
import {
  assistantTranscriptHostKey,
  stepLabelOf,
  stepsOf,
  turnLockKey,
  useTurnLock,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { formatOrgRange } from "@/utils/formatters";

import { markdownToPlainText } from "./markdown";

interface ActionItem {
  id: string;
  label: I18nText;
  icon: IconName;
  dataTest: string;
  disabled?: boolean;
  reason?: I18nText;
  run(): void;
}

const props = withDefaults(defineProps<AssistantMessageActionsProps>(), {
  prompt: null,
  density: "compact",
  mode: "bar",
  canRegenerate: true,
});

const emit = defineEmits<AssistantMessageActionsEmits>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const capability = useAssistantCapability();
const { mdUp } = useBreakpoint();
const host = inject(assistantTranscriptHostKey, null);

const copied = ref<string | null>(null);
const draft = ref(String(props.message.content ?? ""));
const editChips = ref<ContextChip[]>(
  (props.message.chips ?? []).map((chip) => ({ ...toRaw(chip) })),
);
const editorRoot = ref<HTMLElement | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const turnLock = useTurnLock(() => props.sid);
const turnLocked = computed(() => capability.value.creditMode === "exhausted" || !!turnLock.value);
// The open editor's Send waits for a running turn, and for the cross-tab lock that arrived while it was open.
const editBlocked = computed(() => {
  if (running.value) return t("assistant.composer.running");
  return turnLock.value ? turnLockedReason.value : null;
});
const turnLockedReason = computed(() =>
  turnLock.value ? t(turnLockKey(turnLock.value)) : t("assistant.message.creditsUsedUp"),
);
const isUser = computed(() => props.message.role === "user");
// A turn started from the composer while the editor was open; the edit waits rather than being dropped.
const running = computed(() => {
  const session = store.state.sessions[props.sid];
  return !!session && isRunning(session.turn);
});

const items = computed<ActionItem[]>(() => {
  if (isUser.value)
    return [
      {
        id: "edit",
        label: t("assistant.message.edit"),
        icon: assistantGlyph.edit,
        dataTest: "assistant-msg-edit",
        disabled: turnLocked.value,
        reason: turnLockedReason.value,
        run: () => emit("edit"),
      },
      copyItem("prompt", t("assistant.message.copyPrompt"), "assistant-msg-copy-prompt", () =>
        String(props.message.content ?? ""),
      ),
    ];
  const answer: ActionItem[] = [];
  // Without B-12 a version replaces the latest answer only; an older turn would fork the chat.
  if (props.isLast && props.prompt && props.canRegenerate)
    answer.push({
      id: "regenerate",
      label: t("assistant.message.regenerate"),
      icon: assistantGlyph.regenerate,
      dataTest: "assistant-msg-regenerate",
      disabled: turnLocked.value,
      reason: turnLockedReason.value,
      run: startRegenerate,
    });
  answer.push(
    copyItem("answer", t("assistant.message.copyAnswer"), "assistant-msg-copy-answer", answerText),
    copyItem("markdown", t("assistant.message.copyMarkdown"), "assistant-msg-copy-md", answerMd),
  );
  return answer;
});

function copyItem(
  id: string,
  label: I18nText,
  dataTest: string,
  text: () => string | Promise<string>,
): ActionItem {
  return {
    id,
    label: copied.value === id ? t("common.copied") : label,
    icon:
      copied.value === id
        ? assistantGlyph.copied
        : id === "markdown"
          ? assistantGlyph.markdown
          : assistantGlyph.copy,
    dataTest,
    run: () => void copy(id, text()),
  };
}

// Each block through the same worker path as its render; a block already rendered answers from cache, synchronously.
function answerText(): string | Promise<string> {
  const texts = (props.message.contentBlocks ?? [])
    .filter((block) => block.type === "text" && block.text?.trim())
    .map((block) => block.text!);
  const plains = (texts.length ? texts : [String(props.message.content ?? "")]).map(
    markdownToPlainText,
  );
  const join = (all: string[]) => all.filter(Boolean).join("\n\n");
  if (plains.every((plain) => typeof plain === "string")) return join(plains as string[]);
  return Promise.all(plains).then(join);
}

function answerMd(): string {
  const blocks = props.message.contentBlocks ?? [];
  const runs = blocks.map(queryRunOf).filter((run) => run !== null);
  const timed = runs.filter((run) => run.from !== null && run.to !== null);
  const range = (from: number, to: number) => formatOrgRange(from, to);
  const from = Math.min(...timed.map((run) => run.from!));
  const to = Math.max(...timed.map((run) => run.to!));
  const steps = stepsOf(props.message, store.state.sessions[props.sid]?.org ?? "");
  return answerMarkdown(blocks, {
    claim(callId) {
      const step = steps.find((candidate) => candidate.callId === callId);
      return step ? String(stepCitation(step, t)) : null;
    },
    step(block) {
      const label = stepLabelOf(block.tool ?? "", block.context);
      return String(t(label.key, label.params));
    },
    fenceSource(code) {
      // The query that ran, else the run on the stream the fence reads from: its window is what the answer evaluated.
      const named = /\bFROM\s+"?([\w.-]+)"?/i.exec(code)?.[1];
      const run =
        timed.find((candidate) => candidate.code === code.trim() && candidate.stream) ??
        timed.find((candidate) => !!named && candidate.stream === named);
      if (!run) return null;
      return String(
        t("assistant.message.fenceSource", {
          stream: run.stream,
          range: range(run.from!, run.to!),
        }),
      );
    },
    stamp: timed.length
      ? String(
          t(
            "assistant.message.evaluatedStamp",
            { range: range(from, to), n: runs.length },
            runs.length,
          ),
        )
      : null,
  });
}

async function copy(id: string, content: string | Promise<string>): Promise<void> {
  const text = typeof content === "string" ? content : await content;
  const ok = await copyToClipboard(text, t, { silent: true });
  if (!ok) return void announceComposer(props.sid, t("assistant.client.copyManually"));
  copied.value = id;
  announceComposer(props.sid, t("common.copied"));
  if (id === "answer" || id === "markdown")
    trackAssistant("ai_thread_action", {
      action: id === "answer" ? "copy_answer" : "copy_markdown",
    });
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = null), COPIED_MS);
}

function startRegenerate(): void {
  trackAssistant("ai_thread_action", { action: "regenerate" });
  void store.regenerate(props.sid);
  host?.focusComposer();
}

function removeChip(id: string): void {
  editChips.value = editChips.value.filter((chip) => chip.id !== id);
}

function sendEdit(): void {
  const text = draft.value.trim();
  if (!text || editBlocked.value) return;
  trackAssistant("ai_thread_action", { action: "edit_resend" });
  void store.editResend(props.sid, {
    text,
    chips: editChips.value.map((chip) => ({ ...toRaw(chip) })),
    images: [...(props.message.images ?? [])],
    editedFrom: props.promptNumber,
  });
  emit("done");
  host?.focusComposer();
}

// Cancel returns focus to the Edit button the editor came from (EB-09 AC 11).
function cancelEdit(): void {
  const article = editorRoot.value?.closest("article");
  emit("done");
  void nextTick(() =>
    article?.querySelector<HTMLElement>('[data-test="assistant-msg-edit"]')?.focus(),
  );
}

function onEditorKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelEdit();
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendEdit();
  }
}

onMounted(() => {
  if (props.mode !== "editor") return;
  void nextTick(() => {
    const textarea = editorRoot.value?.querySelector("textarea");
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  });
});

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>
