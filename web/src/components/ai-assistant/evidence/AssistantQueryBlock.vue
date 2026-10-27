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
    ref="root"
    role="group"
    :aria-label="groupName"
    class="rounded-surface border-border-default bg-surface-base flex min-w-0 flex-col gap-2 border p-2"
    :data-block-id="block.blockId"
    data-test="assistant-query-block"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <OTag
        type="assistantQueryLanguage"
        :value="block.query.language"
        :label="languageLabel(block.query.language)"
        data-test="assistant-query-language"
      />
      <OCode
        v-if="block.query.stream"
        class="max-w-full min-w-0"
        data-test="assistant-query-stream"
      >
        <OTruncatedText class="max-w-40">{{ raw(block.query.stream) }}</OTruncatedText>
      </OCode>
      <OText variant="meta" data-test="assistant-query-range">{{ rangeLine }}</OText>
      <OButton
        v-if="sourceStep && block.sourceCallId"
        variant="ghost-primary"
        size="xs"
        :class="TOUCH_TARGET_CLASS"
        data-test="assistant-query-source-step"
        @click="openSource"
      >
        {{ t("assistant.evidence.fromStep", { n: sourceStep }) }}
      </OButton>
    </div>

    <AssistantQueryText
      :text="block.query.text"
      :language="block.query.language"
      :label="groupName"
      data-test="assistant-query-text"
    />

    <OText
      v-if="otherOrg"
      variant="meta"
      as="p"
      class="break-words"
      data-test="assistant-query-other-org"
    >
      {{ t("assistant.evidence.otherOrg", { org: raw(block.query.org) }) }}
    </OText>

    <div
      v-if="run?.status !== 'running'"
      class="flex min-w-0 flex-wrap items-center gap-2"
      data-test="assistant-query-actions"
    >
      <OButton
        v-if="canRun && mdUp"
        :variant="isLast ? 'primary' : 'secondary'"
        size="sm"
        :icon-left="assistantGlyph.run"
        :class="['shrink-0', TOUCH_TARGET_CLASS]"
        data-test="assistant-query-run"
        @click="startRun"
      >
        {{ t("assistant.query.run") }}
      </OButton>
      <OButton
        v-if="canOpen"
        :variant="canRun && mdUp ? 'secondary' : run?.status === 'forbidden' ? 'ghost' : 'primary'"
        size="sm"
        as="a"
        :href="openHref"
        :target="openInNewTab ? '_blank' : undefined"
        :rel="openInNewTab ? 'noopener noreferrer' : undefined"
        :icon-right="openInNewTab ? assistantGlyph.newTab : undefined"
        :aria-label="
          openInNewTab ? t('assistant.evidence.opensNewTab', { label: openLabel }) : undefined
        "
        :class="['min-w-0 max-md:flex-1', TOUCH_TARGET_CLASS]"
        data-test="assistant-query-open"
        @click="onOpen"
      >
        {{ openLabel }}
        <OTooltip :content="t('assistant.evidence.openHint')" />
      </OButton>
      <AssistantIconButton
        v-if="mdUp"
        :label="t('assistant.query.copy')"
        :icon="assistantGlyph.copy"
        data-test="assistant-query-copy"
        @click="copyQuery"
      />
      <OButton
        v-if="canInsert && mdUp"
        variant="ghost"
        size="sm"
        :disabled="insertState !== 'idle'"
        :focusable-unavailable="insertState !== 'idle'"
        :icon-left="insertState === 'inserted' ? assistantGlyph.done : undefined"
        :class="['shrink-0', TOUCH_TARGET_CLASS]"
        data-test="assistant-query-insert"
        :data-state="insertState"
        @click="insert"
      >
        {{ insertLabel }}
      </OButton>
      <ODropdown v-if="menuItems.length" align="end" privacy="mask">
        <template #trigger>
          <AssistantIconButton
            :label="t('assistant.query.more')"
            :icon="assistantGlyph.more"
            data-test="assistant-query-more"
          />
        </template>
        <ODropdownItem
          v-for="item in menuItems"
          :key="item.id"
          :icon-left="item.icon"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          :data-test="item.dataTest"
          @select="item.run"
        >
          {{ item.label }}
        </ODropdownItem>
      </ODropdown>
    </div>

    <OText
      v-if="insertNote"
      variant="meta"
      as="p"
      class="break-words"
      data-test="assistant-query-insert-note"
    >
      {{ insertNote }}
    </OText>

    <OInput
      v-if="manualCopy"
      :model-value="block.query.text"
      readonly
      :label="t('assistant.client.copyManually')"
      data-test="assistant-query-copy-manual"
      @focus="selectAll"
    />

    <div
      v-if="run"
      ref="results"
      role="group"
      tabindex="-1"
      :aria-label="t('assistant.evidence.resultsOf', { name: groupName })"
      class="focus-visible:ring-border-strong rounded-default flex min-w-0 flex-col gap-2 outline-none focus-visible:ring-2"
      :data-state="run.status"
      data-test="assistant-query-results"
    >
      <div v-if="run.status === 'running'" class="flex flex-wrap items-center gap-2">
        <OSpinner variant="dots" size="xs" class="motion-reduce:hidden" />
        <OText variant="meta" data-test="assistant-query-running">
          {{ t("assistant.query.running", { n: elapsedSeconds }) }}
        </OText>
        <OButton
          variant="secondary"
          size="sm"
          :icon-left="assistantGlyph.stop"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-query-stop"
          @click="stopRun"
        >
          {{ t("assistant.query.stop") }}
        </OButton>
      </div>
      <template v-else-if="run.status === 'done'">
        <OText variant="meta" data-test="assistant-query-summary">{{ summaryLine }}</OText>
        <AssistantResultTable
          :rows="run.rows ?? []"
          :columns="run.columns"
          :label="t('assistant.evidence.resultsOf', { name: groupName })"
          data-test="assistant-query-table"
        />
      </template>
      <OText
        v-else-if="run.status === 'forbidden'"
        variant="meta"
        as="p"
        class="break-words"
        data-test="assistant-query-outcome"
      >
        <i18n-t keypath="assistant.evidence.noStreamAccess" tag="span">
          <template #stream>
            <OCode>{{ raw(block.query.stream ?? "") }}</OCode>
          </template>
        </i18n-t>
      </OText>
      <OText v-else variant="meta" as="p" class="break-words" data-test="assistant-query-outcome">
        {{ outcomeLine }}
      </OText>
    </div>
  </div>
</template>

<script lang="ts">
import type { AssistantHostAdapter, QueryRef, Sid } from "@/composables/assistant/pure";

/** One runnable query in an answer. */
export interface QueryBlock {
  blockId: string;
  query: QueryRef;
  sourceCallId?: string;
  rangeSource: "step" | "turn" | "page";
}

export interface AssistantQueryBlockProps {
  block: QueryBlock;
  isLast: boolean;
  readonly?: boolean;
  host?: AssistantHostAdapter;
  permissions: { dashboardCreate?: boolean; alertCreate?: boolean };
  /** The live session; absent on a shared page. */
  sid?: Sid | null;
  /** The trail number of `sourceCallId`, for "from step n". */
  sourceStep?: number | null;
  /** The turn the block belongs to, so a draft names its origin. */
  turnId?: string;
  /** False on a readonly page with no explorer behind it. */
  openable?: boolean;
}
</script>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import { useRouter } from "vue-router";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  assistantEvidenceHostKey,
  proposalFor,
  type AiLabelState,
  type AssistantAction,
  type InsertOutcome,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { explorerOf, explorerTarget } from "@/utils/assistant/explorerRoutes";
import { copyToClipboard } from "@/utils/clipboard";
import { formatBytes, formatCount, formatElapsed } from "@/utils/formatters";

import AssistantQueryText from "./AssistantQueryText.vue";
import AssistantResultTable from "./AssistantResultTable.vue";
import { explorerLabel, languageLabel, rangeText } from "./evidenceText";
import { revealStep } from "./revealStep";

interface MenuItem {
  id: string;
  label: I18nText;
  icon: IconName;
  dataTest: string;
  /** Shown in the overflow only on a phone, where the row keeps Open alone. */
  phoneOnly: boolean;
  shown: boolean;
  run(): void;
}

type MenuKey =
  | "assistant.query.run"
  | "assistant.query.copy"
  | "assistant.query.insert"
  | "assistant.query.dashboard"
  | "assistant.query.alert";

const MINUTE_MS = 60_000;

const props = withDefaults(defineProps<AssistantQueryBlockProps>(), {
  readonly: false,
  host: undefined,
  sid: null,
  sourceStep: null,
  turnId: undefined,
  openable: true,
});

const { t } = useI18nTyped();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const router = useRouter();
const { mdUp } = useBreakpoint();

const root = ref<HTMLElement | null>(null);
const results = ref<HTMLElement | null>(null);
const manualCopy = ref(false);
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

const live = computed(() => !props.readonly && !!evidence && !!props.sid);
const explorer = computed(() => explorerOf(props.block.query));
const run = computed(() =>
  props.sid && evidence ? evidence.queryRun(props.sid, props.block.blockId) : null,
);
const otherOrg = computed(() => {
  const current = evidence?.currentOrg();
  return !!current && !!props.block.query.org && current !== props.block.query.org;
});
// A 403 is final for this reader, so Run does not come back as a retry.
const canRun = computed(
  () =>
    live.value &&
    props.block.query.language === "sql" &&
    !otherOrg.value &&
    run.value?.status !== "forbidden",
);
// A VRL or regex block has no explorer or draft that can run it.
const runnable = computed(() => ["sql", "promql"].includes(props.block.query.language));
const canOpen = computed(() => runnable.value && !otherOrg.value && props.openable);
const editorHost = computed(() => props.host ?? evidence?.host?.() ?? null);
const canInsert = computed(
  () =>
    live.value &&
    !otherOrg.value &&
    !!editorHost.value &&
    editorHost.value.language === props.block.query.language,
);
// Insert reads as a review until the user decides in the editor, then as done and spent.
const reviewing = ref(false);
// The accepted text this block landed, by its label; a revert, an edit or a tab switch frees Insert again.
const landed = shallowRef<{ label: Readonly<Ref<AiLabelState | null>>; at: number } | null>(null);
const insertState = computed<"idle" | "review" | "inserted">(() => {
  if (reviewing.value) return "review";
  const label = landed.value?.label.value;
  return label && label.acceptedAt === landed.value?.at && label.status === "written"
    ? "inserted"
    : "idle";
});
const insertNote = ref<I18nText | null>(null);
const insertLabel = computed<I18nText>(() => {
  if (insertState.value === "review") return t("assistant.diff.reviewInEditor");
  if (insertState.value === "inserted") return t("assistant.helper.inserted");
  return t("assistant.query.insert");
});
const openInNewTab = computed(() => !live.value || evidence?.prefersNewTab() === true);

const openHref = computed(() => {
  if (!router) return undefined;
  return router.resolve(explorerTarget(props.block.query, explorer.value, String(Date.now()))).href;
});

const openLabel = computed(() =>
  t("assistant.query.open", { explorer: explorerLabel(explorer.value, t) }),
);

const rangeLine = computed<I18nText>(() => {
  const { from, to } = props.block.query;
  return from && to ? rangeText({ from, to }) : t("assistant.evidence.rangeFallback");
});

const groupName = computed<I18nText>(() => {
  const { from, to, stream } = props.block.query;
  const range = from && to ? rangeText({ from, to }) : t("assistant.evidence.rangeUnknown");
  const language = languageLabel(props.block.query.language);
  return stream
    ? t("assistant.evidence.groupName", { language, stream: raw(stream), range })
    : t("assistant.evidence.groupNameNoStream", { language, range });
});

const elapsedSeconds = computed(() =>
  run.value ? Math.max(0, Math.floor((now.value - run.value.startedAt) / 1000)) : 0,
);

// The window that ran is stated, because a fallback or a 7-day cut differs from the header's.
const ranWindow = computed<I18nText>(() => {
  const window = run.value?.window;
  if (!window) return raw("");
  if (window.fallback)
    return t(
      "assistant.evidence.lastMinutes",
      { count: Math.round((window.to - window.from) / MINUTE_MS) },
      Math.round((window.to - window.from) / MINUTE_MS),
    );
  const range = rangeText(window);
  return window.capped ? t("assistant.evidence.windowCapped", { window: range }) : range;
});

const summaryLine = computed<I18nText>(() => {
  const current = run.value;
  const count = current?.total ?? current?.rows?.length ?? 0;
  const took = raw(current?.tookMs !== undefined ? formatElapsed(current.tookMs) : "—");
  const window = ranWindow.value;
  if (current?.scannedBytes === undefined)
    return t("assistant.evidence.rowsWindow", { count: formatCount(count), took, window }, count);
  const size = formatBytes(current.scannedBytes);
  return t(
    "assistant.evidence.rowsScannedWindow",
    { count: formatCount(count), took, size, window },
    count,
  );
});

const outcomeLine = computed<I18nText>(() => {
  const current = run.value;
  if (current?.status === "empty") return t("assistant.evidence.noRows");
  if (current?.status === "stopped") return t("assistant.evidence.stopped");
  if (current?.status === "forbidden")
    return t("assistant.evidence.noStreamAccess", { stream: raw(props.block.query.stream ?? "") });
  return current?.reason
    ? t("assistant.evidence.queryFailed", { reason: raw(current.reason) })
    : t("assistant.evidence.queryFailedPlain");
});

// A phone keeps Open in the row; Run, Copy and Insert join the drafts in the overflow.
const menuItems = computed<MenuItem[]>(() => {
  if (!live.value) return [];
  const query = props.block.query;
  const turnId = props.turnId ? { turnId: props.turnId } : {};
  const all: MenuItem[] = [
    item("run", "assistant.query.run", assistantGlyph.run, true, canRun.value, startRun),
    item("copy", "assistant.query.copy", assistantGlyph.copy, true, true, copyQuery),
    item("insert", "assistant.query.insert", assistantGlyph.edit, true, canInsert.value, insert),
    item(
      "add-dashboard",
      "assistant.query.dashboard",
      assistantGlyph.chipPanel,
      false,
      runnable.value && props.permissions.dashboardCreate !== false && !otherOrg.value,
      () => void act({ kind: "add_to_dashboard_draft", query, ...turnId }),
    ),
    item(
      "create-alert",
      "assistant.query.alert",
      assistantGlyph.chipAlert,
      false,
      runnable.value && props.permissions.alertCreate !== false && !otherOrg.value,
      () => void act({ kind: "create_alert_draft", query, ...turnId }),
    ),
  ];
  return all.filter((entry) => entry.shown && (!entry.phoneOnly || !mdUp.value));
});

function item(
  id: string,
  key: MenuKey,
  icon: IconName,
  phoneOnly: boolean,
  shown: boolean,
  onSelect: () => void,
): MenuItem {
  return {
    id,
    label: t(key),
    icon,
    dataTest: `assistant-query-${id}`,
    phoneOnly,
    shown,
    run: onSelect,
  };
}

function dispatch(action: AssistantAction) {
  if (!props.sid || !evidence)
    return Promise.resolve({ ok: false as const, reason: "failed" as const });
  return evidence.dispatch(props.sid, action);
}

// A session of another org is refused by the registry; the reader hears why.
async function act(action: AssistantAction) {
  const result = await dispatch(action);
  if (!result.ok && result.reason === "other_org" && props.sid && evidence)
    evidence.announce(
      props.sid,
      t("assistant.evidence.otherOrg", { org: raw(props.block.query.org) }),
    );
  return result;
}

async function startRun(): Promise<void> {
  if (!canRun.value || run.value?.status === "running") return;
  const started = act({
    kind: "run_query",
    query: props.block.query,
    blockId: props.block.blockId,
  });
  await nextTick();
  results.value?.focus();
  const result = await started;
  if (!props.sid || !evidence) return;
  const settled = run.value;
  if (result.ok && settled?.status === "done") {
    const count = settled.total ?? settled.rows?.length ?? 0;
    evidence.announce(
      props.sid,
      t("assistant.evidence.rowsCount", { count: formatCount(count) }, count),
    );
  } else if (settled) evidence.announce(props.sid, outcomeLine.value);
}

// Stop removes itself, so focus moves to the results region that now says "Stopped".
async function stopRun(): Promise<void> {
  await dispatch({ kind: "stop_query", blockId: props.block.blockId });
  await nextTick();
  results.value?.focus();
}

// Ctrl/⌘, Shift and middle clicks keep the browser's own new-tab behaviour.
function onOpen(event: MouseEvent): void {
  if (!live.value) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) return;
  event.preventDefault();
  void act({ kind: "open_in_explorer", query: props.block.query, explorer: explorer.value });
}

async function copyQuery(): Promise<void> {
  if (!live.value || !props.sid || !evidence) {
    await copyToClipboard(props.block.query.text, t, {
      successMessage: t("assistant.evidence.copied"),
    });
    return;
  }
  const result = await dispatch({ kind: "copy", text: props.block.query.text, what: "query" });
  manualCopy.value = !result.ok;
  evidence.announce(
    props.sid,
    result.ok ? t("assistant.evidence.copied") : t("assistant.client.copyManually"),
  );
}

async function insert(): Promise<void> {
  const host = editorHost.value;
  if (!host || insertState.value !== "idle") return;
  const { stream, from, to } = props.block.query;
  reviewing.value = true;
  insertNote.value = null;
  const result = await act({
    kind: "insert_into_editor",
    text: props.block.query.text,
    language: props.block.query.language,
    hostId: host.id,
    mode: "replace",
    provenance: {
      prompt: promptOfTurn(),
      ...(stream && { stream }),
      ...(from && to && { range: { from, to } }),
    },
  });
  const outcome = result.ok ? (result.detail as InsertOutcome | undefined) : undefined;
  reviewing.value = false;
  const label = proposalFor(host.id)?.label;
  landed.value =
    outcome?.decision === "accepted" && label?.value ? { label, at: label.value.acceptedAt } : null;
  if (outcome?.decision === "no_change") insertNote.value = t("assistant.helper.noChange");
  else if (outcome?.decision === "discarded") insertNote.value = t("assistant.helper.discarded");
  else if (outcome?.note) insertNote.value = t(outcome.note);
}

// The provenance line quotes the user's own prompt of this turn, never the model's text.
function promptOfTurn(): string {
  const session = props.sid && evidence ? evidence.session(props.sid) : null;
  const prompt = session?.messages.find(
    (message) => message.role === "user" && message.turnId === props.turnId,
  );
  return String(prompt?.content ?? "");
}

function openSource(): void {
  const callId = props.block.sourceCallId;
  if (!callId) return;
  void dispatch({ kind: "open_step", callId }).then(() => revealStep(root.value, callId));
}

function selectAll(event: FocusEvent): void {
  (event.target as HTMLInputElement | null)?.select?.();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.key !== "Escape" || run.value?.status !== "running") return;
  event.preventDefault();
  event.stopPropagation();
  void stopRun();
}

// Escape anywhere in the block stops a run; the group itself is not a control, so it listens directly.
watch(root, (el, _old, onCleanup) => {
  if (!el) return;
  el.addEventListener("keydown", onKeydown);
  onCleanup(() => el.removeEventListener("keydown", onKeydown));
});

watch(
  () => run.value?.status === "running",
  (running) => {
    if (ticker) clearInterval(ticker);
    ticker = null;
    if (!running) return;
    now.value = Date.now();
    ticker = setInterval(() => (now.value = Date.now()), 1000);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker);
});
</script>
