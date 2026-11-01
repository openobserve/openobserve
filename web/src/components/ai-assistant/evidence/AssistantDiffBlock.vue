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
  <section
    ref="root"
    :aria-label="regionName"
    data-dd-privacy="mask"
    data-test="assistant-diff-block"
    :data-mode="view"
    class="bg-surface-base border-border-default rounded-default flex min-h-0 flex-col overflow-hidden border max-md:fixed max-md:inset-x-0 max-md:top-14 max-md:bottom-14 max-md:rounded-none max-md:border-x-0"
  >
    <div
      :class="[
        'border-border-default flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-2 py-1.5',
        reserveEnd && 'pe-10',
      ]"
      data-test="assistant-diff-bar"
    >
      <OText
        variant="meta"
        as="p"
        class="min-w-0 flex-[1_1_12rem] break-words"
        data-test="assistant-diff-status"
      >
        {{ statusLine }}
      </OText>
      <div class="flex flex-wrap items-center gap-2 max-md:w-full">
        <OButton
          ref="rejectButton"
          variant="secondary"
          size="sm"
          :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
          data-test="assistant-diff-reject"
          @click="proposal.reject()"
        >
          {{ t("assistant.diff.reject") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm"
          :disabled="checking"
          focusable-unavailable
          :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
          data-test="assistant-diff-accept"
          @click="proposal.accept()"
        >
          {{ t("assistant.diff.accept") }}
          <template v-if="checking" #unavailable-reason>{{
            t("assistant.helper.checking")
          }}</template>
        </OButton>
        <OButton
          v-if="proposal.canRun"
          variant="outline"
          size="sm"
          :disabled="checking || !!runBlocked"
          focusable-unavailable
          :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
          data-test="assistant-diff-accept-run"
          @click="proposal.acceptAndRun()"
        >
          {{ t("assistant.diff.acceptRun") }}
          <OTooltip v-if="runBlocked" :content="runBlocked" />
          <template v-if="checking || runBlocked" #unavailable-reason>{{
            runBlocked ?? t("assistant.helper.checking")
          }}</template>
        </OButton>
      </div>
      <OText
        v-if="proposal.canRun && proposal.checks?.runNote"
        variant="meta"
        as="p"
        class="w-full text-end break-words"
        data-test="assistant-diff-run-note"
      >
        {{ proposal.checks.runNote }}
      </OText>
    </div>
    <div
      v-if="view !== 'lines'"
      v-show="monacoReady"
      ref="editorHost"
      class="min-h-40 flex-1"
      data-test="assistant-diff-editor"
    />
    <!-- Phones, a Monaco still loading or one that failed read the same diff as wrapping lines -->
    <ol
      v-if="view === 'lines' || !monacoReady"
      :aria-label="title"
      class="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs"
      data-test="assistant-diff-lines"
    >
      <li
        v-for="(line, index) in lines"
        :key="index"
        :class="[
          'px-2 break-all whitespace-pre-wrap',
          line.kind === 'added' ? 'bg-surface-subtle text-text-heading font-medium' : '',
          line.kind === 'removed' ? 'text-text-secondary line-through' : '',
        ]"
        :data-kind="line.kind"
      >
        <span aria-hidden="true">{{ raw(MARKS[line.kind]) }}</span
        ><span v-if="line.kind !== 'same'" class="sr-only">{{ markName(line.kind) }} </span
        ><template v-for="(part, k) in segmentsOf(line)" :key="k"
          ><span
            v-if="part.unknown"
            class="underline decoration-wavy"
            data-test="assistant-diff-unknown-field"
            >{{ raw(part.text)
            }}<span class="sr-only"> {{ t("assistant.diff.unknownMark") }}</span></span
          ><template v-else>{{ raw(part.text) }}</template></template
        >
      </li>
    </ol>
  </section>
</template>

<script lang="ts">
import type { PendingProposal } from "@/composables/assistant";

export interface AssistantDiffBlockProps {
  proposal: PendingProposal;
  /** Leaves room for a host button pinned to the editor's end corner. */
  reserveEnd?: boolean;
}

/** Side by side only on a wide window; a narrower one stacks before over after. */
export const SIDE_BY_SIDE_MIN_PX = 1280;

const MARKS = { same: "  ", added: "+ ", removed: "- " } as const;
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { registerEscapeRung, stopLadderEscape, useAssistantName } from "@/composables/assistant";
import { PROPOSAL_LANGUAGE_NAMES, diffLines } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

type DiffEditor = {
  updateOptions(options: Record<string, unknown>): void;
  dispose(): void;
};

type MarkedEditor = {
  getModel(): {
    findMatches(
      search: string,
      all: boolean,
      regex: boolean,
      matchCase: boolean,
      separators: string | null,
      capture: boolean,
    ): { range: unknown }[];
  } | null;
  createDecorationsCollection(decorations: unknown[]): { clear(): void };
};

const props = withDefaults(defineProps<AssistantDiffBlockProps>(), { reserveEnd: false });

const { t } = useI18nTyped();
const { product } = useAssistantName();
const { mdUp, lgUp } = useBreakpoint();
const root = ref<HTMLElement | null>(null);
const editorHost = ref<HTMLElement | null>(null);
const rejectButton = ref<InstanceType<typeof OButton> | null>(null);
const monacoReady = ref(false);
const windowWidth = ref(typeof window === "undefined" ? 0 : window.innerWidth);
let editor: DiffEditor | null = null;
let models: { dispose(): void }[] = [];
let labelWatchers: { dispose(): void }[] = [];
let modifiedEditor: MarkedEditor | null = null;
let unknownMarks: { clear(): void } | null = null;
let disposed = false;
let offRung: (() => void) | null = null;

const languageName = computed<I18nText>(() =>
  raw(PROPOSAL_LANGUAGE_NAMES[props.proposal.language]),
);
const title = computed(() => t("assistant.diff.title", { language: languageName.value }));
const regionName = computed(() => t(`assistant.diff.region.${props.proposal.hostId}`));
const sideBySide = computed(() => windowWidth.value >= SIDE_BY_SIDE_MIN_PX);
// A phone column is too narrow for two gutters, so the diff reads as wrapping lines there.
const view = computed(() => (!mdUp.value ? "lines" : sideBySide.value ? "side" : "stacked"));
const lines = computed(() => diffLines(props.proposal.before, props.proposal.after) ?? []);

const checking = computed(() => props.proposal.checks?.state === "checking");
const unknownFields = computed(() => props.proposal.checks?.unknownFields ?? []);
const runBlocked = computed(() => props.proposal.checks?.runBlocked);

const checkLine = computed<I18nText>(() => {
  const checks = props.proposal.checks;
  if (checks?.state === "checking") return t("assistant.helper.checking");
  if (checks?.state === "ok") return t("assistant.diff.validated");
  if (checks?.state === "error" && checks.unknownCount)
    return t("assistant.diff.unknownCount", { count: checks.unknownCount }, checks.unknownCount);
  if (checks?.state === "error") return t("assistant.diff.parseFailed");
  return t("assistant.diff.notChecked");
});

const statusLine = computed<I18nText>(() =>
  raw([title.value, checkLine.value, t("assistant.diff.from", { product })].join(" · ")),
);

// Reject is first in focus, so Enter on arrival never changes the editor.
onMounted(async () => {
  window.addEventListener("resize", onResize, { passive: true });
  root.value?.addEventListener("keydown", stopLadderEscape);
  offRung = registerEscapeRung("d", rejectFromBar);
  await nextTick();
  focusReject();
  if (view.value !== "lines") void mountMonaco();
});

onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener("resize", onResize);
  root.value?.removeEventListener("keydown", stopLadderEscape);
  offRung?.();
  disposeMonaco();
});

watch(sideBySide, (side) => editor?.updateOptions({ ...editorLabels(), renderSideBySide: side }));
watch(unknownFields, () => markUnknownFields());
watch(lgUp, (wide) =>
  editor?.updateOptions({ ...editorLabels(), lineNumbers: wide ? "on" : "off" }),
);
watch(view, (next, was) => {
  if (next === "lines") disposeMonaco();
  else if (was === "lines") void nextTick(mountMonaco);
});

// Monaco's narrow-width inline fallback re-applies inner options without a label, so it is put back.
function keepLabel(
  inner: {
    getOption(id: number): unknown;
    updateOptions(options: Record<string, unknown>): void;
    onDidChangeConfiguration(listener: () => void): { dispose(): void };
  },
  option: number,
  label: string,
): void {
  const restore = () => {
    if (editor && !inner.getOption(option)) inner.updateOptions({ ariaLabel: label });
  };
  labelWatchers.push(inner.onDidChangeConfiguration(restore));
  restore();
}

// Every diff option update rewrites the inner editors' labels, so each one carries them again.
function editorLabels(): Record<string, string> {
  return {
    ariaLabel: title.value,
    originalAriaLabel: t("assistant.diff.current", { language: languageName.value }),
    modifiedAriaLabel: title.value,
  };
}

// Whole-word matches only, so `status` inside `http_status` is never marked.
function segmentsOf(line: { kind: string; text: string }): { text: string; unknown: boolean }[] {
  const fields = line.kind === "removed" ? [] : unknownFields.value;
  if (!fields.length) return [{ text: line.text, unknown: false }];
  const names = new Set(fields);
  return line.text
    .split(/([A-Za-z_][A-Za-z0-9_.]*)/)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, unknown: names.has(part) }));
}

function markUnknownFields(): void {
  unknownMarks?.clear();
  unknownMarks = null;
  const model = modifiedEditor?.getModel();
  if (!modifiedEditor || !model || !unknownFields.value.length) return;
  const hover = { value: t("assistant.diff.unknownMark") };
  const decorations = unknownFields.value.flatMap((field) =>
    model.findMatches(field, false, false, true, " ,()=<>!+-*/'\"`", false).map((match) => ({
      range: match.range,
      options: { inlineClassName: "underline decoration-wavy", hoverMessage: hover },
    })),
  );
  unknownMarks = modifiedEditor.createDecorationsCollection(decorations);
}

function markName(kind: "added" | "removed"): I18nText {
  return t(kind === "added" ? "assistant.diff.added" : "assistant.diff.removed");
}

function focusReject(): void {
  const el = rejectButton.value?.$el as HTMLElement | undefined;
  el?.focus({ preventScroll: false });
}

function onResize(): void {
  windowWidth.value = window.innerWidth;
}

function rejectFromBar(event: KeyboardEvent): boolean {
  const target = event.target instanceof Node ? event.target : null;
  if (!target || !root.value?.contains(target)) return false;
  props.proposal.reject();
  return true;
}

function disposeMonaco(): void {
  labelWatchers.forEach((watcher) => watcher.dispose());
  labelWatchers = [];
  unknownMarks?.clear();
  unknownMarks = null;
  modifiedEditor = null;
  editor?.dispose();
  editor = null;
  models.forEach((model) => model.dispose());
  models = [];
  monacoReady.value = false;
}

async function mountMonaco(): Promise<void> {
  try {
    const monaco = await import("monaco-editor/esm/vs/editor/editor.api");
    if (disposed || editor || !editorHost.value) return;
    // Syntax colours fail contrast on the diff's tinted lines, so both sides render as plain text.
    const original = monaco.editor.createModel(props.proposal.before, "plaintext");
    const modified = monaco.editor.createModel(props.proposal.after, "plaintext");
    models = [original, modified];
    const diff = monaco.editor.createDiffEditor(editorHost.value, {
      readOnly: true,
      originalEditable: false,
      renderSideBySide: sideBySide.value,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      wordWrap: "on",
      diffWordWrap: "on",
      lineNumbers: lgUp.value ? "on" : "off",
      glyphMargin: false,
      ...editorLabels(),
    });
    diff.setModel({ original, modified });
    editor = diff as unknown as DiffEditor;
    const labels = editorLabels();
    const option = monaco.editor.EditorOption.ariaLabel;
    keepLabel(diff.getOriginalEditor(), option, labels.originalAriaLabel);
    keepLabel(diff.getModifiedEditor(), option, labels.modifiedAriaLabel);
    modifiedEditor = diff.getModifiedEditor() as unknown as MarkedEditor;
    markUnknownFields();
    monacoReady.value = true;
  } catch {
    monacoReady.value = false;
  }
}
</script>
